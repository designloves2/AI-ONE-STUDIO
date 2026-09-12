// graphBuilder.ts — MiniMax H3 워크플로 그래프 빌더 (원본: web/minimax/graph_builder_minimax.js)
// state를 ComfyUI API 그래프(JSON)로 조립한다. 순수 로직이라 거의 그대로 이식.
import type { MinimaxState, LoraEntry, PipelinePreset, UserPipelinePreset } from "./core";
import { SUBFOLDER, FPS, resolveResolution, framesToSeconds, ONE_TAKE_OVERLAP_FRAMES, attnForwardBlockedReason, blockCacheBlockedReason, h3OptimizerBlockedReason, PDD_NFE_CHOICES, pddFileForMode, PIPELINE_PRESETS, applyPreset } from "./core";

export { ONE_TAKE_OVERLAP_FRAMES };

const N = {
  unet: "MM:unet",
  clip: "MM:clip",
  vaeV: "MM:vae_video",
  vaeA: "MM:vae_audio",
  sage: "MM:sage",
  memSage: "MM:mem_sage",
  solSched: "MM:sol_sched",
  fusedMod: "MM:fused_mod",
  ckAttn: "MM:ck_attn",
  torch: "MM:torch",
  shift: "MM:sigma_shift",
  fbcache: "MM:fbcache",
  h3mem: "MM:h3_mem",
  h3sparse: "MM:h3_sparse",
  sla: "MM:sla_attn",
  sol: "MM:solattn",
  spectrum: "MM:spectrum",
  turbo: "MM:turbo_lora",
  pdd: "MM:pdd_acc",
  preview: "MM:preview",
  cond: "MM:cond",
  freeClipVram: "MM:free_clip_vram",
  noise: "MM:noise",
  sampSel: "MM:sampler_sel",
  sched: "MM:scheduler",
  guider: "MM:guider",
  sampler: "MM:sampler",
  decode: "MM:decode",
  decodeA: "MM:decode_audio",
  upModel: "MM:upscale_model",
  upApply: "MM:upscale",
  rtx: "MM:rtx",
  deblurR: "MM:deblur",
  video: "MM:video",
  save: "MM:save_video",
  videoRaw: "MM:video_raw",
  saveRaw: "MM:save_video_raw",
  lastF: "MM:last_frame",
  saveLF: "MM:save_last_frame",
  tailF: "MM:tail_frames",
  tailPrev: "MM:tail_preview",
  loadFirst: "MM:load_first",
  loadLast: "MM:load_last",
  loadFirstResize: "MM:load_first_resize",
  loadLastResize: "MM:load_last_resize",
  ref: (i: number) => `MM:ref_${i}`,
  refResize: (i: number) => `MM:ref_resize_${i}`,
  refVid: (i: number) => `MM:refvid_${i}`,
  refAud: (i: number) => `MM:refaud_${i}`,
  refAudTrim: (i: number) => `MM:refaud_trim_${i}`,
  audioLock: "MM:audio_lock",
  lockAud: "MM:lock_audio",
  lockAudTrim: "MM:lock_audio_trim",
  chkLoad: "MM:h3_chk_load",
  continuation: "MM:h3_continuation",
  chkSave: "MM:h3_chk_save",
};
export const NODE_IDS = N;

export const TAIL_CANDIDATES = 8;

type Graph = Record<string, any>;
type Avail = Record<string, boolean>;
const has = (avail: Avail | undefined, name: string) => !!(avail && avail[name]);

export function previewNodeKey(nodeId: string | number) {
  return `MMH3_preview_${nodeId}`;
}

/** Resolves turboMode "larryvrh"/"pdd" down to "none" if its file isn't actually set.
 * PDD is core-native since ComfyUI v0.35.0 (#15908) — the ComfyUI-converted Acc file loads
 * as a plain model-only LoRA (no apply node, no dedicated pack), so only a missing file
 * forces the fallback now, same shape as larryvrh's below. */
export function turboEffective(state: MinimaxState, avail?: Avail): string {
  if (state.turboMode === "larryvrh") {
    if (!turboLoraForMode(state)) return "none";
    if (avail && Object.keys(avail).length && !avail.MiniMaxH3TurboLoRA) return "none";
    return "larryvrh";
  }
  if (state.turboMode === "pdd") {
    if (!pddFileForMode(state)) return "none";
    return "pdd";
  }
  return state.turboMode || "none";
}

export function turboLoraForMode(state: MinimaxState): string {
  const name = state.turboLora;
  return name && name !== "none" ? name : "";
}

/** The step count a run will actually sample at — goes through turboEffective() first, so a
 * turbo that's selected but can't run (no LoRA/file set, pack missing) correctly falls back to
 * the normal step count instead of reporting a turbo number the run won't use. */
export function effectiveSteps(state: MinimaxState, avail?: Avail): number {
  const eff = turboEffective(state, avail);
  if (eff === "larryvrh") return state.turboSteps ?? 4;
  if (eff === "lightx2v") return state.slaTurboSteps ?? 6;
  // PDD's step count is not a preference — it's how the 32-interval grid was partitioned during
  // training, and the apply node emits exactly this many sigmas. Anything else is off the
  // trained envelope and renders as noise, so it's a fixed list, not a free number.
  if (eff === "pdd") return PDD_NFE_CHOICES.includes(String(state.pddNfe)) ? Number(state.pddNfe) : 8;
  return state.steps ?? 20;
}

function buildAudioLock(g: Graph, state: MinimaxState, avail: Avail | undefined, clipIndex: number, frames: number): boolean {
  if (!state.audioLock) return false;
  if (!has(avail, "TJ_H3_AudioLock")) throw new Error("Audio lock needs the TJ_H3_AudioLock node — install the TJ_NODE pack, or switch the lock off.");
  if (!state.lockAudioFile) throw new Error("Audio lock is on but no audio file is selected — pick one under Lock audio in the left panel.");

  const clipSeconds = framesToSeconds(frames);
  const trimStart = Math.max(0, state.audioLockTrimStart || 0);
  const startSec = trimStart + clipIndex * clipSeconds;

  g[N.lockAud] = { class_type: "LoadAudio", inputs: { audio: state.lockAudioFile } };
  let audioLink: any = [N.lockAud, 0];

  if (has(avail, "TrimAudioDuration")) {
    g[N.lockAudTrim] = { class_type: "TrimAudioDuration", inputs: { audio: audioLink, start_index: startSec, duration: clipSeconds } };
    audioLink = [N.lockAudTrim, 0];
  }

  g[N.audioLock] = {
    class_type: "TJ_H3_AudioLock",
    inputs: {
      av_latent: [N.cond, 1],
      audio: audioLink,
      audio_vae: [N.vaeA, 0],
      mode: state.audioLockMode || "lock",
      strength: state.audioLockStrength ?? 0.5,
      fit: state.audioLockFit || "pad_silence",
      get_name_av_latent: "(none)",
      get_name_audio: "(none)",
      get_name_audio_vae: "(none)",
      auto_set: false,
    },
  };
  return true;
}

function buildOneTake(g: Graph, state: MinimaxState, avail: Avail | undefined, clipIndex: number, prevCheckpointName: string | null, defaultLatent: any) {
  if (state.continuityMode !== "onetake") return defaultLatent;
  if (!has(avail, "TJ_H3_LatentContinuation")) throw new Error("One-Take needs the TJ_H3_LatentContinuation node — install/update the TJ_NODE pack, or switch Continuity to something else.");
  if (clipIndex === 0 || !prevCheckpointName) return defaultLatent;
  if (!has(avail, "TJ_H3_LoadLatentCheckpoint")) throw new Error("One-Take needs the TJ_H3_LoadLatentCheckpoint node — install/update the TJ_NODE pack.");

  // TJ_NODE가 strict 입력을 새로 필수로 추가했다(기본 true — 없으면 검증 실패: "Required input
  // is missing: strict"). 이 경로는 clipIndex>=1일 때만 타서 이전 클립의 체크포인트가 반드시
  // 있어야 하므로, 없으면 에러가 나는 게 맞는 기존 동작과 정확히 같은 strict:true로 명시한다.
  g[N.chkLoad] = { class_type: "TJ_H3_LoadLatentCheckpoint", inputs: { checkpoint_name: prevCheckpointName, strict: true } };
  g[N.continuation] = {
    class_type: "TJ_H3_LatentContinuation",
    inputs: { overlap_frames: ONE_TAKE_OVERLAP_FRAMES, lock_audio: !!state.oneTakeLockAudio, prev_latent: [N.chkLoad, 0], target_latent: defaultLatent },
  };
  return [N.continuation, 0];
}

function saveOneTakeCheckpoint(g: Graph, state: MinimaxState, avail: Avail | undefined, checkpointName: string | null) {
  if (state.continuityMode !== "onetake" || !checkpointName) return;
  if (!has(avail, "TJ_H3_SaveLatentCheckpoint")) return;
  g[N.chkSave] = { class_type: "TJ_H3_SaveLatentCheckpoint", inputs: { latent: [N.sampler, 0], checkpoint_name: checkpointName } };
}

function requireModels(state: MinimaxState): string {
  const mode = state.generationMode || "t2v";
  const unet = mode === "reference" ? state.unetReference : state.unetFirstLast;
  if (!unet || unet === "none") throw new Error(`No ${mode === "reference" ? "Reference" : "First/Last"} UNET selected — open ⚙ Settings → Models.`);
  if (!state.clipName || state.clipName === "none") throw new Error("No text encoder selected — open ⚙ Settings → Models.");
  if (!state.vaeVideo || state.vaeVideo === "none") throw new Error("No video VAE selected — open ⚙ Settings → Models.");
  if (!state.vaeAudio || state.vaeAudio === "none") throw new Error("No audio VAE selected — open ⚙ Settings → Models.");
  return unet;
}

