// customLlmControls.ts — the "Connect Custom" fields (any OpenAI-style Chat Completions server)
// shared by every LLM backend picker: H3 Brief / Vision / LTX Upscale, the image tools' Prompt
// Enhance / Image → Prompt Write, and MusicMaker. Port of the node's web/shared/custom_llm_controls.js.
//
// URL, model id and context size belong to the caller (it stores them wherever that picker
// keeps its settings). The API key does not: it is sent once on "Connect & test", held in
// the server's memory under this role, and the field is cleared.
import { getComfyBase } from "./comfyBase";

export type CustomLlmRole = "brief" | "vision" | "ltx" | "img_enhance" | "img_i2p" | "music";

export interface CustomLlmTheme { bg: string; text: string; border: string; muted: string; ok: string; warn: string; err: string; brand: string }

/** Same call the H3 settings made, now reachable from every tool. */
export async function connectCustomLLM(role: CustomLlmRole, { baseUrl, apiKey, model }: { baseUrl: string; apiKey?: string; model?: string }): Promise<any> {
  const r = await fetch(`${getComfyBase()}/tj_shared/custom_llm/connect`, {
    method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
    body: JSON.stringify({ role, base_url: baseUrl, api_key: apiKey || "", model: model || "" }),
  });
  return r.json();
}

export function customLLMControls({ role, values, onChange, theme, noteKeyWhere = "the local backend" }: {
  role: CustomLlmRole;
  values: { base?: string; model?: string; ctx?: number };
  onChange: (patch: { base?: string; model?: string; ctx?: number }) => void;
  theme: CustomLlmTheme;
  noteKeyWhere?: string;
}): HTMLElement {
  const T = theme;
  const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration> = {}, props: Record<string, any> = {}): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    Object.assign(e, props);
    Object.assign(e.style, style);
    return e;
  };
  const input = (type: string, value: string | number, placeholder: string, change: (v: string) => void) => {
    const i = mk("input", {
      width: "100%", boxSizing: "border-box", background: T.bg, color: T.text,
      border: `1px solid ${T.border}`, borderRadius: "6px", padding: "6px", fontSize: "12px", fontFamily: "inherit",
    }, { type, placeholder, autocomplete: "off" });
    i.value = String(value);
    i.addEventListener("change", () => change(i.value));
    return i;
  };
  const lab = (text: string) => mk("div", { fontSize: "10px", color: T.muted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "2px" }, { textContent: text });
  const note = (text: string) => mk("div", { fontSize: "10px", color: T.muted, lineHeight: "1.5" }, { textContent: text });
  const col = (children: HTMLElement[]) => { const d = mk("div", { display: "flex", flexDirection: "column", gap: "4px" }); children.forEach((c) => d.appendChild(c)); return d; };

  const baseIn = input("text", values.base || "", "http://localhost:3000/v1", (v) => onChange({ base: v.trim() }));
  const keyIn = input("password", "", "Paste key for this session", () => {});
  const modelIn = input("text", values.model || "", "gemini-3.7-flash", (v) => onChange({ model: v.trim() }));
  const models = mk("datalist", {}, { id: `custom-llm-models-${role}` });
  modelIn.setAttribute("list", models.id);
  const ctxIn = input("number", values.ctx || "", "32768", (v) => onChange({ ctx: Math.max(0, Math.round(Number(v)) || 0) }));
  const status = mk("div", { fontSize: "11px", lineHeight: "1.5", color: T.muted, whiteSpace: "pre-wrap", overflowWrap: "anywhere" });

  const connect = mk("button", {
    cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "7px 12px", borderRadius: "6px",
    fontWeight: "700", background: T.brand, color: "#fff", border: "1px solid transparent",
  }, { type: "button", textContent: "Connect & test" });
  connect.addEventListener("click", async () => {
    const patch = { base: baseIn.value.trim(), model: modelIn.value.trim(), ctx: Math.max(0, Math.round(Number(ctxIn.value)) || 0) };
    onChange(patch);
    status.style.color = T.muted; status.textContent = "Connecting…";
    connect.disabled = true;
    try {
      const d = await connectCustomLLM(role, { baseUrl: patch.base, apiKey: keyIn.value, model: patch.model });
      if (!d.ok) { status.style.color = T.err; status.textContent = `✗ ${d.error || "connection failed"}`; return; }
      if (keyIn.value) { keyIn.value = ""; keyIn.placeholder = "✓ key held in server memory (this session)"; }
      models.replaceChildren(...(d.models || []).map((m: string) => mk("option", {}, { value: m })));
      let msg = `✓ Connected in ${d.ms} ms` + (d.models?.length ? ` · ${d.models.length} models listed` : "") + (d.note ? ` · ${d.note}` : "");
      if (!patch.model && d.models?.length) {
        modelIn.value = d.models[0]; onChange({ model: d.models[0] });
        msg += `\nModel ID was empty — set to the first listed: ${d.models[0]}`;
      } else if (patch.model && d.modelFound === false) {
        status.style.color = T.warn; status.textContent = `${msg}\n⚠ "${patch.model}" is not in the endpoint's model list.`;
        return;
      }
      status.style.color = T.ok; status.textContent = msg;
    } catch (e: any) {
      status.style.color = T.err; status.textContent = `✗ ${e?.message || e}`;
    } finally { connect.disabled = false; }
  });

  return col([
    note("One shared Chat Completions backend."),
    col([lab("API base URL"), baseIn,
      note("Public endpoints require HTTPS; loopback and private LAN addresses may use HTTP.")]),
    col([lab("API key (optional)"), keyIn,
      note(`The key is sent once to ${noteKeyWhere}, kept only in memory, and never saved in localStorage.`)]),
    col([lab("Model ID (optional before connect)"), modelIn, models]),
    col([lab("Known context (optional)"), ctxIn]),
    connect, status,
  ]);
}
