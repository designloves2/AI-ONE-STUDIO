// promptTools.ts — Krea2 프롬프트 보조 기능: 확장 편집(Edit/Enhance LLM/Image→Prompt 탭) +
// 프롬프트 템플릿 오버레이. 원본 근거: web/shared/llm_panel.js(attachLLMPanel),
// web/klein/ui_prompt_templates.js(BUILT_IN 카테고리 — Krea2도 이 템플릿을 공유해 이식).
import { C, el, clear, BRAND } from "./core";
import { button, label as uiLabel, row, confirmDialog } from "../../shared/ui";
import { getConfig, saveConfig } from "./api";
import { comfyApi } from "./comfyClient";

// ── LLM 설정 (탭/기기 전역 공유 — llm_panel.js와 동일 localStorage 키) ──────────
const LLM_LS_KEY = "tj_studio_one_llm_settings";
function loadLLMSettings(): any {
  try { return JSON.parse(localStorage.getItem(LLM_LS_KEY) || "{}"); } catch { return {}; }
}
function saveLLMSettings(patch: any) {
  const s = loadLLMSettings();
  Object.assign(s, patch);
  localStorage.setItem(LLM_LS_KEY, JSON.stringify(s));
}

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
  hdr.append(el("div", { text: "프롬프트 편집", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }), button("✕", () => (ov.style.display = "none"), "danger"));

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
    { gguf_model: "", mmproj_file: "none", vision_task: "Caption (plain description)", model_format: "Universal Natural Language", aesthetic: "None (no aesthetic injection)", extra_instructions: "", custom_instruction: "", n_gpu_layers: -1, n_ctx: 4096, max_tokens: 1000, temperature: 0.7, seed: 0 },
    loadLLMSettings()
  );
  function saveLLM() { saveLLMSettings(llm); }

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
  enhLeft.append(
    fieldRow("GGUF Model", ggufSelE),
    fieldRow("GPU Layers", gpuLayersE),
    fieldRow("Context Size", nCtxE),
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

  const enhTA = el("textarea", { placeholder: "결과가 여기에 표시됩니다…", style: { flex: "1", background: C.bg0, color: C.text, border: "none", padding: "10px", fontSize: "13px", fontFamily: "inherit", resize: "none", outline: "none" } });
  const enhReplaceBtn = button("적용", () => { setPrompt(enhTA.value); editTA.value = enhTA.value; }, "primary");
  const enhRight = el("div", { style: { flex: "1", display: "flex", flexDirection: "column" } }, [enhTA, el("div", { style: { padding: "6px", borderTop: `1px solid ${C.border}` } }, [enhReplaceBtn])]);
  const panelEnhance = el("div", { class: "aos-llm-panel-row", style: { display: "none", flex: "1", flexDirection: "row" } }, [enhLeft, enhRight]);

  enhanceBtn.addEventListener("click", async () => {
    const prompt = editTA.value.trim();
    if (!prompt) { alert("먼저 프롬프트를 입력하세요"); return; }
    enhanceBtn.textContent = "…";
    (enhanceBtn as HTMLButtonElement).disabled = true;
    try {
      const r = await comfyApi.fetchApi("/tj_studio_one/llm/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, gguf_model: llm.gguf_model, n_gpu_layers: llm.n_gpu_layers, n_ctx: llm.n_ctx, max_tokens: llm.max_tokens, temperature: llm.temperature, seed: llm.seed, model_format: llm.model_format, aesthetic: llm.aesthetic, extra_instructions: llm.extra_instructions }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "error");
      enhTA.value = d.result;
    } catch (e: any) {
      alert("LLM 오류: " + (e.message || e));
    } finally {
      enhanceBtn.textContent = "✨ Enhance";
      (enhanceBtn as HTMLButtonElement).disabled = false;
    }
  });

  // ── Image → Prompt panel ─────────────────────────────────────────────────
  const i2pLeft = el("div", { class: "aos-llm-left", style: { width: "210px", flexShrink: "0", background: C.bg0, padding: "10px", display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto", borderRight: `1px solid ${C.border}` } });

  const dropZone = el("div", { style: { border: `2px dashed ${C.border}`, borderRadius: "6px", padding: "10px", textAlign: "center", cursor: "pointer", color: C.muted, fontSize: "11px", background: C.bg2, minHeight: "80px", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" } });
  dropZone.textContent = "이미지를 드래그하거나 클릭";
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
      img.src = src;
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
  const urlInput = el("input", { type: "text", placeholder: "이미지 URL…", style: { flex: "1", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "4px 6px", fontSize: "11px", minWidth: "0" } });
  const btnDl = el("button", { type: "button", text: "↓", title: "URL에서 다운로드", style: { background: "#1a1e3a", color: "#7e9eff", border: "1px solid #3a4a7a", borderRadius: "4px", padding: "4px 8px", cursor: "pointer", fontSize: "11px", flexShrink: "0" } });
  btnDl.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    if (!url) { alert("URL을 입력하세요"); return; }
    btnDl.textContent = "…"; (btnDl as HTMLButtonElement).disabled = true;
    try {
      const resp = await comfyApi.fetchApi("/tj_studio_one/llm/download_image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const d = await resp.json();
      if (!d.ok) throw new Error(d.error || "unknown error");
      await resizeAndSetImage(d.b64);
    } catch (e: any) { alert("다운로드 오류: " + (e.message || e)); }
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

  i2pLeft.append(
    fieldRow("이미지", imgWrap),
    fieldRow("GGUF Model", ggufSelI),
    fieldRow("mmproj", mmprojSel),
    fieldRow("Vision Task", vtSel),
    fieldRow("Model Format", modelFmtSelI),
    fieldRow("Aesthetic", aestheticSelI),
    fieldRow("Custom Instruction", customInstrTA),
    fieldRow("GPU Layers", gpuLayersI),
    fieldRow("Max Tokens", maxTokI),
    fieldRow("Temperature", tempI),
    fieldRow("Seed", seedI)
  );
  const i2pBtn = el("button", { type: "button", text: "🖼 분석", style: { background: "#1a1e4a", color: "#7e9eff", border: "1px solid #3a4a7a", borderRadius: "5px", padding: "8px", cursor: "pointer", fontSize: "12px", fontWeight: "700" } });
  i2pLeft.appendChild(i2pBtn);

  const i2pTA = el("textarea", { placeholder: "분석 결과가 여기에 표시됩니다…", style: { flex: "1", background: C.bg0, color: C.text, border: "none", padding: "10px", fontSize: "13px", fontFamily: "inherit", resize: "none", outline: "none" } });
  const i2pSendBtn = button("적용", () => { setPrompt(i2pTA.value); editTA.value = i2pTA.value; }, "primary");
  const i2pRight = el("div", { style: { flex: "1", display: "flex", flexDirection: "column" } }, [i2pTA, el("div", { style: { padding: "6px", borderTop: `1px solid ${C.border}` } }, [i2pSendBtn])]);
  const panelI2P = el("div", { class: "aos-llm-panel-row", style: { display: "none", flex: "1", flexDirection: "row" } }, [i2pLeft, i2pRight]);

  i2pBtn.addEventListener("click", async () => {
    if (!imgB64) { alert("먼저 이미지를 업로드하세요"); return; }
    i2pBtn.textContent = "…";
    (i2pBtn as HTMLButtonElement).disabled = true;
    try {
      const r = await comfyApi.fetchApi("/tj_studio_one/llm/image_to_prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64: imgB64, gguf_model: llm.gguf_model, mmproj_file: llm.mmproj_file, vision_task: llm.vision_task, model_format: llm.model_format, aesthetic: llm.aesthetic, custom_instruction: llm.custom_instruction, n_gpu_layers: llm.n_gpu_layers, n_ctx: llm.n_ctx, max_tokens: llm.max_tokens, temperature: llm.temperature, seed: llm.seed }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "error");
      i2pTA.value = d.result;
    } catch (e: any) {
      alert("LLM 오류: " + (e.message || e));
    } finally {
      i2pBtn.textContent = "🖼 분석";
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
    comfyApi.fetchApi("/tj_studio_one/llm/models").then((r) => r.json()).then((d) => {
      if (!d.ok) return;
      if (d.gguf?.length) {
        [ggufSelE, ggufSelI].forEach((s) => populateSelect(s, d.gguf, llm.gguf_model));
        if (!llm.gguf_model && d.gguf[0]) { llm.gguf_model = d.gguf[0]; saveLLM(); ggufSelE.value = llm.gguf_model; ggufSelI.value = llm.gguf_model; }
      }
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
  const ov = el("div", { style: { position: "fixed", inset: "0", zIndex: "10001", background: "rgba(0,0,0,0.85)", display: "none", alignItems: "center", justifyContent: "center" } });
  const box = el("div", { style: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "12px", width: "min(700px, 92vw)", maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" } });

  const hdr = el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
  hdr.append(el("div", { text: "📋 프롬프트 템플릿", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }), button("✕", () => (ov.style.display = "none"), "danger"));
  box.appendChild(hdr);
  ov.appendChild(box);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.style.display = "none"; });

  const builtInEl = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } });
  box.appendChild(builtInEl);
  function renderBuiltIn() {
    clear(builtInEl);
    const categories = (BUILT_IN[getMode()] || []).filter((cat) => cat.items.length);
    if (!categories.length) {
      builtInEl.appendChild(el("div", { text: "이 모드에는 내장 템플릿이 없습니다. 아래에서 직접 만들어 쓰세요.", style: { color: C.muted, fontSize: "11px" } }));
      return;
    }
    categories.forEach((cat) => {
      builtInEl.appendChild(el("div", { text: cat.cat, style: { color: C.muted, fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: "4px" } }));
      const grid = el("div", { style: { display: "flex", flexWrap: "wrap", gap: "5px" } });
      cat.items.forEach((item) => {
        const btn = el("button", { type: "button", text: item.label, style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "4px 10px", borderRadius: "14px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, whiteSpace: "nowrap" } });
        btn.onclick = () => { onApply(item.prompt); ov.style.display = "none"; };
        grid.appendChild(btn);
      });
      builtInEl.appendChild(grid);
    });
  }

  box.appendChild(el("div", { style: { borderTop: `1px solid ${C.border}`, margin: "4px 0" } }));

  const customHeader = el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
  customHeader.append(el("div", { text: "MY TEMPLATES", style: { color: C.muted, fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em", flex: "1" } }));
  const addBtn = button("+ New", () => startEdit(null));
  customHeader.appendChild(addBtn);
  box.appendChild(customHeader);

  let customTemplates: { name: string; prompt: string }[] = [];
  const listEl = el("div", { style: { display: "flex", flexDirection: "column", gap: "5px" } });
  box.appendChild(listEl);

  function renderCustom() {
    clear(listEl);
    if (!customTemplates.length) {
      listEl.appendChild(el("div", { text: "저장된 템플릿이 없습니다. + New로 추가하세요.", style: { color: C.muted, fontSize: "11px", padding: "8px 0" } }));
      return;
    }
    customTemplates.forEach((t, i) => {
      const card = el("div", { style: { background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "7px 10px", display: "flex", alignItems: "flex-start", gap: "8px" } });
      const info = el("div", { style: { flex: "1", minWidth: "0" } });
      info.append(
        el("div", { text: t.name, style: { color: C.text, fontSize: "12px", fontWeight: "600", marginBottom: "2px" } }),
        el("div", { text: t.prompt.slice(0, 100) + (t.prompt.length > 100 ? "…" : ""), style: { color: C.muted, fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } })
      );
      const applyBtn = button("Apply", () => { onApply(t.prompt); ov.style.display = "none"; }, "primary");
      const editBtn = button("Edit", () => startEdit(i));
      const delBtn = button("✕", async () => { if (!(await confirmDialog(`"${t.name}" 삭제할까요?`))) return; customTemplates.splice(i, 1); saveCustom(); renderCustom(); }, "danger");
      card.append(info, applyBtn, editBtn, delBtn);
      listEl.appendChild(card);
    });
  }

  const editForm = el("div", { style: { display: "none", flexDirection: "column", gap: "6px", padding: "10px", background: C.bg0, borderRadius: "8px", border: `1px solid ${C.border}` } });
  const nameIn = el("input", { type: "text", placeholder: "템플릿 이름…", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px", fontSize: "12px", fontFamily: "inherit" } });
  const promptTA2 = el("textarea", { placeholder: "프롬프트…", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px", fontSize: "12px", fontFamily: "inherit", resize: "vertical", minHeight: "70px" } });
  editForm.append(uiLabel("이름"), nameIn, uiLabel("프롬프트"), promptTA2);
  let editIdx: number | null = null;
  const saveEditBtn = button("💾 저장", () => {
    const n = nameIn.value.trim(), p = promptTA2.value.trim();
    if (!n || !p) { alert("이름과 프롬프트를 모두 입력하세요."); return; }
    if (editIdx === null) customTemplates.push({ name: n, prompt: p });
    else customTemplates[editIdx] = { name: n, prompt: p };
    saveCustom(); editForm.style.display = "none"; renderCustom();
  }, "primary");
  const cancelEditBtn = button("취소", () => { editForm.style.display = "none"; });
  editForm.appendChild(row([saveEditBtn, cancelEditBtn]));
  box.appendChild(editForm);

  function startEdit(idx: number | null) {
    editIdx = idx;
    nameIn.value = idx !== null ? customTemplates[idx].name : "";
    promptTA2.value = idx !== null ? customTemplates[idx].prompt : "";
    editForm.style.display = "flex";
  }
  function saveCustom() { saveConfig({ t2i_templates: customTemplates }).catch(() => {}); }

  let loaded = false;
  return {
    el: ov,
    show() {
      ov.style.display = "flex";
      renderBuiltIn();
      if (!loaded) {
        loaded = true;
        getConfig().then((cfg) => {
          customTemplates = Array.isArray(cfg.t2i_templates) ? cfg.t2i_templates : [];
          renderCustom();
        }).catch(() => renderCustom());
      }
    },
    hide() { ov.style.display = "none"; },
  };
}
