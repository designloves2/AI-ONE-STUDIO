// promptEdit.ts — MiniMax H3 전체화면 프롬프트 에디터 (Ollama LLM enhance 포함).
// 원본: web/minimax/ui_prompt_edit_minimax.js. 오버레이 자체가 이미 풀스크린으로 설계돼
// 있던 부분이라 레이아웃은 원본을 그대로 따르되, 저장된 프롬프트 세트(서버 파일 저장)
// 기능은 백엔드 연결 단계(§4-2)로 미뤘다 — 지금은 로컬 state(localStorage)까지만.
import type { MinimaxState, PromptEntry } from "./core";
import {
  IMAGE_BRIEF_MODES,
  evenBreaks,
  groupShotsWithBreaks,
  imageBriefMax,
  parseBrief,
  parseTargetSeconds,
  promptEnabled,
  promptText,
} from "./core";
import { button, clear, el, searchableSelect } from "../../shared/ui";
import { C, BRAND } from "../../identity";
import {
  analyzeImagesNative,
  deletePromptSet,
  enhancePrompt,
  getModels,
  getOllamaModels,
  getPromptSet,
  getSystemPrompt,
  imageToB64,
  listPromptSets,
  savePromptSet,
  uploadImage,
  viewUrl,
  writeBriefNative,
} from "./api";

