// core-helpers.mjs — ported from src/tools/minimax_h3/core.ts (types stripped, DOM/Vite removed).
// Pure functions + the default `state` shape buildClipGraph reads, plus a snake_case
// config -> camelCase state mapper (the studio does this in settings.ts on load).

export const FPS = 24;
export const SUBFOLDER = "one_minimax_h3";
export const ONE_TAKE_OVERLAP_FRAMES = 39;
export const DEFAULT_FRAMES = 192; // 8s @ 24fps

/** The evaluation counts released PDD checkpoints were partitioned for — a fixed list. */
export const PDD_NFE_CHOICES = ["8", "4", "6"];

// Portrait -> Square -> Landscape
export const ASPECTS = [
  { label: "9:16 Portrait", w: 9, h: 16 },
  { label: "2:3 Portrait", w: 2, h: 3 },
  { label: "3:4 Portrait", w: 3, h: 4 },
  { label: "4:5 Portrait", w: 4, h: 5 },
  { label: "1:1 Square", w: 1, h: 1 },
  { label: "5:4 Landscape", w: 5, h: 4 },
  { label: "4:3 Landscape", w: 4, h: 3 },
  { label: "3:2 Landscape", w: 3, h: 2 },
  { label: "16:9 Landscape", w: 16, h: 9 },
  { label: "21:9 Cinema", w: 21, h: 9 },
];

/** RTX VSR target-size math — "scale" | "short" | "long" | "wh" size modes. Ported verbatim
 *  from core.ts computeRtxTarget(). srcW/srcH is whatever the RTX pass actually receives. */
export function computeRtxTarget(state, srcW, srcH) {
  const mode = state.rtxSizeMode || "scale";
  const round8 = (v) => Math.max(8, Math.round(v / 8) * 8);
  if (mode === "short" || mode === "long") {
    const short = Math.min(srcW, srcH), long = Math.max(srcW, srcH);
    const target = Math.max(8, Math.round(mode === "short" ? (state.rtxShort ?? 1080) : (state.rtxLong ?? 1920)));
    const otherTarget = mode === "short" ? target * (long / short) : target * (short / long);
    const isWSide = srcW <= srcH;
    const width = mode === "short" ? (isWSide ? target : round8(otherTarget)) : (isWSide ? round8(otherTarget) : target);
    const height = mode === "short" ? (isWSide ? round8(otherTarget) : target) : (isWSide ? target : round8(otherTarget));
    return { resizeType: "target dimensions", width: round8(width), height: round8(height), crop: null };
  }
  if (mode === "wh") {
    const width = round8(Math.max(8, Math.round(state.rtxW ?? 1920)));
    const height = round8(Math.max(8, Math.round(state.rtxH ?? 1080)));
    const targetAspect = width / height, srcAspect = srcW / srcH;
    let cropW = srcW, cropH = srcH;
    if (srcAspect > targetAspect) cropW = Math.round(srcH * targetAspect);
    else if (srcAspect < targetAspect) cropH = Math.round(srcW / targetAspect);
    const anchor = state.rtxCropAnchor || "center";
    const x = anchor === "left" ? 0 : anchor === "right" ? srcW - cropW : Math.round((srcW - cropW) / 2);
    const y = anchor === "top" ? 0 : anchor === "bottom" ? srcH - cropH : Math.round((srcH - cropH) / 2);
    const crop = cropW < srcW || cropH < srcH ? { x, y, width: cropW, height: cropH } : null;
    return { resizeType: "target dimensions", width, height, crop };
  }
  return { resizeType: "scale by multiplier", scale: state.rtxScale ?? 2.0, crop: null };
}

// Character Sheet's fixed frame count for the 8-shot turnaround (each [Shot N] marker in the
// reference prompt template assumes this exact length) + its default grid frame picks.
export const CHARSHEET_FRAMES = 124;
export const CHARSHEET_DEFAULT_FRAME_INDICES = [7, 22, 37, 52, 67, 82, 107, 118];

export function resolveResolution(aspectLabel, megapixels) {
  const a = ASPECTS.find((x) => x.label === aspectLabel) || ASPECTS[0];
  const mp = Math.max(0.1, megapixels || 1.0);
  const target = mp * 1_000_000;
  const ratio = a.w / a.h;
  let h = Math.sqrt(target / ratio);
  let w = h * ratio;
  const snap = (v) => Math.max(32, Math.round(v / 32) * 32);
  return { width: snap(w), height: snap(h) };
}

