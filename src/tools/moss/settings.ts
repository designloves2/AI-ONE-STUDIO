// settings.ts — Moss Settings 오버레이 (모델 3종 + negative + 저장 폴더 + 매뉴얼).
// 원본 근거: web/moss/ui_app_settings_moss.js
import { tabSettings } from "../../shared/settingsTabs";
import { BRAND as TAB_BRAND } from "../../identity";
import type { MossState } from "./core";
import { C, el, SUBFOLDER, MANUAL_TEXT } from "./core";
import { panel, label, button, col, searchableSelect } from "../../shared/ui";
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
}

export function createSettingsOverlay(state: MossState, ctx: SettingsCtx) {
  const ov = el("div", {
    style: {
      position: "absolute", inset: "0", zIndex: "10002",
      background: "rgba(11,11,11,0.97)", borderRadius: "inherit",
      display: "none", flexDirection: "column", padding: "12px", gap: "8px",
      boxSizing: "border-box", overflowY: "auto",
    },
  });

  const topRow = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" } });
  topRow.appendChild(el("div", { text: "⚙ Settings — Moss Image ONE STUDIO (TJ)", style: { color: "#ffffff", fontSize: "14px", fontWeight: "700", flex: "1" } }));
  const saveAllBtn = button("💾 Save All", () => saveAll(), "primary");
  const closeBtn = button("✕", () => (ov.style.display = "none"), "danger");
  topRow.append(saveAllBtn, closeBtn);
  ov.appendChild(topRow);

  const modelWrap = el("div"), teWrap = el("div"), vaeWrap = el("div");
  let modelSel: ReturnType<typeof searchableSelect>, teSel: ReturnType<typeof searchableSelect>, vaeSel: ReturnType<typeof searchableSelect>;

  function rebuildModels(data: { diffusion_models?: string[]; text_encoders?: string[]; vaes?: string[]; loras?: string[] }) {
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
    modelWrap.appendChild(col([label("Diffusion Model (moss_image_sft_* or moss_image_base_*)"), modelSel.el]));
    teWrap.appendChild(col([label("Text Encoder (qwen3.5_9b_*, loaded as CLIP type moss_image)"), teSel.el]));
    vaeWrap.appendChild(col([label("VAE (flux2-vae.safetensors)"), vaeSel.el]));
  }
  rebuildModels({});

  const refreshBtn = button("↻ Refresh Models", async () => {
    refreshBtn.textContent = "Loading…";
    try {
      const d = await getModels();
      rebuildModels(d);
      ctx.availableLoras = d.loras || [];
      ctx.onModelsRefreshed?.();
    } finally {
      refreshBtn.textContent = "↻ Refresh Models";
    }
  });
  const modelNote = el("div", { style: { fontSize: "10px", color: C.muted, marginTop: "-4px" } });
  modelNote.innerHTML = "Diffusion model → <code>models/diffusion_models/</code> · Text Encoder → <code>models/text_encoders/</code> · VAE → <code>models/vae/</code>";
  ov.appendChild(panel([el("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } }, [modelWrap, teWrap, vaeWrap, modelNote, refreshBtn])]));

  const negTA = el("textarea", { placeholder: "Negative prompt…", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px", fontSize: "12px", fontFamily: "inherit", resize: "vertical", outline: "none", minHeight: "60px" } });
  negTA.value = state.negativePrompt || "";
  negTA.addEventListener("input", () => (state.negativePrompt = negTA.value));
  ov.appendChild(panel([label("Negative Prompt"), negTA]));

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
  ov.appendChild(panel([label("Save Folder (inside output/)"), pathIn, visLbl]));

  const manualBody = el("div", { style: { fontSize: "11px", lineHeight: "1.6", color: C.text, whiteSpace: "pre-wrap" } });
  manualBody.textContent = MANUAL_TEXT;
  ov.appendChild(panel([label("Manual — Model & File Requirements"), manualBody]));

  function saveAll() {
    ctx.persist();
    saveConfig({
      save_subfolder: state.saveSubfolder || "",
      output_mode_visible: visChk.checked,
      selected_model: state.model || "",
      selected_text_encoder: state.textEncoder || "",
      selected_vae: state.vae || "",
      negative_prompt: state.negativePrompt || "",
    });
    saveAllBtn.textContent = "✓ Saved!";
    setTimeout(() => (saveAllBtn.textContent = "💾 Save All"), 1500);
  }

  getConfig()
    .then((cfg) => {
      // 모델/LoRA 선택값은 서버(ComfyUI 백엔드)가 기준 — 여러 기기/브라우저에서 동일한 값을 보도록
      // 로컬(localStorage) 값보다 서버 값을 우선 적용한다.
      if (cfg.selected_model) state.model = cfg.selected_model;
      if (cfg.selected_text_encoder) state.textEncoder = cfg.selected_text_encoder;
      if (cfg.selected_vae) state.vae = cfg.selected_vae;
      if (cfg.negative_prompt && !state.negativePrompt?.trim()) { state.negativePrompt = cfg.negative_prompt; negTA.value = cfg.negative_prompt; }
      if (cfg.save_subfolder && !state.saveSubfolder) { state.saveSubfolder = cfg.save_subfolder; pathIn.value = cfg.save_subfolder; }
      visChk.checked = cfg.output_mode_visible !== false;
      ctx.appConfig.output_mode_visible = visChk.checked;
      ctx.onOutputVisibilityChanged?.();
      ctx.persist();
      return getModels().then((d) => {
        rebuildModels(d);
        ctx.availableLoras = d.loras || [];
        ctx.onModelsRefreshed?.();
      });
    })
    .catch(() => {});

  const tabs = tabSettings(ov, { brand: TAB_BRAND, bg: C.bg2, border: C.border, nodeKey: "moss" });
  return {
    el: ov,
    show() { ov.style.display = "flex"; },
    showTab(name: string) { tabs.show(name); ov.style.display = "flex"; },
    hide() { ov.style.display = "none"; },
  };
}
