// router.ts — 해시 기반 수동 화면 전환 (SPA 라우터 불필요, 도구 6개뿐)
import { TOOLS, toolFromHash, type ToolId } from "./shared/tools";

export type RenderFn = (container: HTMLElement) => void;

const registry = new Map<ToolId, RenderFn>();

export function registerTool(id: ToolId, render: RenderFn) {
  registry.set(id, render);
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
