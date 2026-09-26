// settings.ts — ITDA ONE STUDIO App Settings panel (system-level, not per-project).
// 원본 근거: web/one_node_itda_studio.js `openAppSettingsModal()` — a single SMALL popup modal
// (api.showModal, same #modal chrome ITDA's own Project Library/Load Project use). Node also
// mounts a shared LLM Backend section here (mountLLMSettingsSection) purely because that
// component is shared verbatim across every ONE STUDIO tool's App Settings — but grepping every
// ITDA source file (itda_app_ported.js / dom_build.js / one_node_itda_studio.js / the backend)
// turns up zero actual LLM calls anywhere in ITDA: Auto Stitch and Scene+Beat Detect are backend
// audio/video signal-processing, not LLM prompt-writing. User: "잇다에서는... LLM기능 설정은
// 빼야지" — intentionally deviates from the node here and drops that dead section rather than
// mirroring it, since ITDA never reads or uses that config.
import { el, panel, row, label } from "../../shared/ui";
import { C, BRAND } from "../../identity";
import { getAppSettings, saveAppSettings } from "./api";

export interface SettingsHandle {
  el: HTMLElement;
  show(): void;
  hide(): void;
}

export function createItdaSettingsOverlay(): SettingsHandle {
  // Small centered modal card — matches ITDA's own Project Library / Load Project chrome
  // (view.ts's smallModal helper) and the node's #modal popup, instead of a fullscreen
  // takeover: "왜 App Settings는 전체창으로 나오지??? 팝업이 아니고?"
  const card = el("div", {
    style: {
      background: "#16171d",
      border: `1px solid ${C.border}`,
      borderRadius: "10px",
      padding: "16px",
      width: "min(480px, 92vw)",
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
  card.appendChild(body);

  function saveAllBtnEl() {
    const btn = el("button", {
      text: "Apply",
      style: { background: BRAND, color: "#111", border: "none", borderRadius: "6px", padding: "5px 12px", fontSize: "12px", fontWeight: "700", cursor: "pointer" },
      onclick: async () => {
        btn.textContent = "Saving…";
        try {
          await saveAppSettings({ gallery_dir: galleryDirInput.value.trim() });
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
