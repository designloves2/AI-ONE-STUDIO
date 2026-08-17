// core.ts — SDXL ONE STUDIO 상수/상태/헬퍼.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/sdxl/core_sdxl.js + web/one_node_sdxl.js.
// 백엔드 nodes.py의 SDXL_SUBFOLDER("one_sdxl")와 반드시 일치해야 한다 — 원본 프론트엔드 자체의
// SUBFOLDER 상수("sdxl-one-tj")는 stale 값이라 Krea2/Qwen2511과 같은 함정이니 사용하지 않는다.
export { C, BRAND } from "../../identity";
export { el, clear } from "../../shared/ui";

export const SUBFOLDER = "one_sdxl";
export const API = "/sdxl_one";
export const LS_KEY = "sdxl_one_tj_state_v1";

export type SDXLMode = "t2i" | "i2i" | "inpaint" | "outpaint" | "upscale";
export type ModelLoaderMode = "checkpoint" | "separate";
export type UpscaleMode = "esrgan" | "refiner" | "seedvr2";

export interface LoraEntry {
  name: string;
  strength: number;
  triggerWord: string;
  enabled: boolean;
}

const ALL_TARGETS: { mode: SDXLMode; label: string; field: string }[] = [
  { mode: "i2i", label: "→ I2I", field: "i2iImage" },
  { mode: "inpaint", label: "→ Inpaint", field: "inpaintImage" },
  { mode: "outpaint", label: "→ Outpaint", field: "outpaintImage" },
  { mode: "upscale", label: "→ Upscale", field: "upscaleImage" },
];
export const SEND_TO: Record<SDXLMode, typeof ALL_TARGETS> = {
  t2i: ALL_TARGETS,
  i2i: ALL_TARGETS.filter((t) => t.mode !== "i2i"),
  inpaint: ALL_TARGETS.filter((t) => t.mode !== "inpaint"),
  outpaint: ALL_TARGETS.filter((t) => t.mode !== "outpaint"),
  upscale: ALL_TARGETS.filter((t) => t.mode !== "upscale"),
};

export interface SDXLState {
  mode: SDXLMode;

  modelLoaderMode: ModelLoaderMode;
  checkpoint: string;
  useRefiner: boolean;
  refinerCheckpoint: string;
  refinerStepFrac: number;

  unet: string;
  clipL: string;
  clipG: string;
  vae: string;

  prompt: string;
  promptsByMode: Record<string, string>;
  negativePrompt: string;
  promptSuffix: string;

  width: number;
  height: number;

  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number;
  seedMode: string;

  loras: LoraEntry[];

  i2iImage: string | null;
  i2iDenoise: number;

  inpaintImage: string | null;
  inpaintMaskImage: string | null;
  inpaintDenoise: number;
  inpaintMaskBlur: number;
  inpaintGrowMask: number;

  outpaintImage: string | null;
  outpaintUp: number;
  outpaintDown: number;
  outpaintLeft: number;
  outpaintRight: number;
  outpaintFeather: number;

  upscaleMode: UpscaleMode;
  upscaleImage: string | null;

  esrganModel: string;
  esrganScale: number;

  upscaleRefinerDenoise: number;
  upscaleRefinerSteps: number;
  upscaleRefinerCfg: number;

  upscaleDitModel: string;
  upscaleVaeModel: string;
  upscaleResolution: number;
  upscaleMaxResolution: number;
  upscaleBatchSize: number;
  upscaleBlocksToSwap: number;
  upscaleColorCorrection: string;
  upscaleAttentionMode: string;
  upscaleOffloadDevice: string;
  upscaleInputNoiseScale: number;
  upscaleLatentNoiseScale: number;

  outputMode: string;
  saveSubfolder: string;
}

export const SAMPLERS = ["euler", "euler_ancestral", "dpm_2", "dpm_2_ancestral", "dpm_pp_2m", "dpm_pp_2m_sde", "dpm_pp_sde", "heun", "lms", "dpm_fast", "dpm_adaptive", "ddim", "uni_pc"];
export const SCHEDULERS = ["normal", "karras", "exponential", "sgm_uniform", "simple", "beta"];
export const LORA_UI_CAP = 5;

export const SEEDVR2_ATTN_MODES = ["sdpa", "flash_attn_2", "flash_attn_3", "sageattn_2", "sageattn_3"];
export const SEEDVR2_COLOR_MODES = ["lab", "wavelet", "wavelet_adaptive", "hsv", "adain", "none"];

export const RESOLUTIONS: { label: string; w: number; h: number }[] = [
  { label: "1024 × 1024", w: 1024, h: 1024 },
  { label: "1152 × 896", w: 1152, h: 896 },
  { label: "896 × 1152", w: 896, h: 1152 },
  { label: "1216 × 832", w: 1216, h: 832 },
  { label: "832 × 1216", w: 832, h: 1216 },
  { label: "1344 × 768", w: 1344, h: 768 },
  { label: "768 × 1344", w: 768, h: 1344 },
  { label: "1536 × 640", w: 1536, h: 640 },
  { label: "640 × 1536", w: 640, h: 1536 },
  { label: "Custom", w: 0, h: 0 },
];

