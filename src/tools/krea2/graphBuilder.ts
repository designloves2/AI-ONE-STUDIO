// graphBuilder.ts — Krea2 ComfyUI API 그래프 빌더.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/krea2/graph_builder_krea2.js — 1:1 이식
// (노드 id 문자열, 클래스명, 입력 필드명까지 원본과 동일하게 유지)
import type { Krea2State, LoraEntry } from "./core";
import { SUBFOLDER, safeDepthCkpt, buildPromptText, controlOutputSize, controlLoraForType } from "./core";

type Graph = Record<string, any>;
type Link = [string, number];

function unetNode(name: string) {
  if ((name || "").toLowerCase().endsWith(".gguf")) return { class_type: "UnetLoaderGGUF", inputs: { unet_name: name } };
  return { class_type: "UNETLoader", inputs: { unet_name: name, weight_dtype: "default" } };
}

function withLoraChain(modelLink: Link, loras: LoraEntry[]): { graph: Graph; modelOut: Link } {
  const graph: Graph = {};
  let out: Link = modelLink;
  (loras || []).forEach((lora, i) => {
    if (!lora.name || lora.name === "none" || lora.enabled === false) return;
    const strength = parseFloat(String(lora.strength ?? 0.8));
    if (!(strength > 0)) return;
    const id = `K2:lora${i}`;
    graph[id] = { class_type: "LoraLoaderModelOnly", inputs: { model: out, lora_name: lora.name, strength_model: strength } };
    out = [id, 0];
  });
  return { graph, modelOut: out };
}

function saveNode(link: Link, state: Krea2State) {
  if (state.outputMode === "preview") return { class_type: "PreviewImage", inputs: { images: link } };
  const folder = state.saveSubfolder || SUBFOLDER;
  return { class_type: "SaveImage", inputs: { images: link, filename_prefix: `${folder}/K2` } };
}

function baseGraph(state: Krea2State, promptText: string): { g: Graph; modelOut: Link } {
  const modelName = state.model || "";
  const clipName = state.textEncoder || "";
  const vaeName = state.vae || "";
  if (!modelName) throw new Error("No model selected. Please set a model in ⚙ Settings.");
  if (!clipName) throw new Error("No text encoder selected. Please set one in ⚙ Settings.");
  if (!vaeName) throw new Error("No VAE selected. Please set one in ⚙ Settings.");

  const g: Graph = {};
  g["K2:unet"] = unetNode(modelName);

  if ((clipName || "").toLowerCase().endsWith(".gguf")) {
    g["K2:clip"] = { class_type: "CLIPLoaderGGUF", inputs: { clip_name: clipName, type: "krea2" } };
  } else {
    g["K2:clip"] = { class_type: "CLIPLoader", inputs: { clip_name: clipName, type: "krea2", device: "default" } };
  }

  g["K2:vae"] = { class_type: "VAELoader", inputs: { vae_name: vaeName } };

  const { graph: lg, modelOut } = withLoraChain(["K2:unet", 0], state.loras || []);
  Object.assign(g, lg);

  g["K2:positive"] = { class_type: "CLIPTextEncode", inputs: { clip: ["K2:clip", 0], text: promptText || "" } };
  // Negative 프롬프트가 비어 있으면 원본 Krea2 방식(ConditioningZeroOut)으로 폴백,
  // 채워져 있으면 실제 negative 텍스트를 인코딩해서 사용한다.
  if ((state.negativePrompt || "").trim()) {
    g["K2:negative"] = { class_type: "CLIPTextEncode", inputs: { clip: ["K2:clip", 0], text: state.negativePrompt } };
  } else {
    g["K2:negative"] = { class_type: "ConditioningZeroOut", inputs: { conditioning: ["K2:positive", 0] } };
  }

  return { g, modelOut };
}

