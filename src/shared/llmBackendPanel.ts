// llmBackendPanel.ts — shared "Local GGUF | OpenRouter" backend selector for the image tools'
// prompt-expand LLM panels (Enhance + Image→Prompt).
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/shared/llm_panel.js `makeBackendBlock` (node 68064ac).
// 각 도구의 promptTools.ts는 자체 createPromptExpandOverlay를 갖고 있어서, 노드처럼 하나의
// 공유 패널로 합치는 대신 이 블록 하나만 공유한다. `llm.backend` / `llm.or_model` 을 in-place
// 로 갱신하고, 키 자체는 서버 `.env` 로 (뮤직 노드와 동일한 키).
import { getComfyBase } from "./comfyBase";
import { C } from "../identity";
import { searchableSelect } from "./ui";

// credentials: "include" — external access is behind Cloudflare Access (see comfyBase.ts).
const fetchApi = (path: string, opts?: RequestInit) => fetch(`${getComfyBase()}${path}`, { ...opts, credentials: "include" });

let _orModelsCache: string[] | null = null;
export async function fetchOrModels(): Promise<string[]> {
  if (_orModelsCache) return _orModelsCache;
  try {
    const r = await fetchApi("/music_one/openrouter_models");
    const d = await r.json();
    _orModelsCache = Array.isArray(d.models) ? d.models : [];
  } catch { _orModelsCache = []; }
  return _orModelsCache || [];
}

/** The masked `sk****…1234` hint for the shared OpenRouter key, or "" if none is set. */
export async function fetchLlmKeyHint(): Promise<string> {
  try {
    const d = await (await fetchApi("/tj_studio_one/llm/models")).json();
    return d.openrouter_key_hint || "";
  } catch { return ""; }
}

/** POST a patch to the shared LLM config (`or_model_text` / `or_model_vision` / `openrouter_key`). */
export function pushLlmConfig(patch: Record<string, any>) {
  fetchApi("/tj_studio_one/llm/config", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
  }).catch(() => {});
}

// The Enhance panel writes the prompt (text-only) → cheap text model; Image→Prompt reads
// pixels → multimodal model. Separate backend + OpenRouter model per role, one shared key
// (node 49422ca / 488bad2). Legacy single `backend` / `or_model` migrate into the text role.
export type LlmRole = "text" | "vision";

export interface LlmBackendState {
  backend?: string;          // legacy — migrated to backend_text on first use
  backend_text?: string;
  backend_vision?: string;
  or_model?: string;         // legacy / text OpenRouter model
  or_model_vision?: string;
  [k: string]: any;
}

interface Block {
  el: HTMLElement;
  /** labelRows only meaningful for the local backend — caller pushes its GGUF/GPU/ctx rows here. */
  localOnly: HTMLElement[];
  syncFromState: () => void;
  fill: (orModels: string[], keyHint: string) => void;
}

export interface LlmBackendGroup {
  /** role picks which backend + OpenRouter model the block edits — "text" → backend_text /
   *  or_model, "vision" → backend_vision / or_model_vision. Defaults to "text". */
  makeBlock: (role?: LlmRole) => Block;
  syncAll: () => void;
  fillAll: (orModels: string[], keyHint: string) => void;
  /** force every role to the OpenRouter backend (TJ_NODE local LLM not installed) */
  stripLocal: () => void;
}

