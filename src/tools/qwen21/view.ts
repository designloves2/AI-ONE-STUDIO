// view.ts — QWEN IMAGE 2.1 ONE STUDIO 메인 화면 조립. Qwen Image Edit 2511의 레이아웃 패턴
// (450px 좌측 패널, Send-to/Compare/Reset/Unload/Settings/Gallery/Help, 프롬프트 박스)을 그대로
// 따르되 모드가 다르다: T2I / I2I(+ Ref to Image 서브모드) / EDIT / PAINT(Inpaint/Outpaint) /
// UPSCALE — Faceswap/Angle 없음. Ref to Image와 Edit의 Images 2–10은 MiniMax H3의 압축 그리드
// (imageSlot)를 그대로 재사용하고, Edit/Inpaint는 마스크 파일 대신 새 드로잉 도구(maskDraw.ts)로
// 주석을 그려 추가 레퍼런스 이미지로 넣는다.
import type { Q21State, Q21Mode, PaintSubMode } from "./core";
import {
  C, el, clear, BRAND, MODES, RESOLUTIONS, SAMPLERS, SCHEDULERS,
  LORA_UI_CAP, MAX_REF_IMAGES, MAX_EDIT_EXTRA, SEEDVR2_ATTN_MODES, SEEDVR2_COLOR_MODES, SEND_TO,
  defaultState, loadState, saveState, getModePrompt, setModePrompt, randomSeed, snap8,
} from "./core";
import { panel, label, button, select, numberField, row, col, modeBar, iconBtn, checkboxRow, searchableSelect, openFullscreen, confirmDialog, applyMobileCollapsibleLayout } from "../../shared/ui";
import * as api from "./api";
import { openImageGalleryPicker } from "../../shared/imageGalleryPicker";
import { imageSlot } from "../minimax_h3/imagesPanel";
import { buildGraph } from "./graphBuilder";
import { queuePrompt, comfyApi } from "./comfyClient";
import { createSettingsOverlay } from "./settings";
import { createGalleryOverlay } from "./galleryOverlay";
import { createTemplateOverlay } from "./promptTools";
import { openMaskDrawOverlay, type Stroke } from "./maskDraw";
import { createPromptEditPopup, type PromptEditLlmState } from "../../shared/promptEditPopup";

const LLM_LS_KEY = "tj_studio_one_llm_settings";
function loadLlmState(): PromptEditLlmState {
  try { return JSON.parse(localStorage.getItem(LLM_LS_KEY) || "{}"); } catch { return {}; }
}
function saveLlmState(s: PromptEditLlmState) {
  try { localStorage.setItem(LLM_LS_KEY, JSON.stringify(s)); } catch {}
}

