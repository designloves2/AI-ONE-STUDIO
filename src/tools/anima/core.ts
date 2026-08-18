// core.ts — Anima ONE STUDIO 상수/상태/헬퍼.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/anima/core_anima.js + one_node_anima.js — 1:1 이식.
// 백엔드 nodes.py의 SUBFOLDER("anima-one-tj")/API 접두사("/anima_one")와 반드시 일치해야 한다.
export { C, BRAND } from "../../identity";
export { el, clear } from "../../shared/ui";

export const SUBFOLDER = "anima-one-tj";
export const API = "/anima_one";
export const LS_KEY = "anima_one_state_v1";

export type AnimaMode = "t2i" | "inpaint" | "anycontrol" | "depthcontrol";

export const MODES: { key: AnimaMode; label: string }[] = [
  { key: "t2i", label: "T2I" },
  { key: "inpaint", label: "INPAINTING" },
  { key: "anycontrol", label: "ANY CONTROL" },
  { key: "depthcontrol", label: "DEPTH CONTROL" },
];

// T2I는 자기 자신에게 이미지 입력이 없으므로 Send-to 대상에서 제외.
export const SEND_TO: Record<AnimaMode, { mode: AnimaMode; label: string; field: string }[]> = {
  t2i: [
    { mode: "inpaint", label: "→ Inpainting", field: "inpaintImage" },
    { mode: "anycontrol", label: "→ Any Control", field: "anyControlImage" },
    { mode: "depthcontrol", label: "→ Depth Control", field: "depthControlImage" },
  ],
  inpaint: [
    { mode: "anycontrol", label: "→ Any Control", field: "anyControlImage" },
    { mode: "depthcontrol", label: "→ Depth Control", field: "depthControlImage" },
  ],
  anycontrol: [
    { mode: "inpaint", label: "→ Inpainting", field: "inpaintImage" },
    { mode: "depthcontrol", label: "→ Depth Control", field: "depthControlImage" },
  ],
  depthcontrol: [
    { mode: "inpaint", label: "→ Inpainting", field: "inpaintImage" },
    { mode: "anycontrol", label: "→ Any Control", field: "anyControlImage" },
  ],
};

export const RESOLUTIONS: { label: string; w: number; h: number }[] = [
  { label: "1024 × 1024", w: 1024, h: 1024 },
  { label: "1024 × 1536", w: 1024, h: 1536 },
  { label: "1536 × 1024", w: 1536, h: 1024 },
  { label: "1152 × 768", w: 1152, h: 768 },
  { label: "768 × 1152", w: 768, h: 1152 },
  { label: "1280 × 720", w: 1280, h: 720 },
  { label: "720 × 1280", w: 720, h: 1280 },
  { label: "Custom", w: 0, h: 0 },
];

export const SAMPLERS = ["euler", "dpmpp_2m_sde", "dpmpp_2m", "euler_ancestral", "heun"];
export const SCHEDULERS = ["simple", "sgm_uniform", "karras", "normal", "exponential"];

// LLLite 컨트롤 패치 파일명 — 공식 Anima 템플릿 기준.
export const LLLITE_PATCH: Record<Exclude<AnimaMode, "t2i">, string> = {
  inpaint: "anima-lllite-inpainting-v2.safetensors",
  anycontrol: "anima-lllite-any-test-like-v2.safetensors",
  depthcontrol: "anima-lllite-depth-1.safetensors",
};

export const TURBO_LORA_DEFAULT = "anima-turbo-lora-v0.2.safetensors";

// Steps/CFG 전환값 — 공식 템플릿의 ComfySwitchNode 게이팅과 동일.
export const BASE_STEPS = 30;
export const BASE_CFG = 4;
export const TURBO_STEPS = 8;
export const TURBO_CFG = 1;

export interface AnimaState {
  mode: AnimaMode;

  // Models (Settings)
  model: string; // Base 1.0 (전 모드) 또는 T2I 전용 Preview3
  previewModel: string; // anima-preview3-base.safetensors
  textEncoder: string;
  vae: string;
  turboLora: string;

  prompt: string;
  promptsByMode: Record<string, string>;
  negativePrompt: string;

  width: number;
  height: number;

  useBaseVariant: "base" | "preview3"; // T2I 전용
  turboMode: boolean;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number;
  seedMode: string;

  // Inpainting
  inpaintImage: string;
  inpaintMask: string | null;
  inpaintStrength: number;
  inpaintStart: number;
  inpaintEnd: number;

  // Any Control to Image
  anyControlImage: string;
  anyControlMask: string | null;
  anyControlStrength: number;
  anyControlStart: number;
  anyControlEnd: number;

  // Depth Control to Image
  depthControlImage: string;
  depthControlStrength: number;
  depthControlStart: number;
  depthControlEnd: number;
  depthCkpt: string;
  preprocResolution: number;

  outputMode: string; // "save" | "preview"
  saveSubfolder: string;
}

export function loadState(): Partial<AnimaState> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}
export function saveState(s: AnimaState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
}

