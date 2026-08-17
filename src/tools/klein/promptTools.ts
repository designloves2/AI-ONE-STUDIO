// promptTools.ts — Z-Image 프롬프트 보조 기능: 확장 편집(Edit/Enhance LLM/Image→Prompt 탭) +
// 프롬프트 템플릿 오버레이. Krea2와 동일한 공유 LLM 백엔드(shared/llm_panel.js)를 사용하므로
// 로직은 1:1 재사용, import 경로만 zimage 것으로 조정.
import { C, el, clear, BRAND } from "./core";
import { button, label as uiLabel, row, confirmDialog } from "../../shared/ui";
import { getConfig, saveConfig } from "./api";
import { comfyApi } from "./comfyClient";

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

export function createPromptExpandOverlay(getPrompt: () => string, setPrompt: (text: string) => void) {
  const ov = el("div", { style: { position: "fixed", inset: "0", zIndex: "10001", background: "rgba(0,0,0,0.85)", display: "none", alignItems: "center", justifyContent: "center" } });
  const box = el("div", { class: "aos-llm-box", style: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "12px", width: "min(980px, 94vw)", height: "min(660px, 88vh)", display: "flex", flexDirection: "column", gap: "8px" } });

  const hdr = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" } });
  hdr.append(el("div", { text: "프롬프트 편집", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }), button("✕", () => (ov.style.display = "none"), "danger"));

  const tabBar = el("div", { style: { display: "flex", gap: "4px", flexShrink: "0" } });
  function mkTab(text: string) {
    return el("button", { type: "button", text, style: { background: C.bg2, color: C.muted, border: `1px solid ${C.border}`, borderRadius: "6px 6px 0 0", padding: "6px 14px", fontSize: "11px", cursor: "pointer", fontWeight: "700" } });
  }
  const tabEdit = mkTab("Edit"), tabEnhance = mkTab("✨ Enhance"), tabI2P = mkTab("🔍 Image → Prompt");
  tabBar.append(tabEdit, tabEnhance, tabI2P);

  const content = el("div", { class: "aos-llm-content", style: { flex: "1", minHeight: "0", display: "flex", border: `1px solid ${C.border}`, borderRadius: "0 6px 6px 6px", overflow: "hidden" } });

  const editTA = el("textarea", { style: { flex: "1", background: C.bg0, color: C.text, border: "none", padding: "10px", fontSize: "13px", fontFamily: "inherit", resize: "none", outline: "none" } });
  const panelEdit = el("div", { style: { display: "flex", flex: "1" } }, [editTA]);

  const llm = Object.assign(
    { gguf_model: "", mmproj_file: "none", vision_task: "Caption (plain description)", model_format: "Universal Natural Language", aesthetic: "None (no aesthetic injection)", extra_instructions: "", custom_instruction: "", n_gpu_layers: -1, n_ctx: 4096, max_tokens: 1000, temperature: 0.7, seed: 0 },
    loadLLMSettings()
  );
  function saveLLM() { saveLLMSettings(llm); }

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
  const i2pBtn = el("button", { type: "button", text: "🔍 분석", style: { background: "#1a1e4a", color: "#7e9eff", border: "1px solid #3a4a7a", borderRadius: "5px", padding: "8px", cursor: "pointer", fontSize: "12px", fontWeight: "700" } });
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
      i2pBtn.textContent = "🔍 분석";
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

