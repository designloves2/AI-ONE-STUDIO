// settings.ts — QWEN IMAGE 2.1 Settings 오버레이.
// 원본 근거: web/one_node_qwen21.js의 createSettingsOverlay. 2511과 달리 Lightning/Angle LoRA
// 섹션이 없고 대신 Cache(QwenImage21Cache)/Sage Attention 토글이 있다. Diffusion/Text Encoder/VAE
// 드롭다운은 파일명 필터링을 하지 않는다(원본 주석: "qwen3vl"/"qwen" 필터링은 실제 버그였다 —
// 이름을 바꾼 파일을 못 고르는 문제). Model Override / Language 셀렉터는 이 웹앱이 LiteGraph
// 노드가 아니라서 2511 포팅 때와 동일하게 옮기지 않는다(그 파일에 이미 그 전례가 있다).
import type { Q21State } from "./core";
import { C, el, SUBFOLDER } from "./core";
import { panel, label, button, row, col, searchableSelect } from "../../shared/ui";
import { getModels, getConfig, saveConfig } from "./api";

export interface SettingsCtx {
  persist: () => void;
  availableLoras: string[];
  onModelsRefreshed?: () => void;
  onCacheOrSageChange?: () => void;
}

export function createSettingsOverlay(state: Q21State, ctx: SettingsCtx) {
  const ov = el("div", {
    style: {
      position: "absolute", inset: "0", zIndex: "60",
      background: "rgba(11,11,11,0.97)", borderRadius: "inherit",
      display: "none", flexDirection: "column", padding: "12px", gap: "8px",
      boxSizing: "border-box", overflowY: "auto",
    },
  });

  const topRow = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" } });
  topRow.appendChild(el("div", { text: "⚙ Settings — QWEN IMAGE 2.1 ONE STUDIO (TJ)", style: { color: "#ffffff", fontSize: "14px", fontWeight: "700", flex: "1" } }));
  const saveAllBtn = button("💾 Save All", () => saveAll(), "primary");
  const closeBtn = button("✕", () => (ov.style.display = "none"), "danger");
  topRow.append(saveAllBtn, closeBtn);
  ov.appendChild(topRow);

  const modelWrap = el("div"), teWrap = el("div"), vaeWrap = el("div");
  let modelSel: ReturnType<typeof searchableSelect>, teSel: ReturnType<typeof searchableSelect>, vaeSel: ReturnType<typeof searchableSelect>;

  function rebuildModels(data: { diffusion_models?: string[]; gguf?: string[]; text_encoders?: string[]; vaes?: string[] }) {
    [modelWrap, teWrap, vaeWrap].forEach((w) => (w.innerHTML = ""));
    const diff = ["none", ...(data.diffusion_models || []), ...(data.gguf || [])];
    const te = ["none", ...(data.text_encoders || [])];
    const vaes = ["none", ...(data.vaes || [])];
    if ((data.diffusion_models?.length || data.gguf?.length) && !diff.includes(state.model)) state.model = "none";
    if (data.text_encoders?.length && !te.includes(state.textEncoder)) state.textEncoder = "none";
    if (data.vaes?.length && !vaes.includes(state.vae)) state.vae = "none";
    modelSel = searchableSelect(diff, state.model, (v) => { state.model = v; ctx.persist(); });
    teSel = searchableSelect(te, state.textEncoder, (v) => { state.textEncoder = v; ctx.persist(); });
    vaeSel = searchableSelect(vaes, state.vae, (v) => { state.vae = v; ctx.persist(); });
    modelWrap.appendChild(col([label("Diffusion Model (UNETLoader)"), modelSel.el]));
    teWrap.appendChild(col([label("Text Encoder (Qwen3-VL)"), teSel.el]));
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
  const modelNote = el("div", { style: { fontSize: "10px", color: C.muted, marginTop: "-4px" } });
  modelNote.innerHTML = "Model → <code>models/diffusion_models/</code> · Text Encoder → <code>models/text_encoders/</code> · VAE → <code>models/vae/</code>";
  ov.appendChild(panel([el("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } }, [row([modelWrap, teWrap, vaeWrap]), modelNote, refreshBtn])]));

  // ── Cache / Sage Attention 토글 ────────────────────────────────────────────
  const cacheBtn = button(state.useCache !== false ? "Cache: ON" : "Cache: OFF", () => {
    state.useCache = state.useCache === false;
    ctx.persist();
    cacheBtn.textContent = state.useCache !== false ? "Cache: ON" : "Cache: OFF";
    ctx.onCacheOrSageChange?.();
  });
  const sageBtn = button(state.useSageAttention ? "Sage Attention: ON" : "Sage Attention: OFF", () => {
    state.useSageAttention = !state.useSageAttention;
    ctx.persist();
    sageBtn.textContent = state.useSageAttention ? "Sage Attention: ON" : "Sage Attention: OFF";
    ctx.onCacheOrSageChange?.();
  });
  ov.appendChild(panel([row([cacheBtn]), row([sageBtn])]));

  const negTA = el("textarea", { placeholder: "Negative prompt…", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px", fontSize: "12px", fontFamily: "inherit", resize: "vertical", outline: "none", minHeight: "60px" } }) as HTMLTextAreaElement;
  negTA.value = state.negativePrompt || "";
  negTA.addEventListener("input", () => (state.negativePrompt = negTA.value));
  ov.appendChild(panel([label("Negative Prompt"), negTA]));

  const pathIn = el("input", { type: "text", placeholder: SUBFOLDER, style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px", fontSize: "12px", fontFamily: "inherit" } }) as HTMLInputElement;
  pathIn.value = state.saveSubfolder || "";
  pathIn.addEventListener("input", () => (state.saveSubfolder = pathIn.value.trim()));
  ov.appendChild(panel([label("Save Subfolder (optional)"), pathIn]));

  const suffixIn = el("input", { type: "text", placeholder: "e.g. high quality, sharp focus", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px", fontSize: "12px", fontFamily: "inherit" } }) as HTMLInputElement;
  suffixIn.value = state.promptSuffix || "";
  suffixIn.addEventListener("input", () => (state.promptSuffix = suffixIn.value));
  ov.appendChild(panel([label("Prompt Suffix (auto-appended for quality boost)"), suffixIn]));

  function saveAll() {
    ctx.persist();
    saveConfig({
      save_subfolder: state.saveSubfolder || "",
      selected_model: state.model || "",
      selected_text_encoder: state.textEncoder || "",
      selected_vae: state.vae || "",
      negative_prompt: state.negativePrompt || "",
      prompt_suffix: state.promptSuffix || "",
    });
    saveAllBtn.textContent = "✓ Saved!";
    setTimeout(() => (saveAllBtn.textContent = "💾 Save All"), 1500);
  }

  // 초기 로드 — 서버(ComfyUI 백엔드)의 마지막 저장값이 기준. 여러 기기/브라우저에서 같은 값을
  // 보도록 로컬(localStorage) 값보다 서버 값을 우선 적용한다 (2511과 동일 패턴).
  getConfig()
    .then((cfg) => {
      if (cfg.selected_model) state.model = cfg.selected_model;
      if (cfg.selected_text_encoder) state.textEncoder = cfg.selected_text_encoder;
      if (cfg.selected_vae) state.vae = cfg.selected_vae;
      if (cfg.negative_prompt && !state.negativePrompt) { state.negativePrompt = cfg.negative_prompt; negTA.value = cfg.negative_prompt; }
      if (cfg.prompt_suffix && !state.promptSuffix) { state.promptSuffix = cfg.prompt_suffix; suffixIn.value = cfg.prompt_suffix; }
      if (cfg.save_subfolder && !state.saveSubfolder) { state.saveSubfolder = cfg.save_subfolder; pathIn.value = cfg.save_subfolder; }
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
