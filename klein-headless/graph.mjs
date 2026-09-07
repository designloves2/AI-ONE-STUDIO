// graph.mjs — Flux2 Klein ComfyUI graph builder. Ported node-for-node from
// src/tools/klein/graphBuilder.ts (and the original graph_builder_klein.js).
//
// Klein does NOT assemble a graph from scratch. The backend serves a pre-made workflow JSON
// per mode (`GET /flux_klein/workflow_<name>`); this file fetches it and patches only the
// known node IDs — the graph's own correctness is guaranteed by that workflow file. So a
// running ComfyUI with the flux_klein node pack is required even for `--dry-run`.
//
// Scope: t2i / i2i / edit / inpaint / outpaint / faceswap. (SeedVR2 upscale is the same node
// set as krea2-headless / upscale-headless — out of scope here.)

import { SUBFOLDER, buildPromptText, getUseKV } from "./core-helpers.mjs";

function tag(err, stage) { err.stage = stage; return err; }

function resolveModels(state) {
  return { modelName: state.model || "", clipName: state.textEncoder || "", vaeName: state.vae || "" };
}

function requireModels(state) {
  const { modelName, clipName, vaeName } = resolveModels(state);
  if (!modelName) throw tag(new Error("No model — set `model` in the job or `selected_model` in the ComfyUI config."), "config");
  if (!clipName) throw tag(new Error("No text encoder — set `textEncoder` in the job or `selected_text_encoder` in the config."), "config");
  if (!vaeName) throw tag(new Error("No VAE — set `vae` in the job or `selected_vae` in the config."), "config");
  return { modelName, clipName, vaeName };
}

function patchModelLoader(prompt, nodeId, modelName) {
  if (!prompt[nodeId]) return;
  if (modelName.toLowerCase().endsWith(".gguf")) {
    prompt[nodeId].class_type = "UnetLoaderGGUF";
    delete prompt[nodeId].inputs.weight_dtype;
  } else {
    prompt[nodeId].class_type = "UNETLoader";
    if (!prompt[nodeId].inputs.weight_dtype) prompt[nodeId].inputs.weight_dtype = "default";
  }
  prompt[nodeId].inputs.unet_name = modelName;
}

function patchClipLoader(prompt, nodeId, clipName) {
  if (!prompt[nodeId]) return;
  prompt[nodeId].class_type = clipName.toLowerCase().endsWith(".gguf") ? "CLIPLoaderGGUF" : "CLIPLoader";
  prompt[nodeId].inputs.clip_name = clipName;
}

// T2I / Edit shared node IDs (fixed in the backend workflow JSON).
const WF = {
  model: "FK:165", textEnc: "FK:155", vae: "FK:153",
  promptPos: "FK:166", promptNeg: "FK:156",
  sampling: "FK:169", latent: "FK:170", sampler: "FK:171", saveImage: "FK:86",
  loadImage1: "FK:91", loadImage2: "FK:88",
  scaleImg1: "FK:163", scaleImg2: "FK:163b", getSize: "FK:167",
  vaeEnc1: "FK:132", vaeEnc2: "FK:232",
  refPos1: "FK:133", refNeg1: "FK:131", refPos2: "FK:233", refNeg2: "FK:231",
};

function applyLoraChain(prompt, loras, chainSrc, idPrefix) {
  const toPrev = (p) => (typeof p === "string" ? [p, 0] : p);
  let prev = chainSrc;
  (loras || []).forEach((ul, i) => {
    if (!ul.name || ul.name === "none" || ul.enabled === false || !(+(ul.strength || 0) > 0)) return;
    const id = `${idPrefix}UL${i + 1}`;
    prompt[id] = { class_type: "LoraLoaderModelOnly", inputs: { lora_name: ul.name, strength_model: +(ul.strength ?? 1), model: toPrev(prev) } };
    prev = [id, 0];
  });
  return toPrev(prev);
}

function set(prompt, id, key, val) {
  if (prompt[id]) prompt[id].inputs[key] = val;
}

