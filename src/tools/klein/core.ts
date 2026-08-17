// core.ts — Flux2 Klein ONE STUDIO 상수/상태/헬퍼.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/klein/core_klein.js + one_node_flux_2_klein.js.
// 백엔드 nodes.py의 FK_SUBFOLDER("one_flux2-klein")/API 접두사("/flux_klein")와 반드시 일치해야 한다.
export { C, BRAND } from "../../identity";
export { el, clear } from "../../shared/ui";

export const SUBFOLDER = "one_flux2-klein";
export const API = "/flux_klein";
export const LS_KEY = "flux2_klein_one_tj_state_v1";

// 원본 MODES: T2I/I2I/EDIT/PAINT(inpaint+outpaint 서브모드)/FACESWAP/UPSCALE.
export type KleinMode = "t2i" | "i2i" | "edit" | "inpaint" | "faceswap" | "upscale";
export type PaintSubMode = "inpaint" | "outpaint";

export interface LoraEntry {
  name: string;
  strength: number;
  triggerWord: string;
  enabled: boolean;
}
export interface EditRefImage {
  filename: string | null;
}

// 원본 SEND_TO — Inpaint 타겟은 subMode(inpaint/outpaint)에 따라 라벨이 갈린다.
export const SEND_TO: Record<KleinMode, { mode: KleinMode; label: string; field: string; subMode?: PaintSubMode }[]> = {
  t2i: [
    { mode: "i2i", label: "→ I2I", field: "i2iImage" },
    { mode: "edit", label: "→ Edit", field: "editImage1" },
    { mode: "inpaint", label: "→ Inpaint", field: "inpaintImage", subMode: "inpaint" },
    { mode: "inpaint", label: "→ Outpaint", field: "outpaintImage", subMode: "outpaint" },
    { mode: "faceswap", label: "→ Faceswap", field: "faceswapTarget" },
    { mode: "upscale", label: "→ Upscale", field: "upscaleImage" },
  ],
  i2i: [
    { mode: "edit", label: "→ Edit", field: "editImage1" },
    { mode: "inpaint", label: "→ Inpaint", field: "inpaintImage", subMode: "inpaint" },
    { mode: "inpaint", label: "→ Outpaint", field: "outpaintImage", subMode: "outpaint" },
    { mode: "faceswap", label: "→ Faceswap", field: "faceswapTarget" },
    { mode: "upscale", label: "→ Upscale", field: "upscaleImage" },
  ],
  edit: [
    { mode: "i2i", label: "→ I2I", field: "i2iImage" },
    { mode: "inpaint", label: "→ Inpaint", field: "inpaintImage", subMode: "inpaint" },
    { mode: "inpaint", label: "→ Outpaint", field: "outpaintImage", subMode: "outpaint" },
    { mode: "faceswap", label: "→ Faceswap", field: "faceswapTarget" },
    { mode: "upscale", label: "→ Upscale", field: "upscaleImage" },
  ],
  inpaint: [
    { mode: "i2i", label: "→ I2I", field: "i2iImage" },
    { mode: "edit", label: "→ Edit", field: "editImage1" },
    { mode: "faceswap", label: "→ Faceswap", field: "faceswapTarget" },
    { mode: "upscale", label: "→ Upscale", field: "upscaleImage" },
  ],
  faceswap: [
    { mode: "i2i", label: "→ I2I", field: "i2iImage" },
    { mode: "edit", label: "→ Edit", field: "editImage1" },
    { mode: "inpaint", label: "→ Inpaint", field: "inpaintImage", subMode: "inpaint" },
    { mode: "inpaint", label: "→ Outpaint", field: "outpaintImage", subMode: "outpaint" },
    { mode: "upscale", label: "→ Upscale", field: "upscaleImage" },
  ],
  upscale: [
    { mode: "i2i", label: "→ I2I", field: "i2iImage" },
    { mode: "edit", label: "→ Edit", field: "editImage1" },
    { mode: "inpaint", label: "→ Inpaint", field: "inpaintImage", subMode: "inpaint" },
    { mode: "inpaint", label: "→ Outpaint", field: "outpaintImage", subMode: "outpaint" },
    { mode: "faceswap", label: "→ Faceswap", field: "faceswapTarget" },
  ],
};

export interface KleinState {
  mode: KleinMode;
  model: string;
  textEncoder: string;
  vae: string;
  kvCacheOverride: string; // "auto" | "on" | "off"

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
  i2iWidth: number | null;
  i2iHeight: number | null;
  i2iLockRatio: boolean;
  i2iDenoise: number;

  editImage1: string | null;
  editImage2: string | null;
  editRefImages: EditRefImage[];
  editSizeSource: string; // "img1" | "manual"

  paintSubMode: PaintSubMode;
  inpaintImage: string | null;
  inpaintMaskImage: string | null;
  inpaintDenoise: number;
  outpaintImage: string | null;
  outpaintUp: number;
  outpaintDown: number;
  outpaintLeft: number;
  outpaintRight: number;
  outpaintPadR: number;
  outpaintPadG: number;
  outpaintPadB: number;

  faceswapTarget: string | null;
  faceswapSource: string | null;
  faceswapDenoise: number;
  bfsLora: LoraEntry | null;

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

  outputMode: string; // "save" | "preview"
  saveSubfolder: string;
}

