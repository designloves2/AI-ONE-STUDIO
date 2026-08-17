import { getComfyBase } from "../../shared/comfyBase";
// comfyClient.ts — ComfyUI 웹소켓 기반 큐잉/이벤트 클라이언트.
// 원본 ComfyUI 프론트엔드의 scripts/api.js(EventTarget 인터페이스)를 독립 사이트에서
// 재구현한 것 — §3-2 comfy-client.ts의 이 도구 전용 슬라이스. 다른 도구를 이식할 때
// 이 파일의 패턴(웹소켓 연결 + addEventListener 유사 인터페이스)을 그대로 재사용한다.
const BASE = getComfyBase();
const WS_BASE = BASE.replace(/^http/, "ws");

// 탭/페이지 로드마다 새로 발급한다 — localStorage에 영구 저장해서 여러 탭이나 이전
// 세션의 유령 소켓과 같은 clientId를 공유하면, ComfyUI가 progress/executing 같은
// 단방향(unicast) 이벤트를 그 중 아무 소켓에나 보내버려 실제 연결에는 아무것도 안
// 오는 문제가 생긴다(실제로 겪었음) — 매번 고유해야 이런 충돌이 생기지 않는다.
const CLIENT_ID = crypto.randomUUID();

type Listener = (detail: any) => void;
const listeners = new Map<string, Set<Listener>>();
let ws: WebSocket | null = null;
let wsReady: Promise<void> | null = null;

function dispatch(type: string, detail: any) {
  listeners.get(type)?.forEach((fn) => {
    try {
      fn(detail);
    } catch (e) {
      console.error(`[comfyClient] listener for "${type}" threw`, e);
    }
  });
}

function connect(): Promise<void> {
  if (wsReady) return wsReady;
  wsReady = new Promise((resolve) => {
    const socket = new WebSocket(`${WS_BASE}/ws?clientId=${CLIENT_ID}`);
    ws = socket;
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("message", (ev) => {
      if (typeof ev.data !== "string") return; // binary preview frames not used here
      try {
        const msg = JSON.parse(ev.data);
        if (msg && msg.type) dispatch(msg.type, msg.data);
      } catch {}
    });
    socket.addEventListener("close", () => {
      ws = null;
      wsReady = null;
      // 재연결 — 생성 도중 끊기면 진행률을 놓치므로 몇 초 뒤 다시 붙는다.
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

/** Submit one graph and resolve once ComfyUI finishes executing it (or reject on error). */
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
