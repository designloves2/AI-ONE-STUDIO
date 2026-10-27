// commonPromptOverlay.ts — 헤더/테일만 큰 화면으로 빠르게 편집 (원본: web/minimax/ui_common_prompt_minimax.js)
// Prompt Edit 안에도 같은 필드가 작게 있지만, 이 오버레이는 topbar에서 바로 열리는
// 전용 큰 화면판 — 원본과 같은 state를 읽고 쓰므로 둘은 항상 동기화된다.
import type { MinimaxState } from "./core";
import { composeClipPrompt, h3ProtectWords } from "./core";
import { attachBilingual } from "../../shared/bilingualUi";
import { fieldSetBoth } from "../../shared/bilingual";
import { button, el } from "../../shared/ui";
import { C, BRAND } from "../../identity";

export interface CommonPromptCtx {
  persist: () => void;
  showPopup?: (msg: string, isError?: boolean) => void;
}

export interface CommonPromptHandle {
  el: HTMLElement;
  show(): void;
  hide(): void;
  isOpen(): boolean;
}

export function createCommonPromptOverlay(state: MinimaxState, ctx: CommonPromptCtx, onApply?: () => void): CommonPromptHandle {
  // A popup over a dimmed backdrop, not the whole screen (node 064229d).
  const ov = el("div", {
    class: "fixed inset-0 z-[9999] box-border",
    style: { display: "none", background: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  });
  const panelBox = el("div", { style: {
    width: "min(900px, 94%)", height: "min(430px, 80%)", display: "flex", flexDirection: "column", gap: "8px",
    padding: "12px", boxSizing: "border-box", background: "rgba(11,11,11,0.985)",
    border: `1px solid ${BRAND}`, borderRadius: "10px", boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
  } });

  const hdr = el("div", { class: "flex items-center gap-2 shrink-0" });
  hdr.appendChild(el("div", { text: "🧩 Common Prompt", class: "text-white text-sm font-bold" }));
  hdr.appendChild(el("div", { text: "sent with every clip", class: "text-[10.5px] flex-1", style: { color: C.muted } }));
  hdr.appendChild(button("✕ Close", () => hide(), "danger"));

  function field(titleText: string, hintHTML: string, get: () => string, set: (v: string) => void, key: string) {
    const wrap = el("div", { class: "flex-1 flex flex-col gap-1 min-h-0" });
    const head = el("div", { class: "flex items-center gap-1.5" });
    head.append(
      el("div", { text: titleText, class: "text-[11px] font-bold tracking-wide", style: { color: BRAND } }),
      el("div", { html: hintHTML, class: "text-[10px] flex-1", style: { color: C.muted } })
    );
    const ta = el("textarea", {
      style: { flex: "1", minHeight: "0", boxSizing: "border-box", background: C.bg1, color: C.text, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "11px", fontSize: "12.5px", lineHeight: "1.6", fontFamily: "inherit", outline: "none", resize: "none" },
    }) as HTMLTextAreaElement;
    ta.value = get() || "";
    ta.addEventListener("input", () => { set(ta.value); ctx.persist(); refreshTag(); });
    ta.addEventListener("focus", () => (ta.style.borderColor = BRAND));
    ta.addEventListener("blur", () => (ta.style.borderColor = C.border));
    // KO / EN button: the English text is what the model gets, the Korean one is its view
    const bil = attachBilingual(ta, { target: () => state, key, persist: () => ctx.persist(), protect: () => h3ProtectWords(state), onError: (m) => ctx.showPopup?.(m, true) });
    wrap.append(head, bil.el);
    return { wrap, ta, bil };
  }

  const headerF = field("HEADER — style & opening", "visual style, grade, lens, opening composition", () => state.promptHeader, (v) => (state.promptHeader = v), "promptHeader");
  const footerF = field("TAIL — sound & music", "<code>Ambient sound:</code> … / <code>Music:</code> …", () => state.promptFooter, (v) => (state.promptFooter = v), "promptFooter");

  const body = el("div", { class: "flex-1 flex gap-2.5 min-h-0 flex-col md:flex-row" });
  body.append(headerF.wrap, footerF.wrap);

  const foot = el("div", { class: "flex items-center gap-2 shrink-0" });
  const tag = el("div", { class: "text-[10.5px] flex-1", style: { color: C.muted } });
  const clearBtn = el("button", { type: "button", text: "Clear both", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "6px 12px", borderRadius: "6px", background: C.bg2, color: C.muted, border: `1px solid ${C.border}` } });
  clearBtn.addEventListener("click", () => {
    fieldSetBoth(state, "promptHeader", "", ""); fieldSetBoth(state, "promptFooter", "", "");
    headerF.bil.refresh(); footerF.bil.refresh();
    ctx.persist();
    refreshTag();
    onApply?.();
  });
  foot.append(clearBtn, tag, button("✓ Done", () => hide(), "primary"));

  function refreshTag() {
    const h = (state.promptHeader || "").length,
      f = (state.promptFooter || "").length;
    const full = composeClipPrompt(state, 0).length;
    tag.textContent = `header ${h} + tail ${f} chars · clip 1 sends ${full} chars in total`;
  }

  function hide() {
    ov.style.display = "none";
    onApply?.();
  }

  panelBox.append(hdr, body, foot);
  ov.append(panelBox);
  return {
    el: ov,
    show() {
      headerF.bil.refresh(); footerF.bil.refresh();
      refreshTag();
      ov.style.display = "flex";
      setTimeout(() => headerF.ta.focus(), 50);
    },
    hide,
    isOpen: () => ov.style.display !== "none",
  };
}
