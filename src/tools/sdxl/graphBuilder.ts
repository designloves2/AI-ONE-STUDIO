// graphBuilder.ts — SDXL 워크플로우를 노드 단위로 조립. 원본 근거: graph_builder_sdxl.js.
// Checkpoint 모드는 CheckpointLoaderSimple 하나로 model/clip/vae를 모두 얻고, Separate 모드는
// UNETLoader(or UnetLoaderGGUF)+DualCLIPLoader(type=sdxl)+VAELoader를 따로 구성한다.
import type { SDXLState, LoraEntry } from "./core";
import { SUBFOLDER } from "./core";

const P = "SX";

function buildPromptText(state: SDXLState, mode: string): string {
  const base = state.promptsByMode[mode] || state.prompt || "";
  const parts = [base];
  (state.loras || []).forEach((l: LoraEntry) => {
    if (l.enabled !== false && l.name && l.name !== "none" && l.triggerWord) parts.push(l.triggerWord);
  });
  if (state.promptSuffix) parts.push(state.promptSuffix);
  return parts.filter(Boolean).join(", ");
}

function buildModelNodes(state: SDXLState) {
  const g: Record<string, any> = {};
  if (state.modelLoaderMode === "separate") {
    const unetName = state.unet || "";
    if (unetName.toLowerCase().endsWith(".gguf")) {
      g[`${P}:unet`] = { class_type: "UnetLoaderGGUF", inputs: { unet_name: unetName } };
    } else {
      g[`${P}:unet`] = { class_type: "UNETLoader", inputs: { unet_name: unetName, weight_dtype: "default" } };
    }
    g[`${P}:te`] = { class_type: "DualCLIPLoader", inputs: { clip_name1: state.clipL || "", clip_name2: state.clipG || "", type: "sdxl" } };
    g[`${P}:vae`] = { class_type: "VAELoader", inputs: { vae_name: state.vae || "" } };
    return { g, modelRef: [`${P}:unet`, 0], clipRef: [`${P}:te`, 0], vaeRef: [`${P}:vae`, 0] };
  }
  g[`${P}:ckpt`] = { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: state.checkpoint || "" } };
  return { g, modelRef: [`${P}:ckpt`, 0], clipRef: [`${P}:ckpt`, 1], vaeRef: [`${P}:ckpt`, 2] };
}

function applyLoraChain(g: Record<string, any>, state: SDXLState, modelRef: any, clipRef: any) {
  let mOut = modelRef;
  let cOut = clipRef;
  (state.loras || []).forEach((lora, i) => {
    if (!lora.name || lora.name === "none" || lora.enabled === false) return;
    const str = Number(lora.strength ?? 1);
    if (!(str > 0)) return;
    const id = `${P}:lora${i}`;
    g[id] = { class_type: "LoraLoader", inputs: { model: mOut, clip: cOut, lora_name: lora.name, strength_model: str, strength_clip: str } };
    mOut = [id, 0];
    cOut = [id, 1];
  });
  return { modelOut: mOut, clipOut: cOut };
}

function saveNode(imagesRef: any, state: SDXLState, prefix = "SX") {
  if (state.outputMode === "preview") return { class_type: "PreviewImage", inputs: { images: imagesRef } };
  const folder = state.saveSubfolder || SUBFOLDER;
  return { class_type: "SaveImage", inputs: { images: imagesRef, filename_prefix: `${folder}/${prefix}` } };
}

function ksampler(modelRef: any, posRef: any, negRef: any, latentRef: any, state: SDXLState, denoise: number) {
  return {
    class_type: "KSampler",
    inputs: {
      model: modelRef,
      positive: posRef,
      negative: negRef,
      latent_image: latentRef,
      seed: state.seed ?? 0,
      steps: state.steps ?? 20,
      cfg: state.cfg !== undefined ? state.cfg : 7,
      sampler_name: state.sampler || "euler_ancestral",
      scheduler: state.scheduler || "karras",
      denoise,
    },
  };
}

