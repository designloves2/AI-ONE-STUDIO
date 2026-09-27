// poseCrop.ts — POSE mode's crop tool for Qwen Image 2.1 ONE STUDIO.
// 원본 근거: web/qwen21/ui_pose_crop.js.
//
// 이 오버레이는 크롭 영역(노란 박스 + 8개 드래그 핸들)만 선택한다 — 자체 출력 사이즈 UI는
// 없다. Output Size(W/H + 🔒 Lock ratio, 크롭 자체의 비율에 고정)는 왼쪽 패널의 크롭 버튼
// 바로 아래에 있어서, 오버레이를 다시 열지 않고도 보고 편집할 수 있고, 영역을 다시 고르지
// 않고도 출력 사이즈만 바꿀 수 있다. cropAndUploadPoseImage()가 실제 크롭+리사이즈+업로드를
// 담당한다("방금 크롭을 적용" / "이후 Output Size 필드를 바꿈" 두 경우 모두 재사용).
import { C, BRAND, el } from "./core";
import { uploadAnnotationBlob } from "./api";

const YELLOW = "#ffd400";
const HANDLE_SIZE = 12;

export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function btnStyle() {
  return {
    cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "4px 10px",
    borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`,
  } as Partial<CSSStyleDeclaration>;
}

/** `cropBox`(sourceImageUrl 이미지의 native 픽셀)를 크롭해서 outW×outH로 리사이즈하고
 * 업로드한 뒤 그 파일명으로 resolve한다. */
export function cropAndUploadPoseImage(sourceImageUrl: string, cropBox: CropBox, outW: number, outH: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      try {
        const outCanvas = document.createElement("canvas");
        outCanvas.width = Math.max(8, Math.round(outW));
        outCanvas.height = Math.max(8, Math.round(outH));
        const octx = outCanvas.getContext("2d") as CanvasRenderingContext2D;
        octx.drawImage(img, cropBox.x, cropBox.y, cropBox.w, cropBox.h, 0, 0, outCanvas.width, outCanvas.height);
        const blob: Blob = await new Promise((res) => outCanvas.toBlob((b) => res(b as Blob), "image/png"));
        const filename = await uploadAnnotationBlob(blob, `q21_pose_crop_${Date.now()}.png`);
        resolve(filename);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("Failed to load the source image."));
    img.src = sourceImageUrl;
  });
}

/**
 * 모달 크롭 오버레이를 `root` 위에 연다. onCommit(cropBox) — cropBox는 소스 이미지의 NATIVE
 * 픽셀 좌표. 호출자(mountPose)가 cropAndUploadPoseImage()로 실제 파일을 만들고, Output Size
 * 필드를 cropBox.w/h로 채우는 책임을 진다.
 */
export function openPoseCropOverlay(
  root: HTMLElement,
  sourceImageUrl: string,
  initialCropBox: CropBox | null | undefined,
  onCommit: (cropBox: CropBox) => void
): HTMLElement {
  const overlay = el("div", {
    style: {
      position: "absolute", inset: "0", zIndex: "9999", background: "rgba(11,11,11,0.97)",
      borderRadius: "inherit", display: "flex", flexDirection: "column", padding: "12px", gap: "8px", boxSizing: "border-box",
    },
  });

  const hdr = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" } });
  hdr.appendChild(el("div", { text: "Crop the pose image — drag the yellow box/handles", style: { color: "#fff", fontSize: "13px", fontWeight: "700", flex: "1" } }));
  const cancelBtn = el("button", { type: "button", text: "Cancel", style: btnStyle() });
  const applyBtn = el("button", {
    type: "button", text: "✓ Apply Crop",
    style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "6px 14px", borderRadius: "6px", background: BRAND, color: "#fff", border: "none", fontWeight: "700" },
  }) as HTMLButtonElement;
  hdr.appendChild(cancelBtn);
  hdr.appendChild(applyBtn);
  overlay.appendChild(hdr);

  const canvasWrap = el("div", { style: { flex: "1", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" } });
  overlay.appendChild(canvasWrap);

  const img = new Image();
  img.onload = () => {
    const maxW = canvasWrap.clientWidth || 640;
    const maxH = canvasWrap.clientHeight || 480;
    const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
    const dispW = Math.round(img.naturalWidth * scale);
    const dispH = Math.round(img.naturalHeight * scale);
    const toDisp = scale; // native -> display

    const stage = el("div", { style: { position: "relative", width: `${dispW}px`, height: `${dispH}px` } });
    stage.appendChild(el("img", { src: sourceImageUrl, style: { position: "absolute", inset: "0", width: `${dispW}px`, height: `${dispH}px`, borderRadius: "6px", userSelect: "none", pointerEvents: "none" } }));
    canvasWrap.appendChild(stage);

    // 크롭 박스는 NATIVE 픽셀 좌표로 유지 — 렌더링할 때만 display 좌표로 변환한다. 그래서
    // 오버레이 크기가 달라져도 같은 이미지를 재편집하면 정확히 같은 박스가 복원된다.
    let box: CropBox = initialCropBox && initialCropBox.w > 0 && initialCropBox.h > 0
      ? { ...initialCropBox }
      : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };

    const boxEl = el("div", { style: { position: "absolute", border: `2px solid ${YELLOW}`, boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)", cursor: "move", boxSizing: "border-box" } });
    stage.appendChild(boxEl);

    const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
    type Handle = (typeof HANDLES)[number];
    const handleEls: Record<Handle, HTMLElement> = {} as any;
    const cursorMap: Record<Handle, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };
    HANDLES.forEach((h) => {
      const he = el("div", { style: { position: "absolute", width: `${HANDLE_SIZE}px`, height: `${HANDLE_SIZE}px`, background: YELLOW, border: "1px solid #000", borderRadius: "2px", cursor: cursorMap[h], zIndex: "2" } });
      handleEls[h] = he;
      stage.appendChild(he);
    });

    function clampBox() {
      box.w = Math.max(16, Math.min(box.w, img.naturalWidth));
      box.h = Math.max(16, Math.min(box.h, img.naturalHeight));
      box.x = Math.max(0, Math.min(box.x, img.naturalWidth - box.w));
      box.y = Math.max(0, Math.min(box.y, img.naturalHeight - box.h));
    }

    function render() {
      clampBox();
      const dx = box.x * toDisp, dy = box.y * toDisp, dw = box.w * toDisp, dh = box.h * toDisp;
      boxEl.style.left = `${dx}px`; boxEl.style.top = `${dy}px`; boxEl.style.width = `${dw}px`; boxEl.style.height = `${dh}px`;
      const mid = (a: number, b: number) => (a + b) / 2 - HANDLE_SIZE / 2;
      const pos: Record<Handle, [number, number]> = {
        nw: [dx - HANDLE_SIZE / 2, dy - HANDLE_SIZE / 2], ne: [dx + dw - HANDLE_SIZE / 2, dy - HANDLE_SIZE / 2],
        sw: [dx - HANDLE_SIZE / 2, dy + dh - HANDLE_SIZE / 2], se: [dx + dw - HANDLE_SIZE / 2, dy + dh - HANDLE_SIZE / 2],
        n: [mid(dx, dx + dw), dy - HANDLE_SIZE / 2], s: [mid(dx, dx + dw), dy + dh - HANDLE_SIZE / 2],
        w: [dx - HANDLE_SIZE / 2, mid(dy, dy + dh)], e: [dx + dw - HANDLE_SIZE / 2, mid(dy, dy + dh)],
      };
      HANDLES.forEach((h) => { handleEls[h].style.left = `${pos[h][0]}px`; handleEls[h].style.top = `${pos[h][1]}px`; });
    }
    render();

    // ── 박스 전체 드래그로 이동 ──────────────────────────────────────────
    boxEl.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      boxEl.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY, bx: box.x, by: box.y };
      const move = (e2: PointerEvent) => {
        box.x = start.bx + (e2.clientX - start.x) / toDisp;
        box.y = start.by + (e2.clientY - start.y) / toDisp;
        render();
      };
      const up = () => { boxEl.removeEventListener("pointermove", move); boxEl.removeEventListener("pointerup", up); };
      boxEl.addEventListener("pointermove", move); boxEl.addEventListener("pointerup", up);
    });

    // ── 핸들 드래그로 리사이즈 ──────────────────────────────────────────────
    HANDLES.forEach((h) => {
      handleEls[h].addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        (handleEls[h] as HTMLElement).setPointerCapture(e.pointerId);
        // mx/my로 이름 지음(x/y 아님) — box 자신이 x/y 키를 갖고 있어서, 만약 `{ x: e.clientX,
        // ...box }`처럼 스프레드하면 box.x가 마우스 시작 좌표를 조용히 덮어써서 드래그가
        // 마우스를 전혀 안 따라가는 버그가 생긴다(노드 쪽에서 실제로 겪은 버그).
        const start = { mx: e.clientX, my: e.clientY, x: box.x, y: box.y, w: box.w, h: box.h };
        const move = (e2: PointerEvent) => {
          const ddx = (e2.clientX - start.mx) / toDisp, ddy = (e2.clientY - start.my) / toDisp;
          let { x, y, w, h: bh } = start;
          if (h.includes("e")) w = start.w + ddx;
          if (h.includes("s")) bh = start.h + ddy;
          if (h.includes("w")) { x = start.x + ddx; w = start.w - ddx; }
          if (h.includes("n")) { y = start.y + ddy; bh = start.h - ddy; }
          box = { x, y, w, h: bh };
          render();
        };
        const up = () => { handleEls[h].removeEventListener("pointermove", move); handleEls[h].removeEventListener("pointerup", up); };
        handleEls[h].addEventListener("pointermove", move); handleEls[h].addEventListener("pointerup", up);
      });
    });

    applyBtn.onclick = () => {
      clampBox();
      onCommit({ x: box.x, y: box.y, w: box.w, h: box.h });
      overlay.remove();
    };
  };
  img.src = sourceImageUrl;

  cancelBtn.onclick = () => overlay.remove();
  root.appendChild(overlay);
  return overlay;
}
