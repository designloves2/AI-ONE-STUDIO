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

// A pseudo tool for ComfyUI's own input/ directory — not one of the 5 galleries above. Backed
// by the shared /tj_shared/input_gallery + /tj_shared/gallery_folders?root=input routes (the
// same lightweight, non-recursive, per-folder routes the node side uses — confirmed live on
// this backend). Picking one of these needs no copy_to_input — it's already in input/.
export const INPUT_TOOL_ID = "__input__";
const INPUT_TOOL: GalleryToolDef = { id: INPUT_TOOL_ID, label: "INPUT", api: "", subfolder: "" };

// Same idea as INPUT, but for ComfyUI's global output/ root — a raw file sitting there isn't
// necessarily one this app's own 5 galleries know about (e.g. dropped in by hand, or made by a
// workflow outside this app). Backed by /tj_shared/output_gallery + gallery_folders?root=output.
// Picking one still needs a copy_to_input — unlike INPUT, it isn't already there.
export const OUTPUT_TOOL_ID = "__output__";
const OUTPUT_TOOL: GalleryToolDef = { id: OUTPUT_TOOL_ID, label: "OUTPUT", api: "", subfolder: "" };

// copy_to_input is a generic file-copy handler duplicated per tool (same body shape, same
// behavior — it just moves bytes given filename/subfolder/type) — OUTPUT has no tool of its
// own to own a route, so it borrows the first real tool's, exactly like the raw-output picker
// in galleryOverlay.ts already assumes this handler is format/tool-agnostic.
const GENERIC_COPY_API = IMAGE_GALLERY_TOOLS[0].api;

interface PickerImage {
  filename: string;
  subfolder: string;
  mtime?: number;
}

// User: "INPUT/OUTPUT은 폴더도 네이비게이션 되면 좋겠는데... 드롭다운 방식... 최상위 + 하위
// 폴더 2단계까지." First attempt derived the folder tree by fetching (and, worse, paginating
// through) EVERY image under input//output/ just to read off their subfolder names — the user
// caught this directly: "드롭다운으로 폴더 목록만 가져오라고 했는데 왜 폴더에 있는 파일까지
// 전부 검색하는건데" (I only asked for the FOLDER list, why is it scanning every file too) —
// and on a real install with thousands of images this made the whole picker hang ("로딩으로
// 멈춰버려있잖아"). The shared /tj_shared/gallery_folders?root=input|output route (added
// alongside the node port of this same feature) returns ONLY folder names/paths, 2 levels
// deep, with zero image scanning — this is the actual lightweight source that should have been
// used from the start.
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

// Actual card images for a picked (non-recursive, exact) folder — /tj_shared/input_gallery /
// output_gallery, the same per-folder paginated routes gallery_folders is the tree-only
// counterpart to. folder="" is that root's own loose files only, same convention as every
// other folder entry.
async function fetchRootGallery(root: "input" | "output", offset: number, limit: number, folder: string): Promise<{ images: PickerImage[]; total: number }> {
  try {
    const r = await fetch(`${BASE}/tj_shared/${root}_gallery?offset=${offset}&limit=${limit}&subfolder=${encodeURIComponent(folder)}`, { credentials: "include" });
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();
    return { images: (d.images || []).map((x: any) => ({ filename: x.filename, subfolder: (x.subfolder || "").replace(/\\/g, "/"), mtime: x.mtime })), total: d.total ?? (d.images || []).length };
  } catch {
    return { images: [], total: 0 };
  }
}

