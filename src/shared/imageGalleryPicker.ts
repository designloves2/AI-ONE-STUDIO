// imageGalleryPicker.ts — 이미지 도구 5종(Krea2/Z-Image/Klein/Qwen2511/SDXL)의 갤러리를 한
// 오버레이에서 넘나들며 볼 수 있는 공용 피커. MiniMax H3의 이미지 업로드 카드에서
// "갤러리 선택" 방식으로 쓰인다. 이미지를 고르면 해당 도구의 copy_to_input으로 ComfyUI
// 전역 input 폴더에 복사한 뒤(파일명이 유니크해짐) 그 파일명을 콜백으로 돌려준다.
import { C, BRAND } from "../identity";
import { el, clear } from "./ui";
import { getComfyBase } from "./comfyBase";
import { attachSensitiveToggle, mediaKey, isBlurred } from "./sensitiveMedia";

const BASE = getComfyBase();

export interface GalleryToolDef {
  id: string;
  label: string;
  api: string;
  subfolder: string;
}

export const IMAGE_GALLERY_TOOLS: GalleryToolDef[] = [
  { id: "krea2", label: "Krea2", api: "/krea2_one", subfolder: "one_krea2" },
  { id: "zimage", label: "Z-Image", api: "/z_image_turbo", subfolder: "one_z-image" },
  { id: "klein", label: "Flux2 Klein", api: "/flux_klein", subfolder: "one_flux2-klein" },
  { id: "qwen2511", label: "Qwen Image 2511", api: "/qwen2511_one", subfolder: "one_qwen2511" },
  { id: "sdxl", label: "SDXL", api: "/sdxl_one", subfolder: "one_sdxl" },
];

// A pseudo tool for ComfyUI's own input/ directory — not one of the 5 galleries above, listed
// via LoadImage's own combo options (same trick api.ts's getMediaFiles() uses for videos/audios)
// rather than a /gallery route, since input/ isn't paginated server-side and has no subfolder
// convention of its own. Picking one of these needs no copy_to_input — it's already in input/.
export const INPUT_TOOL_ID = "__input__";
const INPUT_TOOL: GalleryToolDef = { id: INPUT_TOOL_ID, label: "INPUT", api: "", subfolder: "" };

// Same idea as INPUT, but for ComfyUI's global output/ root — a raw file sitting there isn't
// necessarily one this app's own 5 galleries know about (e.g. dropped in by hand, or made by a
// workflow outside this app). Listed via LoadImageOutput's own remote route (the "Load Image
// (from Outputs)" core node ComfyUI added alongside LoadImage) rather than a /gallery route,
// same reasoning as INPUT: output/ isn't paginated per-subfolder here and has no single
// tool-owned convention. Picking one still needs a copy_to_input — unlike INPUT, it isn't
// already there.
export const OUTPUT_TOOL_ID = "__output__";
const OUTPUT_TOOL: GalleryToolDef = { id: OUTPUT_TOOL_ID, label: "OUTPUT", api: "", subfolder: "" };

let outputFilesCache: string[] | null = null;
async function fetchOutputFiles(): Promise<string[]> {
  if (outputFilesCache) return outputFilesCache;
  // LoadImageOutput's own remote route (/internal/files/output) turned out to return an empty
  // list on real servers regardless of directory — not the reliable source it looked like from
  // its object_info shape. Every one of this app's own 5 tool galleries already recursively
  // scans the WHOLE output/ tree when given an empty subfolder (confirmed directly: krea2's
  // /gallery?subfolder= returns files from every tool's own subfolder, not just krea2's) — so
  // reuse that already-working, already-paginated route instead, same tool-agnostic assumption
  // GENERIC_COPY_API already makes for copy_to_input.
  try {
    const r = await fetch(`${BASE}${IMAGE_GALLERY_TOOLS[0].api}/gallery?offset=0&limit=5000&subfolder=`, { credentials: "include" });
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();
    const imgs: { filename: string; subfolder?: string }[] = d.images || [];
    outputFilesCache = imgs.map((x) => (x.subfolder ? `${x.subfolder.replace(/\\/g, "/")}/${x.filename}` : x.filename));
  } catch {
    outputFilesCache = [];
  }
  return outputFilesCache;
}

interface PickerImage {
  filename: string;
  subfolder: string;
  mtime?: number;
}

let inputFilesCache: string[] | null = null;
async function fetchInputFiles(): Promise<string[]> {
  if (inputFilesCache) return inputFilesCache;
  try {
    const r = await fetch(`${BASE}/object_info/LoadImage`, { credentials: "include" });
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();
    const inp = d?.LoadImage?.input;
    const spec = (inp?.required || {}).image || (inp?.optional || {}).image;
    const opts = Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options || [];
    inputFilesCache = Array.isArray(opts) ? opts.filter((x: any) => typeof x === "string") : [];
  } catch {
    inputFilesCache = [];
  }
  return inputFilesCache;
}