export const MODES: { key: SDXLMode; label: string }[] = [
  { key: "t2i", label: "T2I" },
  { key: "i2i", label: "I2I" },
  { key: "inpaint", label: "INPAINT" },
  { key: "outpaint", label: "OUTPAINT" },
  { key: "upscale", label: "UPSCALE" },
];

const DEFAULT_NEG = "low quality, deformed, blurry, watermark, ugly, bad anatomy, disfigured, mutated, extra limbs, poorly drawn face, bad proportions, jpeg artifacts, overexposed, underexposed, nsfw";

export function loadState(): Partial<SDXLState> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}
export function saveState(s: SDXLState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
}

export function snap8(v: number) {
  return Math.max(8, Math.round(v / 8) * 8);
}

export function defaultState(saved: Partial<SDXLState> = {}): SDXLState {
  return {
    mode: (saved.mode as SDXLMode) || "t2i",

    modelLoaderMode: saved.modelLoaderMode || "checkpoint",
    checkpoint: saved.checkpoint || "",
    useRefiner: saved.useRefiner || false,
    refinerCheckpoint: saved.refinerCheckpoint || "",
    refinerStepFrac: saved.refinerStepFrac ?? 0.8,

    unet: saved.unet || "",
    clipL: saved.clipL || "",
    clipG: saved.clipG || "",
    vae: saved.vae || "",

    // 구버전 마이그레이션 — promptsByMode 필드 자체가 없을 때만 이관한다 (Klein/Qwen2511과 동일 원칙).
    prompt: saved.prompt || "",
    promptsByMode: (() => {
      if (saved.promptsByMode) return { ...saved.promptsByMode };
      const p: Record<string, string> = {};
      if (saved.prompt) p[(saved.mode as SDXLMode) || "t2i"] = saved.prompt;
      return p;
    })(),
    negativePrompt: saved.negativePrompt || DEFAULT_NEG,
    promptSuffix: saved.promptSuffix || "",

    width: saved.width || 1024,
    height: saved.height || 1024,

    steps: saved.steps || 20,
    cfg: saved.cfg !== undefined ? saved.cfg : 7,
    sampler: saved.sampler || "euler_ancestral",
    scheduler: saved.scheduler || "karras",
    seed: saved.seed ?? 0,
    seedMode: saved.seedMode || "randomize",

    loras: Array.isArray(saved.loras)
      ? saved.loras.map((l) => ({ name: l.name || "none", strength: l.strength ?? 1, triggerWord: l.triggerWord || "", enabled: l.enabled !== false }))
      : [],

    i2iImage: saved.i2iImage || null,
    i2iDenoise: saved.i2iDenoise ?? 0.75,

    inpaintImage: saved.inpaintImage || null,
    inpaintMaskImage: saved.inpaintMaskImage || null,
    inpaintDenoise: saved.inpaintDenoise ?? 0.85,
    inpaintMaskBlur: saved.inpaintMaskBlur ?? 0,
    inpaintGrowMask: saved.inpaintGrowMask ?? 6,

    outpaintImage: saved.outpaintImage || null,
    outpaintUp: saved.outpaintUp ?? 256,
    outpaintDown: saved.outpaintDown ?? 256,
    outpaintLeft: saved.outpaintLeft ?? 0,
    outpaintRight: saved.outpaintRight ?? 0,
    outpaintFeather: saved.outpaintFeather ?? 32,

    upscaleMode: saved.upscaleMode || "esrgan",
    upscaleImage: saved.upscaleImage || null,

    esrganModel: saved.esrganModel || "",
    esrganScale: saved.esrganScale ?? 4,

    upscaleRefinerDenoise: saved.upscaleRefinerDenoise ?? 0.35,
    upscaleRefinerSteps: saved.upscaleRefinerSteps ?? 20,
    upscaleRefinerCfg: saved.upscaleRefinerCfg ?? 7,

    upscaleDitModel: saved.upscaleDitModel || "none",
    upscaleVaeModel: saved.upscaleVaeModel || "none",
    upscaleResolution: saved.upscaleResolution ?? 2048,
    upscaleMaxResolution: saved.upscaleMaxResolution ?? 4096,
    upscaleBatchSize: saved.upscaleBatchSize ?? 1,
    upscaleBlocksToSwap: saved.upscaleBlocksToSwap ?? 0,
    upscaleColorCorrection: saved.upscaleColorCorrection || "lab",
    upscaleAttentionMode: saved.upscaleAttentionMode || "sdpa",
    upscaleOffloadDevice: saved.upscaleOffloadDevice && saved.upscaleOffloadDevice !== "none" ? saved.upscaleOffloadDevice : "cpu",
    upscaleInputNoiseScale: saved.upscaleInputNoiseScale ?? 0,
    upscaleLatentNoiseScale: saved.upscaleLatentNoiseScale ?? 0,

    outputMode: saved.outputMode || "save",
    saveSubfolder: saved.saveSubfolder || "",
  };
}

export function getModePrompt(state: SDXLState, mode?: SDXLMode): string {
  return state.promptsByMode[mode || state.mode] ?? "";
}
export function setModePrompt(state: SDXLState, mode: SDXLMode, text: string) {
  state.promptsByMode[mode] = text;
  if (mode === state.mode) state.prompt = text;
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e15);
}
