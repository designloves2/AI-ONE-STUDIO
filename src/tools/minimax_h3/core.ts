// core.ts — MiniMax H3 ONE STUDIO 상수/상태/헬퍼.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/minimax/core_minimax.js (거의 그대로 이식,
// 정사각형 위젯 전용 레이아웃 상수(NODE_W/PREVIEW_SIZE/LEFT_W)는 웹 레이아웃에서 쓰지 않으므로 제외)

export const LS_KEY = "minimax_h3_one_state_v1";
export const API = "/minimax_h3_one";
export const SUBFOLDER = "one_minimax_h3";
export const FPS = 24;

export interface PromptEntry {
  text: string;
  firstFrame: string;
  enabled: boolean;
}

export interface LoraEntry {
  name: string;
  strength: number;
  triggerWord: string;
  enabled: boolean;
}

export interface MinimaxState {
  unetFirstLast: string;
  unetReference: string;
  clipName: string;
  vaeVideo: string;
  vaeAudio: string;
  turboLora: string;
  turboLoraReference: string;
  turboLoraStrength: number;
  turboLoraLowVram: boolean;
  upscaleModel: string;
  targetLength: string;
  audioLock: boolean;
  lockAudioFile: string;
  audioLockMode: string;
  audioLockStrength: number;
  audioLockFit: string;
  audioLockTrimStart: number;
  audioLockTrimEnd: number;
  loras: LoraEntry[];
  generationMode: string;
  accelMode: string;
  upscaleMode: string;
  continuityMode: string;
  oneTakeLockAudio: boolean;
  oneTakeAutoStitch: boolean;
  oneTakeAudioOverride: boolean;
  aspect: string;
  megapixels: number;
  clipFrames: number;
  clipLengthCustom: boolean;
  clipLengthCustomSec: number;
  totalSeconds: number;
  trimLastClip: boolean;
  avgMinutesPerClip: number;
  unloadBetweenClips: boolean;
  prompts: PromptEntry[];
  promptHeader: string;
  promptFooter: string;
  promptSuffix: string;
  firstFrameImage: string | null;
  lastFrameImage: string | null;
  firstFrameMp: number;
  lastFrameMp: number;
  refImages: string[];
  refImagesMp: number[];
  refImageSize: string;
  refVideos: { file: string; start: number; end: number; withAudio?: boolean }[];
  refAudios: { file: string; start: number; end: number }[];
  refTypes: { images?: boolean; videos?: boolean; audios?: boolean };
  steps: number;
  turboSteps: number;
  slaTurboSteps: number; // lightx2v's own step count — separate from turboSteps (larryvrh) and steps (no turbo)
  sampler: string;
  scheduler: string;
  denoise: number;
  seed: number;
  seedMode: string;
  seedPerClip: boolean;
  useCache: boolean;
  useFirstBlockCache: boolean;
  saveSubfolder: string;
  filenamePrefix: string;
  stitchAtEnd: boolean;
  targetLengthSeconds?: string;
  ollamaUrl: string;
  ollamaModel: string;
  ollamaVisionModel: string;
  ollamaTemperature: number;
  ollamaTopP: number;
  ollamaImageMode: string;
  ollamaImages: string[];
  visionSource: string; // "ollama" | "native"
  nativeVisionClip: string;
  nativeBriefClip: string;

  // Turbo LoRA
  turboLoraStrength: number;
  turboLoraLowVram: boolean;
  // SolAttn (SolAttnPatch)
  solTau: number;
  solMinTokens: number;
  solStart: number;
  solEnd: number;
  // Spectrum (SpectrumApplyMiniMaxH3)
  specBlendWeight: number;
  specDegree: number;
  specRidgeLambda: number;
  specWindowSize: number;
  specFlexWindow: number;
  specWarmupSteps: number;
  specTailSteps: number;
  specMaxHistory: number;
  specHistoryStore: string;

  // RTX VSR upscale
  rtxScale: number;
  rtxQuality: string;

  // Sigma shift (MiniMaxH3SigmaShift)
  shiftVideo: number;
  shiftAudio: number;

  // Model patches
  useSageAttn: boolean;
  sageAttnMode: string;
  useMemEffSage: boolean;
  useCkAttention: boolean;
  ckAttentionBackend: string;
  useTorchPatch: boolean;
  fp16Accum: boolean;
  cacheThreshold: number;
  cacheMaxSteps: number;
  cacheStart: number;
  cacheEnd: number;

