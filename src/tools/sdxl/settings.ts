// settings.ts — SDXL Settings 오버레이. 원본 근거: web/sdxl/ui_app_settings_sdxl.js.
// Checkpoint 모드(단일 ckpt)와 Separate 모드(UNet+DualCLIP+VAE)를 토글하고, 두 모드 모두에서
// 공용으로 Refiner Checkpoint를 선택할 수 있다 — Klein/Qwen2511에는 없는 SDXL 고유 UI.
import type { SDXLState, ModelLoaderMode } from "./core";
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
}

export function createSettingsOverlay(state: SDXLState, ctx: SettingsCtx) {
  const ov = el("div", {
    style: {
      position: "absolute", inset: "0", zIndex: "60",
      background: "rgba(11,11,11,0.97)", borderRadius: "inherit",
      display: "none", flexDirection: "column", padding: "12px", gap: "8px",
      boxSizing: "border-box", overflowY: "auto",
    },
  });

  const topRow = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" } });
  topRow.appendChild(el("div", { text: "⚙ Settings — SDXL", style: { color: "#ffffff", fontSize: "14px", fontWeight: "700", flex: "1" } }));
  const saveAllBtn = button("💾 Save All", () => saveAll(), "primary");
  const closeBtn = button("✕", () => (ov.style.display = "none"), "danger");
  topRow.append(saveAllBtn, closeBtn);
  ov.appendChild(topRow);

  // ── Model Loading Mode ───────────────────────────────────────────────────
  const modeRow = el("div", { style: { display: "flex", gap: "8px", flexShrink: "0" } });
  ov.appendChild(panel([label("Model Loading Mode"), modeRow]));

  function renderModeRow() {
    modeRow.innerHTML = "";
    (["checkpoint", "separate"] as ModelLoaderMode[]).forEach((mode) => {
      const active = state.modelLoaderMode === mode;
      const lbl = mode === "checkpoint" ? "📦 Checkpoint" : "🔧 UNet + DualCLIP + VAE";
      const btn = el("button", {
        type: "button", text: lbl,
        style: { flex: "1", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "8px 12px", borderRadius: "6px", background: active ? BRAND : C.bg2, color: active ? "#fff" : C.text, border: `1px solid ${active ? BRAND : C.border}`, fontWeight: active ? "700" : "400" },
        onclick: () => { state.modelLoaderMode = mode; ctx.persist(); renderModeRow(); rebuildModelSection(); },
      });
      modeRow.appendChild(btn);
    });
  }
  renderModeRow();

  // ── Model section (dynamic) ──────────────────────────────────────────────
  const modelSection = el("div");
  ov.appendChild(modelSection);
  let _modelData: { checkpoints?: string[]; unets?: string[]; text_encoders?: string[]; vaes?: string[]; loras?: string[] } = {};

  function rebuildModelSection() {
    modelSection.innerHTML = "";
    if (state.modelLoaderMode === "checkpoint") buildCheckpointSection();
    else buildSeparateSection();
  }

  function buildCheckpointSection() {
    const ckpts = ["none", ...(_modelData.checkpoints || [])];
    const refiners = ["none", ...(_modelData.checkpoints || [])];
    const ckptSel = searchableSelect(ckpts, state.checkpoint || "none", (v) => { state.checkpoint = v; ctx.persist(); });
    const refinerSel = searchableSelect(refiners, state.refinerCheckpoint || "none", (v) => { state.refinerCheckpoint = v; ctx.persist(); });
    const refTog = el("input", { type: "checkbox" }) as HTMLInputElement;
    refTog.checked = !!state.useRefiner;
    refTog.addEventListener("change", () => { state.useRefiner = refTog.checked; ctx.persist(); });

    modelSection.appendChild(panel([
      col([label("Checkpoint"), ckptSel.el]),
      el("div", { style: { marginTop: "6px", display: "flex", alignItems: "center", gap: "6px" } }, [refTog, el("span", { text: "Use Refiner", style: { color: C.text, fontSize: "12px" } })]),
      el("div", { style: { marginTop: "4px" } }, [col([label("Refiner Checkpoint"), refinerSel.el])]),
      el("div", { style: { fontSize: "10px", color: C.muted, marginTop: "4px" }, html: "Model → <code>models/checkpoints/</code>" }),
    ]));
  }

  function buildSeparateSection() {
    const diff = ["none", ...(_modelData.unets || [])];
    const te = ["none", ...(_modelData.text_encoders || [])];
    const vaes = ["none", ...(_modelData.vaes || [])];
    const refiners = ["none", ...(_modelData.checkpoints || [])];
    const unetSel = searchableSelect(diff, state.unet || "none", (v) => { state.unet = v; ctx.persist(); });
    const clipLSel = searchableSelect(te, state.clipL || "none", (v) => { state.clipL = v; ctx.persist(); });
    const clipGSel = searchableSelect(te, state.clipG || "none", (v) => { state.clipG = v; ctx.persist(); });
    const vaeSel = searchableSelect(vaes, state.vae || "none", (v) => { state.vae = v; ctx.persist(); });
    const refinerSel = searchableSelect(refiners, state.refinerCheckpoint || "none", (v) => { state.refinerCheckpoint = v; ctx.persist(); });
    const refTog = el("input", { type: "checkbox" }) as HTMLInputElement;
    refTog.checked = !!state.useRefiner;
    refTog.addEventListener("change", () => { state.useRefiner = refTog.checked; ctx.persist(); });

    modelSection.appendChild(panel([
      row([col([label("UNet (diffusion model)"), unetSel.el]), col([label("VAE"), vaeSel.el])]),
      row([col([label("CLIP-L (text_encoder_1)"), clipLSel.el]), col([label("CLIP-G (text_encoder_2)"), clipGSel.el])]),
      el("div", { style: { fontSize: "10px", color: C.muted, marginTop: "4px" }, html: "UNet → <code>models/diffusion_models/</code> · CLIP → <code>models/text_encoders/</code> · VAE → <code>models/vae/</code>" }),
      el("div", { style: { marginTop: "8px", display: "flex", alignItems: "center", gap: "6px" } }, [refTog, el("span", { text: "Use Refiner (Checkpoint)", style: { color: C.text, fontSize: "12px" } })]),
      el("div", { style: { marginTop: "4px" } }, [col([label("Refiner Checkpoint"), refinerSel.el])]),
      el("div", { style: { fontSize: "10px", color: C.muted, marginTop: "4px" }, html: "Refiner → <code>models/checkpoints/</code>" }),
    ]));
  }

  const refreshBtn = button("↻ Refresh Models", async () => {
    refreshBtn.textContent = "Loading…";
    try {
      const d = await getModels();
      _modelData = d;
      ctx.availableLoras = d.loras || [];
      ctx.onModelsRefreshed?.();
      rebuildModelSection();
    } finally {
      refreshBtn.textContent = "↻ Refresh Models";
    }
  });
  ov.appendChild(refreshBtn);

  // ── Refiner step fraction ─────────────────────────────────────────────────
  const fracIn = el("input", { type: "number", min: "0.1", max: "0.99", step: "0.05", style: { width: "80px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px", fontSize: "12px", fontFamily: "inherit" } }) as HTMLInputElement;
  fracIn.value = String(state.refinerStepFrac ?? 0.8);
  fracIn.addEventListener("input", () => { state.refinerStepFrac = parseFloat(fracIn.value) || 0.8; ctx.persist(); });
  ov.appendChild(panel([
    label("Refiner Step Fraction (T2I — base uses this % of steps)"),
    el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } }, [fracIn, el("span", { text: "e.g. 0.8 = first 80% base, last 20% refiner", style: { color: C.muted, fontSize: "11px" } })]),
  ]));

  const negTA = el("textarea", { placeholder: "Negative prompt…", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px", fontSize: "12px", fontFamily: "inherit", resize: "vertical", outline: "none", minHeight: "60px" } }) as HTMLTextAreaElement;
  negTA.value = state.negativePrompt || "";
  negTA.addEventListener("input", () => (state.negativePrompt = negTA.value));
  ov.appendChild(panel([label("Negative Prompt (global default)"), negTA]));

  const suffixIn = el("input", { type: "text", placeholder: "e.g. masterpiece, best quality, ultra detailed", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px", fontSize: "12px", fontFamily: "inherit" } }) as HTMLInputElement;
  suffixIn.value = state.promptSuffix || "";
  suffixIn.addEventListener("input", () => (state.promptSuffix = suffixIn.value));
  ov.appendChild(panel([label("Prompt Suffix (auto-appended)"), suffixIn]));

  const pathIn = el("input", { type: "text", placeholder: SUBFOLDER, style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px", fontSize: "12px", fontFamily: "inherit" } }) as HTMLInputElement;
  pathIn.value = state.saveSubfolder || "";
  pathIn.addEventListener("input", () => (state.saveSubfolder = pathIn.value.trim()));

  const visChk = el("input", { type: "checkbox" }) as HTMLInputElement;
  visChk.checked = ctx.appConfig.output_mode_visible !== false;
  const visLbl = el("label", { style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: C.text } }, [visChk, el("span", { text: "Show Save / Preview toggle in main view" })]);
  visChk.addEventListener("change", () => { ctx.appConfig.output_mode_visible = visChk.checked; ctx.onOutputVisibilityChanged?.(); });
  ov.appendChild(panel([label("Save Folder (inside output/)"), pathIn, visLbl]));

  function saveAll() {
    state.negativePrompt = negTA.value;
    state.promptSuffix = suffixIn.value;
    state.saveSubfolder = pathIn.value;
    ctx.persist();
    saveConfig({
      selected_checkpoint: state.checkpoint || "",
      selected_refiner: state.refinerCheckpoint || "",
      selected_unet: state.unet || "",
      selected_clip_l: state.clipL || "",
      selected_clip_g: state.clipG || "",
      selected_vae: state.vae || "",
      model_loader_mode: state.modelLoaderMode || "checkpoint",
      negative_prompt: state.negativePrompt || "",
      prompt_suffix: state.promptSuffix || "",
      save_subfolder: state.saveSubfolder || "",
      output_mode_visible: visChk.checked,
    });
    saveAllBtn.textContent = "✓ Saved!";
    setTimeout(() => (saveAllBtn.textContent = "💾 Save All"), 1500);
  }

  rebuildModelSection();

  getConfig()
    .then((cfg) => {
      if (!cfg) return;
      // 모델/LoRA 선택값은 서버(ComfyUI 백엔드)가 기준 — 여러 기기/브라우저에서 동일한 값을 보도록
      // 로컬(localStorage) 값보다 서버 값을 우선 적용한다.
      if (cfg.selected_checkpoint) state.checkpoint = cfg.selected_checkpoint;
      if (cfg.selected_refiner) state.refinerCheckpoint = cfg.selected_refiner;
      if (cfg.selected_unet) state.unet = cfg.selected_unet;
      if (cfg.selected_clip_l) state.clipL = cfg.selected_clip_l;
      if (cfg.selected_clip_g) state.clipG = cfg.selected_clip_g;
      if (cfg.selected_vae) state.vae = cfg.selected_vae;
      if (cfg.model_loader_mode) { state.modelLoaderMode = cfg.model_loader_mode; renderModeRow(); }
      if (cfg.negative_prompt && !state.negativePrompt) { state.negativePrompt = cfg.negative_prompt; negTA.value = cfg.negative_prompt; }
      if (cfg.prompt_suffix && !state.promptSuffix) { state.promptSuffix = cfg.prompt_suffix; suffixIn.value = cfg.prompt_suffix; }
      if (cfg.save_subfolder && !state.saveSubfolder) pathIn.placeholder = cfg.save_subfolder;
      visChk.checked = cfg.output_mode_visible !== false;
      ctx.appConfig.output_mode_visible = visChk.checked;
      ctx.onOutputVisibilityChanged?.();
      ctx.persist();
      return getModels().then((d) => {
        _modelData = d;
        ctx.availableLoras = d.loras || [];
        ctx.onModelsRefreshed?.();
        rebuildModelSection();
      });
    })
    .catch(() => {});

  return {
    el: ov,
    show() { ov.style.display = "flex"; },
    hide() { ov.style.display = "none"; },
  };
}
