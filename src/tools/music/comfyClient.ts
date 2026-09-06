import { getComfyBase, getComfyWsBase } from "../../shared/comfyBase";
// comfyClient.ts — ComfyUI 웹소켓 기반 이벤트/큐 클라이언트 (MusicMaker).
// MiniMax H3의 comfyClient.ts와 동일 패턴. 원본 노드(one_node_music.js)는 ComfyUI의
// scripts/api.js(`api`)를 그대로 썼고 — `api.clientId`, `api.fetchApi`,
// `api.addEventListener("progress"|"executing")` — 독립 사이트에서는 그 인터페이스를
// 이 파일이 재현한다. clientId는 sessionStorage 탭 단위(§ H3 주석 참고).
const BASE = getComfyBase();
const WS_BASE = getComfyWsBase();

const CLIENT_ID = (() => {
  try {
    const existing = sessionStorage.getItem("mmm_client_id");
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem("mmm_client_id", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();

type Listener = (detail: any) => void;
const listeners = new Map<string, Set<Listener>>();
let wsReady: Promise<void> | null = null;

function dispatch(type: string, detail: any) {
  listeners.get(type)?.forEach((fn) => {
    try { fn(detail); } catch (e) { console.error(`[music/comfyClient] listener for "${type}" threw`, e); }
  });
}

function connect(): Promise<void> {
  if (wsReady) return wsReady;
  wsReady = new Promise((resolve) => {
    const socket = new WebSocket(`${WS_BASE}/ws?clientId=${CLIENT_ID}`);
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("message", (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg && msg.type) dispatch(msg.type, msg.data);
      } catch {}
    });
    socket.addEventListener("close", () => {
      wsReady = null;
      setTimeout(() => connect(), 2000);
    });
    socket.addEventListener("error", () => {});
  });
  return wsReady;
}

export const comfyApi = {
  clientId: CLIENT_ID,
  base: BASE,
  ensureConnected: connect,
  addEventListener(type: string, fn: Listener) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
    connect();
  },
  removeEventListener(type: string, fn: Listener) {
    listeners.get(type)?.delete(fn);
  },
  async fetchApi(path: string, opts?: RequestInit) {
    // credentials: "include" — external access is behind Cloudflare Access.
    return fetch(`${BASE}${path}`, { ...opts, credentials: "include" });
  },
};
