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

export function buildGraph(state: ZImageState): Record<string, any> {
  if (state.mode === "i2i") return buildI2IGraph(state);
  if (state.mode === "upscale") return buildUpscaleGraph(state);
  if (state.mode === "t2i") return buildT2IGraph(state);
  throw new Error(`Mode "${state.mode}" is not implemented yet (Phase 2).`);
}