export function framesToSeconds(frames) {
  return frames / FPS;
}

/** Mirrors comfy_extras/nodes_minimax_h3.py's align_frame_count (17k+5 frame grid, rounds up). */
export function alignFrameCount(n) {
  let f = Math.max(5, Math.round(n));
  while (f % 17 !== 5) f++;
  return f;
}

/** Compose the one H3 prompt string from the job's 3-field object (or pass a raw string). */
export function composePrompt(prompt) {
  if (typeof prompt === "string") return prompt.trim();
  if (!prompt || typeof prompt !== "object") return "";
  const parts = [];
  const desc = (prompt.integrated_multimodal_description || prompt.description || prompt.text || "").trim();
  if (desc) parts.push(desc);
  const amb = (prompt.overall_soundscape || prompt.ambient_sound || "").trim();
  if (amb) parts.push(`overall_soundscape: ${amb}`);
  const mus = (prompt.non_diegetic_music || prompt.music || "").trim();
  if (mus) parts.push(`non_diegetic_music: ${mus}`);
  return parts.join("\n\n");
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e15);
}

/** Trigger words from enabled LoRA slots, joined for the prompt tail. Ported from core.ts
 *  loraTriggers(). */
export function loraTriggers(state) {
  return (state.loras || [])
    .filter((l) => l && l.enabled !== false && l.name && l.name !== "none" && l.triggerWord)
    .map((l) => String(l.triggerWord).trim())
    .filter(Boolean)
    .join(", ");
}

/** Composes one clip's full prompt: header + this clip's body (falling back to the nearest
 *  earlier non-empty prompts[] entry when the array is shorter than the clip count — clip 5
 *  with only 3 prompts given reuses prompts[2]) + footer + LoRA triggers + suffix. Ported
 *  verbatim from core.ts composeClipPrompt() (state.prompts is a flat string[] here, not the
 *  {text,firstFrame,enabled} PromptEntry[] the studio panel uses — headless jobs have no
 *  per-clip first-frame override or enable toggle). */
