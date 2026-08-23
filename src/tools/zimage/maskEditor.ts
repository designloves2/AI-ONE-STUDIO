// maskEditor.ts — Inpaint 모드의 인라인 마스크 에디터 (브러시/지우개, 원본 해상도 캔버스).
// 원본 근거: web/zimage/ui_inpaint.js의 createDrawingEngine/createMaskEditor를 축약 이식
// — 팝업 대형 에디터는 생략하고 인라인 캔버스만 제공한다 (핵심 기능은 동일: 브러시로 칠한
// 영역이 흰색 마스크로 저장되어 DifferentialDiffusion 인페인트에 쓰인다).
import type { ZImageState } from "./core";
import { C, el } from "./core";
import { uploadImage, viewUrl } from "./api";

const DISP_W = 402; // 450px 좌측 패널 - panel 패딩

export function createMaskEditor(state: ZImageState, persist: () => void) {
  const maskRef: { canvas: HTMLCanvasElement | null; srcImg: HTMLImageElement | null; origW: number; origH: number } = { canvas: null, srcImg: null, origW: 0, origH: 0 };
  let tool: "brush" | "eraser" = "brush";
  let brushSize = 24;
  let isDrawing = false;
  let lastPos: { x: number; y: number } | null = null;

  const dispCanvas = el("canvas", { style: { display: "block", width: "100%", cursor: "crosshair", touchAction: "none" } }) as HTMLCanvasElement;
  const wrap = el("div", { style: { display: "none", position: "relative", width: `${DISP_W}px`, background: "#111", borderRadius: "6px", border: `1px solid ${C.border}`, overflow: "hidden" } });
  wrap.appendChild(dispCanvas);

  // 브러시 크기를 실제 화면 픽셀 원으로 보여주는 커스텀 커서 (SVG data-URI).
  function updateCursor() {
    const { origW } = maskRef;
    if (!origW) return;
    const rect = dispCanvas.getBoundingClientRect();
    if (!rect.width) return;
    const scale = rect.width / origW;
    const r = Math.max(1, Math.round(brushSize * scale));
    const s = r * 2 + 4;
    const color = tool === "eraser" ? "255,255,255" : "124,30,218";
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'><circle cx='${s / 2}' cy='${s / 2}' r='${r}' fill='rgba(${color},0.25)' stroke='rgba(${color},0.9)' stroke-width='1.5'/></svg>`;
    dispCanvas.style.cursor = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${s / 2} ${s / 2}, crosshair`;
  }

  function render() {
    const { canvas: maskCanvas, srcImg, origW, origH } = maskRef;
    if (!srcImg || !maskCanvas) return;
    const dctx = dispCanvas.getContext("2d")!;
    const dw = dispCanvas.width, dh = dispCanvas.height;
    dctx.clearRect(0, 0, dw, dh);
    dctx.drawImage(srcImg, 0, 0, origW, origH, 0, 0, dw, dh);
    const tmp = document.createElement("canvas");
    tmp.width = dw; tmp.height = dh;
    const tctx = tmp.getContext("2d")!;
    tctx.drawImage(maskCanvas, 0, 0, origW, origH, 0, 0, dw, dh);
    tctx.globalCompositeOperation = "source-in";
    tctx.fillStyle = "rgba(118,18,218,0.55)";
    tctx.fillRect(0, 0, dw, dh);
    dctx.drawImage(tmp, 0, 0);
  }

  function toOrig(e: PointerEvent) {
    const { origW, origH } = maskRef;
    const r = dispCanvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * origW, y: ((e.clientY - r.top) / r.height) * origH };
  }

  function dot(pos: { x: number; y: number }) {
    const mctx = maskRef.canvas!.getContext("2d")!;
    mctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    mctx.fillStyle = tool === "eraser" ? "rgba(0,0,0,1)" : "white";
    mctx.beginPath();
    mctx.arc(pos.x, pos.y, brushSize, 0, Math.PI * 2);
    mctx.fill();
    mctx.globalCompositeOperation = "source-over";
    render();
  }
  function stroke(from: { x: number; y: number }, to: { x: number; y: number }) {
    const mctx = maskRef.canvas!.getContext("2d")!;
    mctx.lineCap = "round"; mctx.lineJoin = "round"; mctx.lineWidth = brushSize * 2;
    mctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    mctx.strokeStyle = mctx.fillStyle = tool === "eraser" ? "rgba(0,0,0,1)" : "white";
    mctx.beginPath(); mctx.moveTo(from.x, from.y); mctx.lineTo(to.x, to.y); mctx.stroke();
    mctx.beginPath(); mctx.arc(to.x, to.y, brushSize, 0, Math.PI * 2); mctx.fill();
    mctx.globalCompositeOperation = "source-over";
    render();
  }

  dispCanvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dispCanvas.setPointerCapture(e.pointerId);
    if (e.button !== 0) return;
    isDrawing = true;
    lastPos = toOrig(e);
    dot(lastPos);
  });
  dispCanvas.addEventListener("pointermove", (e) => {
    e.preventDefault();
    if (!isDrawing) return;
    const pos = toOrig(e);
    if (lastPos) stroke(lastPos, pos);
    lastPos = pos;
  });
  const endDraw = () => { isDrawing = false; lastPos = null; };
  dispCanvas.addEventListener("pointerup", endDraw);
  dispCanvas.addEventListener("pointercancel", endDraw);

  // ── 툴바 ──────────────────────────────────────────────────────────────
  function btn(text: string, onClick: () => void) {
    return el("button", { type: "button", text, style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "4px 8px", borderRadius: "6px", border: `1px solid ${C.border}`, background: C.bg2, color: "#fff" }, onclick: onClick });
  }
  const brushBtn = btn("✏ Brush", () => { tool = "brush"; syncToolBtns(); updateCursor(); });
  const eraserBtn = btn("◻ Eraser", () => { tool = "eraser"; syncToolBtns(); updateCursor(); });
  function syncToolBtns() {
    brushBtn.style.background = tool === "brush" ? BRAND_LOCAL : C.bg2;
    eraserBtn.style.background = tool === "eraser" ? BRAND_LOCAL : C.bg2;
  }
  const BRAND_LOCAL = "#7c1eda";
  syncToolBtns();

  const clearBtn = btn("✕ Clear", () => {
    if (!maskRef.canvas) return;
    maskRef.canvas.getContext("2d")!.clearRect(0, 0, maskRef.origW, maskRef.origH);
    render();
    state.inpaintMaskImage = null;
    persist();
  });

  const sizeValEl = el("span", { text: `${brushSize}px`, style: { color: C.text, fontSize: "11px", minWidth: "28px", display: "inline-block", textAlign: "right" } });
  const sizeRange = el("input", { type: "range", min: "2", max: "150", step: "1" }) as HTMLInputElement;
  sizeRange.value = String(brushSize);
  sizeRange.style.cssText = "flex:1;min-width:60px;";
  sizeRange.addEventListener("input", () => { brushSize = parseInt(sizeRange.value); sizeValEl.textContent = `${brushSize}px`; updateCursor(); });

  const toolRow = el("div", { style: { display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", marginBottom: "4px" } });
  const sizeRow = el("div", { style: { display: "flex", alignItems: "center", gap: "4px", flex: "1" } }, [el("span", { text: "Size:", style: { color: C.muted, fontSize: "11px" } }), sizeRange, sizeValEl]);
  toolRow.append(brushBtn, eraserBtn, clearBtn, sizeRow);

  const hint = el("div", { text: "Paint the area to regenerate (purple) with the brush. Use the eraser to remove.", style: { color: C.muted, fontSize: "9px", marginBottom: "4px" } });

  const saveMaskBtn = el("button", {
    type: "button", text: "💾 Save Mask",
    style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "6px 12px", borderRadius: "6px", border: "none", background: "#7c1eda", color: "#fff", fontWeight: "700", flex: "1" },
  }) as HTMLButtonElement;
  saveMaskBtn.addEventListener("click", async () => {
    const saved = await saveMask();
    saveMaskBtn.textContent = saved ? "✓ Saved" : "Save failed";
    setTimeout(() => (saveMaskBtn.textContent = "💾 Save Mask"), 1500);
  });

  async function saveMask(): Promise<boolean> {
    if (!maskRef.canvas || !maskRef.origW) return false;
    const out = document.createElement("canvas");
    out.width = maskRef.origW; out.height = maskRef.origH;
    const octx = out.getContext("2d")!;
    octx.fillStyle = "black"; octx.fillRect(0, 0, maskRef.origW, maskRef.origH);
    octx.drawImage(maskRef.canvas, 0, 0);
    const blob: Blob = await new Promise((r) => out.toBlob((b) => r(b!), "image/png"));
    const name = await uploadImage(blob, `zit_mask_${Date.now()}.png`);
    state.inpaintMaskImage = name;
    persist();
    return true;
  }

  const editorPanel = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } }, [wrap, toolRow, hint, saveMaskBtn]);
  editorPanel.style.display = "none";

  function loadSourceImage(filename: string | null) {
    if (!filename) { editorPanel.style.display = "none"; return; }
    const img = new Image();
    img.onload = () => {
      maskRef.srcImg = img;
      maskRef.origW = img.naturalWidth;
      maskRef.origH = img.naturalHeight;
      const dh = Math.round((maskRef.origH * DISP_W) / maskRef.origW);
      dispCanvas.width = DISP_W;
      dispCanvas.height = dh;
      wrap.style.display = "block";
      maskRef.canvas = document.createElement("canvas");
      maskRef.canvas.width = maskRef.origW;
      maskRef.canvas.height = maskRef.origH;

      if (state.inpaintMaskImage) {
        const mImg = new Image();
        mImg.onload = () => {
          const tmp = document.createElement("canvas");
          tmp.width = maskRef.origW; tmp.height = maskRef.origH;
          const tctx = tmp.getContext("2d")!;
          tctx.drawImage(mImg, 0, 0, maskRef.origW, maskRef.origH);
          const imgData = tctx.getImageData(0, 0, maskRef.origW, maskRef.origH);
          for (let i = 0; i < imgData.data.length; i += 4) imgData.data[i + 3] = imgData.data[i];
          tctx.putImageData(imgData, 0, 0);
          maskRef.canvas!.getContext("2d")!.drawImage(tmp, 0, 0);
          render();
        };
        mImg.onerror = () => render();
        mImg.src = viewUrl(state.inpaintMaskImage, "", "input", Date.now());
      } else {
        render();
      }
      editorPanel.style.display = "flex";
      requestAnimationFrame(updateCursor);
    };
    img.onerror = () => {};
    img.src = viewUrl(filename, "", "input", Date.now());
  }

  async function autoSaveIfNeeded(): Promise<boolean> {
    if (state.inpaintMaskImage) return true;
    if (!maskRef.canvas || !maskRef.origW) return false;
    const data = maskRef.canvas.getContext("2d")!.getImageData(0, 0, maskRef.origW, maskRef.origH).data;
    let hasPixels = false;
    for (let i = 3; i < data.length; i += 4) { if (data[i] > 10) { hasPixels = true; break; } }
    if (!hasPixels) return false;
    return saveMask();
  }

  return { editorPanel, loadSourceImage, autoSaveIfNeeded };
}
