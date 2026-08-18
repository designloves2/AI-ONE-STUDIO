// view.ts — Anima 메인 화면 조립. Z-Image의 레이아웃(450px 좌측 패널, 180px 프롬프트,
// Send-to/Compare/Reset/Unload/Settings/Gallery/Help 패턴)을 그대로 따르되, Anima 고유의 4모드
// (T2I/Inpainting/Any Control/Depth Control)와 TURBO 토글(Steps/CFG 자동 전환)을 반영한다.
import type { AnimaState, AnimaMode } from "./core";
import {
  C, el, clear, BRAND, MODES, RESOLUTIONS, SAMPLERS, SCHEDULERS, SEND_TO,
  BASE_STEPS, BASE_CFG, TURBO_STEPS, TURBO_CFG,
  defaultState, loadState, saveState, getModePrompt, setModePrompt, randomSeed,
} from "./core";
import { panel, label, button, select, numberField, row, col, modeBar, iconBtn, checkboxRow, openFullscreen, confirmDialog, applyMobileCollapsibleLayout } from "../../shared/ui";
import * as api from "./api";
import { openImageGalleryPicker } from "../../shared/imageGalleryPicker";
import { buildT2IGraph, buildInpaintGraph, buildAnyControlGraph, buildDepthControlGraph } from "./graphBuilder";
import { queuePrompt } from "./comfyClient";
import type { AppConfig } from "./settings";
import { createSettingsOverlay } from "./settings";
import { createGalleryOverlay } from "./galleryOverlay";
import { createPromptExpandOverlay, createTemplateOverlay } from "./promptTools";
import { createMaskEditor } from "./maskEditor";