export function composeClipPrompt(state, i) {
  const list = state.prompts || [];
  let body = "";
  for (let k = Math.min(i, list.length - 1); k >= 0; k--) {
    const t = String(list[k] || "").trim();
    if (t) { body = t; break; }
  }
  return [state.promptHeader, body, state.promptFooter, loraTriggers(state), state.promptSuffix]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Overlap-trimmed total duration for a stitched One-Take run — same formula as core.ts
 *  clipPlan() (isOneTakeStitched / stitchedSeconds), kept in sync so a headless estimate
 *  matches what the stitch endpoint actually produces. */
export function oneTakeStitchedSeconds(clipCount, clipFrames) {
  const clipSec = framesToSeconds(clipFrames || DEFAULT_FRAMES);
  const actualSeconds = clipCount * clipSec;
  const overlapSec = framesToSeconds(alignFrameCount(ONE_TAKE_OVERLAP_FRAMES));
  return clipCount > 1 ? actualSeconds - (clipCount - 1) * overlapSec : actualSeconds;
}

export const ATTN_BACKENDS = [
  { key: "none", label: "None" },
  { key: "sage", label: "Sage", node: "PathchSageAttentionKJ" },
  { key: "ck", label: "CK-Attention", node: "ModelAttentionBackend" },
  { key: "solattn_kijai", label: "SolAttn (kijai)", node: "SolAttnPatch" },
  { key: "sla", label: "H3 SLA Attention", node: "H3SLAAttention" },
];

export const ATTN_FORWARDS = [
  { key: "none", label: "None", dense: true },
  { key: "memeff_sage", label: "MemEff Sage", node: "MiniMaxH3MemoryEfficientSageAttentionPatch", dense: true },
  { key: "solattn_saganaki", label: "SolAttn (Saganaki22, scheduled)", node: "MiniMaxH3ScheduledSolAttentionPatch", dense: false },
];

/** The only real block on the H3 forward patch: a 4-step larryvrh schedule + a sparse forward kernel. */
export function attnForwardBlockedReason(state, key) {
  const f = ATTN_FORWARDS.find((x) => x.key === key);
  if (!f || key === "none") return "";
  if (state.turboMode === "larryvrh" && !f.dense) {
    return "Turbo LoRA (larryvrh) runs 4 steps — a sparse forward kernel's approximation error is too large to absorb there.";
  }
  return "";
}

/** Block caches never reach their reuse threshold under a turbo schedule. */
export function blockCacheBlockedReason(state, key) {
  if (key === "none") return "";
  if (state.turboMode === "larryvrh" || state.turboMode === "lightx2v" || state.turboMode === "pdd") {
    return "A turbo schedule is only a handful of steps — it never reaches the threshold these caches reuse steps at.";
  }
  return "";
}

/** H3 Memory Opt is never blocked; the Sparse stage is gated like a sparse backend and can't
 *  own attn.forward when a turbo, an already-sparse backend, or an H3 forward patch has it. */
export function h3OptimizerBlockedReason(state, key) {
  if (!key || key === "none" || key === "memory") return "";
  if (key === "memory_sparse") {
    if (state.turboMode && state.turboMode !== "none") {
      return "The Sparse stage approximates attention — a few-step turbo schedule can't absorb that. Use plain H3 Memory Opt.";
    }
    if (state.attnBackend === "solattn_kijai" || state.attnBackend === "sla") {
      return "The attention backend is already sparse — H3 Sparse on top double-sparsifies. Use plain H3 Memory Opt.";
    }
    if (state.attnForward && state.attnForward !== "none") {
      return "An H3 attention-forward patch keeps the blocks' attention — H3 Sparse can't route around it. Use plain H3 Memory Opt.";
    }
  }
  return "";
}

/** The PDD Acc file for the current generation mode (per-variant release: Ref2VA vs FL2VA). */
export function pddFileForMode(state) {
  const isRef = (state.generationMode || "t2v") === "reference";
  const pick = isRef ? state.pddFileReference : state.pddFile;
  return pick && pick !== "none" ? pick : "";
}

// ── Pipeline preset apply (SPEC_MINIMAX_H3_PRESETS.md + CONTINUE_AND_EXTEND §4) ──
export const RECIPE_KEYS = [
  "steps", "sampler", "scheduler", "denoise", "shiftVideo", "shiftAudio",
  "turboSteps", "slaTurboSteps",
  "turboLora", "turboLoraReference", "pddFile", "pddFileReference",
  "unetFirstLast", "unetReference",
];

/** Writes a preset's axes onto state; RECIPE_KEYS restore whatever the (user) preset carries.
 *  Built-in presets carry axes only, so steps/model/etc. stay at their config values. */
export function applyPreset(state, preset) {
  state.turboMode = preset.turbo;
  state.attnBackend = preset.backend;
  state.attnForward = preset.forward;
  state.blockCache = preset.cache;
  state.useSpectrum = !!preset.spectrum;
  state.useTorchPatch = !!preset.torch;
  state.useFusedModulation = !!preset.fused;
  if (preset.nfe) state.pddNfe = String(preset.nfe);
  state.fp16Accum = true; // rides along with the Torch patch
  for (const k of RECIPE_KEYS) if (preset[k] !== undefined) state[k] = preset[k];
}

// ── Built-in fallback presets — used only if the backend user_presets[] lookup misses.
// Numeric ids carried over from the node-side 39-config bench. See SPEC_MINIMAX_H3_PRESETS.md.
export const BUILTIN_PRESETS = [
  { id: 1,  alias: "stock",        turbo: "none",     backend: "none", forward: "none",         cache: "none",    spectrum: false, torch: false, fused: false },
  { id: 4,  alias: "dense",        turbo: "none",     backend: "sage", forward: "memeff_sage",  cache: "none",    spectrum: false, torch: true,  fused: true  },
  { id: 5,  alias: "turbo-4step",  turbo: "larryvrh", backend: "sage", forward: "memeff_sage",  cache: "none",    spectrum: false, torch: true,  fused: true  },
  { id: 18, alias: "everyday",     turbo: "none",     backend: "sage", forward: "memeff_sage",  cache: "fbcache", spectrum: false, torch: true,  fused: false },
  { id: 31, alias: "sla-turbo",    turbo: "lightx2v", backend: "sla",  forward: "none",         cache: "none",    spectrum: false, torch: true,  fused: false },
  { id: 38, alias: "pdd-spectrum", turbo: "pdd",      backend: "none", forward: "none",         cache: "none",    spectrum: true,  torch: true,  fused: false, nfe: "8" },
];

const norm = (s) => String(s || "").toLowerCase().replace(/[\s_-]+/g, "");

/** Resolve a preset name against the backend user_presets[] first, then the built-in aliases /
 *  labels / ids. Returns { preset, source } or null. */
export function resolvePreset(name, userPresets) {
  if (name == null) return { preset: null, source: "none" };
  const want = norm(name);
  const u = (userPresets || []).find((p) => norm(p.name) === want);
  if (u) return { preset: u, source: "user" };
  const b = BUILTIN_PRESETS.find(
    (p) => norm(p.alias) === want || norm(p.label) === want || String(p.id) === want || norm(`preset ${p.id}`) === want
  );
  if (b) return { preset: b, source: "builtin" };
  return null;
}

// ── Default state — the shape buildClipGraph reads. Ported verbatim from core.ts defaultState(),
// minus the localStorage/migration path (headless always starts from a fresh config).
export function defaultState() {
  return {
    unetFirstLast: "", unetReference: "", clipName: "", vaeVideo: "", vaeAudio: "",
    turboLora: "", turboLoraReference: "", turboLoraStrength: 1.0, turboLoraLowVram: false,
    upscaleModel: "", targetLength: "",
    audioLock: false, lockAudioFile: "", audioLockMode: "lock", audioLockStrength: 0.5,
    audioLockFit: "pad_silence", audioLockTrimStart: 0, audioLockTrimEnd: 0,
    loras: [],
    generationMode: "t2v", accelMode: "solattn", upscaleMode: "none", deblurStrength: "none",
    saveUnprocessed: false,
    continuityMode: "onetake", oneTakeLockAudio: false, oneTakeAutoStitch: true, oneTakeAudioOverride: false,
    aspect: "16:9 Landscape", megapixels: 1.0,
    clipFrames: DEFAULT_FRAMES, clipLengthCustom: false, clipLengthCustomSec: framesToSeconds(DEFAULT_FRAMES),
    totalSeconds: 8, trimLastClip: false, avgMinutesPerClip: 13, unloadBetweenClips: true,
    prompts: [{ text: "", firstFrame: "", enabled: true }],
    promptHeader: "", promptFooter: "", promptSuffix: "",
    firstFrameImage: null, lastFrameImage: null, firstFrameMp: 1.0, lastFrameMp: 1.0,
    refImages: [], refImagesMp: [], refImageSize: "match",
    refVideos: [], refAudios: [],
    refTypes: { images: true, videos: false, audios: false },
    steps: 20, turboSteps: 4, slaTurboSteps: 6,
    sampler: "res_multistep", scheduler: "simple", denoise: 1.0,
    seed: 0, seedMode: "randomize", seedPerClip: true,
    useCache: true, useFirstBlockCache: false,
    saveSubfolder: "", filenamePrefix: "MMH3", stitchAtEnd: true,
    briefImageMode: "ref", visionSource: "native",
    nativeVisionClip: "Qwen3\\qwen_3vl_8b_nvfp4.safetensors",
    nativeBriefClip: "LTX\\gemma4_e2b_it_bf16.safetensors",
    pddFile: "none", pddFileReference: "none", pddNfe: "8", pddLoraStrength: 1.0, pddHeadStrength: 1.0,
    solTau: 1.3, solMinTokens: 4096, solStart: 0.2, solEnd: 0.9,
    specBlendWeight: 0.5, specDegree: 1, specRidgeLambda: 0.1, specWindowSize: 2.0, specFlexWindow: 0.75,
    specWarmupSteps: 1, specTailSteps: 1, specMaxHistory: 8, specHistoryStore: "system_ram",
    rtxScale: 2.0, rtxQuality: "ULTRA",
    shiftVideo: 12, shiftAudio: 3,
    useSageAttn: true, sageAttnMode: "auto", useMemEffSage: true,
    useCkAttention: false, ckAttentionBackend: "comfy_kitchen",
    useTorchPatch: true, fp16Accum: true,
    useSlaAttention: false, slaSparsity: 0.9, slaBlockSize: "64", slaMinSeqLen: 8192,
    slaDenseLastSteps: 0, slaProtectAudio: true, slaRunEnabled: true,
    fbcMode: "H3 Fast — 0.10 / max 2", fbcThreshold: 0.1, fbcStartPercent: 0.1, fbcEndPercent: 0.95,
    fbcMaxConsecutiveHits: 2, fbcTemporalGuard: false,
    cacheThreshold: 0.3, cacheMaxSteps: 2, cacheStart: 0.15, cacheEnd: 0.9,
    previewEnabled: false, previewFrames: 8, previewFps: 12, previewMaxRes: 512, previewQuality: 85,
    previewTinyVae: "none",
    turboMode: "none", attnBackend: "none", attnForward: "none", blockCache: "none",
    h3Optimizer: "none", h3MemChunkRows: 4096, h3MemPrecision: "Auto", h3MemQkvStreaming: "Auto",
    h3MemLowVram: false, h3SparseBudget: 0.15, h3SparseDenserEdges: true, h3SparseLayerBudgets: "",
    useSpectrum: false, useFusedModulation: false, pipelineMigrated: true,
    solSchedTauStart: 1.3, solSchedTauEnd: 0.8, solSchedCurve: "linear", solSchedMinTokens: 4096,
    solSchedStrict: false, solSchedDensePercent: 0.0, solSchedThreshType: "diag",
    solSchedInt8Qk: false, solSchedInt8Pv: false, solSchedSinkConditioning: "exact_kv_and_rows",
    solSchedDenseBlocks: "",

    // ── FlashVSR (shared upscaleMode "flashvsr" option on buildClipGraph, and the still-image
    // gallery upscaler never uses it — only the video clip path does).
    flashvsrModel: "FlashVSR-v1.1", flashvsrMode: "tiny", flashvsrScale: 2, flashvsrColorFix: true,
    flashvsrTileSize: 384, flashvsrTileOverlap: 32, flashvsrSeed: 42, flashvsrSeedMode: "fixed",

    // ── RTX VSR target-size fields (computeRtxTarget) — "scale" (default) never reads the rest.
    rtxSizeMode: "scale", rtxShort: 1080, rtxLong: 1920, rtxW: 1920, rtxH: 1080, rtxCropAnchor: "center",

    // ── Face Refine (generationMode "facerefine") ──────────────────────────────────────────
    frSource: "", frSourceKind: "gallery", frSourceMeta: null, frPrompt: "",
    frSelect: "largest_face", frSelectIndex: 0, frConfidence: 0.35, frConfirmedPick: "",
    frChainPicks: [], frCutDetection: false, frCutThreshold: 3.0,
    frIdentityTrack: true, frIdentityThreshold: 0.45, frIdentityModel: "insightface",
    frCropFactor: 2.5, frCanvasMode: "auto_capped_768", frCanvasWidth: 768, frCanvasHeight: 768,
    frSmoothWindow: 21,
    frDenoise: 0.40, frDenoiseMulSmall: 1.0, frDenoiseMulLarge: 0.35,
    frFacePxSmall: 30.0, frFacePxLarge: 120.0,
    frSteps: 8, frSampler: "euler", frScheduler: "simple",
    frPasteRegion: "face_only", frFeather: 6, frColourMatch: 1.0, frBlend: 1.0, frUndetected: "fade_out",
    faceDetector: "", faceFallbackDetector: "none",
    frUseCustomModel: false, frUnet: "", frClip: "",
    frLoras: [],
    frTurboOn: false, frTurboPreset: "",

    // ── Image Generator (generationMode "imagegen") ────────────────────────────────────────
    imageGenMode: "t2i",
    imgLoras: [],
    imgTurboLoraT2i: "none", imgTurboLoraRef2i: "none", imgTurboLoraStrength: 1.0,

    // ── Character Sheet (imageGenMode "charsheet") ─────────────────────────────────────────
    charSheetPrompt: "", charSheetSubjectName: "Character",
    charSheetFrameIndices: CHARSHEET_DEFAULT_FRAME_INDICES.slice(),
    charSheetDeblur: "none", charSheetRtxVsr: false, charSheetRtxSupersample: false,
    charSheetUseLatentUpscale: false, charSheetFirstPassRatio: 0.36,
    charSheetSaveEachFrames: false, charSheetMaxSize: 2048,
    charSheetVideoFile: null, charSheetVideoOutput: null, charSheetRefImage: null,
    charSheetCellW: 0, charSheetCellH: 0,
  };
}

/** Overlay a `GET /minimax_h3_one/config` response (snake_case) onto a state object.
 *  Mirrors settings.ts' getConfig().then(take(...)) block + the node's own get_config keys. */
export function applyConfig(state, cfg) {
  if (!cfg) return state;
  const take = (k, v) => { if (v && v !== "none") state[k] = v; };
  const set = (k, v) => { if (v != null) state[k] = v; };

  take("unetFirstLast", cfg.unet_first_last);
  take("unetReference", cfg.unet_reference);
  take("clipName", cfg.clip_name);
  take("vaeVideo", cfg.vae_video);
  take("vaeAudio", cfg.vae_audio);
  take("turboLora", cfg.turbo_lora);
  take("turboLoraReference", cfg.turbo_lora_reference);
  take("pddFile", cfg.pdd_file);
  take("pddFileReference", cfg.pdd_file_reference);
  take("upscaleModel", cfg.upscale_model);
  take("nativeVisionClip", cfg.native_vision_clip);
  take("filenamePrefix", cfg.filename_prefix);
  take("saveSubfolder", cfg.save_subfolder);

  set("turboLoraStrength", cfg.turbo_lora_strength);
  set("turboLoraLowVram", cfg.turbo_lora_low_vram);
  set("sampler", cfg.sampler);
  set("scheduler", cfg.scheduler);
  set("denoise", cfg.denoise);
  set("shiftVideo", cfg.shift_video);
  set("shiftAudio", cfg.shift_audio);
  set("sageAttnMode", cfg.sage_attn_mode);
  set("useSageAttn", cfg.use_sage_attn);
  set("useMemEffSage", cfg.use_mem_eff_sage);
  set("useTorchPatch", cfg.use_torch_patch);
  set("fp16Accum", cfg.fp16_accum);
  set("useCkAttention", cfg.use_ck_attention);
  set("ckAttentionBackend", cfg.ck_attention_backend);
  set("useSlaAttention", cfg.use_sla_attention);
  set("slaSparsity", cfg.sla_sparsity);
  set("slaBlockSize", cfg.sla_block_size);
  set("slaMinSeqLen", cfg.sla_min_seq_len);
  set("slaDenseLastSteps", cfg.sla_dense_last_steps);
  set("slaProtectAudio", cfg.sla_protect_audio);
  set("fbcMode", cfg.fbc_mode);
  set("fbcThreshold", cfg.fbc_threshold);
  set("fbcStartPercent", cfg.fbc_start_percent);
  set("fbcEndPercent", cfg.fbc_end_percent);
  set("fbcMaxConsecutiveHits", cfg.fbc_max_hits ?? cfg.fbc_max_consecutive_hits);
  set("fbcTemporalGuard", cfg.fbc_temporal_guard);
  set("cacheThreshold", cfg.cache_threshold);
  set("cacheStart", cfg.cache_start);
  set("cacheEnd", cfg.cache_end);
  set("cacheMaxSteps", cfg.cache_max_steps);
  set("pddNfe", cfg.pdd_nfe != null ? String(cfg.pdd_nfe) : undefined);
  set("pddLoraStrength", cfg.pdd_lora_strength);
  set("pddHeadStrength", cfg.pdd_head_strength);
  set("slaTurboSteps", cfg.sla_turbo_steps);

  // Pipeline axes — the node persists these to config; the web keeps them per-run. A job's
  // preset overrides them anyway (applyPreset runs after this), so these only matter when
  // job.preset is null: then the run matches "the studio with no preset selected".
  set("turboMode", cfg.turbo_mode);
  set("attnBackend", cfg.attn_backend);
  set("attnForward", cfg.attn_forward);
  set("blockCache", cfg.block_cache);
  set("useSpectrum", cfg.use_spectrum);
  set("useFusedModulation", cfg.use_fused_modulation);
  if (cfg.h3_optimizer) set("h3Optimizer", cfg.h3_optimizer);

  // Scheduled SolAttn detail params.
  set("solSchedTauStart", cfg.sol_sag_tau_start);
  set("solSchedTauEnd", cfg.sol_sag_tau_end);
  set("solSchedCurve", cfg.sol_sag_curve);
  set("solSchedMinTokens", cfg.sol_sag_min_tokens);
  set("solSchedDensePercent", cfg.sol_sag_dense_percent);
  set("solSchedThreshType", cfg.sol_sag_thresh_type);
  set("solSchedInt8Qk", cfg.sol_sag_int8_qk);
  set("solSchedInt8Pv", cfg.sol_sag_int8_pv);
  set("solSchedSinkConditioning", cfg.sol_sag_sink_cond);
  set("solSchedDenseBlocks", cfg.sol_sag_dense_blocks);

  return state;
}

/** Map a headless job.mode onto the studio's generationMode. */
export function jobModeToGenerationMode(mode) {
  const m = String(mode || "t2va").toLowerCase();
  if (m === "ref2va" || m === "reference") return "reference";
  if (m === "fl2va" || m === "firstlast" || m === "first_last") return "firstlast";
  // l2va / t2va / text -> the plain text-to-video path
  return "t2v";
}