export function renderQwen21(root: HTMLElement) {
  clear(root);
  root.className = "flex-1 min-h-0 flex flex-col";
  root.style.background = C.bg0;

  const state: Q21State = defaultState(loadState());
  let availableLoras: string[] = [];
  let samplingActive = false;
  let queuedPromptId: string | null = null;

  function persist() { saveState(state); }

  const wrap = el("div", { style: { flex: "1", minHeight: "0", display: "flex", flexDirection: "column", padding: "10px", gap: "8px", boxSizing: "border-box" } });
  root.appendChild(wrap);

  // ── Sub bar: 모드 pill + 아이콘들 ──────────────────────────────────────────
  const subBar = el("div", { class: "aos-sub-bar", style: { display: "flex", alignItems: "center", gap: "10px", flexShrink: "0" } });
  const modeBarWrap = el("div", { class: "aos-mode-bar-wrap" });
  function renderModeBar() {
    clear(modeBarWrap);
    modeBarWrap.appendChild(
      modeBar(MODES.map((m) => ({ key: m.key, label: m.label })), state.mode, (key) => {
        state.mode = key as Q21Mode;
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

  // ── Body: 좌측 패널(450px) + 우측 프리뷰 ─────────────────────────────────────
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
  const placeholderTxt = el("div", { text: "Result image appears here", style: { position: "absolute", inset: "0", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: "13px" } });
  const resultImg = el("img", { style: { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain", display: "none" } }) as HTMLImageElement;
  resultImg.addEventListener("dblclick", () => { if (resultImg.src) openFullscreen(resultImg.src, "image"); });
  const clearBtn = el("button", { type: "button", text: "✕", title: "Clear result", style: { position: "absolute", top: "6px", right: "6px", zIndex: "5", background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", borderRadius: "4px", width: "22px", height: "22px", cursor: "pointer", fontSize: "12px", padding: "0", display: "none" } });
  const zoomLockBtn = el("button", { type: "button", text: "🔓", title: "Scroll zoom on/off", style: { position: "absolute", top: "6px", right: "32px", zIndex: "5", background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", borderRadius: "4px", width: "22px", height: "22px", cursor: "pointer", fontSize: "11px", padding: "0", display: "none" } });
  // "Generating…" overlay directly on the preview box, shown while sampling — was missing
  // from the port (one_node_qwen21.js's own loadingOv+spinner, root.appendChild order shows
  // it's a real distinct feature from the below-preview status/progress strip, not a
  // duplicate of it). User: "프리뷰 화면에 이미지 생성중 일때의 메시지 기능 누락."
  if (!document.getElementById("q21-spin-style")) {
    const s = document.createElement("style"); s.id = "q21-spin-style";
    s.textContent = "@keyframes q21v1-spin{to{transform:rotate(360deg)}}";
    document.head.appendChild(s);
  }
  const loadingOv = el("div", { style: { position: "absolute", inset: "0", background: "rgba(0,0,0,0.5)", display: "none", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", zIndex: "10" } });
  const spinnerEl = el("div", { style: { width: "44px", height: "44px", border: `3px solid ${C.border}`, borderTop: `3px solid ${BRAND}`, borderRadius: "50%", animation: "q21v1-spin 0.8s linear infinite" } });
  loadingOv.append(spinnerEl, el("div", { text: "Generating…", style: { color: C.text, fontSize: "12px" } }));
  previewBox.append(placeholderTxt, resultImg, zoomLockBtn, clearBtn, loadingOv);
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

  function resultKey(): string {
    return state.mode === "inpaint" ? `inpaint:${state.paintSubMode}` : state.mode === "i2i" ? `i2i:${state.i2iSubMode}` : state.mode;
  }
  function currentSourceFilename(): string {
    if (state.mode === "i2i") return state.i2iSubMode === "ref2img" ? "" : state.i2iImage || "";
    if (state.mode === "edit") return state.editAnnotImage || state.editImage1 || "";
    if (state.mode === "inpaint") return (state.paintSubMode === "inpaint" ? state.inpaintAnnotImage || state.inpaintImage : state.inpaintImage) || "";
    if (state.mode === "upscale") return state.upscaleImage || "";
    return "";
  }

  // ── Compare view — clip-path 방식 ──────────────────────────────────────
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

  // ── Send to / Output toggle / Status ───────────────────────────────────
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
    if (compareEnabled && state.mode !== "t2i" && !(state.mode === "i2i" && state.i2iSubMode === "ref2img") && srcFile) {
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
          if (t.field === "inpaintImage") state.paintSubMode = (t.subMode as PaintSubMode) || "inpaint";
          if (t.mode === state.mode) {
            persist();
            renderLeftPanel();
          } else {
            if (t.subMode) state.paintSubMode = t.subMode;
            state.mode = t.mode as Q21Mode;
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

  // ── Prompt box — 헤더 순서: Auto Enhance 체크박스 → 🔍 Prompt Edit → 📋 Prompt Preset ──
  const promptWrap = el("div", { style: { flexShrink: "0", display: "flex", flexDirection: "column", gap: "6px" } });
  const promptHdr = el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } });
  const charCount = el("span", { style: { color: C.muted, fontSize: "10px" } });
  promptHdr.append(el("div", { text: "PROMPT", style: { color: C.muted, fontSize: "11px", flex: "1", textTransform: "uppercase", letterSpacing: "0.04em" } }), charCount);

  const autoEnhanceChk = el("input", { type: "checkbox" }) as HTMLInputElement;
  autoEnhanceChk.checked = !!state.autoEnhance;
  autoEnhanceChk.addEventListener("change", () => { state.autoEnhance = autoEnhanceChk.checked; persist(); });
  const autoEnhanceLbl = el("label", {
    title: "Automatically run Prompt Enhance on the current prompt right before Generate, updating the PROMPT field in place.",
    style: { display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: C.muted, cursor: "pointer" },
  }, [autoEnhanceChk, el("span", { text: "Auto Enhance" })]);
  promptHdr.appendChild(autoEnhanceLbl);

  function purpleHdrBtn(text: string, onClick: () => void) {
    return el("button", {
      type: "button", text, onclick: onClick,
      style: { background: BRAND, color: "#fff", border: "none", borderRadius: "6px", padding: "6px 10px", cursor: "pointer", fontSize: "11px", fontWeight: "700", whiteSpace: "nowrap" },
    });
  }
  const expandBtn = purpleHdrBtn("🔍 Prompt Edit", () => promptExpandOv.show());
  const templatesBtn = purpleHdrBtn("📋 Prompt Preset", () => templateOv.show());
  promptHdr.append(expandBtn, templatesBtn);

  const promptTA = el("textarea", { placeholder: "Describe what you want to generate…", style: { width: "100%", boxSizing: "border-box", background: C.bg1, color: C.text, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "9px", fontSize: "13px", fontFamily: "inherit", resize: "vertical", minHeight: "180px", outline: "none" } }) as HTMLTextAreaElement;
  function updatePromptCount() {
    const n = getModePrompt(state, state.mode).trim().length;
    charCount.textContent = ` (${n} chars${n < 20 ? " ⚠" : ""})`;
    charCount.style.color = n < 20 ? C.warn : C.muted;
  }
  function refreshPromptBox() {
    promptTA.value = getModePrompt(state, state.mode);
    updatePromptCount();
  }
  refreshPromptBox();
  promptTA.addEventListener("input", () => { setModePrompt(state, state.mode, promptTA.value); persist(); updatePromptCount(); });

  promptWrap.append(promptHdr, promptTA);
  rightPanel.appendChild(promptWrap);

  const llmState = loadLlmState();
  const promptExpandOv = createPromptEditPopup({
    fetchApi: (path, opts) => comfyApi.fetchApi(path, opts),
    getPrompt: () => getModePrompt(state, state.mode),
    setPrompt: (text) => { setModePrompt(state, state.mode, text); refreshPromptBox(); },
    persist,
    openImageGalleryPicker: (onPick) => openImageGalleryPicker(onPick),
    viewUrl: (filename) => api.viewUrl(filename, "", "input"),
    llm: llmState,
    saveLlm: () => saveLlmState(llmState),
    openSettings: () => settingsOv.show(),
    title: "🔍 Prompt — Full Screen Edit",
  });
  // Opening Prompt Edit auto-defaults Model Format to "Qwen Image 2.1 (T2I)" — but only when
  // the field is still empty or on the shared generic default, never overwriting a value the
  // user already deliberately changed. 원본: one_node_qwen21.js의 promptExpandOv.show 오버라이드.
  const origPromptExpandShow = promptExpandOv.show.bind(promptExpandOv);
  promptExpandOv.show = () => {
    origPromptExpandShow();
    if (!llmState.model_format || llmState.model_format === "Universal Natural Language") {
      const sel = [...promptExpandOv.el.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "Qwen Image 2.1 (T2I)"));
      if (sel && (sel.value === "Universal Natural Language" || !sel.value)) {
        sel.value = "Qwen Image 2.1 (T2I)";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  };
  const templateOv = createTemplateOverlay(
    () => state.mode,
    (text) => { setModePrompt(state, state.mode, text); persist(); refreshPromptBox(); }
  );
  wrap.appendChild(promptExpandOv.el);
  wrap.appendChild(templateOv.el);

  // ── Auto Enhance — Generate 직전 현재 프롬프트에 Prompt Enhance를 조용히 1회 실행하고
  // 결과로 PROMPT 필드를 갱신한 다음 그 프롬프트로 생성한다. 원본 llmApi.enhance()와 동일하게
  // Settings/Prompt Edit과 같은 tj_studio_one_llm_settings 백엔드 설정을 그대로 사용한다.
  async function runAutoEnhance(): Promise<void> {
    const prompt = getModePrompt(state, state.mode).trim();
    if (!prompt) return;
    const r = await comfyApi.fetchApi("/tj_studio_one/llm/enhance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        backend: llmState.backend_text || "local",
        or_model: llmState.or_model,
        gguf_model: llmState.gguf_model,
        text_encoder_name: llmState.text_encoder_name,
        clip_loader_type: llmState.clip_loader_type,
        n_gpu_layers: llmState.n_gpu_layers,
        n_ctx: llmState.n_ctx,
        max_tokens: llmState.max_tokens,
        temperature: llmState.temperature,
        seed: llmState.seed,
        model_format: llmState.model_format,
        aesthetic: llmState.aesthetic,
        extra_instructions: llmState.extra_instructions,
      }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "enhance failed");
    setModePrompt(state, state.mode, d.result);
    refreshPromptBox();
    persist();
  }

  // ── Seed + Generate/Stop ────────────────────────────────────────────────
  const seedInput = numberField(state.seed, (v) => { state.seed = v; persist(); }, 1);
  const seedModeDD = select(
    [{ value: "randomize", label: "Random" }, { value: "fixed", label: "Fixed" }, { value: "increment", label: "+1" }, { value: "decrement", label: "-1" }],
    state.seedMode,
    (v) => { state.seedMode = v; persist(); }
  );
  const seedGenWrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px", paddingTop: "8px", borderTop: `1px solid ${C.border}` } });
  seedGenWrap.appendChild(panel([row([col([label("SEED"), seedInput]), col([label("MODE"), seedModeDD])])]));
  leftBottomBar.appendChild(seedGenWrap);

  const genBtn = button("▶ Generate", () => generate(), "primary");
  genBtn.style.width = "100%";
  const stopBtn = button("■ Stop", () => stopGeneration(), "danger");
  stopBtn.style.width = "100%";
  stopBtn.style.display = "none";
  leftBottomBar.append(genBtn, stopBtn);

  // ── Overlays ────────────────────────────────────────────────────────────
  const settingsOv = createSettingsOverlay(state, {
    persist,
    get availableLoras() { return availableLoras; },
    set availableLoras(v: string[]) { availableLoras = v; },
    onModelsRefreshed: () => { renderLeftPanel(); },
    onCacheOrSageChange: () => {},
  } as any);
  wrap.style.position = "relative";
  wrap.appendChild(settingsOv.el);

  const galleryOv = createGalleryOverlay(
    state,
    (meta: any) => { applyReuseMeta(meta); },
    (mode: string, field: string, extra: string | undefined, filename: string) => {
      (state as any)[field] = filename;
      if (extra) state.paintSubMode = extra as PaintSubMode;
      state.mode = mode as Q21Mode;
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
  function loraSection(loras: () => Q21State["loras"]) {
    const wrap2 = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } });
    function rebuild() {
      clear(wrap2);
      loras().forEach((l, i) => {
        const nameOpts = ["none", ...availableLoras.filter((n) => n !== "none")];
        const trigIn = el("input", { type: "text", placeholder: "trigger word", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "5px", fontSize: "11px" } }) as HTMLInputElement;
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
        wrap2.appendChild(panel([
          headerRow,
          nameSel.el,
          row([col([label("Trigger Word"), trigIn]), col([label("Strength"), strIn])]),
        ]));
      });
      if (loras().length < LORA_UI_CAP) {
        wrap2.appendChild(button(`+ Add LoRA (max ${LORA_UI_CAP})`, () => { loras().push({ name: "none", strength: 1, triggerWord: "", enabled: true }); persist(); rebuild(); }));
      }
    }
    rebuild();
    return wrap2;
  }

  function imageUploadSlot(currentFilename: string | null, onSet: (name: string) => void, onLoad?: (w: number, h: number) => void, probeIfUnknown?: boolean) {
    const wrap2 = el("div", { style: { border: `2px dashed ${C.border}`, borderRadius: "8px", padding: "8px", textAlign: "center", cursor: "pointer", minHeight: "180px", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", background: C.bg2 } });
    const img = el("img", { style: { maxWidth: "100%", maxHeight: "168px", display: "none", borderRadius: "4px" } }) as HTMLImageElement;
    const hint = el("div", { text: "Click or drag to upload", style: { color: C.muted, fontSize: "11px" } });
    const fileIn = el("input", { type: "file", accept: "image/*", style: { display: "none" } }) as HTMLInputElement;
    wrap2.append(hint, img, fileIn);
    const clearBtn2 = el("button", { type: "button", text: "✕", title: "Remove", style: { position: "absolute", top: "4px", right: "4px", zIndex: "3", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", borderRadius: "4px", width: "20px", height: "20px", cursor: "pointer", fontSize: "11px", padding: "0", display: "none" } });
    clearBtn2.addEventListener("click", (e) => {
      e.stopPropagation();
      img.style.display = "none";
      img.src = "";
      hint.style.display = "";
      clearBtn2.style.display = "none";
      onSet("");
    });
    wrap2.appendChild(clearBtn2);
    async function handleFile(file: File) {
      hint.textContent = "Uploading…";
      try {
        const name = await api.uploadImage(file, file.name);
        onSet(name);
        const url = api.viewUrl(name, "", "input", Date.now());
        img.src = url;
        img.style.display = "block";
        hint.style.display = "none";
        clearBtn2.style.display = "block";
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
      clearBtn2.style.display = "block";
      if (onLoad) {
        const probe = new Image();
        probe.onload = () => onLoad(probe.naturalWidth, probe.naturalHeight);
        probe.src = url;
      }
    }
    const galleryBtn2 = el("button", { type: "button", text: "🖼", title: "Pick from gallery", style: { position: "absolute", bottom: "4px", left: "4px", zIndex: "3", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", borderRadius: "4px", width: "22px", height: "22px", cursor: "pointer", fontSize: "12px", padding: "0" } });
    galleryBtn2.addEventListener("click", (e) => { e.stopPropagation(); openImageGalleryPicker((name) => applyPicked(name)); });
    wrap2.appendChild(galleryBtn2);

    wrap2.addEventListener("click", () => fileIn.click());
    fileIn.addEventListener("change", () => { if (fileIn.files?.[0]) handleFile(fileIn.files[0]); });
    wrap2.addEventListener("dragover", (e) => { e.preventDefault(); wrap2.style.borderColor = BRAND; });
    wrap2.addEventListener("dragleave", () => { wrap2.style.borderColor = C.border; });
    wrap2.addEventListener("drop", (e) => { e.preventDefault(); wrap2.style.borderColor = C.border; const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f); });

    if (currentFilename) {
      const url = api.viewUrl(currentFilename, "", "input");
      img.src = url;
      img.style.display = "block";
      hint.style.display = "none";
      clearBtn2.style.display = "block";
      if (onLoad && probeIfUnknown) {
        const probe = new Image();
        probe.onload = () => onLoad(probe.naturalWidth, probe.naturalHeight);
        probe.src = url;
      }
    }
    (wrap2 as any)._setFilename = (name: string | null) => { if (name) applyPicked(name); else { img.style.display = "none"; img.src = ""; hint.style.display = ""; clearBtn2.style.display = "none"; } };
    return wrap2;
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

  // ── Ref-to-Image / Edit-extra 공통: MiniMax H3식 압축 그리드 ────────────────
  function refImageGrid(getList: () => { filename: string }[], setList: (l: { filename: string }[]) => void, max: number, labelPrefix: string, boxSize = 76) {
    const gridWrap = el("div", { style: { display: "flex", flexWrap: "wrap", gap: "5px", justifyContent: "center" } });
    function render() {
      clear(gridWrap);
      const refs = getList().slice(0, max);
      gridWrap.appendChild(el("div", { text: `${labelPrefix} (${refs.length}/${max})`, style: { width: "100%", textAlign: "center", fontSize: "10px", color: C.muted, marginBottom: "2px" } }));
      for (let i = 0; i < Math.min(max, refs.length + 1); i++) {
        const current = refs[i]?.filename || null;
        const slot = imageSlot(current ? `#${i + 1}` : "+ add\nreference", current, (fn) => {
          const list = getList().slice();
          if (fn) list[i] = { filename: fn }; else list.splice(i, 1);
          setList(list.filter(Boolean).slice(0, max));
          persist();
          render();
        }, { box: boxSize });
        if (current) {
          slot.el.draggable = true;
          slot.el.addEventListener("dragstart", (e) => { e.dataTransfer?.setData("text/plain", String(i)); });
          slot.el.addEventListener("dragover", (e) => e.preventDefault());
          slot.el.addEventListener("drop", (e) => {
            e.preventDefault();
            const from = Number(e.dataTransfer?.getData("text/plain"));
            if (Number.isNaN(from) || from === i) return;
            const list = getList().slice();
            const [moved] = list.splice(from, 1);
            list.splice(i, 0, moved);
            setList(list.filter(Boolean).slice(0, max));
            persist();
            render();
          });
        }
        gridWrap.appendChild(slot.el);
      }
    }
    render();
    return { el: gridWrap, render };
  }

  function renderLeftPanel() {
    clear(leftScroll);
    if (state.mode === "t2i") {
      const matched = RESOLUTIONS.find((r) => r.w === state.width && r.h === state.height);
      const isCustom = !matched || matched.label === "Custom";
      const customRow = row([col([label("W"), numberField(state.width, (v) => { state.width = Math.max(64, snap8(v)) || 1024; persist(); }, 8)]), col([label("H"), numberField(state.height, (v) => { state.height = Math.max(64, snap8(v)) || 1024; persist(); }, 8)])]);
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
      const subRow = row([
        button("I2I", () => { state.i2iSubMode = "i2i"; persist(); renderLeftPanel(); restorePreviewForMode(); renderSendTo(); }, state.i2iSubMode === "i2i" ? "primary" : "default"),
        button("Ref to Image", () => { state.i2iSubMode = "ref2img"; persist(); renderLeftPanel(); restorePreviewForMode(); renderSendTo(); }, state.i2iSubMode === "ref2img" ? "primary" : "default"),
      ]);
      leftScroll.appendChild(panel([subRow]));

      if (state.i2iSubMode === "ref2img") {
        const grid = refImageGrid(() => state.refImages, (l) => (state.refImages = l), MAX_REF_IMAGES, "Ref");
        leftScroll.appendChild(panel([grid.el]));
        leftScroll.appendChild(panel([row([col([label("WIDTH"), numberField(state.refWidth, (v) => { state.refWidth = v; persist(); }, 8)]), col([label("HEIGHT"), numberField(state.refHeight, (v) => { state.refHeight = v; persist(); }, 8)])])]));
        // Denoise는 반드시 있어야 한다(기본 1.0) — 원본에서 한 번 누락됐다가 복구된 필드.
        leftScroll.appendChild(panel([label("Denoise"), numberField(state.refDenoise ?? 1.0, (v) => { state.refDenoise = Math.max(0, Math.min(1, v)); persist(); }, 0.01)]));
        leftScroll.appendChild(panel([label("Sampling"), samplingSection()]));
        leftScroll.appendChild(panel([label("LoRA"), loraSection(() => state.loras)]));
      } else {
        let aspect = state.i2iWidth && state.i2iHeight ? state.i2iWidth / state.i2iHeight : 1;
        const wIn = numberField(state.i2iWidth || 512, (v) => {
          const nv = snap8(v || 512);
          state.i2iWidth = nv;
          if (state.i2iLockRatio && aspect > 0) { state.i2iHeight = snap8(nv / aspect); hIn.value = String(state.i2iHeight); }
          else if (state.i2iHeight) aspect = nv / state.i2iHeight;
          persist();
        }, 8);
        const hIn = numberField(state.i2iHeight || 512, (v) => {
          const nv = snap8(v || 512);
          state.i2iHeight = nv;
          if (state.i2iLockRatio && aspect > 0) { state.i2iWidth = snap8(nv * aspect); wIn.value = String(state.i2iWidth); }
          else if (state.i2iWidth) aspect = state.i2iWidth / nv;
          persist();
        }, 8);
        const lockChk = checkboxRow("🔒 Lock ratio", state.i2iLockRatio ?? true, (v) => { state.i2iLockRatio = v; if (state.i2iWidth && state.i2iHeight) aspect = state.i2iWidth / state.i2iHeight; persist(); });
        const sizeEl = col([row([col([label("W"), wIn]), col([label("H"), hIn])]), lockChk]);

        const card = imageUploadSlot(state.i2iImage, (name) => { state.i2iImage = name; persist(); }, (w, h) => {
          state.i2iWidth = snap8(w); state.i2iHeight = snap8(h); aspect = w / h; persist(); renderLeftPanel();
        }, !state.i2iWidth || !state.i2iHeight);
        leftScroll.appendChild(panel([label("Source Image"), card, sizeEl]));
        leftScroll.appendChild(panel([label("Denoise"), numberField(state.i2iDenoise, (v) => { state.i2iDenoise = Math.max(0, Math.min(1, v)); persist(); }, 0.01)]));
        leftScroll.appendChild(panel([label("Sampling"), samplingSection()]));
        leftScroll.appendChild(panel([label("LoRA"), loraSection(() => state.loras)]));
      }
    } else if (state.mode === "edit") {
      // Image 1 — 카드 썸네일은 주석(annotated) 버전이 있으면 그것을 보여주되, 실제 업로드된
      // 원본 파일명(state.editImage1)은 그대로 유지된다. 재드로잉 시 항상 원본에서 다시
      // 그린다 — 원본 코멘트: "재-주석 시 이전 주석이 아니라 원본에서 다시 flatten".
      const card1 = imageUploadSlot(state.editAnnotImage || state.editImage1, (fn) => {
        state.editImage1 = fn; state.editAnnotImage = null; state.editAnnotStrokes = []; persist();
      });
      leftScroll.appendChild(panel([label("Image 1 (main reference)"), card1]));

      const draw1Btn = button(state.editAnnotImage ? "✏ Edit annotation" : "✏ Draw annotation", () => {
        if (!state.editImage1) { alert("Upload Image 1 first."); return; }
        const url = api.viewUrl(state.editImage1, "", "input");
        openMaskDrawOverlay(previewBox.parentElement ? wrap : wrap, url, (filename, strokes) => {
          state.editAnnotImage = filename; state.editAnnotStrokes = strokes; persist();
          renderLeftPanel();
        }, state.editAnnotStrokes);
      });
      leftScroll.appendChild(draw1Btn);
      if (state.editAnnotImage) {
        leftScroll.appendChild(el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } }, [
          el("div", { text: "✓ Image 1 annotation attached.", style: { fontSize: "10px", color: BRAND, flex: "1" } }),
          button("✕ Remove", () => { state.editAnnotImage = null; state.editAnnotStrokes = []; persist(); renderLeftPanel(); }, "danger"),
        ]));
      }

      // Images 2–10 — MiniMax H3 압축 그리드, 각 슬롯마다 개별 ✏ 주석 버튼.
      const extraWrap = el("div");
      function renderExtraGrid() {
        clear(extraWrap);
        const gridWrap = el("div", { style: { display: "flex", flexWrap: "wrap", gap: "5px", justifyContent: "center" } });
        const refs = (state.editRefImages || []).slice(0, MAX_EDIT_EXTRA);
        gridWrap.appendChild(el("div", { text: `Images 2–10 (${refs.length}/${MAX_EDIT_EXTRA})`, style: { width: "100%", textAlign: "center", fontSize: "10px", color: C.muted, marginBottom: "2px" } }));
        for (let i = 0; i < Math.min(MAX_EDIT_EXTRA, refs.length + 1); i++) {
          const current = refs[i]?.filename || null;
          const annotated = state.editRefAnnotations[i] || null;
          const cell = el("div", { style: { display: "flex", flexDirection: "column", gap: "2px", alignItems: "center" } });
          const slot = imageSlot(current ? `Img ${i + 2}` : "+ add\nimage", annotated || current, (fn) => {
            const list = (state.editRefImages || []).slice();
            if (fn) { list[i] = { filename: fn }; delete state.editRefAnnotations[i]; delete state.editRefAnnotationStrokes[i]; }
            else { list.splice(i, 1); delete state.editRefAnnotations[i]; delete state.editRefAnnotationStrokes[i]; }
            state.editRefImages = list.filter(Boolean).slice(0, MAX_EDIT_EXTRA);
            persist();
            renderExtraGrid();
          }, { box: 76 });
          cell.appendChild(slot.el);
          if (current) {
            slot.el.draggable = true;
            slot.el.addEventListener("dragstart", (e) => { e.dataTransfer?.setData("text/plain", String(i)); });
            slot.el.addEventListener("dragover", (e) => e.preventDefault());
            slot.el.addEventListener("drop", (e) => {
              e.preventDefault();
              const from = Number(e.dataTransfer?.getData("text/plain"));
              if (Number.isNaN(from) || from === i) return;
              const list = (state.editRefImages || []).slice();
              const [moved] = list.splice(from, 1);
              list.splice(i, 0, moved);
              state.editRefImages = list.filter(Boolean).slice(0, MAX_EDIT_EXTRA);
              persist();
              renderExtraGrid();
            });
            const drawBtn = el("button", {
              type: "button", text: annotated ? "✓✏" : "✏", title: annotated ? "Edit this image's annotation" : "Draw annotation on this image",
              style: { cursor: "pointer", background: annotated ? BRAND : C.bg2, color: "#fff", border: `1px solid ${C.border}`, borderRadius: "4px", fontSize: "10px", padding: "1px 6px" },
            });
            drawBtn.addEventListener("click", () => {
              const url = api.viewUrl(current, "", "input");
              openMaskDrawOverlay(wrap, url, (filename, strokes) => {
                state.editRefAnnotations[i] = filename; state.editRefAnnotationStrokes[i] = strokes; persist();
                renderExtraGrid();
              }, state.editRefAnnotationStrokes[i] as Stroke[] | undefined);
            });
            cell.appendChild(drawBtn);
          }
          gridWrap.appendChild(cell);
        }
        extraWrap.appendChild(panel([gridWrap]));
      }
      renderExtraGrid();
      leftScroll.appendChild(extraWrap);

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

      const card = imageUploadSlot(state.inpaintAnnotImage || state.inpaintImage, (name) => {
        state.inpaintImage = name; state.inpaintAnnotImage = null; state.inpaintAnnotStrokes = []; persist();
      });
      leftScroll.appendChild(panel([label("Source Image"), card]));

      if (state.paintSubMode === "inpaint") {
        const drawBtn = button(state.inpaintAnnotImage ? "✏ Edit mask" : "✏ Draw mask (required)", () => {
          if (!state.inpaintImage) { alert("Upload a source image first."); return; }
          const url = api.viewUrl(state.inpaintImage, "", "input");
          openMaskDrawOverlay(wrap, url, (filename, strokes) => {
            state.inpaintAnnotImage = filename; state.inpaintAnnotStrokes = strokes; persist();
            renderLeftPanel();
          }, state.inpaintAnnotStrokes);
        });
        leftScroll.appendChild(drawBtn);
        if (state.inpaintAnnotImage) {
          leftScroll.appendChild(el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } }, [
            el("div", { text: "✓ Marked area ready.", style: { fontSize: "10px", color: BRAND, flex: "1" } }),
            button("✕ Remove", () => { state.inpaintAnnotImage = null; state.inpaintAnnotStrokes = []; persist(); renderLeftPanel(); }, "danger"),
          ]));
        }
        leftScroll.appendChild(panel([label("Denoise"), numberField(state.inpaintDenoise ?? 0.85, (v) => { state.inpaintDenoise = Math.max(0.1, Math.min(1, v)); persist(); }, 0.01)]));
        leftScroll.appendChild(panel([label("Sampling"), samplingSection()]));
        leftScroll.appendChild(panel([label("LoRA"), loraSection(() => state.loras)]));
      } else {
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
        leftScroll.appendChild(panel([label("Sampling"), samplingSection()]));
        leftScroll.appendChild(panel([label("LoRA"), loraSection(() => state.loras)]));
      }
    } else if (state.mode === "upscale") {
      const card = imageUploadSlot(state.upscaleImage, (name) => { state.upscaleImage = name; persist(); });
      leftScroll.appendChild(panel([label("Source Image"), card]));
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
        row([col([label("Batch Size"), numberField(state.upscaleBatchSize ?? 1, (v) => { state.upscaleBatchSize = v; persist(); }, 1)]), col([label("Blocks to Swap"), numberField(state.upscaleBlocksToSwap ?? 0, (v) => { state.upscaleBlocksToSwap = v; persist(); }, 1)])]),
        row([col([label("Attention Mode"), select(SEEDVR2_ATTN_MODES, state.upscaleAttentionMode, (v) => { state.upscaleAttentionMode = v; persist(); })]), col([label("Color Correction"), select(SEEDVR2_COLOR_MODES, state.upscaleColorCorrection, (v) => { state.upscaleColorCorrection = v; persist(); })])]),
        col([label("Offload Device"), select(["cpu", "cuda:0"], state.upscaleOffloadDevice, (v) => { state.upscaleOffloadDevice = v; persist(); })]),
        row([col([label("Input Noise Scale"), numberField(state.upscaleInputNoiseScale ?? 0, (v) => { state.upscaleInputNoiseScale = v; persist(); }, 0.01)]), col([label("Latent Noise Scale"), numberField(state.upscaleLatentNoiseScale ?? 0, (v) => { state.upscaleLatentNoiseScale = v; persist(); }, 0.01)])]),
      ]));
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

  // ── Generate / Stop ────────────────────────────────────────────────────
  async function generate() {
    if (samplingActive) return;
    if (!state.model || state.model === "none") { warnTag.textContent = "⚙ Set Model / Text Encoder / VAE in Settings"; return; }
    if (!state.textEncoder || state.textEncoder === "none") { warnTag.textContent = "⚙ Set Text Encoder in Settings"; return; }
    if (!state.vae || state.vae === "none") { warnTag.textContent = "⚙ Set VAE in Settings"; return; }
    if (state.mode === "i2i") {
      if (state.i2iSubMode === "ref2img") {
        if (!(state.refImages || []).filter((r) => r?.filename).length) { warnTag.textContent = "Add at least one Ref to Image reference"; return; }
      } else if (!state.i2iImage) { warnTag.textContent = "Upload an I2I source image"; return; }
    }
    if (state.mode === "edit" && !state.editImage1) { warnTag.textContent = "Upload Image 1 for Edit mode"; return; }
    if (state.mode === "inpaint") {
      if (state.paintSubMode === "inpaint") {
        if (!state.inpaintImage) { warnTag.textContent = "Upload an Inpaint source image"; return; }
        if (!state.inpaintAnnotImage) { warnTag.textContent = "Draw and commit the marked area first"; return; }
      } else {
        if (!state.inpaintImage) { warnTag.textContent = "Upload an Outpaint source image"; return; }
        const total = (state.outpaintUp || 0) + (state.outpaintDown || 0) + (state.outpaintLeft || 0) + (state.outpaintRight || 0);
        if (total <= 0) { warnTag.textContent = "Enter an Expansion value for at least one direction"; return; }
      }
    }
    if (state.mode === "upscale") {
      if (!state.upscaleImage) { warnTag.textContent = "Upload an Upscale source image"; return; }
      if (!state.upscaleDitModel || state.upscaleDitModel === "none" || !state.upscaleVaeModel || state.upscaleVaeModel === "none") { warnTag.textContent = "Select the SeedVR2 DiT/VAE models"; return; }
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
    loadingOv.style.display = "flex";

    if (state.autoEnhance && getModePrompt(state, state.mode).trim()) {
      statusText.textContent = "Enhancing…";
      try {
        await runAutoEnhance();
      } catch (e: any) {
        statusText.textContent = `Auto Enhance failed: ${e.message || e}`;
        samplingActive = false;
        genBtn.style.display = "block";
        stopBtn.style.display = "none";
        loadingOv.style.display = "none";
        return;
      }
      statusText.textContent = "Queuing…";
    }

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
      loadingOv.style.display = "none";
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
        loadingOv.style.display = "none";
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
  hdr.append(el("div", { text: "❔ QWEN IMAGE 2.1 ONE STUDIO Help", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }), button("✕", () => (ov.style.display = "none"), "danger"));
  const bodyEl = el("div", { style: { color: C.text, fontSize: "12px", lineHeight: "1.7" } });
  bodyEl.innerHTML = `
    <b>T2I</b>: Pick a resolution preset (or Custom W/H), write a prompt, Generate.<br>
    <b>I2I</b>: Image-to-image with a single Source Image and a Denoise slider — lower keeps more of the original. Optional custom output size with a 🔒 Lock ratio toggle.<br>
    <b>I2I — Ref to Image</b>: Up to 10 reference images composed into a new image from your prompt, at its own output resolution.<br>
    <b>EDIT</b>: Image 1 is the main reference; Images 2–10 are extra references in a compact grid (drag to reorder). Each image can get its own hand-drawn ✏ annotation pointing at what to change — sent as an extra reference, not a mask.<br>
    <b>PAINT — Inpaint</b>: Draw directly on the Source Image to mark the area to change. No separate mask file — the marked-up image is sent as a second reference alongside the original.<br>
    <b>PAINT — Outpaint</b>: Expands the canvas (Up/Down/Left/Right) and fills the new border with Pad Color before asking the model to extend the scene into it.<br>
    <b>UPSCALE</b>: SeedVR2 upscaler — pick a DiT + VAE model pair from models/SEEDVR2/, independent of the Qwen model above.<br>
    <b>Auto Enhance</b>: when checked, Generate first runs Prompt Enhance on the current prompt and updates the PROMPT field before generating with it.<br>
    <b>Send to / Gallery</b>: Copies the current result into the next mode's Source/Image 1 slot, or browse this tool's own render history in 🖼 Gallery.
  `;
  box.append(hdr, bodyEl);
  ov.appendChild(box);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.style.display = "none"; });
  return { el: ov, show() { ov.style.display = "flex"; }, hide() { ov.style.display = "none"; } };
}
