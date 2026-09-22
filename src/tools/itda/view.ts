// view.ts — ITDA Studio toolbar + timeline + media bin + properties panel + render modal.
// Structural reference: web/itda_studio/dom_build.js (node pack). Built with this repo's own
// el()/panel()/row()/col() convention (src/shared/ui.ts), not literal DOM-string reuse.
import { el, panel, row, label, clear } from "../../shared/ui";
import { C, BRAND } from "../../identity";
import * as api from "./api";
import { ItdaState, type ItdaClip, type DragState } from "./core";
import { createItdaSettingsOverlay } from "./settings";

const TRACK_HEIGHT = 44;
const RULER_HEIGHT = 22;

export function renderItda(container: HTMLElement) {
  const state = new ItdaState();
  let dragState: DragState | null = null;

  const root = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", padding: "10px", gap: "8px", boxSizing: "border-box" } });
  container.appendChild(root);

  // ── App Settings (system-wide — Gallery Path + LLM backend/model) ────────
  const settingsOverlay = createItdaSettingsOverlay();
  root.appendChild(settingsOverlay.el);

  // ── toolbar ────────────────────────────────────────────────────────────
  const statusEl = el("span", { style: { color: C.muted, fontSize: "12px" } });
  const projectLabel = el("span", { style: { color: C.text, fontSize: "13px", fontWeight: "600" } });
  const toolbar = row(
    [
      el("span", { text: "ITDA ONE STUDIO", style: { color: BRAND, fontWeight: "700", fontSize: "14px", marginRight: "10px" } }),
      projectLabel,
      el("div", { style: { flex: "1" } }),
      mkBtn("+ Video Track", () => { state.addTrack("video"); renderTracks(); }),
      mkBtn("+ Audio Track", () => { state.addTrack("audio"); renderTracks(); }),
      mkBtn("✂", () => {
        if (state.splitSelectedAtPlayhead()) { renderTracks(); renderProps(); refreshStatus(); statusEl.textContent = "Split"; }
      }, false, "Split — cut the selected clip at the playhead"),
      mkBtn("🧵", () => {
        const c = state.stitchSelected();
        renderTracks(); renderProps(); refreshStatus();
        statusEl.textContent = c ? "Stitched as layer container" : "Select 2+ clips (ctrl/shift-click) to Stitch";
      }, false, "Stitch — combine 2+ selected clips into one layer container"),
      mkBtn("🪢", () => {
        const ok = state.unstitchSelected();
        renderTracks(); renderProps(); refreshStatus();
        statusEl.textContent = ok ? "UnStitched" : "Select a Stitched clip to UnStitch";
      }, false, "UnStitch — restore a stitched clip's originals"),
      mkBtn("▣", async () => {
        const c = state.snapshotCandidate();
        if (!c) { statusEl.textContent = "No clip under the playhead to snapshot"; return; }
        statusEl.textContent = "Snapshotting…";
        try {
          const sourceFrame = Math.max(0, Math.round((c.source_in || 0) + (state.playhead - c.start)));
          const res = await api.snapshotFrame(state.project, c.media_path, c.kind === "image" ? "image" : "video", sourceFrame, c.fps);
          statusEl.textContent = res?.ok ? `Snapshot saved · F${sourceFrame}` : `Snapshot failed: ${(res as any)?.error || "unknown"}`;
        } catch (err: any) {
          statusEl.textContent = `Snapshot failed: ${err?.message || err}`;
        }
      }, false, "Snapshot — save the current frame (P)"),
      mkBtn("Save", async () => { await state.save(); refreshStatus(); }),
      mkBtn("Render…", () => openRenderModal(), true),
      mkBtn("Gallery", () => openGalleryOverlay(container, state), false),
      mkBtn("⚙ App Settings", () => settingsOverlay.show(), false, "System-wide settings — Gallery Path + LLM backend/model"),
      statusEl,
    ],
    "8px"
  );
  toolbar.style.alignItems = "center";
  root.appendChild(toolbar);

  // ── main split: media bin | timeline+properties ──────────────────────────
  const mainRow = el("div", { style: { flex: "1", minHeight: "0", display: "flex", gap: "8px" } });
  root.appendChild(mainRow);

  const mediaBin = el("div", { style: { width: "220px", flexShrink: "0", overflowY: "auto" } });
  mainRow.appendChild(mediaBin);

  const centerCol = el("div", { style: { flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "8px" } });
  mainRow.appendChild(centerCol);

  const propsPanel = el("div", { style: { width: "220px", flexShrink: "0" } });
  mainRow.appendChild(propsPanel);

  // playhead controls
  const playheadInfo = el("span", { style: { color: C.muted, fontSize: "12px" } });
  const transport = row(
    [
      mkBtn("⏮", () => seekPlayhead(0)),
      mkBtn("◀", () => seekPlayhead(state.playhead - 1)),
      mkBtn("▶", () => seekPlayhead(state.playhead + 1)),
      mkBtn("End", () => seekPlayhead(state.contentEnd())),
      playheadInfo,
    ],
    "4px"
  );
  centerCol.appendChild(transport);

  const timelineScroll = el("div", { style: { flex: "1", minHeight: "0", overflow: "auto", background: C.bg0, border: `1px solid ${C.border}`, borderRadius: "6px", position: "relative" } });
  centerCol.appendChild(timelineScroll);

  const timelineInner = el("div", { style: { position: "relative" } });
  timelineScroll.appendChild(timelineInner);

  const ruler = el("div", { style: { height: `${RULER_HEIGHT}px`, position: "relative", borderBottom: `1px solid ${C.border}` } });
  timelineInner.appendChild(ruler);

  const tracksHost = el("div", { style: { position: "relative" } });
  timelineInner.appendChild(tracksHost);

  const playheadLine = el("div", {
    style: { position: "absolute", top: "0", bottom: "0", width: "1px", background: BRAND, zIndex: "5", pointerEvents: "none" },
  });
  timelineInner.appendChild(playheadLine);

  function frameToPx(f: number) {
    return f * state.zoomPxPerFrame;
  }
  function pxToFrame(px: number) {
    return Math.max(0, Math.round(px / state.zoomPxPerFrame));
  }

  function refreshStatus() {
    projectLabel.textContent = state.project;
    statusEl.textContent = state.dirty ? "unsaved changes" : "saved";
    playheadInfo.textContent = `frame ${state.playhead} / end ${state.contentEnd()} / total ${state.totalFrames} @ ${state.fps}fps`;
  }

  function seekPlayhead(f: number) {
    state.playhead = Math.max(0, Math.min(state.totalFrames, f));
    playheadLine.style.left = `${frameToPx(state.playhead)}px`;
    refreshStatus();
  }

  function renderRuler() {
    clear(ruler);
    const width = frameToPx(state.totalFrames);
    ruler.style.width = `${width}px`;
    const stepFrames = Math.max(1, Math.round(state.fps)); // 1s ticks
    for (let f = 0; f <= state.totalFrames; f += stepFrames) {
      const tick = el("div", {
        style: { position: "absolute", left: `${frameToPx(f)}px`, top: "0", bottom: "0", width: "1px", background: C.border },
      });
      ruler.appendChild(tick);
      if ((f / stepFrames) % 5 === 0) {
        ruler.appendChild(
          el("div", {
            text: `${Math.round(f / state.fps)}s`,
            style: { position: "absolute", left: `${frameToPx(f) + 2}px`, top: "2px", fontSize: "9px", color: C.muted },
          })
        );
      }
    }
  }

  function renderTracks() {
    clear(tracksHost);
    const width = frameToPx(state.totalFrames);
    tracksHost.style.width = `${width}px`;
    state.tracks.forEach((track, ti) => {
      const trackEl = el("div", {
        style: {
          position: "relative",
          height: `${TRACK_HEIGHT}px`,
          borderBottom: `1px solid ${C.border}`,
          background: track.kind === "audio" ? "rgba(100,180,255,0.04)" : "transparent",
        },
      });
      trackEl.dataset.trackIndex = String(ti);
      trackEl.addEventListener("dragover", (e) => e.preventDefault());
      trackEl.addEventListener("drop", (e) => {
        e.preventDefault();
        const mediaPath = e.dataTransfer?.getData("text/itda-media");
        if (!mediaPath) return;
        const media = state.media.find((m) => m.path === mediaPath);
        if (!media) return;
        const rect = trackEl.getBoundingClientRect();
        const localX = (e as DragEvent).clientX - rect.left + timelineScroll.scrollLeft;
        const startFrame = state.snapFrame(pxToFrame(localX), "__new__");
        const clip = state.addClip(ti, media, startFrame);
        if (clip) renderTracks();
        refreshStatus();
      });

      track.clips.forEach((clip) => trackEl.appendChild(renderClipEl(clip)));
      tracksHost.appendChild(trackEl);
    });
    tracksHost.style.height = `${state.tracks.length * TRACK_HEIGHT}px`;
    timelineInner.style.width = `${width}px`;
    playheadLine.style.left = `${frameToPx(state.playhead)}px`;
  }

  function renderClipEl(clip: ItdaClip) {
    const w = Math.max(4, frameToPx(clip.duration));
    const isSel = state.selectedClipIds.has(clip.id) || state.selectedClipId === clip.id;
    const isStitched = clip.kind === "stitched";
    const clipEl = el(
      "div",
      {
        style: {
          position: "absolute",
          left: `${frameToPx(clip.start)}px`,
          top: "2px",
          bottom: "2px",
          width: `${w}px`,
          background: isSel ? BRAND : isStitched ? "#7a4f1e" : clip.kind === "audio" ? "#3a6" : "#37507a",
          border: `1px solid ${isSel ? "#fff" : isStitched ? "#c8842e" : C.border}`,
          borderRadius: "3px",
          overflow: "hidden",
          cursor: "grab",
          fontSize: "10px",
          color: "#fff",
          padding: "2px 4px",
          boxSizing: "border-box",
          userSelect: "none",
        },
        text: (isStitched ? "🧵 " : "") + (clip.label || clip.media_path.split(/[\\/]/).pop() || ""),
      },
      []
    );

    // waveform canvas for audio-bearing clips (a "stitched" container has no media_path of
    // its own to probe)
    if (!isStitched && (clip.kind === "audio" || clip.kind === "video")) {
      const canvas = el("canvas", { style: { position: "absolute", left: "0", bottom: "0", width: "100%", height: "60%", opacity: "0.55", pointerEvents: "none" } }) as HTMLCanvasElement;
      clipEl.appendChild(canvas);
      loadWaveform(clip, canvas, w);
    }

    const leftHandle = el("div", { style: { position: "absolute", left: "0", top: "0", bottom: "0", width: "6px", cursor: "ew-resize" } });
    const rightHandle = el("div", { style: { position: "absolute", right: "0", top: "0", bottom: "0", width: "6px", cursor: "ew-resize" } });
    clipEl.appendChild(leftHandle);
    clipEl.appendChild(rightHandle);

    clipEl.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      // ctrl/shift-click adds to the multi-select (🧵 Stitch needs 2+); a plain click
      // replaces the selection, matching the node's own click-vs-additive-click split.
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      if (additive) {
        if (state.selectedClipIds.has(clip.id)) state.selectedClipIds.delete(clip.id);
        else state.selectedClipIds.add(clip.id);
      } else if (!state.selectedClipIds.has(clip.id)) {
        state.selectedClipIds = new Set([clip.id]);
      }
      state.selectedClipId = clip.id;
      renderTracks();
      renderProps();
      const target = e.target as HTMLElement;
      const mode: DragState["mode"] = target === leftHandle ? "trim-left" : target === rightHandle ? "trim-right" : "move";
      dragState = {
        clipId: clip.id,
        mode,
        startX: e.clientX,
        origStart: clip.start,
        origSourceIn: clip.source_in,
        origSourceOut: clip.source_out,
        origDuration: clip.duration,
      };
    });

    return clipEl;
  }

  const waveformCache = new Map<string, number[]>();
  async function loadWaveform(clip: ItdaClip, canvas: HTMLCanvasElement, widthPx: number) {
    const key = clip.media_path;
    let finalPeaks: number[] | undefined = waveformCache.get(key);
    if (!finalPeaks) {
      const res = await api.getWaveform(state.project, clip.media_path, 240).catch(() => null);
      finalPeaks = (res?.peaks as number[] | undefined) || [];
      waveformCache.set(key, finalPeaks);
    }
    if (!finalPeaks.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bars = Math.max(1, Math.min(finalPeaks.length, Math.round(widthPx)));
    canvas.width = bars;
    canvas.height = 20;
    ctx.fillStyle = "#ffffff";
    const step = finalPeaks.length / bars;
    for (let i = 0; i < bars; i++) {
      const p = finalPeaks[Math.floor(i * step)] || 0; // peak-normalized 0..1
      const h = Math.max(1, p * canvas.height);
      ctx.fillRect(i, canvas.height - h, 1, h);
    }
  }

  window.addEventListener("mousemove", (e) => {
    if (!dragState) return;
    const found = state.findClip(dragState.clipId);
    if (!found) return;
    const { clip } = found;
    const rawDeltaFrames = Math.round((e.clientX - dragState.startX) / state.zoomPxPerFrame);

    if (dragState.mode === "move") {
      const proposedStart = Math.max(0, dragState.origStart + rawDeltaFrames);
      clip.start = state.snapMoveStart(clip, proposedStart);
      state.clampToTotalFrames(clip);
    } else if (dragState.mode === "trim-left") {
      const proposedFrame = dragState.origStart + rawDeltaFrames;
      const snapped = state.snapEdge(clip, "left", proposedFrame);
      const maxIn = dragState.origStart + dragState.origDuration - 1;
      const newStart = Math.max(0, Math.min(snapped, maxIn));
      const shift = newStart - dragState.origStart;
      clip.start = newStart;
      clip.duration = Math.max(1, dragState.origDuration - shift);
      clip.source_in = dragState.origSourceIn + shift;
    } else if (dragState.mode === "trim-right") {
      const proposedEnd = dragState.origStart + dragState.origDuration + rawDeltaFrames;
      const snapped = state.snapEdge(clip, "right", proposedEnd);
      const newDuration = Math.max(1, snapped - clip.start);
      clip.duration = newDuration;
      clip.source_out = clip.source_in + newDuration;
      state.clampToTotalFrames(clip);
    }
    state.dirty = true;
    renderTracks();
    refreshStatus();
  });
  window.addEventListener("mouseup", () => {
    if (dragState) {
      dragState = null;
      renderProps();
    }
  });

  timelineScroll.addEventListener("click", (e) => {
    if (e.target === timelineInner || e.target === ruler || e.target === tracksHost) {
      const rect = timelineInner.getBoundingClientRect();
      const x = e.clientX - rect.left;
      seekPlayhead(pxToFrame(x));
      if (state.selectedClipIds.size || state.selectedClipId) {
        state.selectedClipIds = new Set();
        state.selectedClipId = null;
        renderTracks();
        renderProps();
      }
    }
  });
  ruler.addEventListener("click", (e) => {
    const rect = ruler.getBoundingClientRect();
    seekPlayhead(pxToFrame(e.clientX - rect.left));
  });

  function renderMediaBin() {
    clear(mediaBin);
    mediaBin.appendChild(
      panel([
        label("Media Bin"),
        el("input", {
          type: "file",
          multiple: "true",
          accept: "video/*,audio/*,image/*",
          style: { fontSize: "11px", marginBottom: "6px" },
          onchange: async (e: Event) => {
            const files = Array.from((e.target as HTMLInputElement).files || []);
            if (!files.length) return;
            await api.uploadMedia(state.project, files);
            await state.refreshMedia();
            renderMediaBin();
          },
        }),
        el(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "4px", maxHeight: "420px", overflowY: "auto" } },
          state.media.map((m) => {
            const item = el(
              "div",
              {
                draggable: "true",
                style: {
                  background: C.bg0,
                  border: `1px solid ${C.border}`,
                  borderRadius: "4px",
                  padding: "4px 6px",
                  fontSize: "11px",
                  color: C.text,
                  cursor: "grab",
                },
                text: `${m.kind === "audio" ? "🎵" : m.kind === "image" ? "🖼" : "🎬"} ${m.name || m.path.split(/[\\/]/).pop()}`,
              },
              []
            );
            item.addEventListener("dragstart", (e) => {
              e.dataTransfer?.setData("text/itda-media", m.path);
            });
            return item;
          })
        ),
      ])
    );
  }

  function renderProps() {
    clear(propsPanel);
    const found = state.selectedClipId ? state.findClip(state.selectedClipId) : null;
    if (!found) {
      propsPanel.appendChild(panel([label("Properties"), el("div", { text: "No clip selected.", style: { color: C.muted, fontSize: "12px" } })]));
      return;
    }
    const { clip } = found;
    propsPanel.appendChild(
      panel([
        label("Properties"),
        row([el("span", { text: "Track", style: { color: C.muted, fontSize: "11px" } }), el("span", { text: String(clip.track), style: { fontSize: "11px" } })]),
        row([el("span", { text: "Start", style: { color: C.muted, fontSize: "11px" } }), el("span", { text: String(clip.start), style: { fontSize: "11px" } })]),
        row([el("span", { text: "Duration", style: { color: C.muted, fontSize: "11px" } }), el("span", { text: String(clip.duration), style: { fontSize: "11px" } })]),
        mkBtn("First Frame", () => seekPlayhead(clip.start)),
        mkBtn("End Frame", () => seekPlayhead(clip.start + clip.duration)),
        mkBtn("Delete Clip", () => {
          state.removeClip(clip.id);
          state.selectedClipId = null;
          renderTracks();
          renderProps();
        }),
      ])
    );
  }

  function openRenderModal() {
    const overlay = el("div", {
      style: {
        position: "fixed", inset: "0", background: "rgba(0,0,0,0.6)", zIndex: "50",
        display: "flex", alignItems: "center", justifyContent: "center",
      },
      onclick: (e: MouseEvent) => { if (e.target === overlay) overlay.remove(); },
    });
    const box = panel(
      [
        label("Render"),
        el("div", { text: `Length: ${state.contentEnd()} frames (${(state.contentEnd() / state.fps).toFixed(1)}s) — auto-detected from last clip end.`, style: { fontSize: "11px", color: C.muted, marginBottom: "8px" } }),
        row([
          mkBtn("Video + Audio", () => doRender("video_audio", overlay)),
          mkBtn("Video Only", () => doRender("video_only", overlay)),
          mkBtn("Audio Only", () => doRender("audio_only", overlay)),
        ]),
      ],
      { width: "360px" }
    );
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  async function doRender(mode: "video_audio" | "video_only" | "audio_only", overlay: HTMLElement) {
    statusEl.textContent = "rendering…";
    try {
      const res = await state.render(mode);
      statusEl.textContent = res?.ok ? "render complete → gallery" : `render failed: ${res?.error || "unknown"}`;
    } catch (err: any) {
      statusEl.textContent = `render failed: ${err?.message || err}`;
    }
    overlay.remove();
  }

  function mkBtn(text: string, onclick: () => void, primary = false, title?: string) {
    return el("button", {
      text,
      onclick,
      ...(title ? { title } : {}),
      style: {
        background: primary ? BRAND : C.bg1,
        color: primary ? "#111" : C.text,
        border: `1px solid ${C.border}`,
        borderRadius: "5px",
        padding: "4px 10px",
        fontSize: "12px",
        cursor: "pointer",
      },
    });
  }

  // ── boot ──────────────────────────────────────────────────────────────
  (async () => {
    await api.initProject(state.project);
    await state.loadProject(state.project);
    await state.refreshMedia();
    renderRuler();
    renderTracks();
    renderMediaBin();
    renderProps();
    refreshStatus();
  })();
}

