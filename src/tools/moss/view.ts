// view.ts — Moss Image ONE STUDIO 메인 화면 조립. Anima/Krea2의 웹 레이아웃(450px 좌측 패널, 180px 프롬프트,
// Send-to/Compare/Reset/Unload/Settings/Gallery/Help 패턴)을 따르되, Moss 고유의 4모드(T2I / I2I / R2I (bboxes) / INPAINT)를
// 반영한다. 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/moss/one_node_moss.js (node f730ee9, ca925eb, 680f142).
// 노드 전용(Prompt/pipe Override, prompt/settings 출력, ModelPreviewOverrideKJ 라이브 프리뷰, 1310x1034 크기)은 옮기지 않는다.
import type { MossState, MossMode } from "./core";
import {
  C, el, clear, BRAND, MODES, RESOLUTIONS, SAMPLERS, SCHEDULERS, SEND_TO, LORA_UI_CAP, snap16,
  defaultState, loadState, saveState, getModePrompt, setModePrompt, randomSeed,
} from "./core";
import { panel, label, button, select, numberField, row, col, modeBar, iconBtn, checkboxRow, searchableSelect, confirmDialog, applyMobileCollapsibleLayout } from "../../shared/ui";
import * as api from "./api";
import { addLivePreview, listenLivePreview, showStepBar, hideStepBar } from "../../shared/livePreview";
import { openImageGalleryPicker } from "../../shared/imageGalleryPicker";
import { buildT2IGraph, buildI2IGraph, buildInpaintGraph, buildR2IGraph, OUTPUT_NODE } from "./graphBuilder";
import { createR2IEditor } from "./r2iEditor";
import { mossSystemPrompt } from "./systemPrompt";
import { queuePrompt } from "./comfyClient";
import type { AppConfig } from "./settings";
import { createSettingsOverlay } from "./settings";
import { createGalleryOverlay } from "./galleryOverlay";
import { createTemplateOverlay } from "./promptTools";
import { createPromptEditPopup, type PromptEditLlmState } from "../../shared/promptEditPopup";
import { comfyApi } from "./comfyClient";

import { loadLLMSettings, saveLLMSettings } from "../../shared/llmSettingsStore";
function loadLlmState(): PromptEditLlmState { return loadLLMSettings(); }
function saveLlmState(s: PromptEditLlmState) { saveLLMSettings(s); }
import { createMaskEditor } from "./maskEditor";
import { withCurrent } from "../../shared/samplerLists";
import { attachPanZoom, createCompareView as createSharedCompareView } from "../../shared/panZoom";
import { attachLeftResize } from "../../shared/leftResize";

