// graphBuilder.ts — Z-Image Turbo 그래프 빌더 (Phase 1: T2I/I2I/Upscale).
// 원본 근거: web/zimage/graph_builder.js — buildT2IGraph/buildI2IGraph를 1:1 이식.
// Krea2와의 핵심 차이: ModelSamplingAuraFlow(shift 파라미터) 사용, GGUF 분기 시 type="lumina2"
// (Krea2는 "krea2") — Z-Image는 Lumina2 계열 베이스 모델이라 다르다.
import type { ZImageState } from "./core";
import { SUBFOLDER } from "./core";

function buildPromptText(state: ZImageState): string {
  const modePrompt = state.mode in state.promptsByMode ? state.promptsByMode[state.mode] : state.prompt || "";
  const parts: string[] = [modePrompt];
  (state.loras || []).forEach((l) => {
    if (l.enabled !== false && l.name && l.name !== "none" && l.triggerWord) parts.push(l.triggerWord);
  });
  if (state.promptSuffix) parts.push(state.promptSuffix);
  return parts.filter(Boolean).join(", ");
}

function unetNode(name: string) {
  if (name.toLowerCase().endsWith(".gguf")) return { class_type: "UnetLoaderGGUF", inputs: { unet_name: name } };
  return { class_type: "UNETLoader", inputs: { unet_name: name, weight_dtype: "default" } };
}
function clipNode(name: string) {
  if (name.toLowerCase().endsWith(".gguf")) return { class_type: "CLIPLoaderGGUF", inputs: { clip_name: name, type: "lumina2" } };
  return { class_type: "CLIPLoader", inputs: { clip_name: name, type: "lumina2", device: "default" } };
}

function withLoraChain(modelLink: any, loras: ZImageState["loras"]) {
  const graph: Record<string, any> = {};
  let out = modelLink;
  (loras || []).forEach((lora, i) => {
    if (!lora.name || lora.name === "none" || lora.enabled === false) return;
    const strength = parseFloat(String(lora.strength ?? 1));
    if (!(strength > 0)) return;
    const id = `ZIT:lora${i}`;
    graph[id] = { class_type: "LoraLoaderModelOnly", inputs: { model: out, lora_name: lora.name, strength_model: strength } };
    out = [id, 0];
  });
  return { graph, modelOut: out };
}

function baseGraph(state: ZImageState): Record<string, any> {
  const g: Record<string, any> = {};
  g["ZIT:unet"] = unetNode(state.model);
  g["ZIT:clip"] = clipNode(state.textEncoder);
  g["ZIT:vae"] = { class_type: "VAELoader", inputs: { vae_name: state.vae } };
  const { graph: lg, modelOut } = withLoraChain(["ZIT:unet", 0], state.loras || []);
  Object.assign(g, lg);
  g["ZIT:modelSampling"] = { class_type: "ModelSamplingAuraFlow", inputs: { model: modelOut, shift: state.shift ?? 3 } };
  g["ZIT:positive"] = { class_type: "CLIPTextEncode", inputs: { clip: ["ZIT:clip", 0], text: buildPromptText(state) } };
  g["ZIT:negative"] = { class_type: "CLIPTextEncode", inputs: { clip: ["ZIT:clip", 0], text: state.negativePrompt || "" } };
  return g;
}

function saveNode(link: any, state: ZImageState) {
  if (state.outputMode === "preview") return { class_type: "PreviewImage", inputs: { images: link } };
  const folder = state.saveSubfolder || SUBFOLDER;
  return { class_type: "SaveImage", inputs: { images: link, filename_prefix: `${folder}/ZIT` } };
}

function ksampler(state: ZImageState, latent: any, denoise: number) {
  return {
    class_type: "KSampler",
    inputs: {
      model: ["ZIT:modelSampling", 0],
      positive: ["ZIT:positive", 0],
      negative: ["ZIT:negative", 0],
      latent_image: latent,
      seed: state.seed ?? 0,
      steps: state.steps ?? 8,
      cfg: state.cfg ?? 1,
      sampler_name: state.sampler || "euler",
      scheduler: state.scheduler || "simple",
      denoise,
    },
  };
}

