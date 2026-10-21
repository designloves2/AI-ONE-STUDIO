// core.ts — Moss Image ONE STUDIO 상수/상태/헬퍼.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/moss/core_moss.js + one_node_moss.js (node f730ee9, ca925eb, 680f142) — 1:1 이식.
// 백엔드 nodes.py의 API 접두사("/moss_one")/저장 서브폴더와 반드시 일치해야 한다.
export { C, BRAND } from "../../identity";
export { el, clear } from "../../shared/ui";

export const SUBFOLDER = "moss-image-one-tj";
export const API = "/moss_one";
export const LORA_UI_CAP = 3;
export const LS_KEY = "moss_image_one_state_v1";

export type MossMode = "t2i" | "i2i" | "r2i" | "inpaint";

export const MODES: { key: MossMode; label: string }[] = [
  { key: "t2i", label: "T2I" },
  { key: "i2i", label: "I2I" },
  { key: "r2i", label: "R2I (bboxes)" },
  { key: "inpaint", label: "INPAINT" },
];

// Send-to targets per mode: where a generated result can be copied as the next mode's source image. T2I and R2I draw
// from text (and boxes), so they are not targets themselves.
const TO_I2I = { mode: "i2i" as MossMode, label: "→ I2I", field: "i2iImage" };
const TO_INPAINT = { mode: "inpaint" as MossMode, label: "→ Inpaint", field: "inpaintImage" };
export const SEND_TO: Record<MossMode, { mode: MossMode; label: string; field: string }[]> = {
  t2i: [TO_I2I, TO_INPAINT],
  i2i: [TO_INPAINT],
  inpaint: [TO_I2I],
  r2i: [TO_I2I, TO_INPAINT],
};

export const RESOLUTIONS: { label: string; w: number; h: number }[] = [
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

// MOSS-Image needs width and height in multiples of 16 (1080 is not): the size actually rendered.
export const snap16 = (v: number) => Math.max(64, Math.round(v / 16) * 16);
export function workSize(state: { width?: number; height?: number }) {
  return { w: snap16(state.width || 1024), h: snap16(state.height || 1024) };
}

// ComfyUI's full KSampler lists (node bd435ee) — read once from /object_info, short lists only as a fallback.
export { SAMPLERS, SCHEDULERS } from "../../shared/samplerLists";

// MOSS-Image defaults (ComfyUI MOSS-Image template): 25 steps / CFG 2.5 / er_sde / simple.
export const DEFAULT_STEPS = 25;
export const DEFAULT_CFG = 2.5;
export const DEFAULT_NEGATIVE = "nsfw, worst quality, bad anatomy, watermark, jpeg artifact";

/** One R2I box: ComfyUI CreateBoundingBoxes editor_state entry, in canvas pixels of the working size. */
export interface R2IBox {
  x: number;
  y: number;
  width: number;
  height: number;
  metadata: { type: "obj" | "text"; text: string; desc: string; palette: unknown[] };
}

export interface MossState {
  mode: MossMode;

  // Models (Settings)
  model: string; // moss_image_sft_* (or moss_image_base_*)
  textEncoder: string; // qwen3.5_9b_* (CLIPLoader type moss_image)
  vae: string; // flux2-vae

  // Runs Prompt Enhance on the current prompt right before Generate, updating the PROMPT field in place.
  autoEnhance: boolean;

  prompt: string;
  promptsByMode: Record<string, string>;
  negativePrompt: string;

  width: number;
  height: number;

  loras: { name: string; strength: number; triggerWord?: string; enabled: boolean }[];

  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number;
  seedMode: string;

  // Skip layer guidance on the model (official layer 22; off = more detail collapse risk gone, anime can overblow)
  slgEnabled: boolean;
  slgLayers: string;
  slgStart: number;
  slgEnd: number;

  // I2I — source image encoded to a latent and re-noised (MOSS has no reference-image input)
  i2iImage: string | null;
  i2iDenoise: number;
  i2iWidth: number; // the source's own size (set on upload); 0 = use width / height
  i2iHeight: number;
  i2iLockRatio: boolean;

  // INPAINT — source + painted mask; the work size is the source's own (set on upload)
  inpaintImage: string | null;
  inpaintMask: string | null;
  inpaintDenoise: number;
  inpaintWidth: number;
  inpaintHeight: number;

  // R2I — region (bounding box) layout. Boxes are in canvas pixels of width x height.
  r2iBoxes: R2IBox[];
  r2iCharacters: string; // numbers of the object boxes to label as characters, e.g. "1, 3"

  outputMode: string; // "save" | "preview"
  saveSubfolder: string;
}

export function loadState(): Partial<MossState> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}
export function saveState(s: MossState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
}

