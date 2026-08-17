// galleryOverlay.ts — Qwen Image Edit 2511 이미지 갤러리 오버레이. Klein과 동일 패턴 + ANGLE 타깃.
// 원본 근거: web/qwen2511/ui_gallery_qe2511.js
import { C, el, clear, BRAND, SUBFOLDER } from "./core";
import type { GalleryImage } from "./api";
import { getGallery, updateImageMeta, deleteImage, openImageFolder, loadMeta, copyOutputToInput, outputViewUrl } from "./api";

const SEND_TARGETS: { mode: string; field: string; label: string; extra?: string }[] = [
  { mode: "i2i", field: "i2iImage", label: "→ I2I" },
  { mode: "edit", field: "editImage1", label: "→ Edit (Img1)" },
  { mode: "inpaint", field: "inpaintImage", label: "→ Inpaint", extra: "inpaint" },
  { mode: "inpaint", field: "inpaintImage", label: "→ Outpaint", extra: "outpaint" },
  { mode: "faceswap", field: "faceswapTarget", label: "→ Faceswap" },
  { mode: "angle", field: "angleCameraImage", label: "→ Angle" },
  { mode: "upscale", field: "upscaleImage", label: "→ Upscale" },
];

function btn(text: string, onClick: () => void, variant?: "primary" | "danger") {
  return el("button", {
    type: "button",
    text,
    style: {
      cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "5px 10px", borderRadius: "6px", border: "none",
      background: variant === "primary" ? BRAND : variant === "danger" ? "#c0392b" : "#2a2a3a",
      color: "#fff", fontWeight: variant === "primary" ? "700" : "400",
    },
    onclick: onClick,
  });
}