function unetNode(name: string) {
  if ((name || "").toLowerCase().endsWith(".gguf")) return { class_type: "UnetLoaderGGUF", inputs: { unet_name: name } };
  return { class_type: "UNETLoader", inputs: { unet_name: name, weight_dtype: "default" } };
}

function buildModelChain(g: Graph, state: MinimaxState, avail: Avail | undefined) {
  const unet = requireModels(state);
  g[N.unet] = unetNode(unet);
  let m: any = [N.unet, 0];

  // ── Attention backend (L6/L7) — single-select axis, so these never stack by construction
  // (unlike the old independent booleans, which let SLA silently overwrite Sage/SolAttn since
  // none of them checked for an existing optimized_attention_override — bug ① in
  // SPEC_MINIMAX_H3_PIPELINE_AXES.md). "sla" is applied later in applySla(), after preview,
  // per H3SLAAttention's own placement requirement.
  if (state.attnBackend === "ck" && has(avail, "ModelAttentionBackend")) {
    g[N.ckAttn] = { class_type: "ModelAttentionBackend", inputs: { model: m, attention: state.ckAttentionBackend === "pytorch" ? "pytorch attention" : "comfy kitchen attention" } };
    m = [N.ckAttn, 0];
  } else if (state.attnBackend === "sage" && has(avail, "PathchSageAttentionKJ")) {
    g[N.sage] = { class_type: "PathchSageAttentionKJ", inputs: { model: m, sage_attention: state.sageAttnMode || "auto" } };
    m = [N.sage, 0];
  } else if (state.attnBackend === "solattn_kijai" && has(avail, "SolAttnPatch")) {
    g[N.sol] = {
      class_type: "SolAttnPatch",
      inputs: { model: m, tau: state.solTau ?? 1.3, start_percent: state.solStart ?? 0.2, end_percent: state.solEnd ?? 0.9, min_tokens: state.solMinTokens ?? 4096, int8_qk: true, sink_conditioning: "exact_kv_and_rows", morton: false, morton_curve: "2d_frame", int8_pv: true, verbose: false, use_tma: false, dense_blocks: "" },
    };
    m = [N.sol, 0];
  }

  // ── Attention forward patch (L5) — blocked whenever attnBackend replaces attn.forward
  // itself (ck/solattn_kijai/sla), since the override those backends rely on is only ever
  // consulted by the *stock* forward — replacing it makes the selected backend never run
  // (bug ② in the spec). Only meaningful stacked with "sage" or "none".
  if (!attnForwardBlockedReason(state, state.attnForward)) {
    if (state.attnForward === "memeff_sage" && has(avail, "MiniMaxH3MemoryEfficientSageAttentionPatch")) {
      g[N.memSage] = { class_type: "MiniMaxH3MemoryEfficientSageAttentionPatch", inputs: { model: m } };
      m = [N.memSage, 0];
    } else if (state.attnForward === "solattn_saganaki" && has(avail, "MiniMaxH3ScheduledSolAttentionPatch")) {
      g[N.solSched] = {
        class_type: "MiniMaxH3ScheduledSolAttentionPatch",
        inputs: {
          model: m, enabled: true,
          tau_start: state.solSchedTauStart ?? 1.3, tau_end: state.solSchedTauEnd ?? 0.8,
          curve: state.solSchedCurve || "linear", min_tokens: state.solSchedMinTokens ?? 4096,
          strict: !!state.solSchedStrict, dense_percent: state.solSchedDensePercent ?? 0.0,
          thresh_type: state.solSchedThreshType || "diag", int8_qk: !!state.solSchedInt8Qk, int8_pv: !!state.solSchedInt8Pv,
          sink_conditioning: state.solSchedSinkConditioning || "exact_kv_and_rows", dense_blocks: state.solSchedDenseBlocks || "",
        },
      };
      m = [N.solSched, 0]; // output 1 is the tau_graph IMAGE — left unconnected, matching the spec's "if unused, leave it"
    }
  }

  if (state.useTorchPatch && has(avail, "ModelPatchTorchSettings")) {
    g[N.torch] = { class_type: "ModelPatchTorchSettings", inputs: { model: m, enable_fp16_accumulation: state.fp16Accum !== false } };
    m = [N.torch, 0];
  }

  // ── Fused Modulation (L4) — independent checkbox, safe with every other axis (it calls
  // adaln_proj as a module, so Turbo's LoRA injection there survives).
  if (state.useFusedModulation && has(avail, "MiniMaxH3FusedModulation")) {
    g[N.fusedMod] = { class_type: "MiniMaxH3FusedModulation", inputs: { model: m, enabled: true } };
    m = [N.fusedMod, 0];
  }

  // PDD's head bank is trained against a 12/3 shift and its wrapper hard-errors on anything
  // else — mid-render, not at graph-build time — so pin it here rather than let a changed
  // slider turn into a failed run partway through.
  const pddShiftForced = turboEffective(state, avail) === "pdd";
  g[N.shift] = {
    class_type: "MiniMaxH3SigmaShift",
    inputs: { model: m, shift_video: pddShiftForced ? 12 : state.shiftVideo ?? 12, shift_audio: pddShiftForced ? 3 : state.shiftAudio ?? 3 },
  };
  m = [N.shift, 0];

  (state.loras || []).forEach((lora: LoraEntry, i: number) => {
    if (!lora?.name || lora.name === "none" || lora.enabled === false) return;
    const strength = parseFloat(String(lora.strength ?? 1.0));
    if (!(strength > 0)) return;
    const id = `MM:lora${i}`;
    g[id] = { class_type: "LoraLoaderModelOnly", inputs: { model: m, lora_name: lora.name, strength_model: strength } };
    m = [id, 0];
  });

  // ── Block cache (L3) — blocked entirely under either Turbo mode (the same approximation
  // stacked on an already-distilled/4-step model isn't validated). "h3cache" (MiniMaxH3Cache)
  // was retired 2026-09-11 — it global-patched a pre-#15908 forward and broke every H3 render
  // on ComfyUI core 0.35+; FirstBlockCache is the only survivor.
  if (!blockCacheBlockedReason(state, state.blockCache)) {
    if (state.blockCache === "fbcache" && has(avail, "ApplyMiniMaxH3FirstBlockCache")) {
      g[N.fbcache] = {
        class_type: "ApplyMiniMaxH3FirstBlockCache",
        inputs: {
          model: m, mode: state.fbcMode || "H3 Fast — 0.10 / max 2",
          threshold: state.fbcThreshold ?? 0.1, start_percent: state.fbcStartPercent ?? 0.1,
          end_percent: state.fbcEndPercent ?? 0.95, max_consecutive_hits: state.fbcMaxConsecutiveHits ?? 2,
          temporal_guard: !!state.fbcTemporalGuard,
        },
      };
      m = [N.fbcache, 0];
    }
  }

  // ── H3-Optimizations (Zironic): VRAM + optional sparse, backend-preserving ─
  // Unlike the KJ forward patch, H3 Memory Optimization does NOT replace the blocks'
  // attention — it wraps the selected dense backend (sage / comfy kitchen / stock) with
  // chunked QKV/MLP/FinalLayer and early embedding release, so it's how you get a
  // memory-efficient CK. Its nodes are order-independent and reconcile at prepare-sampling,
  // so placement here (after the caches, inside Spectrum's wrapper) is safe. The Sparse
  // stage is gated exactly like the sparse backends.
  const h3opt = state.h3Optimizer || "none";
  if ((h3opt === "memory" || h3opt === "memory_sparse") && has(avail, "H3MemoryOptimization")) {
    g[N.h3mem] = {
      class_type: "H3MemoryOptimization",
      inputs: {
        model: m,
        // Legacy serialized slots — ignored by execution but kept as required inputs.
        fused_qkv: "auto",
        preserve_precision: true,
        embedding_memory_mode: "Auto",
        // Authoritative controls.
        mlp_memory: "auto",
        chunk_rows: Math.round(state.h3MemChunkRows ?? 4096),
        precision_mode: state.h3MemPrecision || "Auto",
        qkv_streaming_mode: state.h3MemQkvStreaming || "Auto",
        kitchen_v_memory_mode: state.h3MemLowVram ? "Lower VRAM (slower)" : "Standard",
      },
    };
    m = [N.h3mem, 0];
  }
  if (h3opt === "memory_sparse" && !h3OptimizerBlockedReason(state, "memory_sparse") && has(avail, "H3SparseAttention")) {
    g[N.h3sparse] = {
      class_type: "H3SparseAttention",
      inputs: {
        model: m,
        video_budget: state.h3SparseBudget ?? 0.15,
        denser_early_late_steps: state.h3SparseDenserEdges !== false,
        layer_video_budgets: state.h3SparseLayerBudgets || "",
      },
    };
    m = [N.h3sparse, 0];
  }

  // ── Turbo (L8, weights) — larryvrh's own LoRA node, or PDD's plain model-only LoRA.
  // lightx2v is a regular LoRA, already applied above via the loras[] loop, gated to SLA
  // attention entirely through the UI/attnBackend axis.
  const turboWeights = turboEffective(state, avail);
  if (turboWeights === "larryvrh" && has(avail, "MiniMaxH3TurboLoRA")) {
    g[N.turbo] = { class_type: "MiniMaxH3TurboLoRA", inputs: { model: m, lora_name: turboLoraForMode(state), strength: state.turboLoraStrength ?? 1.0, low_vram: !!state.turboLoraLowVram } };
    m = [N.turbo, 0];
  } else if (turboWeights === "pdd") {
    // Core-native since ComfyUI v0.35.0 (#15908 "Support PDD LoRA"). The ComfyUI-converted
    // Acc checkpoint (not the raw alibaba-pai file — its DiffSynth key names map to nothing
    // and it silently applies 0 patches) is an ordinary model-only LoRA that expands
    // video_out / audio_out into an N-interval head bank; core's FinalLayer.forward detects
    // the bank from the weight shape and picks the head(s) spanning each step's sigma range
    // off the sampler's own schedule. So there's no apply node, no emitted sigmas, no
    // on-grid contract — a plain BasicScheduler at the distilled step count feeds it (see
    // the sigmas wiring in buildClipGraph below). Needs core >= v0.35.0.
    g[N.pdd] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: m,
        lora_name: pddFileForMode(state),
        strength_model: state.pddLoraStrength ?? 1.0,
      },
    };
    m = [N.pdd, 0];
  }

  // ── Spectrum (L1) — independent of attnBackend/blockCache; complementary with block
  // caches (different axis — Spectrum skips whole steps, caches skip blocks within a step).
  if (state.useSpectrum && has(avail, "SpectrumApplyMiniMaxH3")) {
    g[N.spectrum] = {
      class_type: "SpectrumApplyMiniMaxH3",
      inputs: {
        model: m, enabled: true,
        blend_weight: state.specBlendWeight ?? 0.5, degree: Math.round(state.specDegree ?? 1), ridge_lambda: state.specRidgeLambda ?? 0.1,
        window_size: state.specWindowSize ?? 2.0, flex_window: state.specFlexWindow ?? 0.75, warmup_steps: Math.round(state.specWarmupSteps ?? 1),
        tail_actual_steps: Math.round(state.specTailSteps ?? 1), max_history: Math.round(state.specMaxHistory ?? 8), debug: false,
        history_storage: state.specHistoryStore || "system_ram", bootstrap_first_forecast: true,
      },
    };
    m = [N.spectrum, 0];
  }

  return m;
}