function patchSave(prompt, saveId, state) {
  if (!prompt[saveId]) return;
  const folder = state.saveSubfolder || SUBFOLDER;
  if (state.outputMode === "preview") {
    prompt[saveId].class_type = "PreviewImage";
    delete prompt[saveId].inputs.filename_prefix;
  } else {
    prompt[saveId].inputs.filename_prefix = `${folder}/FK`;
  }
}

function patchT2IBase(prompt, state, samplerNodeId) {
  const useKV = getUseKV(state);
  const isBase = (state.model || "").toLowerCase().includes("base");
  const { modelName, clipName, vaeName } = resolveModels(state);

  patchModelLoader(prompt, WF.model, modelName);
  patchClipLoader(prompt, WF.textEnc, clipName);
  set(prompt, WF.vae, "vae_name", vaeName);

  let modelSrc = WF.model;
  if (useKV) {
    prompt["FK:KV"] = { class_type: "FluxKVCache", inputs: { model: [WF.model, 0] }, _meta: { title: "Flux KV Cache" } };
    modelSrc = "FK:KV";
  }

  const finalRef = applyLoraChain(prompt, state.loras, modelSrc, "FK:");
  set(prompt, WF.sampling, "model", finalRef);

  const steps = state.steps || 4;
  const cfg = state.cfg !== undefined ? state.cfg : isBase ? 5 : 1;
  set(prompt, samplerNodeId, "steps", steps);
  set(prompt, samplerNodeId, "cfg", cfg);
  set(prompt, samplerNodeId, "sampler_name", state.sampler || "euler");
  set(prompt, samplerNodeId, "scheduler", state.scheduler || "simple");
  set(prompt, samplerNodeId, "seed", state.seed ?? 0);
}

function metaFrom(prompt, saveNode, samplerId) {
  const s = prompt[samplerId]?.inputs || {};
  return { saveNode, steps: s.steps, seed: s.seed, samplerUsed: s.sampler_name, cfg: s.cfg, denoise: s.denoise };
}

// ── T2I ─────────────────────────────────────────────────────────────────
export async function buildT2IGraph(state, loadWorkflow) {
  requireModels(state);
  const prompt = await loadWorkflow("t2i");
  patchT2IBase(prompt, state, WF.sampler);
  set(prompt, WF.promptPos, "text", buildPromptText(state, "t2i"));
  set(prompt, WF.promptNeg, "text", state.negativePrompt || "");
  set(prompt, WF.latent, "width", state.width || 1024);
  set(prompt, WF.latent, "height", state.height || 1024);
  set(prompt, WF.sampler, "denoise", 1);
  patchSave(prompt, WF.saveImage, state);
  return { graph: prompt, meta: { ...metaFrom(prompt, WF.saveImage, WF.sampler), width: prompt[WF.latent]?.inputs.width, height: prompt[WF.latent]?.inputs.height } };
}

