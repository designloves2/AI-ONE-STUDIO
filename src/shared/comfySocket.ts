// comfySocket.ts — 상단바 위젯들(시스템 모니터, 콘솔 로그)이 공유하는 단일 ComfyUI WebSocket.
// 각 도구는 자기만의 clientId로 별도 소켓을 쓰지만, 이 소켓들은 도구 페이지와 무관하게 항상
//떠 있는 topbar 위젯용이라 페이지 전환에 영향받지 않는 자체 clientId/소켓 하나만 쓴다.
import { getComfyBase } from "./comfyBase";

export const COMFY_BASE = getComfyBase();
export const CLIENT_ID = crypto.randomUUID();

type Listener = (data: any) => void;
const listeners = new Map<string, Set<Listener>>();
let socket: WebSocket | null = null;

function connect() {
  if (socket) return;
  const wsBase = COMFY_BASE.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsBase}/ws?clientId=${CLIENT_ID}`);
  socket = ws;
  ws.addEventListener("message", (ev) => {
    if (typeof ev.data !== "string") return;
    try {
      const msg = JSON.parse(ev.data);
      if (msg?.type) listeners.get(msg.type)?.forEach((fn) => fn(msg.data));
    } catch {}
  });
  ws.addEventListener("close", () => {
    socket = null;
    setTimeout(connect, 3000);
  });
  ws.addEventListener("error", () => {});
}

export function onComfyMessage(type: string, fn: Listener): () => void {
  connect();
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type)!.add(fn);
  return () => listeners.get(type)?.delete(fn);
}

export async function comfyFetch(path: string, opts?: RequestInit) {
  return fetch(`${COMFY_BASE}${path}`, opts);
}