export function buildT2IGraph(state: ZImageState): Record<string, any> {
  const g = baseGraph(state);
  g["ZIT:latent"] = { class_type: "EmptySD3LatentImage", inputs: { width: state.width || 1024, height: state.height || 1536, batch_size: 1 } };
  g["ZIT:sampler"] = ksampler(state, ["ZIT:latent", 0], 1);
  g["ZIT:vaeDecode"] = { class_type: "VAEDecode", inputs: { samples: ["ZIT:sampler", 0], vae: ["ZIT:vae", 0] } };
  g["ZIT:save"] = saveNode(["ZIT:vaeDecode", 0], state);
  return g;
}

export function buildI2IGraph(state: ZImageState): Record<string, any> {
  if (!state.i2iImage) throw new Error("No source image uploaded.");
  const g = baseGraph(state);
  g["ZIT:load"] = { class_type: "LoadImage", inputs: { image: state.i2iImage } };
  let pixSrc: any = ["ZIT:load", 0];
  if (state.i2iWidth && state.i2iHeight) {
    g["ZIT:scale"] = { class_type: "ImageScale", inputs: { image: ["ZIT:load", 0], width: state.i2iWidth, height: state.i2iHeight, upscale_method: "lanczos", crop: "disabled" } };
    pixSrc = ["ZIT:scale", 0];
  }
  g["ZIT:vaeEnc"] = { class_type: "VAEEncode", inputs: { pixels: pixSrc, vae: ["ZIT:vae", 0] } };
  g["ZIT:sampler"] = ksampler(state, ["ZIT:vaeEnc", 0], state.i2iDenoise ?? 0.75);
  g["ZIT:vaeDecode"] = { class_type: "VAEDecode", inputs: { samples: ["ZIT:sampler", 0], vae: ["ZIT:vae", 0] } };
  g["ZIT:save"] = saveNode(["ZIT:vaeDecode", 0], state);
  return g;
}

// ── Upscale (SeedVR2) — Krea2와 동일한 SeedVR2 노드 세트, subfolder만 다름 ──────
export function buildUpscaleGraph(state: ZImageState): Record<string, any> {
  if (!state.upscaleImage) throw new Error("Upload a source image.");
  if (!state.upscaleDitModel || state.upscaleDitModel === "none") throw new Error("Select a DiT model.");
  if (!state.upscaleVaeModel || state.upscaleVaeModel === "none") throw new Error("Select a VAE model.");
  const g: Record<string, any> = {};
  const ditOffload = state.upscaleOffloadDevice && state.upscaleOffloadDevice !== "none" ? state.upscaleOffloadDevice : "cpu";

  g["UP:dit"] = {
    class_type: "SeedVR2LoadDiTModel",
    inputs: {
      model: state.upscaleDitModel,
      device: "cuda:0",
      blocks_to_swap: state.upscaleBlocksToSwap ?? 0,
      swap_io_components: false,
      offload_device: ditOffload,
      cache_model: ditOffload !== "none",
      attention_mode: state.upscaleAttentionMode || "sdpa",
    },
  };
  g["UP:vae"] = {
    class_type: "SeedVR2LoadVAEModel",
    inputs: {
      model: state.upscaleVaeModel,
      device: "cuda:0",
      encode_tiled: true,
      encode_tile_size: 1024,
      encode_tile_overlap: 128,
      decode_tiled: true,
      decode_tile_size: 1024,
      decode_tile_overlap: 128,
      tile_debug: "false",
      offload_device: ditOffload,
      cache_model: false,
    },
  };
  g["UP:load"] = { class_type: "LoadImage", inputs: { image: state.upscaleImage } };
  g["UP:run"] = {
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
  };
  g["UP:save"] = saveNode(["UP:run", 0], state);
  return g;
}