export function defaultState(saved: Partial<MossState> = {}): MossState {
  return {
    mode: (saved.mode as MossMode) || "t2i",

    model: saved.model || "",
    textEncoder: saved.textEncoder || "",
    vae: saved.vae || "",

    autoEnhance: saved.autoEnhance ?? false,

    prompt: saved.prompt || "",
    promptsByMode: saved.promptsByMode || {},
    negativePrompt: saved.negativePrompt ?? DEFAULT_NEGATIVE,

    width: saved.width || 1024,
    height: saved.height || 1024,

    loras: Array.isArray(saved.loras)
      ? saved.loras.map((l: any) => ({ name: l.name || "none", strength: l.strength ?? 0.8, triggerWord: l.triggerWord || "", enabled: l.enabled !== false }))
      : [],

    steps: saved.steps ?? DEFAULT_STEPS,
    cfg: saved.cfg ?? DEFAULT_CFG,
    sampler: saved.sampler || "er_sde",
    scheduler: saved.scheduler || "simple",
    seed: saved.seed ?? 0,
    seedMode: saved.seedMode || "randomize",

    slgEnabled: saved.slgEnabled ?? false,
    slgLayers: saved.slgLayers || "22",
    slgStart: saved.slgStart ?? 0,
    slgEnd: saved.slgEnd ?? 0.5,

    i2iImage: saved.i2iImage || null,
    i2iDenoise: saved.i2iDenoise ?? 0.6,
    i2iWidth: saved.i2iWidth || 0,
    i2iHeight: saved.i2iHeight || 0,
    i2iLockRatio: saved.i2iLockRatio ?? true,

    inpaintImage: saved.inpaintImage || null,
    inpaintMask: saved.inpaintMask || null,
    inpaintDenoise: saved.inpaintDenoise ?? 1.0,
    inpaintWidth: saved.inpaintWidth || 0,
    inpaintHeight: saved.inpaintHeight || 0,

    r2iBoxes: Array.isArray(saved.r2iBoxes) ? saved.r2iBoxes : [],
    r2iCharacters: saved.r2iCharacters || "",

    outputMode: saved.outputMode || "save",
    saveSubfolder: saved.saveSubfolder || "",
  };
}

// 모드별 프롬프트는 완전히 독립적이어야 한다 — 조회는 항상 promptsByMode[key]만 본다 (state.prompt는 현재 모드 캐시일 뿐).
export function getModePrompt(state: MossState, mode?: string): string {
  const key = mode || state.mode;
  return state.promptsByMode[key] ?? "";
}
export function setModePrompt(state: MossState, mode: string, text: string) {
  state.promptsByMode[mode] = text;
  if (mode === state.mode) state.prompt = text;
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e15);
}

export const MANUAL_TEXT = `MOSS-Image is an open ~5B text-to-image model (single-stream DiT, FLUX.2 small VAE, Qwen3.5 text encoder). Strong at English / Chinese text rendering and layout control. Apache 2.0.

MODES
• T2I — prompt to image.
• I2I — the source image is encoded to a latent and re-noised; DENOISE sets how far it may change. (MOSS itself has no reference-image input.)
• R2I (bboxes) — draw boxes on the canvas. Each box is an OBJECT (a described thing) or a TEXT block (exact words to render). Boxes go through MOSSImageLayoutPrompt, which turns them plus your PROMPT (description of the whole image) into the layout prompt the model was trained on. Draw the background element first and foreground last. "Characters" = numbers of the object boxes to label as characters, e.g. 1, 3.
• INPAINT — paint a mask on the source; only the painted area is repainted (latent noise mask + DifferentialDiffusion).

SIZE
Total pixels of 1M, 1.5M or 2M are recommended (0.25M to 4M works). Width and height must be multiples of 16.

SAMPLING (ComfyUI template defaults)
25 steps / CFG 2.5 / er_sde / simple. The official defaults are 50 steps / CFG 3 / Euler. SFT checkpoints give clearer text layouts; Base has no post-training (better for LoRAs).
SLG (skip layer guidance, layer 22) is optional: off looks more realistic, on keeps detail but can overblow anime styles.
Recommended negative prompt: nsfw, worst quality, bad anatomy, watermark, jpeg artifact

REQUIRED FILES (Hugging Face: Comfy-Org/MOSS-Image)
• moss_image_sft_int8_convrot.safetensors (or moss_image_sft_bf16 / moss_image_base_*) → models/diffusion_models/
• qwen3.5_9b_w4a8_gptq.safetensors (loaded as CLIP type moss_image) → models/text_encoders/
• flux2-vae.safetensors (flux2-vae_small.safetensors) → models/vae/

Needs a ComfyUI recent enough to have the MOSS-Image nodes (EmptyFlux2LatentImage, MOSSImageLayoutPrompt, CreateBoundingBoxes).`;
