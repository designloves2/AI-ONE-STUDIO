// promptTemplatesApi.ts — custom prompt templates and tag presets, one pool per tool
// (klein, zimage, krea2, qwen2511, qwen21, anima, sdxl, minimax_h3), stored by
// ComfyUI-TJ_NODE_STUDIO_ONE nodes.py at /shared/prompt_templates and /shared/prompt_categories.
// Mirrors node web/shared/api_templates.js. The old shared pools "nl" / "tag" are still served
// for older clients but are frozen — nothing here uses them.
import { getComfyBase } from "./comfyBase";

export type TemplatePool = "klein" | "zimage" | "krea2" | "qwen2511" | "qwen21" | "anima" | "sdxl" | "minimax_h3";

export interface PromptTemplate {
  name: string;
  prompt: string;
}

export interface PromptTagItem { label: string; prompt: string; dual?: boolean }
export interface PromptTagCategory { cat: string; items: PromptTagItem[] }

// Throws on a network/HTTP failure or a malformed body, so callers can tell "failed to load"
// from "loaded an empty list" (saving after a failed load would wipe the stored list).
export async function getTemplates(pool: TemplatePool): Promise<PromptTemplate[]> {
  const r = await fetch(`${getComfyBase()}/shared/prompt_templates?pool=${encodeURIComponent(pool)}`, { credentials: "include" });
  const d = await r.json();
  if (!Array.isArray(d.templates)) throw new Error("bad response");
  return d.templates;
}

export async function saveTemplates(pool: TemplatePool, templates: PromptTemplate[]): Promise<void> {
  await fetch(`${getComfyBase()}/shared/prompt_templates?pool=${encodeURIComponent(pool)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templates }),
    credentials: "include",
  }).catch(() => {});
}

// Tag presets: {mode: [{cat, items: [{label, prompt, dual?}]}]}; a mode that is not in the
// result has never been customised. Throws on failure / malformed body.
export async function getCategories(pool: TemplatePool): Promise<Record<string, PromptTagCategory[]>> {
  const r = await fetch(`${getComfyBase()}/shared/prompt_categories?pool=${encodeURIComponent(pool)}`, { credentials: "include" });
  const d = await r.json();
  if (!d || typeof d.categories !== "object" || d.categories === null) throw new Error("bad response");
  return d.categories;
}

// categories === null drops the mode's customisation, back to the built-in defaults.
export async function saveCategories(pool: TemplatePool, mode: string, categories: PromptTagCategory[] | null): Promise<void> {
  await fetch(`${getComfyBase()}/shared/prompt_categories?pool=${encodeURIComponent(pool)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, categories }),
    credentials: "include",
  }).catch(() => {});
}
