// timelineHost.ts — the LTX Director segment timeline of the web twin: ruler + main track (prompt text and image
// segments) + audio track + IC-LoRA video track on one canvas, toolbar, transport, zoom, segment prompt and strengths.
// Written for this project from the data format in SPEC_LTX25_ONE_STUDIO_WEB.md and from how the timeline looks and
// behaves (a basic multi-track segment editor); nothing is copied from the Director's code.
//
// Data (timeline_data JSON + derived strings, 24 fps): main segments { id, start, length, prompt, type: "text" | "image",
// imageFile, imageB64, isAnchor, isEndFrame, guideStrength }, audioSegments { type: "audio", audioFile, fileName, trimStart,
// audioDurationFrames, waveformPeaks }, motionSegments { type: "motion_video", videoFile, fileName, trimStart,
// videoDurationFrames, videoStrength, videoAttentionStrength, resampleMode }. snapshot() returns the widget values the
// LTXDirectorTJ25 node takes.
import { C } from "../../identity";
import { emptyTimeline, FPS } from "./core";
import { comfyApi } from "./comfyClient";

const MIN_LEN = 6;            // frames, the shortest segment
const HANDLE_PX = 12;         // edge grab zone
const RULER_H = 24;
const SIDEBAR_W = 66;
const ASSET_SUBFOLDER = "ltx25_one";
const ZONE_HUES = [210, 28, 140, 300, 55, 185, 345, 95];

type Track = "image" | "audio" | "motion";
type AnySeg = Record<string, any>;

let uid = 0;
const newId = () => Date.now().toString(36) + (uid++).toString(36) + Math.random().toString(36).slice(2, 5);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function h<K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration> = {}, props: Record<string, any> = {}, kids: (Node | string)[] = []) {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  for (const k in props) { if (k === "class") e.className = props[k]; else (e as any)[k] = props[k]; }
  for (const c of kids) e.append(c);
  return e;
}

function splitPath(p: string): { subfolder: string; filename: string } {
  const s = String(p || "").replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return i < 0 ? { subfolder: "", filename: s } : { subfolder: s.slice(0, i), filename: s.slice(i + 1) };
}
const viewUrl = (p: string) => { const { subfolder, filename } = splitPath(p); return `${comfyApi.base}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=input`; };

async function uploadAsset(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("image", file); fd.append("subfolder", ASSET_SUBFOLDER); fd.append("type", "input");
  const r = await comfyApi.fetchApi("/upload/image", { method: "POST", body: fd });
  if (!r.ok) throw new Error(`upload failed (${r.status})`);
  const d = await r.json();
  return d.subfolder ? `${d.subfolder}/${d.name}` : d.name;
}

export interface TimelineSnapshot { widgets: Record<string, any> }

