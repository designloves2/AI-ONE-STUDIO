// view.ts — Krea2 메인 화면 조립.
// MiniMax H3(view.ts)의 레이아웃 패턴(subBar/leftPanel/rightPanel/promptWrap/statusWrap +
// 외부 큐 배너)을 따르되, Krea2는 단발성(single-shot) 생성이라 릴레이 루프가 없다.
// 상태 필드/그래프는 원본 web/krea2/*.js 와 1:1로 맞춘다 (core.ts/graphBuilder.ts 주석 참고).
import type { Krea2State } from "./core";
import {
  C, el, clear, BRAND, MODES, RESOLUTIONS, SAMPLERS, SCHEDULERS,
  LORA_UI_CAP, SEEDVR2_ATTN_MODES, SEEDVR2_COLOR_MODES, DEPTH_CKPTS, SEND_TO,
  defaultState, loadState, saveState, getModePrompt, setModePrompt, randomSeed, snap8,
} from "./core";
import { panel, label, button, select, numberField, row, col, modeBar, iconBtn, checkboxRow, searchableSelect, openFullscreen } from "../../shared/ui";
import * as api from "./api";
import { buildGraph, buildControlPreviewGraph } from "./graphBuilder";
import { queuePrompt } from "./comfyClient";
import type { AppConfig } from "./settings";
import { createSettingsOverlay } from "./settings";
import { createGalleryOverlay } from "./galleryOverlay";
import { createPromptExpandOverlay, createTemplateOverlay } from "./promptTools";

