// imagesPanel.ts — 모드별 이미지 입력 (원본: web/minimax/ui_images_minimax.js)
// Text only는 이미지 없음, First/Last Frame은 키프레임 2장, Reference는 이미지 9 +
// 비디오 3 + 오디오 3(옵트인). 이게 없으면 First/Last·Reference 모드는 이미지를 넣을
// 방법이 없어 사실상 동작 불가 — 반드시 있어야 하는 패널.
import type { MinimaxState } from "./core";
import { button, col, el, clear, label, numberField, panel, row, select } from "../../shared/ui";
import { C, BRAND } from "../../identity";
import { getMediaFiles, getMediaInfo, uploadImage, uploadMedia, viewUrl } from "./api";
import { openImageGalleryPicker, INPUT_TOOL_ID } from "../../shared/imageGalleryPicker";

export interface ImagesPanelCtx {
  persist: () => void;
  showPopup: (msg: string, isError?: boolean) => void;
  availability?: Record<string, boolean>;
}

export interface ImageSlotHandle {
  el: HTMLElement;
  setFilename(name: string | null): void;
  getFilename(): string | null;
}

export function imageSlot(labelText: string, initialFile: string | null, onSet: (name: string | null) => void, opts: { box?: number } = {}): ImageSlotHandle {
  const box = opts.box ?? 132;
  const wrap = el("div", { class: "flex flex-col gap-1 items-center" });
  const frame = el("div", {
    class: "relative shrink-0 flex items-center justify-center overflow-hidden rounded-lg cursor-pointer",
    style: { width: `${box}px`, height: `${box}px`, background: "#000", border: `1px solid ${C.border}` },
  });
  const hint = el("div", { text: labelText, class: "text-center pointer-events-none", style: { color: C.muted, fontSize: "10px", padding: "0 6px", whiteSpace: "pre-line" } });
  const img = el("img", { class: "absolute inset-0 w-full h-full pointer-events-none", style: { objectFit: "contain", display: "none" } });
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
    if (current) {
      img.setAttribute("src", viewUrl(current) + `&t=${Date.now()}`);
      img.style.display = "block";
      hint.style.display = "none";
      clearBtn.classList.remove("hidden");
    } else {
      img.style.display = "none";
      hint.style.display = "";
      clearBtn.classList.add("hidden");
    }
  }
  frame.append(hint, img, clearBtn, galleryBtn);
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