// ── I2I ─────────────────────────────────────────────────────────────────
export async function buildI2IGraph(state, loadWorkflow) {
  if (!state.i2iImage) throw tag(new Error("i2i mode needs `i2iImage` (an absolute path)."), "config");
  requireModels(state);
  const prompt = await loadWorkflow("i2i");
  const useKV = getUseKV(state);

  const { modelName, clipName, vaeName } = resolveModels(state);
  patchModelLoader(prompt, "FK:165", modelName);
  patchClipLoader(prompt, "FK:155", clipName);
  set(prompt, "FK:153", "vae_name", vaeName);
  set(prompt, "FK:166", "text", buildPromptText(state, "i2i"));
  set(prompt, "FKI2I:img", "image", state.i2iImage);

  if (state.i2iWidth && state.i2iHeight) {
    prompt["FKI2I:scale"] = { class_type: "ImageScale", inputs: { image: ["FKI2I:img", 0], width: state.i2iWidth, height: state.i2iHeight, upscale_method: "lanczos", crop: "disabled" } };
    set(prompt, "FKI2I:vae", "pixels", ["FKI2I:scale", 0]);
  }

  let i2iModelSrc = "FK:165";
  if (useKV) {
    prompt["FK:KV"] = { class_type: "FluxKVCache", inputs: { model: ["FK:165", 0] }, _meta: { title: "Flux KV Cache" } };
    i2iModelSrc = "FK:KV";
  }
  const loraRef = applyLoraChain(prompt, state.loras, i2iModelSrc, "FK:");
  set(prompt, "FK:169", "model", loraRef);

  const isBase = (state.model || "").toLowerCase().includes("base");
  set(prompt, "FK:171", "seed", state.seed ?? 0);
  set(prompt, "FK:171", "steps", state.steps || 4);
  set(prompt, "FK:171", "cfg", state.cfg !== undefined ? state.cfg : isBase ? 5 : 1);
  set(prompt, "FK:171", "denoise", state.i2iDenoise ?? 0.75);
  set(prompt, "FK:171", "sampler_name", state.sampler || "euler");
  set(prompt, "FK:171", "scheduler", state.scheduler || "simple");

  patchSave(prompt, "FK:86", state);
  return { graph: prompt, meta: metaFrom(prompt, "FK:86", "FK:171") };
}

// ── Edit (multi-reference) ──────────────────────────────────────────────
export async function buildEditGraph(state, loadWorkflow) {
  if (!state.editImage1) throw tag(new Error("edit mode needs `editImage1` (an absolute path)."), "config");
  requireModels(state);
  const prompt = await loadWorkflow("edit");
  patchT2IBase(prompt, state, WF.sampler);
  set(prompt, WF.promptPos, "text", buildPromptText(state, "edit"));
  set(prompt, WF.promptNeg, "text", state.negativePrompt || "");
  set(prompt, WF.loadImage1, "image", state.editImage1);
  set(prompt, WF.sampler, "denoise", 1);
  patchSave(prompt, WF.saveImage, state);

  const src = state.editSizeSource || "img1";
  const img2 = state.editImage2 || state.editRefImages?.[0]?.filename || null;
  const hasImg2 = !!img2;

  if (src === "img1") {
    set(prompt, WF.vaeEnc1, "pixels", [WF.loadImage1, 0]);
  } else {
    if (prompt[WF.latent]) {
      prompt[WF.latent].inputs.width = state.width || 1024;
      prompt[WF.latent].inputs.height = state.height || 1024;
    }
    set(prompt, WF.vaeEnc1, "pixels", [WF.scaleImg1, 0]);
  }

  if (hasImg2) {
    set(prompt, WF.loadImage2, "image", img2);
    set(prompt, WF.sampler, "positive", [WF.refPos2, 0]);
    set(prompt, WF.sampler, "negative", [WF.refNeg2, 0]);
  } else {
    [WF.loadImage2, WF.scaleImg2, WF.vaeEnc2, WF.refPos2, WF.refNeg2].forEach((id) => delete prompt[id]);
    set(prompt, WF.sampler, "positive", [WF.refPos1, 0]);
    set(prompt, WF.sampler, "negative", [WF.refNeg1, 0]);
  }

  return { graph: prompt, meta: metaFrom(prompt, WF.saveImage, WF.sampler) };
}

