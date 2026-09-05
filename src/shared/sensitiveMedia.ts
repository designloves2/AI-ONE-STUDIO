// sensitiveMedia.ts — per-item "hide this" flag for gallery thumbnails, shared by every
// tool's gallery (and the standalone gallery page). The user clicks the 👁 on a tile to blur
// it; the choice is remembered in localStorage keyed by "<subfolder>/<filename>", so the
// gallery comes back with the same items hidden.
const KEY = "aos_sensitive_media_v1";

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

let cache = load();

// Session-only "peek": reveal every hidden item at once without touching the saved set, so a
// second toggle restores exactly what was hidden. Not persisted — a reload comes back hidden.
let revealAll = false;
export function isRevealAll(): boolean {
  return revealAll;
}
export function setRevealAll(on: boolean) {
  revealAll = on;
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

export function setSensitive(key: string, on: boolean) {
  if (on) cache.add(key);
  else cache.delete(key);
  try {
    localStorage.setItem(KEY, JSON.stringify([...cache]));
  } catch {}
}

const EYE_CSS =
  "width:18px;height:18px;line-height:18px;padding:0;border:none;border-radius:4px;" +
  "background:rgba(0,0,0,0.65);color:#fff;font-size:10px;cursor:pointer;flex:none";

/**
 * Build the 👁 toggle + the blur scrim for one gallery tile, without positioning them.
 * Caller places `eye` (a button) and `shade` (a full-bleed div) itself. `media` gets blurred
 * while the key is marked sensitive.
 */
export function makeSensitiveControl(media: HTMLElement, key: string) {
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
    const marked = isSensitive(key); // in the saved hidden set → 🙈 icon
    const blurred = isBlurred(key); // …and not peeking → actually blur it
    shade.style.opacity = blurred ? "1" : "0";
    shade.style.pointerEvents = blurred ? "auto" : "none";
    // blur the element itself (GPU-cached for a still <img>); scale past the clip box so the
    // soft transparent halo blur leaves at the edges is hidden by the tile's overflow:hidden.
    media.style.filter = blurred ? "blur(20px)" : "";
    media.style.transform = blurred ? "scale(1.2)" : "";
    eye.textContent = marked ? "🙈" : "👁";
    eye.title = marked ? "Reveal this item" : "Hide this item";
  }

  eye.addEventListener("click", (e) => {
    e.stopPropagation();
    setSensitive(key, !isSensitive(key));
    render();
  });
  // The scrim swallows clicks (so a hidden tile can't be opened by tapping it) but does NOT
  // reveal — only the 👁 does that.
  shade.addEventListener("click", (e) => e.stopPropagation());

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
  corner: Corner = "br"
) {
  const { eye, shade } = makeSensitiveControl(media, key);
  eye.style.cssText += `;position:absolute;${CORNER_CSS[corner]};z-index:3;border-radius:8px`;
  cell.appendChild(shade);
  cell.appendChild(eye);
}
