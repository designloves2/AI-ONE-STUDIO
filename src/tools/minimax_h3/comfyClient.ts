import { getComfyBase } from "../../shared/comfyBase";
// comfyClient.ts — ComfyUI 웹소켓 기반 큐잉/이벤트 클라이언트.
// 원본 ComfyUI 프론트엔드의 scripts/api.js(EventTarget 인터페이스)를 독립 사이트에서
// 재구현한 것 — §3-2 comfy-client.ts의 이 도구 전용 슬라이스. 다른 도구를 이식할 때
// 이 파일의 패턴(웹소켓 연결 + addEventListener 유사 인터페이스)을 그대로 재사용한다.
const BASE = getComfyBase();
const WS_BASE = BASE.replace(/^http/, "ws");

// sessionStorage에 탭 단위로 유지한다 — localStorage로 여러 탭이 공유하면 ComfyUI가
// progress/executing 같은 단방향(unicast) 이벤트를 그 중 아무 소켓에나 보내버려 실제
// 연결에는 아무것도 안 오는 문제가 생긴다(실제로 겪었음). 반대로 매 로드마다 완전히
// 새로 발급하면, 브라우저가 백그라운드 탭을 스스로 디스카드했다가 다시 그리는 경우
// (사용자가 새로고침을 누른 게 아닌데도 탭이 리셋된 것처럼 보이는 크롬 메모리 절약
// 동작) 새 clientId로 붙어버려서 서버가 진행 중이던 작업의 progress를 예전 소켓으로
// 계속 보내다 허공에 날려버린다 — 그래서 "이 화면이 큐잉한 작업이 아니면 표시 안 됨"
// 배너가 뜨고 릴레이도 거기서 멈춘다. sessionStorage는 탭 하나에만 묶이고 탭이 다시
// 그려질 때도 유지되니, 같은 clientId로 재연결하면 서버가 다음 progress부터는 새
// 소켓으로 다시 보내준다 — 두 문제를 동시에 피한다.
const CLIENT_ID = (() => {
  try {
    const existing = sessionStorage.getItem("mmh3_client_id");
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem("mmh3_client_id", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();

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

/**
 * Submit one graph and resolve once ComfyUI finishes executing it (or reject on error).
 *
 * Pass `existingPromptId` (and `promptGraph: null`) to re-attach to a job that was already
 * queued in an earlier page load instead of submitting a new one — the browser can silently
 * discard/reload a backgrounded tab (Chrome's memory-saver, no user refresh involved), which
 * wipes this function's in-flight promise but leaves the job running server-side. Re-attaching
 * checks /history first in case it already finished while the tab was gone, then falls back to
 * listening for the same events a fresh submission would.
 */
export function queuePrompt(
  promptGraph: Record<string, any> | null,
  opts?: { onProgress?: (v: number, m: number) => void; onQueued?: (promptId: string) => void; existingPromptId?: string }
): Promise<QueueResult> {
  return new Promise(async (resolve, reject) => {
    await connect();
    let promptId: string | null = opts?.existingPromptId || null;
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
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    function cleanup() {
      comfyApi.removeEventListener("progress", onProgress);
      comfyApi.removeEventListener("executed", onExecuted);
      comfyApi.removeEventListener("execution_success", onSuccess);
      comfyApi.removeEventListener("execution_error", onError);
      comfyApi.removeEventListener("execution_cancelled", onCancelled);
      comfyApi.removeEventListener("execution_interrupted", onCancelled);
      if (pollTimer) clearInterval(pollTimer);
    }
    comfyApi.addEventListener("progress", onProgress);
    comfyApi.addEventListener("executed", onExecuted);
    comfyApi.addEventListener("execution_success", onSuccess);
    comfyApi.addEventListener("execution_error", onError);
    comfyApi.addEventListener("execution_cancelled", onCancelled);
    comfyApi.addEventListener("execution_interrupted", onCancelled);

    if (opts?.existingPromptId) {
      // 재부착 — 이미 큐에 들어간 작업이니 다시 POST하지 않는다. 탭이 없던 사이에
      // 이미 끝나 있었을 수도 있으니 /history부터 확인하고, 아니면 위에서 건 리스너가
      // 다음 progress/executed/success 이벤트를 그대로 받아서 이어간다.
      try {
        const h = await comfyApi.fetchApi(`/history/${opts.existingPromptId}`);
        const hd = await h.json();
        const entry = hd?.[opts.existingPromptId];
        if (entry?.status?.completed) {
          cleanup();
          const outs: Record<string, any> = {};
          for (const nodeId in entry.outputs || {}) outs[nodeId] = entry.outputs[nodeId];
          resolve({ byNode: outs });
          return;
        }
        if (entry?.status?.status_str === "error") {
          cleanup();
          reject(new Error(entry.status?.messages?.map((m: any) => m?.[1]?.exception_message || "").filter(Boolean).join(" ") || "generation failed"));
          return;
        }
      } catch {
        // /history lookup failing doesn't mean the job is gone — just fall through and
        // check /queue below instead.
      }
      // Not in history (not done, not errored) — confirm it's actually still queued/running
      // before settling in to wait forever. If ComfyUI restarted while the tab was gone, the
      // old prompt_id is just gone and no WS event for it will ever arrive; failing fast here
      // beats leaving the UI stuck on "reconnecting…" indefinitely.
      try {
        const q = await comfyApi.fetchApi("/queue");
        const qd = await q.json();
        const stillThere = [...(qd.queue_running || []), ...(qd.queue_pending || [])].some((e: any) => e?.[1] === opts.existingPromptId);
        if (!stillThere) {
          cleanup();
          reject(new Error("Previous run not found in the ComfyUI queue — the server may have restarted or it's already gone."));
          return;
        }
      } catch (e) {
        cleanup();
        reject(e instanceof Error ? e : new Error("failed to check reconnection status"));
        return;
      }
      // Still queued/running — from here on, normally the WS listeners above catch completion.
      // But a real tab close+reopen mints a new clientId (comfyClient.ts's CLIENT_ID is
      // sessionStorage-scoped), so the server keeps routing progress/success events to the old,
      // now-dead socket and this reattach would otherwise wait forever. Poll /history as a
      // fallback so completion is still detected even if no WS event ever arrives.
      const pollId = opts.existingPromptId;
      pollTimer = setInterval(async () => {
        try {
          const h = await comfyApi.fetchApi(`/history/${pollId}`);
          const hd = await h.json();
          const entry = hd?.[pollId];
          if (entry?.status?.completed) {
            cleanup();
            const outs: Record<string, any> = {};
            for (const nodeId in entry.outputs || {}) outs[nodeId] = entry.outputs[nodeId];
            resolve({ byNode: outs });
          } else if (entry?.status?.status_str === "error") {
            cleanup();
            reject(new Error(entry.status?.messages?.map((m: any) => m?.[1]?.exception_message || "").filter(Boolean).join(" ") || "generation failed"));
          }
        } catch {
          // transient fetch failure — try again next tick
        }
      }, 5000);
      return;
    }

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
      if (promptId) opts?.onQueued?.(promptId);

      // /history poll as a completion fallback for the fresh-submission path too — not just
      // reattach. iOS Safari (and any browser) throttles or drops the WS on a long-running
      // backgrounded tab, especially over a tunnel; the job finishes server-side and the result
      // sits in /history but no `executed`/`execution_success` event ever reaches this socket,
      // so the promise would hang forever. Symptom seen in the wild: gallery chunked upscale
      // stuck on "preparing chunk 1/N" while the ComfyUI console shows "Prompt executed".
      if (promptId && !pollTimer) {
        const pid = promptId;
        pollTimer = setInterval(async () => {
          try {
            const h = await comfyApi.fetchApi(`/history/${pid}`);
            const hd = await h.json();
            const entry = hd?.[pid];
            if (entry?.status?.completed) {
              cleanup();
              const outs: Record<string, any> = { ...outputs };
              for (const nodeId in entry.outputs || {}) outs[nodeId] = entry.outputs[nodeId];
              resolve({ byNode: outs });
            } else if (entry?.status?.status_str === "error") {
              cleanup();
              reject(new Error(entry.status?.messages?.map((m: any) => m?.[1]?.exception_message || "").filter(Boolean).join(" ") || "generation failed"));
            }
          } catch {
            // transient fetch failure — retry next tick
          }
        }, 5000);
      }
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}