function applyPreview(g: Graph, state: MinimaxState, avail: Avail | undefined, modelLink: any, nodeId: string | number | null) {
  if (!state.previewEnabled || !has(avail, "ModelPreviewOverrideKJ") || nodeId == null) return modelLink;
  const key = previewNodeKey(nodeId);
  const inputs: Record<string, any> = {
    model: modelLink,
    max_resolution: state.previewMaxRes ?? 512,
    jpeg_quality: state.previewQuality ?? 85,
    suppress_default_preview: true,
    preview_frames: Math.max(1, state.previewFrames ?? 8),
    preview_fps: state.previewFps ?? 12,
  };
  // "none"(기본)이면 필드를 아예 안 보내 노드가 Latent2RGB(진짜 VAE 없이 근사)로 폴백하게 둔다 —
  // 원본 노드(graph_builder_minimax.js)와 동일한 조건. models/vae_approx의 Tiny VAE를 지정하면
  // 그걸로 실제 디코드해서 더 정확한(대신 스텝마다 조금 더 느린) 프리뷰를 낸다.
  if (state.previewTinyVae && state.previewTinyVae !== "none") inputs.tiny_vae = state.previewTinyVae;
  g[key] = { class_type: "ModelPreviewOverrideKJ", inputs, _meta: { title: `MMH3 preview #${nodeId}` } };
  return [key, 0];
}

// H3 SLA Attention wants to be last before the sampler (its own README: "place it after your
// LoRA loader, last before the sampler"), so it goes after preview, not inside buildModelChain.
// Enabling it lives in Settings; the node's own `enabled` bypass is the left-panel per-run
// checkbox, so the node stays in the graph either way once turned on in Settings — flipping
// the left-panel box just toggles sparse vs dense passthrough.
function applySla(g: Graph, state: MinimaxState, avail: Avail | undefined, modelLink: any) {
  if (state.attnBackend !== "sla" || !has(avail, "H3SLAAttention")) return modelLink;
  g[N.sla] = {
    class_type: "H3SLAAttention",
    inputs: {
      model: modelLink,
      sparsity_ratio: state.slaSparsity ?? 0.9,
      block_size: state.slaBlockSize || "64",
      min_seq_len: state.slaMinSeqLen ?? 8192,
      dense_last_steps: state.slaDenseLastSteps ?? 0,
      protect_audio: state.slaProtectAudio !== false,
      enabled: state.slaRunEnabled !== false,
    },
  };
  return [N.sla, 0];
}

// Per-card megapixel override for a keyframe/reference image — 0 (or unset) means "send as
// uploaded, no resize". ImageScaleToTotalPixels is a ComfyUI core node, so no availability gate.
function resizeToMp(g: Graph, key: string, imageLink: any, mp: number | undefined) {
  if (!((mp ?? 0) > 0)) return imageLink;
  g[key] = { class_type: "ImageScaleToTotalPixels", inputs: { image: imageLink, upscale_method: "lanczos", megapixels: mp, resolution_steps: 1 } };
  return [key, 0];
}

function buildConditioning(g: Graph, state: MinimaxState, promptText: string, width: number, height: number, frames: number, opts: { firstFrame?: string | null; lastFrame?: string | null; refImages?: string[] }, avail?: Avail) {
  const mode = state.generationMode || "t2v";
  const { firstFrame, lastFrame, refImages } = opts || {};

  if (mode === "reference") {
    const inputs: Record<string, any> = { clip: [N.clip, 0], vae: [N.vaeV, 0], audio_vae: [N.vaeA, 0], prompt: promptText, width, height, length: frames, ref_image_size: state.refImageSize || "match" };
    (refImages || []).slice(0, 9).forEach((name, i) => {
      if (!name) return;
      g[N.ref(i)] = { class_type: "LoadImage", inputs: { image: name } };
      inputs[`ref_images.ref_image_${i}`] = resizeToMp(g, N.refResize(i), [N.ref(i), 0], (state.refImagesMp || [])[i]);
    });

    // Reference videos. VHS_LoadVideo does the whole job in one node: force_rate pins the
    // 24fps the model expects, skip/cap are the in/out points in frames. Its AUDIO output
    // is the same clip's soundtrack, paired by index when the "use soundtrack" box is on.
    if (has(avail, "VHS_LoadVideo")) {
      (state.refVideos || []).slice(0, 3).forEach((v, i) => {
        if (!v || !v.file) return;
        const start = Math.max(0, Number(v.start) || 0);
        const end = Math.max(start, Number(v.end) || 0);
        const skip = Math.round(start * FPS);
        const cap = Math.max(0, Math.round((end - start) * FPS));
        g[N.refVid(i)] = { class_type: "VHS_LoadVideo", inputs: { video: v.file, force_rate: FPS, custom_width: 0, custom_height: 0, frame_load_cap: cap, skip_first_frames: skip, select_every_nth: 1 } };
        inputs[`ref_videos.ref_video_${i}`] = [N.refVid(i), 0];
        if (v.withAudio !== false) inputs[`ref_video_audios.ref_video_audio_${i}`] = [N.refVid(i), 2];
      });
    }

    // Standalone reference audio, trimmed to the requested window.
    (state.refAudios || []).slice(0, 3).forEach((a, i) => {
      if (!a || !a.file) return;
      g[N.refAud(i)] = { class_type: "LoadAudio", inputs: { audio: a.file } };
      let link: any = [N.refAud(i), 0];
      const start = Math.max(0, Number(a.start) || 0);
      const end = Math.max(start, Number(a.end) || 0);
      const dur = end - start;
      if ((start > 0 || dur > 0) && has(avail, "TrimAudioDuration")) {
        g[N.refAudTrim(i)] = { class_type: "TrimAudioDuration", inputs: { audio: link, start_index: start, duration: dur > 0 ? dur : 60.0 } };
        link = [N.refAudTrim(i), 0];
      }
      inputs[`ref_audios.ref_audio_${i}`] = link;
    });

    g[N.cond] = { class_type: "MiniMaxH3ReferenceToVideo", inputs };
    return;
  }

  const inputs: Record<string, any> = { clip: [N.clip, 0], vae: [N.vaeV, 0], prompt: promptText, width, height, length: frames };
  if (mode === "firstlast") {
    if (firstFrame) {
      g[N.loadFirst] = { class_type: "LoadImage", inputs: { image: firstFrame } };
      inputs.first_frame = resizeToMp(g, N.loadFirstResize, [N.loadFirst, 0], state.firstFrameMp);
    }
    if (lastFrame) {
      g[N.loadLast] = { class_type: "LoadImage", inputs: { image: lastFrame } };
      inputs.last_frame = resizeToMp(g, N.loadLastResize, [N.loadLast, 0], state.lastFrameMp);
    }
  }
  g[N.cond] = { class_type: "MiniMaxH3ImageToVideo", inputs };
}

export interface BuildClipOpts {
  nodeId: string | number;
  promptText: string;
  seed: number;
  firstFrame?: string | null;
  lastFrame?: string | null;
  refImages?: string[] | null;
  clipIndex?: number;
  saveLastFrame?: boolean;
  // The tail-frame PreviewImage batch only exists so pickChainFrame() can step back past a
  // fade-to-black when chaining Last Frame Chain — eight temp PNGs per clip, wasted in every
  // other continuity mode. Defaults true so other callers are unaffected; the relay loop passes
  // rs.continuityMode === "lastframe". See SPEC_MINIMAX_H3_TEMP_FILE_CLEANUP.md.
  saveTailPreviews?: boolean;
  prevCheckpointName?: string | null;
  checkpointName?: string | null;
}