// ── T2I (옵션: Base+Refiner 2단계) ──────────────────────────────────────────
export function buildT2IGraph(state: SDXLState): Record<string, any> {
  const { g, modelRef, clipRef, vaeRef } = buildModelNodes(state);
  const { modelOut, clipOut } = applyLoraChain(g, state, modelRef, clipRef);

  g[`${P}:pos`] = { class_type: "CLIPTextEncode", inputs: { text: buildPromptText(state, "t2i"), clip: clipOut } };
  g[`${P}:neg`] = { class_type: "CLIPTextEncode", inputs: { text: state.negativePrompt || "", clip: clipOut } };
  g[`${P}:latent`] = { class_type: "EmptyLatentImage", inputs: { width: state.width || 1024, height: state.height || 1024, batch_size: 1 } };

  const totalSteps = state.steps || 20;

  if (state.useRefiner && state.refinerCheckpoint) {
    const baseSteps = Math.max(1, Math.round(totalSteps * (state.refinerStepFrac ?? 0.8)));

    g[`${P}:baseKS`] = {
      class_type: "KSamplerAdvanced",
      inputs: {
        model: modelOut, positive: [`${P}:pos`, 0], negative: [`${P}:neg`, 0],
        latent_image: [`${P}:latent`, 0],
        noise_seed: state.seed ?? 0, steps: totalSteps, cfg: state.cfg ?? 7,
        sampler_name: state.sampler || "euler_ancestral", scheduler: state.scheduler || "karras",
        start_at_step: 0, end_at_step: baseSteps,
        add_noise: "enable", return_with_leftover_noise: "enable",
      },
    };
    g[`${P}:refCkpt`] = { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: state.refinerCheckpoint } };
    g[`${P}:refPos`] = { class_type: "CLIPTextEncode", inputs: { text: buildPromptText(state, "t2i"), clip: [`${P}:refCkpt`, 1] } };
    g[`${P}:refNeg`] = { class_type: "CLIPTextEncode", inputs: { text: state.negativePrompt || "", clip: [`${P}:refCkpt`, 1] } };
    g[`${P}:refKS`] = {
      class_type: "KSamplerAdvanced",
      inputs: {
        model: [`${P}:refCkpt`, 0], positive: [`${P}:refPos`, 0], negative: [`${P}:refNeg`, 0],
        latent_image: [`${P}:baseKS`, 0],
        noise_seed: state.seed ?? 0, steps: totalSteps, cfg: state.cfg ?? 7,
        sampler_name: state.sampler || "euler_ancestral", scheduler: state.scheduler || "karras",
        start_at_step: baseSteps, end_at_step: totalSteps,
        add_noise: "disable", return_with_leftover_noise: "disable",
      },
    };
    g[`${P}:vaeDec`] = { class_type: "VAEDecode", inputs: { samples: [`${P}:refKS`, 0], vae: [`${P}:refCkpt`, 2] } };
  } else {
    g[`${P}:sampler`] = ksampler(modelOut, [`${P}:pos`, 0], [`${P}:neg`, 0], [`${P}:latent`, 0], state, 1);
    g[`${P}:vaeDec`] = { class_type: "VAEDecode", inputs: { samples: [`${P}:sampler`, 0], vae: vaeRef } };
  }

  g[`${P}:save`] = saveNode([`${P}:vaeDec`, 0], state);
  return g;
}

// ── I2I ──────────────────────────────────────────────────────────────────
export function buildI2IGraph(state: SDXLState): Record<string, any> {
  if (!state.i2iImage) throw new Error("Upload a source image.");
  const { g, modelRef, clipRef, vaeRef } = buildModelNodes(state);
  const { modelOut, clipOut } = applyLoraChain(g, state, modelRef, clipRef);

  g[`${P}:pos`] = { class_type: "CLIPTextEncode", inputs: { text: buildPromptText(state, "i2i"), clip: clipOut } };
  g[`${P}:neg`] = { class_type: "CLIPTextEncode", inputs: { text: state.negativePrompt || "", clip: clipOut } };
  g[`${P}:load`] = { class_type: "LoadImage", inputs: { image: state.i2iImage } };
  g[`${P}:vaeEnc`] = { class_type: "VAEEncode", inputs: { pixels: [`${P}:load`, 0], vae: vaeRef } };
  g[`${P}:sampler`] = ksampler(modelOut, [`${P}:pos`, 0], [`${P}:neg`, 0], [`${P}:vaeEnc`, 0], state, state.i2iDenoise ?? 0.75);
  g[`${P}:vaeDec`] = { class_type: "VAEDecode", inputs: { samples: [`${P}:sampler`, 0], vae: vaeRef } };
  g[`${P}:save`] = saveNode([`${P}:vaeDec`, 0], state);
  return g;
}

