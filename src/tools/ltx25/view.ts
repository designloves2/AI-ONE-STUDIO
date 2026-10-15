// view.ts — LTX 2.5 ONE STUDIO (web). First usable page: Text To Video and Image to Video (F/L).
// State, clip graph and /ltx25_one/* calls are the exact copies of the node's files (core / graphBuilder / api).
// Not on this page yet (see PORT_LEDGER row 45): LTX Director timeline editor, Postprocess, Prompt Edit with
// Prompt Write / Refine, the full Settings tabs, the LTX25 gallery, image-shape rules (cropLastToFirst).
import { C, BRAND } from "../../identity";
import { el, clear, panel, label, button, select, numberField, row, col, modeBar, iconBtn, searchableSelect, applyMobileCollapsibleLayout } from "../../shared/ui";
import { openImageGalleryPicker } from "../../shared/imageGalleryPicker";
import {
  defaultState, loadState, saveState, GENERATION_MODES, ASPECTS, CLIP_LENGTHS, composeClipPrompt, promptText,
  promptEnabled, randomSeed, clipFramesFor, clipPlan, formatDuration, resolveResolution, SUBFOLDER,
} from "./core";
import { buildClipGraph, NODE_IDS } from "./graphBuilder";
import * as api from "./api";
import { comfyApi } from "./comfyClient";

const MODES = GENERATION_MODES.filter((m: any) => m.key === "t2v" || m.key === "firstlast");