  // H3 SLA Attention (block-sparse, last before the sampler)
  useSlaAttention: boolean;
  slaSparsity: number;
  slaBlockSize: string;
  slaMinSeqLen: number;
  slaDenseLastSteps: number;
  slaProtectAudio: boolean;
  slaRunEnabled: boolean;

  // H3 FirstBlockCache (step reuse) — three calibrated presets + a manual Custom mode.
  // Manual fields (fbcThreshold/fbcStartPercent/fbcEndPercent/fbcMaxConsecutiveHits/
  // fbcTemporalGuard) only take effect when fbcMode is "Custom — manual values".
  fbcMode: string;
  fbcThreshold: number;
  fbcStartPercent: number;
  fbcEndPercent: number;
  fbcMaxConsecutiveHits: number;
  fbcTemporalGuard: boolean;

  // ── Pipeline axes (v1.17.0 port, SPEC_MINIMAX_H3_PIPELINE_AXES.md) ──────────────────────
  // One control per patch layer, replacing the old single accelMode + scattered booleans.
  // These are now the source of truth for buildModelChain(); the legacy fields above
  // (accelMode, useSageAttn, useCkAttention, useSlaAttention, useMemEffSage, useCache,
  // useFirstBlockCache) are read only by migratePipelineState() to seed these once.
  turboMode: string; // "none" | "larryvrh" | "lightx2v" (lightx2v is a regular LoRA — add it in the LoRA section; picking it here just forces attnBackend to "sla" and suggests 6 steps)
  attnBackend: string; // "none" | "sage" | "ck" | "solattn_kijai" | "sla" — L6/L7, single-select
  attnForward: string; // "none" | "memeff_sage" | "solattn_saganaki" — L5, blocked whenever attnBackend replaces attn.forward itself (ck/solattn_kijai/sla)
  blockCache: string; // "none" | "h3cache" | "fbcache" — L2/L3, blocked entirely under either Turbo mode
  useSpectrum: boolean; // L1, independent of attnBackend/blockCache — orthogonal axis
  useFusedModulation: boolean; // L4, safe with every other axis
  pipelineMigrated: boolean;
  // MiniMaxH3ScheduledSolAttentionPatch (Saganaki22/ComfyUI-sol-attn) — strict superset of
  // that pack's MemoryEfficient variant; set tau_start==tau_end for the old fixed-tau behavior.
  solSchedTauStart: number;
  solSchedTauEnd: number;
  solSchedCurve: string; // "linear" | "cosine" | "sqrt" | "smoothstep"
  solSchedMinTokens: number;
  solSchedStrict: boolean;
  solSchedDensePercent: number;
  solSchedThreshType: string; // "diag" | "exact"
  solSchedInt8Qk: boolean;
  solSchedInt8Pv: boolean;
  solSchedSinkConditioning: string; // "exact_kv" | "exact_kv_and_rows" | "off"
  solSchedDenseBlocks: string;

  // Live preview (ModelPreviewOverrideKJ)
  previewEnabled: boolean;
  previewFrames: number;
  previewFps: number;
  previewMaxRes: number;
  previewQuality: number;
  // "none"(기본, Latent2RGB로 폴백) 또는 models/vae_approx의 파일명 — 지정하면 진짜 VAE로
  // 디코드한 실시간 프리뷰가 나온다(Latent2RGB보다 정확하지만 스텝마다 약간 더 느림).
  previewTinyVae: string;
}

export const CLIP_LENGTHS = (() => {
  const out: { frames: number; seconds: number; label: string }[] = [];
  for (let n = 124; n <= 362; n += 17) {
    const sec = n / FPS;
    out.push({ frames: n, seconds: sec, label: `${sec.toFixed(2)}s  (${n}f)` });
  }
  return out;
})();
export const DEFAULT_FRAMES = 192; // 8.000s

export function framesToSeconds(frames: number) {
  return frames / FPS;
}

/** Mirrors comfy_extras/nodes_minimax_h3.py's align_frame_count (17k+5 frame grid, rounds up). */
export function alignFrameCount(n: number): number {
  let f = Math.max(5, Math.round(n));
  while (f % 17 !== 5) f++;
  return f;
}

