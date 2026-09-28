// graph.mjs — QWEN IMAGE 2.1 graph builder. Ported node-for-node from
// src/tools/qwen21/graphBuilder.ts (t2i / i2i / ref2i / edit / pose slice only -- inpaint,
// outpaint and upscale are out of scope for this headless generator and are NOT ported).
//
// Key traits vs zimage/klein: TextEncodeQwenImage21 does clip/vae/prompt/negative_prompt/
// resolution + up to 10 images.image_N directly, producing (positive, negative, latent) in one
// node -- there is no separate VAEEncode/reference-latent chain. Model Sampling is
// ModelSamplingFlux (max_shift/base_shift), plus QwenImage21Cache (device="auto",
// dtype="default" -- required inputs per /object_info, hardcoded here just like the web port)
// and an optional PathchSageAttentionKJ toggle.

import { SUBFOLDER, POSE_SYSTEM_PROMPT_DEFAULT, POSE_SAM3D_MODEL_DEFAULT } from "./core-helpers.mjs";

const P = "Q21";

function tag(err, stage) { err.stage = stage; return err; }

function saveNode(link, state) {
  const folder = state.saveSubfolder || SUBFOLDER;
  if (state.outputMode === "preview") return { class_type: "PreviewImage", inputs: { images: link } };
  return { class_type: "SaveImage", inputs: { images: link, filename_prefix: `${folder}/Q21` } };
}

function buildPromptText(state, mode) {
  const base = mode in (state.promptsByMode || {}) ? state.promptsByMode[mode] : state.prompt || "";
  const parts = [base];
  (state.loras || []).forEach((l) => {
    if (l.enabled !== false && l.name && l.name !== "none" && l.triggerWord) parts.push(l.triggerWord);
  });
  if (state.promptSuffix) parts.push(state.promptSuffix);
  return parts.filter(Boolean).join(", ");
}

function buildBaseGraph(state) {
  const model = state.model || "";
  const clip = state.textEncoder || "";
  const vae = state.vae || "";
  if (!model) throw tag(new Error("No model selected — set `model` in the job or configure it in the ComfyUI config."), "config");
  if (!clip) throw tag(new Error("No text encoder selected — set `textEncoder` in the job or configure it in the ComfyUI config."), "config");
  if (!vae) throw tag(new Error("No VAE selected — set `vae` in the job or configure it in the ComfyUI config."), "config");

  const g = {};

  if (model.toLowerCase().endsWith(".gguf")) {
    g[`${P}:unet`] = { class_type: "UnetLoaderGGUF", inputs: { unet_name: model } };
  } else {
    g[`${P}:unet`] = { class_type: "UNETLoader", inputs: { unet_name: model, weight_dtype: "default" } };
  }
  // CLIP -- Qwen3-VL text encoder (2.1-specific; differs from 2511's Qwen2.5-VL)
  g[`${P}:clip`] = { class_type: "CLIPLoader", inputs: { clip_name: clip, type: "qwen_image", device: "default" } };
  g[`${P}:vae`] = { class_type: "VAELoader", inputs: { vae_name: vae } };

  let modelOut = [`${P}:unet`, 0];

  (state.loras || []).forEach((lora, i) => {
    if (!lora.name || lora.name === "none" || lora.enabled === false || !(+(lora.strength || 0) > 0)) return;
    const id = `${P}:lora${i}`;
    g[id] = { class_type: "LoraLoaderModelOnly", inputs: { model: modelOut, lora_name: lora.name, strength_model: +(lora.strength ?? 1) } };
    modelOut = [id, 0];
  });

  // ModelSamplingFlux -- 2.1 uses max_shift/base_shift (not 2511's AuraFlow+CFGNorm combo)
  g[`${P}:modelSamp`] = {
    class_type: "ModelSamplingFlux",
    inputs: { model: modelOut, max_shift: state.maxShift ?? 0.69, base_shift: state.baseShift ?? 0.5, width: state.width || 1024, height: state.height || 1024 },
  };
  modelOut = [`${P}:modelSamp`, 0];

  // QwenImage21Cache -- device/dtype are required inputs per /object_info even though the node
  // UI doesn't expose them; always hardcoded into the graph (omitting them -> "Required input
  // is missing").
  if (state.useCache !== false) {
    g[`${P}:cache`] = { class_type: "QwenImage21Cache", inputs: { model: modelOut, device: "auto", dtype: "default" } };
    modelOut = [`${P}:cache`, 0];
  }

  if (state.useSageAttention) {
    g[`${P}:sage`] = { class_type: "PathchSageAttentionKJ", inputs: { model: modelOut, sage_attention: "auto" } };
    modelOut = [`${P}:sage`, 0];
  }

  return { g, modelLink: modelOut, clipLink: [`${P}:clip`, 0], vaeLink: [`${P}:vae`, 0] };
}

