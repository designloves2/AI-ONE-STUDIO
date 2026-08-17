// core.ts — Qwen Image Edit 2511 ONE STUDIO 상수/상태/헬퍼.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/qwen2511/core_qwen2511.js + web/one_node_qwen2511.js.
// 백엔드 nodes.py의 QE_SUBFOLDER("one_qwen2511")/API 접두사("/qwen2511_one")와 반드시 일치해야 한다.
export { C, BRAND } from "../../identity";
export { el, clear } from "../../shared/ui";

export const SUBFOLDER = "one_qwen2511";
export const API = "/qwen2511_one";
export const LS_KEY = "qwen2511_one_tj_state_v1";

export type QEMode = "t2i" | "i2i" | "edit" | "inpaint" | "faceswap" | "angle" | "upscale";
export type PaintSubMode = "inpaint" | "outpaint";

export interface LoraEntry {
  name: string;
  strength: number;
  triggerWord: string;
  enabled: boolean;
}
export interface SimpleLora {
  name: string;
  strength: number;
  enabled: boolean;
}
export interface EditRefImage {
  filename: string | null;
}

// 원본 SEND_TO: T2I → 전체 모드, 나머지는 (전체 − T2I − 현재모드).
const ALL_TARGETS: { mode: QEMode; label: string; field: string; subMode?: PaintSubMode }[] = [
  { mode: "i2i", label: "→ I2I", field: "i2iImage" },
  { mode: "edit", label: "→ Edit", field: "editImage1" },
  { mode: "inpaint", label: "→ Inpaint", field: "inpaintImage", subMode: "inpaint" },
  { mode: "inpaint", label: "→ Outpaint", field: "inpaintImage", subMode: "outpaint" },
  { mode: "faceswap", label: "→ Face", field: "faceswapTarget" },
  { mode: "angle", label: "→ Angle", field: "angleCameraImage" },
  { mode: "upscale", label: "→ Upscale", field: "upscaleImage" },
];
export const SEND_TO: Record<QEMode, typeof ALL_TARGETS> = {
  t2i: ALL_TARGETS,
  i2i: ALL_TARGETS.filter((t) => t.mode !== "i2i"),
  edit: ALL_TARGETS.filter((t) => t.mode !== "edit"),
  inpaint: ALL_TARGETS.filter((t) => t.mode !== "inpaint"),
  faceswap: ALL_TARGETS.filter((t) => t.mode !== "faceswap"),
  angle: ALL_TARGETS.filter((t) => t.mode !== "angle"),
  upscale: ALL_TARGETS.filter((t) => t.mode !== "upscale"),
};

export interface QEState {
  mode: QEMode;
  model: string;
  textEncoder: string;
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

  lightningLora: SimpleLora;
  loras: LoraEntry[];

  i2iImage: string | null;
  i2iWidth: number | null;
  i2iHeight: number | null;
  i2iLockRatio: boolean;
  i2iDenoise: number;

  editImage1: string | null;
  editImage2: string | null;
  editRefImages: EditRefImage[];
  editSizeSource: string;

  paintSubMode: PaintSubMode;
  inpaintImage: string | null;
  inpaintMaskImage: string | null;
  inpaintDenoise: number;
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
  bfsLora: SimpleLora | null;

  angleCameraImage: string | null;
  angleHorizontal: number;
  angleVertical: number;
  angleZoom: number;
  angleLora: SimpleLora;

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

  outputMode: string;
  saveSubfolder: string;
}

export const SAMPLERS = ["euler", "euler_ancestral", "er_sde", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "heun", "dpm_pp_2m"];
export const SCHEDULERS = ["simple", "normal", "karras", "exponential", "sgm_uniform", "beta"];
export const LORA_UI_CAP = 3;
export const MAX_EDIT_REFS = 5;

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

export const MODES: { key: QEMode; label: string }[] = [
  { key: "t2i", label: "T2I" },
  { key: "i2i", label: "I2I" },
  { key: "edit", label: "EDIT" },
  { key: "inpaint", label: "PAINT" },
  { key: "faceswap", label: "FACESWAP" },
  { key: "angle", label: "ANGLE" },
  { key: "upscale", label: "UPSCALE" },
];