// ── Inpaint — DifferentialDiffusion + SetLatentNoiseMask ──────────────────
// Flow 모델에서 EmptyLatent+composite 방식은 맥락을 무시한 완전히 다른 이미지를 생성하므로,
// DifferentialDiffusion으로 마스크 영역만 자연스럽게 재생성한다 (원본 주석 그대로).
export function buildInpaintGraph(state: ZImageState): Record<string, any> {
  if (!state.inpaintImage) throw new Error("Upload a source image.");
  if (!state.inpaintMaskImage) throw new Error("Upload a mask image.");
  const g: Record<string, any> = {};
  g["ZIT:unet"] = unetNode(state.model);
  g["ZIT:clip"] = clipNode(state.textEncoder);
  g["ZIT:vae"] = { class_type: "VAELoader", inputs: { vae_name: state.vae } };
  const { graph: lg, modelOut } = withLoraChain(["ZIT:unet", 0], state.loras || []);
  Object.assign(g, lg);
  g["ZIT:modelSamp"] = { class_type: "ModelSamplingAuraFlow", inputs: { model: modelOut, shift: state.shift ?? 3 } };
  g["ZIT:diffDiff"] = { class_type: "DifferentialDiffusion", inputs: { model: ["ZIT:modelSamp", 0] } };
  g["ZIT:positive"] = { class_type: "CLIPTextEncode", inputs: { clip: ["ZIT:clip", 0], text: buildPromptText(state) } };
  g["ZIT:negative"] = { class_type: "CLIPTextEncode", inputs: { clip: ["ZIT:clip", 0], text: state.negativePrompt || "" } };

  g["ZIT:load"] = { class_type: "LoadImage", inputs: { image: state.inpaintImage } };
  g["ZIT:loadMask"] = { class_type: "LoadImage", inputs: { image: state.inpaintMaskImage } };
  g["ZIT:toMask"] = { class_type: "ImageToMask", inputs: { image: ["ZIT:loadMask", 0], channel: "red" } };
  g["ZIT:vaeEnc"] = { class_type: "VAEEncode", inputs: { pixels: ["ZIT:load", 0], vae: ["ZIT:vae", 0] } };
  g["ZIT:noiseMask"] = { class_type: "SetLatentNoiseMask", inputs: { samples: ["ZIT:vaeEnc", 0], mask: ["ZIT:toMask", 0] } };

  g["ZIT:sampler"] = {
    class_type: "KSampler",
    inputs: {
      model: ["ZIT:diffDiff", 0],
      positive: ["ZIT:positive", 0],
      negative: ["ZIT:negative", 0],
      latent_image: ["ZIT:noiseMask", 0],
      seed: state.seed ?? 0,
      steps: state.steps ?? 8,
      cfg: state.cfg ?? 1,
      sampler_name: state.sampler || "euler",
      scheduler: state.scheduler || "simple",
      denoise: state.inpaintDenoise ?? 0.85,
    },
  };
  g["ZIT:vaeDecode"] = { class_type: "VAEDecode", inputs: { samples: ["ZIT:sampler", 0], vae: ["ZIT:vae", 0] } };
  g["ZIT:save"] = saveNode(["ZIT:vaeDecode", 0], state);
  return g;
}