export function renderLtx25(root: HTMLElement) {
  clear(root);
  root.className = "flex-1 min-h-0 flex flex-col";
  root.style.background = C.bg0;

  const state: any = defaultState(loadState());
  if (state.generationMode !== "t2v" && state.generationMode !== "firstlast") state.generationMode = "t2v";
  const persist = () => saveState(state);
  let running = false;
  let stopRequested = false;
  let models: any = {};

  const wrap = el("div", { style: { flex: "1", minHeight: "0", display: "flex", flexDirection: "column", padding: "10px", gap: "8px", boxSizing: "border-box" } });
  root.appendChild(wrap);

  // ── sub bar ──────────────────────────────────────────────────────────────
  const subBar = el("div", { class: "aos-sub-bar", style: { display: "flex", alignItems: "center", gap: "10px", flexShrink: "0" } });
  const modeWrap = el("div", { class: "aos-mode-bar-wrap" });
  function renderModeBar() {
    clear(modeWrap);
    modeWrap.appendChild(modeBar(MODES.map((m: any) => ({ key: m.key, label: m.label })), state.generationMode, (key) => {
      state.generationMode = key; persist(); renderModeBar(); renderLeft();
    }));
  }
  renderModeBar();
  const warnTag = el("div", { text: "", style: { color: C.warn, fontSize: "11px" } });
  const unloadBtn = iconBtn("🗑", "Unload RAM/VRAM", () => { void api.freeMemory(); });
  subBar.append(modeWrap, warnTag, el("div", { style: { flex: "1" } }), unloadBtn);
  wrap.appendChild(subBar);

  // ── body ─────────────────────────────────────────────────────────────────
  const body = el("div", { style: { flex: "1", minHeight: "0", display: "flex", gap: "10px" } });
  wrap.appendChild(body);
  const leftPanel = el("div", { style: { width: "450px", flexShrink: "0", display: "flex", flexDirection: "column", minHeight: "0" } });
  const leftScroll = el("div", { style: { flex: "1", minHeight: "0", overflowY: "auto", paddingRight: "4px" } });
  const leftBottom = el("div", { style: { flexShrink: "0", paddingTop: "8px", display: "flex", flexDirection: "column", gap: "6px" } });
  leftPanel.append(leftScroll, leftBottom);
  const rightPanel = el("div", { style: { flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "8px" } });
  body.append(leftPanel, rightPanel);

  // preview: the finished clip
  const previewBox = el("div", { class: "aos-preview-box", style: { flex: "1", minHeight: "0", background: "#000", border: `1px solid ${C.border}`, borderRadius: "10px", position: "relative", overflow: "hidden" } });
  const placeholder = el("div", { text: "Result video appears here", style: { position: "absolute", inset: "0", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: "13px" } });
  const video = el("video", { controls: "true", loop: "true", style: { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain", display: "none", background: "#000" } }) as HTMLVideoElement;
  previewBox.append(placeholder, video);
  const statusText = el("div", { text: "Idle", style: { fontSize: "11px", color: C.muted } });
  const progressOuter = el("div", { style: { height: "4px", background: C.bg2, borderRadius: "2px", overflow: "hidden", flexShrink: "0" } });
  const progressInner = el("div", { style: { height: "100%", width: "0%", background: BRAND } });
  progressOuter.appendChild(progressInner);
  rightPanel.append(previewBox, statusText, progressOuter);

  function showVideo(v: { filename: string; subfolder?: string; type?: string }) {
    const url = `${api_base()}/view?filename=${encodeURIComponent(v.filename)}&subfolder=${encodeURIComponent(v.subfolder || "")}&type=${v.type || "output"}&t=${Date.now()}`;
    video.src = url;
    video.style.display = "block";
    placeholder.style.display = "none";
    void video.play().catch(() => {});
  }
  function api_base() { return comfyApi.base; }

  // ── prompts (one box per clip) ───────────────────────────────────────────
  const promptsWrap = el("div", { style: { flexShrink: "0", display: "flex", flexDirection: "column", gap: "6px", maxHeight: "40%", overflowY: "auto" } });
  rightPanel.appendChild(promptsWrap);
  function renderPrompts() {
    clear(promptsWrap);
    (state.prompts || []).forEach((raw: any, i: number) => {
      const ta = el("textarea", { placeholder: `Clip prompt ${i + 1} - what this clip shows, camera, light, sound…`, style: {
        flex: "1", minHeight: "70px", boxSizing: "border-box", background: C.bg1, color: C.text, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "8px", fontSize: "12px", fontFamily: "inherit", outline: "none", resize: "vertical",
      } }) as HTMLTextAreaElement;
      ta.value = promptText(raw);
      ta.addEventListener("input", () => {
        const p = state.prompts[i];
        if (typeof p === "object") p.text = ta.value; else state.prompts[i] = ta.value;
        persist(); refreshPlan();
      });
      const on = el("input", { type: "checkbox" }) as HTMLInputElement;
      on.checked = promptEnabled(raw);
      on.title = "Render this clip";
      on.addEventListener("change", () => {
        const p = state.prompts[i];
        if (typeof p === "object") p.enabled = on.checked; else state.prompts[i] = { text: p, enabled: on.checked };
        persist(); refreshPlan();
      });
      const del = el("button", { type: "button", text: "✕", title: "Remove this clip", style: { cursor: "pointer", background: "transparent", color: C.muted, border: "none", fontSize: "12px" } });
      del.addEventListener("click", () => { state.prompts.splice(i, 1); if (!state.prompts.length) state.prompts = [""]; persist(); renderPrompts(); refreshPlan(); });
      promptsWrap.appendChild(el("div", { style: { display: "flex", gap: "6px", alignItems: "flex-start" } }, [
        el("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", width: "22px", color: C.muted, fontSize: "10px" } }, [el("div", { text: String(i + 1) }), on, del]), ta,
      ]));
    });
    promptsWrap.appendChild(button("+ Add clip", () => { state.prompts.push(""); persist(); renderPrompts(); refreshPlan(); }));
  }

  // ── left panel ───────────────────────────────────────────────────────────
  const planLine = el("div", { style: { fontSize: "11px", lineHeight: "1.65", color: C.text } });
  function refreshPlan() {
    const p = (clipPlan as any)(state);
    const { width, height } = resolveResolution(state.aspect, state.megapixels);
    planLine.innerHTML = `<b>${p.count}</b> clip${p.count === 1 ? "" : "s"} · <b>${p.actualSeconds.toFixed(2)}s</b> total · est. <b>${formatDuration(p.estimateMinutes)}</b><br><span style="color:${C.muted}">${width}×${height} · ${p.clipSec.toFixed(2)}s/clip · ${state.clipFrames} frames</span>`;
  }

  function imageSlot(current: string | null, onSet: (name: string | null) => void, caption: string) {
    const box = el("div", { style: { width: "150px", height: "150px", border: `2px dashed ${C.border}`, borderRadius: "8px", background: C.bg2, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", overflow: "hidden", textAlign: "center", color: C.muted, fontSize: "11px", padding: "6px", boxSizing: "border-box" } });
    const img = el("img", { style: { maxWidth: "100%", maxHeight: "100%", display: "none", objectFit: "contain" } }) as HTMLImageElement;
    const hint = el("div", { text: caption });
    const fileIn = el("input", { type: "file", accept: "image/*", style: { display: "none" } }) as HTMLInputElement;
    const clearBtn = el("button", { type: "button", text: "✕", title: "Remove", style: { position: "absolute", top: "4px", right: "4px", zIndex: "3", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", borderRadius: "4px", width: "20px", height: "20px", cursor: "pointer", fontSize: "11px", padding: "0", display: "none" } });
    const gal = el("button", { type: "button", text: "🖼", title: "Pick from gallery", style: { position: "absolute", bottom: "4px", left: "4px", zIndex: "3", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", borderRadius: "4px", width: "22px", height: "22px", cursor: "pointer", fontSize: "12px", padding: "0" } });
    box.append(hint, img, fileIn, clearBtn, gal);
    function show(name: string | null) {
      if (name) { img.src = `${api_base()}/view?filename=${encodeURIComponent(name)}&type=input`; img.style.display = "block"; hint.style.display = "none"; clearBtn.style.display = "block"; }
      else { img.removeAttribute("src"); img.style.display = "none"; hint.style.display = ""; clearBtn.style.display = "none"; }
    }
    img.addEventListener("error", async () => {   // a saved file that is gone: empty card, forget the name
      if (!img.getAttribute("src")) return;
      const gone = await fetch(img.src, { method: "HEAD" }).then((r) => r.status === 404, () => false);
      show(null); if (gone) onSet(null);
    });
    show(current);
    box.addEventListener("click", () => fileIn.click());
    fileIn.addEventListener("change", async () => {
      const f = fileIn.files?.[0]; if (!f) return;
      hint.textContent = "Uploading…";
      try { const n = await api.uploadImage(f); onSet(n); show(n); } catch (e: any) { hint.textContent = "Upload failed: " + (e.message || e); }
    });
    clearBtn.addEventListener("click", (e) => { e.stopPropagation(); onSet(null); show(null); });
    gal.addEventListener("click", (e) => { e.stopPropagation(); openImageGalleryPicker((n) => { onSet(n); show(n); }); });
    return el("div", { style: { display: "flex", flexDirection: "column", gap: "4px", alignItems: "center" } }, [box]);
  }

  function modelSelect(title: string, key: string, cfgKey: string, options: string[]) {
    const opts = ["", ...options.filter(Boolean)];
    if (state[key] && !opts.includes(state[key])) opts.splice(1, 0, state[key]);
    const sel = searchableSelect(opts, state[key] || "", (v) => { state[key] = v; persist(); void api.saveConfig({ [cfgKey]: v }); });
    return col([label(title), sel.el]);
  }

  function renderLeft() {
    clear(leftScroll);
    const isFL = state.generationMode === "firstlast";
    leftScroll.appendChild(panel([label("Canvas"), row([
      col([label("Aspect"), select(ASPECTS.map((a: any) => ({ value: a.label, label: a.label })), state.aspect, (v) => { state.aspect = v; persist(); refreshPlan(); })]),
      col([label("Megapixels"), numberField(state.megapixels ?? 0.5, (v) => { state.megapixels = Math.max(0.1, v); persist(); refreshPlan(); }, 0.1)]),
    ])]));
    leftScroll.appendChild(panel([label("Clip length"),
      select([...CLIP_LENGTHS.map((c: any) => ({ value: String(c.frames), label: c.label }))], String(state.clipFrames), (v) => { state.clipFrames = parseInt(v, 10); persist(); refreshPlan(); }),
      planLine]));
    if (isFL) {
      leftScroll.appendChild(panel([label("First / Last Keyframes"),
        row([imageSlot(state.firstFrameImage, (n) => { state.firstFrameImage = n; persist(); }, "① First frame\n(click / drop)"),
             imageSlot(state.lastFrameImage, (n) => { state.lastFrameImage = n; persist(); }, "② Last frame\n(optional)")], "10px"),
        el("div", { text: "Both are optional. With neither, this is the same as Text only.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } })]));
    }
    leftScroll.appendChild(panel([label("Sampling"), row([
      col([label("Steps"), numberField(state.steps ?? 20, (v) => { state.steps = Math.max(1, Math.round(v)); persist(); }, 1)]),
      col([label("CFG"), numberField(state.cfg ?? 1, (v) => { state.cfg = v; persist(); }, 0.1)]),
    ])]));
    const det = el("details", { style: { marginBottom: "6px" } }) as HTMLDetailsElement;
    det.append(el("summary", { text: "Models", style: { cursor: "pointer", fontSize: "11px", fontWeight: "700", color: C.text, userSelect: "none" } }),
      el("div", { style: { display: "flex", flexDirection: "column", gap: "6px", marginTop: "6px" } }, [
        modelSelect("Diffusion model (Text / First-Last)", "unetFirstLast", "unet_first_last", models.diffusion_models || []),
        modelSelect("Text encoder", "clipName", "clip_name", models.text_encoders || []),
        modelSelect("Video VAE", "vaeVideo", "vae_video", models.vaes || []),
        modelSelect("Audio VAE", "vaeAudio", "vae_audio", models.vaes || []),
        modelSelect("Turbo LoRA", "turboLora", "turbo_lora", models.loras || []),
      ]));
    leftScroll.appendChild(panel([det]));
    refreshPlan();
  }

  // seed + generate
  const seedInput = numberField(state.seed ?? 0, (v) => { state.seed = Math.max(0, Math.floor(v)); persist(); }, 1);
  const seedMode = select([{ value: "randomize", label: "Random" }, { value: "fixed", label: "Fixed" }, { value: "increment", label: "Increment" }], state.seedMode || "randomize", (v) => { state.seedMode = v; persist(); });
  leftBottom.appendChild(panel([row([col([label("SEED"), seedInput]), col([label("MODE"), seedMode])])]));
  const genBtn = button("▶ Generate", () => { void generate(); }, "primary");
  genBtn.style.width = "100%"; genBtn.style.padding = "12px"; genBtn.style.fontSize = "13px";
  const stopBtn = button("■ Stop", () => { stopRequested = true; void api.interrupt(); statusText.textContent = "Stopping…"; }, "danger");
  stopBtn.style.display = "none"; stopBtn.style.width = "100%"; stopBtn.style.padding = "12px";
  leftBottom.append(genBtn, stopBtn);

  function firstOutput(byNode: any, key: string) {
    const out = byNode?.[key];
    const arr = out?.images || out?.gifs || [];
    return arr.length ? arr[0] : null;
  }

  async function generate() {
    if (running) return;
    const active = (state.prompts || []).map((p: any, i: number) => ({ p, i })).filter(({ p }: any) => promptEnabled(p));
    if (!active.length || active.every(({ p }: any) => !promptText(p).trim())) { warnTag.textContent = "Write a clip prompt first"; return; }
    warnTag.textContent = "";
    running = true; stopRequested = false;
    genBtn.style.display = "none"; stopBtn.style.display = "block";
    try {
      const avail = (await api.getNodeAvailability()).available;
      let n = 0;
      for (const { i } of active) {
        if (stopRequested) break;
        n++;
        const clipState = { ...state, clipFrames: clipFramesFor(state, i) };
        const seed = state.seedMode === "randomize" ? randomSeed() : (state.seed || 0) + (state.seedMode === "increment" ? i : 0);
        const isFL = state.generationMode === "firstlast";
        const built = buildClipGraph(clipState, avail, {
          nodeId: "ltx25_web", promptText: composeClipPrompt(state, i), seed, clipIndex: i, saveLastFrame: false, saveTailPreviews: false,
          firstFrame: isFL ? state.firstFrameImage || null : null, lastFrame: isFL ? state.lastFrameImage || null : null,
        });
        statusText.textContent = `Clip ${n}/${active.length} · queued`;
        const res: any = await (api as any).queuePrompt(built.graph, {
          samplerNode: [NODE_IDS.sampler],
          onProgress: (value: number, max: number) => {
            statusText.textContent = `Clip ${n}/${active.length} · sampling ${value}/${max}`;
            progressInner.style.width = `${Math.round((value / max) * 100)}%`;
          },
        });
        const vid = firstOutput(res.byNode, NODE_IDS.save);
        if (vid) {
          showVideo(vid);
          try { await api.saveMeta(vid.filename, vid.subfolder || "", { ...state, prompts: [promptText(state.prompts[i])], clip: n, clips: active.length, seed }); } catch { /* the clip is saved either way */ }
        }
      }
      statusText.textContent = stopRequested ? "Stopped" : "Done";
      progressInner.style.width = "100%";
    } catch (e: any) {
      statusText.textContent = `Error: ${e.message || e}`;
    } finally {
      running = false;
      genBtn.style.display = "block"; stopBtn.style.display = "none";
    }
  }

  renderLeft();
  renderPrompts();
  applyMobileCollapsibleLayout(body, leftPanel, leftScroll, rightPanel);

  // models + saved defaults from the server (a live choice in the page is never overwritten)
  void api.getModels().then((m: any) => { models = m || {}; renderLeft(); }).catch(() => {});
  void api.getConfig().then((cfg: any) => {
    const take = (k: string, v: any) => { if (!state[k] && v) state[k] = v; };
    take("unetFirstLast", cfg.unet_first_last); take("clipName", cfg.clip_name); take("vaeVideo", cfg.vae_video);
    take("vaeAudio", cfg.vae_audio); take("turboLora", cfg.turbo_lora); take("upscaleModel", cfg.upscale_model);
    persist(); renderLeft();
  }).catch(() => {});
  void SUBFOLDER;
}
