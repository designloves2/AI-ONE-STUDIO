// settings.ts — Qwen Image Edit 2511 Settings 오버레이.
// 원본 근거: web/qwen2511/ui_app_settings_qe.js — Lightning LoRA(4-step 속도 부스트, ON 전환 시
// Steps=8/CFG=1로 자동 세팅) + Camera Angle LoRA(ANGLE 모드 전용) 섹션이 Klein/Z-Image에는 없는
// Qwen 2511 고유 기능이다.
import type { QEState } from "./core";
import { C, el, SUBFOLDER, BRAND } from "./core";
import { panel, label, button, row, col, searchableSelect } from "../../shared/ui";
import { getModels, getConfig, saveConfig } from "./api";

export interface AppConfig {
  output_mode_visible: boolean;
}

export interface SettingsCtx {
  persist: () => void;
  availableLoras: string[];
  appConfig: AppConfig;
  onModelsRefreshed?: () => void;
  onOutputVisibilityChanged?: () => void;
  onLightningChange?: () => void;
}

function simpleLoraRow(
  labelText: string,
  hint: string,
  getLora: () => { name: string; strength: number; enabled: boolean },
  setLora: (l: { name: string; strength: number; enabled: boolean }) => void,
  availableLoras: () => string[],
  persist: () => void,
  onToggle?: (enabled: boolean) => void
) {
  const wrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } });
  const lora = getLora();
  const opts = ["none", ...availableLoras()];
  const sel = searchableSelect(opts, lora.name || "none", (v) => { lora.name = v; setLora(lora); persist(); });
  const strIn = el("input", { type: "number", step: "0.05", min: "0", max: "2", style: { width: "60px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "4px", fontSize: "12px", fontFamily: "inherit", outline: "none" } }) as HTMLInputElement;
  strIn.value = String(lora.strength ?? 1);
  strIn.addEventListener("input", () => { const v = parseFloat(strIn.value); lora.strength = isNaN(v) ? 1 : v; setLora(lora); persist(); });
  const onBtn = el("button", { type: "button", text: lora.enabled ? "ON" : "OFF", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "10px", padding: "3px 8px", borderRadius: "10px", border: "none", background: lora.enabled ? BRAND : "#444", color: "#fff", fontWeight: "700" } });
  onBtn.addEventListener("click", () => {
    lora.enabled = !lora.enabled;
    setLora(lora);
    persist();
    onBtn.textContent = lora.enabled ? "ON" : "OFF";
    onBtn.style.background = lora.enabled ? BRAND : "#444";
    onToggle?.(lora.enabled);
  });
  wrap.append(
    label(labelText),
    sel.el,
    row([el("span", { text: "Strength:", style: { fontSize: "11px", color: C.muted, flexShrink: "0" } }), strIn, onBtn]),
    el("div", { style: { fontSize: "10px", color: C.muted, lineHeight: "1.4" }, text: hint })
  );
  return { wrap, refreshOptions: (newOpts: string[]) => { (sel.el.querySelector("select") as HTMLSelectElement)?.replaceChildren(...["none", ...newOpts].map((o) => el("option", { value: o, text: o }))); sel.setValue(lora.name || "none"); } };
}

export function createSettingsOverlay(state: QEState, ctx: SettingsCtx) {
  const ov = el("div", {
    style: {
      position: "absolute", inset: "0", zIndex: "60",
      background: "rgba(11,11,11,0.97)", borderRadius: "inherit",
      display: "none", flexDirection: "column", padding: "12px", gap: "8px",
      boxSizing: "border-box", overflowY: "auto",
    },
  });

  const topRow = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" } });
  topRow.appendChild(el("div", { text: "⚙ Settings — Qwen Image Edit 2511", style: { color: "#ffffff", fontSize: "14px", fontWeight: "700", flex: "1" } }));
  const saveAllBtn = button("💾 Save All", () => saveAll(), "primary");
  const closeBtn = button("✕", () => (ov.style.display = "none"), "danger");
  topRow.append(saveAllBtn, closeBtn);
  ov.appendChild(topRow);

  const modelWrap = el("div"), teWrap = el("div"), vaeWrap = el("div");
  let modelSel: ReturnType<typeof searchableSelect>, teSel: ReturnType<typeof searchableSelect>, vaeSel: ReturnType<typeof searchableSelect>;

  function rebuildModels(data: { diffusion_models?: string[]; text_encoders?: string[]; vaes?: string[] }) {
    [modelWrap, teWrap, vaeWrap].forEach((w) => (w.innerHTML = ""));
    const diff = ["none", ...(data.diffusion_models || [])];
    const te = ["none", ...(data.text_encoders || [])];
    const vaes = ["none", ...(data.vaes || [])];
    if (data.diffusion_models?.length && !diff.includes(state.model)) state.model = "none";
    if (data.text_encoders?.length && !te.includes(state.textEncoder)) state.textEncoder = "none";
    if (data.vaes?.length && !vaes.includes(state.vae)) state.vae = "none";
    modelSel = searchableSelect(diff, state.model, (v) => { state.model = v; ctx.persist(); });
    teSel = searchableSelect(te, state.textEncoder, (v) => { state.textEncoder = v; ctx.persist(); });
    vaeSel = searchableSelect(vaes, state.vae, (v) => { state.vae = v; ctx.persist(); });
    modelWrap.appendChild(col([label("Diffusion Model (UNETLoader)"), modelSel.el]));
    teWrap.appendChild(col([label("Text Encoder (CLIPLoader qwen_image)"), teSel.el]));
    vaeWrap.appendChild(col([label("VAE"), vaeSel.el]));
  }
  rebuildModels({});

  const refreshBtn = button("↻ Refresh Models", async () => {
    refreshBtn.textContent = "Loading…";
    try {
      const d = await getModels();
      rebuildModels(d);
      ctx.availableLoras = d.loras || [];
      ctx.onModelsRefreshed?.();
      lightningRow.refreshOptions(d.loras || []);
      angleRow.refreshOptions(d.loras || []);
    } finally {
      refreshBtn.textContent = "↻ Refresh Models";
    }
  });
  const modelNote = el("div", { style: { fontSize: "10px", color: C.muted, marginTop: "-4px" } });
  modelNote.innerHTML = "Model → <code>models/diffusion_models/</code> · Text Encoder → <code>models/text_encoders/</code> · VAE → <code>models/vae/</code>";
  ov.appendChild(panel([el("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } }, [row([modelWrap, teWrap, vaeWrap]), modelNote, refreshBtn])]));

  // ── Lightning LoRA — ON 전환 시 Steps=8/CFG=1, OFF 시 Steps=20/CFG=4로 자동 세팅 ──
  const lightningRow = simpleLoraRow(
    "Lightning LoRA (optional 4-step speed)",
    "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16 · steps=4, cfg=1.0",
    () => state.lightningLora,
    (l) => (state.lightningLora = l),
    () => ctx.availableLoras,
    ctx.persist,
    (enabled) => {
      if (enabled) { state.steps = 8; state.cfg = 1; } else { state.steps = 20; state.cfg = 4; }
      ctx.persist();
      ctx.onLightningChange?.();
    }
  );
  ov.appendChild(panel([lightningRow.wrap]));

  // ── Camera Angle LoRA — ANGLE 모드 생성 시 자동 적용 ──────────────────────
  const angleRow = simpleLoraRow(
    "Camera Angle LoRA (optional — applied in ANGLE mode)",
    "Select a LoRA trained for camera angle control. Saved here and auto-applied when ANGLE mode generates.",
    () => state.angleLora,
    (l) => (state.angleLora = l),
    () => ctx.availableLoras,
    ctx.persist
  );
  ov.appendChild(panel([angleRow.wrap]));

  const negTA = el("textarea", { placeholder: "Negative prompt…", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px", fontSize: "12px", fontFamily: "inherit", resize: "vertical", outline: "none", minHeight: "60px" } });
  negTA.value = state.negativePrompt || "";
  negTA.addEventListener("input", () => (state.negativePrompt = negTA.value));
  ov.appendChild(panel([label("Negative Prompt"), negTA]));

  const suffixIn = el("input", { type: "text", placeholder: "e.g. high quality, sharp focus", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px", fontSize: "12px", fontFamily: "inherit" } });
  suffixIn.value = state.promptSuffix || "";
  suffixIn.addEventListener("input", () => (state.promptSuffix = suffixIn.value));
  ov.appendChild(panel([label("Prompt Suffix (auto-appended)"), suffixIn]));

  const pathIn = el("input", { type: "text", placeholder: SUBFOLDER, style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px", fontSize: "12px", fontFamily: "inherit" } });
  pathIn.value = state.saveSubfolder || "";
  pathIn.addEventListener("input", () => (state.saveSubfolder = pathIn.value.trim()));

  const visChk = el("input", { type: "checkbox" });
  visChk.checked = ctx.appConfig.output_mode_visible !== false;
  const visLbl = el("label", { style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: C.text } }, [visChk, el("span", { text: "Show Save / Preview toggle in main view" })]);
  visChk.addEventListener("change", () => {
    ctx.appConfig.output_mode_visible = visChk.checked;
    ctx.onOutputVisibilityChanged?.();
  });
  ov.appendChild(panel([label("Save Folder (output/ 안)"), pathIn, visLbl]));

  function saveAll() {
    ctx.persist();
    saveConfig({
      save_subfolder: state.saveSubfolder || "",
      output_mode_visible: visChk.checked,
      selected_model: state.model || "",
      selected_text_encoder: state.textEncoder || "",
      selected_vae: state.vae || "",
      negative_prompt: state.negativePrompt || "",
      prompt_suffix: state.promptSuffix || "",
    });
    saveAllBtn.textContent = "✓ Saved!";
    setTimeout(() => (saveAllBtn.textContent = "💾 Save All"), 1500);
  }

  getConfig()
    .then((cfg) => {
      if (cfg.negative_prompt && !state.negativePrompt) { state.negativePrompt = cfg.negative_prompt; negTA.value = cfg.negative_prompt; }
      if (cfg.prompt_suffix && !state.promptSuffix) { state.promptSuffix = cfg.prompt_suffix; suffixIn.value = cfg.prompt_suffix; }
      if (cfg.save_subfolder && !state.saveSubfolder) pathIn.placeholder = cfg.save_subfolder;
      visChk.checked = cfg.output_mode_visible !== false;
      ctx.appConfig.output_mode_visible = visChk.checked;
      ctx.onOutputVisibilityChanged?.();
      return getModels().then((d) => {
        rebuildModels(d);
        ctx.availableLoras = d.loras || [];
        ctx.onModelsRefreshed?.();
        lightningRow.refreshOptions(d.loras || []);
        angleRow.refreshOptions(d.loras || []);
      });
    })
    .catch(() => {});

  return {
    el: ov,
    show() { ov.style.display = "flex"; },
    hide() { ov.style.display = "none"; },
  };
}
