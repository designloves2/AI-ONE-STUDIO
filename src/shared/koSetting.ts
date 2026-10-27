// koSetting.ts — "Use Korean translation": one on / off choice per tool, kept in this browser.
// Port of ComfyUI-TJ_NODE_STUDIO_ONE/web/shared/ko_setting.js (node v1.49.2).
// Off = no AUTOMATIC translation (before Generate, the Korean view after Write / Refine, the Korean side of the Refine
// result); the EN / 한 button still translates when it is pressed. A tool marks its root element with
// data-tj-node="<key>" so shared code (the Prompt Edit popup) can find which tool it is in.
const KEY = (node: string) => `tj_use_ko_${node}`;

export function getUseKo(node: string): boolean {
  try { return localStorage.getItem(KEY(node)) !== "0"; } catch { return true; }
}

export function setUseKo(node: string, on: boolean) {
  try { localStorage.setItem(KEY(node), on ? "1" : "0"); } catch { /* private window: the choice just isn't remembered */ }
  window.dispatchEvent(new Event("tj-use-ko"));
}

export const nodeKeyOf = (el: Element | null | undefined): string => (el?.closest?.("[data-tj-node]") as HTMLElement | null)?.dataset.tjNode || "";

/** Is Korean on for the tool that contains `el`? (true when `el` is not inside a marked tool) */
export function useKoFor(el: Element | null | undefined): boolean {
  const node = nodeKeyOf(el);
  return node ? getUseKo(node) : true;
}

/** The settings checkbox. */
export function useKoCheckbox(node: string, { text = "#dedede", muted = "#8a8a8a" } = {}): HTMLElement {
  const label = document.createElement("label");
  Object.assign(label.style, { display: "flex", alignItems: "center", gap: "6px", color: text, fontSize: "12px", cursor: "pointer" });
  const chk = document.createElement("input");
  chk.type = "checkbox"; chk.checked = getUseKo(node);
  chk.addEventListener("change", () => setUseKo(node, chk.checked));
  const note = document.createElement("span");
  note.textContent = "한글 번역 사용";
  const hint = document.createElement("span");
  hint.textContent = "— 끄면 자동 번역(생성 전 번역, Write/Refine 뒤 한국어 채우기, Refine 결과 번역)이 꺼지고 EN/한 버튼을 직접 누를 때만 한 번 번역합니다. 이 노드에만 적용됩니다.";
  Object.assign(hint.style, { color: muted, fontSize: "10px" });
  label.append(chk, note, hint);
  return label;
}