// TextEncodeQwenImage21 wired with 0-10 reference images. latentLink is only meaningful (i.e.
// node-produced) when at least one image is attached.
function addConditioning(g, clipLink, vaeLink, positiveText, negativeText, resolution, imageLinks) {
  const inputs = { clip: clipLink, vae: vaeLink, prompt: positiveText || "", negative_prompt: negativeText || "", resolution: resolution || 1024 };
  (imageLinks || []).slice(0, 10).forEach((link, i) => {
    inputs[`images.image_${i + 1}`] = link;
  });
  g[`${P}:enc`] = { class_type: "TextEncodeQwenImage21", inputs };
  return { posLink: [`${P}:enc`, 0], negLink: [`${P}:enc`, 1], latentLink: [`${P}:enc`, 2] };
}

function addKSampler(g, modelLink, latentLink, state, denoise, posLink, negLink) {
  g[`${P}:sampler`] = {
    class_type: "KSampler",
    inputs: {
      model: modelLink,
      positive: posLink,
      negative: negLink,
      latent_image: latentLink,
      seed: state.seed ?? 0,
      steps: state.steps ?? 20,
      cfg: state.cfg ?? 1.0,
      sampler_name: state.sampler || "euler",
      scheduler: state.scheduler || "simple",
      denoise,
    },
  };
}

// Ref to Image / Edit reference image auto-downscale -- 0 (or unset) means "send as uploaded".
// ImageScaleToTotalPixels is a ComfyUI core node, no pack-availability check needed.
function resizeToMp(g, key, imageLink, mp) {
  if (!((mp ?? 0) > 0)) return imageLink;
  g[key] = { class_type: "ImageScaleToTotalPixels", inputs: { image: imageLink, upscale_method: "lanczos", megapixels: mp, resolution_steps: 1 } };
  return [key, 0];
}

function addDecodeAndSave(g, vaeLink, state) {
  g[`${P}:decode`] = { class_type: "VAEDecode", inputs: { samples: [`${P}:sampler`, 0], vae: vaeLink } };
  g[`${P}:save`] = saveNode([`${P}:decode`, 0], state);
}

// ── T2I ─────────────────────────────────────────────────────────────────
export function buildT2IGraph(state) {
  const { g, modelLink, clipLink, vaeLink } = buildBaseGraph(state);
  const promptText = buildPromptText(state, "t2i");
  g[`${P}:latent`] = { class_type: "EmptyLatentImage", inputs: { width: state.width || 1024, height: state.height || 1024, batch_size: 1 } };
  const { posLink, negLink } = addConditioning(g, clipLink, vaeLink, promptText, state.negativePrompt || "", state.resolution || state.width || 1024, []);
  addKSampler(g, modelLink, [`${P}:latent`, 0], state, 1.0, posLink, negLink);
  addDecodeAndSave(g, vaeLink, state);
  return {
    graph: g,
    meta: { saveNode: `${P}:save`, width: g[`${P}:latent`].inputs.width, height: g[`${P}:latent`].inputs.height, steps: g[`${P}:sampler`].inputs.steps, seed: g[`${P}:sampler`].inputs.seed, samplerUsed: g[`${P}:sampler`].inputs.sampler_name, denoise: g[`${P}:sampler`].inputs.denoise },
  };
}