/** Turn the tensor errors these packs throw into something actionable. */
export function explainGenerationError(message: string): string | null {
  const m = String(message || "");
  if (/must match the size of tensor b \(2\)/.test(m) || /adaln/i.test(m)) {
    return "The turbo LoRA doesn't match this mode's base model — turbo LoRAs are fl2v-only. Switch Acceleration to SolAttn, Spectrum or None.";
  }
  if (/failed to extract audio/i.test(m)) {
    return "A reference video has no audio track but its soundtrack was requested — untick \"also use this clip's soundtrack\" for that video.";
  }
  if (/VAEDecodeAudio/i.test(m) && /must match the size of tensor/i.test(m)) {
    return "The audio VAE couldn't decode this latent. Check that the Audio VAE in ⚙ Settings is the MiniMax audio VAE and that the mode's UNET matches (Reference needs the Ref2VA model).";
  }
  if (/shape mismatch/i.test(m) && /cannot be broadcast/i.test(m)) {
    return "The sampler rejected the reference tokens. Check the Reference UNET in ⚙ Settings is the Ref2VA model, and that Acceleration isn't Turbo.";
  }
  return null;
}

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

export function resolveResolution(aspectLabel: string, megapixels: number) {
  const a = ASPECTS.find((x) => x.label === aspectLabel) || ASPECTS[0];
  const mp = Math.max(0.1, megapixels || 1.0);
  const target = mp * 1_000_000;
  const ratio = a.w / a.h;
  let h = Math.sqrt(target / ratio);
  let w = h * ratio;
  const snap = (v: number) => Math.max(32, Math.round(v / 32) * 32);
  return { width: snap(w), height: snap(h) };
}