// ── Re-BG — RMBG로 서브젝트 분리 후 배경 전체를 새로 생성(denoise=1)해 경계선 없이 합성 ──
export function buildReBGGraph(state: ZImageState): Record<string, any> {
  if (!state.rebgImage) throw new Error("Upload a source image.");
  if (!state.rebgBgModel || state.rebgBgModel === "none") throw new Error("Select a background removal model.");
  const g: Record<string, any> = {};
  g["ZIT:unet"] = unetNode(state.model);
  g["ZIT:clip"] = clipNode(state.textEncoder);
  g["ZIT:vae"] = { class_type: "VAELoader", inputs: { vae_name: state.vae } };
  const { graph: lg, modelOut } = withLoraChain(["ZIT:unet", 0], state.loras || []);
  Object.assign(g, lg);
  g["ZIT:modelSamp"] = { class_type: "ModelSamplingAuraFlow", inputs: { model: modelOut, shift: state.shift ?? 3 } };
  g["ZIT:positive"] = { class_type: "CLIPTextEncode", inputs: { clip: ["ZIT:clip", 0], text: buildPromptText(state) } };
  g["ZIT:negative"] = { class_type: "CLIPTextEncode", inputs: { clip: ["ZIT:clip", 0], text: state.negativePrompt || "" } };

  g["ZIT:load"] = { class_type: "LoadImage", inputs: { image: state.rebgImage } };
  g["ZIT:bgModel"] = { class_type: "LoadBackgroundRemovalModel", inputs: { bg_removal_name: state.rebgBgModel } };
  g["ZIT:rmbg"] = { class_type: "RemoveBackground", inputs: { image: ["ZIT:load", 0], bg_removal_model: ["ZIT:bgModel", 0] } };

  let maskRef: any = ["ZIT:rmbg", 0];
  const offset = Math.round(state.rebgOffset || 0);
  if (offset !== 0) {
    g["ZIT:maskGrow"] = { class_type: "GrowMask", inputs: { mask: maskRef, expand: offset, tapered_corners: true } };
    maskRef = ["ZIT:maskGrow", 0];
  }
  const blur = Math.round(Math.max(0, state.rebgBlur || 0));
  if (blur > 0) {
    g["ZIT:maskToImg2"] = { class_type: "MaskToImage", inputs: { mask: maskRef } };
    g["ZIT:maskBlur"] = { class_type: "ImageBlur", inputs: { image: ["ZIT:maskToImg2", 0], blur_radius: blur, sigma: blur * 0.5 } };
    g["ZIT:maskFinal"] = { class_type: "ImageToMask", inputs: { image: ["ZIT:maskBlur", 0], channel: "red" } };
    maskRef = ["ZIT:maskFinal", 0];
  }
  g["ZIT:maskImg"] = { class_type: "MaskToImage", inputs: { mask: maskRef } };

  const padBase = {
    left: Math.max(0, state.rebgLeft || 0),
    top: Math.max(0, state.rebgUp || 0),
    right: Math.max(0, state.rebgRight || 0),
    bottom: Math.max(0, state.rebgDown || 0),
    feathering: state.rebgFeather ?? 40,
  };
  g["ZIT:padSrc"] = { class_type: "ImagePadForOutpaint", inputs: { ...padBase, image: ["ZIT:load", 0] } };
  g["ZIT:padMaskImg"] = { class_type: "ImagePadForOutpaint", inputs: { ...padBase, feathering: 0, image: ["ZIT:maskImg", 0] } };
  g["ZIT:padMask"] = { class_type: "ImageToMask", inputs: { image: ["ZIT:padMaskImg", 0], channel: "red" } };

  g["ZIT:vaeEnc"] = { class_type: "VAEEncode", inputs: { pixels: ["ZIT:padSrc", 0], vae: ["ZIT:vae", 0] } };
  g["ZIT:sampler"] = {
    class_type: "KSampler",
    inputs: {
      model: ["ZIT:modelSamp", 0],
      positive: ["ZIT:positive", 0],
      negative: ["ZIT:negative", 0],
      latent_image: ["ZIT:vaeEnc", 0],
      seed: state.seed ?? 0,
      steps: state.steps ?? 8,
      cfg: state.cfg ?? 1,
      sampler_name: state.sampler || "euler",
      scheduler: state.scheduler || "simple",
      denoise: state.rebgDenoise ?? 1,
    },
  };
  g["ZIT:vaeDecode"] = { class_type: "VAEDecode", inputs: { samples: ["ZIT:sampler", 0], vae: ["ZIT:vae", 0] } };
  g["ZIT:composite"] = {
    class_type: "ImageCompositeMasked",
    inputs: { destination: ["ZIT:vaeDecode", 0], source: ["ZIT:padSrc", 0], x: 0, y: 0, resize_source: false, mask: ["ZIT:padMask", 0] },
  };
  g["ZIT:save"] = saveNode(["ZIT:composite", 0], state);
  return g;
}

