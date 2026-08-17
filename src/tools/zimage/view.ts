// view.ts — Z-Image Turbo 메인 화면 조립 (Phase 1: T2I/I2I/Upscale 완전 구현).
// Krea2 view.ts와 완전히 동일한 레이아웃/상호작용 패턴을 그대로 재사용한다 — 사용자 지시:
// "모드만 여러개 있지, KREA2랑 같아", "Generate/STOP은 KREA2와 같은 방식",
// "왼쪽 메뉴 넓이와 프롬포트의 높이도 KREA2와 같은 사이즈"(450px / 180px 그대로 유지).
// 7개 모드 버튼 전부 노출(원본 one_node_z_image_turbo.js MODES 그대로) — 미구현 모드(Phase 2:
// Inpaint/Re-BG/ControlNet/Face Redraw)는 좌측에 "Coming soon" 안내만 표시하고 Generate는 막는다.
import type { ZImageState, ZImageMode } from "./core";
import {
  C, el, clear, BRAND, MODES, RESOLUTIONS, SAMPLERS, SCHEDULERS,
  LORA_UI_CAP, SEEDVR2_ATTN_MODES, SEEDVR2_COLOR_MODES, SEND_TO, IMPLEMENTED_MODES,
  defaultState, loadState, saveState, getModePrompt, setModePrompt, randomSeed, snap8,
} from "./core";
import { panel, label, button, select, numberField, row, col, modeBar, iconBtn, checkboxRow, searchableSelect, openFullscreen, confirmDialog } from "../../shared/ui";
import * as api from "./api";
import { openImageGalleryPicker } from "../../shared/imageGalleryPicker";
import { buildGraph } from "./graphBuilder";
import { queuePrompt } from "./comfyClient";
import type { AppConfig } from "./settings";
import { createSettingsOverlay } from "./settings";
import { createGalleryOverlay } from "./galleryOverlay";
import { createPromptExpandOverlay, createTemplateOverlay } from "./promptTools";
import { createMaskEditor } from "./maskEditor";

