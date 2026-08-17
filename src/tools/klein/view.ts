// view.ts — Flux2 Klein 메인 화면 조립. Krea2/Z-Image와 완전히 동일한 레이아웃/상호작용
// 패턴(450px 좌측 패널, 180px 프롬프트, Generate/Stop 동일 위치)을 재사용하되, Klein 고유
// 기능(KV Cache 토글, Inpaint↔Outpaint 서브모드, Edit 다중 레퍼런스, Faceswap 전용 LoRA)을 추가한다.
import type { KleinState, KleinMode, PaintSubMode } from "./core";
import {
  C, el, clear, BRAND, MODES, RESOLUTIONS, SAMPLERS, SCHEDULERS,
  LORA_UI_CAP, MAX_EDIT_REFS, SEEDVR2_ATTN_MODES, SEEDVR2_COLOR_MODES, SEND_TO,
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

export function renderKlein(root: HTMLElement) {
  clear(root);
  root.className = "flex-1 min-h-0 flex flex-col";
  root.style.background = C.bg0;

  const state: KleinState = defaultState(loadState());
  let availableLoras: string[] = [];
  let samplingActive = false;
  let queuedPromptId: string | null = null;
  const appConfig: AppConfig = { output_mode_visible: true };

  function persist() { saveState(state); }

  const wrap = el("div", { style: { flex: "1", minHeight: "0", display: "flex", flexDirection: "column", padding: "10px", gap: "8px", boxSizing: "border-box" } });
  root.appendChild(wrap);

  // ── Sub bar: 모드 pill + KV + 아이콘들 ─────────────────────────────────────
  const subBar = el("div", { style: { display: "flex", alignItems: "center", gap: "10px", flexShrink: "0" } });
  const modeBarWrap = el("div");
  function renderModeBar() {
    clear(modeBarWrap);
    modeBarWrap.appendChild(
      modeBar(MODES.map((m) => ({ key: m.key, label: m.label })), state.mode, (key) => {
        state.mode = key as KleinMode;
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

  // KV Cache 토글 — Klein 고유: auto(모델명에 kv 포함시 사용)/on/off 순환.
  const kvBtn = iconBtn("KV A", "Flux KV Cache: Auto/On/Off", () => {
    const next = state.kvCacheOverride === "off" ? "auto" : state.kvCacheOverride === "auto" ? "on" : "off";
    state.kvCacheOverride = next;
    persist();
    updateKvBtn();
  });
  function updateKvBtn() {
    const ov = state.kvCacheOverride;
    const isOn = ov === "on" || (ov === "auto" && (state.model || "").toLowerCase().includes("kv"));
    kvBtn.textContent = ov === "auto" ? "KV A" : ov === "on" ? "KV ✓" : "KV ✗";
    kvBtn.style.cssText += `font-size:9px;font-weight:700;min-width:34px;border-radius:6px;padding:4px 8px;`;
    if (isOn) {
      kvBtn.style.background = "#ffffff"; kvBtn.style.color = BRAND; kvBtn.style.border = `2px solid ${BRAND}`;
    } else {
      kvBtn.style.background = C.bg2; kvBtn.style.color = C.muted; kvBtn.style.border = `1px solid ${C.border}`;
    }
  }
  updateKvBtn();

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
  subBar.append(modeBarWrap, warnTag, spacer, kvBtn, resetBtn, compareBtn, unloadBtn, settingsBtn, galleryBtn, helpBtn);
  wrap.appendChild(subBar);

  // ── Body: 좌측 패널(Krea2/Z-Image와 동일 450px) + 우측 프리뷰 ────────────────
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
    if (!zoomEnabled || !modeResults[resultKey()] || compareViewEl) return;
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

  // PAINT 모드는 서브모드별로 결과/소스가 달라야 하므로 결과 캐시 키에 서브모드를 포함한다.
  function resultKey(): string {
    return state.mode === "inpaint" ? `inpaint:${state.paintSubMode}` : state.mode;
  }
  function currentSourceFilename(): string {
    if (state.mode === "i2i") return state.i2iImage || "";
    if (state.mode === "edit") return state.editImage1 || "";
    if (state.mode === "inpaint") return (state.paintSubMode === "outpaint" ? state.outpaintImage : state.inpaintImage) || "";
    if (state.mode === "faceswap") return state.faceswapTarget || "";
    if (state.mode === "upscale") return state.upscaleImage || "";
    return "";
  }

  // ── Compare view — Krea2/Z-Image에서 검증된 clip-path 방식 ─────────────────
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
    const mr = modeResults[resultKey()];
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
  clearBtn.addEventListener("click", () => { delete modeResults[resultKey()]; resetZoom(); restorePreviewForMode(); renderSendTo(); });
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
        const mr = modeResults[resultKey()];
        if (!mr) return;
        (btn as HTMLButtonElement).disabled = true;
        btn.textContent = "Copying…";
        try {
          const n = await api.copyOutputToInput(mr.filename, mr.subfolder || "", mr.type || "output");
          (state as any)[t.field] = n;
          // 원본: inpaint/outpaint 이미지는 같은 소스를 공유 — 한쪽으로 보내면 다른쪽도 갱신.
          if (t.field === "inpaintImage") state.outpaintImage = n;
          if (t.field === "outpaintImage") state.inpaintImage = n;
          if (t.mode === state.mode) {
            if (t.subMode && t.subMode !== state.paintSubMode) { state.paintSubMode = t.subMode; }
            persist();
            renderLeftPanel();
          } else {
            if (t.subMode) state.paintSubMode = t.subMode;
            state.mode = t.mode;
            persist();
            renderModeBar();
            renderLeftPanel();
          }
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

  // ── Prompt box ──────────────────────────────────────────────────────────
  const promptWrap = el("div", { style: { flexShrink: "0", display: "flex", flexDirection: "column", gap: "6px" } });
  const promptHdr = el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } });
  const charCount = el("span", { style: { color: C.muted, fontSize: "10px" } });
  promptHdr.append(el("div", { text: "PROMPT", style: { color: C.muted, fontSize: "11px", flex: "1", textTransform: "uppercase", letterSpacing: "0.04em" } }), charCount);
  const templatesBtn = button("📋 Templates", () => templateOv.show());
  const expandBtn = button("🔍 Expand / LLM", () => promptExpandOv.show());
  promptHdr.append(templatesBtn, expandBtn);

  const promptTA = el("textarea", { placeholder: state.mode === "inpaint" && state.paintSubMode === "outpaint" ? "Scene description only — system prompt is auto-added" : "Describe what you want to generate…", style: { width: "100%", boxSizing: "border-box", background: C.bg1, color: C.text, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "9px", fontSize: "13px", fontFamily: "inherit", resize: "vertical", minHeight: "180px", outline: "none" } });
  function updatePromptCount() {
    const n = getModePrompt(state, state.mode).trim().length;
    charCount.textContent = ` (${n} chars${n < 30 ? " ⚠" : ""})`;
    charCount.style.color = n < 30 ? C.warn : C.muted;
  }
  function refreshPromptBox() {
    promptTA.value = getModePrompt(state, state.mode);
    promptTA.placeholder = state.mode === "inpaint" && state.paintSubMode === "outpaint" ? "Scene description only — system prompt is auto-added" : "Describe what you want to generate…";
    updatePromptCount();
  }
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

  // ── Seed + Mode + Generate/Stop — Krea2/Z-Image와 동일하게 좌측 최하단 고정 ──
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
    onModelsRefreshed: () => { renderLeftPanel(); updateKvBtn(); },
    onOutputVisibilityChanged: () => renderOutputToggle(),
  } as any);
  wrap.style.position = "relative";
  wrap.appendChild(settingsOv.el);

  const galleryOv = createGalleryOverlay(
    state,
    (meta: any) => { applyReuseMeta(meta); },
    (mode: string, field: string, extra: string | undefined, filename: string) => {
      (state as any)[field] = filename;
      if (field === "inpaintImage") state.outpaintImage = filename;
      if (field === "outpaintImage") state.inpaintImage = filename;
      if (extra) state.paintSubMode = extra as PaintSubMode;
      state.mode = mode as KleinMode;
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

  async function resetAllSettings() {
    if (!(await confirmDialog("Reset all settings? Model selection is preserved."))) return;
    const { model, textEncoder, vae } = state;
    Object.assign(state, defaultState({}));
    if (model) state.model = model;
    if (textEncoder) state.textEncoder = textEncoder;
    if (vae) state.vae = vae;
    persist();
    renderModeBar();
    renderLeftPanel();
    refreshPromptBox();
    renderSendTo();
    restorePreviewForMode();
    updateKvBtn();
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
    updateKvBtn();
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

  function loraSection(loras: () => KleinState["loras"]) {
    const wrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } });
    function rebuild() {
      clear(wrap);
      loras().forEach((l, i) => {
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
        const delBtn = iconBtn("✕", "Remove", () => { loras().splice(i, 1); persist(); rebuild(); });
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
      if (loras().length < LORA_UI_CAP) {
        wrap.appendChild(button(`+ Add LoRA (max ${LORA_UI_CAP})`, () => { loras().push({ name: "none", strength: 1, triggerWord: "", enabled: true }); persist(); rebuild(); }));
      }
    }
    rebuild();
    return wrap;
  }

  // Faceswap 전용 단일 LoRA 슬롯 (state.loras와 독립, 최대 1개) — 원본 mountFaceswapLoraSection.
  function bfsLoraSection() {
    const wrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } });
    function rebuild() {
      clear(wrap);
      const lora = state.bfsLora;
      if (lora) {
        const nameOpts = ["none", ...availableLoras.filter((n) => n !== "none")];
        const nameSel = searchableSelect(nameOpts, lora.name || "none", (v) => { lora.name = v; persist(); });
        const strIn = numberField(lora.strength ?? 1, (v) => { lora.strength = v; persist(); }, 0.05);
        const enChk = checkboxRow("on", lora.enabled !== false, (v) => { lora.enabled = v; persist(); });
        const delBtn = iconBtn("✕", "Remove", () => { state.bfsLora = null; persist(); rebuild(); });
        wrap.appendChild(panel([
          el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } }, [
            el("div", { text: "FACE LORA", style: { color: C.muted, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em" } }),
            el("div", { style: { flex: "1" } }), enChk, delBtn,
          ]),
          nameSel.el,
          col([label("Strength"), strIn]),
        ]));
      } else {
        wrap.appendChild(button("+ Add Face LoRA", () => { state.bfsLora = { name: "none", strength: 1, triggerWord: "", enabled: true }; persist(); rebuild(); }));
      }
    }
    rebuild();
    return wrap;
  }

  function imageUploadSlot(currentFilename: string | null, onSet: (name: string) => void, onLoad?: (w: number, h: number) => void, probeIfUnknown?: boolean) {
    const wrap = el("div", { style: { border: `2px dashed ${C.border}`, borderRadius: "8px", padding: "8px", textAlign: "center", cursor: "pointer", minHeight: "180px", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", background: C.bg2 } });
    const img = el("img", { style: { maxWidth: "100%", maxHeight: "168px", display: "none", borderRadius: "4px" } });
    const hint = el("div", { text: "클릭 또는 드래그하여 업로드", style: { color: C.muted, fontSize: "11px" } });
    const fileIn = el("input", { type: "file", accept: "image/*", style: { display: "none" } });
    wrap.append(hint, img, fileIn);
    const clearBtn = el("button", { type: "button", text: "✕", title: "삭제", style: { position: "absolute", top: "4px", right: "4px", zIndex: "3", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", borderRadius: "4px", width: "20px", height: "20px", cursor: "pointer", fontSize: "11px", padding: "0", display: "none" } });
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      img.style.display = "none";
      img.src = "";
      hint.style.display = "";
      clearBtn.style.display = "none";
      onSet("");
    });
    wrap.appendChild(clearBtn);
    async function handleFile(file: File) {
      hint.textContent = "업로드 중…";
      try {
        const name = await api.uploadImage(file, file.name);
        onSet(name);
        const url = api.viewUrl(name, "", "input", Date.now());
        img.src = url;
        img.style.display = "block";
        hint.style.display = "none";
        clearBtn.style.display = "block";
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
      clearBtn.style.display = "block";
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
      clearBtn.style.display = "block";
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
        col([label("Steps"), numberField(state.steps, (v) => { state.steps = Math.max(1, Math.round(v) || 1); persist(); })]),
        col([label("CFG"), numberField(state.cfg, (v) => { state.cfg = Math.max(0, v || 0); persist(); }, 0.1)]),
      ]),
      row([col([label("Sampler"), select(SAMPLERS, state.sampler, (v) => { state.sampler = v; persist(); })]), col([label("Scheduler"), select(SCHEDULERS, state.scheduler, (v) => { state.scheduler = v; persist(); })])]),
    ]);
  }

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
      leftScroll.appendChild(panel([label("LoRA"), loraSection(() => state.loras)]));
    } else if (state.mode === "i2i") {
      leftScroll.appendChild(panel([
        label("Source Image"),
        imageUploadSlot(state.i2iImage, (name) => { state.i2iImage = name; persist(); }, (w, h) => { state.i2iWidth = snap8(w); state.i2iHeight = snap8(h); persist(); renderLeftPanel(); }, !state.i2iWidth || !state.i2iHeight),
        sizeFields(() => state.i2iWidth, (v) => (state.i2iWidth = v), () => state.i2iHeight, (v) => (state.i2iHeight = v), () => state.i2iLockRatio, (v) => (state.i2iLockRatio = v)),
      ]));
      leftScroll.appendChild(panel([label("Denoise"), numberField(state.i2iDenoise, (v) => { state.i2iDenoise = Math.max(0, Math.min(1, v)); persist(); }, 0.01)]));
      leftScroll.appendChild(panel([label("Sampling"), samplingSection()]));
      leftScroll.appendChild(panel([label("LoRA"), loraSection(() => state.loras)]));
    } else if (state.mode === "edit") {
      leftScroll.appendChild(panel([label("Ref Image 1 (main)"), imageUploadSlot(state.editImage1, (name) => { state.editImage1 = name; persist(); })]));
      state.editRefImages.forEach((imgState, i) => {
        const removeBtn = iconBtn("✕", "Remove", () => { state.editRefImages.splice(i, 1); persist(); renderLeftPanel(); });
        removeBtn.style.cssText += "position:absolute;top:6px;left:6px;z-index:2;background:rgba(180,0,0,0.85);border-radius:50%;width:20px;height:20px;padding:0;";
        const card = el("div", { style: { position: "relative" } }, [
          removeBtn,
          panel([label(`Ref Image ${i + 2}`), imageUploadSlot(imgState.filename, (name) => { imgState.filename = name; persist(); })]),
        ]);
        leftScroll.appendChild(card);
      });
      if (state.editRefImages.length < MAX_EDIT_REFS - 1) {
        leftScroll.appendChild(button("+ Add Ref Image", () => { state.editRefImages.push({ filename: null }); persist(); renderLeftPanel(); }));
      }
      leftScroll.appendChild(panel([
        label("Output Size Source"),
        select([{ value: "img1", label: "Match Image 1 size" }, { value: "manual", label: "Manual" }], state.editSizeSource || "img1", (v) => { state.editSizeSource = v; persist(); }),
      ]));
      leftScroll.appendChild(panel([label("Sampling"), samplingSection()]));
      leftScroll.appendChild(panel([label("LoRA"), loraSection(() => state.loras)]));
    } else if (state.mode === "inpaint") {
      const subRow = row([
        button("Inpaint", () => { state.paintSubMode = "inpaint"; persist(); renderLeftPanel(); refreshPromptBox(); restorePreviewForMode(); renderSendTo(); }, state.paintSubMode === "inpaint" ? "primary" : "default"),
        button("Outpaint", () => { state.paintSubMode = "outpaint"; persist(); renderLeftPanel(); refreshPromptBox(); restorePreviewForMode(); renderSendTo(); }, state.paintSubMode === "outpaint" ? "primary" : "default"),
      ]);
      leftScroll.appendChild(panel([subRow]));

      const sharedImage = state.paintSubMode === "outpaint" ? state.outpaintImage : state.inpaintImage;
      leftScroll.appendChild(panel([
        label("Source Image"),
        imageUploadSlot(sharedImage, (name) => { state.inpaintImage = name; state.outpaintImage = name; state.inpaintMaskImage = null; persist(); if (state.paintSubMode === "inpaint") { editor?.loadSourceImage(name); } }),
      ]));

      let editor: ReturnType<typeof createMaskEditor> | null = null;
      if (state.paintSubMode === "inpaint") {
        editor = createMaskEditor(state, persist);
        leftScroll.appendChild(panel([label("Mask Editor (보라=재생성 / 검=유지)"), editor.editorPanel]));
        if (state.inpaintImage) editor.loadSourceImage(state.inpaintImage);
        inpaintAutoSave = editor.autoSaveIfNeeded;
        leftScroll.appendChild(panel([label("Denoise"), numberField(state.inpaintDenoise ?? 0.85, (v) => { state.inpaintDenoise = Math.max(0.1, Math.min(1, v)); persist(); }, 0.01)]));
      } else {
        inpaintAutoSave = null;
        leftScroll.appendChild(panel([
          label("Expansion (px)"),
          row([col([label("Up"), numberField(state.outpaintUp ?? 0, (v) => { state.outpaintUp = Math.max(0, v); persist(); }, 64)]), col([label("Down"), numberField(state.outpaintDown ?? 0, (v) => { state.outpaintDown = Math.max(0, v); persist(); }, 64)])]),
          row([col([label("Left"), numberField(state.outpaintLeft ?? 0, (v) => { state.outpaintLeft = Math.max(0, v); persist(); }, 64)]), col([label("Right"), numberField(state.outpaintRight ?? 0, (v) => { state.outpaintRight = Math.max(0, v); persist(); }, 64)])]),
        ]));
        leftScroll.appendChild(panel([
          label("Pad Color (R G B)"),
          row([
            col([label("R"), numberField(state.outpaintPadR ?? 0, (v) => { state.outpaintPadR = Math.max(0, Math.min(255, Math.round(v))); persist(); }, 1)]),
            col([label("G"), numberField(state.outpaintPadG ?? 0, (v) => { state.outpaintPadG = Math.max(0, Math.min(255, Math.round(v))); persist(); }, 1)]),
            col([label("B"), numberField(state.outpaintPadB ?? 0, (v) => { state.outpaintPadB = Math.max(0, Math.min(255, Math.round(v))); persist(); }, 1)]),
          ]),
        ]));
      }
      leftScroll.appendChild(panel([label("Sampling"), samplingSection()]));
      leftScroll.appendChild(panel([label("LoRA"), loraSection(() => state.loras)]));
    } else if (state.mode === "faceswap") {
      leftScroll.appendChild(panel([label("Target Image (scene)"), imageUploadSlot(state.faceswapTarget, (name) => { state.faceswapTarget = name; persist(); })]));
      leftScroll.appendChild(panel([label("Source Face"), imageUploadSlot(state.faceswapSource, (name) => { state.faceswapSource = name; persist(); })]));
      leftScroll.appendChild(panel([label("Denoise"), numberField(state.faceswapDenoise ?? 1, (v) => { state.faceswapDenoise = Math.max(0, Math.min(1, v)); persist(); }, 0.01)]));
      leftScroll.appendChild(panel([label("Sampling"), samplingSection()]));
      leftScroll.appendChild(el("div", { text: "⚠ Face LoRA는 일반 LoRA와 별도로 최대 1개만 적용됩니다.", style: { color: "#FFD700", fontSize: "11px", fontWeight: "600", padding: "6px 8px", background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.3)", borderRadius: "6px" } }));
      leftScroll.appendChild(panel([label("Face LoRA"), bfsLoraSection()]));
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
    }
  }

  // Inpaint 모드는 마스크를 그려야 해서 beforeGenerate에서 자동 저장 훅이 필요.
  let inpaintAutoSave: (() => Promise<boolean>) | null = null;
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

  // ── Generate / Stop ────────────────────────────────────────────────────
  async function generate() {
    if (samplingActive) return;
    if (!state.model || state.model === "none") { warnTag.textContent = "⚙ Settings에서 Model / Text Encoder / VAE를 설정하세요"; return; }
    if (!state.textEncoder || state.textEncoder === "none") { warnTag.textContent = "⚙ Settings에서 Text Encoder를 설정하세요"; return; }
    if (!state.vae || state.vae === "none") { warnTag.textContent = "⚙ Settings에서 VAE를 설정하세요"; return; }
    if (state.mode === "i2i" && !state.i2iImage) { warnTag.textContent = "I2I 소스 이미지를 업로드하세요"; return; }
    if (state.mode === "edit" && !state.editImage1) { warnTag.textContent = "Edit 모드에 Image 1을 업로드하세요"; return; }
    if (state.mode === "faceswap") {
      if (!state.faceswapTarget) { warnTag.textContent = "Faceswap Target 이미지를 업로드하세요"; return; }
      if (!state.faceswapSource) { warnTag.textContent = "Faceswap Source Face 이미지를 업로드하세요"; return; }
    }
    if (state.mode === "inpaint") {
      if (state.paintSubMode === "inpaint") {
        if (!state.inpaintImage) { warnTag.textContent = "Inpaint 소스 이미지를 업로드하세요"; return; }
        if (!state.inpaintMaskImage) {
          const saved = await inpaintAutoSave?.().catch(() => false);
          if (!saved) { warnTag.textContent = "마스크를 칠하고 저장하세요"; return; }
        }
      } else {
        if (!state.outpaintImage) { warnTag.textContent = "Outpaint 소스 이미지를 업로드하세요"; return; }
        const total = (state.outpaintUp || 0) + (state.outpaintDown || 0) + (state.outpaintLeft || 0) + (state.outpaintRight || 0);
        if (total <= 0) { warnTag.textContent = "최소 한 방향의 Expansion 값을 입력하세요"; return; }
      }
    }
    if (state.mode === "upscale") {
      if (!state.upscaleImage) { warnTag.textContent = "Upscale 소스 이미지를 업로드하세요"; return; }
      if (!state.upscaleDitModel || state.upscaleDitModel === "none" || !state.upscaleVaeModel || state.upscaleVaeModel === "none") { warnTag.textContent = "SeedVR2 DiT/VAE 모델을 선택하세요"; return; }
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
      const graph = await buildGraph(state);
      const result = await queuePrompt(graph, {
        onProgress: (v, m) => {
          statusText.textContent = `Sampling ${v}/${m}`;
          progressInner.style.width = `${Math.round((v / m) * 100)}%`;
        },
      });
      const out = Object.values(result.byNode).find((o: any) => o.images?.length) as any;
      if (out) {
        const im = out.images[0];
        modeResults[resultKey()] = { filename: im.filename, subfolder: im.subfolder || "", type: im.type || "output" };
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
  hdr.append(el("div", { text: "❔ Flux2 Klein 도움말", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }), button("✕", () => (ov.style.display = "none"), "danger"));
  const body = el("div", { style: { color: C.text, fontSize: "12px", lineHeight: "1.7" } });
  body.innerHTML = `
    <b>모드</b>: T2I, I2I, Edit(다중 레퍼런스 이미지), PAINT(Inpaint/Outpaint 서브모드), Faceswap, Upscale(SeedVR2).<br>
    <b>PAINT 모드</b>: 상단 Inpaint/Outpaint 버튼으로 전환합니다. Inpaint는 브러시로 마스크를 그리고, Outpaint는 확장 방향(px)과 패딩 색을 지정합니다.<br>
    <b>KV Cache</b>: 상단 "KV" 버튼으로 Auto/On/Off 순환 — Auto는 모델명에 "kv"가 포함된 경우에만 사용합니다.<br>
    <b>Faceswap</b>: Target(장면) + Source(얼굴) 이미지가 필요하며, 전용 Face LoRA는 일반 LoRA와 별도로 최대 1개까지 적용됩니다.<br>
    <b>프롬프트</b>: 📋 Templates에서 스타일 템플릿을 적용하거나, 🔍 Expand/LLM에서 로컬 LLM으로 프롬프트를 보강할 수 있습니다.<br>
    <b>상단 아이콘</b>: ↺ Reset(전체 초기화, 모델 선택 유지) · ⇌ Compare(원본/결과 비교) · 🗑 Unload VRAM · ⚙ Settings · 🖼 Gallery.
  `;
  box.append(hdr, body);
  ov.appendChild(box);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.style.display = "none"; });
  return { el: ov, show() { ov.style.display = "flex"; }, hide() { ov.style.display = "none"; } };
}
