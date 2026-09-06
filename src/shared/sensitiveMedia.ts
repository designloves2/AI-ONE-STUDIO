// sensitiveMedia.ts — per-item "hide this" (눈가리기) for gallery thumbnails, shared by every
// tool's gallery and the standalone gallery page.
//
// The hidden set now lives ONCE, server-side, behind `GET/POST /tj_shared/sensitive_media`
// (node f2386f9) — the node galleries and this web twin read/write the same list, so hiding a
// picture in one place hides it everywhere. Keyed by "<subfolder>/<filename>".
//
// localStorage (`aos_sensitive_media_v1`) is kept only as a **read-through mirror**: the last
// known list, so a reload paints blurred immediately before the server GET returns (no flash of
// hidden content) and so the feature degrades to local-only when the node is unreachable. The
// server is always authoritative — wiping the mirror can no longer lose anything, the next load
// re-fetches it.
import { getComfyBase } from "./comfyBase";

const KEY = "aos_sensitive_media_v1";
const MIGRATED_KEY = "aos_sensitive_media_migrated";
const SM_URL = "/tj_shared/sensitive_media";

const smFetch = (opts?: RequestInit) => fetch(`${getComfyBase()}${SM_URL}`, { ...opts, credentials: "include" });

function loadMirror(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function writeMirror() {
  try { localStorage.setItem(KEY, JSON.stringify([...cache])); } catch {}
}

let cache = loadMirror();
const seedKeys = [...cache]; // the pre-migration localStorage list, for the one-time server seed

let revealAll = false; // session-only "peek", never persisted
let loaded = false;
let loadingPromise: Promise<void> | null = null;
const painters = new Set<() => void>(); // render() of every live tile, for repaint-on-load/change

function repaintAll() {
  for (const p of [...painters]) {
    try { p(); } catch {}
  }
}

/** Fetch the server list once (idempotent); seeds the server from the old localStorage list on
 *  the first run, then repaints every live tile. */
export function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      const d = await smFetch().then((r) => r.json());
      if (d && d.ok && Array.isArray(d.items)) cache = new Set(d.items);

      // one-time migration: union the browser's existing hides into the server set.
      if (seedKeys.length && !safeGet(MIGRATED_KEY)) {
        try {
          const d2 = await smFetch({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ add: seedKeys }),
          }).then((r) => r.json());
          if (d2 && d2.ok && Array.isArray(d2.items)) cache = new Set(d2.items);
          else seedKeys.forEach((k) => cache.add(k));
          safeSet(MIGRATED_KEY, "1");
        } catch { /* leave the flag unset — retried next load */ }
      }
      writeMirror();
    } catch {
      // server unreachable — keep the localStorage mirror as the working set (local-only mode)
    } finally {
      loaded = true;
      loadingPromise = null;
      repaintAll();
    }
  })();
  return loadingPromise;
}

/** Force a re-fetch (e.g. the node changed the set while this tab was open). */
export function refreshSensitive(): Promise<void> {
  loaded = false;
  return ensureLoaded();
}

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch {}
}

export function isRevealAll(): boolean {
  return revealAll;
}
export function setRevealAll(on: boolean) {
  revealAll = !!on;
  repaintAll();
}

export function mediaKey(filename: string, subfolder?: string): string {
  return `${subfolder || ""}/${filename}`;
}

/** Is this item in the saved hidden set (regardless of the peek toggle). */
export function isSensitive(key: string): boolean {
  return cache.has(key);
}

/** Should this item actually be blurred right now (saved hidden AND not peeking). */
export function isBlurred(key: string): boolean {
  return !revealAll && cache.has(key);
}

/** Optimistic: flip locally + repaint now, then persist to the server; revert on failure. */
export function setSensitive(key: string, on: boolean) {
  if (on) cache.add(key);
  else cache.delete(key);
  writeMirror();
  repaintAll();
  smFetch({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, on: !!on }),
  })
    .then((r) => r.json())
    .then((d) => {
      if (d && d.ok && Array.isArray(d.items)) {
        cache = new Set(d.items);
        writeMirror();
        repaintAll();
      }
    })
    .catch(() => {
      // couldn't reach the server — revert the optimistic change (matches the node helper).
      if (on) cache.delete(key);
      else cache.add(key);
      writeMirror();
      repaintAll();
    });
}

