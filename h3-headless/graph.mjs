// graph.mjs — ported from src/tools/minimax_h3/graphBuilder.ts (buildClipGraph + helpers).
// Types stripped; gallery/upscale/interpolate graphs dropped (out of scope). buildClipGraph
// supports both single-clip runs (clipIndex 0, no continuity) and One-Take multi-clip runs —
// index.mjs's runOneTake() orchestration loop passes clipIndex/checkpointName/
// prevCheckpointName across a submit-wait-submit-wait sequence; buildOneTake /
// saveOneTakeCheckpoint / buildAudioLock only short-circuit when those opts are left at their
// single-clip defaults.

import {
  SUBFOLDER, FPS, resolveResolution, ONE_TAKE_OVERLAP_FRAMES, framesToSeconds,
  attnForwardBlockedReason, blockCacheBlockedReason, h3OptimizerBlockedReason,
  pddFileForMode, computeRtxTarget, CHARSHEET_FRAMES,
  CHARSHEET_DEFAULT_FRAME_INDICES, BUILTIN_PRESETS, applyPreset,
} from "./core-helpers.mjs";

export const N = {
  unet: "MM:unet", clip: "MM:clip", vaeV: "MM:vae_video", vaeA: "MM:vae_audio",
  sage: "MM:sage", memSage: "MM:mem_sage", solSched: "MM:sol_sched", fusedMod: "MM:fused_mod",
  ckAttn: "MM:ck_attn", torch: "MM:torch", shift: "MM:sigma_shift",
  cache: "MM:cache", fbcache: "MM:fbcache", h3mem: "MM:h3_mem", h3sparse: "MM:h3_sparse",
  sla: "MM:sla_attn", sol: "MM:solattn", spectrum: "MM:spectrum", turbo: "MM:turbo_lora", pdd: "MM:pdd_acc",
  preview: "MM:preview", cond: "MM:cond", freeClipVram: "MM:free_clip_vram",
  noise: "MM:noise", sampSel: "MM:sampler_sel", sched: "MM:scheduler", guider: "MM:guider", sampler: "MM:sampler",
  decode: "MM:decode", decodeA: "MM:decode_audio",
  upModel: "MM:upscale_model", upApply: "MM:upscale", rtx: "MM:rtx", rtxCrop: "MM:rtx_crop",
  fvsrPipe: "MM:flashvsr_pipe", fvsr: "MM:flashvsr", deblurR: "MM:deblur",
  video: "MM:video", save: "MM:save_video", videoRaw: "MM:video_raw", saveRaw: "MM:save_video_raw",
  lastF: "MM:last_frame", saveLF: "MM:save_last_frame", tailF: "MM:tail_frames", tailPrev: "MM:tail_preview",
  loadFirst: "MM:load_first", loadLast: "MM:load_last", loadFirstResize: "MM:load_first_resize", loadLastResize: "MM:load_last_resize",
  ref: (i) => `MM:ref_${i}`, refResize: (i) => `MM:ref_resize_${i}`,
  refVid: (i) => `MM:refvid_${i}`, refAud: (i) => `MM:refaud_${i}`, refAudTrim: (i) => `MM:refaud_trim_${i}`,
  audioLock: "MM:audio_lock", lockAud: "MM:lock_audio", lockAudTrim: "MM:lock_audio_trim",
  chkLoad: "MM:h3_chk_load", continuation: "MM:h3_continuation", chkSave: "MM:h3_chk_save",
};
export const TAIL_CANDIDATES = 8;

const has = (avail, name) => !!(avail && avail[name]);

export function turboLoraForMode(state) {
  const name = state.turboLora;
  return name && name !== "none" ? name : "";
}

export function turboEffective(state, avail) {
  if (state.turboMode === "larryvrh") {
    if (!turboLoraForMode(state)) return "none";
    if (avail && Object.keys(avail).length && !avail.MiniMaxH3TurboLoRA) return "none";
    return "larryvrh";
  }
  if (state.turboMode === "pdd") {
    if (!pddFileForMode(state)) return "none";
    if (avail && Object.keys(avail).length && !avail.MiniMaxH3PDDAccApply) return "none";
    return "pdd";
  }
  return state.turboMode || "none";
}

export function effectiveSteps(state, avail) {
  const eff = turboEffective(state, avail);
  if (eff === "larryvrh") return state.turboSteps ?? 4;
  if (eff === "lightx2v") return state.slaTurboSteps ?? 6;
  if (eff === "pdd") return Math.max(1, Math.round(Number(state.pddNfe) || 8));
  return state.steps ?? 20;
}

function requireModels(state) {
  const mode = state.generationMode || "t2v";
  const unet = mode === "reference" ? state.unetReference : state.unetFirstLast;
  if (!unet || unet === "none") throw new Error(`No ${mode === "reference" ? "Reference" : "First/Last"} UNET set — pass it in job.json or set it on the ComfyUI config.`);
  if (!state.clipName || state.clipName === "none") throw new Error("No text encoder set (clip_name) on the ComfyUI config.");
  if (!state.vaeVideo || state.vaeVideo === "none") throw new Error("No video VAE set (vae_video) on the ComfyUI config.");
  if (!state.vaeAudio || state.vaeAudio === "none") throw new Error("No audio VAE set (vae_audio) on the ComfyUI config.");
  return unet;
}

function unetNode(name) {
  if (String(name || "").toLowerCase().endsWith(".gguf")) return { class_type: "UnetLoaderGGUF", inputs: { unet_name: name } };
  return { class_type: "UNETLoader", inputs: { unet_name: name, weight_dtype: "default" } };
}

function resizeToMp(g, key, imageLink, mp) {
  if (!((mp ?? 0) > 0)) return imageLink;
  g[key] = { class_type: "ImageScaleToTotalPixels", inputs: { image: imageLink, upscale_method: "lanczos", megapixels: mp, resolution_steps: 1 } };
  return [key, 0];
}

