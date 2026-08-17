import { getComfyBase } from "../../shared/comfyBase";
// comfyClient.ts — ComfyUI 웹소켓 큐잉/이벤트 클라이언트 (Qwen Image 2511).
// Krea2/H3와 동일 패턴 — clientId는 탭/페이지 로드마다 새로 발급 (localStorage에 영구 저장하면
// 유령 소켓이 progress/executed 이벤트를 가로채는 문제가 있었음, 이 세션에서 실제로 겪은 버그).
const BASE = getComfyBase();
const WS_BASE = BASE.replace(/^http/, "ws");

const CLIENT_ID = crypto.randomUUID();

type Listener = (detail: any) => void;
const listeners = new Map<string, Set<Listener>>();
let wsReady: Promise<void> | null = null;

function dispatch(type: string, detail: any) {
  listeners.get(type)?.forEach((fn) => {
    try {
      fn(detail);
    } catch (e) {
      console.error(`[klein/comfyClient] listener for "${type}" threw`, e);
    }
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
    return fetch(`${BASE}${path}`, opts);
  },
};

export interface QueueResult {
  byNode: Record<string, any>;
}

export function queuePrompt(promptGraph: Record<string, any>, opts?: { onProgress?: (v: number, m: number) => void }): Promise<QueueResult> {
  return new Promise(async (resolve, reject) => {
    await connect();
    let promptId: string | null = null;
    const outputs: Record<string, any> = {};

    const onProgress = (d: any) => {
      if (!opts?.onProgress) return;
      const { value, max } = d || {};
      if (max) opts.onProgress(value, max);
    };
    const onExecuted = (d: any) => {
      if (d?.prompt_id && promptId && d.prompt_id !== promptId) return;
      if (d?.node != null && d?.output) outputs[d.node] = d.output;
    };
    const onSuccess = (d: any) => {
      if (d?.prompt_id && promptId && d.prompt_id !== promptId) return;
      cleanup();
      resolve({ byNode: outputs });
    };
    const onError = (d: any) => {
      if (d?.prompt_id && promptId && d.prompt_id !== promptId) return;
      cleanup();
      reject(new Error(d?.exception_message || "generation failed"));
    };
    const onCancelled = (d: any) => {
      if (d?.prompt_id && promptId && d.prompt_id !== promptId) return;
      cleanup();
      reject(new Error("cancelled"));
    };
    function cleanup() {
      comfyApi.removeEventListener("progress", onProgress);
      comfyApi.removeEventListener("executed", onExecuted);
      comfyApi.removeEventListener("execution_success", onSuccess);
      comfyApi.removeEventListener("execution_error", onError);
      comfyApi.removeEventListener("execution_cancelled", onCancelled);
      comfyApi.removeEventListener("execution_interrupted", onCancelled);
    }
    comfyApi.addEventListener("progress", onProgress);
    comfyApi.addEventListener("executed", onExecuted);
    comfyApi.addEventListener("execution_success", onSuccess);
    comfyApi.addEventListener("execution_error", onError);
    comfyApi.addEventListener("execution_cancelled", onCancelled);
    comfyApi.addEventListener("execution_interrupted", onCancelled);

    try {
      const resp = await comfyApi.fetchApi("/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptGraph, client_id: CLIENT_ID }),
      });
      const data = await resp.json();
      if (data.error) {
        cleanup();
        const detail = data.node_errors ? ` (${Object.keys(data.node_errors).join(", ")})` : "";
        reject(new Error((data.error.message || "queue failed") + detail));
        return;
      }
      promptId = data.prompt_id;
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}
