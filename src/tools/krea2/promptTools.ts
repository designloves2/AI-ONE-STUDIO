// promptTools.ts — Krea2 프롬프트 보조 기능: 확장 편집(Edit/Enhance LLM/Image→Prompt 탭) +
// 프롬프트 템플릿 오버레이. 원본 근거: web/shared/llm_panel.js(attachLLMPanel),
// web/klein/ui_prompt_templates.js(BUILT_IN 카테고리 — Krea2도 이 템플릿을 공유해 이식).
import { C, el, BRAND } from "./core";
import { button } from "../../shared/ui";
// 템플릿은 도구별 config가 아니라 공용 풀(/shared/prompt_templates?pool=krea2)에 저장한다 —
// 도구마다 자기 풀을 가진다(노드 7ec5ad9). 옛 공유 풀 nl/tag는 더 이상 쓰지 않는다. UI는 shared/promptTemplateOverlay.ts.
import { createTemplateOverlay as createSharedTemplateOverlay } from "../../shared/promptTemplateOverlay";
import { createLlmBackendGroup, fetchOrModels } from "../../shared/llmBackendPanel";
import { comfyApi } from "./comfyClient";
import { sameOriginSrc } from "../../shared/sameOriginImage";

// ── LLM 설정 (탭/기기 전역 공유 — llm_panel.js와 동일 localStorage 키) ──────────
import { loadLLMSettings, saveLLMSettings } from "../../shared/llmSettingsStore";