// ── I2I (plain) ─────────────────────────────────────────────────────────
export function buildI2IGraph(state) {
  if (!state.i2iImage) throw tag(new Error("i2i mode needs `i2iImage` (an absolute path)."), "config");
  const { g, modelLink, clipLink, vaeLink } = buildBaseGraph(state);
  const promptText = buildPromptText(state, "i2i");
  g[`${P}:loadImg1`] = { class_type: "LoadImage", inputs: { image: state.i2iImage } };
  let imgLink = [`${P}:loadImg1`, 0];
  if (state.i2iWidth && state.i2iHeight) {
    g[`${P}:i2iScale`] = { class_type: "ImageScale", inputs: { image: imgLink, width: state.i2iWidth, height: state.i2iHeight, upscale_method: "lanczos", crop: "disabled" } };
    imgLink = [`${P}:i2iScale`, 0];
  }
  const { posLink, negLink, latentLink } = addConditioning(g, clipLink, vaeLink, promptText, state.negativePrompt || "", state.i2iWidth || state.width || 1024, [imgLink]);
  addKSampler(g, modelLink, latentLink, state, state.i2iDenoise ?? 0.75, posLink, negLink);
  addDecodeAndSave(g, vaeLink, state);
  return { graph: g, meta: { saveNode: `${P}:save`, steps: g[`${P}:sampler`].inputs.steps, seed: g[`${P}:sampler`].inputs.seed, samplerUsed: g[`${P}:sampler`].inputs.sampler_name, denoise: g[`${P}:sampler`].inputs.denoise } };
}

// ── Ref to Image (up to 10 refs, its own output size) ──────────────────────
// Web's state.mode "i2i" + i2iSubMode "ref2img" flattened into its own top-level job.mode
// "ref2i" for a clearer external job spec (see README "mode mapping").
export function buildRefToImageGraph(state) {
  const refs = (state.refImages || []).filter((r) => r && r.filename).slice(0, 10);
  if (!refs.length) throw tag(new Error("ref2i mode needs at least one entry in `refImages`."), "config");
  const { g, modelLink, clipLink, vaeLink } = buildBaseGraph(state);
  const promptText = buildPromptText(state, "ref2img");

  const imageLinks = refs.map((r, i) => {
    const id = `${P}:refImg${i}`;
    g[id] = { class_type: "LoadImage", inputs: { image: r.filename } };
    return resizeToMp(g, `${P}:refImgMp${i}`, [id, 0], state.refMaxMegapixels);
  });

  g[`${P}:latent`] = { class_type: "EmptyLatentImage", inputs: { width: state.refWidth || 1024, height: state.refHeight || 1024, batch_size: 1 } };
  const { posLink, negLink } = addConditioning(g, clipLink, vaeLink, promptText, state.negativePrompt || "", state.refWidth || 1024, imageLinks);
  addKSampler(g, modelLink, [`${P}:latent`, 0], state, state.refDenoise ?? 1.0, posLink, negLink);
  addDecodeAndSave(g, vaeLink, state);
  return { graph: g, meta: { saveNode: `${P}:save`, width: g[`${P}:latent`].inputs.width, height: g[`${P}:latent`].inputs.height, steps: g[`${P}:sampler`].inputs.steps, seed: g[`${P}:sampler`].inputs.seed, samplerUsed: g[`${P}:sampler`].inputs.sampler_name, denoise: g[`${P}:sampler`].inputs.denoise } };
}

