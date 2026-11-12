// nativeLlmOpts.ts — ComfyUI-native "Generate Text" (TextGenerateV2 / TextGenerate) detail options, one set shared by every tool.
// Port of the node's web/shared/native_llm_opts.js (SPEC_RELAY_H3_IMAGE_OFFICIAL.md section 3).
// Stored in the browser (localStorage) so H3 / LTX / Music / the image tools all send the same values.
//
//   nativeGenNode(clipRef, prompt, { images, maxLength })  → { class_type, inputs } for a queue graph
//   mountNativeLLMOptions(parent)                          → the settings block (put it in any LLM settings tab)
import { getComfyBase } from "./comfyBase";

const KEY = "tj_native_llm_opts_v1";

export interface NativeLlmOpts {
  max_length: number;
  sampling: boolean;          // Sampling Mode: on / off
  temperature: number;
  top_k: number;
  top_p: number;
  min_p: number;
  repetition_penalty: number;
  presence_penalty: number;
  seed: number;
  thinking: boolean;
  use_default_template: boolean;
  mtp: string;                // auto | on | off  (multi-token prediction)
}

export const NATIVE_LLM_DEFAULTS: NativeLlmOpts = {
  max_length: 2048,
  sampling: true,
  temperature: 0.7,
  top_k: 64,
  top_p: 0.95,
  min_p: 0.05,
  repetition_penalty: 1.05,
  presence_penalty: 0,
  seed: 0,
  thinking: false,
  use_default_template: true,
  mtp: "auto",
};

export function loadNativeLLMOpts(): NativeLlmOpts {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...NATIVE_LLM_DEFAULTS, ...(o && typeof o === "object" ? o : {}) };
  } catch { return { ...NATIVE_LLM_DEFAULTS }; }
}
export function saveNativeLLMOpts(o: Partial<NativeLlmOpts>) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...NATIVE_LLM_DEFAULTS, ...o })); } catch { /* storage blocked: the defaults stay */ }
}

/** max tokens / temperature / seed of the saved block, for the studio LLM routes when the backend is ComfyUI native (node `nativeNums`). */
export function nativeNums(backend: string | undefined): Record<string, number> {
  if (backend !== "comfy") return {};
  const o = loadNativeLLMOpts();
  return { max_tokens: o.max_length, temperature: o.temperature, seed: o.seed };
}

