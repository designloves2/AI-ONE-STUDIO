// galleryOverlay.ts — ITDA Studio's real render gallery overlay. Ported structurally from
// the node original (web/shared/ui_gallery_itda.js), which itself was ported from MiniMax
// H3's own video gallery card design (web/minimax/ui_gallery_minimax.js / this repo's
// ../minimax_h3/galleryOverlay.ts) rather than being its own simplified thing — same square
// contain-fit thumbnail, ⓘ hover info popup, hover-preview <video>, [WxH / MP ratio] line,
// "★ stitched" mark color/weight, and ⬇ explicit-import button (not click-to-import — a
// bare look/hover must never silently add project media).
//
// What's adapted: ITDA renders have no single "prompt" — gallery.py's own meta.media_used
// (the media-pool filenames the render drew from) fills that slot instead. "Stitched" here
// means "composited from MORE THAN ONE media-pool file" (meta.media_used.length > 1), the
// direct ITDA equivalent of H3's multi-clip concat flag.
//
// What's intentionally NOT built: the node's bottom 2x2 Reuse/Extend/View/Copy button grid.
// The node's own comment is explicit that these are unimplemented there too — ITDA gallery
// items carry no single render setting to Reuse, no source clip to Extend, and no single
// prompt to View/Copy (media_used already covers that slot in the meta line above), so
// there's nothing on the ITDA side to wire any of them to. Left out entirely, not shown
// disabled, matching the node's own "하단에 버튼 비활성화 아니고 있다 갤러리에서는
// 안보여야지" (not disabled — absent) instruction.
import { C, BRAND } from "../../identity";
import { el, clear } from "../../shared/ui";
import { attachSensitiveToggle, mediaKey, isBlurred } from "../../shared/sensitiveMedia";
import * as api from "./api";
import type { ItdaGalleryItem } from "./api";

// Same non-BRAND amber H3 uses for its stitched mark/border, so "stitched" and "picked/
// selected" never read as the same color.
const STITCH_COLOR = "#e0a530";

function fmtWhen(ts?: number) {
  if (!ts) return "";
  try { return new Date(ts * 1000).toLocaleString(); } catch { return ""; }
}

export interface ItdaGalleryOverlayCtx {
  getProject: () => string;
  onImported: () => void | Promise<void>;
  showStatus: (msg: string) => void;
}

export interface ItdaGalleryOverlayHandle {
  el: HTMLElement;
  show(): void;
  hide(): void;
}