export function createGalleryOverlay(state: { saveSubfolder: string }, onReuse: (meta: any) => void, onSendTo: (mode: string, field: string, extra: string | undefined, filename: string) => void) {
  const ov = el("div", { style: { position: "absolute", inset: "0", zIndex: "55", background: "rgba(11,11,11,0.97)", borderRadius: "inherit", display: "none", flexDirection: "column", padding: "12px", gap: "8px", boxSizing: "border-box" } });

  const topRow = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" } });
  topRow.appendChild(el("div", { text: "🖼 Gallery — Qwen2511", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }));
  const favBtn = btn("☆ Favs", () => { favOnly = !favOnly; favBtn.textContent = favOnly ? "★ Favs (ON)" : "☆ Favs"; reset(); });
  const selectModeBtn = btn("☑ Select", () => toggleSelectMode());
  const deleteSelBtn = btn("🗑 Delete Selection (0)", () => deleteSelected(), "danger");
  deleteSelBtn.style.display = "none";
  const refreshBtn = btn("↻", () => reset());
  const closeBtn = btn("✕", () => (ov.style.display = "none"), "danger");
  topRow.append(favBtn, selectModeBtn, deleteSelBtn, refreshBtn, closeBtn);
  ov.appendChild(topRow);

  let favOnly = false, offset = 0, total = 0, loading = false;
  let loadedImages: GalleryImage[] = [];
  let selectMode = false;
  const selected = new Set<string>();
  const LIMIT = 60;

  function keyOf(img: GalleryImage) { return `${img.subfolder || ""}/${img.filename}`; }

  function toggleSelectMode() {
    selectMode = !selectMode;
    selectModeBtn.textContent = selectMode ? "☑ Select (ON)" : "☑ Select";
    deleteSelBtn.style.display = selectMode ? "inline-block" : "none";
    selected.clear();
    updateDeleteBtn();
    reset();
  }
  function updateDeleteBtn() { deleteSelBtn.textContent = `🗑 Delete Selection (${selected.size})`; }

  async function deleteSelected() {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} selected images?`)) return;
    for (const k of Array.from(selected)) {
      const [subfolder, filename] = [k.slice(0, k.lastIndexOf("/")), k.slice(k.lastIndexOf("/") + 1)];
      await deleteImage(filename, subfolder).catch(() => {});
    }
    selected.clear();
    updateDeleteBtn();
    reset();
  }

  const grid = el("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "6px", overflowY: "auto", flex: "1", alignContent: "start" } });
  const statusEl = el("div", { style: { color: C.muted, fontSize: "11px", flexShrink: "0" } });
  const moreBtn = btn("Load more", () => loadMore());
  moreBtn.style.display = "none";

  let viewerEl: HTMLElement | null = null, keyHandler: ((e: KeyboardEvent) => void) | null = null;
  function closeViewer() {
    if (keyHandler) { document.removeEventListener("keydown", keyHandler); keyHandler = null; }
    if (viewerEl) { document.body.removeChild(viewerEl); viewerEl = null; }
  }
  function openViewer(img: GalleryImage, imgIdx: number) {
    closeViewer();
    const url = outputViewUrl(img.filename, img.subfolder || "", img.mtime);
    const ov2 = el("div", { style: { position: "fixed", inset: "0", background: "rgba(0,0,0,0.92)", zIndex: "10000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px" } });
    ov2.addEventListener("click", (e) => { if (e.target === ov2) closeViewer(); });

    function nav(d: number) { closeViewer(); const ni = Math.max(0, Math.min(loadedImages.length - 1, imgIdx + d)); openViewer(loadedImages[ni], ni); }
    const prevBtn = el("button", { text: "‹", type: "button", style: { position: "fixed", left: "24px", top: "50%", transform: "translateY(-50%)", background: "rgba(40,40,40,0.9)", color: "#fff", border: "none", borderRadius: "50%", width: "48px", height: "48px", fontSize: "24px", cursor: "pointer", display: imgIdx > 0 ? "block" : "none" } });
    const nextBtn = el("button", { text: "›", type: "button", style: { position: "fixed", right: "24px", top: "50%", transform: "translateY(-50%)", background: "rgba(40,40,40,0.9)", color: "#fff", border: "none", borderRadius: "50%", width: "48px", height: "48px", fontSize: "24px", cursor: "pointer", display: imgIdx < loadedImages.length - 1 ? "block" : "none" } });
    prevBtn.onclick = (e) => { e.stopPropagation(); nav(-1); };
    nextBtn.onclick = (e) => { e.stopPropagation(); nav(1); };

    const big = el("img", { src: url, style: { maxWidth: "90vw", maxHeight: "64vh", borderRadius: "8px", objectFit: "contain" } });
    const counter = el("div", { text: `${imgIdx + 1} / ${loadedImages.length}`, style: { color: C.muted, fontSize: "11px" } });
    const promptTxt = el("div", { text: img.prompt ? img.prompt.slice(0, 240) : "", style: { color: C.muted, fontSize: "11px", maxWidth: "70vw", textAlign: "center", whiteSpace: "pre-wrap" } });

    const closeB = btn("Close", () => closeViewer());
    const folderB = btn("📂 Open Folder", () => openImageFolder(img.filename, img.subfolder || ""));
    const deleteB = btn("🗑 Delete", async () => { if (!confirm("Delete this image?")) return; await deleteImage(img.filename, img.subfolder || ""); closeViewer(); reset(); }, "danger");
    const copyB = btn("📋 Copy Prompt", () => { if (img.prompt) navigator.clipboard?.writeText(img.prompt).catch(() => {}); });
    const reuseB = btn("♻ Reuse", async () => {
      reuseB.textContent = "Loading…"; (reuseB as HTMLButtonElement).disabled = true;
      const meta = await loadMeta(img.filename, img.subfolder || "");
      if (!meta || !meta.mode) { reuseB.textContent = "No meta"; (reuseB as HTMLButtonElement).disabled = false; return; }
      closeViewer(); ov.style.display = "none"; onReuse(meta);
    }, "primary");

    const actionRow = el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "center" } });
    [closeB, reuseB, copyB, folderB, deleteB].forEach((b) => actionRow.appendChild(b));

    const sendRow = el("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "center" } });
    sendRow.appendChild(el("div", { text: "Send to:", style: { color: C.muted, fontSize: "12px", alignSelf: "center" } }));
    SEND_TARGETS.forEach((t) => {
      const b = btn(t.label, async () => {
        (b as HTMLButtonElement).disabled = true; b.textContent = "Copying…";
        try {
          const n = await copyOutputToInput(img.filename, img.subfolder || "", "output");
          closeViewer(); ov.style.display = "none";
          onSendTo(t.mode, t.field, t.extra, n);
        } catch { b.textContent = "Error"; setTimeout(() => { (b as HTMLButtonElement).disabled = false; b.textContent = t.label; }, 2000); }
      });
      b.style.fontSize = "11px";
      sendRow.appendChild(b);
    });

    ov2.append(prevBtn, nextBtn, big, counter, promptTxt, actionRow, sendRow);
    document.body.appendChild(ov2);
    viewerEl = ov2;
    keyHandler = (e) => { if (e.key === "ArrowLeft") nav(-1); if (e.key === "ArrowRight") nav(1); if (e.key === "Escape") closeViewer(); };
    document.addEventListener("keydown", keyHandler);
  }

  function thumb(img: GalleryImage, idx: number) {
    const url = outputViewUrl(img.filename, img.subfolder || "", img.mtime);
    const k = keyOf(img);
    const cell = el("div", { style: { position: "relative", borderRadius: "4px", overflow: "hidden", border: `1px solid ${C.border}`, background: C.bg2, cursor: "pointer" } });
    const im = el("img", { src: url, style: { width: "100%", height: "auto", display: "block" } });
    im.addEventListener("click", () => { if (selectMode) { toggleSel(k, cell); } else { openViewer(img, idx); } });

    if (selectMode) {
      const chk = el("div", {
        text: selected.has(k) ? "✓" : "",
        style: { position: "absolute", top: "3px", left: "3px", width: "18px", height: "18px", borderRadius: "4px", background: selected.has(k) ? BRAND : "rgba(0,0,0,0.6)", border: `1px solid ${C.border}`, color: "#fff", fontSize: "12px", textAlign: "center", lineHeight: "17px" },
      });
      cell.appendChild(chk);
    } else {
      const star = el("button", { text: img.favorite ? "★" : "☆", type: "button", style: { position: "absolute", top: "2px", right: "2px", background: "rgba(0,0,0,0.65)", color: img.favorite ? BRAND : "#fff", border: "none", borderRadius: "8px", width: "18px", height: "18px", fontSize: "10px", cursor: "pointer", lineHeight: "18px", padding: "0" } });
      star.addEventListener("click", async (e) => {
        e.stopPropagation();
        const nv = !img.favorite; img.favorite = nv;
        star.textContent = nv ? "★" : "☆"; star.style.color = nv ? BRAND : "#fff";
        await updateImageMeta(img.filename, img.subfolder || "", { favorite: nv });
      });
      const del = el("button", { text: "✕", type: "button", style: { position: "absolute", top: "2px", left: "2px", background: "rgba(180,0,0,0.7)", color: "#fff", border: "none", borderRadius: "8px", width: "18px", height: "18px", fontSize: "10px", cursor: "pointer", lineHeight: "18px", padding: "0" } });
      del.addEventListener("click", async (e) => { e.stopPropagation(); if (!confirm("Delete?")) return; await deleteImage(img.filename, img.subfolder || ""); reset(); });
      cell.append(star, del);
    }
    cell.appendChild(im);
    return cell;
  }

  function toggleSel(k: string, cell: HTMLElement) {
    if (selected.has(k)) selected.delete(k); else selected.add(k);
    updateDeleteBtn();
    const chk = cell.querySelector("div") as HTMLElement | null;
    if (chk) {
      chk.textContent = selected.has(k) ? "✓" : "";
      chk.style.background = selected.has(k) ? BRAND : "rgba(0,0,0,0.6)";
    }
  }

  async function loadMore() {
    if (loading) return;
    loading = true; moreBtn.textContent = "Loading…";
    try {
      const data = await getGallery({ offset, limit: LIMIT, subfolder: state.saveSubfolder || SUBFOLDER, favonly: favOnly });
      const imgs = data.images || []; total = data.total || 0;
      imgs.forEach((img, i) => grid.appendChild(thumb(img, offset + i)));
      loadedImages = loadedImages.concat(imgs); offset += imgs.length;
      statusEl.textContent = `${loadedImages.length} / ${total}`;
      moreBtn.style.display = offset < total ? "block" : "none";
      if (!loadedImages.length) statusEl.textContent = "No images found.";
    } catch (e: any) { statusEl.textContent = `Error: ${e.message || e}`; }
    finally { loading = false; moreBtn.textContent = "Load more"; }
  }
  function reset() { clear(grid); offset = 0; loadedImages = []; loadMore(); }

  ov.appendChild(grid);
  ov.appendChild(el("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexShrink: "0" } }, [statusEl, moreBtn]));

  return {
    el: ov,
    show() { ov.style.display = "flex"; reset(); },
    hide() { ov.style.display = "none"; },
  };
}
