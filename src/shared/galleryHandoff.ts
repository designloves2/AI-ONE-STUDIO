// galleryHandoff.ts — one-shot "apply this clip's settings" payload passed from the standalone
// gallery page (gallery.html) to a tool's generator page.
//
// Image tools don't need this: their Reuse is a flat Object.assign onto state, so the gallery
// page just merges the meta into the tool's saved localStorage and the tool picks it up on
// mount. MiniMax H3's Reuse (applyClipSettings) reshapes fields — prompts[] string→object,
// accel-string migration, per-clip inputs — so it has to run the tool's own function. The
// gallery page stashes the meta here; h3's view.ts calls takeReuse() on mount and feeds it
// straight to applyClipSettings().
const KEY = "aos_gallery_reuse_handoff";

export function stashReuse(toolId: string, meta: any) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ toolId, meta }));
  } catch {}
}

/** Returns the stashed meta for `toolId` and clears it, or null. Consumed once. */
export function takeReuse(toolId: string): any | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const h = JSON.parse(raw);
    if (!h || h.toolId !== toolId) return null;
    sessionStorage.removeItem(KEY);
    return h.meta ?? null;
  } catch {
    return null;
  }
}