// ── INPAINT — DifferentialDiffusion + VAEEncodeForInpaint ─────────────────
export function buildInpaintGraph(state: SDXLState): Record<string, any> {
  if (!state.inpaintImage) throw new Error("Upload a source image.");
  if (!state.inpaintMaskImage) throw new Error("Upload a mask image.");

  const { g, modelRef, clipRef, vaeRef } = buildModelNodes(state);
  const { modelOut, clipOut } = applyLoraChain(g, state, modelRef, clipRef);
  const growMask = state.inpaintGrowMask ?? 6;

  g[`${P}:diffDiff`] = { class_type: "DifferentialDiffusion", inputs: { model: modelOut } };
  g[`${P}:pos`] = { class_type: "CLIPTextEncode", inputs: { text: buildPromptText(state, "inpaint"), clip: clipOut } };
  g[`${P}:neg`] = { class_type: "CLIPTextEncode", inputs: { text: state.negativePrompt || "", clip: clipOut } };
  g[`${P}:load`] = { class_type: "LoadImage", inputs: { image: state.inpaintImage } };
  g[`${P}:mask`] = { class_type: "LoadImage", inputs: { image: state.inpaintMaskImage } };
  g[`${P}:toMask`] = { class_type: "ImageToMask", inputs: { image: [`${P}:mask`, 0], channel: "red" } };
  g[`${P}:vaeEnc`] = { class_type: "VAEEncodeForInpaint", inputs: { pixels: [`${P}:load`, 0], vae: vaeRef, mask: [`${P}:toMask`, 0], grow_mask_by: growMask } };
  g[`${P}:sampler`] = {
    class_type: "KSampler",
    inputs: {
      model: [`${P}:diffDiff`, 0],
      positive: [`${P}:pos`, 0], negative: [`${P}:neg`, 0],
      latent_image: [`${P}:vaeEnc`, 0],
      seed: state.seed ?? 0, steps: state.steps ?? 20, cfg: state.cfg ?? 7,
      sampler_name: state.sampler || "euler_ancestral", scheduler: state.scheduler || "karras",
      denoise: state.inpaintDenoise ?? 0.85,
    },
  };
  g[`${P}:vaeDec`] = { class_type: "VAEDecode", inputs: { samples: [`${P}:sampler`, 0], vae: vaeRef } };
  g[`${P}:save`] = saveNode([`${P}:vaeDec`, 0], state);
  return g;
}

