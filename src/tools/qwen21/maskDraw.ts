// maskDraw.ts — QWEN IMAGE 2.1 전용 드로잉/주석 도구.
// 원본 근거: web/qwen21/ui_mask_draw.js (Edit/Inpaint 공용, 2511에는 없는 신규 컴포넌트).
// pen/line/circle/rect 4개 툴 + 브러시 크기 슬라이더 + Undo/Clear + 키보드 단축키 + 지우개
// (오른쪽 클릭). 커밋 시 스트로크를 원본 이미지 위에 평평한 마젠타(#ff00c8)로 합성해 새
// 이미지로 업로드하고, 그 파일명은 "마스크"가 아니라 그래프에 추가되는 레퍼런스 이미지
// 한 장으로 취급된다 (SetLatentNoiseMask 아님).
import { C, BRAND, el } from "./core";
import { uploadAnnotationBlob } from "./api";

const HIGHLIGHT = "#ff00c8";

export type StrokeTool = "pen" | "line" | "circle" | "rect";
export interface Stroke {
  tool: StrokeTool;
  size: number;
  shift: boolean;
  erase?: boolean;
  points: { x: number; y: number }[];
}

function btnStyle() {
  return {
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "11px",
    padding: "4px 10px",
    borderRadius: "6px",
    background: C.bg2,
    color: C.text,
    border: `1px solid ${C.border}`,
  } as Partial<CSSStyleDeclaration>;
}

/**
 * 모달 드로잉 오버레이를 `root` 위에 연다. `previousStrokes`가 있으면 재편집(지우기/추가)
 * 가능하도록 그대로 이어서 그린다 — 원본 요구사항: "원본이미지와 드로잉 레이어 두개를 전부
 * 기억하고 있으면서 수정이 가능하게 되야 한다." onCommit(filename, strokes)는 사용자가
 * 합성된 이미지를 업로드했을 때 한 번 호출되고, strokes는 다음에 같은 이미지를 다시 열 때
 * 그대로 replay할 수 있도록 호출자가 저장해 둔다.
 */
