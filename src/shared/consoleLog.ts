// consoleLog.ts — ComfyUI 서버 콘솔 로그(백엔드 stdout/stderr)를 그대로 웹에서 본다.
// ComfyUI 코어에 이미 있는 기능을 그대로 씀: 시작 시 GET /internal/logs/raw로 버퍼(최근 300줄)를
// 받고, PATCH /internal/logs/subscribe로 이 클라이언트를 구독시키면 그 뒤로는 comfySocket의
// WebSocket에 type:"logs" 이벤트로 새 줄이 실시간으로 밀려온다(ComfyUI 자체 터미널 뷰어와 동일
// 메커니즘 — api_server/services/terminal_service.py).
import { COMFY_BASE, CLIENT_ID, onComfyMessage, comfyFetch } from "./comfySocket";

export interface LogEntry {
  t: string;
  m: string;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export async function getLogHistory(): Promise<LogEntry[]> {
  try {
    const r = await fetch(`${COMFY_BASE}/internal/logs/raw`, { credentials: "include" });
    const d = await r.json();
    return Array.isArray(d.entries) ? d.entries : [];
  } catch {
    return [];
  }
}

export function subscribeLiveLogs(fn: (entries: LogEntry[]) => void): () => void {
  comfyFetch("/internal/logs/subscribe", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: CLIENT_ID, enabled: true }),
  }).catch(() => {});

  const off = onComfyMessage("logs", (data) => {
    if (Array.isArray(data?.entries)) fn(data.entries);
  });

  return () => {
    off();
    comfyFetch("/internal/logs/subscribe", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: CLIENT_ID, enabled: false }),
    }).catch(() => {});
  };
}
