// serverRestart.ts — 상단바 우측 끝의 빨간 "⟳" 아이콘 버튼. ComfyUI-Manager의 재시작 API
// (POST /manager/reboot)를 그대로 쏜다 — ComfyUI-Manager 웹 UI의 재시작 버튼과 동일한 방식.
// ComfyUI-Manager가 없으면 이 라우트 자체가 없어서 요청이 실패하고 팝업으로 안내만 한다.
import { comfyFetch } from "./comfySocket";
import { C } from "../identity";
import { el } from "./ui";

// 서버 전체를 죽이는 파괴적 동작이라 shared/ui.ts의 범용 confirmDialog(Enter=확인)를 일부러
// 안 쓴다 — 여기서는 Enter를 아예 아무 버튼에도 연결하지 않아서, 실수로 Enter를 눌러도 절대
// 재시작되지 않고 오직 "Restart Now" 버튼을 직접 클릭해야만 실행된다. 기본 포커스도 Cancel.
function confirmRestart(): Promise<boolean> {
  return new Promise((resolve) => {
    const ov = el("div", { style: { position: "fixed", inset: "0", background: "rgba(0,0,0,0.6)", zIndex: "100002", display: "flex", alignItems: "center", justifyContent: "center" } });
    const box = el("div", { style: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "18px", width: "min(400px, 88vw)", boxShadow: "0 10px 40px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: "14px" } });
    box.appendChild(
      el("div", {
        text: "Restart the ComfyUI server?\n\nAny job currently running or queued will be interrupted. It may take a few seconds to a minute for the server to come back up.",
        style: { color: C.text, fontSize: "13px", lineHeight: "1.5", whiteSpace: "pre-wrap" },
      })
    );
    const btnRow = el("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px" } });
    function finish(v: boolean) {
      document.removeEventListener("keydown", onEsc);
      document.body.removeChild(ov);
      resolve(v);
    }
    // Escape만 취소로 연결 — Enter는 의도적으로 아무 것도 안 함(실수 재시작 방지).
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") finish(false); };
    const cancelBtn = el("button", {
      type: "button", text: "Cancel", onclick: () => finish(false),
      style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12.5px", padding: "7px 16px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` },
    }) as HTMLButtonElement;
    const okBtn = el("button", {
      type: "button", text: "Restart Now", onclick: () => finish(true),
      style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12.5px", padding: "7px 16px", borderRadius: "6px", background: "#c0392b", color: "#fff", border: "none", fontWeight: "700" },
    });
    btnRow.append(cancelBtn, okBtn);
    box.appendChild(btnRow);
    ov.appendChild(box);
    ov.addEventListener("click", (e) => { if (e.target === ov) finish(false); });
    document.addEventListener("keydown", onEsc);
    document.body.appendChild(ov);
    cancelBtn.focus();
  });
}

export function createRestartButton(): HTMLElement {
  const btn = document.createElement("button");
  btn.textContent = "⟳";
  btn.title = "Restart the ComfyUI server (ComfyUI-Manager /manager/reboot)";
  btn.className =
    "shrink-0 h-8 w-8 rounded-md text-base font-bold text-white transition-colors";
  btn.style.background = "#c0392b";
  btn.style.border = "1px solid #a5281b";
  btn.addEventListener("mouseenter", () => (btn.style.background = "#d9483a"));
  btn.addEventListener("mouseleave", () => (btn.style.background = "#c0392b"));

  btn.addEventListener("click", async () => {
    const ok = await confirmRestart();
    if (!ok) return;
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "…";
    try {
      const r = await comfyFetch("/manager/reboot", { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!r.ok && r.status !== 0) throw new Error(String(r.status));
      // 서버가 곧 죽으므로 응답이 안 올 수도 있음 — 그건 정상.
    } catch {
      // ComfyUI-Manager 미설치 등으로 라우트가 없으면 여기로 옴.
      alert("Could not send the restart request — check that ComfyUI-Manager is installed.");
      btn.disabled = false;
      btn.textContent = orig;
    }
  });

  return btn;
}