function addPreprocessor(g: Graph, prefix: string, imgLink: Link, state: Krea2State, type: string): Link {
  if (type === "canny") {
    g[`${prefix}:pre`] = { class_type: "CannyEdgePreprocessor", inputs: { image: imgLink, low_threshold: state.cannyLow ?? 100, high_threshold: state.cannyHigh ?? 200, resolution: state.preprocResolution ?? 512 } };
  } else {
    g[`${prefix}:pre`] = { class_type: "DepthAnythingV2Preprocessor", inputs: { image: imgLink, ckpt_name: safeDepthCkpt(state.depthCkpt), resolution: state.preprocResolution ?? 512 } };
  }
  return [`${prefix}:pre`, 0];
}

/** depth: Krea2ControlLoRALoader + Krea2ControlImageEncode + Krea2ControlApply
 *  canny: NK2EInContextEditNode + LoraLoaderModelOnly, overrides latent + denoise=1 */
function applyControlChain(g: Graph, state: Krea2State, mode: "t2i" | "i2i", modelOut: Link, latentRef: Link): { modelOut: Link; latentOverride?: Link; denoiseOverride?: number } {
  const enabled = mode === "t2i" ? state.t2iControlEnabled : state.i2iControlEnabled;
  const ctrlImg = mode === "t2i" ? state.t2iControlImage : state.i2iControlImage;
  const type = state.controlType || "depth";
  const lora = controlLoraForType(state, type);
  if (!(enabled && lora && lora !== "none" && ctrlImg)) return { modelOut };

  g["K2:ctrl_img"] = { class_type: "LoadImage", inputs: { image: ctrlImg } };
  const ctrlMap = addPreprocessor(g, "K2:ctrl", ["K2:ctrl_img", 0], state, type);

  if (type === "canny") {
    const fit = controlOutputSize(state, mode);
    if (fit) {
      g["K2:ctrl_scale"] = { class_type: "ImageScale", inputs: { image: ctrlMap, width: fit.W, height: fit.H, upscale_method: "lanczos", crop: "disabled" } };
    } else {
      g["K2:ctrl_scale"] = { class_type: "ImageScaleToTotalPixels", inputs: { image: ctrlMap, upscale_method: "lanczos", megapixels: 1, resolution_steps: 16 } };
    }
    g["K2:ctrl_enc"] = { class_type: "VAEEncode", inputs: { pixels: ["K2:ctrl_scale", 0], vae: ["K2:vae", 0] } };
    g["K2:ctrl_nk2e"] = { class_type: "NK2EInContextEditNode", inputs: { model: modelOut, reference: ["K2:ctrl_enc", 0] } };
    g["K2:ctrl_lora"] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["K2:ctrl_nk2e", 0], lora_name: lora, strength_model: state.controlStrength ?? 0.7 } };
    return { modelOut: ["K2:ctrl_lora", 0], latentOverride: ["K2:ctrl_enc", 0], denoiseOverride: 1 };
  }

  g["K2:ctrl_lora"] = { class_type: "Krea2ControlLoRALoader", inputs: { model: modelOut, lora_name: lora, strength: state.controlStrength ?? 1.0 } };
  g["K2:ctrl_enc"] = {
    class_type: "Krea2ControlImageEncode",
    inputs: {
      control_image: ctrlMap,
      vae: ["K2:vae", 0],
      latent: latentRef,
      resize: "match_latent_size",
      upscale_method: "bicubic",
      crop: "center",
      channel_mode: state.controlChannelMode || "rgb",
      normalize: state.controlNormalize || "per_image_minmax",
      invert: state.controlInvert ?? false,
      batch_mode: "independent_images",
    },
  };
  g["K2:ctrl_apply"] = { class_type: "Krea2ControlApply", inputs: { model: ["K2:ctrl_lora", 0], control_latent: ["K2:ctrl_enc", 0] } };
  return { modelOut: ["K2:ctrl_apply", 0] };
}

