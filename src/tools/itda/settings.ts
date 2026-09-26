// settings.ts — ITDA ONE STUDIO App Settings panel (system-level, not per-project).
// 원본 근거: web/one_node_itda_studio.js `openAppSettingsModal()` — a single SMALL popup modal
// (api.showModal, same #modal chrome ITDA's own Project Library/Load Project use) with just
// Gallery Path + the shared LLM backend/model section (mountLLMSettingsSection). This is NOT
// the sprawling multi-tab Settings pattern MiniMax H3 uses (src/tools/minimax_h3/settings.ts)
// — ITDA's own node keeps App Settings deliberately minimal, and this mirrors that scope
// exactly rather than over-building it.
import { el, panel, row, label } from "../../shared/ui";
import { C, BRAND } from "../../identity";
import { createLlmBackendGroup, fetchOrModels, fetchLlmKeyHint, type LlmBackendState } from "../../shared/llmBackendPanel";
import { getComfyBase } from "../../shared/comfyBase";
import { getAppSettings, saveAppSettings } from "./api";

// System-wide (not per-project) — separate localStorage key from any per-project ItdaState.
// Only the backend/model *choice* lives here; the OpenRouter key itself is never stored
// client-side (llmBackendPanel.ts pushes it straight to the server .env on blur).
const LS_KEY = "aos_itda_llm_settings_v1";

interface ItdaLlmState extends LlmBackendState {
  gguf_model?: string;
  mmproj_file?: string;
}