export function buildClipGraph(state: MinimaxState, avail: Avail | undefined, opts: BuildClipOpts) {
  const { nodeId, promptText, seed, firstFrame = null, lastFrame = null, refImages = null, clipIndex = 0, saveLastFrame = true, saveTailPreviews = true, prevCheckpointName = null, checkpointName = null } = opts;

  const frames = state.clipFrames || 192;
  const { width, height } = resolveResolution(state.aspect, state.megapixels);
  const folder = (state.saveSubfolder || SUBFOLDER).replace(/\\/g, "/");
  const stem = state.filenamePrefix || "MMH3";

  const g: Graph = {};

  const modelLink0 = buildModelChain(g, state, avail);
  g[N.clip] = { class_type: "CLIPLoader", inputs: { clip_name: state.clipName, type: "minimax", device: "default" } };
  g[N.vaeV] = { class_type: "VAELoader", inputs: { vae_name: state.vaeVideo } };
  g[N.vaeA] = { class_type: "VAELoader", inputs: { vae_name: state.vaeAudio } };

  const modelLink = applySla(g, state, avail, applyPreview(g, state, avail, modelLink0, nodeId));

  const fullPrompt = String(promptText || "").trim();
  buildConditioning(g, state, fullPrompt, width, height, frames, { firstFrame, lastFrame, refImages: refImages ?? state.refImages }, avail);

  // 텍스트 인코더(N.clip)로 할 인코딩은 여기서 끝 — N.cond가 유일한 소비자라, 디퓨즈
  // 모델 샘플링 들어가기 전에 그 VRAM을 콕 집어 내린다(unload_all_models처럼 전부 내리는
  // 게 아니라 이 clip 하나만). 노드가 없는 서버(ComfyUI-TJ_NODE 미설치)에서는 조용히
  // 건너뛰고 conditioning을 그대로 통과시킨다.
  let condLink: any = [N.cond, 0];
  if (has(avail, "TJ_FreeTextEncoderVRAM")) {
    g[N.freeClipVram] = { class_type: "TJ_FreeTextEncoderVRAM", inputs: { clip: [N.clip, 0], trigger: condLink } };
    condLink = [N.freeClipVram, 0];
  }

  const turboEff = turboEffective(state, avail);
  const useTurboSampler = turboEff === "larryvrh" && has(avail, "MiniMaxH3TurboSampler");
  const steps = effectiveSteps(state, avail);

  g[N.noise] = { class_type: "RandomNoise", inputs: { noise_seed: seed ?? 0 } };
  let samplerUsed: string;
  if (useTurboSampler) {
    g[N.sampSel] = { class_type: "MiniMaxH3TurboSampler", inputs: {} };
    samplerUsed = "MiniMaxH3TurboSampler";
  } else if (turboEff === "pdd") {
    // PDD distils a mean velocity per interval, which is what one Euler step consumes — an
    // ancestral or multistep sampler would evaluate between the points the head bank was
    // trained for, so the sampler is fixed here even though the schedule is now a plain one.
    samplerUsed = "euler";
    g[N.sampSel] = { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } };
  } else {
    samplerUsed = state.sampler || "er_sde";
    g[N.sampSel] = { class_type: "KSamplerSelect", inputs: { sampler_name: samplerUsed } };
  }
  g[N.sched] = { class_type: "BasicScheduler", inputs: { model: modelLink, scheduler: state.scheduler || "simple", steps, denoise: state.denoise ?? 1.0 } };
  g[N.guider] = { class_type: "BasicGuider", inputs: { model: modelLink, conditioning: condLink } };

  const lockAudio = buildAudioLock(g, state, avail, clipIndex, frames);
  const preOneTakeLatent = lockAudio ? [N.audioLock, 0] : [N.cond, 1];
  const latentImage = buildOneTake(g, state, avail, clipIndex, prevCheckpointName, preOneTakeLatent);

  // Core-native PDD (v0.35.0+) reads the sampler's own schedule per step and maps it onto its
  // head bank, so BasicScheduler feeds it like any other run — no special sigma wiring.
  g[N.sampler] = { class_type: "SamplerCustomAdvanced", inputs: { noise: [N.noise, 0], guider: [N.guider, 0], sampler: [N.sampSel, 0], sigmas: [N.sched, 0], latent_image: latentImage } };
  saveOneTakeCheckpoint(g, state, avail, checkpointName);

  g[N.decode] = { class_type: "VAEDecode", inputs: { samples: [N.sampler, 0], vae: [N.vaeV, 0] } };
  g[N.decodeA] = { class_type: "VAEDecodeAudio", inputs: { samples: [N.sampler, 0], vae: [N.vaeA, 0] } };

  let images: any = [N.decode, 0];
  // The decoded frames as they are, before any deblur/upscale — kept so the run loop can also
  // save the un-processed clip when the panel asks for it.
  const preProcImages: any = [N.decode, 0];
  // What the frame pipeline actually did, for the clip's sidecar — resolveResolution() below
  // only knows the pre-decode size, so the gallery needs these to badge an inline-deblurred /
  // upscaled clip and to show its real dimensions. Set only inside the branch that wires the
  // node, never recomputed from raw state.
  let deblurUsed: string | null = null;
  let upscaleUsed: { method: "model"; model: string } | { method: "rtx"; scale: number; quality: string } | null = null;
  // Deblur runs on the decoded frames before any upscale, at their own resolution. It is
  // independent of the upscale setting: Upscale = None still deblurs.
  if (state.deblurStrength && state.deblurStrength !== "none" && has(avail, "TJ_RTXDeblur")) {
    g[N.deblurR] = { class_type: "TJ_RTXDeblur", inputs: { images, strength: state.deblurStrength } };
    images = [N.deblurR, 0];
    deblurUsed = state.deblurStrength;
  }
  const up = state.upscaleMode || "none";
  if (up === "model" && state.upscaleModel && state.upscaleModel !== "none") {
    g[N.upModel] = { class_type: "UpscaleModelLoader", inputs: { model_name: state.upscaleModel } };
    g[N.upApply] = { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: [N.upModel, 0], image: images } };
    images = [N.upApply, 0];
    upscaleUsed = { method: "model", model: state.upscaleModel };
  } else if (up === "rtx" && has(avail, "RTXVideoSuperResolution")) {
    g[N.rtx] = { class_type: "RTXVideoSuperResolution", inputs: { images, resize_type: "scale by multiplier", "resize_type.scale": state.rtxScale ?? 2.0, quality: state.rtxQuality || "ULTRA" } };
    images = [N.rtx, 0];
    upscaleUsed = { method: "rtx", scale: state.rtxScale ?? 2.0, quality: state.rtxQuality || "ULTRA" };
  }

  const clipTag = String(clipIndex + 1).padStart(3, "0");
  g[N.video] = { class_type: "CreateVideo", inputs: { images, fps: FPS, audio: lockAudio ? [N.audioLock, 1] : [N.decodeA, 0] } };
  g[N.save] = { class_type: "SaveVideo", inputs: { video: [N.video, 0], filename_prefix: `${folder}/${stem}_clip${clipTag}`, format: "auto", codec: "auto" } };

  // SPEC_MINIMAX_H3_INLINE_POSTPROCESS_META.md §6 — "Also save the clip before deblur /
  // upscale": a second file straight off the decode, before deblur/upscale touched it. Only
  // worth writing when something actually ran; the run loop saves its sidecar and drops it
  // into the gallery, but it never joins the stitch or the last-frame chain — the processed
  // clip stays the real one.
  const saveRawToo = !!state.saveUnprocessed && !!(deblurUsed || upscaleUsed);
  if (saveRawToo) {
    g[N.videoRaw] = { class_type: "CreateVideo", inputs: { images: preProcImages, fps: FPS, audio: lockAudio ? [N.audioLock, 1] : [N.decodeA, 0] } };
    g[N.saveRaw] = { class_type: "SaveVideo", inputs: { video: [N.videoRaw, 0], filename_prefix: `${folder}/${stem}_clip${clipTag}_raw`, format: "auto", codec: "auto" } };
  }

  if (saveLastFrame) {
    g[N.lastF] = { class_type: "ImageFromBatch", inputs: { image: images, batch_index: Math.max(0, frames - 1), length: 1 } };
    g[N.saveLF] = { class_type: "SaveImage", inputs: { images: [N.lastF, 0], filename_prefix: `${folder}/frames/${stem}_clip${clipTag}_last` } };
    if (saveTailPreviews) {
      const tail = Math.min(TAIL_CANDIDATES, frames);
      g[N.tailF] = { class_type: "ImageFromBatch", inputs: { image: images, batch_index: Math.max(0, frames - tail), length: tail } };
      g[N.tailPrev] = { class_type: "PreviewImage", inputs: { images: [N.tailF, 0] } };
    }
  }

  return {
    graph: g,
    meta: {
      width, height, frames, steps, seed, videoNode: N.save, lastFrameNode: N.saveLF,
      // SPEC_MINIMAX_H3_PDD_AND_TELEMETRY.md #3 — steps/sampler alone are misleading on any
      // turbo-mode clip (turbo overrides both); these make the clip self-describing after the
      // fact instead of needing to re-derive it from turboMode + availability.
      stepsEffective: steps, samplerUsed,
      turboFile:
        turboEff === "larryvrh" ? turboLoraForMode(state) || null
        : turboEff === "pdd" ? pddFileForMode(state) || null
        : null, // lightx2v has no dedicated file slot on this port — it's a regular LoRA entry
      pddNfe: turboEff === "pdd" ? String(state.pddNfe ?? "8") : null,
      // null when the pipeline didn't run it; the save path re-probes the output only when
      // `upscale` is set (deblur alone never changes the size).
      deblur: deblurUsed,
      upscale: upscaleUsed,
      // §6 — the run loop saves this node's output as a separate un-processed `_raw` clip.
      rawVideoNode: saveRawToo ? N.saveRaw : null,
    },
  };
}