function buildModelChain(g, state, avail) {
  const unet = requireModels(state);
  g[N.unet] = unetNode(unet);
  let m = [N.unet, 0];

  // Attention backend (single-select).
  if (state.attnBackend === "ck" && has(avail, "ModelAttentionBackend")) {
    g[N.ckAttn] = { class_type: "ModelAttentionBackend", inputs: { model: m, attention: state.ckAttentionBackend === "pytorch" ? "pytorch attention" : "comfy kitchen attention" } };
    m = [N.ckAttn, 0];
  } else if (state.attnBackend === "sage" && has(avail, "PathchSageAttentionKJ")) {
    g[N.sage] = { class_type: "PathchSageAttentionKJ", inputs: { model: m, sage_attention: state.sageAttnMode || "auto" } };
    m = [N.sage, 0];
  } else if (state.attnBackend === "solattn_kijai" && has(avail, "SolAttnPatch")) {
    g[N.sol] = { class_type: "SolAttnPatch", inputs: { model: m, tau: state.solTau ?? 1.3, start_percent: state.solStart ?? 0.2, end_percent: state.solEnd ?? 0.9, min_tokens: state.solMinTokens ?? 4096, int8_qk: true, sink_conditioning: "exact_kv_and_rows", morton: false, morton_curve: "2d_frame", int8_pv: true, verbose: false, use_tma: false, dense_blocks: "" } };
    m = [N.sol, 0];
  }

  // H3 attention forward patch (L5).
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
      m = [N.solSched, 0];
    }
  }

  if (state.useTorchPatch && has(avail, "ModelPatchTorchSettings")) {
    g[N.torch] = { class_type: "ModelPatchTorchSettings", inputs: { model: m, enable_fp16_accumulation: state.fp16Accum !== false } };
    m = [N.torch, 0];
  }

  if (state.useFusedModulation && has(avail, "MiniMaxH3FusedModulation")) {
    g[N.fusedMod] = { class_type: "MiniMaxH3FusedModulation", inputs: { model: m, enabled: true } };
    m = [N.fusedMod, 0];
  }

  const pddShiftForced = turboEffective(state, avail) === "pdd";
  g[N.shift] = { class_type: "MiniMaxH3SigmaShift", inputs: { model: m, shift_video: pddShiftForced ? 12 : state.shiftVideo ?? 12, shift_audio: pddShiftForced ? 3 : state.shiftAudio ?? 3 } };
  m = [N.shift, 0];

  (state.loras || []).forEach((lora, i) => {
    if (!lora?.name || lora.name === "none" || lora.enabled === false) return;
    const strength = parseFloat(String(lora.strength ?? 1.0));
    if (!(strength > 0)) return;
    const id = `MM:lora${i}`;
    g[id] = { class_type: "LoraLoaderModelOnly", inputs: { model: m, lora_name: lora.name, strength_model: strength } };
    m = [id, 0];
  });

  // Block cache (L2/L3).
  if (!blockCacheBlockedReason(state, state.blockCache)) {
    if (state.blockCache === "h3cache" && has(avail, "MiniMaxH3Cache")) {
      g[N.cache] = { class_type: "MiniMaxH3Cache", inputs: { model: m, resuse_threshold: state.cacheThreshold ?? 0.3, start_percent: state.cacheStart ?? 0.15, end_percent: state.cacheEnd ?? 0.9, max_steps: state.cacheMaxSteps ?? 2, device: "auto", verbose: false } };
      m = [N.cache, 0];
    } else if (state.blockCache === "fbcache" && has(avail, "ApplyMiniMaxH3FirstBlockCache")) {
      g[N.fbcache] = { class_type: "ApplyMiniMaxH3FirstBlockCache", inputs: { model: m, mode: state.fbcMode || "H3 Fast — 0.10 / max 2", threshold: state.fbcThreshold ?? 0.1, start_percent: state.fbcStartPercent ?? 0.1, end_percent: state.fbcEndPercent ?? 0.95, max_consecutive_hits: state.fbcMaxConsecutiveHits ?? 2, temporal_guard: !!state.fbcTemporalGuard } };
      m = [N.fbcache, 0];
    }
  }

  // H3-Optimizations (Zironic) — after the caches, inside Spectrum's wrapper.
  const h3opt = state.h3Optimizer || "none";
  if ((h3opt === "memory" || h3opt === "memory_sparse") && has(avail, "H3MemoryOptimization")) {
    g[N.h3mem] = { class_type: "H3MemoryOptimization", inputs: { model: m, fused_qkv: "auto", preserve_precision: true, embedding_memory_mode: "Auto", mlp_memory: "auto", chunk_rows: Math.round(state.h3MemChunkRows ?? 4096), precision_mode: state.h3MemPrecision || "Auto", qkv_streaming_mode: state.h3MemQkvStreaming || "Auto", kitchen_v_memory_mode: state.h3MemLowVram ? "Lower VRAM (slower)" : "Standard" } };
    m = [N.h3mem, 0];
  }
  if (h3opt === "memory_sparse" && !h3OptimizerBlockedReason(state, "memory_sparse") && has(avail, "H3SparseAttention")) {
    g[N.h3sparse] = { class_type: "H3SparseAttention", inputs: { model: m, video_budget: state.h3SparseBudget ?? 0.15, denser_early_late_steps: state.h3SparseDenserEdges !== false, layer_video_budgets: state.h3SparseLayerBudgets || "" } };
    m = [N.h3sparse, 0];
  }

  // Turbo weights (L8).
  const turboWeights = turboEffective(state, avail);
  if (turboWeights === "larryvrh" && has(avail, "MiniMaxH3TurboLoRA")) {
    g[N.turbo] = { class_type: "MiniMaxH3TurboLoRA", inputs: { model: m, lora_name: turboLoraForMode(state), strength: state.turboLoraStrength ?? 1.0, low_vram: !!state.turboLoraLowVram } };
    m = [N.turbo, 0];
  } else if (turboWeights === "pdd" && has(avail, "MiniMaxH3PDDAccApply")) {
    g[N.pdd] = { class_type: "MiniMaxH3PDDAccApply", inputs: { model: m, pdd_file: pddFileForMode(state), nfe: String(state.pddNfe ?? "8"), lora_strength: state.pddLoraStrength ?? 1.0, head_strength: state.pddHeadStrength ?? 1.0, on_off_grid: "error" } };
    m = [N.pdd, 0];
  }

  // Spectrum (L1).
  if (state.useSpectrum && has(avail, "SpectrumApplyMiniMaxH3")) {
    g[N.spectrum] = { class_type: "SpectrumApplyMiniMaxH3", inputs: { model: m, enabled: true, blend_weight: state.specBlendWeight ?? 0.5, degree: Math.round(state.specDegree ?? 1), ridge_lambda: state.specRidgeLambda ?? 0.1, window_size: state.specWindowSize ?? 2.0, flex_window: state.specFlexWindow ?? 0.75, warmup_steps: Math.round(state.specWarmupSteps ?? 1), tail_actual_steps: Math.round(state.specTailSteps ?? 1), max_history: Math.round(state.specMaxHistory ?? 8), debug: false, history_storage: state.specHistoryStore || "system_ram", bootstrap_first_forecast: true } };
    m = [N.spectrum, 0];
  }

  return m;
}

function applySla(g, state, avail, modelLink) {
  if (state.attnBackend !== "sla" || !has(avail, "H3SLAAttention")) return modelLink;
  g[N.sla] = { class_type: "H3SLAAttention", inputs: { model: modelLink, sparsity_ratio: state.slaSparsity ?? 0.9, block_size: state.slaBlockSize || "64", min_seq_len: state.slaMinSeqLen ?? 8192, dense_last_steps: state.slaDenseLastSteps ?? 0, protect_audio: state.slaProtectAudio !== false, enabled: state.slaRunEnabled !== false } };
  return [N.sla, 0];
}

