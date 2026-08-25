// graphBuilder.ts — MiniMax H3 워크플로 그래프 빌더 (원본: web/minimax/graph_builder_minimax.js)
// state를 ComfyUI API 그래프(JSON)로 조립한다. 순수 로직이라 거의 그대로 이식.
import type { MinimaxState, LoraEntry } from "./core";
import { SUBFOLDER, FPS, resolveResolution, framesToSeconds, ONE_TAKE_OVERLAP_FRAMES } from "./core";
import type { NodeAvailability } from "./api";

export { ONE_TAKE_OVERLAP_FRAMES };

const N = {
  unet: "MM:unet",
  clip: "MM:clip",
  vaeV: "MM:vae_video",
  vaeA: "MM:vae_audio",
  sage: "MM:sage",
  memSage: "MM:mem_sage",
  ckAttn: "MM:ck_attn",
  torch: "MM:torch",
  shift: "MM:sigma_shift",
  cache: "MM:cache",
  fbcache: "MM:fbcache",
  sla: "MM:sla_attn",
  sol: "MM:solattn",
  spectrum: "MM:spectrum",
  turbo: "MM:turbo_lora",
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
  video: "MM:video",
  save: "MM:save_video",
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

function effectiveAccel(state: MinimaxState, avail?: Avail): { mode: string; fellBack: boolean; reason?: string } {
  const want = state.accelMode || "turbo";
  if (want !== "turbo") return { mode: want, fellBack: false };
  const name = turboLoraForMode(state);
  if (!name) return { mode: "none", fellBack: true, reason: "No turbo LoRA set — turbo skipped." };
  if (avail && Object.keys(avail).length && !avail.MiniMaxH3TurboLoRA) return { mode: "none", fellBack: true, reason: "comfyui-minimax-h3-turbo is not installed — turbo skipped." };
  return { mode: "turbo", fellBack: false };
}

function turboLoraForMode(state: MinimaxState): string {
  const name = state.turboLora;
  return name && name !== "none" ? name : "";
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

  // SageAttention and CK-Attention are alternative attention backends — the Settings UI
  // enforces only one group being on, so these never stack.
  if (state.useCkAttention && has(avail, "ModelAttentionBackend")) {
    g[N.ckAttn] = { class_type: "ModelAttentionBackend", inputs: { model: m, attention: state.ckAttentionBackend === "pytorch" ? "pytorch attention" : "comfy kitchen attention" } };
    m = [N.ckAttn, 0];
  } else {
    if (state.useSageAttn && has(avail, "PathchSageAttentionKJ")) {
      g[N.sage] = { class_type: "PathchSageAttentionKJ", inputs: { model: m, sage_attention: state.sageAttnMode || "auto" } };
      m = [N.sage, 0];
    }
    if (state.useMemEffSage && has(avail, "MiniMaxH3MemoryEfficientSageAttentionPatch")) {
      g[N.memSage] = { class_type: "MiniMaxH3MemoryEfficientSageAttentionPatch", inputs: { model: m } };
      m = [N.memSage, 0];
    }
  }
  if (state.useTorchPatch && has(avail, "ModelPatchTorchSettings")) {
    g[N.torch] = { class_type: "ModelPatchTorchSettings", inputs: { model: m, enable_fp16_accumulation: state.fp16Accum !== false } };
    m = [N.torch, 0];
  }

  g[N.shift] = { class_type: "MiniMaxH3SigmaShift", inputs: { model: m, shift_video: state.shiftVideo ?? 12, shift_audio: state.shiftAudio ?? 3 } };
  m = [N.shift, 0];

  (state.loras || []).forEach((lora: LoraEntry, i: number) => {
    if (!lora?.name || lora.name === "none" || lora.enabled === false) return;
    const strength = parseFloat(String(lora.strength ?? 1.0));
    if (!(strength > 0)) return;
    const id = `MM:lora${i}`;
    g[id] = { class_type: "LoraLoaderModelOnly", inputs: { model: m, lora_name: lora.name, strength_model: strength } };
    m = [id, 0];
  });

  if (state.useCache && has(avail, "MiniMaxH3Cache")) {
    g[N.cache] = {
      class_type: "MiniMaxH3Cache",
      inputs: { model: m, resuse_threshold: state.cacheThreshold ?? 0.3, start_percent: state.cacheStart ?? 0.15, end_percent: state.cacheEnd ?? 0.9, max_steps: state.cacheMaxSteps ?? 2, device: "auto", verbose: false },
    };
    m = [N.cache, 0];
  }

  // Same reuse-cache idea as MiniMaxH3Cache above, just a different implementation — the UI
  // enforces only one of the two being on at once, so this never stacks with N.cache.
  if (state.useFirstBlockCache && has(avail, "ApplyMiniMaxH3FirstBlockCache")) {
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

  const accel = effectiveAccel(state, avail).mode;
  if (accel === "turbo" && has(avail, "MiniMaxH3TurboLoRA")) {
    g[N.turbo] = { class_type: "MiniMaxH3TurboLoRA", inputs: { model: m, lora_name: turboLoraForMode(state), strength: state.turboLoraStrength ?? 1.0, low_vram: !!state.turboLoraLowVram } };
    m = [N.turbo, 0];
  } else if (accel === "solattn" && has(avail, "SolAttnPatch")) {
    g[N.sol] = {
      class_type: "SolAttnPatch",
      inputs: { model: m, tau: state.solTau ?? 1.3, start_percent: state.solStart ?? 0.2, end_percent: state.solEnd ?? 0.9, min_tokens: state.solMinTokens ?? 4096, int8_qk: true, sink_conditioning: "exact_kv_and_rows", morton: false, morton_curve: "2d_frame", int8_pv: true, verbose: false, use_tma: false, dense_blocks: "" },
    };
    m = [N.sol, 0];
  } else if (accel === "spectrum" && has(avail, "SpectrumApplyMiniMaxH3")) {
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
  if (!state.useSlaAttention || !has(avail, "H3SLAAttention")) return modelLink;
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
  prevCheckpointName?: string | null;
  checkpointName?: string | null;
}

export function buildClipGraph(state: MinimaxState, avail: Avail | undefined, opts: BuildClipOpts) {
  const { nodeId, promptText, seed, firstFrame = null, lastFrame = null, refImages = null, clipIndex = 0, saveLastFrame = true, prevCheckpointName = null, checkpointName = null } = opts;

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

  const accel = effectiveAccel(state, avail).mode;
  const useTurboSampler = accel === "turbo" && has(avail, "MiniMaxH3TurboSampler");
  const steps = useTurboSampler ? state.turboSteps ?? 4 : state.steps ?? 20;

  g[N.noise] = { class_type: "RandomNoise", inputs: { noise_seed: seed ?? 0 } };
  if (useTurboSampler) {
    g[N.sampSel] = { class_type: "MiniMaxH3TurboSampler", inputs: {} };
  } else {
    g[N.sampSel] = { class_type: "KSamplerSelect", inputs: { sampler_name: state.sampler || "er_sde" } };
  }
  g[N.sched] = { class_type: "BasicScheduler", inputs: { model: modelLink, scheduler: state.scheduler || "simple", steps, denoise: state.denoise ?? 1.0 } };
  g[N.guider] = { class_type: "BasicGuider", inputs: { model: modelLink, conditioning: condLink } };

  const lockAudio = buildAudioLock(g, state, avail, clipIndex, frames);
  const preOneTakeLatent = lockAudio ? [N.audioLock, 0] : [N.cond, 1];
  const latentImage = buildOneTake(g, state, avail, clipIndex, prevCheckpointName, preOneTakeLatent);

  g[N.sampler] = { class_type: "SamplerCustomAdvanced", inputs: { noise: [N.noise, 0], guider: [N.guider, 0], sampler: [N.sampSel, 0], sigmas: [N.sched, 0], latent_image: latentImage } };
  saveOneTakeCheckpoint(g, state, avail, checkpointName);

  g[N.decode] = { class_type: "VAEDecode", inputs: { samples: [N.sampler, 0], vae: [N.vaeV, 0] } };
  g[N.decodeA] = { class_type: "VAEDecodeAudio", inputs: { samples: [N.sampler, 0], vae: [N.vaeA, 0] } };

  let images: any = [N.decode, 0];
  const up = state.upscaleMode || "none";
  if (up === "model" && state.upscaleModel && state.upscaleModel !== "none") {
    g[N.upModel] = { class_type: "UpscaleModelLoader", inputs: { model_name: state.upscaleModel } };
    g[N.upApply] = { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: [N.upModel, 0], image: images } };
    images = [N.upApply, 0];
  } else if (up === "rtx" && has(avail, "RTXVideoSuperResolution")) {
    g[N.rtx] = { class_type: "RTXVideoSuperResolution", inputs: { images, resize_type: "scale by multiplier", "resize_type.scale": state.rtxScale ?? 2.0, quality: state.rtxQuality || "ULTRA" } };
    images = [N.rtx, 0];
  }

  const clipTag = String(clipIndex + 1).padStart(3, "0");
  g[N.video] = { class_type: "CreateVideo", inputs: { images, fps: FPS, audio: lockAudio ? [N.audioLock, 1] : [N.decodeA, 0] } };
  g[N.save] = { class_type: "SaveVideo", inputs: { video: [N.video, 0], filename_prefix: `${folder}/${stem}_clip${clipTag}`, format: "auto", codec: "auto" } };

  if (saveLastFrame) {
    g[N.lastF] = { class_type: "ImageFromBatch", inputs: { image: images, batch_index: Math.max(0, frames - 1), length: 1 } };
    g[N.saveLF] = { class_type: "SaveImage", inputs: { images: [N.lastF, 0], filename_prefix: `${folder}/frames/${stem}_clip${clipTag}_last` } };
    const tail = Math.min(TAIL_CANDIDATES, frames);
    g[N.tailF] = { class_type: "ImageFromBatch", inputs: { image: images, batch_index: Math.max(0, frames - tail), length: tail } };
    g[N.tailPrev] = { class_type: "PreviewImage", inputs: { images: [N.tailF, 0] } };
  }

  return { graph: g, meta: { width, height, frames, steps, seed, videoNode: N.save, lastFrameNode: N.saveLF } };
}
