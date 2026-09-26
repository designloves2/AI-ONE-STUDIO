// poseCrop.ts — POSE mode's crop tool for Qwen Image 2.1 ONE STUDIO.
// 원본 근거: web/qwen21/ui_pose_crop.js. 포즈 이미지는 SAM3D Body에 크롭/리사이즈된 크기 그대로
// 전달된다(그래프에 별도 ImageCrop 노드 없음 — 크롭은 클라이언트 캔버스에서 합성 후 업로드,
// maskDraw.ts와 동일한 "flatten → upload → LoadImage from filename" 패턴), 그래서 크롭 박스 +
// 출력 W/H는 포즈 추출 전에 미리 정해져야 한다. 노란 박스 + 8개 드래그 핸들로 크롭 영역을
// 표시하고, W/H 필드(🔒 Lock ratio — I2I의 사이즈 필드와 동일 패턴)로 최종 리사이즈 출력 크기를 정한다.
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

/**
 * 모달 크롭 오버레이를 `root` 위에 연다. onCommit(filename, cropBox, outW, outH, lockRatio) —
 * cropBox는 소스 이미지의 NATIVE 픽셀 좌표라, 같은 이미지를 다시 열면 동일한 박스가 복원된다.
 */
export function openPoseCropOverlay(
  root: HTMLElement,
  sourceImageUrl: string,
  initial: { cropBox?: CropBox | null; outW?: number; outH?: number; lockRatio?: boolean } | undefined,
  onCommit: (filename: string, cropBox: CropBox, outW: number, outH: number, lockRatio: boolean) => void
): HTMLElement {
  const { cropBox: initialCropBox, outW: initialOutW, outH: initialOutH, lockRatio: initialLockRatio } = initial || {};

  const overlay = el("div", {
    style: {
      position: "absolute", inset: "0", zIndex: "9999", background: "rgba(11,11,11,0.97)",
      borderRadius: "inherit", display: "flex", flexDirection: "column", padding: "12px", gap: "8px", boxSizing: "border-box",
    },
  });

  const hdr = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" } });
  hdr.appendChild(el("div", { text: "Crop the pose image — drag the yellow box/handles", style: { color: "#fff", fontSize: "13px", fontWeight: "700", flex: "1" } }));
  const cancelBtn = el("button", { type: "button", text: "Cancel", style: btnStyle() });
  hdr.appendChild(cancelBtn);
  overlay.appendChild(hdr);

  const canvasWrap = el("div", { style: { flex: "1", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" } });
  overlay.appendChild(canvasWrap);

  const footer = el("div", { style: { display: "flex", alignItems: "center", gap: "10px", flexShrink: "0", flexWrap: "wrap" } });
  const sizeStyle = { width: "80px", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "5px 7px", fontSize: "12px", fontFamily: "inherit", outline: "none" };
  const wIn = el("input", { type: "number", step: "8", min: "64", style: sizeStyle }) as HTMLInputElement;
  const hIn = el("input", { type: "number", step: "8", min: "64", style: sizeStyle }) as HTMLInputElement;
  const lockChk = el("input", { type: "checkbox" }) as HTMLInputElement;
  const lockLbl = el("label", { style: { display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: C.muted, cursor: "pointer", whiteSpace: "nowrap" } }, [lockChk, el("span", { text: "🔒 Lock ratio" })]);
  const applyBtn = el("button", {
    type: "button", text: "✓ Apply Crop",
    style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "6px 14px", borderRadius: "6px", background: BRAND, color: "#fff", border: "none", fontWeight: "700" },
  }) as HTMLButtonElement;
  footer.appendChild(el("span", { text: "Output W", style: { fontSize: "11px", color: C.muted } }));
  footer.appendChild(wIn);
  footer.appendChild(el("span", { text: "H", style: { fontSize: "11px", color: C.muted } }));
  footer.appendChild(hIn);
  footer.appendChild(lockLbl);
  footer.appendChild(el("div", { style: { flex: "1" } }));
  footer.appendChild(applyBtn);
  overlay.appendChild(footer);

  const img = new Image();
  img.onload = () => {
    const maxW = canvasWrap.clientWidth || 640, maxH = canvasWrap.clientHeight || 480;
    const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
    const dispW = Math.round(img.naturalWidth * scale), dispH = Math.round(img.naturalHeight * scale);
    const toDisp = scale; // native -> display

    const stage = el("div", { style: { position: "relative", width: `${dispW}px`, height: `${dispH}px` } });
    stage.appendChild(el("img", { src: sourceImageUrl, style: { position: "absolute", inset: "0", width: `${dispW}px`, height: `${dispH}px`, borderRadius: "6px", userSelect: "none", pointerEvents: "none" } }));
    canvasWrap.appendChild(stage);

    // 크롭 박스는 NATIVE 픽셀 좌표로 유지 — 렌더링할 때만 display 좌표로 변환한다. 그래서
    // 오버레이 크기가 달라져도 같은 이미지를 재편집하면 정확히 같은 박스가 복원된다.
    let box: CropBox = initialCropBox && initialCropBox.w > 0 && initialCropBox.h > 0
      ? { ...initialCropBox }
      : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    let aspect = initialOutW && initialOutH ? initialOutW / initialOutH : box.w / box.h;

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
        const start = { sx: e.clientX, sy: e.clientY, ...box };
        const move = (e2: PointerEvent) => {
          const ddx = (e2.clientX - start.sx) / toDisp, ddy = (e2.clientY - start.sy) / toDisp;
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

    // ── 출력 사이즈 필드 (🔒 Lock ratio — I2I 사이즈 필드와 동일 패턴) ──────────
    const snap8 = (v: number) => Math.max(8, Math.round(v / 8) * 8);
    wIn.value = String(initialOutW || Math.round(box.w));
    hIn.value = String(initialOutH || Math.round(box.h));
    lockChk.checked = initialLockRatio ?? true;
    lockChk.addEventListener("change", () => { if (lockChk.checked) aspect = (+wIn.value || 1) / (+hIn.value || 1); });
    wIn.addEventListener("change", () => {
      wIn.value = String(snap8(+wIn.value || 512));
      if (lockChk.checked) hIn.value = String(snap8(+wIn.value / aspect));
    });
    hIn.addEventListener("change", () => {
      hIn.value = String(snap8(+hIn.value || 512));
      if (lockChk.checked) wIn.value = String(snap8(+hIn.value * aspect));
      else aspect = (+wIn.value || 1) / (+hIn.value || 1);
    });

    applyBtn.onclick = async () => {
      applyBtn.disabled = true; applyBtn.textContent = "Uploading…";
      try {
        clampBox();
        const outW = Math.max(8, Math.round(+wIn.value || box.w));
        const outH = Math.max(8, Math.round(+hIn.value || box.h));
        const outCanvas = document.createElement("canvas");
        outCanvas.width = outW; outCanvas.height = outH;
        const octx = outCanvas.getContext("2d") as CanvasRenderingContext2D;
        octx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, outW, outH);
        const blob: Blob = await new Promise((res) => outCanvas.toBlob((b) => res(b as Blob), "image/png"));
        const filename = await uploadAnnotationBlob(blob, `q21_pose_crop_${Date.now()}.png`);
        onCommit(filename, { x: box.x, y: box.y, w: box.w, h: box.h }, outW, outH, lockChk.checked);
        overlay.remove();
      } catch (e: any) {
        alert("Upload failed: " + (e.message || e));
      } finally {
        applyBtn.disabled = false; applyBtn.textContent = "✓ Apply Crop";
      }
    };
  };
  img.src = sourceImageUrl;

  cancelBtn.onclick = () => overlay.remove();
  root.appendChild(overlay);
  return overlay;
}
