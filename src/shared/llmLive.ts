// llmLive.ts — LLM live monitor: a small line at the bottom-left of the page for every running LLM call, fed by the
// `tj_llm_progress` websocket event (core LLM (TJ) node and the studio /tj_studio_one/llm/* routes). Port of the node's
// web/shared/llm_live.js (SPEC_RELAY_LLM_LIVE_LOG.md).
//
//   thinking · 210 tok · 17 tok/s · 12 s      (with the backend and model in front when several calls run at once)
//
// The local GGUF routes and ComfyUI TextGenerate stream (real counts, the line moves every ~0.7 s); OpenRouter / Custom send only a
// start and an end event, so for them the line shows the elapsed seconds (ticking here) and `~` counts at the end. If a streaming
// call is silent for 30 s the line says so.
// TextGenerate graphs that this page queues itself (native translate, native brief / image analysis, MusicMaker) do not use the
// studio routes: noteNativeGraph() remembers them and ComfyUI's own `progress` events (one per generated token) become the same line.
import { onComfyMessage, CLIENT_ID } from "./comfySocket";

export { CLIENT_ID as LLM_LIVE_CLIENT_ID };

interface LiveEvent {
  call_id: string; backend?: string; model?: string; phase: string;
  input_tokens?: number | null; output_tokens?: number | null; chars?: number; tok_per_sec?: number; elapsed_ms?: number;
  delta?: string; finish_reason?: string; estimated?: boolean;
}
interface Call { ev: LiveEvent; seen: number; start: number; hideAt: number }

const calls = new Map<string, Call>();   // call_id -> last event, when it came, start time, when to hide
let box: HTMLDivElement | null = null;

const TEXT: Record<string, string> = {
  prompt: "reading input", thinking: "thinking", answer: "writing", done: "done", error: "error",
  cut: "cut off (max tokens)", quiet: "no change for 30 s", sec: " s",
};

function ensureBox(): HTMLDivElement {
  if (box) return box;
  box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed", left: "12px", bottom: "12px", zIndex: "10001", display: "none", flexDirection: "column", gap: "4px",
    maxWidth: "min(720px, 90vw)", pointerEvents: "none", fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: "11px",
  });
  document.body.appendChild(box);
  return box;
}

function shortModel(m: any): string {
  const s = String(m || "").split(/[\\/]/).pop() || "";
  return s.length > 42 ? s.slice(0, 40) + "…" : s;
}

function lineText(c: Call, now: number, withName: boolean): string {
  const ev = c.ev;
  const approx = ev.estimated ? "~" : "";
  const secs = Math.max(Math.round((ev.elapsed_ms || 0) / 1000), Math.round((now - c.start) / 1000));
  const phase = TEXT[ev.phase] || ev.phase;
  const parts = withName ? [`${ev.backend}${ev.model ? " · " + shortModel(ev.model) : ""}`, phase] : [phase];
  if (ev.output_tokens) parts.push(`${approx}${ev.output_tokens} tok`);
  if (ev.tok_per_sec) parts.push(`${approx}${ev.tok_per_sec >= 10 ? Math.round(ev.tok_per_sec) : ev.tok_per_sec} tok/s`);
  parts.push(`${secs}${TEXT.sec}`);
  if (ev.finish_reason === "length") parts.push(TEXT.cut);
  if (ev.phase !== "done" && ev.phase !== "error" && now - c.seen > 30000 && ev.estimated === false) parts.push(TEXT.quiet);
  return parts.join(" · ");
}

function render() {
  const now = Date.now();
  for (const [id, c] of calls) if ((c.hideAt && now > c.hideAt) || now - c.seen > 30 * 60 * 1000) calls.delete(id);
  const b = ensureBox();
  if (!calls.size) { b.style.display = "none"; return; }
  b.style.display = "flex";
  const shown = [...calls.values()].slice(-3);
  b.replaceChildren(...shown.map((c) => {
    const row = document.createElement("div");
    const bad = c.ev.phase === "error" || c.ev.finish_reason === "length";
    Object.assign(row.style, {
      background: "rgba(20,20,28,0.92)", color: bad ? "#ff9a9a" : (c.ev.phase === "done" ? "#9be8a6" : "#e6e6f0"),
      border: "1px solid " + (bad ? "#8a3a3a" : "#3a3a55"), borderRadius: "6px", padding: "4px 9px", whiteSpace: "nowrap",
      overflow: "hidden", textOverflow: "ellipsis",
    });
    row.textContent = "🧠 " + lineText(c, now, shown.length > 1);
    return row;
  }));
}

