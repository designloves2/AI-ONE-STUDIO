// angleScene.ts — ANGLE 모드의 인터랙티브 3D 카메라 각도 컨트롤(링/호/막대를 드래그).
// 원본 근거: web/qwen2511/ui_angle_qe.js의 createScene() — Qwen2511 고유 기능이라 축약 없이
// 거의 그대로 이식한다(클릭 없이 라인 위에서 바로 드래그하는 hover-drag 인터랙션 포함).
export interface AngleSceneState {
  angleHorizontal: number;
  angleVertical: number;
  angleZoom: number;
}

const H_OPTS = [
  { label: "front view", value: 0 },
  { label: "front-right view", value: 45 },
  { label: "right view", value: 90 },
  { label: "back-right view", value: 135 },
  { label: "back view", value: 180 },
  { label: "back-left view", value: 225 },
  { label: "left view", value: 270 },
  { label: "front-left view", value: 315 },
];
const V_OPTS = [
  { label: "low-angle shot", value: -30 },
  { label: "eye-level shot", value: 0 },
  { label: "elevated shot", value: 30 },
  { label: "high-angle shot", value: 60 },
];
const Z_OPTS = [
  { label: "close-up", value: 1 },
  { label: "medium shot", value: 5 },
  { label: "wide shot", value: 10 },
];

const V_MIN = -45, V_MAX = 75, Z_MIN = 1, Z_MAX = 10;
const H_OFFSET = 320;

export const ANGLE_H_OPTS = H_OPTS;
export const ANGLE_V_OPTS = V_OPTS;
export const ANGLE_Z_OPTS = Z_OPTS;

export function nearestH(d: number) {
  const a = ((d % 360) + 360) % 360;
  return H_OPTS.reduce((b, o) => (Math.abs(((o.value - a + 540) % 360) - 180) < Math.abs(((b.value - a + 540) % 360) - 180) ? o : b), H_OPTS[0]);
}
export function nearestV(d: number) {
  return V_OPTS.reduce((b, o) => (Math.abs(o.value - d) < Math.abs(b.value - d) ? o : b), V_OPTS[1]);
}
export function nearestZ(z: number) {
  return Z_OPTS.reduce((b, o) => (Math.abs(o.value - z) < Math.abs(b.value - z) ? o : b), Z_OPTS[1]);
}

const COL_H = "#e91e8c", COL_V = "#00e5c8", COL_Z = "#ffd740", COL_CAM = "#e91e8c";

