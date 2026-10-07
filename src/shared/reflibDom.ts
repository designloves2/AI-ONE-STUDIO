// @ts-nocheck — 1:1 port of the node's web/shared/reflib_dom.js (SPEC_MINIMAX_H3_ASSET_PORT.md). Kept loosely typed on
// purpose so the behaviour stays byte-for-byte what the node ships; only imports / base URL / colours differ.
// reflib_dom.js — tiny DOM helpers for the asset library screens. Props go on as properties
// (value / selected / controls need that, not attributes); children are variadic.
import { C as WebC, BRAND } from "../identity";
// The node's palette calls the accent colour `lime`; the web identity names the same value BRAND.
export const C = { ...WebC, lime: BRAND };

// ── Web-only phone layout (<=767px) for every asset-library screen. Labels / behaviour are the node's; only sizes,
// wrapping and arrangement change here (touch-size controls, combo-box categories, 16px inputs so iOS does not zoom).
const MOBILE_CSS = `@media (max-width: 767px) {
  .rl-root button, .rl-root select { min-height: 40px; }
  .rl-root input[type=text], .rl-root input[type=number], .rl-root select { min-height: 40px; font-size: 16px !important; }
  .rl-root input[type=range] { min-height: 32px; }
  .rl-menu-item { padding: 13px 18px !important; }
  .rl-bar { flex-wrap: wrap !important; }
  .rl-bar input[type=text] { width: 100% !important; flex: 1 1 100% !important; }
  .rl-gi-grid { grid-template-columns: repeat(3, 1fr) !important; }
}`;
if (typeof document !== "undefined" && !document.getElementById("aos-reflib-mobile-css")) {
  const st = document.createElement("style"); st.id = "aos-reflib-mobile-css"; st.textContent = MOBILE_CSS; document.head.append(st);
}

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
