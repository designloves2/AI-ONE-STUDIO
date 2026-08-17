// api.ts — Z-Image 백엔드 REST 호출 이식.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/zimage/api.js (API="/z_image_turbo")
import { comfyApi } from "./comfyClient";
import { API, SUBFOLDER } from "./core";

const BASE = comfyApi.base;

async function jsonFetch(path: string, opts?: RequestInit) {
  const r = await comfyApi.fetchApi(path, opts);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

export async function getModels(): Promise<{ diffusion_models: string[]; text_encoders: string[]; vaes: string[]; loras: string[]; model_patches: string[]; face_detectors: string[] }> {
  try {
    return await jsonFetch(`${API}/models`);
  } catch {
    return { diffusion_models: [], text_encoders: [], vaes: [], loras: [], model_patches: [], face_detectors: [] };
  }
}

// 원본 ui_rebg.js — /z_image_turbo/bgremoval_models (Re-BG 전용, /models와 별도 엔드포인트).
export async function getBgRemovalModels(): Promise<string[]> {
  try {
    const d = await jsonFetch(`${API}/bgremoval_models`);
    return d.models || [];
  } catch {
    return [];
  }
}

export async function getSeedVR2Models(): Promise<{ models: string[] }> {
  try {
    return await jsonFetch(`${API}/seedvr2_models`);
  } catch {
    return { models: [] };
  }
}

export async function getLoraTriggers(name: string): Promise<string> {
  try {
    const d = await jsonFetch(`${API}/lora_triggers?name=${encodeURIComponent(name)}`);
    return d.ok && d.triggers?.length ? d.triggers.join(", ") : "";
  } catch {
    return "";
  }
}

// 원본 api.js 고유 기능 — Krea2에는 없음: /object_info/KSampler에서 실제 유효한
// sampler/scheduler 목록을 동적으로 가져온다 (하드코딩 목록은 폴백용).
export async function getKSamplerOptions(): Promise<{ samplers: string[]; schedulers: string[] } | null> {
  try {
    const d = await jsonFetch(`/object_info/KSampler`);
    const inputs = d?.KSampler?.input?.required;
    const samplers = inputs?.sampler_name?.[0];
    const schedulers = inputs?.scheduler?.[0];
    if (Array.isArray(samplers) && Array.isArray(schedulers)) return { samplers, schedulers };
    return null;
  } catch {
    return null;
  }
}

export async function getConfig(): Promise<any> {
  try {
    return await jsonFetch(`${API}/config`);
  } catch {
    return {};
  }
}
export async function saveConfig(cfg: any): Promise<void> {
  await jsonFetch(`${API}/config`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) }).catch(() => {});
}

export async function uploadImage(file: File | Blob, filename = "upload.png"): Promise<string> {
  const fd = new FormData();
  fd.append("image", file, filename);
  fd.append("subfolder", "");
  fd.append("type", "input");
  const r = await comfyApi.fetchApi("/upload/image", { method: "POST", body: fd });
  const d = await r.json();
  return d.name;
}

export function imageToB64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function viewUrl(filename: string, subfolder = "", type: "input" | "output" | "temp" = "input", t?: number) {
  return `${BASE}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${type}${t ? `&t=${t}` : ""}`;
}
export function outputViewUrl(filename: string, subfolder = "", t?: number) {
  return viewUrl(filename, subfolder, "output", t);
}

export interface GalleryImage {
  filename: string;
  subfolder: string;
  mtime: number;
  size: number;
  favorite?: boolean;
  prompt?: string;
  meta?: any;
}

export async function getGallery(opts: { offset?: number; limit?: number; subfolder?: string; favonly?: boolean } = {}): Promise<{ images: GalleryImage[]; total: number }> {
  const q = new URLSearchParams();
  if (opts.offset != null) q.set("offset", String(opts.offset));
  if (opts.limit != null) q.set("limit", String(opts.limit));
  q.set("subfolder", opts.subfolder ?? SUBFOLDER);
  if (opts.favonly) q.set("favonly", "1");
  try {
    return await jsonFetch(`${API}/gallery?${q.toString()}`);
  } catch {
    return { images: [], total: 0 };
  }
}

export async function updateImageMeta(filename: string, subfolder: string, patch: any): Promise<void> {
  await jsonFetch(`${API}/update_meta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, subfolder, patch }),
  }).catch(() => {});
}

export async function deleteImage(filename: string, subfolder: string): Promise<void> {
  await jsonFetch(`${API}/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, subfolder }),
  }).catch(() => {});
}

export async function openImageFolder(filename: string, subfolder: string): Promise<void> {
  await jsonFetch(`${API}/open_folder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, subfolder }),
  }).catch(() => {});
}

export async function copyOutputToInput(filename: string, subfolder: string, type = "output"): Promise<string> {
  const d = await jsonFetch(`${API}/copy_to_input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, subfolder, type }),
  });
  if (!d.ok) throw new Error(d.error || "copy failed");
  return d.filename;
}

export async function setLastImage(filename: string, subfolder: string): Promise<void> {
  await jsonFetch(`${API}/set_last_image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, subfolder }),
  }).catch(() => {});
}

export async function loadMeta(filename: string, subfolder: string): Promise<any> {
  try {
    return await jsonFetch(`${API}/meta?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}`);
  } catch {
    return null;
  }
}
export async function saveMeta(filename: string, subfolder: string, meta: any): Promise<void> {
  await jsonFetch(`${API}/save_meta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, subfolder, meta }),
  }).catch(() => {});
}

export async function interrupt(): Promise<void> {
  await comfyApi.fetchApi("/interrupt", { method: "POST" }).catch(() => {});
}

// 원본 api.js: Z-Image는 전용 /z_image_turbo/free_memory 엔드포인트를 쓴다 (Krea2의 범용 /free와 다름).
export async function freeMemory(): Promise<void> {
  await comfyApi
    .fetchApi(`${API}/free_memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    })
    .catch(() => {});
}

export interface QueueStatusResult {
  pending: number;
  running: number;
  runningPromptIds: string[];
  pendingPromptIds: string[];
}

export async function getQueueStatus(): Promise<QueueStatusResult> {
  try {
    const d = await jsonFetch(`/queue`);
    const running = (d.queue_running || []) as any[];
    const pending = (d.queue_pending || []) as any[];
    return {
      running: running.length,
      pending: pending.length,
      runningPromptIds: running.map((r) => r[1]),
      pendingPromptIds: pending.map((r) => r[1]),
    };
  } catch {
    return { running: 0, pending: 0, runningPromptIds: [], pendingPromptIds: [] };
  }
}
