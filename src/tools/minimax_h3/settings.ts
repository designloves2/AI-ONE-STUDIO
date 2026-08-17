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
  const bodyWrap = el("div", { class: "flex-1 overflow-hidden flex gap-3 min-h-0" });
  const leftCol = el("div", { class: "flex-1 overflow-y-auto flex flex-col gap-2 pr-1 min-h-0" });
  const rightCol = el("div", { class: "flex-1 overflow-y-auto flex flex-col gap-2 pr-1 min-h-0" });
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
        col([label("Turbo LoRA (Text only / First-Last)"), tl.el]),
        el("div", { html: "Turbo LoRAs are trained against a specific base model and only <code>fl2v</code> ones exist, so <b>Reference mode doesn't offer Turbo at all</b> — use SolAttn, Spectrum or None there.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.55" } }),
        row([
          col([label("Turbo strength"), el("input", { type: "number", step: "0.01", value: String(state.turboLoraStrength ?? 1.0), style: numInputStyle(), oninput: (e: any) => { state.turboLoraStrength = parseFloat(e.target.value) || 1.0; ctx.persist(); } })]),
          col([label(" "), checkboxRow("Low VRAM turbo load", !!state.turboLoraLowVram, (v) => { state.turboLoraLowVram = v; ctx.persist(); })]),
        ]),
        col([label("Upscale Model (used when Upscale = Upscale Model)"), um.el]),
      ])
    );

    wrap.appendChild(
      panel([
        label("Model Patches"),
        row([
          col([checkboxRow("SageAttention (KJ)", !!state.useSageAttn, (v) => { state.useSageAttn = v; ctx.persist(); })]),
          col([label("mode"), select(["auto", "disabled", "sageattn3", "sageattn3_per_block_mean", "sageattn_qk_int8_pv_fp16_cuda", "sageattn_qk_int8_pv_fp8_cuda"].map((s) => ({ value: s, label: s })), state.sageAttnMode || "auto", (v) => { state.sageAttnMode = v; ctx.persist(); })]),
        ]),
        checkboxRow("H3 memory-efficient SageAttention patch", !!state.useMemEffSage, (v) => { state.useMemEffSage = v; ctx.persist(); }),
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

  function renderBody() {
    clear(leftCol);
    clear(rightCol);
    leftCol.append(sectionHeading("Models"), modelsTab(), sectionHeading("Preview"), previewTab());
    rightCol.append(sectionHeading("Sampling"), samplingTab(), sectionHeading("Output"), outputTab());
    refreshPackStatusText();
  }

  function saveAll() {
    ctx.persist();
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
      const take = (k: keyof MinimaxState, v: any) => {
        if ((!state[k] || state[k] === "none") && v && v !== "none") (state as any)[k] = v;
      };
      take("unetFirstLast", cfg.unet_first_last);
      take("unetReference", cfg.unet_reference);
      take("clipName", cfg.clip_name);
      take("vaeVideo", cfg.vae_video);
      take("vaeAudio", cfg.vae_audio);
      take("turboLora", cfg.turbo_lora);
      take("upscaleModel", cfg.upscale_model);
      if (cfg.turbo_lora_strength != null && state.turboLoraStrength == null) state.turboLoraStrength = cfg.turbo_lora_strength;
      if (cfg.prompt_suffix && !state.promptSuffix) state.promptSuffix = cfg.prompt_suffix;
      if (cfg.avg_minutes_per_clip != null) state.avgMinutesPerClip = cfg.avg_minutes_per_clip;
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