/** "Preview depth/canny" 버튼용 — 업로드한 컨트롤 이미지에 전처리기만 실행. */
export function buildControlPreviewGraph(state: Krea2State, imageFilename: string, type?: string): Graph {
  if (!imageFilename) throw new Error("Upload a control image first.");
  const t = type || state.controlType || "depth";
  const g: Graph = {};
  g["PP:load"] = { class_type: "LoadImage", inputs: { image: imageFilename } };
  const map = addPreprocessor(g, "PP", ["PP:load", 0], state, t);
  g["PP:preview"] = { class_type: "PreviewImage", inputs: { images: map } };
  return g;
}

// ── T2I ─────────────────────────────────────────────────────────────────
export function buildT2IGraph(state: Krea2State): Graph {
  const { g, modelOut } = baseGraph(state, buildPromptText(state, "t2i"));

  const t2iFit = controlOutputSize(state, "t2i");
  g["K2:latent"] = { class_type: "EmptyLatentImage", inputs: { width: t2iFit ? t2iFit.W : state.width || 1024, height: t2iFit ? t2iFit.H : state.height || 1024, batch_size: 1 } };

  const cc = applyControlChain(g, state, "t2i", modelOut, ["K2:latent", 0]);
  const t2iLatent = cc.latentOverride || (["K2:latent", 0] as Link);

  g["K2:sampler"] = {
    class_type: "KSampler",
    inputs: { model: cc.modelOut, positive: ["K2:positive", 0], negative: ["K2:negative", 0], latent_image: t2iLatent, seed: state.seed ?? 0, steps: state.steps ?? 8, cfg: state.cfg ?? 1, sampler_name: state.sampler || "euler", scheduler: state.scheduler || "simple", denoise: 1 },
  };
  g["K2:decode"] = { class_type: "VAEDecode", inputs: { samples: ["K2:sampler", 0], vae: ["K2:vae", 0] } };
  g["K2:save"] = saveNode(["K2:decode", 0], state);
  return g;
}

// ── I2I ─────────────────────────────────────────────────────────────────
export function buildI2IGraph(state: Krea2State): Graph {
  if (!state.i2iImage) throw new Error("No source image uploaded for I2I.");
  const { g, modelOut } = baseGraph(state, buildPromptText(state, "i2i"));

  g["K2:load"] = { class_type: "LoadImage", inputs: { image: state.i2iImage } };
  let k2PixSrc: Link = ["K2:load", 0];
  if (state.i2iWidth && state.i2iHeight) {
    g["K2:i2iScale"] = { class_type: "ImageScale", inputs: { image: ["K2:load", 0], width: state.i2iWidth, height: state.i2iHeight, upscale_method: "lanczos", crop: "disabled" } };
    k2PixSrc = ["K2:i2iScale", 0];
  }
  g["K2:encode"] = { class_type: "VAEEncode", inputs: { pixels: k2PixSrc, vae: ["K2:vae", 0] } };

  const cc = applyControlChain(g, state, "i2i", modelOut, ["K2:encode", 0]);
  const i2iLatent = cc.latentOverride || (["K2:encode", 0] as Link);

  g["K2:sampler"] = {
    class_type: "KSampler",
    inputs: { model: cc.modelOut, positive: ["K2:positive", 0], negative: ["K2:negative", 0], latent_image: i2iLatent, seed: state.seed ?? 0, steps: state.steps ?? 8, cfg: state.cfg ?? 1, sampler_name: state.sampler || "euler", scheduler: state.scheduler || "simple", denoise: cc.denoiseOverride ?? state.i2iDenoise ?? 0.75 },
  };
  g["K2:decode"] = { class_type: "VAEDecode", inputs: { samples: ["K2:sampler", 0], vae: ["K2:vae", 0] } };
  g["K2:save"] = saveNode(["K2:decode", 0], state);
  return g;
}