export function defaultState(saved: Partial<AnimaState> = {}): AnimaState {
  return {
    mode: (saved.mode as AnimaMode) || "t2i",

    model: saved.model || "",
    previewModel: saved.previewModel || "",
    textEncoder: saved.textEncoder || "",
    vae: saved.vae || "",
    turboLora: saved.turboLora || "",

    prompt: saved.prompt || "",
    promptsByMode: (() => {
      if (saved.promptsByMode) return { ...saved.promptsByMode };
      const p: Record<string, string> = {};
      if (saved.prompt) p[(saved.mode as AnimaMode) || "t2i"] = saved.prompt;
      return p;
    })(),
    negativePrompt: saved.negativePrompt || "",

    width: saved.width || 1024,
    height: saved.height || 1024,

    useBaseVariant: (saved.useBaseVariant as "base" | "preview3") || "base",
    turboMode: saved.turboMode ?? false,
    steps: saved.steps ?? BASE_STEPS,
    cfg: saved.cfg ?? BASE_CFG,
    sampler: saved.sampler || "euler",
    scheduler: saved.scheduler || "simple",
    seed: saved.seed ?? 0,
    seedMode: saved.seedMode || "randomize",

    inpaintImage: saved.inpaintImage || "",
    inpaintMask: saved.inpaintMask || null,
    inpaintStrength: saved.inpaintStrength ?? 1.0,
    inpaintStart: saved.inpaintStart ?? 0.0,
    inpaintEnd: saved.inpaintEnd ?? 1.0,

    anyControlImage: saved.anyControlImage || "",
    anyControlMask: saved.anyControlMask || null,
    anyControlStrength: saved.anyControlStrength ?? 1.0,
    anyControlStart: saved.anyControlStart ?? 0.0,
    anyControlEnd: saved.anyControlEnd ?? 1.0,

    depthControlImage: saved.depthControlImage || "",
    depthControlStrength: saved.depthControlStrength ?? 1.0,
    depthControlStart: saved.depthControlStart ?? 0.0,
    depthControlEnd: saved.depthControlEnd ?? 1.0,
    depthCkpt: saved.depthCkpt || "depth_anything_v2_vitl.pth",
    preprocResolution: saved.preprocResolution ?? 512,

    outputMode: saved.outputMode || "save",
    saveSubfolder: saved.saveSubfolder || "",
  };
}

// 모드별 프롬프트는 완전히 독립적이어야 한다 — 다른 도구들에서 겪은 "프롬프트 누수" 버그를
// 피하기 위해 조회는 항상 promptsByMode[key]만 본다 (state.prompt는 현재 모드 캐시일 뿐).
export function getModePrompt(state: AnimaState, mode?: string): string {
  const key = mode || state.mode;
  return state.promptsByMode[key] ?? "";
}
export function setModePrompt(state: AnimaState, mode: string, text: string) {
  state.promptsByMode[mode] = text;
  if (mode === state.mode) state.prompt = text;
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e15);
}

export const MANUAL_TEXT = `Anima is ComfyUI's native anime/illustration text-to-image model (2B params, non-photorealistic by design).

MODEL VARIANTS
• Base 1.0 (anima-base-v1.0.safetensors) — full-quality checkpoint, 30 steps / CFG 4. Used by all 4 modes.
• Turbo 1.0 — NOT a separate checkpoint. It is the Turbo LoRA (anima-turbo-lora-v0.2.safetensors) applied on top of Base 1.0, which also switches sampling to 8 steps / CFG 1. Toggle it with the TURBO switch in the left panel.
• Preview3-base (anima-preview3-base.safetensors) — an earlier/experimental checkpoint. T2I mode only. Lower quality than Base 1.0; select it in Settings only if you specifically want to compare.

REQUIRED FILES
• qwen_3_06b_base.safetensors → models/text_encoders/
• qwen_image_vae.safetensors → models/vae/
• anima-base-v1.0.safetensors → models/diffusion_models/
• anima-preview3-base.safetensors (optional, T2I only) → models/diffusion_models/
• anima-turbo-lora-v0.2.safetensors (optional) → models/loras/
• anima-lllite-inpainting-v2.safetensors (Inpainting mode) → models/model_patches/
• anima-lllite-any-test-like-v2.safetensors (Any Control mode) → models/model_patches/
• anima-lllite-depth-1.safetensors (Depth Control mode) → models/model_patches/

CONTROL MECHANISM
Inpainting / Any Control / Depth Control do NOT use a standard ControlNet — they use a lightweight LLLite model patch (ModelPatchLoader → AnimaLLLiteApply) applied directly onto the diffusion model, guided by an image (+ mask for Inpainting).

Depth Control in this app reuses the DepthAnythingV2 preprocessor already installed for other tools in this pack (instead of the official template's Depth-Anything-3 pipeline), so no extra model download is required beyond what Krea2's ControlNet setup already uses.

All files download from the HuggingFace repos: circlestone-labs/Anima, circlestone-labs/Anima-Official-LoRAs, Comfy-Org/Anima-LLLite.`;