// ── LTX 2.5 Upscale mode (generationMode "ltxupscale") ───────────────────────
// A standalone 2x latent-upscale + light refine pass over a finished/uploaded clip. Nothing
// about an H3 render is involved — its own model set (Settings → LTX 2.5 Upscale), its own
// euler_ancestral / BasicScheduler(steps 3, denoise 0.15) refine, its own LTX video+audio
// VAEs. The source is read with VHS_LoadVideo (audio passes straight through); its first
// frame anchors LTXVImgToVideoInplace so colour/identity don't drift. Mirrors node
// graph_builder_minimax.js `buildLtxUpscaleGraph` (node 8427b5b), built from the verified
// MiniMaxH3-LTX-2-5-Upscale.json. LTX 2.5 nodes are ComfyUI core — no new pack.
const L = {
  load: "LX:load", unet: "LX:unet", clip: "LX:clip", vaeV: "LX:vae_v", vaeA: "LX:vae_a",
  lora: (i: number) => `LX:lora${i}`,
  upmodel: "LX:up_model", ckAttn: "LX:ck_attn", sol: "LX:sol", preview: "LX:preview",
  txtPos: "LX:txt_pos", txtNeg: "LX:txt_neg", cond: "LX:cond", freePos: "LX:free_pos",
  freeNeg: "LX:free_neg", guider: "LX:guider", enc: "LX:vae_encode", upsamp: "LX:upsampler",
  firstF: "LX:first_frame", i2v: "LX:i2v_inplace", audEnc: "LX:aud_encode", concat: "LX:concat",
  noise: "LX:noise", sampSel: "LX:sampler_sel", sched: "LX:scheduler", sampler: "LX:sampler",
  sep: "LX:separate", decV: "LX:decode_v", decA: "LX:decode_a", deblur: "LX:deblur",
  upApply: "LX:up_apply", upLoad: "LX:up_load", rtx: "LX:rtx", video: "LX:video", save: "LX:save",
};

export interface LtxUpscaleOpts {
  nodeId?: string | number | null;
  sourceFile: string; // filename in ComfyUI's input/
  fps?: number;
  window?: { skip: number; cap: number } | null; // one segment of the source when split for VRAM
  saveSuffix?: string; // per-segment SaveVideo filename suffix, e.g. "_seg00"
  // Segment 2+ of a split run must anchor LTXVImgToVideoInplace on the PREVIOUS segment's own
  // finished output, not on the original source clip at that same time boundary (sourceFile
  // never changes across segments, only the skip/cap window does — anchoring on the original
  // there is a real seam bug: the refine loses continuity with what the prior segment actually
  // produced). A filename already in input/ (the caller reads it via getClipLastFrame on the
  // previous segment's output) — omitted/null for segment 1, which still anchors on the clip's
  // own true first frame. Mirrors node `ca8a194`.
  anchorImage?: string | null;
}

export function buildLtxUpscaleGraph(state: MinimaxState, avail: Avail | undefined, opts: LtxUpscaleOpts) {
  const { nodeId = null, sourceFile, fps = FPS, window = null, saveSuffix = "", anchorImage = null } = opts;
  if (!sourceFile) throw new Error("LTX Upscale: pick a source clip (gallery or upload).");
  const need: Record<string, string> = {
    ltxUnet: "LTX unet", ltxLatentUpscaler: "latent upscaler", ltxClip: "text encoder",
    ltxVaeVideo: "video VAE", ltxVaeAudio: "audio VAE",
  };
  const missing = Object.keys(need).filter((k) => !(state as any)[k] || (state as any)[k] === "none").map((k) => need[k]);
  if (missing.length) throw new Error(`LTX Upscale: set these in ⚙ Settings → LTX 2.5 Upscale — ${missing.join(", ")}`);

  const g: Record<string, any> = {};
  const folder = (state.saveSubfolder || SUBFOLDER).replace(/\\/g, "/");
  const stem = state.filenamePrefix || "MMH3";
  const isGguf = (s: string) => String(s || "").toLowerCase().endsWith(".gguf");

  // ── source ────────────────────────────────────────────────────────────────
  g[L.load] = { class_type: "VHS_LoadVideo", inputs: {
    video: sourceFile, force_rate: 0, custom_width: 0, custom_height: 0,
    frame_load_cap: window ? Math.max(1, window.cap | 0) : 0,
    skip_first_frames: window ? Math.max(0, window.skip | 0) : 0,
    select_every_nth: 1, format: "AnimateDiff",
  } };
  // IMAGE = [L.load, 0], frame_count = [L.load, 1], audio = [L.load, 2]

  // ── loaders ───────────────────────────────────────────────────────────────
  g[L.unet] = isGguf(state.ltxUnet)
    ? { class_type: "UnetLoaderGGUF", inputs: { unet_name: state.ltxUnet } }
    : { class_type: "UNETLoader", inputs: { unet_name: state.ltxUnet, weight_dtype: "default" } };
  let model: any = [L.unet, 0];

  g[L.clip] = isGguf(state.ltxClip)
    ? { class_type: "TJ_LTX25ClipLoaderGGUF", inputs: { clip_name: state.ltxClip } }
    : { class_type: "CLIPLoader", inputs: { clip_name: state.ltxClip, type: "ltxv", device: "default" } };
  const clip: any = [L.clip, 0];

  g[L.vaeV] = { class_type: "VAELoader", inputs: { vae_name: state.ltxVaeVideo } };
  g[L.vaeA] = { class_type: "VAELoader", inputs: { vae_name: state.ltxVaeAudio } };
  const vaeV: any = [L.vaeV, 0], vaeA: any = [L.vaeA, 0];

  g[L.upmodel] = { class_type: "LatentUpscaleModelLoader", inputs: { model_name: state.ltxLatentUpscaler } };

  // ── LTX LoRA chain (own list — a different model from H3, so never state.loras) ──
  (state.ltxLoras || []).forEach((lora, i) => {
    if (!lora?.name || lora.name === "none" || lora.enabled === false) return;
    const s = parseFloat(String(lora.strength ?? 1.0));
    if (!(s > 0)) return;
    g[L.lora(i)] = { class_type: "LoraLoaderModelOnly", inputs: { model, lora_name: lora.name, strength_model: s } };
    model = [L.lora(i), 0];
  });

  // ── model patches (verified combo: comfy-kitchen attention → Sol-Attn → preview) ──
  if (has(avail, "ModelAttentionBackend")) {
    g[L.ckAttn] = { class_type: "ModelAttentionBackend", inputs: { model, attention: "comfy kitchen attention" } };
    model = [L.ckAttn, 0];
  }
  if (has(avail, "SolAttnPatch")) {
    g[L.sol] = { class_type: "SolAttnPatch", inputs: {
      model, tau: 1.3, start_percent: 0.2, end_percent: 0.9, min_tokens: 4096,
      int8_qk: true, sink_conditioning: "exact_kv_and_rows", morton: false, morton_curve: "2d_frame",
      int8_pv: true, verbose: false, use_tma: false, dense_blocks: "",
    } };
    model = [L.sol, 0];
  }
  if ((state.ltxPreviewEnabled ?? true) && has(avail, "ModelPreviewOverrideKJ") && nodeId != null) {
    // Same key the JS live-preview listener matches on (previewNodeKey) — the inline
    // "LX:preview" id used before had a colon, which ComfyUI truncates in
    // hidden.unique_id for dynamic-expansion paths, so the frames never reached the UI.
    const key = previewNodeKey(nodeId);
    const pin: any = {
      model, max_resolution: state.ltxPreviewMaxRes ?? 512, jpeg_quality: state.ltxPreviewQuality ?? 85,
      suppress_default_preview: true, preview_frames: Math.max(1, state.ltxPreviewFrames ?? 8),
      preview_fps: state.ltxPreviewFps ?? fps,
    };
    const tv = state.ltxTinyVae;
    if (tv && tv !== "none") pin.tiny_vae = tv;
    g[key] = { class_type: "ModelPreviewOverrideKJ", inputs: pin, _meta: { title: `MMH3 LTX preview #${nodeId}` } };
    model = [key, 0];
  }

  // ── conditioning ──────────────────────────────────────────────────────────
  g[L.txtPos] = { class_type: "CLIPTextEncode", inputs: { text: String(state.ltxPrompt || ""), clip } };
  g[L.txtNeg] = { class_type: "CLIPTextEncode", inputs: {
    text: String(state.ltxNegPrompt || "bad anatomy, inconsistent look, low resolution,"), clip,
  } };
  g[L.cond] = { class_type: "LTXVConditioning", inputs: { frame_rate: fps, positive: [L.txtPos, 0], negative: [L.txtNeg, 0] } };
  let condPos: any = [L.cond, 0], condNeg: any = [L.cond, 1];
  if (has(avail, "TJ_FreeTextEncoderVRAM")) {
    g[L.freePos] = { class_type: "TJ_FreeTextEncoderVRAM", inputs: { clip, trigger: [L.cond, 0] } };
    g[L.freeNeg] = { class_type: "TJ_FreeTextEncoderVRAM", inputs: { clip, trigger: [L.cond, 1] } };
    condPos = [L.freePos, 0]; condNeg = [L.freeNeg, 0];
  }
  g[L.guider] = { class_type: "LTXVDualCFGGuider", inputs: { video_cfg: 1, audio_cfg: 1, model, positive: condPos, negative: condNeg } };

  // ── latent: encode → 2x latent upscale → first-frame anchor → concat with audio ──
  g[L.enc] = { class_type: "VAEEncode", inputs: { pixels: [L.load, 0], vae: vaeV } };
  g[L.upsamp] = { class_type: "LTXVLatentUpsampler", inputs: { samples: [L.enc, 0], upscale_model: [L.upmodel, 0], vae: vaeV } };
  let anchorLink: any;
  if (anchorImage) {
    g[L.firstF] = { class_type: "LoadImage", inputs: { image: anchorImage } };
    anchorLink = [L.firstF, 0];
  } else {
    g[L.firstF] = { class_type: "ImageFromBatch", inputs: { image: [L.load, 0], batch_index: 0, length: 1 } };
    anchorLink = [L.firstF, 0];
  }
  g[L.i2v] = { class_type: "LTXVImgToVideoInplace", inputs: { strength: 1, bypass: false, vae: vaeV, image: anchorLink, latent: [L.upsamp, 0] } };
  g[L.audEnc] = { class_type: "LTXVAudioVAEEncode", inputs: { audio: [L.load, 2], audio_vae: vaeA } };
  g[L.concat] = { class_type: "LTXVConcatAVLatent", inputs: { video_latent: [L.i2v, 0], audio_latent: [L.audEnc, 0] } };

  // ── refine sample ─────────────────────────────────────────────────────────
  // Seed comes from the node's fixed bottom Seed / Mode row (state.seed), not a mode-local
  // field — one seed control for every mode.
  const seed = state.seedMode === "randomize" ? Math.floor(Math.random() * 1e15) : (state.seed ?? 0);
  const steps = Math.max(1, Math.round(state.ltxSteps ?? 3));
  g[L.noise] = { class_type: "RandomNoise", inputs: { noise_seed: seed } };
  g[L.sampSel] = { class_type: "KSamplerSelect", inputs: { sampler_name: state.ltxSampler || "euler_ancestral" } };
  g[L.sched] = { class_type: "BasicScheduler", inputs: {
    model, scheduler: state.ltxScheduler || "simple", steps, denoise: state.ltxDenoise ?? 0.15,
  } };
  g[L.sampler] = { class_type: "SamplerCustomAdvanced", inputs: {
    noise: [L.noise, 0], guider: [L.guider, 0], sampler: [L.sampSel, 0], sigmas: [L.sched, 0], latent_image: [L.concat, 0],
  } };

  // ── decode ────────────────────────────────────────────────────────────────
  g[L.sep] = { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: [L.sampler, 0] } };
  g[L.decV] = { class_type: "VAEDecodeTiled", inputs: {
    tile_size: 512, overlap: 64, temporal_size: 4096, temporal_overlap: 32, samples: [L.sep, 0], vae: vaeV,
  } };
  g[L.decA] = { class_type: "LTXVAudioVAEDecode", inputs: { samples: [L.sep, 1], audio_vae: vaeA } };
  let images: any = [L.decV, 0];

  // ── optional RTX finisher (reuses the H3 node's deblur / RTX VSR settings) ──
  let deblurUsed: string | null = null;
  let upscaleUsed: any = null;
  if (state.deblurStrength && state.deblurStrength !== "none" && has(avail, "TJ_RTXDeblur")) {
    g[L.deblur] = { class_type: "TJ_RTXDeblur", inputs: { images, strength: state.deblurStrength } };
    images = [L.deblur, 0]; deblurUsed = state.deblurStrength;
  }
  const up = state.upscaleMode || "none";
  if (up === "model" && state.upscaleModel && state.upscaleModel !== "none") {
    g[L.upLoad] = { class_type: "UpscaleModelLoader", inputs: { model_name: state.upscaleModel } };
    g[L.upApply] = { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: [L.upLoad, 0], image: images } };
    images = [L.upApply, 0]; upscaleUsed = { method: "model", model: state.upscaleModel };
  } else if (up === "rtx" && has(avail, "RTXVideoSuperResolution")) {
    g[L.rtx] = { class_type: "RTXVideoSuperResolution", inputs: {
      images, resize_type: "scale by multiplier", "resize_type.scale": state.rtxScale ?? 2.0, quality: state.rtxQuality || "ULTRA",
    } };
    images = [L.rtx, 0]; upscaleUsed = { method: "rtx", scale: state.rtxScale ?? 2.0, quality: state.rtxQuality || "ULTRA" };
  }

  // ── output ────────────────────────────────────────────────────────────────
  g[L.video] = { class_type: "CreateVideo", inputs: { images, fps, audio: [L.decA, 0] } };
  g[L.save] = { class_type: "SaveVideo", inputs: {
    video: [L.video, 0], filename_prefix: `${folder}/${stem}_LTXUP${saveSuffix}`, format: "auto", codec: "auto",
  } };

  const usedLoras = (state.ltxLoras || [])
    .filter((l) => l?.name && l.name !== "none" && l.enabled !== false)
    .map((l) => ({ name: l.name, strength: l.strength ?? 1.0 }));

  return {
    graph: g,
    meta: {
      ltxUpscale: true, steps, denoise: state.ltxDenoise ?? 0.15,
      sampler: state.ltxSampler || "euler_ancestral", scheduler: state.ltxScheduler || "simple",
      seed, source: sourceFile, fps, loras: usedLoras, deblur: deblurUsed, upscale: upscaleUsed,
      videoNode: L.save, lastFrameNode: null,
    },
  };
}

