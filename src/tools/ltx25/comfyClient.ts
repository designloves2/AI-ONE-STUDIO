import { getComfyBase, getComfyWsBase } from "../../shared/comfyBase";
// comfyClient.ts — ComfyUI websocket + fetch client for LTX 2.5 ONE STUDIO.
// Gives the ported node code the same `api` surface it was written against (ComfyUI's scripts/api.js):
// addEventListener(type, ev => ev.detail...), removeEventListener, clientId, fetchApi.
const BASE = getComfyBase();
const WS_BASE = getComfyWsBase();

// One id per browser tab (sessionStorage) so a reconnect after the tab was discarded keeps receiving progress.
const CLIENT_ID = (() => {
  try {
    const existing = sessionStorage.getItem("ltx25_client_id");
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem("ltx25_client_id", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();

type Handler = (ev: { detail: any }) => void;
const listeners = new Map<string, Set<Handler>>();
let wsReady: Promise<void> | null = null;

function dispatch(type: string, detail: any) {
  listeners.get(type)?.forEach((fn) => {
    try { fn({ detail }); } catch (e) { console.error(`[ltx25/comfyClient] listener for "${type}" threw`, e); }
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
      } catch { /* not JSON */ }
    });
    socket.addEventListener("close", () => {
      wsReady = null;
      setTimeout(() => connect(), 2000);   // reconnect: a drop mid-generation would lose the progress
    });
    socket.addEventListener("error", () => {});
  });
  return wsReady;
}

export const comfyApi = {
  clientId: CLIENT_ID,
  base: BASE,
  ensureConnected: connect,
  addEventListener(type: string, fn: Handler) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
    void connect();
  },
  removeEventListener(type: string, fn: Handler) {
    listeners.get(type)?.delete(fn);
  },
  async fetchApi(path: string, opts?: RequestInit) {
    // credentials: "include" — external access sits behind Cloudflare Access (CF_Authorization cookie).
    return fetch(`${BASE}${path}`, { ...opts, credentials: "include" });
  },
};
