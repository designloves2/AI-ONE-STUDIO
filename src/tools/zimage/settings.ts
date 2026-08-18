// settings.ts — Z-Image Settings 오버레이 (모델 선택 + negative/suffix/저장 폴더).
// 원본 근거: web/zimage/ui_app_settings.js — Krea2와 달리 ControlNet/Identity LoRA 슬롯이 없다
// (그건 각각 CONTROLNET/FACE REDRAW 모드 좌측 패널에 있음 — Phase 2에서 이식 예정).
import type { ZImageState } from "./core";
import { C, el, SUBFOLDER } from "./core";
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
}

export function createSettingsOverlay(state: ZImageState, ctx: SettingsCtx) {
  const ov = el("div", {
    style: {
      position: "absolute", inset: "0", zIndex: "60",
      background: "rgba(11,11,11,0.97)", borderRadius: "inherit",
      display: "none", flexDirection: "column", padding: "12px", gap: "8px",
      boxSizing: "border-box", overflowY: "auto",
    },
  });

  const topRow = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" } });
  topRow.appendChild(el("div", { text: "⚙ Settings — Z-Image Turbo", style: { color: "#ffffff", fontSize: "14px", fontWeight: "700", flex: "1" } }));
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
    modelWrap.appendChild(col([label("Diffusion Model (UNet)"), modelSel.el]));
    teWrap.appendChild(col([label("Text Encoder (CLIP)"), teSel.el]));
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
    } finally {
      refreshBtn.textContent = "↻ Refresh Models";
    }
  });
  ov.appendChild(panel([el("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } }, [row([modelWrap, teWrap, vaeWrap]), refreshBtn])]));

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
      // 모델/LoRA 선택값은 서버(ComfyUI 백엔드)가 기준 — 여러 기기/브라우저에서 동일한 값을 보도록
      // 로컬(localStorage) 값보다 서버 값을 우선 적용한다.
      if (cfg.selected_model) state.model = cfg.selected_model;
      if (cfg.selected_text_encoder) state.textEncoder = cfg.selected_text_encoder;
      if (cfg.selected_vae) state.vae = cfg.selected_vae;
      if (cfg.negative_prompt && !state.negativePrompt) { state.negativePrompt = cfg.negative_prompt; negTA.value = cfg.negative_prompt; }
      if (cfg.prompt_suffix && !state.promptSuffix) { state.promptSuffix = cfg.prompt_suffix; suffixIn.value = cfg.prompt_suffix; }
      if (cfg.save_subfolder && !state.saveSubfolder) pathIn.placeholder = cfg.save_subfolder;
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

  return {
    el: ov,
    show() { ov.style.display = "flex"; },
    hide() { ov.style.display = "none"; },
  };
}
