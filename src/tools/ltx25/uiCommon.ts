// uiCommon.ts — the node's klein/ui_common.js helpers as the ported LTX 2.5 files expect them: the web's own widgets, but with
// the node's `row` (no wrapping: the Generate / Stop buttons must stay on one line).
import { el } from "../../shared/ui";
export { panel, label, button, select, numberField, col, modeBar, iconBtn } from "../../shared/ui";

export function row(children: (Node | null | undefined)[], gap = "6px") {
  return el("div", { style: { display: "flex", gap, alignItems: "flex-start" } }, children);
}