export function renderZImage(root: HTMLElement) {
  clear(root);
  root.className = "flex-1 min-h-0 flex flex-col";
  root.style.background = C.bg0;

  const state: ZImageState = defaultState(loadState());
  let availableLoras: string[] = [];
  let samplingActive = false;
  let queuedPromptId: string | null = null;
  const appConfig: AppConfig = { output_mode_visible: true };

  function persist() { saveState(state); }

  const wrap = el("div", { style: { flex: "1", minHeight: "0", display: "flex", flexDirection: "column", padding: "10px", gap: "8px", boxSizing: "border-box" } });
  root.appendChild(wrap);

  // ── Sub bar: 7개 모드 pill + 아이콘 ────────────────────────────────────────
  const subBar = el("div", { style: { display: "flex", alignItems: "center", gap: "10px", flexShrink: "0" } });
  const modeBarWrap = el("div");
  function renderModeBar() {
    clear(modeBarWrap);
    modeBarWrap.appendChild(
      modeBar(MODES.map((m) => ({ key: m.key, label: m.label })), state.mode, (key) => {
        state.mode = key as ZImageMode;
        state.prompt = getModePrompt(state, state.mode);
        persist();
        renderModeBar();
        renderLeftPanel();
        refreshPromptBox();
        renderSendTo();
        restorePreviewForMode();
      })
    );
  }
  renderModeBar();
  const warnTag = el("div", { text: "", style: { color: C.warn, fontSize: "11px" } });
  const spacer = el("div", { style: { flex: "1" } });

  // 원본 topBar: ↺ Reset(전체 초기화 — Z-Image는 compareEnabled도 강제 OFF) · ⇌ Compare · 🗑 Unload · ⚙ · 🖼 · ?
  const resetBtn = iconBtn("↺", "Reset settings", () => resetAllSettings());
  resetBtn.style.cssText += `background:#ffffff;color:${BRAND};border:2px solid ${BRAND};border-radius:6px;padding:4px 8px;font-weight:700;`;
  resetBtn.addEventListener("mouseenter", () => (resetBtn.style.background = "#f5f5ff"));
  resetBtn.addEventListener("mouseleave", () => (resetBtn.style.background = "#ffffff"));

  let compareEnabled = true;
  const compareBtn = iconBtn("⇌", "Toggle compare view", () => { compareEnabled = !compareEnabled; applyCompareBtnStyle(); restorePreviewForMode(); });
  compareBtn.style.cssText += "border-radius:6px;padding:4px 8px;font-weight:700;font-size:13px;";
  function applyCompareBtnStyle() {
    if (compareEnabled) {
      compareBtn.style.background = "#ffffff"; compareBtn.style.color = BRAND; compareBtn.style.border = `2px solid ${BRAND}`;
      compareBtn.onmouseenter = () => (compareBtn.style.background = "#f0e0ff");
      compareBtn.onmouseleave = () => (compareBtn.style.background = "#ffffff");
    } else {
      compareBtn.style.background = C.bg2; compareBtn.style.color = C.muted; compareBtn.style.border = `1px solid ${C.border}`;
      compareBtn.onmouseenter = () => (compareBtn.style.background = C.bg3);
      compareBtn.onmouseleave = () => (compareBtn.style.background = C.bg2);
    }
  }
  applyCompareBtnStyle();

  const unloadBtn = iconBtn("🗑", "Unload RAM/VRAM", () => unloadVram());
  const settingsBtn = iconBtn("⚙", "Settings", () => settingsOv.show());
  const galleryBtn = iconBtn("🖼", "Gallery", () => galleryOv.show());
  const helpBtn = iconBtn("?", "Help", () => helpOv.show());
  subBar.append(modeBarWrap, warnTag, spacer, resetBtn, compareBtn, unloadBtn, settingsBtn, galleryBtn, helpBtn);
  wrap.appendChild(subBar);

  // ── Body: left panel(Krea2와 동일 450px) + right preview ────────────────────
  const body = el("div", { style: { flex: "1", minHeight: "0", display: "flex", gap: "10px" } });
  wrap.appendChild(body);

  const leftPanel = el("div", { style: { width: "450px", flexShrink: "0", display: "flex", flexDirection: "column", minHeight: "0" } });
  const leftScroll = el("div", { style: { flex: "1", minHeight: "0", overflowY: "auto", paddingRight: "4px" } });
  const leftBottomBar = el("div", { style: { flexShrink: "0", paddingTop: "8px" } });
  leftPanel.append(leftScroll, leftBottomBar);
  body.appendChild(leftPanel);

  const rightPanel = el("div", { style: { flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "8px" } });
  body.appendChild(rightPanel);

  const previewBox = el("div", { style: { flex: "1", minHeight: "0", background: "#000", border: `1px solid ${C.border}`, borderRadius: "10px", position: "relative", overflow: "hidden" } });
  const placeholderTxt = el("div", { text: "결과 이미지가 여기에 표시됩니다", style: { position: "absolute", inset: "0", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: "13px" } });
  const resultImg = el("img", { style: { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain", display: "none" } });
  resultImg.addEventListener("dblclick", () => { if (resultImg.src) openFullscreen(resultImg.src, "image"); });
  const clearBtn = el("button", { type: "button", text: "✕", title: "Clear result", style: { position: "absolute", top: "6px", right: "6px", zIndex: "5", background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", borderRadius: "4px", width: "22px", height: "22px", cursor: "pointer", fontSize: "12px", padding: "0", display: "none" } });
  const zoomLockBtn = el("button", { type: "button", text: "🔓", title: "Scroll zoom on/off", style: { position: "absolute", top: "6px", right: "32px", zIndex: "5", background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", borderRadius: "4px", width: "22px", height: "22px", cursor: "pointer", fontSize: "11px", padding: "0", display: "none" } });
  previewBox.append(placeholderTxt, resultImg, zoomLockBtn, clearBtn);
  rightPanel.appendChild(previewBox);

  // ── Zoom / Pan ──────────────────────────────────────────────────────────
  let zoomEnabled = true, zoomScale = 1, panX = 0, panY = 0, isPanning = false, panSX = 0, panSY = 0, pSTX = 0, pSTY = 0;
  function applyZoom() {
    resultImg.style.transform = `scale(${zoomScale}) translate(${panX}px,${panY}px)`;
    resultImg.style.transformOrigin = "center center";
    resultImg.style.cursor = zoomScale > 1 ? "grab" : "default";
  }
  function resetZoom() { zoomScale = 1; panX = 0; panY = 0; applyZoom(); }
  zoomLockBtn.addEventListener("click", () => { zoomEnabled = !zoomEnabled; zoomLockBtn.textContent = zoomEnabled ? "🔓" : "🔒"; if (!zoomEnabled) resetZoom(); });
  previewBox.addEventListener("wheel", (e) => {
    if (!zoomEnabled || !modeResults[state.mode] || compareViewEl) return;
    e.preventDefault();
    zoomScale = Math.max(1, Math.min(8, zoomScale * (e.deltaY < 0 ? 1.12 : 0.9)));
    if (zoomScale === 1) { panX = 0; panY = 0; }
    applyZoom();
  }, { passive: false });
  previewBox.addEventListener("mousedown", (e) => {
    if (!zoomEnabled || zoomScale <= 1 || e.button !== 0 || compareViewEl) return;
    isPanning = true; panSX = e.clientX; panSY = e.clientY; pSTX = panX; pSTY = panY; resultImg.style.cursor = "grabbing"; e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => { if (!isPanning) return; panX = pSTX + (e.clientX - panSX) / zoomScale; panY = pSTY + (e.clientY - panSY) / zoomScale; applyZoom(); });
  document.addEventListener("mouseup", () => { if (isPanning) { isPanning = false; resultImg.style.cursor = zoomScale > 1 ? "grab" : "default"; } });

  function currentSourceFilename(): string {
    if (state.mode === "i2i") return state.i2iImage;
    if (state.mode === "inpaint") return state.inpaintImage;
    if (state.mode === "rebg") return state.rebgImage;
    if (state.mode === "controlnet") return state.controlnetImage;
    if (state.mode === "face_redraw") return state.faceImage;
    if (state.mode === "upscale") return state.upscaleImage;
    return "";
  }

  // ── Compare view — Krea2에서 검증된 clip-path 방식(원본의 px 스냅샷 방식 대신) ──
  let compareViewEl: HTMLElement | null = null;
  function createCompareView(originalURL: string, resultURL: string) {
    const container = el("div", { style: { position: "absolute", inset: "0", overflow: "hidden", borderRadius: "10px", background: "#000" } });
    const rImg = el("img", { src: resultURL, style: { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain" } });
    const origImg = el("img", { src: originalURL, style: { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain" } });
    const divider = el("div", { style: { position: "absolute", top: "0", bottom: "0", left: "0%", width: "3px", background: "rgba(255,255,255,0.85)", cursor: "ew-resize", zIndex: "10" } });
    const handle = el("div", { text: "⟺", style: { position: "absolute", top: "50%", left: "-10px", transform: "translateY(-50%)", width: "20px", height: "40px", borderRadius: "10px", background: BRAND, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "11px", userSelect: "none" } });
    divider.appendChild(handle);
    function update(p: number) {
      const pos = Math.max(0, Math.min(100, p));
      origImg.style.clipPath = `inset(0 ${100 - pos}% 0 0)`;
      divider.style.left = pos + "%";
    }
    update(0);
    divider.addEventListener("pointerdown", (e) => {
      divider.setPointerCapture(e.pointerId);
      const mv = (e2: PointerEvent) => { const r = container.getBoundingClientRect(); update(((e2.clientX - r.left) / r.width) * 100); };
      const up = () => { divider.removeEventListener("pointermove", mv); divider.removeEventListener("pointerup", up); };
      divider.addEventListener("pointermove", mv); divider.addEventListener("pointerup", up);
    });
    container.append(rImg, origImg, divider);
    return container;
  }

  // ── Send to: + Output(Preview/Save) 토글 ───────────────────────────────────
  type ModeResult = { filename: string; subfolder: string; type: string };
  const modeResults: Partial<Record<string, ModeResult>> = {};
  function restorePreviewForMode() {
    if (compareViewEl) { compareViewEl.remove(); compareViewEl = null; }
    const mr = modeResults[state.mode];
    if (!mr) {
      placeholderTxt.style.display = "flex";
      resultImg.style.display = "none";
      clearBtn.style.display = "none";
      zoomLockBtn.style.display = "none";
      return;
    }
    clearBtn.style.display = "block";
    zoomLockBtn.style.display = "block";
    const resultURL = api.viewUrl(mr.filename, mr.subfolder || "", (mr.type as any) || "output", Date.now());
    const srcFile = currentSourceFilename();
    if (compareEnabled && state.mode !== "t2i" && srcFile) {
      placeholderTxt.style.display = "none";
      resultImg.style.display = "none";
      compareViewEl = createCompareView(api.viewUrl(srcFile, "", "input"), resultURL);
      previewBox.appendChild(compareViewEl);
      resetZoom();
    } else {
      placeholderTxt.style.display = "none";
      resultImg.src = resultURL;
      resultImg.style.display = "block";
    }
  }
  clearBtn.addEventListener("click", () => { delete modeResults[state.mode]; resetZoom(); restorePreviewForMode(); renderSendTo(); });
  const sendToWrap = el("div", { style: { flexShrink: "0", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } });
  const sendLeft = el("div", { style: { flex: "1", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px" } });
  const sendRight = el("div", { style: { display: "flex", alignItems: "center", gap: "4px", flexShrink: "0" } });
  sendToWrap.append(sendLeft, sendRight);
  rightPanel.appendChild(sendToWrap);

  function renderSendTo() {
    clear(sendLeft);
    const targets = SEND_TO[state.mode] || [];
    if (!targets.length) return;
    sendLeft.appendChild(el("div", { text: "Send to:", style: { color: C.muted, fontSize: "11px", flexShrink: "0" } }));
    targets.forEach((t) => {
      const btn = el("button", { type: "button", text: t.label, style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "3px 8px", borderRadius: "12px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` } });
      btn.addEventListener("mouseenter", () => (btn.style.background = C.bg3));
      btn.addEventListener("mouseleave", () => (btn.style.background = C.bg2));
      btn.addEventListener("click", async () => {
        const mr = modeResults[state.mode];
        if (!mr) return;
        if (!IMPLEMENTED_MODES.includes(t.mode)) { warnTag.textContent = `${t.mode} 모드는 Phase 2에서 지원 예정입니다.`; return; }
        (btn as HTMLButtonElement).disabled = true;
        btn.textContent = "Copying…";
        try {
          const n = await api.copyOutputToInput(mr.filename, mr.subfolder || "", mr.type || "output");
          (state as any)[t.field] = n;
          state.mode = t.mode;
          persist();
          renderModeBar();
          renderLeftPanel();
          refreshPromptBox();
          renderSendTo();
          restorePreviewForMode();
        } catch {
          (btn as HTMLButtonElement).disabled = false;
          btn.textContent = t.label;
        }
      });
      sendLeft.appendChild(btn);
    });
  }
  renderSendTo();

  function renderOutputToggle() {
    clear(sendRight);
    if (appConfig.output_mode_visible === false) return;
    sendRight.appendChild(el("div", { text: "Output:", style: { color: C.muted, fontSize: "11px" } }));
    (["preview", "save"] as const).forEach((key) => {
      const active = state.outputMode === key;
      const btn = el("button", {
        type: "button",
        text: key === "save" ? "💾 Save" : "👁 Preview",
        style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "4px 10px", borderRadius: "20px", background: active ? BRAND : C.bg2, color: "#fff", border: `1px solid ${active ? BRAND : C.border}`, fontWeight: active ? "700" : "400" },
        onclick: () => { state.outputMode = key; persist(); renderOutputToggle(); },
      });
      sendRight.appendChild(btn);
    });
  }
  renderOutputToggle();

  const statusWrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "4px", flexShrink: "0" } });
  const statusText = el("div", { text: "Idle", style: { color: C.muted, fontSize: "12px" } });
  const progressOuter = el("div", { style: { height: "5px", background: C.bg2, borderRadius: "3px", overflow: "hidden" } });
  const progressInner = el("div", { style: { height: "100%", width: "0%", background: BRAND, transition: "width 0.15s" } });
  progressOuter.appendChild(progressInner);
  const externalQueueBanner = el("div", { style: { display: "none", color: C.warn, fontSize: "11px", background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "5px 8px" } });
  statusWrap.append(statusText, progressOuter, externalQueueBanner);
  rightPanel.appendChild(statusWrap);

  // ── Prompt box (Krea2와 동일 180px, 원본은 30자 미만 경고 — Krea2는 20자) ─────
  const promptWrap = el("div", { style: { flexShrink: "0", display: "flex", flexDirection: "column", gap: "6px" } });
  const promptHdr = el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } });
  const charCount = el("span", { style: { color: C.muted, fontSize: "10px" } });
  promptHdr.append(el("div", { text: "PROMPT", style: { color: C.muted, fontSize: "11px", flex: "1", textTransform: "uppercase", letterSpacing: "0.04em" } }), charCount);
  const templatesBtn = button("📋 Templates", () => templateOv.show());
  const expandBtn = button("🔍 Expand / LLM", () => promptExpandOv.show());
  promptHdr.append(templatesBtn, expandBtn);

  const promptTA = el("textarea", { placeholder: "Prompt…", style: { width: "100%", boxSizing: "border-box", background: C.bg1, color: C.text, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "9px", fontSize: "13px", fontFamily: "inherit", resize: "vertical", minHeight: "180px", outline: "none" } });
  function updatePromptCount() {
    const n = getModePrompt(state, state.mode).trim().length;
    charCount.textContent = ` (${n} chars${n < 30 ? " ⚠" : ""})`;
    charCount.style.color = n < 30 ? C.warn : C.muted;
  }
  function refreshPromptBox() { promptTA.value = getModePrompt(state, state.mode); updatePromptCount(); }
  refreshPromptBox();
  promptTA.addEventListener("input", () => { setModePrompt(state, state.mode, promptTA.value); persist(); updatePromptCount(); });

  promptWrap.append(promptHdr, promptTA);
  rightPanel.appendChild(promptWrap);

  const promptExpandOv = createPromptExpandOverlay(
    () => getModePrompt(state, state.mode),
    (text) => { setModePrompt(state, state.mode, text); persist(); refreshPromptBox(); }
  );
  const templateOv = createTemplateOverlay(
    () => state.mode,
    (text) => { setModePrompt(state, state.mode, text); persist(); refreshPromptBox(); }
  );
  wrap.appendChild(promptExpandOv.el);
  wrap.appendChild(templateOv.el);

  // ── Seed + Mode + Generate/Stop — Krea2와 동일하게 좌측 최하단 고정, 같은 위치 스왑 ──
  const seedInput = numberField(state.seed, (v) => { state.seed = v; persist(); }, 1);
  const seedModeDD = select(
    [{ value: "randomize", label: "Random" }, { value: "fixed", label: "Fixed" }, { value: "increment", label: "+1" }, { value: "decrement", label: "-1" }],
    state.seedMode,
    (v) => { state.seedMode = v; persist(); }
  );
  const seedGenWrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px", paddingTop: "8px", borderTop: `1px solid ${C.border}` } });
  seedGenWrap.appendChild(panel([row([col([label("SEED"), seedInput]), col([label("MODE"), seedModeDD])])]));
  leftBottomBar.appendChild(seedGenWrap);

  const genBtn = button("✨ Generate", () => generate(), "primary");
  genBtn.style.width = "100%";
  const stopBtn = button("⏹ Stop", () => stopGeneration(), "danger");
  stopBtn.style.width = "100%";
  stopBtn.style.display = "none";
  leftBottomBar.append(genBtn, stopBtn);

  // ── Overlays ────────────────────────────────────────────────────────────
  const settingsOv = createSettingsOverlay(state, {
    persist,
    get availableLoras() { return availableLoras; },
    set availableLoras(v: string[]) { availableLoras = v; },
    appConfig,
    onModelsRefreshed: () => renderLeftPanel(),
    onOutputVisibilityChanged: () => renderOutputToggle(),
  } as any);
  wrap.style.position = "relative";
  wrap.appendChild(settingsOv.el);

  const galleryOv = createGalleryOverlay(
    state,
    (meta: any) => { applyReuseMeta(meta); },
    (mode: string, field: string, filename: string) => {
      (state as any)[field] = filename;
      state.mode = mode as ZImageMode;
      persist();
      renderModeBar();
      renderLeftPanel();
      refreshPromptBox();
      renderSendTo();
      restorePreviewForMode();
    }
  );
  wrap.appendChild(galleryOv.el);

  const helpOv = createHelpOverlay();
  wrap.appendChild(helpOv.el);

  // 원본 resetBtn: localStorage 전체 삭제 + model/textEncoder는 보존 + compareEnabled 강제 OFF.
  async function resetAllSettings() {
    if (!(await confirmDialog("Reset all settings? Model selection is preserved."))) return;
    const { model, textEncoder, vae } = state;
    Object.assign(state, defaultState({}));
    if (model) state.model = model;
    if (textEncoder) state.textEncoder = textEncoder;
    if (vae) state.vae = vae;
    persist();
    Object.keys(modeResults).forEach((k) => delete modeResults[k]);
    compareEnabled = false;
    applyCompareBtnStyle();
    renderModeBar();
    renderLeftPanel();
    refreshPromptBox();
    renderSendTo();
    restorePreviewForMode();
    seedInput.value = String(state.seed ?? 0);
  }

  async function unloadVram() {
    unloadBtn.style.opacity = "0.5";
    try { await api.freeMemory(); }
    finally { setTimeout(() => (unloadBtn.style.opacity = "1"), 2000); }
  }

  function applyReuseMeta(meta: any) {
    if (!meta || !meta.mode) return;
    Object.assign(state, meta);
    persist();
    renderModeBar();
    renderLeftPanel();
    refreshPromptBox();
    renderSendTo();
    restorePreviewForMode();
  }

  // ── Left panel helpers ───────────────────────────────────────────────────
  function sizeFields(getW: () => number | null, setW: (v: number | null) => void, getH: () => number | null, setH: (v: number | null) => void, lockGetter: () => boolean, lockSetter: (v: boolean) => void) {
    let aspect = getW() && getH() ? (getW() as number) / (getH() as number) : 1;
    const wIn = numberField(getW() || 512, (v) => {
      const nv = snap8(v || 512);
      setW(nv);
      if (lockGetter() && aspect > 0) setH(snap8(nv / aspect));
      else if (getH()) aspect = nv / (getH() as number);
      persist();
    }, 8);
    const hIn = numberField(getH() || 512, (v) => {
      const nv = snap8(v || 512);
      setH(nv);
      if (lockGetter() && aspect > 0) setW(snap8(nv * aspect));
      else if (getW()) aspect = (getW() as number) / nv;
      persist();
    }, 8);
    const lockChk = checkboxRow("🔒 Lock ratio", lockGetter(), (v) => { lockSetter(v); if (getW() && getH()) aspect = (getW() as number) / (getH() as number); persist(); });
    return col([row([col([label("W"), wIn]), col([label("H"), hIn])]), lockChk]);
  }

  function loraSection() {
    const wrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } });
    function rebuild() {
      clear(wrap);
      (state.loras || []).forEach((l, i) => {
        const nameOpts = ["none", ...availableLoras.filter((n) => n !== "none")];
        const trigIn = el("input", { type: "text", placeholder: "trigger word", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "5px", fontSize: "11px" } });
        trigIn.value = l.triggerWord || "";
        trigIn.addEventListener("input", () => { l.triggerWord = trigIn.value; persist(); });
        const nameSel = searchableSelect(nameOpts, l.name || "none", async (v) => {
          const prev = l.name;
          l.name = v;
          persist();
          if (v && v !== "none") {
            if (v !== prev) { l.triggerWord = ""; trigIn.value = ""; }
            if (!l.triggerWord) {
              trigIn.placeholder = "Loading…";
              try {
                const tw = await api.getLoraTriggers(v);
                if (tw) { l.triggerWord = tw; trigIn.value = tw; persist(); }
              } catch {}
              trigIn.placeholder = "trigger word";
            }
          } else {
            l.triggerWord = ""; trigIn.value = "";
          }
        });
        const strIn = numberField(l.strength, (v) => { l.strength = v; persist(); }, 0.05);
        const enChk = checkboxRow("on", l.enabled, (v) => { l.enabled = v; persist(); });
        const delBtn = iconBtn("✕", "Remove", () => { state.loras.splice(i, 1); persist(); rebuild(); });
        const headerRow = el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } }, [
          el("div", { text: "LORA", style: { color: C.muted, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em" } }),
          el("div", { style: { flex: "1" } }),
          enChk,
          delBtn,
        ]);
        wrap.appendChild(panel([
          headerRow,
          nameSel.el,
          row([col([label("Trigger Word"), trigIn]), col([label("Strength"), strIn])]),
        ]));
      });
      if ((state.loras || []).length < LORA_UI_CAP) {
        wrap.appendChild(button(`+ Add LoRA (max ${LORA_UI_CAP})`, () => { state.loras.push({ name: "none", strength: 0.8, triggerWord: "", enabled: true }); persist(); rebuild(); }));
      }
    }
    rebuild();
    return wrap;
  }

  function imageUploadSlot(currentFilename: string, onSet: (name: string) => void, onLoad?: (w: number, h: number) => void, probeIfUnknown?: boolean) {
    const wrap = el("div", { style: { border: `2px dashed ${C.border}`, borderRadius: "8px", padding: "8px", textAlign: "center", cursor: "pointer", minHeight: "180px", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", background: C.bg2 } });
    const img = el("img", { style: { maxWidth: "100%", maxHeight: "168px", display: "none", borderRadius: "4px" } });
    const hint = el("div", { text: "클릭 또는 드래그하여 업로드", style: { color: C.muted, fontSize: "11px" } });
    const fileIn = el("input", { type: "file", accept: "image/*", style: { display: "none" } });
    wrap.append(hint, img, fileIn);
    // Krea2에서 실제로 겪은 무한 재렌더 루프 버그 회피: img의 "load" 이벤트에 onLoad를 절대 걸지 않는다.
    async function handleFile(file: File) {
      hint.textContent = "업로드 중…";
      try {
        const name = await api.uploadImage(file, file.name);
        onSet(name);
        const url = api.viewUrl(name, "", "input", Date.now());
        img.src = url;
        img.style.display = "block";
        hint.style.display = "none";
        if (onLoad) {
          const probe = new Image();
          probe.onload = () => onLoad(probe.naturalWidth, probe.naturalHeight);
          probe.src = url;
        }
      } catch (e: any) { hint.textContent = "업로드 실패: " + (e.message || e); }
    }
    function applyPicked(name: string) {
      onSet(name);
      const url = api.viewUrl(name, "", "input", Date.now());
      img.src = url;
      img.style.display = "block";
      hint.style.display = "none";
      if (onLoad) {
        const probe = new Image();
        probe.onload = () => onLoad(probe.naturalWidth, probe.naturalHeight);
        probe.src = url;
      }
    }
    const galleryBtn = el("button", { type: "button", text: "🖼", title: "갤러리에서 선택", style: { position: "absolute", bottom: "4px", left: "4px", zIndex: "3", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", borderRadius: "4px", width: "22px", height: "22px", cursor: "pointer", fontSize: "12px", padding: "0" } });
    galleryBtn.addEventListener("click", (e) => { e.stopPropagation(); openImageGalleryPicker((name) => applyPicked(name)); });
    wrap.appendChild(galleryBtn);

    wrap.addEventListener("click", () => fileIn.click());
    fileIn.addEventListener("change", () => { if (fileIn.files?.[0]) handleFile(fileIn.files[0]); });
    wrap.addEventListener("dragover", (e) => { e.preventDefault(); wrap.style.borderColor = BRAND; });
    wrap.addEventListener("dragleave", () => { wrap.style.borderColor = C.border; });
    wrap.addEventListener("drop", (e) => { e.preventDefault(); wrap.style.borderColor = C.border; const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f); });

    if (currentFilename) {
      const url = api.viewUrl(currentFilename, "", "input");
      img.src = url;
      img.style.display = "block";
      hint.style.display = "none";
      // Send-to로 넘어온 이미지는 새 업로드가 아니라 onLoad 프로브가 실행되지 않아 W/H가 미확인
      // 상태로 남는 버그가 있었다(라이브 테스트에서 발견) — 아직 크기를 모를 때만, 한 번만 프로브.
      if (onLoad && probeIfUnknown) {
        const probe = new Image();
        probe.onload = () => onLoad(probe.naturalWidth, probe.naturalHeight);
        probe.src = url;
      }
    }
    return wrap;
  }

  function samplingSection() {
    return el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } }, [
      row([
        col([label("Steps"), numberField(state.steps, (v) => { state.steps = Math.max(1, Math.min(50, Math.round(v) || 1)); persist(); })]),
        col([label("CFG"), numberField(state.cfg, (v) => { state.cfg = Math.max(0, Math.min(20, v || 0)); persist(); }, 0.25)]),
        col([label("Shift"), numberField(state.shift, (v) => { state.shift = Math.max(0, v || 0); persist(); }, 0.5)]),
      ]),
      row([col([label("Sampler"), select(SAMPLERS, state.sampler, (v) => { state.sampler = v; persist(); })]), col([label("Scheduler"), select(SCHEDULERS, state.scheduler, (v) => { state.scheduler = v; persist(); })])]),
    ]);
  }

  // Inpaint 모드는 마스크를 그려야 해서 beforeGenerate에서 자동 저장 훅이 필요 — 모드 전환마다 갱신.
  let inpaintAutoSave: (() => Promise<boolean>) | null = null;

  function renderLeftPanel() {
    clear(leftScroll);
    if (state.mode === "t2i") {
      const matched = RESOLUTIONS.find((r) => r.w === state.width && r.h === state.height);
      const isCustom = !matched || matched.label === "Custom";
      const customRow = row([col([label("W"), numberField(state.width, (v) => { state.width = Math.max(64, snap8(v)) || 1024; persist(); }, 8)]), col([label("H"), numberField(state.height, (v) => { state.height = Math.max(64, snap8(v)) || 1536; persist(); }, 8)])]);
      customRow.style.display = isCustom ? "flex" : "none";
      const resSel = select(RESOLUTIONS.map((r) => ({ value: r.label, label: r.label })), isCustom ? "Custom" : matched!.label, (v) => {
        const p = RESOLUTIONS.find((r) => r.label === v);
        if (p && p.w > 0) { state.width = p.w; state.height = p.h; persist(); customRow.style.display = "none"; }
        else customRow.style.display = "flex";
      });
      leftScroll.appendChild(panel([label("Resolution"), resSel, customRow]));
      leftScroll.appendChild(panel([label("Sampling"), samplingSection()]));
      leftScroll.appendChild(panel([label("LoRA"), loraSection()]));
    } else if (state.mode === "i2i") {
      leftScroll.appendChild(panel([
        label("Source Image"),
        imageUploadSlot(state.i2iImage, (name) => { state.i2iImage = name; persist(); }, (w, h) => { state.i2iWidth = snap8(w); state.i2iHeight = snap8(h); persist(); renderLeftPanel(); }, !state.i2iWidth || !state.i2iHeight),
        sizeFields(() => state.i2iWidth, (v) => (state.i2iWidth = v), () => state.i2iHeight, (v) => (state.i2iHeight = v), () => state.i2iLockRatio, (v) => (state.i2iLockRatio = v)),
      ]));
      leftScroll.appendChild(panel([label("Denoise Strength"), numberField(state.i2iDenoise, (v) => { state.i2iDenoise = Math.max(0, Math.min(1, v)); persist(); }, 0.01)]));
      leftScroll.appendChild(panel([label("Sampling"), samplingSection()]));
      leftScroll.appendChild(panel([label("LoRA"), loraSection()]));
    } else if (state.mode === "upscale") {
      leftScroll.appendChild(panel([label("Source Image"), imageUploadSlot(state.upscaleImage, (name) => { state.upscaleImage = name; persist(); })]));
      const ditSel = searchableSelect(["none"], state.upscaleDitModel, (v) => { state.upscaleDitModel = v; persist(); });
      const vaeSel = searchableSelect(["none"], state.upscaleVaeModel, (v) => { state.upscaleVaeModel = v; persist(); });
      api.getSeedVR2Models().then((d) => {
        const opts = ["none", ...(d.models || []).filter((m) => m !== "none")];
        if (opts.length > 1) {
          (ditSel.el.querySelector("select") as HTMLSelectElement)?.replaceChildren(...opts.map((o) => el("option", { value: o, text: o })));
          (vaeSel.el.querySelector("select") as HTMLSelectElement)?.replaceChildren(...opts.map((o) => el("option", { value: o, text: o })));
          ditSel.setValue(state.upscaleDitModel);
          vaeSel.setValue(state.upscaleVaeModel);
        }
      });
      leftScroll.appendChild(panel([label("DiT Model"), ditSel.el]));
      leftScroll.appendChild(panel([label("VAE Model"), vaeSel.el, el("div", { text: "Models → models/SEEDVR2/", style: { fontSize: "10px", color: C.muted } })]));
      leftScroll.appendChild(panel([
        label("Upscale Settings"),
        row([col([label("Resolution (short edge)"), numberField(state.upscaleResolution ?? 2048, (v) => { state.upscaleResolution = v; persist(); }, 2)]), col([label("Max Resolution"), numberField(state.upscaleMaxResolution ?? 4096, (v) => { state.upscaleMaxResolution = v; persist(); }, 2)])]),
        row([col([label("Batch Size (4n+1)"), numberField(state.upscaleBatchSize ?? 1, (v) => { state.upscaleBatchSize = v; persist(); }, 4)]), col([label("Blocks to Swap"), numberField(state.upscaleBlocksToSwap ?? 0, (v) => { state.upscaleBlocksToSwap = v; persist(); }, 1)])]),
        row([col([label("Attention Mode"), select(SEEDVR2_ATTN_MODES, state.upscaleAttentionMode, (v) => { state.upscaleAttentionMode = v; persist(); })]), col([label("Color Correction"), select(SEEDVR2_COLOR_MODES, state.upscaleColorCorrection, (v) => { state.upscaleColorCorrection = v; persist(); })])]),
        col([label("Offload Device"), select(["cpu", "cuda:0"], state.upscaleOffloadDevice, (v) => { state.upscaleOffloadDevice = v; persist(); })]),
        row([col([label("Input Noise Scale"), numberField(state.upscaleInputNoiseScale ?? 0, (v) => { state.upscaleInputNoiseScale = v; persist(); }, 0.01)]), col([label("Latent Noise Scale"), numberField(state.upscaleLatentNoiseScale ?? 0, (v) => { state.upscaleLatentNoiseScale = v; persist(); }, 0.01)])]),
      ]));
    } else if (state.mode === "inpaint") {
      inpaintAutoSave = null;
      const editor = createMaskEditor(state, persist);
      leftScroll.appendChild(panel([
        label("Source Image"),
        imageUploadSlot(state.inpaintImage, (name) => { state.inpaintImage = name; state.inpaintMaskImage = null; persist(); editor.loadSourceImage(name); }),
      ]));
      leftScroll.appendChild(panel([label("Mask Editor (보라=재생성 / 검=유지)"), editor.editorPanel]));
      if (state.inpaintImage) editor.loadSourceImage(state.inpaintImage);
      inpaintAutoSave = editor.autoSaveIfNeeded;
      leftScroll.appendChild(panel([
        label("Denoise"),
        el("div", { text: "높을수록 마스크 영역이 프롬프트를 더 강하게 따릅니다.", style: { color: C.muted, fontSize: "10px", marginBottom: "4px" } }),
        numberField(state.inpaintDenoise ?? 0.85, (v) => { state.inpaintDenoise = Math.max(0.1, Math.min(1, v)); persist(); }, 0.01),
      ]));
      leftScroll.appendChild(panel([label("Sampling"), samplingSection()]));
      leftScroll.appendChild(panel([label("LoRA"), loraSection()]));
    } else if (state.mode === "rebg") {
      const bgSel = searchableSelect(["none"], state.rebgBgModel, (v) => { state.rebgBgModel = v; persist(); });
      api.getBgRemovalModels().then((models) => {
        const opts = models.length ? models : ["none"];
        if (!opts.includes(state.rebgBgModel)) { state.rebgBgModel = opts[0]; persist(); }
        (bgSel.el.querySelector("select") as HTMLSelectElement)?.replaceChildren(...opts.map((o) => el("option", { value: o, text: o })));
        bgSel.setValue(state.rebgBgModel);
      }).catch(() => {});
      leftScroll.appendChild(panel([label("BG Removal Model"), bgSel.el]));
      leftScroll.appendChild(panel([label("Source Image"), imageUploadSlot(state.rebgImage, (name) => { state.rebgImage = name; persist(); })]));
      leftScroll.appendChild(panel([
        label("Subject Edge"),
        el("div", { text: "Edge Offset: 마스크 경계를 + 확장 / − 축소 (px). 기본 0", style: { color: C.muted, fontSize: "10px" } }),
        numberField(state.rebgOffset ?? 0, (v) => { state.rebgOffset = v; persist(); }, 1),
        el("div", { text: "Edge Blur: 마스크를 블러링해 경계를 부드럽게 (px). 기본 0", style: { color: C.muted, fontSize: "10px", marginTop: "6px" } }),
        numberField(state.rebgBlur ?? 0, (v) => { state.rebgBlur = Math.max(0, v); persist(); }, 1),
      ]));
      leftScroll.appendChild(panel([
        label("Expansion (px) — 0이면 배경만 재생성"),
        el("div", { text: "ℹ Expansion은 OUTPAINT가 아닙니다. 서브젝트는 원본 위치 그대로 유지되며, 배경 영역만 px 단위로 넓혀 재생성합니다.", style: { color: "#FFD700", fontSize: "11px", padding: "4px 6px", background: "rgba(255,215,0,0.07)", border: "1px solid rgba(255,215,0,0.25)", borderRadius: "5px", marginBottom: "6px" } }),
        row([col([label("Up"), numberField(state.rebgUp ?? 0, (v) => { state.rebgUp = Math.max(0, v); persist(); }, 64)]), col([label("Down"), numberField(state.rebgDown ?? 0, (v) => { state.rebgDown = Math.max(0, v); persist(); }, 64)])]),
        row([col([label("Left"), numberField(state.rebgLeft ?? 0, (v) => { state.rebgLeft = Math.max(0, v); persist(); }, 64)]), col([label("Right"), numberField(state.rebgRight ?? 0, (v) => { state.rebgRight = Math.max(0, v); persist(); }, 64)])]),
      ]));
      leftScroll.appendChild(panel([
        label("Expansion Edge Feathering (px)"),
        el("div", { text: "Expansion px > 0 일 때만 유효 — 원본/확장 경계를 블렌딩", style: { color: C.muted, fontSize: "10px", marginBottom: "4px" } }),
        numberField(state.rebgFeather ?? 40, (v) => { state.rebgFeather = Math.max(0, v); persist(); }, 4),
      ]));
      leftScroll.appendChild(panel([
        label("Background Denoise"),
        el("div", { text: "1.0 = 완전히 새 배경 생성 / 낮을수록 원본 배경 색감 유지", style: { color: C.muted, fontSize: "10px", marginBottom: "4px" } }),
        numberField(state.rebgDenoise ?? 1, (v) => { state.rebgDenoise = Math.max(0.5, Math.min(1, v)); persist(); }, 0.01),
      ]));
      leftScroll.appendChild(panel([label("Sampling"), samplingSection()]));
      leftScroll.appendChild(panel([label("LoRA"), loraSection()]));
    } else if (state.mode === "controlnet") {
      const cnSel = searchableSelect(["none"], state.controlnetModel, (v) => { state.controlnetModel = v; persist(); });
      api.getModels().then((d) => {
        const opts = d.model_patches?.length ? d.model_patches : ["none"];
        if (!opts.includes(state.controlnetModel)) { state.controlnetModel = opts[0]; persist(); }
        (cnSel.el.querySelector("select") as HTMLSelectElement)?.replaceChildren(...opts.map((o) => el("option", { value: o, text: o })));
        cnSel.setValue(state.controlnetModel);
      }).catch(() => {});
      leftScroll.appendChild(panel([label("ControlNet Union Model"), cnSel.el]));
      leftScroll.appendChild(panel([label("Reference Image"), imageUploadSlot(state.controlnetImage, (name) => { state.controlnetImage = name; persist(); })]));
      leftScroll.appendChild(panel([
        label("Control Type"),
        select([{ value: "depth", label: "Depth" }, { value: "canny", label: "Canny" }, { value: "pose", label: "Pose" }, { value: "hed", label: "HED" }, { value: "mlsd", label: "MLSD" }, { value: "none", label: "None (raw)" }], state.controlnetType || "depth", (v) => { state.controlnetType = v; persist(); }),
        label("Strength"),
        numberField(state.controlnetStrength ?? 1, (v) => { state.controlnetStrength = Math.max(0, Math.min(2, v)); persist(); }, 0.05),
        label("Preprocess Resolution"),
        numberField(state.controlnetResolution ?? 1024, (v) => { state.controlnetResolution = v; persist(); }, 64),
        label("Denoise"),
        numberField(state.controlnetDenoise ?? 1, (v) => { state.controlnetDenoise = Math.max(0.1, Math.min(1, v)); persist(); }, 0.01),
      ]));
      leftScroll.appendChild(panel([label("LoRA"), loraSection()]));
    } else if (state.mode === "face_redraw") {
      const detSel = searchableSelect(["none"], state.faceDetectorModel, (v) => { state.faceDetectorModel = v; persist(); });
      api.getModels().then((d) => {
        const opts = d.face_detectors?.length ? d.face_detectors : ["none"];
        if (!opts.includes(state.faceDetectorModel)) { state.faceDetectorModel = opts[0]; persist(); }
        (detSel.el.querySelector("select") as HTMLSelectElement)?.replaceChildren(...opts.map((o) => el("option", { value: o, text: o })));
        detSel.setValue(state.faceDetectorModel);
      }).catch(() => {});
      leftScroll.appendChild(panel([label("Face Detector (ultralytics/bbox)"), detSel.el]));
      leftScroll.appendChild(panel([label("Source Portrait"), imageUploadSlot(state.faceImage, (name) => { state.faceImage = name; persist(); })]));
      leftScroll.appendChild(panel([
        label("Detection Settings"),
        label("Threshold"),
        numberField(state.faceThreshold ?? 0.5, (v) => { state.faceThreshold = Math.max(0.1, Math.min(0.99, v)); persist(); }, 0.01),
        label("Dilation (px)"),
        numberField(state.faceDilation ?? 4, (v) => { state.faceDilation = v; persist(); }, 1),
      ]));
      leftScroll.appendChild(panel([
        label("Regeneration Settings"),
        label("Denoise"),
        numberField(state.faceDenoise ?? 0.5, (v) => { state.faceDenoise = Math.max(0.1, Math.min(1, v)); persist(); }, 0.01),
        label("Feather (px)"),
        numberField(state.faceFeather ?? 5, (v) => { state.faceFeather = Math.max(0, v); persist(); }, 1),
      ]));
      leftScroll.appendChild(panel([label("LoRA"), loraSection()]));
    }
  }
  renderLeftPanel();

  // ── External queue banner ─────────────────────────────────────────────
  function startQueuePolling() {
    setInterval(async () => {
      const q = await api.getQueueStatus();
      if (samplingActive) { externalQueueBanner.style.display = "none"; return; }
      if (queuedPromptId && (q.runningPromptIds.includes(queuedPromptId) || q.pendingPromptIds.includes(queuedPromptId))) {
        externalQueueBanner.style.display = "block";
        externalQueueBanner.textContent = q.pendingPromptIds.includes(queuedPromptId) ? "내 요청이 대기 중…" : "내 요청 실행 중…";
      } else if (q.running > 0 || q.pending > 0) {
        externalQueueBanner.style.display = "block";
        externalQueueBanner.textContent = `ComfyUI가 다른 작업을 처리 중입니다 (대기 ${q.pending}건)`;
      } else {
        externalQueueBanner.style.display = "none";
        queuedPromptId = null;
      }
    }, 4000);
  }
  startQueuePolling();

  // ── Generate / Stop — Krea2와 동일 방식 ────────────────────────────────
  async function generate() {
    if (samplingActive) return;
    if (!IMPLEMENTED_MODES.includes(state.mode)) { warnTag.textContent = "이 모드는 Phase 2에서 지원 예정입니다."; return; }
    if (!state.model) { warnTag.textContent = "⚙ Settings에서 Model / Text Encoder / VAE를 설정하세요"; return; }
    if (!state.textEncoder) { warnTag.textContent = "⚙ Settings에서 Text Encoder를 설정하세요"; return; }
    if (!state.vae) { warnTag.textContent = "⚙ Settings에서 VAE를 설정하세요"; return; }
    if (state.mode === "i2i" && !state.i2iImage) { warnTag.textContent = "I2I 소스 이미지를 업로드하세요"; return; }
    if (state.mode === "upscale" && !state.upscaleImage) { warnTag.textContent = "Upscale 소스 이미지를 업로드하세요"; return; }
    if (state.mode === "upscale" && (!state.upscaleDitModel || state.upscaleDitModel === "none" || !state.upscaleVaeModel || state.upscaleVaeModel === "none")) { warnTag.textContent = "SeedVR2 DiT/VAE 모델을 선택하세요"; return; }
    if (state.mode === "inpaint") {
      if (!state.inpaintImage) { warnTag.textContent = "Inpaint 소스 이미지를 업로드하세요"; return; }
      if (!state.inpaintMaskImage) {
        const saved = await inpaintAutoSave?.().catch(() => false);
        if (!saved) { warnTag.textContent = "마스크를 칠하고 저장하세요"; return; }
      }
    }
    if (state.mode === "rebg") {
      if (!state.rebgImage) { warnTag.textContent = "Redraw-BG 소스 이미지를 업로드하세요"; return; }
      if (!state.rebgBgModel || state.rebgBgModel === "none") { warnTag.textContent = "BG Removal 모델을 선택하세요"; return; }
    }
    if (state.mode === "controlnet") {
      if (!state.controlnetImage) { warnTag.textContent = "ControlNet 참조 이미지를 업로드하세요"; return; }
      if (!state.controlnetModel || state.controlnetModel === "none") { warnTag.textContent = "ControlNet Union 모델을 선택하세요"; return; }
    }
    if (state.mode === "face_redraw") {
      if (!state.faceImage) { warnTag.textContent = "Face Redraw 소스 이미지를 업로드하세요"; return; }
      if (!state.faceDetectorModel || state.faceDetectorModel === "none") { warnTag.textContent = "Face Detector 모델을 선택하세요"; return; }
    }
    warnTag.textContent = "";

    if (state.seedMode === "randomize") { state.seed = randomSeed(); seedInput.value = String(state.seed); }
    else if (state.seedMode === "increment") { state.seed = (state.seed || 0) + 1; seedInput.value = String(state.seed); }
    else if (state.seedMode === "decrement") { state.seed = Math.max(0, (state.seed || 0) - 1); seedInput.value = String(state.seed); }
    persist();

    samplingActive = true;
    genBtn.style.display = "none";
    stopBtn.style.display = "block";
    statusText.textContent = "Queuing…";
    progressInner.style.width = "0%";
    externalQueueBanner.style.display = "none";

    try {
      const graph = buildGraph(state);
      const result = await queuePrompt(graph, {
        onProgress: (v, m) => {
          statusText.textContent = `Sampling ${v}/${m}`;
          progressInner.style.width = `${Math.round((v / m) * 100)}%`;
        },
      });
      const out = Object.values(result.byNode).find((o: any) => o.images?.length) as any;
      if (out) {
        const im = out.images[0];
        modeResults[state.mode] = { filename: im.filename, subfolder: im.subfolder || "", type: im.type || "output" };
        restorePreviewForMode();
        renderSendTo();
        if (state.outputMode !== "preview") {
          await api.saveMeta(im.filename, im.subfolder || "", { ...state, prompt: getModePrompt(state, state.mode) }).catch(() => {});
        }
      }
      statusText.textContent = "Done";
      progressInner.style.width = "100%";
    } catch (e: any) {
      statusText.textContent = `Error: ${e.message || e}`;
    } finally {
      samplingActive = false;
      genBtn.style.display = "block";
      stopBtn.style.display = "none";
    }
  }

  function stopGeneration() {
    api.interrupt().catch(() => {});
    statusText.textContent = "Stopping…";
    window.setTimeout(() => {
      if (samplingActive) {
        samplingActive = false;
        genBtn.style.display = "block";
        stopBtn.style.display = "none";
        statusText.textContent = "Stopped";
      }
    }, 6000);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (promptExpandOv.el.style.display !== "none") { promptExpandOv.hide(); return; }
    if (templateOv.el.style.display !== "none") { templateOv.hide(); return; }
    if (helpOv.el.style.display !== "none") { helpOv.hide(); return; }
    if (settingsOv.el.style.display !== "none") { settingsOv.hide(); return; }
    if (galleryOv.el.style.display !== "none") { galleryOv.hide(); return; }
  });
}

function createHelpOverlay() {
  const ov = el("div", { style: { position: "fixed", inset: "0", zIndex: "10001", background: "rgba(0,0,0,0.85)", display: "none", alignItems: "center", justifyContent: "center" } });
  const box = el("div", { style: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "16px", width: "min(640px, 92vw)", maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" } });
  const hdr = el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
  hdr.append(el("div", { text: "❔ Z-Image Turbo 도움말", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }), button("✕", () => (ov.style.display = "none"), "danger"));
  const body = el("div", { style: { color: C.text, fontSize: "12px", lineHeight: "1.7" } });
  body.innerHTML = `
    <b>모드</b>: T2I, I2I, Upscale(SeedVR2)가 현재 구현되어 있습니다. Inpaint/Re-BG/ControlNet/Face Redraw는 곧 추가됩니다.<br>
    <b>프롬프트</b>: 📋 Templates에서 스타일/각도/조명 템플릿을 적용하거나, 🔍 Expand/LLM에서 로컬 LLM으로 프롬프트를 보강하거나 이미지를 프롬프트로 변환할 수 있습니다.<br>
    <b>상단 아이콘</b>: ↺ Reset(전체 초기화, 모델 선택은 유지) · ⇌ Compare(원본/결과 비교) · 🗑 Unload VRAM · ⚙ Settings · 🖼 Gallery.
  `;
  box.append(hdr, body);
  ov.appendChild(box);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.style.display = "none"; });
  return { el: ov, show() { ov.style.display = "flex"; }, hide() { ov.style.display = "none"; } };
}
