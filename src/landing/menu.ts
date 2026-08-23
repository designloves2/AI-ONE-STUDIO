// menu.ts — 랜딩 화면. 상단 메뉴바와 동일한 4개 카테고리(Video/Image/Image Edit/Beta)로
// 도구를 묶어 보여주고, ONE STUDIO 소개(ComfyUI 커스텀 노드를 독립 웹앱으로 이식했다는 설명)를
// 담는다. 이전의 "공유 갤러리" 섹션은 도구별 갤러리(각 도구 우측 상단 🖼)와 중복이라 제거했다.
import { GROUP_ORDER, GROUP_LABELS, toolsByGroup, type ToolId, type ToolGroup } from "../shared/tools";
import { goTo } from "../router";
import { C, BRAND } from "../identity";

const GROUP_DESC: Record<ToolGroup, string> = {
  video: "Generate video from text/images.",
  image: "Generate new images from text or images.",
  image_edit: "Edit an existing image with an instruction.",
  beta: "Experimental tools.",
};

const TOOL_DESC: Partial<Record<ToolId, string>> = {
  minimax_h3: "Multi-clip video generation from reference images/audio",
  krea2: "T2I · I2I · Identity Edit · Upscale",
  zimage: "T2I · I2I · Inpaint · Re-BG · ControlNet · Face Redraw · Upscale",
  klein: "Instruction-based image editing (T2I/I2I/Inpaint/Outpaint/Face Swap)",
  qwen2511: "Image editing with the Qwen Image Edit model",
  sdxl: "SDXL-based image generation (beta)",
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
      ComfyUI custom nodes, as a standalone web studio.
    </h1>
    <p class="text-sm md:text-[15px] text-muted leading-relaxed max-w-3xl">
      AI ONE STUDIO takes the 6 generation tools bundled in the
      <a href="https://github.com/designloves2/ComfyUI-TJ_NODE_STUDIO_ONE" target="_blank" rel="noopener noreferrer"
         class="text-text underline decoration-dotted underline-offset-2 hover:no-underline"
         style="color:${BRAND}">ComfyUI-TJ_NODE_STUDIO_ONE</a>
      custom node pack and ports them straight to a web UI. No need to wire up nodes on the ComfyUI canvas —
      connect to an already-running ComfyUI server and generate/edit directly in the browser. Each tool's
      features and parameters match the original nodes 1:1; only the layout has been reworked for the web.
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