// ── Identity Edit (comfyui-krea2edit) ──────────────────────────────────────
export function buildIdentityGraph(state: Krea2State): Graph {
  if (!state.identityImage) throw new Error("No source image uploaded for Identity Edit.");
  const idLora = state.identityLora;
  if (!idLora || idLora === "none") throw new Error("No Identity Edit LoRA configured. Open ⚙ Settings → Identity Edit and pick the krea2 identity edit LoRA (one-time setup).");

  const modelName = state.model || "";
  const clipName = state.textEncoder || "";
  const vaeName = state.vae || "";
  if (!modelName) throw new Error("No model selected. Please set a model in ⚙ Settings.");
  if (!clipName) throw new Error("No text encoder selected. Please set one in ⚙ Settings.");
  if (!vaeName) throw new Error("No VAE selected. Please set one in ⚙ Settings.");

  const instruction = ("identity" in state.promptsByMode ? state.promptsByMode.identity : state.prompt || "").trim();
  if (!instruction) throw new Error('Enter an edit instruction (e.g. "recolor the car to matte black").');

  const g: Graph = {};
  g["K2:unet"] = unetNode(modelName);
  if ((clipName || "").toLowerCase().endsWith(".gguf")) g["K2:clip"] = { class_type: "CLIPLoaderGGUF", inputs: { clip_name: clipName, type: "krea2" } };
  else g["K2:clip"] = { class_type: "CLIPLoader", inputs: { clip_name: clipName, type: "krea2", device: "default" } };
  g["K2:vae"] = { class_type: "VAELoader", inputs: { vae_name: vaeName } };

  g["ID:lora"] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["K2:unet", 0], lora_name: idLora, strength_model: state.identityLoraStrength ?? 1.0 } };
  const { graph: lg, modelOut } = withLoraChain(["ID:lora", 0], state.loras || []);
  Object.assign(g, lg);

  g["ID:load"] = { class_type: "LoadImage", inputs: { image: state.identityImage } };
  g["ID:encode"] = { class_type: "VAEEncode", inputs: { pixels: ["ID:load", 0], vae: ["K2:vae", 0] } };

  const hasB = !!state.identityImageB;
  if (hasB) {
    g["ID:loadB"] = { class_type: "LoadImage", inputs: { image: state.identityImageB } };
    g["ID:encodeB"] = { class_type: "VAEEncode", inputs: { pixels: ["ID:loadB", 0], vae: ["K2:vae", 0] } };
  }

  const fitMode = state.identityFitMode || "fit";
  const patchInputs: any = { model: modelOut, source_latent: ["ID:encode", 0], vae: ["K2:vae", 0], source_image: ["ID:load", 0], fit_mode: fitMode, ref_boost: state.identityRefBoost ?? 1.0 };
  if (hasB) { patchInputs.source_latent_b = ["ID:encodeB", 0]; patchInputs.source_image_b = ["ID:loadB", 0]; }
  g["ID:patch"] = { class_type: "Krea2EditModelPatch", inputs: patchInputs };

  const groundingPx = state.identityGroundingPx ?? 768;
  const posEnc: any = { clip: ["K2:clip", 0], prompt: instruction, image: ["ID:load", 0], grounding_px: groundingPx };
  // 원본 주석: "Krea2EditGroundedEncode(empty prompt, same image) → KSampler.negative (trained uncond)"
  // 이 모델은 negative 쪽에 반드시 빈 프롬프트를 기대하도록 학습됨 — 여기에 실제 negative 텍스트를
  // 넣으면 identity grounding이 깨져서 완전히 다른 사람이 나온다. Identity 모드는 negativePrompt를 쓰지 않는다.
  const negEnc: any = { clip: ["K2:clip", 0], prompt: "", image: ["ID:load", 0], grounding_px: groundingPx };
  if (hasB) { posEnc.image_b = ["ID:loadB", 0]; negEnc.image_b = ["ID:loadB", 0]; }
  g["ID:positive"] = { class_type: "Krea2EditGroundedEncode", inputs: posEnc };
  g["ID:negative"] = { class_type: "Krea2EditGroundedEncode", inputs: negEnc };

  g["ID:latent"] = { class_type: "EmptySD3LatentImage", inputs: { width: state.identityWidth || 1024, height: state.identityHeight || 1024, batch_size: 1 } };

  g["ID:sampler"] = {
    class_type: "KSampler",
    inputs: { model: ["ID:patch", 0], positive: ["ID:positive", 0], negative: ["ID:negative", 0], latent_image: ["ID:latent", 0], seed: state.seed ?? 0, steps: state.steps ?? 8, cfg: state.cfg ?? 1, sampler_name: state.sampler || "euler", scheduler: state.scheduler || "simple", denoise: 1 },
  };
  g["ID:decode"] = { class_type: "VAEDecode", inputs: { samples: ["ID:sampler", 0], vae: ["K2:vae", 0] } };
  g["ID:save"] = saveNode(["ID:decode", 0], state);
  return g;
}

