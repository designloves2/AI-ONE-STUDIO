// timelineHost.ts — the LTX Director segment timeline editor of the web twin, written from the data format in
// SPEC_LTX25_ONE_STUDIO_WEB.md only (no code from the node's Director folder; rule W1).
//
// One clip's timeline = beats (text segments, contiguous, each with a prompt) plus pinned images (image segments with a
// start, or pinned to the clip's last frame, and a guide strength). snapshot() returns the widget values the
// LTXDirectorTJ25 node takes: { timeline_data, local_prompts, segment_lengths, guide_strength, ... } at 24 fps.
import { C, BRAND } from "../../identity";
import { emptyTimeline, FPS } from "./core";
import { uploadImage } from "./api";
import { comfyApi } from "./comfyClient";

const MIN_BEAT = 8;       // frames
const IMG_LEN = 24;       // default length of an image pin

type Seg = { id: string; start: number; length: number; prompt: string; type: "text" | "image"; imageFile?: string; imageB64?: string; isAnchor?: boolean; isEndFrame?: boolean };

let uid = 0;
const newId = () => `tj-w${Date.now().toString(36)}${(uid++).toString(36)}`;

export interface TimelineSnapshot { widgets: Record<string, any> }

function h<K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration> = {}, props: Record<string, any> = {}, kids: (Node | string)[] = []) {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  for (const k in props) { if (k === "text") e.textContent = props[k]; else if (k === "class") e.className = props[k]; else (e as any)[k] = props[k]; }
  for (const c of kids) e.append(c);
  return e;
}