// ── OUTPAINT — ImagePadForOutpaint + DifferentialDiffusion ─────────────────
export function buildOutpaintGraph(state: SDXLState): Record<string, any> {
  if (!state.outpaintImage) throw new Error("Upload a source image.");
  const total = (state.outpaintUp || 0) + (state.outpaintDown || 0) + (state.outpaintLeft || 0) + (state.outpaintRight || 0);
  if (total <= 0) throw new Error("Set at least 1px of outpaint expansion.");

  const { g, modelRef, clipRef, vaeRef } = buildModelNodes(state);
  const { modelOut, clipOut } = applyLoraChain(g, state, modelRef, clipRef);

  g[`${P}:diffDiff`] = { class_type: "DifferentialDiffusion", inputs: { model: modelOut } };
  g[`${P}:pos`] = { class_type: "CLIPTextEncode", inputs: { text: buildPromptText(state, "outpaint"), clip: clipOut } };
  g[`${P}:neg`] = { class_type: "CLIPTextEncode", inputs: { text: state.negativePrompt || "", clip: clipOut } };
  g[`${P}:load`] = { class_type: "LoadImage", inputs: { image: state.outpaintImage } };
  g[`${P}:pad`] = {
    class_type: "ImagePadForOutpaint",
    inputs: {
      image: [`${P}:load`, 0],
      left: Math.max(0, state.outpaintLeft || 0),
      top: Math.max(0, state.outpaintUp || 0),
      right: Math.max(0, state.outpaintRight || 0),
      bottom: Math.max(0, state.outpaintDown || 0),
      feathering: state.outpaintFeather ?? 32,
    },
  };
  g[`${P}:vaeEnc`] = { class_type: "VAEEncode", inputs: { pixels: [`${P}:pad`, 0], vae: vaeRef } };
  g[`${P}:noiseMask`] = { class_type: "SetLatentNoiseMask", inputs: { samples: [`${P}:vaeEnc`, 0], mask: [`${P}:pad`, 1] } };
  g[`${P}:sampler`] = {
    class_type: "KSampler",
    inputs: {
      model: [`${P}:diffDiff`, 0],
      positive: [`${P}:pos`, 0], negative: [`${P}:neg`, 0],
      latent_image: [`${P}:noiseMask`, 0],
      seed: state.seed ?? 0, steps: state.steps ?? 20, cfg: state.cfg ?? 7,
      sampler_name: state.sampler || "euler_ancestral", scheduler: state.scheduler || "karras",
      denoise: 1,
    },
  };
  g[`${P}:vaeDec`] = { class_type: "VAEDecode", inputs: { samples: [`${P}:sampler`, 0], vae: vaeRef } };
  g[`${P}:save`] = saveNode([`${P}:vaeDec`, 0], state);
  return g;
}

// ── UPSCALE: ESRGAN ─────────────────────────────────────────────────────────
export function buildESRGANGraph(state: SDXLState): Record<string, any> {
  if (!state.upscaleImage) throw new Error("Upload an image to upscale.");
  if (!state.esrganModel) throw new Error("Select an ESRGAN model.");
  const g: Record<string, any> = {};
  g["UP:loader"] = { class_type: "UpscaleModelLoader", inputs: { model_name: state.esrganModel } };
  g["UP:load"] = { class_type: "LoadImage", inputs: { image: state.upscaleImage } };
  g["UP:run"] = { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: ["UP:loader", 0], image: ["UP:load", 0] } };

  const scale = state.esrganScale ?? 4;
  if (scale !== 4) {
    g["UP:scale"] = { class_type: "ImageScale", inputs: { image: ["UP:run", 0], width: 0, height: 0, upscale_method: "lanczos", crop: "disabled" } };
    g["UP:save"] = saveNode(["UP:scale", 0], state, "UP");
  } else {
    g["UP:save"] = saveNode(["UP:run", 0], state, "UP");
  }
  return g;
}

// ── UPSCALE: SDXL Refiner (I2I with refiner checkpoint) ────────────────────
export function buildRefinerUpscaleGraph(state: SDXLState): Record<string, any> {
  if (!state.upscaleImage) throw new Error("Upload an image to upscale.");
  if (!state.refinerCheckpoint) throw new Error("Select the Refiner Checkpoint in Settings.");
  const g: Record<string, any> = {};
  g["UP:ckpt"] = { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: state.refinerCheckpoint } };
  g["UP:pos"] = { class_type: "CLIPTextEncode", inputs: { text: state.promptsByMode.upscale || state.prompt || "", clip: ["UP:ckpt", 1] } };
  g["UP:neg"] = { class_type: "CLIPTextEncode", inputs: { text: state.negativePrompt || "", clip: ["UP:ckpt", 1] } };
  g["UP:load"] = { class_type: "LoadImage", inputs: { image: state.upscaleImage } };
  g["UP:vaeEnc"] = { class_type: "VAEEncode", inputs: { pixels: ["UP:load", 0], vae: ["UP:ckpt", 2] } };
  g["UP:ks"] = {
    class_type: "KSampler",
    inputs: {
      model: ["UP:ckpt", 0], positive: ["UP:pos", 0], negative: ["UP:neg", 0],
      latent_image: ["UP:vaeEnc", 0],
      seed: state.seed ?? 0,
      steps: state.upscaleRefinerSteps ?? 20,
      cfg: state.upscaleRefinerCfg ?? 7,
      sampler_name: state.sampler || "euler_ancestral",
      scheduler: state.scheduler || "karras",
      denoise: state.upscaleRefinerDenoise ?? 0.35,
    },
  };
  g["UP:vaeDec"] = { class_type: "VAEDecode", inputs: { samples: ["UP:ks", 0], vae: ["UP:ckpt", 2] } };
  g["UP:save"] = saveNode(["UP:vaeDec", 0], state, "UP");
  return g;
}