// Deferred: full gallery overlay (galleryOverlay.ts, ported from ui_gallery_itda.js /
// minimax_h3/galleryOverlay.ts pattern) + 4-tab video picker (ui_video_gallery_picker.js).
// This stub opens a minimal list so Render→Gallery is end-to-end verifiable now; see
// PORT_LEDGER.md "ITDA" section for the follow-up scope.
function openGalleryOverlay(_container: HTMLElement, _state: ItdaState) {
  const overlay = el("div", {
    style: { position: "fixed", inset: "0", background: "rgba(0,0,0,0.7)", zIndex: "50", display: "flex", alignItems: "center", justifyContent: "center" },
    onclick: (e: MouseEvent) => { if (e.target === overlay) overlay.remove(); },
  });
  const listHost = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px", maxHeight: "60vh", overflowY: "auto" } });
  const box = panel([label("ITDA Gallery (minimal — full picker deferred)"), listHost], { width: "480px" });
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  api.listGallery().then((res) => {
    clear(listHost);
    for (const item of res.items || []) {
      listHost.appendChild(
        el("div", {
          text: item.path.split(/[\\/]/).pop(),
          style: { fontSize: "12px", color: C.text, padding: "4px 6px", border: `1px solid ${C.border}`, borderRadius: "4px" },
        })
      );
    }
    if (!res.items?.length) listHost.appendChild(el("div", { text: "No renders yet.", style: { color: C.muted, fontSize: "12px" } }));
  });
}