// ── Upscale — SeedVR2 ──────────────────────────────────────────────────────
export function buildUpscaleGraph(state: Krea2State): Graph {
  if (!state.upscaleImage) throw new Error("No source image uploaded for upscale.");
  if (!state.upscaleDitModel || state.upscaleDitModel === "none") throw new Error("Select a SeedVR2 DiT model in the UPSCALE panel.");
  if (!state.upscaleVaeModel || state.upscaleVaeModel === "none") throw new Error("Select a SeedVR2 VAE model in the UPSCALE panel.");

  const ditOffload = state.upscaleOffloadDevice && state.upscaleOffloadDevice !== "none" ? state.upscaleOffloadDevice : "cpu";
  const folder = state.saveSubfolder || SUBFOLDER;

  return {
    "UP:dit": { class_type: "SeedVR2LoadDiTModel", inputs: { model: state.upscaleDitModel, device: "cuda:0", blocks_to_swap: state.upscaleBlocksToSwap ?? 0, swap_io_components: false, offload_device: ditOffload, cache_model: ditOffload !== "none", attention_mode: state.upscaleAttentionMode || "sdpa" } },
    "UP:vae": { class_type: "SeedVR2LoadVAEModel", inputs: { model: state.upscaleVaeModel, device: "cuda:0", encode_tiled: true, encode_tile_size: 1024, encode_tile_overlap: 128, decode_tiled: true, decode_tile_size: 1024, decode_tile_overlap: 128, tile_debug: "false", offload_device: ditOffload, cache_model: false } },
    "UP:load": { class_type: "LoadImage", inputs: { image: state.upscaleImage } },
    "UP:run": {
      class_type: "SeedVR2VideoUpscaler",
      inputs: {
        image: ["UP:load", 0],
        dit: ["UP:dit", 0],
        vae: ["UP:vae", 0],
        seed: (state.seed ?? 42) % 4294967295,
        resolution: state.upscaleResolution ?? 2048,
        max_resolution: state.upscaleMaxResolution ?? 4096,
        batch_size: state.upscaleBatchSize ?? 1,
        uniform_batch_size: false,
        color_correction: state.upscaleColorCorrection || "lab",
        temporal_overlap: 0,
        prepend_frames: 0,
        input_noise_scale: state.upscaleInputNoiseScale ?? 0,
        latent_noise_scale: state.upscaleLatentNoiseScale ?? 0,
        offload_device: ditOffload,
        enable_debug: false,
      },
    },
    "UP:save": { class_type: "SaveImage", inputs: { images: ["UP:run", 0], filename_prefix: `${folder}/K2_up` } },
  };
}

export function buildGraph(state: Krea2State): Graph {
  switch (state.mode) {
    case "i2i": return buildI2IGraph(state);
    case "identity": return buildIdentityGraph(state);
    case "upscale": return buildUpscaleGraph(state);
    default: return buildT2IGraph(state);
  }
}
