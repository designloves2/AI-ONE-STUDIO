// settings.ts — MiniMax H3 Settings 오버레이 (원본: web/minimax/ui_app_settings_minimax.js)
// 탭: Models · Sampling · Preview · Output. 여기서 정한 값은 매 실행에 재사용되고,
// 실행마다 바뀌는 값(steps, accel 등)은 좌측 패널에 남아있다 — 원본과 동일한 구분.
import type { MinimaxState } from "./core";
import { SAMPLERS, SCHEDULERS } from "./core";
import { button, checkboxRow, clear, col, el, label, panel, row, searchableSelect, select } from "../../shared/ui";
import { C, BRAND } from "../../identity";
import {
  getConfig,
  getModels,
  getNodeAvailability,
  getOllamaModels,
  getPreviewTinyVaeOptions,
  saveConfig,
  type ModelLists,
  type NodeAvailability,
} from "./api";

export interface SettingsCtx {
  persist: () => void;
  refreshPlan?: () => void;
  refreshModes?: () => void;
  availability?: Record<string, boolean>;
  availabilityInfo?: NodeAvailability;
  availableModels?: ModelLists;
  _rerenderImages?: () => void;
  audioFiles?: string[];
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
    packStatusText.textContent = missing.length ? `⚠ Not installed: ${missing.join(", ")}` : "✓ All optional acceleration / preview / upscale packs are installed.";
    packStatusText.style.color = missing.length ? C.warn : C.ok;
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

