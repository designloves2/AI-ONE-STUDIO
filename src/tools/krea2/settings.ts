// settings.ts — Krea2 Settings 오버레이 (모델/ControlNet LoRA/Identity LoRA/저장 폴더 등).
// 원본 근거: web/krea2/ui_app_settings_krea2.js
import type { Krea2State } from "./core";
import { C, el, SUBFOLDER, safeDepthCkpt } from "./core";
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

export function createSettingsOverlay(state: Krea2State, ctx: SettingsCtx) {
  const ov = el("div", {
    style: {
      position: "absolute", inset: "0", zIndex: "60",
      background: "rgba(11,11,11,0.97)", borderRadius: "inherit",
      display: "none", flexDirection: "column", padding: "12px", gap: "8px",
      boxSizing: "border-box", overflowY: "auto",
    },
  });

  const topRow = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" } });
  topRow.appendChild(el("div", { text: "⚙ Settings — Krea 2", style: { color: "#ffffff", fontSize: "14px", fontWeight: "700", flex: "1" } }));
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
    teWrap.appendChild(col([label("Text Encoder (CLIP krea2)"), teSel.el]));
    vaeWrap.appendChild(col([label("VAE"), vaeSel.el]));
  }
  rebuildModels({});

  const refreshBtn = button("↻ Refresh Models", async () => {
    refreshBtn.textContent = "Loading…";
    try {
      const d = await getModels();
      rebuildModels(d);
      ctx.availableLoras = d.loras || [];
      rebuildControlNet(d.loras || []);
      rebuildIdentity(d.loras || []);
      ctx.onModelsRefreshed?.();
    } finally {
      refreshBtn.textContent = "↻ Refresh Models";
    }
  });

  ov.appendChild(panel([el("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } }, [row([modelWrap, teWrap, vaeWrap]), refreshBtn])]));

  // ── ControlNet LoRA files ─────────────────────────────────────────────────
  const cnDepthWrap = el("div"), cnCannyWrap = el("div");
  function rebuildControlNet(loras: string[]) {
    [cnDepthWrap, cnCannyWrap].forEach((w) => (w.innerHTML = ""));
    const opts = ["none", ...(loras || []).filter((n) => n !== "none")];
    if (loras?.length && !opts.includes(state.controlLoraDepth)) state.controlLoraDepth = "none";
    if (loras?.length && !opts.includes(state.controlLoraCanny)) state.controlLoraCanny = "none";
    const depthSel = searchableSelect(opts, state.controlLoraDepth, (v) => { state.controlLoraDepth = v; ctx.persist(); });
    const cannySel = searchableSelect(opts, state.controlLoraCanny, (v) => { state.controlLoraCanny = v; ctx.persist(); });
    cnDepthWrap.appendChild(col([label("Depth Control LoRA"), depthSel.el]));
    cnCannyWrap.appendChild(col([label("Canny Control LoRA"), cannySel.el]));
  }
  rebuildControlNet([]);
  state.depthCkpt = safeDepthCkpt(state.depthCkpt);

  const cnHint = el("div", { style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } });
  cnHint.innerHTML =
    "LoRA 파일을 여기서 한 번만 등록. Depth/Canny 세기·모델 등 튜닝값은 좌측 CONTROLNET 패널에서 조정.<br>" +
    "<b>Depth</b>: Krea2 Control LoRA + DepthAnythingV2Preprocessor.<br><b>Canny</b>: NK2E in-context edit + CannyEdgePreprocessor.";
  ov.appendChild(panel([label("ControlNet — LoRA 파일 (1회 등록)"), row([cnDepthWrap, cnCannyWrap]), cnHint]));

  // ── Identity LoRA ────────────────────────────────────────────────────────
  const idLoraWrap = el("div");
  function rebuildIdentity(loras: string[]) {
    idLoraWrap.innerHTML = "";
    const opts = ["none", ...(loras || []).filter((n) => n !== "none")];
    if (loras?.length && !opts.includes(state.identityLora)) state.identityLora = "none";
    const sel = searchableSelect(opts, state.identityLora, (v) => { state.identityLora = v; ctx.persist(); });
    idLoraWrap.appendChild(col([label("Identity Edit LoRA"), sel.el]));
  }
  rebuildIdentity([]);
  const idStrIn = el("input", { type: "number", step: "0.05", min: "0", max: "2", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px", fontSize: "12px", fontFamily: "inherit", outline: "none" } });
  idStrIn.value = String(state.identityLoraStrength ?? 1.0);
  idStrIn.addEventListener("input", () => { const v = parseFloat(idStrIn.value); state.identityLoraStrength = isNaN(v) ? 1.0 : v; ctx.persist(); });
  ov.appendChild(panel([label("Identity Edit — LoRA (1회 설정)"), idLoraWrap, row([col([label("LoRA Strength"), idStrIn]), col([el("div")])])]));

  // ── Negative prompt / suffix / save folder ───────────────────────────────────
  // 원본 Krea2는 negative 프롬프트가 없고 항상 ConditioningZeroOut을 쓰지만, 사용자 요청으로
  // 실제 negative 텍스트 입력을 추가했다 — 비어 있으면 그래프가 원본과 동일하게 ConditioningZeroOut으로 폴백한다.
  const negTA = el("textarea", { placeholder: "Negative prompt… (비워두면 Krea2 기본 방식(ConditioningZeroOut) 사용)", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px", fontSize: "12px", fontFamily: "inherit", resize: "vertical", outline: "none", minHeight: "60px" } });
  negTA.value = state.negativePrompt || "";
  negTA.addEventListener("input", () => (state.negativePrompt = negTA.value));
  ov.appendChild(panel([label("Negative Prompt"), negTA]));

  const suffixIn = el("input", { type: "text", placeholder: "e.g. high quality, sharp focus", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px", fontSize: "12px", fontFamily: "inherit" } });
  suffixIn.value = state.promptSuffix || "";
  suffixIn.addEventListener("input", () => (state.promptSuffix = suffixIn.value));
  ov.appendChild(panel([label("Prompt Suffix"), suffixIn]));

  const pathIn = el("input", { type: "text", placeholder: SUBFOLDER, style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px", fontSize: "12px", fontFamily: "inherit" } });
  pathIn.value = state.saveSubfolder || "";
  pathIn.addEventListener("input", () => (state.saveSubfolder = pathIn.value.trim()));

  // ── Output 토글 표시 여부 (메인 화면의 Save/Preview 셀렉트를 숨길지) ────────────
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
      control_lora_depth: state.controlLoraDepth || "none",
      control_lora_canny: state.controlLoraCanny || "none",
      depth_ckpt: state.depthCkpt || "depth_anything_v2_vitl.pth",
      identity_lora: state.identityLora || "none",
      identity_lora_strength: state.identityLoraStrength ?? 1.0,
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
      if (cfg.control_lora_depth && cfg.control_lora_depth !== "none") state.controlLoraDepth = cfg.control_lora_depth;
      if (cfg.control_lora_canny && cfg.control_lora_canny !== "none") state.controlLoraCanny = cfg.control_lora_canny;
      if (cfg.depth_ckpt) state.depthCkpt = safeDepthCkpt(cfg.depth_ckpt);
      if (cfg.identity_lora && cfg.identity_lora !== "none") state.identityLora = cfg.identity_lora;
      if (cfg.identity_lora_strength != null) { state.identityLoraStrength = cfg.identity_lora_strength; idStrIn.value = String(state.identityLoraStrength); }
      if (cfg.save_subfolder && !state.saveSubfolder) pathIn.placeholder = cfg.save_subfolder;
      visChk.checked = cfg.output_mode_visible !== false;
      ctx.appConfig.output_mode_visible = visChk.checked;
      ctx.onOutputVisibilityChanged?.();
      ctx.persist();
      return getModels().then((d) => {
        rebuildModels(d);
        ctx.availableLoras = d.loras || [];
        rebuildControlNet(d.loras || []);
        rebuildIdentity(d.loras || []);
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