// ── Inpaint ─────────────────────────────────────────────────────────────
export async function buildInpaintGraph(state, loadWorkflow) {
  if (!state.inpaintImage) throw tag(new Error("inpaint needs `inpaintImage` (an absolute path)."), "config");
  if (!state.inpaintMaskImage) throw tag(new Error("inpaint needs `inpaintMaskImage` (an absolute path — a black/white mask)."), "config");
  requireModels(state);
  const prompt = await loadWorkflow("inpaint");

  const WFI = { model: "FKI:194", kv: "FKI:216", textEnc: "FKI:195", vae: "FKI:196", promptPos: "FKI:6", loadImg: "FKI:198", loadMask: "FKI:199", sampler: "FKI:163", save: "FKI:203" };

  const useKV = getUseKV(state);
  const isBase = (state.model || "").toLowerCase().includes("base");
  const { modelName, clipName, vaeName } = resolveModels(state);
  patchModelLoader(prompt, WFI.model, modelName);
  patchClipLoader(prompt, WFI.textEnc, clipName);
  set(prompt, WFI.vae, "vae_name", vaeName);
  set(prompt, WFI.promptPos, "text", buildPromptText(state, "inpaint"));
  set(prompt, WFI.loadImg, "image", state.inpaintImage);
  set(prompt, WFI.loadMask, "image", state.inpaintMaskImage);

  const modelSrc = useKV ? WFI.kv : WFI.model;
  if (!useKV) delete prompt[WFI.kv];
  const loraRef = applyLoraChain(prompt, state.loras, modelSrc, "FKI:");
  const samplingId = Object.keys(prompt).find((k) => prompt[k].class_type === "ModelSamplingAuraFlow");
  if (samplingId) set(prompt, samplingId, "model", loraRef);
  else set(prompt, WFI.sampler, "model", loraRef);

  set(prompt, WFI.sampler, "seed", state.seed ?? 0);
  set(prompt, WFI.sampler, "steps", state.steps || 4);
  set(prompt, WFI.sampler, "cfg", state.cfg !== undefined ? state.cfg : isBase ? 5 : 1);
  set(prompt, WFI.sampler, "sampler_name", state.sampler || "euler");
  set(prompt, WFI.sampler, "scheduler", state.scheduler || "simple");
  set(prompt, WFI.sampler, "denoise", state.inpaintDenoise ?? 0.85);

  patchSave(prompt, WFI.save, state);
  return { graph: prompt, meta: metaFrom(prompt, WFI.save, WFI.sampler) };
}

// ── Outpaint (edit workflow + ImagePadKJ) ───────────────────────────────
export async function buildOutpaintGraph(state, loadWorkflow) {
  if (!state.outpaintImage) throw tag(new Error("outpaint needs `outpaintImage` (an absolute path)."), "config");
  const total = (state.outpaintUp || 0) + (state.outpaintDown || 0) + (state.outpaintLeft || 0) + (state.outpaintRight || 0);
  if (total <= 0) throw tag(new Error("outpaint needs at least one of outpaintUp/Down/Left/Right > 0."), "config");
  requireModels(state);

  const prompt = await loadWorkflow("edit");
  patchT2IBase(prompt, state, WF.sampler);

  const padR = state.outpaintPadR ?? 0, padG = state.outpaintPadG ?? 0, padB = state.outpaintPadB ?? 0;
  const padColor = `rgb(${padR}, ${padG}, ${padB})`;
  const sysPrompt = `Extend the composition of this image. Replace all black or ${padColor} areas with a logical continuation of the background and foreground. Ensure the transition is invisible and the new elements perfectly match the perspective and color palette of the original image. Scene description: `;
  set(prompt, WF.promptPos, "text", sysPrompt + buildPromptText(state, "outpaint"));
  set(prompt, WF.promptNeg, "text", state.negativePrompt || "");
  set(prompt, WF.loadImage1, "image", state.outpaintImage);
  prompt["FKO:pad"] = {
    class_type: "ImagePadKJ",
    inputs: {
      image: [WF.loadImage1, 0],
      left: Math.max(0, state.outpaintLeft || 0),
      top: Math.max(0, state.outpaintUp || 0),
      right: Math.max(0, state.outpaintRight || 0),
      bottom: Math.max(0, state.outpaintDown || 0),
      extra_padding: 0,
      pad_mode: "color",
      color: `${padR}, ${padG}, ${padB}`,
    },
  };
  set(prompt, WF.scaleImg1, "image", ["FKO:pad", 0]);
  set(prompt, WF.getSize, "image", [WF.scaleImg1, 0]);

  [WF.loadImage2, WF.scaleImg2, WF.vaeEnc2, WF.refPos2, WF.refNeg2].forEach((id) => delete prompt[id]);
  set(prompt, WF.sampler, "positive", [WF.refPos1, 0]);
  set(prompt, WF.sampler, "negative", [WF.refNeg1, 0]);

  set(prompt, WF.sampler, "denoise", 1.0);
  patchSave(prompt, WF.saveImage, state);
  return { graph: prompt, meta: metaFrom(prompt, WF.saveImage, WF.sampler) };
}

