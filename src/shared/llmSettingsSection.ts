// llmSettingsSection.ts — the image tools' "LLM — Prompt Write / Prompt Enhance" settings section:
// the Prompt Enhance block (role text) and the Image → Prompt Write block (role vision), each with
// Backend [Local GGUF, ComfyUI Native, OpenRouter, Connect Custom] + its fields, then the advanced row
// (GPU layers, n_ctx, max tokens, temperature, seed). Reads/writes the shared settings object, which
// lives on the SERVER (/tj_shared/llm_settings — see llmSettingsStore.ts), so the values equal the ones
// every image tool's popup uses. Port of the node's web/shared/llm_panel.js mountLLMSettingsSection.
import { getComfyBase } from "./comfyBase";
import { C } from "../identity";
import { createLlmBackendGroup } from "./llmBackendPanel";
import { loadLLMSettings, saveLLMSettings } from "./llmSettingsStore";

const fetchApi = (path: string, opts?: RequestInit) => fetch(`${getComfyBase()}${path}`, { ...opts, credentials: "include" });

function selectEl(options: string[], value: string, onChange: (v: string) => void) {
  const s = document.createElement("select");
  Object.assign(s.style, { background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "4px 6px", fontSize: "11px", width: "100%" });
  options.forEach((o) => { const op = document.createElement("option"); op.value = o; op.textContent = o; if (o === value) op.selected = true; s.appendChild(op); });
  s.addEventListener("change", () => onChange(s.value));
  return s;
}
function labelRow(text: string, control: HTMLElement) {
  const w = document.createElement("div");
  Object.assign(w.style, { display: "flex", flexDirection: "column", gap: "2px" });
  const l = document.createElement("div");
  l.textContent = text;
  Object.assign(l.style, { color: C.muted, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.04em" });
  w.append(l, control);
  return w;
}
function numberInput(value: number, min: number, max: number, step: number, onChange: (v: number) => void) {
  const i = document.createElement("input");
  i.type = "number"; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(value);
  Object.assign(i.style, { background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "4px 6px", fontSize: "11px", width: "100%", boxSizing: "border-box" });
  i.addEventListener("input", () => { const v = parseFloat(i.value); if (!isNaN(v)) onChange(v); });
  return i;
}
function populate(sel: HTMLSelectElement, opts: string[], current: string) {
  sel.innerHTML = "";
  opts.forEach((m) => { const o = document.createElement("option"); o.value = m; o.textContent = m; if (m === current) o.selected = true; sel.appendChild(o); });
}

export function mountLLMSettingsSection(host: HTMLElement): void {
  const cfg = loadLLMSettings();
  const llm: any = {
    backend_text: cfg.backend_text || cfg.backend || "local",
    backend_vision: cfg.backend_vision || cfg.backend || "local",
    or_model: cfg.or_model_text || cfg.or_model || "",
    or_model_vision: cfg.or_model_vision || cfg.or_model || "",
    custom_base_text: cfg.custom_base_text || "", custom_model_text: cfg.custom_model_text || "", custom_ctx_text: cfg.custom_ctx_text ?? 0,
    custom_base_vision: cfg.custom_base_vision || "", custom_model_vision: cfg.custom_model_vision || "", custom_ctx_vision: cfg.custom_ctx_vision ?? 0,
    gguf_model: cfg.gguf_model || "",
    mmproj_file: cfg.mmproj_file || "none",
    text_encoder_name: cfg.text_encoder_name || "",
    clip_loader_type: cfg.clip_loader_type || "Auto",
    vision_task: cfg.vision_task || "Caption + Format (apply model_format below)",
    model_format: cfg.model_format || "Universal Natural Language",
    aesthetic: cfg.aesthetic || "None (no aesthetic injection)",
    extra_instructions: cfg.extra_instructions || "",
    n_gpu_layers: cfg.n_gpu_layers ?? -1,
    n_ctx: cfg.n_ctx ?? 4096,
    max_tokens: cfg.max_tokens ?? 1000,
    temperature: cfg.temperature ?? 0.7,
    seed: cfg.seed ?? 0,
  };
  const saveLLM = () => saveLLMSettings(llm);

  const wrap = document.createElement("div");
  Object.assign(wrap.style, { display: "flex", flexDirection: "column", gap: "10px" });
  const title = document.createElement("div");
  title.textContent = "LLM — Prompt Write / Prompt Enhance";
  Object.assign(title.style, { color: "#fff", fontSize: "13px", fontWeight: "700" });
  wrap.appendChild(title);
  const body = document.createElement("div");
  Object.assign(body.style, { display: "flex", flexDirection: "column", gap: "10px" });
  wrap.appendChild(body);

  const group = createLlmBackendGroup(llm, saveLLM);
  const enhBlock = group.makeBlock("text");
  const i2pBlock = group.makeBlock("vision");
  // Local GGUF rows (the shared block leaves `localOnly` for the caller): text role needs the GGUF model,
  // vision role also needs mmproj.
  const ggufText = selectEl([llm.gguf_model || "Loading…"], llm.gguf_model || "", (v) => { llm.gguf_model = v; saveLLM(); ggufVision.value = v; });
  const rowGgufText = labelRow("GGUF Model", ggufText);
  enhBlock.localOnly.push(rowGgufText);
  enhBlock.el.insertBefore(rowGgufText, enhBlock.el.firstChild!.nextSibling);
  const ggufVision = selectEl([llm.gguf_model || "Loading…"], llm.gguf_model || "", (v) => { llm.gguf_model = v; saveLLM(); ggufText.value = v; });
  const mmprojSel = selectEl([llm.mmproj_file || "none"], llm.mmproj_file || "none", (v) => { llm.mmproj_file = v; saveLLM(); });
  const rowGgufVision = labelRow("GGUF Model", ggufVision);
  const rowMmproj = labelRow("mmproj", mmprojSel);
  i2pBlock.localOnly.push(rowGgufVision, rowMmproj);
  i2pBlock.el.insertBefore(rowMmproj, i2pBlock.el.firstChild!.nextSibling);
  i2pBlock.el.insertBefore(rowGgufVision, i2pBlock.el.firstChild!.nextSibling);
  enhBlock.syncFromState();
  i2pBlock.syncFromState();
  body.append(enhBlock.el, i2pBlock.el);

  const advRow = document.createElement("div");
  Object.assign(advRow.style, { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: "6px" });
  advRow.append(
    labelRow("GPU Layers", numberInput(llm.n_gpu_layers, -1, 999, 1, (v) => { llm.n_gpu_layers = v; saveLLM(); })),
    labelRow("Context (n_ctx)", numberInput(llm.n_ctx, 512, 32768, 512, (v) => { llm.n_ctx = v; saveLLM(); })),
    labelRow("Max Tokens", numberInput(llm.max_tokens, 50, 4096, 50, (v) => { llm.max_tokens = v; saveLLM(); })),
    labelRow("Temperature", numberInput(llm.temperature, 0, 2, 0.05, (v) => { llm.temperature = v; saveLLM(); })),
    labelRow("Seed", numberInput(llm.seed, 0, 999999999, 1, (v) => { llm.seed = v; saveLLM(); })),
  );
  body.appendChild(advRow);

  fetchApi("/tj_studio_one/llm/models").then((r) => r.json()).then((d: any) => {
    if (d.or_model_text && !llm.or_model) { llm.or_model = d.or_model_text; saveLLM(); }
    if (d.or_model_vision && !llm.or_model_vision) { llm.or_model_vision = d.or_model_vision; saveLLM(); }
    const orModels: string[] = Array.isArray(d.or_models) ? d.or_models : [];
    if (!d.ok || d._notInstalled) group.stripLocal(); else group.syncAll();
    group.fillAll(orModels, d.openrouter_key_hint || "");
    group.fillTextEncodersAll(d.text_encoders || [], d.clip_loader_types || []);
    if (d.gguf?.length) {
      [ggufText, ggufVision].forEach((sel) => populate(sel, d.gguf, llm.gguf_model || d.gguf[0]));
      if (!llm.gguf_model) { llm.gguf_model = d.gguf[0]; saveLLM(); }
    }
    if (d.mmproj?.length) populate(mmprojSel, ["none", ...d.mmproj.filter((m: string) => m !== "none")], llm.mmproj_file || "none");
  }).catch(() => {});

  host.appendChild(wrap);
}