export function createAngleScene(st: AngleSceneState, imgElGetter: () => HTMLImageElement | null, onChange: (axis: "h" | "v" | "z", val: number) => void) {
  const W = 280, SH = 280;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = SH;
  cv.style.cssText = `width:${W}px;height:${SH}px;display:block;margin:0 auto;cursor:default;border-radius:8px;`;
  const ctx = cv.getContext("2d")!;

  const VIEW_ELEV = (28 * Math.PI) / 180;
  const VIEW_AZ = ((360 - H_OFFSET) * Math.PI) / 180;
  const CX = W / 2, CY = SH * 0.54, R = W * 0.37;

  function proj(wx: number, wy: number, wz: number): [number, number, number] {
    const ca = Math.cos(VIEW_AZ), sa = Math.sin(VIEW_AZ);
    const rx = wx * ca + wz * sa;
    const rz0 = -wx * sa + wz * ca;
    const ry = wy * Math.cos(VIEW_ELEV) - rz0 * Math.sin(VIEW_ELEV);
    const rz = wy * Math.sin(VIEW_ELEV) + rz0 * Math.cos(VIEW_ELEV);
    return [CX + R * rx, CY - R * ry, rz];
  }

  function nearestOnRing(mx: number, my: number) {
    let bestDisplay = 0, bestDist = Infinity;
    for (let i = 0; i < 360; i++) {
      const worldA = ((i + H_OFFSET) % 360) * (Math.PI / 180);
      const [sx, sy] = proj(Math.sin(worldA), 0, Math.cos(worldA));
      const d = Math.hypot(mx - sx, my - sy);
      if (d < bestDist) { bestDist = d; bestDisplay = i; }
    }
    return { dist: bestDist, value: bestDisplay };
  }
  const ARC_R = 1.22;
  function nearestOnArc(mx: number, my: number) {
    const h = st.angleHorizontal ?? 0;
    const worldHr = ((h + H_OFFSET) % 360) * (Math.PI / 180);
    let bestV = 0, bestDist = Infinity;
    for (let vi = V_MIN * 2; vi <= V_MAX * 2; vi++) {
      const vd = vi * 0.5;
      const vr = (vd * Math.PI) / 180;
      const [sx, sy] = proj(ARC_R * Math.cos(vr) * Math.sin(worldHr), ARC_R * Math.sin(vr), ARC_R * Math.cos(vr) * Math.cos(worldHr));
      const d = Math.hypot(mx - sx, my - sy);
      if (d < bestDist) { bestDist = d; bestV = vd; }
    }
    return { dist: bestDist, value: bestV };
  }
  function nearestOnRod(mx: number, my: number) {
    const sub = proj(0, 0.05, 0);
    const h = st.angleHorizontal ?? 0, v = st.angleVertical ?? 0;
    const worldHr = ((h + H_OFFSET) % 360) * (Math.PI / 180), vr = (v * Math.PI) / 180;
    const cam = proj(Math.cos(vr) * Math.sin(worldHr), Math.sin(vr), Math.cos(vr) * Math.cos(worldHr));
    const dx = cam[0] - sub[0], dy = cam[1] - sub[1];
    const len2 = dx * dx + dy * dy;
    if (len2 < 4) return { dist: Infinity, value: st.angleZoom ?? 4 };
    let t = ((mx - sub[0]) * dx + (my - sub[1]) * dy) / len2;
    t = Math.max(0.05, Math.min(0.95, t));
    const px = sub[0] + t * dx, py = sub[1] + t * dy;
    return { dist: Math.hypot(mx - px, my - py), value: Z_MIN + t * (Z_MAX - Z_MIN) };
  }

  function flatDot(sx: number, sy: number, r: number, color: string) {
    ctx.save();
    ctx.fillStyle = color; ctx.globalAlpha = 0.92;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, 2 * Math.PI); ctx.stroke();
    ctx.restore();
  }
  function glowLine(seg: [number, number][], color: string, lw: number, alpha = 0.9) {
    if (seg.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = lw * 2.8; ctx.globalAlpha = alpha * 0.18;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); seg.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))); ctx.stroke();
    ctx.lineWidth = lw; ctx.globalAlpha = alpha;
    ctx.beginPath(); seg.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))); ctx.stroke();
    ctx.restore();
  }

  const pts = { h: { sx: 0, sy: 0 }, v: { sx: 0, sy: 0 }, z: { sx: 0, sy: 0 } };

  function draw() {
    ctx.clearRect(0, 0, W, SH);
    const h = st.angleHorizontal ?? 0, v = st.angleVertical ?? 0, z = st.angleZoom ?? 5;
    const worldHr = ((h + H_OFFSET) % 360) * (Math.PI / 180);
    const vr = (v * Math.PI) / 180;
    const cvx = Math.cos(vr) * Math.sin(worldHr), cvy = Math.sin(vr), cvz = Math.cos(vr) * Math.cos(worldHr);
    const [csx, csy] = proj(cvx, cvy, cvz);
    const planeFacingViewer = cvz * Math.cos(VIEW_ELEV) - cvy * Math.sin(VIEW_ELEV);
    const isBack = planeFacingViewer < 0;

    ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, W, SH);

    const N = 120, backR: [number, number][] = [], frontR: [number, number][] = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * 2 * Math.PI;
      const [sx, sy, sz] = proj(Math.sin(a), 0, Math.cos(a));
      (sz < 0 ? backR : frontR).push([sx, sy]);
    }
    glowLine(backR, COL_H, 3.5, 0.22);
    glowLine(frontR, COL_H, 3.5, 0.85);

    {
      const fwr = (H_OFFSET * Math.PI) / 180;
      const [frx, fry] = proj(Math.sin(fwr), 0, Math.cos(fwr));
      const [fox, foy] = proj(1.28 * Math.sin(fwr), 0, 1.28 * Math.cos(fwr));
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.38)"; ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(frx, fry); ctx.lineTo(fox, foy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.52)";
      ctx.font = "bold 8px 'Segoe UI',sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText("FRONT / 0°", fox, foy + 1);
      ctx.restore();
    }

    const [hsx, hsy] = proj(Math.sin(worldHr), 0, Math.cos(worldHr));
    pts.h.sx = hsx; pts.h.sy = hsy;

    const arcBack: [number, number][] = [], arcFront: [number, number][] = [];
    for (let i = 0; i <= 80; i++) {
      const vv = ((-40 + i) * Math.PI) / 180;
      const [sx, sy, sz] = proj(ARC_R * Math.cos(vv) * Math.sin(worldHr), ARC_R * Math.sin(vv), ARC_R * Math.cos(vv) * Math.cos(worldHr));
      (sz < 0 ? arcBack : arcFront).push([sx, sy]);
    }
    glowLine(arcBack, COL_V, 3, 0.22);
    glowLine(arcFront, COL_V, 3, 0.88);

    const [vsx, vsy] = proj(ARC_R * Math.cos(vr) * Math.sin(worldHr), ARC_R * Math.sin(vr), ARC_R * Math.cos(vr) * Math.cos(worldHr));
    pts.v.sx = vsx; pts.v.sy = vsy;

    const vr_plane = -vr;
    const right = [Math.cos(worldHr), 0, -Math.sin(worldHr)];
    const px = Math.cos(vr_plane) * Math.sin(worldHr), py = Math.sin(vr_plane), pz = Math.cos(vr_plane) * Math.cos(worldHr);
    const camDir = [-px, -py, -pz];
    const upV = [
      right[1] * camDir[2] - right[2] * camDir[1],
      right[2] * camDir[0] - right[0] * camDir[2],
      right[0] * camDir[1] - right[1] * camDir[0],
    ];
    const scX = 0.52, scY = 0.68;
    const corners = ([[-scX, +scY], [scX, +scY], [scX, -scY], [-scX, -scY]] as [number, number][]).map(([rx, ry]) =>
      proj(rx * right[0] + ry * upV[0], rx * right[1] + ry * upV[1], rx * right[2] + ry * upV[2])
    );
    const sc = corners.map((c) => [c[0], c[1]] as [number, number]);

    ctx.save();
    ctx.beginPath(); ctx.moveTo(sc[0][0], sc[0][1]);
    sc.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.closePath(); ctx.clip();

    const imgEl = imgElGetter();
    if (imgEl && imgEl.naturalWidth > 0) {
      const [x0, y0] = sc[0], [x1, y1] = sc[1], [x3, y3] = sc[3];
      const iw = imgEl.naturalWidth, ih = imgEl.naturalHeight;
      ctx.transform((x1 - x0) / iw, (y1 - y0) / iw, (x3 - x0) / ih, (y3 - y0) / ih, x0, y0);
      ctx.drawImage(imgEl, 0, 0);
    } else {
      ctx.fillStyle = "rgba(40,40,80,0.55)"; ctx.fill();
      ctx.strokeStyle = "rgba(90,90,160,0.35)"; ctx.lineWidth = 0.7;
      for (let t = 0.25; t < 1; t += 0.25) {
        const a: [number, number] = [sc[0][0] + (sc[1][0] - sc[0][0]) * t, sc[0][1] + (sc[1][1] - sc[0][1]) * t];
        const b: [number, number] = [sc[3][0] + (sc[2][0] - sc[3][0]) * t, sc[3][1] + (sc[2][1] - sc[3][1]) * t];
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      for (let t = 0.33; t < 1; t += 0.33) {
        const a: [number, number] = [sc[0][0] + (sc[3][0] - sc[0][0]) * t, sc[0][1] + (sc[3][1] - sc[0][1]) * t];
        const b: [number, number] = [sc[1][0] + (sc[2][0] - sc[1][0]) * t, sc[1][1] + (sc[2][1] - sc[1][1]) * t];
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    }
    ctx.restore();

    if (isBack) {
      ctx.save();
      ctx.beginPath(); ctx.moveTo(sc[0][0], sc[0][1]);
      sc.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.closePath(); ctx.clip();
      ctx.fillStyle = "rgba(0,0,0,0.58)"; ctx.fill();
      ctx.restore();
    }

    ctx.save(); ctx.strokeStyle = COL_CAM; ctx.lineWidth = 1.8; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(sc[0][0], sc[0][1]);
    sc.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.closePath(); ctx.stroke();
    ctx.restore();

    const sub = proj(0, 0.05, 0);
    ctx.save(); ctx.strokeStyle = COL_Z; ctx.lineWidth = 2.2; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(sub[0], sub[1]); ctx.lineTo(csx, csy); ctx.stroke();
    ctx.restore();

    const zfrac = (z - Z_MIN) / (Z_MAX - Z_MIN);
    const zpx = sub[0] + (csx - sub[0]) * zfrac, zpy = sub[1] + (csy - sub[1]) * zfrac;
    pts.z.sx = zpx; pts.z.sy = zpy;

    flatDot(csx, csy, 4, COL_CAM);
    flatDot(zpx, zpy, 6, COL_Z);
    flatDot(hsx, hsy, 6, COL_H);
    flatDot(vsx, vsy, 6, COL_V);
  }

  const THRESH_RING = 15, THRESH_ARC = 15, THRESH_ROD = 13;
  let dragging: "h" | "v" | "z" | null = null;

  function getScaled(e: MouseEvent): [number, number] {
    const rect = cv.getBoundingClientRect(), s = W / rect.width;
    return [(e.clientX - rect.left) * s, (e.clientY - rect.top) * s];
  }
  function detectLine(mx: number, my: number) {
    const ring = nearestOnRing(mx, my), arc = nearestOnArc(mx, my), rod = nearestOnRod(mx, my);
    const cands: { axis: "h" | "v" | "z"; dist: number; val: number }[] = [];
    if (ring.dist < THRESH_RING) cands.push({ axis: "h", dist: ring.dist, val: ring.value });
    if (arc.dist < THRESH_ARC) cands.push({ axis: "v", dist: arc.dist, val: arc.value });
    if (rod.dist < THRESH_ROD) cands.push({ axis: "z", dist: rod.dist, val: rod.value });
    if (!cands.length) return null;
    cands.sort((a, b) => a.dist - b.dist);
    return cands[0];
  }

  cv.addEventListener("mousedown", (e) => {
    const [mx, my] = getScaled(e);
    const hit = detectLine(mx, my);
    if (hit) {
      dragging = hit.axis;
      onChange(hit.axis, hit.val);
      cv.style.cursor = "grabbing";
      e.preventDefault();
    }
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const [mx, my] = getScaled(e);
    let val: number;
    if (dragging === "h") val = nearestOnRing(mx, my).value;
    else if (dragging === "v") val = nearestOnArc(mx, my).value;
    else val = nearestOnRod(mx, my).value;
    onChange(dragging, val);
  });
  document.addEventListener("mouseup", () => {
    if (dragging) { dragging = null; cv.style.cursor = "default"; }
  });
  cv.addEventListener("mousemove", (e) => {
    if (dragging) return;
    const [mx, my] = getScaled(e);
    cv.style.cursor = detectLine(mx, my) ? "grab" : "default";
  });
  cv.addEventListener("mouseleave", () => { if (!dragging) cv.style.cursor = "default"; });

  draw();
  return { el: cv, draw };
}