function buildConditioning(g, state, promptText, width, height, frames, opts, avail) {
  const mode = state.generationMode || "t2v";
  const { firstFrame, lastFrame, refImages } = opts || {};

  if (mode === "reference") {
    const inputs = { clip: [N.clip, 0], vae: [N.vaeV, 0], audio_vae: [N.vaeA, 0], prompt: promptText, width, height, length: frames, ref_image_size: state.refImageSize || "match" };
    (refImages || []).slice(0, 9).forEach((name, i) => {
      if (!name) return;
      g[N.ref(i)] = { class_type: "LoadImage", inputs: { image: name } };
      inputs[`ref_images.ref_image_${i}`] = resizeToMp(g, N.refResize(i), [N.ref(i), 0], (state.refImagesMp || [])[i]);
    });
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
    (state.refAudios || []).slice(0, 3).forEach((a, i) => {
      if (!a || !a.file) return;
      g[N.refAud(i)] = { class_type: "LoadAudio", inputs: { audio: a.file } };
      let link = [N.refAud(i), 0];
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

  const inputs = { clip: [N.clip, 0], vae: [N.vaeV, 0], prompt: promptText, width, height, length: frames };
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

// Builds an RTXVideoSuperResolution node (+ an optional ImageCrop ahead of it for the "wh"
// size mode's forced crop) and returns the final image link plus a {method,...} descriptor.
function buildRtxNode(g, ids, images, state, srcW, srcH) {
  const t = computeRtxTarget(state, srcW, srcH);
  if (t.crop) {
    g[ids.crop] = { class_type: "ImageCrop", inputs: { image: images, width: t.crop.width, height: t.crop.height, x: t.crop.x, y: t.crop.y } };
    images = [ids.crop, 0];
  }
  g[ids.rtx] = t.resizeType === "scale by multiplier"
    ? { class_type: "RTXVideoSuperResolution", inputs: { images, resize_type: "scale by multiplier", "resize_type.scale": t.scale, quality: state.rtxQuality || "ULTRA" } }
    : { class_type: "RTXVideoSuperResolution", inputs: { images, resize_type: "target dimensions", "resize_type.width": t.width, "resize_type.height": t.height, quality: state.rtxQuality || "ULTRA" } };
  const upscaleUsed = t.resizeType === "scale by multiplier"
    ? { method: "rtx", scale: t.scale, quality: state.rtxQuality || "ULTRA" }
    : { method: "rtx", width: t.width, height: t.height, quality: state.rtxQuality || "ULTRA" };
  return { images: [ids.rtx, 0], upscaleUsed };
}

// FlashVSR VSR (lihaoyun6/ComfyUI-FlashVSR_Ultra_Fast) — the buildClipGraph inline upscale
// mode's third option (alongside "model"/"rtx"). Only the 8 UI-exposed fields; everything
// else is fixed at the shipped API workflow's own values.
function buildFlashVSR(g, pipeId, nodeId, p, images) {
  g[pipeId] = { class_type: "FlashVSRInitPipe", inputs: {
    model: p.model || "FlashVSR-v1.1", mode: p.mode || "tiny", alt_vae: "none",
    force_offload: true, precision: "bf16", device: "cuda:0", attention_mode: "sparse_sage_attention",
  } };
  g[nodeId] = { class_type: "FlashVSRNodeAdv", inputs: {
    pipe: [pipeId, 0], frames: images,
    scale: Math.min(4, Math.max(2, Math.round(p.scale ?? 2))),
    color_fix: p.colorFix !== false, tiled_vae: true, tiled_dit: true,
    tile_size: p.tileSize ?? 384, tile_overlap: p.tileOverlap ?? 32,
    unload_dit: false, sparse_ratio: 2, kv_ratio: 3, local_range: 11, seed: p.seed ?? 42,
  } };
}
function flashvsrUsed(p) {
  return {
    method: "flashvsr", model: p.model || "FlashVSR-v1.1", mode: p.mode || "tiny",
    scale: p.scale ?? 2, colorFix: p.colorFix !== false,
    tileSize: p.tileSize ?? 384, tileOverlap: p.tileOverlap ?? 32, seed: p.seed ?? 42,
  };
}
function flashvsrParamsFromState(state) {
  return {
    model: state.flashvsrModel, mode: state.flashvsrMode, scale: state.flashvsrScale,
    colorFix: state.flashvsrColorFix, tileSize: state.flashvsrTileSize,
    tileOverlap: state.flashvsrTileOverlap, seed: state.flashvsrSeed,
  };
}

// Audio Lock — feeds a user-supplied audio track into the latent alongside the visual
// conditioning so the render's audio track matches it instead of generating its own. Ported
// verbatim from graphBuilder.ts buildAudioLock(). clipIndex offsets which slice of the source
// file this clip locks onto (clip N starts at trimStart + N * clipSeconds).
function buildAudioLock(g, state, avail, clipIndex, frames) {
  if (!state.audioLock) return false;
  if (!has(avail, "TJ_H3_AudioLock")) throw new Error("Audio lock needs the TJ_H3_AudioLock node — install the TJ_NODE pack, or switch the lock off.");
  if (!state.lockAudioFile) throw new Error("Audio lock is on but no audio file is selected — pick one under Lock audio in the left panel.");

  const clipSeconds = framesToSeconds(frames);
  const trimStart = Math.max(0, state.audioLockTrimStart || 0);
  const startSec = trimStart + clipIndex * clipSeconds;

  g[N.lockAud] = { class_type: "LoadAudio", inputs: { audio: state.lockAudioFile } };
  let audioLink = [N.lockAud, 0];

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

// One-Take continuity — chains this clip's latent onto the previous clip's saved checkpoint
// (TJ_H3_LatentContinuation) so the sampler continues one unbroken shot instead of starting a
// fresh one. Ported verbatim from graphBuilder.ts buildOneTake(). clipIndex 0 (or no previous
// checkpoint yet) always renders as a fresh start — there is nothing to continue from.
function buildOneTake(g, state, avail, clipIndex, prevCheckpointName, defaultLatent) {
  if (state.continuityMode !== "onetake") return defaultLatent;
  if (!has(avail, "TJ_H3_LatentContinuation")) throw new Error("One-Take needs the TJ_H3_LatentContinuation node — install/update the TJ_NODE pack, or switch Continuity to something else.");
  if (clipIndex === 0 || !prevCheckpointName) return defaultLatent;
  if (!has(avail, "TJ_H3_LoadLatentCheckpoint")) throw new Error("One-Take needs the TJ_H3_LoadLatentCheckpoint node — install/update the TJ_NODE pack.");

  g[N.chkLoad] = { class_type: "TJ_H3_LoadLatentCheckpoint", inputs: { checkpoint_name: prevCheckpointName, strict: true } };
  g[N.continuation] = {
    class_type: "TJ_H3_LatentContinuation",
    inputs: { overlap_frames: ONE_TAKE_OVERLAP_FRAMES, lock_audio: !!state.oneTakeLockAudio, prev_latent: [N.chkLoad, 0], target_latent: defaultLatent },
  };
  return [N.continuation, 0];
}

// Saves this clip's sampled latent under checkpointName so the NEXT clip's buildOneTake() can
// load it — server-side state keyed by name, nothing downloaded/re-uploaded between clips.
function saveOneTakeCheckpoint(g, state, avail, checkpointName) {
  if (state.continuityMode !== "onetake" || !checkpointName) return;
  if (!has(avail, "TJ_H3_SaveLatentCheckpoint")) return;
  g[N.chkSave] = { class_type: "TJ_H3_SaveLatentCheckpoint", inputs: { latent: [N.sampler, 0], checkpoint_name: checkpointName } };
}

/** Single-clip graph. opts: { nodeId, promptText, seed, firstFrame, lastFrame, refImages,
 *  clipIndex, prevCheckpointName, checkpointName }. One-Take continuity (clipIndex >= 1 with
 *  state.continuityMode === "onetake") chains this clip's latent onto prevCheckpointName's
 *  saved checkpoint, then (if checkpointName is set) saves this clip's own latent under it for
 *  the next clip to chain onto. Single-clip callers simply omit clipIndex/checkpointName/
 *  prevCheckpointName, which is exactly a clipIndex:0, no-continuity run. */
export function buildClipGraph(state, avail, opts) {
  const { nodeId = "1", promptText, seed, firstFrame = null, lastFrame = null, refImages = null, clipIndex = 0, prevCheckpointName = null, checkpointName = null } = opts || {};

  const frames = state.clipFrames || 192;
  const { width, height } = resolveResolution(state.aspect, state.megapixels);
  const folder = (state.saveSubfolder || SUBFOLDER).replace(/\\/g, "/");
  const stem = state.filenamePrefix || "MMH3";
  const g = {};

  const modelLink0 = buildModelChain(g, state, avail);
  g[N.clip] = { class_type: "CLIPLoader", inputs: { clip_name: state.clipName, type: "minimax", device: "default" } };
  g[N.vaeV] = { class_type: "VAELoader", inputs: { vae_name: state.vaeVideo } };
  g[N.vaeA] = { class_type: "VAELoader", inputs: { vae_name: state.vaeAudio } };

  const modelLink = applySla(g, state, avail, modelLink0); // headless: preview always off

  const fullPrompt = String(promptText || "").trim();
  buildConditioning(g, state, fullPrompt, width, height, frames, { firstFrame, lastFrame, refImages: refImages ?? state.refImages }, avail);

  let condLink = [N.cond, 0];
  if (has(avail, "TJ_FreeTextEncoderVRAM")) {
    g[N.freeClipVram] = { class_type: "TJ_FreeTextEncoderVRAM", inputs: { clip: [N.clip, 0], trigger: condLink } };
    condLink = [N.freeClipVram, 0];
  }

  const turboEff = turboEffective(state, avail);
  const useTurboSampler = turboEff === "larryvrh" && has(avail, "MiniMaxH3TurboSampler");
  const steps = effectiveSteps(state, avail);

  g[N.noise] = { class_type: "RandomNoise", inputs: { noise_seed: seed ?? 0 } };
  let samplerUsed;
  if (useTurboSampler) {
    g[N.sampSel] = { class_type: "MiniMaxH3TurboSampler", inputs: {} };
    samplerUsed = "MiniMaxH3TurboSampler";
  } else if (turboEff === "pdd") {
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

  g[N.sampler] = { class_type: "SamplerCustomAdvanced", inputs: { noise: [N.noise, 0], guider: [N.guider, 0], sampler: [N.sampSel, 0], sigmas: turboEff === "pdd" ? [N.pdd, 1] : [N.sched, 0], latent_image: latentImage } };
  saveOneTakeCheckpoint(g, state, avail, checkpointName);

  g[N.decode] = { class_type: "VAEDecode", inputs: { samples: [N.sampler, 0], vae: [N.vaeV, 0] } };
  g[N.decodeA] = { class_type: "VAEDecodeAudio", inputs: { samples: [N.sampler, 0], vae: [N.vaeA, 0] } };

  let images = [N.decode, 0];
  // Inline deblur / upscale — the studio's per-run left-panel controls. Off by default in a
  // headless job (deblurStrength "none", upscaleMode "none"); kept so a preset or job override
  // could still request them.
  if (state.deblurStrength && state.deblurStrength !== "none" && has(avail, "TJ_RTXDeblur")) {
    g[N.deblurR] = { class_type: "TJ_RTXDeblur", inputs: { images, strength: state.deblurStrength } };
    images = [N.deblurR, 0];
  }
  const up = state.upscaleMode || "none";
  if (up === "model" && state.upscaleModel && state.upscaleModel !== "none") {
    g[N.upModel] = { class_type: "UpscaleModelLoader", inputs: { model_name: state.upscaleModel } };
    g[N.upApply] = { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: [N.upModel, 0], image: images } };
    images = [N.upApply, 0];
  } else if (up === "rtx" && has(avail, "RTXVideoSuperResolution")) {
    const r = buildRtxNode(g, { crop: N.rtxCrop, rtx: N.rtx }, images, state, width, height);
    images = r.images;
  } else if (up === "flashvsr" && has(avail, "FlashVSRNodeAdv")) {
    buildFlashVSR(g, N.fvsrPipe, N.fvsr, flashvsrParamsFromState(state), images);
    images = [N.fvsr, 0];
  }

  const clipTag = String(clipIndex + 1).padStart(3, "0");
  const audioOut = lockAudio ? [N.audioLock, 1] : [N.decodeA, 0];
  g[N.video] = { class_type: "CreateVideo", inputs: { images, fps: FPS, audio: audioOut } };
  g[N.save] = { class_type: "SaveVideo", inputs: { video: [N.video, 0], filename_prefix: `${folder}/${stem}_clip${clipTag}`, format: "auto", codec: "auto" } };

  return {
    graph: g,
    meta: { width, height, frames, steps, seed, samplerUsed, videoNode: N.save, turboEffective: turboEff },
  };
}

// Writes the final video-save step: VHS_VideoCombine's nvenc_h264-mp4 format when the pack is
// installed, falling back to CreateVideo -> SaveVideo (ComfyUI core) otherwise. Used by the
// new modes below (Face Refine / Character Sheet video); buildClipGraph above keeps its own
// simpler inline SaveVideo, unchanged.
function saveVideoNode(g, ids, images, audio, fps, filenamePrefix, avail, preview = false) {
  if (has(avail, "VHS_VideoCombine")) {
    g[ids.save] = { class_type: "VHS_VideoCombine", inputs: {
      images, audio, frame_rate: fps, loop_count: 0, filename_prefix: filenamePrefix,
      format: "video/nvenc_h264-mp4", pingpong: false, save_output: !preview,
    } };
  } else {
    g[ids.video] = { class_type: "CreateVideo", inputs: { images, fps, audio } };
    g[ids.save] = { class_type: "SaveVideo", inputs: { video: [ids.video, 0], filename_prefix: filenamePrefix, format: "auto", codec: "auto" } };
  }
}

// Up to 3 user LoRA slots shared by Image Generator + Character Sheet (state.imgLoras) —
// its own list, never the main render's state.loras.
function buildImageLoraChain(g, state, modelLink) {
  const loras = Array.isArray(state.imgLoras) ? state.imgLoras : [];
  let link = modelLink;
  loras.slice(0, 3).forEach((l, i) => {
    if (!l || l.enabled === false || !l.name || l.name === "none") return;
    g[`IMG:lora_${i}`] = { class_type: "LoraLoaderModelOnly", inputs: { lora_name: l.name, strength_model: l.strength ?? 1.0, model: link } };
    link = [`IMG:lora_${i}`, 0];
  });
  return link;
}

/** Resolve a saved preset id ("s:<numeric id>" for a BUILTIN_PRESETS row, "u:<name>" for a
 * user preset) the same way the web view's own preset dropdown names them. */
function findPresetById(id, userPresets) {
  if (!id) return null;
  if (id.startsWith("u:")) {
    const name = id.slice(2);
    return (userPresets || []).find((p) => p.name === name) || null;
  }
  if (id.startsWith("s:")) {
    const num = Number(id.slice(2));
    return BUILTIN_PRESETS.find((p) => p.id === num) || null;
  }
  return null;
}

// ── H3 Face Refine (generationMode "facerefine") ────────────────────────────────────────────
// Post-process an existing clip: detect/track a face, crop it to fill a canvas, re-render just
// that crop through H3 as img2img (H3InjectVideoLatent), then stitch the refined crop back over
// the original frames. Ported node-for-node from graphBuilder.ts buildFaceRefineGraph. Headless
// drops only the live sampling preview (ModelPreviewOverrideKJ) — UI-only, out of scope.
const FR = {
  load: "FR:load", select: "FR:select", track: "FR:track", inject: "FR:inject",
  denoise: "FR:denoise", stitch: "FR:stitch", video: "FR:video", save: "FR:save",
  lora: (i) => `FR:lora${i}`,
};

/**
 * opts: { nodeId, sourceFile, promptText, seed, refImages, confirmedPickOverride, userPresets }
 */
export function buildFaceRefineGraph(state, avail, opts) {
  const { sourceFile, promptText, seed, refImages, confirmedPickOverride, userPresets } = opts || {};
  if (!sourceFile) throw new Error("Face Refine: pick a source clip (already uploaded to ComfyUI's input/).");
  if (!state.faceDetector || state.faceDetector === "none")
    throw new Error("Face Refine: set a face detector (job.faceDetector / config faceDetector).");
  const isManual = state.frSelect === "manual";
  const confirmedPick = confirmedPickOverride ?? state.frConfirmedPick;
  if (isManual && !String(confirmedPick || "").trim())
    throw new Error("Face Refine: frSelect is 'manual' but no frConfirmedPick was given.");

  const g = {};
  const folder = (state.saveSubfolder || SUBFOLDER).replace(/\\/g, "/");
  const stem = state.filenamePrefix || "MMH3";
  const cutMode = state.frCutDetection ? "auto (pyscenedetect)" : "none";

  let imagesLink, audioLink, facePickLink = null;
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

  const trackInputs = {
    images: imagesLink, detector: state.faceDetector, confidence: state.frConfidence ?? 0.35,
    crop_factor: state.frCropFactor ?? 2.5,
    canvas_width: state.frCanvasWidth ?? 768, canvas_height: state.frCanvasHeight ?? 768,
    canvas_mode: state.frCanvasMode || "auto_capped_768",
    smooth_window: state.frSmoothWindow ?? 21, size_smooth_window: 51,
    smooth_method: "gaussian", size_mode: "per_frame",
    identity_track: state.frIdentityTrack !== false,
    identity_threshold: state.frIdentityThreshold ?? 0.45,
    fallback_detector: state.faceFallbackDetector || "none",
  };
  if (facePickLink) {
    trackInputs.face_pick = facePickLink;
  } else {
    trackInputs.select = state.frSelect || "largest_face";
    trackInputs.cut_detection = cutMode;
    trackInputs.cut_threshold = state.frCutThreshold ?? 3.0;
  }
  if (state.frIdentityModel) trackInputs.identity_model = state.frIdentityModel;
  g[FR.track] = { class_type: "H3FaceTrackCrop", inputs: trackInputs };
  const canvasW = [FR.track, 4], canvasH = [FR.track, 5], frameCount = [FR.track, 6];
  const cropsLink = [FR.track, 0], transformLink = [FR.track, 1];

  const useCustomModel = !!state.frUseCustomModel;
  const unetFile = useCustomModel ? state.frUnet : state.unetReference;
  const clipFile = useCustomModel ? state.frClip : state.clipName;
  if (useCustomModel && (!unetFile || unetFile === "none"))
    throw new Error("Face Refine: set frUnet (or turn off frUseCustomModel).");
  if (useCustomModel && (!clipFile || clipFile === "none"))
    throw new Error("Face Refine: set frClip (or turn off frUseCustomModel).");
  const refState = { ...state, generationMode: "reference", unetReference: unetFile };
  if (state.frTurboOn) {
    const preset = findPresetById(state.frTurboPreset, userPresets)
      || (userPresets || []).find((p) => p.turbo && p.turbo !== "none")
      || BUILTIN_PRESETS.find((p) => p.turbo && p.turbo !== "none")
      || null;
    if (preset) {
      applyPreset(refState, preset);
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

  let modelLoraLink = modelLink0;
  (state.frLoras || []).forEach((lora, i) => {
    if (!lora?.name || lora.name === "none" || lora.enabled === false) return;
    const s = parseFloat(String(lora.strength ?? 1.0));
    if (!(s > 0)) return;
    g[FR.lora(i)] = { class_type: "LoraLoaderModelOnly", inputs: { model: modelLoraLink, lora_name: lora.name, strength_model: s } };
    modelLoraLink = [FR.lora(i), 0];
  });

  // Headless: no live preview node (ModelPreviewOverrideKJ) — UI-only.
  const modelLink = applySla(g, refState, avail, modelLoraLink);

  buildConditioning(g, refState, String(promptText || "").trim(), canvasW, canvasH, frameCount,
    { refImages: refImages ?? state.refImages }, avail);

  g[FR.inject] = { class_type: "H3InjectVideoLatent", inputs: { av_latent: [N.cond, 1], images: cropsLink, vae: [N.vaeV, 0] } };

  g[N.audioLock] = { class_type: "TJ_H3_AudioLock", inputs: {
    av_latent: [FR.inject, 0], audio: audioLink, audio_vae: [N.vaeA, 0],
    mode: "lock", strength: 0.5, fit: "pad_silence",
    get_name_av_latent: "(none)", get_name_audio: "(none)", get_name_audio_vae: "(none)", auto_set: false,
  } };

  g[FR.denoise] = { class_type: "H3PerFrameDenoise", inputs: {
    model: modelLink, av_latent: [N.audioLock, 0], transform: transformLink,
    denoise_multiplier_small_face: state.frDenoiseMulSmall ?? 1.0,
    denoise_multiplier_large_face: state.frDenoiseMulLarge ?? 0.35,
    scale_mode: "absolute_px",
    face_px_small: state.frFacePxSmall ?? 30.0, face_px_large: state.frFacePxLarge ?? 120.0,
    gamma: 1.0, smooth_frames: 9,
  } };
  const denoisedModel = [FR.denoise, 2];

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
  g[N.sched] = { class_type: "BasicScheduler", inputs: { model: denoisedModel, scheduler: state.frScheduler || "simple", steps, denoise: state.frDenoise ?? 0.40 } };
  let condLink = [N.cond, 0];
  if (has(avail, "TJ_FreeTextEncoderVRAM")) {
    g[N.freeClipVram] = { class_type: "TJ_FreeTextEncoderVRAM", inputs: { clip: [N.clip, 0], trigger: condLink } };
    condLink = [N.freeClipVram, 0];
  }
  g[N.guider] = { class_type: "BasicGuider", inputs: { model: denoisedModel, conditioning: condLink } };
  g[N.sampler] = { class_type: "SamplerCustomAdvanced", inputs: {
    noise: [N.noise, 0], guider: [N.guider, 0], sampler: [N.sampSel, 0], sigmas: [N.sched, 0], latent_image: [FR.denoise, 0],
  } };
  g[N.decode] = { class_type: "VAEDecode", inputs: { samples: [N.sampler, 0], vae: [N.vaeV, 0] } };

  g[FR.stitch] = { class_type: "H3FaceStitch", inputs: {
    base_images: imagesLink, refined_crops: [N.decode, 0], transform: transformLink,
    paste_region: state.frPasteRegion || "face_only",
    mask_dilation: 16, feather: state.frFeather ?? 6,
    colour_match: state.frColourMatch ?? 1.0, blend: state.frBlend ?? 1.0,
    undetected_frames: state.frUndetected || "fade_out",
  } };

  saveVideoNode(g, { video: FR.video, save: FR.save }, [FR.stitch, 0], [N.audioLock, 1], FPS, `${folder}/${stem}_FACEREFINE`, avail);

  return {
    graph: g,
    meta: { faceRefine: true, source: sourceFile, select: state.frSelect, denoise: state.frDenoise ?? 0.40, steps, turboMode, seed: useSeed, videoNode: FR.save, lastFrameNode: null },
  };
}

// ── Image Generator (generationMode "imagegen", subMode "t2i" | "ref2i") ───────────────────
// Same H3 video pipeline run at a short fixed length (8 frames), read back as a single still.
// A cheap first pass at preview resolution; final:true adds a second latent-upscale pass up to
// finalRes. Ported node-for-node from graphBuilder.ts buildImageGenGraph.
const IMG = {
  unet: "IMG:unet", sage: "IMG:sage", memSage: "IMG:mem_sage", turboLora: "IMG:turbo_lora",
  clip: "IMG:clip", vaeV: "IMG:vae_video", ref: (i) => `IMG:ref_image_${i}`, cond: "IMG:cond",
  noise: "IMG:noise", sampSel1: "IMG:sampler_sel1", sched: "IMG:scheduler",
  guider1: "IMG:guider1", sampler1: "IMG:sampler1",
  sepAV: "IMG:sep_av", latentUp: "IMG:latent_up", concatAV: "IMG:concat_av",
  sampSel2: "IMG:sampler_sel2", guider2: "IMG:guider2", sigmas2: "IMG:sigmas2", sampler2: "IMG:sampler2",
  decode: "IMG:decode", frame: "IMG:frame", save: "IMG:save",
};
const IMG_PASS2_SIGMAS = "0.9035, 0.6316, 0.3158, 0.0000";
const IMG_LENGTH = 8;

/**
 * opts: { subMode, final, refImages, refImageSize, prompt, seed, previewRes, finalRes,
 *         filenamePrefix, steps, turboOn, turboLora, turboLoraStrength, savePreview }
 */
export function buildImageGenGraph(state, avail, opts) {
  const { subMode, final, refImages, refImageSize, prompt, seed, previewRes, finalRes, filenamePrefix,
    steps, turboOn, turboLora, turboLoraStrength, savePreview } = opts || {};
  const refList = (refImages || []).filter(Boolean).slice(0, 9);
  if (subMode === "ref2i" && !refList.length) throw new Error("Reference to Image needs at least one reference image.");
  const g = {};

  const unetName = subMode === "ref2i" ? state.unetReference : state.unetFirstLast;
  if (!unetName || unetName === "none") throw new Error(`${subMode === "ref2i" ? "Reference" : "First/Last"} UNET is not set.`);
  g[IMG.unet] = { class_type: "UNETLoader", inputs: { unet_name: unetName, weight_dtype: "default" } };
  let model = [IMG.unet, 0];

  if (has(avail, "PathchSageAttentionKJ")) {
    g[IMG.sage] = { class_type: "PathchSageAttentionKJ", inputs: { sage_attention: "auto", allow_compile: true, model } };
    model = [IMG.sage, 0];
  }
  if (has(avail, "MiniMaxH3MemoryEfficientSageAttentionPatch")) {
    g[IMG.memSage] = { class_type: "MiniMaxH3MemoryEfficientSageAttentionPatch", inputs: { model } };
    model = [IMG.memSage, 0];
  }
  model = buildImageLoraChain(g, state, model);

  if (turboOn && turboLora && turboLora !== "none") {
    g[IMG.turboLora] = { class_type: "LoraLoaderModelOnly", inputs: { model, lora_name: turboLora, strength_model: turboLoraStrength ?? 1.0 } };
    model = [IMG.turboLora, 0];
  }

  g[IMG.clip] = { class_type: "CLIPLoader", inputs: { clip_name: state.clipName, type: "minimax", device: "default" } };
  g[IMG.vaeV] = { class_type: "VAELoader", inputs: { vae_name: state.vaeVideo } };

  const condInputs = { clip: [IMG.clip, 0], vae: [IMG.vaeV, 0], prompt, width: previewRes.width, height: previewRes.height, length: IMG_LENGTH };
  if (subMode === "ref2i") {
    condInputs.ref_image_size = refImageSize || "max";
    refList.forEach((name, i) => {
      g[IMG.ref(i)] = { class_type: "LoadImage", inputs: { image: name } };
      condInputs[`ref_images.ref_image_${i}`] = [IMG.ref(i), 0];
    });
    g[IMG.cond] = { class_type: "MiniMaxH3ReferenceToVideo", inputs: condInputs };
  } else {
    g[IMG.cond] = { class_type: "MiniMaxH3ImageToVideo", inputs: condInputs };
  }

  const stepCount = Math.max(1, Math.round(steps ?? 8));
  g[IMG.noise] = { class_type: "RandomNoise", inputs: { noise_seed: seed ?? 0 } };
  g[IMG.sampSel1] = { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } };
  g[IMG.sched] = { class_type: "BasicScheduler", inputs: { scheduler: "simple", steps: stepCount, denoise: 1, model } };
  g[IMG.guider1] = { class_type: "BasicGuider", inputs: { model, conditioning: [IMG.cond, 0] } };
  g[IMG.sampler1] = { class_type: "SamplerCustomAdvanced", inputs: {
    noise: [IMG.noise, 0], guider: [IMG.guider1, 0], sampler: [IMG.sampSel1, 0], sigmas: [IMG.sched, 0], latent_image: [IMG.cond, 1],
  } };

  let decodeSamples;
  if (!final) {
    decodeSamples = [IMG.sampler1, 0];
  } else {
    if (!has(avail, "MinimaxH3LatentUpscaler3D")) throw new Error("MinimaxH3LatentUpscaler3D is not installed.");
    g[IMG.sepAV] = { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: [IMG.sampler1, 1] } };
    g[IMG.latentUp] = { class_type: "MinimaxH3LatentUpscaler3D", inputs: {
      model_name: "minimax_h3_latent_upscaler_3d_bf16.safetensors",
      mode: "target dimensions", "mode.width": finalRes.width, "mode.height": finalRes.height,
      align: 32, enable_temporal_chunking: true, force_unload: true, device: "cuda", precision: "fp16",
      latent: [IMG.sepAV, 0],
    } };
    g[IMG.concatAV] = { class_type: "LTXVConcatAVLatent", inputs: { video_latent: [IMG.latentUp, 0], audio_latent: [IMG.sepAV, 1] } };
    g[IMG.sampSel2] = { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } };
    g[IMG.guider2] = { class_type: "BasicGuider", inputs: { model, conditioning: [IMG.cond, 0] } };
    g[IMG.sigmas2] = turboOn
      ? { class_type: "ManualSigmas", inputs: { sigmas: IMG_PASS2_SIGMAS } }
      : { class_type: "BasicScheduler", inputs: { scheduler: "simple", steps: stepCount, denoise: 1, model } };
    g[IMG.sampler2] = { class_type: "SamplerCustomAdvanced", inputs: {
      noise: [IMG.noise, 0], guider: [IMG.guider2, 0], sampler: [IMG.sampSel2, 0], sigmas: [IMG.sigmas2, 0], latent_image: [IMG.concatAV, 0],
    } };
    decodeSamples = [IMG.sampler2, 0];
  }

  g[IMG.decode] = { class_type: "VAEDecode", inputs: { samples: decodeSamples, vae: [IMG.vaeV, 0] } };
  g[IMG.frame] = { class_type: "ImageFromBatch", inputs: { batch_index: IMG_LENGTH, length: 1, image: [IMG.decode, 0] } };
  g[IMG.save] = (final || savePreview)
    ? { class_type: "SaveImage", inputs: { filename_prefix: filenamePrefix, images: [IMG.frame, 0] } }
    : { class_type: "PreviewImage", inputs: { images: [IMG.frame, 0] } };

  return { graph: g, saveNode: IMG.save };
}

// ── Character Sheet (imageGenMode "charsheet") — two separate graphs ───────────────────────
// Stage 1 (buildCharacterSheetVideoGraph): the expensive H3 render — ref2va 124-frame
// turnaround, saved as a plain video (no audio). Stage 2 (buildCharacterSheetGridGraph): the
// cheap grid-assembly graph against the already-saved video — the caller re-runs only this one
// to pick different frames. Ported node-for-node from graphBuilder.ts.
const CS = {
  unet: "CS:unet", sage: "CS:sage", memSage: "CS:mem_sage", shift: "CS:shift",
  clip: "CS:clip", vaeV: "CS:vae_video", ref: (i) => `CS:ref_image_${i}`, cond: "CS:cond",
  noise: "CS:noise", sampSel: "CS:sampler_sel", sched: "CS:scheduler", guider: "CS:guider", sampler: "CS:sampler",
  sepAV: "CS:sep_av", latentUp: "CS:latent_up", concatAV: "CS:concat_av",
  sampSel2: "CS:sampler_sel2", guider2: "CS:guider2", sigmas2: "CS:sigmas2", sampler2: "CS:sampler2",
  decode: "CS:decode", deblur: "CS:deblur", rtxCrop: "CS:rtx_crop", rtx: "CS:rtx", rtxDown: "CS:rtx_downsize",
  video: "CS:video", save: "CS:save",
};
const CS_PASS2_SIGMAS = "0.9035, 0.6316, 0.3158, 0.0000";

/**
 * opts: { refImages, refImageSize, prompt, deblur, rtx, rtxSupersample, useLatentUpscale,
 *         firstPassRes, width, height, seed, filenamePrefix }
 */
export function buildCharacterSheetVideoGraph(state, avail, opts) {
  const { refImages, refImageSize, prompt, deblur = "none", rtx = null, rtxSupersample = false,
    useLatentUpscale = false, firstPassRes, width, height, seed, filenamePrefix } = opts || {};
  const refList = (refImages || []).filter(Boolean).slice(0, 9);
  if (!refList.length) throw new Error("Character Sheet needs at least one reference image.");
  if (!state.unetReference || state.unetReference === "none") throw new Error("Reference UNET is not set.");
  const g = {};

  g[CS.unet] = { class_type: "UNETLoader", inputs: { unet_name: state.unetReference, weight_dtype: "default" } };
  let model = [CS.unet, 0];
  if (has(avail, "PathchSageAttentionKJ")) {
    g[CS.sage] = { class_type: "PathchSageAttentionKJ", inputs: { sage_attention: "auto", allow_compile: false, model } };
    model = [CS.sage, 0];
  }
  if (has(avail, "MiniMaxH3MemoryEfficientSageAttentionPatch")) {
    g[CS.memSage] = { class_type: "MiniMaxH3MemoryEfficientSageAttentionPatch", inputs: { model } };
    model = [CS.memSage, 0];
  }
  model = buildImageLoraChain(g, state, model);
  g[CS.shift] = { class_type: "MiniMaxH3SigmaShift", inputs: { model, shift_video: 12, shift_audio: 3 } };
  model = [CS.shift, 0];

  g[CS.clip] = { class_type: "CLIPLoader", inputs: { clip_name: state.clipName, type: "minimax", device: "default" } };
  g[CS.vaeV] = { class_type: "VAELoader", inputs: { vae_name: state.vaeVideo } };

  const passRes = useLatentUpscale && firstPassRes ? firstPassRes : { width, height };
  const condInputs = { clip: [CS.clip, 0], vae: [CS.vaeV, 0], prompt, width: passRes.width, height: passRes.height, length: CHARSHEET_FRAMES, ref_image_size: refImageSize || "max" };
  refList.forEach((name, i) => {
    g[CS.ref(i)] = { class_type: "LoadImage", inputs: { image: name } };
    condInputs[`ref_images.ref_image_${i}`] = [CS.ref(i), 0];
  });
  g[CS.cond] = { class_type: "MiniMaxH3ReferenceToVideo", inputs: condInputs };

  g[CS.noise] = { class_type: "RandomNoise", inputs: { noise_seed: seed ?? 0 } };
  g[CS.sampSel] = { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } };
  g[CS.sched] = { class_type: "BasicScheduler", inputs: { scheduler: "simple", steps: 8, denoise: 1, model } };
  g[CS.guider] = { class_type: "BasicGuider", inputs: { model, conditioning: [CS.cond, 0] } };
  g[CS.sampler] = { class_type: "SamplerCustomAdvanced", inputs: {
    noise: [CS.noise, 0], guider: [CS.guider, 0], sampler: [CS.sampSel, 0], sigmas: [CS.sched, 0], latent_image: [CS.cond, 1],
  } };

  let decodeSamples = [CS.sampler, 0];
  if (useLatentUpscale) {
    if (!has(avail, "MinimaxH3LatentUpscaler3D")) throw new Error("MinimaxH3LatentUpscaler3D is not installed.");
    g[CS.sepAV] = { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: [CS.sampler, 1] } };
    g[CS.latentUp] = { class_type: "MinimaxH3LatentUpscaler3D", inputs: {
      model_name: "minimax_h3_latent_upscaler_3d_bf16.safetensors",
      mode: "target dimensions", "mode.width": width, "mode.height": height,
      align: 32, enable_temporal_chunking: true, force_unload: true, device: "cuda", precision: "fp16",
      latent: [CS.sepAV, 0],
    } };
    g[CS.concatAV] = { class_type: "LTXVConcatAVLatent", inputs: { video_latent: [CS.latentUp, 0], audio_latent: [CS.sepAV, 1] } };
    g[CS.sampSel2] = { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } };
    g[CS.guider2] = { class_type: "BasicGuider", inputs: { model, conditioning: [CS.cond, 0] } };
    g[CS.sigmas2] = { class_type: "ManualSigmas", inputs: { sigmas: CS_PASS2_SIGMAS } };
    g[CS.sampler2] = { class_type: "SamplerCustomAdvanced", inputs: {
      noise: [CS.noise, 0], guider: [CS.guider2, 0], sampler: [CS.sampSel2, 0], sigmas: [CS.sigmas2, 0], latent_image: [CS.concatAV, 0],
    } };
    decodeSamples = [CS.sampler2, 0];
  }
  g[CS.decode] = { class_type: "VAEDecode", inputs: { samples: decodeSamples, vae: [CS.vaeV, 0] } };
  let images = [CS.decode, 0];

  if (deblur && deblur !== "none") {
    if (!has(avail, "TJ_RTXDeblur")) throw new Error("RTX Deblur (TJ_RTXDeblur) is not installed.");
    g[CS.deblur] = { class_type: "TJ_RTXDeblur", inputs: { images, strength: deblur } };
    images = [CS.deblur, 0];
  }
  if (rtx) {
    if (!has(avail, "RTXVideoSuperResolution")) throw new Error("RTXVideoSuperResolution is not installed.");
    const rtxState = { rtxSizeMode: "scale", rtxScale: rtx.rtxScale ?? 2.0, rtxQuality: rtx.rtxQuality || "ULTRA", rtxShort: 0, rtxLong: 0, rtxW: 0, rtxH: 0, rtxCropAnchor: "center" };
    const r = buildRtxNode(g, { crop: CS.rtxCrop, rtx: CS.rtx }, images, rtxState, width, height);
    images = r.images;
    if (rtxSupersample) {
      g[CS.rtxDown] = { class_type: "ImageScale", inputs: { image: images, upscale_method: "lanczos", width, height, crop: "center" } };
      images = [CS.rtxDown, 0];
    }
  }

  if (has(avail, "VHS_VideoCombine")) {
    g[CS.save] = { class_type: "VHS_VideoCombine", inputs: { images, frame_rate: FPS, loop_count: 0, filename_prefix: filenamePrefix, format: "video/nvenc_h264-mp4", pingpong: false, save_output: true } };
  } else {
    g[CS.video] = { class_type: "CreateVideo", inputs: { images, fps: FPS } };
    g[CS.save] = { class_type: "SaveVideo", inputs: { video: [CS.video, 0], filename_prefix: filenamePrefix, format: "auto", codec: "auto" } };
  }
  return { graph: g, saveNode: CS.save };
}

const CSG = {
  load: "CSG:load", ref: "CSG:ref", refResize: "CSG:ref_resize",
  frame: (i) => `CSG:frame_${i}`, frameSave: (i) => `CSG:frame_save_${i}`,
  batch: "CSG:batch", grid: "CSG:grid", scaleMax: "CSG:scale_max", save: "CSG:save",
};

/**
 * opts: { videoFile, refImage, frameIndices, cellWidth, cellHeight, maxDimension,
 *         saveEachFrames, framesFilenamePrefix, filenamePrefix }
 */
export function buildCharacterSheetGridGraph(opts, avail) {
  const { videoFile, refImage, frameIndices, cellWidth, cellHeight, maxDimension = 2048,
    saveEachFrames = false, framesFilenamePrefix, filenamePrefix } = opts || {};
  const indices = (frameIndices && frameIndices.length ? frameIndices : CHARSHEET_DEFAULT_FRAME_INDICES).slice(0, 8);
  for (const n of ["BatchImagesNode", "ImageGrid", "ImageScaleToMaxDimension"]) {
    if (!has(avail, n)) throw new Error(`${n} is not installed.`);
  }
  const g = {};

  g[CSG.load] = { class_type: "VHS_LoadVideo", inputs: { video: videoFile, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1 } };
  g[CSG.ref] = { class_type: "LoadImage", inputs: { image: refImage } };
  g[CSG.refResize] = { class_type: "ImageScale", inputs: { image: [CSG.ref, 0], upscale_method: "lanczos", width: cellWidth, height: cellHeight, crop: "center" } };

  const batchInputs = { "images.image0": [CSG.refResize, 0] };
  indices.forEach((idx, i) => {
    g[CSG.frame(i)] = { class_type: "ImageFromBatch", inputs: { batch_index: idx, length: 1, image: [CSG.load, 0] } };
    batchInputs[`images.image${i + 1}`] = [CSG.frame(i), 0];
    if (saveEachFrames) {
      g[CSG.frameSave(i)] = { class_type: "SaveImage", inputs: { filename_prefix: `${framesFilenamePrefix}_shot${i + 1}`, images: [CSG.frame(i), 0] } };
    }
  });
  g[CSG.batch] = { class_type: "BatchImagesNode", inputs: batchInputs };
  g[CSG.grid] = { class_type: "ImageGrid", inputs: { columns: 3, cell_width: cellWidth, cell_height: cellHeight, padding: 8, images: [CSG.batch, 0] } };
  g[CSG.scaleMax] = { class_type: "ImageScaleToMaxDimension", inputs: { upscale_method: "area", largest_size: maxDimension, image: [CSG.grid, 0] } };
  g[CSG.save] = { class_type: "SaveImage", inputs: { filename_prefix: filenamePrefix, images: [CSG.scaleMax, 0] } };
  return { graph: g, saveNode: CSG.save };
}

// ── Still-image upscale (Deblur + RTX VSR only — no FlashVSR path for stills in the source).
// Same shape as the (excluded) video gallery upscaler but LoadImage/SaveImage instead of
// VHS_LoadVideo/VHS_VideoCombine. Ported from graphBuilder.ts buildImageUpscaleGraph.
const IMGPP = { load: "IMGPP:load", deblur: "IMGPP:deblur", rtxCrop: "IMGPP:rtx_crop", rtx: "IMGPP:rtx", save: "IMGPP:save" };

/** opts: { inputFile, deblur, rtx: {rtxScale,rtxQuality,srcW,srcH}, folder, stem, saveSuffix } */
export function buildImageUpscaleGraph(opts, avail) {
  const { inputFile, deblur = "none", rtx = null, folder, stem, saveSuffix = "_post" } = opts || {};
  const g = {};
  g[IMGPP.load] = { class_type: "LoadImage", inputs: { image: inputFile } };
  let image = [IMGPP.load, 0];
  let used = false;

  if (deblur && deblur !== "none") {
    if (!has(avail, "TJ_RTXDeblur")) throw new Error("RTX Deblur (TJ_RTXDeblur) is not installed.");
    g[IMGPP.deblur] = { class_type: "TJ_RTXDeblur", inputs: { images: image, strength: deblur } };
    image = [IMGPP.deblur, 0];
    used = true;
  }
  if (rtx) {
    if (!has(avail, "RTXVideoSuperResolution")) throw new Error("RTXVideoSuperResolution is not installed.");
    const rtxState = { rtxSizeMode: "scale", rtxScale: rtx.rtxScale ?? 2.0, rtxQuality: rtx.rtxQuality || "ULTRA", rtxShort: 0, rtxLong: 0, rtxW: 0, rtxH: 0, rtxCropAnchor: "center" };
    const r = buildRtxNode(g, { crop: IMGPP.rtxCrop, rtx: IMGPP.rtx }, image, rtxState, rtx.srcW || 1024, rtx.srcH || 1024);
    image = r.images;
    used = true;
  }
  if (!used) throw new Error("Nothing to do — set deblur, rtx, or both.");

  g[IMGPP.save] = { class_type: "SaveImage", inputs: { filename_prefix: `${folder}/${stem}${saveSuffix}`, images: image } };
  return { graph: g, saveNode: IMGPP.save };
}

export { ONE_TAKE_OVERLAP_FRAMES };
