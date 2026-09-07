// core-helpers.mjs — pure functions + default state + config->state mapper, ported from
// src/tools/krea2/core.ts (t2i / i2i slice only — identity & SeedVR2 upscale are separate).

export const SUBFOLDER = "one_krea2";
export const API = "/krea2_one";

export const DEPTH_CKPTS = [
  "depth_anything_v2_vitl.pth",
  "depth_anything_v2_vitb.pth",
  "depth_anything_v2_vits.pth",
];
export function safeDepthCkpt(name) {
  return name && DEPTH_CKPTS.includes(name) ? name : "depth_anything_v2_vitl.pth";
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e15);
}

/** verbatim port of core.ts defaultState, minus localStorage-migration and identity/upscale-only
 *  fields the t2i/i2i graph never reads. */
export function defaultState(saved = {}) {
  return {
    mode: saved.mode || "t2i",
    model: saved.model || "",
    textEncoder: saved.textEncoder || "",
    vae: saved.vae || "",

    prompt: saved.prompt || "",
    promptSuffix: saved.promptSuffix || "",
    negativePrompt: saved.negativePrompt || "",

    width: saved.width || 1024,
    height: saved.height || 1024,

    steps: saved.steps ?? 8,
    cfg: saved.cfg ?? 1,
    sampler: saved.sampler || "euler",
    scheduler: saved.scheduler || "simple",
    seed: saved.seed ?? 0,

    loras: Array.isArray(saved.loras)
      ? saved.loras.map((l) => ({ name: l.name || "none", strength: l.strength ?? 0.8, triggerWord: l.triggerWord || "", enabled: l.enabled !== false }))
      : [],

    // I2I
    i2iImage: saved.i2iImage || "",
    i2iWidth: saved.i2iWidth || null,
    i2iHeight: saved.i2iHeight || null,
    i2iDenoise: saved.i2iDenoise ?? 0.75,

    // ControlNet (Krea2 Control LoRA / NK2E canny)
    controlType: saved.controlType || "canny",
    controlLoraDepth: saved.controlLoraDepth ?? "none",
    controlLoraCanny: saved.controlLoraCanny ?? "none",
    controlStrength: saved.controlStrength ?? 1.0,
    controlChannelMode: saved.controlChannelMode ?? "rgb",
    controlNormalize: saved.controlNormalize ?? "per_image_minmax",
    controlInvert: saved.controlInvert ?? false,
    cannyLow: saved.cannyLow ?? 100,
    cannyHigh: saved.cannyHigh ?? 200,
    depthCkpt: safeDepthCkpt(saved.depthCkpt),
    preprocResolution: saved.preprocResolution ?? 512,
    t2iControlEnabled: saved.t2iControlEnabled ?? false,
    t2iControlImage: saved.t2iControlImage || "",
    t2iControlImageW: saved.t2iControlImageW || null,
    t2iControlImageH: saved.t2iControlImageH || null,
    i2iControlEnabled: saved.i2iControlEnabled ?? false,
    i2iControlImage: saved.i2iControlImage || "",
    i2iControlImageW: saved.i2iControlImageW || null,
    i2iControlImageH: saved.i2iControlImageH || null,

    // IDENTITY EDIT (comfyui-krea2edit — Krea2EditModelPatch + Krea2EditGroundedEncode
    // + the krea2 identity-edit LoRA). `promptsByMode.identity` (or `prompt`) is the
    // edit instruction. identityLora / identityLoraStrength default from the studio
    // config; the rest match core.ts.
    promptsByMode: (saved.promptsByMode && typeof saved.promptsByMode === "object") ? { ...saved.promptsByMode } : {},
    identityImage: saved.identityImage || "",
    identityImageB: saved.identityImageB || "",
    identityWidth: saved.identityWidth || null,
    identityHeight: saved.identityHeight || null,
    identityRefBoost: saved.identityRefBoost ?? 1.0,
    identityGroundingPx: (() => {
      const v = saved.identityGroundingPx;
      return v === 0 || (v ?? 0) >= 64 ? v : 768;
    })(),
    identityFitMode: (saved.identityFitMode === "fit" || saved.identityFitMode === "crop (legacy)") ? saved.identityFitMode : "fit",
    identityLora: saved.identityLora || "none",
    identityLoraStrength: saved.identityLoraStrength ?? 1.0,

    outputMode: saved.outputMode || "save",
    saveSubfolder: saved.saveSubfolder || "",
  };
}

/** GET /krea2_one/config -> state. Same keys the studio Settings panel reads. */
export function applyConfig(state, cfg = {}) {
  if (cfg.selected_model) state.model = cfg.selected_model;
  if (cfg.selected_text_encoder) state.textEncoder = cfg.selected_text_encoder;
  if (cfg.selected_vae) state.vae = cfg.selected_vae;
  if (cfg.negative_prompt) state.negativePrompt = cfg.negative_prompt;
  if (cfg.prompt_suffix) state.promptSuffix = cfg.prompt_suffix;
  if (cfg.save_subfolder) state.saveSubfolder = cfg.save_subfolder;
  if (cfg.control_lora_depth && cfg.control_lora_depth !== "none") state.controlLoraDepth = cfg.control_lora_depth;
  if (cfg.control_lora_canny && cfg.control_lora_canny !== "none") state.controlLoraCanny = cfg.control_lora_canny;
  if (cfg.depth_ckpt) state.depthCkpt = safeDepthCkpt(cfg.depth_ckpt);
  if (cfg.identity_lora && cfg.identity_lora !== "none") state.identityLora = cfg.identity_lora;
  if (cfg.identity_lora_strength != null) state.identityLoraStrength = cfg.identity_lora_strength;
  return state;
}

/** core.ts buildPromptText — mode prompt + shared suffix. */
export function buildPromptText(state, mode) {
  const key = mode || state.mode;
  const body = (state.promptsByMode?.[key] ?? state.prompt ?? "").trim();
  return [body, state.promptSuffix].map((s) => (s || "").trim()).filter(Boolean).join(", ");
}

/** core.ts controlOutputSize — fit output to the control image's aspect ratio. */
export function controlOutputSize(state, mode) {
  const enabled = mode === "t2i" ? state.t2iControlEnabled : state.i2iControlEnabled;
  if (!enabled) return null;
  const cw = mode === "t2i" ? state.t2iControlImageW : state.i2iControlImageW;
  const ch = mode === "t2i" ? state.t2iControlImageH : state.i2iControlImageH;
  if (!cw || !ch) return null;
  const setW = mode === "t2i" ? state.width || 1024 : state.i2iWidth || state.width || 1024;
  const setH = mode === "t2i" ? state.height || 1024 : state.i2iHeight || state.height || 1024;
  const longEdge = Math.max(setW, setH);
  const ar = cw / ch;
  let W, H;
  if (cw >= ch) { W = longEdge; H = longEdge / ar; }
  else { H = longEdge; W = longEdge * ar; }
  const snap = (v) => Math.max(64, Math.round(v / 8) * 8);
  return { W: snap(W), H: snap(H) };
}

export function controlLoraForType(state, type) {
  return (type || state.controlType || "depth") === "canny" ? state.controlLoraCanny : state.controlLoraDepth;
}
