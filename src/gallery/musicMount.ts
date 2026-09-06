// musicMount.ts — MusicMaker's track library for the standalone gallery page.
//
// MusicMaker has no `createGalleryOverlay` (its playlist lives inside the tool view). This is a
// focused, self-contained library: the same SUNO playlist + player + selection UI, minus
// compose/generate/LLM. Row layout / `.mmm-*` classes match the tool's `trackRow`. Reads the
// node's `/music_one/*` routes via the tool's `api.ts`; Reuse stashes the track meta and hops
// to `#music`.
import type { GalleryMount } from "./mounts";
import { navigateToTool } from "../shared/galleryNav";
import { stashReuse } from "../shared/galleryHandoff";
import { mediaKey, attachSensitiveToggle } from "../shared/sensitiveMedia";
import {
  C, PLAYER_H, SUBFOLDER, ensureMusicStyles,
  el, clear, defaultState, loadState, saveState, fmtDur, settingsBadge,
} from "../tools/music/core";
import { comfyApi, jget, jpost, viewURL } from "../tools/music/api";

export function createMusicGalleryMount(): GalleryMount {
  ensureMusicStyles();
  const state: any = defaultState(loadState());
  const persist = () => saveState(state);
  const SUB = () => (state.saveSubfolder || "").trim().replace(/^[\/\\]+|[\/\\]+$/g, "") || SUBFOLDER;

  const CONT_KEY = "music_gallery_continuous";
  let continuous = (() => { try { return localStorage.getItem(CONT_KEY) !== "0"; } catch { return true; } })();

  // ── root ────────────────────────────────────────────────────────────────
  const box = el("div", { style: {
    position: "absolute", inset: "0", display: "none", flexDirection: "column",
    background: C.bg0, color: C.text, fontSize: "12px", padding: "12px", gap: "10px", boxSizing: "border-box",
  }});

  // ── player ──────────────────────────────────────────────────────────────
  const audioEl = new Audio(); audioEl.preload = "metadata";
  const bar = el("div", { className: "mmm-bar", style: { height: `${PLAYER_H}px` } });
  const miniCover = el("div", { style: { width: "40px", height: "40px", borderRadius: "8px", background: C.bg3, flexShrink: 0, backgroundSize: "cover", backgroundPosition: "center", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "800", fontSize: "12px", color: C.muted } });
  const nowWrap = el("div", { style: { width: "170px", flexShrink: 0, overflow: "hidden" } });
  const nowTitle = el("div", { style: { fontSize: "11.5px", color: C.text, fontWeight: "600", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, text: "Pick a track to play" });
  const nowSub = el("div", { style: { fontSize: "10px", color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, text: "" });
  nowWrap.append(nowTitle, nowSub);
  const SVG_PLAY  = `<svg width="13" height="14" viewBox="0 0 13 14"><path d="M1 1.2c0-.7.8-1.1 1.4-.7l9 5.6c.5.3.5 1.1 0 1.4l-9 5.6c-.6.4-1.4 0-1.4-.7z"/></svg>`;
  const SVG_PAUSE = `<svg width="12" height="14" viewBox="0 0 12 14"><rect x="1" y="1" width="3.5" height="12" rx="1"/><rect x="7.5" y="1" width="3.5" height="12" rx="1"/></svg>`;
  const prevBtn = el("button", { className: "mmm-ib", text: "◄◄", title: "Previous", onclick: () => playIndex(curIdx - 1) });
  const playBtn: any = el("button", { className: "mmm-pp", title: "Play / pause", onclick: () => { audioEl.paused ? audioEl.play() : audioEl.pause(); } });
  playBtn.innerHTML = SVG_PLAY;
  const nextBtn = el("button", { className: "mmm-ib", text: "►►", title: "Next", onclick: () => playIndex(curIdx + 1) });
  const contBtn: any = el("button", { className: "mmm-ib" + (continuous ? " act" : ""), text: "⟳" });
  const paintCont = () => { contBtn.classList.toggle("act", continuous); contBtn.title = continuous ? "Continuous play (click for single track)" : "Single track (click for continuous)"; };
  paintCont();
  contBtn.onclick = () => { continuous = !continuous; try { localStorage.setItem(CONT_KEY, continuous ? "1" : "0"); } catch {} paintCont(); };
  const curT = el("span", { style: { fontSize: "10px", color: C.muted, width: "34px", textAlign: "right", flexShrink: 0 }, text: "0:00" });
  const durT = el("span", { style: { fontSize: "10px", color: C.muted, width: "34px", flexShrink: 0 }, text: "0:00" });
  const seek: any = el("input", { className: "mmm-seek", type: "range", min: "0", max: "1000", value: "0" });
  seek.addEventListener("input", () => { if (audioEl.duration) audioEl.currentTime = (seek.value / 1000) * audioEl.duration; });
  const vol: any = el("input", { className: "mmm-vol", type: "range", min: "0", max: "1", step: "0.02", value: "1", title: "Volume" });
  vol.addEventListener("input", () => { audioEl.volume = +vol.value; });
  bar.append(miniCover, nowWrap, prevBtn, playBtn, nextBtn, curT, seek, durT, contBtn, vol);

  audioEl.addEventListener("timeupdate", () => {
    curT.textContent = fmtDur(audioEl.currentTime);
    if (audioEl.duration) seek.value = String((audioEl.currentTime / audioEl.duration) * 1000);
  });
  audioEl.addEventListener("loadedmetadata", () => { durT.textContent = fmtDur(audioEl.duration); });
  audioEl.addEventListener("play",  () => playBtn.innerHTML = SVG_PAUSE);
  audioEl.addEventListener("pause", () => playBtn.innerHTML = SVG_PLAY);
  audioEl.addEventListener("ended", () => { if (continuous) playIndex(curIdx + 1); });
  const stopPlayback = () => { try { audioEl.pause(); audioEl.removeAttribute("src"); audioEl.load(); } catch {} };

  // ── playlist ────────────────────────────────────────────────────────────
  let tracks: any[] = [], curIdx = -1;
  const selected = new Set<string>();
  let favOnly = false;

  const head = el("div", { style: { display: "flex", alignItems: "center", gap: "7px", flexShrink: 0 } });
  head.appendChild(el("div", { text: "MusicMaker library", style: { fontWeight: "700", fontSize: "13px", color: C.text, flexShrink: 0 } }));
  const searchIn: any = el("input", { type: "text", placeholder: "Search", className: "mmm-fld", style: { flex: "1", padding: "5px 9px", fontSize: "11px" } });
  const favTgl: any = el("button", { className: "mmm-ib", text: "★", title: "Favorites only", onclick: () => { favOnly = !favOnly; favTgl.classList.toggle("act", favOnly); loadPlaylist(); } });
  const sortSel: any = el("select", { className: "mmm-sel", style: { width: "auto", fontSize: "11px", padding: "5px 26px 5px 9px" } });
  [["newest", "Newest"], ["oldest", "Oldest"], ["title", "Title"]].forEach(([v, l]) => { const o: any = el("option", { text: l }); o.value = v; sortSel.appendChild(o); });
  sortSel.addEventListener("change", () => loadPlaylist());
  head.append(searchIn, favTgl, sortSel);

  const selBar = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "11.5px", color: C.text, padding: "4px 2px", flexShrink: 0 } });
  // 2-column grid — rows are horizontal cards, two per line.
  const listBody = el("div", { className: "mmm-lp", style: {
    flex: "1", overflowY: "auto", minHeight: 0,
    display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "4px 10px", alignContent: "start",
  }});

  box.append(head, selBar, listBody, bar);

  function coverURL(fn: string) { return `url("${comfyApi.base}/view?filename=${encodeURIComponent(fn)}&subfolder=${encodeURIComponent(SUB() + "/covers")}&type=output")`; }
  const engLabel = (x: any) => (x && x.engine === "acestep") ? "ACE" : "MM";
  const coverPlaceholder = (x: any, fs?: string) => el("span", { className: "mmm-engtxt", text: engLabel(x), style: fs ? { fontSize: fs } : {} });

  function renderSelBar() {
    clear(selBar);
    const n = selected.size;
    selBar.appendChild(el("span", { text: `${n} selected`, style: { flex: "1", color: n ? C.text : C.muted } }));
    const delBtn: any = el("button", { className: "mmm-x", text: "Delete", style: n ? { borderColor: C.err, color: C.err } : { opacity: ".4", cursor: "default" }, onclick: async () => {
      if (!n || !confirm(`Delete ${n} track(s)?`)) return;
      await jpost("/delete", { filenames: [...selected], subfolder: SUB() });
      selected.clear(); loadPlaylist();
    }});
    const clrBtn: any = el("button", { className: "mmm-x", text: "Clear", style: n ? {} : { opacity: ".4", cursor: "default" }, onclick: () => { if (n) { selected.clear(); renderList(); } } });
    delBtn.disabled = !n; clrBtn.disabled = !n;
    selBar.append(delBtn, clrBtn);
  }

  function playIndex(i: number) {
    if (i < 0 || i >= tracks.length) return;
    curIdx = i;
    const t = tracks[i];
    audioEl.src = viewURL(t);
    audioEl.play().catch(() => {});
    nowTitle.textContent = t.title || t.filename;
    nowSub.textContent = settingsBadge(t) || (t.engine === "acestep" ? "Ace-Step 1.5" : "MiniMax Music 3");
    if (t.cover) { miniCover.style.backgroundImage = coverURL(t.cover); miniCover.textContent = ""; }
    else { miniCover.style.backgroundImage = "none"; miniCover.textContent = engLabel(t); }
    renderList();
  }
  function togglePlay(i: number) {
    if (i === curIdx && audioEl.src) { audioEl.paused ? audioEl.play().catch(() => {}) : audioEl.pause(); }
    else playIndex(i);
  }
  function restartPlay(i: number) {
    if (i !== curIdx || !audioEl.src) { playIndex(i); return; }
    audioEl.currentTime = 0; audioEl.play().catch(() => {});
  }

  function popMenu(ev: any, entries: any[]) {
    document.querySelectorAll(".mmm-menu").forEach((n) => n.remove());
    const m: any = el("div", { className: "mmm-menu" });
    entries.forEach((e) => {
      if (e === "-") { m.appendChild(el("div", { className: "sep" })); return; }
      const it: any = el("div", { className: "it" + (e.danger ? " danger" : ""), text: e.label });
      it.onclick = () => { m.remove(); e.fn(); };
      m.appendChild(it);
    });
    m.style.visibility = "hidden";
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(ev.clientX, window.innerWidth - r.width - 8) + "px";
    m.style.top = Math.min(ev.clientY, window.innerHeight - r.height - 8) + "px";
    m.style.visibility = "visible";
    const close = (e2: any) => { if (!m.contains(e2.target)) { m.remove(); document.removeEventListener("mousedown", close); } };
    setTimeout(() => document.addEventListener("mousedown", close), 0);
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
    const big = el("div", { style: { width: "168px", height: "168px", flexShrink: 0, borderRadius: "12px", background: C.bg2, backgroundSize: "cover", backgroundPosition: "center", display: "flex", alignItems: "center", justifyContent: "center" } });
    if (t.cover) big.style.backgroundImage = coverURL(t.cover); else big.appendChild(coverPlaceholder(t, "44px"));
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
    box.appendChild(ov);
  }

  async function reuse(t: any) {
    const d = await jget(`/meta?filename=${encodeURIComponent(t.filename)}&subfolder=${encodeURIComponent(t.subfolder || SUB())}`);
    stashReuse("music", (d && d.ok ? d.meta : null) || { engine: t.engine, title: t.title, seconds: t.seconds });
    navigateToTool("#music");
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

    const cover: any = el("div", { className: "mmm-cover", title: "Track info", onclick: (e: Event) => { e.stopPropagation(); showInfo(t); } });
    if (t.cover) cover.style.backgroundImage = coverURL(t.cover);
    else cover.appendChild(coverPlaceholder(t));
    if (t.seconds) cover.appendChild(el("div", { className: "mmm-dur", text: fmtDur(t.seconds) }));
    attachSensitiveToggle(cover, cover, mediaKey(t.filename, t.subfolder || SUB()), "br");

    const mid = el("div", { style: { flex: "1", minWidth: 0 } });
    let clickT: any = null;
    const title = el("div", { className: "mmm-tt", text: t.title || t.filename, title: "Click to play/pause · double-click to restart" });
    title.onclick = () => { clearTimeout(clickT); clickT = setTimeout(() => togglePlay(i), 200); };
    title.ondblclick = () => { clearTimeout(clickT); restartPlay(i); };
    const trow = el("div", { className: "mmm-trow" });
    const acts = el("div", { className: "mmm-acts" });
    acts.appendChild(el("button", { className: "mmm-ib", title: "Reuse in MusicMaker", text: "↺", onclick: (e: Event) => { e.stopPropagation(); reuse(t); } }));
    acts.appendChild(el("button", { className: "mmm-ib", title: "Info", text: "ⓘ", onclick: (e: Event) => { e.stopPropagation(); showInfo(t); } }));
    acts.appendChild(el("button", { className: "mmm-ib", title: "Download tagged MP3", text: "↓", onclick: async (e: Event) => {
      e.stopPropagation();
      const btn = e.currentTarget as HTMLButtonElement; const old = btn.textContent; btn.textContent = "…"; btn.disabled = true;
      try {
        const rr = await comfyApi.fetchApi(`/music_one/download?filename=${encodeURIComponent(t.filename)}&subfolder=${encodeURIComponent(t.subfolder || SUB())}`);
        if (!rr.ok) throw new Error(await rr.text());
        const a = document.createElement("a");
        a.href = URL.createObjectURL(await rr.blob());
        a.download = (t.title || t.filename).replace(/[\\/:*?"<>|]/g, "_") + ".mp3";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } catch { /* ignore */ }
      finally { btn.textContent = old; btn.disabled = false; }
    }}));
    acts.appendChild(el("button", { className: "mmm-ib", title: "More", text: "⋯", onclick: (e: Event) => { e.stopPropagation(); popMenu(e, [
      { label: "Rename", fn: async () => { const nn = prompt("New title", t.title || ""); if (nn != null) { await jpost("/update_meta", { filename: t.filename, subfolder: SUB(), patch: { title: nn } }); loadPlaylist(); } } },
      { label: "Open folder", fn: () => jpost("/open_folder", { filename: t.filename, subfolder: SUB() }) },
      "-",
      { label: "Delete", danger: true, fn: async () => { if (confirm("Delete this track?")) { await jpost("/delete", { filename: t.filename, subfolder: SUB() }); loadPlaylist(); } } },
    ]); } }));

    trow.append(title, el("span", { className: "mmm-eng", text: t.engine === "acestep" ? "Ace-Step" : "MiniMax" }), el("div", { style: { flex: "1" } }), acts);
    mid.appendChild(trow);
    const subText = (t.caption || "").replace(/\s*\n\s*/g, " ").trim() || (t.instrumental ? "instrumental" : settingsBadge(t));
    mid.appendChild(el("div", { className: "mmm-sub", text: subText }));
    r.append(lcol, cover, mid);
    return r;
  }

  function renderList() {
    clear(listBody);
    const q = searchIn.value.trim().toLowerCase();
    const shown = tracks.filter((t) => !q || (t.title || t.filename).toLowerCase().includes(q));
    shown.forEach((t) => listBody.appendChild(trackRow(t, tracks.indexOf(t))));
    if (!tracks.length) listBody.appendChild(el("div", { style: { gridColumn: "1 / -1", color: C.muted, padding: "48px 20px", textAlign: "center", fontSize: "12px", lineHeight: "1.7" }, html: "No tracks in this folder.<br>Generate some in <b>MusicMaker</b>." }));
    renderSelBar();
  }
  searchIn.addEventListener("input", renderList);

  async function loadPlaylist() {
    try {
      const playingFn = curIdx >= 0 ? tracks[curIdx]?.filename : null;
      const d = await jget(`/playlist?limit=300&sort=${sortSel.value}${favOnly ? "&favonly=1" : ""}&subfolder=${encodeURIComponent(SUB())}`);
      tracks = d.tracks || [];
      curIdx = playingFn ? tracks.findIndex((t) => t.filename === playingFn) : -1;
      renderList();
    } catch (e) { console.warn("[music-gallery] playlist", e); }
  }

  // ── settings (save folder) ─────────────────────────────────────────────
  const settingsEl: any = el("div", { className: "mmm-ov", style: { display: "none" } });
  function renderSettings() {
    clear(settingsEl);
    const hd = el("div", { className: "mmm-ov-hd" });
    hd.appendChild(el("div", { className: "t", text: "MusicMaker library — folder" }));
    hd.appendChild(el("button", { className: "mmm-x", text: "Close", onclick: () => toggleSettings() }));
    settingsEl.appendChild(hd);
    const body = el("div", { className: "mmm-ov-body" });
    jget("/config").then((cfg) => {
      const inp: any = el("input", { className: "mmm-fld", type: "text", spellcheck: false, placeholder: SUBFOLDER,
        value: state.saveSubfolder || cfg.save_subfolder || "" });
      const row = el("div");
      row.append(el("label", { className: "mmm-lbl", text: "Save folder (under ComfyUI output/)" }), inp);
      body.appendChild(row);
      body.appendChild(el("div", { className: "mmm-hint", text: `Where the library reads from. Blank = ${SUBFOLDER}. Covers are in <folder>/covers.` }));
      const save = el("button", { className: "mmm-save", text: "Apply", onclick: async () => {
        const v = inp.value.trim();
        state.saveSubfolder = v; persist();
        await jpost("/config", { save_subfolder: v }).catch(() => {});
        toggleSettings();
        loadPlaylist();
      }});
      body.appendChild(save);
    }).catch(() => {});
    settingsEl.appendChild(body);
  }
  box.appendChild(settingsEl);

  let settingsOpen = false;
  function toggleSettings() {
    settingsOpen = !settingsOpen;
    settingsEl.style.display = settingsOpen ? "flex" : "none";
    if (settingsOpen) renderSettings();
    return settingsOpen;
  }

  // stop the detached <audio> when the mount is hidden / the page navigates away
  window.addEventListener("pagehide", stopPlayback);

  return {
    el: box,
    show() { box.style.display = "flex"; loadPlaylist(); },
    hide() { box.style.display = "none"; stopPlayback(); },
    refresh() { renderList(); },
    toggleSettings,
  };
}