// ── UPSCALE: SEEDVR2 ─────────────────────────────────────────────────────────
export function buildSeedVR2Graph(state: SDXLState): Record<string, any> {
  if (!state.upscaleImage) throw new Error("Upload an image to upscale.");
  if (!state.upscaleDitModel || state.upscaleDitModel === "none") throw new Error("Select a DiT model.");
  if (!state.upscaleVaeModel || state.upscaleVaeModel === "none") throw new Error("Select a VAE model.");

  const s = state;
  const offload = s.upscaleOffloadDevice && s.upscaleOffloadDevice !== "none" ? s.upscaleOffloadDevice : "cpu";
  const g: Record<string, any> = {};
  g["UP:dit"] = {
    class_type: "SeedVR2LoadDiTModel",
    inputs: { model: s.upscaleDitModel, device: "cuda:0", blocks_to_swap: s.upscaleBlocksToSwap ?? 0, swap_io_components: false, offload_device: offload, cache_model: offload !== "none", attention_mode: s.upscaleAttentionMode || "sdpa" },
  };
  g["UP:vae"] = {
    class_type: "SeedVR2LoadVAEModel",
    inputs: { model: s.upscaleVaeModel, device: "cuda:0", encode_tiled: true, encode_tile_size: 1024, encode_tile_overlap: 128, decode_tiled: true, decode_tile_size: 1024, decode_tile_overlap: 128, tile_debug: "false", offload_device: offload, cache_model: false },
  };
  g["UP:load"] = { class_type: "LoadImage", inputs: { image: s.upscaleImage } };
  g["UP:run"] = {
    class_type: "SeedVR2VideoUpscaler",
    inputs: {
      image: ["UP:load", 0], dit: ["UP:dit", 0], vae: ["UP:vae", 0],
      seed: (s.seed ?? 42) % 4294967295,
      resolution: s.upscaleResolution ?? 2048, max_resolution: s.upscaleMaxResolution ?? 4096,
      batch_size: s.upscaleBatchSize ?? 1, uniform_batch_size: false,
      color_correction: s.upscaleColorCorrection || "lab", temporal_overlap: 0, prepend_frames: 0,
      input_noise_scale: s.upscaleInputNoiseScale ?? 0, latent_noise_scale: s.upscaleLatentNoiseScale ?? 0,
      offload_device: offload, enable_debug: false,
    },
  };
  g["UP:save"] = saveNode(["UP:run", 0], state, "UP");
  return g;
}

export function buildGraph(state: SDXLState): Record<string, any> {
  switch (state.mode) {
    case "t2i": return buildT2IGraph(state);
    case "i2i": return buildI2IGraph(state);
    case "inpaint": return buildInpaintGraph(state);
    case "outpaint": return buildOutpaintGraph(state);
    case "upscale": {
      const m = state.upscaleMode || "esrgan";
      if (m === "esrgan") return buildESRGANGraph(state);
      if (m === "refiner") return buildRefinerUpscaleGraph(state);
      return buildSeedVR2Graph(state);
    }
    default: throw new Error(`Unknown mode: ${state.mode}`);
  }
}
