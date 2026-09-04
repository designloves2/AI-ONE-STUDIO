// graph.mjs — ported from src/tools/minimax_h3/graphBuilder.ts (buildClipGraph + helpers).
// Types stripped; gallery/upscale/interpolate graphs dropped (out of scope). Single-clip
// only: the headless always calls buildClipGraph with clipIndex 0, no continuity, no
// last-frame save — so buildOneTake / saveOneTakeCheckpoint / buildAudioLock short-circuit.

import {
  SUBFOLDER, FPS, resolveResolution, ONE_TAKE_OVERLAP_FRAMES,
  attnForwardBlockedReason, blockCacheBlockedReason, h3OptimizerBlockedReason,
  PDD_NFE_CHOICES, pddFileForMode,
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
  upModel: "MM:upscale_model", upApply: "MM:upscale", rtx: "MM:rtx", deblurR: "MM:deblur",
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
  if (eff === "pdd") return PDD_NFE_CHOICES.includes(String(state.pddNfe)) ? Number(state.pddNfe) : 8;
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

/** Single-clip graph. opts: { nodeId, promptText, seed, firstFrame, lastFrame, refImages }. */
export function buildClipGraph(state, avail, opts) {
  const { nodeId = "1", promptText, seed, firstFrame = null, lastFrame = null, refImages = null } = opts || {};

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

  const latentImage = [N.cond, 1]; // single clip, no audio-lock, no one-take continuity

  g[N.sampler] = { class_type: "SamplerCustomAdvanced", inputs: { noise: [N.noise, 0], guider: [N.guider, 0], sampler: [N.sampSel, 0], sigmas: turboEff === "pdd" ? [N.pdd, 1] : [N.sched, 0], latent_image: latentImage } };

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
    g[N.rtx] = { class_type: "RTXVideoSuperResolution", inputs: { images, resize_type: "scale by multiplier", "resize_type.scale": state.rtxScale ?? 2.0, quality: state.rtxQuality || "ULTRA" } };
    images = [N.rtx, 0];
  }

  g[N.video] = { class_type: "CreateVideo", inputs: { images, fps: FPS, audio: [N.decodeA, 0] } };
  g[N.save] = { class_type: "SaveVideo", inputs: { video: [N.video, 0], filename_prefix: `${folder}/${stem}_clip001`, format: "auto", codec: "auto" } };

  return {
    graph: g,
    meta: { width, height, frames, steps, seed, samplerUsed, videoNode: N.save, turboEffective: turboEff },
  };
}

export { ONE_TAKE_OVERLAP_FRAMES };