// ── ControlNet ──────────────────────────────────────────────────────────
const PREPROCESSOR_MAP: Record<string, string> = { canny: "CannyEdgePreprocessor", depth: "DepthAnythingPreprocessor", pose: "DWPreprocessor", hed: "HEDPreprocessor", mlsd: "M-LSDPreprocessor" };

export function buildControlNetGraph(state: ZImageState): Record<string, any> {
  if (!state.controlnetImage) throw new Error("Upload a reference image.");
  if (!state.controlnetModel || state.controlnetModel === "none") throw new Error("Select a ControlNet Union model.");
  const g: Record<string, any> = {};
  g["ZIT:unet"] = unetNode(state.model);
  g["ZIT:clip"] = clipNode(state.textEncoder);
  g["ZIT:vae"] = { class_type: "VAELoader", inputs: { vae_name: state.vae } };
  const { graph: lg, modelOut } = withLoraChain(["ZIT:unet", 0], state.loras || []);
  Object.assign(g, lg);
  g["ZIT:positive"] = { class_type: "CLIPTextEncode", inputs: { clip: ["ZIT:clip", 0], text: buildPromptText(state) } };
  g["ZIT:negative"] = { class_type: "CLIPTextEncode", inputs: { clip: ["ZIT:clip", 0], text: state.negativePrompt || "" } };
  g["ZIT:loadImg"] = { class_type: "LoadImage", inputs: { image: state.controlnetImage } };
  let ctrlLink: any = ["ZIT:loadImg", 0];
  const prep = PREPROCESSOR_MAP[state.controlnetType || "depth"];
  if (prep) {
    g["ZIT:pre"] = { class_type: "AIO_Preprocessor", inputs: { image: ctrlLink, preprocessor: prep, resolution: state.controlnetResolution ?? 1024 } };
    ctrlLink = ["ZIT:pre", 0];
  }
  g["ZIT:patch"] = { class_type: "ModelPatchLoader", inputs: { name: state.controlnetModel } };
  g["ZIT:cnApply"] = { class_type: "ZImageFunControlnet", inputs: { model: modelOut, model_patch: ["ZIT:patch", 0], vae: ["ZIT:vae", 0], strength: state.controlnetStrength ?? 1, image: ctrlLink } };
  g["ZIT:modelSamp"] = { class_type: "ModelSamplingAuraFlow", inputs: { model: ["ZIT:cnApply", 0], shift: state.shift ?? 3 } };
  g["ZIT:getSize"] = { class_type: "GetImageSize", inputs: { image: ctrlLink } };
  g["ZIT:latent"] = { class_type: "EmptySD3LatentImage", inputs: { width: ["ZIT:getSize", 0], height: ["ZIT:getSize", 1], batch_size: 1 } };
  g["ZIT:sampler"] = {
    class_type: "KSampler",
    inputs: {
      model: ["ZIT:modelSamp", 0],
      positive: ["ZIT:positive", 0],
      negative: ["ZIT:negative", 0],
      latent_image: ["ZIT:latent", 0],
      seed: state.seed ?? 0,
      steps: state.steps ?? 8,
      cfg: state.cfg ?? 1,
      sampler_name: state.sampler || "euler",
      scheduler: state.scheduler || "simple",
      denoise: state.controlnetDenoise ?? 1,
    },
  };
  g["ZIT:vaeDecode"] = { class_type: "VAEDecode", inputs: { samples: ["ZIT:sampler", 0], vae: ["ZIT:vae", 0] } };
  g["ZIT:save"] = saveNode(["ZIT:vaeDecode", 0], state);
  return g;
}