export function renderKrea2(root: HTMLElement) {
  clear(root);
  root.className = "flex-1 min-h-0 flex flex-col";
  root.style.background = C.bg0;

  const state: Krea2State = defaultState(loadState());
  let availableLoras: string[] = [];
  let samplingActive = false;
  let queuedPromptId: string | null = null;
  const appConfig: AppConfig = { output_mode_visible: true };

  function persist() { saveState(state); }

  const wrap = el("div", { style: { flex: "1", minHeight: "0", display: "flex", flexDirection: "column", padding: "10px", gap: "8px", boxSizing: "border-box" } });
  root.appendChild(wrap);

  // ── Sub bar: mode pills + icons ────────────────────────────────────────
  const subBar = el("div", { style: { display: "flex", alignItems: "center", gap: "10px", flexShrink: "0" } });
  const modeBarWrap = el("div");
  function renderModeBar() {
    clear(modeBarWrap);
    modeBarWrap.appendChild(
      modeBar(MODES.map((m) => ({ key: m.key, label: m.label })), state.mode, (key) => {
        state.mode = key as any;
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

  // 원본 topBar 아이콘: ↺ Reset(전체 설정 초기화, 흰바탕/보라테두리 고정) · ⇌ Compare(토글) · 🗑 Unload · ⚙ · 🖼 · ?
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

  // ── Body: left panel + right preview ─────────────────────────────────────
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

  // ── Zoom / Pan (원본: 마우스 휠 확대, 드래그 이동 — Compare 미사용일 때만) ─────
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
    if (state.mode === "identity") return state.identityImage;
    if (state.mode === "upscale") return state.upscaleImage;
    return "";
  }

  // ── Compare view (원본 createCompareView) — 드래그 가능한 원본/결과 비교 슬라이더 ──
  let compareViewEl: HTMLElement | null = null;
  function createCompareView(originalURL: string, resultURL: string) {
    // clip-path 방식 — 두 이미지 다 컨테이너 100%/100%에 동일하게 object-fit:contain으로
    // 렌더링해서 항상 정확히 겹치게 하고, origImg는 clip-path(자기 박스 기준 %)로만 가려서
    // 드러낸다. 이전엔 origImg를 px 스냅샷 너비로 따로 두는 방식이라 컨테이너 레이아웃
    // 타이밍에 따라 작게 렌더링되며 두 이미지가 겹치지 않는 버그가 있었다.
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

  // ── Send to: + Output(Preview/Save) 토글 — 원본 one_node_krea2.js의 sendToWrap ──
  type ModeResult = { filename: string; subfolder: string; type: string };
  const modeResults: Partial<Record<string, ModeResult>> = {};
  /** 모드 전환 시 그 모드의 마지막 결과(있으면)를 원본 로직대로 표시 — compare 슬라이더 또는 단순 이미지. */
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
    // Preview 모드 결과는 ComfyUI가 type=temp로 저장하므로 저장된 실제 type을 그대로 써야 한다
    // (outputViewUrl은 type=output을 강제해서 404가 났었음).
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
  const externalQueueBanner = el("div", { style: { display: "none", color: C.warn, fontSize: "11px", background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "5px 8px" } });
  statusWrap.append(statusText, progressOuter, externalQueueBanner);
  rightPanel.appendChild(statusWrap);

  // ── Prompt box ──────────────────────────────────────────────────────────
  const promptWrap = el("div", { style: { flexShrink: "0", display: "flex", flexDirection: "column", gap: "6px" } });
  const promptHdr = el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } });
  const charCount = el("span", { style: { color: C.muted, fontSize: "10px" } });
  promptHdr.append(el("div", { text: "PROMPT", style: { color: C.muted, fontSize: "11px", flex: "1", textTransform: "uppercase", letterSpacing: "0.04em" } }), charCount);
  const templatesBtn = button("📋 Templates", () => templateOv.show());
  const expandBtn = button("⤢ Expand / LLM", () => promptExpandOv.show());
  promptHdr.append(templatesBtn, expandBtn);

  const promptTA = el("textarea", { placeholder: "Prompt…", style: { width: "100%", boxSizing: "border-box", background: C.bg1, color: C.text, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "9px", fontSize: "13px", fontFamily: "inherit", resize: "vertical", minHeight: "180px", outline: "none" } });
  function updatePromptCount() {
    const n = getModePrompt(state, state.mode).trim().length;
    charCount.textContent = ` (${n} chars${n < 20 ? " ⚠" : ""})`;
    charCount.style.color = n < 20 ? C.warn : C.muted;
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

  // ── Seed + Mode + Generate — 원본처럼 모드와 무관하게 항상 표시, 좌측 메뉴 최하단 고정 ──
  // (원본 seedGenWrap: SEED/MODE가 각 모드 패널이 아니라 좌측 패널 바깥에 항상 떠 있음)
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
      state.mode = mode as any;
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

  // 원본 resetBtn: 모델 선택(model/textEncoder/vae)만 보존하고 나머지 전체 설정을 초기화한다.
  function resetAllSettings() {
    if (!confirm("Reset all settings? Model selection is preserved.")) return;
    const { model, textEncoder, vae } = state;
    Object.assign(state, defaultState({}));
    if (model) state.model = model;
    if (textEncoder) state.textEncoder = textEncoder;
    if (vae) state.vae = vae;
    persist();
    renderModeBar();
    renderLeftPanel();
    refreshPromptBox();
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

  // ── Left panel per mode ───────────────────────────────────────────────────

  /** 원본 makeSizeFields — snap8 + 비율 고정. i2i/identity 공용. */
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
        // 원본 ui_t2i_krea2.js: LoRA 선택도 검색 가능한 드롭다운(loraSelect) + 트리거워드 자동 조회.
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
        // 헤더 줄: LORA .......... on ✕ / 그 아래 검색 → 선택 → (Trigger word | Strength).
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

  function controlNetSection(mode: "t2i" | "i2i") {
    const enabledKey = mode === "t2i" ? "t2iControlEnabled" : "i2iControlEnabled";
    const imgKey = mode === "t2i" ? "t2iControlImage" : "i2iControlImage";
    const wKey = mode === "t2i" ? "t2iControlImageW" : "i2iControlImageW";
    const hKey = mode === "t2i" ? "t2iControlImageH" : "i2iControlImageH";
    const wWrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } });
    function rebuild() {
      clear(wWrap);
      const enabled = (state as any)[enabledKey] ?? false;
      const enChk = checkboxRow("ControlNet 사용", enabled, (v) => { (state as any)[enabledKey] = v; persist(); rebuild(); });
      wWrap.appendChild(enChk);
      if (!enabled) return;

      const type = state.controlType || "depth";
      const typeSel = select([{ value: "canny", label: "✏️ Canny" }, { value: "depth", label: "🌊 Depth" }], type, (v) => { state.controlType = v; persist(); rebuild(); });
      wWrap.appendChild(col([label("Control Type"), typeSel]));

      const tip = el("div", { style: { fontSize: "10px", color: C.text, lineHeight: "1.55", background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px 9px" } });
      tip.innerHTML = type === "canny"
        ? "💡 <b>Canny</b> — 윤곽선을 정확히 고정해 포즈·얼굴 방향·실루엣을 충실히 재현합니다."
        : "💡 <b>Depth</b> — 전체 구도·프레이밍·스케일을 잡습니다. 세밀한 포즈는 Canny를 쓰세요.";
      wWrap.appendChild(tip);

      const uploadWrap = imageUploadSlot((state as any)[imgKey], (name) => { (state as any)[imgKey] = name; persist(); refreshSizeHint(); }, (w, h) => { (state as any)[wKey] = w; (state as any)[hKey] = h; persist(); refreshSizeHint(); });
      wWrap.appendChild(col([label("Control Image (원본 사진)"), uploadWrap]));
      const sizeHint = el("div", { text: "", style: { fontSize: "10px", color: C.muted, textAlign: "center" } });
      function refreshSizeHint() {
        const cw = (state as any)[wKey], ch = (state as any)[hKey];
        sizeHint.textContent = cw && ch ? `컨트롤 이미지 비율: ${cw} × ${ch}` : "";
      }
      refreshSizeHint();
      wWrap.appendChild(sizeHint);

      const strDefault = state.controlStrength ?? (type === "canny" ? 0.7 : 1.0);
      const strIn = numberField(strDefault, (v) => { state.controlStrength = v; persist(); }, 0.05);
      wWrap.appendChild(col([label("Strength"), strIn]));

      if (type === "canny") {
        wWrap.appendChild(row([col([label("Canny Low"), numberField(state.cannyLow ?? 100, (v) => { state.cannyLow = v; persist(); }, 1)]), col([label("Canny High"), numberField(state.cannyHigh ?? 200, (v) => { state.cannyHigh = v; persist(); }, 1)])]));
        wWrap.appendChild(col([label("Preprocess Resolution"), numberField(state.preprocResolution ?? 512, (v) => { state.preprocResolution = v; persist(); }, 64)]));
      } else {
        wWrap.appendChild(row([
          col([label("Depth Model"), select(DEPTH_CKPTS.map((n) => ({ value: n, label: n.replace("depth_anything_v2_", "").replace(".pth", "") })), state.depthCkpt, (v) => { state.depthCkpt = v; persist(); })]),
          col([label("Resolution"), numberField(state.preprocResolution ?? 512, (v) => { state.preprocResolution = v; persist(); }, 64)]),
        ]));
        wWrap.appendChild(row([
          col([label("Channel Mode"), select([{ value: "rgb", label: "RGB" }, { value: "grayscale", label: "Grayscale" }], state.controlChannelMode || "rgb", (v) => { state.controlChannelMode = v; persist(); })]),
          col([label("Normalize"), select([{ value: "per_image_minmax", label: "Per-image MinMax" }, { value: "none", label: "None" }], state.controlNormalize || "per_image_minmax", (v) => { state.controlNormalize = v; persist(); })]),
        ]));
        wWrap.appendChild(checkboxRow("Invert depth", state.controlInvert, (v) => { state.controlInvert = v; persist(); }));
      }

      const previewImg = el("img", { style: { width: "100%", borderRadius: "6px", display: "none", marginTop: "4px" } });
      const previewBtn = button(`👁 Preview ${type}`, async () => {
        const file = (state as any)[imgKey];
        if (!file) { warnTag.textContent = "컨트롤 이미지를 먼저 업로드하세요"; return; }
        try {
          previewBtn.textContent = "…";
          const g = buildControlPreviewGraph(state, file, type);
          const r = await queuePrompt(g);
          const out = Object.values(r.byNode).find((o: any) => o.images?.length) as any;
          if (out) {
            const im = out.images[0];
            previewImg.src = api.outputViewUrl(im.filename, im.subfolder || "", Date.now());
            previewImg.style.display = "block";
          }
        } catch (e: any) { alert(e.message || String(e)); }
        finally { previewBtn.textContent = `👁 Preview ${type}`; }
      });
      wWrap.append(previewBtn, previewImg);
    }
    rebuild();
    return wWrap;
  }

  function imageUploadSlot(currentFilename: string, onSet: (name: string) => void, onLoad?: (w: number, h: number) => void) {
    const wrap = el("div", { style: { border: `2px dashed ${C.border}`, borderRadius: "8px", padding: "8px", textAlign: "center", cursor: "pointer", minHeight: "180px", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", background: C.bg2 } });
    const img = el("img", { style: { maxWidth: "100%", maxHeight: "168px", display: "none", borderRadius: "4px" } });
    const hint = el("div", { text: "클릭 또는 드래그하여 업로드", style: { color: C.muted, fontSize: "11px" } });
    const fileIn = el("input", { type: "file", accept: "image/*", style: { display: "none" } });
    wrap.append(hint, img, fileIn);
    // 주의: 이전엔 img의 "load" 이벤트에서 onLoad→renderLeftPanel()을 호출했는데, 이 슬롯 자체가
    // renderLeftPanel()마다 새로 생성되고 기존 이미지를 다시 img.src에 세팅하므로 "load"가 또 발생 →
    // renderLeftPanel() 재호출 → 다시 "load"... 로 무한 재렌더 루프가 생겨 I2I/Identity처럼 이미
    // 이미지가 설정된 모드에서 페이지 전체가 멈춘 것처럼 보였다(클릭/체크박스/셀렉트 전부 무반응).
    // 그래서 이제 onLoad는 "새로 업로드했을 때"만, 화면에 보이는 img와 무관한 별도 Image()로 딱 한 번만 호출한다.
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
    wrap.addEventListener("click", () => fileIn.click());
    fileIn.addEventListener("change", () => { if (fileIn.files?.[0]) handleFile(fileIn.files[0]); });
    wrap.addEventListener("dragover", (e) => { e.preventDefault(); wrap.style.borderColor = BRAND; });
    wrap.addEventListener("dragleave", () => { wrap.style.borderColor = C.border; });
    wrap.addEventListener("drop", (e) => { e.preventDefault(); wrap.style.borderColor = C.border; const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f); });

    if (currentFilename) {
      img.src = api.viewUrl(currentFilename, "", "input");
      img.style.display = "block";
      hint.style.display = "none";
    }
    return wrap;
  }

  // Seed/Seed Mode는 원본처럼 이 패널이 아니라 좌측 최하단(seedGenWrap)에 항상 표시된다.
  function samplingSection() {
    return el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } }, [
      row([col([label("Steps"), numberField(state.steps, (v) => { state.steps = Math.max(1, Math.min(50, Math.round(v) || 1)); persist(); })]), col([label("CFG"), numberField(state.cfg, (v) => { state.cfg = Math.max(0, Math.min(20, v || 0)); persist(); }, 0.25)])]),
      row([col([label("Sampler"), select(SAMPLERS, state.sampler, (v) => { state.sampler = v; persist(); })]), col([label("Scheduler"), select(SCHEDULERS, state.scheduler, (v) => { state.scheduler = v; persist(); })])]),
    ]);
  }

  // Output(Save/Preview)은 원본처럼 좌측 패널이 아니라 미리보기 아래 sendToWrap의
  // 세그먼트 토글(renderOutputToggle)로 구현되어 있다 — ⚙ Settings 체크로 숨김/표시.

  function renderLeftPanel() {
    clear(leftScroll);
    if (state.mode === "t2i") {
      // 원본 mountT2ILeft: Resolution 프리셋 + Custom(0,0)일 때만 W/H 노출
      const matched = RESOLUTIONS.find((r) => r.w === state.width && r.h === state.height);
      const isCustom = !matched || matched.label === "Custom";
      const customRow = row([col([label("W"), numberField(state.width, (v) => { state.width = Math.max(64, Math.round(v / 64) * 64) || 1024; persist(); }, 64)]), col([label("H"), numberField(state.height, (v) => { state.height = Math.max(64, Math.round(v / 64) * 64) || 1024; persist(); }, 64)])]);
      customRow.style.display = isCustom ? "flex" : "none";
      const resSel = select(RESOLUTIONS.map((r) => ({ value: r.label, label: r.label })), isCustom ? "Custom" : matched!.label, (v) => {
        const p = RESOLUTIONS.find((r) => r.label === v);
        if (p && p.w > 0) { state.width = p.w; state.height = p.h; persist(); customRow.style.display = "none"; }
        else customRow.style.display = "flex";
      });
      leftScroll.appendChild(panel([label("Resolution"), resSel, customRow]));
      leftScroll.appendChild(panel([label("Sampling"), samplingSection()]));
      leftScroll.appendChild(panel([label("LoRA"), loraSection()]));
      leftScroll.appendChild(panel([label("ControlNet (Krea2 Control LoRA)"), controlNetSection("t2i")]));
    } else if (state.mode === "i2i") {
      leftScroll.appendChild(panel([
        label("Source Image"),
        imageUploadSlot(state.i2iImage, (name) => { state.i2iImage = name; persist(); }, (w, h) => { state.i2iWidth = snap8(w); state.i2iHeight = snap8(h); persist(); renderLeftPanel(); }),
        sizeFields(() => state.i2iWidth, (v) => (state.i2iWidth = v), () => state.i2iHeight, (v) => (state.i2iHeight = v), () => state.i2iLockRatio, (v) => (state.i2iLockRatio = v)),
      ]));
      leftScroll.appendChild(panel([label("Denoise"), numberField(state.i2iDenoise, (v) => { state.i2iDenoise = Math.max(0, Math.min(1, v)); persist(); }, 0.01)]));
      leftScroll.appendChild(panel([label("Sampling"), samplingSection()]));
      leftScroll.appendChild(panel([label("LoRA"), loraSection()]));
      leftScroll.appendChild(panel([label("ControlNet (Krea2 Control LoRA)"), controlNetSection("i2i")]));
    } else if (state.mode === "identity") {
      const swapBtn = button("⇄ Swap ①↔②", () => { const t = state.identityImage; state.identityImage = state.identityImageB; state.identityImageB = t; persist(); renderLeftPanel(); });
      leftScroll.appendChild(panel([
        el("div", { style: { display: "flex", gap: "8px" } }, [
          col([label("① Scene / Source"), imageUploadSlot(state.identityImage, (name) => { state.identityImage = name; persist(); }, (w, h) => { state.identityWidth = snap8(w); state.identityHeight = snap8(h); persist(); renderLeftPanel(); })]),
          col([label("② Subject / Face (optional)"), imageUploadSlot(state.identityImageB, (name) => { state.identityImageB = name; persist(); })]),
        ]),
        el("div", { style: { display: "flex", justifyContent: "center", marginTop: "6px" } }, [swapBtn]),
        sizeFields(() => state.identityWidth, (v) => (state.identityWidth = v), () => state.identityHeight, (v) => (state.identityHeight = v), () => state.identityLockRatio, (v) => (state.identityLockRatio = v)),
        el("div", { html: 'PROMPT에 <b>지시문</b>으로 편집 → 예: "recolor the car to matte black". 2장 사용 시 순서: ① 장면(scene), ② 인물/얼굴(subject).', style: { fontSize: "10px", color: C.muted, lineHeight: "1.55", marginTop: "6px" } }),
      ]));
      leftScroll.appendChild(panel([
        label("Reference fidelity (ref_boost)"),
        numberField(state.identityRefBoost ?? 1.0, (v) => { state.identityRefBoost = Math.max(0.5, Math.min(3, v)); persist(); }, 0.05),
        el("div", { text: "1.0 = off · >1 identity 강화 · <1 완화", style: { fontSize: "10px", color: C.muted } }),
        label("Grounding resolution (grounding_px)"),
        numberField(state.identityGroundingPx ?? 768, (v) => { state.identityGroundingPx = Math.max(0, Math.min(1536, v)); persist(); }, 64),
        el("div", { text: "높을수록 identity 강화(사람 1024+) · 낮을수록 edit adherence 강화(512) · 0 = native", style: { fontSize: "10px", color: C.muted } }),
        col([label("Fit mode"), select([{ value: "fit", label: "fit (v1.2, recommended)" }, { value: "crop (legacy)", label: "crop (legacy)" }], state.identityFitMode || "fit", (v) => { state.identityFitMode = v; persist(); })]),
      ]));
      leftScroll.appendChild(panel([label("Sampling"), samplingSection(), el("div", { text: "Turbo: 8 steps, CFG 1 (~1분). Removal 계열은 Raw 모델 + CFG ~3, ~20 steps 권장.", style: { fontSize: "10px", color: C.muted } })]));
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
    }
  }
  renderLeftPanel();

  // ── External queue banner (ComfyUI 실제 큐 상태 폴링) ─────────────────────
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
    if (!state.model) { warnTag.textContent = "⚙ Settings에서 Model / Text Encoder / VAE를 설정하세요"; return; }
    if (!state.textEncoder) { warnTag.textContent = "⚙ Settings에서 Text Encoder를 설정하세요"; return; }
    if (!state.vae) { warnTag.textContent = "⚙ Settings에서 VAE를 설정하세요"; return; }
    if (state.mode === "i2i" && !state.i2iImage) { warnTag.textContent = "I2I 소스 이미지를 업로드하세요"; return; }
    if (state.mode === "identity" && !state.identityImage) { warnTag.textContent = "Identity 소스 이미지를 업로드하세요"; return; }
    if (state.mode === "identity" && (!state.identityLora || state.identityLora === "none")) { warnTag.textContent = "⚙ Settings에서 Identity Edit LoRA를 설정하세요"; return; }
    if (state.mode === "upscale" && !state.upscaleImage) { warnTag.textContent = "Upscale 소스 이미지를 업로드하세요"; return; }
    if (state.mode === "upscale" && (!state.upscaleDitModel || state.upscaleDitModel === "none" || !state.upscaleVaeModel || state.upscaleVaeModel === "none")) { warnTag.textContent = "SeedVR2 DiT/VAE 모델을 선택하세요"; return; }
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

  // ── ESC로 열려있는 오버레이 닫기 (원본 동일 동작) ───────────────────────────
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (promptExpandOv.el.style.display !== "none") { promptExpandOv.hide(); return; }
    if (templateOv.el.style.display !== "none") { templateOv.hide(); return; }
    if (helpOv.el.style.display !== "none") { helpOv.hide(); return; }
    if (settingsOv.el.style.display !== "none") { settingsOv.hide(); return; }
    if (galleryOv.el.style.display !== "none") { galleryOv.hide(); return; }
  });
}