export function createItdaGalleryOverlay(root: HTMLElement, ctx: ItdaGalleryOverlayCtx): ItdaGalleryOverlayHandle {
  const ov = el("div", { style: {
    position: "fixed", inset: "0", zIndex: "9998",
    background: "rgba(11,11,11,0.985)", display: "none", flexDirection: "column",
    padding: "12px", gap: "8px", boxSizing: "border-box",
  }});

  const hdr = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" } });
  hdr.appendChild(el("div", { text: "🖼 Gallery", style: { color: "#fff", fontSize: "14px", fontWeight: "700" } }));
  const countTag = el("div", { style: { fontSize: "10.5px", color: C.muted, flex: "1" } });
  hdr.appendChild(countTag);
  const refreshBtn = el("button", { type: "button", text: "↻", title: "Refresh", style: {
    cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "5px 11px",
    borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`,
  }});
  refreshBtn.addEventListener("click", () => refresh());
  const closeBtn = el("button", { type: "button", text: "✕ Close", style: {
    cursor: "pointer", fontFamily: "inherit", fontSize: "10.5px", padding: "5px 11px",
    borderRadius: "6px", background: C.bg2, color: "#ff6767", border: `1px solid ${C.border}`,
  }});
  closeBtn.addEventListener("click", () => hide());
  hdr.append(refreshBtn, closeBtn);

  const grid = el("div", { style: {
    flex: "1", overflow: "auto", display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "10px", alignContent: "start",
  }});

  ov.append(hdr, grid);

  // ── delete confirm — viewport-centered, same pattern H3's gallery uses ──────────────
  const deleteConfirmOv = el("div", { style: {
    display: "none", position: "fixed", inset: "0", zIndex: "99999",
    background: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center",
  }});
  const deleteConfirmName = el("div", { style: { color: C.muted, fontSize: "11px", lineHeight: "1.5", wordBreak: "break-all" } });
  const deleteConfirmBtn = el("button", { type: "button", text: "Delete", style: {
    cursor: "pointer", fontFamily: "inherit", fontSize: "11.5px", padding: "6px 14px",
    borderRadius: "6px", background: C.bg2, color: "#ff6767", border: `1px solid ${C.border}`,
  }}) as HTMLButtonElement;
  const deleteCancelBtn = el("button", { type: "button", text: "Cancel", style: {
    cursor: "pointer", fontFamily: "inherit", fontSize: "11.5px", padding: "6px 14px",
    borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`,
  }});
  let pendingDelete: ItdaGalleryItem | null = null;
  function cancelDelete() { deleteConfirmOv.style.display = "none"; pendingDelete = null; }
  deleteCancelBtn.addEventListener("click", cancelDelete);
  async function runDelete() {
    if (!pendingDelete) return;
    deleteConfirmBtn.disabled = true;
    try {
      const d = await api.deleteGalleryItem(pendingDelete.id);
      if (!(d as any).ok) throw new Error((d as any).error || "delete failed");
      deleteConfirmOv.style.display = "none";
      pendingDelete = null;
      await refresh();
    } catch (e: any) {
      ctx.showStatus(`Delete failed: ${e.message || e}`);
    } finally {
      deleteConfirmBtn.disabled = false;
    }
  }
  deleteConfirmBtn.addEventListener("click", runDelete);
  const deleteBtnRow = el("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" } });
  deleteBtnRow.append(deleteCancelBtn, deleteConfirmBtn);
  const deleteConfirmBox = el("div", { style: {
    background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px",
    padding: "18px 20px", width: "320px", boxSizing: "border-box",
    display: "flex", flexDirection: "column", gap: "10px", boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
  }});
  deleteConfirmBox.append(
    el("div", { text: "Delete this render?", style: { color: "#fff", fontSize: "13px", fontWeight: "700" } }),
    deleteConfirmName,
    el("div", { text: "This can't be undone.", style: { color: C.muted, fontSize: "11.5px" } }),
    deleteBtnRow,
  );
  deleteConfirmOv.appendChild(deleteConfirmBox);
  deleteConfirmOv.addEventListener("click", (e) => { if (e.target === deleteConfirmOv) cancelDelete(); });
  function askDelete(it: ItdaGalleryItem) {
    pendingDelete = it;
    deleteConfirmName.textContent = (it as any).filename || it.path;
    deleteConfirmOv.style.display = "flex";
  }

  // ── one shared hover-preview <video>, moved between cards ─────────────────────────
  const hoverVideo = el("video", { muted: "", playsInline: "", preload: "metadata", style: {
    position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain",
    background: "#000", pointerEvents: "none",
  }}) as HTMLVideoElement;
  hoverVideo.muted = true;
  function stopGridVideos() {
    hoverVideo.pause();
    hoverVideo.removeAttribute("src");
    if (hoverVideo.parentNode) hoverVideo.parentNode.removeChild(hoverVideo);
  }

  // ── fullscreen player — double-click a card ────────────────────────────────────────
  const fsVideo = el("video", { controls: "", style: {
    display: "none", position: "fixed", inset: "0", width: "100%", height: "100%",
    background: "#000", zIndex: "99999",
  }}) as HTMLVideoElement;
  document.body.appendChild(fsVideo);
  fsVideo.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) { fsVideo.pause(); fsVideo.style.display = "none"; fsVideo.removeAttribute("src"); }
  });
  async function openPlayer(it: ItdaGalleryItem) {
    fsVideo.src = (it as any).video_url || "";
    fsVideo.style.display = "block";
    try { await fsVideo.requestFullscreen?.(); } catch { /* needs a direct user gesture on some browsers */ }
    fsVideo.play().catch(() => {});
  }

  let items: ItdaGalleryItem[] = [];

  function renderGrid() {
    stopGridVideos();
    clear(grid);
    countTag.textContent = `${items.length} render${items.length === 1 ? "" : "s"}`;
    if (!items.length) {
      grid.appendChild(el("div", {
        text: 'Nothing rendered yet — use "Render…" to add the first one.',
        style: { color: C.muted, fontSize: "12px", gridColumn: "1 / -1", textAlign: "center", padding: "30px 0" } }));
      return;
    }
    items.forEach((it) => {
      const anyIt = it as any;
      const m = anyIt.meta || {};
      const isAudioOnly = anyIt.mode === "audio_only" || anyIt.has_video === false;
      const isStitched = Array.isArray(m.media_used) && m.media_used.length > 1;

      const card = el("div", { style: {
        position: "relative",
        background: C.bg1, border: `1px solid ${isStitched ? STITCH_COLOR : C.border}`,
        borderRadius: "8px", cursor: "pointer",
        display: "flex", flexDirection: "column",
      }});

      const thumbWrap = el("div", { style: { position: "relative", width: "100%" } });
      const thumbInner = isAudioOnly
        ? el("div", { style: {
            width: "100%", aspectRatio: "1 / 1", background: "#000", display: "flex",
            flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: "4px", color: "#8f7bff", fontSize: "26px", borderRadius: "7px 7px 0 0",
          }}, [
            el("span", { text: "🎵" }),
            el("span", { text: "Audio", style: { fontSize: "11px", color: "#aaa", fontWeight: "600" } }),
          ])
        : el("img", { loading: "lazy", src: anyIt.thumb_url || "", style: {
            width: "100%", aspectRatio: "1 / 1", objectFit: "contain", background: "#000", display: "block",
            borderRadius: "7px 7px 0 0",
          }});
      thumbWrap.appendChild(thumbInner);

      const deleteBtn = el("button", { type: "button", text: "✕", title: "Delete this render", style: {
        position: "absolute", top: "4px", right: "4px", zIndex: "3",
        width: "18px", height: "18px", lineHeight: "16px", padding: "0",
        cursor: "pointer", fontSize: "11px", fontFamily: "inherit",
        background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "4px",
      }});
      deleteBtn.addEventListener("click", (e) => { e.stopPropagation(); askDelete(it); });
      thumbWrap.appendChild(deleteBtn);

      // Explicit import button — not click-to-import. A plain click/look must never silently
      // add project media (regression the node comment calls out by name).
      const importBtn = el("button", { type: "button", text: "⬇", title: "Import into Media Bin", style: {
        position: "absolute", bottom: "4px", left: "4px", zIndex: "3",
        width: "18px", height: "18px", lineHeight: "16px", padding: "0",
        cursor: "pointer", fontSize: "11px", fontFamily: "inherit",
        background: BRAND, color: "#fff", border: "none", borderRadius: "4px",
      }});
      const sensKey = mediaKey(anyIt.filename || it.path, `itda_gallery/${it.project}`);
      importBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (isBlurred(sensKey)) { ctx.showStatus("Hidden — click 👁 to reveal it first."); return; }
        try {
          const project = ctx.getProject() || it.project;
          const d = await api.importGalleryItem(it.id, project);
          if (!(d as any).ok) throw new Error((d as any).error || "import failed");
          await ctx.onImported();
          ctx.showStatus("Imported into Media Bin: " + (anyIt.filename || it.path));
        } catch (e2: any) {
          ctx.showStatus("Import failed: " + (e2.message || e2));
        }
      });
      thumbWrap.appendChild(importBtn);

      // ⓘ hover info — an ITDA render's own read-out (no steps/sampler/seed here) in place of
      // H3's full generation-param set.
      const infoBtn = el("button", { type: "button", text: "ⓘ", style: {
        position: "absolute", top: "4px", left: "4px", zIndex: "3",
        width: "18px", height: "18px", lineHeight: "16px", padding: "0",
        cursor: "default", fontSize: "11px", fontFamily: "inherit",
        background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "4px",
      }});
      infoBtn.addEventListener("click", (e) => e.stopPropagation());
      let infoPopup: HTMLElement | null = null;
      infoBtn.addEventListener("mouseenter", () => {
        const lines: string[] = [];
        if (m.w && m.h) lines.push(`${m.w}×${m.h}`);
        if (m.fps) lines.push(`${m.frames || 0} frames @ ${Math.round(m.fps)}fps`);
        lines.push(`mode: ${anyIt.mode || "video_audio"}`);
        lines.push(`project: ${it.project}`);
        infoPopup = el("div", { style: {
          position: "fixed", zIndex: "10001", background: "rgba(10,10,10,0.97)",
          border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px 8px",
          fontSize: "10px", color: C.text, lineHeight: "1.6",
          whiteSpace: "pre-wrap", wordBreak: "break-all",
          pointerEvents: "none", maxWidth: "220px", boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        }});
        infoPopup.textContent = lines.join("\n");
        document.body.appendChild(infoPopup);
        const r = infoBtn.getBoundingClientRect();
        infoPopup.style.left = `${r.right - 226}px`;
        infoPopup.style.bottom = `${window.innerHeight - r.top + 6}px`;
      });
      infoBtn.addEventListener("mouseleave", () => { infoPopup?.remove(); infoPopup = null; });
      thumbWrap.appendChild(infoBtn);

      // 눈가리기 — same shared hide/reveal every ONE STUDIO gallery uses.
      attachSensitiveToggle(thumbWrap, thumbInner.tagName === "IMG" ? thumbInner : thumbWrap, sensKey, "br", () => {
        if (hoverVideo.parentNode === thumbWrap) hoverVideo.style.filter = isBlurred(sensKey) ? "blur(14px)" : "";
      });

      if (!isAudioOnly) {
        thumbWrap.addEventListener("mouseenter", () => {
          stopGridVideos();
          hoverVideo.src = anyIt.video_url || "";
          hoverVideo.style.filter = isBlurred(sensKey) ? "blur(14px)" : "";
          thumbWrap.appendChild(hoverVideo);
          hoverVideo.currentTime = 0; hoverVideo.play?.().catch(() => {});
        });
        thumbWrap.addEventListener("mouseleave", stopGridVideos);
      }
      card.addEventListener("dblclick", () => {
        if (isBlurred(sensKey)) { ctx.showStatus("Hidden — click 👁 to reveal it first."); return; }
        openPlayer(it);
      });

      const meta = el("div", { style: { padding: "5px 7px", display: "flex", flexDirection: "column", gap: "1px" } });
      if (m.w && m.h) {
        const mp = ((m.w * m.h) / 1_000_000).toFixed(1);
        meta.appendChild(el("div", {
          text: `[${m.w}x${m.h}px / ${mp}MP]`,
          style: { fontSize: "9px", color: "#fff", fontWeight: "600" },
        }));
      }
      const fname = anyIt.filename || it.path;
      meta.append(
        el("div", { text: fname, title: fname, style: {
          fontSize: "10px", color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }),
        el("div", { text: `${Math.round(anyIt.duration_sec || 0)}s · ${it.project} · ${fmtWhen(it.created_at)}`,
          style: { fontSize: "9px", color: C.muted } }),
      );
      if (isStitched) {
        meta.appendChild(el("div", { text: "★ stitched", style: { fontSize: "9px", color: STITCH_COLOR, fontWeight: "700" } }));
      }

      // "사용 파일 정보" (files used) replaces H3's prompt text in the same card slot — ITDA
      // renders have no single prompt; the media-pool files a composited render drew from
      // fill that slot instead.
      const mediaUsed: string[] = Array.isArray(m.media_used) ? m.media_used : [];
      if (mediaUsed.length) {
        const filesText = mediaUsed.join(", ");
        const p = el("div", { text: filesText, style: {
          fontSize: "9px", color: C.muted, lineHeight: "1.35", marginTop: "2px",
          display: "-webkit-box", WebkitLineClamp: "3", WebkitBoxOrient: "vertical",
          overflow: "hidden", cursor: "text",
        }});
        p.title = filesText;
        meta.appendChild(p);
      }

      card.append(thumbWrap, meta);
      grid.appendChild(card);
    });
  }

  async function refresh() {
    countTag.textContent = "loading…";
    try {
      const d = await api.listGallery();
      items = (d as any).ok ? (d.items || []) : [];
    } catch { items = []; }
    renderGrid();
  }

  function show() { ov.style.display = "flex"; refresh(); }
  function hide() { ov.style.display = "none"; stopGridVideos(); }

  root.appendChild(ov);
  document.body.appendChild(deleteConfirmOv);

  return { el: ov, show, hide };
}