// Is the new "Generate Text" node (TextGenerateV2) installed? Looked up once.
let v2: Promise<boolean> | null = null;
function hasV2(): Promise<boolean> {
  if (!v2) {
    v2 = fetch(`${getComfyBase()}/object_info/TextGenerateV2`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((j: any) => !!j?.TextGenerateV2)
      .catch(() => false);
  }
  return v2;
}

/**
 * Build the text-generation node for a queue graph with the user's options.
 * @param clipRef  ["clipNodeId", 0]
 * @param opts.images  a node link (e.g. ["batch", 0]) for the image input, or null
 * @param opts.maxLength  overrides the saved max_length when given a number (> 0): the larger of the two is used
 * @param opts.system  system prompt (V2 only; otherwise the caller has already merged it into `prompt`)
 */
export async function nativeGenNode(clipRef: any, prompt: string, { images = null, maxLength = 0, system = "" }: { images?: any; maxLength?: number; system?: string } = {}) {
  const o = loadNativeLLMOpts();
  const isV2 = await hasV2();
  const inputs: Record<string, any> = {
    clip: clipRef, prompt,
    max_length: maxLength > 0 ? Math.max(Number(maxLength), o.max_length) : o.max_length,
    thinking: !!o.thinking, use_default_template: !!o.use_default_template, mtp: o.mtp || "auto",
  };
  if (o.sampling) {
    inputs.sampling_mode = "on";
    inputs["sampling_mode.temperature"] = o.temperature;
    inputs["sampling_mode.top_k"] = o.top_k;
    inputs["sampling_mode.top_p"] = o.top_p;
    inputs["sampling_mode.min_p"] = o.min_p;
    inputs["sampling_mode.repetition_penalty"] = o.repetition_penalty;
    if (isV2) inputs["sampling_mode.presence_penalty"] = o.presence_penalty;
    inputs["sampling_mode.seed"] = o.seed;
  } else {
    inputs.sampling_mode = "off";
  }
  if (isV2) {
    if (images) inputs["images.image1"] = images;
    if (system) inputs.system_prompt = system;
    return { class_type: "TextGenerateV2", inputs };
  }
  if (images) inputs.image = images;
  if (system) inputs.system_prompt = system;
  return { class_type: "TextGenerate", inputs };
}

type RowKind = "int" | "float";
const ROWS: Array<[keyof NativeLlmOpts, string, RowKind, string]> = [
  ["max_length", "max_length", "int", "Maximum tokens to generate"],
  ["temperature", "temperature", "float", "Sampling temperature"],
  ["top_k", "top_k", "int", "Keep only the k most likely tokens"],
  ["top_p", "top_p", "float", "Nucleus sampling threshold"],
  ["min_p", "min_p", "float", "Drop tokens below this share of the top token"],
  ["repetition_penalty", "repetition_penalty", "float", "Penalty for repeated tokens (1 = off)"],
  ["presence_penalty", "presence_penalty", "float", "Penalty for tokens already present (needs the Generate Text V2 node)"],
  ["seed", "seed", "int", "Sampling seed"],
];

/** Settings block: all ComfyUI-native Generate Text options. Changes save at once. */
export function mountNativeLLMOptions(parent: HTMLElement | null, { skip = [] as string[] } = {}): HTMLElement {
  const o = loadNativeLLMOpts();
  const box = document.createElement("div");
  box.style.cssText = "display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid rgba(128,128,128,.35);border-radius:8px;margin-top:8px";
  const title = document.createElement("div");
  title.textContent = "ComfyUI native — Generate Text details";
  title.style.cssText = "font-weight:700;font-size:12px";
  const note = document.createElement("div");
  note.textContent = "Used whenever a node runs its LLM through ComfyUI's own Generate Text node (Image → Brief, Write, Translate, MusicMaker). Shared by every node.";
  note.style.cssText = "font-size:10px;opacity:.7;line-height:1.5";
  box.append(title, note);

  const save = () => saveNativeLLMOpts(o);
  const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, css?: string): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (css) e.style.cssText = css; return e; };
  const field = (labelText: string, tip: string, control: HTMLElement) => {
    const w = mk("label", "display:flex;flex-direction:column;gap:2px;font-size:10.5px;flex:1;min-width:110px");
    w.title = tip || "";
    const t = mk("span"); t.textContent = labelText; w.append(t, control); return w;
  };
  const inputCss = "width:100%;box-sizing:border-box;padding:4px 6px;font-size:12px;border-radius:5px;border:1px solid rgba(128,128,128,.4);background:inherit;color:inherit";

  const grid = mk("div", "display:flex;flex-wrap:wrap;gap:6px");
  const numInputs: Record<string, HTMLInputElement> = {};
  ROWS.forEach(([k, name, kind, tip]) => {
    if (skip.includes(k)) return;
    const i = mk("input", inputCss);
    i.type = "number"; i.step = kind === "int" ? "1" : "0.01"; i.value = String(o[k]);
    i.addEventListener("change", () => {
      const v = Number(i.value);
      if (!Number.isFinite(v)) { i.value = String(o[k]); return; }
      (o as any)[k] = kind === "int" ? Math.round(v) : v;
      if (k === "max_length") o[k] = Math.max(1, o[k] as number);
      save();
    });
    numInputs[k] = i;
    grid.appendChild(field(name, tip, i));
  });
  box.appendChild(grid);

  const sel = (opts: Array<[string, string]>, cur: string, cb: (v: string) => void) => {
    const s = mk("select", inputCss);
    opts.forEach(([v, l]) => { const e = document.createElement("option"); e.value = v; e.textContent = l; s.appendChild(e); });
    s.value = cur; s.addEventListener("change", () => cb(s.value)); return s;
  };
  const chk = (text: string, cur: boolean, tip: string, cb: (v: boolean) => void) => {
    const w = mk("label", "display:flex;align-items:center;gap:6px;font-size:11px;flex:1;min-width:150px");
    w.title = tip || "";
    const c = mk("input"); c.type = "checkbox"; c.checked = !!cur; c.addEventListener("change", () => cb(c.checked));
    const t = mk("span"); t.textContent = text; w.append(c, t); return w;
  };
  const dim = () => {
    ["temperature", "top_k", "top_p", "min_p", "repetition_penalty", "presence_penalty", "seed"].filter((k) => numInputs[k]).forEach((k) => {
      numInputs[k].disabled = !o.sampling; numInputs[k].style.opacity = o.sampling ? "1" : ".45";
    });
  };
  const row = mk("div", "display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end");
  row.append(
    field("Sampling Mode", "on = sample with the values below, off = greedy", sel([["on", "on"], ["off", "off"]], o.sampling ? "on" : "off", (v) => { o.sampling = v === "on"; save(); dim(); })),
    field("mtp", "Multi-token prediction", sel([["auto", "auto"], ["on", "on"], ["off", "off"]], o.mtp, (v) => { o.mtp = v; save(); })),
    chk("thinking", o.thinking, "Let the model think before answering", (v) => { o.thinking = v; save(); }),
    chk("use_default_template", o.use_default_template, "Wrap the prompt in the model's chat template", (v) => { o.use_default_template = v; save(); }),
  );
  box.appendChild(row);
  const reset = mk("button", "align-self:flex-start;font-size:11px;padding:3px 10px;border-radius:5px;cursor:pointer");
  reset.type = "button"; reset.textContent = "Reset to defaults";
  reset.addEventListener("click", () => { saveNativeLLMOpts(NATIVE_LLM_DEFAULTS); box.replaceWith(mountNativeLLMOptions(null, { skip })); });
  box.appendChild(reset);
  dim();
  if (parent) parent.appendChild(box);
  return box;
}