export const SAMPLERS = ["euler", "euler_ancestral", "heun", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_3m_sde", "ddim", "uni_pc", "res_multistep", "er_sde", "lcm", "deis"];
export const SCHEDULERS = ["simple", "normal", "karras", "exponential", "sgm_uniform", "beta", "ddim_uniform"];

export const GENERATION_MODES = [
  { key: "t2v", label: "Text only", hint: "prompt only (T2VA)" },
  { key: "firstlast", label: "First/Last Frame", hint: "start + end keyframe (FL2VA)" },
  { key: "reference", label: "Reference", hint: "up to 9 reference images (REF2VA)" },
];

export const ACCEL_MODES = [
  { key: "turbo", label: "Turbo LoRA(larryvrh)", node: "MiniMaxH3TurboLoRA", modes: ["t2v", "firstlast", "reference"] },
  { key: "solattn", label: "SolAttn", node: "SolAttnPatch" },
  { key: "spectrum", label: "Spectrum", node: "SpectrumApplyMiniMaxH3" },
  { key: "none", label: "None", node: null },
];

export function accelModesFor(generationMode: string) {
  return ACCEL_MODES.filter((m) => !m.modes || m.modes.includes(generationMode || "t2v"));
}

// ── Pipeline axes (v1.17.0 port) — one control per patch layer instead of one accelMode. ──

export const TURBO_MODES = [
  { key: "none", label: "None" },
  { key: "larryvrh", label: "Turbo LoRA (larryvrh)", modes: ["t2v", "firstlast", "reference"] },
  { key: "lightx2v", label: "SLA Turbo (lightx2v)" },
] as const;
export function turboModesFor(generationMode: string) {
  return TURBO_MODES.filter((m: any) => !m.modes || m.modes.includes(generationMode || "t2v"));
}

export const ATTN_BACKENDS = [
  { key: "none", label: "None" },
  { key: "sage", label: "Sage", node: "PathchSageAttentionKJ" },
  { key: "ck", label: "CK-Attention", node: "ModelAttentionBackend" },
  { key: "solattn_kijai", label: "SolAttn (kijai)", node: "SolAttnPatch" },
  { key: "sla", label: "H3 SLA Attention", node: "H3SLAAttention" },
] as const;

export const ATTN_FORWARDS = [
  { key: "none", label: "None" },
  { key: "memeff_sage", label: "MemEff Sage", node: "MiniMaxH3MemoryEfficientSageAttentionPatch" },
  { key: "solattn_saganaki", label: "SolAttn (Saganaki22, scheduled)", node: "MiniMaxH3ScheduledSolAttentionPatch" },
] as const;

export const BLOCK_CACHES = [
  { key: "none", label: "None" },
  { key: "h3cache", label: "H3 Cache", node: "MiniMaxH3Cache" },
  { key: "fbcache", label: "FirstBlockCache", node: "ApplyMiniMaxH3FirstBlockCache" },
] as const;

/** Why an attention-backend option is greyed out, or "" if it's fine. Shown inline, never hidden. */
export function attnBackendBlockedReason(state: MinimaxState, key: string): string {
  if (key === "none" || key === "sage") return "";
  if (state.turboMode === "larryvrh" && (key === "solattn_kijai" || key === "sla")) {
    return "Turbo LoRA (larryvrh) needs dense attention — its 4 steps leave no room for sparse-approximation error to average out.";
  }
  if (state.turboMode === "lightx2v" && key !== "sla") {
    return "SLA Turbo (lightx2v) is a LoRA distilled against the SLA kernel — it gives no speedup and isn't validated without SLA attention.";
  }
  return "";
}

/** Why an attention-forward option is greyed out, or "" if it's fine. */
export function attnForwardBlockedReason(state: MinimaxState, key: string): string {
  if (key === "none") return "";
  if (state.attnBackend === "ck" || state.attnBackend === "solattn_kijai" || state.attnBackend === "sla") {
    return "This patch replaces the block's own attention call — the selected attention backend would never run underneath it.";
  }
  return "";
}

/** Why a block-cache option is greyed out, or "" if it's fine. */
export function blockCacheBlockedReason(state: MinimaxState, key: string): string {
  if (key === "none") return "";
  if (state.turboMode === "larryvrh" || state.turboMode === "lightx2v") {
    return "Block caches aren't validated with either Turbo mode.";
  }
  return "";
}

/**
 * One-time conversion from the old accelMode + scattered attention/cache booleans into the
 * new axis fields, so saved workflows don't reset. SLA is given priority when multiple old
 * backends were on at once, since it was the one silently winning before this port (bug ①
 * in SPEC_MINIMAX_H3_PIPELINE_AXES.md). Mutates `saved` in place; call before defaultState()
 * reads turboMode/attnBackend/etc. off it. Guarded by pipelineMigrated so it only ever runs once.
 */
export function migratePipelineState(saved: Partial<MinimaxState> & Record<string, any>): void {
  if (saved.pipelineMigrated) return;

  if (saved.turboMode == null) {
    saved.turboMode = saved.accelMode === "turbo" ? "larryvrh" : "none";
  }
  if (saved.useSpectrum == null) {
    saved.useSpectrum = saved.accelMode === "spectrum" ? true : !!saved.useSpectrum;
  }
  if (saved.attnBackend == null) {
    if (saved.useSlaAttention) saved.attnBackend = "sla";
    else if (saved.useCkAttention) saved.attnBackend = "ck";
    else if (saved.accelMode === "solattn") saved.attnBackend = "solattn_kijai";
    else if (saved.useSageAttn) saved.attnBackend = "sage";
    else saved.attnBackend = "none";
  }
  if (saved.attnForward == null) {
    saved.attnForward = saved.useMemEffSage ? "memeff_sage" : "none";
  }
  if (saved.blockCache == null) {
    saved.blockCache = saved.useFirstBlockCache ? "fbcache" : saved.useCache ? "h3cache" : "none";
  }
  saved.pipelineMigrated = true;
}

export const UPSCALE_MODES = [
  { key: "none", label: "None" },
  { key: "model", label: "Upscale Model" },
  { key: "rtx", label: "RTX VSR" },
];

export const CONTINUITY_MODES = [
  { key: "none", label: "None", hint: "nothing is handed between clips — each one is made from its prompt, on the run's own model; only the common prompt keeps them consistent" },
  {
    key: "onetake",
    label: "One-Take (latent)",
    hint: "each clip's sampled latent tail feeds straight into the next clip's head — no VAE round trip, and the run's own mode (including Reference) carries on unchanged",
    refHint: "each clip's sampled latent tail feeds straight into the next clip's head — reference images keep conditioning every clip, unlike Last Frame Chain which drops them after the first",
  },
  { key: "reference", label: "Reference", refOnly: true, hint: "every clip re-uses the same reference images — the mode carries on unchanged" },
  {
    key: "lastframe",
    label: "Last Frame Chain",
    hint: "each clip starts from the previous clip's final frame",
    refHint: "clips after the first start from the previous clip's final frame (rendered by FL2VA, so the reference images shape the first clip only — the common prompt carries the rest)",
  },
] as const;

const isSet = (v: string | undefined) => !!v && v !== "none";

export function modelAvailability(state: MinimaxState) {
  return {
    fl: isSet(state.unetFirstLast),
    ref: isSet(state.unetReference),
    clip: isSet(state.clipName),
    vaeVideo: isSet(state.vaeVideo),
    vaeAudio: isSet(state.vaeAudio),
  };
}

export function configIssues(state: MinimaxState) {
  const a = modelAvailability(state);
  const missing: string[] = [];
  if (!a.fl && !a.ref) missing.push("a UNET (First/Last or Reference)");
  if (!a.clip) missing.push("the text encoder");
  if (!a.vaeVideo) missing.push("the video VAE");
  if (!a.vaeAudio) missing.push("the audio VAE");
  return missing;
}

export function generationModesFor(state: MinimaxState) {
  const a = modelAvailability(state);
  return GENERATION_MODES.map((m) => {
    const ok = m.key === "reference" ? a.ref : a.fl;
    return { ...m, enabled: ok, reason: ok ? "" : `Set the ${m.key === "reference" ? "Reference" : "First/Last"} UNET in ⚙ Settings → Models` };
  });
}

export function continuityModesFor(generationMode: string, state?: MinimaxState) {
  const isRef = (generationMode || "t2v") === "reference";
  const a = state ? modelAvailability(state) : { fl: true, ref: true };
  const need: Record<string, "fl" | "ref" | null> = { lastframe: "fl", reference: "ref", none: null, onetake: null };
  return CONTINUITY_MODES.map((m: any) => {
    if (m.refOnly && !isRef) {
      return { key: m.key, label: m.label, hint: m.hint, disabled: true, reason: "Only available in Reference mode" };
    }
    const k = need[m.key];
    const ok = !k || (a as any)[k];
    return {
      key: m.key,
      label: m.label,
      hint: isRef && m.refHint ? m.refHint : m.hint,
      disabled: !ok,
      reason: ok ? "" : `Needs the ${k === "ref" ? "Reference" : "First/Last"} UNET — set it in ⚙ Settings → Models`,
    };
  });
}

export function activePrompts(state: MinimaxState) {
  const list = state.prompts || [{ text: "", firstFrame: "", enabled: true }];
  return list.map((p, i) => ({ p, i })).filter(({ p }) => promptEnabled(p));
}

export const ONE_TAKE_OVERLAP_FRAMES = 39;

export function clipPlan(state: MinimaxState) {
  const frames = state.clipFrames ?? 192;
  const clipSec = framesToSeconds(frames);
  const total = Math.max(1, (state.prompts || [{ text: "" }]).length);
  const count = Math.max(0, activePrompts(state).length);
  const avg = state.avgMinutesPerClip ?? 13;
  const actualSeconds = count * clipSec;

  // One-Take + auto-stitch: the finished result isn't `count` clips end-to-end — each clip
  // after the first shares `overlap` seconds with the previous one, and the auto-stitch step
  // trims that overlap out. Same formula as the real stitch (view.ts's onetake-finish handler
  // and galleryOverlay.ts's manual Stitch), kept here too so the estimate shown before a run
  // matches what actually gets saved.
  const isOneTakeStitched = state.continuityMode === "onetake" && state.oneTakeAutoStitch !== false;
  const overlapSec = framesToSeconds(alignFrameCount(ONE_TAKE_OVERLAP_FRAMES));
  const stitchedSeconds = count > 1 ? actualSeconds - (count - 1) * overlapSec : actualSeconds;

  return { count, clipSec, actualSeconds, isOneTakeStitched, stitchedSeconds, estimateMinutes: count * avg, promptCount: total };
}

export function formatDuration(minutes: number) {
  if (!isFinite(minutes) || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60),
    m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export const promptText = (p: PromptEntry | string) => (typeof p === "string" ? p : p?.text || "");
export const promptEnabled = (p: PromptEntry | string) => (typeof p === "string" ? true : p?.enabled !== false);
export const promptFirstFrame = (p: PromptEntry | string) => (typeof p === "string" ? "" : p?.firstFrame || "");

export function parseTargetSeconds(text: string): number {
  const raw = String(text || "").trim().toLowerCase();
  if (!raw) return 0;
  const clock = raw.match(/^(\d+)\s*:\s*([0-5]?\d(?:\.\d+)?)$/);
  if (clock) return +clock[1] * 60 + +clock[2];
  const min = raw.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes|분)/);
  const sec = raw.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds|초)/);
  if (min || sec) return (min ? +min[1] * 60 : 0) + (sec ? +sec[1] : 0);
  const plain = raw.match(/^(\d+(?:\.\d+)?)$/);
  return plain ? +plain[1] : 0;
}

