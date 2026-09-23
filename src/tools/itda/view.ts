// view.ts — ITDA Studio toolbar + timeline + media bin + properties panel + render modal.
// Visual reference: standalone ITDA (web/index.html/style.css) for Media Bin card-grid +
// transport bar detail; TJ_NODE_STUDIO_ONE port (itda_style.css/dom_build.js) for the purple
// header/toolbar chrome and sectioned Properties panel. Built with this repo's own
// el()/panel()/row()/col() convention (src/shared/ui.ts), not literal DOM-string reuse.
import { el, panel, row, label, clear } from "../../shared/ui";
import { C, BRAND } from "../../identity";
import * as api from "./api";
import { ItdaState, type ItdaClip, type DragState } from "./core";
import { createItdaGalleryOverlay } from "./galleryOverlay";
import { openVideoGalleryPicker } from "./videoGalleryPicker";
import { openAudioGalleryPicker } from "../../shared/audioGalleryPicker";
import { createItdaSettingsOverlay } from "./settings";

const RULER_HEIGHT = 30;

export function renderItda(container: HTMLElement) {
  const state = new ItdaState();
  let dragState: DragState | null = null;
  let dragEl: HTMLElement | null = null;
  const trackHidden = new Set<number>();
  const trackLocked = new Set<number>();

  const root = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", background: C.bg0, boxSizing: "border-box", overflow: "hidden", fontFamily: "inherit" } });
  container.appendChild(root);

  // ── App Settings (system-wide — Gallery Path + LLM backend/model) ────────
  const settingsOverlay = createItdaSettingsOverlay();
  root.appendChild(settingsOverlay.el);

  // ── header — purple gradient title strip with status dot, matching the node pack's
  // "ITDA ONE STUDIO (TJ)" header (itda_style.css .app-header) ─────────────────────────
  const statusDot = el("span", {
    style: { width: "7px", height: "7px", borderRadius: "50%", background: "#33e08a", boxShadow: "0 0 6px #33e08a", flexShrink: "0" },
  });
  const statusEl = el("span", { style: { color: "rgba(255,255,255,0.82)", fontSize: "11px" } });
  // editable project name — dom_build.js's `projectName` <input>, not a static label.
  // Committing a rename calls api.renameProject then re-boots under the new name.
  const projectNameInput = el("input", {
    type: "text",
    value: state.project,
    spellcheck: "false",
    style: {
      background: "transparent", color: "#fff", fontSize: "12px", fontWeight: "600",
      border: "1px solid transparent", borderRadius: "4px", padding: "3px 6px", width: "140px",
    },
    onfocus: (e: Event) => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.22)"; (e.target as HTMLInputElement).style.background = "#0d0e12"; },
    onblur: async (e: Event) => {
      const input = e.target as HTMLInputElement;
      input.style.borderColor = "transparent";
      input.style.background = "transparent";
      const next = input.value.trim();
      if (!next || next === state.project) { input.value = state.project; return; }
      try {
        await api.renameProject(state.project, next);
        await bootProject(next);
      } catch { input.value = state.project; }
    },
  }) as HTMLInputElement;

  // measured: target header bg is flat near-black (#111219), NOT a purple gradient —
  // probe.py on the reference (region 0,0,1217,40) reports BACKGROUND=#111219 at every
  // x sample (left/mid/right); purple is reserved for accent chips (Render pill, active tab).
  const header = el("div", {
    style: {
      flexShrink: "0",
      background: "#111219",
      padding: "8px 14px",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      borderBottom: `1px solid ${C.border}`,
    },
  });
  // Render mode — matches dom_build.js's header-level `renderMode` <select> (Video +
  // Audio / Video Only / Audio Only), placed left of the Render button. Decision (per
  // ITDA_GAPS item 4, read against itda_app_ported.js's render flow): the select IS
  // the mode picker now — the old 3-button modal is simplified to a length + Confirm
  // dialog that renders using whatever this header select is currently set to, so
  // there's exactly one place the mode lives, matching the node.
  const renderModeSelect = el("select", {
    title: "Render mode",
    style: { background: "#0d0e12", color: "#fff", border: "1px solid rgba(255,255,255,0.22)", borderRadius: "999px", padding: "4px 8px", fontSize: "11px", cursor: "pointer" },
  }, [
    el("option", { value: "video_audio", text: "Video + Audio" }),
    el("option", { value: "video_only", text: "Video Only" }),
    el("option", { value: "audio_only", text: "Audio Only" }),
  ]) as HTMLSelectElement;

  // ── ☰ Menu dropdown — dom_build.js's `itdaMenuDropdown`: Project Settings / App
  // Settings / Project… / Save, all folded under one menu button instead of 4 loose
  // top-level buttons (App Settings/Gallery/Save were previously separate always-visible
  // buttons — Gallery stays a top-level button per the reference's topbar, but the other
  // 3 move into the menu). ──────────────────────────────────────────────────────────
  const menuDropdown = el("div", {
    style: {
      display: "none", position: "absolute", top: "calc(100% + 4px)", left: "0",
      background: "#16171d", border: `1px solid ${C.border}`, borderRadius: "8px",
      minWidth: "170px", zIndex: "50", boxShadow: "0 8px 24px rgba(0,0,0,0.5)", overflow: "hidden",
    },
  });
  function menuItem(text: string, onclick: () => void) {
    return el("button", {
      type: "button", text, onclick: () => { menuDropdown.style.display = "none"; onclick(); },
      style: {
        display: "block", width: "100%", textAlign: "left", background: "transparent", color: C.text,
        border: "none", padding: "8px 12px", fontSize: "12px", cursor: "pointer",
      },
      onmouseenter: (e: Event) => { (e.target as HTMLElement).style.background = C.bg2; },
      onmouseleave: (e: Event) => { (e.target as HTMLElement).style.background = "transparent"; },
    });
  }
  menuDropdown.append(
    menuItem("⚙ Project Settings", () => projectSettingsOv.show()),
    menuItem("🖥 App Settings", () => settingsOverlay.show()),
    menuItem("📁 Project…", () => projectListOv.show()),
    menuItem("💾 Save", async () => { await state.save(); refreshStatus(); })
  );
  const menuWrap = el("div", { style: { position: "relative" } });
  const menuBtn = ghostBtn("☰ Menu", () => {
    menuDropdown.style.display = menuDropdown.style.display === "none" ? "block" : "none";
  });
  menuWrap.append(menuBtn, menuDropdown);
  document.addEventListener("click", (e) => {
    if (!menuWrap.contains(e.target as Node)) menuDropdown.style.display = "none";
  });

  const fullscreenBtn = ghostBtn("⛶", () => {
    if (!document.fullscreenElement) root.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  }, "Fullscreen");

  header.append(
    statusDot,
    el("span", { text: "ITDA ONE STUDIO", style: { color: "#fff", fontWeight: "800", fontSize: "15px", letterSpacing: "0.02em", marginRight: "4px" } }),
    menuWrap,
    projectNameInput,
    el("div", { style: { flex: "1" } }),
    statusEl,
    ghostBtn("🖼 Gallery", () => galleryOv.show()),
    renderModeSelect,
    pillBtn("▶ Render", () => openRenderModal()),
    fullscreenBtn
  );
  root.appendChild(header);

  // ── ⚙ Project Settings — per-project FPS/Total Frames (dom_build.js's
  // "⚙ Project Settings" menu item; distinct from the system-wide App Settings). ──────
  const fpsInput = el("input", { type: "number", min: "1", step: "0.001", style: inputStyle() }) as HTMLInputElement;
  const totalFramesInput = el("input", { type: "number", min: "1", step: "1", style: inputStyle() }) as HTMLInputElement;
  const projectSettingsOv = smallModal("⚙ Project Settings", [
    fieldRow("FPS", fpsInput),
    fieldRow("Total Frames", totalFramesInput),
  ], async () => {
    const fps = Number(fpsInput.value) || state.fps;
    const total = Math.max(1, Math.round(Number(totalFramesInput.value) || state.totalFrames));
    state.fps = fps;
    state.totalFrames = total;
    state.dirty = true;
    await state.save();
    renderRuler(); renderTracks(); refreshStatus();
  }, () => { fpsInput.value = String(state.fps); totalFramesInput.value = String(state.totalFrames); });

  // ── 📁 Project… — list/open/new, wired to the real project CRUD routes in api.ts
  // (initProject/getProject/listProjects/newProject already existed server-side but had
  // no UI at all before this — state.project was permanently stuck at its default). ────
  const projectListBody = el("div", { style: { display: "flex", flexDirection: "column", gap: "4px", maxHeight: "260px", overflowY: "auto" } });
  const newProjectNameInput = el("input", { type: "text", placeholder: "new-project-name", style: inputStyle() }) as HTMLInputElement;
  const projectListOv = smallModal("📁 Project", [
    el("div", { style: { display: "flex", gap: "6px" } }, [
      newProjectNameInput,
      el("button", {
        type: "button", text: "+ New", style: pillStyle(),
        onclick: async () => {
          const name = newProjectNameInput.value.trim();
          if (!name) return;
          try { await api.newProject(name); await bootProject(name); projectListOv.hide(); } catch {}
        },
      }),
    ]),
    projectListBody,
  ], null, async () => {
    projectListBody.innerHTML = "";
    try {
      const res = await api.listProjects();
      for (const item of res.items || []) {
        projectListBody.appendChild(el("button", {
          type: "button", text: item.name === state.project ? `● ${item.name}` : item.name,
          style: { display: "block", width: "100%", textAlign: "left", background: item.name === state.project ? "#2a1f45" : "transparent", color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px 8px", fontSize: "12px", cursor: "pointer", marginBottom: "2px" },
          onclick: async () => { await bootProject(item.name); projectListOv.hide(); },
        }));
      }
    } catch {}
  });

  // ── action toolbar — icon buttons, compact, matching the node's action-row density ──
  // Order below mirrors dom_build.js's `actionRow` build EXACTLY — no button here that
  // isn't in that file. "Add Video Track"/"Add Audio Track" were removed: dom_build.js
  // has no such buttons at all (grepped, zero matches) — the reference uses a fixed
  // LANE_COUNT=3, kind-agnostic lane model with no user-facing "add a track" action.
  // That was a fabricated feature from an earlier pass, not a real mirror of the source.
  const actionToolbar = row(
    [
      mkIconBtn("⏮", () => { state.markIn(); refreshStatus(); statusEl.textContent = `Mark In · F${state.playhead}`; }, "Mark In (I)"),
      mkIconBtn("⏭", () => { state.markOut(); refreshStatus(); statusEl.textContent = `Mark Out · F${state.playhead}`; }, "Mark Out (O)"),
      mkIconBtn("⊘", () => { state.clearRange(); refreshStatus(); statusEl.textContent = "Range cleared"; }, "Clear Range"),
      sep(),
      snapPill(),
      peakMatchPill(),
      sep(),
      mkIconBtn("✂", () => {
        if (state.splitSelectedAtPlayhead()) { renderTracks(); renderProps(); refreshStatus(); statusEl.textContent = "Split"; }
      }, "Split — cut the selected clip at the playhead"),
      mkIconBtn("🧵", () => {
        const c = state.stitchSelected();
        renderTracks(); renderProps(); refreshStatus();
        statusEl.textContent = c ? "Stitched as layer container" : "Select 2+ clips (ctrl/shift-click) to Stitch";
      }, "Stitch — combine 2+ selected clips into one layer container"),
      mkIconBtn("🪢", () => {
        const ok = state.unstitchSelected();
        renderTracks(); renderProps(); refreshStatus();
        statusEl.textContent = ok ? "UnStitched" : "Select a Stitched clip to UnStitch";
      }, "UnStitch — restore a stitched clip's originals"),
      // ── disabled on the node itself (itda_app_ported.js's autoStitchClip /
      // addTransition / aiDetect buttons ship `disabled=""` in dom_build.js) — kept
      // visually present here, non-interactive, to match that dormant state.
      mkIconBtn("🪄", () => {}, "Auto Stitch — select 2 video clips (in time order) to analyze the best overlap cut point"),
      mkIconBtn("🎞", () => {}, "Transition — select 2 adjacent video clips to insert a transition at the join"),
      mkIconBtn("✨", () => {}, "AI Detect — Scene / Beat detection for the selected clip"),
      sep(),
      mkIconBtn("🔗", () => {
        const ok = state.groupSelected();
        renderProps(); refreshStatus();
        statusEl.textContent = ok ? "Grouped" : "Select 2+ clips (ctrl/shift-click) to Group";
      }, "Group"),
      mkIconBtn("⛓️‍💥", () => {
        const ok = state.ungroupSelected();
        renderProps(); refreshStatus();
        statusEl.textContent = ok ? "Ungrouped" : "Select a grouped clip to Ungroup";
      }, "Ungroup"),
      mkIconBtn("🔈⊘", () => {
        const c = state.detachAudio();
        renderTracks(); renderProps(); refreshStatus();
        statusEl.textContent = c ? "Audio detached" : "Select a video clip to Detach Audio";
      }, "Detach Audio"),
      mkIconBtn("🔈+", () => {
        const ok = state.mergeAudioBack();
        renderTracks(); renderProps(); refreshStatus();
        statusEl.textContent = ok ? "Audio merged back" : "Select a clip with detached audio to Merge Audio";
      }, "Merge Audio"),
      mkIconBtn("⏩", async () => {
        const start = state.range.start ?? 0;
        const end = state.range.end ?? state.contentEnd();
        statusEl.textContent = "Pre-rendering…";
        try {
          const res = await api.prerenderRange(state.project, start, end);
          statusEl.textContent = (res as any)?.ok ? "Pre-render complete" : `Pre-render failed: ${(res as any)?.error || "unknown"}`;
        } catch (err: any) {
          statusEl.textContent = `Pre-render failed: ${err?.message || err}`;
        }
      }, "Pre-render"),
      mkIconBtn("🗑", () => {
        if (!state.selectedClipId) return;
        state.removeClip(state.selectedClipId);
        state.selectedClipId = null;
        renderTracks(); renderProps();
      }, "Clip Delete"),
      sep(),
      mkIconBtn("⇤", () => seekPlayhead(0), "Go to First Frame"),
      mkIconBtn("⇥", () => seekPlayhead(state.contentEnd()), "Go to End Frame"),
      el("div", { style: { flex: "1" } }),
      el("span", { text: "↔", title: "Horizontal Zoom", style: { color: C.muted, fontSize: "11px" } }),
      hZoomSlider(),
      el("span", { text: "↕", title: "Vertical Track Zoom", style: { color: C.muted, fontSize: "11px" } }),
      vZoomSlider(),
    ],
    "5px"
  );
  actionToolbar.style.cssText += `align-items:center;flex-wrap:wrap;flex-shrink:0;padding:6px 12px;background:${C.bg1};border-bottom:1px solid ${C.border};`;
  // NOTE: appended to timelinePanel below, not root — dom_build.js's actionRow lives
  // in the `lowerPane` directly above the timeline, not under the header (fixed per
  // user report: it was incorrectly sitting above Media Bin/Preview/Properties).

  const mainBody = el("div", { style: { flex: "1", minHeight: "0", display: "flex", flexDirection: "column", padding: "8px", gap: "0", boxSizing: "border-box" } });
  root.appendChild(mainBody);

  // ── upper pane: media bin | preview | properties — 26%/49%/25% ──────────────────────
  const UPPER_H_KEY = "aos_itda_upperH_v1";
  const upperPane = el("div", {
    style: { display: "grid", gridTemplateColumns: "27% 48% 25%", gap: "8px", minHeight: "250px", flexShrink: "0", marginBottom: "8px" },
  });
  mainBody.appendChild(upperPane);

  const mediaBin = el("div", { style: { minWidth: "0", overflow: "hidden", display: "flex", flexDirection: "column", background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "8px" } });
  upperPane.appendChild(mediaBin);

  // ── preview panel ─────────────────────────────────────────────────────────────────
  const previewPanel = el("div", {
    style: { display: "flex", flexDirection: "column", minWidth: "0", background: C.bg0, border: `1px solid ${C.border}`, borderRadius: "8px", overflow: "hidden" },
  });
  upperPane.appendChild(previewPanel);

  let activeMode = "Single";
  const modeTabs: Record<string, HTMLButtonElement> = {};
  function mkModeTab(name: string, enabled: boolean) {
    const btn = el("button", {
      text: name,
      disabled: enabled ? undefined : "true",
      style: {
        background: name === activeMode ? BRAND : "transparent",
        color: name === activeMode ? "#fff" : enabled ? C.text : C.muted,
        border: `1px solid ${name === activeMode ? BRAND : C.border}`,
        borderRadius: "999px",
        padding: "3px 11px",
        fontSize: "10px",
        fontWeight: "700",
        cursor: enabled ? "pointer" : "default",
        opacity: enabled ? "1" : "0.45",
      },
      onclick: enabled ? () => { activeMode = name; refreshModeTabs(); } : undefined,
    }) as HTMLButtonElement;
    modeTabs[name] = btn;
    return btn;
  }
  function refreshModeTabs() {
    for (const k of Object.keys(modeTabs)) {
      const b = modeTabs[k];
      b.style.background = k === activeMode ? BRAND : "transparent";
      b.style.color = k === activeMode ? "#fff" : b.disabled ? C.muted : C.text;
      b.style.borderColor = k === activeMode ? BRAND : C.border;
    }
  }
  // Snapshot lives HERE (preview panel's own toolbar, next to fullscreen) per
  // dom_build.js's `snapshotTop` — NOT in the timeline action row.
  async function takeSnapshot() {
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
  }
  const previewToolbar = row(
    [
      mkModeTab("Single", true),
      mkModeTab("Compare", false),
      mkModeTab("Overlay", false),
      mkModeTab("Wipe", false),
      el("div", { style: { flex: "1" } }),
      mkIconBtn("▣", () => takeSnapshot(), "Snapshot"),
      mkIconBtn("⛶", () => { previewStage.requestFullscreen?.(); }, "Full Screen"),
    ],
    "6px"
  );
  previewToolbar.style.cssText += `height:36px;align-items:center;padding:0 10px;background:${C.bg1};border-bottom:1px solid ${C.border};box-sizing:border-box;flex-shrink:0;`;
  previewPanel.appendChild(previewToolbar);

  const previewStage = el("div", {
    style: { position: "relative", flex: "1", minHeight: "0", background: "#000", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  });
  previewPanel.appendChild(previewStage);

  const previewPlaceholder = el("div", {
    text: "Preview",
    style: { color: "#464c56", fontWeight: "850", fontSize: "24px", letterSpacing: "0.06em", pointerEvents: "none" },
  });
  previewStage.appendChild(previewPlaceholder);

  const previewVideo = el("video", {
    style: { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain", background: "#000", display: "none" },
  }) as HTMLVideoElement;
  previewVideo.muted = true;
  previewVideo.playsInline = true;
  previewStage.appendChild(previewVideo);

  const previewImage = el("img", {
    style: { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain", background: "#000", display: "none" },
    alt: "",
  }) as HTMLImageElement;
  previewStage.appendChild(previewImage);

  // ── transport — 7-icon row + Loop/Mute/Scrub pills + Vol slider + readout row ───────
  let loopOn = false, muteOn = true, scrubOn = true, vol = 100;
  const playheadInfo = el("span", { style: { color: C.text, fontSize: "11px", fontWeight: "700", fontVariantNumeric: "tabular-nums" } });
  const transport = el("div", {
    style: { flexShrink: "0", background: C.bg1, borderTop: `1px solid ${C.border}`, padding: "6px 10px 8px", display: "flex", flexDirection: "column", gap: "5px" },
  });

  const volSlider = el("input", { type: "range", min: "0", max: "100", value: "100", style: { width: "64px", accentColor: BRAND } }) as HTMLInputElement;
  const volLabel = el("span", { text: "100%", style: { color: C.muted, fontSize: "10px", width: "30px" } });
  volSlider.addEventListener("input", () => { vol = Number(volSlider.value); volLabel.textContent = `${vol}%`; previewVideo.volume = vol / 100; });

  const loopPill = togglePill("Loop", loopOn, (v) => { loopOn = v; });
  const mutePill = togglePill("Mute", muteOn, (v) => { muteOn = v; previewVideo.muted = v; });
  const scrubPill = togglePill("Scrub", scrubOn, (v) => { scrubOn = v; });

  // ── transport semantics — matches itda_app_ported.js's real handlers, not the
  // earlier (wrong) timeline-relative/second-based guesses:
  // ◀| / |▶ = SELECTED CLIP's own start/end (gotoSelectedStart/End), not the
  // timeline's — the timeline-level ⇤/⇥ jump lives in the action row instead.
  // ◀◀/▶▶ step ±5 frames (data-step="-5"/"5" in dom_build.js), not ±1s.
  // ▶ (main-play) toggles Play/Pause; the lone ▶ after it steps +1 frame.
  function selectedClipRange(): { start: number; end: number } | null {
    if (!state.selectedClipId) return null;
    const found = state.findClip(state.selectedClipId);
    if (!found) return null;
    return { start: found.clip.start, end: found.clip.start + found.clip.duration };
  }
  function gotoSelectedStart() {
    const r = selectedClipRange();
    seekPlayhead(r ? r.start : 0);
  }
  function gotoSelectedEnd() {
    const r = selectedClipRange();
    seekPlayhead(r ? r.end : state.contentEnd());
  }
  let playing = false;
  let playRAF = 0;
  let playStartFrame = 0;
  let playStartedAt = 0;
  const mainPlayBtn = mkIconBtn("▶", () => togglePlay(), "Play / Pause");
  function stopPlay() {
    playing = false;
    mainPlayBtn.textContent = "▶";
    if (playRAF) cancelAnimationFrame(playRAF);
    previewVideo.pause();
  }
  function loopPlayStep() {
    if (!playing) return;
    const elapsed = (performance.now() - playStartedAt) / 1000;
    let f = Math.round(playStartFrame + elapsed * state.fps);
    const end = state.contentEnd();
    if (f >= end) {
      if (loopOn) {
        playStartFrame = 0;
        playStartedAt = performance.now();
        f = 0;
      } else {
        seekPlayhead(end);
        stopPlay();
        return;
      }
    }
    seekPlayhead(f);
    playRAF = requestAnimationFrame(loopPlayStep);
  }
  function startPlay() {
    playing = true;
    playStartFrame = state.playhead;
    playStartedAt = performance.now();
    mainPlayBtn.textContent = "❚❚";
    previewVideo.play?.().catch(() => {});
    loopPlayStep();
  }
  function togglePlay() {
    if (playing) stopPlay();
    else startPlay();
  }
  const transportButtons = row(
    [
      mkIconBtn("◀|", () => gotoSelectedStart(), "Selected Clip Start"),
      mkIconBtn("◀◀", () => seekPlayhead(state.playhead - 5), "Step Back 5 Frames"),
      mkIconBtn("◀", () => seekPlayhead(state.playhead - 1), "Step Back 1 Frame"),
      mainPlayBtn,
      mkIconBtn("▶", () => seekPlayhead(state.playhead + 1), "Step Forward 1 Frame"),
      mkIconBtn("▶▶", () => seekPlayhead(state.playhead + 5), "Step Forward 5 Frames"),
      mkIconBtn("|▶", () => gotoSelectedEnd(), "Selected Clip End"),
      sep(),
      loopPill, mutePill, scrubPill,
      sep(),
      el("span", { text: "Vol", style: { color: C.muted, fontSize: "10px" } }),
      volSlider,
      volLabel,
    ],
    "4px"
  );
  transportButtons.style.justifyContent = "center";
  transportButtons.style.flexWrap = "wrap";
  const transportReadout = el("div", { style: { display: "flex", justifyContent: "center" } }, [playheadInfo]);
  transport.append(transportButtons, transportReadout);
  previewPanel.appendChild(transport);

  // ── properties panel ─────────────────────────────────────────────────────────────
  const propsPanel = el("div", {
    style: { minWidth: "0", overflowY: "auto", background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "8px" },
  });
  upperPane.appendChild(propsPanel);

  const galleryOv = createItdaGalleryOverlay(root, {
    getProject: () => state.project,
    onImported: async () => { await state.refreshMedia(); renderMediaBin(); },
    showStatus: (msg: string) => { statusEl.textContent = msg; },
  });

  // ── resize handle between upper pane and the timeline — matches dom_build.js's
  // "resizeHandle"/.resize-handle (5px bar, row-resize cursor) + itda_app_ported.js's
  // drag logic: a DELTA from the drag's own start Y/height, not an absolute
  // page-position formula — the node's own comment explains why that distinction
  // matters ("조절하려고 하면 그자리에서 조절되는게 아니고 다시 시작점으로 돌아가서
  // 조절됨" — an absolute formula snaps the pane back to a start-position-derived
  // height instead of continuing smoothly from wherever it already is). ──────────────
  const resizeHandle = el("div", {
    style: { height: "5px", flexShrink: "0", background: "#0b0c0e", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, cursor: "row-resize" },
  });
  mainBody.appendChild(resizeHandle);

  // ── lower pane: timeline ─────────────────────────────────────────────────────────
  const timelinePanel = el("div", { style: { flex: "1", minHeight: "0", display: "flex", flexDirection: "column", background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "8px", overflow: "hidden" } });
  mainBody.appendChild(timelinePanel);
  timelinePanel.appendChild(actionToolbar);

  {
    let resizing = false;
    let dragStartY = 0;
    let dragStartUpperH = 0;
    const applyUpperH = (h: number) => {
      const clamped = Math.max(250, Math.min(mainBody.clientHeight - 210, h));
      upperPane.style.height = `${clamped}px`;
    };
    resizeHandle.addEventListener("mousedown", (e) => {
      resizing = true;
      dragStartY = e.clientY;
      dragStartUpperH = upperPane.offsetHeight;
    });
    window.addEventListener("mousemove", (e) => {
      if (!resizing) return;
      applyUpperH(dragStartUpperH + (e.clientY - dragStartY));
    });
    window.addEventListener("mouseup", () => {
      if (!resizing) return;
      resizing = false;
      try { localStorage.setItem(UPPER_H_KEY, String(parseInt(upperPane.style.height, 10) || "")); } catch {}
    });
    try {
      const saved = Number(localStorage.getItem(UPPER_H_KEY));
      if (saved) applyUpperH(saved);
      else upperPane.style.height = "56%";
    } catch { upperPane.style.height = "56%"; }
  }

  const timelineScroll = el("div", { style: { flex: "1", minHeight: "0", overflow: "auto", background: C.bg0, position: "relative" } });
  timelinePanel.appendChild(timelineScroll);

  const timelineInner = el("div", { style: { position: "relative" } });
  timelineScroll.appendChild(timelineInner);

  // marginLeft:34px matches the per-track T1/T2/T3 label gutter (renderTracks' trackEl)
  // — without it the "0s" tick sat over the label column instead of above the actual
  // frame-0 clip position, misaligning every tick with the tracks below it.
  const ruler = el("div", { style: { height: `${RULER_HEIGHT}px`, position: "relative", borderBottom: `1px solid ${C.border}`, background: C.bg1, marginLeft: "34px" } });
  timelineInner.appendChild(ruler);

  const tracksHost = el("div", { style: { position: "relative" } });
  timelineInner.appendChild(tracksHost);

  const playheadLine = el("div", {
    style: { position: "absolute", top: "0", bottom: "0", width: "1px", background: BRAND, zIndex: "5", pointerEvents: "none", boxShadow: `0 0 4px ${BRAND}` },
  });
  timelineInner.appendChild(playheadLine);

  // ── status bar — bottom strip matching image 3's "Project FPS · Snap · Total" bar ──
  const statusBar = el("div", {
    style: { flexShrink: "0", height: "24px", display: "flex", alignItems: "center", gap: "14px", padding: "0 12px", background: "#0d0e12", borderTop: `1px solid ${C.border}`, fontSize: "10px", color: C.muted, fontVariantNumeric: "tabular-nums" },
  });
  timelinePanel.appendChild(statusBar);

  function frameToPx(f: number) {
    return f * state.zoomPxPerFrame;
  }
  function pxToFrame(px: number) {
    return Math.max(0, Math.round(px / state.zoomPxPerFrame));
  }

  function fmtTime(frame: number) {
    const secs = frame / state.fps;
    const mm = String(Math.floor(secs / 60)).padStart(2, "0");
    const ss = (secs % 60).toFixed(3).padStart(6, "0");
    return `${mm}:${ss}`;
  }

  function refreshStatus() {
    if (document.activeElement !== projectNameInput) projectNameInput.value = state.project;
    statusDot.style.background = state.dirty ? "#ffb347" : "#33e08a";
    statusDot.style.boxShadow = state.dirty ? "0 0 6px #ffb347" : "0 0 6px #33e08a";
    if (statusEl.dataset.override !== "1") statusEl.textContent = state.dirty ? "unsaved changes" : "saved";
    playheadInfo.textContent = `Frame ${state.playhead}  ·  ${fmtTime(state.playhead)}  ·  FPS ${state.fps.toFixed(3)}  ·  Total ${state.totalFrames}f`;
    statusBar.textContent = "";
    statusBar.append(
      el("span", { text: `Project FPS: ${state.fps.toFixed(3)}` }),
      el("span", { text: "·" }),
      el("span", { text: `Snap: ${state.snap ? "ON" : "OFF"}`, style: { color: state.snap ? "#33e08a" : C.muted } }),
      el("span", { text: "·" }),
      el("span", { text: `Total: ${state.contentEnd()}f / ${fmtTime(state.contentEnd())}` }),
      el("span", { text: "·" }),
      el("span", { text: `Loaded ${state.project}` }),
      el("div", { style: { flex: "1" } }),
      el("span", { text: state.dirty ? "● unsaved" : "✓ saved", style: { color: state.dirty ? "#ffb347" : "#33e08a" } })
    );
  }
  function seekPlayhead(f: number) {
    state.playhead = Math.max(0, Math.min(state.totalFrames, f));
    playheadLine.style.left = `${frameToPx(state.playhead) + 34}px`;
    refreshStatus();
    updatePreview();
  }

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
    if (!clip || clip.kind === "audio" || clip.kind === "stitched") {
      previewVideo.style.display = "none";
      previewVideo.removeAttribute("src");
      previewVideo.dataset.src = "";
      previewImage.style.display = "none";
      previewImage.removeAttribute("src");
      previewPlaceholder.style.display = "block";
      return;
    }
    previewPlaceholder.style.display = "none";
    if (clip.kind === "image") {
      previewVideo.style.display = "none";
      previewVideo.pause();
      previewVideo.removeAttribute("src");
      previewVideo.dataset.src = "";
      const src = api.mediaFileUrl(clip.media_path, state.project);
      if (previewImage.dataset.src !== src) {
        previewImage.src = src;
        previewImage.dataset.src = src;
      }
      previewImage.style.display = "block";
      return;
    }
    previewImage.style.display = "none";
    previewImage.removeAttribute("src");
    const src = api.mediaFileUrl(clip.media_path, state.project);
    if (previewVideo.dataset.src !== src) {
      previewVideo.pause();
      previewVideo.removeAttribute("src");
      previewVideo.load();
      previewVideo.src = src;
      previewVideo.dataset.src = src;
      previewVideo.muted = true; // always muted at source-load time; Mute pill only affects intent
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
      const major = (f / stepFrames) % 5 === 0;
      const tick = el("div", {
        style: { position: "absolute", left: `${frameToPx(f)}px`, top: major ? "14px" : "20px", bottom: "0", width: "1px", background: major ? C.borderH : C.border },
      });
      ruler.appendChild(tick);
      if (major) {
        ruler.appendChild(
          el("div", {
            text: `${Math.round(f / state.fps)}s`,
            style: { position: "absolute", left: `${frameToPx(f) + 3}px`, top: "1px", fontSize: "9px", fontWeight: "700", color: C.text },
          })
        );
        ruler.appendChild(
          el("div", {
            text: `${f}f`,
            style: { position: "absolute", left: `${frameToPx(f) + 3}px`, top: "13px", fontSize: "8px", color: C.muted },
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
      const hidden = trackHidden.has(ti);
      const locked = trackLocked.has(ti);
      const trackEl = el("div", {
        style: {
          position: "relative",
          height: `${state.trackHeight}px`,
          borderBottom: `1px solid ${C.border}`,
          background: track.kind === "audio" ? "rgba(100,180,255,0.05)" : "rgba(255,255,255,0.015)",
          opacity: hidden ? "0.45" : "1",
          marginLeft: "34px",
        },
      });
      trackEl.dataset.trackIndex = String(ti);
      if (!locked) {
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
      }

      track.clips.forEach((clip) => trackEl.appendChild(renderClipEl(clip, locked)));

      // per-track 👁/🔒 icon pair, pinned to the left edge (absolutely positioned so
      // it doesn't scroll with the horizontally-scrolling clip content)
      const headBtn = (icon: string, active: boolean, title: string, onclick: () => void) =>
        el("button", {
          text: icon,
          title,
          onclick,
          style: {
            width: "15px", height: "15px", lineHeight: "13px", padding: "0", fontSize: "9px",
            background: active ? "#2a1f45" : "transparent", color: active ? BRAND : C.muted,
            border: "none", borderRadius: "3px", cursor: "pointer",
          },
        });
      const head = el("div", {
        style: {
          position: "absolute", left: "-34px", top: "0", width: "30px", height: `${state.trackHeight}px`,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "3px",
          background: C.bg1, borderRight: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
        },
      });
      head.append(
        el("span", { text: `T${ti + 1}`, style: { color: C.text, fontSize: "10px", fontWeight: "700", marginBottom: "2px" } }),
        headBtn("👁", !hidden, hidden ? "Hidden — click to show" : "Visible — click to hide", () => {
          if (trackHidden.has(ti)) trackHidden.delete(ti); else trackHidden.add(ti);
          renderTracks();
        }),
        headBtn("🔒", locked, locked ? "Locked — click to unlock" : "Unlocked — click to lock", () => {
          if (trackLocked.has(ti)) trackLocked.delete(ti); else trackLocked.add(ti);
          renderTracks();
        })
      );
      trackEl.appendChild(head);
      tracksHost.appendChild(trackEl);
    });
    tracksHost.style.height = `${state.tracks.length * state.trackHeight}px`;
    // NOTE: no marginLeft here — each trackEl already carries its own 34px marginLeft
    // (for its T1/T2/T3 label gutter, at left:-34px relative to itself); adding it
    // AGAIN at the tracksHost level double-applied the offset, pushing the whole
    // track area (and its labels) an extra 34px right and leaving a blank strip
    // between the timeline's scroll edge and the T1 label — exactly what was reported.
    timelineInner.style.width = `${width + 34}px`;
    playheadLine.style.left = `${frameToPx(state.playhead) + 34}px`;
  }

  function renderClipEl(clip: ItdaClip, trackLockedFlag: boolean) {
    const w = Math.max(4, frameToPx(clip.duration));
    const isSel = state.selectedClipIds.has(clip.id) || state.selectedClipId === clip.id;
    const isStitched = clip.kind === "stitched";
    const clipEl = el(
      "div",
      {
        style: {
          position: "absolute",
          left: `${frameToPx(clip.start)}px`,
          top: "3px",
          bottom: "3px",
          width: `${w}px`,
          background: isSel ? BRAND : isStitched ? "#7a4f1e" : clip.kind === "audio" ? "#245a3d" : "#2c3f63",
          border: `1px solid ${isSel ? "#fff" : isStitched ? "#c8842e" : C.border}`,
          borderRadius: "4px",
          overflow: "hidden",
          cursor: trackLockedFlag ? "not-allowed" : "grab",
          fontSize: "10px",
          color: "#fff",
          boxSizing: "border-box",
          userSelect: "none",
          boxShadow: isSel ? `0 0 0 1px ${BRAND}` : "none",
        },
      },
      []
    );
    clipEl.dataset.clipId = clip.id;

    const chip = el("div", {
      text: (isStitched ? "🧵 " : clip.kind === "audio" ? "🎵 " : clip.kind === "image" ? "🖼 " : "🎬 ") + (clip.label || clip.media_path.split(/[\\/]/).pop() || ""),
      style: { padding: "2px 5px", fontWeight: "700", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", background: "rgba(0,0,0,0.28)" },
    });
    clipEl.appendChild(chip);
    if (!isStitched) {
      clipEl.appendChild(el("div", {
        text: `${clip.duration}f · in${clip.source_in || 0}`,
        style: { padding: "0 5px", fontSize: "8px", color: "rgba(255,255,255,0.65)" },
      }));
    }

    if (!isStitched && (clip.kind === "audio" || clip.kind === "video")) {
      const barsBox = el("div", {
        style: {
          position: "absolute",
          left: "0",
          right: "0",
          bottom: "0",
          height: "clamp(30px, 58%, 58px)",
          background: "rgba(0,0,0,.32)",
          borderRadius: "0 0 3px 3px",
          overflow: "hidden",
          pointerEvents: "none",
        },
      });
      const canvas = el("canvas", { style: { position: "absolute", left: "0", top: "0", display: "block" } }) as HTMLCanvasElement;
      barsBox.appendChild(canvas);
      clipEl.appendChild(barsBox);
      requestAnimationFrame(() => loadWaveform(clip, canvas, barsBox));
    }

    const leftHandle = el("div", { style: { position: "absolute", left: "0", top: "0", bottom: "0", width: "6px", cursor: "ew-resize" } });
    const rightHandle = el("div", { style: { position: "absolute", right: "0", top: "0", bottom: "0", width: "6px", cursor: "ew-resize" } });
    clipEl.appendChild(leftHandle);
    clipEl.appendChild(rightHandle);

    clipEl.addEventListener("mousedown", (e) => {
      e.stopPropagation();
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
      if (trackLockedFlag) return;
      const target = e.target as HTMLElement;
      const mode: DragState["mode"] = target === leftHandle ? "trim-left" : target === rightHandle ? "trim-right" : "move";
      // renderTracks() above just replaced every clip <div> with a fresh one (same
      // pattern that broke the thumbnail slider) — re-find THIS clip's new element so
      // the drag can move it directly frame-by-frame without a full rebuild.
      dragEl = tracksHost.querySelector<HTMLElement>(`[data-clip-id="${CSS.escape(clip.id)}"]`);
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

    {
      const rect = timelineScroll.getBoundingClientRect();
      const edge = 36;
      const step = 22;
      if (e.clientX > rect.right - edge) timelineScroll.scrollLeft += step;
      else if (e.clientX < rect.left + edge) timelineScroll.scrollLeft = Math.max(0, timelineScroll.scrollLeft - step);
    }
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
    // Move the dragged element directly instead of calling renderTracks() on every
    // single mousemove tick — a full rebuild (new DOM nodes, re-attached listeners,
    // re-queued waveform loads) on every pixel of movement is what made dragging feel
    // broken/unresponsive (same root cause as the thumbnail-slider bug fixed earlier).
    // The full renderTracks() still runs once on mouseup to settle everything
    // (waveform repaint, track-height/lock state, etc.) consistently.
    if (dragEl) {
      dragEl.style.left = `${frameToPx(clip.start)}px`;
      dragEl.style.width = `${Math.max(4, frameToPx(clip.duration))}px`;
    }
    refreshStatus();
  });
  window.addEventListener("mouseup", () => {
    if (dragState) {
      dragState = null;
      dragEl = null;
      renderTracks();
      renderProps();
    }
  });

  timelineScroll.addEventListener("click", (e) => {
    if (e.target === timelineInner || e.target === ruler || e.target === tracksHost) {
      const rect = timelineInner.getBoundingClientRect();
      const x = e.clientX - rect.left - 34;
      seekPlayhead(pxToFrame(x));
      if (state.selectedClipIds.size || state.selectedClipId) {
        state.selectedClipIds = new Set();
        state.selectedClipId = null;
        renderTracks();
        renderProps();
      }
    }
  });

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

  // ── Media Bin — 2-up thumbnail card grid ────────────────────────────────────────
  let mediaViewMode: "grid" | "list" = "grid";
  let thumbSize = 96;
  let mediaGridEl: HTMLElement | null = null;

  function mediaKindIcon(kind?: string) {
    return kind === "audio" ? "🎵" : kind === "image" ? "🖼" : "🎬";
  }

  function renderMediaBin() {
    clear(mediaBin);

    const binHeader = el("div", {
      style: { padding: "8px 10px 6px", borderBottom: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: "6px", flexShrink: "0" },
    });
    binHeader.append(
      row([
        el("span", { text: "Media Bin", style: { fontWeight: "850", fontSize: "12px", color: C.text } }),
        el("div", { style: { flex: "1" } }),
        el("button", {
          text: mediaViewMode === "grid" ? "▦" : "▦",
          title: "Grid view",
          onclick: () => { mediaViewMode = "grid"; renderMediaBin(); },
          style: { background: mediaViewMode === "grid" ? BRAND : "transparent", color: mediaViewMode === "grid" ? "#fff" : C.muted, border: "none", borderRadius: "4px", padding: "2px 5px", fontSize: "11px", cursor: "pointer" },
        }),
        el("button", {
          text: "☰",
          title: "List view",
          onclick: () => { mediaViewMode = "list"; renderMediaBin(); },
          style: { background: mediaViewMode === "list" ? BRAND : "transparent", color: mediaViewMode === "list" ? "#fff" : C.muted, border: "none", borderRadius: "4px", padding: "2px 5px", fontSize: "11px", cursor: "pointer" },
        }),
      ], "2px"),
      row(
        [
          el("input", {
            type: "file",
            multiple: "true",
            accept: "video/*,audio/*,image/*",
            style: { display: "none" },
            onchange: async (e: Event) => {
              const files = Array.from((e.target as HTMLInputElement).files || []);
              if (!files.length) return;
              await api.uploadMedia(state.project, files);
              await state.refreshMedia();
              renderMediaBin();
            },
          }),
        ],
        "0"
      )
    );
    // wire the hidden file input to two grid buttons instead of a single raw <input>
    const fileInput = binHeader.querySelector("input[type=file]") as HTMLInputElement;
    const uploadGrid = el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px" } }, [
      binBtn("+Video", () => fileInput.click()),
      binBtn("+Audio", () => fileInput.click()),
      binBtn("🎞 Video (Gallery)", () => {
        openVideoGalleryPicker(state.project, async () => {
          await state.refreshMedia();
          renderMediaBin();
          statusEl.textContent = "Video added from gallery";
        });
      }),
      binBtn("🎵 Audio (Gallery)", () => {
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
    ]);
    binHeader.appendChild(uploadGrid);
    binHeader.appendChild(row([
      el("span", { text: `${state.media.length} item${state.media.length === 1 ? "" : "s"}`, style: { color: C.muted, fontSize: "10px" } }),
      el("div", { style: { flex: "1" } }),
      el("button", {
        text: "Clear",
        title: "Clear media bin (does not delete files)",
        style: { background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "2px 8px", fontSize: "10px", cursor: "pointer" },
        onclick: () => { state.media = []; renderMediaBin(); },
      }),
    ], "6px"));
    mediaBin.appendChild(binHeader);

    const listArea = el("div", { style: { flex: "1", minHeight: "0", overflowY: "auto", padding: "8px" } });
    if (mediaViewMode === "grid") {
      // measured: target Media Bin cards are 3-up, narrow (83px in a ~300px-wide bin,
      // ~11px gutter) with a near-square dark thumbnail, not 2-up wide gradient tiles.
      const grid = el("div", { style: { display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))`, gap: "6px" } });
      mediaGridEl = grid;
      state.media.forEach((m) => grid.appendChild(renderMediaCard(m)));
      listArea.appendChild(grid);
    } else {
      mediaGridEl = null;
      const list = el("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } });
      state.media.forEach((m) => {
        const item = el(
          "div",
          {
            draggable: "true",
            style: { background: C.bg0, border: `1px solid ${C.border}`, borderRadius: "5px", padding: "5px 8px", fontSize: "11px", color: C.text, cursor: "grab", display: "flex", alignItems: "center", gap: "6px" },
          },
          [
            el("span", { text: mediaKindIcon(m.kind) }),
            el("span", { text: m.name || m.path.split(/[\\/]/).pop(), style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1" } }),
          ]
        );
        item.addEventListener("dragstart", (e) => e.dataTransfer?.setData("text/itda-media", m.path));
        list.appendChild(item);
      });
      listArea.appendChild(list);
    }
    mediaBin.appendChild(listArea);

    const footer = el("div", {
      style: { flexShrink: "0", padding: "5px 10px", borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: "6px" },
    });
    const sizeSlider = el("input", { type: "range", min: "70", max: "140", value: String(thumbSize), style: { flex: "1", accentColor: BRAND } }) as HTMLInputElement;
    // Update the grid's own column width directly on every 'input' tick instead of
    // calling renderMediaBin() — a full rebuild replaces this very <input> mid-drag,
    // which kills the browser's native slider-drag gesture (felt like "doesn't move
    // smoothly" / doesn't visibly resize, since the old slider node was destroyed
    // while still being dragged). No rebuild needed at all: the grid reflows on its
    // own from the CSS change.
    sizeSlider.addEventListener("input", () => {
      thumbSize = Number(sizeSlider.value);
      if (mediaGridEl) mediaGridEl.style.gridTemplateColumns = `repeat(auto-fill, minmax(${thumbSize}px, 1fr))`;
    });
    footer.append(el("span", { text: "Thumb", style: { color: C.muted, fontSize: "9px" } }), sizeSlider);
    mediaBin.appendChild(footer);
  }

  function renderMediaCard(m: { path: string; name?: string; kind?: string; fps?: number; duration?: number }) {
    const kind = m.kind || "video";
    const card = el("div", {
      draggable: "true",
      style: {
        position: "relative",
        background: C.bg0,
        border: `1px solid ${C.border}`,
        borderRadius: "9px",
        overflow: "hidden",
        cursor: "grab",
      },
    });
    card.addEventListener("dragstart", (e) => e.dataTransfer?.setData("text/itda-media", m.path));

    // measured: target thumbnail is near-square (card w=83 vs thumb h~130 of a 164 total
    // card height — i.e. the thumb dominates, info strip is a thin footer), flat near-black
    // fill (#000/#0e0f13), not a diagonal gradient tile.
    const thumb = el("div", {
      style: {
        aspectRatio: "1 / 1",
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "22px",
        color: "#4a5062",
      },
      text: mediaKindIcon(kind),
    });
    if (kind === "image") {
      const img = el("img", {
        src: api.mediaFileUrl(m.path, state.project),
        style: { width: "100%", height: "100%", objectFit: "cover", display: "none" },
        alt: "",
        onerror: (ev: Event) => { (ev.target as HTMLElement).style.display = "none"; },
        onload: (ev: Event) => { (ev.target as HTMLElement).style.display = "block"; thumb.querySelector("span")?.remove(); },
      }) as HTMLImageElement;
      // videos won't render a frame via <img src>, so this is a best-effort thumbnail;
      // image kind renders correctly, video keeps the icon placeholder if it 404s.
      thumb.appendChild(img);
    }
    card.appendChild(thumb);

    const delBadge = el("div", {
      text: "✕",
      title: "Remove from bin",
      style: {
        position: "absolute", top: "4px", left: "4px", width: "16px", height: "16px",
        borderRadius: "50%", background: "#c93a3a", color: "#fff", fontSize: "9px", fontWeight: "900",
        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
      },
      onclick: (e: MouseEvent) => {
        e.stopPropagation();
        state.media = state.media.filter((x) => x.path !== m.path);
        renderMediaBin();
      },
    });
    card.appendChild(delBadge);

    const info = el("div", { style: { padding: "5px 6px" } });
    info.append(
      el("div", { text: m.name || m.path.split(/[\\/]/).pop() || "", style: { fontSize: "10px", fontWeight: "700", color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }),
      el("div", { text: `${kind} · ${(m.fps || state.fps).toFixed(2)}fps · ${Math.round((m.duration || 0) * 10) / 10}s`, style: { fontSize: "9px", color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } })
    );
    card.appendChild(info);
    return card;
  }

  function binBtn(text: string, onclick: () => void) {
    return el("button", {
      text,
      onclick,
      style: { background: C.bg0, color: C.text, border: `1px solid ${C.border}`, borderRadius: "5px", padding: "5px 6px", fontSize: "10px", cursor: "pointer" },
    });
  }

  // ── Properties panel ────────────────────────────────────────────────────────────
  function propRow(labelText: string, field: HTMLElement) {
    return [
      el("div", { text: labelText, style: { color: C.muted, fontSize: "10px", display: "flex", alignItems: "center" } }),
      field,
    ];
  }
  function propSection(title: string) {
    return el("div", {
      text: title,
      style: { gridColumn: "1 / -1", fontWeight: "900", color: BRAND, borderTop: `1px solid ${C.border}`, paddingTop: "10px", marginTop: "4px", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em" },
    });
  }
  function propInput(value: string | number, onCommit: (v: string) => void, type = "text") {
    const i = el("input", {
      type,
      value: String(value),
      style: { width: "100%", boxSizing: "border-box", background: "#0d0e12", color: C.text, border: `1px solid ${C.border}`, borderRadius: "5px", padding: "5px 7px", fontSize: "11px", fontFamily: "inherit", outline: "none" },
    }) as HTMLInputElement;
    i.addEventListener("change", () => onCommit(i.value));
    i.addEventListener("focus", () => { i.style.borderColor = BRAND; });
    i.addEventListener("blur", () => { i.style.borderColor = C.border; });
    return i;
  }
  function propSelectStatic(value: string) {
    return el("div", {
      text: value,
      style: { fontSize: "11px", color: C.text, background: "#0d0e12", border: `1px solid ${C.border}`, borderRadius: "5px", padding: "5px 7px" },
    });
  }

  function renderProps() {
    clear(propsPanel);
    const found = state.selectedClipId ? state.findClip(state.selectedClipId) : null;
    propsPanel.appendChild(el("div", {
      text: "Clip Properties",
      style: { height: "36px", display: "flex", alignItems: "center", padding: "0 12px", borderBottom: `1px solid ${C.border}`, fontSize: "12px", fontWeight: "850", boxSizing: "border-box" },
    }));
    if (!found) {
      propsPanel.appendChild(el("div", { text: "No clip selected.", style: { padding: "16px 12px", color: C.muted, fontSize: "11px" } }));
      return;
    }
    const { clip } = found;
    const grid = el("div", {
      style: { display: "grid", gridTemplateColumns: "68px minmax(0,1fr)", gap: "7px", alignItems: "center", padding: "10px 12px" },
    });
    grid.append(
      propSection("Clip"),
      ...propRow("Name", propInput(clip.label || clip.media_path.split(/[\\/]/).pop() || "", (v) => { clip.label = v; state.dirty = true; renderTracks(); refreshStatus(); })),
      ...propRow("Type", propSelectStatic(clip.kind)),
      ...propRow("Track", propInput(clip.track + 1, (v) => {
        const idx = Math.max(1, Math.round(Number(v) || 1)) - 1;
        if (state.tracks[idx]) {
          const src = state.findClip(clip.id);
          if (src) {
            src.track.clips = src.track.clips.filter((c) => c.id !== clip.id);
            clip.track = idx;
            state.tracks[idx].clips.push(clip);
            state.dirty = true;
            renderTracks();
            refreshStatus();
          }
        } else {
          renderProps();
        }
      }, "number")),

      propSection("Timing"),
      ...propRow("Start", propInput(clip.start, (v) => { clip.start = Math.max(0, Math.round(Number(v) || 0)); state.clampToTotalFrames(clip); state.dirty = true; renderTracks(); refreshStatus(); }, "number")),
      ...propRow("Length", propInput(clip.duration, (v) => { clip.duration = Math.max(1, Math.round(Number(v) || 1)); clip.source_out = clip.source_in + clip.duration; state.clampToTotalFrames(clip); state.dirty = true; renderTracks(); refreshStatus(); }, "number")),
      ...propRow("Trim In", propInput(clip.source_in || 0, (v) => { clip.source_in = Math.max(0, Math.round(Number(v) || 0)); state.dirty = true; refreshStatus(); }, "number")),
      ...propRow("Trim Out", propInput(clip.source_out || clip.duration, (v) => { clip.source_out = Math.max(1, Math.round(Number(v) || 1)); state.dirty = true; refreshStatus(); }, "number"))
    );
    propsPanel.appendChild(grid);

    const actions = el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", padding: "0 12px 14px" } }, [
      ghostBtn("First Frame", () => seekPlayhead(clip.start)),
      ghostBtn("End Frame", () => seekPlayhead(clip.start + clip.duration)),
      el("button", {
        text: "Delete Clip",
        onclick: () => { state.removeClip(clip.id); state.selectedClipId = null; renderTracks(); renderProps(); },
        style: { background: "#3a1414", color: "#ff8a8a", border: "1px solid #5a1e1e", borderRadius: "5px", padding: "4px 10px", fontSize: "11px", cursor: "pointer" },
      }),
    ]);
    propsPanel.appendChild(actions);
  }

  function openRenderModal() {
    const overlay = el("div", {
      style: {
        position: "fixed", inset: "0", background: "rgba(0,0,0,0.6)", zIndex: "50",
        display: "flex", alignItems: "center", justifyContent: "center",
      },
      onclick: (e: MouseEvent) => { if (e.target === overlay) overlay.remove(); },
    });
    const modeNames: Record<string, string> = { video_audio: "Video + Audio", video_only: "Video Only", audio_only: "Audio Only" };
    const box = panel(
      [
        label("Render"),
        el("div", { text: `Length: ${state.contentEnd()} frames (${(state.contentEnd() / state.fps).toFixed(1)}s) — auto-detected from last clip end.`, style: { fontSize: "11px", color: C.muted, marginBottom: "4px" } }),
        el("div", { text: `Mode: ${modeNames[renderModeSelect.value] || renderModeSelect.value} — set from the header's Render mode dropdown.`, style: { fontSize: "11px", color: C.muted, marginBottom: "10px" } }),
        row([
          pillBtn("Confirm", () => doRender(renderModeSelect.value as any, overlay)),
          ghostBtn("Cancel", () => overlay.remove()),
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

  // ── shared button styles ──────────────────────────────────────────────────────
  function pillBtn(text: string, onclick: () => void, title?: string) {
    return el("button", {
      text,
      onclick,
      ...(title ? { title } : {}),
      style: {
        background: "#fff",
        color: BRAND,
        border: "none",
        borderRadius: "999px",
        padding: "5px 13px",
        fontSize: "11px",
        fontWeight: "800",
        cursor: "pointer",
      },
    });
  }
  function ghostBtn(text: string, onclick: () => void, title?: string) {
    const b = el("button", {
      text,
      onclick,
      ...(title ? { title } : {}),
      style: {
        background: "rgba(255,255,255,0.08)",
        color: "#fff",
        border: "1px solid rgba(255,255,255,0.22)",
        borderRadius: "999px",
        padding: "4px 11px",
        fontSize: "11px",
        fontWeight: "600",
        cursor: "pointer",
      },
    }) as HTMLButtonElement;
    b.addEventListener("mouseenter", () => { b.style.background = "rgba(255,255,255,0.18)"; });
    b.addEventListener("mouseleave", () => { b.style.background = "rgba(255,255,255,0.08)"; });
    return b;
  }
  function inputStyle() {
    return { background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px 8px", fontSize: "12px", width: "100%", boxSizing: "border-box" as const };
  }
  function pillStyle() {
    return { background: BRAND, color: "#111", border: "none", borderRadius: "999px", padding: "6px 12px", fontSize: "12px", fontWeight: "700" as const, cursor: "pointer" as const, flexShrink: "0" as const };
  }
  function fieldRow(labelText: string, input: HTMLElement) {
    return el("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } }, [
      el("span", { text: labelText, style: { color: C.muted, fontSize: "11px", fontWeight: "700" } }),
      input,
    ]);
  }
  // small centered modal, shared by Project Settings / Project… — matches the
  // App Settings overlay's chrome (createItdaSettingsOverlay in settings.ts) but
  // scoped to a single-card popup rather than a full-screen panel.
  function smallModal(title: string, body: HTMLElement[], onApply: (() => void | Promise<void>) | null, onShow?: () => void | Promise<void>) {
    const card = el("div", { style: { background: "#16171d", border: `1px solid ${C.border}`, borderRadius: "10px", padding: "16px", width: "320px", display: "flex", flexDirection: "column", gap: "10px" } });
    const closeBtn = el("button", { type: "button", text: "✕", style: { background: "transparent", color: C.muted, border: "none", cursor: "pointer", fontSize: "13px" } });
    const head = el("div", { style: { display: "flex", alignItems: "center" } }, [
      el("span", { text: title, style: { color: C.text, fontWeight: "700", fontSize: "13px", flex: "1" } }),
      closeBtn,
    ]);
    card.append(head, ...body);
    if (onApply) {
      const applyBtn = el("button", { type: "button", text: "Apply", style: { ...pillStyle(), width: "100%" }, onclick: async () => { await onApply(); ov.style.display = "none"; } });
      card.appendChild(applyBtn);
    }
    const ov = el("div", { style: { display: "none", position: "fixed", inset: "0", zIndex: "9999", background: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" } }, [card]);
    closeBtn.onclick = () => { ov.style.display = "none"; };
    root.appendChild(ov);
    return {
      el: ov,
      async show() { ov.style.display = "flex"; if (onShow) await onShow(); },
      hide() { ov.style.display = "none"; },
    };
  }
  function mkIconBtn(icon: string, onclick: () => void, title?: string) {
    const b = el("button", {
      text: icon,
      onclick,
      ...(title ? { title } : {}),
      style: {
        background: C.bg0,
        color: C.text,
        border: `1px solid ${C.border}`,
        borderRadius: "6px",
        minWidth: "28px",
        height: "26px",
        fontSize: "12px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 4px",
        whiteSpace: "nowrap",
        flexShrink: "0",
      },
    }) as HTMLButtonElement;
    b.addEventListener("mouseenter", () => { b.style.borderColor = BRAND; });
    b.addEventListener("mouseleave", () => { b.style.borderColor = C.border; });
    return b;
  }
  function sep() {
    return el("div", { style: { width: "1px", alignSelf: "stretch", background: C.border, margin: "0 2px" } });
  }
  function togglePill(text: string, initial: boolean, onchange: (v: boolean) => void) {
    let on = initial;
    const b = el("button", {
      text,
      style: {
        background: on ? BRAND : "transparent",
        color: on ? "#fff" : C.muted,
        border: `1px solid ${on ? BRAND : C.border}`,
        borderRadius: "999px",
        padding: "3px 9px",
        fontSize: "10px",
        fontWeight: "700",
        cursor: "pointer",
      },
    }) as HTMLButtonElement;
    b.addEventListener("click", () => {
      on = !on;
      b.style.background = on ? BRAND : "transparent";
      b.style.color = on ? "#fff" : C.muted;
      b.style.borderColor = on ? BRAND : C.border;
      onchange(on);
    });
    return b;
  }
  function snapPill() {
    const b = togglePill(`Snap: ${state.snap ? "ON" : "OFF"}`, state.snap, (v) => {
      state.snap = v;
      b.textContent = `Snap: ${v ? "ON" : "OFF"}`;
      refreshStatus();
    });
    return b;
  }
  // ↔ Horizontal Zoom — range chosen so the midpoint (1.5px/frame) shows ~30s of a
  // 24fps timeline in a ~1000px-wide viewport (1000 / (1.5 * 24) ≈ 27.8s ≈ 30s), and
  // that midpoint is also the DEFAULT so the slider starts at 50% instead of near one
  // end (previously min .5/max 20, default 2 — handle sat at ~8% on first load).
  function hZoomSlider() {
    const s = el("input", { type: "range", min: "0.5", max: "2.5", step: "0.1", value: String(state.zoomPxPerFrame), style: { width: "70px", accentColor: BRAND } }) as HTMLInputElement;
    s.addEventListener("input", () => {
      state.zoomPxPerFrame = Number(s.value);
      renderRuler();
      renderTracks();
    });
    return s;
  }
  // ↕ Vertical Track Zoom — matches dom_build.js's vZoom (min 44 / max 140).
  function vZoomSlider() {
    const s = el("input", { type: "range", min: "44", max: "140", step: "1", value: String(state.trackHeight), style: { width: "70px", accentColor: BRAND } }) as HTMLInputElement;
    s.addEventListener("input", () => {
      state.trackHeight = Number(s.value);
      renderTracks();
    });
    return s;
  }
  function peakMatchPill() {
    return togglePill("Peak Match", state.peakSnap, (v) => {
      state.peakSnap = v;
      statusEl.textContent = `Peak Match ${v ? "ON" : "OFF"}`;
    });
  }

  // ── boot / project-switch — factored out so the ☰ Menu's "📁 Project…" list and
  // "+ New" flow can re-run the exact same sequence for a different project name,
  // not just at initial mount. ────────────────────────────────────────────────────
  async function bootProject(name: string) {
    state.project = name;
    await api.initProject(state.project);
    await state.loadProject(state.project);
    await state.refreshMedia();
    state.selectedClipId = null;
    state.selectedClipIds = new Set();
    projectNameInput.value = state.project;
    renderRuler();
    renderTracks();
    renderMediaBin();
    renderProps();
    refreshStatus();
    updatePreview();
  }

  (async () => { await bootProject(state.project); })();
}
