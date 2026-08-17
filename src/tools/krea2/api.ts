// api.ts — Krea2 백엔드 REST 호출 이식.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/krea2/api_krea2.js (API="/krea2_one" 라우트는
// nodes.py에 등록된 백엔드가 그대로 서빙 — MiniMax H3의 api.ts와 동일한 comfyApi.base 패턴)
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

export async function getSeedVR2Models(): Promise<{ models: string[] }> {
  try {
    return await jsonFetch(`${API}/seedvr2_models`);
  } catch {
    return { models: [] };
  }
}

export async function getLoraTriggers(name: string): Promise<string> {
  try {
    // 백엔드 응답은 { ok, triggers: string[] } — 배열을 ", "로 합쳐서 반환한다 (원본 ui_t2i_krea2.js와 동일).
    const d = await jsonFetch(`${API}/lora_triggers?name=${encodeURIComponent(name)}`);
    return d.ok && d.triggers?.length ? d.triggers.join(", ") : "";
  } catch {
    return "";
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
  // 백엔드는 { ok, filename: "<prefix>_<uuid>_<원본이름>" } 형태로 응답한다 — input/ 폴더에
  // 새 이름으로 복사된 실제 파일명이며 원본 filename과 다르다 (d.name은 존재하지 않는 필드였음).
  const d = await jsonFetch(`${API}/copy_to_input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, subfolder, type }),
  });
  if (!d.ok) throw new Error(d.error || "copy failed");
  return d.filename;
}

export async function setLastImage(filename: string, subfolder: string): Promise<void> {
  await jsonFetch(`${API}/set_last`, {
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

export async function freeMemory(): Promise<void> {
  await comfyApi
    .fetchApi("/free", {
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
