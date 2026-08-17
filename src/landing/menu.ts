// menu.ts — 랜딩 화면. 상단 메뉴바는 layout이 이미 그리므로,
// 여기서는 도구를 고르지 않았을 때 보이는 기본 화면(갤러리 중심)만 담당한다.
import { createGallery } from "../shared/gallery";
import { TOOLS } from "../shared/tools";
import { goTo } from "../router";

export function renderLanding(container: HTMLElement) {
  const wrap = document.createElement("div");
  wrap.className = "flex flex-col gap-6 p-6 max-w-6xl mx-auto";

  const intro = document.createElement("div");
  intro.innerHTML = `
    <h1 class="text-xl font-semibold text-text">AI ONE STUDIO</h1>
    <p class="text-sm text-muted mt-1">상단 메뉴에서 도구를 선택하세요. 아래는 모든 도구가 공유하는 결과물 갤러리입니다.</p>
  `;
  wrap.appendChild(intro);

  const cards = document.createElement("div");
  cards.className = "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3";
  for (const tool of TOOLS) {
    const card = document.createElement("button");
    card.className =
      "flex flex-col items-center justify-center gap-2 aspect-square rounded-lg bg-bg1 border border-border hover:border-brand hover:bg-bg2 transition-colors text-sm text-text";
    card.textContent = tool.label;
    card.addEventListener("click", () => goTo(tool.id));
    cards.appendChild(card);
  }
  wrap.appendChild(cards);

  const galleryLabel = document.createElement("h2");
  galleryLabel.className = "text-sm font-medium text-muted mt-2";
  galleryLabel.textContent = "갤러리";
  wrap.appendChild(galleryLabel);

  const gallery = createGallery();
  gallery.el.classList.add("min-h-[240px]");
  wrap.appendChild(gallery.el);

  container.appendChild(wrap);
}
