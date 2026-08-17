// menu.ts — 랜딩 화면. 상단 메뉴바와 동일한 4개 카테고리(Video/Image/Image Edit/Beta)로
// 도구를 묶어 보여주고, ONE STUDIO 소개(ComfyUI 커스텀 노드를 독립 웹앱으로 이식했다는 설명)를
// 담는다. 이전의 "공유 갤러리" 섹션은 도구별 갤러리(각 도구 우측 상단 🖼)와 중복이라 제거했다.
import { GROUP_ORDER, GROUP_LABELS, toolsByGroup, type ToolId, type ToolGroup } from "../shared/tools";
import { goTo } from "../router";
import { C, BRAND } from "../identity";

const GROUP_DESC: Record<ToolGroup, string> = {
  video: "텍스트/이미지로 영상을 생성합니다.",
  image: "텍스트 또는 이미지로 새 이미지를 생성합니다.",
  image_edit: "기존 이미지를 지시문으로 편집합니다.",
  beta: "실험적으로 제공되는 도구입니다.",
};

const TOOL_DESC: Partial<Record<ToolId, string>> = {
  minimax_h3: "레퍼런스 이미지/음성 기반 멀티 클립 영상 생성",
  krea2: "T2I · I2I · Identity Edit · Upscale",
  zimage: "T2I · I2I · Inpaint · Re-BG · ControlNet · Face Redraw · Upscale",
  klein: "지시문 기반 이미지 편집(T2I/I2I/Inpaint/Outpaint/Face Swap)",
  qwen2511: "Qwen Image 편집 모델 기반 이미지 편집",
  sdxl: "SDXL 기반 이미지 생성 (베타)",
};

const GROUP_ICON: Record<ToolGroup, string> = {
  video: "🎬",
  image: "🖼",
  image_edit: "✂️",
  beta: "🧪",
};

export function renderLanding(container: HTMLElement) {
  const wrap = document.createElement("div");
  wrap.className = "flex flex-col gap-10 p-6 md:p-10 max-w-6xl mx-auto";

  // ── Hero: ONE STUDIO 소개 ────────────────────────────────────────────────
  const hero = document.createElement("div");
  hero.className = "flex flex-col gap-3 py-6";
  hero.innerHTML = `
    <div class="text-xs font-semibold tracking-widest uppercase" style="color:${BRAND}">AI ONE STUDIO</div>
    <h1 class="text-2xl md:text-3xl font-bold text-text leading-tight">
      ComfyUI 커스텀 노드를, 독립 실행형 웹 스튜디오로.
    </h1>
    <p class="text-sm md:text-[15px] text-muted leading-relaxed max-w-3xl">
      AI ONE STUDIO는
      <a href="https://github.com/designloves2/ComfyUI-TJ_NODE_STUDIO_ONE" target="_blank" rel="noopener noreferrer"
         class="text-text underline decoration-dotted underline-offset-2 hover:no-underline"
         style="color:${BRAND}">ComfyUI-TJ_NODE_STUDIO_ONE</a>
      커스텀 노드 패키지에 담겨 있던 6개의 생성 도구를 그대로 웹 UI로 옮겨온 사이트입니다.
      ComfyUI 캔버스 위 노드를 마우스로 조합하지 않아도, 이미 실행 중인 ComfyUI 서버에 연결해 브라우저에서
      곧바로 생성·편집 작업을 할 수 있습니다. 각 도구의 기능과 파라미터는 원본 노드와 1:1로 동일하며,
      레이아웃만 웹에 맞게 재구성했습니다.
    </p>
  `;
  wrap.appendChild(hero);

  // ── 카테고리별 도구 카드 ─────────────────────────────────────────────────
  for (const group of GROUP_ORDER) {
    const tools = toolsByGroup(group);
    if (!tools.length) continue;

    const section = document.createElement("div");
    section.className = "flex flex-col gap-3";

    const sectionHdr = document.createElement("div");
    sectionHdr.className = "flex items-baseline gap-2";
    sectionHdr.innerHTML = `
      <span class="text-lg">${GROUP_ICON[group]}</span>
      <h2 class="text-base font-semibold text-text">${GROUP_LABELS[group]}</h2>
      <span class="text-xs text-muted">${GROUP_DESC[group]}</span>
    `;
    section.appendChild(sectionHdr);

    const cards = document.createElement("div");
    cards.className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3";
    for (const tool of tools) {
      const card = document.createElement("button");
      card.className =
        "group flex flex-col items-start gap-2 rounded-xl p-4 text-left border transition-colors";
      card.style.background = C.bg1;
      card.style.borderColor = C.border;
      card.addEventListener("mouseenter", () => (card.style.borderColor = BRAND));
      card.addEventListener("mouseleave", () => (card.style.borderColor = C.border));
      card.innerHTML = `
        <div class="text-sm font-semibold text-text">${tool.label}</div>
        <div class="text-xs leading-relaxed" style="color:${C.muted}">${TOOL_DESC[tool.id] || ""}</div>
      `;
      card.addEventListener("click", () => goTo(tool.id));
      cards.appendChild(card);
    }
    section.appendChild(cards);
    wrap.appendChild(section);
  }

  container.appendChild(wrap);
}
