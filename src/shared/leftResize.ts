// leftResize.ts — drag handle between a tool's left settings column and the work area; the same on every tool.
// ONE width is shared by every tool (localStorage `aos_left_w`): whatever the user set last applies on all of them.
// Below `minViewport` (phone / stacked layouts) the handle is hidden and the tool's CSS width applies, untouched.
import { C, BRAND } from "../identity";

export const LEFT_W_KEY = "aos_left_w";
const MIN_W = 300;
const MAX_W = 900;

export interface LeftResizeOpts {
  /** Viewport width from which the tool shows its side-by-side layout. */
  minViewport: number;
  /** The flex gap (px) between the left column and the next element — the handle sits in that gap. */
  gap: number;
}

/** Call after `leftEl` is appended to its flex-row parent; the handle is inserted right after it. */
export function attachLeftResize(leftEl: HTMLElement, o: LeftResizeOpts) {
  const parent = leftEl.parentElement;
  if (!parent) return;
  const storeKey = LEFT_W_KEY;
  const stored = () => { try { return Number(localStorage.getItem(storeKey)) || 0; } catch { return 0; } };
  const clamp = (w: number) => Math.max(MIN_W, Math.min(MAX_W, w));
  const save = (w: number) => { try { localStorage.setItem(storeKey, String(w)); } catch { /* ignore */ } };

  const bar = document.createElement("div");
  bar.style.cssText = `width:3px;height:34px;border-radius:2px;background:${C.border};pointer-events:none`;
  const handle = document.createElement("div");
  handle.title = "Drag to resize the settings column";
  // negative side margins cancel the two flex gaps the handle would otherwise add
  handle.style.cssText = `flex:0 0 ${o.gap}px;width:${o.gap}px;margin:0 -${o.gap}px;align-self:stretch;cursor:col-resize;display:flex;align-items:center;justify-content:center;z-index:5;touch-action:none`;
  handle.appendChild(bar);
  leftEl.after(handle);
  handle.addEventListener("mouseenter", () => (bar.style.background = BRAND));
  handle.addEventListener("mouseleave", () => (bar.style.background = C.border));

  const apply = (w: number | null) => {
    // max-width keeps room for the work area on narrow windows; it is CSS, so it needs no layout at render time
    if (w) { leftEl.style.setProperty("width", `${w}px`, "important"); leftEl.style.setProperty("max-width", "calc(100% - 360px)", "important"); }
    else { leftEl.style.removeProperty("width"); leftEl.style.removeProperty("max-width"); }
  };

  const mq = window.matchMedia(`(min-width: ${o.minViewport}px)`);
  const sync = () => {
    handle.style.display = mq.matches ? "flex" : "none";
    apply(mq.matches && stored() ? clamp(stored()) : null);
  };
  mq.addEventListener("change", sync);
  sync();

  handle.addEventListener("pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = leftEl.getBoundingClientRect().width;
    let w = w0;
    const move = (ev: PointerEvent) => { w = Math.round(clamp(w0 + ev.clientX - x0)); apply(w); save(w); };
    const up = (ev: PointerEvent) => {
      try { handle.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      save(w);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
}
