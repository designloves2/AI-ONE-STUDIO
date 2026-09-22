// videoGalleryPicker.ts — 4-tab (Input / Output / MiniMax H3 / ITDA Studio) video picker for
// ITDA's Media Bin "🎞 Video (Gallery)" import. Structural twin of
// src/shared/imageGalleryPicker.ts (same overlay chrome, tool-tab bar, INPUT/OUTPUT 2-level
// folder dropdown) but sourced from video-only routes, per the node original:
// web/shared/ui_video_gallery_picker.js. Picking a video copies it into THIS ITDA project's
// own media folder (not just ComfyUI's input/) — Input/Output/MiniMax H3 go through
// api.importMediaFromGallery (mirrors nodes.py's /itda_studio_one/media/from_gallery, the
// same route one_node_itda_studio.js's HOOKS.pickVideoFromGallery uses); the ITDA Studio tab
// goes through api.importGalleryItem instead, since a rendered-gallery item's real file may
// live under a user-configured gallery path rather than ComfyUI's output/ root (see
// itda_studio_backend/paths.py's gallery_dir docstring) — gallery/import already copies
// straight from the manifest's own path, which from_gallery's input/output/temp-only lookup
// cannot reach.
import { C, BRAND } from "../../identity";
import { el, clear } from "../../shared/ui";
import { getComfyBase } from "../../shared/comfyBase";
import { attachSensitiveToggle, mediaKey, isBlurred } from "../../shared/sensitiveMedia";
import * as api from "./api";

const BASE = getComfyBase();

type ToolKind = "shared" | "tool" | "itda";
interface VideoToolDef {
  id: string;
  label: string;
  kind: ToolKind;
  root?: "input" | "output"; // shared
  api?: string; // tool
  subfolder?: string; // tool
}

// INPUT first and default — same reasoning as the image picker: no copy-to-input needed,
// and it's where every previous pick already landed.
const VIDEO_TOOLS: VideoToolDef[] = [
  { id: "input", label: "INPUT folder", kind: "shared", root: "input" },
  { id: "output", label: "OUTPUT folder", kind: "shared", root: "output" },
  { id: "minimaxh3", label: "MiniMax H3", kind: "tool", api: "/minimax_h3_one", subfolder: "one_minimax_h3" },
  { id: "itdastudio", label: "ITDA Studio", kind: "itda" },
];

interface PickerVideo {
  filename: string;
  subfolder: string;
  mtime?: number;
  thumbUrl?: string;
  // ITDA Studio tab only — needed for gallery/import (import-by-id, not by path).
  itdaId?: string;
}

interface FolderNode { path: string; label: string; children: FolderNode[] }
const folderTreeCache: Partial<Record<"input" | "output", FolderNode[]>> = {};
async function fetchFolderTree(root: "input" | "output"): Promise<FolderNode[]> {
  if (folderTreeCache[root]) return folderTreeCache[root]!;
  try {
    const r = await fetch(`${BASE}/tj_shared/gallery_folders?root=${root}`, { credentials: "include" });
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();
    const conv = (nodes: any[]): FolderNode[] =>
      (Array.isArray(nodes) ? nodes : []).map((n) => ({ path: n.path, label: n.name, children: conv(n.children || []) }));
    folderTreeCache[root] = conv(d.folders || []);
  } catch {
    folderTreeCache[root] = [];
  }
  return folderTreeCache[root]!;
}