function lblRow(text: string, control: HTMLElement) {
  const w = document.createElement("div");
  Object.assign(w.style, { display: "flex", flexDirection: "column", gap: "2px" });
  const l = document.createElement("div");
  l.textContent = text;
  Object.assign(l.style, { color: C.muted, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.04em" });
  w.append(l, control);
  return w;
}
function sel(options: string[], value: string, onChange: (v: string) => void) {
  const s = document.createElement("select");
  Object.assign(s.style, { background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "4px 6px", fontSize: "11px", width: "100%" });
  options.forEach((o) => { const op = document.createElement("option"); op.value = o; op.textContent = o; if (o === value) op.selected = true; s.appendChild(op); });
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

export function createLlmBackendGroup(state: LlmBackendState, save: () => void): LlmBackendGroup {
  const legacy = state.backend || "local";
  state.backend_text = state.backend_text || legacy;
  state.backend_vision = state.backend_vision || legacy;
  state.or_model = state.or_model || "";
  state.or_model_vision = state.or_model_vision || "";
  const blocks: Block[] = [];
  const syncAll = () => blocks.forEach((b) => b.syncFromState());
  const fillAll = (m: string[], k: string) => blocks.forEach((b) => b.fill(m, k));
  const stripLocal = () => {
    state.backend_text = "openrouter";
    state.backend_vision = "openrouter";
    save();
    pushLlmConfig({ backend_text: "openrouter", backend_vision: "openrouter" });
    blocks.forEach((b) => { b.localOnly.forEach((r) => r.remove()); b.localOnly.length = 0; b.syncFromState(); });
  };

  function makeBlock(role: LlmRole = "text"): Block {
    const getModel = () => (role === "vision" ? state.or_model_vision : state.or_model) || "";
    const setModel = (v: string) => {
      if (role === "vision") { state.or_model_vision = v; pushLlmConfig({ or_model_vision: v }); }
      else { state.or_model = v; pushLlmConfig({ or_model_text: v }); }
    };
    const getBackend = () => (role === "vision" ? state.backend_vision : state.backend_text) || "local";
    const setBackend = (b: string) => {
      if (role === "vision") { state.backend_vision = b; pushLlmConfig({ backend_vision: b }); }
      else { state.backend_text = b; pushLlmConfig({ backend_text: b }); }
    };
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { display: "flex", flexDirection: "column", gap: "6px", marginBottom: "2px" });

    const beSel = sel(["Local GGUF", "OpenRouter"], getBackend() === "openrouter" ? "OpenRouter" : "Local GGUF",
      (v) => { setBackend(v === "OpenRouter" ? "openrouter" : "local"); save(); syncAll(); });
    wrap.appendChild(lblRow(role === "vision" ? "Backend — vision (reads images)" : "Backend — text (writes prompt)", beSel));

    const orGroup = document.createElement("div");
    Object.assign(orGroup.style, { display: "flex", flexDirection: "column", gap: "6px" });
    // full OpenRouter list + filter box — no capability filter, user's choice (node d33aab3).
    const orSS = searchableSelect([getModel() || "Loading…"], getModel(),
      (v) => { setModel(v); save(); syncAll(); });
    orGroup.appendChild(lblRow(role === "vision" ? "OpenRouter model — vision (reads images)" : "OpenRouter model — text (writes prompt)", orSS.el));

    const keyInp = document.createElement("input");
    keyInp.type = "password";
    keyInp.placeholder = "sk-or-… (stored in .env)";
    Object.assign(keyInp.style, { background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "3px 5px", fontSize: "11px", width: "100%", boxSizing: "border-box" });
    keyInp.addEventListener("blur", () => {
      const v = keyInp.value.trim();
      if (!v || v.includes("*")) return;
      pushLlmConfig({ openrouter_key: v });
      keyInp.value = ""; keyInp.placeholder = "✓ key saved to .env";
    });
    orGroup.appendChild(lblRow("OpenRouter API key", keyInp));
    wrap.appendChild(orGroup);

    const block: Block = {
      el: wrap,
      localOnly: [],
      syncFromState() {
        beSel.value = getBackend() === "openrouter" ? "OpenRouter" : "Local GGUF";
        if (getModel()) orSS.setValue(getModel());
        const or = getBackend() === "openrouter";
        orGroup.style.display = or ? "flex" : "none";
        block.localOnly.forEach((r) => (r.style.display = or ? "none" : "flex"));
      },
      fill(orModels, keyHint) {
        if (orModels && orModels.length) {
          orSS.setOptions(orModels);
          if (!getModel()) {
            setModel(orModels.find((m) => /gemini-2\.5-flash/.test(m)) || orModels[0]);
            save();
          }
          orSS.setValue(getModel());
        }
        if (keyHint) keyInp.placeholder = keyHint + "  — click to replace";
      },
    };
    block.syncFromState();
    blocks.push(block);
    return block;
  }

  return { makeBlock, syncAll, fillAll, stripLocal };
}