export function evenBreaks(count: number, groups: number): number[] {
  const n = Math.max(1, Math.min(groups || 1, count));
  const per = Math.ceil(count / n);
  const b: number[] = [];
  for (let i = per; i < count; i += per) b.push(i);
  return b;
}

export function groupShotsWithBreaks(shots: string[], groups: number, breaks?: number[]) {
  if (!shots.length) return [];
  if (breaks && breaks.length) {
    const cuts = [...new Set(breaks)].filter((i) => i > 0 && i < shots.length).sort((a, b) => a - b);
    const out: string[][] = [];
    let prev = 0;
    for (const c of cuts) {
      out.push(shots.slice(prev, c));
      prev = c;
    }
    out.push(shots.slice(prev));
    return out.map((g) => g.join("\n\n"));
  }
  return groupShots(shots, groups);
}

export const IMAGE_BRIEF_MODES = [
  { key: "fl", label: "First/Last (max 2)", max: 2, hint: "image 1 = the starting frame, image 2 = the ending frame — write the brief as a first/last-frame shot" },
  { key: "ref", label: "Reference (max 8)", max: 8, hint: "each image is a <Picture N> reference, in upload order" },
];
export function imageBriefMax(mode: string) {
  return (IMAGE_BRIEF_MODES.find((m) => m.key === mode) || IMAGE_BRIEF_MODES[1]).max;
}

