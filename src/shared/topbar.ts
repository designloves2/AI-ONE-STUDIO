// topbar.ts — 상단 고정 메뉴바. 6개 도구를 탭으로 노출, 항상 화면에 보임.
import { animate } from "motion";
import { TOOLS, GROUP_LABELS, GROUP_ORDER, toolFromHash, type ToolId } from "./tools";
import { goTo } from "../router";
import { createSystemMonitorWidget } from "./systemMonitorWidget";
import { createConsoleLogOverlay } from "./consoleLogOverlay";
import { createRestartButton } from "./serverRestart";

export function createTopbar(): HTMLElement {
  const bar = document.createElement("header");
  // 페이지 자체가 h-screen으로 고정되고 스크롤은 내부 main에서만 일어나므로(main.ts),
  // topbar는 sticky일 필요가 없다 — sticky는 풀스크린 전환처럼 뷰포트 크기가 바뀔 때
  // 컴포지팅 레이어가 제대로 갱신되지 않아 잔상(ghosting)을 남기는 경우가 있어 제거.
  // 도구 탭이 많아 가로 스크롤이 필요하지만, 우측 CPU/RAM/GPU 모니터는 스크롤과 무관하게
  // 항상 고정 노출되어야 해서 스크롤 영역을 nav 쪽으로 좁혔다(예전엔 bar 전체가 스크롤 영역).
  bar.className = "aos-topbar z-50 flex items-center gap-2 px-4 h-14 bg-bg1 border-b border-border shrink-0";

  const brand = document.createElement("button");
  brand.className = "aos-topbar-menu aos-topbar-brand font-semibold text-brand mr-4 shrink-0";
  brand.textContent = "AI ONE STUDIO";
  brand.addEventListener("click", () => goTo(null));
  bar.appendChild(brand);

  const navWrap = document.createElement("div");
  navWrap.className = "aos-topbar-menu flex-1 min-w-0 overflow-x-auto";
  bar.appendChild(navWrap);

  // 모바일 전용 강제 줄바꿈 스페이서 — 데스크톱에서는 display:none으로 완전히 비활성(레이아웃에
  // 전혀 관여 안 함), 모바일에서만 flex-basis:100%로 부풀어서 "메뉴|재시작" 줄과
  // "모니터링|콘솔" 줄 사이에 줄바꿈을 강제한다. style.css의 .aos-topbar-break 참고.
  const rowBreak = document.createElement("span");
  rowBreak.className = "aos-topbar-break";
  bar.appendChild(rowBreak);

  const nav = document.createElement("nav");
  nav.className = "flex items-center gap-4";
  navWrap.appendChild(nav);

  const tabs = new Map<ToolId, HTMLButtonElement>();

  const groups = GROUP_ORDER;
  for (const group of groups) {
    const groupEl = document.createElement("div");
    groupEl.className = "flex items-center gap-1 whitespace-nowrap";

    const label = document.createElement("span");
    label.textContent = GROUP_LABELS[group] + " :";
    label.className = "aos-topbar-group-label text-xs text-muted mr-1 shrink-0";
    groupEl.appendChild(label);

    for (const tool of TOOLS.filter((t) => t.group === group)) {
      const btn = document.createElement("button");
      btn.textContent = tool.label;
      btn.className =
        "px-3 h-9 rounded-md text-sm text-muted hover:text-text hover:bg-bg2 border border-transparent transition-colors whitespace-nowrap";
      btn.addEventListener("click", () => goTo(tool.id));
      groupEl.appendChild(btn);
      tabs.set(tool.id, btn);
    }

    nav.appendChild(groupEl);

    if (group !== groups[groups.length - 1]) {
      const divider = document.createElement("span");
      divider.className = "w-px h-6 bg-border shrink-0";
      nav.appendChild(divider);
    }
  }

  function updateActive() {
    const active = toolFromHash(location.hash);
    for (const [id, btn] of tabs) {
      const isActive = active?.id === id;
      btn.classList.toggle("bg-bg3", isActive);
      btn.classList.toggle("text-text", isActive);
      btn.classList.toggle("border-brand", isActive);
      btn.classList.toggle("text-muted", !isActive);
      if (isActive) {
        animate(btn, { opacity: [0.6, 1] }, { duration: 0.2 });
      }
    }
  }

  window.addEventListener("hashchange", updateActive);
  updateActive();

  // 순서: 🖥 Console(글씨 있는 넓은 버튼) → 실시간 CPU/RAM/GPU 모니터 → ⟳ Restart(아이콘만, 빨강, 맨 우측).
  const consoleOv = createConsoleLogOverlay();
  const consoleBtn = document.createElement("button");
  consoleBtn.textContent = "🖥 Console";
  consoleBtn.title = "ComfyUI server console";
  consoleBtn.className =
    "aos-console-btn shrink-0 h-8 px-3 rounded-md text-xs font-bold text-muted hover:text-text hover:bg-bg2 border border-border transition-colors whitespace-nowrap";
  consoleBtn.addEventListener("click", () => consoleOv.show());
  bar.appendChild(consoleBtn);
  document.body.appendChild(consoleOv.el);

  bar.appendChild(createSystemMonitorWidget());

  const restartBtn = createRestartButton();
  restartBtn.classList.add("aos-restart-btn");
  bar.appendChild(restartBtn);

  return bar;
}