export function renderMoss(root: HTMLElement) {
  clear(root);
  root.className = "flex-1 min-h-0 flex flex-col";
  root.style.background = C.bg0;

  const state: MossState = defaultState(loadState());
  let availableLoras: string[] = [];
  let samplingActive = false;
  let queuedPromptId: string | null = null;
  const appConfig: AppConfig = { output_mode_visible: true };

  function persist() { saveState(state); }
  let r2i = createR2IEditor(state, persist);

  const wrap = el("div", { style: { flex: "1", minHeight: "0", display: "flex", flexDirection: "column", padding: "10px", gap: "8px", boxSizing: "border-box" } });
  root.appendChild(wrap);

  const subBar = el("div", { class: "aos-sub-bar", style: { display: "flex", alignItems: "center", gap: "10px", flexShrink: "0" } });
  const modeBarWrap = el("div", { class: "aos-mode-bar-wrap" });
  function renderModeBar() {
    clear(modeBarWrap);
    modeBarWrap.appendChild(
      modeBar(MODES.map((m) => ({ key: m.key, label: m.label })), state.mode, (key) => {
        state.mode = key as MossMode;
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
  attachLeftResize(leftPanel, { minViewport: 768, gap: 10 });

  const rightPanel = el("div", { style: { flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "8px" } });
  body.appendChild(rightPanel);

  const previewBox = el("div", { class: "aos-preview-box", style: { flex: "1", minHeight: "0", background: "#000", border: `1px solid ${C.border}`, borderRadius: "10px", position: "relative", overflow: "hidden" } });
  const placeholderTxt = el("div", { text: "Result image appears here", style: { position: "absolute", inset: "0", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: "13px" } });
  const resultImg = el("img", { style: { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain", display: "none" } });
  const clearBtn = el("button", { type: "button", text: "✕", title: "Clear result", style: { position: "absolute", top: "6px", right: "6px", zIndex: "5", background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", borderRadius: "4px", width: "22px", height: "22px", cursor: "pointer", fontSize: "12px", padding: "0", display: "none" } });
  const zoomLockBtn = el("button", { type: "button", text: "🔓", title: "Scroll zoom on/off", style: { position: "absolute", top: "6px", right: "32px", zIndex: "5", background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", borderRadius: "4px", width: "22px", height: "22px", cursor: "pointer", fontSize: "11px", padding: "0", display: "none" } });
  previewBox.append(placeholderTxt, resultImg, zoomLockBtn, clearBtn);
  rightPanel.appendChild(previewBox);

  let zoomEnabled = true;
  // One gesture set for every image viewer (node 6056b8a): wheel = zoom at the cursor, left-drag = pan, double-click = fit.
  const panZoom = attachPanZoom(previewBox, () => [resultImg], { enabled: () => zoomEnabled && !!modeResults[state.mode] });
  function resetZoom() { panZoom.reset(); }
  zoomLockBtn.addEventListener("click", () => { zoomEnabled = !zoomEnabled; zoomLockBtn.textContent = zoomEnabled ? "🔓" : "🔒"; if (!zoomEnabled) resetZoom(); });

  function currentSourceFilename(): string {
    if (state.mode === "i2i") return state.i2iImage || "";
    if (state.mode === "inpaint") return state.inpaintImage || "";
    return "";
  }

  let compareViewEl: HTMLElement | null = null;
  function createCompareView(originalURL: string, resultURL: string) {
    const c = createSharedCompareView(originalURL, resultURL, BRAND);
    Object.assign(c.style, { position: "absolute", inset: "0", width: "auto", height: "auto" });
    return c;
  }

  type ModeResult = { filename: string; subfolder: string; type: string };
  const modeResults: Partial<Record<string, ModeResult>> = {};
  function restorePreviewForMode() {
    hideStepBar(previewBox);
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
    if (compareEnabled && (state.mode === "i2i" || state.mode === "inpaint") && srcFile) {
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
  // Live sampling frames (ModelPreviewOverrideKJ, node live_preview.js): shown in the preview box until the final image replaces them.
  listenLivePreview("moss", comfyApi, (url, step, total) => {
    if (!samplingActive) return;
    if (compareViewEl) { compareViewEl.remove(); compareViewEl = null; }
    placeholderTxt.style.display = "none";
    resultImg.src = url;
    resultImg.style.display = "block";
    if (step && total) showStepBar(previewBox, step, total);
  });
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
  const externalQueueBanner = el("div", { style: { display: "none", color: C.warn, fontSize: "11px", background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "5px 8px" } });
  statusWrap.append(statusText, progressOuter, externalQueueBanner);
  rightPanel.appendChild(statusWrap);

  // ── External queue banner (ComfyUI 실제 큐 상태 폴링) ─────────────────────
  function startQueuePolling() {
    setInterval(async () => {
      const q = await api.getQueueStatus();
      if (samplingActive) { externalQueueBanner.style.display = "none"; return; }
      if (queuedPromptId && (q.runningPromptIds.includes(queuedPromptId) || q.pendingPromptIds.includes(queuedPromptId))) {
        externalQueueBanner.style.display = "block";
        externalQueueBanner.textContent = q.pendingPromptIds.includes(queuedPromptId) ? "My request is pending…" : "My request is running…";
      } else if (q.running > 0 || q.pending > 0) {
        externalQueueBanner.style.display = "block";
        externalQueueBanner.textContent = `⚠ ComfyUI queue: ${q.running} running · ${q.pending} pending — if this screen didn't queue it, progress/preview won't show here.`;
      } else {
        externalQueueBanner.style.display = "none";
        queuedPromptId = null;
      }
    }, 4000);
  }
  startQueuePolling();

  const promptWrap = el("div", { style: { flexShrink: "0", display: "flex", flexDirection: "column", gap: "6px" } });
  const promptHdr = el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } });
  const charCount = el("span", { style: { color: C.muted, fontSize: "10px" } });
  promptHdr.append(el("div", { text: "PROMPT", style: { color: C.muted, fontSize: "11px", flex: "1", textTransform: "uppercase", letterSpacing: "0.04em" } }), charCount);
  function purpleHdrBtn(text: string, onClick: () => void) {
    return el("button", {
      type: "button", text, onclick: onClick,
      style: { background: BRAND, color: "#fff", border: "none", borderRadius: "6px", padding: "6px 10px", cursor: "pointer", fontSize: "11px", fontWeight: "700", whiteSpace: "nowrap" },
    });
  }
  // Refine: revise the current prompt from an instruction without opening Prompt Edit (node 9bac1a5).
  const refineHdrBtn = purpleHdrBtn("🔧 Refine", () => { void promptExpandOv.refine(); });
  refineHdrBtn.title = "Revise the current prompt from an instruction (no need to open Prompt Edit)";
  const expandBtn = purpleHdrBtn("🔍 Prompt Edit", () => promptExpandOv.show());
  const templatesBtn = purpleHdrBtn("📋 Prompt Preset", () => templateOv.show());
  // No job.json feature exists for Moss (no headless package / buildAgentJob reference
  // anywhere in this tool's source) — not adding the header button per the Plan A default.
  const autoEnhanceChk = el("input", { type: "checkbox" }) as HTMLInputElement;
  autoEnhanceChk.checked = !!state.autoEnhance;
  autoEnhanceChk.addEventListener("change", () => { state.autoEnhance = autoEnhanceChk.checked; persist(); });
  const autoEnhanceLbl = el("label", {
    title: "Automatically run Prompt Enhance on the current prompt right before Generate, updating the PROMPT field in place.",
    style: { display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: C.muted, cursor: "pointer" },
  }, [autoEnhanceChk, el("span", { text: "Auto Enhance" })]);
  promptHdr.appendChild(autoEnhanceLbl);
  promptHdr.append(refineHdrBtn, expandBtn, templatesBtn);

  const promptTA = el("textarea", { placeholder: "Prompt…", style: { width: "100%", boxSizing: "border-box", background: C.bg1, color: C.text, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "9px", fontSize: "13px", fontFamily: "inherit", resize: "vertical", minHeight: "180px", outline: "none" } });
  function updatePromptCount() {
    const n = getModePrompt(state, state.mode).trim().length;
    charCount.textContent = ` (${n} chars${n < 10 ? " ⚠" : ""})`;
    charCount.style.color = n < 10 ? C.warn : C.muted;
  }
  function refreshPromptBox() {
    promptTA.value = getModePrompt(state, state.mode);
    promptTA.placeholder = state.mode === "r2i" ? "Describe the whole image (the boxes carry the details)…" : "Describe what you want to generate…";
    updatePromptCount();
  }
  refreshPromptBox();
  promptTA.addEventListener("input", () => { setModePrompt(state, state.mode, promptTA.value); persist(); updatePromptCount(); });

  promptWrap.append(promptHdr, promptTA);
  rightPanel.appendChild(promptWrap);

  const llmState = loadLlmState();
  const promptExpandOv = createPromptEditPopup({
    getPromptTA: () => promptTA as HTMLTextAreaElement,
    fetchApi: (path, opts) => comfyApi.fetchApi(path, opts),
    getPrompt: () => getModePrompt(state, state.mode),
    setPrompt: (text) => { setModePrompt(state, state.mode, text); refreshPromptBox(); },
    persist,
    openImageGalleryPicker: (onPick) => openImageGalleryPicker(onPick),
    viewUrl: (filename) => api.viewUrl(filename, "", "input"),
    llm: llmState,
    saveLlm: () => saveLlmState(llmState),
    openSettings: () => settingsOv.show(),
    title: "🔍 Prompt Edit",
    defaultModelFormat: "Universal Natural Language",
    systemPrompt: () => mossSystemPrompt(state.mode),
  });
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
      state.mode = mode as MossMode;
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
    r2i = createR2IEditor(state, persist);
    if (model) state.model = model;
    if (textEncoder) state.textEncoder = textEncoder;
    if (vae) state.vae = vae;
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
    try { await api.freeVram(); }
    finally { setTimeout(() => (unloadBtn.style.opacity = "1"), 2000); }
  }

  function applyReuseMeta(meta: any) {
    if (!meta || !meta.mode) return;
    Object.assign(state, meta);
    r2i = createR2IEditor(state, persist);
    persist();
    renderModeBar();
    renderLeftPanel();
    refreshPromptBox();
    renderSendTo();
    restorePreviewForMode();
  }

  function imageUploadSlot(currentFilename: string, onSet: (name: string) => void, onLoad?: (w: number, h: number) => void, probeIfUnknown?: boolean) {
    const wrap = el("div", { style: { border: `2px dashed ${C.border}`, borderRadius: "8px", padding: "8px", textAlign: "center", cursor: "pointer", minHeight: "180px", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", background: C.bg2 } });
    const img = el("img", { style: { maxWidth: "100%", maxHeight: "168px", display: "none", borderRadius: "4px" } });
    const hint = el("div", { text: "Click or drag to upload", style: { color: C.muted, fontSize: "11px" } });
    const fileIn = el("input", { type: "file", accept: "image/*", style: { display: "none" } });
    wrap.append(hint, img, fileIn);
    const clearBtn = el("button", { type: "button", text: "✕", title: "Remove", style: { position: "absolute", top: "4px", right: "4px", zIndex: "3", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", borderRadius: "4px", width: "20px", height: "20px", cursor: "pointer", fontSize: "11px", padding: "0", display: "none" } });
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      img.style.display = "none";
      img.src = "";
      hint.style.display = "";
      clearBtn.style.display = "none";
      onSet("");
    });
    wrap.appendChild(clearBtn);
    // 주의: 이전엔 img의 "load" 이벤트에서 onLoad→renderLeftPanel()을 호출했는데, 이 슬롯 자체가
    // renderLeftPanel()마다 새로 생성되고 기존 이미지를 다시 img.src에 세팅하므로 "load"가 또 발생 →
    // renderLeftPanel() 재호출 → 다시 "load"... 로 무한 재렌더 루프가 생겨 I2I/Identity처럼 이미
    // 이미지가 설정된 모드에서 페이지 전체가 멈춘 것처럼 보였다(클릭/체크박스/셀렉트 전부 무반응).
    // 그래서 이제 onLoad는 "새로 업로드했을 때"만, 화면에 보이는 img와 무관한 별도 Image()로 딱 한 번만 호출한다.
    async function handleFile(file: File) {
      hint.textContent = "Uploading…";
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
      } catch (e: any) { hint.textContent = "Upload failed: " + (e.message || e); }
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
    const galleryBtn = el("button", { type: "button", text: "🖼", title: "Pick from gallery", style: { position: "absolute", bottom: "4px", left: "4px", zIndex: "3", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", borderRadius: "4px", width: "22px", height: "22px", cursor: "pointer", fontSize: "12px", padding: "0" } });
    galleryBtn.addEventListener("click", (e) => { e.stopPropagation(); openImageGalleryPicker((name) => applyPicked(name)); });
    wrap.appendChild(galleryBtn);

    wrap.addEventListener("click", () => fileIn.click());
    fileIn.addEventListener("change", () => { if (fileIn.files?.[0]) handleFile(fileIn.files[0]); });
    wrap.addEventListener("dragover", (e) => { e.preventDefault(); wrap.style.borderColor = BRAND; });
    wrap.addEventListener("dragleave", () => { wrap.style.borderColor = C.border; });
    wrap.addEventListener("drop", (e) => { e.preventDefault(); wrap.style.borderColor = C.border; const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f); });

    // A saved file that no longer exists would show a broken-image icon: show the empty card instead,
    // and forget the saved name when the server says the file is gone (404). (node c79a4c9)
    img.addEventListener("error", async () => {
      if (!img.getAttribute("src")) return;
      const gone = await fetch(img.src, { method: "HEAD" }).then((r) => r.status === 404, () => false);
      img.style.display = "none";
      hint.style.display = "";
      clearBtn.style.display = "none";
      if (gone) onSet("");
    });

    if (currentFilename) {
      const url = api.viewUrl(currentFilename, "", "input");
      img.src = url;
      img.style.display = "block";
      hint.style.display = "none";
      clearBtn.style.display = "block";
      // Send-to로 넘어온 이미지는 새 업로드가 아니라 onLoad 프로브가 실행되지 않아 W/H가 미확인
      // 상태로 남는 버그가 있었다(Z-Image 라이브 테스트에서 발견) — 아직 크기를 모를 때만, 한 번만 프로브.
      if (onLoad && probeIfUnknown) {
        const probe = new Image();
        probe.onload = () => onLoad(probe.naturalWidth, probe.naturalHeight);
        probe.src = url;
      }
    }
    return wrap;
  }

  // Steps / CFG, Sampler / Scheduler and the skip-layer-guidance switch — shared by every mode (ui_t2i_moss.js mountSharedSettings).
  function samplingSection(onSize?: () => void, withResolution = true) {
    const out: HTMLElement[] = [];
    if (withResolution) out.push(resolutionSection(onSize));
    const stepsF = numberField(state.steps, (v) => { state.steps = Math.max(1, Math.min(100, Math.round(v) || 1)); persist(); }, 1);
    const cfgF = numberField(state.cfg, (v) => { state.cfg = Math.max(0, Math.min(20, v || 0)); persist(); }, 0.25);
    out.push(panel([row([col([label("Steps"), stepsF]), col([label("CFG"), cfgF])])]));
    out.push(panel([row([
      col([label("Sampler"), select(withCurrent(SAMPLERS, state.sampler), state.sampler, (v) => { state.sampler = v; persist(); })]),
      col([label("Scheduler"), select(withCurrent(SCHEDULERS, state.scheduler), state.scheduler, (v) => { state.scheduler = v; persist(); })]),
    ])]));
    const slgLayers = el("input", { type: "text", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "5px 7px", fontSize: "12px", fontFamily: "inherit", outline: "none" } }) as HTMLInputElement;
    slgLayers.value = state.slgLayers ?? "22";
    slgLayers.addEventListener("input", () => { state.slgLayers = slgLayers.value.trim(); persist(); });
    const slgRow = row([col([label("Layers (single)"), slgLayers])]);
    const syncSlg = () => { slgRow.style.display = state.slgEnabled ? "flex" : "none"; };
    const slgLbl = checkboxRow("SLG — skip layer guidance", !!state.slgEnabled, (v) => { state.slgEnabled = v; persist(); syncSlg(); });
    slgLbl.title = "Skip layer guidance on the model (official layer 22). Off looks more realistic; on keeps detail but can overblow anime styles.";
    syncSlg();
    out.push(panel([slgLbl, slgRow]));
    return out;
  }

  // Resolution (multiples of 16): preset list or Custom W / H.
  function resolutionSection(onSize?: () => void) {
    const matched = RESOLUTIONS.find((r) => r.w === state.width && r.h === state.height);
    const isCustom = !matched || matched.label === "Custom";
    const wInp = numberField(state.width, (v) => { state.width = snap16(v) || 1024; persist(); onSize?.(); }, 16);
    const hInp = numberField(state.height, (v) => { state.height = snap16(v) || 1024; persist(); onSize?.(); }, 16);
    const customRow = row([col([label("W"), wInp]), col([label("H"), hInp])]);
    customRow.style.display = isCustom ? "flex" : "none";
    const resSel = select(RESOLUTIONS.map((r) => ({ value: r.label, label: r.label })), isCustom ? "Custom" : matched!.label, (v) => {
      const p = RESOLUTIONS.find((r) => r.label === v);
      if (p && p.w > 0) { state.width = p.w; state.height = p.h; (wInp as HTMLInputElement).value = String(p.w); (hInp as HTMLInputElement).value = String(p.h); persist(); customRow.style.display = "none"; onSize?.(); }
      else customRow.style.display = "flex";
    });
    return panel([label("Resolution"), resSel, customRow]);
  }

  // W / H of an image mode's source (set from the upload, multiples of 16) with an optional ratio lock.
  function sizeFields(getW: () => number, setW: (v: number) => void, getH: () => number, setH: (v: number) => void, lockGetter: () => boolean, lockSetter: (v: boolean) => void) {
    let aspect = getW() && getH() ? getW() / getH() : 1;
    const wIn = numberField(getW() || 1024, (v) => {
      const nv = snap16(v || 1024); setW(nv);
      if (lockGetter() && aspect > 0) setH(snap16(nv / aspect)); else if (getH()) aspect = nv / getH();
      persist(); renderLeftPanel();
    }, 16);
    const hIn = numberField(getH() || 1024, (v) => {
      const nv = snap16(v || 1024); setH(nv);
      if (lockGetter() && aspect > 0) setW(snap16(nv * aspect)); else if (getW()) aspect = getW() / nv;
      persist(); renderLeftPanel();
    }, 16);
    const lockChk = checkboxRow("Lock ratio", lockGetter(), (v) => { lockSetter(v); if (getW() && getH()) aspect = getW() / getH(); persist(); });
    return col([row([col([label("W"), wIn]), col([label("H"), hIn])]), lockChk]);
  }

  // Inpainting needs a painted mask: beforeGenerate auto-saves it.
  let controlAutoSave: (() => Promise<boolean>) | null = null;

  // LoRA section (max 3) — mirrors Krea2 ONE STUDIO's LoRA UI.
  function loraSection() {
    const wrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } });
    function rebuild() {
      clear(wrap);
      (state.loras || []).forEach((l, i) => {
        const nameOpts = ["none", ...availableLoras.filter((n) => n !== "none")];
        const trigIn = el("input", { type: "text", placeholder: "trigger word", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px", fontSize: "12px", fontFamily: "inherit", outline: "none" } }) as HTMLInputElement;
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
        wrap.appendChild(button(`+ Add LoRA (max ${LORA_UI_CAP})`, () => { state.loras.push({ name: "none", strength: 1, triggerWord: "", enabled: true }); persist(); rebuild(); }));
      }
    }
    rebuild();
    return wrap;
  }

  function denoiseSlider(title: string, get: () => number, set: (v: number) => void) {
    const valTxt = el("span", { text: get().toFixed(2), style: { color: C.text, fontSize: "11px", minWidth: "32px", textAlign: "right" } });
    const rng = el("input", { type: "range", min: "0", max: "1", step: "0.01", style: { flex: "1", accentColor: BRAND } }) as HTMLInputElement;
    rng.value = String(get());
    rng.addEventListener("input", () => { const v = parseFloat(rng.value); set(v); valTxt.textContent = v.toFixed(2); persist(); });
    return panel([label(title), el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, [rng, valTxt])]);
  }

  function renderLeftPanel() {
    clear(leftScroll);
    controlAutoSave = null;
    if (state.mode === "t2i") {
      samplingSection().forEach((p) => leftScroll.appendChild(p));
      leftScroll.appendChild(panel([label("LoRA"), loraSection()]));
    } else if (state.mode === "i2i") {
      // MOSS has no reference-image input, so I2I is the classic latent route: the source is scaled to the working size,
      // encoded by the VAE and re-noised by DENOISE.
      leftScroll.appendChild(panel([
        label("Source Image"),
        imageUploadSlot(state.i2iImage || "", (name) => { state.i2iImage = name || null; persist(); }, (w, h) => { state.i2iWidth = snap16(w); state.i2iHeight = snap16(h); persist(); renderLeftPanel(); }, !state.i2iWidth || !state.i2iHeight),
        sizeFields(() => state.i2iWidth, (v) => (state.i2iWidth = v), () => state.i2iHeight, (v) => (state.i2iHeight = v), () => state.i2iLockRatio, (v) => (state.i2iLockRatio = v)),
      ]));
      leftScroll.appendChild(denoiseSlider("Denoise", () => state.i2iDenoise ?? 0.6, (v) => { state.i2iDenoise = v; }));
      samplingSection(undefined, false).forEach((p) => leftScroll.appendChild(p));
      leftScroll.appendChild(panel([label("LoRA"), loraSection()]));
    } else if (state.mode === "r2i") {
      // Draw boxes on a canvas of the working size; the boxes + PROMPT go through MOSSImageLayoutPrompt.
      samplingSection(() => r2i.onSize()).forEach((p) => leftScroll.appendChild(p));
      r2i.panels.forEach((p) => leftScroll.appendChild(p));
      leftScroll.appendChild(panel([label("LoRA"), loraSection()]));
    } else if (state.mode === "inpaint") {
      // Same route as Z-Image's INPAINT: latent noise mask + DifferentialDiffusion.
      const editor = createMaskEditor(state, persist, "inpaintImage", "inpaintMask");
      leftScroll.appendChild(panel([
        label("Inpaint"),
        imageUploadSlot(state.inpaintImage || "", (name) => { state.inpaintImage = name || null; state.inpaintMask = null; persist(); editor.loadSourceImage(name || null); }, (w, h) => { state.inpaintWidth = snap16(w); state.inpaintHeight = snap16(h); persist(); }, !state.inpaintWidth || !state.inpaintHeight),
      ]));
      leftScroll.appendChild(panel([label("Mask Editor (purple = repaint)"), editor.editorPanel]));
      if (state.inpaintImage) editor.loadSourceImage(state.inpaintImage);
      controlAutoSave = editor.autoSaveIfNeeded;
      leftScroll.appendChild(denoiseSlider("Denoise (1.0 = repaint the masked area freely)", () => state.inpaintDenoise ?? 1, (v) => { state.inpaintDenoise = v; }));
      samplingSection(undefined, false).forEach((p) => leftScroll.appendChild(p));
      leftScroll.appendChild(panel([label("LoRA"), loraSection()]));
    }
  }
  renderLeftPanel();

  async function generate() {
    if (samplingActive) return;
    if (!state.model) { warnTag.textContent = "⚙ Set the Diffusion Model in Settings"; return; }
    if (!state.textEncoder) { warnTag.textContent = "⚙ Set Text Encoder in Settings"; return; }
    if (!state.vae) { warnTag.textContent = "⚙ Set VAE in Settings"; return; }
    if (state.mode === "i2i" && !state.i2iImage) { warnTag.textContent = "Upload an I2I source image"; return; }
    if (state.mode === "r2i" && !(state.r2iBoxes || []).some((b) => b && b.width > 0 && b.height > 0)) { warnTag.textContent = "Draw at least one box in R2I mode"; return; }
    if (state.mode === "inpaint") {
      if (!state.inpaintImage) { warnTag.textContent = "Upload an INPAINT source image"; return; }
      const saved = await controlAutoSave?.().catch(() => false);   // sends the mask as painted now, no Save Mask press needed
      if (!saved) { warnTag.textContent = "Paint the mask area with the brush first"; return; }
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

    if (state.autoEnhance && getModePrompt(state, state.mode).trim()) {
      statusText.textContent = "Enhancing…";
      try {
        const enhanced = await promptExpandOv.enhance(getModePrompt(state, state.mode));
        setModePrompt(state, state.mode, enhanced); refreshPromptBox(); persist();
      } catch (e: any) {
        statusText.textContent = `Auto Enhance failed: ${e.message || e}`;
        samplingActive = false;
        genBtn.style.display = "block";
        stopBtn.style.display = "none";
        return;
      }
      statusText.textContent = "Queuing…";
    }

    try {
      const graph =
        state.mode === "t2i" ? buildT2IGraph(state) :
        state.mode === "i2i" ? buildI2IGraph(state) :
        state.mode === "r2i" ? buildR2IGraph(state) :
        buildInpaintGraph(state);
      await addLivePreview(graph, "moss", comfyApi);
      const result = await queuePrompt(graph, {
        onProgress: (v, m) => {
          statusText.textContent = `Sampling ${v}/${m}`;
          progressInner.style.width = `${Math.round((v / m) * 100)}%`;
        },
      });
      // Only the save/preview node's result counts: R2I also has CreateBoundingBoxes, an output node with its own preview image.
      const out = (result.byNode as any)[OUTPUT_NODE];
      if (out?.images?.length) {
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
      restorePreviewForMode();
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
  hdr.append(el("div", { text: "❔ Moss Image Help", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }), button("✕", () => (ov.style.display = "none"), "danger"));
  const body = el("div", { style: { color: C.text, fontSize: "12px", lineHeight: "1.7" } });
  body.innerHTML = `
    <b>Modes</b>: T2I, I2I, R2I (bboxes), INPAINT.<br>
    <b>I2I</b>: the source image is encoded to a latent and re-noised; Denoise sets how far it may change (MOSS has no reference-image input).<br>
    <b>R2I (bboxes)</b>: draw boxes on the canvas. Each box is an OBJECT (a described thing) or a TEXT block (exact words to render). Draw the background first and the foreground last; "Characters" = numbers of the object boxes to label as characters (e.g. 1, 3).<br>
    <b>INPAINT</b>: paint the area to repaint; only that area follows the prompt, the rest of the picture is kept.<br>
    <b>Size</b>: width and height are snapped to multiples of 16 (1080 renders as 1088).<br>
    <b>Prompt</b>: apply a saved template from 📋 Prompt Preset, or expand it with a local LLM via 🔍 Prompt Edit.<br>
    <b>Top icons</b>: ↺ Reset (full reset, keeps model selection) · ⇌ Compare (original/result) · 🗑 Unload VRAM · ⚙ Settings · 🖼 Gallery. See the Manual at the bottom of ⚙ Settings for model file details.
  `;
  box.append(hdr, body);
  ov.appendChild(box);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.style.display = "none"; });
  return { el: ov, show() { ov.style.display = "flex"; }, hide() { ov.style.display = "none"; } };
}