  // ══ Models tab ══════════════════════════════════════════════════════════
  function modelsTab() {
    const wrap = el("div", { class: "flex flex-col gap-2" });
    const diff = ["none", ...(modelData.diffusion_models || []).filter((x) => x !== "none")];
    const te = ["none", ...(modelData.text_encoders || []).filter((x) => x !== "none")];
    const vae = ["none", ...(modelData.vaes || []).filter((x) => x !== "none")];
    const lor = ["none", ...(modelData.loras || []).filter((x) => x !== "none")];
    const ups = ["none", ...(modelData.upscale_models || []).filter((x) => x !== "none")];

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
        col([label("Text Encoder (CLIPLoader type=minimax)"), cl.el]),
        row([col([label("Video VAE"), vv.el]), col([label("Audio VAE"), va.el])]),
        el("div", { html: "→ <code>models/text_encoders/</code> · <code>models/vae/</code>", style: { fontSize: "10px", color: C.muted } }),
      ])
    );

    const tl = searchableSelect(lor, state.turboLora || "none", (v) => { state.turboLora = v; ctx.persist(); ctx.refreshPlan?.(); });
    const um = searchableSelect(ups, state.upscaleModel || "none", (v) => { state.upscaleModel = v; ctx.persist(); });
    wrap.appendChild(
      panel([
        label("Acceleration & Upscale"),
        col([label("Turbo LoRA(larryvrh)"), tl.el]),
        row([
          col([label("Turbo strength"), el("input", { type: "number", step: "0.01", value: String(state.turboLoraStrength ?? 1.0), style: numInputStyle(), oninput: (e: any) => { state.turboLoraStrength = parseFloat(e.target.value) || 1.0; ctx.persist(); } })]),
          col([label(" "), checkboxRow("Low VRAM turbo load", !!state.turboLoraLowVram, (v) => { state.turboLoraLowVram = v; ctx.persist(); })]),
        ]),
        col([label("Upscale Model (used when Upscale = Upscale Model)"), um.el]),
      ])
    );

    // SageAttention and CK-Attention are alternative attention backends, so only one of the
    // two groups can be active at a time. Picking Sage turns its whole group (mode + the H3
    // mem-efficient patch) on together; picking CK turns the Sage group off and leaves only
    // CK's own setting editable. Both checkboxes stay clickable at all times — picking one
    // just turns the other off, no separate "uncheck this first" step needed.
    const sageModeSel = select(["auto", "disabled", "sageattn3", "sageattn3_per_block_mean", "sageattn_qk_int8_pv_fp16_cuda", "sageattn_qk_int8_pv_fp8_cuda"].map((s) => ({ value: s, label: s })), state.sageAttnMode || "auto", (v) => { state.sageAttnMode = v; ctx.persist(); });
    const memEffChk = checkboxRow("H3 memory-efficient SageAttention patch", !!state.useMemEffSage, (v) => { state.useMemEffSage = v; ctx.persist(); });
    const ckSel = select([{ value: "comfy_kitchen", label: "comfy kitchen attention" }, { value: "pytorch", label: "pytorch attention" }], state.ckAttentionBackend || "comfy_kitchen", (v) => { state.ckAttentionBackend = v; ctx.persist(); });
    if (!state.useSageAttn) {
      (sageModeSel as HTMLSelectElement).disabled = true;
      sageModeSel.style.opacity = "0.4";
      memEffChk.style.opacity = "0.4";
      (memEffChk.querySelector("input") as HTMLInputElement).disabled = true;
    }
    if (!state.useCkAttention) {
      (ckSel as HTMLSelectElement).disabled = true;
      ckSel.style.opacity = "0.4";
    }

    wrap.appendChild(
      panel([
        label("Model Patches"),
        el("div", { text: "SageAttention and CK-Attention are alternative backends — only one group is active at a time.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
        row([
          col([checkboxRow("SageAttention (KJ)", !!state.useSageAttn, (v) => { state.useSageAttn = v; if (v) state.useCkAttention = false; else state.useMemEffSage = false; ctx.persist(); renderBody(); })]),
          col([label("mode"), sageModeSel]),
        ]),
        memEffChk,
        row([
          col([checkboxRow("CK-Attention (comfy kitchen)", !!state.useCkAttention, (v) => { state.useCkAttention = v; if (v) state.useSageAttn = false; ctx.persist(); renderBody(); })]),
          col([label("attention"), ckSel]),
        ]),
        row([
          col([checkboxRow("Torch settings patch", !!state.useTorchPatch, (v) => { state.useTorchPatch = v; ctx.persist(); })]),
          col([checkboxRow("fp16 accumulation", !!state.fp16Accum, (v) => { state.fp16Accum = v; ctx.persist(); })]),
        ]),
        label(state.useCache ? "H3 Cache (step reuse) — ON in the node's left panel" : "H3 Cache (step reuse) — OFF in the node's left panel"),
        ...(state.useCache
          ? [
              row([
                col([label("reuse threshold"), el("input", { type: "number", step: "0.01", value: String(state.cacheThreshold ?? 0.3), style: numInputStyle(), oninput: (e: any) => { state.cacheThreshold = parseFloat(e.target.value) || 0; ctx.persist(); } })]),
                col([label("max steps"), el("input", { type: "number", step: "1", value: String(state.cacheMaxSteps ?? 2), style: numInputStyle(), oninput: (e: any) => { state.cacheMaxSteps = Math.round(parseFloat(e.target.value) || 0); ctx.persist(); } })]),
              ]),
              row([
                col([label("start %"), el("input", { type: "number", step: "0.01", value: String(state.cacheStart ?? 0.15), style: numInputStyle(), oninput: (e: any) => { state.cacheStart = parseFloat(e.target.value) || 0; ctx.persist(); } })]),
                col([label("end %"), el("input", { type: "number", step: "0.01", value: String(state.cacheEnd ?? 0.9), style: numInputStyle(), oninput: (e: any) => { state.cacheEnd = parseFloat(e.target.value) || 0; ctx.persist(); } })]),
              ]),
            ]
          : []),
      ])
    );

    const slaOk = !!ctx.availability?.H3SLAAttention;
    wrap.appendChild(
      panel([
        checkboxRow("H3 SLA Attention (block-sparse, last before the sampler)", !!state.useSlaAttention, (v) => { state.useSlaAttention = v; ctx.persist(); renderBody(); ctx.refreshModes?.(); }),
        ...(!slaOk ? [el("div", { html: "⚠ <code>H3SLAAttention</code> not installed — this stays off.", style: { fontSize: "10px", color: C.warn, lineHeight: "1.5" } })] : []),
        ...(state.useSlaAttention
          ? [
              row([
                col([label("sparsity ratio"), el("input", { type: "number", step: "0.05", value: String(state.slaSparsity ?? 0.9), style: numInputStyle(), oninput: (e: any) => { state.slaSparsity = parseFloat(e.target.value) || 0; ctx.persist(); } })]),
                col([label("block size"), select(["64", "128"].map((s) => ({ value: s, label: s })), state.slaBlockSize || "64", (v) => { state.slaBlockSize = v; ctx.persist(); })]),
              ]),
              row([
                col([label("min seq len"), el("input", { type: "number", step: "1024", value: String(state.slaMinSeqLen ?? 8192), style: numInputStyle(), oninput: (e: any) => { state.slaMinSeqLen = Math.round(parseFloat(e.target.value) || 0); ctx.persist(); } })]),
                col([label("dense last steps"), el("input", { type: "number", step: "1", value: String(state.slaDenseLastSteps ?? 0), style: numInputStyle(), oninput: (e: any) => { state.slaDenseLastSteps = Math.round(parseFloat(e.target.value) || 0); ctx.persist(); } })]),
              ]),
              checkboxRow("Protect audio (always attend text/cond/audio prefix)", state.slaProtectAudio !== false, (v) => { state.slaProtectAudio = v; ctx.persist(); }),
              el("div", { text: "Quick on/off per run (the node's own bypass) lives in the node's left panel, under H3 FirstBlockCache.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
            ]
          : []),
      ])
    );

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
        label("Steps & acceleration"),
        el("div", { html: "Step counts and each acceleration mode's tuning knobs now live in the node's <b>left panel</b>, directly under the Acceleration dropdown — switching modes there doesn't require coming back here.", style: { fontSize: "11px", color: C.muted, lineHeight: "1.6" } }),
      ])
    );
    wrap.appendChild(
      panel([
        label("Sampler"),
        row([
          col([label("Sampler (non-turbo)"), select(SAMPLERS.map((s) => ({ value: s, label: s })), state.sampler || "er_sde", (v) => { state.sampler = v; ctx.persist(); })]),
          col([label("Scheduler"), select(SCHEDULERS.map((s) => ({ value: s, label: s })), state.scheduler || "simple", (v) => { state.scheduler = v; ctx.persist(); })]),
        ]),
        col([label("Denoise"), el("input", { type: "number", step: "0.01", value: String(state.denoise ?? 1.0), style: numInputStyle(), oninput: (e: any) => { state.denoise = parseFloat(e.target.value) || 0; ctx.persist(); } })]),
      ])
    );
    wrap.appendChild(
      panel([
        label("Sigma Shift (MiniMaxH3SigmaShift)"),
        row([
          col([label("shift_video"), el("input", { type: "number", step: "0.5", value: String(state.shiftVideo ?? 12), style: numInputStyle(), oninput: (e: any) => { state.shiftVideo = parseFloat(e.target.value) || 0; ctx.persist(); } })]),
          col([label("shift_audio"), el("input", { type: "number", step: "0.5", value: String(state.shiftAudio ?? 3), style: numInputStyle(), oninput: (e: any) => { state.shiftAudio = parseFloat(e.target.value) || 0; ctx.persist(); } })]),
        ]),
      ])
    );
    wrap.appendChild(
      panel([
        label("Ollama server"),
        col([
          label("Server URL"),
          (() => {
            const inp = el("input", { type: "text", placeholder: "http://127.0.0.1:11434", style: numInputStyle() }) as HTMLInputElement;
            inp.value = state.ollamaUrl || "http://127.0.0.1:11434";
            inp.addEventListener("input", () => { state.ollamaUrl = inp.value.trim(); ctx.persist(); });
            return inp;
          })(),
        ]),
        row([
          col([label("Temperature"), el("input", { type: "number", step: "0.01", value: String(state.ollamaTemperature ?? 0.7), style: numInputStyle(), oninput: (e: any) => { state.ollamaTemperature = parseFloat(e.target.value) || 0; ctx.persist(); } })]),
          col([label("Top P"), el("input", { type: "number", step: "0.01", value: String(state.ollamaTopP ?? 0.9), style: numInputStyle(), oninput: (e: any) => { state.ollamaTopP = parseFloat(e.target.value) || 0; ctx.persist(); } })]),
        ]),
        el("div", { text: "Only read when Vision source below is set to Ollama.", style: { fontSize: "10px", color: C.muted } }),
      ])
    );

    wrap.appendChild(
      panel([
        label("Image → Brief — vision source"),
        (() => {
          const srcRow = el("div", { class: "flex gap-1" });
          const SOURCES = [
            { key: "ollama", label: "Ollama" },
            { key: "native", label: "Native (CLIP, no server)" },
          ];
          function renderSrc() {
            clear(srcRow);
            SOURCES.forEach((s) => {
              const active = (state.visionSource || "ollama") === s.key;
              const b = el("button", { type: "button", text: s.label, style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "5px 10px", borderRadius: "6px", fontWeight: active ? "700" : "400", background: active ? BRAND : C.bg2, color: "#fff", border: `1px solid ${active ? BRAND : C.border}` } });
              b.addEventListener("click", () => { state.visionSource = s.key; ctx.persist(); renderModelPickers(); });
              srcRow.appendChild(b);
            });
          }
          renderSrc();
          return srcRow;
        })(),
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
    const source = state.visionSource || "ollama";

    if (source === "ollama") {
      const briefWrap = el("div"),
        visionWrap = el("div");
      const statusRow = el("div", { style: { fontSize: "10px", color: C.muted } });
      let models: string[] = [];
      function renderPickers() {
        clear(briefWrap);
        clear(visionWrap);
        const opts = ["", ...models];
        const mk = (val: string, onChange: (v: string) => void) => select(opts.map((m) => ({ value: m, label: m || "(none)" })), models.includes(val) ? val : "", onChange);
        briefWrap.appendChild(mk(state.ollamaModel, (v) => { state.ollamaModel = v; ctx.persist(); }));
        visionWrap.appendChild(mk(state.ollamaVisionModel, (v) => { state.ollamaVisionModel = v; ctx.persist(); }));
      }
      (async () => {
        statusRow.textContent = "connecting to Ollama…";
        const d = await getOllamaModels(state.ollamaUrl);
        models = d.models || [];
        statusRow.textContent = d.ok ? `${models.length} model(s) available` : `⚠ ${String(d.error || "unreachable").slice(0, 80)}`;
        statusRow.style.color = d.ok ? C.muted : C.warn;
        renderPickers();
      })().catch(() => { statusRow.textContent = "⚠ could not reach Ollama"; statusRow.style.color = C.warn; });
      wrap2.append(
        row([col([label("Brief model (writes the prompt)"), briefWrap]), col([label("Vision model (reads images)"), visionWrap])]),
        statusRow,
        el("div", { text: "The brief writer never sees an image, so any text model works there. A single Ollama call with several images attached was tested and only one was ever attended to — images are analyzed one at a time and merged as text before the brief model sees them.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } })
      );
    } else {
      const missing: string[] = [];
      if (!availability.available?.TJ_MultiImageLoader) missing.push("TJ_MultiImageLoader (TJ_NODE)");
      if (!availability.available?.TextGenerate) missing.push("TextGenerate (ComfyUI core — update ComfyUI)");
      if (!availability.available?.TJStudioOneTextOutput) missing.push("TJStudioOneTextOutput (this package)");
      if (missing.length) {
        wrap2.appendChild(el("div", { text: `⚠ Native vision needs: ${missing.join(", ")}`, style: { fontSize: "10px", color: C.warn, lineHeight: "1.5" } }));
        return;
      }
      const clipList = ["none", ...(modelData.text_encoders || []).filter((x) => x !== "none")];
      const briefPick = searchableSelect(clipList, state.nativeBriefClip || "none", (v) => { state.nativeBriefClip = v === "none" ? "" : v; ctx.persist(); });
      const visionPick = searchableSelect(clipList, state.nativeVisionClip || "none", (v) => { state.nativeVisionClip = v === "none" ? "" : v; ctx.persist(); });
      wrap2.append(
        row([col([label("Brief CLIP (writes the prompt)"), briefPick.el]), col([label("Vision CLIP (reads images)"), visionPick.el])]),
        el("div", { text: "Both run through TextGenerate on ComfyUI's own model loading — no external server. A Qwen3-VL checkpoint (the kind already used for MiniMax H3 text encoding) can be picked for either or both roles; the same file works for both if you don't want two loaded at once.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } })
      );
    }
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
    return wrap;
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

    wrap.appendChild(
      panel([
        label("Relay"),
        checkboxRow("Stitch all clips into one video when the run finishes", !!state.stitchAtEnd, (v) => { state.stitchAtEnd = v; ctx.persist(); }),
        checkboxRow("Trim the stitched video to the requested total length", !!state.trimLastClip, (v) => { state.trimLastClip = v; ctx.persist(); }),
        checkboxRow("Free VRAM between clips (slower reload, safer on 16GB)", !!state.unloadBetweenClips, (v) => { state.unloadBetweenClips = v; ctx.persist(); }),
        col([label("Avg minutes per clip (used for the time estimate)"), el("input", { type: "number", step: "0.5", value: String(state.avgMinutesPerClip ?? 13), style: numInputStyle(), oninput: (e: any) => { state.avgMinutesPerClip = parseFloat(e.target.value) || 0; ctx.persist(); ctx.refreshPlan?.(); } })]),
      ])
    );

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
    leftCol.append(section("models", "Models", modelsTab()), section("preview", "Preview", previewTab()));
    rightCol.append(section("sampling", "Sampling", samplingTab()), section("output", "Output", outputTab()));
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
      upscale_model: state.upscaleModel || "",
      save_subfolder: state.saveSubfolder || "",
      prompt_suffix: state.promptSuffix || "",
      avg_minutes_per_clip: state.avgMinutesPerClip ?? 13,
      preview_tiny_vae: state.previewTinyVae || "",
      preview_enabled: state.previewEnabled !== false,
      preview_frames: state.previewFrames ?? 8,
      preview_fps: state.previewFps ?? 12,
      preview_max_res: state.previewMaxRes ?? 512,
      preview_quality: state.previewQuality ?? 85,
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
      cache_threshold: state.cacheThreshold ?? 0.3,
      cache_start: state.cacheStart ?? 0.15,
      cache_end: state.cacheEnd ?? 0.9,
      cache_max_steps: state.cacheMaxSteps ?? 2,
      ollama_url: state.ollamaUrl || "http://127.0.0.1:11434",
      ollama_model: state.ollamaModel || "",
      ollama_vision_model: state.ollamaVisionModel || "",
      ollama_temperature: state.ollamaTemperature ?? 0.7,
      ollama_top_p: state.ollamaTopP ?? 0.9,
      vision_source: state.visionSource || "ollama",
      native_vision_clip: state.nativeVisionClip || "",
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
      take("upscaleModel", cfg.upscale_model);
      take("previewTinyVae", cfg.preview_tiny_vae);
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
      if (cfg.cache_threshold != null) state.cacheThreshold = cfg.cache_threshold;
      if (cfg.cache_start != null) state.cacheStart = cfg.cache_start;
      if (cfg.cache_end != null) state.cacheEnd = cfg.cache_end;
      if (cfg.cache_max_steps != null) state.cacheMaxSteps = cfg.cache_max_steps;
      if (cfg.ollama_url) state.ollamaUrl = cfg.ollama_url;
      if (cfg.ollama_model) state.ollamaModel = cfg.ollama_model;
      if (cfg.ollama_vision_model) state.ollamaVisionModel = cfg.ollama_vision_model;
      if (cfg.ollama_temperature != null) state.ollamaTemperature = cfg.ollama_temperature;
      if (cfg.ollama_top_p != null) state.ollamaTopP = cfg.ollama_top_p;
      if (cfg.vision_source) state.visionSource = cfg.vision_source;
      if (cfg.native_vision_clip) state.nativeVisionClip = cfg.native_vision_clip;
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
    },
    hide() {
      ov.style.display = "none";
    },
  };
}
