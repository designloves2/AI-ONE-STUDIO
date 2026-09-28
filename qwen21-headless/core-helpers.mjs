// core-helpers.mjs — pure functions + default state + config->state mapper, ported from
// src/tools/qwen21/core.ts. In-scope fields only: t2i / i2i / ref2i (Ref to Image) / edit /
// pose. Paint (inpaint/outpaint) and Upscale (SeedVR2) fields are intentionally NOT ported —
// out of scope for this headless generator.

export const SUBFOLDER = "qwen21-one-tj";
export const API = "/qwenimage21_one";

export const POSE_SYSTEM_PROMPT_DEFAULT =
  "replace the pose of <image 2> with the pose of <image 1>. keep the character of <image 2>.";
export const POSE_SAM3D_MODEL_DEFAULT = "sam_3d_body_dinov3_bf16.safetensors";

export const MAX_REF_IMAGES = 10;
export const MAX_EDIT_EXTRA = 9; // Images 2-10

export function randomSeed() {
  return Math.floor(Math.random() * 1e15);
}

/** verbatim port of core.ts defaultState, restricted to the 5 in-scope modes' fields. */
export function defaultState(saved = {}) {
  return {
    mode: saved.mode || "t2i",
    model: saved.model || "",
    textEncoder: saved.textEncoder || "",
    vae: saved.vae || "",

    prompt: saved.prompt || "",
    promptsByMode: saved.promptsByMode ? { ...saved.promptsByMode } : {},
    negativePrompt: saved.negativePrompt || "",
    promptSuffix: saved.promptSuffix || "",
    // Ref to Image / Edit reference image auto-downscale. 0 (default) = off, send as uploaded.
    refMaxMegapixels: saved.refMaxMegapixels || 0,

    width: saved.width || 1024,
    height: saved.height || 1024,
    resolution: saved.resolution || 1024, // TextEncodeQwenImage21's own `resolution` int input

    steps: saved.steps !== undefined ? saved.steps : 20,
    cfg: saved.cfg !== undefined ? saved.cfg : 1.0,
    sampler: saved.sampler || "euler",
    scheduler: saved.scheduler || "simple",
    seed: saved.seed ?? 0,

    maxShift: saved.maxShift ?? 0.69,
    baseShift: saved.baseShift ?? 0.5,

    useCache: saved.useCache !== false,
    useSageAttention: saved.useSageAttention ?? false,

    loras: Array.isArray(saved.loras)
      ? saved.loras.map((l) => ({ name: l.name || "none", strength: l.strength ?? 1, triggerWord: l.triggerWord || "", enabled: l.enabled !== false }))
      : [],

    // I2I - plain
    i2iImage: saved.i2iImage || null,
    i2iWidth: saved.i2iWidth || null,
    i2iHeight: saved.i2iHeight || null,
    i2iDenoise: saved.i2iDenoise ?? 0.75,

    // Ref to Image (headless job.mode "ref2i" -- the web's i2i+i2iSubMode:"ref2img" flattened
    // into its own top-level mode, see README "mode mapping")
    refImages: Array.isArray(saved.refImages) ? saved.refImages.slice(0, MAX_REF_IMAGES) : [],
    refWidth: saved.refWidth || 1024,
    refHeight: saved.refHeight || 1024,
    refDenoise: saved.refDenoise ?? 1.0,

    // Edit -- no annotation support (headless has no canvas). Only verbatim images.
    editImage1: saved.editImage1 || null,
    editImage2: saved.editImage2 || null,
    editRefImages: Array.isArray(saved.editRefImages) ? saved.editRefImages : [],

    outputMode: saved.outputMode || "save",
    saveSubfolder: saved.saveSubfolder || "",

    // POSE mode (VNCCS PoseStudio LoRA). poseImage is sent to SAM3D as-is, uncropped, at its
    // native size -- headless does not replicate the web's client-side canvas crop tool.
    poseImage: saved.poseImage || null,
    poseCharacterImage: saved.poseCharacterImage || null,

    poseLoraModel: saved.poseLoraModel || "none",
    poseLoraStrength: saved.poseLoraStrength ?? 1,
    poseSamModel: saved.poseSamModel || POSE_SAM3D_MODEL_DEFAULT,
    poseSystemPrompt: saved.poseSystemPrompt ?? POSE_SYSTEM_PROMPT_DEFAULT,
  };
}

/** GET /qwenimage21_one/config -> state. Same keys the studio Settings panel reads. */
export function applyConfig(state, cfg = {}) {
  if (cfg.selected_model) state.model = cfg.selected_model;
  if (cfg.selected_text_encoder) state.textEncoder = cfg.selected_text_encoder;
  if (cfg.selected_vae) state.vae = cfg.selected_vae;
  if (cfg.negative_prompt) state.negativePrompt = cfg.negative_prompt;
  if (cfg.prompt_suffix) state.promptSuffix = cfg.prompt_suffix;
  if (cfg.save_subfolder) state.saveSubfolder = cfg.save_subfolder;
  if (cfg.pose_lora_model) state.poseLoraModel = cfg.pose_lora_model;
  if (cfg.pose_lora_strength != null) state.poseLoraStrength = cfg.pose_lora_strength;
  if (cfg.pose_sam_model) state.poseSamModel = cfg.pose_sam_model;
  if (cfg.pose_system_prompt) state.poseSystemPrompt = cfg.pose_system_prompt;
  return state;
}
