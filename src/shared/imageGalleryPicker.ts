// imageGalleryPicker.ts — 이미지 도구 5종(Krea2/Z-Image/Klein/Qwen2511/SDXL)의 갤러리를 한
// 오버레이에서 넘나들며 볼 수 있는 공용 피커. MiniMax H3의 이미지 업로드 카드에서
// "갤러리 선택" 방식으로 쓰인다. 이미지를 고르면 해당 도구의 copy_to_input으로 ComfyUI
// 전역 input 폴더에 복사한 뒤(파일명이 유니크해짐) 그 파일명을 콜백으로 돌려준다.
import { C, BRAND } from "../identity";
import { el, clear } from "./ui";
import { getComfyBase } from "./comfyBase";

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

interface PickerImage {
  filename: string;
  subfolder: string;
  mtime?: number;
}

async function fetchGallery(tool: GalleryToolDef, offset: number, limit: number): Promise<{ images: PickerImage[]; total: number }> {
  try {
    const r = await fetch(`${BASE}${tool.api}/gallery?offset=${offset}&limit=${limit}&subfolder=${encodeURIComponent(tool.subfolder)}`);
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } catch {
    return { images: [], total: 0 };
  }
}

async function copyToInput(tool: GalleryToolDef, img: PickerImage): Promise<string> {
  const r = await fetch(`${BASE}${tool.api}/copy_to_input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: img.filename, subfolder: img.subfolder || "", type: "output" }),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || "copy failed");
  return d.filename as string;
}

function viewUrl(img: PickerImage) {
  return `${BASE}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=output&t=${img.mtime || ""}`;
}

export function openImageGalleryPicker(onPick: (filename: string) => void, initialToolId?: string) {
  let activeTool = IMAGE_GALLERY_TOOLS.find((t) => t.id === initialToolId) || IMAGE_GALLERY_TOOLS[0];
  let offset = 0;
  let total = 0;
  let loading = false;
  let picking = false;

  const ov = el("div", { style: { position: "fixed", inset: "0", background: "rgba(0,0,0,0.75)", zIndex: "100000", display: "flex", alignItems: "center", justifyContent: "center" } });
  const box = el("div", { style: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "12px", width: "min(1056px, 96vw)", height: "min(840px, 92vh)", minHeight: "0", boxShadow: "0 10px 40px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", gap: "10px" } });

  const topRow = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" } });
  topRow.appendChild(el("div", { text: "🖼 갤러리에서 이미지 선택", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }));
  const closeBtn = el("button", { type: "button", text: "✕", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "5px 10px", borderRadius: "6px", border: "none", background: "#c0392b", color: "#fff" } });
  closeBtn.addEventListener("click", () => close());
  topRow.appendChild(closeBtn);

  const toolBar = el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", flexShrink: "0" } });
  function renderToolBar() {
    clear(toolBar);
    IMAGE_GALLERY_TOOLS.forEach((t) => {
      const active = t.id === activeTool.id;
      const b = el("button", {
        type: "button", text: t.label,
        style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "5px 10px", borderRadius: "14px", background: active ? BRAND : C.bg2, color: active ? "#fff" : C.text, border: `1px solid ${active ? BRAND : C.border}`, fontWeight: active ? "700" : "400" },
      });
      b.addEventListener("click", () => { if (activeTool.id !== t.id) { activeTool = t; reset(); } });
      toolBar.appendChild(b);
    });
  }
  renderToolBar();

  const grid = el("div", { style: { display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gridAutoRows: "min-content", gap: "6px", overflowY: "auto", flex: "1", minHeight: "0", alignContent: "start" } });
  const statusEl = el("div", { style: { color: C.muted, fontSize: "11px", flexShrink: "0" } });
  const moreBtn = el("button", { type: "button", text: "Load more", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "6px 10px", borderRadius: "6px", border: `1px solid ${C.border}`, background: C.bg2, color: C.text, flexShrink: "0" } });
  moreBtn.style.display = "none";
  moreBtn.addEventListener("click", () => loadMore());

  box.append(topRow, toolBar, grid, statusEl, moreBtn);
  ov.appendChild(box);

  function close() {
    document.removeEventListener("keydown", onKey);
    document.body.removeChild(ov);
  }
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });

  function reset() {
    offset = 0;
    total = 0;
    clear(grid);
    renderToolBar();
    statusEl.textContent = "Loading…";
    loadMore();
  }

  async function loadMore() {
    if (loading) return;
    loading = true;
    const tool = activeTool;
    const data = await fetchGallery(tool, offset, 60);
    if (tool.id !== activeTool.id) { loading = false; return; }
    total = data.total || 0;
    const imgs = data.images || [];
    imgs.forEach((img) => {
      const cell = el("div", { style: { position: "relative", borderRadius: "4px", overflow: "hidden", border: `1px solid ${C.border}`, background: C.bg2, cursor: "pointer" } });
      const im = el("img", { src: viewUrl(img), style: { width: "100%", height: "auto", display: "block" } });
      cell.appendChild(im);
      cell.addEventListener("click", async () => {
        if (picking) return;
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
    statusEl.textContent = imgs.length || total ? `${offset} / ${total}` : "이 도구의 갤러리에 저장된 이미지가 없습니다.";
    moreBtn.style.display = offset < total ? "block" : "none";
    loading = false;
  }

  reset();
  document.body.appendChild(ov);
}
