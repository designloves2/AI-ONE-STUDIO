// promptEdit.ts — MiniMax H3 전체화면 프롬프트 에디터 (Ollama LLM enhance 포함).
// 원본: web/minimax/ui_prompt_edit_minimax.js. 오버레이 자체가 이미 풀스크린으로 설계돼
// 있던 부분이라 레이아웃은 원본을 그대로 따르되, 저장된 프롬프트 세트(서버 파일 저장)
// 기능은 백엔드 연결 단계(§4-2)로 미뤘다 — 지금은 로컬 state(localStorage)까지만.
import type { MinimaxState, PromptEntry } from "./core";
import {
  clipAssets,
  clipFraming,
  evenBreaks,
  groupShotsWithBreaks,
  imageBriefMax,
  parseBrief,
  parseTargetSeconds,
  promptEnabled,
  promptFirstFrame,
  promptOverrides,
  promptText,
} from "./core";
import { button, clear, el, confirmDialog, promptDialog, promptTextareaDialog } from "../../shared/ui";
import { openImageGalleryPicker, INPUT_TOOL_ID } from "../../shared/imageGalleryPicker";
import { C, BRAND } from "../../identity";
import { buildClipMediaSlots, dragReorder } from "./imagesPanel";
import { openVideoGalleryPicker } from "./videoPicker";
import { openAudioGalleryPicker } from "../../shared/audioGalleryPicker";
import {
  analyzeImagesNative,
  analyzeImagesOpenRouter,
  analyzeImageLlama,
  writeBriefOpenRouter,
  writeBriefLlama,
  deletePromptSet,
  getModels,
  getPromptSet,
  getSystemPrompt,
  interrupt,
  listPromptSets,
  savePromptSet,
  uploadImage,
  viewUrl,
  writeBriefNative,
} from "./api";