// ── H3 Face Refine — SPEC_MINIMAX_H3_FACE_REFINE.md ─────────────────────────────────────
// Post-process an existing clip: detect/track a face, crop it to fill a canvas, re-render
// just that crop through H3 as img2img (H3InjectVideoLatent — H3 has no stock img2img path),
// then stitch the refined crop back over the original frames. Same "source clip → own graph
// → single queue → gallery save" shape as buildLtxUpscaleGraph above.
const FR = {
  load: "FR:load",
  select: "FR:select", // H3FaceSelect — Manual Select only
  track: "FR:track",
  inject: "FR:inject",
  denoise: "FR:denoise",
  stitch: "FR:stitch",
  video: "FR:video",
  save: "FR:save",
  lora: (i: number) => `FR:lora${i}`, // Face Refine's own LoRA chain — §17, never state.loras
};

/** Resolve a saved preset id ("s:<numeric id>" for a PIPELINE_PRESETS built-in, "u:<name>" for
 * a user preset) the same way view.ts's own preset dropdown names them (§18's frTurboPreset). */
function findPresetById(id: string, userPresets: UserPipelinePreset[] | undefined): PipelinePreset | UserPipelinePreset | null {
  if (!id) return null;
  if (id.startsWith("u:")) {
    const name = id.slice(2);
    return (userPresets || []).find((p) => p.name === name) || null;
  }
  if (id.startsWith("s:")) {
    const num = Number(id.slice(2));
    return PIPELINE_PRESETS.find((p) => p.id === num) || null;
  }
  return null;
}

export interface FaceRefineOpts {
  nodeId?: string | number | null;
  sourceFile: string; // filename in ComfyUI's input/
  promptText: string;
  seed?: number;
  refImages?: string[] | null;
  // Multi-person chain (§12): each chain step calls this with its own single pick instead
  // of reading state.frConfirmedPick, so the step never touches the shared state.
  confirmedPickOverride?: string;
  // Needed only when state.frTurboOn is set — the caller's own loaded user-preset list, so
  // this stays a pure function instead of reading from a global/module cache.
  userPresets?: UserPipelinePreset[];
}

