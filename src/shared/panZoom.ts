// panZoom.ts — one zoom / pan / fit gesture set for every image viewer (result previews, compare views, gallery lightboxes):
//   wheel = zoom around the cursor · left-drag = pan · double-click = fit.
// Port of ComfyUI-TJ_NODE_STUDIO_ONE/web/shared/pan_zoom.js (node 6056b8a).
// The element(s) in `targets` are transformed (center origin), the host stays put and clips them.
// Anything inside the host marked data-pz-ignore, and any button, never starts a pan.
// `enabled` (optional) switches the whole gesture set off, e.g. while there is no result or the zoom lock is on.

type Targets = HTMLElement[] | (() => Iterable<HTMLElement>);

export function attachPanZoom(host: HTMLElement, targets: Targets, { max = 8, enabled = null }: { max?: number; enabled?: (() => boolean) | null } = {}) {
  let z = 1, px = 0, py = 0;
  let drag: { x: number; y: number; px: number; py: number } | null = null;
  const on = () => !enabled || enabled();
  const list = (): HTMLElement[] => (typeof targets === "function" ? [...targets()] : targets);

  host.style.userSelect = "none";
  host.style.touchAction = "none";

  function clampPan() {
    const lx = host.clientWidth * (z - 1) / 2, ly = host.clientHeight * (z - 1) / 2;
    px = Math.max(-lx, Math.min(lx, px)); py = Math.max(-ly, Math.min(ly, py));
  }
  function apply() {
    for (const t of list()) {
      (t as HTMLImageElement).draggable = false;
      t.style.transformOrigin = "center center";
      t.style.transform = z === 1 ? "" : `translate(${px}px, ${py}px) scale(${z})`;
    }
    host.style.cursor = z > 1 ? (drag ? "grabbing" : "grab") : "";
  }
  function reset() { z = 1; px = 0; py = 0; drag = null; apply(); }

  host.addEventListener("wheel", (e) => {
    if (!on()) return;
    e.preventDefault(); e.stopPropagation();
    const r = host.getBoundingClientRect();
    const cx = e.clientX - r.left - r.width / 2, cy = e.clientY - r.top - r.height / 2;
    const prev = z;
    z = Math.min(max, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    const k = z / prev;
    px = cx - (cx - px) * k; py = cy - (cy - py) * k;
    if (z === 1) { px = 0; py = 0; }
    clampPan(); apply();
  }, { passive: false });

  // Pointers: one finger / left mouse button pans (when zoomed), two fingers pinch-zoom around their midpoint,
  // a double tap fits (touch screens do not always fire dblclick with touch-action none).
  const pts = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; z: number; px: number; py: number; mx: number; my: number } | null = null;
  let lastTap = 0, tapMoved = false;
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const mid = () => { const [a, b] = [...pts.values()]; const r = host.getBoundingClientRect(); return { x: (a.x + b.x) / 2 - r.left - r.width / 2, y: (a.y + b.y) / 2 - r.top - r.height / 2 }; };

  host.addEventListener("pointerdown", (e) => {
    if (!on() || (e.pointerType === "mouse" && e.button !== 0) || (e.target as HTMLElement).closest("[data-pz-ignore], button")) return;
    e.preventDefault(); e.stopPropagation();          // no native image drag, no text selection, nothing underneath reacts
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { host.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (pts.size === 2) {
      drag = null; const m = mid();
      pinch = { d: dist(), z, px, py, mx: m.x, my: m.y };
    } else if (pts.size === 1) {
      tapMoved = false;
      if (z > 1) { drag = { x: e.clientX, y: e.clientY, px, py }; apply(); }
    }
  });
  host.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size >= 2) {
      tapMoved = true;
      const m = mid();
      const nz = Math.min(max, Math.max(1, pinch.z * dist() / pinch.d));
      const k = nz / pinch.z;
      z = nz;
      px = m.x - (pinch.mx - pinch.px) * k; py = m.y - (pinch.my - pinch.py) * k;
      if (z === 1) { px = 0; py = 0; }
      clampPan(); apply();
      return;
    }
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 6) tapMoved = true;
    px = drag.px + (e.clientX - drag.x); py = drag.py + (e.clientY - drag.y);
    clampPan(); apply();
  });
  const end = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    const wasSingle = pts.size === 1;
    pts.delete(e.pointerId);
    pinch = null;
    if (pts.size === 1) { const [p] = [...pts.values()]; drag = z > 1 ? { x: p.x, y: p.y, px, py } : null; }
    else if (drag) { drag = null; }
    apply();
    if (e.type === "pointerup" && e.pointerType !== "mouse" && wasSingle && !tapMoved) {
      const now = Date.now();
      if (now - lastTap < 320) { reset(); lastTap = 0; } else lastTap = now;
    }
  };
  host.addEventListener("pointerup", end);
  host.addEventListener("pointercancel", end);
  host.addEventListener("dblclick", (e) => { if (!on()) return; e.preventDefault(); e.stopPropagation(); reset(); });
  host.addEventListener("dragstart", (e) => e.preventDefault(), true);

  // A new picture in the host (gallery prev / next) starts fitted.
  new MutationObserver(reset).observe(host, { childList: true });
  apply();
  return { reset };
}

/** Before / after view: both pictures zoom and pan together, the compare bar stays where it is. */
export function createCompareView(originalURL: string, resultURL: string, accent = "#7612DA"): HTMLElement {
  const container = document.createElement("div");
  Object.assign(container.style, { position: "relative", width: "100%", height: "100%", overflow: "hidden", borderRadius: "8px" });

  const fit = { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain", display: "block" };
  const resultImg = document.createElement("img"); resultImg.src = resultURL; Object.assign(resultImg.style, fit);
  const origImg = document.createElement("img"); origImg.src = originalURL; Object.assign(origImg.style, fit);
  // The original sits in its own un-transformed layer, so the clip follows the bar, not the zoom.
  const origLayer = document.createElement("div");
  Object.assign(origLayer.style, { position: "absolute", inset: "0", overflow: "hidden" });
  origLayer.appendChild(origImg);

  const divider = document.createElement("div");
  divider.dataset.pzIgnore = "1";
  Object.assign(divider.style, { position: "absolute", top: "0", bottom: "0", left: "0", width: "3px", background: "rgba(255,255,255,0.85)", cursor: "ew-resize", zIndex: "10", touchAction: "none" });
  const handle = document.createElement("div");
  handle.textContent = "⟺";
  Object.assign(handle.style, { position: "absolute", top: "50%", left: "-10px", transform: "translateY(-50%)", width: "20px", height: "40px", borderRadius: "10px", background: accent, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "11px", userSelect: "none" });
  divider.appendChild(handle);

  function update(p: number) {
    p = Math.max(0, Math.min(100, p));
    origLayer.style.clipPath = `inset(0 ${100 - p}% 0 0)`;
    divider.style.left = `${p}%`;
  }
  update(0);
  divider.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    divider.setPointerCapture(e.pointerId);
    const move = (e2: PointerEvent) => { const r = container.getBoundingClientRect(); update((e2.clientX - r.left) / r.width * 100); };
    const up = () => { divider.removeEventListener("pointermove", move); divider.removeEventListener("pointerup", up); };
    divider.addEventListener("pointermove", move); divider.addEventListener("pointerup", up);
  });

  container.append(resultImg, origLayer, divider);
  attachPanZoom(container, [resultImg, origImg]);
  return container;
}