async function fetchVideos(tool: VideoToolDef, offset: number, limit: number, folder: string): Promise<{ rows: PickerVideo[]; total: number }> {
  try {
    if (tool.kind === "shared") {
      const r = await fetch(`${BASE}/tj_shared/${tool.root}_gallery_video?offset=${offset}&limit=${limit}&subfolder=${encodeURIComponent(folder)}`, { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      const rows: PickerVideo[] = (d.images || []).map((x: any) => ({ filename: x.filename, subfolder: (x.subfolder || "").replace(/\\/g, "/"), mtime: x.mtime }));
      return { rows, total: d.total ?? rows.length };
    }
    if (tool.kind === "tool") {
      const r = await fetch(`${BASE}${tool.api}/videos?offset=${offset}&limit=${limit}&subfolder=${encodeURIComponent(tool.subfolder || "")}`, { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      const rows: PickerVideo[] = (d.videos || []).map((x: any) => ({ filename: x.filename, subfolder: x.subfolder || tool.subfolder || "", mtime: x.mtime }));
      return { rows, total: d.total ?? rows.length };
    }
    // ITDA Studio's own render gallery — flat list, no subfolder concept, reused as-is.
    const res = await api.listGallery();
    const all = (res.items || []).filter((it: any) => it.has_video !== false);
    const rows: PickerVideo[] = all.map((it: any) => ({
      filename: it.filename || (it.path || "").split(/[\\/]/).pop() || it.id,
      subfolder: "",
      mtime: it.created_at,
      thumbUrl: it.thumb_url,
      itdaId: it.id,
    }));
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  } catch {
    return { rows: [], total: 0 };
  }
}

function viewUrl(v: PickerVideo, tool: VideoToolDef): string {
  if (tool.kind === "itda") return v.thumbUrl || "";
  const type = tool.kind === "shared" && tool.root === "input" ? "input" : "output";
  return `${BASE}/view?filename=${encodeURIComponent(v.filename)}&subfolder=${encodeURIComponent(v.subfolder || "")}&type=${type}&t=${v.mtime || ""}`;
}

/** Copies the picked video into `project`'s own ITDA media folder, returns the project media path. */
async function importIntoProject(tool: VideoToolDef, v: PickerVideo, project: string): Promise<string> {
  if (tool.kind === "itda") {
    if (!v.itdaId) throw new Error("missing gallery id");
    const d = await api.importGalleryItem(v.itdaId, project);
    if (!d.ok) throw new Error((d as any).error || "import failed");
    return (d as any).path || v.filename;
  }
  const type: "input" | "output" = tool.kind === "shared" && tool.root === "input" ? "input" : "output";
  const d = await api.importMediaFromGallery(project, v.filename, v.subfolder || "", type);
  if (!d.ok) throw new Error(d.error || "import failed");
  return d.path || v.filename;
}

export function openVideoGalleryPicker(project: string, onPick: (path: string) => void, initialToolId?: string) {
  delete folderTreeCache.input;
  delete folderTreeCache.output;
  let activeTool = VIDEO_TOOLS.find((t) => t.id === initialToolId) || VIDEO_TOOLS[0];
  let offset = 0, total = 0, loading = false, picking = false;
  let activeFolder = ""; // INPUT/OUTPUT only

  const ov = el("div", { style: { position: "fixed", inset: "0", background: "rgba(0,0,0,0.75)", zIndex: "100000", display: "flex", alignItems: "center", justifyContent: "center" } });
  const box = el("div", { style: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "12px", width: "min(1056px, 96vw)", height: "min(840px, 92vh)", minHeight: "0", boxShadow: "0 10px 40px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", gap: "10px" } });

  const topRow = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" } });
  topRow.appendChild(el("div", { text: "🎞 Pick a video from a gallery", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }));
  const closeBtn = el("button", { type: "button", text: "✕", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "5px 10px", borderRadius: "6px", border: "none", background: "#c0392b", color: "#fff" } });
  closeBtn.addEventListener("click", () => close());
  topRow.appendChild(closeBtn);

  const toolBar = el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", flexShrink: "0" } });
  function renderToolBar() {
    clear(toolBar);
    VIDEO_TOOLS.forEach((t) => {
      const active = t.id === activeTool.id;
      const b = el("button", {
        type: "button", text: t.label,
        style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "5px 10px", borderRadius: "14px", background: active ? BRAND : C.bg2, color: active ? "#fff" : C.text, border: `1px solid ${active ? BRAND : C.border}`, fontWeight: active ? "700" : "400" },
      });
      b.addEventListener("click", () => { if (activeTool.id !== t.id) { activeTool = t; activeFolder = ""; reset(); } });
      toolBar.appendChild(b);
    });
  }
  renderToolBar();

  const folderSel = el("select", {
    style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "5px 8px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, display: "none" },
  }) as HTMLSelectElement;
  folderSel.addEventListener("change", () => { activeFolder = folderSel.value; reloadGrid(); });
  async function renderFolderSel() {
    if (activeTool.kind !== "shared") { folderSel.style.display = "none"; return; }
    const root = activeTool.root!;
    const tree = await fetchFolderTree(root);
    if (activeTool.kind !== "shared" || activeTool.root !== root) return; // switched away while awaiting
    clear(folderSel);
    folderSel.appendChild(el("option", { value: "", text: activeTool.label }));
    tree.forEach((top) => {
      folderSel.appendChild(el("option", { value: top.path, text: top.label }));
      top.children.forEach((sub) => folderSel.appendChild(el("option", { value: sub.path, text: `  ${sub.label}` })));
    });
    folderSel.value = activeFolder;
    folderSel.style.display = tree.length ? "" : "none";
  }
  function refreshFolderSel() {
    if (activeTool.kind !== "shared") return;
    delete folderTreeCache[activeTool.root!];
    renderFolderSel();
  }
  const folderPollTimer = window.setInterval(() => {
    if (document.activeElement === folderSel) return;
    if (activeTool.kind === "shared") refreshFolderSel();
  }, 5000);

  const grid = el("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gridAutoRows: "min-content", gap: "8px", overflowY: "auto", flex: "1", minHeight: "0", alignContent: "start" } });
  const statusEl = el("div", { style: { color: C.muted, fontSize: "11px", flexShrink: "0" } });
  const moreBtn = el("button", { type: "button", text: "Load more", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "6px 10px", borderRadius: "6px", border: `1px solid ${C.border}`, background: C.bg2, color: C.text, flexShrink: "0" } });
  moreBtn.style.display = "none";
  moreBtn.addEventListener("click", () => loadMore());

  box.append(topRow, toolBar, folderSel, grid, statusEl, moreBtn);
  ov.appendChild(box);

  function close() {
    window.clearInterval(folderPollTimer);
    document.removeEventListener("keydown", onKey);
    if (ov.parentNode) document.body.removeChild(ov);
  }
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });

  function reset() {
    renderToolBar();
    renderFolderSel();
    reloadGrid();
  }

  function reloadGrid() {
    offset = 0; total = 0;
    clear(grid);
    statusEl.textContent = "Loading…";
    loadMore();
  }

  async function loadMore() {
    if (loading) return;
    loading = true;
    const tool = activeTool;
    const folder = activeFolder;
    const { rows, total: t } = await fetchVideos(tool, offset, 60, folder);
    if (tool.id !== activeTool.id || folder !== activeFolder) { loading = false; return; }
    total = t;
    rows.forEach((v) => {
      const cell = el("div", { style: { position: "relative", borderRadius: "6px", overflow: "hidden", border: `1px solid ${C.border}`, background: "#000", cursor: "pointer", height: "108px" } });
      const vid = el("video", { src: viewUrl(v, tool), muted: "", playsInline: "", preload: "metadata", style: { width: "100%", height: "100%", objectFit: "cover", display: "block", background: "#000" } }) as HTMLVideoElement;
      vid.muted = true;
      cell.addEventListener("mouseenter", () => { try { vid.currentTime = 0; vid.play().catch(() => {}); } catch {} cell.style.borderColor = BRAND; });
      cell.addEventListener("mouseleave", () => { vid.pause(); cell.style.borderColor = C.border; });
      cell.appendChild(vid);
      const nameTag = el("div", { text: v.filename, style: { position: "absolute", left: "0", right: "0", bottom: "0", padding: "2px 5px", fontSize: "10px", color: "#eee", background: "rgba(0,0,0,0.6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } });
      cell.appendChild(nameTag);
      // 눈가리기 — same shared hide/reveal every ONE STUDIO gallery/picker uses.
      const sensKey = mediaKey(v.filename, v.subfolder || (tool.kind === "itda" ? "itda_gallery" : ""));
      attachSensitiveToggle(cell, vid, sensKey, "br");
      cell.addEventListener("click", async () => {
        if (picking) return;
        if (isBlurred(sensKey)) {
          statusEl.textContent = "Hidden — click 👁 on the tile to reveal it first.";
          setTimeout(() => { statusEl.textContent = rows.length || total ? `${offset} / ${total}` : ""; }, 2200);
          return;
        }
        picking = true;
        const prevOpacity = cell.style.opacity;
        cell.style.opacity = "0.5";
        try {
          const path = await importIntoProject(tool, v, project);
          onPick(path);
          close();
        } catch (e: any) {
          cell.style.opacity = prevOpacity;
          picking = false;
          statusEl.textContent = "Import failed: " + (e?.message || e);
        }
      });
      grid.appendChild(cell);
    });
    offset += rows.length;
    statusEl.textContent = rows.length || total ? `${offset} / ${total}` : "No videos in this tab yet.";
    moreBtn.style.display = offset < total ? "block" : "none";
    loading = false;
  }

  reset();
  document.body.appendChild(ov);
}