export const SAMPLERS = ["euler", "euler_ancestral", "er_sde", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "heun", "dpm_pp_2m"];
export const SCHEDULERS = ["simple", "normal", "karras", "exponential", "sgm_uniform", "beta"];
export const LORA_UI_CAP = 3;
export const MAX_EDIT_REFS = 5;

export const SEEDVR2_ATTN_MODES = ["sdpa", "flash_attn_2", "flash_attn_3", "sageattn_2", "sageattn_3"];
export const SEEDVR2_COLOR_MODES = ["lab", "wavelet", "wavelet_adaptive", "hsv", "adain", "none"];

export const RESOLUTIONS: { label: string; w: number; h: number }[] = [
  { label: "1024 × 1536", w: 1024, h: 1536 },
  { label: "1536 × 1024", w: 1536, h: 1024 },
  { label: "1024 × 1024", w: 1024, h: 1024 },
  { label: "1920 × 1088", w: 1920, h: 1088 },
  { label: "1088 × 1920", w: 1088, h: 1920 },
  { label: "1280 × 720", w: 1280, h: 720 },
  { label: "720 × 1280", w: 720, h: 1280 },
  { label: "Custom", w: 0, h: 0 },
];

export const MODES: { key: KleinMode; label: string }[] = [
  { key: "t2i", label: "T2I" },
  { key: "i2i", label: "I2I" },
  { key: "edit", label: "EDIT" },
  { key: "inpaint", label: "PAINT" },
  { key: "faceswap", label: "FACESWAP" },
  { key: "upscale", label: "UPSCALE" },
];

const DEFAULT_NEG =
  "low quality, deformed, blurry, watermark, ugly, bad anatomy, disfigured, mutated, extra limbs, poorly drawn face, bad proportions, gross proportions, jpeg artifacts, overexposed, underexposed";

export function loadState(): Partial<KleinState> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}
export function saveState(s: KleinState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
}

export function snap8(v: number) {
  return Math.max(8, Math.round(v / 8) * 8);
}

export function defaultState(saved: Partial<KleinState> = {}): KleinState {
  return {
    mode: (saved.mode as KleinMode) || "t2i",
    model: saved.model || "",
    textEncoder: saved.textEncoder || "",
    vae: saved.vae || "",
    kvCacheOverride: saved.kvCacheOverride || "auto",

    // 구버전 저장 데이터 마이그레이션 — 다른 모드로 프롬프트가 새는 버그를 Krea2/Z-Image에서
    // 겪은 뒤 확립한 규칙: getModePrompt는 promptsByMode[key]만 보고 state.prompt로 폴백하지 않는다.
    prompt: saved.prompt || "",
    promptsByMode: (() => {
      const p = { ...(saved.promptsByMode || {}) };
      const activeMode = (saved.mode as KleinMode) || "t2i";
      if (saved.prompt && !(activeMode in p)) p[activeMode] = saved.prompt;
      return p;
    })(),
    negativePrompt: saved.negativePrompt || DEFAULT_NEG,
    promptSuffix: saved.promptSuffix || "",

    width: saved.width || 1024,
    height: saved.height || 1536,

    steps: saved.steps || 4,
    cfg: saved.cfg !== undefined ? saved.cfg : 1,
    sampler: saved.sampler || "euler",
    scheduler: saved.scheduler || "simple",
    seed: saved.seed ?? 0,
    seedMode: saved.seedMode || "randomize",

    loras: Array.isArray(saved.loras)
      ? saved.loras.map((l) => ({ name: l.name || "none", strength: l.strength ?? 1, triggerWord: l.triggerWord || "", enabled: l.enabled !== false }))
      : [],

    i2iImage: saved.i2iImage || null,
    i2iWidth: saved.i2iWidth || null,
    i2iHeight: saved.i2iHeight || null,
    i2iLockRatio: saved.i2iLockRatio ?? true,
    i2iDenoise: saved.i2iDenoise ?? 0.75,

    editImage1: saved.editImage1 || null,
    editImage2: saved.editImage2 || null,
    editRefImages: Array.isArray(saved.editRefImages) ? saved.editRefImages : [],
    editSizeSource: saved.editSizeSource || "img1",

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

    faceswapTarget: saved.faceswapTarget || null,
    faceswapSource: saved.faceswapSource || null,
    faceswapDenoise: saved.faceswapDenoise ?? 1.0,
    bfsLora: saved.bfsLora || null,

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

    outputMode: saved.outputMode || "save",
    saveSubfolder: saved.saveSubfolder || "",
  };
}

// PAINT 모드는 서브모드(inpaint/outpaint)별로 프롬프트가 독립적이어야 한다 — 원본 effectiveKey.
export function effectiveModeKey(state: KleinState, mode: KleinMode): string {
  return mode === "inpaint" && state.paintSubMode === "outpaint" ? "outpaint" : mode;
}
export function getModePrompt(state: KleinState, mode?: KleinMode): string {
  const key = effectiveModeKey(state, mode || state.mode);
  return state.promptsByMode[key] ?? "";
}
export function setModePrompt(state: KleinState, mode: KleinMode, text: string) {
  const key = effectiveModeKey(state, mode);
  state.promptsByMode[key] = text;
  if (mode === state.mode) state.prompt = text;
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e15);
}

export function getUseKV(state: KleinState): boolean {
  if (state.kvCacheOverride === "on") return true;
  if (state.kvCacheOverride === "off") return false;
  return (state.model || "").toLowerCase().includes("kv");
}
