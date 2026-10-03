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
import { sameOriginSrc } from "../../shared/sameOriginImage";

const YELLOW = "#ffd400";
const HANDLE_SIZE = 12;

export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 비율 프리셋 — "쌍(paired)"인 것들(2:3/3:4/4:5/9:16)은 박스 옆 ⇔/⇕ 스위치로 가로/세로
// 전환 가능. 1:1과 Free는 쌍이 없음.
const RATIO_PRESETS: { key: string; w: number | null; h: number | null; pair?: boolean }[] = [
  { key: "1:1", w: 1, h: 1 },
  { key: "2:3", w: 2, h: 3, pair: true },
  { key: "3:4", w: 3, h: 4, pair: true },
  { key: "4:5", w: 4, h: 5, pair: true },
  { key: "9:16", w: 9, h: 16, pair: true },
  { key: "Free", w: null, h: null },
];

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
    sameOriginSrc(sourceImageUrl).then((s) => { img.src = s; }, () => { img.src = sourceImageUrl; });
  });
}

/**
 * 모달 크롭 오버레이를 `root` 위에 연다. onCommit(cropBox, ratioLabel) — cropBox는 소스
 * 이미지의 NATIVE 픽셀 좌표, ratioLabel은 적용된 비율 프리셋 표시용 문자열(예: "2:3",
 * ⇔/⇕로 뒤집었으면 "3:2") 또는 Free일 때 null. 호출자(mountPose)가
 * cropAndUploadPoseImage()로 실제 파일을 만들고, Output Size 필드를 cropBox.w/h로 채우고,
 * ratioLabel을 크기 텍스트 앞에 "Ratio 2:3" 식으로 보여주는 책임을 진다.
 */
