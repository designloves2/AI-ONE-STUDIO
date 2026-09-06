// view.ts — MusicMaker ONE STUDIO (TJ), 웹 이식판.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/one_node_music.js (_buildUI) — 디자인/LLM 흐름을
// 그대로 미러링한다. 노드는 ComfyUI 위젯 안(고정 1280×994)이었고, 웹은 콘텐츠 영역을 꽉
// 채운다는 점만 다르다. `.mmm-*` 스타일 블록, SUNO 레이아웃(좌 compose / 우 playlist / 하
// player bar), 생성 큐, LLM 3-백엔드 흐름은 원본과 동일.
//
// LLM: local / openrouter 는 POST /music_one/llm/run (서버측), comfy 는 원본대로
// TextGenerate 그래프를 큐에 넣어 처리 — 웹은 API 키를 들지 않는다.
import {
  C, BRAND, LEFT_W, PLAYER_H, PAD, API, SUBFOLDER, ensureMusicStyles,
  el, clear, loadState, saveState, defaultState, randomSeed,
  SAMPLERS, SCHEDULERS, AUDIO_FORMATS, STYLE_CHIPS, LYRIC_TAGS,
  DURATION_MIN, DURATION_MAX, LLM_BACKENDS, LLM_CLIP_TYPES, lyricsIntent, fmtDur, settingsBadge,
  ENGINES, ENGINE_FIELDS, ACE_LANGUAGES, ACE_KEYSCALES, ACE_TIMESIGS,
  VOCAL_GENDER, VOCAL_STYLE, VOICE_TONE,
} from "./core";
import { buildMusicGraph, effectiveDuration } from "./graphBuilder";
import { comfyApi, jget, jpost, playableAudioUrl } from "./api";
import { takeReuse } from "../../shared/galleryHandoff";
import { attachSensitiveToggle, mediaKey } from "../../shared/sensitiveMedia";

const UNIQUE_ID = "music_web";

