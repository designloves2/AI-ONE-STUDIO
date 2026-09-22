// view.ts — ITDA Studio toolbar + timeline + media bin + properties panel + render modal.
// Structural reference: web/itda_studio/dom_build.js (node pack). Built with this repo's own
// el()/panel()/row()/col() convention (src/shared/ui.ts), not literal DOM-string reuse.
import { el, panel, row, label, clear } from "../../shared/ui";
import { C, BRAND } from "../../identity";
import * as api from "./api";
import { ItdaState, type ItdaClip, type DragState } from "./core";
import { createItdaGalleryOverlay } from "./galleryOverlay";
import { openVideoGalleryPicker } from "./videoGalleryPicker";
import { openAudioGalleryPicker } from "../../shared/audioGalleryPicker";
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
      mkBtn("Gallery", () => galleryOv.show(), false),
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

  // ── real render gallery overlay (★ stitch mark, ⓘ info, ⬇ import, dblclick fullscreen) ──
  const galleryOv = createItdaGalleryOverlay(root, {
    getProject: () => state.project,
    onImported: async () => { await state.refreshMedia(); renderMediaBin(); },
    showStatus: (msg: string) => { statusEl.textContent = msg; },
  });

  // preview video — mirrors the node's #previewVideo: seeks to the frame under the
  // playhead as it's scrubbed, instead of only updating a transport readout.
  const previewVideo = el("video", {
    style: { width: "100%", maxHeight: "220px", background: "#000", borderRadius: "6px", display: "none" },
  }) as HTMLVideoElement;
  previewVideo.muted = true;
  previewVideo.playsInline = true;
  centerCol.appendChild(previewVideo);

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
    updatePreview();
  }

  // Port of itda_app_ported.js's seekElementToFrame: frame-accurate scrub, but with
  // only ONE seek in flight per element — a fast drag/scrub calls this on every single
  // mousemove, far more often than the browser's decode pipeline can complete a seek.
  // Firing video.currentTime= on each one queues a backlog of stale seeks that visibly
  // lag behind the playhead. While a seek is still resolving, just remember the latest
  // requested frame and jump straight there once 'seeked' fires.
  function seekElementToFrame(video: HTMLVideoElement, clip: ItdaClip, frame: number) {
    if (!video.src) return;
    const fps = clip.fps || state.fps;
    const local = Math.max(0, (frame - clip.start + (clip.source_in || 0)) / fps);
    if (!Number.isFinite(local)) return;
    const drift = Math.abs((video.currentTime || 0) - local);
    if (drift <= 0.08) return;
    const v = video as any;
    if (v._itdaSeeking) {
      v._itdaPendingFrame = frame;
      return;
    }
    v._itdaSeeking = true;
    let settled = false;
    let safety: number;
    const settle = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(safety);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onSeeked);
      v._itdaSeeking = false;
      const pending = v._itdaPendingFrame;
      v._itdaPendingFrame = null;
      if (pending != null && pending !== frame) seekElementToFrame(video, clip, pending);
    };
    const onSeeked = () => settle();
    safety = window.setTimeout(settle, 600);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onSeeked);
    try {
      video.currentTime = local;
    } catch {
      settle();
    }
  }

  function updatePreview() {
    const clip = state.clipAtFrame(state.playhead);
    if (!clip || clip.kind !== "video") {
      if (clip && clip.kind === "image") {
        // image clips have no seek/currentTime concept — just show a still frame slot
        previewVideo.style.display = "none";
      } else {
        previewVideo.style.display = "none";
        previewVideo.removeAttribute("src");
      }
      return;
    }
    const src = api.mediaFileUrl(clip.media_path, state.project);
    if (previewVideo.dataset.src !== src) {
      previewVideo.pause();
      previewVideo.removeAttribute("src");
      previewVideo.load();
      previewVideo.src = src;
      previewVideo.dataset.src = src;
    }
    previewVideo.style.display = "block";
    seekElementToFrame(previewVideo, clip, state.playhead);
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

    // waveform canvas for audio-bearing clips — sizing/opacity/bar-pitch match
    // the node's v0.2.8 waveform/trim/audio hotfix (itda_style.css .clip-bars /
    // .wf-canvas): track fills the clip edge-to-edge at clamp(30px,58%,58px)
    // height, canvas painted at .92 opacity, 1px bar + 1px gap pitch. A "stitched"
    // container has no media_path of its own to probe, so it's excluded.
    if (!isStitched && (clip.kind === "audio" || clip.kind === "video")) {
      const barsBox = el("div", {
        style: {
          position: "absolute",
          left: "0",
          right: "0",
          bottom: "0",
          height: "clamp(30px, 58%, 58px)",
          background: "rgba(0,0,0,.32)",
          borderRadius: "0 0 2px 2px",
          overflow: "hidden",
          pointerEvents: "none",
        },
      });
      const canvas = el("canvas", { style: { position: "absolute", left: "0", top: "0", display: "block" } }) as HTMLCanvasElement;
      barsBox.appendChild(canvas);
      clipEl.appendChild(barsBox);
      // deferred one frame so barsBox has real layout dimensions once it's
      // actually attached to the DOM (getBoundingClientRect is 0x0 before that)
      requestAnimationFrame(() => loadWaveform(clip, canvas, barsBox));
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
        startScrollLeft: timelineScroll.scrollLeft,
      };
    });

    return clipEl;
  }

  const waveformCache = new Map<string, number[]>();
  // Port of the node's drawClipWaveform (itda_app_ported.js v0.2.8 hotfix):
  // per-clip peak normalization (this clip's own loudest point in its
  // trimmed range fills the track height), 1px bar + 1px gap pitch snapped
  // to the pixel grid, dpr-aware canvas sizing, 2px min-height floor.
  async function loadWaveform(clip: ItdaClip, canvas: HTMLCanvasElement, barsBox: HTMLElement) {
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

    const rect = barsBox.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const peaks = finalPeaks;
    const sourceTotal = Math.max(1, peaks.length);
    const srcIn = Math.max(0, Math.min(sourceTotal - 1, Math.round(clip.source_in || 0)));
    const length = Math.max(1, Math.min(Math.round(clip.duration || 1), sourceTotal - srcIn));

    ctx.fillStyle = clip.kind === "audio" ? "rgba(205,255,235,.92)" : "rgba(238,222,255,.92)";
    const mid = cssH / 2;

    // peak-normalize over this clip's trimmed range only
    let maxPeak = 0;
    {
      const a0 = Math.max(0, Math.floor((srcIn / sourceTotal) * peaks.length));
      const b0 = Math.min(peaks.length, Math.ceil(((srcIn + length) / sourceTotal) * peaks.length));
      for (let j = a0; j < b0; j++) {
        const v = Math.abs(Number(peaks[j]) || 0);
        if (v > maxPeak) maxPeak = v;
      }
    }
    const norm = maxPeak > 0.005 ? 1 / maxPeak : 1;

    const nBars = Math.max(1, Math.min(Math.round(cssW / 2), peaks.length));
    const barW = 1;
    for (let i = 0; i < nBars; i++) {
      const frameA = srcIn + (i / nBars) * length;
      const frameB = srcIn + ((i + 1) / nBars) * length;
      const a = Math.max(0, Math.min(peaks.length - 1, Math.floor((frameA / sourceTotal) * peaks.length)));
      const b = Math.max(a + 1, Math.min(peaks.length, Math.ceil((frameB / sourceTotal) * peaks.length)));
      let peak = 0;
      for (let j = a; j < b; j++) {
        const v = Math.abs(Number(peaks[j]) || 0);
        if (v > peak) peak = v;
      }
      peak = Math.min(1, peak * norm);
      const h = Math.max(2, peak * mid * 2);
      const x = Math.round((i / nBars) * cssW);
      ctx.fillRect(x, mid - h / 2, barW, h);
    }
  }

  window.addEventListener("mousemove", (e) => {
    if (!dragState) return;
    const found = state.findClip(dragState.clipId);
    if (!found) return;
    const { clip } = found;

    // Autoscroll the timeline while dragging (move OR trim) near its left/right
    // edge — matches itda_app_ported.js onClipPointer exactly: 36px edge zone,
    // 22px step per mousemove, no rAF ticker (relies on the pointer continuing
    // to move while at the edge).
    {
      const rect = timelineScroll.getBoundingClientRect();
      const edge = 36;
      const step = 22;
      if (e.clientX > rect.right - edge) timelineScroll.scrollLeft += step;
      else if (e.clientX < rect.left + edge) timelineScroll.scrollLeft = Math.max(0, timelineScroll.scrollLeft - step);
    }
    // Fold the timeline's own scroll movement back into the drag delta — without
    // this, autoscrolling content under a stationary pointer would never let the
    // drag target move past whatever was reachable on-screen at drag-start.
    const scrollDelta = timelineScroll.scrollLeft - dragState.startScrollLeft;
    const rawDeltaFrames = Math.round((e.clientX - dragState.startX + scrollDelta) / state.zoomPxPerFrame);

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

  // Ruler scrub: mousedown-drag seeks continuously (not just on release), the video
  // preview keeping up via seekElementToFrame's single-seek-in-flight throttle above —
  // matches the node's scrub() (bind()) calling updatePlayhead on every mousemove.
  let scrubbing = false;
  ruler.addEventListener("mousedown", (e) => {
    scrubbing = true;
    const rect = ruler.getBoundingClientRect();
    seekPlayhead(pxToFrame(e.clientX - rect.left));
  });
  window.addEventListener("mousemove", (e) => {
    if (!scrubbing) return;
    const rect = ruler.getBoundingClientRect();
    seekPlayhead(pxToFrame(e.clientX - rect.left));
  });
  window.addEventListener("mouseup", () => {
    scrubbing = false;
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
        row(
          [
            mkBtn("🎞 Video (Gallery)", () => {
              openVideoGalleryPicker(state.project, async () => {
                await state.refreshMedia();
                renderMediaBin();
                statusEl.textContent = "Video added from gallery";
              });
            }),
            mkBtn("🎵 Audio (Gallery)", () => {
              openAudioGalleryPicker(async (inputFilename: string) => {
                try {
                  await api.importMediaFromGallery(state.project, inputFilename, "", "input");
                } catch (e: any) {
                  statusEl.textContent = `Audio import failed: ${e?.message || e}`;
                  return;
                }
                await state.refreshMedia();
                renderMediaBin();
                statusEl.textContent = "Audio added from gallery";
              }, "/minimax_h3_one");
            }),
          ],
          "4px"
        ),
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
    updatePreview();
  })();
}
