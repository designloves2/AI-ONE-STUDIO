// topbar.ts — 상단 고정 메뉴바. 6개 도구를 탭으로 노출, 항상 화면에 보임.
import { animate } from "motion";
import { TOOLS, GROUP_LABELS, GROUP_ORDER, toolFromHash, type ToolId, type ToolGroup } from "./tools";
import { goTo } from "../router";
import { createSystemMonitorWidget } from "./systemMonitorWidget";
import { createConsoleLogOverlay } from "./consoleLogOverlay";
import { createRestartButton } from "./serverRestart";
import { isCloseGuardEnabled, setCloseGuardEnabled } from "./closeGuard";

export function createTopbar(opts: { onBrand?: () => void } = {}): HTMLElement {
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
  brand.addEventListener("click", () => (opts.onBrand ? opts.onBrand() : goTo(null)));
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
  // 데스크톱: 4개 카테고리 버튼 그대로. 모바일(<=767px)에서는 이 nav 자체를 숨기고
  // 아래 mobileNav(버튼 하나 + 전체 도구 드롭다운 하나)로 완전히 대체한다 —
  // "모바일에서는 메뉴가 4칸이 아니고 그냥 하나에 전부 드롭다운 형태로".
  nav.className = "aos-topbar-nav-desktop flex items-center gap-4";
  navWrap.appendChild(nav);

  const mobileNav = document.createElement("nav");
  mobileNav.className = "aos-topbar-nav-mobile items-center";
  navWrap.appendChild(mobileNav);

  const tabs = new Map<ToolId, HTMLButtonElement[]>();
  function registerTab(id: ToolId, btn: HTMLButtonElement) {
    const arr = tabs.get(id) || [];
    arr.push(btn);
    tabs.set(id, arr);
  }

  // 4개 카테고리를 전부 가로로 펼치는 대신, 카테고리당 하나의 ☰ 스타일 버튼 + 클릭 시
  // 펼쳐지는 드롭다운(서브메뉴)으로 변경 — 사용자 요청("가로로 펼쳐놓은게 아니고 서브메뉴식").
  // ITDA의 ☰ Menu 드롭다운과 동일한 상호작용 패턴(열기/바깥 클릭 시 닫힘)을 그대로 따름.
  const groups = GROUP_ORDER;
  const groupBtns = new Map<ToolGroup, HTMLButtonElement>();
  const openDropdowns: HTMLElement[] = [];

  function closeAllDropdowns() {
    for (const dd of openDropdowns) dd.style.display = "none";
  }
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Node)) return;
    for (const dd of openDropdowns) {
      const ownerBtn = (dd as any)._ownerBtn as HTMLElement | undefined;
      if (!dd.contains(e.target) && !(ownerBtn && ownerBtn.contains(e.target))) dd.style.display = "none";
    }
  });
  // navWrap scrolls horizontally (overflow-x-auto), which — per the CSS overflow spec
  // — forces its OTHER axis to an implicit 'auto' too, clipping anything positioned
  // absolute/relative to a nav child the instant it extends past that row's own
  // height. That's why the dropdown only ever showed "inside the frame" instead of
  // floating over the page. Fixed by appending every dropdown to <body> with
  // position:fixed, coordinates computed from the trigger button's own rect at open
  // time — same escape-the-clipping-ancestor approach as this app's other overlays.
  window.addEventListener("scroll", closeAllDropdowns, true);
  window.addEventListener("resize", closeAllDropdowns);

  for (const group of groups) {
    const groupBtn = document.createElement("button");
    groupBtn.textContent = `${GROUP_LABELS[group]} ▾`;
    // fixed width (not just min-width) so all 4 buttons stay evenly spaced regardless
    // of label length — was sized to its own text, so "MiniMax H3" vs "Image Edit
    // Generator" vs a long tool name (e.g. "Qwen Image 2511") each pushed the
    // following buttons around by however much shorter/longer the label was.
    groupBtn.className =
      "px-2 h-9 w-[190px] rounded-md text-sm font-bold text-muted hover:text-text hover:bg-bg2 border border-transparent transition-colors whitespace-nowrap overflow-hidden text-ellipsis shrink-0";
    groupBtns.set(group, groupBtn);

    const dropdown = document.createElement("div");
    dropdown.className =
      "flex flex-col min-w-[180px] rounded-md border border-border bg-bg1 shadow-lg py-1";
    dropdown.style.cssText = "display:none; position:fixed; z-index:1000;";
    (dropdown as any)._ownerBtn = groupBtn;
    openDropdowns.push(dropdown);
    document.body.appendChild(dropdown);

    groupBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = dropdown.style.display !== "none";
      closeAllDropdowns();
      if (!isOpen) {
        const r = groupBtn.getBoundingClientRect();
        dropdown.style.left = `${r.left}px`;
        dropdown.style.top = `${r.bottom + 4}px`;
        dropdown.style.display = "flex";
      }
    });

    for (const tool of TOOLS.filter((t) => t.group === group)) {
      const btn = document.createElement("button");
      btn.textContent = tool.label;
      btn.className =
        "px-3 h-9 text-left text-sm text-muted hover:text-text hover:bg-bg2 border border-transparent transition-colors whitespace-nowrap";
      btn.addEventListener("click", () => { closeAllDropdowns(); goTo(tool.id); });
      dropdown.appendChild(btn);
      registerTab(tool.id, btn);
    }

    nav.appendChild(groupBtn);

    if (group !== groups[groups.length - 1]) {
      const divider = document.createElement("span");
      divider.className = "w-px h-6 bg-border shrink-0";
      nav.appendChild(divider);
    }
  }

  // ── 모바일: 버튼 하나("☰ Tools ▾") + 전체 도구를 그룹 헤더와 함께 한 드롭다운에 ──
  const mobileBtn = document.createElement("button");
  mobileBtn.textContent = "☰ Tools ▾";
  mobileBtn.className =
    "px-2 h-9 rounded-md text-sm font-bold text-muted hover:text-text hover:bg-bg2 border border-transparent transition-colors whitespace-nowrap shrink-0";
  mobileNav.appendChild(mobileBtn);

  const mobileDropdown = document.createElement("div");
  mobileDropdown.className =
    "flex flex-col min-w-[200px] max-h-[70vh] overflow-y-auto rounded-md border border-border bg-bg1 shadow-lg py-1";
  mobileDropdown.style.cssText = "display:none; position:fixed; z-index:1000;";
  (mobileDropdown as any)._ownerBtn = mobileBtn;
  openDropdowns.push(mobileDropdown);
  document.body.appendChild(mobileDropdown);

  mobileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = mobileDropdown.style.display !== "none";
    closeAllDropdowns();
    if (!isOpen) {
      const r = mobileBtn.getBoundingClientRect();
      mobileDropdown.style.left = `${r.left}px`;
      mobileDropdown.style.top = `${r.bottom + 4}px`;
      mobileDropdown.style.display = "flex";
    }
  });

  for (const group of groups) {
    const hdr = document.createElement("div");
    hdr.textContent = GROUP_LABELS[group];
    hdr.className = "px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-muted";
    mobileDropdown.appendChild(hdr);
    for (const tool of TOOLS.filter((t) => t.group === group)) {
      const btn = document.createElement("button");
      btn.textContent = tool.label;
      btn.className =
        "px-3 h-9 text-left text-sm text-muted hover:text-text hover:bg-bg2 border border-transparent transition-colors whitespace-nowrap";
      btn.addEventListener("click", () => { closeAllDropdowns(); goTo(tool.id); });
      mobileDropdown.appendChild(btn);
      registerTab(tool.id, btn);
    }
  }

  function updateActive() {
    const active = toolFromHash(location.hash);
    for (const [id, btns] of tabs) {
      const isActive = active?.id === id;
      for (const btn of btns) {
        btn.classList.toggle("bg-bg3", isActive);
        btn.classList.toggle("text-text", isActive);
        btn.classList.toggle("border-brand", isActive);
        btn.classList.toggle("text-muted", !isActive);
        if (isActive) {
          animate(btn, { opacity: [0.6, 1] }, { duration: 0.2 });
        }
      }
    }
    // 활성 도구가 속한 카테고리 버튼도 강조하고, 그 도구 이름을 버튼 라벨로 보여준다
    // (선택 전에는 카테고리 이름만 — "Media Generator ▾" — 선택 후에는 어떤 도구인지
    // 바로 보이도록 "MiniMax H3 ▾"로 바뀐다).
    for (const [group, btn] of groupBtns) {
      const isActiveGroup = active?.group === group;
      btn.classList.toggle("text-text", isActiveGroup);
      btn.classList.toggle("border-brand", isActiveGroup);
      btn.classList.toggle("text-muted", !isActiveGroup);
      btn.textContent = `${isActiveGroup && active ? active.label : GROUP_LABELS[group]} ▾`;
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

  // 생성 중 탭을 실수로 닫으면 경고할지 여부 — 기본 ON. 코드 수정으로 인한 Vite 리로드는
  // closeGuard.ts가 자체적으로 걸러내므로, 이 체크박스는 순전히 "실수로 탭 닫기" 방지용이다.
  const closeGuardLabel = document.createElement("label");
  closeGuardLabel.className = "aos-warnclose-btn flex items-center gap-1 shrink-0 text-xs text-muted cursor-pointer select-none";
  closeGuardLabel.title = "Warn before closing this tab while a generation is running";
  const closeGuardChk = document.createElement("input");
  closeGuardChk.type = "checkbox";
  closeGuardChk.checked = isCloseGuardEnabled();
  closeGuardChk.addEventListener("change", () => setCloseGuardEnabled(closeGuardChk.checked));
  const closeGuardText = document.createElement("span");
  closeGuardText.textContent = "Warn on close";
  closeGuardLabel.append(closeGuardChk, closeGuardText);
  bar.appendChild(closeGuardLabel);

  const restartBtn = createRestartButton();
  restartBtn.classList.add("aos-restart-btn");
  bar.appendChild(restartBtn);

  return bar;
}