async function fetchGallery(tool: GalleryToolDef, offset: number, limit: number, folder = ""): Promise<{ images: PickerImage[]; total: number }> {
  if (tool.id === INPUT_TOOL.id) return fetchRootGallery("input", offset, limit, folder);
  if (tool.id === OUTPUT_TOOL.id) return fetchRootGallery("output", offset, limit, folder);
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
  delete folderTreeCache.input; // re-list the folder tree fresh each time the picker opens
  delete folderTreeCache.output;
  let activeTool = ALL_PICKER_TOOLS.find((t) => t.id === initialToolId) || ALL_PICKER_TOOLS[0];
  let offset = 0;
  let total = 0;
  let loading = false;
  let picking = false;
  let activeFolder = ""; // "" = the tab's own root (INPUT folder / OUTPUT folder) — loose files only, not a recursive dump; only meaningful for INPUT/OUTPUT, reset on every tool switch

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
  // subfolder already (nothing to navigate). "INPUT folder"/"OUTPUT folder" first (loose root files only, named after the tab — user explicitly said no generic "(All)"), then the 2-level tree with
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
    const root = activeTool.id === INPUT_TOOL.id ? "input" : "output";
    const tree = await fetchFolderTree(root);
    if (activeTool.id !== INPUT_TOOL.id && activeTool.id !== OUTPUT_TOOL.id) return; // switched away while awaiting
    clear(folderSel);
    // Default entry is named after the tab itself (user: "최상위는 OUTPUT 폴더와 INPUT폴더로
    // 이름 만들고") rather than a generic "(All)"/"(Root)" — it shows only images sitting
    // directly in input//output/'s own root, same as any other single-folder pick.
    folderSel.appendChild(el("option", { value: "", text: activeTool.id === INPUT_TOOL.id ? "INPUT folder" : "OUTPUT folder" }));
    tree.forEach((top) => {
      folderSel.appendChild(el("option", { value: top.path, text: top.label }));
      top.children.forEach((sub) => folderSel.appendChild(el("option", { value: sub.path, text: `  ${sub.label}` })));
    });
    folderSel.value = activeFolder;
    folderSel.style.display = tree.length ? "" : "none";
  }
  // The underlying scan is always live server-side, but this dropdown only re-fetched on
  // tab-switch/folder-pick — a folder created on disk while the picker sat open wouldn't show
  // up. User: "실시간 갱신도 되야해." A background poll keeps the list current while the
  // picker is open. Mirrors node `8b74eb4`.
  //
  // A `mousedown`-triggered refresh (rebuild the <option> list right as the native dropdown is
  // about to open) was tried first and reverted — user: "드롭다운에서 폴더를 선택했어. 그리고
  // 다시 드롭다운을 누르면 최상단으로 가는데 이러면 불편해." The rebuild only resolves after
  // fetchFolderTree()'s async round trip, landing after the native popup had already started
  // painting at its default (top) scroll position, so every re-open jumped away from whatever
  // folder was selected. Mirrors node `33047e2` — removed entirely; the poll (guarded to skip
  // while the dropdown has focus, so it can't rebuild mid-interaction either) is enough.
  function refreshFolderSel() {
    if (activeTool.id === INPUT_TOOL.id) delete folderTreeCache.input;
    else if (activeTool.id === OUTPUT_TOOL.id) delete folderTreeCache.output;
    else return;
    renderFolderSel(); // cheap now — folder names only, no image scan
  }
  const folderPollTimer = window.setInterval(() => {
    if (document.activeElement === folderSel) return; // don't rebuild options while it's focused/open
    if (activeTool.id === INPUT_TOOL.id || activeTool.id === OUTPUT_TOOL.id) refreshFolderSel();
  }, 5000);

  const grid = el("div", { style: { display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gridAutoRows: "min-content", gap: "6px", overflowY: "auto", flex: "1", minHeight: "0", alignContent: "start" } });
  const statusEl = el("div", { style: { color: C.muted, fontSize: "11px", flexShrink: "0" } });
  const moreBtn = el("button", { type: "button", text: "Load more", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "6px 10px", borderRadius: "6px", border: `1px solid ${C.border}`, background: C.bg2, color: C.text, flexShrink: "0" } });
  moreBtn.style.display = "none";
  moreBtn.addEventListener("click", () => loadMore());

  box.append(topRow, toolBar, folderSel, grid, statusEl, moreBtn);
  ov.appendChild(box);

  function close() {
    window.clearInterval(folderPollTimer);
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
