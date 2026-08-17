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
  { mode: "rebg", label: "→ Redraw-BG", field: "rebgImage" },
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

// 실제로 그래프를 만들 수 있는 모드 (Phase 1: t2i/i2i/upscale, Phase 2: 나머지 4개 추가).
export const IMPLEMENTED_MODES: ZImageMode[] = ["t2i", "i2i", "inpaint", "rebg", "controlnet", "face_redraw", "upscale"];

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
  inpaintMaskImage: string | null;
  inpaintDenoise: number;

  rebgImage: string;
  rebgBgModel: string;
  rebgOffset: number;
  rebgBlur: number;
  rebgUp: number;
  rebgDown: number;
  rebgLeft: number;
  rebgRight: number;
  rebgFeather: number;
  rebgDenoise: number;

  controlnetImage: string;
  controlnetModel: string;
  controlnetType: string;
  controlnetStrength: number;
  controlnetResolution: number;
  controlnetDenoise: number;

  faceImage: string;
  faceDetectorModel: string;
  faceThreshold: number;
  faceDilation: number;
  faceDenoise: number;
  faceFeather: number;

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
  { key: "rebg", label: "REDRAW-BG" },
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

    // 구버전 저장 데이터(promptsByMode 없이 prompt 필드만 있던 시절) 마이그레이션 — 저장 당시
    // 활성 모드에만 값을 이관하고, 다른 모드는 절대 이 값을 공유하지 않는다. promptsByMode
    // 필드 자체가 없던 "진짜 구버전" 데이터에만 적용해야 한다 — "현재 모드에 값이 아직 없다"는
    // 조건으로 매번 재실행하면 마지막으로 입력했던 모드의 프롬프트가 처음 방문하는 다른
    // 모드로 새는 버그가 재발한다(Klein에서 실제 재현 확인 후 세 도구 모두 수정).
    prompt: saved.prompt || "",
    promptsByMode: (() => {
      if (saved.promptsByMode) return { ...saved.promptsByMode };
      const p: Record<string, string> = {};
      if (saved.prompt) p[(saved.mode as ZImageMode) || "t2i"] = saved.prompt;
      return p;
    })(),
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
    inpaintMaskImage: saved.inpaintMaskImage || null,
    inpaintDenoise: saved.inpaintDenoise ?? 0.85,

    rebgImage: saved.rebgImage || "",
    rebgBgModel: saved.rebgBgModel || "none",
    rebgOffset: saved.rebgOffset ?? 0,
    rebgBlur: saved.rebgBlur ?? 0,
    rebgUp: saved.rebgUp ?? 0,
    rebgDown: saved.rebgDown ?? 0,
    rebgLeft: saved.rebgLeft ?? 0,
    rebgRight: saved.rebgRight ?? 0,
    rebgFeather: saved.rebgFeather ?? 40,
    rebgDenoise: saved.rebgDenoise ?? 1,

    controlnetImage: saved.controlnetImage || "",
    controlnetModel: saved.controlnetModel || "none",
    controlnetType: saved.controlnetType || "depth",
    controlnetStrength: saved.controlnetStrength ?? 1,
    controlnetResolution: saved.controlnetResolution ?? 1024,
    controlnetDenoise: saved.controlnetDenoise ?? 1,

    faceImage: saved.faceImage || "",
    faceDetectorModel: saved.faceDetectorModel || "none",
    faceThreshold: saved.faceThreshold ?? 0.5,
    faceDilation: saved.faceDilation ?? 4,
    faceDenoise: saved.faceDenoise ?? 0.5,
    faceFeather: saved.faceFeather ?? 5,

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

// 모드별 프롬프트는 완전히 독립적이어야 한다 — 다른 모드에 값이 없다고 해서 state.prompt(공유
// 필드)로 폴백하면 "T2I에 입력한 프롬프트가 I2I에도 보임" 버그가 생긴다. state.prompt는 이제
// 순수하게 "현재 선택된 모드의 프롬프트 캐시" 역할만 하고, 조회는 항상 promptsByMode[key]만 본다.
export function getModePrompt(state: ZImageState, mode?: string): string {
  const key = mode || state.mode;
  return state.promptsByMode[key] ?? "";
}
export function setModePrompt(state: ZImageState, mode: string, text: string) {
  state.promptsByMode[mode] = text;
  if (mode === state.mode) state.prompt = text;
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e15);
}