// ── Angle 프리셋/각도→프롬프트 변환 — 원본 core_qwen2511.js 그대로 ─────────────
export const AZIMUTH_PRESETS = [
  { label: "Front (0°)", value: 0 },
  { label: "Front-Right (45°)", value: 45 },
  { label: "Right (90°)", value: 90 },
  { label: "Back-Right (135°)", value: 135 },
  { label: "Back (180°)", value: 180 },
  { label: "Back-Left (225°)", value: 225 },
  { label: "Left (270°)", value: 270 },
  { label: "Front-Left (315°)", value: 315 },
];
export const ELEVATION_PRESETS = [
  { label: "Low Angle (-30°)", value: -30 },
  { label: "Eye Level (0°)", value: 0 },
  { label: "Elevated (30°)", value: 30 },
  { label: "High Angle (60°)", value: 60 },
];
export const ZOOM_PRESETS = [
  { label: "Wide Shot (1)", value: 1 },
  { label: "Medium Shot (4)", value: 4 },
  { label: "Close-up (8)", value: 8 },
];

export function buildAnglePrompt(h: number, v: number, z: number): string {
  const ha = ((h % 360) + 360) % 360;
  let hDir: string;
  if (ha < 22.5 || ha >= 337.5) hDir = "front view";
  else if (ha < 67.5) hDir = "front-right quarter view";
  else if (ha < 112.5) hDir = "right side view";
  else if (ha < 157.5) hDir = "back-right quarter view";
  else if (ha < 202.5) hDir = "back view";
  else if (ha < 247.5) hDir = "back-left quarter view";
  else if (ha < 292.5) hDir = "left side view";
  else hDir = "front-left quarter view";

  const vDir = v < -15 ? "high-angle shot" : v < 15 ? "eye-level shot" : v < 45 ? "elevated shot" : "low-angle shot";
  const dist = z < 4 ? "close-up" : z < 7 ? "medium shot" : "wide shot";
  return `<sks> ${hDir} ${vDir} ${dist}`;
}

export function loadState(): Partial<QEState> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}
export function saveState(s: QEState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
}

export function snap8(v: number) {
  return Math.max(8, Math.round(v / 8) * 8);
}

export function defaultState(saved: Partial<QEState> = {}): QEState {
  return {
    mode: (saved.mode as QEMode) || "edit",
    model: saved.model || "",
    textEncoder: saved.textEncoder || "",
    vae: saved.vae || "",

    // 구버전 마이그레이션 — promptsByMode 필드 자체가 없을 때만 이관한다. Krea2/Z-Image/Klein에서
    // 겪은 "현재 모드에 값 없음"을 조건으로 매번 재실행하면 프롬프트가 새는 버그가 재발한다.
    prompt: saved.prompt || "",
    promptsByMode: (() => {
      if (saved.promptsByMode) return { ...saved.promptsByMode };
      const p: Record<string, string> = {};
      if (saved.prompt) p[(saved.mode as QEMode) || "edit"] = saved.prompt;
      return p;
    })(),
    negativePrompt: saved.negativePrompt || "",
    promptSuffix: saved.promptSuffix || "",

    width: saved.width || 1024,
    height: saved.height || 1024,

    steps: saved.steps !== undefined ? saved.steps : 20,
    cfg: saved.cfg !== undefined ? saved.cfg : 4.0,
    sampler: saved.sampler || "euler",
    scheduler: saved.scheduler || "simple",
    seed: saved.seed ?? 0,
    seedMode: saved.seedMode || "randomize",

    lightningLora: saved.lightningLora
      ? { name: saved.lightningLora.name || "none", strength: saved.lightningLora.strength ?? 1, enabled: saved.lightningLora.enabled !== false }
      : { name: "none", strength: 1, enabled: false },

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
    bfsLora: saved.bfsLora ? { name: saved.bfsLora.name || "none", strength: saved.bfsLora.strength ?? 1, enabled: saved.bfsLora.enabled !== false } : null,

    angleCameraImage: saved.angleCameraImage || null,
    angleHorizontal: saved.angleHorizontal ?? 0,
    angleVertical: saved.angleVertical ?? 0,
    angleZoom: saved.angleZoom ?? 5,
    angleLora: saved.angleLora
      ? { name: saved.angleLora.name || "none", strength: saved.angleLora.strength ?? 1, enabled: saved.angleLora.enabled !== false }
      : { name: "none", strength: 1, enabled: true },

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
export function effectiveModeKey(state: QEState, mode: QEMode): string {
  return mode === "inpaint" && state.paintSubMode === "outpaint" ? "outpaint" : mode;
}
export function getModePrompt(state: QEState, mode?: QEMode): string {
  const key = effectiveModeKey(state, mode || state.mode);
  return state.promptsByMode[key] ?? "";
}
export function setModePrompt(state: QEState, mode: QEMode, text: string) {
  const key = effectiveModeKey(state, mode);
  state.promptsByMode[key] = text;
  if (mode === state.mode) state.prompt = text;
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e15);
}