// ── Faceswap (needs the BFS lora on the server) ─────────────────────────
export async function buildFaceswapGraph(state, loadWorkflow) {
  if (!state.faceswapTarget) throw tag(new Error("faceswap needs `faceswapTarget` (an absolute path — the image to swap onto)."), "config");
  if (!state.faceswapSource) throw tag(new Error("faceswap needs `faceswapSource` (an absolute path — the source face)."), "config");
  requireModels(state);
  const prompt = await loadWorkflow("faceswap");

  const WFF = { model: "FKF:225", lora: "FKF:226", textEnc: "FKF:223", vae: "FKF:235", target: "FKF:234", source: "FKF:236", sampling: "FKF:239", sampler: "FKF:228", save: "FKF:232" };

  const useKV = getUseKV(state);
  const isBase = (state.model || "").toLowerCase().includes("base");
  const bfsLora = state.bfsLora && state.bfsLora.name && state.bfsLora.name !== "none" && state.bfsLora.enabled !== false ? state.bfsLora : null;

  const { modelName, clipName, vaeName } = resolveModels(state);
  patchModelLoader(prompt, WFF.model, modelName);
  patchClipLoader(prompt, WFF.textEnc, clipName);
  set(prompt, WFF.vae, "vae_name", vaeName);
  set(prompt, WFF.target, "image", state.faceswapTarget);
  set(prompt, WFF.source, "image", state.faceswapSource);

  let baseModelSrc = WFF.model;
  if (useKV) {
    prompt["FK:KV"] = { class_type: "FluxKVCache", inputs: { model: [WFF.model, 0] }, _meta: { title: "Flux KV Cache" } };
    baseModelSrc = "FK:KV";
  }

  if (bfsLora) {
    set(prompt, WFF.lora, "lora_name", bfsLora.name);
    set(prompt, WFF.lora, "strength_model", bfsLora.strength ?? 1);
    if (prompt[WFF.lora]) prompt[WFF.lora].inputs.model = [baseModelSrc, 0];
    set(prompt, WFF.sampling, "model", [WFF.lora, 0]);
  } else {
    delete prompt[WFF.lora];
    set(prompt, WFF.sampling, "model", [baseModelSrc, 0]);
  }

  const effectivePrompt = buildPromptText(state, "faceswap");
  if (effectivePrompt.trim()) set(prompt, "FKF:227", "text", effectivePrompt);

  set(prompt, WFF.sampler, "seed", state.seed ?? 0);
  set(prompt, WFF.sampler, "steps", state.steps || 4);
  set(prompt, WFF.sampler, "cfg", state.cfg !== undefined ? state.cfg : isBase ? 5 : 1);
  set(prompt, WFF.sampler, "sampler_name", state.sampler || "euler");
  set(prompt, WFF.sampler, "scheduler", state.scheduler || "simple");
  set(prompt, WFF.sampler, "denoise", state.faceswapDenoise ?? 1.0);

  patchSave(prompt, WFF.save, state);
  return { graph: prompt, meta: metaFrom(prompt, WFF.save, WFF.sampler) };
}

/** `loadWorkflow(name)` -> the pre-made workflow JSON (from `GET /flux_klein/workflow_<name>`). */
export async function buildGraph(state, loadWorkflow) {
  switch (state.mode) {
    case "i2i": return buildI2IGraph(state, loadWorkflow);
    case "edit": return buildEditGraph(state, loadWorkflow);
    case "inpaint": return buildInpaintGraph(state, loadWorkflow);
    case "outpaint": return buildOutpaintGraph(state, loadWorkflow);
    case "faceswap": return buildFaceswapGraph(state, loadWorkflow);
    default: return buildT2IGraph(state, loadWorkflow);
  }
}
