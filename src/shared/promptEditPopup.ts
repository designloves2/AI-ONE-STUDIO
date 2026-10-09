// promptEditPopup.ts — shared single-screen "Prompt Edit" popup (image drop/URL/gallery,
// Vision Task + Settings shortcut, Model Format + Aesthetic, Extra Instructions, Seed +
// seed-mode, Image→Prompt Write / Prompt Enhance / APPLY action row, footer backend/model
// summary, collapsible debug log) — config-driven factory so all 6 image tools can reuse it.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/shared/llm_panel.js attachLLMPanel (node db35f86 +
// 0177783/70626c8/e1988ca/71826f4/0757b7c) — single merged screen replacing the old
// Edit/Enhance/Image→Prompt 3-tab layout. DOM conventions (el()/C/BRAND) follow
// src/tools/minimax_h3/promptEdit.ts, this repo's other full-screen popup.
import { el } from "./ui";
import { C, BRAND } from "../identity";
import { createLlmBackendGroup, backendName, type LlmBackendState } from "./llmBackendPanel";
import { sameOriginSrc } from "./sameOriginImage";

// Per-prompt options (vision task / model format / aesthetic / extra instructions / seed) live
// on the same localStorage-backed object as the backend fields — matches node's single
// tj_studio_one_llm_settings blob so Settings and this popup never disagree.
export interface PromptEditLlmState extends LlmBackendState {
  vision_task?: string;
  model_format?: string;
  aesthetic?: string;
  extra_instructions?: string;
  seed?: number;
  seed_mode?: string; // "randomize" | "fixed" | "increment" | "decrement"
  gguf_model?: string;
  mmproj_file?: string;
  n_gpu_layers?: number;
  n_ctx?: number;
  max_tokens?: number;
  temperature?: number;
}

export interface PromptEditPopupConfig {
  /** Wraps fetch with this tool's ComfyUI base + credentials (same as its api.ts). */
  fetchApi: (path: string, opts?: RequestInit) => Promise<Response>;
  getPrompt: () => string;
  setPrompt: (text: string) => void;
  persist: () => void;
  /** Opens this tool's gallery picker; calls back with the picked input/ filename. */
  openImageGalleryPicker: (onPick: (filename: string) => void) => void;
  /** input/ view URL builder for a filename. */
  viewUrl: (filename: string) => string;
  llm: PromptEditLlmState;
  saveLlm: () => void;
  /** Opens the tool's own Settings overlay, scrolled/focused at the LLM section if possible. */
  openSettings?: () => void;
  title?: string; // header title text, default "Prompt Edit"
  /** The tool's main PROMPT textarea — Refine (run from the main header) disables it and covers it with a busy
   *  overlay while the LLM works (node attachLLMPanel `getPromptTA`). */
  getPromptTA?: () => HTMLTextAreaElement | null;
  /**
   * This tool's own Model Format preset (e.g. "Qwen Image 2.1 (T2I)"), applied once the real
   * model_formats list arrives from the server — but only while the field is still empty or on
   * the shared generic default ("Universal Natural Language"), never overwriting a value the
   * user already deliberately changed. Setting this inside show() itself (before the async
   * model list loads) would race the <select>'s real options never being there yet to match
   * against — every per-tool default lives here instead, applied from loadModelsOnce()'s own
   * populateSelect() call once the list is actually populated.
   */
  defaultModelFormat?: string;
}

export interface PromptEditPopupHandle {
  el: HTMLElement;
  show(): void;
  hide(): void;
  /** Same Prompt Enhance call the popup's own button makes (node `llmApi.enhance()`), for callers that run
   *  it programmatically — the image tools' "Auto Enhance" checkbox. Puts `prompt` in the popup's text box,
   *  enhances it in place (errors alert like the button's) and returns the box's text afterwards. */
  enhance(prompt: string): Promise<string>;
  /** Refine on the tool's main prompt without opening Prompt Edit (node `llmApi.refine()`): instruction popup -> LLM ->
   *  original / refined compare -> Apply writes the current mode's prompt back. */
  refine(): Promise<void>;
}