export function buildFaceRefineGraph(state: MinimaxState, avail: Avail | undefined, opts: FaceRefineOpts) {
  const { nodeId = null, sourceFile, promptText, seed, refImages, confirmedPickOverride, userPresets } = opts;
  if (!sourceFile) throw new Error("Face Refine: pick a source clip (gallery or upload).");
  if (!state.faceDetector || state.faceDetector === "none")
    throw new Error("Face Refine: set a face detector in ⚙ Settings — FaceRefine Model.");
  const isManual = state.frSelect === "manual";
  const confirmedPick = confirmedPickOverride ?? state.frConfirmedPick;
  if (isManual && !String(confirmedPick || "").trim())
    throw new Error("Face Refine: pick a face for every shot first (Pick Faces button) — Select is set to Manual.");

  const g: Record<string, any> = {};
  const folder = (state.saveSubfolder || SUBFOLDER).replace(/\\/g, "/");
  const stem = state.filenamePrefix || "MMH3";
  const cutMode = state.frCutDetection ? "auto (pyscenedetect)" : "none";

  // ── source + (optional) manual face pick ──────────────────────────────────
  // H3FaceSelect replaces the plain video loader when Manual Select is on: it detects once,
  // up front, and hands its boxes to the tracker via face_pick so the tracker skips its own
  // detection pass. Ranking-rule modes (largest_face etc.) skip this node entirely.
  let imagesLink: any, audioLink: any, facePickLink: any = null;
  if (isManual && has(avail, "H3FaceSelect")) {
    g[FR.select] = { class_type: "H3FaceSelect", inputs: {
      video: sourceFile, detector: state.faceDetector, confidence: state.frConfidence ?? 0.35,
      select: "manual", select_index: 0, confirmed_pick: confirmedPick || "",
      cut_detection: cutMode, cut_threshold: state.frCutThreshold ?? 3.0,
      skip_first_frames: 0, frame_load_cap: 0, select_every_nth: 1,
    } };
    imagesLink = [FR.select, 0]; audioLink = [FR.select, 1]; facePickLink = [FR.select, 2];
  } else {
    g[FR.load] = { class_type: "VHS_LoadVideo", inputs: {
      video: sourceFile, force_rate: 0, custom_width: 0, custom_height: 0,
      frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: "AnimateDiff",
    } };
    imagesLink = [FR.load, 0]; audioLink = [FR.load, 2];
  }

  // ── track + crop ───────────────────────────────────────────────────────────
  const trackInputs: Record<string, any> = {
    images: imagesLink, detector: state.faceDetector, confidence: state.frConfidence ?? 0.35,
    crop_factor: state.frCropFactor ?? 2.5,
    canvas_width: state.frCanvasWidth ?? 768, canvas_height: state.frCanvasHeight ?? 768,
    canvas_mode: state.frCanvasMode || "auto_capped_768",
    smooth_window: state.frSmoothWindow ?? 21, size_smooth_window: 51,
    smooth_method: "gaussian", size_mode: "per_frame",
    identity_track: state.frIdentityTrack !== false,
    // 0.45 (not the pack's own stock 0.28) — SPEC_MINIMAX_H3_FACE_REFINE.md §19/§20:
    // 0.28 let continuity tracking drift onto the wrong person uncorrected.
    identity_threshold: state.frIdentityThreshold ?? 0.45,
    fallback_detector: state.faceFallbackDetector || "none",
  };
  if (facePickLink) {
    trackInputs.face_pick = facePickLink; // detection already done by H3FaceSelect
  } else {
    trackInputs.select = state.frSelect || "largest_face";
    trackInputs.cut_detection = cutMode;
    trackInputs.cut_threshold = state.frCutThreshold ?? 3.0;
  }
  if (state.frIdentityModel) trackInputs.identity_model = state.frIdentityModel;
  g[FR.track] = { class_type: "H3FaceTrackCrop", inputs: trackInputs };
  // RETURN_NAMES = (crops, transform, preview, report, canvas_w, canvas_h, frame_count)
  const canvasW: any = [FR.track, 4], canvasH: any = [FR.track, 5], frameCount: any = [FR.track, 6];
  const cropsLink: any = [FR.track, 0], transformLink: any = [FR.track, 1];

  // ── loaders + model chain ─────────────────────────────────────────────────
  // Face Refine always conditions like Reference mode (refs + prompt, no first/last
  // keyframes) — generationMode is coerced to "reference" for this call only, on a shallow
  // copy, so the real state/main render is never touched. frUseCustomModel (§15) swaps in
  // Face Refine's OWN unet/clip file (GGUF-aware) instead of H3's Reference model.
  const useCustomModel = !!state.frUseCustomModel;
  const unetFile = useCustomModel ? state.frUnet : state.unetReference;
  const clipFile = useCustomModel ? state.frClip : state.clipName;
  if (useCustomModel && (!unetFile || unetFile === "none"))
    throw new Error("Face Refine: set its own UNET in ⚙ Settings → FaceRefine Model (or turn off 'use a separate model').");
  if (useCustomModel && (!clipFile || clipFile === "none"))
    throw new Error("Face Refine: set its own text encoder in ⚙ Settings → FaceRefine Model (or turn off 'use a separate model').");
  const refState: MinimaxState = { ...state, generationMode: "reference", unetReference: unetFile };
  // Face Refine's OWN turbo switch (§18) — independent of the main render's turboMode.
  // OFF: force "none" regardless of what the main render has set, so no turbo LoRA leaks in
  // by accident. ON: apply the chosen saved preset's full accel recipe onto refState (a
  // shallow copy — the real `state`/main render is untouched).
  if (state.frTurboOn) {
    const preset = findPresetById(state.frTurboPreset, userPresets)
      || (userPresets || []).find((p) => p.turbo && p.turbo !== "none")
      || PIPELINE_PRESETS.find((p) => p.turbo && p.turbo !== "none")
      || null;
    if (preset) {
      applyPreset(refState, preset);
      // applyPreset writes unetReference when the matched preset pins one (RECIPE_KEYS) —
      // re-assert Face Refine's own model choice (unetFile: frUnet under frUseCustomModel,
      // else state.unetReference) so a preset's pinned model can never silently override it.
      refState.unetReference = unetFile;
    } else {
      refState.turboMode = "none";
    }
  } else {
    refState.turboMode = "none";
  }
  const modelLink0 = buildModelChain(g, refState, avail);
  g[N.clip] = String(clipFile || "").toLowerCase().endsWith(".gguf")
    ? { class_type: "CLIPLoaderGGUF", inputs: { clip_name: clipFile, type: "minimax" } }
    : { class_type: "CLIPLoader", inputs: { clip_name: clipFile, type: "minimax", device: "default" } };
  g[N.vaeV] = { class_type: "VAELoader", inputs: { vae_name: state.vaeVideo } };
  g[N.vaeA] = { class_type: "VAELoader", inputs: { vae_name: state.vaeAudio } };

  // ── Face Refine's OWN LoRA chain (e.g. a face-detail LoRA) — never state.loras, which
  // buildModelChain already applied above for the main render's own LoRA list. Same pattern
  // as LTX Upscale's ltxLoras: its own list, applied closest to the sampler. ──
  let modelLoraLink = modelLink0;
  (state.frLoras || []).forEach((lora, i) => {
    if (!lora?.name || lora.name === "none" || lora.enabled === false) return;
    const s = parseFloat(String(lora.strength ?? 1.0));
    if (!(s > 0)) return;
    g[FR.lora(i)] = { class_type: "LoraLoaderModelOnly", inputs: { model: modelLoraLink, lora_name: lora.name, strength_model: s } };
    modelLoraLink = [FR.lora(i), 0];
  });

  // Live sampling preview — same ModelPreviewOverrideKJ + previewNodeKey(nodeId) wiring
  // buildClipGraph uses, so Face Refine streams into the same preview box every other mode
  // already shows.
  const modelLink1 = applyPreview(g, refState, avail, modelLoraLink, nodeId);
  const modelLink = applySla(g, refState, avail, modelLink1);

  // ── conditioning — width/height/length come from the TRACKER's outputs (links, not
  // literals): canvas_mode "auto_*" only knows the real size once the crop is built. ──
  buildConditioning(g, refState, String(promptText || "").trim(), canvasW, canvasH, frameCount,
    { refImages: refImages ?? state.refImages }, avail);

  // ── img2img: encode the tracked crops into the video stream (H3 has no stock path) ──
  g[FR.inject] = { class_type: "H3InjectVideoLatent", inputs: {
    av_latent: [N.cond, 1], images: cropsLink, vae: [N.vaeV, 0],
  } };

  // ── audio lock — our own node (TJ_H3_AudioLock), never a third-party AudioLock pack ──
  g[N.audioLock] = { class_type: "TJ_H3_AudioLock", inputs: {
    av_latent: [FR.inject, 0], audio: audioLink, audio_vae: [N.vaeA, 0],
    mode: "lock", strength: 0.5, fit: "pad_silence",
    get_name_av_latent: "(none)", get_name_audio: "(none)", get_name_audio_vae: "(none)",
    auto_set: false,
  } };

  // ── per-frame denoise: small face = strong pass, large face = gentle ─────────
  g[FR.denoise] = { class_type: "H3PerFrameDenoise", inputs: {
    model: modelLink, av_latent: [N.audioLock, 0], transform: transformLink,
    denoise_multiplier_small_face: state.frDenoiseMulSmall ?? 1.0,
    denoise_multiplier_large_face: state.frDenoiseMulLarge ?? 0.35,
    scale_mode: "absolute_px",
    face_px_small: state.frFacePxSmall ?? 30.0, face_px_large: state.frFacePxLarge ?? 120.0,
    gamma: 1.0, smooth_frames: 9,
  } };
  // RETURN_NAMES = (av_latent, report, model) — this model MUST reach the sampler, not
  // modelLink: the two things it patches are the MODEL, not the latent.
  const denoisedModel: any = [FR.denoise, 2];

  // ── sample ─────────────────────────────────────────────────────────────────
  // A turbo accelerator needs its OWN step count / sampler to mean anything (PDD's head
  // bank is trained for its exact NFE grid, larryvrh needs its dedicated sampler node) — same
  // coordination buildClipGraph does. frSteps/frSampler only apply with no turbo active;
  // frDenoise still trims the resulting schedule either way.
  const turboMode = turboEffective(refState, avail);
  const useTurboSampler = turboMode === "larryvrh" && has(avail, "MiniMaxH3TurboSampler");
  const steps = turboMode === "none" ? Math.max(1, Math.round(state.frSteps ?? 8)) : effectiveSteps(refState, avail);

  const useSeed = state.seedMode === "randomize" ? Math.floor(Math.random() * 1e15) : (seed ?? state.seed ?? 0);
  g[N.noise] = { class_type: "RandomNoise", inputs: { noise_seed: useSeed } };
  if (useTurboSampler) {
    g[N.sampSel] = { class_type: "MiniMaxH3TurboSampler", inputs: {} };
  } else if (turboMode === "pdd") {
    g[N.sampSel] = { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } };
  } else {
    g[N.sampSel] = { class_type: "KSamplerSelect", inputs: { sampler_name: state.frSampler || "euler" } };
  }
  g[N.sched] = { class_type: "BasicScheduler", inputs: {
    model: denoisedModel, scheduler: state.frScheduler || "simple", steps, denoise: state.frDenoise ?? 0.40,
  } };
  let condLink: any = [N.cond, 0];
  if (has(avail, "TJ_FreeTextEncoderVRAM")) {
    g[N.freeClipVram] = { class_type: "TJ_FreeTextEncoderVRAM", inputs: { clip: [N.clip, 0], trigger: condLink } };
    condLink = [N.freeClipVram, 0];
  }
  g[N.guider] = { class_type: "BasicGuider", inputs: { model: denoisedModel, conditioning: condLink } };
  g[N.sampler] = { class_type: "SamplerCustomAdvanced", inputs: {
    noise: [N.noise, 0], guider: [N.guider, 0], sampler: [N.sampSel, 0], sigmas: [N.sched, 0],
    latent_image: [FR.denoise, 0],
  } };
  g[N.decode] = { class_type: "VAEDecode", inputs: { samples: [N.sampler, 0], vae: [N.vaeV, 0] } };

  // ── stitch the refined crop back onto the original frames, then save ─────────
  g[FR.stitch] = { class_type: "H3FaceStitch", inputs: {
    base_images: imagesLink, refined_crops: [N.decode, 0], transform: transformLink,
    paste_region: state.frPasteRegion || "face_only",
    mask_dilation: 16, feather: state.frFeather ?? 6,
    colour_match: state.frColourMatch ?? 1.0, blend: state.frBlend ?? 1.0,
    undetected_frames: state.frUndetected || "fade_out",
  } };

  g[FR.video] = { class_type: "CreateVideo", inputs: { images: [FR.stitch, 0], fps: FPS, audio: [N.audioLock, 1] } };
  g[FR.save] = { class_type: "SaveVideo", inputs: {
    video: [FR.video, 0], filename_prefix: `${folder}/${stem}_FACEREFINE`, format: "auto", codec: "auto",
  } };

  const usedLoras = (state.frLoras || []).filter((l) => l?.name && l.name !== "none" && l.enabled !== false)
    .map((l) => ({ name: l.name, strength: l.strength ?? 1.0 }));
  return {
    graph: g,
    meta: {
      faceRefine: true, source: sourceFile, select: state.frSelect,
      denoise: state.frDenoise ?? 0.40, steps, turboMode, loras: usedLoras,
      seed: useSeed, videoNode: FR.save, lastFrameNode: null,
    },
  };
}