// Downsized/JPEG-encoded base64 of an input/ file — Llama GGUF vision takes one image per
// call (no true multi-image batching like native TextGenerate has), read straight off the
// same /view route the rest of this file already uses for previews.
export async function imageToB64(filename: string): Promise<string> {
  const resp = await fetch(viewUrl(filename));
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  const targetPixels = 1024 * 1024;
  const scale = Math.min(1, Math.sqrt(targetPixels / (bitmap.width * bitmap.height)));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  (canvas.getContext("2d") as CanvasRenderingContext2D).drawImage(bitmap, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  return dataUrl.split(",")[1] || "";
}

function normPrompt(p: PromptEntry | string): PromptEntry {
  return typeof p === "string" ? { text: p, firstFrame: "", enabled: true } : p;
}

export interface PromptEditHandle {
  el: HTMLElement;
  show(): void;
  hide(): void;
  syncCommon(): void;
}

export function createPromptEditOverlay(
  state: MinimaxState,
  ctx: {
    persist: () => void;
    showPopup: (msg: string, isError?: boolean) => void;
    currentPlan: () => { count: number; clipSec: number; promptCount: number; actualSeconds: number };
    // Filenames confirmed missing from ComfyUI's input/ folder (SPEC_MINIMAX_H3_PER_CLIP_
    // OVERRIDE.md §8) — same set the left panel's Images accordion uses.
    missingAssets?: Set<string>;
    // Re-runs the missing-asset check (one batch, common + every clip's own set) and re-renders.
    checkMissingAssets?: () => void;
  },
  onApply?: () => void
): PromptEditHandle {
  const ov = el("div", {
    class: "aos-prompt-edit-ov fixed inset-0 z-[9999] flex-col p-3 gap-2 box-border",
    style: { display: "none", background: "rgba(11,11,11,0.985)" },
  });
  ov.appendChild(el("style", { text: "@keyframes mmh3-spin{to{transform:rotate(360deg)}}" }));

  let selected = 0;
  let systemPrompt = "";
  let clipModels: string[] = [];
  let busy = false;
  let enhMode: "text" | "image" = "text";

  // ── header ──────────────────────────────────────────────────────────────
  const hdr = el("div", { class: "flex items-center gap-2 shrink-0", style: { position: "relative" } });
  hdr.appendChild(el("div", { text: "📝 Prompt Edit", class: "text-white text-sm font-bold" }));
  // True center of the whole header, independent of how wide the title/buttons on either
  // side are — so it reads as one glance: what mode is this popup working with.
  const hdrModeTag = el("div", {
    style: {
      position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
      fontSize: "11px", fontWeight: "700", color: BRAND, whiteSpace: "nowrap", pointerEvents: "none",
    },
  });
  hdr.appendChild(hdrModeTag);
  const srcTag = el("div", { class: "text-[10px] flex-1", style: { color: C.muted } });
  hdr.appendChild(srcTag);
  const resetBtn = el("button", {
    type: "button", text: "↺ Reset", title: "Reset prompts, header and footer",
    style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "5px 11px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` },
  });
  resetBtn.addEventListener("click", () => (resetConfirmOv.style.display = "flex"));
  hdr.appendChild(resetBtn);
  const closeBtn = button("✕ Close", () => hide(), "danger");
  hdr.appendChild(closeBtn);

  // ── reset confirm — 원본 ui_prompt_edit_minimax.js와 동일: 프롬프트를 1개(빈 값)로,
  // header/footer를 비운다. body에 직접 붙이는 이유는 원본 주석 그대로: 오버레이가
  // fixed로 뷰포트 중앙에 항상 보이게 하기 위해서다.
  const resetConfirmOv = el("div", { style: { display: "none", position: "fixed", inset: "0", zIndex: "99999", background: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" } });
  const resetConfirmBox = el("div", { style: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "18px 20px", width: "340px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "10px", boxShadow: "0 8px 30px rgba(0,0,0,0.5)" } });
  resetConfirmBox.appendChild(el("div", { text: "Reset prompt settings?", style: { color: "#fff", fontSize: "13px", fontWeight: "700" } }));
  resetConfirmBox.appendChild(el("div", { text: "This clears every prompt down to one, plus the common header/footer.", style: { color: C.muted, fontSize: "11.5px", lineHeight: "1.5" } }));
  const resetBtnRow = el("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" } });
  const resetCancelBtn = el("button", { type: "button", text: "Cancel", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11.5px", padding: "6px 14px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` } });
  const resetConfirmBtn = button("Reset", () => {
    state.prompts = [{ text: "", firstFrame: "", enabled: true }];
    state.promptHeader = "";
    state.promptFooter = "";
    selected = 0;
    ctx.persist();
    resetConfirmOv.style.display = "none";
    renderAll();
    ctx.showPopup?.("Prompts reset.", false);
  }, "danger");
  resetCancelBtn.addEventListener("click", () => (resetConfirmOv.style.display = "none"));
  resetBtnRow.append(resetCancelBtn, resetConfirmBtn);
  resetConfirmBox.appendChild(resetBtnRow);
  resetConfirmOv.appendChild(resetConfirmBox);
  resetConfirmOv.addEventListener("click", (e) => { if (e.target === resetConfirmOv) resetConfirmOv.style.display = "none"; });
  document.body.appendChild(resetConfirmOv);

  // ── 프롬프트 세트 — 서버 파일로 저장되는 이름 붙은 묶음(원본 A5) ──────────
  const setsWrap = el("div", { class: "flex items-center gap-1.5 shrink-0" });
  const setsSel = el("select", { style: { flex: "1", minWidth: "0", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "5px 7px", fontSize: "11px", fontFamily: "inherit", outline: "none" } }) as HTMLSelectElement;
  function setBtn(text: string, title?: string) {
    return el("button", { type: "button", text, title, style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "5px 10px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, flexShrink: "0" } });
  }
  const setLoadBtn = setBtn("📂 Load", "Load this set — replaces all current prompts");
  const setSaveBtn = setBtn("💾 Save", "Save current prompts as a named set");
  const setDelBtn = setBtn("🗑 Delete", "Delete this set");
  setsWrap.append(setsSel, setLoadBtn, setSaveBtn, setDelBtn);

  async function refreshSetsList(selectName?: string) {
    try {
      const sets = await listPromptSets();
      const cur = selectName || setsSel.value;
      clear(setsSel);
      if (!sets.length) {
        setsSel.appendChild(el("option", { text: "(no saved sets)", value: "" }));
      } else {
        sets.forEach((s) => setsSel.appendChild(el("option", { text: `${s.name} · ${s.count}`, value: s.name })));
      }
      if (cur && sets.some((s) => s.name === cur)) setsSel.value = cur;
    } catch {
      clear(setsSel);
      setsSel.appendChild(el("option", { text: "(failed to load — check ComfyUI connection)", value: "" }));
    }
  }

  setLoadBtn.addEventListener("click", async () => {
    const name = setsSel.value;
    if (!name) return;
    try {
      const s = await getPromptSet(name);
      // Restore each entry whole (SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §7) — trimming to just
      // text/firstFrame/enabled is exactly the bug that made override/refImages/etc. save fine
      // but vanish on the next load.
      state.prompts = (Array.isArray(s.prompts) && s.prompts.length ? s.prompts : [{ text: "", firstFrame: "", enabled: true }]).map((p: any) =>
        typeof p === "string" ? { text: p, firstFrame: "", enabled: true } : { ...p, text: p?.text || "", firstFrame: p?.firstFrame || "", enabled: p?.enabled !== false }
      );
      state.promptHeader = s.promptHeader || "";
      state.promptFooter = s.promptFooter || "";
      // SPEC_MINIMAX_H3_CONTINUE_AND_EXTEND.md §2 — the prompt list just changed wholesale, so a
      // resume snapshot taken against the old list would restore the wrong enabled states.
      delete (state as any)._resumeSnapshot;
      // Guarded on presence, not just truthiness — a set saved before §7 has none of these
      // fields at all, and loading it must not wipe whatever is already on screen.
      if (s.generationMode) state.generationMode = s.generationMode;
      if (s.refTypes) (state as any).refTypes = s.refTypes;
      if (Array.isArray(s.refImages)) state.refImages = s.refImages.slice();
      if (Array.isArray(s.refImagesMp)) state.refImagesMp = s.refImagesMp.slice();
      if (s.firstFrameImage !== undefined) state.firstFrameImage = s.firstFrameImage || null;
      if (s.lastFrameImage !== undefined) state.lastFrameImage = s.lastFrameImage || null;
      if (Array.isArray(s.refVideos)) state.refVideos = JSON.parse(JSON.stringify(s.refVideos));
      if (Array.isArray(s.refAudios)) state.refAudios = JSON.parse(JSON.stringify(s.refAudios));
      selected = 0;
      ctx.persist();
      deriveModes();
      renderAll();
      onApply?.(); // generationMode may have just changed — the main view's mode buttons/Images panel need to see it
      ctx.checkMissingAssets?.(); // SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §8 — loaded filenames may no longer exist in input/
      const framesNote = s.clipFrames && s.clipFrames !== (state as any).clipFrames ? ` — saved at a different clip length (${s.clipFrames} frames vs current ${(state as any).clipFrames})` : "";
      ctx.showPopup(`Loaded "${name}"${framesNote}`, false);
    } catch (e: any) {
      ctx.showPopup(`Load failed: ${e.message || e}`, true);
    }
  });

  setSaveBtn.addEventListener("click", async () => {
    const existing = setsSel.value && setsSel.options.length && setsSel.value !== "" ? setsSel.value : "";
    const name = await promptDialog("Save this prompt set as:", existing || "");
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) { ctx.showPopup("Name can't be empty.", true); return; }
    const willOverwrite = [...setsSel.options].some((o) => o.value === trimmed);
    if (willOverwrite && !(await confirmDialog(`"${trimmed}" already exists — overwrite it?`))) return;
    try {
      await savePromptSet({
        name: trimmed,
        clipFrames: (state as any).clipFrames,
        promptHeader: state.promptHeader || "",
        promptFooter: state.promptFooter || "",
        prompts: (state.prompts || []).map((p) => (typeof p === "string" ? { text: p, firstFrame: "", enabled: true } : p)),
        // SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §7 — photos and clips are part of the set itself,
        // not an afterthought: reloading a Reference-mode set with none of this reproduces
        // nothing.
        generationMode: state.generationMode,
        refTypes: (state as any).refTypes,
        refImages: state.refImages || [],
        refImagesMp: state.refImagesMp || [],
        firstFrameImage: state.firstFrameImage || null,
        lastFrameImage: state.lastFrameImage || null,
        refVideos: JSON.parse(JSON.stringify(state.refVideos || [])),
        refAudios: JSON.parse(JSON.stringify(state.refAudios || [])),
      });
      await refreshSetsList(trimmed);
      ctx.showPopup(`Saved "${trimmed}".`, false);
    } catch (e: any) {
      ctx.showPopup(`Save failed: ${e.message || e}`, true);
    }
  });

  setDelBtn.addEventListener("click", async () => {
    const name = setsSel.value;
    if (!name) return;
    if (!(await confirmDialog(`Delete "${name}"? This can't be undone.`))) return;
    try {
      await deletePromptSet(name);
      await refreshSetsList();
      ctx.showPopup(`Deleted "${name}".`, false);
    } catch (e: any) {
      ctx.showPopup(`Delete failed: ${e.message || e}`, true);
    }
  });

  // ── common header/footer ───────────────────────────────────────────────
  function commonField(placeholder: string, get: () => string, set: (v: string) => void) {
    const ta = el("textarea", {
      placeholder,
      style: { width: "100%", boxSizing: "border-box", minHeight: "120px", maxHeight: "210px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px 8px", fontSize: "11.5px", lineHeight: "1.5", fontFamily: "inherit", outline: "none", resize: "vertical" },
    });
    ta.value = get() || "";
    ta.addEventListener("input", () => {
      set(ta.value);
      ctx.persist();
      refreshPreviewTag();
    });
    return ta;
  }

  // Per-field Undo / Clear (node v1.22.1), sat at the top-right of a field's label row.
  // `write(v)` puts the value through that field's real backing store + any side effects.
  // Undo steps back through values captured on focus and on Clear (per-field stack, cap 15);
  // `resetStack()` is called on clip switch so the shot field's Undo can't cross clips.
  function undoClearBtns(ta: HTMLTextAreaElement, write: (v: string) => void) {
    const stack: string[] = [];
    const paint = () => {
      // node v1.22.2 — white when the button can do something, muted grey otherwise.
      undoB.style.color = stack.length ? "#fff" : C.muted;
      clearB.style.color = ta.value ? "#fff" : C.muted;
    };
    const apply = (v: string) => {
      ta.value = v;
      write(v);
      ctx.persist();
      refreshPreviewTag();
      paint();
    };
    ta.addEventListener("focus", () => {
      if (stack[stack.length - 1] !== ta.value) stack.push(ta.value);
      if (stack.length > 15) stack.shift();
      paint();
    });
    ta.addEventListener("input", paint);
    const mk = (txt: string, tip: string, fn: () => void) => {
      const b = el("button", { type: "button", text: txt, title: tip, style: { cursor: "pointer", fontFamily: "inherit", fontSize: "9px", padding: "2px 7px", borderRadius: "4px", background: C.bg2, color: C.muted, border: `1px solid ${C.border}`, flexShrink: "0" } });
      b.addEventListener("click", (e) => { e.preventDefault(); fn(); });
      return b;
    };
    const undoB = mk("Undo", "Undo this field's last change", () => { if (stack.length) apply(stack.pop()!); });
    const clearB = mk("Clear", "Empty this field", () => { stack.push(ta.value); apply(""); });
    const row = el("div", { class: "flex gap-1 shrink-0" }, [undoB, clearB]) as HTMLDivElement & { resetStack: () => void; paint: () => void };
    row.resetStack = () => { stack.length = 0; paint(); };
    row.paint = paint;
    paint();
    return row;
  }
  // Per-clip override (SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §2): when the current clip has
  // `override` on, these two boxes read/write prompts[selected].header/footer instead of the
  // common state.promptHeader/Footer. The header/footer, images, first/last frame, and
  // reference video/audio all follow the same clip's own override flag — an override clip that
  // kept the common header/tail would render the previous shot's visual style and music over
  // the new scene, silently, which is exactly the bug this all-or-nothing rule exists to avoid.
  const headerTA = commonField(
    "Common opening — visual style, grade, opening composition… (sent with every clip)",
    () => clipFraming(state, selected).header,
    (v) => {
      const p = state.prompts[selected];
      if (promptOverrides(p)) (p as PromptEntry).header = v;
      else state.promptHeader = v;
    }
  );
  const footerTA = commonField(
    "Common tail — Ambient sound: … / Music: … (sent with every clip)",
    () => clipFraming(state, selected).footer,
    (v) => {
      const p = state.prompts[selected];
      if (promptOverrides(p)) (p as PromptEntry).footer = v;
      else state.promptFooter = v;
    }
  );
  const headerLabel = el("div", { text: "COMMON — HEADER", class: "text-[9.5px] tracking-wide flex-1", style: { color: C.muted } });
  const footerLabel = el("div", { text: "COMMON — SOUND / MUSIC", class: "text-[9.5px] tracking-wide flex-1", style: { color: C.muted } });
  const headerUC = undoClearBtns(headerTA, (v) => {
    const p = state.prompts[selected];
    if (promptOverrides(p)) (p as PromptEntry).header = v;
    else state.promptHeader = v;
  });
  const footerUC = undoClearBtns(footerTA, (v) => {
    const p = state.prompts[selected];
    if (promptOverrides(p)) (p as PromptEntry).footer = v;
    else state.promptFooter = v;
  });
  const commonWrap = el("div", { class: "shrink-0 flex gap-2 flex-col sm:flex-row" });
  commonWrap.append(
    el("div", { class: "flex-1 flex flex-col gap-1" }, [
      el("div", { class: "flex items-center gap-1.5" }, [headerLabel, headerUC]),
      headerTA,
    ]),
    el("div", { class: "flex-1 flex flex-col gap-1" }, [
      el("div", { class: "flex items-center gap-1.5" }, [footerLabel, footerUC]),
      footerTA,
    ])
  );
  // Re-reads header/footer (and their labels) for whichever clip is now selected — called on
  // clip switch, override toggle, and panel open, per the spec's own three call sites.
  function refreshFraming() {
    const own = promptOverrides(state.prompts[selected]);
    const f = clipFraming(state, selected);
    headerTA.value = f.header;
    footerTA.value = f.footer;
    headerUC.paint();
    footerUC.paint();
    headerLabel.textContent = own ? "THIS CLIP — HEADER" : "COMMON — HEADER";
    headerLabel.style.color = own ? BRAND : C.muted;
    footerLabel.textContent = own ? "THIS CLIP — SOUND / MUSIC" : "COMMON — SOUND / MUSIC";
    footerLabel.style.color = own ? BRAND : C.muted;
  }

  // ── body: clip list | editor ───────────────────────────────────────────
  const body = el("div", { class: "aos-prompt-edit-body flex-1 flex gap-2.5 min-h-0 flex-col md:flex-row" });
  const listCol = el("div", { class: "w-full md:w-[285px] shrink-0 flex flex-col gap-1.5" });
  const listHdr = el("div", { class: "flex items-center gap-1" });
  listHdr.appendChild(el("div", { text: "CLIPS", class: "text-[10px] tracking-wide", style: { color: C.muted } }));
  const onCountTag = el("div", { class: "text-[9.5px] flex-1", style: { color: C.muted } });
  listHdr.appendChild(onCountTag);
  const addClipBtn = el("button", { type: "button", text: "+", title: "Add clip prompt", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "2px 8px", borderRadius: "5px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` } });
  listHdr.appendChild(addClipBtn);
  const listBox = el("div", { class: "flex-1 overflow-y-auto flex flex-col gap-1 max-h-40 md:max-h-none" });
  listCol.append(listHdr, listBox);

  const editCol = el("div", { class: "flex-1 flex flex-col gap-1.5 min-w-0" });
  const editHdr = el("div", { class: "flex items-center gap-1.5" });
  const editTitle = el("div", { text: "Clip 1", class: "text-xs font-semibold flex-1" });
  const charCount = el("div", { class: "text-[10px]", style: { color: C.muted } });
  const editor = el("textarea", {
    placeholder: "Describe this clip…",
    style: { flex: "1", minHeight: "160px", boxSizing: "border-box", background: C.bg1, color: C.text, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "12px", fontSize: "13px", lineHeight: "1.6", fontFamily: "inherit", outline: "none", resize: "none" },
  }) as HTMLTextAreaElement;
  editor.addEventListener("input", () => {
    state.prompts[selected] = normPrompt(state.prompts[selected]);
    state.prompts[selected].text = editor.value;
    ctx.persist();
    updateCount();
    renderList();
  });
  const editorUndoClear = undoClearBtns(editor, (v) => {
    state.prompts[selected] = normPrompt(state.prompts[selected]);
    state.prompts[selected].text = v;
    updateCount();
    renderList();
  });
  editHdr.append(editTitle, charCount, editorUndoClear);

  // Continue this clip from a finished clip's last frame (planned resume) —
  // SPEC_MINIMAX_H3_CONTINUE_AND_EXTEND.md §2. Picking a clip seeds THIS entry's first frame
  // and, since a resume never re-renders what is already done, disables every earlier clip
  // (their "override for this clip" checkbox greys out too) and enables this one onward.
  // Clearing restores the enabled states from the snapshot taken when the pick was made.
  const firstFrameRow = el("div", { class: "shrink-0 flex items-center gap-2 flex-wrap text-[10.5px]", style: { color: C.muted } });
  const firstFrameThumb = el("img", { style: { width: "34px", height: "34px", objectFit: "cover", borderRadius: "5px", border: `1px solid ${C.border}`, display: "none" } }) as HTMLImageElement;
  const firstFrameNote = el("span", { text: "▶ Continue generating the clip.", style: { whiteSpace: "nowrap" } });
  const firstFrameGalleryBtn = el("button", { type: "button", text: "Select from the gallery", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "10.5px", padding: "4px 10px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` } });
  const firstFrameClearBtn = el("button", { type: "button", text: "✕", title: "Stop continuing — restore all clips", style: { display: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "10.5px", padding: "4px 9px", borderRadius: "6px", background: "transparent", color: C.muted, border: `1px solid ${C.border}` } });
  firstFrameGalleryBtn.addEventListener("click", () => {
    openVideoGalleryPicker((inputFilename, clip) => {
      if (!Array.isArray((state as any)._resumeSnapshot)) {
        (state as any)._resumeSnapshot = (state.prompts || []).map((p) => normPrompt(p).enabled !== false);
      }
      (state.prompts || []).forEach((raw, i) => {
        state.prompts[i] = normPrompt(raw);
        if (i === selected) state.prompts[i].firstFrame = inputFilename;
        state.prompts[i].enabled = i >= selected;
      });
      ctx.persist();
      renderFirstFrameRow();
      renderList();
      renderImageRow();
      ctx.showPopup(`Continuing from ${clip?.filename || "the selected clip"} — clips before this are off.`, false);
    }, { mode: "frame" });
  });
  firstFrameClearBtn.addEventListener("click", () => {
    state.prompts[selected] = normPrompt(state.prompts[selected]);
    state.prompts[selected].firstFrame = "";
    const snap = (state as any)._resumeSnapshot;
    if (Array.isArray(snap)) {
      (state.prompts || []).forEach((raw, i) => {
        state.prompts[i] = normPrompt(raw);
        state.prompts[i].enabled = snap[i] !== false;
      });
      delete (state as any)._resumeSnapshot;
    }
    ctx.persist();
    renderFirstFrameRow();
    renderList();
    renderImageRow();
  });
  // Insert-at-cursor tags — <Picture N>, <Subject N>, <Shot N> — into the clip editor. "N"
  // is inserted literally; the user replaces it with the actual number themselves.
  function insertTagAtCursor(ta: HTMLTextAreaElement, tag: string) {
    const s = ta.selectionStart ?? ta.value.length;
    const e = ta.selectionEnd ?? ta.value.length;
    const token = `<${tag} N>`;
    ta.value = ta.value.slice(0, s) + token + ta.value.slice(e);
    ta.focus();
    ta.setSelectionRange(s + token.length, s + token.length);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  // Centered between "Select from the gallery" (left) and the Continue note (right) —
  // wrapped in a flex:1 div so justify-center actually centers it in the row.
  const tagBtnRow = el("div", { class: "flex-1 flex justify-center gap-1.5" },
    ["Picture", "Subject", "Shot"].map((tag) => {
      const b = el("button", {
        type: "button", text: tag, title: `Insert <${tag} N> at the cursor`,
        style: { cursor: "pointer", fontFamily: "inherit", fontSize: "10px", padding: "4px 8px", borderRadius: "5px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` },
      });
      // mousedown steals focus from the editor before click fires, collapsing its selection
      // to the end — preventDefault keeps the editor focused throughout.
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => insertTagAtCursor(editor, tag));
      return b;
    }));
  firstFrameRow.append(firstFrameThumb, firstFrameGalleryBtn, tagBtnRow, firstFrameNote, firstFrameClearBtn);
  const firstFrameHint = el("div", {
    text: "Resuming a multi-clip run: pick the last finished clip, then write the prompts for the "
      + "clips that still need rendering. This clip starts from that clip's final frame (First/Last), "
      + "the ones before it are switched off.",
    class: "shrink-0",
    style: { fontSize: "9.5px", color: C.muted, lineHeight: "1.5" },
  });
  function renderFirstFrameRow() {
    const name = promptFirstFrame(state.prompts[selected]);
    if (name) {
      firstFrameThumb.src = viewUrl(name);
      firstFrameThumb.style.display = "block";
      firstFrameNote.textContent = `Continuing from: ${name}`;
      firstFrameClearBtn.style.display = "inline-block";
    } else {
      firstFrameThumb.style.display = "none";
      firstFrameNote.textContent = "▶ Continue generating the clip.";
      firstFrameClearBtn.style.display = "none";
    }
  }

  // Same "busy, no per-step feedback" banner language as the video preview's own
  // frDetectBanner/fvsrBanner — dim cover + centered glowing text — over the one field a
  // Prompt Write/Refine run is actually about to overwrite.
  const editorWrap = el("div", { class: "flex-1 flex relative", style: { minHeight: "0" } });
  const editorBusyOv = el("div", {
    text: "✨ Writing the prompt…",
    class: "absolute inset-0 flex items-center justify-center text-center hidden",
    style: { zIndex: "5", background: "rgba(0,0,0,0.75)", padding: "0 16px", borderRadius: "8px", color: "#b57bff", fontSize: "18px", fontWeight: "700", textShadow: "0 0 12px rgba(181,123,255,0.5)" },
  });
  editorWrap.append(editor, editorBusyOv);
  function setEditorBusy(isBusy: boolean, busyLabel?: string) {
    editorBusyOv.textContent = busyLabel || "✨ Writing the prompt…";
    editorBusyOv.classList.toggle("hidden", !isBusy);
    (editor as HTMLTextAreaElement).disabled = isBusy;
  }
  editCol.append(editHdr, editorWrap, firstFrameRow, firstFrameHint);
  body.append(listCol, editCol);

  function updateCount() {
    refreshPreviewTag();
  }

  function renderList() {
    clear(listBox);
    let onCount = 0;
    (state.prompts || []).forEach((raw, i) => {
      const p = normPrompt(raw);
      if (promptEnabled(p)) onCount++;
      const active = i === selected;
      const on = promptEnabled(p);
      const item = el("div", {
        class: "flex gap-1 items-center cursor-pointer rounded-md px-1.5 py-1.5",
        style: { background: active ? C.bg3 : C.bg1, border: `1px solid ${active ? BRAND : C.border}`, opacity: on ? "1" : "0.5" },
      }) as HTMLDivElement;
      item.draggable = true;
      item.addEventListener("dragstart", (e: DragEvent) => {
        e.dataTransfer?.setData("text/plain", String(i));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });
      item.addEventListener("dragover", (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "move"; });
      item.addEventListener("drop", (e: DragEvent) => {
        e.preventDefault();
        const from = Number(e.dataTransfer?.getData("text/plain"));
        const to = i;
        if (!Number.isFinite(from) || from === to || !state.prompts) return;
        const [moved] = state.prompts.splice(from, 1);
        state.prompts.splice(to, 0, moved);
        // Keep the currently-open clip open across the reorder: follow it if it was the one
        // dragged, otherwise shift by ±1 only if the move crossed over it.
        if (selected === from) selected = to;
        else if (from < selected && to >= selected) selected -= 1;
        else if (from > selected && to <= selected) selected += 1;
        ctx.persist();
        renderList();
        loadSelected();
      });
      const cb = el("input", { type: "checkbox" });
      cb.checked = on;
      cb.className = "cursor-pointer";
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => {
        state.prompts[i] = normPrompt(state.prompts[i]);
        state.prompts[i].enabled = cb.checked;
        ctx.persist();
        renderList();
      });
      const num = el("div", { text: String(i + 1), class: "w-4 shrink-0 text-center text-[10px] font-bold", style: { color: active ? BRAND : C.muted } });
      const prev = el("div", { text: `${i + 1} - Clip Prompt #${i + 1}`, class: "flex-1 text-[10.5px] truncate", style: { color: C.text } });
      const del = el("button", { type: "button", text: "✕", title: "Remove", style: { flexShrink: "0", cursor: "pointer", background: "transparent", color: C.muted, border: "none", fontSize: "10px", padding: "0 2px" } });
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if ((state.prompts || []).length <= 1) state.prompts = [{ text: "", firstFrame: "", enabled: true }];
        else state.prompts.splice(i, 1);
        if (selected >= state.prompts.length) selected = state.prompts.length - 1;
        ctx.persist();
        renderList();
        loadSelected();
      });
      item.addEventListener("click", () => {
        selected = i;
        renderList();
        loadSelected();
      });
      item.append(cb, num, prev, del);
      listBox.appendChild(item);
    });
    onCountTag.textContent = onCount < (state.prompts || []).length ? `${onCount}/${(state.prompts || []).length} on` : "";
  }

  function loadSelected() {
    const list = state.prompts || [{ text: "", firstFrame: "", enabled: true }];
    if (selected >= list.length) selected = 0;
    const p = normPrompt(list[selected]) as PromptEntry;
    editor.value = promptText(p);
    editTitle.textContent = `Clip ${selected + 1}`;
    editorUndoClear.resetStack(); // node v1.22.1 — the shot field's Undo stays within one clip
    refreshFraming();
    renderFirstFrameRow();
    renderImageRow();
    updateCount();
  }

  addClipBtn.addEventListener("click", () => {
    (state.prompts = state.prompts || []).push({ text: "", firstFrame: "", enabled: true });
    selected = state.prompts.length - 1;
    ctx.persist();
    renderList();
    loadSelected();
    editor.focus();
  });

  // ── LOCAL ENHANCE bar (native CLIP — Ollama support removed, SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §6) ──
  // Collapsible (§10) — collapsing hands this whole block's height to the clip editor above it.
  const enhWrap = el("div", { class: "shrink-0 rounded-lg p-2.5 flex flex-col gap-2", style: { background: C.bg1, border: `1px solid ${C.border}` } });
  const enhTop = el("div", { class: "flex items-center gap-2 flex-wrap" });
  const enhCollapseBtn = el("button", { type: "button", text: "▾", title: "Collapse", style: { cursor: "pointer", background: "transparent", color: C.muted, border: "none", fontSize: "11px", padding: "0 2px" } });
  const enhTitle = el("div", { text: "PROMPT WRITE / REFINE", class: "text-[10px] font-bold tracking-wide", style: { color: BRAND } });
  enhTop.append(enhCollapseBtn, enhTitle);
  function renderEnhCollapse() {
    const collapsed = !!state.enhCollapsed;
    enhCollapseBtn.textContent = collapsed ? "▸" : "▾";
    enhCollapseBtn.title = collapsed ? "Expand" : "Collapse";
    // Overrides renderImageRow()'s own enhMode-based display — a mode change while collapsed
    // must not silently reopen the image row underneath it.
    imgRow.style.display = collapsed || enhMode !== "image" ? "none" : "flex";
    enhBottom.style.display = collapsed ? "none" : "flex";
  }
  enhCollapseBtn.addEventListener("click", () => {
    state.enhCollapsed = !state.enhCollapsed;
    ctx.persist();
    renderEnhCollapse();
  });

  const statusTag = el("div", { text: "", class: "text-[10px] flex-1", style: { color: C.muted } });
  enhTop.appendChild(statusTag);

  // The source mode used to be two rows of manual toggle buttons (Text/Image, then
  // First-Last/Reference) — confusing, since the main screen's own generation mode already
  // says which images exist and what they mean. Both are now derived from
  // state.generationMode instead: t2v has no images to show, firstlast means the brief
  // writer sees the main screen's start/end frame, reference means it sees the main screen's
  // reference set. Recomputed at the start of every write/refine run so it can never go
  // stale if the main mode changed while this popup was open.
  const modeTag = el("div", { class: "text-[10px] font-bold", style: { color: C.muted } });
  function deriveModes() {
    const gm = state.generationMode || "t2v";
    enhMode = gm === "t2v" ? "text" : "image";
    state.briefImageMode = gm === "firstlast" ? "fl" : "ref";
    modeTag.textContent = gm === "t2v" ? "✨ Text → Brief"
      : gm === "firstlast" ? "🖼 Image → Brief (First/Last, from the main screen)"
      : "🖼 Image → Brief (Reference, from the main screen)";
    hdrModeTag.textContent = gm === "t2v" ? "Text To Video"
      : gm === "firstlast" ? "Image to Video (F/L)"
      : gm === "reference" ? "Reference to Video"
      : gm;
  }
  enhTop.appendChild(modeTag);

  const targetSel = el("select", { style: { background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px", fontSize: "12px", fontFamily: "inherit" } }, [
    el("option", { value: "one", text: "→ this clip" }),
    el("option", { value: "all", text: "→ split into all clips" }),
  ]);

  const enhBtn = el("button", { type: "button", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "7px 16px", borderRadius: "6px", background: BRAND, color: "#fff", border: "none", fontWeight: "700", display: "inline-flex", alignItems: "center", gap: "6px" } });
  const enhSpin = el("span", { text: "⟳", class: "hidden", style: { animation: "mmh3-spin 0.8s linear infinite", fontSize: "13px" } });
  const enhBtnLabel = el("span", { text: "✨ Prompt Write" });
  enhBtn.append(enhSpin, enhBtnLabel);

  // Refine — revises an ALREADY-WRITTEN prompt from a typed instruction, instead of writing a
  // fresh one from scratch. Modeled on ComfyUI-MiniMaxH3-Prompt-Writer's assemble_refinement():
  // text-only (no re-attached images), current prompt + the instruction go to the same brief
  // model, and the result goes through the exact same review overlay as Prompt Write.
  const refineBtn = el("button", { type: "button", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "7px 16px", borderRadius: "6px", background: C.bg2, color: "#fff", border: `1px solid ${BRAND}`, fontWeight: "700", display: "inline-flex", alignItems: "center", gap: "6px" } });
  const refineSpin = el("span", { text: "⟳", class: "hidden", style: { animation: "mmh3-spin 0.8s linear infinite", fontSize: "13px" } });
  const refineBtnLabel = el("span", { text: "🔧 Prompt Refine" });
  refineBtn.append(refineSpin, refineBtnLabel);

  // native(ComfyUI 그래프로 도는 로컬 LLM)만 인터럽트가 확실히 먹는다 — Ollama/llama.cpp 같은
  // 외부 서버 경유(non-native) 호출은 ComfyUI 큐 밖이라 /interrupt로 못 멈출 확률이 높아서
  // native일 때만 이 버튼을 보여준다.
  const enhStopBtn = el("button", { type: "button", text: "■ Stop", title: "Interrupt the local LLM (ComfyUI queue)", style: { display: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "7px 12px", borderRadius: "6px", background: "#c0392b", color: "#fff", border: "none", fontWeight: "700" } });
  enhStopBtn.addEventListener("click", async () => {
    enhStopBtn.setAttribute("disabled", "true");
    await interrupt().catch(() => {});
  });

  const lenIn = el("input", { type: "text", placeholder: "3:20", style: { width: "74px", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px", fontSize: "12px", fontFamily: "inherit", outline: "none", textAlign: "center" } }) as HTMLInputElement;
  lenIn.value = state.targetLength || "";
  lenIn.title = "Target length for the whole piece — 3:20 or 200s. Blank = one shot per prompt already in the editor.";
  const lenTag = el("div", { class: "text-[10px] whitespace-nowrap", style: { color: C.muted } });

  function targetPlan() {
    const plan = ctx.currentPlan();
    const secs = parseTargetSeconds(lenIn.value);
    if (!(secs > 0)) return { shots: plan.count, seconds: plan.count * plan.clipSec, clipSec: plan.clipSec, fromField: false };
    const shots = Math.max(1, Math.round(secs / plan.clipSec));
    return { shots, seconds: shots * plan.clipSec, clipSec: plan.clipSec, fromField: true };
  }
  function renderLenTag() {
    const t = targetPlan();
    lenTag.textContent = t.fromField ? `→ ${t.shots} clips × ${t.clipSec.toFixed(2)}s = ${t.seconds.toFixed(1)}s` : `→ ${t.shots} clip${t.shots > 1 ? "s" : ""} (from the editor)`;
  }
  lenIn.addEventListener("input", () => {
    state.targetLength = lenIn.value;
    ctx.persist();
    renderLenTag();
  });

  // Per-clip override (SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §1) — the actual render-time
  // reference set (refImages/refImagesMp/refVideos/refAudios/lastFrame), the same fields the
  // left panel's Images accordion edits. Enhance's vision step reads the same resolved list via
  // clipAssets() rather than a separate copy, so there is only ever one active image set per
  // clip, seen by both rendering and vision. Unchecked reads/writes the common state.* set,
  // checked reads/writes this clip's own prompts[selected].* copy, seeded from common on first
  // check. Row ② (this status line + the checkbox) is its own row, separate from the
  // First/Last|Reference mode buttons in row ③ below — those two are unrelated axes (how many
  // images vision reads vs. whether this clip has its own set at all).
  const overrideStatusText = el("span", { text: "Common (shared by all clips)", class: "text-[10.5px] font-semibold" });
  const overrideLabel = el("label", { class: "flex items-center gap-1.5 cursor-pointer text-[10.5px]", style: { color: C.muted } });
  const overrideCb = el("input", { type: "checkbox" }) as HTMLInputElement;
  overrideCb.style.cursor = "pointer";
  overrideLabel.append(overrideCb, el("span", { text: "override for this clip" }));
  const overrideRow = el("div", { class: "flex items-center justify-between gap-2" }, [overrideStatusText, overrideLabel]);
  overrideCb.addEventListener("change", () => {
    const p = normPrompt(state.prompts[selected]) as PromptEntry;
    state.prompts[selected] = p;
    if (overrideCb.checked && !p.override) {
      p.override = true;
      p.refImages = (state.refImages || []).slice();
      p.refImagesMp = (state.refImagesMp || []).slice();
      p.refVideos = JSON.parse(JSON.stringify(state.refVideos || []));
      p.refAudios = JSON.parse(JSON.stringify(state.refAudios || []));
      p.lastFrame = state.lastFrameImage || "";
      p.header = state.promptHeader || "";
      p.footer = state.promptFooter || "";
    } else {
      p.override = overrideCb.checked;
    }
    ctx.persist();
    refreshFraming();
    renderImageRow();
  });
  function renderOverrideRow() {
    const own = promptOverrides(state.prompts[selected]);
    overrideCb.checked = own;
    overrideStatusText.textContent = own ? "This clip only" : "Common (shared by all clips)";
    overrideStatusText.style.color = own ? BRAND : C.muted;
    // SPEC_MINIMAX_H3_CONTINUE_AND_EXTEND.md §2 — a clip switched off by "Continue generating
    // the clip" won't render, so its per-clip override is meaningless: grey the checkbox.
    const offForResume = normPrompt(state.prompts[selected]).enabled === false;
    overrideCb.disabled = offForResume;
    overrideLabel.style.opacity = offForResume ? "0.4" : "1";
    overrideLabel.style.cursor = offForResume ? "not-allowed" : "pointer";
  }

  const imgRow = el("div", { style: { display: "none", flexDirection: "column", gap: "6px" } });
  function renderImageRow() {
    clear(imgRow);
    imgRow.style.display = enhMode === "image" ? "flex" : "none";
    renderEnhCollapse();
    if (enhMode !== "image") return;

    // First/Last mode has nothing to attach here — the two frames are the main screen's own
    // start/end images (or this clip's "Continue generating the clip" override, below), so
    // this is a read-only preview of what Prompt Write/Refine will actually send, not a
    // second place to edit them.
    if (state.briefImageMode === "fl") {
      const ff = promptFirstFrame(state.prompts[selected]) || state.firstFrameImage || "";
      const lf = clipAssets(state, selected).lastFrame || state.lastFrameImage || "";
      const thumb = (src: string, tag: string) => {
        const box = el("div", {
          class: "w-[72px] h-[72px] rounded-md flex items-center justify-center overflow-hidden shrink-0",
          style: { border: `1px solid ${C.border}`, background: "#000" },
        });
        if (src) box.appendChild(el("img", { src: viewUrl(src), class: "w-full h-full object-cover" }));
        else box.appendChild(el("div", { text: "none", class: "text-[10px]", style: { color: C.muted } }));
        return el("div", { class: "flex flex-col gap-1 items-center" }, [box, el("div", { text: tag, class: "text-[9.5px]", style: { color: C.muted } })]);
      };
      imgRow.append(
        el("div", { text: "First/Last frame — set on the main screen, or via \"Continue generating the clip\" below.", class: "text-[10px] leading-relaxed", style: { color: C.muted } }),
        el("div", { class: "flex gap-3" }, [thumb(ff, "Start"), thumb(lf, "End")]),
      );
      return;
    }
    renderOverrideRow();
    const assets = clipAssets(state, selected);
    const max = imageBriefMax(state.briefImageMode);

    // Row ③ — three columns: images (always) / reference video / reference audio (the latter
    // two only when this clip has its own set — editing the common ones is the left panel's job).
    const cols = el("div", { class: "flex gap-3 items-start flex-wrap" });

    const imgCol = el("div", { class: "flex flex-col gap-1.5", style: { minWidth: "0" } });
    const grid = el("div", { class: "flex gap-1.5 flex-wrap", style: { maxWidth: "534px" } });
    function setImages(list: string[]) {
      const p = normPrompt(state.prompts[selected]) as PromptEntry;
      state.prompts[selected] = p;
      const filtered = list.filter(Boolean).slice(0, 9);
      if (assets.own) p.refImages = filtered; else state.refImages = filtered;
      ctx.persist();
      renderImageRow();
    }
    function slot(i: number) {
      const images = assets.refImages;
      const name = images[i];
      // Ghost tile (§8) — the filename is remembered but gone from input/.
      const missing = !!name && !!ctx.missingAssets?.has(name);
      const box = el("div", {
        class: "relative w-[54px] h-[54px] shrink-0 rounded-md overflow-hidden flex items-center justify-center",
        style: { background: "#000", border: `1px ${missing ? "dashed" : "solid"} ${missing ? C.warn : C.border}`, cursor: name ? "default" : "pointer" },
        title: missing ? `Missing from the input folder:\n${name}` : "",
      });
      if (missing) {
        box.append(
          el("div", { text: "⚠", style: { fontSize: "13px", color: C.warn } }),
          el("div", { text: name, class: "absolute bottom-0 inset-x-0 leading-tight break-all pointer-events-none", style: { color: C.warn, fontSize: "6.5px", background: "rgba(0,0,0,0.6)" } })
        );
        const x = el("button", { type: "button", text: "✕", title: "Remove", style: { position: "absolute", top: "0", right: "0", cursor: "pointer", fontSize: "11px", background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", padding: "1px 4px" } });
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          const list = images.slice();
          list.splice(i, 1);
          setImages(list);
        });
        box.appendChild(x);
      } else if (name) {
        box.appendChild(el("img", { src: viewUrl(name), class: "w-full h-full object-cover" }));
        const x = el("button", { type: "button", text: "✕", title: "Remove", style: { position: "absolute", top: "0", right: "0", cursor: "pointer", fontSize: "11px", background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", padding: "1px 4px" } });
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          const list = images.slice();
          list.splice(i, 1);
          setImages(list);
        });
        box.appendChild(x);
        // <Picture N> is the prompt token that names this slot.
        dragReorder(box, i, (from, to) => {
          const list = images.slice();
          const [moved] = list.splice(from, 1);
          list.splice(to, 0, moved);
          setImages(list);
        });
      } else {
        box.appendChild(el("div", { text: "+img", class: "text-[9px] pointer-events-none", style: { color: C.muted } }));
        const inp = el("input", { type: "file", accept: "image/*", style: { display: "none" } }) as HTMLInputElement;
        async function take(f: File) {
          if (!f) return;
          try {
            const uploaded = await uploadImage(f);
            const list = images.slice();
            list[i] = uploaded;
            setImages(list);
          } catch (e: any) {
            ctx.showPopup(`Upload failed: ${e.message} (check that ComfyUI is running)`, true);
          }
        }
        box.addEventListener("click", () => inp.click());
        inp.addEventListener("change", async () => {
          if (inp.files?.[0]) await take(inp.files[0]);
          inp.value = "";
        });
        // 드래그앤드롭 — 탐색기로 찾는 방식(클릭) 외에 파일을 끌어다 놓아도 업로드된다.
        box.addEventListener("dragover", (e) => { e.preventDefault(); box.style.borderColor = BRAND; });
        box.addEventListener("dragleave", () => { box.style.borderColor = C.border; });
        box.addEventListener("drop", async (e) => {
          e.preventDefault();
          box.style.borderColor = C.border;
          const f = e.dataTransfer?.files?.[0];
          if (f) await take(f);
        });
        box.appendChild(inp);

        // 다른 도구들의 이미지 업로드 슬롯과 동일한 갤러리 선택 버튼 — 여기만 빠져 있었다.
        const galleryBtn = el("button", { type: "button", text: "🖼", title: "Pick from gallery", style: { position: "absolute", bottom: "1px", left: "1px", zIndex: "1", cursor: "pointer", fontSize: "9px", background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", borderRadius: "3px", width: "16px", height: "16px", padding: "0" } });
        galleryBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openImageGalleryPicker((name) => {
            const list = images.slice();
            list[i] = name;
            setImages(list);
          }, INPUT_TOOL_ID);
        });
        box.appendChild(galleryBtn);
      }
      return box;
    }
    const filled = assets.refImages.length;
    const count = Math.min(9, filled + 1);
    for (let i = 0; i < count; i++) grid.appendChild(slot(i));

    const note = el("div", { class: "text-[10px] leading-relaxed", style: { color: C.muted } });
    note.textContent = `${filled}/9 image(s) for this clip. Prompt Write reads the first ${Math.min(filled, max)}.`;
    const modelLine = el("div", { class: "text-[10px]", style: { color: C.muted, cursor: "help" } });
    modelLine.title = "Change these in Settings → LLM Setting";
    imgCol.append(grid, note, modelLine);
    cols.appendChild(imgCol);

    if (assets.own) {
      // Render inputs, never shown to the vision model — feeding clips to it would restrict
      // which model can be used and cost far more time, for something that helps write a
      // prompt rather than make the video. Same slots the left panel uses (buildClipMediaSlots),
      // pointed at this clip's own arrays.
      const p = normPrompt(state.prompts[selected]) as PromptEntry;
      state.prompts[selected] = p;
      const vids = p.refVideos || (p.refVideos = []);
      const auds = p.refAudios || (p.refAudios = []);
      const vidCol = el("div", { class: "flex flex-col gap-1.5" }, [
        el("div", { text: "Reference video (this clip)", class: "text-[9.5px] tracking-wide", style: { color: C.muted } }),
        buildClipMediaSlots("video", vids, ctx, renderImageRow, (onPicked) => openVideoGalleryPicker(onPicked), ctx.missingAssets),
      ]);
      cols.appendChild(vidCol);
      const audCol = el("div", { class: "flex flex-col gap-1.5" }, [
        el("div", { text: "Reference audio (this clip)", class: "text-[9.5px] tracking-wide", style: { color: C.muted } }),
        buildClipMediaSlots("audio", auds, ctx, renderImageRow, (onPicked) => openAudioGalleryPicker(onPicked), ctx.missingAssets),
      ]);
      cols.appendChild(audCol);
    }

    imgRow.append(overrideRow, cols);
    renderModelLine(modelLine);
    renderEnhCollapse();
  }

  const enhBottom = el("div", { class: "flex items-center gap-2 flex-wrap" });
  enhBottom.append(targetSel, el("div", { text: "Length", class: "text-[11px]", style: { color: C.muted } }), lenIn, lenTag, enhBtn, refineBtn, enhStopBtn);
  enhWrap.append(enhTop, imgRow, enhBottom);

  // Read-only — Settings → Models is where these are actually changed (SPEC_MINIMAX_H3_PER_CLIP_
  // OVERRIDE.md peer note: a picker here just eats two rows of vertical space that come straight
  // out of the clip editor's height, for a setting that's shared by every clip anyway).
  function renderModelLine(target: HTMLElement) {
    const shortName = (m: string) => String(m || "").split("/").pop()?.split("\\").pop() || m;
    const briefDesc = state.h3BriefBackend === "llamagguf"
      ? (state.h3LlamaBriefModel ? `Llama GGUF ${shortName(state.h3LlamaBriefModel)}` : "(none)")
      : state.h3BriefBackend === "openrouter"
      ? `OpenRouter ${state.h3OrModelBrief || "default"}` : (state.nativeBriefClip || "(none)");
    const visionDesc = state.h3VisionBackend === "llamagguf"
      ? (state.h3LlamaVisionModel ? `Llama GGUF ${shortName(state.h3LlamaVisionModel)}+${shortName(state.h3LlamaVisionMmproj || "none")}` : "(none)")
      : state.h3VisionBackend === "openrouter"
      ? `OpenRouter ${state.h3OrModelVision || "default"}` : (state.nativeVisionClip || "(none)");
    const anyNative = state.h3BriefBackend !== "openrouter" && state.h3BriefBackend !== "llamagguf"
      || state.h3VisionBackend !== "openrouter" && state.h3VisionBackend !== "llamagguf";
    if (anyNative && !clipModels.length) {
      target.textContent = "Could not load the CLIP list — check the ComfyUI connection";
      target.style.color = C.warn;
      return;
    }
    target.textContent = `Brief: ${briefDesc} · Vision: ${visionDesc} — change in Settings → LLM`;
    target.style.color = C.muted;
  }

  async function refreshEnhanceModels() {
    if (!clipModels.length) {
      statusTag.textContent = "Loading CLIP list…";
      const d = await getModels();
      clipModels = (d.text_encoders || []).filter((x) => x !== "none");
      statusTag.textContent = clipModels.length ? `${clipModels.length} CLIP(s) found` : "⚠ Could not fetch the text encoder list from ComfyUI";
      statusTag.style.color = clipModels.length ? C.muted : C.warn;
    }
    renderImageRow();
  }

  async function loadSystemPrompt() {
    const d = await getSystemPrompt("minimax");
    systemPrompt = d.instruction || "";
    if (systemPrompt) {
      srcTag.textContent = `system prompt: ${d.name || "Minimax H3"} (${d.source === "TJ_NODE" ? "from TJ_NODE" : "built-in"})`;
    } else {
      srcTag.textContent = d.needsRestart ? "⚠ The ComfyUI backend doesn't support this route yet (restart needed)" : "system prompt unavailable — check the ComfyUI connection";
      srcTag.style.color = C.warn;
    }
  }

  // Labeled key:value header block, same shape as ComfyUI-MiniMaxH3-Prompt-Writer's
  // assemble_request() user_content ("Mode: ...\nDuration: ...\n\nReference manifest...\n\n
  // Creative brief:\n...") — the label wording is copied closely; what differs is only our
  // own output shape (shot-separated brief text, not their 6-section MiniMax H3 schema — our
  // own system prompt already governs that, this is just the same technique for framing
  // the request).
  function buildUserPrompt(baseText: string, imageSummary: string) {
    const t = targetPlan();
    const modeLabel = state.generationMode === "reference" ? "Reference"
      : state.briefImageMode === "fl" ? "First/Last frame" : "Text/Image → Brief";
    const lines = [
      `Mode: ${modeLabel}`,
      `Target duration: ${t.seconds.toFixed(2)} seconds total, split into ${t.shots} shot(s) of ~${t.clipSec.toFixed(2)}s each.`,
    ];
    if (t.shots > 1) lines.push(`Write exactly ${t.shots} shots, separated by a line containing only ---, one shot per clip.`);
    const refCount = state.generationMode === "reference" ? (state.refImages || []).length : 0;
    lines.push(
      "",
      "Reference manifest:",
      refCount ? `${refCount} reference image(s) supplied; refer to them as <Picture 1>…<Picture ${refCount}>.` : "None"
    );
    if (imageSummary) {
      if (state.briefImageMode === "fl") {
        lines.push("", "The following images were analyzed in order: image 1 is the STARTING frame, image 2 is the ENDING frame.", "", imageSummary);
      } else {
        lines.push("", `The following images were analyzed in order — use <Picture 1>…<Picture ${imageSummary.split("\n").length}> references for this brief.`, "", imageSummary);
      }
    }
    lines.push("", "Creative brief:", baseText || "(no text supplied — base the brief on the image analysis above)");
    // A last, plain restatement of the rules a long system prompt's earlier instructions are
    // most likely to drift away from, placed as the very last thing the model reads before
    // writing — the same "final contract" technique ComfyUI-MiniMaxH3-Prompt-Writer uses (its
    // assembly.py's _final_contract() appends a mode-specific grounding check to the end of
    // the USER message, not the system prompt, specifically for this recency effect; wording
    // below is adapted from that same closing paragraph). The frame-anchored scenario's own
    // instruction to invent a bridging action between two frames is a documented exception,
    // which is why this says "only the minimum needed" rather than banning invention outright.
    lines.push(
      "",
      "Final grounding check: stay grounded in what the request and any images/video/audio "
      + "actually show — invent only the minimum needed to connect frames or fulfill the request, "
      + "never unrelated actions, props, on-screen text, dialogue, or locations. An explicit user "
      + "instruction always outranks a default assumption. Treat every explicitly assigned reference "
      + "role (voice, motion, style, etc.) as exclusive — use only that role's content, do not also "
      + "pull in its other visible traits. Do not invent music or ambient sound beyond what the "
      + "request asks for or clearly implies. Never pad solely to reach a length — use only what the "
      + "target duration above actually needs. Return only the complete brief text, no commentary "
      + "outside it."
    );
    return lines.join("\n");
  }

  // Refine: revise an already-written prompt from a typed instruction. Structure and wording
  // closely follow ComfyUI-MiniMaxH3-Prompt-Writer's assemble_refinement(): the opening
  // "rewrite / return only / do not discuss" instruction, current-prompt + revision-instruction
  // block, a reference-preservation rule (their version is scoped to <Audio N> tags because
  // that node's Reference mode uses audio/video assets we don't; ours is <Picture N>, the only
  // reference tag our own brief format uses), and a final grounding check appended last for the
  // same recency effect — text-only, no images re-attached, exactly like their version ("media
  // is intentionally not attached"). The OUTPUT stays our own shot-separated brief format
  // throughout; only the prompt-construction technique is borrowed.
  function buildRefineUserPrompt(currentPrompt: string, instruction: string) {
    const lines = [
      "Rewrite the current H3 brief according to the revision instruction. Return only the complete revised brief. Do not discuss the changes.",
      "",
      "Current prompt:",
      currentPrompt || "(empty)",
      "",
      "Revision instruction:",
      instruction,
      "",
      "Reference revision rule: preserve each existing <Picture N> tag that the revision instruction does not ask to change. Only add, remove, or renumber a <Picture N> tag when the instruction's meaning actually calls for it.",
      "",
      "Final grounding check: keep everything from the current prompt that the instruction doesn't ask you to change. Apply only what the instruction actually asks for — do not invent unrelated actions, props, on-screen text, dialogue, locations, music or ambient sound beyond what it asks for or clearly implies. Return only the complete revised prompt, no commentary outside it.",
    ];
    return lines.join("\n");
  }

  const VISION_SYSTEM_PROMPT = "Describe this image factually and concisely for a video director: subject appearance, pose, expression, setting, lighting. Plain prose, no formatting, no preamble, 2-4 sentences.";

  let progTimer: number | undefined;
  let progStart = 0;
  let progStage = "";
  function progressStart() {
    progStart = Date.now();
    progTimer = window.setInterval(progressTick, 1000);
    progressTick();
  }
  function progressStage(text: string) {
    progStage = text;
    progressTick();
  }
  function progressTick() {
    const s = Math.round((Date.now() - progStart) / 1000);
    statusTag.textContent = s > 30 ? `${progStage} (${s}s) — a cold model load can take a while past this point` : `${progStage} (${s}s)`;
    statusTag.style.color = BRAND;
  }
  function progressStop() {
    if (progTimer) window.clearInterval(progTimer);
    progTimer = undefined;
  }

  function briefBackendCheck(): { briefOR: boolean; briefLlama: boolean } | null {
    const briefOR = state.h3BriefBackend === "openrouter";
    const briefLlama = state.h3BriefBackend === "llamagguf";
    if (!briefOR && !briefLlama && !state.nativeBriefClip) {
      ctx.showPopup("Set a Brief CLIP (or switch the Brief backend to OpenRouter/Llama GGUF in Settings).", true);
      return null;
    }
    if (briefLlama && !state.h3LlamaBriefModel) {
      ctx.showPopup("No Llama GGUF brief model set — pick one in Settings.", true);
      return null;
    }
    return { briefOR, briefLlama };
  }

  async function doWrite() {
    if (busy) return;
    deriveModes(); renderImageRow();
    const images = enhMode === "image" ? clipAssets(state, selected).refImages.slice(0, imageBriefMax(state.briefImageMode)).filter(Boolean) : [];

    const backends = briefBackendCheck();
    if (!backends) return;
    const { briefOR, briefLlama } = backends;
    const visionOR = state.h3VisionBackend === "openrouter";
    const visionLlama = state.h3VisionBackend === "llamagguf";
    if (!visionOR && !visionLlama && images.length && !state.nativeVisionClip) {
      ctx.showPopup("Set a Vision CLIP (or switch the Vision backend to OpenRouter/Llama GGUF in Settings).", true);
      return;
    }
    if (images.length && visionLlama && !state.h3LlamaVisionModel) {
      ctx.showPopup("No Llama GGUF vision model set — pick one in Settings.", true);
      return;
    }
    const base = (editor.value || "").trim();
    if (!base && !images.length) {
      ctx.showPopup("Write something first (or add an image).", true);
      return;
    }
    busy = true;
    enhBtn.setAttribute("disabled", "true");
    refineBtn.setAttribute("disabled", "true");
    enhSpin.classList.remove("hidden");
    setEditorBusy(true, "✨ Writing the prompt…");
    enhStopBtn.style.display = "inline-flex";
    enhStopBtn.removeAttribute("disabled");
    progressStart();
    try {
      let imageSummary = "";
      if (images.length) {
        if (visionLlama) {
          // The shared /tj_studio_one/llm/image_to_prompt route (same one the image tools'
          // Enhance panel uses) takes one image per call — no true multi-image batching like
          // the native TextGenerate path has — so loop client-side.
          const lines: string[] = [];
          for (let i = 0; i < images.length; i++) {
            progressStage(`Analyzing image ${i + 1}/${images.length}…`);
            const b64 = await imageToB64(images[i]);
            const desc = await analyzeImageLlama(b64, state.h3LlamaVisionModel, state.h3LlamaVisionMmproj, VISION_SYSTEM_PROMPT, state.h3LlamaNCtx, state.h3LlamaMaxTokens);
            lines.push(String(desc || "").trim());
          }
          imageSummary = lines.join("\n");
        } else {
          progressStage(visionOR
            ? `Analyzing ${images.length} image(s) (OpenRouter)…`
            : `Analyzing ${images.length} image(s) (native, one batch)…`);
          const prompt = `${VISION_SYSTEM_PROMPT} There are ${images.length} images, in order. Describe each one separately, each on its own line starting with "Image N: ".`;
          imageSummary = (visionOR
            ? await analyzeImagesOpenRouter(images, prompt, state.h3OrModelVision || state.h3OrModelBrief)
            : await analyzeImagesNative(state.nativeVisionClip, images, prompt)).trim();
        }
        // The vision model is asked to number its own lines ("Image N: ..."), but it doesn't
        // reliably count right (a real 4-image run came back numbered 1/4/5/6). buildUserPrompt
        // separately tells the brief model these lines are <Picture 1>...<Picture N> strictly
        // BY POSITION ("analyzed in order") — leaving the vision model's own (possibly wrong)
        // numbers embedded on each line meant two conflicting numbering schemes in the same
        // prompt, and the brief model could follow the wrong one. Re-number every line by its
        // actual array position here, discarding whatever the vision model wrote, so the brief
        // model only ever sees correctly sequential labels.
        imageSummary = imageSummary
          .split("\n")
          .map((line, i) => line.replace(/^\s*(?:Image|Picture)\s*\d+\s*:/i, `Image ${i + 1}:`))
          .join("\n");
      }
      progressStage("Writing brief…");
      const text = (briefLlama
        ? await writeBriefLlama(buildUserPrompt(base, imageSummary), state.h3LlamaBriefModel, state.h3LlamaNCtx, state.h3LlamaMaxTokens)
        : briefOR
        ? await writeBriefOpenRouter(systemPrompt, buildUserPrompt(base, imageSummary), state.h3OrModelBrief)
        : await writeBriefNative(state.nativeBriefClip, systemPrompt, buildUserPrompt(base, imageSummary))).trim();
      if (!text) throw new Error("empty response");
      openReview(text, (targetSel as HTMLSelectElement).value);
      statusTag.textContent = "review the result";
      statusTag.style.color = C.ok;
    } catch (e: any) {
      statusTag.textContent = `⚠ ${String(e.message || e).slice(0, 90)}`;
      statusTag.style.color = C.err;
      ctx.showPopup(`Prompt Write failed: ${e.message || e} — check that ComfyUI is running with CORS allowed.`, true);
    } finally {
      progressStop();
      busy = false;
      enhBtn.removeAttribute("disabled");
      refineBtn.removeAttribute("disabled");
      enhSpin.classList.add("hidden");
      setEditorBusy(false);
      enhStopBtn.style.display = "none";
    }
  }
  enhBtn.addEventListener("click", doWrite);

  // Refine — text-only, no images re-attached (see buildRefineUserPrompt above).
  async function doRefine() {
    if (busy) return;
    const backends = briefBackendCheck();
    if (!backends) return;
    const { briefOR, briefLlama } = backends;
    const current = (editor.value || "").trim();
    if (!current) { ctx.showPopup("Nothing to refine — write a prompt first (or use Prompt Write).", true); return; }
    const instruction = await promptTextareaDialog("Revise the current prompt how?", {
      tags: ["Picture", "Subject", "Shot"], okLabel: "Refine",
    });
    if (!instruction) return;
    busy = true;
    enhBtn.setAttribute("disabled", "true");
    refineBtn.setAttribute("disabled", "true");
    refineSpin.classList.remove("hidden");
    setEditorBusy(true, "🔧 Refining the prompt…");
    enhStopBtn.style.display = "inline-flex";
    enhStopBtn.removeAttribute("disabled");
    progressStart();
    try {
      progressStage("Refining brief…");
      const userPrompt = buildRefineUserPrompt(current, instruction);
      const text = (briefLlama
        ? await writeBriefLlama(userPrompt, state.h3LlamaBriefModel, state.h3LlamaNCtx, state.h3LlamaMaxTokens)
        : briefOR
        ? await writeBriefOpenRouter(systemPrompt, userPrompt, state.h3OrModelBrief)
        : await writeBriefNative(state.nativeBriefClip, systemPrompt, userPrompt)).trim();
      if (!text) throw new Error("empty response");
      openReview(text, (targetSel as HTMLSelectElement).value);
      statusTag.textContent = "review the result";
      statusTag.style.color = C.ok;
    } catch (e: any) {
      statusTag.textContent = `⚠ ${String(e.message || e).slice(0, 90)}`;
      statusTag.style.color = C.err;
      ctx.showPopup(`Prompt Refine failed: ${e.message || e} — check that ComfyUI is running with CORS allowed.`, true);
    } finally {
      progressStop();
      busy = false;
      enhBtn.removeAttribute("disabled");
      refineBtn.removeAttribute("disabled");
      refineSpin.classList.add("hidden");
      setEditorBusy(false);
      enhStopBtn.style.display = "none";
    }
  }
  refineBtn.addEventListener("click", doRefine);

  // ── review overlay ──────────────────────────────────────────────────────
  // SPEC_MINIMAX_H3_ENHANCE_APPLY_MODES.md §1 — the cards are always a preview; how the result
  // gets applied is chosen last, from the mode block just above Discard/Apply:
  //   "one"    the whole brief as one paragraph into the current clip's shot field only
  //   "split"  parsed into common header / shots / sound-music tail (the old behaviour)
  //   "manual" only the result cards the user ticked
  const reviewOv = el("div", { class: "absolute inset-0 z-20 flex-col p-3 gap-2 box-border", style: { display: "none", background: "rgba(11,11,11,0.985)" } });
  let reviewText = "",
    reviewTarget = "one",
    reviewMode: "one" | "split" | "manual" = "split";
  const reviewSel = new Set<string>();
  let reviewParsed: ReturnType<typeof parseBrief> = { header: "", shots: [], footer: "" };
  const rvHdr = el("div", { class: "flex items-center gap-2 shrink-0" });
  rvHdr.appendChild(el("div", { text: "✨ Prompt Write/Refine result", class: "text-white text-[13px] font-bold" }));
  const rvInfo = el("div", { class: "text-[10.5px] flex-1", style: { color: C.muted } });
  rvHdr.appendChild(rvInfo);
  const rvBody = el("div", { class: "flex-1 overflow-y-auto flex flex-col gap-1.5" });

  const rvModeRow = el("div", { class: "flex flex-col gap-1.5 shrink-0" });
  rvModeRow.appendChild(el("div", { text: "Choose how to apply this result", class: "text-[10.5px] text-center font-bold", style: { color: C.muted } }));
  const rvModeBtnRow = el("div", { class: "flex gap-1.5" });
  rvModeRow.appendChild(rvModeBtnRow);
  const rvModeBtns: Record<string, HTMLButtonElement> = {};
  ([
    ["one", "1. One Prompt", "Whole brief → this clip's shot field only"],
    ["split", "2. Auto Split", "Header / shots / sound-music into their own fields"],
    ["manual", "3. Use selected", "Only the cards you tick above"],
  ] as const).forEach(([k, lbl, tip]) => {
    const b = el("button", { type: "button", text: lbl, title: tip, style: { flex: "1", cursor: "pointer", fontFamily: "inherit", fontSize: "10px", fontWeight: "700", padding: "5px 0", borderRadius: "5px", border: `1px solid ${C.border}`, background: C.bg2, color: C.text } }) as HTMLButtonElement;
    b.addEventListener("click", () => { reviewMode = k; renderReviewCards(); });
    rvModeBtns[k] = b;
    rvModeBtnRow.appendChild(b);
  });

  const rvFoot = el("div", { class: "flex items-center gap-2 shrink-0" });
  const rvSummary = el("div", { class: "text-[10.5px] flex-1", style: { color: C.muted } });
  const rvCancel = el("button", { type: "button", text: "✕ Discard", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "6px 12px", borderRadius: "6px", background: C.bg2, color: C.muted, border: `1px solid ${C.border}` } });
  const rvApply = button("✓ Apply", () => applyReview(), "primary");
  rvFoot.append(rvSummary, rvCancel, rvApply);
  reviewOv.append(rvHdr, rvBody, rvModeRow, rvFoot);

  // One result card. `key` is "one" | "header" | `shot:${i}` | "footer". In manual mode a
  // click toggles it in/out of reviewSel; the other two modes render it read-only.
  function reviewCard(key: string, title: string, text: string) {
    const selectable = reviewMode === "manual";
    const on = reviewSel.has(key);
    const previewAccent = reviewMode === "one" ? C.border : key.startsWith("shot") ? BRAND : C.ok;
    const border = selectable ? (on ? `2px solid ${BRAND}` : "1px solid #3a3a3a") : `1px solid ${previewAccent}`;
    const b = el("div", {
      class: "rounded-md px-2.5 py-2 flex flex-col gap-1",
      style: {
        background: C.bg1, border,
        cursor: selectable ? "pointer" : "default",
        boxShadow: selectable && !on ? "inset 0 0 0 999px rgba(0,0,0,0.55)" : "none",
        opacity: reviewMode === "one" && key !== "one" ? "0.5" : "1",
        transition: "box-shadow .1s, border-color .1s",
      },
    });
    b.append(
      el("div", {
        text: title + (selectable ? (on ? "   ● selected" : "   ○ off") : ""),
        class: "text-[9.5px] font-bold tracking-wide",
        style: { color: selectable ? (on ? BRAND : C.muted) : previewAccent === C.border ? C.muted : previewAccent },
      }),
      el("div", { text, class: "text-[11px] leading-relaxed whitespace-pre-wrap", style: { color: C.text } })
    );
    if (selectable) b.addEventListener("click", () => {
      reviewSel.has(key) ? reviewSel.delete(key) : reviewSel.add(key);
      renderReviewCards();
    });
    return b;
  }

  function renderReviewCards() {
    for (const k in rvModeBtns) {
      const active = k === reviewMode;
      rvModeBtns[k].style.background = active ? BRAND : C.bg2;
      rvModeBtns[k].style.color = active ? "#fff" : C.text;
    }
    const p = reviewParsed;
    clear(rvBody);
    if (reviewMode === "one") {
      rvBody.appendChild(reviewCard("one", `→ CLIP ${selected + 1} (whole brief, one paragraph)`, reviewText));
    } else {
      if (p.header) rvBody.appendChild(reviewCard("header", "COMMON — HEADER", p.header));
      const shots = p.shots.length ? p.shots : [reviewText];
      shots.forEach((s, i) => rvBody.appendChild(reviewCard(`shot:${i}`, `CLIP ${i + 1}`, s)));
      if (p.footer) rvBody.appendChild(reviewCard("footer", "COMMON — SOUND / MUSIC", p.footer));
    }

    const got = p.shots.length || 1;
    let info = `${reviewText.length} chars`;
    if (reviewTarget === "all") {
      const want = targetPlan().shots;
      info += ` · ${got} shot${got > 1 ? "s" : ""}`;
      if (want && got !== want) info += `  ⚠ asked for ${want} — use ✂ Split into clips or ↻ Prompt Write again`;
    } else {
      info += ` → clip ${selected + 1}`;
    }
    rvInfo.textContent = info;

    rvSummary.textContent =
      reviewMode === "one" ? `Whole brief → clip ${selected + 1}'s text. Header / tail untouched.`
      : reviewMode === "manual" ? (reviewSel.size ? `Applying ${reviewSel.size} selected part(s).` : "Tick the cards to apply.")
      : reviewTarget === "all" ? `Replaces all prompts with ${got}${p.header ? " + header" : ""}${p.footer ? " + tail" : ""}.`
      : `Replaces clip ${selected + 1}${p.header || p.footer ? " and the common parts" : ""}.`;
  }

  function openReview(text: string, target: string) {
    reviewText = text;
    reviewTarget = target;
    reviewParsed = parseBrief(text);
    reviewMode = "split";
    reviewSel.clear();
    // Seed manual mode all-ticked so "Use selected" == "Auto Split" until a card is removed.
    if (reviewParsed.header) reviewSel.add("header");
    if (reviewParsed.footer) reviewSel.add("footer");
    (reviewParsed.shots.length ? reviewParsed.shots : [text]).forEach((_, i) => reviewSel.add(`shot:${i}`));
    renderReviewCards();
    reviewOv.style.display = "flex";
  }

  function applyReview() {
    const p = reviewParsed;
    if (reviewMode === "manual" && !reviewSel.size) {
      ctx.showPopup("Tick at least one card, or switch mode.", true);
      return;
    }
    if (reviewMode === "one") {
      state.prompts[selected] = normPrompt(state.prompts[selected]);
      state.prompts[selected].text = reviewText; // header/footer left alone
    } else if (reviewMode === "split") {
      if (p.header) state.promptHeader = p.header;
      if (p.footer) state.promptFooter = p.footer;
      if (reviewTarget === "all") {
        state.prompts = p.shots.length
          ? p.shots.map((s) => ({ text: s, firstFrame: "", enabled: true }))
          : [{ text: reviewText, firstFrame: "", enabled: true }];
        selected = 0;
      } else {
        state.prompts[selected] = normPrompt(state.prompts[selected]);
        state.prompts[selected].text = p.shots.join("\n\n") || reviewText;
      }
    } else {
      // manual — only the ticked cards
      if (reviewSel.has("header") && p.header) state.promptHeader = p.header;
      if (reviewSel.has("footer") && p.footer) state.promptFooter = p.footer;
      const picked = (p.shots.length ? p.shots : [reviewText]).filter((_, i) => reviewSel.has(`shot:${i}`));
      if (picked.length) {
        if (reviewTarget === "all") {
          state.prompts = picked.map((s) => ({ text: s, firstFrame: "", enabled: true }));
          selected = 0;
        } else {
          state.prompts[selected] = normPrompt(state.prompts[selected]);
          state.prompts[selected].text = picked.join("\n\n");
        }
      }
    }
    ctx.persist();
    reviewOv.style.display = "none";
    renderAll();
    onApply?.();
    statusTag.textContent = "applied";
    statusTag.style.color = C.ok;
  }
  rvCancel.addEventListener("click", () => {
    reviewOv.style.display = "none";
    statusTag.textContent = "discarded";
    statusTag.style.color = C.muted;
  });

  // ── split dialog ────────────────────────────────────────────────────────
  const splitOv = el("div", { class: "absolute inset-0 z-10 flex-col p-3 gap-2 box-border", style: { display: "none", background: "rgba(11,11,11,0.985)" } });
  let splitShots: string[] = [],
    splitHeader = "",
    splitFooter = "",
    splitBreaks = new Set<number>();

  const splitHdr = el("div", { class: "flex items-center gap-2 shrink-0" });
  splitHdr.appendChild(el("div", { text: "✂ Split into clips", class: "text-white text-[13px] font-bold" }));
  const splitInfo = el("div", { class: "text-[10.5px] flex-1", style: { color: C.muted } });
  splitHdr.appendChild(splitInfo);
  function splitCtlBtn(text: string, title?: string) {
    return el("button", { type: "button", text, title, style: { cursor: "pointer", fontFamily: "inherit", fontSize: "10.5px", padding: "5px 11px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` } });
  }
  const evenBtn = splitCtlBtn("↔ Even", "Spread the shots evenly over the planned clip count");
  const onePerBtn = splitCtlBtn("1 shot / clip");
  const noneBtn = splitCtlBtn("All in one");
  splitHdr.append(evenBtn, onePerBtn, noneBtn, button("✕", () => (splitOv.style.display = "none"), "danger"));

  const splitBody = el("div", { class: "flex-1 overflow-y-auto flex flex-col gap-0" });
  const splitFoot = el("div", { class: "flex items-center gap-2 shrink-0" });
  const splitSummary = el("div", { class: "text-[11px] flex-1", style: { color: C.text } });
  const applySplitBtn = button("✓ Apply split", () => applySplit(), "primary");
  splitFoot.append(splitSummary, applySplitBtn);
  splitOv.append(splitHdr, splitBody, splitFoot);

  function renderSplit() {
    clear(splitBody);
    const plan = ctx.currentPlan();
    splitInfo.textContent = `${splitShots.length} shot(s) · plan is ${plan.count} clip(s) of ${plan.clipSec.toFixed(2)}s`;
    let clipNo = 1;
    splitShots.forEach((shot, i) => {
      if (i > 0 && splitBreaks.has(i)) clipNo++;
      const card = el("div", { class: "flex gap-1.5 items-start rounded-md px-2 py-1.5", style: { background: C.bg1, border: `1px solid ${C.border}` } });
      card.append(
        el("div", { text: `C${clipNo}`, class: "shrink-0 text-[10px] font-bold rounded px-1.5 py-0.5", style: { color: BRAND, background: C.bg3 } }),
        el("div", { text: shot.replace(/\s+/g, " ").slice(0, 150) + (shot.length > 150 ? "…" : ""), class: "flex-1 text-[10.5px] leading-relaxed" })
      );
      splitBody.appendChild(card);
      if (i < splitShots.length - 1) {
        const on = splitBreaks.has(i + 1);
        const cut = el("button", { type: "button", text: on ? "✂ ── clip break ──" : "· · · join · · ·", style: { alignSelf: "center", cursor: "pointer", fontFamily: "inherit", fontSize: "9.5px", padding: "2px 12px", margin: "3px 0", borderRadius: "10px", background: on ? BRAND : "transparent", color: on ? "#fff" : C.muted, border: `1px ${on ? "solid" : "dashed"} ${on ? BRAND : C.border}` } });
        cut.addEventListener("click", () => {
          if (splitBreaks.has(i + 1)) splitBreaks.delete(i + 1);
          else splitBreaks.add(i + 1);
          renderSplit();
        });
        splitBody.appendChild(cut);
      }
    });
    const groups = splitBreaks.size + 1;
    splitSummary.innerHTML = `→ <b style="color:${BRAND}">${groups} clip prompt(s)</b>`;
  }

  function openSplit() {
    const parsed = parseBrief(editor.value);
    if (parsed.shots.length <= 1) {
      ctx.showPopup("Only one shot found — nothing to split ([Shot N] markers or --- separate them).", true);
      return;
    }
    splitShots = parsed.shots;
    splitHeader = parsed.header;
    splitFooter = parsed.footer;
    const plan = ctx.currentPlan();
    splitBreaks = new Set(evenBreaks(splitShots.length, plan.count));
    renderSplit();
    splitOv.style.display = "flex";
  }
  function applySplit() {
    const groups = groupShotsWithBreaks(splitShots, splitBreaks.size + 1, [...splitBreaks]);
    if (splitHeader) state.promptHeader = splitHeader;
    if (splitFooter) state.promptFooter = splitFooter;
    state.prompts = groups.map((g) => ({ text: g, firstFrame: "", enabled: true }));
    selected = 0;
    ctx.persist();
    splitOv.style.display = "none";
    renderAll();
    onApply?.();
    ctx.showPopup(`Split into ${groups.length} clip prompt(s); common parts kept.`, false);
  }
  evenBtn.addEventListener("click", () => {
    const plan = ctx.currentPlan();
    splitBreaks = new Set(evenBreaks(splitShots.length, plan.count));
    renderSplit();
  });
  onePerBtn.addEventListener("click", () => {
    splitBreaks = new Set(splitShots.map((_, i) => i).filter((i) => i > 0));
    renderSplit();
  });
  noneBtn.addEventListener("click", () => {
    splitBreaks = new Set();
    renderSplit();
  });

  // ── footer ──────────────────────────────────────────────────────────────
  const footer = el("div", { class: "flex items-center gap-2 shrink-0 flex-wrap" });
  const splitBtn = el("button", { type: "button", text: "✂ Split into clips…", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "6px 12px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` } });
  splitBtn.addEventListener("click", openSplit);
  const planTag = el("div", { class: "text-[10.5px] flex-1", style: { color: C.muted } });
  footer.append(splitBtn, planTag, button("✓ Done", () => hide(), "primary"));

  ov.append(hdr, setsWrap, commonWrap, body, enhWrap, footer, splitOv, reviewOv);

  function refreshPlanTag() {
    const p = ctx.currentPlan();
    const n = (state.prompts || []).length;
    planTag.innerHTML = `${n} prompt(s) for <b>${p.count}</b> clip · ${p.actualSeconds.toFixed(2)}s total`;
  }
  function refreshPreviewTag() {
    charCount.textContent = `${(editor.value || "").length} chars`;
  }
  function renderAll() {
    headerTA.value = state.promptHeader || "";
    footerTA.value = state.promptFooter || "";
    headerUC.paint();
    footerUC.paint();
    renderList();
    loadSelected();
    refreshPlanTag();
    renderLenTag();
  }

  function hide() {
    ov.style.display = "none";
    onApply?.();
  }

  return {
    el: ov,
    show() {
      ov.style.display = "flex";
      if (!state.prompts || !state.prompts.length) state.prompts = [{ text: "", firstFrame: "", enabled: true }];
      if (selected >= state.prompts.length) selected = 0;
      deriveModes();
      renderImageRow();
      renderAll();
      if (!systemPrompt) loadSystemPrompt();
      refreshEnhanceModels();
      refreshSetsList();
      setTimeout(() => editor.focus(), 60);
    },
    hide,
    syncCommon() {
      headerTA.value = state.promptHeader || "";
      footerTA.value = state.promptFooter || "";
      headerUC.paint();
      footerUC.paint();
      refreshPreviewTag();
    },
  };
}
