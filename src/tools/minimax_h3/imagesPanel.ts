// imagesPanel.ts — 모드별 이미지 입력 (원본: web/minimax/ui_images_minimax.js)
// Text only는 이미지 없음, First/Last Frame은 키프레임 2장, Reference는 이미지 9 +
// 비디오 3 + 오디오 3(옵트인). 이게 없으면 First/Last·Reference 모드는 이미지를 넣을
// 방법이 없어 사실상 동작 불가 — 반드시 있어야 하는 패널.
import type { MinimaxState } from "./core";
import { button, col, el, clear, label, numberField, panel, row, select } from "../../shared/ui";
import { C, BRAND } from "../../identity";
import { getMediaInfo, uploadImage, uploadMedia, viewUrl } from "./api";
import { openImageGalleryPicker, INPUT_TOOL_ID } from "../../shared/imageGalleryPicker";
import { openVideoGalleryPicker } from "./videoPicker";

export interface ImagesPanelCtx {
  persist: () => void;
  showPopup: (msg: string, isError?: boolean) => void;
  availability?: Record<string, boolean>;
  // Filenames confirmed missing from ComfyUI's input/ folder (SPEC_MINIMAX_H3_PER_CLIP_
  // OVERRIDE.md §8) — checked in one batch after a prompt-set load, not per-tile.
  missingAssets?: Set<string>;
}

export interface ImageSlotHandle {
  el: HTMLElement;
  setFilename(name: string | null): void;
  getFilename(): string | null;
}

export function imageSlot(labelText: string, initialFile: string | null, onSet: (name: string | null) => void, opts: { box?: number; missing?: boolean } = {}): ImageSlotHandle {
  const box = opts.box ?? 132;
  const wrap = el("div", { class: "flex flex-col gap-1 items-center" });
  const frame = el("div", {
    class: "relative shrink-0 flex items-center justify-center overflow-hidden rounded-lg cursor-pointer",
    style: { width: `${box}px`, height: `${box}px`, background: "#000", border: `1px solid ${C.border}` },
  });
  const hint = el("div", { text: labelText, class: "text-center pointer-events-none", style: { color: C.muted, fontSize: "10px", padding: "0 6px", whiteSpace: "pre-line" } });
  const img = el("img", { class: "absolute inset-0 w-full h-full pointer-events-none", style: { objectFit: "contain", display: "none" } });
  // Ghost tile (§8) — the filename is remembered but the file itself is gone from input/. A
  // blank slot would be indistinguishable from "never had a picture here" and the count
  // (3 photos vs. 0) would silently be lost. Keeps the number badge/✕ and stays clickable —
  // this is a "needs attention" marker, not a locked cell.
  const ghost = el("div", {
    class: "absolute inset-0 flex flex-col items-center justify-center gap-1 pointer-events-none text-center",
    style: { display: "none", padding: "4px" },
  });
  ghost.append(
    el("div", { text: "⚠", style: { fontSize: "16px", color: C.warn } }),
    el("div", { class: "leading-tight break-all", style: { color: C.warn, fontSize: "8.5px" } })
  );
  const clearBtn = el("button", {
    type: "button", text: "✕", title: "Clear",
    class: "absolute top-1 right-1 z-[3] hidden",
    style: { background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", borderRadius: "4px", width: "18px", height: "18px", cursor: "pointer", fontSize: "10px", padding: "0" },
  });
  // 로컬업로드(박스 클릭/드래그) 외에 이미지 도구 갤러리에서 직접 고를 수 있는 방법.
  const galleryBtn = el("button", {
    type: "button", text: "🖼", title: "Pick from gallery",
    class: "absolute bottom-1 left-1 z-[3]",
    style: { background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", borderRadius: "4px", width: "20px", height: "20px", cursor: "pointer", fontSize: "11px", padding: "0" },
  });
  galleryBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openImageGalleryPicker((filename) => { setFilename(filename); onSet(filename); }, INPUT_TOOL_ID);
  });
  let current: string | null = null;
  function setFilename(name: string | null) {
    current = name || null;
    const missing = !!current && !!opts.missing;
    if (current && !missing) {
      img.setAttribute("src", viewUrl(current) + `&t=${Date.now()}`);
      img.style.display = "block";
      hint.style.display = "none";
      ghost.style.display = "none";
      clearBtn.classList.remove("hidden");
      frame.style.borderStyle = "solid";
      frame.style.borderColor = C.border;
      frame.title = "";
    } else if (missing) {
      img.style.display = "none";
      hint.style.display = "none";
      ghost.style.display = "flex";
      (ghost.lastChild as HTMLElement).textContent = current;
      clearBtn.classList.remove("hidden");
      frame.style.borderStyle = "dashed";
      frame.style.borderColor = C.warn;
      frame.title = `Missing from the input folder:\n${current}`;
    } else {
      img.style.display = "none";
      hint.style.display = "";
      ghost.style.display = "none";
      clearBtn.classList.add("hidden");
      frame.style.borderStyle = "solid";
      frame.style.borderColor = C.border;
      frame.title = "";
    }
  }
  frame.append(hint, img, ghost, clearBtn, galleryBtn);
  wrap.appendChild(frame);

  const inp = el("input", { type: "file", accept: "image/*", style: { display: "none" } }) as HTMLInputElement;
  wrap.appendChild(inp);
  async function take(file: File) {
    if (!file) return;
    const name = await uploadImage(file);
    setFilename(name);
    onSet(name);
  }
  inp.addEventListener("change", async () => {
    if (inp.files?.[0]) await take(inp.files[0]);
    inp.value = "";
  });
  frame.addEventListener("click", (e) => {
    if (e.target === clearBtn) return;
    inp.click();
  });
  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setFilename(null);
    onSet(null);
  });
  // 드래그앤드롭 — 탐색기로 찾는 방식(클릭) 외에 파일을 끌어다 놓아도 업로드된다.
  frame.addEventListener("dragover", (e) => { e.preventDefault(); frame.style.borderColor = BRAND; });
  frame.addEventListener("dragleave", () => { frame.style.borderColor = C.border; });
  frame.addEventListener("drop", async (e) => {
    e.preventDefault();
    frame.style.borderColor = C.border;
    const f = e.dataTransfer?.files?.[0];
    if (f) await take(f);
  });

  setFilename(initialFile);
  return { el: wrap, setFilename, getFilename: () => current };
}

