// @ts-nocheck — 1:1 port of the node's web/shared/reflib_dom.js (SPEC_MINIMAX_H3_ASSET_PORT.md). Kept loosely typed on
// purpose so the behaviour stays byte-for-byte what the node ships; only imports / base URL / colours differ.
// reflib_dom.js — tiny DOM helpers for the asset library screens. Props go on as properties
// (value / selected / controls need that, not attributes); children are variadic.
import { C as WebC, BRAND } from "../identity";
// The node's palette calls the accent colour `lime`; the web identity names the same value BRAND.
export const C = { ...WebC, lime: BRAND };

export function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in props) {
    if (k === "style") Object.assign(e.style, props.style);
    else if (k === "text") e.textContent = props.text;
    else e[k] = props[k];
  }
  kids.flat().forEach(c => c != null && e.append(c));
  return e;
}

export function btn(text, onClick, extra = {}) {
  const b = el("button", { type: "button", text, style: {
    cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "6px 12px", borderRadius: "6px",
    background: C.bg2, color: C.text, border: `1px solid ${C.border}`, ...extra,
  }});
  b.addEventListener("click", onClick);
  return b;
}

export const fieldStyle = {
  width: "100%", boxSizing: "border-box", background: C.bg1, color: C.text, border: `1px solid ${C.border}`,
  borderRadius: "6px", padding: "5px 7px", fontSize: "12px", fontFamily: "inherit",
};
