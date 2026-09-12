// settings.ts — MiniMax H3 Settings 오버레이 (원본: web/minimax/ui_app_settings_minimax.js)
// 탭: Models · Sampling · Preview · Output. 여기서 정한 값은 매 실행에 재사용되고,
// 실행마다 바뀌는 값(steps, accel 등)은 좌측 패널에 남아있다 — 원본과 동일한 구분.
import type { MinimaxState } from "./core";
import { SUBFOLDER } from "./core";
import { button, checkboxRow, clear, col, el, label, panel, row, searchableSelect } from "../../shared/ui";
import { fetchOrModels, pushLlmConfig, fetchLlmKeyHint } from "../../shared/llmBackendPanel";
import { C, BRAND } from "../../identity";
import { buildDepFix } from "./depBanner";
import {
  getConfig,
  getModels,
  getNodeAvailability,
  getPreviewTinyVaeOptions,
  listVideos,
  saveConfig,
  type ModelLists,
  type NodeAvailability,
} from "./api";

export interface SettingsCtx {
  persist: () => void;
  showPopup: (msg: string, isError?: boolean) => void;
  refreshPlan?: () => void;
  refreshModes?: () => void;
  availability?: Record<string, boolean>;
  availabilityInfo?: NodeAvailability;
  availableModels?: ModelLists;
  _rerenderImages?: () => void;
  audioFiles?: string[];
  missingAssets?: Set<string>;
}

export interface SettingsHandle {
  el: HTMLElement;
  show(): void;
  hide(): void;
}