// ── EDIT (Image 1 + Images 2-10) ────────────────────────────────────────
// Headless has no canvas -- editAnnotImage / editRefAnnotations (drawn-annotation compositing)
// are NOT ported. Only verbatim images.image_N wiring, exactly as graphBuilder.ts does when no
// annotation exists for a slot.
export function buildEditGraph(state) {
  if (!state.editImage1) throw tag(new Error("edit mode needs `editImage1` (an absolute path)."), "config");
  const { g, modelLink, clipLink, vaeLink } = buildBaseGraph(state);
  const promptText = buildPromptText(state, "edit");

  g[`${P}:loadImg1`] = { class_type: "LoadImage", inputs: { image: state.editImage1 } };
  const imageLinks = [resizeToMp(g, `${P}:loadImg1Mp`, [`${P}:loadImg1`, 0], state.refMaxMegapixels)];

  if (state.editImage2) {
    g[`${P}:loadImg2`] = { class_type: "LoadImage", inputs: { image: state.editImage2 } };
    imageLinks.push(resizeToMp(g, `${P}:loadImg2Mp`, [`${P}:loadImg2`, 0], state.refMaxMegapixels));
  }

  (state.editRefImages || []).forEach((r, i) => {
    if (!r || !r.filename) return;
    const id = `${P}:editRef${i}`;
    g[id] = { class_type: "LoadImage", inputs: { image: r.filename } };
    imageLinks.push(resizeToMp(g, `${P}:editRefMp${i}`, [id, 0], state.refMaxMegapixels));
  });

  const { posLink, negLink, latentLink } = addConditioning(g, clipLink, vaeLink, promptText, state.negativePrompt || "", state.width || 1024, imageLinks.slice(0, 10));
  addKSampler(g, modelLink, latentLink, state, 1.0, posLink, negLink);
  addDecodeAndSave(g, vaeLink, state);
  return { graph: g, meta: { saveNode: `${P}:save`, steps: g[`${P}:sampler`].inputs.steps, seed: g[`${P}:sampler`].inputs.seed, samplerUsed: g[`${P}:sampler`].inputs.sampler_name, denoise: g[`${P}:sampler`].inputs.denoise } };
}

// ── POSE (VNCCS PoseStudio LoRA) ────────────────────────────────────────
// Stage 1: SAM3D-Body pose extract. Takes state.poseImage as-is, uncropped, at its native
// size -- no crop/resize step. (The web UI has a client-side <canvas> crop tool; this headless
// generator intentionally does not replicate it -- see README "POSE" section.)
export function buildPoseExtractGraph(state) {
  if (!state.poseImage) throw tag(new Error("pose mode needs `poseImage` (an absolute path, Image 1)."), "config");
  const folder = state.saveSubfolder || SUBFOLDER;
  const g = {};
  g[`${P}:loadPose`] = { class_type: "LoadImage", inputs: { image: state.poseImage } };
  const pixLink = [`${P}:loadPose`, 0];

  g[`${P}:samLoader`] = { class_type: "SAM3DBody_Loader", inputs: { model_file: state.poseSamModel || POSE_SAM3D_MODEL_DEFAULT } };
  g[`${P}:samPredict`] = {
    class_type: "SAM3DBody_Predict",
    inputs: { sam3d_body_model: [`${P}:samLoader`, 0], image: pixLink, run_hand_refinement: true, fov: 0, batch_size: 64 },
  };
  g[`${P}:samSmooth`] = {
    class_type: "SAM3DBody_Smooth",
    inputs: { mhr_pose_data: [`${P}:samPredict`, 0], strength: 1, method: "gaussian", window: 7, rotation_threshold_degrees: 15 },
  };
  g[`${P}:samRender`] = {
    class_type: "SAM3DBody_Render",
    inputs: {
      pose_data: [`${P}:samSmooth`, 0], width: 0, height: 0,
      render_style: "mesh", "render_style.shader": "default", "render_style.opacity": 1,
      "render_style.person_palette_falloff": 0.6, "render_style.region": "full_body",
    },
  };
  g[`${P}:samSave`] = { class_type: "SaveImage", inputs: { images: [`${P}:samRender`, 0], filename_prefix: `${folder}/Q21_pose_render` } };
  return { graph: g, meta: { saveNode: `${P}:samSave` } };
}

