// core.ts — Krea2 ONE STUDIO 상수/상태/헬퍼.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/krea2/core_krea2.js — 1:1 이식
// (정사각형 위젯 전용 레이아웃 상수(NODE_W/PREVIEW_SIZE/LEFT_W)는 웹 레이아웃에서 쓰지 않으므로 제외)
export { C, BRAND } from "../../identity";
export { el, clear } from "../../shared/ui";

// 백엔드 nodes.py의 K2_SUBFOLDER와 반드시 일치해야 한다 (실제 저장/갤러리 스캔 폴더 기준).
export const SUBFOLDER = "one_krea2";
export const API = "/krea2_one";
export const LS_KEY = "krea2_one_state_v1";

export type Krea2Mode = "t2i" | "i2i" | "identity" | "upscale";

export interface ResolutionOption {
  label: string;
  w: number;
  h: number;
}

// 원본 RESOLUTIONS 그대로 — "Custom"(w:0,h:0)은 커스텀 W/H 입력을 켜는 sentinel
export const RESOLUTIONS: ResolutionOption[] = [
  { label: "1024 × 1024", w: 1024, h: 1024 },
  { label: "1024 × 1536", w: 1024, h: 1536 },
  { label: "1536 × 1024", w: 1536, h: 1024 },
  { label: "1536 × 1536", w: 1536, h: 1536 },
  { label: "2048 × 2048", w: 2048, h: 2048 },
  { label: "1152 × 768", w: 1152, h: 768 },
  { label: "768 × 1152", w: 768, h: 1152 },
  { label: "1152 × 864", w: 1152, h: 864 },
  { label: "864 × 1152", w: 864, h: 1152 },
  { label: "1280 × 720", w: 1280, h: 720 },
  { label: "720 × 1280", w: 720, h: 1280 },
  { label: "1920 × 1080", w: 1920, h: 1080 },
  { label: "1080 × 1920", w: 1080, h: 1920 },
  { label: "Custom", w: 0, h: 0 },
];

export const SAMPLERS = ["euler", "dpmpp_2m_sde", "dpmpp_2m", "euler_ancestral", "heun"];
export const SCHEDULERS = ["simple", "sgm_uniform", "karras", "normal", "exponential"];
export const LORA_MAX = 4;
// 원본 UI(mountLoraSectionKrea2)가 실제로 강제하는 상한 — LORA_MAX 상수와 별개로 3까지만 추가 가능.
export const LORA_UI_CAP = 3;

// DepthAnythingV2 checkpoints — vitg(Giant)는 게이트된 HF repo라 의도적으로 제외.
export const DEPTH_CKPTS = ["depth_anything_v2_vitl.pth", "depth_anything_v2_vitb.pth", "depth_anything_v2_vits.pth"];
export function safeDepthCkpt(name: string | undefined): string {
  return name && DEPTH_CKPTS.includes(name) ? name : "depth_anything_v2_vitl.pth";
}

export const SEEDVR2_ATTN_MODES = ["sdpa", "flash_attn_2", "flash_attn_3", "sageattn_2", "sageattn_3"];
export const SEEDVR2_COLOR_MODES = ["lab", "wavelet", "wavelet_adaptive", "hsv", "adain", "none"];

export const MODES: { key: Krea2Mode; label: string }[] = [
  { key: "t2i", label: "Text → Image" },
  { key: "i2i", label: "Image → Image" },
  { key: "identity", label: "Identity Edit" },
  { key: "upscale", label: "Upscale (SeedVR2)" },
];

// 원본 one_node_krea2.js의 SEND_TO 맵 — T2I는 나머지 3모드 전부, 그 외는 T2I·현재모드 제외한 나머지.
export const SEND_TO: Record<Krea2Mode, { mode: Krea2Mode; label: string; field: keyof Krea2State }[]> = {
  t2i: [
    { mode: "i2i", label: "→ I2I", field: "i2iImage" },
    { mode: "identity", label: "→ Identity", field: "identityImage" },
    { mode: "upscale", label: "→ Upscale", field: "upscaleImage" },
  ],
  i2i: [
    { mode: "identity", label: "→ Identity", field: "identityImage" },
    { mode: "upscale", label: "→ Upscale", field: "upscaleImage" },
  ],
  identity: [
    { mode: "i2i", label: "→ I2I", field: "i2iImage" },
    { mode: "upscale", label: "→ Upscale", field: "upscaleImage" },
  ],
  upscale: [
    { mode: "i2i", label: "→ I2I", field: "i2iImage" },
    { mode: "identity", label: "→ Identity", field: "identityImage" },
  ],
};

