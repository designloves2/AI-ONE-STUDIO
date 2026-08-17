// topbar.ts — 상단 고정 메뉴바. 6개 도구를 탭으로 노출, 항상 화면에 보임.
import { animate } from "motion";
import { TOOLS, GROUP_LABELS, toolFromHash, type ToolId, type ToolGroup } from "./tools";
import { goTo } from "../router";

export function createTopbar(): HTMLElement {
  const bar = document.createElement("header");
  // 페이지 자체가 h-screen으로 고정되고 스크롤은 내부 main에서만 일어나므로(main.ts),
  // topbar는 sticky일 필요가 없다 — sticky는 풀스크린 전환처럼 뷰포트 크기가 바뀔 때
  // 컴포지팅 레이어가 제대로 갱신되지 않아 잔상(ghosting)을 남기는 경우가 있어 제거.
  bar.className =
    "z-50 flex items-center gap-2 px-4 h-14 bg-bg1 border-b border-border shrink-0 overflow-x-auto";

  const brand = document.createElement("button");
  brand.className = "font-semibold text-brand mr-4 shrink-0";
  brand.textContent = "AI ONE STUDIO";
  brand.addEventListener("click", () => goTo(null));
  bar.appendChild(brand);

  const nav = document.createElement("nav");
  nav.className = "flex items-center gap-4 overflow-x-auto";
  bar.appendChild(nav);

  const tabs = new Map<ToolId, HTMLButtonElement>();

  const groups: ToolGroup[] = ["video", "image"];
  for (const group of groups) {
    const groupEl = document.createElement("div");
    groupEl.className = "flex items-center gap-1 whitespace-nowrap";

    const label = document.createElement("span");
    label.textContent = GROUP_LABELS[group] + " :";
    label.className = "text-xs text-muted mr-1 shrink-0";
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

  return bar;
}