// ── Face Redraw — Impact Pack의 FaceDetailer 사용 (탐지→크롭→재생성→합성 전부 내부 처리) ──
export function buildFaceRedrawGraph(state: ZImageState): Record<string, any> {
  if (!state.faceImage) throw new Error("Upload a portrait image.");
  if (!state.faceDetectorModel || state.faceDetectorModel === "none") throw new Error("Select a face detector model.");
  const g: Record<string, any> = {};
  g["ZIT:unet"] = unetNode(state.model);
  g["ZIT:clip"] = clipNode(state.textEncoder);
  g["ZIT:vae"] = { class_type: "VAELoader", inputs: { vae_name: state.vae } };
  const { graph: lg, modelOut } = withLoraChain(["ZIT:unet", 0], state.loras || []);
  Object.assign(g, lg);
  g["ZIT:modelSamp"] = { class_type: "ModelSamplingAuraFlow", inputs: { model: modelOut, shift: state.shift ?? 3 } };
  g["ZIT:positive"] = { class_type: "CLIPTextEncode", inputs: { clip: ["ZIT:clip", 0], text: buildPromptText(state) } };
  g["ZIT:negative"] = { class_type: "CLIPTextEncode", inputs: { clip: ["ZIT:clip", 0], text: state.negativePrompt || "" } };

  g["ZIT:loadImg"] = { class_type: "LoadImage", inputs: { image: state.faceImage } };
  g["ZIT:bboxProv"] = { class_type: "UltralyticsDetectorProvider", inputs: { model_name: state.faceDetectorModel } };

  g["ZIT:faceDetail"] = {
    class_type: "FaceDetailer",
    inputs: {
      image: ["ZIT:loadImg", 0],
      model: ["ZIT:modelSamp", 0],
      clip: ["ZIT:clip", 0],
      vae: ["ZIT:vae", 0],
      positive: ["ZIT:positive", 0],
      negative: ["ZIT:negative", 0],
      bbox_detector: ["ZIT:bboxProv", 0],
      guide_size: 512,
      guide_size_for: true,
      max_size: 1024,
      seed: state.seed ?? 0,
      steps: state.steps ?? 8,
      cfg: state.cfg ?? 1,
      sampler_name: state.sampler || "euler",
      scheduler: state.scheduler || "simple",
      denoise: state.faceDenoise ?? 0.5,
      feather: state.faceFeather ?? 5,
      noise_mask: true,
      force_inpaint: true,
      bbox_threshold: state.faceThreshold ?? 0.5,
      bbox_dilation: state.faceDilation ?? 4,
      bbox_crop_factor: 3.0,
      sam_detection_hint: "center-1",
      sam_dilation: 0,
      sam_threshold: 0.93,
      sam_bbox_expansion: 0,
      sam_mask_hint_threshold: 0.7,
      sam_mask_hint_use_negative: "False",
      drop_size: 10,
      refiner_ratio: 0.2,
      inpaint_model: false,
      noise_mask_feather: 20,
      wildcard: "",
      cycle: 1,
    },
  };
  g["ZIT:save"] = saveNode(["ZIT:faceDetail", 0], state);
  return g;
}

export function buildGraph(state: ZImageState): Record<string, any> {
  if (state.mode === "i2i") return buildI2IGraph(state);
  if (state.mode === "inpaint") return buildInpaintGraph(state);
  if (state.mode === "rebg") return buildReBGGraph(state);
  if (state.mode === "controlnet") return buildControlNetGraph(state);
  if (state.mode === "face_redraw") return buildFaceRedrawGraph(state);
  if (state.mode === "upscale") return buildUpscaleGraph(state);
  return buildT2IGraph(state);
}