const REF_KINDS = [
  { key: "images", label: "Images", max: 9 },
  { key: "videos", label: "Videos", max: 3 },
  { key: "audios", label: "Audios", max: 3 },
] as const;

function refTypeDropdown(state: MinimaxState, ctx: ImagesPanelCtx, onChange: () => void) {
  const wrap = el("div", { style: { position: "relative" } });
  const counts = () => ({
    images: (state.refImages || []).filter(Boolean).length,
    videos: ((state as any).refVideos || []).filter((v: any) => v && v.file).length,
    audios: ((state as any).refAudios || []).filter((a: any) => a && a.file).length,
  });
  const btn = el("button", {
    type: "button",
    class: "w-full flex items-center gap-1.5 text-left",
    style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "6px 8px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` },
  });
  const btnText = el("span", { class: "flex-1" });
  btn.append(btnText, el("span", { text: "▾", style: { color: C.muted } }));

  const menu = el("div", {
    class: "hidden flex-col gap-0.5",
    style: { position: "absolute", top: "calc(100% + 3px)", left: "0", right: "0", zIndex: "50", background: C.bg2, border: `1px solid ${BRAND}`, borderRadius: "6px", padding: "5px", boxShadow: "0 6px 18px rgba(0,0,0,0.55)" },
  });

  function refreshLabel() {
    const c = counts();
    const on = REF_KINDS.filter((k) => (state as any).refTypes?.[k.key]);
    btnText.textContent = on.length ? on.map((k) => `${k.label} ${(c as any)[k.key]}/${k.max}`).join(" · ") : "no reference types selected";
    btnText.style.color = on.length ? C.text : C.warn;
  }

  function buildMenu() {
    clear(menu);
    const c = counts();
    REF_KINDS.forEach((k) => {
      const chk = el("input", { type: "checkbox" }) as HTMLInputElement;
      chk.checked = !!(state as any).refTypes?.[k.key];
      chk.addEventListener("change", () => {
        (state as any).refTypes = { ...((state as any).refTypes || {}), [k.key]: chk.checked };
        ctx.persist();
        refreshLabel();
        onChange?.();
      });
      const line = el(
        "label",
        { class: "flex items-center gap-1.5 cursor-pointer rounded", style: { fontSize: "11px", color: C.text, padding: "4px 5px" } },
        [chk, el("span", { text: k.label, class: "flex-1" }), el("span", { text: `${(c as any)[k.key]}/${k.max}`, style: { color: C.muted, fontSize: "10px" } })]
      );
      line.addEventListener("mouseenter", () => (line.style.background = C.bg3));
      line.addEventListener("mouseleave", () => (line.style.background = "transparent"));
      menu.appendChild(line);
    });
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !menu.classList.contains("hidden");
    if (open) {
      menu.classList.add("hidden");
      return;
    }
    buildMenu();
    menu.classList.remove("hidden");
    menu.style.display = "flex";
    const close = (ev: MouseEvent) => {
      if (wrap.contains(ev.target as Node)) return;
      menu.classList.add("hidden");
      document.removeEventListener("mousedown", close);
    };
    setTimeout(() => document.addEventListener("mousedown", close), 0);
  });

  refreshLabel();
  wrap.append(btn, menu);
  return { el: wrap, refreshLabel };
}