// 원본 web/klein/ui_prompt_templates.js의 BUILT_IN 그대로 이식 — 모드별로 완전히 다른
// 카테고리를 가진다(edit는 ANGLES/RELIGHT/STYLES/OTHER 수십 개, inpaint는 SKETCH/COLLAGE/
// INPAINT/OUTPAINT 4개, faceswap은 1개, i2i는 비어있음, t2i/upscale은 항목 자체가 없음).
// 이전에 Krea2/Z-Image와 동일한 범용 4카테고리를 그대로 복사해 썼던 게 실제 버그였다.
const BUILT_IN: Record<string, { cat: string; items: { label: string; prompt: string }[] }[]> = {
  edit: [
    { cat: "ANGLES", items: [
      { label: "Close-up", prompt: "Shift to a tight close-up on the subject. Crop the frame closely to focus on the main details while keeping the background sharp and visible. Ensure all colors, textures, and environmental elements from the original scene remain identical and perfectly clear, simply viewed from a much shorter camera distance." },
      { label: "Wide-angle", prompt: "Switch to a wide-angle lens while keeping the subject at the center. Reveal more of the existing environment, ensuring the architecture, lighting, and background elements remain identical to the original scene." },
      { label: "Aerial view", prompt: "Transition to a high-altitude aerial view. Reinterpret the original environment's layout from above, keeping all landmarks, colors, and lighting consistent with the source image." },
      { label: "Low-angle", prompt: "Move the camera to a low-angle ground position. Keep the environment identical but show more of the sky or ceiling, ensuring the subject and background maintain their established relationship and scale." },
    ]},
    { cat: "RELIGHT", items: [
      { label: "Soft Azure Drift", prompt: "relight with gentle soft blue lighting emanating from the upper right corner" },
      { label: "Dramatic Slats", prompt: "Relight the image with a strong directional light source from the bottom left, creating distinct shadows and casting linear shadows on the background" },
      { label: "Amber Sideglow", prompt: "relight with noticeable warm amber daylight emanating from the right side" },
      { label: "Shadow Fade Mystery", prompt: "add soft, warm lighting from the right side that gradually fades to shadows on the left, creating a dim, mysterious atmosphere with gentle gradients from light to dark" },
      { label: "High-Top Backlight", prompt: "Relight the image with a strong backlight like lighting from the top" },
      { label: "Soft Foggy Bloom", prompt: "Relight the scene with a soft, diffused foggy glow emanating from the top left side" },
      { label: "Dim Silver Moon", prompt: "relight with dim silver moonlight coming from the top right" },
      { label: "Dappled Canopy", prompt: "add dappled sunlight filtered through leaves from the top creating the shadows, source out of the scene" },
      { label: "Subtle Cool Bloom", prompt: "relight with a subtle cool white glow from the right side, source off-camera" },
      { label: "Warm Hearth Flicker", prompt: "relight with flickering warm orange light from the bottom center, source out of frame" },
      { label: "Sharp Cool Burst", prompt: "add a sharp burst of cool white light from the upper left, source off-camera" },
      { label: "Golden Doorway Glow", prompt: "add a warm yellow glow coming through a doorway from the side, source out of frame" },
      { label: "Faint Moon Hue", prompt: "relight with a faint desaturated blue moonlight from the top left, source out of frame" },
      { label: "Neutral Studio Soft", prompt: "relight with soft neutral white studio lighting from the top left, source out of frame" },
      { label: "Golden Rim Halo", prompt: "add a strong golden hour backlight, creating a glowing outline, source off-camera" },
      { label: "Blue-Magenta Split", prompt: "relight with a mix of cool blue and deep magenta light from opposite sides, source off-camera" },
      { label: "Low-Key Beam", prompt: "add low-key dramatic lighting with a narrow beam of light from the side, source out of frame" },
      { label: "Harsh Top-Down Noir", prompt: "relight with a harsh cool white top-down light, source off-camera, heavy shadows" },
      { label: "Dawn Flare", prompt: "relight with a low-angle warm orange sunrise from the horizon, long soft shadows, hazy morning glow, source out of frame." },
      { label: "Amber Beams", prompt: "relight with warm volumetric light beams from the top right, hazy atmosphere, source out of frame." },
      { label: "Teal-Orange Mix", prompt: "relight with a teal ambient fill and a warm orange key light from the opposite side, classic cinematic color grade, source out of frame." },
      { label: "Deep Kicker", prompt: "add a strong cool white kicker light from the back-left, grazing the edges of the subject, deep shadows in front, source out of frame." },
      { label: "Cross Light", prompt: "relight with two opposing light sources from the left and right sides, high contrast, creating a bright central highlight, source out of frame." },
      { label: "Cold Fill", prompt: "add a subtle desaturated cold blue fill light to the shadow areas, keeping the main light warm, professional color contrast, source out of frame." },
      { label: "Vignette Rim", prompt: "add a sharp white rim light from the back-right, separating the subject from a dark background, source out of frame." },
      { label: "Velvet Shadow", prompt: "relight with low-intensity soft light from the top, creating deep velvet-like shadows and subtle highlights on top surfaces, source out of frame." },
    ]},
    { cat: "STYLES", items: [
      { label: "35mm", prompt: "Change style to a grainy 35mm film photograph, shot on Kodak Portra 400, vintage aesthetic, natural colors." },
      { label: "Polaroid", prompt: "Change style to an authentic 1980s Polaroid photo, faded edges, soft focus, square format with white border." },
      { label: "NatGeo", prompt: "Change style to a raw documentary photograph, high-detail texture, natural sunlight, National Geographic aesthetic." },
      { label: "3D Render", prompt: "Change style to a clean 3D isometric render, soft clay-like textures, pastel color palette, Octane Render, studio lighting." },
      { label: "Oil Paint", prompt: "Change style to a classical oil painting, thick impasto brushstrokes, rich canvas texture, dramatic chiaroscuro." },
      { label: "VHS", prompt: "Change style to a 1990s VHS recording, tracking lines, chromatic aberration, low resolution, analog video glitch." },
      { label: "Portrait", prompt: "Change style to a high-end studio portrait, dramatic Rembrandt lighting, deep shadows, sharp focus on eyes, 8k professional photography." },
      { label: "Sketch", prompt: "Change style to a detailed graphite pencil sketch on textured paper, hand-drawn strokes, cross-hatching, artistic shading." },
      { label: "Digicam", prompt: 'Change style to a 2000s consumer digital camera photo, overexposed flash, slight motion blur, dated date stamp in right corner "01-08-2002", low dynamic range.' },
      { label: "Impressionist", prompt: "Change style to impressionist painting, vibrant dappled light, short thick brushstrokes, focus on light's movement, Monet-inspired palette." },
      { label: "Double Exp", prompt: "Change style to a double exposure photograph, blending the subject with a lush forest landscape, surreal overlays, ethereal atmosphere." },
      { label: "Gothic", prompt: "Change style to a dark moody gothic aesthetic, desaturated colors, misty atmosphere, sharp contrast, cinematic shadows." },
      { label: "Ukiyo-e", prompt: "Change style to traditional Japanese Ukiyo-e woodblock print, flat colors, bold outlines, decorative patterns, antique paper texture." },
      { label: "Charcoal", prompt: "Change style to a rough charcoal drawing, smudged textures, heavy dark strokes, expressive hand-drawn feel on textured canvas." },
      { label: "Marble", prompt: "Change style to a classical marble sculpture, smooth white stone texture, fine chiseled details, soft museum spotlighting." },
      { label: "Watercolor", prompt: "Change style to a delicate watercolor painting, soft pigment bleeds, wet-on-wet technique, hand-painted on cold-press paper." },
      { label: "Daguerreotype", prompt: "Change style to an 1800s daguerreotype, antique silver plate texture, sepia tones, heavy scratches, blurred edges, historical look." },
      { label: "Embroidery", prompt: "Change style to detailed needlepoint embroidery, textured silk threads, hand-stitched patterns, fabric canvas texture." },
      { label: "Claymation", prompt: "Change style to a stop-motion claymation figure, handmade plasticine texture, thumbprint details, studio macro lighting." },
      { label: "Low Poly", prompt: "Change style to a low-poly geometric art, sharp triangular facets, flat shading, minimalist 3D aesthetic." },
      { label: "Vector Art", prompt: "Change style to clean flat vector illustration, geometric shapes, bold solid colors, minimalist digital art." },
      { label: "16-Bit Pixel", prompt: "Change style to 16-bit retro pixel art, limited color palette, clean sprites, nostalgic SNES aesthetic." },
      { label: "Fortnite 3D", prompt: "Change style to Fortnite stylized 3D, vibrant colors, clean cartoonish textures, smooth lighting, battle royale aesthetic." },
    ]},
    { cat: "OTHER", items: [
      { label: "Enhance", prompt: "Enhance the overall image quality by restoring fine details and sharpening the focus. Remove all types of blur, including motion and lens blur, while preserving the original features, textures, and likeness. Increase clarity and micro-contrast without introducing artifacts, ensuring a clean, high-definition result that stays true to the source." },
      { label: "Text edit", prompt: 'Replace the existing text "[OLD TEXT]" with the new text "[NEW TEXT]" in the image. Replicate the exact typography, font family, letter shapes, color palette, effects, and texturing of the original text perfectly. Maintain the exact same position, scale, and alignment within the scene.' },
      { label: "Try-on", prompt: "Using Image 1 as the subject reference and Image 2 as the outfit reference: Modify only the clothing of the person from Image 1, completely replacing it with the exact outfit, style, textures, materials, and colors shown in Image 2. Retain the exact face, identity, hair, expression, pose, and background from Image 1. Conform the new clothing from Image 2 realistically to the subject's body shape and the lighting environment of Image 1. Maintain the original camera framing." },
      { label: "Texture transfer", prompt: "Using Image 1 as the subject and geometry reference, and Image 2 as the texture and material reference: Completely replace the surface material of the subject in Image 1 with the exact tactile texture, pattern, and material characteristics shown in Image 2. Conform the new texture perfectly to the 3D contours, shapes, curves, and lighting of Image 1. Maintain the original face, pose, anatomy, and background from Image 1 perfectly." },
    ]},
  ],
  i2i: [{ cat: "I2I", items: [] }],
  inpaint: [
    { cat: "SKETCH", items: [{ label: "Sketch to photo", prompt: "Transform this sketch into a hyper-realistic photographic scene. Interpret the lines as real-world objects with high-quality textures, cinematic lighting, and natural shadows. Maintain the original composition while adding depth, realistic materials, and 8k resolution details." }] },
    { cat: "COLLAGE", items: [{ label: "Collage to scene", prompt: "Transform this image collage into a cohesive, fully realized and unified scene. Seamlessly blend all the disparate elements into a singular, logical style, strictly maintaining the exact spatial arrangement and relative composition of the original collage while logically generating the missing environment, shadows, and context to naturally connect all objects. Scene Description: [Specify the overall art style or level of realism, the new specific lighting conditions, background environment setting, and overall mood here]" }] },
    { cat: "INPAINT", items: [{ label: "Edit masked area", prompt: "Edit the masked area: [DESCRIBE THE CHANGE — add, remove, replace, or modify the content]. Seamlessly blend with the surrounding scene, preserving the original lighting, shadows, depth of field, and photo grain." }] },
    { cat: "OUTPAINT", items: [{ label: "Extend composition", prompt: "Extend the composition of this image. Replace all black or empty spaces with a logical continuation of the background and foreground. Ensure the transition is invisible and the new elements perfectly match the perspective and color palette of the original image. Scene description: [briefly describe what should appear in the expanded areas]" }] },
  ],
  faceswap: [
    { cat: "FACE SWAP (make sure you have a Faceswap LoRA selected in Settings)", items: [
      { label: "Head swap", prompt: "Replace the head in image 1 with the head from image 2, adapting the facial features to match the artistic style, focus, and environmental lighting of the image 1." },
    ]},
  ],
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
    const categories = BUILT_IN[getMode()] || [];
    if (!categories.length) {
      builtInEl.appendChild(el("div", { text: "이 모드에는 내장 템플릿이 없습니다. 아래에서 직접 만들어 쓰세요.", style: { color: C.muted, fontSize: "11px" } }));
      return;
    }
    categories.forEach((cat) => {
      if (!cat.items.length) return;
      builtInEl.appendChild(el("div", { text: cat.cat, style: { color: C.muted, fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: "4px" } }));
      const grid = el("div", { style: { display: "flex", flexWrap: "wrap", gap: "5px" } });
      cat.items.forEach((item) => {
        const btnEl = el("button", { type: "button", text: item.label, style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "4px 10px", borderRadius: "14px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, whiteSpace: "nowrap" } });
        btnEl.onclick = () => { onApply(item.prompt); ov.style.display = "none"; };
        grid.appendChild(btnEl);
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
  function saveCustom() { saveConfig({ fk_templates: customTemplates }).catch(() => {}); }

  let loaded = false;
  return {
    el: ov,
    show() {
      ov.style.display = "flex";
      renderBuiltIn();
      if (!loaded) {
        loaded = true;
        getConfig().then((cfg) => {
          customTemplates = Array.isArray(cfg.fk_templates) ? cfg.fk_templates : [];
          renderCustom();
        }).catch(() => renderCustom());
      }
    },
    hide() { ov.style.display = "none"; },
  };
}