export interface LoraEntry {
  name: string;
  strength: number;
  triggerWord: string;
  enabled: boolean;
}

export interface Krea2State {
  mode: Krea2Mode;
  model: string;
  textEncoder: string;
  vae: string;

  prompt: string;
  promptsByMode: Record<string, string>;
  promptSuffix: string;
  // 원본 Krea2는 negative 프롬프트가 없고 항상 ConditioningZeroOut을 쓰지만,
  // 사용자 요청으로 이 사이트에서는 실제 negative 텍스트 입력을 추가한다 —
  // 비어 있으면 원본과 동일하게 ConditioningZeroOut으로 폴백한다.
  negativePrompt: string;

  width: number;
  height: number;

  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number;
  seedMode: string;

  loras: LoraEntry[];

  // I2I
  i2iImage: string;
  i2iWidth: number | null;
  i2iHeight: number | null;
  i2iLockRatio: boolean;
  i2iDenoise: number;

  // ControlNet (Krea2 Control LoRA / NK2E canny) — LoRA 파일은 Settings에서 1회 등록
  controlType: string; // "canny" | "depth"
  controlLoraDepth: string;
  controlLoraCanny: string;
  controlStrength: number;
  controlChannelMode: string;
  controlNormalize: string;
  controlInvert: boolean;
  cannyLow: number;
  cannyHigh: number;
  depthCkpt: string;
  preprocResolution: number;
  t2iControlEnabled: boolean;
  t2iControlImage: string;
  t2iControlImageW: number | null;
  t2iControlImageH: number | null;
  i2iControlEnabled: boolean;
  i2iControlImage: string;
  i2iControlImageW: number | null;
  i2iControlImageH: number | null;

  // Identity Edit (comfyui-krea2edit)
  identityImage: string;
  identityImageB: string;
  identityWidth: number | null;
  identityHeight: number | null;
  identityLockRatio: boolean;
  identityRefBoost: number;
  identityGroundingPx: number;
  identityFitMode: string; // "fit" | "crop (legacy)"
  identityLora: string;
  identityLoraStrength: number;

  // Upscale (SeedVR2)
  upscaleImage: string;
  upscaleDitModel: string;
  upscaleVaeModel: string;
  upscaleResolution: number;
  upscaleMaxResolution: number;
  upscaleBatchSize: number;
  upscaleBlocksToSwap: number;
  upscaleAttentionMode: string;
  upscaleColorCorrection: string;
  upscaleOffloadDevice: string;
  upscaleInputNoiseScale: number;
  upscaleLatentNoiseScale: number;

  outputMode: string; // "save" | "preview"
  saveSubfolder: string;
}

export function loadState(): Partial<Krea2State> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}
export function saveState(s: Krea2State) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
}