function onEvent(ev: LiveEvent | null | undefined) {
  if (!ev || !ev.call_id) return;
  const now = Date.now();
  const prev = calls.get(ev.call_id);
  const ended = ev.phase === "done" || ev.phase === "error";
  calls.set(ev.call_id, { ev, seen: now, start: prev ? prev.start : now - (ev.elapsed_ms || 0),
    hideAt: ended ? now + (ev.phase === "error" ? 8000 : 5000) : 0 });
  render();
}

// ── ComfyUI TextGenerate run through the queue ─────────────────────────────────────────────────────────────────────────────
const natives = new Map<string, { nodes: Record<string, number>; model: string; start: number }>();   // prompt_id -> its TextGenerate nodes
// A cached graph can finish before the queue answer reaches this page: its end event arrives first, with nothing registered yet.
// Remember such prompt ids briefly so noteNativeGraph() does not open a line that nothing would ever close.
const endedEarly = new Map<string, number>();
function rememberEnded(pid: string) {
  const now = Date.now();
  endedEarly.set(pid, now);
  for (const [id, t] of endedEarly) if (now - t > 60000) endedEarly.delete(id);
}

/** Call right after a graph was queued from this page (with the prompt_id the server answered). Graphs without a TextGenerate node are ignored. */
export function noteNativeGraph(graph: any, promptId: any, api?: { addEventListener: (type: string, fn: (e: any) => void) => void }) {
  try {
    if (!graph || typeof graph !== "object" || !promptId) return;
    if (endedEarly.has(String(promptId))) return;
    const nodes: Record<string, number> = {};
    let model = "";
    for (const [id, n] of Object.entries<any>(graph)) {
      if (n?.class_type !== "TextGenerate" && n?.class_type !== "TextGenerateV2") continue;
      nodes[id] = Number(n.inputs?.max_length) || 0;
      const link = n.inputs?.clip;
      const loader = Array.isArray(link) ? graph[String(link[0])] : null;
      model = model || String(loader?.inputs?.clip_name || "");
    }
    if (!Object.keys(nodes).length) return;
    natives.set(String(promptId), { nodes, model, start: Date.now() });
    nativeEvent(promptId, "prompt", 0, 0);
    if (api) wireApi(api);
  } catch { /* never break a queue request */ }
}

function nativeEvent(promptId: any, phase: string, value: number, max: number, extra: Partial<LiveEvent> = {}) {
  const info = natives.get(String(promptId));
  if (!info) return;
  const elapsed = Date.now() - info.start;
  onEvent({ call_id: "native-" + promptId, backend: "ComfyUI TextGenerate", model: info.model, phase,
    input_tokens: null, output_tokens: value, chars: 0, estimated: false, delta: "",
    tok_per_sec: elapsed > 0 && value ? Math.round(value / (elapsed / 1000) * 10) / 10 : 0, elapsed_ms: elapsed,
    ...(max && value >= max ? { finish_reason: "length" } : {}), ...extra });
}

const onProgress = (d: any) => {
  const info = natives.get(String(d?.prompt_id));
  if (info && info.nodes[String(d.node)] !== undefined) nativeEvent(d.prompt_id, "answer", d.value, d.max);
};
const onEnd = (phase: string) => (d: any) => {
  const pid = String(d?.prompt_id || "");
  const info = natives.get(pid);
  if (!info) { if (pid) rememberEnded(pid); return; }
  const prev = calls.get("native-" + pid);
  nativeEvent(pid, phase, prev?.ev?.output_tokens || 0, Math.max(...Object.values(info.nodes)),
    { finish_reason: prev?.ev?.finish_reason || (phase === "error" ? "error" : "stop") });
  natives.delete(pid);
};
const onSuccess = onEnd("done"), onFail = onEnd("error");

// A tool's own client (ComfyUI sends a prompt's events only to the client that queued it) feeds the same handlers.
const wired = new WeakSet<object>();
function wireApi(api: { addEventListener: (type: string, fn: (e: any) => void) => void }) {
  if (wired.has(api)) return;
  wired.add(api);
  const d = (fn: (d: any) => void) => (e: any) => fn(e && typeof e === "object" && "detail" in e ? e.detail : e);
  api.addEventListener("progress", d(onProgress));
  api.addEventListener("execution_success", d(onSuccess));
  api.addEventListener("execution_error", d(onFail));
  api.addEventListener("execution_interrupted", d(onFail));
}

let started = false;
/** Start the monitor once for the whole page (listener on the shared websocket + the 1 s tick). */
export function startLlmLive() {
  if (started) return;
  started = true;
  onComfyMessage("tj_llm_progress", (ev: LiveEvent) => onEvent(ev));
  onComfyMessage("progress", onProgress);
  onComfyMessage("execution_success", onSuccess);
  onComfyMessage("execution_error", onFail);
  onComfyMessage("execution_interrupted", onFail);
  setInterval(() => { if (calls.size) render(); }, 1000);
}
