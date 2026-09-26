// router.ts — 해시 기반 수동 화면 전환 (SPA 라우터 불필요, 도구 6개뿐)
import { TOOLS, toolFromHash, type ToolId } from "./shared/tools";

export type RenderFn = (container: HTMLElement) => void;

const registry = new Map<ToolId, RenderFn>();

export function registerTool(id: ToolId, render: RenderFn) {
  registry.set(id, render);
}

// ITDA는 모바일 미지원 — 767px 이하 폭에서는 실제 도구를 마운트하지 않고 안내만 보여준다.
function isMobileWidth(): boolean {
  return window.innerWidth <= 767;
}
function renderItdaMobileBlock(container: HTMLElement) {
  const div = document.createElement("div");
  div.className = "aos-itda-mobile-block";
  div.innerHTML =
    `<div style="font-size:40px;">💻</div>` +
    `<div style="font-size:15px;font-weight:700;color:var(--color-text);">모바일에서는 지원되지 않습니다.</div>` +
    `<div style="font-size:13px;">데스크탑에서 사용해 주세요</div>`;
  container.appendChild(div);
}

export function startRouter(container: HTMLElement, renderLanding: RenderFn) {
  function render() {
    const hash = location.hash || "";
    const tool = toolFromHash(hash);
    container.innerHTML = "";

    if (!tool) {
      renderLanding(container);
      return;
    }

    if (tool.id === "itda" && isMobileWidth()) {
      renderItdaMobileBlock(container);
      return;
    }

    const renderFn = registry.get(tool.id);
    if (!renderFn) {
      const div = document.createElement("div");
      div.className = "p-8 text-muted";
      div.textContent = `${tool.label} — not ported yet`;
      container.appendChild(div);
      return;
    }
    renderFn(container);
  }

  window.addEventListener("hashchange", render);
  // 창 크기가 바뀌어(모바일 브라우저 회전, 창 리사이즈 등) 767px 경계를 넘나들 때도
  // ITDA 화면이면 다시 그려서 안내/실제 도구 전환이 즉시 반영되게 한다.
  let resizeTimer: number | undefined;
  window.addEventListener("resize", () => {
    if (toolFromHash(location.hash)?.id !== "itda") return;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(render, 150);
  });
  render();
}

export function goTo(id: ToolId | null) {
  if (!id) {
    location.hash = "";
    return;
  }
  const tool = TOOLS.find((t) => t.id === id);
  if (tool) location.hash = tool.hash;
}