export function openPoseCropOverlay(
  root: HTMLElement,
  sourceImageUrl: string,
  initialCropBox: CropBox | null | undefined,
  onCommit: (cropBox: CropBox, ratioLabel: string | null) => void
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

  // ── 비율 프리셋 툴바 ─────────────────────────────────────────────────────
  const ratioBar = el("div", { style: { display: "flex", alignItems: "center", gap: "6px", flexShrink: "0", flexWrap: "wrap" } });
  const ratioBtns: Record<string, HTMLElement> = {};
  let setActiveRatio: (key: string) => void = () => {}; // img.onload에서 실제 구현으로 교체됨
  RATIO_PRESETS.forEach((p) => {
    const b = el("button", { type: "button", text: p.key, style: btnStyle() });
    b.addEventListener("click", () => setActiveRatio(p.key));
    ratioBtns[p.key] = b;
    ratioBar.appendChild(b);
  });
  overlay.appendChild(ratioBar);

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

    // ── 비율 고정 — 프리셋이 activeRatio(w/h)를 고정하면, 아래 자유 리사이즈 수식 대신
    // 이 비율을 유지하는 리사이즈로 전환된다. "쌍"인 프리셋은 박스 옆에 가로/세로 전환
    // 스위치(⇔/⇕)를 보여준다.
    let activeRatio: number | null = null;
    let pairLandscape: number | null = null, pairPortrait: number | null = null;
    // 프리셋 키(예: "2:3") + 지금 landscape 방향인지 — Ratio 표시 텍스트("Ratio 2:3" 등)를
    // mountPose 쪽에서 만들 수 있게 onCommit에 함께 전달한다.
    let activeRatioBaseKey: string | null = null;
    function flipLabel(key: string): string {
      const [a, b] = key.split(":");
      return `${b}:${a}`;
    }
    function currentRatioLabel(): string | null {
      if (!activeRatioBaseKey) return null;
      // 프리셋 키(예: "2:3")는 항상 w<h(세로/portrait) 쪽 — pairPortrait와 일치할 때 그대로,
      // ⇔로 landscape(pairLandscape)로 뒤집혔으면 라벨도 뒤집는다. 쌍이 없는 프리셋(1:1)은
      // 항상 그대로.
      if (pairLandscape == null) return activeRatioBaseKey;
      return activeRatio === pairPortrait ? activeRatioBaseKey : flipLabel(activeRatioBaseKey);
    }
    const orientBar = el("div", { style: { position: "absolute", display: "none", gap: "4px", zIndex: "3" } });
    const wideBtn = el("button", { type: "button", text: "⇔", title: "Landscape (wide)", style: { width: "24px", height: "24px", borderRadius: "4px", border: "none", cursor: "pointer", fontSize: "13px" } });
    const tallBtn = el("button", { type: "button", text: "⇕", title: "Portrait (tall)", style: { width: "24px", height: "24px", borderRadius: "4px", border: "none", cursor: "pointer", fontSize: "13px" } });
    orientBar.appendChild(wideBtn);
    orientBar.appendChild(tallBtn);
    stage.appendChild(orientBar);
    function highlightOrientBtns() {
      const isWide = activeRatio === pairLandscape;
      wideBtn.style.background = isWide ? BRAND : C.bg2; wideBtn.style.color = isWide ? "#fff" : C.text;
      tallBtn.style.background = !isWide ? BRAND : C.bg2; tallBtn.style.color = !isWide ? "#fff" : C.text;
    }
    wideBtn.addEventListener("click", (e) => { e.stopPropagation(); if (pairLandscape) { activeRatio = pairLandscape; highlightOrientBtns(); resizeBoxToRatio(); } });
    tallBtn.addEventListener("click", (e) => { e.stopPropagation(); if (pairPortrait) { activeRatio = pairPortrait; highlightOrientBtns(); resizeBoxToRatio(); } });

    function highlightRatioBtn(key: string) {
      Object.entries(ratioBtns).forEach(([k, b]) => {
        b.style.background = k === key ? BRAND : C.bg2;
        b.style.color = k === key ? "#fff" : C.text;
      });
    }
    function resizeBoxToRatio() {
      if (activeRatio) {
        const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
        let newW = box.w, newH = newW / activeRatio;
        if (newH > img.naturalHeight) { newH = img.naturalHeight; newW = newH * activeRatio; }
        if (newW > img.naturalWidth) { newW = img.naturalWidth; newH = newW / activeRatio; }
        box = { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
      }
      render();
    }
    setActiveRatio = (key: string) => {
      const preset = RATIO_PRESETS.find((p) => p.key === key);
      if (!preset) return;
      if (!preset.w || !preset.h) {
        activeRatio = null; pairLandscape = pairPortrait = null; activeRatioBaseKey = null;
        orientBar.style.display = "none";
        highlightRatioBtn("Free"); render(); return;
      }
      activeRatioBaseKey = key;
      activeRatio = preset.w / preset.h;
      if (preset.pair) {
        pairLandscape = Math.max(preset.w, preset.h) / Math.min(preset.w, preset.h);
        pairPortrait = Math.min(preset.w, preset.h) / Math.max(preset.w, preset.h);
        orientBar.style.display = "flex"; highlightOrientBtns();
      } else {
        pairLandscape = pairPortrait = null; orientBar.style.display = "none";
      }
      highlightRatioBtn(key);
      resizeBoxToRatio();
    };
    highlightRatioBtn("Free");

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
      if (activeRatio) {
        // 자유모드 클램프처럼 각 축을 독립적으로 재계산하면 이미지 경계 근처에서 비율이
        // 어긋난다 — 면적 기준으로 클램프해서 W/H가 함께 줄어들며 비율이 정확히 유지되게 한다.
        if (box.w / box.h > activeRatio) box.w = box.h * activeRatio; else box.h = box.w / activeRatio;
      }
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
      orientBar.style.left = `${dx + dw + 6}px`; orientBar.style.top = `${dy}px`;
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
        // 비율 고정 리사이즈용 고정 앵커(반대쪽 모서리/변) — 여기서부터 커지거나 작아져야
        // 비율이 정확히 유지된다.
        const anchor = {
          x: h.includes("w") ? start.x + start.w : start.x,
          y: h.includes("n") ? start.y + start.h : start.y,
        };
        const move = (e2: PointerEvent) => {
          const ddx = (e2.clientX - start.mx) / toDisp, ddy = (e2.clientY - start.my) / toDisp;
          if (activeRatio) {
            // 앵커(반대쪽 모서리/변) 기준으로 리사이즈해야 비율이 정확히 유지된다. n/s
            // 핸들은 세로 이동량만으로(너비는 비율로 유도), e/w는 가로 이동량만으로,
            // 코너는 가로 이동량 기준. rawW/rawH는 자유모드와 동일하게 start.w±ddx /
            // start.h±ddy 방식이어야 한다(그냥 |ddx|/|ddy|만 쓰면 박스의 원래 크기가
            // 전혀 반영이 안 돼서 드래그할 때마다 작은 크기로 순간이동하는 버그가 생김
            // — 노드 쪽에서 실제로 겪은 버그).
            // 실제 버그였던 부분: x/y를 rawW/rawH의 부호로 판단하는 삼항연산(anchor 지나
            // 반대편으로 넘어갔는지 감지하려던 것)이 n/w처럼 앵커가 "반대쪽"에 있는 핸들에서
            // 방향이 뒤집혀 있었다 — 정상 드래그 범위에서도 박스가 앵커 반대편으로 순간이동
            // 하는 원인이었다(사용자: "왼쪽 상단/위쪽 중앙/왼쪽 중앙... 위치가 어긋난다").
            // 코너 분기의 y 공식(`h.includes("n") ? anchor.y - newH : anchor.y`, 부호 무관하게
            // 핸들 방향만으로 직접 계산)은 원래도 맞았다 — x/n-s쪽도 같은 방식으로 통일.
            let newW: number, newH: number;
            if (h === "n" || h === "s") {
              const rawH = h.includes("n") ? start.h - ddy : start.h + ddy;
              newH = Math.max(8, Math.abs(rawH)); newW = newH * activeRatio;
              const y = h.includes("n") ? anchor.y - newH : anchor.y;
              box = { x: anchor.x, y, w: newW, h: newH };
            } else {
              const rawW = h.includes("w") ? start.w - ddx : start.w + ddx;
              newW = Math.max(8, Math.abs(rawW)); newH = newW / activeRatio;
              const x = h.includes("w") ? anchor.x - newW : anchor.x;
              const y = h.includes("n") ? anchor.y - newH : anchor.y;
              box = { x, y, w: newW, h: newH };
            }
            render();
            return;
          }
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
      onCommit({ x: box.x, y: box.y, w: box.w, h: box.h }, currentRatioLabel());
      overlay.remove();
    };
  };
  sameOriginSrc(sourceImageUrl).then((s) => { img.src = s; }, () => { img.src = sourceImageUrl; });

  cancelBtn.onclick = () => overlay.remove();
  root.appendChild(overlay);
  return overlay;
}