// copy_to_input is a generic file-copy handler duplicated per tool (same body shape, same
// behavior — it just moves bytes given filename/subfolder/type) — OUTPUT has no tool of its
// own to own a route, so it borrows the first real tool's, exactly like the raw-output picker
// in galleryOverlay.ts already assumes this handler is format/tool-agnostic.
const GENERIC_COPY_API = IMAGE_GALLERY_TOOLS[0].api;

// input/ and output/ are a flat recursive dump of EVERY image, across every tool's own
// subfolder plus anything dropped in by hand — once there's more than a couple of tools'
// worth, that pushes actual thumbnails off screen before you ever see them. User: "INPUT/
// OUTPUT은 폴더도 네이비게이션 되면 좋겠는데... 드롭다운 방식... 최상위 + 하위 폴더 2단계
//까지." Node ported the same ask via a new backend route (`6487c40`); web already had the
// FULL flat file list client-side (the LoadImage/LoadImageOutput combo trick), so the 2-level
// folder tree is built from that same list instead of adding a route — same UX, no new
// backend dependency.
interface FolderNode { path: string; label: string; children: FolderNode[] }
function buildFolderTree(files: string[]): FolderNode[] {
  const top = new Map<string, Map<string, true>>();
  for (const f of files) {
    const slash = f.lastIndexOf("/");
    if (slash === -1) continue; // a loose file at the root — not a folder
    const dir = f.slice(0, slash);
    const parts = dir.split("/");
    const t = parts[0];
    if (!top.has(t)) top.set(t, new Map());
    if (parts.length > 1) top.get(t)!.set(parts[1], true);
  }
  return [...top.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, subs]) => ({
    path: name, label: name,
    children: [...subs.keys()].sort((a, b) => a.localeCompare(b)).map((s) => ({ path: `${name}/${s}`, label: s, children: [] })),
  }));
}
function filterByFolder(files: string[], folder: string): string[] {
  if (!folder) return files;
  const prefix = `${folder}/`;
  return files.filter((f) => f === folder || f.startsWith(prefix));
}

async function fetchGallery(tool: GalleryToolDef, offset: number, limit: number, folder = ""): Promise<{ images: PickerImage[]; total: number }> {
  if (tool.id === INPUT_TOOL.id) {
    const all = filterByFolder(await fetchInputFiles(), folder);
    const page = all.slice(offset, offset + limit).map((combo) => {
      const slash = combo.lastIndexOf("/");
      return slash === -1 ? { filename: combo, subfolder: "" } : { filename: combo.slice(slash + 1), subfolder: combo.slice(0, slash) };
    });
    return { images: page, total: all.length };
  }
  if (tool.id === OUTPUT_TOOL.id) {
    const all = filterByFolder(await fetchOutputFiles(), folder);
    const page = all.slice(offset, offset + limit).map((combo) => {
      const slash = combo.lastIndexOf("/");
      return slash === -1 ? { filename: combo, subfolder: "" } : { filename: combo.slice(slash + 1), subfolder: combo.slice(0, slash) };
    });
    return { images: page, total: all.length };
  }
  try {
    const r = await fetch(`${BASE}${tool.api}/gallery?offset=${offset}&limit=${limit}&subfolder=${encodeURIComponent(tool.subfolder)}`, { credentials: "include" });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } catch {
    return { images: [], total: 0 };
  }
}

