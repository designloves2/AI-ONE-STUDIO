// ask.ts — the node's ui_ask.js `ask(parent, opts)` on top of the web's own dialogs (alert / confirm / prompt).
// kind "text" -> trimmed string or null; "textarea" -> trimmed string or null; "confirm" -> boolean.
import { confirmDialog, promptDialog, promptTextareaDialog } from "../../shared/ui";

export async function ask(
  _parent: HTMLElement | null,
  { title, message, initial = "", kind = "text", okLabel = "OK", danger = false, tags = null, extra = null }:
    { title?: string; message?: string; initial?: string; kind?: "text" | "textarea" | "confirm"; okLabel?: string; danger?: boolean; tags?: string[] | null; extra?: HTMLElement | null },
): Promise<string | boolean | null> {
  const text = [title, message].filter(Boolean).join("\n\n");
  if (kind === "confirm") return confirmDialog(text, { okText: okLabel, danger });
  if (kind === "textarea") {
    const v = await promptTextareaDialog(text, { defaultValue: initial, tags: tags || undefined, okLabel, extra });
    return v == null ? null : v.trim();
  }
  const v = await promptDialog(text, initial);
  return v == null ? null : v.trim();
}
