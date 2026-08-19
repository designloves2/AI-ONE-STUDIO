// systemMonitor.ts — 상단바의 실시간 CPU/RAM/GPU/VRAM/GPU온도 표시.
// ComfyUI-Crystools(설치돼 있으면)가 자기 몫으로 이미 열어둔 모니터 스레드가 1초마다
// ComfyUI의 WebSocket으로 { type: "crystools.monitor", data: {...} }를 모든 연결된 클라이언트에
// 브로드캐스트한다(server.PromptServer.instance.send_sync) — 그래서 이 사이트는 별도 폴링 없이
// comfySocket.ts가 이미 열어둔 소켓에서 그 메시지를 받아 쓰면 된다. Crystools가 없으면 메시지가
// 안 와서 위젯이 그냥 "—"로 남는다(에러 아님, 조용히 비활성).
import { onComfyMessage } from "./comfySocket";

export interface GpuStat {
  gpu_utilization: number;
  gpu_temperature: number;
  vram_total: number;
  vram_used: number;
  vram_used_percent: number;
  name?: string;
}
export interface SystemStats {
  cpu_utilization: number;
  ram_used_percent: number;
  gpus: GpuStat[];
}

export function subscribeSystemStats(fn: (s: SystemStats) => void): () => void {
  return onComfyMessage("crystools.monitor", fn);
}
