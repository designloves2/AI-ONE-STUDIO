// api.ts — Anima 백엔드 REST 호출 이식.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/anima/api_anima.js (API="/anima_one")
import { comfyApi } from "./comfyClient";
import { API, SUBFOLDER } from "./core";

const BASE = comfyApi.base;

async function jsonFetch(path: string, opts?: RequestInit) {
  const r = await comfyApi.fetchApi(path, opts);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

export async function getModels(): Promise<{ diffusion_models: string[]; text_encoders: string[]; vaes: string[]; loras: string[] }> {
  try {
    return await jsonFetch(`${API}/models`);
  } catch {
    return { diffusion_models: [], text_encoders: [], vaes: [], loras: [] };
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