export function renderMusic(container: HTMLElement) {
  clear(container);
  container.style.background = C.bg0;

  const state: any = defaultState(loadState());
  const persist = () => saveState(state);
  const ctx: any = { availability: {}, models: {}, prompts: {} };
  const CAPTION_ROLE = () => (state.engine === "acestep" ? "caption_acestep" : "caption_minimax");
  const SUB = () => (state.saveSubfolder || "").trim().replace(/^[\/\\]+|[\/\\]+$/g, "") || SUBFOLDER;

  function switchEngine(next: string) {
    if (next === state.engine) return;
    const cur: any = {};
    ENGINE_FIELDS.forEach((k) => { cur[k] = state[k]; });
    state.engineStash[state.engine] = cur;
    const restore = state.engineStash[next] || {};
    const fresh = defaultState({});
    ENGINE_FIELDS.forEach((k) => { state[k] = (k in restore) ? restore[k] : fresh[k]; });
    state.engine = next;
    persist();
  }

  ensureMusicStyles();

  // ── styled form helpers (SUNO tone) ────────────────────────────────────────
  function fld(value: any, oninput: (v: any) => void, { ph = "", ta = false, num = false }: any = {}) {
    const e: any = el(ta ? "textarea" : "input", { className: "mmm-fld", placeholder: ph });
    if (num) e.type = "number";
    e.value = value ?? "";
    e.addEventListener("input", () => oninput(num ? (e.value === "" ? 0 : +e.value) : e.value));
    return e;
  }
  function sel(opts: any[], cur: any, onchange: (v: any) => void) {
    const e: any = el("select", { className: "mmm-sel" });
    opts.forEach((o) => {
      const v = typeof o === "string" ? o : o.value;
      const l = typeof o === "string" ? o : o.label;
      const op: any = el("option", { text: l }); op.value = v; e.appendChild(op);
    });
    e.value = cur;
    e.addEventListener("change", () => onchange(e.value));
    return e;
  }
  function fieldCol(lblText: string, node: any) {
    const c = el("div");
    c.appendChild(el("label", { className: "mmm-lbl", text: lblText }));
    c.appendChild(node);
    return c;
  }
  function searchSel(options: string[], value: string, onChange: (v: string) => void, { placeholder = "filter…" }: any = {}) {
    const wrap = el("div", { className: "mmm-ss" });
    const opts = ["none", ...options.filter((o) => o && o !== "none")];
    let cur = value && opts.includes(value) ? value : "none";
    const f: any = el("input", { className: "f", type: "text", placeholder });
    const s: any = el("select");
    const shortName = (o: string) => o === "none" ? "— none —" : o.split(/[\\/]/).pop();
    function build(q: string) {
      const ql = (q || "").toLowerCase();
      s.replaceChildren(...opts
        .filter((o) => o === "none" || o === cur || !ql || o.toLowerCase().includes(ql))
        .map((o) => { const op: any = el("option", { text: shortName(o), title: o }); op.value = o; if (o === cur) op.selected = true; return op; }));
      s.value = [...s.options].some((o: any) => o.value === cur) ? cur : "none";
      s.title = cur;
    }
    build("");
    f.addEventListener("input", () => build(f.value));
    s.addEventListener("change", () => { cur = s.value; s.title = cur; onChange(cur); });
    wrap.append(f, s);
    return wrap;
  }
  function seg(items: [string, any][], curVal: any, onpick: (v: any) => void) {
    const w: any = el("div", { className: "mmm-seg" });
    const map = new Map<any, any>();
    items.forEach(([lbl, val]) => {
      const b: any = el("button", { text: lbl, className: val === curVal ? "on" : "" });
      b.onclick = () => { w._sync(val); onpick(val); };
      map.set(val, b); w.appendChild(b);
    });
    w._sync = (val: any) => map.forEach((b, k) => b.classList.toggle("on", k === val));
    return w;
  }
  function insertAtCursor(ta: any, text: string) {
    const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? ta.value.length;
    const keepScroll = ta.scrollTop;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    const pos = s + text.length;
    ta.dispatchEvent(new Event("input"));
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(pos, pos);
    ta.scrollTop = keepScroll;
  }
  function rangeRow(lblText: string, min: number, max: number, step: number, val: number, oninput: (v: number) => void, fmt?: (v: number) => string) {
    const c = el("div");
    const lb: any = el("label", { className: "mmm-lbl", text: `${lblText} — ${fmt ? fmt(val) : val}` });
    const r: any = el("input", { className: "mmm-range", type: "range", min, max, step, value: val });
    r.addEventListener("input", () => { lb.textContent = `${lblText} — ${fmt ? fmt(+r.value) : r.value}`; oninput(+r.value); });
    c.append(lb, r);
    return c;
  }
  function sectionHead(text: string, ...btns: any[]) {
    const h = el("div", { className: "mmm-sh" });
    h.appendChild(el("div", { className: "t", text }));
    btns.forEach((b) => b && h.appendChild(b));
    return h;
  }
  function popMenu(ev: any, entries: any[]) {
    document.querySelectorAll(".mmm-menu").forEach((n) => n.remove());
    const m: any = el("div", { className: "mmm-menu" });
    const vw = window.innerWidth, vh = window.innerHeight;
    entries.forEach((e) => {
      if (e === "-") { m.appendChild(el("div", { className: "sep" })); return; }
      if (e.el) { e.el._closeMenu = () => m.remove(); m.appendChild(e.el); return; }
      const it: any = el("div", { className: "it" + (e.danger ? " danger" : ""), text: (e.icon ? e.icon + "  " : "") + e.label });
      it.onclick = () => { m.remove(); e.fn(); };
      m.appendChild(it);
    });
    m.style.visibility = "hidden";
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(ev.clientX, vw - r.width - 8) + "px";
    m.style.top = Math.min(ev.clientY, vh - r.height - 8) + "px";
    m.style.visibility = "visible";
    const close = (e2: any) => { if (!m.contains(e2.target)) { m.remove(); document.removeEventListener("mousedown", close); } };
    setTimeout(() => document.addEventListener("mousedown", close), 0);
  }

  const root: any = el("div", { className: "mmm-root", style: {
    position: "relative", flex: "1", minHeight: "0", width: "100%", padding: `${PAD}px`,
    display: "flex", flexDirection: "column", gap: `${PAD}px`,
    boxSizing: "border-box", color: C.text, fontSize: "12px", overflow: "hidden", background: C.bg0,
  }});

  // ── topbar ─────────────────────────────────────────────────────────────
  const top = el("div", { className: "mmm-top" });
  const brand = el("div", { className: "mmm-brand", text: "AI ONE STUDIO" });
  brand.appendChild(el("span", { className: "m", text: "MusicMaker" }));
  top.appendChild(brand);
  const engSel: any = seg(ENGINES.map((e) => [e.label, e.key] as [string, any]), state.engine, (v) => {
    switchEngine(v); renderCompose(); loadPlaylist();
  });
  engSel.style.flex = "0 0 auto";
  top.appendChild(engSel);
  top.appendChild(el("div", { style: { flex: "1" } }));
  top.appendChild(el("button", { className: "mmm-tb", text: "Settings", title: "Models / LLM", onclick: () => settingsOv.show() }));
  root.appendChild(top);

  // ── main split: compose | playlist ─────────────────────────────────────
  const LEFT_MIN = LEFT_W, LEFT_MAX = 760;
  const main = el("div", { className: "mmm-main", style: { flex: "1", display: "flex", gap: "0", minHeight: 0 } });
  const clampLeft = (w: number) => Math.max(LEFT_MIN, Math.min(LEFT_MAX, w));
  state.leftW = clampLeft(state.leftW || LEFT_W);
  const composeWrap = el("div", { className: "mmm-composewrap", style: {
    width: `${state.leftW}px`, flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0,
  }});
  const compose = el("div", { className: "mmm-lp mmm-compose", style: {
    flex: "1", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", paddingRight: "6px",
  }});
  const composeFixed = el("div", { className: "mmm-composefixed", style: {
    flexShrink: 0, display: "flex", flexDirection: "column", gap: "7px",
    paddingTop: "9px", marginTop: "2px", borderTop: `1px solid ${C.border}`,
  }});
  composeWrap.append(compose, composeFixed);
  const dragH = el("div", { className: "mmm-dragh", title: "Drag to resize", style: {
    width: `${PAD}px`, flexShrink: 0, cursor: "col-resize", display: "flex",
    alignItems: "center", justifyContent: "center",
  }});
  dragH.appendChild(el("div", { style: { width: "3px", height: "34px", borderRadius: "2px", background: C.border } }));
  dragH.addEventListener("mouseenter", () => (dragH.firstChild as HTMLElement).style.background = BRAND);
  dragH.addEventListener("mouseleave", () => (dragH.firstChild as HTMLElement).style.background = C.border);
  dragH.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = composeWrap.offsetWidth;
    const mv = (ev: MouseEvent) => { state.leftW = clampLeft(w0 + ev.clientX - x0); composeWrap.style.width = state.leftW + "px"; };
    const up = () => { persist(); document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
  });
  const playlistWrap = el("div", { className: "mmm-playlistwrap", style: { flex: "1", display: "flex", flexDirection: "column", minWidth: 0, gap: "6px" } });
  main.append(composeWrap, dragH, playlistWrap);
  root.appendChild(main);

  // ── bottom player bar ──────────────────────────────────────────────────
  const audioEl = new Audio(); audioEl.preload = "metadata";
  const stopPlayback = () => { try { audioEl.pause(); audioEl.removeAttribute("src"); audioEl.load(); } catch {} };
  const bar = el("div", { className: "mmm-bar", style: { height: `${PLAYER_H}px` } });
  const miniCover = el("div", { style: { width: "40px", height: "40px", borderRadius: "8px", background: C.bg3, flexShrink: 0, backgroundSize: "cover", backgroundPosition: "center", boxShadow: "0 1px 6px rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "800", fontSize: "12px", letterSpacing: ".5px", color: C.muted } });
  const nowWrap = el("div", { className: "mmm-nowwrap", style: { width: "150px", flexShrink: 0, overflow: "hidden" } });
  const nowTitle = el("div", { style: { fontSize: "11.5px", color: C.text, fontWeight: "600", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, text: "Pick a track to play" });
  const nowSub = el("div", { style: { fontSize: "10px", color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, text: "" });
  nowWrap.append(nowTitle, nowSub);
  const SVG_PLAY  = `<svg width="13" height="14" viewBox="0 0 13 14"><path d="M1 1.2c0-.7.8-1.1 1.4-.7l9 5.6c.5.3.5 1.1 0 1.4l-9 5.6c-.6.4-1.4 0-1.4-.7z"/></svg>`;
  const SVG_PAUSE = `<svg width="12" height="14" viewBox="0 0 12 14"><rect x="1" y="1" width="3.5" height="12" rx="1"/><rect x="7.5" y="1" width="3.5" height="12" rx="1"/></svg>`;
  const prevBtn = el("button", { className: "mmm-ib", text: "◄◄", title: "Previous", onclick: () => playIndex(curIdx - 1) });
  const playBtn: any = el("button", { className: "mmm-pp", title: "Play / pause", onclick: () => { audioEl.paused ? audioEl.play() : audioEl.pause(); } });
  playBtn.innerHTML = SVG_PLAY;
  const nextBtn = el("button", { className: "mmm-ib", text: "►►", title: "Next", onclick: () => playIndex(curIdx + 1) });
  const contBtn: any = el("button", { className: "mmm-ib" + (state.continuous !== false ? " act" : ""), text: "⟳" });
  const paintCont = () => { const on = state.continuous !== false; contBtn.classList.toggle("act", on); contBtn.title = on ? "Continuous play (click for single track)" : "Single track (click for continuous)"; };
  paintCont();
  contBtn.onclick = () => { state.continuous = state.continuous === false; persist(); paintCont(); };
  const curT = el("span", { style: { fontSize: "10px", color: C.muted, width: "34px", textAlign: "right", flexShrink: 0 }, text: "0:00" });
  const durT = el("span", { style: { fontSize: "10px", color: C.muted, width: "34px", flexShrink: 0 }, text: "0:00" });
  const seek: any = el("input", { className: "mmm-seek", type: "range", min: "0", max: "1000", value: "0" });
  seek.addEventListener("input", () => { if (audioEl.duration) audioEl.currentTime = (seek.value / 1000) * audioEl.duration; });
  const vol: any = el("input", { className: "mmm-vol", type: "range", min: "0", max: "1", step: "0.02", value: "1", title: "Volume" });
  vol.addEventListener("input", () => { audioEl.volume = +vol.value; });
  bar.append(miniCover, nowWrap, prevBtn, playBtn, nextBtn, curT, seek, durT, contBtn, vol);
  root.appendChild(bar);

  audioEl.addEventListener("timeupdate", () => {
    curT.textContent = fmtDur(audioEl.currentTime);
    if (audioEl.duration) seek.value = String((audioEl.currentTime / audioEl.duration) * 1000);
  });
  audioEl.addEventListener("loadedmetadata", () => { durT.textContent = fmtDur(audioEl.duration); });
  audioEl.addEventListener("play",  () => playBtn.innerHTML = SVG_PAUSE);
  audioEl.addEventListener("pause", () => playBtn.innerHTML = SVG_PLAY);
  audioEl.addEventListener("ended", () => { if (state.continuous !== false) playIndex(curIdx + 1); });

  // ── playlist ───────────────────────────────────────────────────────────
  let tracks: any[] = [], curIdx = -1;
  let lastTitleTap = 0;
  let genQueue: any[] = [];
  let regenCoverFn: string | null = null;
  const selected = new Set<string>();
  const plHead = el("div", { style: { display: "flex", alignItems: "center", gap: "7px", flexShrink: 0 } });
  plHead.appendChild(el("div", { text: "Playlist", style: { fontWeight: "700", fontSize: "12.5px", color: C.text, flexShrink: 0 } }));
  const searchIn: any = el("input", { type: "text", placeholder: "Search", className: "mmm-fld", style: { flex: "1", padding: "5px 9px", fontSize: "11px" } });
  const sortSel: any = sel([["newest", "Newest"], ["oldest", "Oldest"], ["title", "Title"]].map(([v, l]) => ({ value: v, label: l })), "newest", () => loadPlaylist());
  sortSel.style.width = "auto"; sortSel.style.fontSize = "11px"; sortSel.style.padding = "5px 26px 5px 9px";
  let favOnly = false;
  const favTgl: any = el("button", { className: "mmm-ib", text: "★", title: "Favorites only" });
  favTgl.onclick = () => { favOnly = !favOnly; favTgl.classList.toggle("act", favOnly); loadPlaylist(); };
  const selBar = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "11.5px", color: C.text, padding: "4px 2px", flexShrink: 0 } });
  plHead.append(searchIn, favTgl, sortSel);
  const plBody = el("div", { className: "mmm-lp", style: { flex: "1", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" } });
  playlistWrap.append(selBar, plHead, plBody);

  function renderSelBar() {
    clear(selBar);
    const n = selected.size;
    selBar.appendChild(el("span", { text: `${n} selected`, style: { flex: "1", color: n ? C.text : C.muted } }));
    const delBtn: any = el("button", { className: "mmm-x", text: "Delete", style: n ? { borderColor: C.err, color: C.err } : { opacity: ".4", cursor: "default" }, onclick: async () => {
      if (!n) return;
      if (!confirm(`Delete ${n} track(s)?`)) return;
      await jpost("/delete", { filenames: [...selected], subfolder: SUB() });
      selected.clear(); loadPlaylist();
    }});
    const clrBtn: any = el("button", { className: "mmm-x", text: "Clear", style: n ? {} : { opacity: ".4", cursor: "default" }, onclick: () => { if (!n) return; selected.clear(); renderPlaylist(); renderSelBar(); } });
    delBtn.disabled = !n; clrBtn.disabled = !n;
    selBar.append(delBtn, clrBtn);
  }

  function coverURL(fn: string) { return `url("${comfyApi.base}/view?filename=${encodeURIComponent(fn)}&subfolder=${encodeURIComponent(SUB() + "/covers")}&type=output")`; }
  const engLabel = (x: any) => (x && x.engine === "acestep") ? "ACE" : "MM";
  function coverPlaceholder(x: any, fontSize?: string) {
    return el("span", { className: "mmm-engtxt", text: engLabel(x), style: fontSize ? { fontSize } : {} });
  }

  function playIndex(i: number) {
    if (i < 0 || i >= tracks.length) return;
    curIdx = i;
    const t = tracks[i];
    audioEl.src = playableAudioUrl({ filename: t.filename, subfolder: t.subfolder || SUB() });
    audioEl.play().catch(() => {});
    nowTitle.textContent = t.title || t.filename;
    nowSub.textContent = settingsBadge(t) || (t.engine === "acestep" ? "Ace-Step 1.5" : "MiniMax Music 3");
    if (t.cover) { miniCover.style.backgroundImage = coverURL(t.cover); miniCover.textContent = ""; }
    else { miniCover.style.backgroundImage = "none"; miniCover.textContent = engLabel(t); }
    renderPlaylist();
  }
  function togglePlay(i: number) {
    if (i === curIdx && audioEl.src) { audioEl.paused ? audioEl.play().catch(() => {}) : audioEl.pause(); }
    else playIndex(i);
  }
  function restartPlay(i: number) {
    if (i !== curIdx || !audioEl.src) { playIndex(i); return; }
    audioEl.currentTime = 0; audioEl.play().catch(() => {});
  }

  function trackRow(t: any, i: number) {
    const r = el("div", { className: "mmm-row" + (i === curIdx ? " on" : "") });
    const lcol = el("div", { className: "mmm-lcol" });
    const cb: any = el("input", { type: "checkbox", className: "mmm-cb" });
    cb.checked = selected.has(t.filename);
    cb.onclick = (e: Event) => { e.stopPropagation(); cb.checked ? selected.add(t.filename) : selected.delete(t.filename); renderSelBar(); };
    const favBtn = el("button", { className: "mmm-fav" + (t.favorite ? " act" : ""), text: t.favorite ? "★" : "☆", title: "Favorite",
      onclick: async (e: Event) => { e.stopPropagation(); await jpost("/update_meta", { filename: t.filename, subfolder: SUB(), patch: { favorite: !t.favorite } }); loadPlaylist(); } });
    lcol.append(cb, favBtn);
    const cover = el("div", { className: "mmm-cover" + (t.filename === regenCoverFn ? " regen" : ""), title: "Track info", onclick: (e: Event) => { e.stopPropagation(); showInfo(t); } });
    if (t.cover) cover.style.backgroundImage = coverURL(t.cover);
    else cover.appendChild(coverPlaceholder(t));
    if (t.seconds) cover.appendChild(el("div", { className: "mmm-dur", text: fmtDur(t.seconds) }));
    // "tl" — the duration badge (`.mmm-dur`) already owns the bottom-right corner.
    attachSensitiveToggle(cover, cover, mediaKey(t.filename, t.subfolder || SUB()), "tl");
    const mid = el("div", { style: { flex: "1", minWidth: 0 } });
    const title = el("div", { className: "mmm-tt", text: t.title || t.filename, title: "Tap to play/pause · double-tap to restart" });
    // Play SYNCHRONOUSLY in the tap handler — iOS Safari only lets a detached <audio> start
    // from a real user gesture, so the old 200ms setTimeout debounce silently blocked playback
    // there. A fast second tap = restart (timestamp check instead of a deferred single-click).
    title.onclick = () => {
      const now = Date.now();
      if (now - lastTitleTap < 300) { lastTitleTap = 0; restartPlay(i); return; }
      lastTitleTap = now;
      togglePlay(i);
    };
    const trow = el("div", { className: "mmm-trow" });
    const acts = el("div", { className: "mmm-acts" });
    acts.appendChild(el("button", { className: "mmm-ib", title: "Reuse settings", text: "↺", onclick: (e: Event) => { e.stopPropagation(); reuse(t); } }));
    acts.appendChild(el("button", { className: "mmm-ib", title: "Info", text: "ⓘ", onclick: (e: Event) => { e.stopPropagation(); showInfo(t); } }));
    acts.appendChild(el("button", { className: "mmm-ib", title: "Download tagged MP3", text: "↓", onclick: async (e: Event) => {
      e.stopPropagation();
      const btn = e.currentTarget as HTMLButtonElement; const old = btn.textContent; btn.textContent = "…"; btn.disabled = true;
      try {
        const url = `${API}/download?filename=${encodeURIComponent(t.filename)}&subfolder=${encodeURIComponent(t.subfolder || SUB())}`;
        const rr = await comfyApi.fetchApi(url);
        if (!rr.ok) throw new Error(await rr.text());
        const blob = await rr.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = (t.title || t.filename).replace(/[\\/:*?"<>|]/g, "_") + ".mp3";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } catch (err) { statusEl.textContent = "Download failed: " + String(err).slice(0, 80); }
      finally { btn.textContent = old; btn.disabled = false; }
    }}));
    acts.appendChild(el("button", { className: "mmm-ib", title: "More", text: "⋯", onclick: (e: Event) => { e.stopPropagation(); moreMenu(t, e); } }));

    trow.append(title, el("span", { className: "mmm-eng", text: t.engine === "acestep" ? "Ace-Step" : "MiniMax" }), el("div", { style: { flex: "1" } }), acts);
    mid.appendChild(trow);
    const subText = (t.caption || "").replace(/\s*\n\s*/g, " ").trim() || (t.instrumental ? "instrumental" : settingsBadge(t));
    mid.appendChild(el("div", { className: "mmm-sub", text: subText }));
    r.append(lcol, cover, mid);
    return r;
  }

  function pendingCard(p: any) {
    const r = el("div", { className: "mmm-row gen" + (p.err ? " err" : "") });
    r.dataset.jobId = p.id;
    r.append(el("div", { className: "mmm-lcol" }));
    const cover = el("div", { className: "mmm-cover" + (p.cover || p.err ? "" : " busy") });
    if (p.cover) cover.style.backgroundImage = coverURL(p.cover);
    else cover.appendChild(p.err ? el("span", { className: "mmm-engtxt", text: "!" }) : coverPlaceholder(p));
    r.appendChild(cover);
    const mid = el("div", { style: { flex: "1", minWidth: 0 } });
    const trow = el("div", { className: "mmm-trow" });
    trow.append(el("div", { className: "mmm-tt", text: p.title || "New track", style: { cursor: "default" } }),
                el("span", { className: "mmm-eng", text: p.engine === "acestep" ? "Ace-Step" : "MiniMax" }));
    mid.appendChild(trow);
    const stage = el("div", { className: "mmm-stage" });
    stage.append(el("span", { text: p.stage || "Queued…" }), el("span", { className: "p", text: p.pct ? p.pct + "%" : "" }));
    mid.appendChild(stage);
    const prog = el("div", { className: "mmm-prog" }); prog.appendChild(el("i", { style: { width: (p.pct || (p.err ? 100 : 4)) + "%" } }));
    mid.appendChild(prog);
    r.appendChild(mid);
    const acts = el("div", { className: "mmm-acts", style: { opacity: 1 } });
    acts.appendChild(el("button", { className: "mmm-ib", style: { color: C.err },
      title: p.err ? "Dismiss" : (p.started ? "Cancel this run" : "Remove from queue"), text: "✕",
      onclick: () => { p.err ? (genQueue = genQueue.filter((j) => j.id !== p.id), renderPlaylist()) : cancelJob(p.id); } }));
    r.appendChild(acts);
    return r;
  }
  function paintJob(p: any) {
    const c: any = plBody.querySelector(`.mmm-row.gen[data-job-id="${p.id}"]`);
    if (!c) { renderPlaylist(); return; }
    c.classList.toggle("err", !!p.err);
    const cov = c.querySelector(".mmm-cover");
    cov.classList.toggle("busy", !p.cover && !p.err);
    if (p.cover && !cov.style.backgroundImage) { cov.style.backgroundImage = coverURL(p.cover); cov.textContent = ""; }
    c.querySelector(".mmm-stage span:first-child").textContent = p.stage || "Queued…";
    c.querySelector(".mmm-stage .p").textContent = p.pct ? p.pct + "%" : "";
    c.querySelector(".mmm-prog i").style.width = (p.pct || (p.err ? 100 : 4)) + "%";
  }

  function renderPlaylist() {
    clear(plBody);
    genQueue.forEach((j) => plBody.appendChild(pendingCard(j)));
    const q = searchIn.value.trim().toLowerCase();
    const shown = tracks.filter((t) => !q || (t.title || t.filename).toLowerCase().includes(q));
    shown.forEach((t) => plBody.appendChild(trackRow(t, tracks.indexOf(t))));
    if (!tracks.length && !genQueue.length) plBody.appendChild(el("div", { style: { color: C.muted, padding: "40px 20px", textAlign: "center", fontSize: "12px", lineHeight: "1.7" }, html: "No tracks yet.<br>Write lyrics &amp; style on the left, then hit <b>Generate</b>." }));
    renderSelBar();
  }
  searchIn.addEventListener("input", renderPlaylist);

  async function loadPlaylist() {
    try {
      const playingFn = curIdx >= 0 ? tracks[curIdx]?.filename : null;
      const d = await jget(`/playlist?limit=200&sort=${sortSel.value}${favOnly ? "&favonly=1" : ""}&subfolder=${encodeURIComponent(SUB())}`);
      tracks = d.tracks || [];
      curIdx = playingFn ? tracks.findIndex((t) => t.filename === playingFn) : -1;
      renderPlaylist();
    } catch (e) { console.warn("[MMM] playlist", e); }
  }

  function moreMenu(t: any, ev: any) {
    popMenu(ev, [
      { label: "Rename", fn: async () => { const nn = prompt("New title", t.title || ""); if (nn != null) { await jpost("/update_meta", { filename: t.filename, subfolder: SUB(), patch: { title: nn } }); loadPlaylist(); } } },
      { label: "Regenerate cover", fn: () => regenCoverPopup(t) },
      { label: "Open folder", fn: () => jpost("/open_folder", { filename: t.filename, subfolder: SUB() }) },
      "-",
      { label: "Delete", danger: true, fn: async () => { if (confirm("Delete this track?")) { await jpost("/delete", { filename: t.filename, subfolder: SUB() }); loadPlaylist(); } } },
    ]);
  }

  async function showInfo(t: any) {
    const d = await jget(`/meta?filename=${encodeURIComponent(t.filename)}&subfolder=${encodeURIComponent(t.subfolder || SUB())}`);
    const meta = d.ok ? d.meta : null;
    const ov = el("div", { className: "mmm-ov" });
    const hd = el("div", { className: "mmm-ov-hd" });
    hd.appendChild(el("div", { className: "t", text: t.title || t.filename }));
    hd.appendChild(el("button", { className: "mmm-x", text: "Close", onclick: () => ov.remove() }));
    ov.appendChild(hd);
    const body = el("div", { className: "mmm-ov-body" });

    const topRow = el("div", { style: { display: "flex", gap: "14px", flexShrink: 0 } });
    const big = el("div", { style: { width: "168px", height: "168px", flexShrink: 0, borderRadius: "12px", background: C.bg2,
      backgroundSize: "cover", backgroundPosition: "center", boxShadow: "0 4px 18px rgba(0,0,0,.5)",
      display: "flex", alignItems: "center", justifyContent: "center" } });
    if (t.cover) big.style.backgroundImage = coverURL(t.cover);
    else big.appendChild(coverPlaceholder(t, "44px"));
    const metaCol = el("div", { style: { display: "flex", flexDirection: "column", gap: "5px", minWidth: 0, alignSelf: "center" } });
    const line = (k: string, v: string) => metaCol.append(el("div", { style: { fontSize: "11px", color: C.muted }, text: k }), el("div", { style: { fontSize: "12.5px", color: C.text, marginBottom: "3px" }, text: v }));
    line("Engine", (meta || t).engine === "acestep" ? "Ace-Step 1.5" : "MiniMax Music 3");
    if (meta?.seconds) line("Length", fmtDur(meta.seconds));
    if (meta?.seed != null) line("Seed", String(meta.seed));
    if (meta?.llmBackend) {
      const bk = ({ local: "Local GGUF", openrouter: "OpenRouter", comfy: "ComfyUI TextGenerate" } as any)[meta.llmBackend] || meta.llmBackend;
      line("LLM", meta.llmModel ? `${bk} · ${meta.llmModel}` : bk);
    }
    topRow.append(big, metaCol);
    body.appendChild(topRow);

    if (!meta) body.appendChild(el("div", { text: "No metadata for this track.", style: { color: C.muted, marginTop: "10px" } }));
    else {
      const blk = (k: string, v: any) => { body.appendChild(el("div", { className: "mmm-k", text: k })); body.appendChild(el("pre", { text: typeof v === "string" ? v : JSON.stringify(v, null, 1) })); };
      blk("Style / tags", meta.caption || "—");
      blk("Lyrics", meta.lyrics || "(instrumental)");
      blk("Parameters", meta.engine === "acestep"
        ? { bpm: meta.bpm, key: meta.keyscale, timesig: meta.timesignature, language: meta.language, cfg_scale: meta.cfgScaleAce, stages: meta.aceStages }
        : { steps: meta.steps, cfg: meta.cfg, cfg_scale: meta.cfgScale, top_k: meta.topK, sampler: meta.sampler });
    }
    ov.appendChild(body);
    root.appendChild(ov);
  }

  function applyReuseMeta(m: any) {
    if (!m) return;
    const eng = m.engine === "acestep" ? "acestep" : "minimax";
    if (eng !== state.engine) switchEngine(eng);
    ENGINE_FIELDS.forEach((k) => { if (m[k] !== undefined) state[k] = m[k]; });
    state.lyricsInput = m.lyricsInput ?? m.lyrics ?? "";
    state.lyrics      = m.lyrics ?? "";
    state.caption     = m.caption ?? "";
    state.captionBrief = m.captionBrief ?? "";
    state.styleChips  = Array.isArray(m.styleChips) ? m.styleChips : [];
    state.title       = m.title || "";
    state.coverBrief  = m.coverBrief || "";
    if (m.seconds != null) state.duration = m.seconds;
    state.seedMode = "fixed";
    if (m.seed != null) state.seed = m.seed;
    persist(); renderCompose(); loadPlaylist();
    statusEl.textContent = `Reused — ${m.engine === "acestep" ? "Ace-Step" : "MiniMax"}`;
  }
  function reuse(t: any) {
    jget(`/meta?filename=${encodeURIComponent(t.filename)}&subfolder=${encodeURIComponent(t.subfolder || SUB())}`).then((d) => {
      if (d.ok && d.meta) applyReuseMeta(d.meta);
    });
  }

  // ── compose panel ──────────────────────────────────────────────────────
  const genBtn = el("button", { className: "mmm-go", text: "▶ Generate", onclick: () => enqueueGen() });
  const stopBtn = el("button", { className: "mmm-stop", text: "■ Stop", title: "Stop the current run and clear the queue", onclick: () => stopQueue() });
  const statusEl = el("div", { className: "mmm-status" });
  let lyricsTA: any, styleTA: any, lyricsWrap: any, styleWrap: any;

  function resizableBox(getV: () => string, setV: (v: string) => void, hKey: string) {
    const wrap = el("div", { style: { position: "relative" } });
    const ta: any = el("textarea", { className: "mmm-fld", style: {
      height: `${state[hKey]}px`, minHeight: "96px", resize: "none", lineHeight: "1.55", display: "block",
    }});
    ta.value = getV() || "";
    ta.addEventListener("input", () => { setV(ta.value); persist(); });
    const grip = el("div", { style: { position: "absolute", left: "8px", right: "8px", bottom: "3px", height: "10px", cursor: "ns-resize", display: "flex", alignItems: "center", justifyContent: "center" } });
    grip.appendChild(el("div", { style: { width: "24px", height: "3px", borderRadius: "2px", background: C.borderH } }));
    grip.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault(); const y0 = e.clientY, h0 = ta.offsetHeight;
      const mv = (ev: MouseEvent) => { const nh = Math.max(96, Math.min(520, h0 + ev.clientY - y0)); ta.style.height = nh + "px"; state[hKey] = nh; };
      const up = () => { persist(); document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); };
      document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
    });
    wrap.append(ta, grip);
    return { wrap, ta };
  }

  function llmBusy(wrap: any, label?: string) {
    if (!wrap) return () => {};
    const ov = el("div", { className: "mmm-llmbusy" });
    ov.append(el("span", { className: "dot" }), el("span", { text: (label || "LLM writing…") }));
    wrap.appendChild(ov);
    return () => ov.remove();
  }
  let _llmPrompts: any = null;
  async function comfyTextGen(role: string, input: string, context: any) {
    if (!state.llmClip) throw new Error("Set a CLIP/GGUF model for ComfyUI TextGenerate in Settings.");
    if (!_llmPrompts) _llmPrompts = (await jget("/llm/prompts")).prompts || {};
    const sys = _llmPrompts[role];
    if (!sys) throw new Error("unknown role: " + role);
    const ctxLines = Object.entries(context || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
    const composed = `${sys.trim()}\n\n---\n\n${ctxLines ? ctxLines + "\n\n" : ""}${input || ""}`.trim();
    const loader = state.llmClip.toLowerCase().endsWith(".gguf")
      ? { class_type: "CLIPLoaderGGUF", inputs: { clip_name: state.llmClip, type: state.llmClipType || "qwen_image" } }
      : { class_type: "CLIPLoader",     inputs: { clip_name: state.llmClip, type: state.llmClipType || "qwen_image" } };
    const graph: any = {
      "tg:c": loader,
      "tg:t": { class_type: "TextGenerate", inputs: { clip: ["tg:c", 0], prompt: composed, max_length: 2048, sampling_mode: "off", thinking: false, use_default_template: true } },
      "tg:p": { class_type: "PreviewAny", inputs: { source: ["tg:t", 0] } },
    };
    const res = await submitPrompt(graph, `MusicMaker · LLM (${role})`);
    if (res.error || (res.node_errors && Object.keys(res.node_errors).length)) throw new Error(res.error?.message || JSON.stringify(res.node_errors));
    const pid = res.prompt_id;
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const h = await comfyApi.fetchApi(`/history/${pid}`).then((r) => r.json()).catch(() => ({}));
      const e = h[pid]; if (!e) continue;
      if (e.status?.status_str === "error") throw new Error("TextGenerate execution error — check Console");
      if (e.status?.completed) {
        for (const nid of Object.keys(e.outputs || {})) {
          const t = e.outputs[nid].text;
          if (Array.isArray(t) && t.length) return String(t[0]);
        }
        throw new Error("TextGenerate produced no text");
      }
    }
    throw new Error("TextGenerate timed out");
  }

  function stripThinking(text: string) {
    let t = String(text || "");
    t = t.replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, "");
    t = t.replace(/^<think(ing)?>[\s\S]*/i, "");
    t = t.trim();
    const head = t.slice(0, 60).toLowerCase();
    const opensReasoned = /^(let me |okay,? (let|i'?ll|so)|first,? i|i'?ll (analyze|start|think)|i need to|let'?s (break|think)|looking at the (input|brief)|analysis:)/.test(head);
    if (opensReasoned) {
      const q = [...t.matchAll(/["“]([^"“”]{60,})["”]/gs)].map((m) => m[1]);
      if (q.length) return q[q.length - 1].trim();
      const m = t.match(/\n\s*(?:final (?:caption|title|answer|version)|here'?s? the (?:final|caption|title))\s*[:\-]?\s*\n+([\s\S]+?)(?:\n\n\*\*|$)/i);
      if (m && m[1].trim().length > 20) return m[1].trim().replace(/^["“”*]+|["“”*]+$/g, "").trim();
    }
    return t;
  }

  // throwOnFail: 큐(llmOnce) 경로에서만 켠다 — LLM이 실패하면 job이 조용히 원문(brief)으로
  // 넘어가지 않고 에러로 멈춰야 한다. 대화형 ✨ 버튼은 statusEl 표시만 하고 넘어간다(원본 동작).
  async function runLLM(role: string, input: string, context: any, apply: (t: string) => void, busyWrap?: any, busyLabel?: string, throwOnFail = false) {
    statusEl.textContent = `LLM · ${role} …`;
    const done = llmBusy(busyWrap, busyLabel);
    try {
      let text: string;
      if (state.llmBackend === "comfy") {
        text = stripThinking(await comfyTextGen(role, input, context));
      } else {
        const model = state.llmBackend === "openrouter" ? state.llmOrModel : state.llmModel;
        const d = await jpost("/llm/run", { role, input, context, backend: state.llmBackend, model });
        if (!d.ok) throw new Error(d.error || "empty response");
        text = stripThinking(d.text);
      }
      if (text) { apply(text); statusEl.textContent = "LLM ✓"; }
      else { statusEl.textContent = "LLM: empty response"; if (throwOnFail) throw new Error("LLM returned no text"); }
    } catch (e: any) {
      statusEl.textContent = "LLM: " + e.message;
      if (throwOnFail) throw e;
    }
    finally { done(); }
  }

  function checkRow(lblText: string, checked: boolean, onchange: (v: boolean) => void) {
    const w = el("label", { style: { display: "flex", gap: "8px", alignItems: "center", fontSize: "11.5px", cursor: "pointer", color: C.text, padding: "2px 0" } });
    const cb: any = el("input", { type: "checkbox", style: { accentColor: BRAND, width: "14px", height: "14px" } });
    cb.checked = checked;
    cb.onchange = () => onchange(cb.checked);
    w.append(cb, el("span", { text: lblText }));
    return w;
  }

  async function presetMenu(kind: string, ev: any, getPayload: () => any, applyPayload: (p: any) => void) {
    let sets: any[] = [];
    try { sets = (await jget(`/${kind}_presets`)).sets || []; } catch {}
    const nice = kind === "lyrics" ? "lyrics" : "style";
    const entries: any[] = [
      { label: "Save current…", fn: async () => {
        const name = prompt(`${nice} preset name`);
        if (!name) return;
        await jpost(`/${kind}_presets/save`, { name, ...getPayload() });
        statusEl.textContent = `Saved — ${name}`;
      }},
    ];
    if (sets.length) {
      entries.push("-");
      sets.forEach((s) => {
        const row: any = el("div", { className: "it", style: { display: "flex", alignItems: "center", gap: "6px" } });
        const nm = el("span", { text: s.name, style: { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } });
        nm.onclick = async () => {
          row._closeMenu?.();
          try { applyPayload(await jget(`/${kind}_presets/get?name=${encodeURIComponent(s.name)}`)); persist(); statusEl.textContent = `Loaded — ${s.name}`; }
          catch { statusEl.textContent = "Load failed"; }
        };
        const mini = (txt: string, title: string, fn: () => void) => el("button", { className: "mmm-x", text: txt, title,
          style: { padding: "2px 6px", fontSize: "12px", lineHeight: "1", flexShrink: 0 },
          onclick: (e: Event) => { e.stopPropagation(); fn(); } });
        const renameBtn = mini("↺", "Rename", async () => {
          const nn = prompt("Rename preset", s.name);
          if (!nn || nn.trim() === s.name) return;
          row._closeMenu?.();
          const p = await jget(`/${kind}_presets/get?name=${encodeURIComponent(s.name)}`);
          await jpost(`/${kind}_presets/save`, { ...p, name: nn.trim() });
          await jpost(`/${kind}_presets/delete`, { name: s.name });
          statusEl.textContent = `Renamed — ${nn.trim()}`;
        });
        const delBtn = mini("✕", "Delete", async () => {
          if (!confirm(`Delete preset "${s.name}"?`)) return;
          row._closeMenu?.();
          await jpost(`/${kind}_presets/delete`, { name: s.name });
          statusEl.textContent = `Deleted — ${s.name}`;
        });
        row.append(nm, renameBtn, delBtn);
        entries.push({ el: row });
      });
    }
    popMenu(ev, entries);
  }

  function coverInfoPopup() {
    const ov = el("div", { className: "mmm-pop" });
    const box = el("div", { className: "box" });
    box.appendChild(el("h4", { text: "Album cover description" }));
    box.appendChild(el("p", { text: "Write what you want the cover to look like, in plain words. The LLM rewrites it into a Krea2 image prompt. Leave empty to let the LLM work from the title + lyrics." }));
    const ta: any = el("textarea", { className: "mmm-fld", style: { fontSize: "12px", lineHeight: "1.5" } });
    ta.value = state.coverBrief || "";
    box.appendChild(ta);
    const btns = el("div", { className: "btns" });
    btns.append(
      el("button", { className: "mmm-x", text: "Clear", onclick: () => { ta.value = ""; } }),
      el("button", { className: "mmm-x", text: "Cancel", onclick: () => ov.remove() }),
      el("button", { className: "mmm-save", style: { padding: "8px 16px", boxShadow: "none" }, text: "Save", onclick: () => {
        state.coverBrief = ta.value.trim(); persist(); renderCompose(); ov.remove();
      }}),
    );
    box.appendChild(btns);
    ov.appendChild(box);
    ov.addEventListener("mousedown", (e: Event) => { if (e.target === ov) ov.remove(); });
    root.appendChild(ov);
    ta.focus();
  }

  function bigEdit(title: string, getV: () => string, setV: (v: string) => void) {
    const ov = el("div", { className: "mmm-ov" });
    const hd = el("div", { className: "mmm-ov-hd" });
    hd.appendChild(el("div", { className: "t", text: title }));
    const done = el("button", { className: "mmm-x", text: "Done", style: { borderColor: BRAND, color: BRAND } });
    hd.appendChild(done);
    ov.appendChild(hd);
    const ta: any = el("textarea", { className: "mmm-fld", style: { flex: "1", resize: "none", lineHeight: "1.6", fontSize: "13px" } });
    ta.value = getV() || "";
    ta.addEventListener("input", () => setV(ta.value));
    done.onclick = () => { setV(ta.value); persist(); renderCompose(); ov.remove(); };
    ov.appendChild(ta);
    root.appendChild(ov);
    ta.focus();
  }

  const vocalHints = () => {
    if (state.instrumental) return { vocal_gender: "instrumental (no vocals)" };
    const o: any = {};
    if (state.vocalGender && state.vocalGender !== "auto") o.vocal_gender = state.vocalGender;
    if (state.vocalStyle  && state.vocalStyle  !== "auto") o.vocal_delivery = state.vocalStyle;
    if (state.voiceTone   && state.voiceTone   !== "auto") o.voice_tone = state.voiceTone;
    if (state.bpm)         o.bpm = state.bpm;
    if (state.keyscale)    o.scale = state.keyscale;
    if (state.timesignature) o.time_sig = state.timesignature;
    return o;
  };

  function headBtns(kind: string) {
    const isLyr = kind === "lyrics";
    const tb = (label: string, title: string, onclick: any) => el("button", { className: "mmm-tb", text: label, title, onclick });
    const resetBtn = tb("Reset", "Clear this field", () => {
      const ta = isLyr ? lyricsTA : styleTA;
      if ((ta?.value || "").trim() && !confirm("Clear this field?")) return;
      if (isLyr) { state.lyrics = ""; state.lyricsInput = ""; }
      else { state.caption = ""; state.captionBrief = ""; state.styleChips = []; }
      persist(); renderCompose();
    });
    const presetBtn = tb("Preset", "Save / load presets", (e: any) => isLyr
      ? presetMenu("lyrics", e, () => ({ lyricsInput: state.lyricsInput, lyrics: state.lyrics }),
          (p) => { state.lyricsInput = p.lyricsInput ?? p.lyrics ?? ""; state.lyrics = state.lyricsInput; renderCompose(); })
      : presetMenu("style", e, () => ({ captionBrief: state.captionBrief, caption: state.caption, styleChips: state.styleChips }),
          (p) => { state.captionBrief = p.captionBrief ?? ""; state.caption = p.caption ?? ""; state.styleChips = p.styleChips ?? []; renderCompose(); }));
    const varBtn = isLyr ? null : tb("Reroll", "Rewrite the prompt a different way", () =>
      runLLM(CAPTION_ROLE(), state.captionBrief || styleTA.value,
        { lyrics: state.lyrics, chips: (state.styleChips || []).join(", "), ...vocalHints(), variation: Date.now() },
        (txt) => { state.caption = txt; styleTA.value = txt; persist(); }, styleWrap));
    const expandBtn = tb("Expand", "Full-screen editor", () => isLyr
      ? bigEdit("Lyrics", () => state.lyricsInput || state.lyrics, (v) => { state.lyricsInput = v; state.lyrics = v; })
      : bigEdit(state.engine === "acestep" ? "Style tags" : "Style", () => state.caption || state.captionBrief, (v) => { if (state.engine === "acestep" || !/###\s/.test(v)) state.captionBrief = v; state.caption = v; }));
    const spark = el("button", { className: "mmm-spark", title: isLyr ? "Write / enhance lyrics (uses Title when empty)" : "Write music prompt", text: "✨", onclick: () => {
      if (isLyr) {
        const cur = lyricsTA.value.trim();
        const intent = lyricsIntent(cur);
        let role = intent === "enhance" ? "lyrics_enhance" : "lyrics_from_theme";
        let input = cur;
        if (intent === "empty" && (state.title || "").trim()) { role = "lyrics_from_title"; input = state.title.trim(); }
        else if (intent === "empty") { statusEl.textContent = "Write a brief, or fill in the Title"; return; }
        const durSec = effectiveDuration({ ...state, lyricsInput: cur });
        runLLM(role, input, { engine: state.engine, language: state.language, duration_seconds: durSec, style_caption: state.caption, title: state.title || "" }, (txt) => {
          state.lyrics = txt; state.lyricsInput = cur; lyricsTA.value = txt; persist();
        }, lyricsWrap, "Writing lyrics…");
      } else {
        const brief = (state.captionBrief || styleTA.value || "").trim();
        if (!brief) { statusEl.textContent = "Write a few words of style first"; return; }
        state.captionBrief = brief;
        runLLM(CAPTION_ROLE(), brief, { lyrics: state.lyrics, chips: (state.styleChips || []).join(", "), ...vocalHints() }, (txt) => { state.caption = txt; styleTA.value = txt; persist(); }, styleWrap, "Writing prompt…");
      }
    }});
    return [resetBtn, presetBtn, varBtn, expandBtn, spark].filter(Boolean);
  }

  function renderCompose() {
    // Format 변경 / LoRA 추가·삭제 등은 compose를 통째로 다시 그린다 — 스크롤 위치를 잃지 않게
    // 복원한다 (원본 노드는 위젯 안이라 스크롤 영향이 없었음).
    const _scroll = compose.scrollTop;
    clear(compose);
    engSel?._sync?.(state.engine);

    compose.appendChild(seg([["Simple", false], ["Advanced", true]], state.advanced, (v) => { state.advanced = v; persist(); renderCompose(); }));

    // ── Title + Cover Info ──
    const titleIn = fld(state.title || "", (v: string) => { state.title = v; state.titleTouched = !!v.trim(); persist(); }, { ph: "Song title (optional — ✨ can turn it into lyrics)" });
    const tRow = el("div", { style: { display: "flex", gap: "6px", alignItems: "flex-end" } });
    tRow.append(
      el("div", { style: { flex: "1" } }, [el("label", { className: "mmm-lbl", text: "Title" }), titleIn]),
      el("button", { className: "mmm-cinfo", text: state.coverBrief ? "Cover Info ●" : "Cover Info",
        title: "Describe the album cover — the LLM turns it into a Krea2 prompt",
        onclick: () => coverInfoPopup() }),
    );
    compose.appendChild(tRow);

    // ── Lyrics / Instrumental ──
    const modeSeg: any = seg([["Song", false], ["Instrumental", true]], !!state.instrumental, (v) => {
      state.instrumental = v;
      if (v) state.vocalGender = "instrumental (no vocals)";
      else if (state.vocalGender === "instrumental (no vocals)") state.vocalGender = "auto";
      persist(); renderCompose();
    });
    compose.appendChild(el("div", { style: { display: "flex", marginTop: "6px" } }, [modeSeg]));
    modeSeg.style.flex = "1";
    compose.appendChild(sectionHead("Lyrics", ...(state.instrumental ? [] : headBtns("lyrics"))));
    if (state.instrumental) {
      compose.appendChild(el("div", { style: { fontSize: "11px", color: C.muted, padding: "8px 10px", background: C.bg1,
        border: `1px solid ${C.border}`, borderRadius: "8px", lineHeight: "1.5" },
        text: "Instrumental — no lyrics, no vocals. The style prompt drives everything. Switch to Song to write or generate lyrics." }));
    } else {
      const lb = resizableBox(() => state.lyricsInput || state.lyrics, (v) => { state.lyricsInput = v; state.lyrics = v; }, "lyricsH");
      lyricsTA = lb.ta; lyricsWrap = lb.wrap;
      lyricsTA.placeholder = "Write lyrics, or just describe them.\ne.g. \"a one-minute sad breakup story\"  /  \"mmm mmm I hate you, that vibe, 1 min\"\nLeave empty and hit ✨ to generate.";
      compose.appendChild(lb.wrap);
      const tagRow = el("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "5px" } });
      LYRIC_TAGS.forEach((tag) => tagRow.appendChild(el("button", { text: tag.replace(/[\[\]]/g, ""), className: "mmm-chip", style: { fontSize: "10px", padding: "3px 9px" }, onmousedown: (e: Event) => e.preventDefault(), onclick: () => {
        const before = lyricsTA.value.slice(0, lyricsTA.selectionStart ?? lyricsTA.value.length);
        const pre = (before && !before.endsWith("\n")) ? "\n" : "";
        insertAtCursor(lyricsTA, pre + tag + "\n");
      }})));
      compose.appendChild(tagRow);
    }

    // ── Style ──
    const stLbl = state.engine === "acestep" ? "Style tags" : "Style";
    compose.appendChild(sectionHead(stLbl, ...headBtns("style")));
    const sb = resizableBox(() => state.caption || state.captionBrief, (v) => {
      if (state.engine === "acestep") { state.caption = v; state.captionBrief = v; }
      else if (/###\s/.test(v)) state.caption = v; else state.captionBrief = v;
    }, "styleH");
    styleTA = sb.ta; styleWrap = sb.wrap;
    styleTA.placeholder = state.engine === "acestep"
      ? "cinematic melodic house, Alan Walker vibe, plucky synth, airy pads, breathy vocals …\n✨ turns it into finished tags"
      : "warm acoustic pop, female vocal, fingerpicked guitar …\n✨ turns it into a structured caption";
    compose.appendChild(sb.wrap);
    const chipRow = el("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "5px" } });
    STYLE_CHIPS.forEach((chip) => chipRow.appendChild(el("button", { text: chip, className: "mmm-chip", onmousedown: (e: Event) => e.preventDefault(), onclick: () => {
      state.styleChips = [...new Set([...(state.styleChips || []), chip])];
      const caret = styleTA.selectionStart ?? styleTA.value.length;
      const before = styleTA.value.slice(0, caret), after = styleTA.value.slice(caret);
      const pre  = (before.trim() && !/[\s,]$/.test(before)) ? ", " : "";
      const post = (after && !/^[\s,\n]/.test(after)) ? ", " : "";
      insertAtCursor(styleTA, pre + chip + post);
    }})));
    compose.appendChild(chipRow);

    // ── Vocals (LLM hints) ──
    if (!state.instrumental) {
      compose.appendChild(el("div", { className: "mmm-sh", style: { marginTop: "8px" } }, [el("div", { className: "t", text: "Vocals" })]));
      const vg = el("div", { className: "mmm-grid3" });
      vg.append(
        fieldCol("gender", sel(VOCAL_GENDER, state.vocalGender || "auto", (v) => { state.vocalGender = v; persist(); })),
        fieldCol("delivery", sel(VOCAL_STYLE, state.vocalStyle || "auto", (v) => { state.vocalStyle = v; persist(); })),
        fieldCol("tone", sel(VOICE_TONE, state.voiceTone || "auto", (v) => { state.voiceTone = v; persist(); })),
      );
      compose.appendChild(vg);
    }

    // ── musical params (always) ──
    const basics = el("div", { style: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" } });
    const g2 = el("div", { className: "mmm-grid2" });
    g2.append(
      fieldCol(state.engine === "acestep" ? "key / scale" : "scale (LLM hint)", sel(ACE_KEYSCALES, state.keyscale || "A minor", (v) => { state.keyscale = v; persist(); })),
      fieldCol(state.engine === "acestep" ? "time sig" : "time sig (LLM hint)", sel(ACE_TIMESIGS.map((s) => ({ value: s, label: s + "/4" })), String(state.timesignature || "4"), (v) => { state.timesignature = v; persist(); })),
    );
    basics.appendChild(g2);
    basics.appendChild(rangeRow("BPM", 40, 220, 1, Math.round(state.bpm || 120), (v) => { state.bpm = Math.round(v); persist(); }));
    basics.appendChild(rangeRow("Length", DURATION_MIN, DURATION_MAX, 5, state.duration, (v) => { state.duration = v; persist(); }, fmtDur));
    basics.appendChild(checkRow("Auto-generate album cover (Krea2)", state.makeCover, (v) => { state.makeCover = v; persist(); }));
    compose.appendChild(basics);

    // ── advanced ──
    if (state.advanced) {
      const acc = el("div", { className: "mmm-acc" });
      acc.appendChild(el("div", { className: "hd", text: state.engine === "acestep" ? "Ace-Step 1.5" : "MiniMax Music 3" }));

      const fmtSel = fieldCol("format", sel(AUDIO_FORMATS, state.format || "flac", (v) => { state.format = v; persist(); renderCompose(); }));
      const qualSel = (state.format === "mp3" || state.format === "opus")
        ? fieldCol("quality", sel(state.format === "opus" ? ["64k", "96k", "128k", "192k", "320k"] : ["V0", "128k", "320k"], state.audioQuality || (state.format === "opus" ? "128k" : "V0"), (v) => { state.audioQuality = v; persist(); }))
        : null;

      if (state.engine === "acestep") {
        const g2a = el("div", { className: "mmm-grid2" });
        g2a.append(
          fieldCol("language", sel(ACE_LANGUAGES, state.language || "en", (v) => { state.language = v; persist(); })),
          fieldCol("cfg_scale", fld(state.cfgScaleAce, (v: number) => { state.cfgScaleAce = v; persist(); }, { num: true })),
          fieldCol("temperature", fld(state.temperature, (v: number) => { state.temperature = v; persist(); }, { num: true })),
          fieldCol("top_p", fld(state.topP, (v: number) => { state.topP = v; persist(); }, { num: true })),
        );
        acc.appendChild(g2a);
        const g3 = el("div", { className: "mmm-grid3" });
        g3.append(
          fieldCol("top_k", fld(state.topKAce, (v: number) => { state.topKAce = Math.round(v); persist(); }, { num: true })),
          fieldCol("min_p", fld(state.minP, (v: number) => { state.minP = v; persist(); }, { num: true })),
          el("div"),
        );
        acc.appendChild(g3);
        acc.appendChild(el("div", { className: "hd", text: "Sampling stages — steps / cfg (stage 1 always; 2→3 sequential)" }));
        const stg = el("div", { className: "mmm-grid3" });
        state.aceStages.forEach((s: any, i: number) => {
          if (i === 0) s.on = true;
          const prevOn = i === 0 ? true : state.aceStages[i - 1].on !== false;
          const active = s.on !== false && prevOn;
          const c = el("div", { style: { opacity: active || i === 0 ? "1" : ".4" } });
          const lblRow = el("label", { className: "mmm-lbl", style: { display: "flex", alignItems: "center", gap: "5px", cursor: i === 0 ? "default" : "pointer" } });
          if (i > 0) {
            const cb: any = el("input", { type: "checkbox", style: { accentColor: BRAND, width: "13px", height: "13px", margin: "0" } });
            cb.checked = active;
            cb.disabled = !prevOn;
            cb.onchange = () => {
              s.on = cb.checked;
              if (!cb.checked) for (let k = i + 1; k < state.aceStages.length; k++) state.aceStages[k].on = false;
              persist(); renderCompose();
            };
            lblRow.appendChild(cb);
          }
          lblRow.appendChild(el("span", { text: `stage ${i + 1}` }));
          c.appendChild(lblRow);
          const rr = el("div", { style: { display: "flex", gap: "4px" } });
          const stf: any = fld(s.steps, (v: number) => { s.steps = Math.round(v); persist(); }, { num: true });
          const cf: any = fld(s.cfg, (v: number) => { s.cfg = v; persist(); }, { num: true });
          if (!active && i !== 0) { stf.disabled = true; cf.disabled = true; }
          rr.append(stf, cf);
          c.appendChild(rr); stg.appendChild(c);
        });
        acc.appendChild(stg);
      } else {
        const g3 = el("div", { className: "mmm-grid3" });
        g3.append(
          fieldCol("steps", fld(state.steps, (v: number) => { state.steps = Math.round(v); persist(); }, { num: true })),
          fieldCol("sampler cfg", fld(state.cfg, (v: number) => { state.cfg = v; persist(); }, { num: true })),
          fieldCol("top_k", fld(state.topK, (v: number) => { state.topK = Math.round(v); persist(); }, { num: true })),
        );
        acc.appendChild(g3);
        const g2c = el("div", { className: "mmm-grid2" });
        g2c.append(
          fieldCol("guidance (cfg_scale)", fld(state.cfgScale ?? 1.7, (v: number) => { state.cfgScale = v; persist(); }, { num: true })),
          el("div", { style: { fontSize: "10px", color: C.muted, alignSelf: "center", lineHeight: "1.4" }, text: "cfg_scale = prompt-adherence in the MiniMax text encoder. sampler cfg = KSampler guidance. Different knobs." }),
        );
        acc.appendChild(g2c);
        const sf = el("div", { className: "mmm-grid2" });
        sf.append(fieldCol("sampler", sel(SAMPLERS, state.sampler || "euler", (v) => { state.sampler = v; persist(); })), fmtSel);
        acc.appendChild(sf);
        if (qualSel) acc.appendChild(qualSel);
        acc.appendChild(checkRow("Lower VRAM (tiled decode)", state.tiledDecode, (v) => { state.tiledDecode = v; persist(); }));
      }
      if (state.engine === "acestep") {
        const af = el("div", { className: "mmm-grid2" });
        af.append(fmtSel, qualSel || el("div"));
        acc.appendChild(af);
      }
      compose.appendChild(acc);

      // LoRA
      const lr = el("div", { className: "mmm-acc" });
      const lrHd = el("div", { style: { display: "flex", alignItems: "center" } });
      lrHd.append(el("div", { className: "hd", text: `LoRA${state.loras.length ? ` (${state.loras.length})` : ""}`, style: { flex: "1" } }));
      lr.appendChild(lrHd);
      const loraOpts = ctx.models.loras || [];
      state.loras.forEach((lo: any, i: number) => {
        const rowEl = el("div", { className: "mmm-lora" });
        rowEl.appendChild(searchSel(loraOpts, lo.name, (v) => { lo.name = v; persist(); }, { placeholder: "search LoRA…" }));
        const str: any = fld(lo.strength ?? 1, (v: number) => { lo.strength = v; persist(); }, { num: true });
        str.title = "strength"; str.style.textAlign = "center";
        const rc = el("div", { style: { display: "flex", flexDirection: "column", gap: "4px", width: "58px", flexShrink: 0 } });
        rc.append(
          el("button", { className: "mmm-del", text: "✕", title: "remove", style: { width: "100%" }, onclick: () => { state.loras.splice(i, 1); persist(); renderCompose(); } }),
          str,
        );
        rowEl.appendChild(rc);
        lr.appendChild(rowEl);
      });
      lr.appendChild(el("button", { className: "mmm-add", text: "+ Add LoRA", onclick: () => { state.loras.push({ name: "none", strength: 1.0 }); persist(); renderCompose(); } }));
      compose.appendChild(lr);

      compose.appendChild(el("div", { className: "mmm-hint",
        text: (() => {
          const b = state.llmBackend;
          const label = b === "openrouter" ? "OpenRouter" : b === "comfy" ? "ComfyUI TextGenerate" : "Local GGUF";
          const mdl = b === "openrouter" ? state.llmOrModel : b === "comfy" ? state.llmClip : state.llmModel;
          return `LLM · ${label}${mdl ? " · " + String(mdl).split(/[\\/]/).pop() : ""} — change in Settings`;
        })(),
      }));
    }

    renderFixed();
    compose.scrollTop = _scroll;
  }

  function renderFixed() {
    clear(composeFixed);
    composeFixed.appendChild(statusEl);
    const seedRow = el("div", { className: "mmm-grid2" });
    seedRow.append(
      fieldCol("seed", fld(state.seed, (v: number) => { state.seed = Math.round(v); persist(); }, { num: true })),
      fieldCol("seed mode", sel([["random", "random"], ["fixed", "fixed"]].map(([v, l]) => ({ value: v, label: l })), state.seedMode || "random", (v) => { state.seedMode = v; persist(); })),
    );
    composeFixed.appendChild(seedRow);
    const genRow = el("div", { style: { display: "flex", gap: "6px" } });
    genRow.append(genBtn, stopBtn);
    composeFixed.appendChild(genRow);
  }

  async function submitPrompt(graph: any, label: string): Promise<any> {
    const body = { prompt: graph, client_id: comfyApi.clientId,
      extra_data: { extra_pnginfo: { workflow: { nodes: [], links: [], extra: { tj_music: label } } } } };
    return comfyApi.fetchApi("/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  }

  function cleanTitle(raw: string) {
    let lines = String(raw || "").split("\n").map((s) => s.trim())
      .filter((s) => s && !/^(let me|okay|here('s| is)|sure|i('ll| will)|analy|think|the (song|track|user)|based on|first)/i.test(s));
    const cands = lines.filter((s) => s.length <= 60);
    let t = (cands.length ? cands[cands.length - 1] : (lines[lines.length - 1] || "")) || "";
    t = t.replace(/^\s*(title|song title|name)\s*[:：-]\s*/i, "")
         .replace(/^[#>*\-\d.)\]\s]+/, "").replace(/["'“”‘’*`]/g, "").trim();
    return t.slice(0, 60) || "Untitled";
  }

  // ── generation queue ───────────────────────────────────────────────────
  let queueBusy = false;

  async function llmOnce(role: string, input: string, context: any) {
    let out = "";
    await runLLM(role, input, context, (t) => { out = String(t || ""); }, null, undefined, true);
    const s = out.trim();
    if (!s) throw new Error(`LLM (${role}) returned no usable text`);
    return s;
  }

  function enqueueGen() {
    if (!state.caption && !state.captionBrief) { statusEl.textContent = "Enter a style first"; return; }
    persist();
    const snap = JSON.parse(JSON.stringify(state));
    genQueue.push({
      id: Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      snap, title: (snap.title || "").trim() || "New track", engine: snap.engine,
      stage: "Queued…", pct: 0, err: false, done: false, cover: null, started: false,
    });
    renderPlaylist();
    statusEl.textContent = genQueue.filter((j) => !j.done && !j.err).length + " in queue";
    runQueue();
  }

  function cancelJob(id: string) {
    const j = genQueue.find((x) => x.id === id);
    if (!j) return;
    if (j.started && !j.err) {
      j.cancelled = true;
      comfyApi.fetchApi("/interrupt", { method: "POST" }).catch(() => {});
    }
    genQueue = genQueue.filter((x) => x.id !== id);
    const n = genQueue.filter((x) => !x.done && !x.err).length;
    statusEl.textContent = n ? n + " in queue" : (queueBusy ? "" : "Cancelled");
    renderPlaylist();
  }

  let queueStopped = false;
  function stopQueue() {
    queueStopped = true;
    comfyApi.fetchApi("/interrupt", { method: "POST" }).catch(() => {});
    genQueue = [];
    statusEl.textContent = "Stopped";
    renderPlaylist();
  }

  async function runQueue() {
    if (queueBusy) return;
    queueBusy = true;
    queueStopped = false;
    try {
      let job: any;
      while ((job = genQueue.find((j) => !j.done && !j.err))) {
        job.started = true;
        await processJob(job).catch((e: any) => {
          job.err = true; job.stage = "Failed — " + String(e.message || e).slice(0, 60);
          paintJob(job);
        });
      }
    } finally {
      queueBusy = false;
      genQueue = genQueue.filter((j) => j.err);
      if (!genQueue.length && !queueStopped) statusEl.textContent = "Done ✓";
      renderPlaylist();
    }
  }

  const STAGE_OF = (ct: string) => {
    if (/TextEncode|CLIPTextEncode/.test(ct)) return "Encoding prompt";
    if (/Sampler|KSampler/.test(ct)) return "Sampling";
    if (/VAEDecode/.test(ct)) return "Decoding audio";
    if (/SaveAudio/.test(ct)) return "Saving";
    return null;
  };

  async function processJob(job: any) {
    const st = job.snap;
    if (!st.caption && st.captionBrief) {
      job.stage = "Writing prompt…"; paintJob(job);
      const role = st.engine === "acestep" ? "caption_acestep" : "caption_minimax";
      const c = await llmOnce(role, st.captionBrief, { lyrics: st.lyrics, ...vocalHintsOf(st) });
      if (c) st.caption = c;
    }
    if (!st.caption) throw new Error("Caption failed — check LLM settings");
    if (st.instrumental) {
      st.lyrics = "";
    } else {
      const li = lyricsIntent(st.lyricsInput);
      if ((li === "brief" || li === "hook") && st.lyricsInput) {
        job.stage = "Writing lyrics…"; paintJob(job);
        // llmOnce는 실패 시 throw → job이 에러로 멈춘다 (원문 brief로 조용히 넘어가지 않음).
        st.lyrics = await llmOnce("lyrics_from_theme", st.lyricsInput,
          { engine: st.engine, language: st.language, duration_seconds: effectiveDuration(st), style_caption: st.caption });
      } else {
        st.lyrics = st.lyricsInput;
      }
    }

    const seed = st.seedMode === "fixed" ? st.seed : randomSeed();
    const { graph, meta, seedUsed } = buildMusicGraph({ ...st, seed }, {});
    job.title = meta.title || job.title;

    job.stage = "Making cover…"; paintJob(job);
    if (st.makeCover) {
      const cfn = await coverImage(meta, { brief: st.coverBrief || "" }).catch(() => null);
      if (cfn) { (meta as any).coverImage = cfn; job.cover = cfn; }
    }

    job.stage = "Queued…"; job.pct = 0; paintJob(job);
    const res = await submitPrompt(graph, `MusicMaker · ${job.title}`);
    if (res.error || (res.node_errors && Object.keys(res.node_errors).length)) {
      throw new Error(res.error?.message || JSON.stringify(res.node_errors || res.error));
    }
    const pid = res.prompt_id;
    job.pid = pid;
    console.info(`[MusicMaker] queued music prompt ${pid} — "${job.title}"`);

    const setStage = (nid: any) => {
      const s = nid ? STAGE_OF(graph[nid]?.class_type || "") : null;
      if (s && s !== job.stage) { job.stage = s; return true; }
      return false;
    };
    const onProg = (d: any) => {
      d = d || {};
      if (d.prompt_id && d.prompt_id !== pid) return;
      setStage(d.node);
      if (d.max) job.pct = Math.min(99, Math.round((d.value / d.max) * 100));
      paintJob(job);
    };
    const onExec = (d: any) => {
      const nid = (d && typeof d === "object") ? d.node : d;
      if ((d && d.prompt_id && d.prompt_id !== pid) || !nid) return;
      if (setStage(nid)) { job.pct = 0; paintJob(job); }
    };
    comfyApi.addEventListener("progress", onProg);
    comfyApi.addEventListener("executing", onExec);
    try {
      let outputs: any = null;
      for (let i = 0; i < 1200 && !outputs; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        if (!genQueue.includes(job)) return;
        const h = await comfyApi.fetchApi(`/history/${pid}`).then((r) => r.json()).catch(() => ({}));
        const e = h[pid];
        if (!e) continue;
        const s = e.status || {};
        if (s.status_str === "error" || (s.messages || []).some((m: any) => m[0] === "execution_error")) throw new Error("Execution error — check Console");
        if (s.completed || s.status_str === "success") outputs = e.outputs;
      }
      if (!outputs) throw new Error("Timed out");
      let audio: any = null;
      for (const nid of Object.keys(outputs)) { const a = outputs[nid].audio || outputs[nid].audios; if (Array.isArray(a) && a.length) { audio = a[0]; break; } }
      if (!audio) throw new Error("No audio output");

      job.stage = "Finishing…"; job.pct = 100; paintJob(job);
      if (!st.titleTouched || !meta.title) {
        (meta as any).title = "";
        const tt = await llmOnce("title", st.caption || st.captionBrief || "", { lyrics: st.lyrics || "" });
        const c = cleanTitle(tt);
        (meta as any).title = (c && c !== "Untitled") ? c : (cleanTitle(st.lyrics || st.caption || "") || "Untitled");
      }
      (meta as any).seed = seedUsed;
      await jpost("/save_meta", { filename: audio.filename, subfolder: audio.subfolder || SUB(), meta });
      await jpost("/set_last_audio", { unique_id: UNIQUE_ID, audio });
      job.done = true;
      genQueue = genQueue.filter((j) => j !== job);
      const stillPending = genQueue.filter((j) => !j.done && !j.err).length;
      statusEl.textContent = stillPending ? stillPending + " in queue" : "Done ✓";
      const wasIdle = audioEl.paused || !audioEl.src;
      await loadPlaylist();
      if (wasIdle && !stillPending) playIndex(0);
    } finally {
      comfyApi.removeEventListener("progress", onProg);
      comfyApi.removeEventListener("executing", onExec);
    }
  }

  function vocalHintsOf(st: any) {
    if (st.instrumental) return { vocal_gender: "instrumental (no vocals)" };
    const o: any = {};
    if (st.vocalGender && st.vocalGender !== "auto") o.vocal_gender = st.vocalGender;
    if (st.vocalStyle  && st.vocalStyle  !== "auto") o.vocal_delivery = st.vocalStyle;
    if (st.voiceTone   && st.voiceTone   !== "auto") o.voice_tone = st.voiceTone;
    if (st.bpm)          o.bpm = st.bpm;
    if (st.keyscale)     o.scale = st.keyscale;
    if (st.timesignature) o.time_sig = st.timesignature;
    return o;
  }

  function regenCoverPopup(t: any) {
    const ov = el("div", { className: "mmm-pop" });
    const box = el("div", { className: "box" });
    box.appendChild(el("h4", { text: "Regenerate cover" }));
    let mode = "auto";
    const ta: any = el("textarea", { className: "mmm-fld", style: { fontSize: "12px", lineHeight: "1.5", opacity: ".4" },
      placeholder: "Describe the cover in plain words — the LLM turns it into a Krea2 prompt." });
    ta.disabled = true;
    const segw = seg([["Auto ReGen", "auto"], ["Prompt ReGen", "prompt"]], mode, (v) => {
      mode = v; ta.disabled = (v === "auto"); ta.style.opacity = v === "auto" ? ".4" : "1";
      if (v === "prompt") ta.focus();
    });
    box.appendChild(segw);
    box.appendChild(el("p", { text: "Auto: the LLM works from the title + lyrics. Prompt: your description goes through the LLM into a Krea2 prompt." }));
    box.appendChild(ta);
    const btns = el("div", { className: "btns" });
    btns.append(
      el("button", { className: "mmm-x", text: "Cancel", onclick: () => ov.remove() }),
      el("button", { className: "mmm-save", style: { padding: "8px 16px", boxShadow: "none" }, text: "ReGenerate", onclick: () => {
        const brief = mode === "prompt" ? ta.value.trim() : "";
        ov.remove();
        regenCover(t, brief);
      }}),
    );
    box.appendChild(btns);
    ov.appendChild(box);
    ov.addEventListener("mousedown", (e: Event) => { if (e.target === ov) ov.remove(); });
    root.appendChild(ov);
  }

  async function regenCover(t: any, brief: string) {
    statusEl.textContent = "Regenerating cover…";
    regenCoverFn = t.filename;
    renderPlaylist();
    try {
      const d = await jget(`/meta?filename=${encodeURIComponent(t.filename)}&subfolder=${encodeURIComponent(t.subfolder || SUB())}`);
      const meta = d.ok ? d.meta : null;
      if (!meta) { statusEl.textContent = "No metadata — can't make a cover"; return; }
      meta.seed = randomSeed();
      const fn = await coverImage(meta, { brief: brief || "" });
      if (!fn) { statusEl.textContent = "Cover failed — check Krea2 in Settings"; return; }
      await jpost("/update_meta", { filename: t.filename, subfolder: t.subfolder || SUB(), patch: { coverImage: fn } });
      statusEl.textContent = "Cover done ✓";
    } catch (e: any) { statusEl.textContent = "Cover error: " + e.message; }
    finally { regenCoverFn = null; loadPlaylist(); }
  }

  async function coverImage(meta: any, opts: any) {
    const kb: any = await import("../krea2/graphBuilder");
    const kcfg = await comfyApi.fetchApi("/krea2_one/config").then((r) => r.json());
    const briefSrc = (opts && "brief" in opts) ? opts.brief : state.coverBrief;
    const brief = (briefSrc || "").trim();
    const llmInput = brief || [meta.title && `Title: ${meta.title}`, meta.lyrics && `Lyrics:\n${meta.lyrics}`].filter(Boolean).join("\n\n");
    if (!llmInput) return null;
    let coverPrompt = "";
    await runLLM("cover_prompt", llmInput, {
      user_brief: brief, title: meta.title || "", style: meta.caption || meta.captionBrief || "",
      has_lyrics: meta.lyrics ? "yes" : "no",
    }, (tt) => coverPrompt = tt.trim());
    if (!coverPrompt) return null;
    const kstate: any = {
      mode: "t2i", model: kcfg.selected_model, textEncoder: kcfg.selected_text_encoder, vae: kcfg.selected_vae,
      prompt: coverPrompt, promptsByMode: { t2i: coverPrompt }, width: 640, height: 640,
      steps: 8, cfg: 1, sampler: "euler", scheduler: "simple", seed: meta.seed || 1, loras: [],
      outputMode: "save", saveSubfolder: SUB() + "/covers",
    };
    const g = kb.buildT2IGraph ? kb.buildT2IGraph(kstate) : (kb.default ? kb.default(kstate) : null);
    if (!g) return null;
    const r = await submitPrompt(g.graph || g, "MusicMaker · cover art");
    const pid = r.prompt_id;
    console.info(`[MusicMaker] queued cover prompt ${pid}`);
    for (let i = 0; i < 150; i++) {
      await new Promise((res) => setTimeout(res, 2000));
      const h = await comfyApi.fetchApi(`/history/${pid}`).then((r) => r.json()).catch(() => ({}));
      const e = h[pid];
      if (e && (e.status?.completed || e.status?.status_str === "success")) {
        for (const nid of Object.keys(e.outputs || {})) {
          const im = e.outputs[nid].images;
          if (Array.isArray(im) && im.length) return im[0].filename;
        }
        return null;
      }
    }
    return null;
  }

  // ── settings overlay — 3 tabs, batch "Save All" ────────────────────────
  const settingsEl: any = el("div", { className: "mmm-ov", style: { display: "none" } });
  const settingsOv = { el: settingsEl, show() { settingsEl.style.display = "flex"; renderSettings(); }, hide() { settingsEl.style.display = "none"; } };
  let setTab = "minimax";
  let pending: any = {};
  let orModels: any = null;

  function setSelectRow(lbl: string, key: string, opts: string[] | undefined, cur: any) {
    return fieldCol(lbl, searchSel(opts || [], pending[key] ?? cur ?? "none", (v) => { pending[key] = v; }, { placeholder: "filter models…" }));
  }
  function setTextRow(lbl: string, key: string, cur: any, placeholder?: string) {
    const i: any = el("input", { className: "mmm-fld", type: (key === "openrouter_key" ? "password" : "text"), placeholder: placeholder || "", value: pending[key] ?? cur ?? "" });
    i.oninput = () => { pending[key] = i.value; };
    return fieldCol(lbl, i);
  }
  const setNote = (t: string) => el("div", { text: t, style: { fontSize: "10.5px", color: C.muted, lineHeight: "1.6" } });

  async function flushSettings() {
    if (!pending || !Object.keys(pending).length) return true;
    try {
      await jpost("/config", pending);
      const map: any = { dit: "dit", clip: "clip", dav: "dav", ace_unet: "aceUnet", ace_clip1: "aceClip1", ace_clip2: "aceClip2", ace_vae: "aceVae", ace_sampler_name: "aceSamplerName", ace_scheduler: "aceScheduler", ace_shift: "aceShift", llm_backend: "llmBackend", llm_model: "llmModel", llm_or_model: "llmOrModel", llm_clip: "llmClip", llm_clip_type: "llmClipType", save_subfolder: "saveSubfolder" };
      const folderChanged = ("save_subfolder" in pending) && (pending.save_subfolder || "") !== (state.saveSubfolder || "");
      for (const k in pending) if (map[k]) state[map[k]] = pending[k];
      persist(); pending = {}; renderCompose();
      if (folderChanged) loadPlaylist();
      return true;
    } catch (e: any) { statusEl.textContent = "Settings save failed: " + e.message; return false; }
  }

  async function renderSettings() {
    clear(settingsEl);
    pending = {};
    const m = ctx.models = await jget("/models").catch(() => ctx.models || {});
    ctx.llmModels = null;
    const cfg = await jget("/config");

    const hd = el("div", { className: "mmm-ov-hd" });
    hd.appendChild(el("div", { className: "t", text: "MusicMaker Settings" }));
    const hdBtns = el("div", { style: { display: "flex", gap: "6px" } });
    hdBtns.appendChild(el("button", { className: "mmm-tb", text: "↻ Refresh models", title: "Re-scan the model folders",
      onclick: async (e: Event) => {
        (e.currentTarget as HTMLButtonElement).textContent = "↻ Scanning…"; (e.currentTarget as HTMLButtonElement).disabled = true;
        ctx.models = null; ctx.llmModels = null; orModels = null;
        await renderSettings();
      }}));
    hdBtns.appendChild(el("button", { className: "mmm-x", text: "Close", title: "Save & close", onclick: async () => { await flushSettings(); settingsOv.hide(); } }));
    hd.appendChild(hdBtns);
    settingsEl.appendChild(hd);

    const tabs: any = el("div", { className: "mmm-tabs" });
    ([["minimax", "MiniMax Music 3"], ["acestep", "Ace-Step 1.5"], ["llm", "LLM"]] as [string, string][]).forEach(([k, lbl]) => {
      tabs.appendChild(el("button", { text: lbl, className: setTab === k ? "on" : "", onclick: () => { setTab = k; renderTab(cfg, m); [...tabs.children].forEach((c: any, i: number) => c.classList.toggle("on", ["minimax", "acestep", "llm"][i] === k)); } }));
    });
    settingsEl.appendChild(tabs);

    const sfIn: any = el("input", { className: "mmm-fld", type: "text", spellcheck: false,
      placeholder: SUBFOLDER, value: pending.save_subfolder ?? cfg.save_subfolder ?? state.saveSubfolder ?? "" });
    sfIn.oninput = () => { pending.save_subfolder = sfIn.value.trim(); };
    const sfRow = fieldCol("Save folder (under ComfyUI output/)", sfIn);
    sfRow.style.margin = "10px 0 2px";
    settingsEl.appendChild(sfRow);
    settingsEl.appendChild(el("div", { text: "Where tracks are saved and where the playlist reads from. Blank = " + SUBFOLDER + ". Covers go in <folder>/covers.",
      style: { fontSize: "10px", color: C.muted, lineHeight: "1.5", marginBottom: "4px" } }));

    const bodyEl = el("div", { className: "mmm-ov-body" });
    settingsEl.appendChild(bodyEl);
    settingsEl._body = bodyEl;
    renderTab(cfg, m);

    settingsEl.appendChild(el("div", { className: "mmm-hint", text: "Changes are saved on Close or Save all — stored on the server, kept after restart." }));
    const saveBtn: any = el("button", { className: "mmm-save", text: "Save all", onclick: async () => {
      saveBtn.disabled = true; saveBtn.textContent = "Saving…";
      const ok = await flushSettings();
      saveBtn.textContent = ok ? "✓ Saved" : "Error — retry";
      setTimeout(() => { saveBtn.textContent = "Save all"; saveBtn.disabled = false; }, 1200);
    }});
    settingsEl.appendChild(saveBtn);
  }

  async function renderTab(cfg: any, m: any) {
    const b = settingsEl._body; clear(b);
    if (setTab === "minimax") {
      b.appendChild(setNote("MiniMax Music 3 — ComfyUI native. Pick the 3 models."));
      b.appendChild(setSelectRow("DiT (diffusion model)", "dit", m.diffusion_models, cfg.dit));
      b.appendChild(setSelectRow("Text encoder", "clip", m.text_encoders, cfg.clip));
      b.appendChild(setSelectRow("Audio VAE (DAV)", "dav", m.vaes, cfg.dav));
    } else if (setTab === "acestep") {
      b.appendChild(setNote("Ace-Step 1.5 — DualCLIP + AuraFlow + 3-stage SamplerCustom chain."));
      b.appendChild(setSelectRow("Diffusion model", "ace_unet", m.diffusion_models, cfg.ace_unet));
      b.appendChild(setSelectRow("CLIP 1 (qwen 0.6b)", "ace_clip1", m.text_encoders, cfg.ace_clip1));
      b.appendChild(setSelectRow("CLIP 2 (qwen 4b)", "ace_clip2", m.text_encoders, cfg.ace_clip2));
      b.appendChild(setSelectRow("VAE (ace_1.5)", "ace_vae", m.vaes, cfg.ace_vae));
      let names = ["jkass_quality"];
      try { const so = await comfyApi.fetchApi("/object_info/KSamplerSelect").then((r) => r.json()); names = so.KSamplerSelect?.input?.required?.sampler_name?.[0] || names; } catch {}
      b.appendChild(fieldCol("sampler_name", sel(names, pending.ace_sampler_name ?? cfg.ace_sampler_name, (v) => { pending.ace_sampler_name = v; })));
      const g = el("div", { className: "mmm-grid2" });
      g.append(
        fieldCol("scheduler", sel(SCHEDULERS, pending.ace_scheduler ?? cfg.ace_scheduler, (v) => { pending.ace_scheduler = v; })),
        fieldCol("shift (AuraFlow)", fld(pending.ace_shift ?? cfg.ace_shift ?? 3, (v: number) => { pending.ace_shift = v; }, { num: true })),
      );
      b.appendChild(g);
    } else {
      b.appendChild(setNote("LLM — writes the lyrics, style caption and cover-art prompts. Captions need strong instruction-following, so OpenRouter is recommended."));
      b.appendChild(fieldCol("Backend", sel(LLM_BACKENDS.map((x) => ({ value: x.key, label: x.label })), pending.llm_backend ?? cfg.llm_backend, (v) => { pending.llm_backend = v; renderTab(cfg, m); })));
      const backend = pending.llm_backend ?? cfg.llm_backend;
      if (backend === "openrouter") {
        if (!orModels) { try { orModels = (await jget("/openrouter_models")).models || []; } catch { orModels = []; } }
        b.appendChild(fieldCol(`Model (${orModels.length} available)`, searchSel(orModels, pending.llm_or_model ?? cfg.llm_or_model, (v) => { pending.llm_or_model = v; }, { placeholder: "search e.g. anthropic/claude" })));
        const keyHint = cfg.openrouter_key_hint || "";
        const keyInput: any = el("input", { className: "mmm-fld", type: "text", autocomplete: "off", spellcheck: false,
          placeholder: keyHint ? "" : "sk-or-v1-…", value: keyHint });
        keyInput.dataset.masked = keyHint ? "1" : "";
        keyInput.onfocus = () => { if (keyInput.dataset.masked === "1") { keyInput.value = ""; keyInput.dataset.masked = ""; keyInput.type = "password"; } };
        keyInput.oninput = () => { pending.openrouter_key = keyInput.value; };
        keyInput.onblur = () => {
          if (!keyInput.value.trim() && keyHint) { keyInput.value = keyHint; keyInput.dataset.masked = "1"; keyInput.type = "text"; delete pending.openrouter_key; }
        };
        b.appendChild(fieldCol("OpenRouter API key", keyInput));
        b.appendChild(el("div", { text: cfg.openrouter_key_set ? "✓ key stored in .env — click the field to replace it" : "⚠ API key required — openrouter.ai/keys", style: { fontSize: "10.5px", color: cfg.openrouter_key_set ? "#7eff7e" : C.warn } }));
      } else if (backend === "comfy") {
        b.appendChild(setNote("Runs ComfyUI's native TextGenerate node — a GGUF/safetensors LLM loaded through a CLIP loader. No extra packages."));
        const clipOpts = [...(m.text_encoders || []), ...(ctx.llmModels || [])];
        b.appendChild(fieldCol(`CLIP / GGUF model (${clipOpts.length})`, searchSel(clipOpts, pending.llm_clip ?? cfg.llm_clip, (v) => { pending.llm_clip = v; }, { placeholder: "search text encoders…" })));
        b.appendChild(fieldCol("CLIP loader type", sel(LLM_CLIP_TYPES, pending.llm_clip_type ?? cfg.llm_clip_type ?? "qwen_image", (v) => { pending.llm_clip_type = v; })));
      } else {
        if (!ctx.llmModels) { try { ctx.llmModels = (await comfyApi.fetchApi("/tj_studio_one/llm/models").then((r) => r.json()).catch(() => ({}))).gguf || []; } catch { ctx.llmModels = []; } }
        if (ctx.llmModels.length) {
          b.appendChild(fieldCol(`GGUF model (${ctx.llmModels.length})`, searchSel(ctx.llmModels, pending.llm_model ?? cfg.llm_model, (v) => { pending.llm_model = v; }, { placeholder: "search GGUF models…" })));
        } else {
          b.appendChild(setTextRow("GGUF model (TJ_NODE)", "llm_model", cfg.llm_model, "no GGUF found — ComfyUI-TJ_NODE required"));
        }
        b.appendChild(setNote("Local LLM needs ComfyUI-TJ_NODE installed. OpenRouter gives better caption quality."));
      }
    }
  }
  root.appendChild(settingsEl);

  // ── mount ──────────────────────────────────────────────────────────────
  container.appendChild(root);

  // 노드의 onRemoved(플레이어 정지)에 해당 — 라우터가 화면을 갈아끼우면 detached Audio가
  // 계속 재생되므로, root가 문서에서 사라지면 정지하고 리스너를 뗀다.
  const leaveGuard = () => {
    if (!document.body.contains(root)) { stopPlayback(); window.removeEventListener("hashchange", leaveGuard); }
  };
  window.addEventListener("hashchange", leaveGuard);

  jget("/models").then((d) => { ctx.models = d; renderCompose(); }).catch(() => {});
  jget("/node_availability").then((d) => { ctx.availability = d.available || {}; }).catch(() => {});
  jget("/config").then((d) => {
    state.dit = state.dit || d.dit; state.clip = state.clip || d.clip; state.dav = state.dav || d.dav;
    state.aceUnet = state.aceUnet || d.ace_unet; state.aceClip1 = state.aceClip1 || d.ace_clip1;
    state.aceClip2 = state.aceClip2 || d.ace_clip2; state.aceVae = state.aceVae || d.ace_vae;
    state.aceSamplerName = state.aceSamplerName || d.ace_sampler_name;
    if (!state.saveSubfolder && d.save_subfolder && d.save_subfolder !== SUBFOLDER) state.saveSubfolder = d.save_subfolder;
    if (d.llm_backend)    state.llmBackend  = d.llm_backend;
    if (d.llm_model != null)    state.llmModel   = d.llm_model;
    if (d.llm_or_model != null) state.llmOrModel = d.llm_or_model;
    if (d.llm_clip != null)     state.llmClip    = d.llm_clip;
    if (d.llm_clip_type)  state.llmClipType = d.llm_clip_type;
    persist(); renderCompose();
  }).catch(() => {});
  renderCompose();
  loadPlaylist();

  // 별도 갤러리 페이지에서 트랙 ↺(Reuse)로 넘어온 경우 — 한 번만 소비.
  const handoff = takeReuse("music");
  if (handoff) applyReuseMeta(handoff);
}
