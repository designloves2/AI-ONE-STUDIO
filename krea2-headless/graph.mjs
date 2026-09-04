// graph.mjs — Krea2 ComfyUI API graph builder (t2i / i2i slice).
// Ported node-for-node from src/tools/krea2/graphBuilder.ts — node id strings, class_type names
// and input field names kept identical to the studio build (and to the original
// graph_builder_krea2.js). Identity Edit and SeedVR2 upscale are out of scope here.

import { SUBFOLDER, safeDepthCkpt, buildPromptText, controlOutputSize, controlLoraForType } from "./core-helpers.mjs";

function unetNode(name) {
  if ((name || "").toLowerCase().endsWith(".gguf")) return { class_type: "UnetLoaderGGUF", inputs: { unet_name: name } };
  return { class_type: "UNETLoader", inputs: { unet_name: name, weight_dtype: "default" } };
}

function withLoraChain(modelLink, loras) {
  const graph = {};
  let out = modelLink;
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

function saveNode(link, state) {
  if (state.outputMode === "preview") return { class_type: "PreviewImage", inputs: { images: link } };
  const folder = state.saveSubfolder || SUBFOLDER;
  return { class_type: "SaveImage", inputs: { images: link, filename_prefix: `${folder}/K2` } };
}

function baseGraph(state, promptText) {
  const modelName = state.model || "";
  const clipName = state.textEncoder || "";
  const vaeName = state.vae || "";
  if (!modelName) throw tag(new Error("No model — set `model` in the job or `selected_model` in the ComfyUI config."), "config");
  if (!clipName) throw tag(new Error("No text encoder — set `textEncoder` in the job or `selected_text_encoder` in the config."), "config");
  if (!vaeName) throw tag(new Error("No VAE — set `vae` in the job or `selected_vae` in the config."), "config");

  const g = {};
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
  if ((state.negativePrompt || "").trim()) {
    g["K2:negative"] = { class_type: "CLIPTextEncode", inputs: { clip: ["K2:clip", 0], text: state.negativePrompt } };
  } else {
    g["K2:negative"] = { class_type: "ConditioningZeroOut", inputs: { conditioning: ["K2:positive", 0] } };
  }

  return { g, modelOut };
}

function addPreprocessor(g, prefix, imgLink, state, type) {
  if (type === "canny") {
    g[`${prefix}:pre`] = { class_type: "CannyEdgePreprocessor", inputs: { image: imgLink, low_threshold: state.cannyLow ?? 100, high_threshold: state.cannyHigh ?? 200, resolution: state.preprocResolution ?? 512 } };
  } else {
    g[`${prefix}:pre`] = { class_type: "DepthAnythingV2Preprocessor", inputs: { image: imgLink, ckpt_name: safeDepthCkpt(state.depthCkpt), resolution: state.preprocResolution ?? 512 } };
  }
  return [`${prefix}:pre`, 0];
}

function applyControlChain(g, state, mode, modelOut, latentRef) {
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

export function buildT2IGraph(state) {
  const { g, modelOut } = baseGraph(state, buildPromptText(state, "t2i"));

  const t2iFit = controlOutputSize(state, "t2i");
  g["K2:latent"] = { class_type: "EmptyLatentImage", inputs: { width: t2iFit ? t2iFit.W : state.width || 1024, height: t2iFit ? t2iFit.H : state.height || 1024, batch_size: 1 } };

  const cc = applyControlChain(g, state, "t2i", modelOut, ["K2:latent", 0]);
  const t2iLatent = cc.latentOverride || ["K2:latent", 0];

  g["K2:sampler"] = {
    class_type: "KSampler",
    inputs: { model: cc.modelOut, positive: ["K2:positive", 0], negative: ["K2:negative", 0], latent_image: t2iLatent, seed: state.seed ?? 0, steps: state.steps ?? 8, cfg: state.cfg ?? 1, sampler_name: state.sampler || "euler", scheduler: state.scheduler || "simple", denoise: 1 },
  };
  g["K2:decode"] = { class_type: "VAEDecode", inputs: { samples: ["K2:sampler", 0], vae: ["K2:vae", 0] } };
  g["K2:save"] = saveNode(["K2:decode", 0], state);
  return { graph: g, meta: { saveNode: "K2:save", width: g["K2:latent"].inputs.width, height: g["K2:latent"].inputs.height, steps: g["K2:sampler"].inputs.steps, seed: g["K2:sampler"].inputs.seed, samplerUsed: g["K2:sampler"].inputs.sampler_name } };
}

export function buildI2IGraph(state) {
  if (!state.i2iImage) throw tag(new Error("i2i mode needs `i2iImage` (an absolute path)."), "config");
  const { g, modelOut } = baseGraph(state, buildPromptText(state, "i2i"));

  g["K2:load"] = { class_type: "LoadImage", inputs: { image: state.i2iImage } };
  let k2PixSrc = ["K2:load", 0];
  if (state.i2iWidth && state.i2iHeight) {
    g["K2:i2iScale"] = { class_type: "ImageScale", inputs: { image: ["K2:load", 0], width: state.i2iWidth, height: state.i2iHeight, upscale_method: "lanczos", crop: "disabled" } };
    k2PixSrc = ["K2:i2iScale", 0];
  }
  g["K2:encode"] = { class_type: "VAEEncode", inputs: { pixels: k2PixSrc, vae: ["K2:vae", 0] } };

  const cc = applyControlChain(g, state, "i2i", modelOut, ["K2:encode", 0]);
  const i2iLatent = cc.latentOverride || ["K2:encode", 0];

  g["K2:sampler"] = {
    class_type: "KSampler",
    inputs: { model: cc.modelOut, positive: ["K2:positive", 0], negative: ["K2:negative", 0], latent_image: i2iLatent, seed: state.seed ?? 0, steps: state.steps ?? 8, cfg: state.cfg ?? 1, sampler_name: state.sampler || "euler", scheduler: state.scheduler || "simple", denoise: cc.denoiseOverride ?? state.i2iDenoise ?? 0.75 },
  };
  g["K2:decode"] = { class_type: "VAEDecode", inputs: { samples: ["K2:sampler", 0], vae: ["K2:vae", 0] } };
  g["K2:save"] = saveNode(["K2:decode", 0], state);
  return { graph: g, meta: { saveNode: "K2:save", denoise: g["K2:sampler"].inputs.denoise, steps: g["K2:sampler"].inputs.steps, seed: g["K2:sampler"].inputs.seed, samplerUsed: g["K2:sampler"].inputs.sampler_name } };
}

export function buildGraph(state) {
  return state.mode === "i2i" ? buildI2IGraph(state) : buildT2IGraph(state);
}

function tag(err, stage) { err.stage = stage; return err; }