export function createSettingsOverlay(state: MinimaxState, ctx: SettingsCtx): SettingsHandle {
  const ov = el("div", {
    class: "fixed inset-0 z-[9998] flex-col p-3 gap-2 box-border",
    style: { display: "none", background: "rgba(11,11,11,0.97)" },
  });

  const topRow = el("div", { class: "relative flex items-center gap-2 shrink-0" });
  topRow.appendChild(el("div", { text: "⚙ Settings — MiniMax H3 ONE STUDIO (TJ)", class: "text-white text-sm font-bold flex-1" }));
  // Third-party pack status — 타이틀 바 정중앙에 절대 위치로 배치.
  const packStatusText = el("div", {
    class: "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] whitespace-nowrap",
    style: { color: C.muted },
  });
  topRow.appendChild(packStatusText);
  const saveAllBtn = button("💾 Save All", () => saveAll(), "primary");
  topRow.appendChild(saveAllBtn);
  topRow.appendChild(button("✕", () => (ov.style.display = "none"), "danger"));
  ov.appendChild(topRow);

  function refreshPackStatusText() {
    const missing = availability.missing_optional || [];
    const missCore = availability.missing_core || [];
    if (missCore.length) {
      packStatusText.textContent = `⛔ Required nodes missing (${missCore.length}) — see Third-party pack status`;
      packStatusText.style.color = C.err;
    } else if (missing.length) {
      packStatusText.textContent = `⚠ Not installed: ${missing.join(", ")}`;
      packStatusText.style.color = C.warn;
    } else {
      packStatusText.textContent = "✓ All optional acceleration / preview / upscale packs are installed.";
      packStatusText.style.color = C.ok;
    }
  }

  // "Third-party pack status" — mirrors the node pack's Settings panel. Lists
  // missing core / optional nodes and names the setup script to run. No in-app
  // installer (see depBanner.ts).
  function packStatusTab() {
    const wrap = el("div", { class: "flex flex-col gap-2" });
    const missing = availability.missing_optional || [];
    const missCore = availability.missing_core || [];
    const note = el("div", { style: { fontSize: "10px", lineHeight: "1.6", color: (missing.length || missCore.length) ? C.warn : C.ok } });
    note.innerHTML = (missing.length || missCore.length)
      ? (missCore.length ? `⛔ Required nodes missing — MiniMax H3 cannot render: <code>${missCore.join("</code>, <code>")}</code><br>` : "")
        + (missing.length ? `⚠ Not installed — the matching feature stays off: <code>${missing.join("</code>, <code>")}</code>` : "")
      : "✓ All optional acceleration / preview / upscale packs are installed.";
    const kids: (Node | null)[] = [note];
    const fix = buildDepFix(availability);
    if (fix) kids.push(fix);
    wrap.appendChild(panel(kids));
    return wrap;
  }

  // 화면이 넓으니 탭으로 하나씩 전환하는 대신 좌/우 2컬럼으로 동시에 보여준다:
  // 왼쪽 = Models + Sampling, 오른쪽 = Preview + Output.
  const bodyWrap = el("div", { class: "aos-mmh3-settings-body flex-1 overflow-hidden flex gap-3 min-h-0" });
  const leftCol = el("div", { class: "aos-mmh3-settings-col flex-1 overflow-y-auto flex flex-col gap-2 pr-1 min-h-0" });
  const rightCol = el("div", { class: "aos-mmh3-settings-col flex-1 overflow-y-auto flex flex-col gap-2 pr-1 min-h-0" });
  bodyWrap.append(leftCol, rightCol);
  ov.appendChild(bodyWrap);

  function sectionHeading(text: string) {
    return el("div", { text, class: "text-xs font-bold tracking-wide uppercase", style: { color: BRAND, marginTop: "2px" } });
  }

  let modelData: ModelLists = { diffusion_models: [], text_encoders: [], vaes: [], loras: [], upscale_models: [] };
  let availability: NodeAvailability = { ok: false, available: {}, core_ok: false, missing_core: [], missing_optional: [] };

  // ══ H3 Model tab — base render's own unet/clip/vae only ═══════════════════
  function h3ModelTab() {
    const wrap = el("div", { class: "flex flex-col gap-2" });
    const diff = ["none", ...(modelData.diffusion_models || []).filter((x) => x !== "none")];
    // Text Encoder dropdown is GGUF-inclusive — text_encoders_all falls back to text_encoders
    // for backends that don't yet send the wider list (same fallback pattern the LTX section
    // below already uses).
    const te = ["none", ...(modelData.text_encoders_all || modelData.text_encoders || []).filter((x) => x !== "none")];
    const vae = ["none", ...(modelData.vaes || []).filter((x) => x !== "none")];
    const lor = ["none", ...(modelData.loras || []).filter((x) => x !== "none")];
    // Core-native PDD (ComfyUI v0.35.0+) loads the Acc file as a plain model-only LoRA, so it
    // comes from the normal loras list — not the pdd_acc folder the retired pack registered.
    const pdd = ["none", ...(modelData.loras || []).filter((x) => x !== "none")];

    const uFL = searchableSelect(diff, state.unetFirstLast || "none", (v) => { state.unetFirstLast = v; ctx.persist(); ctx.refreshModes?.(); });
    const uRF = searchableSelect(diff, state.unetReference || "none", (v) => { state.unetReference = v; ctx.persist(); ctx.refreshModes?.(); });
    wrap.appendChild(
      panel([
        label("Diffusion Models — the reference workflow keeps these separate on purpose"),
        row([col([label("UNET · First/Last (FL2VA)"), uFL.el]), col([label("UNET · Reference (REF2VA)"), uRF.el])]),
        el("div", { html: "Text-only and First/Last modes use the FL2VA model; Reference mode uses the REF2VA one. → <code>models/diffusion_models/</code>", style: { fontSize: "10px", color: C.muted } }),
      ])
    );

    const cl = searchableSelect(te, state.clipName || "none", (v) => { state.clipName = v; ctx.persist(); });
    const vv = searchableSelect(vae, state.vaeVideo || "none", (v) => { state.vaeVideo = v; ctx.persist(); });
    const va = searchableSelect(vae, state.vaeAudio || "none", (v) => { state.vaeAudio = v; ctx.persist(); });
    wrap.appendChild(
      panel([
        label("Text Encoder & VAEs"),
        col([label("Text Encoder (CLIPLoader type=minimax — .gguf listed too, unverified for H3's own truncated Qwen3-VL)"), cl.el]),
        row([col([label("Video VAE"), vv.el]), col([label("Audio VAE"), va.el])]),
        el("div", { html: "→ <code>models/text_encoders/</code> · <code>models/vae/</code>", style: { fontSize: "10px", color: C.muted } }),
      ])
    );

    const tl = searchableSelect(lor, state.turboLora || "none", (v) => { state.turboLora = v; ctx.persist(); ctx.refreshPlan?.(); });
    const pf = searchableSelect(pdd, state.pddFile || "none", (v) => { state.pddFile = v; ctx.persist(); ctx.refreshPlan?.(); });
    const pfRef = searchableSelect(pdd, state.pddFileReference || "none", (v) => { state.pddFileReference = v; ctx.persist(); ctx.refreshPlan?.(); });
    wrap.appendChild(
      panel([
        label("Model Files"),
        col([label("Turbo LoRA (larryvrh) file"), tl.el]),
        row([col([label("PDD Acc LoRA · First/Last & Text-only (FL2VA)"), pf.el]), col([label("PDD Acc LoRA · Reference (Ref2VA)"), pfRef.el])]),
        el("div", { html: "Core-native since ComfyUI v0.35.0 — pick the ComfyUI-converted file (<code>…_pruned_comfy.safetensors</code>) from <code>models/loras/</code>; the raw alibaba-pai one applies 0 patches. Pairing a file with the wrong UNET is a silent quality failure — keep FL2VA/Ref2VA matched to the generation mode.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
        el("div", {
          text: "Turbo mode, Attention backend/forward, Block Cache, Spectrum, and Model Patches (Fused Modulation/Torch/fp16) moved to the left panel's Pipeline accordion — they're per-run settings now, not fixed config.",
          style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" },
        }),
      ])
    );

    return wrap;
  }

  // ══ UpScale Model tab — plain Upscale model + LTX 2.5 Upscale's own model set ══
  function upscaleModelTab() {
    const wrap = el("div", { class: "flex flex-col gap-2" });
    const diff = ["none", ...(modelData.diffusion_models || []).filter((x) => x !== "none")];
    const vae = ["none", ...(modelData.vaes || []).filter((x) => x !== "none")];
    const ups = ["none", ...(modelData.upscale_models || []).filter((x) => x !== "none")];

    const um = searchableSelect(ups, state.upscaleModel || "none", (v) => { state.upscaleModel = v; ctx.persist(); });
    wrap.appendChild(
      panel([
        label("Upscale"),
        col([label("Upscale Model (used when Upscale = Upscale Model)"), um.el]),
      ])
    );

    // ── LTX 2.5 Upscale mode — its own model set (generationMode "ltxupscale") ──
    const lup = ["none", ...(modelData.latent_upscale_models || []).filter((x) => x !== "none")];
    const lte = ["none", ...(modelData.text_encoders_all || modelData.text_encoders || []).filter((x) => x !== "none")];
    const lxU = searchableSelect(diff, state.ltxUnet || "none", (v) => { state.ltxUnet = v === "none" ? "" : v; ctx.persist(); ctx.refreshModes?.(); });
    const lxLU = searchableSelect(lup, state.ltxLatentUpscaler || "none", (v) => { state.ltxLatentUpscaler = v === "none" ? "" : v; ctx.persist(); ctx.refreshModes?.(); });
    const lxC = searchableSelect(lte, state.ltxClip || "none", (v) => { state.ltxClip = v === "none" ? "" : v; ctx.persist(); ctx.refreshModes?.(); });
    const lxVV = searchableSelect(vae, state.ltxVaeVideo || "none", (v) => { state.ltxVaeVideo = v === "none" ? "" : v; ctx.persist(); ctx.refreshModes?.(); });
    const lxVA = searchableSelect(vae, state.ltxVaeAudio || "none", (v) => { state.ltxVaeAudio = v === "none" ? "" : v; ctx.persist(); ctx.refreshModes?.(); });
    wrap.appendChild(
      panel([
        label("LTX 2.5 Upscale — models for the LTX Upscale generation mode"),
        row([col([label("LTX unet (.gguf or .safetensors)"), lxU.el]), col([label("Latent spatial upscaler (x2)"), lxLU.el])]),
        col([label("Text encoder (.gguf → TJ_LTX25ClipLoaderGGUF; else CLIPLoader type ltxv)"), lxC.el]),
        row([col([label("LTX video VAE"), lxVV.el]), col([label("LTX audio VAE"), lxVA.el])]),
        el("div", { html: "Files: LTX unet → <code>models/diffusion_models/</code> · latent upscaler → <code>models/latent_upscale_models/</code> · "
          + "text encoder → <code>models/text_encoders/</code> · VAEs → <code>models/vae/</code>. The gemma4 GGUF text encoder needs the "
          + "<code>ComfyUI-TJ_NODE</code> pack (<code>TJ_LTX25ClipLoaderGGUF</code>); the int8 safetensors works with core <code>CLIPLoader</code>. "
          + "LTX LoRA(s), the ✨ vision model, and Live Preview are set elsewhere (left panel LoRA list · LLM Setting tab · Preview tab).",
          style: { fontSize: "10px", color: C.muted, lineHeight: "1.6" } }),
      ])
    );

    return wrap;
  }

  // ══ FaceRefine Model tab — face detectors + optional separate unet/clip (§15) ══
  function faceRefineModelTab() {
    const wrap = el("div", { class: "flex flex-col gap-2" });
    const diff = ["none", ...(modelData.diffusion_models || []).filter((x) => x !== "none")];
    const teAll = ["none", ...(modelData.text_encoders_all || modelData.text_encoders || []).filter((x) => x !== "none")];
    const fdList = ["none", ...(modelData.face_detectors || []).filter((x) => x !== "none")];
    const ffList = ["none", ...(modelData.face_fallback_detectors || []).filter((x) => x !== "none")];
    const samList = ["none", ...(modelData.sam_models || []).filter((x) => x !== "none")];
    const cvList = ["none", ...(modelData.clip_vision || []).filter((x) => x !== "none")];

    const kids: (Node | null)[] = [
      label("H3 Face Refine — post-process pass on a finished clip (re-renders a small/distant face)"),
      checkboxRow("Use a separate model for Face Refine (unchecked = share H3's Reference unet/clip above)", !!state.frUseCustomModel, (v) => {
        state.frUseCustomModel = v;
        ctx.persist();
        ctx.refreshModes?.();
        renderBody();
      }),
    ];
    if (state.frUseCustomModel) {
      const fuSel = searchableSelect(diff, state.frUnet || "none", (v) => { state.frUnet = v === "none" ? "" : v; ctx.persist(); ctx.refreshModes?.(); });
      const fcSel = searchableSelect(teAll, state.frClip || "none", (v) => { state.frClip = v === "none" ? "" : v; ctx.persist(); ctx.refreshModes?.(); });
      kids.push(
        row([col([label("Face Refine UNET (.gguf or .safetensors)"), fuSel.el]), col([label("Face Refine text encoder (.gguf or .safetensors)"), fcSel.el])]),
        el("div", {
          text: "Runs on its OWN model instead of H3's Reference unet/clip — e.g. a lighter/faster GGUF quant just for the refine pass. Video/audio VAE are always shared with H3 (above).",
          style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" },
        }),
      );
    } else {
      kids.push(el("div", { text: "Runs H3's own unet/text-encoder/VAE from the H3 Model tab (Reference mode's UNET).", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }));
    }

    const fdSel = searchableSelect(fdList, state.faceDetector || "none", (v) => { state.faceDetector = v === "none" ? "" : v; ctx.persist(); ctx.refreshModes?.(); });
    const ffSel = searchableSelect(ffList, state.faceFallbackDetector || "none", (v) => { state.faceFallbackDetector = v; ctx.persist(); });
    const samSel = searchableSelect(samList, state.faceSamModel || "none", (v) => { state.faceSamModel = v; ctx.persist(); });
    const cvSel = searchableSelect(cvList, state.faceIdentityClipVision || "none", (v) => { state.faceIdentityClipVision = v; ctx.persist(); });
    kids.push(
      row([col([label("Face detector (required)"), fdSel.el]), col([label("Fallback detector (optional — body/person model)"), ffSel.el])]),
      row([col([label("SAM model (optional — face-shaped mask)"), samSel.el]), col([label("Identity CLIP Vision (optional — identity_model=clip_vision)"), cvSel.el])]),
      el("div", {
        html: "Files: face detector → <code>models/ultralytics/bbox/</code> (e.g. face_yolov8m.pt from "
          + "Bingsu/adetailer) · fallback → <code>models/ultralytics/segm/</code> · SAM → "
          + "<code>models/sams/</code> · CLIP Vision → <code>models/clip_vision/</code>. Manual Select "
          + "(Pick Faces) and Impact Pack are not required for the basic ranking-rule modes.",
        style: { fontSize: "10px", color: C.muted, lineHeight: "1.6" },
      }),
    );
    wrap.appendChild(panel(kids));
    return wrap;
  }


  function numInputStyle() {
    return { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px", fontSize: "12px", fontFamily: "inherit", outline: "none" } as Record<string, string>;
  }

  // ══ Sampling tab ════════════════════════════════════════════════════════
  let renderModelPickersInto: HTMLElement | null = null;

  function samplingTab() {
    const wrap = el("div", { class: "flex flex-col gap-2" });
    wrap.appendChild(
      panel([
        label("Image → Brief — LOCAL ENHANCE (native CLIP)"),
        el("div", { text: "Runs through ComfyUI's own model loading — no external server. Ollama support was removed (SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §6): one LLM backend keeps the per-clip override work from getting needlessly complicated.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
        (() => {
          const pickWrap = el("div", { class: "flex flex-col gap-1.5 mt-1.5" });
          renderModelPickersInto = pickWrap;
          return pickWrap;
        })(),
      ])
    );
    renderModelPickers();
    return wrap;
  }

  function renderModelPickers() {
    const wrap2 = renderModelPickersInto;
    if (!wrap2) return;
    clear(wrap2);

    // Brief (writes the prompt — text only) and Vision (reads the reference images — multimodal)
    // each pick their own backend AND model, fully free combination (brief native / vision
    // OpenRouter, or the reverse). Cost + capability differ. OpenRouter key is shared with the
    // image + music nodes (server .env). 원본 근거: ui_app_settings_minimax.js (node b995d8d).
    const selStyle = { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px", fontSize: "12px", fontFamily: "inherit" } as Record<string, string>;

    const missing: string[] = [];
    if (!availability.available?.TJ_MultiImageLoader) missing.push("TJ_MultiImageLoader (TJ_NODE)");
    if (!availability.available?.TextGenerate) missing.push("TextGenerate (ComfyUI core — update ComfyUI)");
    if (!availability.available?.TJStudioOneTextOutput) missing.push("TJStudioOneTextOutput (this package)");
    const clipList = ["none", ...(modelData.text_encoders || []).filter((x) => x !== "none")];

    // full OpenRouter model list with a filter box — no vision-capability filter, the user
    // owns the choice (node 6a6ffb0 / d33aab3). Soft pre-select of gemini-2.5-flash only.
    const orModelSel = (get: () => string, set: (v: string) => void) => {
      const ss = searchableSelect([get() || "loading models…"], get(), (v) => { set(v); ctx.persist(); });
      fetchOrModels().then((ms) => {
        if (!ms.length) return;
        ss.setOptions(ms);
        if (!get()) { set(ms.find((m) => /gemini-2\.5-flash/.test(m)) || ms[0]); ctx.persist(); }
        ss.setValue(get());
      });
      return ss.el;
    };

    // one row: backend select + (native → CLIP picker | openrouter → OR model select)
    const roleRow = (
      roleLabel: string,
      backendGet: () => string, backendSet: (v: string) => void,
      clipGet: () => string, clipSet: (v: string) => void,
      orGet: () => string, orSet: (v: string) => void,
      extraRows?: HTMLElement[],
    ) => {
      const beSel = el("select", { style: selStyle }) as HTMLSelectElement;
      [["native", "Native (ComfyUI CLIP)"], ["openrouter", "OpenRouter (cloud)"]].forEach(([v, t]) => {
        const o = el("option", { value: v, text: t }) as HTMLOptionElement;
        if ((backendGet() || "native") === v) o.selected = true;
        beSel.appendChild(o);
      });
      beSel.addEventListener("change", () => { backendSet(beSel.value); ctx.persist(); renderModelPickers(); });
      const isOR = (backendGet() || "native") === "openrouter";
      const modelCtl = isOR
        ? orModelSel(orGet, orSet)
        : (missing.length
            ? el("div", { text: `⚠ Native needs: ${missing.join(", ")}`, style: { fontSize: "10px", color: C.warn, lineHeight: "1.5" } })
            : searchableSelect(clipList, clipGet() || "none", (v) => { clipSet(v === "none" ? "" : v); ctx.persist(); }).el);
      return col([label(roleLabel), beSel, modelCtl, ...(extraRows || [])]);
    };

    wrap2.append(
      roleRow("Brief — writes the prompt (text only)",
        () => state.h3BriefBackend, (v) => { state.h3BriefBackend = v; pushLlmConfig({ h3_brief_backend: v }); },
        () => state.nativeBriefClip, (v) => (state.nativeBriefClip = v),
        () => state.h3OrModelBrief, (v) => { state.h3OrModelBrief = v; pushLlmConfig({ or_model_text: v }); }),
      roleRow("Vision — reads the reference images (multimodal)",
        () => state.h3VisionBackend, (v) => { state.h3VisionBackend = v; pushLlmConfig({ h3_vision_backend: v }); },
        () => state.nativeVisionClip, (v) => (state.nativeVisionClip = v),
        () => state.h3OrModelVision, (v) => { state.h3OrModelVision = v; pushLlmConfig({ or_model_vision: v }); }),
    );

    // ── LTX Upscale ✨ — its own vision model (reads the source clip's first frame), never
    // inherits an H3 Brief/Vision value. Node 6fe621e.
    wrap2.appendChild(el("div", { style: { borderTop: `1px solid ${C.border}`, margin: "4px 0 2px" } }));
    const ltxInstr = el("textarea", {
      value: state.ltxLlmPrompt || "",
      style: { width: "100%", minHeight: "90px", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px", fontSize: "11px", fontFamily: "inherit", outline: "none", resize: "vertical" },
    }) as HTMLTextAreaElement;
    ltxInstr.addEventListener("input", () => { state.ltxLlmPrompt = ltxInstr.value; ctx.persist(); });
    wrap2.appendChild(
      roleRow("LTX Upscale ✨ — reads the source clip's first frame",
        () => state.ltxVisionBackend, (v) => { state.ltxVisionBackend = v; pushLlmConfig({ ltx_vision_backend: v }); },
        () => state.ltxVisionClip, (v) => (state.ltxVisionClip = v),
        () => state.ltxVisionOrModel, (v) => { state.ltxVisionOrModel = v; pushLlmConfig({ ltx_vision_or_model: v }); },
        [
          col([label("✨ instruction (system prompt)"), ltxInstr]),
          el("div", { text: "The ✨ button in the LTX Upscale prompt area feeds this + the source clip's first frame to the model above. Saved with Save All.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.55" } }),
        ])
    );

    if (state.h3BriefBackend === "openrouter" || state.h3VisionBackend === "openrouter" || state.ltxVisionBackend === "openrouter") {
      const keyIn = el("input", { type: "password", placeholder: "sk-or-… (stored in .env, shared)", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "5px 7px", fontSize: "11px", fontFamily: "inherit" } }) as HTMLInputElement;
      keyIn.addEventListener("blur", () => {
        const v = keyIn.value.trim();
        if (!v || v.includes("*")) return;
        pushLlmConfig({ openrouter_key: v });
        keyIn.value = ""; keyIn.placeholder = "✓ key saved to .env";
      });
      fetchLlmKeyHint().then((h) => { if (h) keyIn.placeholder = h + " — click to replace"; });
      wrap2.appendChild(col([label("OpenRouter API key (shared)"), keyIn]));
    }
    wrap2.appendChild(el("div", { text: "Native runs through TextGenerate on ComfyUI's own model loading (a Qwen3-VL checkpoint works for either role). OpenRouter is cloud — no CLIP load, no queue turn. The two roles are independent.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }));
  }

  // ══ Preview tab ═════════════════════════════════════════════════════════
  function previewTab() {
    const wrap = el("div", { class: "flex flex-col gap-2" });
    const kjOk = !!availability.available?.ModelPreviewOverrideKJ;
    const note = el("div", { style: { fontSize: "10px", lineHeight: "1.6", color: kjOk ? C.muted : C.warn } });
    note.innerHTML = kjOk
      ? "Live sampling frames are decoded and streamed into this node's preview box while the clip renders. More frames = an animated clip preview (mp4) instead of a still, at some extra cost per step."
      : "⚠ <code>ModelPreviewOverrideKJ</code> (comfyui-kjnodes) is not installed — generation still works, but the preview box only shows progress.";

    // "none"(기본)이면 노드가 진짜 VAE 없이 Latent2RGB로 근사 프리뷰를 낸다. models/vae_approx의
    // Tiny VAE를 고르면 실제 디코드된(더 정확한) 프리뷰가 나온다 — 목록은 getModels()의
    // vae_approx 필드에서 가져오고(원본 노드와 동일 소스), 아직 그 필드가 없는 백엔드에서는
    // ComfyUI 코어의 /object_info로 자동 폴백한다.
    // previewTinyVae만 예외적으로 서버 config(preview_tiny_vae 키)에도 저장한다 — 원본 노드가
    // 이후 Save All에 추가해서 맞춤(SPEC_MINIMAX_H3_PREVIEW_VAE.md 최초 버전은 로컬 전용이라고
    // 했었지만, 원본이 나중에 바꿈). previewEnabled/Frames/Fps/MaxRes/Quality는 여전히 로컬 전용.
    const tinyVaeSel = searchableSelect(["none", state.previewTinyVae].filter((v, i, a) => v && a.indexOf(v) === i), state.previewTinyVae || "none", (v) => {
      state.previewTinyVae = v;
      ctx.persist();
    });
    getPreviewTinyVaeOptions(modelData).then((opts) => {
      tinyVaeSel.setOptions(opts);
      tinyVaeSel.setValue(opts.includes(state.previewTinyVae) ? state.previewTinyVae : "none");
    });

    wrap.appendChild(
      panel([
        label("Live Preview (ModelPreviewOverrideKJ)"),
        checkboxRow("Show live frames while sampling", !!state.previewEnabled, (v) => { state.previewEnabled = v; ctx.persist(); ctx.refreshModes?.(); }),
        row([
          col([label("Preview frames"), el("input", { type: "number", step: "1", value: String(state.previewFrames ?? 8), style: numInputStyle(), oninput: (e: any) => { state.previewFrames = Math.max(1, Math.round(parseFloat(e.target.value) || 1)); ctx.persist(); } })]),
          col([label("Preview fps"), el("input", { type: "number", step: "1", value: String(state.previewFps ?? 12), style: numInputStyle(), oninput: (e: any) => { state.previewFps = Math.max(1, Math.round(parseFloat(e.target.value) || 1)); ctx.persist(); } })]),
        ]),
        row([
          col([label("Max resolution"), el("input", { type: "number", step: "64", value: String(state.previewMaxRes ?? 512), style: numInputStyle(), oninput: (e: any) => { state.previewMaxRes = Math.round(parseFloat(e.target.value) || 0); ctx.persist(); } })]),
          col([label("JPEG quality"), el("input", { type: "number", step: "1", value: String(state.previewQuality ?? 85), style: numInputStyle(), oninput: (e: any) => { state.previewQuality = Math.round(parseFloat(e.target.value) || 0); ctx.persist(); } })]),
        ]),
        col([label("Preview VAE (tiny/approx, optional — models/vae_approx/)"), tinyVaeSel.el]),
        note,
      ])
    );

    // LTX 2.5 Upscale runs its own model at its own resolution, so it gets its own switch +
    // values here rather than inheriting H3's — the two are rarely a good fit for each other.
    // The graph-side bug where this never actually reached the preview box (a colon in the
    // KJ node's id truncated in ComfyUI's hidden.unique_id) is fixed in graphBuilder.ts; this
    // panel is what turns it on and tunes it.
    const ltxTinyVaeSel = searchableSelect(["none", state.ltxTinyVae].filter((v, i, a) => v && a.indexOf(v) === i), state.ltxTinyVae || "none", (v) => {
      state.ltxTinyVae = v;
      ctx.persist();
    });
    getPreviewTinyVaeOptions(modelData).then((opts) => {
      ltxTinyVaeSel.setOptions(opts);
      ltxTinyVaeSel.setValue(opts.includes(state.ltxTinyVae) ? state.ltxTinyVae : "none");
    });
    wrap.appendChild(
      panel([
        label("LTX 2.5 Upscale — Live Preview"),
        checkboxRow("Show live frames while sampling", state.ltxPreviewEnabled ?? true, (v) => { state.ltxPreviewEnabled = v; ctx.persist(); }),
        row([
          col([label("Preview frames"), el("input", { type: "number", step: "1", value: String(state.ltxPreviewFrames ?? 8), style: numInputStyle(), oninput: (e: any) => { state.ltxPreviewFrames = Math.max(1, Math.round(parseFloat(e.target.value) || 1)); ctx.persist(); } })]),
          col([label("Preview fps"), el("input", { type: "number", step: "1", value: String(state.ltxPreviewFps ?? 12), style: numInputStyle(), oninput: (e: any) => { state.ltxPreviewFps = Math.max(1, Math.round(parseFloat(e.target.value) || 1)); ctx.persist(); } })]),
        ]),
        row([
          col([label("Max resolution"), el("input", { type: "number", step: "64", value: String(state.ltxPreviewMaxRes ?? 512), style: numInputStyle(), oninput: (e: any) => { state.ltxPreviewMaxRes = Math.round(parseFloat(e.target.value) || 0); ctx.persist(); } })]),
          col([label("JPEG quality"), el("input", { type: "number", step: "1", value: String(state.ltxPreviewQuality ?? 85), style: numInputStyle(), oninput: (e: any) => { state.ltxPreviewQuality = Math.round(parseFloat(e.target.value) || 0); ctx.persist(); } })]),
        ]),
        col([label("Preview TAE (taeltx2*, optional — models/vae_approx/)"), ltxTinyVaeSel.el]),
        el("div", { text: "Separate from the H3 preview above — LTX Upscale runs its own model at its own resolution.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
      ])
    );
    return wrap;
  }

  // 현재 패널 설정(해상도/프레임수/가속모드/LoRA 사용여부)과 정확히 일치하는 과거 클립들의
  // 실측 elapsedSec 평균을 내서 "Avg minutes per clip"에 자동 반영한다 — 일치하는 게 없으면
  // 수동 입력값을 그대로 두고 그 사실만 안내한다. Settings가 열릴 때마다 다시 조회.
  async function refreshMeasuredAvg(avgInput: HTMLInputElement, note: HTMLElement) {
    try {
      const { videos } = await listVideos(state.saveSubfolder || SUBFOLDER, { limit: 300 });
      const loraOn = (state.loras || []).some((l) => l.enabled !== false && l.name && l.name !== "none");
      const matches = (videos || []).filter((v: any) => {
        const m = v.meta;
        if (!m || m.elapsedSec == null) return false;
        if (m.aspect !== state.aspect) return false;
        if (Math.abs((m.megapixels ?? 0) - (state.megapixels ?? 0)) > 0.01) return false;
        if (m.frames !== state.clipFrames) return false;
        // New clips carry the real axis fields; older ones (saved before the pipeline-axis
        // port) only have `accel` — match on whichever the clip actually has, rather than a
        // string built from the *current* axes, so pre-split clips can still ever match.
        if (m.turboMode != null || m.attnBackend != null) {
          if ((m.turboMode || "none") !== (state.turboMode || "none")) return false;
          if ((m.attnBackend || "none") !== (state.attnBackend || "none")) return false;
        } else if (m.accel !== (state.attnBackend || "none")) {
          return false;
        }
        const mLoraOn = Array.isArray(m.loras) && m.loras.some((l: any) => l.enabled !== false && l.name && l.name !== "none");
        if (!!mLoraOn !== loraOn) return false;
        return true;
      });
      if (matches.length) {
        const avgMin = matches.reduce((sum: number, v: any) => sum + v.meta.elapsedSec, 0) / matches.length / 60;
        state.avgMinutesPerClip = +avgMin.toFixed(2);
        avgInput.value = String(state.avgMinutesPerClip);
        note.textContent = `Measured from ${matches.length} matching clip${matches.length > 1 ? "s" : ""}.`;
        ctx.persist();
        ctx.refreshPlan?.();
      } else {
        note.textContent = "No past clips at the current settings yet — using the manual value above.";
      }
    } catch {
      // 조회 실패해도 수동 입력값은 그대로 쓸 수 있으니 조용히 무시.
    }
  }

  // ══ Output tab ══════════════════════════════════════════════════════════
  function outputTab() {
    const wrap = el("div", { class: "flex flex-col gap-2" });
    const pathIn = el("input", { type: "text", placeholder: "one_minimax_h3", style: numInputStyle() }) as HTMLInputElement;
    pathIn.value = state.saveSubfolder || "";
    pathIn.addEventListener("input", () => { state.saveSubfolder = pathIn.value.trim(); ctx.persist(); });

    const prefixIn = el("input", { type: "text", placeholder: "MMH3", style: numInputStyle() }) as HTMLInputElement;
    prefixIn.value = state.filenamePrefix || "MMH3";
    prefixIn.addEventListener("input", () => { state.filenamePrefix = prefixIn.value.trim(); ctx.persist(); });

    wrap.appendChild(
      panel([
        label("Save Folder (inside ComfyUI output/)"), pathIn,
        label("Filename Prefix"), prefixIn,
        el("div", { text: "Every clip is always written to disk as its own video; the stitched file is written alongside them.", style: { fontSize: "10px", color: C.muted } }),
      ])
    );

    const avgInput = el("input", { type: "number", step: "0.5", value: String(state.avgMinutesPerClip ?? 13), style: numInputStyle(), oninput: (e: any) => { state.avgMinutesPerClip = parseFloat(e.target.value) || 0; ctx.persist(); ctx.refreshPlan?.(); } }) as HTMLInputElement;
    const measuredNote = el("div", { text: "", style: { fontSize: "9px", color: C.muted } });

    wrap.appendChild(
      panel([
        label("Relay"),
        checkboxRow("Stitch all clips into one video when the run finishes", !!state.stitchAtEnd, (v) => { state.stitchAtEnd = v; ctx.persist(); }),
        checkboxRow("Trim the stitched video to the requested total length", !!state.trimLastClip, (v) => { state.trimLastClip = v; ctx.persist(); }),
        checkboxRow("Free VRAM between clips (slower reload, safer on 16GB)", !!state.unloadBetweenClips, (v) => { state.unloadBetweenClips = v; ctx.persist(); }),
        col([label("Avg minutes per clip (used for the time estimate)"), avgInput, measuredNote]),
      ])
    );
    refreshMeasuredAvg(avgInput, measuredNote);

    const suffixIn = el("input", { type: "text", placeholder: "e.g. cinematic lighting, film grain", style: numInputStyle() }) as HTMLInputElement;
    suffixIn.value = state.promptSuffix || "";
    suffixIn.addEventListener("input", () => { state.promptSuffix = suffixIn.value; ctx.persist(); });
    wrap.appendChild(panel([label("Prompt Suffix (appended to every clip prompt)"), suffixIn]));
    return wrap;
  }

  // 각 섹션을 자기 wrapper로 감싸서 모바일에서 CSS order로 MODELS→SAMPLING→PREVIEW→OUTPUT
  // 한 줄 순서로 재배치할 수 있게 한다(데스크톱 2컬럼 배치는 그대로 유지 — style.css 참고).
  function section(cls: string, heading: string, body: HTMLElement) {
    return el("div", { class: `aos-mmh3-sec-${cls} flex flex-col gap-2` }, [sectionHeading(heading), body]);
  }

  function renderBody() {
    clear(leftCol);
    clear(rightCol);
    leftCol.append(
      section("h3model", "H3 Model", h3ModelTab()),
      section("upscalemodel", "UpScale Model", upscaleModelTab()),
      section("facerefinemodel", "FaceRefine Model", faceRefineModelTab()),
      section("preview", "Preview", previewTab()),
    );
    rightCol.append(
      section("sampling", "LLM Setting", samplingTab()),
      section("output", "Output", outputTab()),
      section("packs", "Third-party pack status", packStatusTab()),
    );
    refreshPackStatusText();
  }

  function saveAll() {
    ctx.persist();
    // 원본 노드가 처음엔 Models 탭 몇 개 필드만 서버 config에 저장하다가, Sampling/Sage/Cache/
    // Ollama/Output 탭 값들은 전부 로컬(워크플로우 상태)에만 남아 있던 걸 뒤늦게 알아채고
    // 한 번에 41개 필드 전부로 넓혔다 — 여기도 동일하게 맞춘다(키 이름 1:1 대응).
    saveConfig({
      unet_first_last: state.unetFirstLast || "",
      unet_reference: state.unetReference || "",
      clip_name: state.clipName || "",
      vae_video: state.vaeVideo || "",
      vae_audio: state.vaeAudio || "",
      turbo_lora: state.turboLora || "",
      turbo_lora_strength: state.turboLoraStrength ?? 1.0,
      pdd_file: state.pddFile || "",
      pdd_file_reference: state.pddFileReference || "",
      // LTX 2.5 Upscale mode
      ltx_unet: state.ltxUnet || "",
      ltx_latent_upscaler: state.ltxLatentUpscaler || "",
      ltx_clip: state.ltxClip || "",
      ltx_vae_video: state.ltxVaeVideo || "",
      ltx_vae_audio: state.ltxVaeAudio || "",
      upscale_model: state.upscaleModel || "",
      // H3 Face Refine mode
      face_detector: state.faceDetector || "",
      face_fallback_detector: state.faceFallbackDetector || "none",
      face_sam_model: state.faceSamModel || "none",
      face_identity_clip_vision: state.faceIdentityClipVision || "none",
      face_use_custom_model: state.frUseCustomModel ?? false,
      face_unet: state.frUnet || "",
      face_clip: state.frClip || "",
      save_subfolder: state.saveSubfolder || "",
      prompt_suffix: state.promptSuffix || "",
      avg_minutes_per_clip: state.avgMinutesPerClip ?? 13,
      preview_tiny_vae: state.previewTinyVae || "",
      preview_enabled: state.previewEnabled !== false,
      preview_frames: state.previewFrames ?? 8,
      preview_fps: state.previewFps ?? 12,
      preview_max_res: state.previewMaxRes ?? 512,
      preview_quality: state.previewQuality ?? 85,
      ltx_tiny_vae: state.ltxTinyVae || "",
      ltx_llm_prompt: state.ltxLlmPrompt || "",
      ltx_convert_prompt: state.ltxConvertPrompt || "",
      ltx_vision_backend: state.ltxVisionBackend || "native",
      ltx_vision_clip: state.ltxVisionClip || "",
      ltx_vision_or_model: state.ltxVisionOrModel || "",
      ltx_preview_enabled: state.ltxPreviewEnabled ?? true,
      ltx_preview_frames: state.ltxPreviewFrames ?? 8,
      ltx_preview_fps: state.ltxPreviewFps ?? 12,
      ltx_preview_max_res: state.ltxPreviewMaxRes ?? 512,
      ltx_preview_quality: state.ltxPreviewQuality ?? 85,
      turbo_lora_low_vram: state.turboLoraLowVram ?? false,
      sampler: state.sampler || "res_multistep",
      scheduler: state.scheduler || "simple",
      denoise: state.denoise ?? 1.0,
      shift_video: state.shiftVideo ?? 12,
      shift_audio: state.shiftAudio ?? 3,
      use_sage_attn: state.useSageAttn ?? true,
      sage_attn_mode: state.sageAttnMode || "auto",
      use_mem_eff_sage: state.useMemEffSage ?? true,
      use_torch_patch: state.useTorchPatch ?? true,
      fp16_accum: state.fp16Accum ?? true,
      use_ck_attention: state.useCkAttention ?? false,
      ck_attention_backend: state.ckAttentionBackend || "comfy_kitchen",
      use_sla_attention: state.useSlaAttention ?? false,
      sla_sparsity: state.slaSparsity ?? 0.9,
      sla_block_size: state.slaBlockSize || "64",
      sla_min_seq_len: state.slaMinSeqLen ?? 8192,
      sla_dense_last_steps: state.slaDenseLastSteps ?? 0,
      sla_protect_audio: state.slaProtectAudio ?? true,
      fbc_mode: state.fbcMode || "H3 Fast — 0.10 / max 2",
      fbc_threshold: state.fbcThreshold ?? 0.1,
      fbc_start_percent: state.fbcStartPercent ?? 0.1,
      fbc_end_percent: state.fbcEndPercent ?? 0.95,
      fbc_max_consecutive_hits: state.fbcMaxConsecutiveHits ?? 2,
      fbc_temporal_guard: state.fbcTemporalGuard ?? false,
      vision_source: state.visionSource || "native",
      native_vision_clip: state.nativeVisionClip || "",
      h3_brief_backend: state.h3BriefBackend || "native",
      h3_vision_backend: state.h3VisionBackend || "native",
      h3_or_model_brief: state.h3OrModelBrief || "",
      h3_or_model_vision: state.h3OrModelVision || "",
      filename_prefix: state.filenamePrefix || "MMH3",
      stitch_at_end: state.stitchAtEnd ?? true,
      trim_last_clip: state.trimLastClip ?? false,
      unload_between_clips: state.unloadBetweenClips ?? true,
    });
    saveAllBtn.textContent = "✓ Saved!";
    setTimeout(() => { saveAllBtn.textContent = "💾 Save All"; }, 1500);
  }

  async function refreshModels() {
    try {
      modelData = await getModels();
      ctx.availableModels = modelData;
    } catch {}
    try {
      availability = await getNodeAvailability();
      ctx.availability = availability.available || {};
      ctx.availabilityInfo = availability;
    } catch {}
    renderBody();
  }

  getConfig()
    .then((cfg) => {
      // 모델/LoRA 선택값은 서버(ComfyUI 백엔드)가 기준 — 여러 기기/브라우저에서 동일한 값을 보도록
      // 로컬(localStorage) 값보다 서버 값을 우선 적용한다.
      const take = (k: keyof MinimaxState, v: any) => {
        if (v && v !== "none") (state as any)[k] = v;
      };
      take("unetFirstLast", cfg.unet_first_last);
      take("unetReference", cfg.unet_reference);
      take("clipName", cfg.clip_name);
      take("vaeVideo", cfg.vae_video);
      take("vaeAudio", cfg.vae_audio);
      take("turboLora", cfg.turbo_lora);
      take("pddFile", cfg.pdd_file);
      take("pddFileReference", cfg.pdd_file_reference);
      take("ltxUnet", cfg.ltx_unet);
      take("ltxLatentUpscaler", cfg.ltx_latent_upscaler);
      take("ltxClip", cfg.ltx_clip);
      take("ltxVaeVideo", cfg.ltx_vae_video);
      take("ltxVaeAudio", cfg.ltx_vae_audio);
      take("upscaleModel", cfg.upscale_model);
      take("faceDetector", cfg.face_detector);
      take("faceFallbackDetector", cfg.face_fallback_detector);
      take("faceSamModel", cfg.face_sam_model);
      take("faceIdentityClipVision", cfg.face_identity_clip_vision);
      if (cfg.face_use_custom_model != null) state.frUseCustomModel = cfg.face_use_custom_model;
      take("frUnet", cfg.face_unet);
      take("frClip", cfg.face_clip);
      take("previewTinyVae", cfg.preview_tiny_vae);
      if (cfg.ltx_llm_prompt && !String(state.ltxLlmPrompt || "").trim()) state.ltxLlmPrompt = cfg.ltx_llm_prompt;
      if (cfg.ltx_convert_prompt && !String(state.ltxConvertPrompt || "").trim()) state.ltxConvertPrompt = cfg.ltx_convert_prompt;
      if (cfg.ltx_vision_backend) state.ltxVisionBackend = cfg.ltx_vision_backend;
      take("ltxVisionClip", cfg.ltx_vision_clip);
      if (cfg.ltx_vision_or_model && !String(state.ltxVisionOrModel || "").trim()) state.ltxVisionOrModel = cfg.ltx_vision_or_model;
      if (cfg.turbo_lora_strength != null) state.turboLoraStrength = cfg.turbo_lora_strength;
      if (cfg.prompt_suffix && !state.promptSuffix) state.promptSuffix = cfg.prompt_suffix;
      if (cfg.avg_minutes_per_clip != null) state.avgMinutesPerClip = cfg.avg_minutes_per_clip;
      // 이 아래는 전부 defaultState()에 이미 기본값이 있는(never-empty) 필드라 take()의
      // "로컬이 비어있을 때만" 조건이 절대 안 걸린다 — avg_minutes_per_clip과 같은 이유로
      // 여기서도 그냥 무조건 덮어쓴다(이 블록 자체가 세션당 한 번, 사용자가 뭘 만지기 전에만 실행됨).
      if (cfg.preview_enabled != null) state.previewEnabled = cfg.preview_enabled;
      if (cfg.preview_frames != null) state.previewFrames = cfg.preview_frames;
      if (cfg.preview_fps != null) state.previewFps = cfg.preview_fps;
      if (cfg.preview_max_res != null) state.previewMaxRes = cfg.preview_max_res;
      if (cfg.preview_quality != null) state.previewQuality = cfg.preview_quality;
      if (cfg.ltx_tiny_vae) state.ltxTinyVae = cfg.ltx_tiny_vae;
      if (cfg.ltx_preview_enabled != null) state.ltxPreviewEnabled = cfg.ltx_preview_enabled;
      if (cfg.ltx_preview_frames != null) state.ltxPreviewFrames = cfg.ltx_preview_frames;
      if (cfg.ltx_preview_fps != null) state.ltxPreviewFps = cfg.ltx_preview_fps;
      if (cfg.ltx_preview_max_res != null) state.ltxPreviewMaxRes = cfg.ltx_preview_max_res;
      if (cfg.ltx_preview_quality != null) state.ltxPreviewQuality = cfg.ltx_preview_quality;
      if (cfg.turbo_lora_low_vram != null) state.turboLoraLowVram = cfg.turbo_lora_low_vram;
      if (cfg.sampler) state.sampler = cfg.sampler;
      if (cfg.scheduler) state.scheduler = cfg.scheduler;
      if (cfg.denoise != null) state.denoise = cfg.denoise;
      if (cfg.shift_video != null) state.shiftVideo = cfg.shift_video;
      if (cfg.shift_audio != null) state.shiftAudio = cfg.shift_audio;
      if (cfg.use_sage_attn != null) state.useSageAttn = cfg.use_sage_attn;
      if (cfg.sage_attn_mode) state.sageAttnMode = cfg.sage_attn_mode;
      if (cfg.use_mem_eff_sage != null) state.useMemEffSage = cfg.use_mem_eff_sage;
      if (cfg.use_torch_patch != null) state.useTorchPatch = cfg.use_torch_patch;
      if (cfg.fp16_accum != null) state.fp16Accum = cfg.fp16_accum;
      if (cfg.use_ck_attention != null) state.useCkAttention = cfg.use_ck_attention;
      if (cfg.ck_attention_backend) state.ckAttentionBackend = cfg.ck_attention_backend;
      if (cfg.use_sla_attention != null) state.useSlaAttention = cfg.use_sla_attention;
      if (cfg.sla_sparsity != null) state.slaSparsity = cfg.sla_sparsity;
      if (cfg.sla_block_size) state.slaBlockSize = cfg.sla_block_size;
      if (cfg.sla_min_seq_len != null) state.slaMinSeqLen = cfg.sla_min_seq_len;
      if (cfg.sla_dense_last_steps != null) state.slaDenseLastSteps = cfg.sla_dense_last_steps;
      if (cfg.sla_protect_audio != null) state.slaProtectAudio = cfg.sla_protect_audio;
      if (cfg.fbc_mode) state.fbcMode = cfg.fbc_mode;
      if (cfg.fbc_threshold != null) state.fbcThreshold = cfg.fbc_threshold;
      if (cfg.fbc_start_percent != null) state.fbcStartPercent = cfg.fbc_start_percent;
      if (cfg.fbc_end_percent != null) state.fbcEndPercent = cfg.fbc_end_percent;
      if (cfg.fbc_max_consecutive_hits != null) state.fbcMaxConsecutiveHits = cfg.fbc_max_consecutive_hits;
      if (cfg.fbc_temporal_guard != null) state.fbcTemporalGuard = cfg.fbc_temporal_guard;
      // vision_source ignored on load — Ollama removed, always native regardless of what a
      // config saved before this change says.
      if (cfg.native_vision_clip) state.nativeVisionClip = cfg.native_vision_clip;
      // per-role backend: new keys, fall back to the pre-split h3_llm_backend (node migrates too)
      if (cfg.h3_brief_backend || cfg.h3_llm_backend) state.h3BriefBackend = (cfg.h3_brief_backend || cfg.h3_llm_backend)!;
      if (cfg.h3_vision_backend || cfg.h3_llm_backend) state.h3VisionBackend = (cfg.h3_vision_backend || cfg.h3_llm_backend)!;
      // brief model: new key, fall back to the pre-split h3_or_model (node migrates it too)
      if (cfg.h3_or_model_brief || cfg.h3_or_model) state.h3OrModelBrief = (cfg.h3_or_model_brief || cfg.h3_or_model)!;
      if (cfg.h3_or_model_vision) state.h3OrModelVision = cfg.h3_or_model_vision;
      // save_subfolder round-trips through the config route but had no load-side read at
      // all — the field only ever showed what pathIn.value already held client-side, so a
      // saved folder silently reset to the default on the next session/device.
      if (cfg.save_subfolder && !state.saveSubfolder) state.saveSubfolder = cfg.save_subfolder;
      if (cfg.filename_prefix) state.filenamePrefix = cfg.filename_prefix;
      if (cfg.stitch_at_end != null) state.stitchAtEnd = cfg.stitch_at_end;
      if (cfg.trim_last_clip != null) state.trimLastClip = cfg.trim_last_clip;
      if (cfg.unload_between_clips != null) state.unloadBetweenClips = cfg.unload_between_clips;
      ctx.persist();
      ctx.refreshPlan?.();
      ctx.refreshModes?.();
    })
    .catch(() => {})
    .finally(refreshModels);

  renderBody();

  return {
    el: ov,
    show() {
      ov.style.display = "flex";
      refreshModels();
      renderBody();
    },
    hide() {
      ov.style.display = "none";
    },
  };
}
