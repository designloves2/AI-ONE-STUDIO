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
import { createLlmBackendGroup, type LlmBackendState } from "./llmBackendPanel";

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
      img.src = src;
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

  const modelFmtSel = mkSelect([llm.model_format!], llm.model_format!, (v) => { llm.model_format = v; saveLLM(); });
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
  const busyLabel = el("div", { text: "", style: { color: "#ccc", fontSize: "12px" } });
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
  const applyBtn = purpleBtn("✓ APPLY");
  applyBtn.style.flex = "1";
  actionRow.append(btnWrite, btnEnhance, applyBtn);

  function syncButtons() {
    (btnWrite as HTMLButtonElement).disabled = !imageB64;
    btnWrite.style.opacity = imageB64 ? "1" : "0.45";
    const hasText = promptTA.value.trim().length > 0;
    (btnEnhance as HTMLButtonElement).disabled = !hasText;
    btnEnhance.style.opacity = hasText ? "1" : "0.45";
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
  function backendLabel(b?: string) { return b === "openrouter" ? "OpenRouter" : b === "comfy" ? "ComfyUI Native" : "Local GGUF"; }
  function refreshFooter() {
    footerEnhance.textContent = "Enhance: " + backendLabel(llm.backend_text) + (llm.backend_text === "openrouter" ? " · " + (llm.or_model || "(model not set)") : "");
    footerVision.textContent = "Image→Prompt: " + backendLabel(llm.backend_vision) + (llm.backend_vision === "openrouter" ? " · " + (llm.or_model_vision || "(model not set)") : "");
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
        const shouldApplyDefault = def && d.model_formats.includes(def) && (!llm.model_format || llm.model_format === "Universal Natural Language");
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

  return { el: ov, show, hide };
}
