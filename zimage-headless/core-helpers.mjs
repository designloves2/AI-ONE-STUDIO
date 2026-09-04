// core-helpers.mjs — pure functions + default state + config->state mapper, ported from
// src/tools/zimage/core.ts (t2i / i2i slice only — inpaint/rebg/controlnet/face_redraw and
// SeedVR2 upscale are out of scope here).

export const SUBFOLDER = "one_z-image";
export const API = "/z_image_turbo";

export function randomSeed() {
  return Math.floor(Math.random() * 1e15);
}

/** verbatim port of core.ts defaultState, minus localStorage migration and the fields only the
 *  Phase-2 modes / SeedVR2 upscale read. */
export function defaultState(saved = {}) {
  return {
    mode: saved.mode || "t2i",
    model: saved.model || "",
    textEncoder: saved.textEncoder || "",
    vae: saved.vae || "",

    prompt: saved.prompt || "",
    negativePrompt: saved.negativePrompt || "",
    promptSuffix: saved.promptSuffix || "",

    width: saved.width || 1024,
    height: saved.height || 1536,

    steps: saved.steps || 8,
    cfg: saved.cfg || 1,
    shift: saved.shift || 3,
    sampler: saved.sampler || "euler",
    scheduler: saved.scheduler || "simple",
    seed: saved.seed ?? 0,

    loras: Array.isArray(saved.loras)
      ? saved.loras.map((l) => ({ name: l.name || "none", strength: l.strength ?? 1, triggerWord: l.triggerWord || "", enabled: l.enabled !== false }))
      : [],

    i2iImage: saved.i2iImage || "",
    i2iWidth: saved.i2iWidth || null,
    i2iHeight: saved.i2iHeight || null,
    i2iDenoise: saved.i2iDenoise ?? 0.75,

    outputMode: saved.outputMode || "save",
    saveSubfolder: saved.saveSubfolder || "",
  };
}

/** GET /z_image_turbo/config -> state. Same keys the studio Settings panel reads. */
export function applyConfig(state, cfg = {}) {
  if (cfg.selected_model) state.model = cfg.selected_model;
  if (cfg.selected_text_encoder) state.textEncoder = cfg.selected_text_encoder;
  if (cfg.selected_vae) state.vae = cfg.selected_vae;
  if (cfg.negative_prompt) state.negativePrompt = cfg.negative_prompt;
  if (cfg.prompt_suffix) state.promptSuffix = cfg.prompt_suffix;
  if (cfg.save_subfolder) state.saveSubfolder = cfg.save_subfolder;
  return state;
}