function mkSelect(options: string[], value: string, onChange: (v: string) => void) {
  const s = el("select", { style: { background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "4px 6px", fontSize: "11px", width: "100%" } });
  options.forEach((o) => s.appendChild(el("option", { value: o, text: o, ...(o === value ? { selected: "selected" } : {}) })));
  s.addEventListener("change", () => onChange(s.value));
  return s;
}
function mkNum(value: number, min: number, max: number, step: number, onChange: (v: number) => void) {
  const i = el("input", { type: "number", value: String(value), min: String(min), max: String(max), step: String(step), style: { background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "4px 6px", fontSize: "11px", width: "100%", boxSizing: "border-box" } });
  i.addEventListener("change", () => onChange(Number(i.value)));
  return i;
}
function fieldRow(labelText: string, control: HTMLElement) {
  const wrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "2px" } });
  wrap.append(el("div", { text: labelText, style: { color: C.muted, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.04em" } }), control);
  return wrap;
}

// ── Prompt 확장 오버레이 (Edit / ✨ Enhance / 🖼 Image→Prompt) ────────────────
// 원본 shared/llm_panel.js의 attachLLMPanel과 필드 구성을 1:1로 맞춘다 —
// Enhance/Image→Prompt 둘 다 Model Format·Aesthetic·Seed까지 전부 포함.
export function createPromptExpandOverlay(getPrompt: () => string, setPrompt: (text: string) => void) {
  const ov = el("div", { style: { position: "fixed", inset: "0", zIndex: "10001", background: "rgba(0,0,0,0.85)", display: "none", alignItems: "center", justifyContent: "center" } });
  const box = el("div", { class: "aos-llm-box", style: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "12px", width: "min(980px, 94vw)", height: "min(660px, 88vh)", display: "flex", flexDirection: "column", gap: "8px" } });

  const hdr = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" } });
  hdr.append(
    el("div", { text: "Edit Prompt", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }),
    // Edit 탭엔 자체 적용 버튼이 없어서(Enhance/Image→Prompt 탭만 있었음), 직접 편집한 내용을
    // 반영할 방법이 없었다 — 헤더에 상시 노출되는 완료 버튼으로 어느 탭에 있든 editTA 내용을 반영.
    button("✓ Done", () => { setPrompt(editTA.value); ov.style.display = "none"; }, "primary"),
    button("✕", () => (ov.style.display = "none"), "danger")
  );

  const tabBar = el("div", { style: { display: "flex", gap: "4px", flexShrink: "0" } });
  function mkTab(text: string) {
    return el("button", { type: "button", text, style: { background: C.bg2, color: C.muted, border: `1px solid ${C.border}`, borderRadius: "6px 6px 0 0", padding: "6px 14px", fontSize: "11px", cursor: "pointer", fontWeight: "700" } });
  }
  const tabEdit = mkTab("Edit"), tabEnhance = mkTab("✨ Enhance"), tabI2P = mkTab("🖼 Image → Prompt");
  tabBar.append(tabEdit, tabEnhance, tabI2P);

  const content = el("div", { class: "aos-llm-content", style: { flex: "1", minHeight: "0", display: "flex", border: `1px solid ${C.border}`, borderRadius: "0 6px 6px 6px", overflow: "hidden" } });

  // Edit panel
  const editTA = el("textarea", { style: { flex: "1", background: C.bg0, color: C.text, border: "none", padding: "10px", fontSize: "13px", fontFamily: "inherit", resize: "none", outline: "none" } });
  const panelEdit = el("div", { style: { display: "flex", flex: "1" } }, [editTA]);

  // ── LLM 공용 설정 (Enhance/Image→Prompt 두 탭이 gguf/model_format/aesthetic 등을 공유) ──
  const llm = Object.assign(
    { backend: "local", backend_text: "local", backend_vision: "local", or_model: "", or_model_vision: "", custom_base_text: "", custom_model_text: "", custom_ctx_text: 0, custom_base_vision: "", custom_model_vision: "", custom_ctx_vision: 0, gguf_model: "", mmproj_file: "none", text_encoder_name: "", clip_loader_type: "Auto",
      // "Caption + Format" is the only vision task that actually applies Model Format/Aesthetic
      // (TJ_ImageToPrompt ignores model_format for every other task) — default to it so the
      // dropdown below isn't a silent no-op (node llm_panel.js, same fix).
      vision_task: "Caption + Format (apply model_format below)", model_format: "Universal Natural Language", aesthetic: "None (no aesthetic injection)", extra_instructions: "", custom_instruction: "", n_gpu_layers: -1, n_ctx: 4096, max_tokens: 1000, temperature: 0.7, seed: 0 },
    loadLLMSettings()
  );
  function saveLLM() { saveLLMSettings(llm); }
  // "Local GGUF | OpenRouter" selector — shared by both the Enhance and Image→Prompt panels.
  const beGroup = createLlmBackendGroup(llm, saveLLM);

  // ── Enhance panel ──────────────────────────────────────────────────────────
  const enhLeft = el("div", { class: "aos-llm-left", style: { width: "210px", flexShrink: "0", background: C.bg0, padding: "10px", display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto", borderRight: `1px solid ${C.border}` } });
  const ggufSelE = mkSelect([llm.gguf_model || "Loading…"], llm.gguf_model, (v) => { llm.gguf_model = v; saveLLM(); ggufSelI.value = v; });
  const modelFmtSelE = mkSelect(["Universal Natural Language"], llm.model_format, (v) => { llm.model_format = v; saveLLM(); modelFmtSelI.value = v; });
  const aestheticSelE = mkSelect(["None (no aesthetic injection)"], llm.aesthetic, (v) => { llm.aesthetic = v; saveLLM(); aestheticSelI.value = v; });
  const extraTA = el("textarea", { rows: "3", style: { background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "4px 5px", fontSize: "11px", width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" } });
  extraTA.value = llm.extra_instructions;
  extraTA.addEventListener("input", () => { llm.extra_instructions = extraTA.value; saveLLM(); });
  const gpuLayersE = mkNum(llm.n_gpu_layers, -1, 999, 1, (v) => { llm.n_gpu_layers = v; saveLLM(); gpuLayersI.value = String(v); });
  const nCtxE = mkNum(llm.n_ctx, 512, 32768, 512, (v) => { llm.n_ctx = v; saveLLM(); });
  const maxTokE = mkNum(llm.max_tokens, 50, 4096, 50, (v) => { llm.max_tokens = v; saveLLM(); maxTokI.value = String(v); });
  const tempE = mkNum(llm.temperature, 0, 2, 0.05, (v) => { llm.temperature = v; saveLLM(); tempI.value = String(v); });
  const seedE = mkNum(llm.seed, 0, 999999999, 1, (v) => { llm.seed = v; saveLLM(); seedI.value = String(v); });
  const enhBackend = beGroup.makeBlock("text");
  const rowGgufE = fieldRow("GGUF Model", ggufSelE);
  const rowGpuE = fieldRow("GPU Layers", gpuLayersE);
  const rowCtxE = fieldRow("Context Size", nCtxE);
  enhBackend.localOnly.push(rowGgufE, rowGpuE, rowCtxE);
  enhLeft.append(
    enhBackend.el,
    rowGgufE, rowGpuE, rowCtxE,
    fieldRow("Max Tokens", maxTokE),
    fieldRow("Temperature", tempE),
    fieldRow("Seed", seedE),
    fieldRow("Model Format", modelFmtSelE),
    fieldRow("Aesthetic", aestheticSelE),
    fieldRow("Extra Instructions", extraTA)
  );
  const spacer1 = el("div", { style: { flex: "1" } });
  const enhanceBtn = el("button", { type: "button", text: "✨ Enhance", style: { background: "#1e4a1e", color: "#7eff7e", border: "1px solid #3a7a3a", borderRadius: "5px", padding: "8px", cursor: "pointer", fontSize: "12px", fontWeight: "700" } });
  enhLeft.append(spacer1, enhanceBtn);

  const enhTA = el("textarea", { placeholder: "Result appears here…", style: { flex: "1", background: C.bg0, color: C.text, border: "none", padding: "10px", fontSize: "13px", fontFamily: "inherit", resize: "none", outline: "none" } });
  const enhReplaceBtn = button("Apply", () => { setPrompt(enhTA.value); editTA.value = enhTA.value; }, "primary");
  const enhRight = el("div", { style: { flex: "1", display: "flex", flexDirection: "column" } }, [enhTA, el("div", { style: { padding: "6px", borderTop: `1px solid ${C.border}` } }, [enhReplaceBtn])]);
  const panelEnhance = el("div", { class: "aos-llm-panel-row", style: { display: "none", flex: "1", flexDirection: "row" } }, [enhLeft, enhRight]);

  enhanceBtn.addEventListener("click", async () => {
    const prompt = editTA.value.trim();
    if (!prompt) { alert("Enter a prompt first"); return; }
    enhanceBtn.textContent = "…";
    (enhanceBtn as HTMLButtonElement).disabled = true;
    try {
      const r = await comfyApi.fetchApi("/tj_studio_one/llm/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, backend: llm.backend_text, or_model: llm.or_model, custom_base: llm.custom_base_text, custom_model: llm.custom_model_text, custom_ctx: llm.custom_ctx_text, gguf_model: llm.gguf_model, text_encoder_name: llm.text_encoder_name, clip_loader_type: llm.clip_loader_type, n_gpu_layers: llm.n_gpu_layers, n_ctx: llm.n_ctx, max_tokens: llm.max_tokens, temperature: llm.temperature, seed: llm.seed, model_format: llm.model_format, aesthetic: llm.aesthetic, extra_instructions: llm.extra_instructions }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "error");
      enhTA.value = d.result;
    } catch (e: any) {
      alert("LLM error: " + (e.message || e));
    } finally {
      enhanceBtn.textContent = "✨ Enhance";
      (enhanceBtn as HTMLButtonElement).disabled = false;
    }
  });

  // ── Image → Prompt panel ─────────────────────────────────────────────────
  const i2pLeft = el("div", { class: "aos-llm-left", style: { width: "210px", flexShrink: "0", background: C.bg0, padding: "10px", display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto", borderRight: `1px solid ${C.border}` } });

  const dropZone = el("div", { style: { border: `2px dashed ${C.border}`, borderRadius: "6px", padding: "10px", textAlign: "center", cursor: "pointer", color: C.muted, fontSize: "11px", background: C.bg2, minHeight: "80px", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" } });
  dropZone.textContent = "Drag an image here or click";
  const fileIn = el("input", { type: "file", accept: "image/*", style: { display: "none" } });
  const preview = el("img", { style: { maxWidth: "100%", maxHeight: "80px", display: "none", borderRadius: "4px", marginTop: "4px" } });
  dropZone.append(fileIn, preview);
  let imgB64: string | null = null;
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
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        const resized = canvas.toDataURL("image/jpeg", 1.0);
        imgB64 = resized;
        preview.src = resized;
        preview.style.display = "block";
        dropZone.style.border = "2px solid #3a7a3a";
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
  dropZone.addEventListener("click", () => fileIn.click());
  fileIn.addEventListener("change", () => { const f = fileIn.files?.[0]; if (f) loadImageFile(f); });
  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.style.borderColor = BRAND; });
  dropZone.addEventListener("dragleave", () => { dropZone.style.borderColor = C.border; });
  dropZone.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) loadImageFile(f); });

  const urlRow = el("div", { style: { display: "flex", gap: "4px", alignItems: "center", width: "100%" } });
  const urlInput = el("input", { type: "text", placeholder: "Image URL…", style: { flex: "1", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "4px 6px", fontSize: "11px", minWidth: "0" } });
  const btnDl = el("button", { type: "button", text: "↓", title: "Download from URL", style: { background: "#1a1e3a", color: "#7e9eff", border: "1px solid #3a4a7a", borderRadius: "4px", padding: "4px 8px", cursor: "pointer", fontSize: "11px", flexShrink: "0" } });
  btnDl.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    if (!url) { alert("Enter a URL"); return; }
    btnDl.textContent = "…"; (btnDl as HTMLButtonElement).disabled = true;
    try {
      const resp = await comfyApi.fetchApi("/tj_studio_one/llm/download_image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const d = await resp.json();
      if (!d.ok) throw new Error(d.error || "unknown error");
      await resizeAndSetImage(d.b64);
    } catch (e: any) { alert("Download error: " + (e.message || e)); }
    finally { btnDl.textContent = "↓"; (btnDl as HTMLButtonElement).disabled = false; }
  });
  urlRow.append(urlInput, btnDl);
  const imgWrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "4px", width: "100%" } }, [urlRow, dropZone]);

  const ggufSelI = mkSelect([llm.gguf_model || "Loading…"], llm.gguf_model, (v) => { llm.gguf_model = v; saveLLM(); ggufSelE.value = v; });
  const mmprojSel = mkSelect([llm.mmproj_file || "none"], llm.mmproj_file, (v) => { llm.mmproj_file = v; saveLLM(); });
  const vtSel = mkSelect(["Caption (plain description)"], llm.vision_task, (v) => { llm.vision_task = v; saveLLM(); });
  const modelFmtSelI = mkSelect(["Universal Natural Language"], llm.model_format, (v) => { llm.model_format = v; saveLLM(); modelFmtSelE.value = v; });
  const aestheticSelI = mkSelect(["None (no aesthetic injection)"], llm.aesthetic, (v) => { llm.aesthetic = v; saveLLM(); aestheticSelE.value = v; });
  const customInstrTA = el("textarea", { rows: "3", style: { background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "4px 5px", fontSize: "11px", width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" } });
  customInstrTA.value = llm.custom_instruction;
  customInstrTA.addEventListener("input", () => { llm.custom_instruction = customInstrTA.value; saveLLM(); });
  const gpuLayersI = mkNum(llm.n_gpu_layers, -1, 999, 1, (v) => { llm.n_gpu_layers = v; saveLLM(); gpuLayersE.value = String(v); });
  const maxTokI = mkNum(llm.max_tokens, 50, 4096, 50, (v) => { llm.max_tokens = v; saveLLM(); maxTokE.value = String(v); });
  const tempI = mkNum(llm.temperature, 0, 2, 0.05, (v) => { llm.temperature = v; saveLLM(); tempE.value = String(v); });
  const seedI = mkNum(llm.seed, 0, 999999999, 1, (v) => { llm.seed = v; saveLLM(); seedE.value = String(v); });

  const i2pBackend = beGroup.makeBlock("vision");
  const rowGgufI = fieldRow("GGUF Model", ggufSelI);
  const rowMmproj = fieldRow("mmproj", mmprojSel);
  const rowGpuI = fieldRow("GPU Layers", gpuLayersI);
  i2pBackend.localOnly.push(rowGgufI, rowMmproj, rowGpuI);
  i2pLeft.append(
    fieldRow("Image", imgWrap),
    i2pBackend.el,
    rowGgufI, rowMmproj,
    fieldRow("Vision Task", vtSel),
    fieldRow("Model Format", modelFmtSelI),
    fieldRow("Aesthetic", aestheticSelI),
    fieldRow("Custom Instruction", customInstrTA),
    rowGpuI,
    fieldRow("Max Tokens", maxTokI),
    fieldRow("Temperature", tempI),
    fieldRow("Seed", seedI)
  );
  const i2pBtn = el("button", { type: "button", text: "🖼 Analyze", style: { background: "#1a1e4a", color: "#7e9eff", border: "1px solid #3a4a7a", borderRadius: "5px", padding: "8px", cursor: "pointer", fontSize: "12px", fontWeight: "700" } });
  i2pLeft.appendChild(i2pBtn);

  const i2pTA = el("textarea", { placeholder: "Analysis result appears here…", style: { flex: "1", background: C.bg0, color: C.text, border: "none", padding: "10px", fontSize: "13px", fontFamily: "inherit", resize: "none", outline: "none" } });
  const i2pSendBtn = button("Apply", () => { setPrompt(i2pTA.value); editTA.value = i2pTA.value; }, "primary");
  const i2pRight = el("div", { style: { flex: "1", display: "flex", flexDirection: "column" } }, [i2pTA, el("div", { style: { padding: "6px", borderTop: `1px solid ${C.border}` } }, [i2pSendBtn])]);
  const panelI2P = el("div", { class: "aos-llm-panel-row", style: { display: "none", flex: "1", flexDirection: "row" } }, [i2pLeft, i2pRight]);

  i2pBtn.addEventListener("click", async () => {
    if (!imgB64) { alert("Upload an image first"); return; }
    i2pBtn.textContent = "…";
    (i2pBtn as HTMLButtonElement).disabled = true;
    try {
      const r = await comfyApi.fetchApi("/tj_studio_one/llm/image_to_prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64: imgB64, backend: llm.backend_vision, or_model: llm.or_model_vision, custom_base: llm.custom_base_vision, custom_model: llm.custom_model_vision, custom_ctx: llm.custom_ctx_vision, gguf_model: llm.gguf_model, mmproj_file: llm.mmproj_file, text_encoder_name: llm.text_encoder_name, clip_loader_type: llm.clip_loader_type, vision_task: llm.vision_task, model_format: llm.model_format, aesthetic: llm.aesthetic, custom_instruction: llm.custom_instruction, n_gpu_layers: llm.n_gpu_layers, n_ctx: llm.n_ctx, max_tokens: llm.max_tokens, temperature: llm.temperature, seed: llm.seed }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "error");
      i2pTA.value = d.result;
    } catch (e: any) {
      alert("LLM error: " + (e.message || e));
    } finally {
      i2pBtn.textContent = "🖼 Analyze";
      (i2pBtn as HTMLButtonElement).disabled = false;
    }
  });

  content.append(panelEdit, panelEnhance, panelI2P);
  box.append(hdr, tabBar, content);
  ov.appendChild(box);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.style.display = "none"; });

  function setActive(tab: HTMLElement) {
    [tabEdit, tabEnhance, tabI2P].forEach((t) => {
      const on = t === tab;
      t.style.background = on ? "#1e3a1e" : C.bg2;
      t.style.color = on ? "#7eff7e" : C.muted;
    });
    panelEdit.style.display = tab === tabEdit ? "flex" : "none";
    panelEnhance.style.display = tab === tabEnhance ? "flex" : "none";
    panelI2P.style.display = tab === tabI2P ? "flex" : "none";
  }
  tabEdit.onclick = () => setActive(tabEdit);
  tabEnhance.onclick = () => { setActive(tabEnhance); enhTA.value = getPrompt(); };
  tabI2P.onclick = () => setActive(tabI2P);

  // ── 모델/포맷/미학 목록 로드 (원본 populateSelects) ─────────────────────────
  let modelsLoaded = false;
  function populateSelect(sel: HTMLSelectElement, opts: string[], current: string) {
    if (!opts?.length) return;
    sel.innerHTML = "";
    opts.forEach((m) => sel.appendChild(el("option", { value: m, text: m, ...(m === current ? { selected: "selected" } : {}) })));
  }
  function loadModelsOnce() {
    if (modelsLoaded) return;
    modelsLoaded = true;
    Promise.all([
      comfyApi.fetchApi("/tj_studio_one/llm/models").then((r) => r.json()).catch(() => ({})),
      fetchOrModels(),
    ]).then(([d, orModels]) => {
      beGroup.fillAll(orModels, d.openrouter_key_hint || "");
      if (d.or_model_text && !llm.or_model) { llm.or_model = d.or_model_text; saveLLM(); } if (d.or_model_vision && !llm.or_model_vision) { llm.or_model_vision = d.or_model_vision; saveLLM(); }
      // TJ_NODE local LLM missing → fall back to OpenRouter (keeps the panel usable).
      if (!d.ok || d._notInstalled) { beGroup.stripLocal(); } else { if (d.backend_text) llm.backend_text = d.backend_text; if (d.backend_vision) llm.backend_vision = d.backend_vision; saveLLM(); }
      beGroup.syncAll();
      if (!d.ok) return;
      if (d.gguf?.length) {
        [ggufSelE, ggufSelI].forEach((s) => populateSelect(s, d.gguf, llm.gguf_model));
        if (!llm.gguf_model && d.gguf[0]) { llm.gguf_model = d.gguf[0]; saveLLM(); ggufSelE.value = llm.gguf_model; ggufSelI.value = llm.gguf_model; }
      }
      beGroup.fillTextEncodersAll(d.text_encoders || [], d.clip_loader_types || []);
      if (d.mmproj?.length) populateSelect(mmprojSel, d.mmproj, llm.mmproj_file);
      if (d.vision_tasks?.length) populateSelect(vtSel, d.vision_tasks, llm.vision_task);
      if (d.model_formats?.length) [modelFmtSelE, modelFmtSelI].forEach((s) => populateSelect(s, d.model_formats, llm.model_format));
      if (d.aesthetics?.length) [aestheticSelE, aestheticSelI].forEach((s) => populateSelect(s, d.aesthetics, llm.aesthetic));
    }).catch(() => {});
  }

  return {
    el: ov,
    show() {
      ov.style.display = "flex";
      editTA.value = getPrompt();
      setActive(tabEdit);
      loadModelsOnce();
    },
    hide() { ov.style.display = "none"; },
  };
}

// ── 프롬프트 템플릿 ──────────────────────────────────────────────────────────
// 원본 one_node_krea2.js는 실제로 klein/ui_prompt_templates.js를 그대로 import해서 쓴다
// (동적 import("./klein/ui_prompt_templates.js") — 별도 Krea2 전용 템플릿 파일이 없음).
// 그래서 BUILT_IN도 Klein의 모드별 카테고리를 그대로 공유하는데, Krea2의 모드(t2i/i2i/
// identity/upscale)는 Klein의 키(edit/i2i/inpaint/faceswap)와 거의 겹치지 않는다 — 실제로는
// "i2i"만 매칭되고 그마저 원본에서 항목이 비어 있어(cat:"I2I", items:[]) 사실상 Krea2에서는
// 내장 템플릿이 거의 표시되지 않는 게 원본 그대로의 동작이다. 이전엔 Krea2용으로 별도의
// 범용 4카테고리를 만들어 썼는데, 그건 원본에 없던 것이라 실제 동작과 달랐다.
const BUILT_IN: Record<string, { cat: string; items: { label: string; prompt: string }[] }[]> = {
  edit: [], // Krea2에는 edit 모드가 없어 도달하지 않음 — Klein 원본 키 목록만 참고용으로 유지
  i2i: [{ cat: "I2I", items: [] }],
  inpaint: [],
  faceswap: [],
};

export function createTemplateOverlay(getMode: () => string, onApply: (prompt: string) => void) {
  return createSharedTemplateOverlay("krea2", getMode, onApply, BUILT_IN);
}
