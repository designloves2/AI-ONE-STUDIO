// core-helpers.mjs — pure functions + default state + config->state mapper, ported from
// src/tools/klein/core.ts. Zero deps. (SEND_TO menu / RESOLUTIONS / MODES UI lists dropped.)

export const SUBFOLDER = "one_flux2-klein";
export const API = "/flux_klein";

export const SAMPLERS = ["euler", "euler_ancestral", "er_sde", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "heun", "dpm_pp_2m"];
export const SCHEDULERS = ["simple", "normal", "karras", "exponential", "sgm_uniform", "beta"];

const DEFAULT_NEG =
  "low quality, deformed, blurry, watermark, ugly, bad anatomy, disfigured, mutated, extra limbs, poorly drawn face, bad proportions, gross proportions, jpeg artifacts, overexposed, underexposed";

export function randomSeed() {
  return Math.floor(Math.random() * 1e15);
}

/** verbatim port of core.ts defaultState, minus localStorage migration + UI-only fields. */
export function defaultState(saved = {}) {
  return {
    mode: saved.mode || "t2i",
    model: saved.model || "",
    textEncoder: saved.textEncoder || "",
    vae: saved.vae || "",
    kvCacheOverride: saved.kvCacheOverride || "auto", // "auto" | "on" | "off"

    prompt: saved.prompt || "",
    promptsByMode: (saved.promptsByMode && typeof saved.promptsByMode === "object") ? { ...saved.promptsByMode } : {},
    negativePrompt: saved.negativePrompt || DEFAULT_NEG,
    promptSuffix: saved.promptSuffix || "",

    width: saved.width || 1024,
    height: saved.height || 1536,

    steps: saved.steps || 4,
    cfg: saved.cfg !== undefined ? saved.cfg : 1,
    sampler: saved.sampler || "euler",
    scheduler: saved.scheduler || "simple",
    seed: saved.seed ?? 0,

    loras: Array.isArray(saved.loras)
      ? saved.loras.map((l) => ({ name: l.name || "none", strength: l.strength ?? 1, triggerWord: l.triggerWord || "", enabled: l.enabled !== false }))
      : [],

    // I2I
    i2iImage: saved.i2iImage || null,
    i2iWidth: saved.i2iWidth || null,
    i2iHeight: saved.i2iHeight || null,
    i2iDenoise: saved.i2iDenoise ?? 0.75,

    // EDIT (multi-reference)
    editImage1: saved.editImage1 || null,
    editImage2: saved.editImage2 || null,
    editRefImages: Array.isArray(saved.editRefImages) ? saved.editRefImages : [],
    editSizeSource: saved.editSizeSource || "img1", // "img1" | "manual"

    // PAINT (inpaint + outpaint sub-mode)
    paintSubMode: saved.paintSubMode || "inpaint",
    inpaintImage: saved.inpaintImage || null,
    inpaintMaskImage: saved.inpaintMaskImage || null,
    inpaintDenoise: saved.inpaintDenoise ?? 0.85,
    outpaintImage: saved.outpaintImage || null,
    outpaintUp: saved.outpaintUp ?? 0,
    outpaintDown: saved.outpaintDown ?? 0,
    outpaintLeft: saved.outpaintLeft ?? 0,
    outpaintRight: saved.outpaintRight ?? 0,
    outpaintPadR: saved.outpaintPadR ?? 0,
    outpaintPadG: saved.outpaintPadG ?? 0,
    outpaintPadB: saved.outpaintPadB ?? 0,

    // FACESWAP (needs the BFS lora on the server)
    faceswapTarget: saved.faceswapTarget || null,
    faceswapSource: saved.faceswapSource || null,
    faceswapDenoise: saved.faceswapDenoise ?? 1.0,
    bfsLora: saved.bfsLora || null, // { name, strength, enabled }

    outputMode: saved.outputMode || "save", // "save" | "preview"
    saveSubfolder: saved.saveSubfolder || "",
  };
}

/** GET /flux_klein/config -> state. Same keys the studio Settings panel reads. */
export function applyConfig(state, cfg = {}) {
  if (cfg.selected_model) state.model = cfg.selected_model;
  if (cfg.selected_text_encoder) state.textEncoder = cfg.selected_text_encoder;
  if (cfg.selected_vae) state.vae = cfg.selected_vae;
  if (cfg.negative_prompt) state.negativePrompt = cfg.negative_prompt;
  if (cfg.prompt_suffix) state.promptSuffix = cfg.prompt_suffix;
  if (cfg.save_subfolder) state.saveSubfolder = cfg.save_subfolder;
  return state;
}

// PAINT mode keys prompts per sub-mode (inpaint / outpaint) — core.ts effectiveModeKey.
export function effectiveModeKey(state, mode) {
  return mode === "inpaint" && state.paintSubMode === "outpaint" ? "outpaint" : mode;
}

/** core.ts buildPromptText — mode prompt + lora trigger words + shared suffix. */
export function buildPromptText(state, mode) {
  const key = effectiveModeKey(state, mode || state.mode);
  const base = (state.promptsByMode?.[key] ?? state.prompt ?? "");
  const parts = [base];
  (state.loras || []).forEach((l) => {
    if (l.enabled !== false && l.name && l.name !== "none" && l.triggerWord) parts.push(l.triggerWord);
  });
  if (state.promptSuffix) parts.push(state.promptSuffix);
  return parts.filter(Boolean).join(", ");
}

/** core.ts getUseKV — Flux KV cache: explicit override, else model-name heuristic. */
export function getUseKV(state) {
  if (state.kvCacheOverride === "on") return true;
  if (state.kvCacheOverride === "off") return false;
  return (state.model || "").toLowerCase().includes("kv");
}
