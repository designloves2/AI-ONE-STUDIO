// api.ts — thin wrappers over ITDA Studio's backend routes (itda_studio_backend/server.py).
// Registered on the SAME shared ComfyUI PromptServer.instance.routes every other TJ_NODE_STUDIO_ONE
// tool uses, so this hits the dev-proxy `/itda_studio_one/*` path added in vite.config.ts — no
// separate backend to stand up.
import { getComfyBase } from "../../shared/comfyBase";

const BASE = getComfyBase();
const API = "/itda_studio_one/api";

async function fetchJson<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    credentials: "include",
    headers: opts?.body ? { "Content-Type": "application/json", ...(opts.headers || {}) } : opts?.headers,
  });
  const text = await r.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, error: text || `HTTP ${r.status}` };
  }
  if (!r.ok && data.ok === undefined) data.ok = false;
  if (!r.ok && !data.error) data.error = `HTTP ${r.status}`;
  return data as T;
}

const post = (path: string, body?: any) =>
  fetchJson(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });

// ── media / file URLs ──────────────────────────────────────────────────────
export function mediaFileUrl(path: string, project: string): string {
  return `${BASE}${API}/file?path=${encodeURIComponent(path)}&project=${encodeURIComponent(project)}`;
}

// ── project CRUD ────────────────────────────────────────────────────────────
export interface ItdaProject {
  name: string;
  fps?: number;
  total_frames?: number;
  tracks?: any[];
  [key: string]: any;
}

export async function initProject(project: string) {
  return post(`${API}/init`, { project });
}
export async function getProject(name: string): Promise<{ ok: boolean; project: ItdaProject }> {
  return fetchJson(`${API}/project/${encodeURIComponent(name)}`);
}
export async function saveProject(name: string, data: ItdaProject) {
  return post(`${API}/project/${encodeURIComponent(name)}`, data);
}
export async function listProjects(): Promise<{ ok: boolean; items: { name: string; path: string; updated_at: number }[] }> {
  return fetchJson(`${API}/projects`);
}
export async function newProject(name?: string) {
  return post(`${API}/project/new`, { name });
}
export async function duplicateProject(source: string, target?: string) {
  return post(`${API}/project/duplicate`, { source, target });
}
export async function renameProject(source: string, target: string) {
  return post(`${API}/project/rename`, { source, target });
}
export async function deleteProject(project: string) {
  return post(`${API}/project/delete`, { project });
}

// ── media bin ───────────────────────────────────────────────────────────────
export interface MediaItem {
  path: string;
  name?: string;
  kind?: "video" | "audio" | "image";
  duration?: number;
  fps?: number;
  thumb?: string;
  [key: string]: any;
}

export async function getMedia(project: string): Promise<{ ok: boolean; items: MediaItem[] }> {
  return fetchJson(`${API}/media/${encodeURIComponent(project)}`);
}

export async function uploadMedia(project: string, files: File[]): Promise<{ ok: boolean; items: string[] }> {
  const fd = new FormData();
  fd.append("project", project);
  for (const f of files) fd.append("files", f, f.name);
  const r = await fetch(`${BASE}${API}/media/upload`, { method: "POST", body: fd, credentials: "include" });
  return r.json();
}

export async function deleteMedia(project: string, path: string) {
  return post(`${API}/media/delete`, { project, path });
}

export async function probeMedia(project: string, path: string) {
  return post(`${API}/probe`, { project, path });
}

export async function getWaveform(project: string, path: string, bars = 240) {
  return post(`${API}/waveform`, { project, path, bars });
}

// ── render / export ─────────────────────────────────────────────────────────
export type RenderMode = "video_audio" | "video_only" | "audio_only";

export async function renderToGallery(project: string, mode: RenderMode = "video_audio") {
  return post(`${API}/render_to_gallery`, { project, mode });
}

export async function exportProject(project: string, fmt = "mp4") {
  return post(`${API}/export`, { project, format: fmt });
}

export async function prerenderRange(project: string, start: number, end: number) {
  return post(`${API}/prerender`, { project, range: { start, end } });
}

// ── gallery (shared with MiniMax H3's output/one_minimax_h3 + sidecar convention) ──────────────
export interface ItdaGalleryItem {
  id: string;
  project: string;
  path: string;
  thumb?: string;
  thumb_url?: string;
  video_url?: string;
  created_at?: number;
  [key: string]: any;
}

export async function listGallery(): Promise<{ ok: boolean; items: ItdaGalleryItem[] }> {
  return fetchJson(`${API}/gallery/list`);
}
export async function deleteGalleryItem(id: string) {
  return post(`${API}/gallery/delete`, { id });
}
export async function importGalleryItem(id: string, project: string) {
  return post(`${API}/gallery/import`, { id, project });
}

// ── app settings (SYSTEM-level, not per-project) ────────────────────────────
export interface ItdaAppSettings {
  gallery_dir?: string;
  [key: string]: any;
}
export async function getAppSettings(): Promise<{ ok: boolean; settings: ItdaAppSettings }> {
  return fetchJson(`${API}/app_settings`);
}
export async function saveAppSettings(patch: ItdaAppSettings) {
  return post(`${API}/app_settings`, patch);
}

export async function health() {
  return fetchJson(`${API}/health`);
}