export function composeClipPrompt(state: MinimaxState, i: number) {
  const list = state.prompts || [];
  let body = "";
  for (let k = Math.min(i, list.length - 1); k >= 0; k--) {
    const t = promptText(list[k]).trim();
    if (t) {
      body = t;
      break;
    }
  }
  return [state.promptHeader, body, state.promptFooter, loraTriggers(state), state.promptSuffix]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function loraTriggers(state: MinimaxState) {
  return (state.loras || [])
    .filter((l) => l && l.enabled !== false && l.name && l.name !== "none" && l.triggerWord)
    .map((l) => String(l.triggerWord).trim())
    .filter(Boolean)
    .join(", ");
}

export function parseBrief(text: string) {
  const SHOT_LINE_RE = /^[ \t]*\[(?:Shot|SHOT|샷)[ \t]*\d+\][^\n]*$/gm;
  const TAIL_RE = /^[ \t]*(?:Ambient sound|Ambience|Sound|Music|Soundtrack|배경음|음악|사운드)[ \t]*:/i;
  const raw = String(text || "").trim();
  if (!raw) return { header: "", shots: [] as string[], footer: "" };

  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = SHOT_LINE_RE.exec(raw)) !== null) starts.push(m.index);

  if (!starts.length) {
    const parts = raw
      .split(/^\s*-{3,}\s*$/m)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length > 1 ? { header: "", shots: parts, footer: "" } : { header: "", shots: [raw], footer: "" };
  }

  const header = raw.slice(0, starts[0]).trim();
  const blocks = starts.map((s, i) => raw.slice(s, i + 1 < starts.length ? starts[i + 1] : undefined).trim());

  let footer = "";
  const last = blocks[blocks.length - 1];
  const lines = last.split("\n");
  let cut = -1;
  for (let i = 1; i < lines.length; i++) {
    if (TAIL_RE.test(lines[i])) {
      cut = i;
      break;
    }
  }
  if (cut > 0) {
    blocks[blocks.length - 1] = lines.slice(0, cut).join("\n").trim();
    footer = lines.slice(cut).join("\n").trim();
  }
  return { header, shots: blocks.filter(Boolean), footer };
}

export function groupShots(shots: string[], groups: number) {
  if (!shots.length) return [];
  const n = Math.max(1, Math.min(groups || 1, shots.length));
  const per = Math.ceil(shots.length / n);
  const out: string[] = [];
  for (let i = 0; i < shots.length; i += per) out.push(shots.slice(i, i + per).join("\n\n"));
  return out;
}

export function loadState(): Partial<MinimaxState> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}
export function saveState(s: MinimaxState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
}

