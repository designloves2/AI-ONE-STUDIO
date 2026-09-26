// core.ts — QWEN IMAGE 2.1 ONE STUDIO 상수/상태/헬퍼.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/qwen21/core_qwen21.js + web/one_node_qwen21.js.
// 백엔드 nodes.py의 SUBFOLDER("qwen21-one-tj")/API 접두사("/qwenimage21_one")와 반드시 일치해야 한다.
// 2511과 달리 Faceswap/Angle 모드가 없고, Model Sampling은 ModelSamplingFlux(max_shift/base_shift)를
// 쓰며, QwenImage21Cache/PathchSageAttentionKJ 토글이 있다. Model Override(node input socket)와
// Language 셀렉터는 이 웹앱이 LiteGraph 노드가 아니므로 2511 포팅 때와 동일하게 이식하지 않는다
// (src/tools/qwen2511/view.ts·settings.ts에 그 두 기능이 없는 것이 그 전례).
export { C, BRAND } from "../../identity";
export { el, clear } from "../../shared/ui";

export const SUBFOLDER = "qwen21-one-tj";
export const API = "/qwenimage21_one";
export const LS_KEY = "qwenimage21_one_tj_state_v1";

export type Q21Mode = "t2i" | "i2i" | "edit" | "inpaint" | "upscale";
export type I2ISubMode = "i2i" | "ref2img";
export type PaintSubMode = "inpaint" | "outpaint";

export interface LoraEntry {
  name: string;
  strength: number;
  triggerWord: string;
  enabled: boolean;
}
export interface RefImage {
  filename: string;
}

const ALL_TARGETS: { mode: Q21Mode; label: string; field: string; subMode?: PaintSubMode }[] = [
  { mode: "i2i", label: "→ I2I", field: "i2iImage" },
  { mode: "edit", label: "→ Edit", field: "editImage1" },
  { mode: "inpaint", label: "→ Inpaint", field: "inpaintImage", subMode: "inpaint" },
  { mode: "inpaint", label: "→ Outpaint", field: "inpaintImage", subMode: "outpaint" },
  { mode: "upscale", label: "→ Upscale", field: "upscaleImage" },
];
export const SEND_TO: Record<Q21Mode, typeof ALL_TARGETS> = {
  t2i: ALL_TARGETS,
  i2i: ALL_TARGETS.filter((t) => t.mode !== "i2i"),
  edit: ALL_TARGETS.filter((t) => t.mode !== "edit"),
  inpaint: ALL_TARGETS.filter((t) => t.mode !== "inpaint"),
  upscale: ALL_TARGETS.filter((t) => t.mode !== "upscale"),
};

export interface Q21State {
  mode: Q21Mode;
  model: string;
  textEncoder: string;
  vae: string;

  prompt: string;
  promptsByMode: Record<string, string>;
  negativePrompt: string;
  promptSuffix: string;

  width: number;
  height: number;
  resolution: number; // TextEncodeQwenImage21's own `resolution` int input

  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number;
  seedMode: string;

  maxShift: number;
  baseShift: number;

  useCache: boolean;
  useSageAttention: boolean;

  loras: LoraEntry[];

  // I2I — plain
  i2iImage: string | null;
  i2iWidth: number | null;
  i2iHeight: number | null;
  i2iLockRatio: boolean;
  i2iDenoise: number;

  // I2I — Ref to Image sub-mode
  i2iSubMode: I2ISubMode;
  refImages: RefImage[];
  refWidth: number;
  refHeight: number;
  refDenoise: number;

  // Edit
  editImage1: string | null;
  editImage2: string | null;
  editRefImages: RefImage[];
  editAnnotImage: string | null;
  editAnnotStrokes: any[];
  editRefAnnotations: Record<number, string>;
  editRefAnnotationStrokes: Record<number, any[]>;
  editSizeSource: string;

  // Paint (Inpaint / Outpaint)
  paintSubMode: PaintSubMode;
  inpaintImage: string | null;
  inpaintAnnotImage: string | null;
  inpaintAnnotStrokes: any[];
  inpaintDenoise: number;
  outpaintUp: number;
  outpaintDown: number;
  outpaintLeft: number;
  outpaintRight: number;
  outpaintPadR: number;
  outpaintPadG: number;
  outpaintPadB: number;

  // Upscale (SeedVR2)
  upscaleImage: string | null;
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

  autoEnhance: boolean;

  outputMode: string;
  saveSubfolder: string;
}

export const SAMPLERS = ["euler", "euler_ancestral", "er_sde", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "heun", "dpm_pp_2m"];
export const SCHEDULERS = ["simple", "normal", "karras", "exponential", "sgm_uniform", "beta"];
export const LORA_UI_CAP = 3;
export const MAX_REF_IMAGES = 10;
export const MAX_EDIT_EXTRA = 9; // Images 2–10

export const SEEDVR2_ATTN_MODES = ["sdpa", "flash_attn_2", "flash_attn_3", "sageattn_2", "sageattn_3"];
export const SEEDVR2_COLOR_MODES = ["lab", "wavelet", "wavelet_adaptive", "hsv", "adain", "none"];

export const RESOLUTIONS: { label: string; w: number; h: number }[] = [
  { label: "1024 × 1024", w: 1024, h: 1024 },
  { label: "1024 × 1536", w: 1024, h: 1536 },
  { label: "1536 × 1024", w: 1536, h: 1024 },
  { label: "1920 × 1088", w: 1920, h: 1088 },
  { label: "1088 × 1920", w: 1088, h: 1920 },
  { label: "1280 × 720", w: 1280, h: 720 },
  { label: "720 × 1280", w: 720, h: 1280 },
  { label: "Custom", w: 0, h: 0 },
];

