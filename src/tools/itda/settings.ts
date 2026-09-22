// settings.ts — ITDA ONE STUDIO App Settings panel (system-level, not per-project).
// 원본 근거: web/one_node_itda_studio.js `openAppSettingsModal()` — a single small modal with
// just Gallery Path + the shared LLM backend/model section (mountLLMSettingsSection), reusing
// the node's own modal chrome rather than a second, visually-inconsistent overlay. This is
// NOT the sprawling multi-tab Settings pattern MiniMax H3 uses (src/tools/minimax_h3/settings.ts)
// — ITDA's own node keeps App Settings deliberately minimal, and this mirrors that scope
// exactly rather than over-building it.
import { el, panel, row, label } from "../../shared/ui";
import { C, BRAND } from "../../identity";
import { createLlmBackendGroup, fetchOrModels, fetchLlmKeyHint, type LlmBackendState } from "../../shared/llmBackendPanel";
import { getAppSettings, saveAppSettings } from "./api";

// System-wide (not per-project) — separate localStorage key from any per-project ItdaState.
// Only the backend/model *choice* lives here; the OpenRouter key itself is never stored
// client-side (llmBackendPanel.ts pushes it straight to the server .env on blur).
const LS_KEY = "aos_itda_llm_settings_v1";

interface ItdaLlmState extends LlmBackendState {}

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

export interface SettingsHandle {
  el: HTMLElement;
  show(): void;
  hide(): void;
}

export function createItdaSettingsOverlay(): SettingsHandle {
  const llmState = loadLlmState();
  const persistLlm = () => saveLlmState(llmState);
  const llmGroup = createLlmBackendGroup(llmState, persistLlm);

  const ov = el("div", {
    style: {
      display: "none",
      position: "fixed",
      inset: "0",
      zIndex: "9998",
      background: "rgba(11,11,11,0.97)",
      flexDirection: "column",
      padding: "14px",
      gap: "10px",
      boxSizing: "border-box",
      overflowY: "auto",
    },
  });

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
  ov.appendChild(topRow);

  // Gallery Path — where ⏺ Render / 🖼 Gallery store/read rendered timelines. Blank = default
  // location (server-side: output/one_itda_studio_gallery, shared with MiniMax H3's own gallery
  // folder — see paths.py's gallery_dir()).
  const galleryDirInput = el("input", {
    type: "text",
    placeholder: "(default: ComfyUI/output/one_itda_studio_gallery)",
    style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px 8px", fontSize: "12px" },
  }) as HTMLInputElement;

  const body = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px", maxWidth: "560px" } });
  body.appendChild(
    panel([
      label("Gallery Path"),
      galleryDirInput,
      el("div", { text: "Where \"⏺ Render\" and \"🖼 Gallery\" store/read rendered timelines. Leave blank for the default location.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
    ])
  );

  // LLM backend/model — same shared cross-tool config every image ONE STUDIO node's Prompt Edit
  // popup and MiniMax H3's Settings already read (server .env). ITDA has no per-role
  // text/vision split of its own (it doesn't run a Brief/Vision LLM pass) — one generic block.
  const llmHost = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } });
  const llmBlock = llmGroup.makeBlock("text");
  llmHost.appendChild(llmBlock.el);
  body.appendChild(panel([label("LLM Backend"), llmHost]));
  ov.appendChild(body);

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