const EYE_CSS =
  "width:18px;height:18px;padding:0;border:none;line-height:1;" +
  "display:flex;align-items:center;justify-content:center;flex:none;" +
  "background:transparent;color:#fff;font-size:11px;cursor:pointer;" +
  "text-shadow:0 0 3px rgba(0,0,0,0.95)";

/**
 * Build the 👁 toggle + the blur scrim for one gallery tile, without positioning them.
 * Caller places `eye` (a button) and `shade` (a full-bleed div) itself. `media` gets blurred
 * while the key is marked sensitive. `afterRender` runs on every render (e.g. an H3 tile
 * re-blurring its hover <video>).
 */
export function makeSensitiveControl(media: HTMLElement, key: string, afterRender?: () => void) {
  ensureLoaded();

  const shade = document.createElement("div");
  // Plain dark scrim — NO backdrop-filter. backdrop-filter over an animating backdrop (the H3
  // hover-preview <video>) makes the GPU re-tile every frame, which showed up as flickering
  // horizontal/vertical seams. The blur is done with a normal `filter` on the media elements
  // instead (see render(); H3 also blurs its hover video). z-2 keeps the scrim above the
  // z-auto hover video but below the corner control buttons (z-3).
  shade.style.cssText =
    "position:absolute;inset:0;z-index:2;background:rgba(12,14,20,0.55);" +
    "border-radius:inherit;transition:opacity .15s;cursor:pointer";

  const eye = document.createElement("button");
  eye.type = "button";
  eye.style.cssText = EYE_CSS;

  function render() {
    // drop this painter once its tile leaves the DOM (galleries rebuild on refresh)
    if (!media.isConnected && !shade.isConnected) { painters.delete(render); return; }
    const marked = isSensitive(key); // in the saved hidden set → 🙈 icon
    const blurred = isBlurred(key); // …and not peeking → actually blur it
    shade.style.opacity = blurred ? "1" : "0";
    shade.style.pointerEvents = blurred ? "auto" : "none";
    // Blur the element in place — no transform, so the media keeps its exact size and framing;
    // only the scrim goes on top. The tile must clip (overflow:hidden) so the blur's soft edge
    // halo doesn't spill past the box.
    media.style.filter = blurred ? "blur(14px)" : "";
    // monochrome text glyphs (︎ forces the b/w eye, not the colour emoji) so the toggle
    // matches the ✕ / ☆ on the same tile instead of flipping to a colour emoji when active.
    eye.textContent = marked ? "⊘" : "👁︎"; // ⊘ hidden / 👁 visible
    eye.title = marked ? "Reveal this item" : "Hide this item";
    afterRender?.();
  }

  eye.addEventListener("click", (e) => {
    e.stopPropagation();
    setSensitive(key, !isSensitive(key));
    render();
    // a GPU-composited tile can defer a filter/opacity repaint until the next pointer event
    // ("only applies after I move the mouse") — force a synchronous reflow so it shows on click.
    void (media.offsetWidth, shade.offsetWidth);
  });
  // The scrim swallows clicks (so a hidden tile can't be opened by tapping it) but does NOT
  // reveal — only the 👁 does that.
  shade.addEventListener("click", (e) => e.stopPropagation());

  painters.add(render);
  render();
  return { eye, shade, render };
}

type Corner = "tl" | "tr" | "bl" | "br";
const CORNER_CSS: Record<Corner, string> = {
  tl: "top:2px;left:2px",
  tr: "top:2px;right:2px",
  bl: "bottom:2px;left:2px",
  br: "bottom:2px;right:2px",
};

/**
 * Add the 👁 toggle to a gallery tile at a corner and keep `media` blurred while its key is
 * marked sensitive. `cell` must be `position: relative`. Call once per tile.
 */
export function attachSensitiveToggle(
  cell: HTMLElement,
  media: HTMLElement,
  key: string,
  corner: Corner = "br",
  afterRender?: () => void
) {
  const { eye, shade } = makeSensitiveControl(media, key, afterRender);
  eye.style.cssText += `;position:absolute;${CORNER_CSS[corner]};z-index:3`;
  cell.appendChild(shade);
  cell.appendChild(eye);
}
