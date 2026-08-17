// commonPromptOverlay.ts — 헤더/테일만 큰 화면으로 빠르게 편집 (원본: web/minimax/ui_common_prompt_minimax.js)
// Prompt Edit 안에도 같은 필드가 작게 있지만, 이 오버레이는 topbar에서 바로 열리는
// 전용 큰 화면판 — 원본과 같은 state를 읽고 쓰므로 둘은 항상 동기화된다.
import type { MinimaxState } from "./core";
import { composeClipPrompt } from "./core";
import { button, el } from "../../shared/ui";
import { C, BRAND } from "../../identity";

export interface CommonPromptCtx {
  persist: () => void;
}

export interface CommonPromptHandle {
  el: HTMLElement;
  show(): void;
  hide(): void;
  isOpen(): boolean;
}

export function createCommonPromptOverlay(state: MinimaxState, ctx: CommonPromptCtx, onApply?: () => void): CommonPromptHandle {
  const ov = el("div", {
    class: "fixed inset-0 z-[9999] flex-col p-3 gap-2 box-border",
    style: { display: "none", background: "rgba(11,11,11,0.985)" },
  });

  const hdr = el("div", { class: "flex items-center gap-2 shrink-0" });
  hdr.appendChild(el("div", { text: "🧩 Common Prompt", class: "text-white text-sm font-bold" }));
  hdr.appendChild(el("div", { text: "sent with every clip", class: "text-[10.5px] flex-1", style: { color: C.muted } }));
  hdr.appendChild(button("✕ Close", () => hide(), "danger"));

  function field(titleText: string, hintHTML: string, get: () => string, set: (v: string) => void) {
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
    wrap.append(head, ta);
    return { wrap, ta };
  }

  const headerF = field("HEADER — style & opening", "visual style, grade, lens, opening composition", () => state.promptHeader, (v) => (state.promptHeader = v));
  const footerF = field("TAIL — sound & music", "<code>Ambient sound:</code> … / <code>Music:</code> …", () => state.promptFooter, (v) => (state.promptFooter = v));

  const body = el("div", { class: "flex-1 flex gap-2.5 min-h-0 flex-col md:flex-row" });
  body.append(headerF.wrap, footerF.wrap);

  const foot = el("div", { class: "flex items-center gap-2 shrink-0" });
  const tag = el("div", { class: "text-[10.5px] flex-1", style: { color: C.muted } });
  const clearBtn = el("button", { type: "button", text: "Clear both", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "6px 12px", borderRadius: "6px", background: C.bg2, color: C.muted, border: `1px solid ${C.border}` } });
  clearBtn.addEventListener("click", () => {
    state.promptHeader = "";
    state.promptFooter = "";
    headerF.ta.value = "";
    footerF.ta.value = "";
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

  ov.append(hdr, body, foot);
  return {
    el: ov,
    show() {
      headerF.ta.value = state.promptHeader || "";
      footerF.ta.value = state.promptFooter || "";
      refreshTag();
      ov.style.display = "flex";
      setTimeout(() => headerF.ta.focus(), 50);
    },
    hide,
    isOpen: () => ov.style.display !== "none",
  };
}