// ui_clip_media_slots.js 원본을 그대로 옮긴 것 — 왼쪽 패널(공통)과 Prompt Edit(클립 전용)
// 양쪽에서 이 한 모듈을 쓴다. 이미지 타일과 같은 조립: 클릭해서 채우는 작은 사각형 + 그
// 아래 한 줄씩 쌓이는 컨트롤. 두 미디어 타일 다 정사각이 아니라 가로가 긴 직사각형이다 —
// 영상 프레임은 16:9라 정사각으로 자르면 양옆이 날아가고, 오디오는 파일명을 보여줄
// 가로 폭이 필요하다.
const MEDIA_TILE = 54; // 이미지 타일과 같은 높이
const MEDIA_TILE_W = 72;
const TINY = "9.5px"; // "source 59.40s · 30fps" 크기

// 슬라이더 핸들은 인라인 스타일로 못 줄인다 — 스타일시트가 한 번 있어야 한다.
let sliderCssInjected = false;
function ensureSliderCss() {
  if (sliderCssInjected) return;
  sliderCssInjected = true;
  const st = document.createElement("style");
  st.textContent = `
    .aos-mmh3-scrub { -webkit-appearance: none; appearance: none; background: transparent; }
    .aos-mmh3-scrub::-webkit-slider-runnable-track { height: 3px; background: ${C.border}; border-radius: 2px; }
    .aos-mmh3-scrub::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 6px; height: 6px; border-radius: 50%; background: ${BRAND}; border: none; margin-top: -1.5px; }
    .aos-mmh3-scrub::-moz-range-track { height: 3px; background: ${C.border}; border-radius: 2px; }
    .aos-mmh3-scrub::-moz-range-thumb { width: 6px; height: 6px; border-radius: 50%; background: ${BRAND}; border: none; }
  `;
  document.head.appendChild(st);
}

