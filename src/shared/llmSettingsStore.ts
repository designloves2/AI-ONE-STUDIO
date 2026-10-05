// llmSettingsStore.ts — the image tools' LLM panel settings (backend, models, Connect Custom
// URL/model/context, Vision Task, Model Format, …) live on the SERVER (/tj_shared/llm_settings),
// so every browser and origin — the node and this web twin — sees the same ones.
// localStorage (`tj_studio_one_llm_settings`) is only a synchronous read cache of that copy:
// it is refreshed from the server before any panel is built (the top-level await below), and
// every save is pushed back. The server never holds an API key.
// Port of the node's web/shared/llm_panel.js (node 8290b40).
import { getComfyBase } from "./comfyBase";

const LS_KEY = "tj_studio_one_llm_settings";

// credentials: "include" — external access is behind Cloudflare Access (see comfyBase.ts).
const fetchApi = (path: string, opts?: RequestInit) => fetch(`${getComfyBase()}${path}`, { ...opts, credentials: "include" });

export function loadLLMSettings(): any {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
}

let _pushTimer: number | undefined;
function pushLLMSettings(s: any) {
  clearTimeout(_pushTimer);
  _pushTimer = window.setTimeout(() => {
    fetchApi("/tj_shared/llm_settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: s }),
    }).catch(() => {});
  }, 300);
}

export function saveLLMSettings(patch: any) {
  const s = loadLLMSettings();
  Object.assign(s, patch);
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
  pushLLMSettings(s);
}

async function syncLLMSettingsFromServer() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    const d = await (await fetchApi("/tj_shared/llm_settings", { signal: ctl.signal })).json();
    clearTimeout(timer);
    const server = d.settings || {};
    const local = loadLLMSettings();
    if (Object.keys(server).length) { try { localStorage.setItem(LS_KEY, JSON.stringify({ ...local, ...server })); } catch {} }
    else if (Object.keys(local).length) pushLLMSettings(local);   // first run: adopt what this browser had
  } catch { /* server unreachable: keep the local copy */ }
}
await syncLLMSettingsFromServer();