export function defaultState(saved: Partial<MinimaxState> = {}): MinimaxState {
  migratePipelineState(saved as any);
  return {
    unetFirstLast: saved.unetFirstLast || "",
    unetReference: saved.unetReference || "",
    clipName: saved.clipName || "",
    vaeVideo: saved.vaeVideo || "",
    vaeAudio: saved.vaeAudio || "",
    turboLora: saved.turboLora || "",
    turboLoraReference: saved.turboLoraReference || "",
    turboLoraStrength: saved.turboLoraStrength ?? 1.0,
    turboLoraLowVram: saved.turboLoraLowVram ?? false,
    upscaleModel: saved.upscaleModel || "",
    targetLength: saved.targetLength || "",
    audioLock: saved.audioLock ?? false,
    lockAudioFile: saved.lockAudioFile || "",
    audioLockMode: saved.audioLockMode || "lock",
    audioLockStrength: saved.audioLockStrength ?? 0.5,
    audioLockFit: saved.audioLockFit || "pad_silence",
    audioLockTrimStart: saved.audioLockTrimStart ?? 0,
    audioLockTrimEnd: saved.audioLockTrimEnd ?? 0,
    loras: Array.isArray(saved.loras)
      ? saved.loras.map((l) => ({ name: l.name || "none", strength: l.strength ?? 1.0, triggerWord: l.triggerWord || "", enabled: l.enabled !== false }))
      : [],
    generationMode: saved.generationMode || "t2v",
    accelMode: saved.accelMode || "solattn",
    upscaleMode: saved.upscaleMode || "none",
    continuityMode: saved.continuityMode || "onetake",
    oneTakeLockAudio: saved.oneTakeLockAudio ?? false,
    oneTakeAutoStitch: saved.oneTakeAutoStitch ?? true,
    oneTakeAudioOverride: !!saved.oneTakeAudioOverride,
    aspect: saved.aspect || "9:16 Portrait",
    megapixels: saved.megapixels ?? 1.0,
    clipFrames: saved.clipFrames ?? DEFAULT_FRAMES,
    clipLengthCustom: !!saved.clipLengthCustom,
    clipLengthCustomSec: saved.clipLengthCustomSec ?? framesToSeconds(saved.clipFrames ?? DEFAULT_FRAMES),
    totalSeconds: saved.totalSeconds ?? 8,
    trimLastClip: saved.trimLastClip ?? false,
    avgMinutesPerClip: saved.avgMinutesPerClip ?? 13,
    unloadBetweenClips: saved.unloadBetweenClips ?? true,
    prompts: (Array.isArray(saved.prompts) && saved.prompts.length ? saved.prompts : [{ text: "", firstFrame: "", enabled: true }]).map((p: any) =>
      typeof p === "string" ? { text: p, firstFrame: "", enabled: true } : { text: p?.text || "", firstFrame: p?.firstFrame || "", enabled: p?.enabled !== false }
    ),
    promptHeader: saved.promptHeader || "",
    promptFooter: saved.promptFooter || "",
    promptSuffix: saved.promptSuffix || "",
    firstFrameImage: saved.firstFrameImage || null,
    lastFrameImage: saved.lastFrameImage || null,
    firstFrameMp: saved.firstFrameMp ?? 1.0,
    lastFrameMp: saved.lastFrameMp ?? 1.0,
    refImages: Array.isArray(saved.refImages) ? saved.refImages.slice(0, 9) : [],
    refImagesMp: Array.isArray(saved.refImagesMp) ? saved.refImagesMp.slice(0, 9) : [],
    refImageSize: saved.refImageSize || "match",
    refVideos: Array.isArray(saved.refVideos) ? saved.refVideos.slice(0, 3).map((v) => ({ file: v.file || "", start: v.start ?? 0, end: v.end ?? 5, withAudio: v.withAudio !== false })) : [],
    refAudios: Array.isArray(saved.refAudios) ? saved.refAudios.slice(0, 3).map((a) => ({ file: a.file || "", start: a.start ?? 0, end: a.end ?? 5 })) : [],
    refTypes: { images: saved.refTypes?.images !== false, videos: saved.refTypes?.videos ?? false, audios: saved.refTypes?.audios ?? false },
    steps: saved.steps ?? 20,
    turboSteps: saved.turboSteps ?? 4,
    slaTurboSteps: saved.slaTurboSteps ?? 6,
    sampler: saved.sampler || "res_multistep",
    scheduler: saved.scheduler || "simple",
    denoise: saved.denoise ?? 1.0,
    seed: saved.seed ?? 0,
    seedMode: saved.seedMode || "randomize",
    seedPerClip: saved.seedPerClip ?? true,
    useCache: saved.useCache ?? true,
    useFirstBlockCache: saved.useFirstBlockCache ?? false,
    saveSubfolder: saved.saveSubfolder || "",
    filenamePrefix: saved.filenamePrefix || "MMH3",
    stitchAtEnd: saved.stitchAtEnd ?? true,
    ollamaUrl: saved.ollamaUrl || "http://127.0.0.1:11434",
    ollamaModel: saved.ollamaModel || "",
    ollamaVisionModel: saved.ollamaVisionModel || "",
    ollamaTemperature: saved.ollamaTemperature ?? 0.7,
    ollamaTopP: saved.ollamaTopP ?? 0.9,
    ollamaImageMode: saved.ollamaImageMode || "ref",
    ollamaImages: Array.isArray(saved.ollamaImages) ? saved.ollamaImages.slice() : [],
    visionSource: saved.visionSource || "ollama",
    nativeVisionClip: saved.nativeVisionClip || "Qwen3\\qwen_3vl_8b_nvfp4.safetensors",
    nativeBriefClip: saved.nativeBriefClip || "LTX\\gemma4_e2b_it_bf16.safetensors",
    turboLoraStrength: saved.turboLoraStrength ?? 1.0,
    turboLoraLowVram: saved.turboLoraLowVram ?? false,
    solTau: saved.solTau ?? 1.3,
    solMinTokens: saved.solMinTokens ?? 4096,
    solStart: saved.solStart ?? 0.2,
    solEnd: saved.solEnd ?? 0.9,
    specBlendWeight: saved.specBlendWeight ?? 0.5,
    specDegree: saved.specDegree ?? 1,
    specRidgeLambda: saved.specRidgeLambda ?? 0.1,
    specWindowSize: saved.specWindowSize ?? 2.0,
    specFlexWindow: saved.specFlexWindow ?? 0.75,
    specWarmupSteps: saved.specWarmupSteps ?? 1,
    specTailSteps: saved.specTailSteps ?? 1,
    specMaxHistory: saved.specMaxHistory ?? 8,
    specHistoryStore: saved.specHistoryStore || "system_ram",
    rtxScale: saved.rtxScale ?? 2.0,
    rtxQuality: saved.rtxQuality || "ULTRA",
    shiftVideo: saved.shiftVideo ?? 12,
    shiftAudio: saved.shiftAudio ?? 3,
    useSageAttn: saved.useSageAttn ?? true,
    sageAttnMode: saved.sageAttnMode || "auto",
    useMemEffSage: saved.useMemEffSage ?? true,
    useCkAttention: saved.useCkAttention ?? false,
    ckAttentionBackend: saved.ckAttentionBackend || "comfy_kitchen",
    useTorchPatch: saved.useTorchPatch ?? true,
    fp16Accum: saved.fp16Accum ?? true,
    useSlaAttention: saved.useSlaAttention ?? false,
    slaSparsity: saved.slaSparsity ?? 0.9,
    slaBlockSize: saved.slaBlockSize || "64",
    slaMinSeqLen: saved.slaMinSeqLen ?? 8192,
    slaDenseLastSteps: saved.slaDenseLastSteps ?? 0,
    slaProtectAudio: saved.slaProtectAudio !== false,
    slaRunEnabled: saved.slaRunEnabled !== false,
    fbcMode: saved.fbcMode || "H3 Fast — 0.10 / max 2",
    fbcThreshold: saved.fbcThreshold ?? 0.1,
    fbcStartPercent: saved.fbcStartPercent ?? 0.1,
    fbcEndPercent: saved.fbcEndPercent ?? 0.95,
    fbcMaxConsecutiveHits: saved.fbcMaxConsecutiveHits ?? 2,
    fbcTemporalGuard: saved.fbcTemporalGuard ?? false,
    cacheThreshold: saved.cacheThreshold ?? 0.3,
    cacheMaxSteps: saved.cacheMaxSteps ?? 2,
    cacheStart: saved.cacheStart ?? 0.15,
    cacheEnd: saved.cacheEnd ?? 0.9,
    previewEnabled: saved.previewEnabled ?? true,
    previewFrames: saved.previewFrames ?? 8,
    previewFps: saved.previewFps ?? 12,
    previewMaxRes: saved.previewMaxRes ?? 512,
    previewQuality: saved.previewQuality ?? 85,
    previewTinyVae: saved.previewTinyVae || "none",
    turboMode: saved.turboMode || "none",
    attnBackend: saved.attnBackend || "none",
    attnForward: saved.attnForward || "none",
    blockCache: saved.blockCache || "none",
    useSpectrum: !!saved.useSpectrum,
    useFusedModulation: saved.useFusedModulation ?? false,
    pipelineMigrated: !!saved.pipelineMigrated,
    solSchedTauStart: saved.solSchedTauStart ?? 1.3,
    solSchedTauEnd: saved.solSchedTauEnd ?? 0.8,
    solSchedCurve: saved.solSchedCurve || "linear",
    solSchedMinTokens: saved.solSchedMinTokens ?? 4096,
    solSchedStrict: saved.solSchedStrict ?? false,
    solSchedDensePercent: saved.solSchedDensePercent ?? 0.0,
    solSchedThreshType: saved.solSchedThreshType || "diag",
    solSchedInt8Qk: saved.solSchedInt8Qk ?? false,
    solSchedInt8Pv: saved.solSchedInt8Pv ?? false,
    solSchedSinkConditioning: saved.solSchedSinkConditioning || "exact_kv_and_rows",
    solSchedDenseBlocks: saved.solSchedDenseBlocks || "",
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e15);
}