export const MODES: { key: Q21Mode; label: string }[] = [
  { key: "t2i", label: "T2I" },
  { key: "i2i", label: "I2I" },
  { key: "edit", label: "EDIT" },
  { key: "inpaint", label: "PAINT" },
  { key: "upscale", label: "UPSCALE" },
];

export function loadState(): Partial<Q21State> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}
export function saveState(s: Q21State) {
  try {
    // 드로잉 오버레이/마스크 데이터 등 무거운 필드는 저장하지 않는다 — 원본 core_qwen21.js의
    // saveState SKIP 목록과 동일한 의도(용량 폭증 방지). 이 웹포트는 그 필드들을 애초에 갖지
    // 않으므로 그대로 저장한다.
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
}

export function snap8(v: number) {
  return Math.max(8, Math.round(v / 8) * 8);
}

export function defaultState(saved: Partial<Q21State> = {}): Q21State {
  return {
    mode: (saved.mode as Q21Mode) || "t2i",
    model: saved.model || "",
    textEncoder: saved.textEncoder || "",
    vae: saved.vae || "",

    prompt: saved.prompt || "",
    promptsByMode: saved.promptsByMode ? { ...saved.promptsByMode } : {},
    negativePrompt: saved.negativePrompt || "",
    promptSuffix: saved.promptSuffix || "",

    width: saved.width || 1024,
    height: saved.height || 1024,
    resolution: saved.resolution || 1024,

    steps: saved.steps !== undefined ? saved.steps : 20,
    cfg: saved.cfg !== undefined ? saved.cfg : 1.0,
    sampler: saved.sampler || "euler",
    scheduler: saved.scheduler || "simple",
    seed: saved.seed ?? 0,
    seedMode: saved.seedMode || "randomize",

    maxShift: saved.maxShift ?? 0.69,
    baseShift: saved.baseShift ?? 0.5,

    useCache: saved.useCache !== false,
    useSageAttention: saved.useSageAttention ?? false,

    loras: Array.isArray(saved.loras)
      ? saved.loras.map((l) => ({ name: l.name || "none", strength: l.strength ?? 1, triggerWord: l.triggerWord || "", enabled: l.enabled !== false }))
      : [],

    i2iImage: saved.i2iImage || null,
    i2iWidth: saved.i2iWidth || null,
    i2iHeight: saved.i2iHeight || null,
    i2iLockRatio: saved.i2iLockRatio ?? true,
    i2iDenoise: saved.i2iDenoise ?? 0.75,

    i2iSubMode: (saved.i2iSubMode as I2ISubMode) || "i2i",
    refImages: Array.isArray(saved.refImages) ? saved.refImages.slice(0, MAX_REF_IMAGES) : [],
    refWidth: saved.refWidth || 1024,
    refHeight: saved.refHeight || 1024,
    refDenoise: saved.refDenoise ?? 1.0,

    editImage1: saved.editImage1 || null,
    editImage2: saved.editImage2 || null,
    editRefImages: Array.isArray(saved.editRefImages) ? saved.editRefImages : [],
    editAnnotImage: saved.editAnnotImage || null,
    editAnnotStrokes: Array.isArray(saved.editAnnotStrokes) ? saved.editAnnotStrokes : [],
    editRefAnnotations: saved.editRefAnnotations && typeof saved.editRefAnnotations === "object" ? { ...saved.editRefAnnotations } : {},
    editRefAnnotationStrokes: saved.editRefAnnotationStrokes && typeof saved.editRefAnnotationStrokes === "object" ? { ...saved.editRefAnnotationStrokes } : {},
    editSizeSource: saved.editSizeSource || "img1",

    paintSubMode: saved.paintSubMode || "inpaint",
    inpaintImage: saved.inpaintImage || null,
    inpaintAnnotImage: saved.inpaintAnnotImage || null,
    inpaintAnnotStrokes: Array.isArray(saved.inpaintAnnotStrokes) ? saved.inpaintAnnotStrokes : [],
    inpaintDenoise: saved.inpaintDenoise ?? 0.85,
    outpaintUp: saved.outpaintUp ?? 0,
    outpaintDown: saved.outpaintDown ?? 0,
    outpaintLeft: saved.outpaintLeft ?? 0,
    outpaintRight: saved.outpaintRight ?? 0,
    outpaintPadR: saved.outpaintPadR ?? 0,
    outpaintPadG: saved.outpaintPadG ?? 0,
    outpaintPadB: saved.outpaintPadB ?? 0,

    upscaleImage: saved.upscaleImage || null,
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

    autoEnhance: saved.autoEnhance ?? false,

    outputMode: saved.outputMode || "save",
    saveSubfolder: saved.saveSubfolder || "",
  };
}

// PAINT 모드는 서브모드(inpaint/outpaint)별로 프롬프트가 독립적이어야 한다 — 원본 effectiveKey.
export function effectiveModeKey(state: Q21State, mode: Q21Mode): string {
  return mode === "inpaint" && state.paintSubMode === "outpaint" ? "outpaint" : mode;
}
export function getModePrompt(state: Q21State, mode?: Q21Mode): string {
  const key = effectiveModeKey(state, mode || state.mode);
  return state.promptsByMode[key] ?? "";
}
export function setModePrompt(state: Q21State, mode: Q21Mode, text: string) {
  const key = effectiveModeKey(state, mode);
  state.promptsByMode[key] = text;
  if (mode === state.mode) state.prompt = text;
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e15);
}