export function defaultState(saved: Partial<Krea2State> = {}): Krea2State {
  return {
    mode: saved.mode || "t2i",
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
      const activeMode = (saved.mode as any) || "t2i";
      if (saved.prompt) p[activeMode] = saved.prompt;
      return p;
    })(),
    promptSuffix: saved.promptSuffix || "",
    negativePrompt: saved.negativePrompt || "",

    width: saved.width || 1024,
    height: saved.height || 1024,

    steps: saved.steps ?? 8,
    cfg: saved.cfg ?? 1,
    sampler: saved.sampler || "euler",
    scheduler: saved.scheduler || "simple",
    seed: saved.seed ?? 0,
    seedMode: saved.seedMode || "randomize",

    loras: Array.isArray(saved.loras)
      ? saved.loras.map((l) => ({ name: l.name || "none", strength: l.strength ?? 0.8, triggerWord: l.triggerWord || "", enabled: l.enabled !== false }))
      : [],

    i2iImage: saved.i2iImage || "",
    i2iWidth: saved.i2iWidth || null,
    i2iHeight: saved.i2iHeight || null,
    i2iLockRatio: saved.i2iLockRatio ?? true,
    i2iDenoise: saved.i2iDenoise ?? 0.75,

    controlType: saved.controlType || "canny",
    controlLoraDepth: (saved as any).controlLoraDepth ?? (saved as any).controlLora ?? "none",
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

    identityImage: saved.identityImage || "",
    identityImageB: saved.identityImageB || "",
    identityWidth: saved.identityWidth || null,
    identityHeight: saved.identityHeight || null,
    identityLockRatio: saved.identityLockRatio ?? true,
    identityRefBoost: saved.identityRefBoost ?? 1.0,
    // grounding_px는 0(native) 또는 64 이상의 값만 유효 — 손상된 값(예: 8)이 남아있으면
    // 모델에 사실상 grounding 정보를 거의 안 주는 셈이라 identity가 완전히 무너진다.
    identityGroundingPx: (() => {
      const v = saved.identityGroundingPx;
      return v === 0 || (v ?? 0) >= 64 ? (v as number) : 768;
    })(),
    // 이전 세션에서 유효하지 않은 값(예: 예전 "cover")이 남아있으면 안전하게 폴백 — ComfyUI 검증 실패 방지.
    identityFitMode: saved.identityFitMode === "fit" || saved.identityFitMode === "crop (legacy)" ? saved.identityFitMode : "fit",
    identityLora: saved.identityLora || "none",
    identityLoraStrength: saved.identityLoraStrength ?? 1.0,

    upscaleImage: saved.upscaleImage || "",
    upscaleDitModel: saved.upscaleDitModel || "none",
    upscaleVaeModel: saved.upscaleVaeModel || "none",
    upscaleResolution: saved.upscaleResolution ?? 2048,
    upscaleMaxResolution: saved.upscaleMaxResolution ?? 4096,
    upscaleBatchSize: saved.upscaleBatchSize ?? 1,
    upscaleBlocksToSwap: saved.upscaleBlocksToSwap ?? 0,
    upscaleAttentionMode: saved.upscaleAttentionMode || "sdpa",
    upscaleColorCorrection: saved.upscaleColorCorrection || "lab",
    upscaleOffloadDevice: saved.upscaleOffloadDevice && saved.upscaleOffloadDevice !== "none" ? saved.upscaleOffloadDevice : "cpu",
    upscaleInputNoiseScale: saved.upscaleInputNoiseScale ?? 0,
    upscaleLatentNoiseScale: saved.upscaleLatentNoiseScale ?? 0,

    outputMode: saved.outputMode || "save",
    saveSubfolder: saved.saveSubfolder || "",
  };
}

// 모드별 프롬프트는 완전히 독립적이어야 한다 — state.prompt(공유 필드)로 폴백하지 않는다.
export function getModePrompt(state: Krea2State, mode?: string): string {
  const key = mode || state.mode;
  return state.promptsByMode[key] ?? "";
}
export function setModePrompt(state: Krea2State, mode: string, text: string) {
  state.promptsByMode[mode] = text;
  if (mode === state.mode) state.prompt = text;
}

/** 원본 graph_builder_krea2.js의 buildPromptText — 모드별 프롬프트 + 공용 suffix. */
export function buildPromptText(state: Krea2State, mode?: string): string {
  const body = getModePrompt(state, mode).trim();
  return [body, state.promptSuffix].map((s) => (s || "").trim()).filter(Boolean).join(", ");
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e15);
}

export function snap8(v: number) {
  return Math.max(8, Math.round(v / 8) * 8);
}

// 컨트롤 이미지의 비율에 맞춰 (긴 변 = 설정된 사이즈의 긴 변) 출력 크기를 계산.
// 원본 graph_builder_krea2.js의 controlOutputSize.
export function controlOutputSize(state: Krea2State, mode: "t2i" | "i2i"): { W: number; H: number } | null {
  const enabled = mode === "t2i" ? state.t2iControlEnabled : state.i2iControlEnabled;
  if (!enabled) return null;
  const cw = mode === "t2i" ? state.t2iControlImageW : state.i2iControlImageW;
  const ch = mode === "t2i" ? state.t2iControlImageH : state.i2iControlImageH;
  if (!cw || !ch) return null;
  const setW = mode === "t2i" ? state.width || 1024 : state.i2iWidth || state.width || 1024;
  const setH = mode === "t2i" ? state.height || 1024 : state.i2iHeight || state.height || 1024;
  const longEdge = Math.max(setW, setH);
  const ar = cw / ch;
  let W: number, H: number;
  if (cw >= ch) { W = longEdge; H = longEdge / ar; }
  else { H = longEdge; W = longEdge * ar; }
  const snap = (v: number) => Math.max(64, Math.round(v / 8) * 8);
  return { W: snap(W), H: snap(H) };
}

export function controlLoraForType(state: Krea2State, type?: string): string {
  return (type || state.controlType || "depth") === "canny" ? state.controlLoraCanny : state.controlLoraDepth;
}