function selStyle(sel: HTMLSelectElement) {
  Object.assign(sel.style, { background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px 8px", fontSize: "12px", width: "100%", boxSizing: "border-box" });
  return sel;
}
function mkSelect(options: string[], value: string, onChange: (v: string) => void) {
  const s = el("select", {});
  options.forEach((o) => s.appendChild(el("option", { value: o, text: o, ...(o === value ? { selected: "selected" } : {}) })));
  s.addEventListener("change", () => onChange(s.value));
  return selStyle(s);
}
function fieldCol(labelText: string, control: HTMLElement) {
  const wrap = el("div", { style: { flex: "1", display: "flex", flexDirection: "column", gap: "3px", minWidth: "0" } });
  wrap.append(el("div", { text: labelText, style: { color: C.muted, fontSize: "11px" } }), control);
  return wrap;
}

// ══════════════════════════════════════════════════════════════════════════
// Refine — revise an already-written prompt from a typed instruction, then compare
// ══════════════════════════════════════════════════════════════════════════
// Port of node llm_panel.js runRefine (5a52038 + f7debf6): instruction popup → LLM → original /
// refined side by side → Re:Refine / Apply / Close. Overlays are fixed to the window (z 100000) so
// they sit above Prompt Edit. Phone (≤767px) stacks the two compare columns — web-only adaptation.
let lastRefineInstruction = "";

function injectRingStyle() {
  if (document.getElementById("tj-llm-ring-style")) return;
  const st = document.createElement("style");
  st.id = "tj-llm-ring-style";
  st.textContent = `
    @keyframes tj-llm-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .tj-llm-ring { width: 40px; height: 40px; border-radius: 50%; border: 4px solid rgba(255,255,255,0.15); border-top-color: #7eff7e; animation: tj-llm-spin 0.9s linear infinite; }
  `;
  document.head.appendChild(st);
}

/** Dim overlay with spinner + label (node `_makeBusyOverlay`). */
function makeBusyOverlay(label: string) {
  injectRingStyle();
  const ov = document.createElement("div");
  Object.assign(ov.style, { position: "absolute", inset: "0", background: "rgba(0,0,0,0.6)", display: "none", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", zIndex: "10", pointerEvents: "all", backdropFilter: "blur(1px)" });
  const ring = document.createElement("div"); ring.className = "tj-llm-ring";
  const lbl = document.createElement("div"); lbl.textContent = label || "";
  Object.assign(lbl.style, { color: "#ccc", fontSize: "12px", letterSpacing: "0.03em" });
  ov.append(ring, lbl);
  return { el: ov, setLabel: (s: string) => { lbl.textContent = s; } };
}

function refineOverlay() {
  const ov = document.createElement("div");
  Object.assign(ov.style, { position: "fixed", inset: "0", zIndex: "100000", background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" });
  const box = document.createElement("div");
  Object.assign(box.style, { background: "#1b1b1b", border: `1px solid ${BRAND}`, borderRadius: "10px", padding: "16px", display: "flex", flexDirection: "column", gap: "10px", boxSizing: "border-box", color: "#ddd", maxHeight: "90vh" });
  ov.appendChild(box);
  document.body.appendChild(ov);
  return { ov, box };
}
function refineBtn(text: string, bg: string) {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = text;
  Object.assign(b.style, { background: bg, color: "#fff", border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontSize: "13px", fontWeight: "700" });
  return b;
}
function refineTitle(text: string) {
  const d = document.createElement("div");
  d.textContent = text;
  Object.assign(d.style, { color: "#fff", fontSize: "14px", fontWeight: "700" });
  return d;
}

function askRefineInstruction(): Promise<string | null> {
  return new Promise((resolve) => {
    const { ov, box } = refineOverlay();
    box.style.width = "min(560px, 92vw)";
    const ta = document.createElement("textarea");
    ta.value = lastRefineInstruction; ta.rows = 5;
    ta.placeholder = "e.g. Make it nighttime, and change the red dress to a blue coat.";
    Object.assign(ta.style, { background: "#2a2a2a", color: "#ddd", border: "1px solid #444", borderRadius: "6px", padding: "8px 10px", fontSize: "13px", fontFamily: "inherit", resize: "vertical", outline: "none" });
    if (window.innerWidth <= 767) ta.style.fontSize = "16px"; // no iOS zoom on focus
    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, { display: "flex", gap: "8px", justifyContent: "flex-end" });
    const ok = refineBtn("Refine", BRAND);
    const cancel = refineBtn("Cancel", "#444");
    const done = (v: string | null) => { ov.remove(); resolve(v); };
    ok.addEventListener("click", () => done(ta.value.trim() || null));
    cancel.addEventListener("click", () => done(null));
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) ok.click(); if (e.key === "Escape") cancel.click(); });
    btnRow.append(cancel, ok);
    box.append(refineTitle("🔧 Refine prompt"),
      Object.assign(document.createElement("div"), { textContent: "What should change in the current prompt?" }),
      ta, btnRow);
    ta.focus();
  });
}

/** Word-level diff (longest common subsequence). Returns the original's tokens as
 *  [{ text, changed }] — `changed` = removed or replaced by the refined text. */
function diffOriginal(original: string, refined: string): { text: string; changed: boolean }[] {
  const a = original.split(/(\s+)/).filter((x) => x !== "");
  const words = (x: string) => x.split(/(\s+)/).filter((w) => w.trim() !== "");
  const aw = words(original), bw = words(refined);
  const n = aw.length, m = bw.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = aw[i] === bw[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const kept = new Set<number>();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (aw[i] === bw[j]) { kept.add(i); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  let wi = 0;
  return a.map((tok) => tok.trim() === "" ? { text: tok, changed: false } : { text: tok, changed: !kept.has(wi++) });
}

/** Original / refined comparison. Resolves the chosen action + the (possibly edited) refined text. */
function showRefineCompare(original: string, refined: string): Promise<{ action: "apply" | "again" | "close"; text: string }> {
  return new Promise((resolve) => {
    const { ov, box } = refineOverlay();
    const phone = window.innerWidth <= 767;
    box.style.width = "min(1100px, 96vw)"; box.style.height = "min(680px, 90vh)";
    const cols = document.createElement("div");
    Object.assign(cols.style, { display: "flex", gap: "12px", flex: "1", minHeight: "0", flexDirection: phone ? "column" : "row" });
    const colBox = () => {
      const c = document.createElement("div");
      Object.assign(c.style, { flex: "1", display: "flex", flexDirection: "column", gap: "4px", minWidth: "0", minHeight: "0" });
      return c;
    };
    const head = (text: string) => {
      const h = document.createElement("div");
      h.textContent = text; Object.assign(h.style, { color: "#aaa", fontSize: "12px" });
      return h;
    };
    // Original is a read-only block, not a textarea, so the changed words can be colored.
    const origCol = colBox();
    const origBody = document.createElement("div");
    Object.assign(origBody.style, { flex: "1", background: "#161616", color: "#999", border: "1px solid #333", borderRadius: "6px", padding: "10px", fontSize: "13px", whiteSpace: "pre-wrap", overflowY: "auto", userSelect: "text", minHeight: "0" });
    for (const w of diffOriginal(original, refined)) {
      const sp = document.createElement("span");
      sp.textContent = w.text;
      if (w.changed) Object.assign(sp.style, { background: "rgba(255,90,90,0.28)", color: "#ffb3b3", borderRadius: "3px" });
      origBody.appendChild(sp);
    }
    origCol.append(head("Original (changed or removed words highlighted)"), origBody);
    const refCol = colBox();
    const refinedTA = document.createElement("textarea");
    refinedTA.value = refined;
    Object.assign(refinedTA.style, { flex: "1", background: "#2a2a2a", color: "#fff", border: `1px solid ${BRAND}`, borderRadius: "6px", padding: "10px", fontSize: phone ? "16px" : "13px", fontFamily: "inherit", resize: "none", outline: "none", minHeight: "0" });
    refCol.append(head("Refined (you can edit it before applying)"), refinedTA);
    cols.append(origCol, refCol);
    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, { display: "flex", gap: "8px", justifyContent: "flex-end" });
    const again = refineBtn("Re:Refine", BRAND);
    const apply = refineBtn("Apply", "#2e8b57");
    const close = refineBtn("Close", "#444");
    const done = (v: "apply" | "again" | "close") => { ov.remove(); resolve({ action: v, text: refinedTA.value }); };
    again.addEventListener("click", () => done("again"));
    apply.addEventListener("click", () => done("apply"));
    close.addEventListener("click", () => done("close"));
    btnRow.append(again, apply, close);
    box.append(refineTitle("🔧 Prompt Refine result"), cols, btnRow);
  });
}

function purpleBtn(text: string) {
  return el("button", {
    type: "button", text,
    style: { background: BRAND, color: "#fff", border: "none", borderRadius: "6px", padding: "9px 14px", cursor: "pointer", fontSize: "13px", fontWeight: "700", whiteSpace: "nowrap" },
  });
}

export function createPromptEditPopup(cfg: PromptEditPopupConfig): PromptEditPopupHandle {
  const llm = cfg.llm;
  llm.vision_task = llm.vision_task || "Caption + Format (apply model_format below)";
  llm.model_format = llm.model_format || "Universal Natural Language";
  llm.aesthetic = llm.aesthetic || "None (no aesthetic injection)";
  llm.extra_instructions = llm.extra_instructions || "";
  llm.seed = llm.seed ?? 0;
  llm.seed_mode = llm.seed_mode || "randomize";
  function saveLLM() { cfg.saveLlm(); }

  const ov = el("div", { style: { position: "fixed", inset: "0", zIndex: "10001", background: "rgba(0,0,0,0.85)", display: "none", alignItems: "center", justifyContent: "center" } });
  const box = el("div", { style: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "12px", width: "min(980px, 94vw)", height: "min(680px, 90vh)", display: "flex", flexDirection: "column", gap: "8px" } });

  // ── header ──────────────────────────────────────────────────────────────
  const hdr = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" } });
  hdr.append(el("div", { text: cfg.title || "Prompt Edit", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }));
  const doneBtn = purpleBtn("✓ Done");
  doneBtn.addEventListener("click", () => { applyNow(); hide(); });
  const closeBtn = el("button", { type: "button", text: "✕", style: { background: C.bg2, color: C.err, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "9px 12px", cursor: "pointer", fontSize: "13px" } });
  closeBtn.addEventListener("click", () => hide());
  hdr.append(doneBtn, closeBtn);

  // ── top row: image col + right col ────────────────────────────────────
  const topRow = el("div", { style: { display: "flex", gap: "12px", flexShrink: "0", alignItems: "stretch" } });

  const imgCol = el("div", { style: { display: "flex", flexDirection: "column", width: "220px", flexShrink: "0" } });
  const imgDropZone = el("div", {
    style: { border: "none", borderRadius: "8px", padding: "6px", textAlign: "center", cursor: "pointer", color: C.muted, fontSize: "12px", background: C.bg2, flex: "1", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", position: "relative", minHeight: "150px" },
  });
  imgDropZone.textContent = "Drop image, or click";
  const fileInput = el("input", { type: "file", accept: "image/*", style: { display: "none" } }) as HTMLInputElement;
  let imageB64: string | null = null;
  const imgPreview = el("img", { style: { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain", display: "none", borderRadius: "4px" } }) as HTMLImageElement;
  const imgClearBtn = el("button", {
    type: "button", text: "✕",
    style: { position: "absolute", top: "2px", right: "2px", zIndex: "2", display: "none", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", borderRadius: "3px", width: "16px", height: "16px", fontSize: "10px", cursor: "pointer", lineHeight: "1" },
  });
  imgClearBtn.addEventListener("click", (e) => { e.stopPropagation(); imageB64 = null; imgPreview.style.display = "none"; imgClearBtn.style.display = "none"; syncButtons(); });
  const imgGalleryBtn = el("button", {
    type: "button", text: "🖼", title: "Load from gallery",
    style: { position: "absolute", bottom: "4px", left: "4px", zIndex: "2", background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", borderRadius: "4px", width: "22px", height: "22px", fontSize: "12px", cursor: "pointer", padding: "0" },
  });
  imgGalleryBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    cfg.openImageGalleryPicker((filename) => resizeAndSetImage(cfg.viewUrl(filename)));
  });
  imgDropZone.append(fileInput, imgPreview, imgClearBtn, imgGalleryBtn);
  imgDropZone.addEventListener("click", (e) => { if (e.target !== imgClearBtn && e.target !== imgGalleryBtn) fileInput.click(); });
  imgDropZone.addEventListener("dragover", (e) => { e.preventDefault(); imgDropZone.style.outline = `2px dashed ${BRAND}`; });
  imgDropZone.addEventListener("dragleave", () => { imgDropZone.style.outline = "none"; });
  imgDropZone.addEventListener("drop", (e) => {
    e.preventDefault(); imgDropZone.style.outline = "none";
    const file = e.dataTransfer?.files?.[0];
    if (file) loadImageFile(file);
  });
  fileInput.addEventListener("change", () => { if (fileInput.files?.[0]) loadImageFile(fileInput.files[0]); });
  // Ctrl+V anywhere in the open popup: an image on the clipboard goes into the drop zone.
  // Plain text pastes (into the prompt box etc.) are left alone.
  ov.addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === "file" && i.type.startsWith("image/"));
    const f = item?.getAsFile();
    if (!f) return;
    e.preventDefault();
    loadImageFile(f);
  });

  const MAX_IMG_MP = 1_000_000;
  function resizeAndSetImage(src: string): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        const mp = w * h;
        if (mp > MAX_IMG_MP) { const scale = Math.sqrt(MAX_IMG_MP / mp); w = Math.round(w * scale); h = Math.round(h * scale); }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        (canvas.getContext("2d") as CanvasRenderingContext2D).drawImage(img, 0, 0, w, h);
        const resized = canvas.toDataURL("image/jpeg", 1.0);
        imageB64 = resized;
        imgPreview.src = resized; imgPreview.style.display = "block";
        imgClearBtn.style.display = "block";
        syncButtons();
        resolve();
      };
      sameOriginSrc(src).then((s) => { img.src = s; }, () => { img.src = src; });
    });
  }
  function loadImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = (ev) => resizeAndSetImage(String(ev.target?.result));
    reader.readAsDataURL(file);
  }
  imgCol.appendChild(imgDropZone);

  const rightCol = el("div", { style: { flex: "1", display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" } });

  const urlRow = el("div", { style: { display: "flex", gap: "8px" } });
  const urlInput = el("input", { type: "text", placeholder: "Image URL…", style: { flex: "1", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "8px 10px", fontSize: "12px", minWidth: "0", boxSizing: "border-box" } }) as HTMLInputElement;
  const btnDl = purpleBtn("↓ Download");
  btnDl.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    if (!url) { alert("Enter a URL"); return; }
    btnDl.textContent = "…"; (btnDl as HTMLButtonElement).disabled = true;
    try {
      const resp = await cfg.fetchApi("/tj_studio_one/llm/download_image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const d = await resp.json();
      if (!d.ok) throw new Error(d.error || "unknown error");
      await resizeAndSetImage(d.b64);
    } catch (e: any) { alert("Download error: " + (e.message || e)); }
    finally { btnDl.textContent = "↓ Download"; (btnDl as HTMLButtonElement).disabled = false; }
  });
  urlRow.append(urlInput, btnDl);

  const vtSel = mkSelect([llm.vision_task!], llm.vision_task!, (v) => { llm.vision_task = v; saveLLM(); });
  const settingsBtn = purpleBtn("⚙ Settings");
  settingsBtn.addEventListener("click", () => cfg.openSettings?.());
  const row2 = el("div", { style: { display: "flex", gap: "8px", alignItems: "flex-end" } });
  row2.append(fieldCol("Vision Task", vtSel), settingsBtn);

  // "이 팝업 인스턴스에서 사용자가 실제로 건드렸는지"만 기준으로 기본값 적용 여부를
  // 판단한다 — model_format은 모든 ONE STUDIO 도구가 공유하는 전역 localStorage 키라서,
  // 전역값이 "Universal Natural Language"인지로 비교하면 다른 도구가 마지막으로 저장해둔
  // 값이 남아있을 때 항상 실패해서 이 도구 고유의 기본값이 절대 안 먹혔다(실제 버그).
  let modelFormatTouched = false;
  const modelFmtSel = mkSelect([llm.model_format!], llm.model_format!, (v) => { llm.model_format = v; modelFormatTouched = true; saveLLM(); });
  const aestheticSel = mkSelect([llm.aesthetic!], llm.aesthetic!, (v) => { llm.aesthetic = v; saveLLM(); });
  const row3 = el("div", { style: { display: "flex", gap: "8px" } });
  row3.append(fieldCol("Model Format", modelFmtSel), fieldCol("Aesthetic", aestheticSel));

  const extraInstrTA = el("textarea", {
    style: { background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "8px 10px", fontSize: "12px", width: "100%", boxSizing: "border-box", resize: "none", fontFamily: "inherit", flex: "1" },
    rows: "2",
  }) as HTMLTextAreaElement;
  extraInstrTA.value = llm.extra_instructions || "";
  extraInstrTA.addEventListener("input", () => { llm.extra_instructions = extraInstrTA.value; saveLLM(); });
  const extraCol = el("div", { style: { display: "flex", flexDirection: "column", flex: "1", minHeight: "0" } });
  extraCol.append(el("div", { text: "Extra Instructions", style: { color: C.muted, fontSize: "11px" } }), extraInstrTA);

  const seedInput = el("input", { type: "number", min: "0", step: "1", style: { background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "8px 10px", fontSize: "12px", width: "100%", boxSizing: "border-box" } }) as HTMLInputElement;
  seedInput.value = String(llm.seed ?? 0);
  seedInput.addEventListener("input", () => { llm.seed = parseInt(seedInput.value, 10) || 0; saveLLM(); });
  const seedModeLabels = { randomize: "Random", fixed: "Fixed", increment: "+1", decrement: "-1" } as const;
  const seedModeSel = mkSelect(["Random", "Fixed", "+1", "-1"], seedModeLabels[(llm.seed_mode as keyof typeof seedModeLabels) || "randomize"], (label) => {
    llm.seed_mode = ({ Random: "randomize", Fixed: "fixed", "+1": "increment", "-1": "decrement" } as Record<string, string>)[label];
    saveLLM();
  });
  function applySeedControl(): number {
    const mode = llm.seed_mode || "randomize";
    if (mode === "randomize") llm.seed = Math.floor(Math.random() * 1e15);
    else if (mode === "increment") llm.seed = (llm.seed || 0) + 1;
    else if (mode === "decrement") llm.seed = Math.max(0, (llm.seed || 0) - 1);
    saveLLM();
    seedInput.value = String(llm.seed);
    return llm.seed!;
  }
  const seedRow = el("div", { style: { display: "flex", gap: "8px", flexShrink: "0" } });
  seedRow.append(fieldCol("Seed", seedInput), fieldCol("Seed Mode", seedModeSel));

  rightCol.append(urlRow, row2, row3, extraCol, seedRow);
  topRow.append(imgCol, rightCol);

  // ── prompt textarea + busy overlay ────────────────────────────────────
  const taWrap = el("div", { style: { flex: "1", display: "flex", position: "relative", minHeight: "0" } });
  const promptTA = el("textarea", {
    style: { flex: "1", background: C.bg0, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "10px", fontSize: "13px", fontFamily: "inherit", resize: "none", outline: "none" },
  }) as HTMLTextAreaElement;
  const busyOv = el("div", {
    style: { position: "absolute", inset: "0", background: "rgba(0,0,0,0.6)", display: "none", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", zIndex: "10" },
  });
  injectRingStyle();
  const busyLabel = el("div", { text: "", style: { color: "#ccc", fontSize: "12px", letterSpacing: "0.03em" } });
  busyOv.appendChild(el("div", { className: "tj-llm-ring" }));
  busyOv.appendChild(busyLabel);
  taWrap.append(promptTA, busyOv);
  function setBusy(on: boolean, label?: string) {
    if (label) busyLabel.textContent = label;
    busyOv.style.display = on ? "flex" : "none";
    promptTA.disabled = on;
  }

  // ── action row ─────────────────────────────────────────────────────────
  const actionRow = el("div", { style: { display: "flex", gap: "10px", flexShrink: "0" } });
  const btnWrite = purpleBtn("🖼 Image → Prompt Write");
  btnWrite.style.flex = "1";
  const btnEnhance = purpleBtn("✨ Prompt Enhance");
  btnEnhance.style.flex = "1";
  const btnRefine = purpleBtn("🔧 Refine");
  btnRefine.style.flex = "1";
  const applyBtn = purpleBtn("✓ APPLY");
  applyBtn.style.flex = "1";
  // Four equal buttons: Image → Prompt Write / Prompt Enhance / Refine / APPLY.
  actionRow.append(btnWrite, btnEnhance, btnRefine, applyBtn);
  if (window.innerWidth <= 767) { actionRow.style.flexWrap = "wrap"; [btnWrite, btnEnhance, btnRefine, applyBtn].forEach((b) => { b.style.minWidth = "46%"; }); }

  function syncButtons() {
    (btnWrite as HTMLButtonElement).disabled = !imageB64;
    btnWrite.style.opacity = imageB64 ? "1" : "0.45";
    const hasText = promptTA.value.trim().length > 0;
    (btnEnhance as HTMLButtonElement).disabled = !hasText;
    btnEnhance.style.opacity = hasText ? "1" : "0.45";
    (btnRefine as HTMLButtonElement).disabled = !hasText;
    btnRefine.style.opacity = hasText ? "1" : "0.45";
  }
  promptTA.addEventListener("input", syncButtons);

  function applyNow() {
    cfg.setPrompt(promptTA.value);
    cfg.persist();
  }
  applyBtn.addEventListener("click", applyNow);

  // ── footer summary + debug log ────────────────────────────────────────
  const footerBar = el("div", { style: { display: "flex", gap: "16px", flexShrink: "0", flexWrap: "wrap", fontSize: "11px", color: C.muted, padding: "2px 2px 0" } });
  const footerEnhance = el("span", {});
  const footerVision = el("span", {});
  footerBar.append(footerEnhance, footerVision);
  const backendLabel = backendName;
  function refreshFooter() {
    footerEnhance.textContent = "Enhance: " + backendLabel(llm.backend_text) + (llm.backend_text === "openrouter" ? " · " + (llm.or_model || "(model not set)") : llm.backend_text === "custom" ? " · " + (llm.custom_model_text || "(model not set)") : "");
    footerVision.textContent = "Image→Prompt: " + backendLabel(llm.backend_vision) + (llm.backend_vision === "openrouter" ? " · " + (llm.or_model_vision || "(model not set)") : llm.backend_vision === "custom" ? " · " + (llm.custom_model_vision || "(model not set)") : "");
  }

  const debugToggleBtn = el("button", {
    type: "button", text: "🔍 show what was actually sent",
    style: { alignSelf: "flex-start", background: "transparent", color: C.muted, border: "none", fontSize: "11px", cursor: "pointer", textDecoration: "underline", padding: "0", flexShrink: "0" },
  });
  const debugPre = el("pre", {
    style: { display: "none", background: "#111", color: "#9c9", border: `1px solid ${C.border}`, borderRadius: "6px", padding: "8px", fontSize: "10px", lineHeight: "1.4", maxHeight: "150px", overflow: "auto", whiteSpace: "pre-wrap", flexShrink: "0", margin: "0" },
  });
  let lastDebug = "";
  debugToggleBtn.addEventListener("click", () => {
    const show = debugPre.style.display === "none";
    debugPre.style.display = show ? "block" : "none";
    debugPre.textContent = lastDebug || "(nothing sent yet)";
  });
  function setLastDebug(text: string) {
    lastDebug = text || "";
    if (debugPre.style.display !== "none") debugPre.textContent = lastDebug || "(nothing sent yet)";
  }

  // ── LLM backend blocks (collapsed into a small strip under the action row —
  //    Settings owns the full picker, this is just enough to switch backend fast) ──
  const backendGroup = createLlmBackendGroup(llm, saveLLM);
  const enhBackendBlock = backendGroup.makeBlock("text");
  const visionBackendBlock = backendGroup.makeBlock("vision");
  // "Local GGUF" backend had no model picker at all in either role — createLlmBackendGroup's
  // shared block leaves `localOnly` for the caller to fill (its own interface comment: "caller
  // pushes its GGUF/GPU/ctx rows here"), same gap already found and fixed in ITDA's App
  // Settings. Text role only needs the GGUF model; vision role also needs mmproj (multimodal
  // projector), matching every other place this shared block is filled (e.g.
  // krea2/promptTools.ts's ggufSelE/ggufSelI/mmprojSel).
  const ggufSelText = mkSelect([llm.gguf_model || "Loading…"], llm.gguf_model || "", (v) => { llm.gguf_model = v; saveLLM(); ggufSelVision.value = v; });
  const rowGgufText = fieldCol("GGUF Model", ggufSelText);
  enhBackendBlock.localOnly.push(rowGgufText);
  enhBackendBlock.el.insertBefore(rowGgufText, enhBackendBlock.el.firstChild!.nextSibling);
  enhBackendBlock.syncFromState();

  const ggufSelVision = mkSelect([llm.gguf_model || "Loading…"], llm.gguf_model || "", (v) => { llm.gguf_model = v; saveLLM(); ggufSelText.value = v; });
  const mmprojSel = mkSelect([llm.mmproj_file || "none"], llm.mmproj_file || "none", (v) => { llm.mmproj_file = v; saveLLM(); });
  const rowGgufVision = fieldCol("GGUF Model", ggufSelVision);
  const rowMmproj = fieldCol("mmproj", mmprojSel);
  visionBackendBlock.localOnly.push(rowGgufVision, rowMmproj);
  visionBackendBlock.el.insertBefore(rowMmproj, visionBackendBlock.el.firstChild!.nextSibling);
  visionBackendBlock.el.insertBefore(rowGgufVision, visionBackendBlock.el.firstChild!.nextSibling);
  visionBackendBlock.syncFromState();
  const backendStrip = el("div", { style: { display: "none", flexDirection: "row", gap: "10px", flexShrink: "0" } });
  const backendToggleBtn = el("button", {
    type: "button", text: "▾ backend settings",
    style: { alignSelf: "flex-start", background: "transparent", color: C.muted, border: "none", fontSize: "11px", cursor: "pointer", textDecoration: "underline", padding: "0", flexShrink: "0" },
  });
  backendToggleBtn.addEventListener("click", () => {
    const show = backendStrip.style.display === "none";
    backendStrip.style.display = show ? "flex" : "none";
  });
  const enhBlockWrap = el("div", { style: { flex: "1", minWidth: "0" } }, [enhBackendBlock.el]);
  const visionBlockWrap = el("div", { style: { flex: "1", minWidth: "0" } }, [visionBackendBlock.el]);
  backendStrip.append(enhBlockWrap, visionBlockWrap);

  box.append(hdr, topRow, actionRow, taWrap, footerBar, backendToggleBtn, backendStrip, debugToggleBtn, debugPre);
  ov.appendChild(box);
  ov.addEventListener("click", (e) => { if (e.target === ov) hide(); });

  // ── Image → Prompt Write ───────────────────────────────────────────────
  async function doWrite() {
    if (!imageB64) return;
    applySeedControl();
    const existingText = promptTA.value.trim();
    let contextInstruction = existingText
      ? `The user has already written this description — use it as context and produce ONE integrated, polished prompt that incorporates it with what you see in the image. Rewrite it as a single cohesive prompt; do not simply append your description after it.\n\nExisting text:\n${existingText}`
      : "";
    if (llm.extra_instructions) contextInstruction += (contextInstruction ? "\n\n" : "") + llm.extra_instructions;
    (btnWrite as HTMLButtonElement).disabled = true;
    setBusy(true, "Analyzing image…");
    try {
      const r = await cfg.fetchApi("/tj_studio_one/llm/image_to_prompt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_b64: imageB64,
          backend: llm.backend_vision || "local",
          or_model: llm.or_model_vision || llm.or_model,
          custom_base: llm.custom_base_vision,
          custom_model: llm.custom_model_vision,
          custom_ctx: llm.custom_ctx_vision,
          gguf_model: llm.gguf_model,
          mmproj_file: llm.mmproj_file,
          text_encoder_name: llm.text_encoder_name,
          clip_loader_type: llm.clip_loader_type,
          vision_task: llm.vision_task,
          model_format: llm.model_format,
          aesthetic: llm.aesthetic,
          custom_instruction: contextInstruction,
          n_gpu_layers: llm.n_gpu_layers,
          n_ctx: llm.n_ctx,
          max_tokens: llm.max_tokens,
          temperature: llm.temperature,
          seed: llm.seed,
        }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "error");
      promptTA.value = d.result;
      setLastDebug(d.debug_thought);
      syncButtons();
    } catch (e: any) { alert("LLM error: " + (e.message || e)); }
    finally { setBusy(false); syncButtons(); }
  }
  btnWrite.addEventListener("click", doWrite);

  // ── Prompt Enhance ─────────────────────────────────────────────────────
  async function doEnhance() {
    const prompt = promptTA.value.trim();
    if (!prompt) return;
    applySeedControl();
    (btnEnhance as HTMLButtonElement).disabled = true;
    setBusy(true, "Enhancing prompt…");
    try {
      const r = await cfg.fetchApi("/tj_studio_one/llm/enhance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          backend: llm.backend_text || "local",
          or_model: llm.or_model,
          custom_base: llm.custom_base_text,
          custom_model: llm.custom_model_text,
          custom_ctx: llm.custom_ctx_text,
          gguf_model: llm.gguf_model,
          text_encoder_name: llm.text_encoder_name,
          clip_loader_type: llm.clip_loader_type,
          n_gpu_layers: llm.n_gpu_layers,
          n_ctx: llm.n_ctx,
          max_tokens: llm.max_tokens,
          temperature: llm.temperature,
          seed: llm.seed,
          model_format: llm.model_format,
          aesthetic: llm.aesthetic,
          extra_instructions: llm.extra_instructions,
        }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "error");
      promptTA.value = d.result;
      setLastDebug(d.debug_thought);
      syncButtons();
    } catch (e: any) { alert("LLM error: " + (e.message || e)); }
    finally { setBusy(false); syncButtons(); }
  }
  btnEnhance.addEventListener("click", doEnhance);

  // ── Refine ─────────────────────────────────────────────────────────────
  // Same /llm/enhance route with `refine_instruction` (server builds the revise-only system text).
  async function callRefine(prompt: string, instruction: string): Promise<string> {
    applySeedControl();
    const r = await cfg.fetchApi("/tj_studio_one/llm/enhance", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt, refine_instruction: instruction,
        backend: llm.backend_text || llm.backend || "local",
        or_model: llm.or_model_text || llm.or_model,
        custom_base: llm.custom_base_text, custom_model: llm.custom_model_text, custom_ctx: llm.custom_ctx_text,
        gguf_model: llm.gguf_model, text_encoder_name: llm.text_encoder_name, clip_loader_type: llm.clip_loader_type,
        n_gpu_layers: llm.n_gpu_layers, n_ctx: llm.n_ctx, max_tokens: llm.max_tokens,
        temperature: llm.temperature, seed: llm.seed,
        model_format: llm.model_format, aesthetic: llm.aesthetic, extra_instructions: llm.extra_instructions,
      }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "error");
    return d.result;
  }
  /** Whole Refine flow on `getText()`'s prompt; `setBusy` shows the caller's busy state, `onApply` gets the accepted text. */
  async function runRefine(o: { getText: () => string; onApply: (t: string) => void; setBusy?: (on: boolean) => void }) {
    const current = (o.getText() || "").trim();
    if (!current) { alert("Nothing to refine yet — write a prompt first."); return; }
    let instruction = await askRefineInstruction();
    while (instruction) {
      lastRefineInstruction = instruction;
      let refined: string;
      o.setBusy?.(true);
      try { refined = await callRefine(current, instruction); }
      catch (e: any) { alert("LLM error: " + (e.message || e)); return; }
      finally { o.setBusy?.(false); }
      const res = await showRefineCompare(current, refined);
      if (res.action === "apply") { o.onApply(res.text); return; }
      if (res.action === "close") return;
      instruction = await askRefineInstruction();
    }
  }
  // Inside Prompt Edit: works on the popup's own text; the accepted result lands back in it.
  btnRefine.addEventListener("click", () => runRefine({
    getText: () => promptTA.value,
    onApply: (text) => { promptTA.value = text; syncButtons(); },
    setBusy: (on) => { (btnRefine as HTMLButtonElement).disabled = on; setBusy(on, "Refining the prompt…"); if (!on) syncButtons(); },
  }));
  // Main PROMPT box (no Prompt Edit needed): reads/writes the current mode's prompt; the box is
  // disabled and covered by an overlay while the LLM runs.
  let mainBusy: ReturnType<typeof makeBusyOverlay> | null = null;
  function setMainBusy(on: boolean) {
    const pta = cfg.getPromptTA?.(); if (!pta?.parentElement) return;
    if (!mainBusy) {
      mainBusy = makeBusyOverlay("Prompt: Refine. The results window will appear shortly.");
      pta.parentElement.style.position = "relative";
      pta.parentElement.appendChild(mainBusy.el);
    }
    Object.assign(mainBusy.el.style, { inset: "auto", top: pta.offsetTop + "px", left: pta.offsetLeft + "px", width: pta.offsetWidth + "px", height: pta.offsetHeight + "px", borderRadius: "6px", display: on ? "flex" : "none" });
    pta.disabled = on;
  }
  function refineMain() {
    return runRefine({
      setBusy: setMainBusy,
      getText: () => cfg.getPrompt(),
      onApply: (text) => { cfg.setPrompt(text); promptTA.value = text; cfg.persist(); syncButtons(); },
    });
  }

  // ── load model lists once ─────────────────────────────────────────────
  let modelsLoaded = false;
  function populateSelect(sel: HTMLSelectElement, opts: string[], current: string) {
    if (!opts?.length) return;
    sel.innerHTML = "";
    opts.forEach((m) => sel.appendChild(el("option", { value: m, text: m, ...(m === current ? { selected: "selected" } : {}) })));
  }
  function loadModelsOnce() {
    if (modelsLoaded) return;
    modelsLoaded = true;
    cfg.fetchApi("/tj_studio_one/llm/models").then((r) => r.json()).then((d: any) => {
      if (d.or_model_text && !llm.or_model) { llm.or_model = d.or_model_text; saveLLM(); }
      if (d.or_model_vision && !llm.or_model_vision) { llm.or_model_vision = d.or_model_vision; saveLLM(); }
      const orModels: string[] = Array.isArray(d.or_models) ? d.or_models : [];
      if (!d.ok || d._notInstalled) { backendGroup.stripLocal(); } else { backendGroup.syncAll(); }
      backendGroup.fillAll(orModels, d.openrouter_key_hint || "");
      backendGroup.fillTextEncodersAll(d.text_encoders || [], d.clip_loader_types || []);
      if (d.gguf?.length) {
        [ggufSelText, ggufSelVision].forEach((sel) => populateSelect(sel, d.gguf, llm.gguf_model || d.gguf[0]));
        if (!llm.gguf_model) { llm.gguf_model = d.gguf[0]; saveLLM(); }
      }
      if (d.mmproj?.length) populateSelect(mmprojSel, ["none", ...d.mmproj.filter((m: string) => m !== "none")], llm.mmproj_file || "none");
      if (d.vision_tasks?.length) populateSelect(vtSel, d.vision_tasks, llm.vision_task!);
      if (d.model_formats?.length) {
        const def = cfg.defaultModelFormat;
        const shouldApplyDefault = def && d.model_formats.includes(def) && !modelFormatTouched;
        if (shouldApplyDefault) { llm.model_format = def; saveLLM(); }
        populateSelect(modelFmtSel, d.model_formats, llm.model_format!);
      }
      if (d.aesthetics?.length) populateSelect(aestheticSel, d.aesthetics, llm.aesthetic!);
      refreshFooter();
    }).catch(() => {});
  }

  function show() {
    ov.style.display = "flex";
    promptTA.value = cfg.getPrompt();
    extraInstrTA.value = llm.extra_instructions || "";
    seedInput.value = String(llm.seed ?? 0);
    debugPre.style.display = "none";
    setLastDebug("");
    syncButtons();
    refreshFooter();
    loadModelsOnce();
  }
  function hide() { ov.style.display = "none"; }

  async function enhance(prompt: string): Promise<string> {
    promptTA.value = prompt;
    await doEnhance();
    return promptTA.value;
  }

  return { el: ov, show, hide, enhance, refine: refineMain };
}