export function renderAnima(root: HTMLElement) {
  clear(root);
  root.className = "flex-1 min-h-0 flex flex-col";
  root.style.background = C.bg0;

  const state: AnimaState = defaultState(loadState());
  let availableLoras: string[] = [];
  let samplingActive = false;
  const appConfig: AppConfig = { output_mode_visible: true };

  function persist() { saveState(state); }

  const wrap = el("div", { style: { flex: "1", minHeight: "0", display: "flex", flexDirection: "column", padding: "10px", gap: "8px", boxSizing: "border-box" } });
  root.appendChild(wrap);

  const subBar = el("div", { class: "aos-sub-bar", style: { display: "flex", alignItems: "center", gap: "10px", flexShrink: "0" } });
  const modeBarWrap = el("div", { class: "aos-mode-bar-wrap" });
  function renderModeBar() {
    clear(modeBarWrap);
    modeBarWrap.appendChild(
      modeBar(MODES.map((m) => ({ key: m.key, label: m.label })), state.mode, (key) => {
        state.mode = key as AnimaMode;
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

  const body = el("div", { style: { flex: "1", minHeight: "0", display: "flex", gap: "10px" } });
  wrap.appendChild(body);

  const leftPanel = el("div", { style: { width: "450px", flexShrink: "0", display: "flex", flexDirection: "column", minHeight: "0" } });
  const leftScroll = el("div", { style: { flex: "1", minHeight: "0", overflowY: "auto", paddingRight: "4px" } });
  const leftBottomBar = el("div", { style: { flexShrink: "0", paddingTop: "8px" } });
  leftPanel.append(leftScroll, leftBottomBar);
  body.appendChild(leftPanel);

  const rightPanel = el("div", { style: { flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "8px" } });
  body.appendChild(rightPanel);

  const previewBox = el("div", { class: "aos-preview-box", style: { flex: "1", minHeight: "0", background: "#000", border: `1px solid ${C.border}`, borderRadius: "10px", position: "relative", overflow: "hidden" } });
  const placeholderTxt = el("div", { text: "결과 이미지가 여기에 표시됩니다", style: { position: "absolute", inset: "0", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: "13px" } });
  const resultImg = el("img", { style: { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain", display: "none" } });
  resultImg.addEventListener("dblclick", () => { if (resultImg.src) openFullscreen(resultImg.src, "image"); });
  const clearBtn = el("button", { type: "button", text: "✕", title: "Clear result", style: { position: "absolute", top: "6px", right: "6px", zIndex: "5", background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", borderRadius: "4px", width: "22px", height: "22px", cursor: "pointer", fontSize: "12px", padding: "0", display: "none" } });
  const zoomLockBtn = el("button", { type: "button", text: "🔓", title: "Scroll zoom on/off", style: { position: "absolute", top: "6px", right: "32px", zIndex: "5", background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", borderRadius: "4px", width: "22px", height: "22px", cursor: "pointer", fontSize: "11px", padding: "0", display: "none" } });
  previewBox.append(placeholderTxt, resultImg, zoomLockBtn, clearBtn);
  rightPanel.appendChild(previewBox);

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
    if (state.mode === "inpaint") return state.inpaintImage;
    if (state.mode === "anycontrol") return state.anyControlImage;
    if (state.mode === "depthcontrol") return state.depthControlImage;
    return "";
  }

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
  statusWrap.append(statusText, progressOuter);
  rightPanel.appendChild(statusWrap);

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
    charCount.textContent = ` (${n} chars${n < 10 ? " ⚠" : ""})`;
    charCount.style.color = n < 10 ? C.warn : C.muted;
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
      state.mode = mode as AnimaMode;
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
    const { model, previewModel, textEncoder, vae, turboLora } = state;
    Object.assign(state, defaultState({}));
    if (model) state.model = model;
    if (previewModel) state.previewModel = previewModel;
    if (textEncoder) state.textEncoder = textEncoder;
    if (vae) state.vae = vae;
    if (turboLora) state.turboLora = turboLora;
    persist();
    Object.keys(modeResults).forEach((k) => delete modeResults[k]);
    renderModeBar();
    renderLeftPanel();
    refreshPromptBox();
    renderSendTo();
    restorePreviewForMode();
    seedInput.value = String(state.seed ?? 0);
  }

  async function unloadVram() {
    unloadBtn.style.opacity = "0.5";
    try { await fetch("/free", { method: "POST" }); }
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

  function imageUploadSlot(currentFilename: string, onSet: (name: string) => void) {
    const wrap = el("div", { style: { border: `2px dashed ${C.border}`, borderRadius: "8px", padding: "8px", textAlign: "center", cursor: "pointer", minHeight: "180px", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", background: C.bg2 } });
    const img = el("img", { style: { maxWidth: "100%", maxHeight: "168px", display: "none", borderRadius: "4px" } });
    const hint = el("div", { text: "클릭 또는 드래그하여 업로드", style: { color: C.muted, fontSize: "11px" } });
    const fileIn = el("input", { type: "file", accept: "image/*", style: { display: "none" } });
    wrap.append(hint, img, fileIn);
    const clearImgBtn = el("button", { type: "button", text: "✕", title: "삭제", style: { position: "absolute", top: "4px", right: "4px", zIndex: "3", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", borderRadius: "4px", width: "20px", height: "20px", cursor: "pointer", fontSize: "11px", padding: "0", display: "none" } });
    clearImgBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      img.style.display = "none";
      img.src = "";
      hint.style.display = "";
      clearImgBtn.style.display = "none";
      onSet("");
    });
    wrap.appendChild(clearImgBtn);

    function applyPicked(name: string) {
      onSet(name);
      const url = api.viewUrl(name, "", "input", Date.now());
      img.src = url;
      img.style.display = "block";
      hint.style.display = "none";
      clearImgBtn.style.display = "block";
    }
    async function handleFile(file: File) {
      hint.textContent = "업로드 중…";
      try {
        const name = await api.uploadImage(file, file.name);
        applyPicked(name);
      } catch (e: any) { hint.textContent = "업로드 실패: " + (e.message || e); }
    }
    const galleryPickBtn = el("button", { type: "button", text: "🖼", title: "갤러리에서 선택", style: { position: "absolute", bottom: "4px", left: "4px", zIndex: "3", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", borderRadius: "4px", width: "22px", height: "22px", cursor: "pointer", fontSize: "12px", padding: "0" } });
    galleryPickBtn.addEventListener("click", (e) => { e.stopPropagation(); openImageGalleryPicker((name) => applyPicked(name)); });
    wrap.appendChild(galleryPickBtn);

    wrap.addEventListener("click", () => fileIn.click());
    fileIn.addEventListener("change", () => { if (fileIn.files?.[0]) handleFile(fileIn.files[0]); });
    wrap.addEventListener("dragover", (e) => { e.preventDefault(); wrap.style.borderColor = BRAND; });
    wrap.addEventListener("dragleave", () => { wrap.style.borderColor = C.border; });
    wrap.addEventListener("drop", (e) => { e.preventDefault(); wrap.style.borderColor = C.border; const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f); });

    if (currentFilename) {
      img.src = api.viewUrl(currentFilename, "", "input");
      img.style.display = "block";
      hint.style.display = "none";
      clearImgBtn.style.display = "block";
    }
    return wrap;
  }

  function turboSection() {
    const stepsF = numberField(state.steps, (v) => { state.steps = Math.max(1, Math.min(60, Math.round(v) || 1)); persist(); }, 1);
    const cfgF = numberField(state.cfg, (v) => { state.cfg = Math.max(0, Math.min(20, v || 0)); persist(); }, 0.25);
    function syncEnabled() {
      const turbo = !!state.turboMode;
      (stepsF as HTMLInputElement).disabled = turbo; (cfgF as HTMLInputElement).disabled = turbo;
      stepsF.style.opacity = turbo ? "0.5" : "1"; cfgF.style.opacity = turbo ? "0.5" : "1";
    }
    const turboLbl = checkboxRow("TURBO (Base 1.0 + Turbo LoRA → 8 steps / CFG 1)", !!state.turboMode, (v) => {
      state.turboMode = v;
      if (v) { state.steps = TURBO_STEPS; state.cfg = TURBO_CFG; } else { state.steps = BASE_STEPS; state.cfg = BASE_CFG; }
      stepsF.value = String(state.steps); cfgF.value = String(state.cfg);
      syncEnabled(); persist();
    });
    syncEnabled();
    return el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } }, [
      turboLbl,
      row([col([label("Steps"), stepsF]), col([label("CFG"), cfgF])]),
      row([col([label("Sampler"), select(SAMPLERS, state.sampler, (v) => { state.sampler = v; persist(); })]), col([label("Scheduler"), select(SCHEDULERS, state.scheduler, (v) => { state.scheduler = v; persist(); })])]),
    ]);
  }

  function resolutionSection() {
    const matched = RESOLUTIONS.find((r) => r.w === state.width && r.h === state.height);
    const isCustom = !matched || matched.label === "Custom";
    const customRow = row([col([label("W"), numberField(state.width, (v) => { state.width = Math.max(64, Math.round(v / 64) * 64) || 1024; persist(); }, 64)]), col([label("H"), numberField(state.height, (v) => { state.height = Math.max(64, Math.round(v / 64) * 64) || 1024; persist(); }, 64)])]);
    customRow.style.display = isCustom ? "flex" : "none";
    const resSel = select(RESOLUTIONS.map((r) => ({ value: r.label, label: r.label })), isCustom ? "Custom" : matched!.label, (v) => {
      const p = RESOLUTIONS.find((r) => r.label === v);
      if (p && p.w > 0) { state.width = p.w; state.height = p.h; persist(); customRow.style.display = "none"; }
      else customRow.style.display = "flex";
    });
    return panel([label("Resolution"), resSel, customRow]);
  }

  // Inpainting/Any Control 모드는 마스크를 그려야 해서 beforeGenerate에서 자동 저장 훅이 필요.
  let controlAutoSave: (() => Promise<boolean>) | null = null;

  function renderLeftPanel() {
    clear(leftScroll);
    controlAutoSave = null;
    if (state.mode === "t2i") {
      leftScroll.appendChild(panel([
        label("Checkpoint"),
        select([{ value: "base", label: "Base 1.0 (recommended)" }, { value: "preview3", label: "Preview3 (experimental)" }], state.useBaseVariant, (v) => { state.useBaseVariant = v as "base" | "preview3"; persist(); }),
      ]));
      leftScroll.appendChild(resolutionSection());
      leftScroll.appendChild(panel([label("Sampling"), turboSection()]));
    } else if (state.mode === "inpaint") {
      const editor = createMaskEditor(state, persist, "inpaintImage", "inpaintMask");
      leftScroll.appendChild(panel([
        label("Source Image"),
        imageUploadSlot(state.inpaintImage, (name) => { state.inpaintImage = name; state.inpaintMask = null; persist(); editor.loadSourceImage(name); }),
      ]));
      leftScroll.appendChild(panel([label("Mask Editor (보라=컨트롤 영역)"), editor.editorPanel]));
      if (state.inpaintImage) editor.loadSourceImage(state.inpaintImage);
      controlAutoSave = editor.autoSaveIfNeeded;
      leftScroll.appendChild(resolutionSection());
      leftScroll.appendChild(panel([
        label("Control Strength / Start-End %"),
        row([col([label("Strength"), numberField(state.inpaintStrength, (v) => { state.inpaintStrength = Math.max(0, Math.min(2, v)); persist(); }, 0.05)]), col([label("Start %"), numberField(state.inpaintStart, (v) => { state.inpaintStart = Math.max(0, Math.min(1, v)); persist(); }, 0.05)]), col([label("End %"), numberField(state.inpaintEnd, (v) => { state.inpaintEnd = Math.max(0, Math.min(1, v)); persist(); }, 0.05)])]),
      ]));
      leftScroll.appendChild(panel([label("Sampling"), turboSection()]));
    } else if (state.mode === "anycontrol") {
      const editor = createMaskEditor(state, persist, "anyControlImage", "anyControlMask");
      leftScroll.appendChild(panel([
        label("Source Image"),
        imageUploadSlot(state.anyControlImage, (name) => { state.anyControlImage = name; state.anyControlMask = null; persist(); editor.loadSourceImage(name); }),
        el("div", { text: "마스크는 선택 사항입니다 — 칠하지 않으면 이미지 전체가 컨트롤됩니다.", style: { fontSize: "10px", color: C.muted, marginTop: "4px" } }),
      ]));
      leftScroll.appendChild(panel([label("Mask Editor (선택 사항)"), editor.editorPanel]));
      if (state.anyControlImage) editor.loadSourceImage(state.anyControlImage);
      leftScroll.appendChild(resolutionSection());
      leftScroll.appendChild(panel([
        label("Control Strength / Start-End %"),
        row([col([label("Strength"), numberField(state.anyControlStrength, (v) => { state.anyControlStrength = Math.max(0, Math.min(2, v)); persist(); }, 0.05)]), col([label("Start %"), numberField(state.anyControlStart, (v) => { state.anyControlStart = Math.max(0, Math.min(1, v)); persist(); }, 0.05)]), col([label("End %"), numberField(state.anyControlEnd, (v) => { state.anyControlEnd = Math.max(0, Math.min(1, v)); persist(); }, 0.05)])]),
      ]));
      leftScroll.appendChild(panel([label("Sampling"), turboSection()]));
    } else if (state.mode === "depthcontrol") {
      leftScroll.appendChild(panel([
        label("Source Image"),
        imageUploadSlot(state.depthControlImage, (name) => { state.depthControlImage = name; persist(); }),
        el("div", { text: "Depth map은 소스 이미지에서 자동 추출됩니다 (DepthAnythingV2 preprocessor).", style: { fontSize: "10px", color: C.muted, marginTop: "4px" } }),
      ]));
      leftScroll.appendChild(resolutionSection());
      leftScroll.appendChild(panel([
        label("Control Strength / Start-End %"),
        row([col([label("Strength"), numberField(state.depthControlStrength, (v) => { state.depthControlStrength = Math.max(0, Math.min(2, v)); persist(); }, 0.05)]), col([label("Start %"), numberField(state.depthControlStart, (v) => { state.depthControlStart = Math.max(0, Math.min(1, v)); persist(); }, 0.05)]), col([label("End %"), numberField(state.depthControlEnd, (v) => { state.depthControlEnd = Math.max(0, Math.min(1, v)); persist(); }, 0.05)])]),
      ]));
      leftScroll.appendChild(panel([label("Sampling"), turboSection()]));
    }
  }
  renderLeftPanel();

  async function generate() {
    if (samplingActive) return;
    if (!state.model) { warnTag.textContent = "⚙ Settings에서 Diffusion Model을 설정하세요"; return; }
    if (!state.textEncoder) { warnTag.textContent = "⚙ Settings에서 Text Encoder를 설정하세요"; return; }
    if (!state.vae) { warnTag.textContent = "⚙ Settings에서 VAE를 설정하세요"; return; }
    if (state.mode === "t2i" && state.useBaseVariant === "preview3" && !state.previewModel) { warnTag.textContent = "⚙ Settings에서 Preview3 모델을 설정하세요"; return; }
    if (state.turboMode && !state.turboLora) { warnTag.textContent = "⚙ Settings에서 Turbo LoRA를 설정하세요"; return; }
    if (state.mode === "inpaint") {
      if (!state.inpaintImage) { warnTag.textContent = "Inpainting 소스 이미지를 업로드하세요"; return; }
      if (!state.inpaintMask) {
        const saved = await controlAutoSave?.().catch(() => false);
        if (!saved) { warnTag.textContent = "마스크를 칠하고 저장하세요"; return; }
      }
    }
    if (state.mode === "anycontrol" && !state.anyControlImage) { warnTag.textContent = "Any Control 소스 이미지를 업로드하세요"; return; }
    if (state.mode === "depthcontrol" && !state.depthControlImage) { warnTag.textContent = "Depth Control 소스 이미지를 업로드하세요"; return; }
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

    try {
      const graph =
        state.mode === "t2i" ? buildT2IGraph(state) :
        state.mode === "inpaint" ? buildInpaintGraph(state) :
        state.mode === "anycontrol" ? buildAnyControlGraph(state) :
        buildDepthControlGraph(state);
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

  applyMobileCollapsibleLayout(body, leftPanel, leftScroll, rightPanel);

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
  hdr.append(el("div", { text: "❔ Anima 도움말", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }), button("✕", () => (ov.style.display = "none"), "danger"));
  const body = el("div", { style: { color: C.text, fontSize: "12px", lineHeight: "1.7" } });
  body.innerHTML = `
    <b>모드</b>: T2I, Inpainting, Any Control to Image, Depth Control to Image.<br>
    <b>TURBO</b>: Base 1.0 + Turbo LoRA를 함께 적용해 8 steps / CFG 1로 빠르게 생성합니다 (⚙ Settings에서 Turbo LoRA 파일을 먼저 지정하세요).<br>
    <b>컨트롤 모드</b>: Inpainting/Any Control/Depth Control은 표준 ControlNet이 아니라 가벼운 LLLite 모델 패치를 씁니다 — Depth Control은 소스 이미지에서 깊이맵을 자동 추출합니다.<br>
    <b>프롬프트</b>: 📋 Templates에서 저장한 템플릿을 적용하거나, 🔍 Expand/LLM에서 로컬 LLM으로 프롬프트를 보강할 수 있습니다.<br>
    <b>상단 아이콘</b>: ↺ Reset(전체 초기화, 모델 선택 유지) · ⇌ Compare(원본/결과 비교) · 🗑 Unload VRAM · ⚙ Settings · 🖼 Gallery. 자세한 모델 파일 안내는 ⚙ Settings 하단의 Manual을 참고하세요.
  `;
  box.append(hdr, body);
  ov.appendChild(box);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.style.display = "none"; });
  return { el: ov, show() { ov.style.display = "flex"; }, hide() { ov.style.display = "none"; } };
}