// ── Gallery post-processing: Upscale / Interpolate on a single finished clip ──
// SPEC_GALLERY_UPSCALE_INTERPOLATE.md. Standalone one-off graphs, unrelated to the per-clip
// pipeline above, so they get their own plain node-id strings instead of sharing the N map.

export interface UpscaleGraphOpts {
  // "none" is a real choice, not an absence — SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §15: with
  // deblur beside it, Upscale = None is what lets this graph run a deblur-only pass.
  method: "model" | "rtx" | "none";
  upscaleModel?: string;
  rtxScale?: number;
  rtxQuality?: string;
  // RTX Deblur — a pre-pass before upscale, at the input's own resolution, independent of
  // whether an upscale follows. "none" | "LOW" | "MEDIUM" | "HIGH" | "ULTRA".
  deblur?: string;
  // §16 chunking (below) slices one source into several bounded VHS_LoadVideo reads instead
  // of one whole-file load. Both default to the old whole-file behavior, so a caller that
  // never chunks doesn't need to know these exist.
  skipFirstFrames?: number;
  frameLoadCap?: number;
  // Overrides the computed _upscaled/_deblur suffix when set (chunking passes "" — the chunk
  // files are joined and renamed afterward, so an interim suffix would just be thrown away).
  saveSuffix?: string;
}

export function buildUpscaleGraph(inputFilename: string, folder: string, stem: string, opts: UpscaleGraphOpts, avail?: Avail) {
  const g: Record<string, any> = {};
  // force_rate 0 keeps the file's own timing — the frame count and audio come back alongside
  // the images so the re-encode stays in sync with the original (resampling to a fixed FPS
  // here, on a file that may already be a re-encode of a re-encode, drifted audio sync).
  g.load = { class_type: "VHS_LoadVideo", inputs: { video: inputFilename, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: opts.frameLoadCap ?? 0, skip_first_frames: opts.skipFirstFrames ?? 0, select_every_nth: 1 } };
  let images: any = ["load", 0];

  // Deblur is a pre-pass, not part of upscaling: it sharpens at the input's own resolution and
  // runs whether or not an upscale follows. A separate `if` (not nested in the upscale branch)
  // is what lets the caller ask for deblur alone via method:"none" below.
  const deblurOn = !!opts.deblur && opts.deblur !== "none";
  if (deblurOn) {
    if (!has(avail, "TJ_RTXDeblur")) throw new Error("TJ_RTXDeblur is not installed — restart ComfyUI after updating this pack.");
    g.deblur = { class_type: "TJ_RTXDeblur", inputs: { images, strength: opts.deblur } };
    images = ["deblur", 0];
  }

  if (opts.method === "none") {
    // deblur-only: nothing else touches the frames
    if (!deblurOn) throw new Error("Nothing to do — pick deblur, an upscale, or both.");
  } else if (opts.method === "rtx") {
    g.rtx = { class_type: "RTXVideoSuperResolution", inputs: { images, resize_type: "scale by multiplier", "resize_type.scale": opts.rtxScale ?? 2.0, quality: opts.rtxQuality || "ULTRA" } };
    images = ["rtx", 0];
  } else {
    g.upModel = { class_type: "UpscaleModelLoader", inputs: { model_name: opts.upscaleModel } };
    g.upApply = { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: ["upModel", 0], image: images } };
    images = ["upApply", 0];
  }

  // deblur-only gets its own suffix — otherwise a "_upscaled" file that never touched the
  // upscaler would misname what actually happened to it.
  const suffix = opts.saveSuffix !== undefined ? opts.saveSuffix : opts.method === "none" ? "_deblur" : "_upscaled";
  g.video = { class_type: "CreateVideo", inputs: { images, fps: FPS, audio: ["load", 2] } };
  g.save = { class_type: "SaveVideo", inputs: { video: ["video", 0], filename_prefix: `${folder}/${stem}${suffix}`, format: "auto", codec: "auto" } };
  return { graph: g, saveNode: "save" };
}

export interface InterpolateGraphOpts {
  targetFps: number;
  scale: number;
  batchSize: number;
  useFp16: boolean;
  skipFirstFrames?: number;
  frameLoadCap?: number;
  saveSuffix?: string;
}

export function buildInterpolateGraph(inputFilename: string, folder: string, stem: string, opts: InterpolateGraphOpts) {
  const g: Record<string, any> = {};
  g.load = { class_type: "VHS_LoadVideo", inputs: { video: inputFilename, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: opts.frameLoadCap ?? 0, skip_first_frames: opts.skipFirstFrames ?? 0, select_every_nth: 1 } };
  g.rife = {
    class_type: "RIFEInterpolation",
    inputs: {
      images: ["load", 0],
      source_fps: FPS,
      target_fps: opts.targetFps,
      scale: opts.scale,
      model_name: "flownet.pkl",
      batch_size: opts.batchSize,
      use_fp16: opts.useFp16,
    },
  };
  // Encode at target_fps, not FPS — the clip keeps its original running time and just moves
  // more smoothly; encoding at the source rate would turn the extra frames into slow motion
  // and desync the audio.
  const suffix = opts.saveSuffix !== undefined ? opts.saveSuffix : `_${opts.targetFps}fps`;
  g.video = { class_type: "CreateVideo", inputs: { images: ["rife", 0], fps: opts.targetFps, audio: ["load", 2] } };
  g.save = { class_type: "SaveVideo", inputs: { video: ["video", 0], filename_prefix: `${folder}/${stem}${suffix}`, format: "auto", codec: "auto" } };
  return { graph: g, saveNode: "save" };
}

// Gallery Resize post-process — mainly for downscaling / adjusting a finished clip's frame
// size. width/height/crop are computed client-side by the caller (galleryOverlay.ts's
// computeResizeTarget) from the source clip's own resolution + the chosen mode
// (Long/Short/Ratio/MegaPixel/WxH) — this function just runs whatever exact numbers it's
// given through ComfyUI core's own ImageScale, which already does everything needed:
// `crop:"disabled"` scales both dimensions to the given width/height exactly (used for Long/
// Short/WxH-stretch, where the caller already computed an aspect-preserving or intentionally
// distorted target); `crop:"center"` scales to COVER the target box then centre-crops the
// excess (used for Ratio and WxH-crop) — since the caller sizes the crop target to touch one
// full source dimension, the cover-scale factor comes out to exactly 1.0 and this is a pure
// crop, not a lossy scale+crop.
export interface ResizeGraphOpts {
  width: number;
  height: number;
  crop: "disabled" | "center";
  skipFirstFrames?: number;
  frameLoadCap?: number;
  saveSuffix?: string;
}

export function buildResizeGraph(inputFilename: string, folder: string, stem: string, opts: ResizeGraphOpts) {
  const g: Record<string, any> = {};
  g.load = { class_type: "VHS_LoadVideo", inputs: { video: inputFilename, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: opts.frameLoadCap ?? 0, skip_first_frames: opts.skipFirstFrames ?? 0, select_every_nth: 1 } };
  g.resize = { class_type: "ImageScale", inputs: { image: ["load", 0], upscale_method: "lanczos", width: opts.width, height: opts.height, crop: opts.crop } };
  const suffix = opts.saveSuffix !== undefined ? opts.saveSuffix : `_${opts.width}x${opts.height}`;
  g.video = { class_type: "CreateVideo", inputs: { images: ["resize", 0], fps: FPS, audio: ["load", 2] } };
  g.save = { class_type: "SaveVideo", inputs: { video: ["video", 0], filename_prefix: `${folder}/${stem}${suffix}`, format: "auto", codec: "auto" } };
  return { graph: g, saveNode: "save" };
}