// ── Help 오버레이 ──────────────────────────────────────────────────────────
function createHelpOverlay() {
  const ov = el("div", { style: { position: "fixed", inset: "0", zIndex: "10001", background: "rgba(0,0,0,0.85)", display: "none", alignItems: "center", justifyContent: "center" } });
  const box = el("div", { style: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "16px", width: "min(640px, 92vw)", maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" } });
  const hdr = el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
  hdr.append(el("div", { text: "❔ Krea 2 도움말", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }), button("✕", () => (ov.style.display = "none"), "danger"));
  const body = el("div", { style: { color: C.text, fontSize: "12px", lineHeight: "1.7" } });
  body.innerHTML = `
    <b>모드</b>: Text→Image, Image→Image, Identity Edit(장면+인물 합성), Upscale(SeedVR2).<br>
    <b>ControlNet</b>: T2I/I2I 좌측 패널에서 Depth 또는 Canny 컨트롤 이미지를 활성화할 수 있습니다. LoRA 파일은 ⚙ Settings에서 1회 등록.<br>
    <b>Identity Edit</b>: ⚙ Settings에서 Identity Edit LoRA를 먼저 설정해야 합니다. 프롬프트는 지시문 형태로 작성하세요.<br>
    <b>프롬프트</b>: 📋 Templates에서 스타일/각도/조명 템플릿을 적용하거나, ⤢ Expand/LLM에서 로컬 LLM으로 프롬프트를 보강(Model Format/Aesthetic/Seed 포함)하거나 이미지를 프롬프트로 변환할 수 있습니다.<br>
    <b>상단 아이콘</b>: ↺ Reset(현재 모드 초기화) · 🧹 Unload VRAM(모델 언로드) · ⇄ Compare(원본/결과 비교) · ⚙ Settings · 🖼 Gallery.
  `;
  box.append(hdr, body);
  ov.appendChild(box);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.style.display = "none"; });
  return { el: ov, show() { ov.style.display = "flex"; }, hide() { ov.style.display = "none"; } };
}
