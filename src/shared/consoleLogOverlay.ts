// consoleLogOverlay.ts — ComfyUI 서버 콘솔 로그 뷰어 오버레이. topbar 우측 "🖥 Console" 버튼으로 연다.
import { C } from "../identity";
import { el } from "./ui";
import { getLogHistory, subscribeLiveLogs, stripAnsi, type LogEntry } from "./consoleLog";

const SIZE_LS_KEY = "aos_console_popup_size";
function loadSavedSize(): { w: number; h: number } | null {
  try {
    const s = JSON.parse(localStorage.getItem(SIZE_LS_KEY) || "null");
    return s && s.w > 0 && s.h > 0 ? s : null;
  } catch {
    return null;
  }
}
function saveSize(w: number, h: number) {
  try { localStorage.setItem(SIZE_LS_KEY, JSON.stringify({ w, h })); } catch {}
}

export function createConsoleLogOverlay() {
  // 전체화면 대신 가운데 뜨는 팝업 창 — Settings/Gallery 등 다른 오버레이와 달리 이건
  // 도구 화면 위가 아니라 topbar에서 아무 페이지에서나 열리므로, 뒤 배경(현재 도구 화면)이
  // 옅게 보이는 편이 "지금 뭘 보고 있었는지" 감이 유지돼서 낫다.
  const ov = el("div", {
    style: {
      position: "fixed", inset: "0", zIndex: "100001",
      background: "rgba(0,0,0,0.55)", display: "none",
      alignItems: "center", justifyContent: "center",
    },
  });

  // 사용자가 우하단 모서리를 드래그해 크기를 바꿀 수 있게(네이티브 CSS resize) 하고,
  // 바꾼 크기는 localStorage에 저장해서 다음에 열 때도 그대로 유지한다.
  const saved = loadSavedSize();
  const box = el("div", {
    style: {
      display: "flex", flexDirection: "column", gap: "8px",
      width: saved ? `${saved.w}px` : "min(1200px, 92vw)",
      height: saved ? `${saved.h}px` : "min(640px, 82vh)",
      minWidth: "420px", minHeight: "260px", maxWidth: "96vw", maxHeight: "92vh",
      resize: "both", overflow: "hidden",
      background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px",
      boxShadow: "0 10px 40px rgba(0,0,0,0.5)", padding: "14px", boxSizing: "border-box",
    },
  });
  ov.appendChild(box);

  const sizeObserver = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (width > 0 && height > 0) saveSize(Math.round(box.offsetWidth), Math.round(box.offsetHeight));
  });
  sizeObserver.observe(box);

  const hdr = el("div", { style: { display: "flex", alignItems: "center", gap: "10px", flexShrink: "0" } });
  hdr.appendChild(el("div", { text: "🖥 ComfyUI Console", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }));
  const autoscrollChk = el("input", { type: "checkbox" }) as HTMLInputElement;
  autoscrollChk.checked = true;
  const autoscrollLbl = el("label", { style: { display: "flex", alignItems: "center", gap: "5px", color: C.muted, fontSize: "11px", cursor: "pointer" } }, [autoscrollChk, el("span", { text: "auto-scroll" })]);
  const clearBtn = el("button", { type: "button", text: "Clear", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "5px 10px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` } });
  const closeBtn = el("button", { type: "button", text: "✕ Close", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "5px 10px", borderRadius: "6px", background: "#c0392b", color: "#fff", border: "none", fontWeight: "700" } });
  hdr.append(autoscrollLbl, clearBtn, closeBtn);

  const body = el("pre", {
    style: {
      flex: "1", minHeight: "0", margin: "0", overflowY: "auto",
      background: "#0a0a0a", border: `1px solid ${C.border}`, borderRadius: "8px",
      padding: "10px 12px", color: "#c8f0c8", fontSize: "11px", lineHeight: "1.5",
      fontFamily: "'Cascadia Code','Consolas',monospace", whiteSpace: "pre-wrap", wordBreak: "break-all",
    },
  });

  box.append(hdr, body);

  function render(entries: LogEntry[]) {
    for (const en of entries) {
      body.appendChild(document.createTextNode(`${en.t.slice(11, 19)}  ${stripAnsi(en.m)}`));
    }
    if (autoscrollChk.checked) body.scrollTop = body.scrollHeight;
  }

  clearBtn.addEventListener("click", () => { body.textContent = ""; });
  closeBtn.addEventListener("click", () => hide());
  ov.addEventListener("click", (e) => { if (e.target === ov) hide(); });

  let unsubscribe: (() => void) | null = null;
  let loaded = false;

  function hide() {
    ov.style.display = "none";
    unsubscribe?.();
    unsubscribe = null;
  }

  return {
    el: ov,
    show() {
      ov.style.display = "flex";
      if (!loaded) {
        loaded = true;
        getLogHistory().then((entries) => render(entries));
      }
      if (!unsubscribe) unsubscribe = subscribeLiveLogs((entries) => render(entries));
    },
    hide,
  };
}