export function createTimelineHost({ onChange }: { onChange?: () => void } = {}) {
  let tl: any = emptyTimeline("", 121);
  let frames = 121;
  let selected: string | null = null;
  let playhead = 0;
  const guides = new Map<string, number>();   // image segment id -> guide strength (1 = default)
  const emit = () => { try { onChange?.(); } catch { /* the host keeps working */ } };

  const textSegs = (): Seg[] => (tl.segments as Seg[]).filter((s) => s.type === "text").sort((a, b) => a.start - b.start);
  const imageSegs = (): Seg[] => (tl.segments as Seg[]).filter((s) => s.type === "image").sort((a, b) => a.start - b.start);

  /** Beats stay contiguous from frame 0 to the end of the clip. */
  function normalize() {
    const beats = textSegs();
    let at = 0;
    beats.forEach((b, k) => {
      b.start = at;
      const last = k === beats.length - 1;
      b.length = last ? Math.max(1, frames - at) : Math.max(MIN_BEAT, Math.round(b.length));
      at += b.length;
    });
    // an over-long middle: squeeze from the end so the last beat keeps at least MIN_BEAT
    if (beats.length > 1 && beats[beats.length - 1].length < MIN_BEAT) {
      let over = MIN_BEAT - beats[beats.length - 1].length;
      for (let k = beats.length - 2; k >= 0 && over > 0; k--) {
        const take = Math.min(over, beats[k].length - MIN_BEAT);
        if (take > 0) { beats[k].length -= take; over -= take; }
      }
      let a2 = 0;
      beats.forEach((b, k) => { b.start = a2; if (k === beats.length - 1) b.length = Math.max(1, frames - a2); a2 += b.length; });
    }
    for (const im of imageSegs()) {
      im.length = Math.max(1, im.length || IMG_LEN);
      if (im.isEndFrame) im.start = Math.max(0, frames - im.length);
      else im.start = Math.max(0, Math.min(frames - 1, Math.round(im.start)));
    }
    tl.normalStartFrame = 0;
    tl.normalDurationFrames = frames;
    tl.disable_prompt_relay = beats.length === 0;   // the beats only take effect with prompt relay on
  }

  function widgets(): Record<string, any> {
    normalize();
    const beats = textSegs();
    const imgs = imageSegs();
    const strengths = imgs.map((s) => guides.get(s.id) ?? 1);
    return {
      timeline_data: JSON.stringify(tl),
      local_prompts: beats.map((b) => b.prompt).join(" | "),
      segment_lengths: beats.map((b) => b.length).join(","),
      guide_strength: strengths.every((v) => v === 1) ? "" : strengths.map((v) => v.toFixed(2)).join(","),
      epsilon: 0.001, use_custom_audio: false, use_custom_motion: false, inpaint_audio: true, override_audio: false,
    };
  }

  // ── DOM ────────────────────────────────────────────────────────────────
  const root = h("div", { display: "flex", flexDirection: "column", gap: "6px", padding: "8px", boxSizing: "border-box", height: "100%", minHeight: "0", overflowY: "auto", color: C.text, fontSize: "12px" });
  root.append(h("style", {}, { textContent: `.prcs-btn{cursor:pointer;font-family:inherit;font-size:11px;padding:4px 9px;border-radius:5px;background:${C.bg2};color:${C.text};border:1px solid ${C.border}}.prcs-btn:hover{background:${C.bg3}}` }));

  const bar = h("div", { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" });
  const mkBtn = (text: string, title: string, fn: () => void) => { const b = h("button", {}, { type: "button", className: "prcs-btn", textContent: text, title }); b.addEventListener("click", fn); return b; };
  const addBeatBtn = mkBtn("＋ Beat", "Split the selected beat in two (or the last one)", () => { addBeat(); });
  const delBtn = mkBtn("🗑 Delete", "Delete the selected beat / image", () => { removeSelected(); });
  const addImgBtn = mkBtn("🖼 Add Image", "Add an image at the playhead", () => fileIn.click());
  const fileIn = h("input", { display: "none" }, { type: "file", accept: "image/*" }) as HTMLInputElement;
  fileIn.addEventListener("change", async () => { const f = fileIn.files?.[0]; fileIn.value = ""; if (f) { await addImageFile(f); emit(); } });
  const timeNote = h("div", { color: C.muted, fontSize: "10.5px", marginLeft: "auto" });
  bar.append(addBeatBtn, addImgBtn, delBtn, fileIn, timeNote);

  const ruler = h("div", { position: "relative", height: "18px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", flexShrink: "0" });
  const beatLane = h("div", { position: "relative", height: "46px", background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "6px", flexShrink: "0" });
  const imgLane = h("div", { position: "relative", height: "40px", background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "6px", flexShrink: "0" });
  const laneLbl = (t: string) => h("div", { fontSize: "9.5px", color: C.muted, letterSpacing: "0.05em" }, { textContent: t });
  const detail = h("div", { display: "flex", flexDirection: "column", gap: "6px", flexShrink: "0" });
  root.append(bar, ruler, laneLbl("PROMPT BEATS (prompt relay)"), beatLane, laneLbl("IMAGES (guides)"), imgLane, detail);

  const pct = (f: number) => `${(f / frames) * 100}%`;
  const fromX = (lane: HTMLElement, clientX: number) => { const r = lane.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) * frames); };

  function render() {
    normalize();
    ruler.replaceChildren();
    const secs = frames / FPS;
    const step = secs > 16 ? 4 : secs > 8 ? 2 : 1;
    for (let s = 0; s <= secs + 1e-6; s += step) {
      const t = h("div", { position: "absolute", left: pct(s * FPS), top: "0", bottom: "0", borderLeft: `1px solid ${C.border}`, paddingLeft: "3px", fontSize: "9.5px", color: C.muted, pointerEvents: "none" }, { textContent: `${s}s` });
      ruler.append(t);
    }
    const ph = h("div", { position: "absolute", left: pct(playhead), top: "0", bottom: "-130px", width: "2px", background: BRAND, pointerEvents: "none", zIndex: "3" });
    ruler.append(ph);
    timeNote.textContent = `${secs.toFixed(2)} s · ${frames} frames · playhead ${(playhead / FPS).toFixed(2)} s`;

    beatLane.replaceChildren();
    const beats = textSegs();
    beats.forEach((b, k) => {
      const on = selected === b.id;
      const blk = h("div", { position: "absolute", left: pct(b.start), width: pct(b.length), top: "3px", bottom: "3px", boxSizing: "border-box", background: on ? "#5a2aa0" : "#3b2468", border: `1px solid ${on ? BRAND : "#4a3380"}`, borderRadius: "5px", overflow: "hidden", cursor: "pointer", padding: "2px 6px", fontSize: "10.5px" },
        { title: b.prompt || "(empty beat)" }, [`${k + 1}. ${b.prompt || "…"}`]);
      blk.addEventListener("click", () => { selected = b.id; render(); });
      beatLane.append(blk);
      if (k < beats.length - 1) {   // drag the cut between this beat and the next
        const cut = h("div", { position: "absolute", left: `calc(${pct(b.start + b.length)} - 4px)`, width: "8px", top: "0", bottom: "0", cursor: "ew-resize", zIndex: "2" });
        cut.addEventListener("pointerdown", (e) => {
          e.preventDefault(); cut.setPointerCapture(e.pointerId);
          const move = (ev: PointerEvent) => {
            const f = fromX(beatLane, ev.clientX);
            const lo = b.start + MIN_BEAT, hi = beats[k + 1].start + beats[k + 1].length - MIN_BEAT;
            const nf = Math.max(lo, Math.min(hi, f));
            const delta = nf - (b.start + b.length);
            if (!delta) return;
            b.length += delta; beats[k + 1].start += delta; beats[k + 1].length -= delta;
            render();
          };
          const up = () => { cut.removeEventListener("pointermove", move); cut.removeEventListener("pointerup", up); emit(); };
          cut.addEventListener("pointermove", move); cut.addEventListener("pointerup", up);
        });
        beatLane.append(cut);
      }
    });
    if (!beats.length) beatLane.append(h("div", { position: "absolute", inset: "0", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: "10.5px" }, { textContent: "No beats yet — ＋ Beat adds the first one (the clip prompt covers the whole clip until then)." }));

    imgLane.replaceChildren();
    for (const im of imageSegs()) {
      const on = selected === im.id;
      const pin = h("div", { position: "absolute", left: pct(im.start), width: `max(26px, ${pct(im.length)})`, top: "3px", bottom: "3px", boxSizing: "border-box", background: on ? "#245a3c" : "#1d3d2b", border: `1px solid ${on ? "#5fd38d" : "#2c6a45"}`, borderRadius: "5px", overflow: "hidden", cursor: "grab", display: "flex", alignItems: "center", gap: "4px", padding: "0 3px", fontSize: "10px" },
        { title: `${im.imageFile}${im.isEndFrame ? " (last frame)" : ""}` });
      const thumb = h("img", { height: "30px", width: "30px", objectFit: "cover", borderRadius: "3px", flexShrink: "0" }, { src: `${comfyApi.base}/view?filename=${encodeURIComponent(im.imageFile || "")}&type=input` });
      pin.append(thumb, h("span", { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, { textContent: im.isEndFrame ? "◀ last" : `${(im.start / FPS).toFixed(1)}s` }));
      pin.addEventListener("click", () => { selected = im.id; render(); });
      pin.addEventListener("pointerdown", (e) => {
        if (im.isEndFrame) return;
        e.preventDefault(); pin.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => { im.start = Math.min(frames - 1, fromX(imgLane, ev.clientX)); render(); };
        const up = () => { pin.removeEventListener("pointermove", move); pin.removeEventListener("pointerup", up); emit(); };
        pin.addEventListener("pointermove", move); pin.addEventListener("pointerup", up);
      });
      imgLane.append(pin);
    }

    renderDetail();
  }

  function renderDetail() {
    detail.replaceChildren();
    const seg = (tl.segments as Seg[]).find((s) => s.id === selected);
    if (!seg) { detail.append(h("div", { color: C.muted, fontSize: "10.5px" }, { textContent: "Click a beat or an image. Click the ruler to place the playhead (new images are added there)." })); return; }
    if (seg.type === "text") {
      const ta = h("textarea", { width: "100%", minHeight: "70px", boxSizing: "border-box", background: C.bg1, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px 8px", fontSize: "12px", fontFamily: "inherit", resize: "vertical", outline: "none" }, { placeholder: "What happens in this beat…", value: seg.prompt }) as HTMLTextAreaElement;
      ta.addEventListener("input", () => { seg.prompt = ta.value; renderBeatsOnlyLabel(); emit(); });
      const idx = textSegs().indexOf(seg);
      detail.append(h("div", { color: C.muted, fontSize: "10.5px" }, { textContent: `Beat ${idx + 1} · ${(seg.start / FPS).toFixed(2)} – ${((seg.start + seg.length) / FPS).toFixed(2)} s (${seg.length} frames)` }), ta);
    } else {
      const strength = h("input", { width: "70px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "5px", padding: "3px 6px" }, { type: "number", min: "0", max: "1", step: "0.05", value: String(guides.get(seg.id) ?? 1) }) as HTMLInputElement;
      strength.addEventListener("change", () => { guides.set(seg.id, Math.max(0, Math.min(1, parseFloat(strength.value) || 1))); emit(); });
      const endChk = h("input", {}, { type: "checkbox", checked: !!seg.isEndFrame }) as HTMLInputElement;
      endChk.addEventListener("change", () => { seg.isEndFrame = endChk.checked; render(); emit(); });
      detail.append(
        h("div", { color: C.muted, fontSize: "10.5px" }, { textContent: `Image ${seg.imageFile}` }),
        h("div", { display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }, {}, [
          h("label", { display: "flex", gap: "5px", alignItems: "center" }, {}, [endChk, "pin to the last frame"]),
          h("label", { display: "flex", gap: "5px", alignItems: "center" }, {}, ["guide strength", strength]),
        ]));
    }
  }
  function renderBeatsOnlyLabel() { render(); }

  ruler.addEventListener("click", (e) => { playhead = Math.min(frames - 1, fromX(ruler, e.clientX)); render(); });

  // ── operations ─────────────────────────────────────────────────────────
  function addBeat(prompt = "") {
    const beats = textSegs();
    if (!beats.length) {
      tl.segments.push({ id: newId(), start: 0, length: frames, prompt: prompt || tl.global_prompt || "", type: "text" });
    } else {
      const target = beats.find((b) => b.id === selected) || beats[beats.length - 1];
      const half = Math.floor(target.length / 2);
      if (half < MIN_BEAT) return;
      const rest = target.length - half;
      target.length = half;
      tl.segments.push({ id: newId(), start: target.start + half, length: rest, prompt, type: "text" });
    }
    normalize();
    selected = textSegs()[textSegs().length ? Math.min(textSegs().length - 1, (textSegs().findIndex((b) => b.id === selected)) + 1) : 0]?.id ?? selected;
    render(); emit();
  }
  function removeSelected() {
    const seg = (tl.segments as Seg[]).find((s) => s.id === selected);
    if (!seg) return;
    if (seg.type === "text") {
      const beats = textSegs();
      const k = beats.indexOf(seg);
      const into = beats[k - 1] || beats[k + 1];
      if (into) into.length += seg.length;
    }
    tl.segments = (tl.segments as Seg[]).filter((s) => s.id !== seg.id);
    guides.delete(seg.id);
    selected = null;
    render(); emit();
  }
  async function addImageFile(file: File) {
    const name = await uploadImage(file);
    if (!name) return;
    tl.segments.push({ id: newId(), start: playhead, length: IMG_LEN, prompt: "", type: "image", isAnchor: false, imageFile: name, imageB64: "", isEndFrame: false });
    selected = (tl.segments[tl.segments.length - 1] as Seg).id;
    render();
  }

  /** Re-time to a new clip length: beats keep their proportions, images keep their place (end-pinned ones stay at the end). */
  function retime(newFrames: number) {
    if (newFrames === frames) return;
    const k = newFrames / frames;
    for (const b of textSegs()) { b.start = Math.round(b.start * k); b.length = Math.max(MIN_BEAT, Math.round(b.length * k)); }
    for (const im of imageSegs()) { if (!im.isEndFrame) im.start = Math.min(newFrames - 1, Math.round(im.start * k)); }
    frames = newFrames;
    normalize();
  }

  // ── public surface (what Prompt Edit drives) ───────────────────────────
  return {
    el: root,
    snapshot(): TimelineSnapshot { return { widgets: widgets() }; },
    async load(dir: any, opts: { frames?: number; text?: string } = {}) {
      const w = dir?.widgets || {};
      try { const parsed = JSON.parse(w.timeline_data || "null"); tl = parsed && typeof parsed === "object" ? parsed : emptyTimeline("", dir?.frames || opts.frames || 121); }
      catch { tl = emptyTimeline("", dir?.frames || opts.frames || 121); }
      if (!Array.isArray(tl.segments)) tl.segments = [];
      frames = Math.max(1, Number(tl.normalDurationFrames) || Number(dir?.frames) || opts.frames || 121);
      guides.clear();
      const vals = String(w.guide_strength || "").split(",").map((x) => parseFloat(x)).filter((v) => !Number.isNaN(v));
      imageSegs().forEach((s, i) => { if (vals[i] != null) guides.set(s.id, vals[i]); });
      if (opts.text != null) tl.global_prompt = opts.text;
      selected = null; playhead = 0;
      if (opts.frames) retime(opts.frames); else normalize();
      render();
    },
    async setText(text: string) { tl.global_prompt = text; },
    async setLength(newFrames: number) { retime(newFrames); render(); },
    async addImageFile(file: File) { await addImageFile(file); },
    async addImageButton(): Promise<HTMLElement> { return addImgBtn; },
    async selectedSegment(): Promise<{ index: number; prompt: string; start: number; end: number } | null> {
      const seg = (tl.segments as Seg[]).find((s) => s.id === selected);
      if (!seg || seg.type !== "text") return null;
      return { index: textSegs().indexOf(seg), prompt: seg.prompt || "", start: seg.start / FPS, end: (seg.start + seg.length) / FPS };
    },
    async setSegmentPrompt(index: number, text: string) {
      const seg = textSegs()[index];
      if (seg) { seg.prompt = text; render(); }
    },
  };
}