export function createTimelineHost({ onChange }: { onChange?: () => void } = {}) {
  let tl: any = emptyTimeline("", 121);
  let frames = 121;
  let sel: { track: Track; ids: string[] } = { track: "image", ids: [] };
  let playhead = 0;
  let zoom = 1;               // 1 = the whole clip fits; larger = zoomed in
  let scrollF = 0;            // first visible frame when zoomed in
  let snapOn = true;
  let playing = false, loop = false, rafId = 0, playStamp = 0, playFrom = 0;
  let overrideAudio = false, inpaintAudio = true;
  let clipboard: { track: Track; seg: AnySeg } | null = null;
  const imgCache = new Map<string, HTMLImageElement>();
  const bufCache = new Map<string, Promise<AudioBuffer | null>>();
  let actx: AudioContext | null = null;
  let audioNodes: AudioBufferSourceNode[] = [];
  const emit = () => { try { onChange?.(); } catch { /* the host keeps working */ } };

  const mainSegs = (): AnySeg[] => (tl.segments as AnySeg[]).slice().sort((a, b) => a.start - b.start);
  const segsOf = (t: Track): AnySeg[] => (t === "image" ? tl.segments : t === "audio" ? tl.audioSegments : tl.motionSegments);
  const trackOn = (t: Track) => (t === "image" ? tl.mainTrackEnabled !== false : t === "audio" ? tl.audioTrackEnabled !== false : tl.motionTrackEnabled !== false);

  // ── DOM ────────────────────────────────────────────────────────────────
  const root = h("div", { display: "flex", flexDirection: "column", gap: "8px", padding: "8px", boxSizing: "border-box", minHeight: "0", flex: "1", overflowY: "auto", overflowX: "hidden", color: C.text, fontSize: "12px", fontFamily: "ui-sans-serif, system-ui, sans-serif" });
  root.append(h("style", {}, { textContent: `
.prcs-btn{background:#222;color:#e0e0e0;border:1px solid #111;border-radius:4px;padding:6px 12px;font-size:11px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit}
.prcs-btn:hover:not(:disabled){background:#333;border-color:#555}
.prcs-btn.on{background:#1c222d;border-color:#283142}
.prcs-btn-danger:hover:not(:disabled){background:#4a1515;border-color:#cc4444;color:#ffaaaa}
.prcs-btn:disabled{opacity:.4;cursor:default}
.prcs-range{-webkit-appearance:none;appearance:none;height:4px;background:#444;border-radius:2px;outline:none;border:1px solid #222}
.prcs-range::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#aaa;cursor:pointer}
.prcs-menu{position:fixed;background:#1e1e1e;border:1px solid #444;border-radius:6px;padding:4px;z-index:100001;display:flex;flex-direction:column;min-width:150px;box-shadow:0 6px 20px rgba(0,0,0,.5)}
.prcs-menu button{background:transparent;color:#e0e0e0;border:none;text-align:left;padding:6px 10px;border-radius:4px;font-size:11px;cursor:pointer;font-family:inherit}
.prcs-menu button:hover{background:#333}` }));

  const toolbar = h("div", { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" });
  const actions = h("div", { display: "flex", gap: "6px", flexWrap: "wrap" });
  const right = h("div", { display: "flex", gap: "6px", flexWrap: "wrap" });
  const mkBtn = (text: string, title: string, fn: () => void, cls = "") => { const b = h("button", {}, { type: "button", className: `prcs-btn ${cls}`.trim(), textContent: text, title }); b.addEventListener("click", fn); return b as HTMLButtonElement; };
  const pick = (accept: string, onFile: (f: File) => void) => { const i = h("input", { display: "none" }, { type: "file", accept }) as HTMLInputElement; i.addEventListener("change", () => { const f = i.files?.[0]; i.value = ""; if (f) onFile(f); }); root.append(i); return () => i.click(); };
  const chooseImage = pick("image/*", (f) => { void addImageFile(f).then(emit); });
  const chooseAudio = pick("audio/*", (f) => { void addAudioFile(f); });
  const chooseMotion = pick("video/*", (f) => { void addMotionFile(f); });
  const addImgBtn = mkBtn("🖼 Add Image", "Add an image at the playhead", () => chooseImage());
  const addAudBtn = mkBtn("♪ Add Audio", "Add an audio clip at the playhead", () => chooseAudio());
  const addMotBtn = mkBtn("🎞 Add IC Video", "Add an IC-LoRA guide video at the playhead", () => chooseMotion());
  const addTxtBtn = mkBtn("T Add Text", "Add a text segment in free space", () => addText());
  const delBtn = mkBtn("🗑 Delete", "Delete the selected segment(s)", () => deleteSelected(), "prcs-btn-danger");
  actions.append(addImgBtn, addAudBtn, addMotBtn, addTxtBtn, delBtn);
  const inpaintBtn = mkBtn("Inpaint: ON", "Audio inpainting in gaps", () => { inpaintAudio = !inpaintAudio; paintToggles(); emit(); });
  const overrideBtn = mkBtn("Audio: OFF", "Override audio: use the audio of the IC-LoRA video", () => { overrideAudio = !overrideAudio; tl.overrideAudio = overrideAudio; paintToggles(); emit(); });
  const snapBtn = mkBtn("🧲 Snap", "Snap to neighbours and the playhead", () => { snapOn = !snapOn; paintToggles(); });
  right.append(inpaintBtn, overrideBtn, snapBtn);
  toolbar.append(actions, right);

  const canvasRow = h("div", { display: "flex", width: "100%" });
  const sidebar = h("div", { width: `${SIDEBAR_W}px`, flexShrink: "0", display: "flex", flexDirection: "column", background: "#1a1a1a", border: "1px solid #111", borderRight: "none", borderRadius: "6px 0 0 6px", overflow: "hidden" });
  const canvas = h("canvas", { display: "block", width: "100%", background: "#2a2a2a", cursor: "pointer", outline: "none", borderRadius: "0 6px 6px 0", border: "1px solid #111" }, { tabIndex: 0 }) as HTMLCanvasElement;
  const canvasBox = h("div", { flex: "1", minWidth: "0", position: "relative" }, {}, [canvas]);
  canvasRow.append(sidebar, canvasBox);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

  // track heights (CSS px)
  const TH = { image: 112, audio: 62, motion: 62 };
  const totalH = () => RULER_H + TH.image + TH.audio + TH.motion;
  const trackTop = (t: Track) => RULER_H + (t === "image" ? 0 : t === "audio" ? TH.image : TH.image + TH.audio);

  const sideBtns: Record<Track, HTMLButtonElement> = {} as any;
  function buildSidebar() {
    sidebar.replaceChildren(h("div", { height: `${RULER_H}px`, flexShrink: "0" }));
    (["image", "audio", "motion"] as Track[]).forEach((t) => {
      const b = h("button", { height: `${TH[t]}px`, flexShrink: "0", background: "transparent", border: "none", borderTop: "1px solid #111", color: "#bbb", fontSize: "10px", cursor: "pointer", fontFamily: "inherit", lineHeight: "1.3" }, { type: "button" }) as HTMLButtonElement;
      b.addEventListener("click", () => { toggleTrack(t); });
      sideBtns[t] = b; sidebar.append(b);
    });
    paintSidebar();
  }
  function paintSidebar() {
    const name: Record<Track, string> = { image: "MAIN", audio: "AUDIO", motion: "IC-LoRA" };
    (["image", "audio", "motion"] as Track[]).forEach((t) => {
      const on = trackOn(t);
      sideBtns[t].style.height = `${TH[t]}px`;
      sideBtns[t].innerHTML = `<div style="font-weight:700">${name[t]}</div><div>${on ? "● on" : "○ off"}</div>`;
      sideBtns[t].style.color = on ? "#dcdcdc" : "#666";
      sideBtns[t].title = `${name[t]} track is ${on ? "enabled" : "disabled"} — click to toggle`;
    });
  }
  function toggleTrack(t: Track) {
    if (t === "image") tl.mainTrackEnabled = !trackOn(t);
    else if (t === "audio") tl.audioTrackEnabled = !trackOn(t);
    else tl.motionTrackEnabled = !trackOn(t);
    paintSidebar(); draw(); emit();
  }

  // prompt + properties
  const promptWrap = h("div", { position: "relative", background: "#222", border: "1px solid #111", borderRadius: "6px", minHeight: "86px", display: "flex", flexDirection: "column" });
  const promptLabel = h("div", { fontSize: "9px", fontWeight: "bold", color: "#666", textTransform: "uppercase", letterSpacing: "0.5px", padding: "5px 8px 0" }, { textContent: "Segment Prompt" });
  const promptTA = h("textarea", { flex: "1", minHeight: "56px", background: "transparent", color: "#e0e0e0", border: "none", padding: "2px 8px 8px", fontSize: "12px", lineHeight: "1.4", resize: "vertical", outline: "none", fontFamily: "inherit" }, { placeholder: "What happens in this segment…" }) as HTMLTextAreaElement;
  promptWrap.append(promptLabel, promptTA);
  const info = h("div", { background: "#181818", color: "#aaa", border: "1px solid #111", borderRadius: "6px", padding: "10px", fontSize: "12px", lineHeight: "1.6", display: "none" });
  const boundsLine = h("div", { color: "#8a8a8a", fontSize: "11px" }, { textContent: "Start: - | End: - | Length: -" });

  const controls = h("div", { background: "#1e1e1e", border: "1px solid #333", borderRadius: "6px", padding: "4px 8px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" });
  const playBtn = mkBtn("▶", "Play / pause", () => togglePlay());
  const loopBtn = mkBtn("⟳", "Toggle loop", () => { loop = !loop; loopBtn.classList.toggle("on", loop); });
  const seek = h("input", { flex: "1", minWidth: "80px" }, { type: "range", min: "0", max: "1000", value: "0", className: "prcs-range" }) as HTMLInputElement;
  const timeLbl = h("div", { fontSize: "11px", color: "#ddd", minWidth: "84px", textAlign: "center" });
  const zOut = mkBtn("−", "Zoom out", () => setZoom(zoom / 1.4));
  const zSlider = h("input", { width: "80px" }, { type: "range", min: "1", max: "20", step: "0.1", value: "1", className: "prcs-range", title: "Zoom level" }) as HTMLInputElement;
  const zIn = mkBtn("+", "Zoom in", () => setZoom(zoom * 1.4));
  const zFit = mkBtn("⤢", "Zoom to fit (show the whole timeline)", () => setZoom(1));
  controls.append(playBtn, loopBtn, seek, timeLbl, zOut, zSlider, zIn, zFit);

  const strengthRow = h("div", { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", fontSize: "11px" });
  const numIn = (min: number, max: number, step: number) => h("input", { width: "52px", fontSize: "12px", color: "#fff", background: "#222", border: "1px solid #444", borderRadius: "4px", textAlign: "center", padding: "3px" }, { type: "number", min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
  const rng = (min: number, max: number, step: number) => h("input", { width: "80px" }, { type: "range", min: String(min), max: String(max), step: String(step), className: "prcs-range" }) as HTMLInputElement;
  const gLbl = h("span", { fontWeight: "600" }, { textContent: "Guide Strength:" });
  const gSlider = rng(0, 1, 0.01), gNum = numIn(0, 1, 0.01);
  const vLbl = h("span", { fontWeight: "600" }, { textContent: "Video Strength:" });
  const vSlider = rng(0, 1, 0.01), vNum = numIn(0, 1, 0.01);
  const aLbl = h("span", { fontWeight: "600" }, { textContent: "Video Attn:" });
  const aSlider = rng(0, 1, 0.01), aNum = numIn(0, 1, 0.01);
  const endChk = h("input", {}, { type: "checkbox" }) as HTMLInputElement;
  const endLbl = h("label", { display: "flex", alignItems: "center", gap: "4px", color: "#ccc" }, {}, [endChk, "image at the segment's end frame"]);
  const anchorChk = h("input", {}, { type: "checkbox" }) as HTMLInputElement;
  const anchorLbl = h("label", { display: "flex", alignItems: "center", gap: "4px", color: "#ccc" }, { title: "A guide-only keyframe: it borrows the previous segment's prompt" }, [anchorChk, "anchor"]);
  strengthRow.append(gLbl, gSlider, gNum, endLbl, anchorLbl, vLbl, vSlider, vNum, aLbl, aSlider, aNum);

  root.append(toolbar, canvasRow, boundsLine, promptWrap, info, controls, strengthRow);

  function paintToggles() {
    inpaintBtn.textContent = `Inpaint: ${inpaintAudio ? "ON" : "OFF"}`;
    overrideBtn.textContent = `Audio: ${overrideAudio ? "ON" : "OFF"}`;
    overrideBtn.classList.toggle("on", overrideAudio);
    snapBtn.classList.toggle("on", snapOn);
  }

  // ── geometry ───────────────────────────────────────────────────────────
  const visibleFrames = () => Math.max(1, frames / zoom);
  const cssW = () => Math.max(40, canvas.clientWidth || canvasBox.clientWidth || 600);
  const pxPerFrame = () => cssW() / visibleFrames();
  const fx = (frame: number) => (frame - scrollF) * pxPerFrame();
  const xf = (x: number) => x / pxPerFrame() + scrollF;
  const clampScroll = () => { scrollF = clamp(scrollF, 0, Math.max(0, frames - visibleFrames())); };
  function setZoom(z: number, anchorFrame?: number) {
    const a = anchorFrame ?? playhead;
    const old = zoom;
    zoom = clamp(z, 1, 20);
    if (zoom !== old) { scrollF = a - (a - scrollF) * (old / zoom); }
    clampScroll(); zSlider.value = String(zoom); draw();
  }
  function sizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = cssW(), hh = totalH();
    canvas.style.height = `${hh}px`;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── images / waveform caches ───────────────────────────────────────────
  function segImage(seg: AnySeg): HTMLImageElement | null {
    const src = seg.imageB64 || (seg.imageFile ? viewUrl(seg.imageFile) : "");
    if (!src) return null;
    let im = imgCache.get(src);
    if (!im) { im = new Image(); im.onload = () => draw(); im.src = src; imgCache.set(src, im); }
    return im.complete && im.naturalWidth ? im : null;
  }

  // ── drawing ────────────────────────────────────────────────────────────
  const zoneColor = (i: number) => `hsl(${ZONE_HUES[i % ZONE_HUES.length]}, 55%, 38%)`;
  const isSel = (t: Track, id: string) => sel.track === t && sel.ids.includes(id);
  function clipText(text: string, maxW: number) {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
    return s + "…";
  }
  function roundRect(x: number, y: number, w: number, hh: number, r: number) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function fmtTime(f: number) { const s = f / FPS; const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`; }

  function draw() {
    sizeCanvas();
    const W = cssW();
    ctx.clearRect(0, 0, W, totalH());
    // backgrounds
    ctx.fillStyle = "#1e1e1e"; ctx.fillRect(0, 0, W, RULER_H);
    const bg: Record<Track, string> = { image: "#121212", audio: "#141414", motion: "#121212" };
    (["image", "audio", "motion"] as Track[]).forEach((t) => { ctx.fillStyle = bg[t]; ctx.fillRect(0, trackTop(t), W, TH[t]); ctx.fillStyle = "#000"; ctx.fillRect(0, trackTop(t), W, 1); });
    // ruler ticks
    const secPx = pxPerFrame() * FPS;
    const stepS = secPx > 90 ? 0.5 : secPx > 44 ? 1 : secPx > 22 ? 2 : secPx > 11 ? 5 : 10;
    ctx.font = "10px sans-serif"; ctx.textBaseline = "middle";
    for (let s = Math.floor(scrollF / FPS / stepS) * stepS; s * FPS <= scrollF + visibleFrames() + 1; s += stepS) {
      const x = Math.round(fx(s * FPS)) + 0.5;
      ctx.fillStyle = "#555"; ctx.fillRect(x, RULER_H - 8, 1, 8);
      ctx.fillStyle = "#aaa"; ctx.fillText(`${Number(s.toFixed(1))}s`, x + 3, RULER_H / 2 - 2);
    }
    // clip end
    const endX = fx(frames);
    ctx.fillStyle = "rgba(255,255,255,0.06)"; if (endX < W) ctx.fillRect(endX, RULER_H, W - endX, totalH() - RULER_H);

    // main track
    const mt = trackTop("image");
    let zone = 0;
    for (const seg of mainSegs()) {
      const x = fx(seg.start), w = Math.max(3, seg.length * pxPerFrame());
      if (x + w < 0 || x > W) continue;
      const on = isSel("image", seg.id);
      const y = mt + 6, hh = TH.image - 12;
      const col = seg.type === "text" ? zoneColor(zone) : seg.isAnchor ? "#4a4a1c" : "#1b3a5c";
      if (seg.type === "text" || !seg.isAnchor) zone++;
      ctx.globalAlpha = trackOn("image") ? 1 : 0.35;
      ctx.fillStyle = col; roundRect(x, y, w, hh, 5); ctx.fill();
      if (seg.type === "image") {
        const im = segImage(seg);
        if (im && w > 8) {
          ctx.save(); roundRect(x, y, w, hh, 5); ctx.clip();
          const tw = hh * (im.naturalWidth / im.naturalHeight);
          if (seg.isEndFrame) { for (let tx = x + w - tw; tx > x - tw; tx -= tw) ctx.drawImage(im, tx, y, tw, hh); }
          else { for (let tx = x; tx < x + w; tx += tw) ctx.drawImage(im, tx, y, tw, hh); }
          ctx.restore();
        }
      }
      // label
      ctx.font = "bold 11px sans-serif"; ctx.textBaseline = "alphabetic";
      const label = seg.type === "image" ? `${seg.isAnchor ? "⚓ " : "🖼 "}${seg.prompt || ""}` : seg.prompt || "";
      ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(x, y + hh - 18, w, 18);
      ctx.fillStyle = seg.prompt ? "#fff" : "rgba(255,255,255,0.6)";
      if (w > 24) ctx.fillText(clipText(label || (seg.type === "image" ? "image" : "empty prompt"), w - 8), x + 4, y + hh - 5);
      if (seg.type === "image" && seg.isEndFrame && w > 30) { ctx.fillStyle = "#ffb35a"; ctx.fillText("◀ end", x + 4, y + 13); }
      ctx.strokeStyle = on ? "#fff" : "rgba(255,255,255,0.18)"; ctx.lineWidth = on ? 2 : 1; roundRect(x + 0.5, y + 0.5, w - 1, hh - 1, 5); ctx.stroke();
      if (on) { ctx.fillStyle = "#fff"; ctx.fillRect(x + 1, y + 6, 3, hh - 12); ctx.fillRect(x + w - 4, y + 6, 3, hh - 12); }
      ctx.globalAlpha = 1;
    }
    // audio track
    const at = trackTop("audio");
    for (const seg of tl.audioSegments as AnySeg[]) {
      const x = fx(seg.start), w = Math.max(3, seg.length * pxPerFrame());
      if (x + w < 0 || x > W) continue;
      const on = isSel("audio", seg.id), y = at + 5, hh = TH.audio - 10;
      ctx.globalAlpha = trackOn("audio") ? 1 : 0.35;
      ctx.fillStyle = "#17442f"; roundRect(x, y, w, hh, 5); ctx.fill();
      const peaks: number[] = seg.waveformPeaks || [];
      if (peaks.length) {
        ctx.save(); roundRect(x, y, w, hh, 5); ctx.clip(); ctx.fillStyle = "#5fd38d";
        const total = Math.max(1, seg.audioDurationFrames || seg.length);
        const bars = Math.max(1, Math.floor(w / 2));
        for (let i = 0; i < bars; i++) {
          const f = (seg.trimStart || 0) + (i / bars) * seg.length;
          const p = peaks[clamp(Math.floor((f / total) * peaks.length), 0, peaks.length - 1)] || 0;
          const bh = Math.max(1, p * (hh - 8));
          ctx.fillRect(x + i * (w / bars), y + (hh - bh) / 2, Math.max(1, w / bars - 0.5), bh);
        }
        ctx.restore();
      }
      ctx.font = "10px sans-serif"; ctx.fillStyle = "#e8fff0"; ctx.textBaseline = "alphabetic";
      if (w > 30) ctx.fillText(clipText(seg.fileName || "audio", w - 8), x + 4, y + 11);
      ctx.strokeStyle = on ? "#fff" : "rgba(255,255,255,0.18)"; ctx.lineWidth = on ? 2 : 1; roundRect(x + 0.5, y + 0.5, w - 1, hh - 1, 5); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // motion (IC-LoRA video) track
    const vt = trackTop("motion");
    for (const seg of tl.motionSegments as AnySeg[]) {
      const x = fx(seg.start), w = Math.max(3, seg.length * pxPerFrame());
      if (x + w < 0 || x > W) continue;
      const on = isSel("motion", seg.id), y = vt + 5, hh = TH.motion - 10;
      ctx.globalAlpha = trackOn("motion") ? 1 : 0.35;
      ctx.fillStyle = "#1c3d46"; roundRect(x, y, w, hh, 5); ctx.fill();
      const im = segImage(seg);
      if (im && w > 8) { ctx.save(); roundRect(x, y, w, hh, 5); ctx.clip(); const tw = hh * (im.naturalWidth / im.naturalHeight); for (let tx = x; tx < x + w; tx += tw) ctx.drawImage(im, tx, y, tw, hh); ctx.restore(); }
      ctx.font = "bold 10px sans-serif"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(0,14,37,0.7)"; ctx.fillRect(x, y + hh - 15, w, 15);
      ctx.fillStyle = "#fff"; if (w > 30) ctx.fillText(clipText(seg.fileName || "video", w - 8), x + 4, y + hh - 4);
      if (seg._uploading) { ctx.fillStyle = "#ffb35a"; ctx.fillText("uploading…", x + 4, y + 12); }
      ctx.strokeStyle = on ? "#fff" : "rgba(255,255,255,0.18)"; ctx.lineWidth = on ? 2 : 1; roundRect(x + 0.5, y + 0.5, w - 1, hh - 1, 5); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // playhead
    const px = fx(playhead);
    if (px >= -2 && px <= W + 2) {
      ctx.fillStyle = "#ff5252"; ctx.fillRect(Math.round(px), 0, 2, totalH());
      ctx.beginPath(); ctx.moveTo(px - 5, 0); ctx.lineTo(px + 6, 0); ctx.lineTo(px + 0.5, 9); ctx.closePath(); ctx.fill();
    }
    updateTransportUI();
  }

  // ── selection / panels ─────────────────────────────────────────────────
  const selected = (): AnySeg | null => { const l = segsOf(sel.track); return l.find((s) => s.id === sel.ids[0]) || null; };
  function refreshPanels() {
    const seg = selected();
    const isMain = !!seg && sel.track === "image";
    promptWrap.style.display = isMain && !(seg!.isAnchor) ? "flex" : "none";
    info.style.display = seg && !isMain ? "block" : (isMain && seg!.isAnchor ? "block" : "none");
    boundsLine.textContent = seg ? `Start: ${fmtTime(seg.start)} | End: ${fmtTime(seg.start + seg.length)} | Length: ${fmtTime(seg.length)} (${seg.length}f)` : "Start: - | End: - | Length: -";
    if (isMain && !seg!.isAnchor) { promptTA.value = seg!.prompt || ""; promptLabel.textContent = seg!.type === "image" ? "Segment Prompt (this image's beat)" : "Segment Prompt"; }
    if (seg && sel.track === "audio") info.innerHTML = `Audio: <span style="color:#fff">${seg.fileName || seg.audioFile}</span><br>Start <span style="color:#fff">${fmtTime(seg.start)}</span> · length <span style="color:#fff">${fmtTime(seg.length)}</span> · trim <span style="color:#fff">${seg.trimStart || 0}f</span>`;
    else if (seg && sel.track === "motion") info.innerHTML = `IC-LoRA video: <span style="color:#fff">${seg.fileName || seg.videoFile}</span><br>Start <span style="color:#fff">${fmtTime(seg.start)}</span> · length <span style="color:#fff">${fmtTime(seg.length)}</span> · trim <span style="color:#fff">${seg.trimStart || 0}f</span>`;
    else if (isMain && seg!.isAnchor) info.innerHTML = `Image anchor: <span style="color:#fff">${seg!.imageFile || "image"}</span> — a guide-only keyframe, it borrows the previous segment's prompt.`;
    const img = isMain && seg!.type === "image";
    const mot = !!seg && sel.track === "motion";
    for (const e of [gLbl, gSlider, gNum, endLbl, anchorLbl]) e.style.display = img ? "" : "none";
    for (const e of [vLbl, vSlider, vNum, aLbl, aSlider, aNum]) e.style.display = mot ? "" : "none";
    strengthRow.style.display = img || mot ? "flex" : "none";
    if (img) { const g = seg!.guideStrength ?? 1; gSlider.value = String(g); gNum.value = String(Number(g).toFixed(2)); endChk.checked = !!seg!.isEndFrame; anchorChk.checked = !!seg!.isAnchor; }
    if (mot) { const v = seg!.videoStrength ?? 1, a = seg!.videoAttentionStrength ?? 0.65; vSlider.value = String(v); vNum.value = String(Number(v).toFixed(2)); aSlider.value = String(a); aNum.value = String(Number(a).toFixed(2)); }
    delBtn.disabled = !seg;
  }
  function select(track: Track, id: string | null, additive = false) {
    if (!id) { sel = { track, ids: [] }; }
    else if (additive && sel.track === track) sel.ids = sel.ids.includes(id) ? sel.ids.filter((x) => x !== id) : [...sel.ids, id];
    else sel = { track, ids: [id] };
    refreshPanels(); draw();
  }
  promptTA.addEventListener("input", () => { const s = selected(); if (s && sel.track === "image") { s.prompt = promptTA.value; draw(); emit(); } });
  const bindStrength = (slider: HTMLInputElement, num: HTMLInputElement, key: string, track: Track) => {
    const set = (v: number) => { const s = selected(); if (s && sel.track === track) { s[key] = clamp(v, 0, 1); slider.value = String(s[key]); num.value = Number(s[key]).toFixed(2); emit(); } };
    slider.addEventListener("input", () => set(parseFloat(slider.value)));
    num.addEventListener("change", () => set(parseFloat(num.value) || 0));
  };
  bindStrength(gSlider, gNum, "guideStrength", "image");
  bindStrength(vSlider, vNum, "videoStrength", "motion");
  bindStrength(aSlider, aNum, "videoAttentionStrength", "motion");
  endChk.addEventListener("change", () => { const s = selected(); if (s) { s.isEndFrame = endChk.checked; draw(); emit(); } });
  anchorChk.addEventListener("change", () => { const s = selected(); if (s) { s.isAnchor = anchorChk.checked; refreshPanels(); draw(); emit(); } });

  // ── hit testing / dragging ─────────────────────────────────────────────
  function trackAt(y: number): Track | "ruler" {
    if (y < RULER_H) return "ruler";
    if (y < RULER_H + TH.image) return "image";
    if (y < RULER_H + TH.image + TH.audio) return "audio";
    return "motion";
  }
  function hit(x: number, y: number): { track: Track; seg: AnySeg; edge: "l" | "r" | "body" } | null {
    const t = trackAt(y); if (t === "ruler") return null;
    const list = segsOf(t);
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i], sx = fx(s.start), sw = Math.max(3, s.length * pxPerFrame());
      if (x >= sx - 4 && x <= sx + sw + 4) {
        const hp = Math.min(HANDLE_PX, sw / 3);
        const edge = x <= sx + hp ? "l" : x >= sx + sw - hp ? "r" : "body";
        return { track: t, seg: s, edge };
      }
    }
    return null;
  }
  const maxLenOf = (t: Track, s: AnySeg): number => t === "audio" ? Math.max(MIN_LEN, (s.audioDurationFrames || s.length) - (s.trimStart || 0)) : t === "motion" ? Math.max(MIN_LEN, (s.videoDurationFrames || s.length) - (s.trimStart || 0)) : frames * 4;

  /** Frame the edge/start should snap to: neighbours' edges, the playhead, 0 and the clip end. */
  function snapTo(frame: number, ignoreId: string, t: Track): number {
    if (!snapOn) return frame;
    const near = 8 / pxPerFrame();
    let best = frame, bd = near;
    const cands = [0, frames, playhead];
    for (const s of segsOf(t)) if (s.id !== ignoreId) { cands.push(s.start, s.start + s.length); }
    for (const c of cands) { const d = Math.abs(c - frame); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  function neighbours(t: Track, seg: AnySeg) {
    const list = segsOf(t).filter((s) => s.id !== seg.id).sort((a, b) => a.start - b.start);
    const prev = list.filter((s) => s.start + s.length <= seg.start + 0.001).pop();
    const next = list.find((s) => s.start >= seg.start + seg.length - 0.001);
    return { lo: prev ? prev.start + prev.length : 0, hi: next ? next.start : Infinity };
  }

  type Drag = { track: Track; seg: AnySeg; edge: "l" | "r" | "body"; x0: number; start0: number; len0: number; trim0: number; moved: boolean } | { scrub: true } | { pan: true; x0: number; scroll0: number };
  let drag: Drag | null = null;

  canvas.addEventListener("pointerdown", (e) => {
    canvas.focus();
    dismissMenu();
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (e.button === 2) return;
    if (e.button === 1) { drag = { pan: true, x0: e.clientX, scroll0: scrollF }; canvas.setPointerCapture(e.pointerId); return; }
    const t = trackAt(y);
    if (t === "ruler") { drag = { scrub: true }; playhead = clamp(Math.round(xf(x)), 0, frames); canvas.setPointerCapture(e.pointerId); stopAudio(); draw(); return; }
    const hh = hit(x, y);
    if (!hh) { select(t, null); return; }
    select(hh.track, hh.seg.id, e.shiftKey || e.ctrlKey || e.metaKey);
    drag = { track: hh.track, seg: hh.seg, edge: hh.edge, x0: x, start0: hh.seg.start, len0: hh.seg.length, trim0: hh.seg.trimStart || 0, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (!drag) { const hh = hit(x, y); canvas.style.cursor = hh ? (hh.edge === "body" ? "grab" : "ew-resize") : trackAt(y) === "ruler" ? "col-resize" : "pointer"; return; }
    if ("scrub" in drag) { playhead = clamp(Math.round(xf(x)), 0, frames); draw(); return; }
    if ("pan" in drag) { scrollF = drag.scroll0 - (e.clientX - drag.x0) / pxPerFrame(); clampScroll(); draw(); return; }
    const d = drag, dF = Math.round((x - d.x0) / pxPerFrame());
    const { lo, hi } = neighbours(d.track, d.seg);
    const limitHi = Math.min(hi, d.track === "image" ? Infinity : Infinity);
    if (!d.moved && Math.abs(x - d.x0) < 3) return;
    d.moved = true;
    const s = d.seg;
    if (d.edge === "body") {
      let ns = snapTo(d.start0 + dF, s.id, d.track);
      const ne = snapTo(ns + d.len0, s.id, d.track);
      if (ne !== ns + d.len0 && Math.abs(ne - (ns + d.len0)) < Math.abs(ns - (d.start0 + dF))) ns = ne - d.len0;
      s.start = clamp(ns, lo, Math.max(lo, limitHi - d.len0));
    } else if (d.edge === "r") {
      let end = snapTo(d.start0 + d.len0 + dF, s.id, d.track);
      end = clamp(end, d.start0 + MIN_LEN, Math.min(limitHi, d.start0 + maxLenOf(d.track, { ...s, trimStart: d.trim0 })));
      s.length = end - d.start0;
    } else {
      let ns = snapTo(d.start0 + dF, s.id, d.track);
      const endF = d.start0 + d.len0;
      let minStart = Math.max(lo, d.track === "image" ? -Infinity : d.start0 - d.trim0);
      ns = clamp(ns, minStart, endF - MIN_LEN);
      const delta = ns - d.start0;
      s.start = ns; s.length = endF - ns;
      if (d.track !== "image") s.trimStart = Math.max(0, d.trim0 + delta);
    }
    refreshPanels(); draw();
  });
  const endDrag = () => { const d = drag; drag = null; if (d && "seg" in d && d.moved) { normalizeTimes(); emit(); } };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || zoom > 1 || Math.abs(e.deltaY) > 0) {
      const r = canvas.getBoundingClientRect();
      if (e.shiftKey) { scrollF += (e.deltaY > 0 ? 1 : -1) * visibleFrames() * 0.1; clampScroll(); draw(); return; }
      setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), xf(e.clientX - r.left));
    }
  }, { passive: false });
  canvas.addEventListener("dblclick", (e) => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const t = trackAt(y);
    if (t === "ruler" || hit(x, y)) return;
    openGapMenu(e.clientX, e.clientY, t, Math.round(xf(x)));
  });
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const t = trackAt(y); if (t === "ruler") return;
    const hh = hit(x, y);
    if (hh) { if (!isSel(hh.track, hh.seg.id)) select(hh.track, hh.seg.id); openSegMenu(e.clientX, e.clientY, hh.track, hh.seg); }
    else openGapMenu(e.clientX, e.clientY, t, Math.round(xf(x)));
  });
  canvas.addEventListener("keydown", (e) => {
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") { const s = selected(); if (s) clipboard = { track: sel.track, seg: JSON.parse(JSON.stringify(s)) }; }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") { e.preventDefault(); pasteAtPlayhead(); }
    else if (e.key === " ") { e.preventDefault(); togglePlay(); }
    else if (e.key.toLowerCase() === "s" && !e.ctrlKey && !e.metaKey) { splitAtPlayhead(); }
    else if (e.key === "ArrowLeft") { playhead = clamp(playhead - (e.shiftKey ? 12 : 1), 0, frames); draw(); }
    else if (e.key === "ArrowRight") { playhead = clamp(playhead + (e.shiftKey ? 12 : 1), 0, frames); draw(); }
  });

  // ── menus ──────────────────────────────────────────────────────────────
  let menu: HTMLElement | null = null;
  function dismissMenu() { menu?.remove(); menu = null; }
  document.addEventListener("pointerdown", (e) => { if (menu && !menu.contains(e.target as Node)) dismissMenu(); }, true);
  function showMenu(x: number, y: number, items: [string, () => void][]) {
    dismissMenu();
    menu = h("div", { left: `${Math.min(x, window.innerWidth - 170)}px`, top: `${Math.min(y, window.innerHeight - items.length * 30 - 10)}px` }, { className: "prcs-menu" });
    for (const [text, fn] of items) { const b = h("button", {}, { type: "button", textContent: text }); b.addEventListener("click", () => { dismissMenu(); fn(); }); menu.append(b); }
    document.body.append(menu);
  }
  function openGapMenu(cx: number, cy: number, t: Track, atFrame: number) {
    const gap = gapAt(t, atFrame);
    const items: [string, () => void][] = [];
    if (t === "image") { items.push(["T  Add Text here", () => addText(gap.start, gap.end)]); items.push(["🖼  Add Image here", () => { playhead = gap.start; chooseImage(); }]); }
    if (t === "audio") items.push(["♪  Add Audio here", () => { playhead = gap.start; chooseAudio(); }]);
    if (t === "motion") items.push(["🎞  Add IC Video here", () => { playhead = gap.start; chooseMotion(); }]);
    items.push(["▏ Playhead here", () => { playhead = clamp(atFrame, 0, frames); draw(); }]);
    if (clipboard && clipboard.track === t) items.push(["⎘  Paste here", () => { playhead = gap.start; pasteAtPlayhead(); }]);
    showMenu(cx, cy, items);
  }
  function openSegMenu(cx: number, cy: number, t: Track, seg: AnySeg) {
    const items: [string, () => void][] = [["✂  Split at playhead", () => splitAtPlayhead()], ["⎘  Copy", () => { clipboard = { track: t, seg: JSON.parse(JSON.stringify(seg)) }; }], ["⧉  Duplicate", () => duplicate(t, seg)]];
    if (t === "image" && seg.type === "image") items.push([seg.isEndFrame ? "Image at segment start" : "Image at segment end", () => { seg.isEndFrame = !seg.isEndFrame; refreshPanels(); draw(); emit(); }]);
    items.push(["🗑  Delete", () => deleteSelected()]);
    showMenu(cx, cy, items);
  }
  function gapAt(t: Track, frame: number) {
    const list = segsOf(t).slice().sort((a, b) => a.start - b.start);
    let lo = 0, hi = frames;
    for (const s of list) { if (s.start + s.length <= frame) lo = Math.max(lo, s.start + s.length); else if (s.start >= frame) { hi = Math.min(hi, s.start); break; } }
    return { start: clamp(lo, 0, frames), end: Math.max(lo, hi) };
  }

  // ── operations ─────────────────────────────────────────────────────────
  function normalizeTimes() {
    for (const t of ["image", "audio", "motion"] as Track[]) segsOf(t).sort((a, b) => a.start - b.start);
    tl.normalStartFrame = 0; tl.normalDurationFrames = frames;
  }
  function freeSlot(t: Track, want: number, from: number): { start: number; length: number } {
    const g = gapAt(t, from);
    const len = Math.min(want, Math.max(MIN_LEN, g.end - g.start));
    if (g.end - g.start >= MIN_LEN) return { start: g.start, length: len };
    const list = segsOf(t); const endAll = list.reduce((m, s) => Math.max(m, s.start + s.length), 0);
    return { start: Math.min(endAll, Math.max(0, frames - MIN_LEN)), length: want };
  }
  function addText(from?: number, to?: number) {
    let start: number, length: number;
    if (from != null && to != null) { start = from; length = Math.max(MIN_LEN, Math.min(to - from, 72)); if (to - from < MIN_LEN) { start = from; length = MIN_LEN; } }
    else { const s = freeSlot("image", 48, playhead); start = s.start; length = s.length; }
    const seg = { id: newId(), start, length, prompt: "", type: "text" };
    tl.segments.push(seg); normalizeTimes(); select("image", seg.id); promptTA.focus(); emit();
  }
  async function addImageFile(file: File) {
    const imageFile = await uploadAsset(file);
    const url = URL.createObjectURL(file);
    const s = freeSlot("image", 24, playhead);
    const seg = { id: newId(), start: s.start, length: Math.max(MIN_LEN, s.length), prompt: "", type: "image", isAnchor: false, imageFile, imageB64: "", isEndFrame: false, guideStrength: 1 };
    const im = new Image(); im.onload = () => draw(); im.src = url; imgCache.set(url, im); (seg as any).imageB64 = ""; imgCache.set(viewUrl(imageFile), im);
    tl.segments.push(seg); normalizeTimes(); select("image", seg.id);
  }
  async function peaksOf(buf: AudioBuffer, n = 200) {
    const d = buf.getChannelData(0), step = Math.max(1, Math.floor(d.length / n)), out: number[] = [];
    for (let i = 0; i < n; i++) { let m = 0; for (let j = 0; j < step; j++) m = Math.max(m, Math.abs(d[i * step + j] || 0)); out.push(m); }
    return out;
  }
  async function addAudioFile(file: File) {
    try {
      const audioFile = await uploadAsset(file);
      actx = actx || new AudioContext();
      const buf = await actx.decodeAudioData(await file.arrayBuffer());
      bufCache.set(audioFile, Promise.resolve(buf));
      const frs = Math.max(1, Math.ceil(buf.duration * FPS));
      const s = freeSlot("audio", frs, playhead);
      const seg = { id: newId(), type: "audio", start: s.start, length: Math.min(frs, Math.max(MIN_LEN, frs)), trimStart: 0, audioDurationFrames: frs, audioFile, fileName: file.name, waveformPeaks: await peaksOf(buf) };
      tl.audioSegments.push(seg); normalizeTimes(); select("audio", seg.id); emit();
    } catch (e) { console.error("[ltx25 timeline] audio add failed", e); }
  }
  async function addMotionFile(file: File) {
    const blobUrl = URL.createObjectURL(file);
    const vid = document.createElement("video"); vid.preload = "auto"; vid.muted = true; vid.src = blobUrl;
    const meta = await new Promise<{ dur: number; thumb: string }>((resolve) => {
      vid.onloadedmetadata = () => { vid.currentTime = Math.min(0.05, vid.duration / 2); };
      vid.onseeked = () => { const c = document.createElement("canvas"); c.width = Math.min(vid.videoWidth, 320); c.height = Math.round((vid.videoHeight / vid.videoWidth) * c.width); c.getContext("2d")!.drawImage(vid, 0, 0, c.width, c.height); resolve({ dur: vid.duration, thumb: c.toDataURL("image/jpeg", 0.7) }); };
      vid.onerror = () => resolve({ dur: 3, thumb: "" });
    });
    const frs = Math.max(1, Math.ceil(meta.dur * FPS));
    const s = freeSlot("motion", frs, playhead);
    const seg: AnySeg = { id: newId(), type: "motion_video", start: s.start, length: Math.max(MIN_LEN, s.length), trimStart: 0, videoDurationFrames: frs, videoFile: "", fileName: file.name, videoStrength: 1, videoAttentionStrength: 0.65, resampleMode: "nearest", imageB64: meta.thumb, _uploading: true };
    tl.motionSegments.push(seg); normalizeTimes(); select("motion", seg.id);
    try { seg.videoFile = await uploadMotionFile(file); } catch (e) { console.error("[ltx25 timeline] video upload failed", e); }
    seg._uploading = false; draw(); emit();
  }
  async function uploadMotionFile(file: File): Promise<string> {
    const CHUNK = 50 * 1024 * 1024;
    const safe = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    if (file.size <= CHUNK) return uploadAsset(file);
    const name = `${Date.now()}_${safe}`, total = Math.ceil(file.size / CHUNK);
    for (let i = 0; i < total; i++) {
      const fd = new FormData();
      fd.append("file", file.slice(i * CHUNK, (i + 1) * CHUNK)); fd.append("filename", name); fd.append("chunk_index", String(i)); fd.append("total_chunks", String(total));
      const r = await comfyApi.fetchApi("/ltx25_one/director/upload_chunk", { method: "POST", body: fd });
      if (!r.ok) throw new Error("video chunk upload failed");
    }
    return name;
  }
  function deleteSelected() {
    if (!sel.ids.length) return;
    const list = segsOf(sel.track);
    for (const id of sel.ids) { const i = list.findIndex((s) => s.id === id); if (i >= 0) list.splice(i, 1); }
    sel = { track: sel.track, ids: [] }; refreshPanels(); draw(); emit();
  }
  function splitAtPlayhead() {
    const t = sel.track, seg = selected();
    if (!seg || playhead <= seg.start + MIN_LEN - 1 || playhead >= seg.start + seg.length - MIN_LEN + 1) return;
    const cut = playhead - seg.start;
    const second: AnySeg = JSON.parse(JSON.stringify(seg));
    second.id = newId(); second.start = playhead; second.length = seg.length - cut;
    if (t !== "image") second.trimStart = (seg.trimStart || 0) + cut;
    if (t === "image" && seg.type === "image") { second.type = "text"; second.imageFile = ""; second.imageB64 = ""; delete second.guideStrength; delete second.isEndFrame; second.isAnchor = false; }
    seg.length = cut;
    if (t === "audio") second.waveformPeaks = seg.waveformPeaks;
    segsOf(t).push(second); normalizeTimes(); select(t, second.id); emit();
  }
  function duplicate(t: Track, seg: AnySeg) {
    const copy: AnySeg = JSON.parse(JSON.stringify(seg)); copy.id = newId();
    const g = gapAt(t, seg.start + seg.length);
    if (g.end - g.start < MIN_LEN) return;
    copy.start = g.start; copy.length = Math.min(copy.length, g.end - g.start);
    segsOf(t).push(copy); normalizeTimes(); select(t, copy.id); emit();
  }
  function pasteAtPlayhead() {
    if (!clipboard) return;
    const t = clipboard.track, copy: AnySeg = JSON.parse(JSON.stringify(clipboard.seg)); copy.id = newId();
    const g = gapAt(t, playhead);
    if (g.end - g.start < MIN_LEN) return;
    copy.start = g.start; copy.length = Math.min(copy.length, g.end - g.start);
    segsOf(t).push(copy); normalizeTimes(); select(t, copy.id); emit();
  }

  // ── transport ──────────────────────────────────────────────────────────
  function updateTransportUI() {
    timeLbl.textContent = `${fmtTime(playhead)} / ${fmtTime(frames)}`;
    seek.value = String(Math.round((playhead / Math.max(1, frames)) * 1000));
    playBtn.textContent = playing ? "⏸" : "▶";
  }
  seek.addEventListener("input", () => { playhead = Math.round((parseFloat(seek.value) / 1000) * frames); if (playing) { stopAudio(); startAudio(); playStamp = performance.now(); playFrom = playhead; } draw(); });
  zSlider.addEventListener("input", () => setZoom(parseFloat(zSlider.value)));
  function bufferFor(seg: AnySeg): Promise<AudioBuffer | null> {
    const key = seg.audioFile as string;
    if (!bufCache.has(key)) {
      actx = actx || new AudioContext();
      bufCache.set(key, fetch(viewUrl(key), { credentials: "include" }).then((r) => r.arrayBuffer()).then((b) => actx!.decodeAudioData(b)).catch(() => null));
    }
    return bufCache.get(key)!;
  }
  function stopAudio() { for (const n of audioNodes) { try { n.stop(); } catch { /* already stopped */ } } audioNodes = []; }
  async function startAudio() {
    if (!trackOn("audio")) return;
    actx = actx || new AudioContext(); await actx.resume().catch(() => {});
    for (const seg of tl.audioSegments as AnySeg[]) {
      const endF = seg.start + seg.length; if (endF <= playhead) continue;
      const buf = await bufferFor(seg); if (!buf || !playing) continue;
      const src = actx.createBufferSource(); src.buffer = buf; src.connect(actx.destination);
      const lead = Math.max(0, (seg.start - playhead) / FPS), into = Math.max(0, (playhead - seg.start) / FPS);
      src.start(actx.currentTime + lead, ((seg.trimStart || 0) / FPS) + into, Math.max(0.01, (seg.length / FPS) - into));
      audioNodes.push(src);
    }
  }
  function tick(now: number) {
    if (!playing) return;
    playhead = playFrom + ((now - playStamp) / 1000) * FPS;
    if (playhead >= frames) { if (loop) { playhead = 0; playFrom = 0; playStamp = now; stopAudio(); void startAudio(); } else { playhead = frames; stopPlay(); draw(); return; } }
    if (playhead > scrollF + visibleFrames() || playhead < scrollF) { scrollF = playhead - visibleFrames() * 0.1; clampScroll(); }
    draw(); rafId = requestAnimationFrame(tick);
  }
  function togglePlay() { playing ? stopPlay() : startPlay(); }
  function startPlay() { if (playhead >= frames) playhead = 0; playing = true; playFrom = playhead; playStamp = performance.now(); void startAudio(); rafId = requestAnimationFrame(tick); updateTransportUI(); }
  function stopPlay() { playing = false; cancelAnimationFrame(rafId); stopAudio(); updateTransportUI(); }

  // ── data out ───────────────────────────────────────────────────────────
  function widgets(): Record<string, any> {
    normalizeTimes();
    const sorted = mainSegs();
    const lengths: number[] = [], prompts: string[] = [];
    let cursor = 0, pending = 0;
    for (const seg of sorted) {
      if (seg.start + seg.length <= 0) continue;
      if (seg.start >= frames) break;
      const endC = Math.min(seg.start + seg.length, frames), startC = Math.max(seg.start, 0);
      if (seg.isAnchor) {   // guide-only: its span is absorbed into the previous prompt
        const absorb = endC - cursor;
        if (absorb > 0) { if (lengths.length) lengths[lengths.length - 1] += absorb; else pending += absorb; }
        cursor = Math.max(cursor, seg.start + seg.length);
        continue;
      }
      if (startC > cursor) { const gap = Math.min(startC, frames) - cursor; if (lengths.length) lengths[lengths.length - 1] += gap; else pending += gap; }
      lengths.push(endC - startC + pending); prompts.push(seg.prompt || ""); pending = 0;
      cursor = Math.max(cursor, seg.start + seg.length);
    }
    const clamped = Math.min(cursor, frames);
    if (lengths.length && clamped < frames) lengths[lengths.length - 1] += frames - clamped;
    const strengths = sorted.filter((s) => s.type !== "text" && s.start + s.length > 0 && s.start < frames).map((s) => (s.guideStrength ?? 1).toFixed(2));
    const save = { ...tl, segments: sorted.map(strip), motionSegments: (tl.motionSegments as AnySeg[]).map(strip), audioSegments: (tl.audioSegments as AnySeg[]).map(strip), overrideAudio, inpaint_audio: inpaintAudio, normalStartFrame: 0, normalDurationFrames: frames, disable_prompt_relay: false };
    tl.inpaint_audio = inpaintAudio;
    return {
      timeline_data: JSON.stringify(save),
      local_prompts: prompts.join(" | "),
      segment_lengths: lengths.join(","),
      guide_strength: strengths.join(","),
      epsilon: 0.001, use_custom_audio: trackOn("audio"), use_custom_motion: trackOn("motion"), inpaint_audio: inpaintAudio, override_audio: overrideAudio,
    };
  }
  const strip = (s: AnySeg) => { const { _uploading, _blobUrl, _audioBuffer, ...rest } = s; return rest; };

  /** Re-time to a new clip length: main segments keep their proportions, audio / video clips keep their place. */
  function retime(newFrames: number) {
    if (newFrames === frames) return;
    const k = newFrames / frames;
    for (const s of tl.segments as AnySeg[]) { s.start = Math.round(s.start * k); s.length = Math.max(MIN_LEN, Math.round(s.length * k)); }
    frames = newFrames; scrollF = 0; zoom = 1; zSlider.value = "1";
    for (const s of tl.segments as AnySeg[]) { if (s.start + s.length > frames) s.length = Math.max(1, frames - s.start); }
    normalizeTimes();
  }

  // ── resize observer ────────────────────────────────────────────────────
  new ResizeObserver(() => { draw(); }).observe(canvasBox);
  buildSidebar(); paintToggles(); refreshPanels();

  // ── public surface (what Prompt Edit drives) ───────────────────────────
  return {
    el: root,
    snapshot(): TimelineSnapshot { return { widgets: widgets() }; },
    async load(dir: any, opts: { frames?: number; text?: string } = {}) {
      stopPlay();
      const w = dir?.widgets || {};
      let parsed: any = null;
      try { parsed = JSON.parse(w.timeline_data || "null"); } catch { parsed = null; }
      tl = parsed && typeof parsed === "object" ? parsed : emptyTimeline("", dir?.frames || opts.frames || 121);
      for (const k of ["segments", "motionSegments", "audioSegments"]) if (!Array.isArray(tl[k])) tl[k] = [];
      for (const s of tl.segments as AnySeg[]) { if (!s.id) s.id = newId(); if (s.type !== "text" && s.type !== "image" && s.type !== "video") s.type = "text"; }
      for (const s of tl.motionSegments as AnySeg[]) { if (!s.id) s.id = newId(); }
      for (const s of tl.audioSegments as AnySeg[]) { if (!s.id) s.id = newId(); }
      // strengths saved in the widget string win over missing per-segment values
      const vals = String(w.guide_strength || "").split(",").map((x) => parseFloat(x)).filter((v) => !Number.isNaN(v));
      mainSegs().filter((s) => s.type !== "text").forEach((s, i) => { if (s.guideStrength === undefined && vals[i] != null) s.guideStrength = vals[i]; });
      overrideAudio = !!(w.override_audio ?? tl.overrideAudio); inpaintAudio = (w.inpaint_audio ?? tl.inpaint_audio) !== false;
      if (w.use_custom_audio !== undefined) tl.audioTrackEnabled = !!w.use_custom_audio;
      if (w.use_custom_motion !== undefined) tl.motionTrackEnabled = !!w.use_custom_motion;
      frames = Math.max(1, Number(tl.normalDurationFrames) || Number(dir?.frames) || opts.frames || 121);
      if (opts.text != null) tl.global_prompt = opts.text;
      sel = { track: "image", ids: [] }; playhead = 0; scrollF = 0; zoom = 1; zSlider.value = "1";
      if (opts.frames) retime(opts.frames); else normalizeTimes();
      paintToggles(); paintSidebar(); refreshPanels(); draw();
    },
    async setText(text: string) { tl.global_prompt = text; },
    async setLength(newFrames: number) { retime(newFrames); draw(); refreshPanels(); },
    async addImageFile(file: File) { await addImageFile(file); },
    async addImageButton(): Promise<HTMLElement> { return addImgBtn; },
    async selectedSegment(): Promise<{ index: number; prompt: string; start: number; end: number } | null> {
      const seg = selected();
      if (!seg || sel.track !== "image" || seg.isAnchor) return null;
      const list = mainSegs().filter((s) => !s.isAnchor);
      return { index: list.findIndex((s) => s.id === seg.id), prompt: seg.prompt || "", start: seg.start / FPS, end: (seg.start + seg.length) / FPS };
    },
    async setSegmentPrompt(index: number, text: string) {
      const seg = mainSegs().filter((s) => !s.isAnchor)[index];
      if (seg) { seg.prompt = text; if (selected()?.id === seg.id) promptTA.value = text; draw(); }
    },
  };
}