// Stage 2: main generation. modelLink comes from the pose LoRA, not the general LoRA list --
// this builds its own minimal base graph rather than reusing buildBaseGraph (the reference
// workflow has no ModelSamplingFlux on this path).
function buildPoseBaseGraph(state) {
  const model = state.model || "";
  const clip = state.textEncoder || "";
  const vae = state.vae || "";
  if (!model) throw tag(new Error("No model selected — set `model` in the job or configure it in the ComfyUI config."), "config");
  if (!clip) throw tag(new Error("No text encoder selected — set `textEncoder` in the job or configure it in the ComfyUI config."), "config");
  if (!vae) throw tag(new Error("No VAE selected — set `vae` in the job or configure it in the ComfyUI config."), "config");
  if (!state.poseLoraModel || state.poseLoraModel === "none") throw tag(new Error("pose mode needs `poseLoraModel` (the VNCCS PoseStudio LoRA) set — in the job or the ComfyUI config."), "config");

  const g = {};
  if (model.toLowerCase().endsWith(".gguf")) {
    g[`${P}:unet`] = { class_type: "UnetLoaderGGUF", inputs: { unet_name: model } };
  } else {
    g[`${P}:unet`] = { class_type: "UNETLoader", inputs: { unet_name: model, weight_dtype: "default" } };
  }
  g[`${P}:clip`] = { class_type: "CLIPLoader", inputs: { clip_name: clip, type: "qwen_image", device: "default" } };
  g[`${P}:vae`] = { class_type: "VAELoader", inputs: { vae_name: vae } };

  g[`${P}:poseLora`] = {
    class_type: "LoraLoaderModelOnly",
    inputs: { model: [`${P}:unet`, 0], lora_name: state.poseLoraModel, strength_model: +(state.poseLoraStrength ?? 1) },
  };
  let modelOut = [`${P}:poseLora`, 0];

  if (state.useCache !== false) {
    g[`${P}:cache`] = { class_type: "QwenImage21Cache", inputs: { model: modelOut, device: "auto", dtype: "default" } };
    modelOut = [`${P}:cache`, 0];
  }
  if (state.useSageAttention) {
    g[`${P}:sage`] = { class_type: "PathchSageAttentionKJ", inputs: { model: modelOut, sage_attention: "auto" } };
    modelOut = [`${P}:sage`, 0];
  }
  return { g, modelLink: modelOut, clipLink: [`${P}:clip`, 0], vaeLink: [`${P}:vae`, 0] };
}

export function buildPoseGraph(state, poseRenderFilename) {
  if (!state.poseCharacterImage) throw tag(new Error("pose mode needs `poseCharacterImage` (an absolute path, Image 2)."), "config");
  if (!poseRenderFilename) throw tag(new Error("pose extraction (Stage 1) failed — no render produced."), "generate");
  const { g, modelLink, clipLink, vaeLink } = buildPoseBaseGraph(state);

  const sysPrompt = (state.poseSystemPrompt || POSE_SYSTEM_PROMPT_DEFAULT).trim();
  const userPrompt = buildPromptText(state, "pose");
  const promptText = [sysPrompt, userPrompt].filter(Boolean).join(" ");

  g[`${P}:loadPoseRender`] = { class_type: "LoadImage", inputs: { image: poseRenderFilename } };
  g[`${P}:loadCharacter`] = { class_type: "LoadImage", inputs: { image: state.poseCharacterImage } };
  const imageLinks = [
    resizeToMp(g, `${P}:poseRenderMp`, [`${P}:loadPoseRender`, 0], state.refMaxMegapixels),
    resizeToMp(g, `${P}:characterMp`, [`${P}:loadCharacter`, 0], state.refMaxMegapixels),
  ];

  const { posLink, negLink, latentLink } = addConditioning(g, clipLink, vaeLink, promptText, state.negativePrompt || "", state.resolution || state.width || 1024, imageLinks);
  addKSampler(g, modelLink, latentLink, state, 1.0, posLink, negLink);
  addDecodeAndSave(g, vaeLink, state);
  return { graph: g, meta: { saveNode: `${P}:save`, steps: g[`${P}:sampler`].inputs.steps, seed: g[`${P}:sampler`].inputs.seed, samplerUsed: g[`${P}:sampler`].inputs.sampler_name, denoise: g[`${P}:sampler`].inputs.denoise } };
}

// Single dispatcher for the 4 non-pose modes -- pose is inherently two sequential graphs, so
// index.mjs calls buildPoseExtractGraph/buildPoseGraph directly instead (mirrors view.ts's
// generate() branch).
export function buildGraph(state) {
  if (state.mode === "i2i") return buildI2IGraph(state);
  if (state.mode === "ref2i") return buildRefToImageGraph(state);
  if (state.mode === "edit") return buildEditGraph(state);
  return buildT2IGraph(state);
}