function mediaRow(kind: "video" | "audio", entry: any, idx: number, files: string[], ctx: ImagesPanelCtx, state: MinimaxState, onRefresh: () => void) {
  const isVideo = kind === "video";
  const box = el("div", { class: "flex flex-col gap-1", style: { background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px" } });

  const hdr = el("div", { class: "flex items-center gap-1.5" });
  hdr.appendChild(el("div", { text: `<${isVideo ? "Video" : "Audio"} ${idx + 1}>`, class: "flex-1", style: { fontSize: "10px", fontWeight: "700", color: BRAND } }));
  const del = el("button", { type: "button", text: "✕", title: "Remove", style: { cursor: "pointer", background: "transparent", color: C.muted, border: "none", fontSize: "10px" } });
  del.addEventListener("click", () => {
    const list = isVideo ? (state as any).refVideos : (state as any).refAudios;
    list.splice(idx, 1);
    ctx.persist();
    onRefresh();
  });
  hdr.appendChild(del);

  const opts = ["", ...files];
  const sel = select(opts.map((f) => ({ value: f, label: f || "— pick a file —" })), entry.file || "", (v) => { entry.file = v; ctx.persist(); onRefresh(); });

  const up = el("button", { type: "button", text: "⬆ upload", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "10px", padding: "4px 8px", borderRadius: "5px", background: C.bg3, color: C.text, border: `1px solid ${C.border}` } });
  const inp = el("input", { type: "file", accept: isVideo ? "video/*" : "audio/*", style: { display: "none" } }) as HTMLInputElement;
  up.addEventListener("click", () => inp.click());
  inp.addEventListener("change", async () => {
    const f = inp.files?.[0];
    inp.value = "";
    if (!f) return;
    up.textContent = "…";
    try {
      entry.file = await uploadMedia(f);
      ctx.persist();
      onRefresh();
    } catch (e: any) {
      ctx.showPopup(e.message, true);
      up.textContent = "⬆ upload";
    }
  });

  const dur = Math.max(0, (Number(entry.end) || 0) - (Number(entry.start) || 0));
  const durTag = el("div", { text: `${dur.toFixed(2)}s`, class: "text-center", style: { fontSize: "10px", color: dur > 0 ? C.muted : C.warn, paddingTop: "6px" } });

  box.append(hdr, row([col([sel]), col([up])]));
  box.appendChild(
    row([
      col([label("in (s)"), numberField(entry.start ?? 0, (v) => { entry.start = Math.max(0, v); ctx.persist(); onRefresh(); }, 0.5)]),
      col([label("out (s)"), numberField(entry.end ?? 5, (v) => { entry.end = Math.max(0, v); ctx.persist(); onRefresh(); }, 0.5)]),
      col([durTag]),
    ])
  );

  const infoTag = el("div", { style: { fontSize: "9.5px", color: C.muted } });
  box.appendChild(infoTag);
  let sndLabel: HTMLElement | null = null;
  let sndChk: HTMLInputElement | null = null;
  if (isVideo) {
    const chk = el("input", { type: "checkbox" }) as HTMLInputElement;
    chk.checked = entry.withAudio !== false;
    chk.addEventListener("change", () => { entry.withAudio = chk.checked; ctx.persist(); });
    sndChk = chk;
    sndLabel = el("label", { class: "flex items-center gap-1.5 cursor-pointer", style: { fontSize: "10px", color: C.text } }, [chk, el("span", { text: "also use this clip's soundtrack" })]);
    box.appendChild(sndLabel);
  }

  if (entry.file) {
    getMediaInfo(entry.file).then((info) => {
      if (!info.ok) { infoTag.textContent = ""; return; }
      const bits = [`source ${(info.duration ?? 0).toFixed(2)}s`];
      if (isVideo && info.fps) bits.push(`${info.fps}fps → resampled to 24`);
      if (isVideo) bits.push(info.has_audio ? "has audio" : "no audio track");
      infoTag.textContent = bits.join(" · ");

      if ((info.duration ?? 0) > 0 && (Number(entry.end) || 0) > (info.duration ?? 0)) {
        entry.end = +(info.duration ?? 0).toFixed(2);
        ctx.persist();
        onRefresh();
        return;
      }
      if (isVideo && !info.has_audio && sndLabel && sndChk) {
        entry.withAudio = false;
        ctx.persist();
        sndChk.checked = false;
        sndChk.disabled = true;
        sndLabel.style.opacity = "0.45";
        sndLabel.style.cursor = "default";
        (sndLabel.lastChild as HTMLElement).textContent = "no soundtrack in this file";
        infoTag.style.color = C.warn;
      }
    });
  }

  box.appendChild(inp);
  return box;
}

export interface ImagesPanelHandle {
  el: HTMLElement;
  render(): void;
}

/** 모드별 이미지 입력 패널. state에 직접 쓴다. */
export function mountImagePanel(state: MinimaxState, ctx: ImagesPanelCtx): ImagesPanelHandle {
  const wrap = el("div");
  let mediaFiles: { videos: string[]; audios: string[] } = { videos: [], audios: [] };
  let mediaLoaded = false;

  function render() {
    clear(wrap);
    const mode = state.generationMode || "t2v";

    if (mode === "t2v") {
      wrap.appendChild(panel([label("Images"), el("div", { text: "Text-only mode uses no images — the whole clip comes from the prompt.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } })]));
      return;
    }

    if (mode === "firstlast") {
      const first = imageSlot("① First frame\n(click / drop)", state.firstFrameImage, (n) => { state.firstFrameImage = n; ctx.persist(); });
      const last = imageSlot("② Last frame\n(optional)", state.lastFrameImage, (n) => { state.lastFrameImage = n; ctx.persist(); });
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
          { box: 92 }
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
      vids.slice(0, 3).forEach((v: any, i: number) => kids.push(mediaRow("video", v, i, mediaFiles.videos, ctx, state, render)));
      if (vids.length < 3) {
        const add = el("button", { type: "button", text: "+ Add reference video", class: "w-full", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "6px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` } });
        add.addEventListener("click", () => { vids.push({ file: "", start: 0, end: 5, withAudio: true }); ctx.persist(); render(); });
        kids.push(add);
      }
      kids.push(el("div", { html: "Frames are pulled at 24fps between <b>in</b> and <b>out</b>; the model was trained on ~2-15s references.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }));
    }

    if (types.audios) {
      const auds = (state as any).refAudios || ((state as any).refAudios = []);
      kids.push(label(`Audios (${auds.filter((a: any) => a.file).length}/3)`));
      if (ctx.availability && Object.keys(ctx.availability).length && !ctx.availability.TrimAudioDuration) {
        kids.push(el("div", { html: "⚠ <code>TrimAudioDuration</code> missing — audio is used whole, in/out is ignored.", style: { fontSize: "10px", color: C.warn, lineHeight: "1.5" } }));
      }
      auds.slice(0, 3).forEach((a: any, i: number) => kids.push(mediaRow("audio", a, i, mediaFiles.audios, ctx, state, render)));
      if (auds.length < 3) {
        const add = el("button", { type: "button", text: "+ Add reference audio", class: "w-full", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "6px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` } });
        add.addEventListener("click", () => { auds.push({ file: "", start: 0, end: 5 }); ctx.persist(); render(); });
        kids.push(add);
      }
    }

    kids.push(el("div", { html: "Prompt tags follow input order per type: <code>&lt;Picture i&gt;</code> · <code>&lt;Video k&gt;</code> · <code>&lt;Audio j&gt;</code>.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }));
    wrap.appendChild(panel(kids));

    if (!mediaLoaded && (types.videos || types.audios)) {
      mediaLoaded = true;
      getMediaFiles().then((f) => { mediaFiles = f; render(); }).catch(() => {});
    }
  }

  render();
  return { el: wrap, render };
}