export function openMaskDrawOverlay(
  root: HTMLElement,
  sourceImageUrl: string,
  onCommit: (filename: string, strokes: Stroke[]) => void,
  initialStrokes?: Stroke[]
): HTMLElement {
  const overlay = el("div", {
    style: {
      position: "absolute", inset: "0", zIndex: "9999", background: "rgba(11,11,11,0.97)",
      borderRadius: "inherit", display: "flex", flexDirection: "column", padding: "12px", gap: "8px", boxSizing: "border-box",
    },
  });

  const hdr = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" } });
  hdr.appendChild(el("div", { text: "Draw over the area to change", style: { color: "#fff", fontSize: "13px", fontWeight: "700", flex: "1" } }));

  const toolbar = el("div", { style: { display: "flex", alignItems: "center", gap: "6px", flexShrink: "0", flexWrap: "wrap" } });
  const TOOL_KEYS: Record<StrokeTool, string> = { pen: "P", line: "I", circle: "O", rect: "U" };
  const tools: StrokeTool[] = ["pen", "line", "circle", "rect"];
  let activeTool: StrokeTool = "pen";
  const toolBtns: Record<string, HTMLElement> = {};
  function setTool(tool: StrokeTool) {
    activeTool = tool;
    tools.forEach((t) => (toolBtns[t].style.background = t === activeTool ? BRAND : C.bg2));
  }
  tools.forEach((tool) => {
    const b = el("button", {
      type: "button", text: `${tool} (${TOOL_KEYS[tool]})`,
      style: {
        cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "4px 10px", borderRadius: "6px",
        background: tool === activeTool ? BRAND : C.bg2, color: "#fff", border: `1px solid ${C.border}`, textTransform: "capitalize",
      },
    });
    b.addEventListener("click", () => setTool(tool));
    toolBtns[tool] = b;
    toolbar.appendChild(b);
  });

  const sizeLabel = el("span", { text: "Brush ([/])", style: { color: C.muted, fontSize: "11px" } });
  const sizeSlider = el("input", { type: "range", min: "2", max: "60", value: "12", style: { width: "100px" } }) as HTMLInputElement;
  toolbar.appendChild(sizeLabel);
  toolbar.appendChild(sizeSlider);

  const undoBtn = el("button", { type: "button", text: "↺ Undo (\\)", style: btnStyle() });
  const clearBtn = el("button", { type: "button", text: "✕ Clear (⌫)", style: btnStyle() });
  toolbar.appendChild(undoBtn);
  toolbar.appendChild(clearBtn);

  const spacer = el("div", { style: { flex: "1" } });
  const hint = el("span", { text: "Right-click drag: erase", style: { color: C.muted, fontSize: "10px" } });
  const cancelBtn = el("button", { type: "button", text: "Cancel (Esc)", style: btnStyle() });
  const commitBtn = el("button", {
    type: "button", text: "✓ Commit as reference (Enter)",
    style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "6px 14px", borderRadius: "6px", background: BRAND, color: "#fff", border: "none", fontWeight: "700" },
  }) as HTMLButtonElement;
  toolbar.appendChild(hint);
  toolbar.appendChild(spacer);
  toolbar.appendChild(cancelBtn);
  toolbar.appendChild(commitBtn);

  hdr.appendChild(toolbar);
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

    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = img.naturalWidth;
    baseCanvas.height = img.naturalHeight;
    (baseCanvas.getContext("2d") as CanvasRenderingContext2D).drawImage(img, 0, 0);

    const stage = el("div", { style: { position: "relative", width: `${dispW}px`, height: `${dispH}px` } });
    const drawCanvas = el("canvas", {
      width: String(dispW), height: String(dispH),
      style: { position: "absolute", inset: "0", width: `${dispW}px`, height: `${dispH}px`, borderRadius: "6px", cursor: "none", touchAction: "none" },
    }) as HTMLCanvasElement;
    const cursorCanvas = el("canvas", {
      width: String(dispW), height: String(dispH),
      style: { position: "absolute", inset: "0", width: `${dispW}px`, height: `${dispH}px`, borderRadius: "6px", pointerEvents: "none" },
    }) as HTMLCanvasElement;
    stage.appendChild(drawCanvas);
    stage.appendChild(cursorCanvas);
    canvasWrap.appendChild(stage);
    const ctx = drawCanvas.getContext("2d") as CanvasRenderingContext2D;
    const cctx = cursorCanvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Strokes are painted onto their own offscreen layer first, then composited under the
    // photo onto drawCanvas — an eraser stroke (right-click) uses destination-out on THIS
    // layer only, so it removes previously drawn marks without touching the photo itself
    // (drawCanvas redraws the full image from scratch every frame, so erasing pixels
    // directly on it would erase the photo, not just the annotation).
    const annotCanvas = document.createElement("canvas");
    annotCanvas.width = dispW;
    annotCanvas.height = dispH;
    const actx = annotCanvas.getContext("2d") as CanvasRenderingContext2D;
    actx.lineCap = "round";
    actx.lineJoin = "round";

    const strokes: Stroke[] = [];
    if (Array.isArray(initialStrokes) && initialStrokes.length) {
      strokes.push(...(JSON.parse(JSON.stringify(initialStrokes)) as Stroke[]));
    }

    function drawStroke(c: CanvasRenderingContext2D, s: Stroke) {
      c.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
      c.strokeStyle = HIGHLIGHT;
      c.fillStyle = HIGHLIGHT;
      c.lineWidth = s.size;
      if (s.tool === "pen") {
        c.beginPath();
        s.points.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
        c.stroke();
      } else if (s.tool === "line" && s.points.length >= 2) {
        c.beginPath();
        c.moveTo(s.points[0].x, s.points[0].y);
        c.lineTo(s.points[1].x, s.points[1].y);
        c.stroke();
      } else if (s.tool === "circle" && s.points.length >= 2) {
        const [a, b] = s.points;
        if (s.shift) {
          // Shift: 중심에서 바깥으로 — a가 중심, 드래그 거리가 반지름.
          const r = Math.hypot(b.x - a.x, b.y - a.y);
          c.beginPath();
          c.arc(a.x, a.y, r, 0, Math.PI * 2);
          c.stroke();
        } else {
          // 기본: rect 툴처럼 좌상단 기준 바운딩 박스 — a→b 박스에 내접하는 타원.
          const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
          const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
          c.beginPath();
          c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          c.stroke();
        }
      } else if (s.tool === "rect" && s.points.length >= 2) {
        const [a, b] = s.points;
        if (s.shift) {
          // Shift: 중심에서 바깥으로 정사각형 — a가 중심.
          const half = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
          c.strokeRect(a.x - half, a.y - half, half * 2, half * 2);
        } else {
          c.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        }
      }
    }
    function redraw() {
      actx.clearRect(0, 0, dispW, dispH);
      strokes.forEach((s) => drawStroke(actx, s));
      ctx.clearRect(0, 0, dispW, dispH);
      ctx.drawImage(img, 0, 0, dispW, dispH);
      ctx.drawImage(annotCanvas, 0, 0);
    }
    function drawCursorRing(pos: { x: number; y: number } | null, size: number, erasing?: boolean) {
      cctx.clearRect(0, 0, dispW, dispH);
      if (!pos) return;
      cctx.beginPath();
      cctx.arc(pos.x, pos.y, Math.max(1, size / 2), 0, Math.PI * 2);
      cctx.strokeStyle = erasing ? "#ff4444" : "#ffffff";
      cctx.lineWidth = 1.5;
      cctx.stroke();
      cctx.beginPath();
      cctx.arc(pos.x, pos.y, Math.max(1, size / 2), 0, Math.PI * 2);
      cctx.strokeStyle = "#000000";
      cctx.lineWidth = 1;
      cctx.setLineDash([2, 2]);
      cctx.stroke();
      cctx.setLineDash([]);
    }

    // 원본 이미지는 오버레이가 열리자마자 즉시 보여야 한다 — 첫 스트로크까지 기다리면
    // 캔버스가 검게 보이는 버그가 실제로 있었다(원본 주석). 그래서 setup 직후 redraw()를 한 번 호출한다.
    redraw();

    let current: Stroke | null = null;
    function toLocal(e: PointerEvent) {
      const r = drawCanvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (dispW / r.width), y: (e.clientY - r.top) * (dispH / r.height) };
    }
    // 오른쪽 클릭 = 활성 툴과 무관하게 지우개, 왼쪽 클릭 = 기존과 동일하게 그리기.
    drawCanvas.addEventListener("contextmenu", (e) => e.preventDefault());
    drawCanvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      drawCanvas.setPointerCapture(e.pointerId);
      current = { tool: activeTool, size: +sizeSlider.value, shift: e.shiftKey, erase: e.button === 2, points: [toLocal(e)] };
      strokes.push(current);
    });
    drawCanvas.addEventListener("pointermove", (e) => {
      drawCursorRing(toLocal(e), +sizeSlider.value, !!current?.erase);
      if (!current) return;
      // shift는 pointerdown 때만이 아니라 매 move마다 읽는다 — 드래그 도중 누르거나 떼는
      // 경우(예: circle 기본 vs Shift 중심 원)를 즉시 반영하기 위함.
      current.shift = e.shiftKey;
      if (current.tool === "pen") current.points.push(toLocal(e));
      else current.points[1] = toLocal(e);
      redraw();
    });
    drawCanvas.addEventListener("pointerup", () => {
      current = null;
    });
    drawCanvas.addEventListener("pointerleave", () => drawCursorRing(null, +sizeSlider.value));

    function undo() {
      strokes.pop();
      redraw();
    }
    function clearAll() {
      strokes.length = 0;
      redraw();
    }
    function bumpBrush(delta: number) {
      const min = +sizeSlider.min, max = +sizeSlider.max;
      sizeSlider.value = String(Math.max(min, Math.min(max, +sizeSlider.value + delta)));
    }
    undoBtn.addEventListener("click", undo);
    clearBtn.addEventListener("click", clearAll);

    async function commit() {
      commitBtn.disabled = true;
      commitBtn.textContent = "Uploading…";
      try {
        const outCanvas = document.createElement("canvas");
        outCanvas.width = img.naturalWidth;
        outCanvas.height = img.naturalHeight;
        const octx = outCanvas.getContext("2d") as CanvasRenderingContext2D;
        octx.drawImage(baseCanvas, 0, 0);
        octx.drawImage(drawCanvas, 0, 0, dispW, dispH, 0, 0, img.naturalWidth, img.naturalHeight);
        const blob: Blob = await new Promise((res) => outCanvas.toBlob((b) => res(b as Blob), "image/png"));
        const filename = await uploadAnnotationBlob(blob, `q21_annot_${Date.now()}.png`);
        onCommit(filename, JSON.parse(JSON.stringify(strokes)));
        closeOverlay();
      } catch (e: any) {
        alert("Upload failed: " + (e.message || e));
      } finally {
        commitBtn.disabled = false;
        commitBtn.textContent = "✓ Commit as reference (Enter)";
      }
    }
    commitBtn.addEventListener("click", commit);

    // ── 키보드 단축키 — Pen=P/Line=I/Circle=O/Rect=U, 브러시 [ - / ] +, Undo=\, Clear=⌫,
    // Cancel=Esc, Commit=Enter. 브러시 슬라이더 자체에 포커스가 있을 땐 무시해서 화살표키로
    // 슬라이더를 조작하는 기본 동작을 막지 않는다.
    function onKeyDown(e: KeyboardEvent) {
      if (e.target === sizeSlider) return;
      switch (e.key) {
        case "p": case "P": setTool("pen"); break;
        case "i": case "I": setTool("line"); break;
        case "o": case "O": setTool("circle"); break;
        case "u": case "U": setTool("rect"); break;
        case "[": bumpBrush(-1); break;
        case "]": bumpBrush(1); break;
        case "\\": e.preventDefault(); undo(); break;
        case "Backspace": e.preventDefault(); clearAll(); break;
        case "Escape": e.preventDefault(); closeOverlay(); break;
        case "Enter": e.preventDefault(); commit(); break;
        default: return;
      }
    }
    function closeOverlay() {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
    }
    document.addEventListener("keydown", onKeyDown);
    cancelBtn.onclick = closeOverlay;
  };
  img.src = sourceImageUrl;

  cancelBtn.addEventListener("click", () => overlay.remove()); // overridden once the image loads, to also drop the keydown listener
  root.appendChild(overlay);
  return overlay;
}
