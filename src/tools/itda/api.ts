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

// Several backend responses (media.py's thumb_url, gallery thumb/video URLs) return
// their own server-relative "/itda_studio_one/api/..." route already built, just
// missing the BASE origin prefix — this is that one shared prefix step.
export function resolveUrl(u: string): string {
  return u.startsWith("http") ? u : `${BASE}${u}`;
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
  // real server-generated thumbnail — media.py's make_video_thumbnail() extracts
  // frame 0 and returns this URL; media-bin cards never read it at all before.
  thumb_url?: string;
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

// ── fonts ───────────────────────────────────────────────────────────────────
export interface ItdaFont {
  name: string;
  family: string;
  format: string;
  url: string;
}
export async function listFonts(): Promise<{ ok: boolean; items: ItdaFont[] }> {
  return fetchJson(`${API}/fonts`);
}

// ── stitch (crossfade/interpolate bridge between two clips) ─────────────────
export async function stitchAnalyze(
  project: string,
  pathA: string,
  pathB: string,
  sourceOutA: number,
  sourceInB: number,
  fps = 24,
  windowSec = 2.0
) {
  return post(`${API}/stitch_analyze`, {
    project,
    path_a: pathA,
    path_b: pathB,
    source_out_a: sourceOutA,
    source_in_b: sourceInB,
    fps,
    window_sec: windowSec,
  });
}

export type StitchBridgeMode = "interpolate" | "crossfade";

export async function stitchBridge(
  project: string,
  pathA: string,
  frameA: number,
  pathB: string,
  frameB: number,
  fps = 24,
  mode: StitchBridgeMode = "interpolate",
  numFrames = 6
) {
  return post(`${API}/stitch_bridge`, {
    project,
    path_a: pathA,
    frame_a: frameA,
    path_b: pathB,
    frame_b: frameB,
    fps,
    mode,
    num_frames: numFrames,
  });
}

// ── scene / beat detection ───────────────────────────────────────────────────
export async function sceneDetect(project: string, path: string, fps = 24, threshold = 0.3) {
  return post(`${API}/scene_detect`, { project, path, fps, threshold });
}

export async function beatDetect(project: string, path: string, fps = 24) {
  return post(`${API}/beat_detect`, { project, path, fps });
}

// ── snapshots ─────────────────────────────────────────────────────────────
export async function snapshotFrame(
  project: string,
  path: string,
  kind: "video" | "image" = "video",
  sourceFrame = 0,
  sourceFps?: number
): Promise<{ ok: boolean; path: string; source_frame: number }> {
  return post(`${API}/snapshot_frame`, {
    project,
    path,
    kind,
    source_frame: sourceFrame,
    source_fps: sourceFps,
  });
}

/** POSTs a canvas/blob snapshot (e.g. from an in-app screenshot tool) as multipart form-data. */
export async function saveSnapshot(project: string, image: Blob, filename = "snapshot.png") {
  const fd = new FormData();
  fd.append("project", project);
  fd.append("image", image, filename);
  const r = await fetch(`${BASE}${API}/snapshot`, { method: "POST", body: fd, credentials: "include" });
  return r.json();
}

// ── send a trimmed clip to ComfyUI's own input (or a standalone instance) ──
export async function sendToComfy(
  project: string,
  path: string,
  kind: "video" | "audio" | "image" = "video",
  opts?: { sourceIn?: number; sourceOut?: number; fps?: number; name?: string; comfyUrl?: string; comfyType?: string }
) {
  return post(`${API}/send_to_comfy`, {
    project,
    path,
    kind,
    source_in: opts?.sourceIn ?? 0,
    source_out: opts?.sourceOut ?? 0,
    fps: opts?.fps,
    name: opts?.name,
    comfy_url: opts?.comfyUrl,
    comfy_type: opts?.comfyType,
  });
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

// ── cross-tool gallery import into the media bin (Input/Output/MiniMax H3 tabs of the
// 4-tab video picker) — copies straight from ComfyUI's input/output/temp dirs into this
// project's own media folder. NOT under /api/ — mirrors nodes.py's own
// /itda_studio_one/media/from_gallery route exactly (one_node_itda_studio.js's importFromGallery).
export async function importMediaFromGallery(
  project: string,
  filename: string,
  subfolder = "",
  type: "input" | "output" | "temp" = "output"
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const r = await fetch(`${BASE}/itda_studio_one/media/from_gallery`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project, filename, subfolder, type }),
  });
  return r.json();
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