async function copyToInput(tool: GalleryToolDef, img: PickerImage): Promise<string> {
  if (tool.id === INPUT_TOOL.id) return img.subfolder ? `${img.subfolder}/${img.filename}` : img.filename;
  const api = tool.id === OUTPUT_TOOL.id ? GENERIC_COPY_API : tool.api;
  const r = await fetch(`${BASE}${api}/copy_to_input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: img.filename, subfolder: img.subfolder || "", type: "output" }),
    credentials: "include",
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || "copy failed");
  return d.filename as string;
}

function viewUrl(img: PickerImage, tool: GalleryToolDef) {
  const type = tool.id === INPUT_TOOL.id ? "input" : "output";
  return `${BASE}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${type}&t=${img.mtime || ""}`;
}

const ALL_PICKER_TOOLS: GalleryToolDef[] = [...IMAGE_GALLERY_TOOLS, INPUT_TOOL, OUTPUT_TOOL];

export function openImageGalleryPicker(onPick: (filename: string) => void, initialToolId?: string) {
  inputFilesCache = null; // re-list input/ fresh each time the picker opens — files may have changed since last time
  outputFilesCache = null; // same for output/
  let activeTool = ALL_PICKER_TOOLS.find((t) => t.id === initialToolId) || ALL_PICKER_TOOLS[0];
  let offset = 0;
  let total = 0;
  let loading = false;
  let picking = false;
  let activeFolder = ""; // "" = (All) — only meaningful for INPUT/OUTPUT, reset on every tool switch

  const ov = el("div", { style: { position: "fixed", inset: "0", background: "rgba(0,0,0,0.75)", zIndex: "100000", display: "flex", alignItems: "center", justifyContent: "center" } });
  const box = el("div", { style: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "12px", width: "min(1056px, 96vw)", height: "min(840px, 92vh)", minHeight: "0", boxShadow: "0 10px 40px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", gap: "10px" } });

  const topRow = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" } });
  topRow.appendChild(el("div", { text: "🖼 Pick an image from the gallery", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }));
  const closeBtn = el("button", { type: "button", text: "✕", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "5px 10px", borderRadius: "6px", border: "none", background: "#c0392b", color: "#fff" } });
  closeBtn.addEventListener("click", () => close());
  topRow.appendChild(closeBtn);

  const toolBar = el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", flexShrink: "0" } });
  function renderToolBar() {
    clear(toolBar);
    ALL_PICKER_TOOLS.forEach((t) => {
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

  // Only INPUT/OUTPUT get a folder dropdown — the 5 per-tool tabs each have one fixed
  // subfolder already (nothing to navigate). "(All)" first, then the 2-level tree with
  // space-indentation for the sub-level, mirroring node `6487c40`'s own dropdown shape.
  const folderSel = el("select", {
    style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "5px 8px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, display: "none" },
  }) as HTMLSelectElement;
  folderSel.addEventListener("change", () => { activeFolder = folderSel.value; reloadGrid(); });
  async function renderFolderSel() {
    if (activeTool.id !== INPUT_TOOL.id && activeTool.id !== OUTPUT_TOOL.id) {
      folderSel.style.display = "none";
      return;
    }
    const files = activeTool.id === INPUT_TOOL.id ? await fetchInputFiles() : await fetchOutputFiles();
    if (activeTool.id !== INPUT_TOOL.id && activeTool.id !== OUTPUT_TOOL.id) return; // switched away while awaiting
    const tree = buildFolderTree(files);
    clear(folderSel);
    folderSel.appendChild(el("option", { value: "", text: "(All)" }));
    tree.forEach((top) => {
      folderSel.appendChild(el("option", { value: top.path, text: top.label }));
      top.children.forEach((sub) => folderSel.appendChild(el("option", { value: sub.path, text: `  ${sub.label}` })));
    });
    folderSel.value = activeFolder;
    folderSel.style.display = tree.length ? "" : "none";
  }

  const grid = el("div", { style: { display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gridAutoRows: "min-content", gap: "6px", overflowY: "auto", flex: "1", minHeight: "0", alignContent: "start" } });
  const statusEl = el("div", { style: { color: C.muted, fontSize: "11px", flexShrink: "0" } });
  const moreBtn = el("button", { type: "button", text: "Load more", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "6px 10px", borderRadius: "6px", border: `1px solid ${C.border}`, background: C.bg2, color: C.text, flexShrink: "0" } });
  moreBtn.style.display = "none";
  moreBtn.addEventListener("click", () => loadMore());

  box.append(topRow, toolBar, folderSel, grid, statusEl, moreBtn);
  ov.appendChild(box);

  function close() {
    document.removeEventListener("keydown", onKey);
    document.body.removeChild(ov);
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
    offset = 0;
    total = 0;
    clear(grid);
    statusEl.textContent = "Loading…";
    loadMore();
  }

  async function loadMore() {
    if (loading) return;
    loading = true;
    const tool = activeTool;
    const folder = activeFolder;
    const data = await fetchGallery(tool, offset, 60, folder);
    if (tool.id !== activeTool.id || folder !== activeFolder) { loading = false; return; }
    total = data.total || 0;
    const imgs = data.images || [];
    imgs.forEach((img) => {
      const cell = el("div", { style: { position: "relative", borderRadius: "4px", overflow: "hidden", border: `1px solid ${C.border}`, background: C.bg2, cursor: "pointer" } });
      const im = el("img", { src: viewUrl(img, tool), style: { width: "100%", height: "auto", display: "block" } });
      cell.appendChild(im);
      // 눈가리기 — this picker had no blur handling at all (unlike every tool's own gallery
      // grid), so a hidden reference image was fully visible + pickable here. Blur the tile
      // like the grid does, and refuse the pick outright while it's still hidden — picking
      // is a one-click action with no "are you sure", so a blurred item must not reach onPick.
      const k = mediaKey(img.filename, img.subfolder || "");
      attachSensitiveToggle(cell, im, k, "tl");
      cell.addEventListener("click", async () => {
        if (picking) return;
        if (isBlurred(k)) return;
        picking = true;
        const prevOpacity = cell.style.opacity;
        cell.style.opacity = "0.5";
        try {
          const filename = await copyToInput(tool, img);
          onPick(filename);
          close();
        } catch {
          cell.style.opacity = prevOpacity;
          picking = false;
        }
      });
      grid.appendChild(cell);
    });
    offset += imgs.length;
    statusEl.textContent = imgs.length || total ? `${offset} / ${total}` : "No images saved in this tool's gallery yet.";
    moreBtn.style.display = offset < total ? "block" : "none";
    loading = false;
  }

  reset();
  document.body.appendChild(ov);
}
