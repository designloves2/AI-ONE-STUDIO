// graph.mjs — Z-Image Turbo graph builder (t2i / i2i slice).
// Ported node-for-node from src/tools/zimage/graphBuilder.ts (originally web/zimage/
// graph_builder.js). Key trait vs Krea2: ModelSamplingAuraFlow(shift), GGUF clip type
// "lumina2". Inpaint/rebg/controlnet/face_redraw and SeedVR2 upscale are out of scope here.

import { SUBFOLDER } from "./core-helpers.mjs";

function buildPromptText(state) {
  const parts = [state.prompt || ""];
  (state.loras || []).forEach((l) => {
    if (l.enabled !== false && l.name && l.name !== "none" && l.triggerWord) parts.push(l.triggerWord);
  });
  if (state.promptSuffix) parts.push(state.promptSuffix);
  return parts.filter(Boolean).join(", ");
}

function unetNode(name) {
  if ((name || "").toLowerCase().endsWith(".gguf")) return { class_type: "UnetLoaderGGUF", inputs: { unet_name: name } };
  return { class_type: "UNETLoader", inputs: { unet_name: name, weight_dtype: "default" } };
}
function clipNode(name) {
  if ((name || "").toLowerCase().endsWith(".gguf")) return { class_type: "CLIPLoaderGGUF", inputs: { clip_name: name, type: "lumina2" } };
  return { class_type: "CLIPLoader", inputs: { clip_name: name, type: "lumina2", device: "default" } };
}

function withLoraChain(modelLink, loras) {
  const graph = {};
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

function baseGraph(state) {
  if (!state.model) throw tag(new Error("No model — set `model` in the job or `selected_model` in the ComfyUI config."), "config");
  if (!state.textEncoder) throw tag(new Error("No text encoder — set `textEncoder` in the job or `selected_text_encoder` in the config."), "config");
  if (!state.vae) throw tag(new Error("No VAE — set `vae` in the job or `selected_vae` in the config."), "config");
  const g = {};
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

function saveNode(link, state) {
  if (state.outputMode === "preview") return { class_type: "PreviewImage", inputs: { images: link } };
  const folder = state.saveSubfolder || SUBFOLDER;
  return { class_type: "SaveImage", inputs: { images: link, filename_prefix: `${folder}/ZIT` } };
}

function ksampler(state, latent, denoise) {
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

export function buildT2IGraph(state) {
  const g = baseGraph(state);
  g["ZIT:latent"] = { class_type: "EmptySD3LatentImage", inputs: { width: state.width || 1024, height: state.height || 1536, batch_size: 1 } };
  g["ZIT:sampler"] = ksampler(state, ["ZIT:latent", 0], 1);
  g["ZIT:vaeDecode"] = { class_type: "VAEDecode", inputs: { samples: ["ZIT:sampler", 0], vae: ["ZIT:vae", 0] } };
  g["ZIT:save"] = saveNode(["ZIT:vaeDecode", 0], state);
  return { graph: g, meta: { saveNode: "ZIT:save", width: g["ZIT:latent"].inputs.width, height: g["ZIT:latent"].inputs.height, steps: g["ZIT:sampler"].inputs.steps, seed: g["ZIT:sampler"].inputs.seed, samplerUsed: g["ZIT:sampler"].inputs.sampler_name, shift: state.shift ?? 3 } };
}

export function buildI2IGraph(state) {
  if (!state.i2iImage) throw tag(new Error("i2i mode needs `i2iImage` (an absolute path)."), "config");
  const g = baseGraph(state);
  g["ZIT:load"] = { class_type: "LoadImage", inputs: { image: state.i2iImage } };
  let pixSrc = ["ZIT:load", 0];
  if (state.i2iWidth && state.i2iHeight) {
    g["ZIT:scale"] = { class_type: "ImageScale", inputs: { image: ["ZIT:load", 0], width: state.i2iWidth, height: state.i2iHeight, upscale_method: "lanczos", crop: "disabled" } };
    pixSrc = ["ZIT:scale", 0];
  }
  g["ZIT:vaeEnc"] = { class_type: "VAEEncode", inputs: { pixels: pixSrc, vae: ["ZIT:vae", 0] } };
  g["ZIT:sampler"] = ksampler(state, ["ZIT:vaeEnc", 0], state.i2iDenoise ?? 0.75);
  g["ZIT:vaeDecode"] = { class_type: "VAEDecode", inputs: { samples: ["ZIT:sampler", 0], vae: ["ZIT:vae", 0] } };
  g["ZIT:save"] = saveNode(["ZIT:vaeDecode", 0], state);
  return { graph: g, meta: { saveNode: "ZIT:save", denoise: g["ZIT:sampler"].inputs.denoise, steps: g["ZIT:sampler"].inputs.steps, seed: g["ZIT:sampler"].inputs.seed, samplerUsed: g["ZIT:sampler"].inputs.sampler_name, shift: state.shift ?? 3 } };
}

export function buildGraph(state) {
  return state.mode === "i2i" ? buildI2IGraph(state) : buildT2IGraph(state);
}

function tag(err, stage) { err.stage = stage; return err; }