const MODES = [
  { key: "text", label: "✨ Text → Brief", hint: "rewrite the prompt into a shot-by-shot brief" },
  { key: "image", label: "🖼 Image → Brief", hint: "describe an image, then write the brief from it" },
];

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
  ctx: { persist: () => void; showPopup: (msg: string, isError?: boolean) => void; currentPlan: () => { count: number; clipSec: number; promptCount: number; actualSeconds: number } },
  onApply?: () => void
): PromptEditHandle {
  const ov = el("div", {
    class: "fixed inset-0 z-[9999] flex-col p-3 gap-2 box-border",
    style: { display: "none", background: "rgba(11,11,11,0.985)" },
  });

  let selected = 0;
  let systemPrompt = "";
  let ollamaModels: string[] = [];
  let clipModels: string[] = [];
  let busy = false;
  let enhMode: "text" | "image" = "text";

  // ── header ──────────────────────────────────────────────────────────────
  const hdr = el("div", { class: "flex items-center gap-2 shrink-0" });
  hdr.appendChild(el("div", { text: "📝 Prompt Edit", class: "text-white text-sm font-bold" }));
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
      setsSel.appendChild(el("option", { text: "(failed to load — ComfyUI 연결 확인)", value: "" }));
    }
  }

  setLoadBtn.addEventListener("click", async () => {
    const name = setsSel.value;
    if (!name) return;
    try {
      const s = await getPromptSet(name);
      state.prompts = (Array.isArray(s.prompts) && s.prompts.length ? s.prompts : [{ text: "", firstFrame: "", enabled: true }]).map((p: any) =>
        typeof p === "string" ? { text: p, firstFrame: "", enabled: true } : { text: p?.text || "", firstFrame: p?.firstFrame || "", enabled: p?.enabled !== false }
      );
      state.promptHeader = s.promptHeader || "";
      state.promptFooter = s.promptFooter || "";
      selected = 0;
      ctx.persist();
      renderAll();
      const framesNote = s.clipFrames && s.clipFrames !== (state as any).clipFrames ? ` — saved at a different clip length (${s.clipFrames} frames vs current ${(state as any).clipFrames})` : "";
      ctx.showPopup(`Loaded "${name}"${framesNote}`, false);
    } catch (e: any) {
      ctx.showPopup(`Load failed: ${e.message || e}`, true);
    }
  });

  setSaveBtn.addEventListener("click", async () => {
    const existing = setsSel.value && setsSel.options.length && setsSel.value !== "" ? setsSel.value : "";
    const name = window.prompt("Save this prompt set as:", existing || "");
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) { ctx.showPopup("Name can't be empty.", true); return; }
    const willOverwrite = [...setsSel.options].some((o) => o.value === trimmed);
    if (willOverwrite && !confirm(`"${trimmed}" already exists — overwrite it?`)) return;
    try {
      await savePromptSet({
        name: trimmed,
        clipFrames: (state as any).clipFrames,
        promptHeader: state.promptHeader || "",
        promptFooter: state.promptFooter || "",
        prompts: (state.prompts || []).map((p) => (typeof p === "string" ? { text: p, firstFrame: "", enabled: true } : p)),
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
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
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
  const headerTA = commonField("Common opening — visual style, grade, opening composition… (sent with every clip)", () => state.promptHeader, (v) => (state.promptHeader = v));
  const footerTA = commonField("Common tail — Ambient sound: … / Music: … (sent with every clip)", () => state.promptFooter, (v) => (state.promptFooter = v));
  const commonWrap = el("div", { class: "shrink-0 flex gap-2 flex-col sm:flex-row" });
  commonWrap.append(
    el("div", { class: "flex-1 flex flex-col gap-1" }, [el("div", { text: "COMMON — HEADER", class: "text-[9.5px] tracking-wide", style: { color: C.muted } }), headerTA]),
    el("div", { class: "flex-1 flex flex-col gap-1" }, [el("div", { text: "COMMON — SOUND / MUSIC", class: "text-[9.5px] tracking-wide", style: { color: C.muted } }), footerTA])
  );

  // ── body: clip list | editor ───────────────────────────────────────────
  const body = el("div", { class: "flex-1 flex gap-2.5 min-h-0 flex-col md:flex-row" });
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
  editHdr.append(editTitle, charCount);
  const editor = el("textarea", {
    placeholder: "Describe this clip…",
    style: { flex: "1", minHeight: "160px", boxSizing: "border-box", background: C.bg1, color: C.text, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "12px", fontSize: "13px", lineHeight: "1.6", fontFamily: "inherit", outline: "none", resize: "none" },
  });
  editor.addEventListener("input", () => {
    state.prompts[selected] = normPrompt(state.prompts[selected]);
    state.prompts[selected].text = editor.value;
    ctx.persist();
    updateCount();
    renderList();
  });
  editCol.append(editHdr, editor);
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
      const prev = el("div", { text: promptText(p).trim().slice(0, 42) || "(empty — reuses previous)", class: "flex-1 text-[10.5px] truncate", style: { color: promptText(p).trim() ? C.text : C.muted } });
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
    const p = normPrompt(list[selected]);
    editor.value = promptText(p);
    editTitle.textContent = `Clip ${selected + 1}`;
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

  // ── Ollama enhance bar ──────────────────────────────────────────────────
  const enhWrap = el("div", { class: "shrink-0 rounded-lg p-2.5 flex flex-col gap-2", style: { background: C.bg1, border: `1px solid ${C.border}` } });
  const enhTop = el("div", { class: "flex items-center gap-2 flex-wrap" });
  const enhTitle = el("div", { text: "ENHANCE", class: "text-[10px] font-bold tracking-wide", style: { color: BRAND } });
  enhTop.appendChild(enhTitle);

  // 원본은 이 스위치가 ⚙ Settings에 있었지만, Enhance를 쓰는 바로 그 자리에서 바꿀 수 있는
  // 게 더 자연스러워서 Prompt Edit 안으로 옮겼다 — Ollama(외부 서버) vs Local(ComfyUI에
  // 이미 로드된 CLIP으로 직접 실행, 별도 서버 불필요).
  const SOURCES = [
    { key: "ollama", label: "🌐 Ollama" },
    { key: "native", label: "💻 Local (native CLIP)" },
  ];
  const sourceWrap = el("div", { class: "flex gap-1" });
  function renderSourceToggle() {
    clear(sourceWrap);
    SOURCES.forEach((s) => {
      const active = (state.visionSource || "ollama") === s.key;
      const b = el("button", {
        type: "button", text: s.label,
        style: { cursor: "pointer", fontFamily: "inherit", fontSize: "10.5px", padding: "4px 10px", borderRadius: "5px", fontWeight: active ? "700" : "400", background: active ? BRAND : C.bg2, color: "#fff", border: `1px solid ${active ? BRAND : C.border}` },
      });
      b.addEventListener("click", () => {
        state.visionSource = s.key;
        ctx.persist();
        renderSourceToggle();
        refreshOllama();
      });
      sourceWrap.appendChild(b);
    });
  }
  enhTop.appendChild(sourceWrap);

  const statusTag = el("div", { text: "", class: "text-[10px] flex-1", style: { color: C.muted } });
  enhTop.appendChild(statusTag);

  const modeWrap = el("div", { class: "flex gap-1" });
  function renderModes() {
    clear(modeWrap);
    MODES.forEach((m) => {
      const active = m.key === enhMode;
      const b = el("button", {
        type: "button", text: m.label, title: m.hint,
        style: { cursor: "pointer", fontFamily: "inherit", fontSize: "10.5px", padding: "4px 10px", borderRadius: "5px", fontWeight: active ? "700" : "400", background: active ? BRAND : C.bg2, color: "#fff", border: `1px solid ${active ? BRAND : C.border}` },
      });
      b.addEventListener("click", () => {
        enhMode = m.key as "text" | "image";
        renderModes();
        renderImageRow();
      });
      modeWrap.appendChild(b);
    });
  }
  enhTop.appendChild(modeWrap);

  const modelSelWrap = el("div", { class: "min-w-[200px]" });
  const targetSel = el("select", { style: { background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px", fontSize: "12px", fontFamily: "inherit" } }, [
    el("option", { value: "one", text: "→ this clip" }),
    el("option", { value: "all", text: "→ split into all clips" }),
  ]);

  const enhBtn = el("button", { type: "button", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "7px 16px", borderRadius: "6px", background: BRAND, color: "#fff", border: "none", fontWeight: "700", display: "inline-flex", alignItems: "center", gap: "6px" } });
  const enhBtnLabel = el("span", { text: "✨ Enhance" });
  enhBtn.append(enhBtnLabel);

  const lenIn = el("input", { type: "text", placeholder: "3:20", style: { width: "74px", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px", fontSize: "12px", fontFamily: "inherit", outline: "none", textAlign: "center" } }) as HTMLInputElement;
  lenIn.value = state.targetLength || "";
  lenIn.title = "Target length for the whole piece — 3:20, 200s, or 3분 20초. Blank = one shot per prompt already in the editor.";
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

  const imgRow = el("div", { style: { display: "none", flexDirection: "column", gap: "6px" } });
  function renderImageRow() {
    clear(imgRow);
    imgRow.style.display = enhMode === "image" ? "flex" : "none";
    if (enhMode !== "image") return;
    if (!state.ollamaImages) state.ollamaImages = [];
    const max = imageBriefMax(state.ollamaImageMode);
    if (state.ollamaImages.length > max) {
      state.ollamaImages.length = max;
      ctx.persist();
    }
    const modeRow = el("div", { class: "flex gap-1" });
    IMAGE_BRIEF_MODES.forEach((m) => {
      const active = state.ollamaImageMode === m.key;
      const b = el("button", { type: "button", text: m.label, title: m.hint, style: { cursor: "pointer", fontFamily: "inherit", fontSize: "10px", padding: "3px 8px", borderRadius: "5px", fontWeight: active ? "700" : "400", background: active ? BRAND : C.bg2, color: "#fff", border: `1px solid ${active ? BRAND : C.border}` } });
      b.addEventListener("click", () => {
        state.ollamaImageMode = m.key;
        const cap = imageBriefMax(m.key);
        if (state.ollamaImages.length > cap) state.ollamaImages.length = cap;
        ctx.persist();
        renderImageRow();
      });
      modeRow.appendChild(b);
    });

    const grid = el("div", { class: "flex gap-1.5 flex-wrap" });
    function slot(i: number) {
      const name = state.ollamaImages[i];
      const box = el("div", { class: "relative w-[108px] h-[108px] shrink-0 rounded-md overflow-hidden flex items-center justify-center", style: { background: "#000", border: `1px solid ${C.border}`, cursor: name ? "default" : "pointer" } });
      if (name) {
        box.appendChild(el("img", { src: viewUrl(name), class: "w-full h-full object-cover" }));
        const x = el("button", { type: "button", text: "✕", title: "Remove", style: { position: "absolute", top: "0", right: "0", cursor: "pointer", fontSize: "13px", background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", padding: "2px 6px" } });
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          state.ollamaImages.splice(i, 1);
          ctx.persist();
          renderImageRow();
        });
        box.appendChild(x);
      } else {
        box.appendChild(el("div", { text: "+img", class: "text-[10px] pointer-events-none", style: { color: C.muted } }));
        const inp = el("input", { type: "file", accept: "image/*", style: { display: "none" } }) as HTMLInputElement;
        async function take(f: File) {
          if (!f) return;
          try {
            const uploaded = await uploadImage(f);
            state.ollamaImages[i] = uploaded;
            ctx.persist();
            renderImageRow();
          } catch (e: any) {
            ctx.showPopup(`업로드 실패: ${e.message} (ComfyUI가 실행 중인지 확인하세요)`, true);
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
      }
      return box;
    }
    const filled = state.ollamaImages.length;
    for (let i = 0; i < filled; i++) grid.appendChild(slot(i));
    if (filled < max) grid.appendChild(slot(filled));

    const note = el("div", { class: "text-[10px] leading-relaxed", style: { color: C.muted } });
    note.textContent = filled ? `${filled}/${max} image(s) — analyzed one at a time, then written into a brief.` : `Add up to ${max} image(s).`;
    imgRow.append(modeRow, grid, note);
  }

  const enhBottom = el("div", { class: "flex items-center gap-2 flex-wrap" });
  enhBottom.append(modelSelWrap, targetSel, el("div", { text: "Length", class: "text-[11px]", style: { color: C.muted } }), lenIn, lenTag, enhBtn);
  enhWrap.append(enhTop, imgRow, enhBottom);

  function isNative() {
    return (state.visionSource || "ollama") === "native";
  }

  function pickerField(labelText: string, options: string[], value: string, onChange: (v: string) => void) {
    const wrap = el("div", { class: "flex flex-col gap-0.5", style: { minWidth: "180px" } });
    wrap.appendChild(el("div", { text: labelText, class: "text-[9px]", style: { color: C.muted } }));
    const picker = searchableSelect(options.length ? options : ["(no models found)"], value || options[0] || "", onChange);
    wrap.appendChild(picker.el);
    return wrap;
  }

  function renderModelSel() {
    clear(modelSelWrap);
    if (isNative()) {
      modelSelWrap.className = "flex gap-2 flex-wrap min-w-[280px]";
      if (!clipModels.length) {
        modelSelWrap.appendChild(el("div", { text: "CLIP 목록을 불러올 수 없습니다 — ComfyUI 연결을 확인하세요", class: "text-[10.5px]", style: { color: C.warn } }));
        return;
      }
      modelSelWrap.appendChild(
        pickerField("BRIEF CLIP (writes the shot list)", clipModels, state.nativeBriefClip, (v) => {
          state.nativeBriefClip = v;
          ctx.persist();
        })
      );
      modelSelWrap.appendChild(
        pickerField("VISION CLIP (Image → Brief only)", clipModels, state.nativeVisionClip, (v) => {
          state.nativeVisionClip = v;
          ctx.persist();
        })
      );
      statusTag.textContent = clipModels.length ? "runs through ComfyUI's own model loading — no external server" : statusTag.textContent;
      statusTag.style.color = C.muted;
      return;
    }
    modelSelWrap.className = "flex gap-2 flex-wrap min-w-[280px]";
    if (!ollamaModels.length) {
      modelSelWrap.appendChild(el("div", { text: "no Ollama models — check the server URL, or ComfyUI isn't reachable", class: "text-[10.5px]", style: { color: C.warn } }));
      return;
    }
    if (!state.ollamaModel || !ollamaModels.includes(state.ollamaModel)) state.ollamaModel = ollamaModels[0];
    if (!state.ollamaVisionModel || !ollamaModels.includes(state.ollamaVisionModel)) state.ollamaVisionModel = ollamaModels[0];
    modelSelWrap.appendChild(
      pickerField("BRIEF MODEL (writes the prompt)", ollamaModels, state.ollamaModel, (v) => {
        state.ollamaModel = v;
        ctx.persist();
      })
    );
    modelSelWrap.appendChild(
      pickerField("VISION MODEL (reads images)", ollamaModels, state.ollamaVisionModel, (v) => {
        state.ollamaVisionModel = v;
        ctx.persist();
      })
    );
  }

  async function refreshOllama() {
    if (isNative()) {
      if (!clipModels.length) {
        statusTag.textContent = "CLIP 목록 불러오는 중…";
        const d = await getModels();
        clipModels = (d.text_encoders || []).filter((x) => x !== "none");
        statusTag.textContent = clipModels.length ? `${clipModels.length} CLIP(s) found` : "⚠ ComfyUI에서 text encoder 목록을 가져오지 못했습니다";
        statusTag.style.color = clipModels.length ? C.muted : C.warn;
      }
      renderModelSel();
      return;
    }
    statusTag.textContent = "connecting to Ollama (ComfyUI 경유)…";
    const d = await getOllamaModels(state.ollamaUrl);
    ollamaModels = d.models || [];
    statusTag.textContent = d.ok ? `${ollamaModels.length} model(s) · ${d.server_url || state.ollamaUrl}` : `⚠ ${String(d.error || "unreachable").slice(0, 90)}`;
    statusTag.style.color = d.ok ? C.muted : C.warn;
    renderModelSel();
  }

  async function loadSystemPrompt() {
    const d = await getSystemPrompt("minimax");
    systemPrompt = d.instruction || "";
    if (systemPrompt) {
      srcTag.textContent = `system prompt: ${d.name || "Minimax H3"} (${d.source === "TJ_NODE" ? "from TJ_NODE" : "built-in"})`;
    } else {
      srcTag.textContent = d.needsRestart ? "⚠ ComfyUI 백엔드가 이 라우트를 아직 지원하지 않습니다 (재시작 필요)" : "system prompt unavailable — ComfyUI 연결을 확인하세요";
      srcTag.style.color = C.warn;
    }
  }

  function buildUserPrompt(baseText: string, imageSummary: string) {
    const t = targetPlan();
    const lines = [`Target duration: ${t.seconds.toFixed(2)} seconds total, split into ${t.shots} shot(s) of ~${t.clipSec.toFixed(2)}s each.`];
    if (t.shots > 1) lines.push(`Write exactly ${t.shots} shots, separated by a line containing only ---, one shot per clip.`);
    if (imageSummary) {
      lines.push("", "The following images were analyzed in order:", "", imageSummary);
    }
    lines.push("", "USER REQUEST:", baseText || "(no text supplied — base the brief on the image analysis above)");
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
    enhBtnLabel.textContent = `${progStage} (${s}s)`;
    statusTag.textContent = s > 30 ? `${progStage} — a cold Ollama model load can take a while past this point` : progStage;
    statusTag.style.color = BRAND;
  }
  function progressStop() {
    if (progTimer) window.clearInterval(progTimer);
    progTimer = undefined;
  }

  enhBtn.addEventListener("click", async () => {
    if (busy) return;
    const native = isNative();
    const images = enhMode === "image" ? (state.ollamaImages || []).filter(Boolean) : [];

    if (native) {
      if (!state.nativeBriefClip) {
        ctx.showPopup("Brief CLIP 파일명을 입력하세요.", true);
        return;
      }
      if (images.length && !state.nativeVisionClip) {
        ctx.showPopup("Vision CLIP 파일명을 입력하세요.", true);
        return;
      }
    } else if (!state.ollamaModel) {
      ctx.showPopup("모델을 먼저 선택하세요 (Ollama 목록이 비어있다면 ComfyUI가 실행 중인지 확인).", true);
      return;
    }
    const base = (editor.value || "").trim();
    if (!base && !images.length) {
      ctx.showPopup("Write something first (or add an image).", true);
      return;
    }
    busy = true;
    enhBtn.setAttribute("disabled", "true");
    progressStart();
    try {
      let imageSummary = "";
      if (images.length) {
        if (native) {
          progressStage(`Analyzing ${images.length} image(s) (native, one batch)…`);
          const prompt = `${VISION_SYSTEM_PROMPT} There are ${images.length} images, in order. Describe each one separately, each on its own line starting with "Image N: ".`;
          imageSummary = (await analyzeImagesNative(state.nativeVisionClip, images, prompt)).trim();
        } else {
          const parts: string[] = [];
          for (let i = 0; i < images.length; i++) {
            progressStage(`Analyzing image ${i + 1}/${images.length}…`);
            const b64 = await imageToB64(images[i]);
            const d = await enhancePrompt({
              model: state.ollamaVisionModel || state.ollamaModel,
              system_prompt: VISION_SYSTEM_PROMPT,
              user_prompt: "Describe this image.",
              image_b64: b64,
              temperature: state.ollamaTemperature ?? 0.7,
              top_p: state.ollamaTopP ?? 0.9,
              think: false,
            });
            parts.push(`Image ${i + 1}: ${(d.response || "").trim()}`);
          }
          imageSummary = parts.join("\n");
        }
      }
      progressStage("Writing brief…");
      let text: string;
      if (native) {
        text = (await writeBriefNative(state.nativeBriefClip, systemPrompt, buildUserPrompt(base, imageSummary))).trim();
      } else {
        const d = await enhancePrompt({
          model: state.ollamaModel,
          system_prompt: systemPrompt,
          user_prompt: buildUserPrompt(base, imageSummary),
          temperature: state.ollamaTemperature ?? 0.7,
          top_p: state.ollamaTopP ?? 0.9,
          think: false,
        });
        text = (d.response || "").trim();
      }
      if (!text) throw new Error("empty response");
      openReview(text, (targetSel as HTMLSelectElement).value);
      statusTag.textContent = "review the result";
      statusTag.style.color = C.ok;
    } catch (e: any) {
      statusTag.textContent = `⚠ ${String(e.message || e).slice(0, 90)}`;
      statusTag.style.color = C.err;
      ctx.showPopup(`Enhance failed: ${e.message || e} — ComfyUI가 CORS 허용 상태로 실행 중인지 확인하세요.`, true);
    } finally {
      progressStop();
      busy = false;
      enhBtn.removeAttribute("disabled");
      enhBtnLabel.textContent = "✨ Enhance";
    }
  });

  // ── review overlay ──────────────────────────────────────────────────────
  const reviewOv = el("div", { class: "absolute inset-0 z-20 flex-col p-3 gap-2 box-border", style: { display: "none", background: "rgba(11,11,11,0.985)" } });
  let reviewText = "",
    reviewTarget = "one";
  const rvHdr = el("div", { class: "flex items-center gap-2 shrink-0" });
  rvHdr.appendChild(el("div", { text: "✨ Enhance result", class: "text-white text-[13px] font-bold" }));
  const rvInfo = el("div", { class: "text-[10.5px] flex-1", style: { color: C.muted } });
  rvHdr.appendChild(rvInfo);
  const rvBody = el("div", { class: "flex-1 overflow-y-auto flex flex-col gap-1.5" });
  const rvFoot = el("div", { class: "flex items-center gap-2 shrink-0" });
  const rvSummary = el("div", { class: "text-[10.5px] flex-1", style: { color: C.muted } });
  const rvCancel = el("button", { type: "button", text: "✕ Discard", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "6px 12px", borderRadius: "6px", background: C.bg2, color: C.muted, border: `1px solid ${C.border}` } });
  const rvApply = button("✓ Apply", () => applyReview(), "primary");
  rvFoot.append(rvSummary, rvCancel, rvApply);
  reviewOv.append(rvHdr, rvBody, rvFoot);

  function reviewBlock(title: string, text: string, accent?: string) {
    const b = el("div", { class: "rounded-md px-2.5 py-2 flex flex-col gap-1", style: { background: C.bg1, border: `1px solid ${accent || C.border}` } });
    b.append(
      el("div", { text: title, class: "text-[9.5px] font-bold tracking-wide", style: { color: accent || C.muted } }),
      el("div", { text, class: "text-[11px] leading-relaxed whitespace-pre-wrap", style: { color: C.text } })
    );
    return b;
  }

  function openReview(text: string, target: string) {
    reviewText = text;
    reviewTarget = target;
    const parsed = parseBrief(text);
    const plan = ctx.currentPlan();
    clear(rvBody);
    if (reviewTarget === "all") {
      const shots = parsed.shots.length ? parsed.shots : [text];
      const secs = shots.length * (plan.clipSec || 0);
      rvInfo.textContent = `${shots.length} shot(s) → ${shots.length} clip prompt(s)${secs ? ` · ${secs.toFixed(1)}s total` : ""}`;
      if (parsed.header) rvBody.appendChild(reviewBlock("→ COMMON HEADER", parsed.header, C.ok));
      shots.forEach((g, i) => rvBody.appendChild(reviewBlock(`→ CLIP ${i + 1}`, g, BRAND)));
      if (parsed.footer) rvBody.appendChild(reviewBlock("→ COMMON SOUND / MUSIC", parsed.footer, C.ok));
      rvSummary.textContent = `Applying replaces ${plan.promptCount} prompt(s) with ${shots.length}`;
    } else {
      rvInfo.textContent = `${text.length} chars → clip ${selected + 1}`;
      if (parsed.header) rvBody.appendChild(reviewBlock("→ COMMON HEADER", parsed.header, C.ok));
      rvBody.appendChild(reviewBlock(`→ CLIP ${selected + 1}`, parsed.shots.join("\n\n") || text, BRAND));
      if (parsed.footer) rvBody.appendChild(reviewBlock("→ COMMON SOUND / MUSIC", parsed.footer, C.ok));
      rvSummary.textContent = `Applying replaces clip ${selected + 1}`;
    }
    reviewOv.style.display = "flex";
  }

  function applyReview() {
    const parsed = parseBrief(reviewText);
    if (parsed.header) state.promptHeader = parsed.header;
    if (parsed.footer) state.promptFooter = parsed.footer;
    if (reviewTarget === "all") {
      state.prompts = parsed.shots.length ? parsed.shots.map((s) => ({ text: s, firstFrame: "", enabled: true })) : [{ text: reviewText, firstFrame: "", enabled: true }];
      selected = 0;
    } else {
      state.prompts[selected] = normPrompt(state.prompts[selected]);
      state.prompts[selected].text = parsed.shots.join("\n\n") || reviewText;
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
      renderModes();
      renderSourceToggle();
      renderImageRow();
      renderAll();
      if (!systemPrompt) loadSystemPrompt();
      refreshOllama();
      refreshSetsList();
      setTimeout(() => editor.focus(), 60);
    },
    hide,
    syncCommon() {
      headerTA.value = state.promptHeader || "";
      footerTA.value = state.promptFooter || "";
      refreshPreviewTag();
    },
  };
}
