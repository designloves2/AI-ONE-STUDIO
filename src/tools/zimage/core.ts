// core.ts — Z-Image Turbo ONE STUDIO 상수/상태/헬퍼.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/zimage/core.js + one_node_z_image_turbo.js — 1:1 이식.
// 백엔드 nodes.py의 ZIT_SUBFOLDER("one_z-image")/API 접두사("/z_image_turbo")와 반드시 일치해야 한다.
export { C, BRAND } from "../../identity";
export { el, clear } from "../../shared/ui";

export const SUBFOLDER = "one_z-image";
export const API = "/z_image_turbo";
export const LS_KEY = "z_image_one_tj_state_v1";

// 원본 MODES 7종. Phase 1: t2i/i2i/upscale 완전 구현. 나머지 4개(Phase 2)는 좌측 패널이
// "Coming soon" placeholder이며 모드 버튼 자체는 원본과 동일하게 이미 노출된다.
export type ZImageMode = "t2i" | "i2i" | "inpaint" | "rebg" | "controlnet" | "face_redraw" | "upscale";

export interface LoraEntry {
  name: string;
  strength: number;
  triggerWord: string;
  enabled: boolean;
}

// 원본 SEND_TO — 7개 모드가 서로 전부 연결(자기 자신 제외). Phase 1 미구현 모드로도 보낼 수 있게
// 필드는 이미 정의해 두되, 실제 좌측 패널이 없는 모드는 Send-to를 눌러도 안내만 표시한다.
const ALL_TARGETS: { mode: ZImageMode; label: string; field: string }[] = [
  { mode: "t2i", label: "→ T2I", field: "i2iImage" },
  { mode: "i2i", label: "→ I2I", field: "i2iImage" },
  { mode: "inpaint", label: "→ Inpaint", field: "inpaintImage" },
  { mode: "rebg", label: "→ Re-BG", field: "rebgImage" },
  { mode: "controlnet", label: "→ ControlNet", field: "controlnetImage" },
  { mode: "face_redraw", label: "→ Face Redraw", field: "faceImage" },
  { mode: "upscale", label: "→ Upscale", field: "upscaleImage" },
];
export const SEND_TO: Record<ZImageMode, { mode: ZImageMode; label: string; field: string }[]> = {
  t2i: ALL_TARGETS.filter((t) => t.mode !== "t2i"),
  i2i: ALL_TARGETS.filter((t) => t.mode !== "i2i"),
  inpaint: ALL_TARGETS.filter((t) => t.mode !== "inpaint"),
  rebg: ALL_TARGETS.filter((t) => t.mode !== "rebg"),
  controlnet: ALL_TARGETS.filter((t) => t.mode !== "controlnet"),
  face_redraw: ALL_TARGETS.filter((t) => t.mode !== "face_redraw"),
  upscale: ALL_TARGETS.filter((t) => t.mode !== "upscale"),
};

// Phase 1에서 실제로 그래프를 만들 수 있는 모드.
export const IMPLEMENTED_MODES: ZImageMode[] = ["t2i", "i2i", "upscale"];

export interface ZImageState {
  mode: ZImageMode;
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
  shift: number;
  sampler: string;
  scheduler: string;
  seed: number;
  seedMode: string;

  loras: LoraEntry[];

  i2iImage: string;
  i2iWidth: number | null;
  i2iHeight: number | null;
  i2iLockRatio: boolean;
  i2iDenoise: number;

  inpaintImage: string;
  rebgImage: string;
  controlnetImage: string;
  faceImage: string;

  upscaleImage: string;
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

export const SAMPLERS = ["euler", "res_multistep", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde", "uni_pc", "lcm"];
export const SCHEDULERS = ["simple", "normal", "sgm_uniform", "karras", "beta", "exponential", "ays", "gits"];
export const LORA_UI_CAP = 3;

export const SEEDVR2_ATTN_MODES = ["sdpa", "flash_attn_2", "flash_attn_3", "sageattn_2", "sageattn_3"];
export const SEEDVR2_COLOR_MODES = ["lab", "wavelet", "wavelet_adaptive", "hsv", "adain", "none"];

// 원본 RES_PRESETS (ui_t2i_i2i.js) — Krea2의 14개짜리 목록과 다르니 그대로 이식.
export const RESOLUTIONS: { label: string; w: number; h: number }[] = [
  { label: "1024 × 1536", w: 1024, h: 1536 },
  { label: "1536 × 1024", w: 1536, h: 1024 },
  { label: "1024 × 1024", w: 1024, h: 1024 },
  { label: "1216 × 832", w: 1216, h: 832 },
  { label: "832 × 1216", w: 832, h: 1216 },
  { label: "1344 × 768", w: 1344, h: 768 },
  { label: "768 × 1344", w: 768, h: 1344 },
  { label: "Custom", w: 0, h: 0 },
];

// 원본 MODES 라벨 (one_node_z_image_turbo.js)
export const MODES: { key: ZImageMode; label: string }[] = [
  { key: "t2i", label: "T2I" },
  { key: "i2i", label: "I2I" },
  { key: "inpaint", label: "INPAINT" },
  { key: "rebg", label: "RE-BG" },
  { key: "controlnet", label: "CONTROLNET" },
  { key: "face_redraw", label: "FACE REDRAW" },
  { key: "upscale", label: "UPSCALE" },
];

export function loadState(): Partial<ZImageState> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}
export function saveState(s: ZImageState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
}

export function snap8(v: number) {
  return Math.max(8, Math.round(v / 8) * 8);
}

export function defaultState(saved: Partial<ZImageState> = {}): ZImageState {
  return {
    mode: (saved.mode as ZImageMode) || "t2i",
    model: saved.model || "",
    textEncoder: saved.textEncoder || "",
    vae: saved.vae || "",

    prompt: saved.prompt || "",
    promptsByMode: saved.promptsByMode || {},
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
    seedMode: saved.seedMode || "randomize",

    loras: Array.isArray(saved.loras)
      ? saved.loras.map((l) => ({ name: l.name || "none", strength: l.strength ?? 1, triggerWord: l.triggerWord || "", enabled: l.enabled !== false }))
      : [],

    i2iImage: saved.i2iImage || "",
    i2iWidth: saved.i2iWidth || null,
    i2iHeight: saved.i2iHeight || null,
    i2iLockRatio: saved.i2iLockRatio ?? true,
    i2iDenoise: saved.i2iDenoise ?? 0.75,

    inpaintImage: saved.inpaintImage || "",
    rebgImage: saved.rebgImage || "",
    controlnetImage: saved.controlnetImage || "",
    faceImage: saved.faceImage || "",

    upscaleImage: saved.upscaleImage || "",
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

export function getModePrompt(state: ZImageState, mode?: string): string {
  const key = mode || state.mode;
  return key in state.promptsByMode ? state.promptsByMode[key] : state.prompt || "";
}
export function setModePrompt(state: ZImageState, mode: string, text: string) {
  state.promptsByMode[mode] = text;
  if (mode === state.mode) state.prompt = text;
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e15);
}
