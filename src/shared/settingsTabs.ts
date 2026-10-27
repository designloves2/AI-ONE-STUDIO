// settingsTabs.ts — Model / LLM / Translation tabs for the image tools' settings overlay.
// Port of ComfyUI-TJ_NODE_STUDIO_ONE/web/shared/settings_tabs.js (node v1.49.2).
//
// The overlays were one long scroll (the model pickers and every other option). Call this once, after the overlay is fully
// built: everything except the header row goes into the "Model" tab, the shared LLM settings (Prompt Write / Prompt Enhance)
// go into the "LLM" tab, and the "Translation" tab is the shared Korean <-> English model setting (the same one every
// tool uses). The first child of `ov` is the header row.
import { mountLLMSettingsSection } from "./llmSettingsSection";
import { translationSettingsPanel } from "./translationSettings";

export function tabSettings(ov: HTMLElement, { brand, bg, border, nodeKey = "", openLlm = false }: { brand: string; bg: string; border: string; nodeKey?: string; openLlm?: boolean }) {
  const header = ov.firstElementChild;
  const modelBox = document.createElement("div");
  const llmBox = document.createElement("div");
  const translationBox = document.createElement("div");
  for (const box of [modelBox, llmBox, translationBox]) Object.assign(box.style, { display: "flex", flexDirection: "column", gap: "8px", flexShrink: "0" });
  [...ov.children].filter((c) => c !== header).forEach((c) => modelBox.appendChild(c));
  mountLLMSettingsSection(llmBox);
  translationBox.appendChild(translationSettingsPanel({ brand, bg, border }, nodeKey));

  const bar = document.createElement("div");
  Object.assign(bar.style, { display: "flex", gap: "6px", flexShrink: "0" });
  const tabs: Record<string, HTMLElement> = { Model: modelBox, LLM: llmBox, Translation: translationBox };
  const buttons: Record<string, HTMLButtonElement> = {};
  function show(name: string) {
    for (const [n, box] of Object.entries(tabs)) {
      const active = n === name;
      box.style.display = active ? "flex" : "none";
      Object.assign(buttons[n].style, { fontWeight: active ? "700" : "400", background: active ? brand : bg, borderColor: active ? brand : border });
    }
  }
  for (const name of Object.keys(tabs)) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = name;
    Object.assign(b.style, { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "6px 14px", borderRadius: "6px", color: "#fff", border: "1px solid" });
    b.addEventListener("click", () => show(name));
    buttons[name] = b; bar.appendChild(b);
  }
  ov.append(bar, modelBox, llmBox, translationBox);
  show(openLlm ? "LLM" : "Model");
  return { show };
}