/** m:ss — the transport and the length readout share this form. */
function clock(sec: number): string {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A one-line labelled number field, as small as it can be and still be clickable. */
function tinyNum(labelText: string, value: number, onChange: (v: number) => void, clamp?: (v: number) => number) {
  const inp = el("input", { type: "number", step: "0.5", style: { width: "44px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "1px 3px", fontSize: TINY, fontFamily: "inherit", outline: "none" } }) as HTMLInputElement;
  inp.value = String(value ?? 0);
  inp.addEventListener("change", () => {
    // Correcting the stored number but leaving the box showing the rejected one reads as
    // the edit having been accepted, so the field is written back too.
    const v = (clamp || ((x: number) => Math.max(0, x)))(Number(inp.value) || 0);
    inp.value = String(v);
    onChange(v);
  });
  const wrap = el("div", { class: "flex items-center justify-center gap-1", style: { fontSize: TINY, color: C.muted } }, [el("span", { text: labelText }), inp]);
  return { el: wrap, input: inp };
}

/**
 * One slot. `kind` is "video" or "audio".
 *
 * Video shows a frame of the file and previews muted on hover, the way the gallery does — a
 * still frame alone doesn't tell you which take you grabbed. Audio has no frame to show, so
 * the tile carries the filename instead, wrapped, with the full name on hover.
 */
function mediaSlot(kind: "video" | "audio", list: any[], idx: number, ctx: ImagesPanelCtx, onRefresh: () => void, onPickFromGallery: ((onPicked: (name: string) => void) => void) | null, missing?: Set<string>) {
  const isVideo = kind === "video";
  const entry = list[idx] || {};
  const isGone = !!entry.file && !!missing?.has(entry.file);
  const wrap = el("div", { class: "flex flex-col gap-0.5 items-center shrink-0", style: { width: `${MEDIA_TILE_W}px` } });

  const tile = el("div", { class: "relative overflow-hidden rounded-md cursor-pointer flex items-center justify-center shrink-0", style: { width: `${MEDIA_TILE_W}px`, height: `${MEDIA_TILE}px`, border: `1px solid ${C.border}`, background: "#000" } });

  let media: HTMLVideoElement | HTMLAudioElement | null = null;
  if (isGone) {
    // The file this slot was saved with is no longer in input/. Say which one, rather than
    // showing an empty tile that looks like nothing was ever attached.
    tile.style.border = `1px dashed ${C.warn}`;
    tile.style.background = "#1a1206";
    tile.title = `Missing from the input folder:\n${entry.file}`;
    tile.appendChild(
      el("div", { class: "flex flex-col items-center justify-center gap-0.5", style: { width: "100%", height: "100%", padding: "2px", boxSizing: "border-box" } }, [
        el("div", { text: "⚠", style: { fontSize: "13px", color: C.warn, lineHeight: "1" } }),
        el("div", { text: entry.file, class: "text-center break-all overflow-hidden", style: { fontSize: "6.5px", color: C.warn, lineHeight: "1.1", maxHeight: "22px" } }),
      ])
    );
    const gx = el("button", { type: "button", text: "✕", title: "Remove this missing entry", class: "absolute top-0 right-0 z-[3]", style: { cursor: "pointer", fontSize: "10px", background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", padding: "1px 4px" } });
    gx.addEventListener("click", (e) => { e.stopPropagation(); list.splice(idx, 1); ctx.persist(); onRefresh(); });
    tile.appendChild(gx);
  } else if (entry.file) {
    if (isVideo) {
      const v = el("video", { muted: "", playsinline: "", preload: "metadata", class: "w-full h-full", style: { objectFit: "cover" } }) as HTMLVideoElement;
      v.src = viewUrl(entry.file);
      v.muted = true;
      // Hover-scrub, same affordance as the gallery: it costs nothing until pointed at.
      tile.addEventListener("mouseenter", () => { v.currentTime = Math.max(0, Number(entry.start) || 0); v.play().catch(() => {}); });
      tile.addEventListener("mouseleave", () => { v.pause(); v.currentTime = Math.max(0, Number(entry.start) || 0); });
      tile.appendChild(v);
      media = v;
    } else {
      const a = el("audio", { preload: "metadata" }) as HTMLAudioElement;
      a.src = viewUrl(entry.file);
      wrap.appendChild(a);
      tile.appendChild(el("div", { text: entry.file, title: entry.file, class: "text-center break-all overflow-hidden", style: { fontSize: "8px", lineHeight: "1.25", color: C.text, padding: "3px" } }));
      media = a;
    }
    tile.appendChild(el("div", { text: String(idx + 1), class: "absolute top-0.5 left-1 pointer-events-none font-bold", style: { fontSize: "9px", color: "#fff", textShadow: "0 0 3px #000" } }));
    const x = el("button", { type: "button", text: "✕", title: "Remove", class: "absolute top-0 right-0 z-[3]", style: { cursor: "pointer", fontSize: "10px", background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", padding: "1px 4px" } });
    x.addEventListener("click", (e) => { e.stopPropagation(); list.splice(idx, 1); ctx.persist(); onRefresh(); });
    tile.appendChild(x);
  } else {
    tile.appendChild(el("div", { text: isVideo ? "+vid" : "+aud", class: "pointer-events-none", style: { color: C.muted, fontSize: "10px" } }));
  }

  // Writing past the end of the array would leave holes that persist as nulls, so an empty
  // tile appends instead of assigning at its own index.
  const setFile = (name: string) => {
    const base = { file: name, start: 0, end: 0, ...(isVideo ? { withAudio: true } : {}) };
    if (idx < list.length) list[idx] = { ...(list[idx] || {}), ...base };
    else list.push(base);
  };

  // Click to upload; the gallery button only exists for video, which is what the MiniMax
  // gallery holds — there is no audio gallery to pick from.
  const fileInp = el("input", { type: "file", accept: isVideo ? "video/*" : "audio/*", style: { display: "none" } }) as HTMLInputElement;
  fileInp.addEventListener("change", async () => {
    const f = fileInp.files?.[0];
    fileInp.value = "";
    if (!f) return;
    try {
      const name = await uploadMedia(f);
      setFile(name);
      ctx.persist();
      onRefresh();
    } catch (e: any) {
      ctx.showPopup(e.message, true);
    }
  });
  tile.addEventListener("click", () => fileInp.click());
  wrap.append(tile, fileInp);

  if (isVideo && onPickFromGallery) {
    const gal = el("button", { type: "button", text: "🖼", title: "Pick from the gallery", class: "absolute z-[3]", style: { bottom: "1px", left: "1px", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", borderRadius: "3px", width: "16px", height: "16px", cursor: "pointer", fontSize: "9px", padding: "0" } });
    gal.addEventListener("click", (e) => {
      e.stopPropagation();
      onPickFromGallery((name) => { setFile(name); ctx.persist(); onRefresh(); });
    });
    tile.appendChild(gal);
  }

  // Clicking a ghost re-opens the file picker, which is the repair the warning asks for.
  if (isGone || !entry.file || !media) return wrap; // nothing to transport or trim

  // ── transport: play/stop toggle + restart ──────────────────────────────────
  const btnCss = { cursor: "pointer", fontFamily: "inherit", fontSize: TINY, lineHeight: "1", padding: "2px 4px", borderRadius: "4px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` };
  const playBtn = el("button", { type: "button", text: "▶", title: "Play / stop", style: btnCss });
  const restartBtn = el("button", { type: "button", text: "⏮", title: "Play from the start", style: btnCss });
  const timeTag = el("div", { text: "0:00", class: "text-center", style: { fontSize: TINY, color: C.muted, width: "100%" } });

  // in/out are not just numbers sent to the render — they are what this tile plays. The
  // point of setting them is hearing or seeing the window you picked, so the transport, the
  // clock and the scrub bar all work inside [in, out] and follow an edit immediately.
  const winStart = () => Math.max(0, Number(entry.start) || 0);
  const winEnd = () => {
    const e = Number(entry.end) || 0;
    const dur = Number.isFinite(media!.duration) ? media!.duration : Infinity;
    return e > winStart() ? Math.min(e, dur) : dur;
  };
  const winLen = () => Math.max(0, winEnd() - winStart());

  const stop = () => { media!.pause(); playBtn.textContent = "▶"; };
  const playFromStart = () => {
    media!.currentTime = winStart();
    media!.play().catch(() => {});
    playBtn.textContent = "■";
  };
  playBtn.addEventListener("click", () => {
    if (!media!.paused) { stop(); return; }
    // Outside the window (or sitting on its end) means "start this window again".
    if (media!.currentTime < winStart() || media!.currentTime >= winEnd() - 0.02) playFromStart();
    else { media!.play().catch(() => {}); playBtn.textContent = "■"; }
  });
  restartBtn.addEventListener("click", playFromStart);
  media.addEventListener("ended", stop);
  media.addEventListener("pause", () => (playBtn.textContent = "▶"));

  // Two lines: the buttons, then the clock under them. Side by side, the clock's width
  // changing as it counts would shove the buttons around.
  wrap.appendChild(el("div", { class: "flex items-center justify-center gap-1.5" }, [playBtn, restartBtn]));
  wrap.appendChild(timeTag);

  // Audio gets a scrub bar; a video already shows its position in the tile itself.
  let bar: HTMLInputElement | null = null;
  if (!isVideo) {
    ensureSliderCss();
    bar = el("input", { type: "range", min: "0", max: "100", value: "0", class: "aos-mmh3-scrub", style: { width: `${MEDIA_TILE_W}px`, height: "6px", cursor: "pointer", margin: "0" } }) as HTMLInputElement;
    bar.addEventListener("input", () => { if (winLen() > 0) media!.currentTime = winStart() + (Number(bar!.value) / 100) * winLen(); });
    wrap.appendChild(bar);
  }
  function paintTime() {
    const pos = Math.min(Math.max(media!.currentTime - winStart(), 0), winLen());
    timeTag.textContent = `${clock(pos)} / ${clock(winLen())}`;
    if (bar && winLen() > 0) bar.value = String((pos / winLen()) * 100);
  }
  media.addEventListener("timeupdate", () => {
    if (media!.currentTime >= winEnd() - 0.02 && !media!.paused) { stop(); media!.currentTime = winEnd(); }
    paintTime();
  });
  media.addEventListener("loadedmetadata", paintTime);

  // ── trim window ────────────────────────────────────────────────────────────
  const onWindowEdit = () => {
    if (media!.currentTime < winStart() || media!.currentTime > winEnd()) media!.currentTime = winStart();
    paintTime();
    ctx.persist();
  };
  // A trim window cannot run past the end of the file — asking for frames that aren't there
  // fails the render, and the number gives no hint that it was the problem.
  const srcLen = () => (Number.isFinite(media!.duration) && media!.duration > 0 ? media!.duration : Number(entry._srcLen) || Infinity);
  const inRow = tinyNum("in", entry.start ?? 0, (v) => { entry.start = v; onWindowEdit(); }, (v) => {
    const cap = srcLen();
    // "in" has to leave room for at least a moment of clip after it.
    const top = Number.isFinite(cap) ? Math.max(0, cap - 0.1) : Infinity;
    return Math.min(Math.max(0, v), top);
  });
  const outRow = tinyNum("out", entry.end ?? 0, (v) => { entry.end = v; onWindowEdit(); }, (v) => Math.min(Math.max(0, v), srcLen()));
  wrap.append(inRow.el, outRow.el);

  // Source facts, at the same size — a silent video can't lend its soundtrack, and that's
  // worth saying here rather than failing the prompt later.
  const info = el("div", { class: "text-center", style: { fontSize: TINY, color: C.muted, lineHeight: "1.3", width: "100%" } });
  wrap.appendChild(info);
  getMediaInfo(entry.file).then((d) => {
    if (!d.ok) return;
    const bits = [`${(d.duration || 0).toFixed(2)}s`];
    if (isVideo && d.fps) bits.push(`${d.fps}fps→24`);
    if (isVideo) bits.push(d.has_audio ? "has audio" : "silent");
    // One fact per line: dot-separated wrapped at arbitrary points in a 72px column.
    clear(info);
    bits.forEach((b) => info.appendChild(el("div", { text: b })));
    // A freshly added file should read "the whole thing" — in 0, out the full length —
    // rather than an arbitrary window the user has to notice and correct. Only fills a slot
    // that has never been set, so an edited trim is never overwritten.
    if ((d.duration ?? 0) > 0) {
      entry._srcLen = +(d.duration as number).toFixed(2);
      // A max on the input stops the spinner arrows walking past the end as well.
      outRow.input.max = String(entry._srcLen);
      inRow.input.max = String(entry._srcLen);
      if (!(Number(entry.end) > 0)) {
        entry.end = entry._srcLen;
        outRow.input.value = String(entry.end);
      } else if (Number(entry.end) > entry._srcLen) {
        // A window saved against a different file, or typed before the length was known.
        entry.end = entry._srcLen;
        outRow.input.value = String(entry.end);
      }
      ctx.persist();
    }
    paintTime();
    if (isVideo && !d.has_audio && entry.withAudio !== false) { entry.withAudio = false; ctx.persist(); }
  });

  return wrap;
}

/**
 * The three slots for one clip's own media list, as a row — always three columns wide
 * whether or not they're filled, so the block beside it doesn't shift every time a file is
 * added or cleared (SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §11).
 */
export function buildClipMediaSlots(kind: "video" | "audio", list: any[], ctx: ImagesPanelCtx, onRefresh: () => void, onPickFromGallery: ((onPicked: (name: string) => void) => void) | null, missing?: Set<string>) {
  const rowEl = el("div", { class: "flex flex-nowrap", style: { gap: "24px" } });
  for (let i = 0; i < 3; i++) rowEl.appendChild(mediaSlot(kind, list, i, ctx, onRefresh, onPickFromGallery, missing));
  return rowEl;
}

export interface ImagesPanelHandle {
  el: HTMLElement;
  render(): void;
}

/** 모드별 이미지 입력 패널. state에 직접 쓴다. */
export function mountImagePanel(state: MinimaxState, ctx: ImagesPanelCtx): ImagesPanelHandle {
  const wrap = el("div");

  function render() {
    clear(wrap);
    const mode = state.generationMode || "t2v";

    if (mode === "t2v") {
      wrap.appendChild(panel([label("Images"), el("div", { text: "Text-only mode uses no images — the whole clip comes from the prompt.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } })]));
      return;
    }

    if (mode === "firstlast") {
      const first = imageSlot("① First frame\n(click / drop)", state.firstFrameImage, (n) => { state.firstFrameImage = n; ctx.persist(); }, { missing: !!state.firstFrameImage && ctx.missingAssets?.has(state.firstFrameImage) });
      const last = imageSlot("② Last frame\n(optional)", state.lastFrameImage, (n) => { state.lastFrameImage = n; ctx.persist(); }, { missing: !!state.lastFrameImage && ctx.missingAssets?.has(state.lastFrameImage) });
      const firstMp = numberField(state.firstFrameMp ?? 1.0, (v) => { state.firstFrameMp = Math.max(0, v); ctx.persist(); }, 0.1);
      const lastMp = numberField(state.lastFrameMp ?? 1.0, (v) => { state.lastFrameMp = Math.max(0, v); ctx.persist(); }, 0.1);
      firstMp.style.width = "60px";
      lastMp.style.width = "60px";
      const mpCol = (imgEl: HTMLElement, mpEl: HTMLElement) => el("div", { style: { display: "flex", flexDirection: "column", gap: "3px", alignItems: "center" } }, [imgEl, el("div", { text: "MP", style: { fontSize: "9px", color: C.muted } }), mpEl]);
      wrap.appendChild(
        panel([
          label("First / Last Keyframes"),
          el("div", { class: "flex gap-1.5 justify-center" }, [mpCol(first.el, firstMp), mpCol(last.el, lastMp)]),
          el("div", { text: "MP = megapixels sent to the model for that image (0 = send as uploaded, no resize).", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
          el("div", { html: "Both are optional. With neither, this is the same as Text only. In a relay run the <b>Last Frame Chain</b> continuity mode overwrites ① for every clip after the first.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
        ])
      );
      return;
    }

    const types = (state as any).refTypes || { images: true };
    const picker = refTypeDropdown(state, ctx, render);
    const kids: (Node | null)[] = [
      label("Reference"),
      el("div", { html: "Uses the <b>Ref2VA</b> model. Acceleration here is SolAttn / Spectrum / None at the normal step count — Turbo is fl2v-only and isn't offered in this mode.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.55" } }),
      picker.el,
    ];

    if (types.images) {
      const grid = el("div", { class: "flex flex-wrap gap-1.5 justify-center" });
      const refs = (state.refImages || []).slice(0, 9);
      for (let i = 0; i < Math.min(9, refs.length + 1); i++) {
        const s = imageSlot(
          refs[i] ? `<Picture ${i + 1}>` : "+ add\nreference",
          refs[i] || null,
          (name) => {
            const list = (state.refImages || []).slice();
            const mpList = (state.refImagesMp || []).slice();
            if (name) list[i] = name;
            else { list.splice(i, 1); mpList.splice(i, 1); }
            state.refImages = list.filter(Boolean).slice(0, 9);
            state.refImagesMp = mpList.slice(0, 9);
            ctx.persist();
            render();
          },
          { box: 92, missing: !!refs[i] && ctx.missingAssets?.has(refs[i]) }
        );
        const cell = el("div", { style: { display: "flex", flexDirection: "column", gap: "2px", alignItems: "center" } }, [s.el]);
        if (refs[i]) {
          const mpIn = numberField(state.refImagesMp?.[i] ?? 1.0, (v) => {
            const mpList = (state.refImagesMp || []).slice();
            mpList[i] = Math.max(0, v);
            state.refImagesMp = mpList;
            ctx.persist();
          }, 0.1);
          mpIn.style.width = "60px";
          mpIn.title = "Megapixels sent to the model (0 = send as uploaded)";
          cell.appendChild(mpIn);
        }
        grid.appendChild(cell);
      }
      kids.push(label(`Images (${refs.length}/9)`), grid);
      kids.push(el("div", { text: "MP = megapixels sent to the model for that image (0 = send as uploaded, no resize).", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }));
      kids.push(
        row([
          col([
            label("Reference size"),
            select(
              [
                { value: "match", label: "match — scale to output area (faster)" },
                { value: "max", label: "max — 2048px short edge (best identity, slower)" },
              ],
              state.refImageSize || "match",
              (v) => { state.refImageSize = v; ctx.persist(); }
            ),
          ]),
        ])
      );
    }

    if (types.videos) {
      const vids = (state as any).refVideos || ((state as any).refVideos = []);
      kids.push(label(`Videos (${vids.filter((v: any) => v.file).length}/3)`));
      if (ctx.availability && Object.keys(ctx.availability).length && !ctx.availability.VHS_LoadVideo) {
        kids.push(el("div", { html: "⚠ <code>VHS_LoadVideo</code> (VideoHelperSuite) is not installed — reference videos are skipped.", style: { fontSize: "10px", color: C.warn, lineHeight: "1.5" } }));
      }
      kids.push(buildClipMediaSlots("video", vids, ctx, render, (onPicked) => openVideoGalleryPicker(onPicked), ctx.missingAssets));
      kids.push(el("div", { html: "Frames are pulled at 24fps between <b>in</b> and <b>out</b>; the model was trained on ~2-15s references.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }));
    }

    if (types.audios) {
      const auds = (state as any).refAudios || ((state as any).refAudios = []);
      kids.push(label(`Audios (${auds.filter((a: any) => a.file).length}/3)`));
      if (ctx.availability && Object.keys(ctx.availability).length && !ctx.availability.TrimAudioDuration) {
        kids.push(el("div", { html: "⚠ <code>TrimAudioDuration</code> missing — audio is used whole, in/out is ignored.", style: { fontSize: "10px", color: C.warn, lineHeight: "1.5" } }));
      }
      kids.push(buildClipMediaSlots("audio", auds, ctx, render, null, ctx.missingAssets));
    }

    kids.push(el("div", { html: "Prompt tags follow input order per type: <code>&lt;Picture i&gt;</code> · <code>&lt;Video k&gt;</code> · <code>&lt;Audio j&gt;</code>.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }));
    wrap.appendChild(panel(kids));
  }

  render();
  return { el: wrap, render };
}
