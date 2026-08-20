// systemMonitorWidget.ts — 상단바에 들어가는 CPU/RAM/GPU/VRAM/GPU온도 가로형 라벨미터 5개.
// 각 미터는 사각 박스 안에 채움 막대(%)를 채우고 그 위에 텍스트(%)를 오버랩해서 보여준다.
import { C, BRAND } from "../identity";
import { subscribeSystemStats, type SystemStats } from "./systemMonitor";

const BOX_W = 46;
const BOX_H = 15;

// 부하 구간별 색: 10% 미만 파랑 → 30%부터 보라(브랜드색) → 50%부터 주황 → 70%부터 빨강.
// 구간 사이는 부드럽게 섞이고, 10% 미만/70% 이상은 각각 그 색으로 고정.
const COLOR_STOPS: [number, [number, number, number]][] = [
  [0, [59, 130, 246]], // blue
  [10, [59, 130, 246]], // blue
  [30, hexToRgb(BRAND)], // purple (brand)
  [50, hexToRgb(C.warn)], // orange
  [70, hexToRgb(C.err)], // red
  [100, hexToRgb(C.err)], // red
];

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}

function colorFor(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const [p0, c0] = COLOR_STOPS[i];
    const [p1, c1] = COLOR_STOPS[i + 1];
    if (p >= p0 && p <= p1) {
      const t = p1 === p0 ? 0 : (p - p0) / (p1 - p0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return `rgb(${r},${g},${b})`;
    }
  }
  return C.err;
}

function meter(labelText: string) {
  const wrap = document.createElement("div");
  wrap.className = "aos-sysmon-meter";
  wrap.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:1px;";

  const label = document.createElement("div");
  label.textContent = labelText;
  label.style.cssText = `font-size:8px;line-height:1;color:${C.muted};letter-spacing:0.03em;`;
  wrap.appendChild(label);

  const box = document.createElement("div");
  box.className = "aos-sysmon-box";
  box.style.cssText = `position:relative;width:${BOX_W}px;height:${BOX_H}px;border-radius:3px;background:${C.bg2};border:1px solid ${C.border};overflow:hidden;`;
  wrap.appendChild(box);

  const fill = document.createElement("div");
  fill.style.cssText = "position:absolute;inset:0 auto 0 0;width:0%;transition:width 0.4s ease,background 0.4s ease;";
  box.appendChild(fill);

  const text = document.createElement("div");
  text.textContent = "—";
  text.style.cssText =
    "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
    "font-size:9px;font-weight:700;color:#fff;text-shadow:0 0 2px rgba(0,0,0,0.9),0 0 1px rgba(0,0,0,0.9);";
  box.appendChild(text);

  function set(pct: number | null, displayText?: string) {
    if (pct == null || !isFinite(pct)) {
      fill.style.width = "0%";
      text.textContent = "—";
      return;
    }
    const clamped = Math.max(0, Math.min(100, pct));
    fill.style.width = `${clamped}%`;
    fill.style.background = colorFor(clamped);
    text.textContent = displayText ?? `${Math.round(clamped)}%`;
  }

  return { el: wrap, set };
}

export function createSystemMonitorWidget(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "aos-sysmon aos-sysmon-bar";
  bar.style.cssText = "display:flex;align-items:center;gap:6px;flex-shrink:0;padding:0 4px;";

  const cpu = meter("CPU");
  const ram = meter("RAM");
  const gpu = meter("GPU");
  const vram = meter("VRAM");
  const temp = meter("TEMP");
  bar.append(cpu.el, ram.el, gpu.el, vram.el, temp.el);

  function apply(s: SystemStats) {
    cpu.set(s.cpu_utilization);
    ram.set(s.ram_used_percent);
    const g = s.gpus?.[0];
    if (g) {
      gpu.set(g.gpu_utilization);
      vram.set(g.vram_used_percent);
      // 온도는 %가 아니라 실제 섭씨값 — 막대는 0~100°C 스케일로 채우되 텍스트는 실제 값을 보여준다.
      temp.set(g.gpu_temperature, `${Math.round(g.gpu_temperature)}°`);
    } else {
      gpu.set(null);
      vram.set(null);
      temp.set(null);
    }
  }

  subscribeSystemStats(apply);
  return bar;
}
