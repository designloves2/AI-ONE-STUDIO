// translateConfig.ts — the one Korean <-> English model setting every tool shares.
// Port of ComfyUI-TJ_NODE_STUDIO_ONE/web/shared/translate_config.js (node v1.49.0).
//
// It lives on the server (config_translate.json), not in a tool: any tool can change it and the server pushes the
// new value to every open page ("tj_translate_config"), so all tools see the same setting at the same moment.
// translateLlm() is the `llm(system, user) => text` function bilingual.ts needs.
import { comfyFetch, onComfyMessage } from "./comfySocket";
import { writeBriefNative } from "../tools/minimax_h3/api";
import type { LlmFn } from "./bilingual";

export interface TranslateConfig {
  backend: "native" | "openrouter" | "llamagguf" | "custom";
  native_clip: string; or_model: string; llama_model: string;
  llama_n_ctx: number; llama_max_tokens: number;
  custom_base: string; custom_model: string; custom_ctx: number;
}

const DEFAULTS: TranslateConfig = {
  backend: "native", native_clip: "", or_model: "", llama_model: "",
  llama_n_ctx: 16384, llama_max_tokens: 4096,
  custom_base: "", custom_model: "", custom_ctx: 0,
};

let cfg: TranslateConfig = { ...DEFAULTS };
let loaded: Promise<TranslateConfig> | null = null;
const listeners = new Set<(c: TranslateConfig) => void>();
const notify = () => listeners.forEach((fn) => { try { fn(cfg); } catch (e) { console.warn("[translate] listener:", e); } });

// the server pushes this whenever any tool saves the setting
onComfyMessage("tj_translate_config", (data) => { cfg = { ...DEFAULTS, ...(data || {}) }; notify(); });

/** The current setting (what the last load or push said). */
export function getTranslateConfig(): TranslateConfig { return cfg; }

/** Load it from the server once (later calls reuse the first answer). */
export function loadTranslateConfig(): Promise<TranslateConfig> {
  if (!loaded) {
    loaded = comfyFetch("/tj_shared/translate_config").then((r) => r.json())
      .then((d) => { cfg = { ...DEFAULTS, ...d }; notify(); return cfg; })
      .catch(() => cfg);
  }
  return loaded;
}

/** Call `fn(cfg)` whenever the setting changes (from this tool or any other). Returns an unsubscribe function. */
export function onTranslateConfig(fn: (c: TranslateConfig) => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

/** Save a change: shown here at once, stored on the server, pushed to every other tool. */
export async function setTranslateConfig(patch: Partial<TranslateConfig>) {
  cfg = { ...cfg, ...patch };
  notify();
  try {
    const r = await comfyFetch("/tj_shared/translate_config", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    const d = await r.json();
    if (d?.config) { cfg = { ...DEFAULTS, ...d.config }; notify(); }
  } catch (e) { console.warn("[translate] save failed:", e); }
}

/** `(system, user) => text` for the shared translate backend. (A browser fetch has no 60 s limit, so a slow local model just waits.) */
export function translateLlm(): LlmFn {
  return async (system, user) => {
    await loadTranslateConfig();
    const c = cfg;
    if (c.backend === "native") {
      if (!c.native_clip) throw new Error("No translate CLIP set - pick one in Settings -> Translation LLM.");
      return writeBriefNative(c.native_clip, system, user);
    }
    const r = await comfyFetch("/tj_shared/translate_llm", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ system, user }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "Translate failed");
    return d.text;
  };
}
