// gallery.ts — 6개 도구가 공유하는 유일한 공용 컴포넌트.
// 생성 결과물(이미지/비디오)이 모이는 영역. 도구별 컨트롤/패널은 각자 재설계하지만
// 결과물 표시 영역만큼은 여기서 통일한다.

export interface GalleryItem {
  id: string;
  url: string;
  kind: "image" | "video";
  createdAt: number;
}

export interface GalleryHandle {
  el: HTMLElement;
  addItem(item: GalleryItem): void;
  clear(): void;
}

export function createGallery(): GalleryHandle {
  const el = document.createElement("div");
  el.className =
    "grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3 auto-rows-max overflow-y-auto p-3 bg-bg1 border border-border rounded-lg";

  const empty = document.createElement("div");
  empty.className = "col-span-full text-muted text-sm text-center py-10";
  empty.textContent = "아직 생성된 결과물이 없습니다";
  el.appendChild(empty);

  function addItem(item: GalleryItem) {
    if (empty.parentElement) empty.remove();

    const card = document.createElement("div");
    card.className =
      "relative aspect-square rounded-md overflow-hidden border border-border bg-bg2 hover:border-borderh transition-colors";

    if (item.kind === "video") {
      const video = document.createElement("video");
      video.src = item.url;
      video.className = "w-full h-full object-cover";
      video.controls = true;
      video.muted = true;
      card.appendChild(video);
    } else {
      const img = document.createElement("img");
      img.src = item.url;
      img.className = "w-full h-full object-cover";
      img.loading = "lazy";
      card.appendChild(img);
    }

    el.prepend(card);
  }

  function clear() {
    el.innerHTML = "";
    el.appendChild(empty);
  }

  return { el, addItem, clear };
}