function loadLlmState(): ItdaLlmState {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveLlmState(s: ItdaLlmState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
}

function ggufSelect(options: string[], value: string, onChange: (v: string) => void) {
  const s = el("select", { style: { background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "4px 6px", fontSize: "11px", width: "100%" } }) as HTMLSelectElement;
  options.forEach((o) => s.appendChild(el("option", { value: o, text: o, ...(o === value ? { selected: "selected" } : {}) })));
  s.addEventListener("change", () => onChange(s.value));
  return s;
}
function fieldRow(labelText: string, control: HTMLElement) {
  const wrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "2px" } });
  wrap.append(el("div", { text: labelText, style: { color: C.muted, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.04em" } }), control);
  return wrap;
}

export interface SettingsHandle {
  el: HTMLElement;
  show(): void;
  hide(): void;
}

export function createItdaSettingsOverlay(): SettingsHandle {
  const llmState = loadLlmState();
  const persistLlm = () => saveLlmState(llmState);
  const llmGroup = createLlmBackendGroup(llmState, persistLlm);

  // Small centered modal card — matches ITDA's own Project Library / Load Project chrome
  // (view.ts's smallModal helper) and the node's #modal popup, instead of a fullscreen
  // takeover: "왜 App Settings는 전체창으로 나오지??? 팝업이 아니고?"
  const card = el("div", {
    style: {
      background: "#16171d",
      border: `1px solid ${C.border}`,
      borderRadius: "10px",
      padding: "16px",
      width: "min(560px, 92vw)",
      maxHeight: "86vh",
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      boxSizing: "border-box",
    },
  });

  const ov = el("div", {
    style: {
      display: "none",
      position: "fixed",
      inset: "0",
      zIndex: "9998",
      background: "rgba(0,0,0,0.55)",
      alignItems: "center",
      justifyContent: "center",
    },
  }, [card]);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.style.display = "none"; });

  const topRow = row([
    el("div", { text: "⚙ App Settings — ITDA ONE STUDIO (TJ)", style: { color: C.text, fontSize: "14px", fontWeight: "700", flex: "1" } }),
    saveAllBtnEl(),
    el("button", {
      text: "✕",
      onclick: () => (ov.style.display = "none"),
      style: { background: C.bg1, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "5px 10px", cursor: "pointer" },
    }),
  ]);
  topRow.style.alignItems = "center";
  card.appendChild(topRow);

  // Gallery Path — where ⏺ Render / 🖼 Gallery store/read rendered timelines. Blank = default
  // location (server-side: output/one_itda_studio_gallery, shared with MiniMax H3's own gallery
  // folder — see paths.py's gallery_dir()).
  const galleryDirInput = el("input", {
    type: "text",
    placeholder: "(default: ComfyUI/output/one_itda_studio_gallery)",
    style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px 8px", fontSize: "12px" },
  }) as HTMLInputElement;

  const body = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } });
  body.appendChild(
    panel([
      label("Gallery Path"),
      galleryDirInput,
      el("div", { text: "Where \"⏺ Render\" and \"🖼 Gallery\" store/read rendered timelines. Leave blank for the default location.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
    ])
  );

  // LLM backend/model — same shared cross-tool config every image ONE STUDIO node's Prompt Edit
  // popup and MiniMax H3's Settings already read (server .env). Node's mountLLMSettingsSection
  // always mounts BOTH roles unconditionally (llm_panel.js: enhBlock="Prompt Enhance"/text,
  // i2pBlock="Image → Prompt Write"/vision) regardless of whether the calling tool itself runs
  // a vision pass — it's one shared global LLM config surface, not a per-tool filtered one.
  // ITDA's settings.ts previously only built the text block ("no per-role split of its own"),
  // which is why the vision role's "Image → Prompt Write" section — and its mmproj picker —
  // never showed up at all: "gguf에서 mmproj선택은?"
  const llmHost = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } });

  function roleHeader(text: string) {
    return el("div", { text, style: { color: C.text, fontSize: "11px", fontWeight: "700" } });
  }

  // "Local GGUF" backend had no model picker at all — llmBackendPanel.ts's shared block
  // deliberately leaves `localOnly` for the caller to fill (per its own interface comment),
  // same as every other tool's promptTools.ts (e.g. krea2/promptTools.ts's ggufSelE/rowGgufE).
  // gguf_model is ONE shared field across both roles (node's llm.gguf_model), so each role gets
  // its own <select> element but both write into the same state field and stay mirrored.
  let ggufSelText!: HTMLSelectElement, ggufSelVision!: HTMLSelectElement;
  function makeGgufSel(mirror: () => HTMLSelectElement) {
    return ggufSelect([llmState.gguf_model || "Loading…"], llmState.gguf_model || "", (v) => {
      llmState.gguf_model = v;
      persistLlm();
      mirror().value = v;
    });
  }
  ggufSelText = makeGgufSel(() => ggufSelVision);
  ggufSelVision = makeGgufSel(() => ggufSelText);

  const textBlock = llmGroup.makeBlock("text");
  const rowGgufText = fieldRow("GGUF Model", ggufSelText);
  textBlock.localOnly.push(rowGgufText);
  textBlock.el.insertBefore(rowGgufText, textBlock.el.firstChild!.nextSibling);
  textBlock.syncFromState();
  llmHost.appendChild(roleHeader("Prompt Enhance"));
  llmHost.appendChild(textBlock.el);

  const mmprojSel = ggufSelect([llmState.mmproj_file || "none"], llmState.mmproj_file || "none", (v) => {
    llmState.mmproj_file = v;
    persistLlm();
  });
  const visionBlock = llmGroup.makeBlock("vision");
  const rowGgufVision = fieldRow("GGUF Model", ggufSelVision);
  const rowMmproj = fieldRow("mmproj", mmprojSel);
  visionBlock.localOnly.push(rowGgufVision, rowMmproj);
  visionBlock.el.insertBefore(rowMmproj, visionBlock.el.firstChild!.nextSibling);
  visionBlock.el.insertBefore(rowGgufVision, visionBlock.el.firstChild!.nextSibling);
  visionBlock.syncFromState();
  llmHost.appendChild(roleHeader("Image → Prompt Write"));
  llmHost.appendChild(visionBlock.el);

  body.appendChild(panel([label("LLM Backend"), llmHost]));
  card.appendChild(body);

  function saveAllBtnEl() {
    const btn = el("button", {
      text: "Apply",
      style: { background: BRAND, color: "#111", border: "none", borderRadius: "6px", padding: "5px 12px", fontSize: "12px", fontWeight: "700", cursor: "pointer" },
      onclick: async () => {
        btn.textContent = "Saving…";
        try {
          await saveAppSettings({ gallery_dir: galleryDirInput.value.trim() });
          persistLlm();
          btn.textContent = "✓ Applied";
        } catch {
          btn.textContent = "Failed";
        }
        setTimeout(() => (btn.textContent = "Apply"), 1500);
      },
    });
    return btn;
  }

  async function refresh() {
    try {
      const res = await getAppSettings();
      if (res.ok) galleryDirInput.value = res.settings?.gallery_dir || "";
    } catch {}
    try {
      const [models, keyHint] = await Promise.all([fetchOrModels(), fetchLlmKeyHint()]);
      llmGroup.fillAll(models, keyHint);
    } catch {}
    // Same endpoint every promptTools.ts panel already reads for its own GGUF/Text-Encoder
    // pickers (node's `/tj_studio_one/llm/models` — returns gguf/text_encoders/clip_loader_types
    // together). Was never called here, so "ComfyUI Native"'s Text Encoder list stayed stuck on
    // the "Loading…" placeholder forever, and "Local GGUF" had no models to pick from at all.
    try {
      const r = await fetch(`${getComfyBase()}/tj_studio_one/llm/models`, { credentials: "include" });
      const d = await r.json();
      if (!d.ok || d._notInstalled) {
        llmGroup.stripLocal();
      } else {
        if (d.gguf?.length) {
          [ggufSelText, ggufSelVision].forEach((sel) => {
            sel.innerHTML = "";
            d.gguf.forEach((m: string) => sel.appendChild(el("option", { value: m, text: m, ...(m === llmState.gguf_model ? { selected: "selected" } : {}) })));
          });
          if (!llmState.gguf_model && d.gguf[0]) { llmState.gguf_model = d.gguf[0]; persistLlm(); ggufSelText.value = d.gguf[0]; ggufSelVision.value = d.gguf[0]; }
        }
        if (d.mmproj?.length) {
          mmprojSel.innerHTML = "";
          d.mmproj.forEach((m: string) => mmprojSel.appendChild(el("option", { value: m, text: m, ...(m === llmState.mmproj_file ? { selected: "selected" } : {}) })));
        }
        llmGroup.fillTextEncodersAll(d.text_encoders || [], d.clip_loader_types || []);
      }
    } catch {}
    llmGroup.syncAll();
  }

  return {
    el: ov,
    show() {
      ov.style.display = "flex";
      refresh();
    },
    hide() {
      ov.style.display = "none";
    },
  };
}
