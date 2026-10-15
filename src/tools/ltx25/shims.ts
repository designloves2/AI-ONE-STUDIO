// shims.ts — the few helpers the node's one_node_ltx25.js takes from ComfyUI-side modules that have no web twin as such.
import { searchableSelect, openFullscreen } from "../../shared/ui";

/** The node's loraSelect(options, value, onChange): a searchable dropdown element. */
export function loraSelect(options: string[], value: string, onChange: (v: string) => void): HTMLElement {
  return searchableSelect(options, value, onChange).el;
}

/** Full-screen video player overlay (the web's own). */
export function openVideoFullscreen(url: string, _opts: { startAt?: number } = {}) {
  openFullscreen(url, "video");
}

/** The node's "fullscreen this node" becomes the browser's fullscreen of the studio page. */
export function createNodeFullscreen(root: HTMLElement, onChange?: (open: boolean) => void) {
  const isOpen = () => document.fullscreenElement === root;
  document.addEventListener("fullscreenchange", () => onChange?.(isOpen()));
  return {
    isOpen,
    toggle() {
      if (isOpen()) void document.exitFullscreen?.();
      else void root.requestFullscreen?.().catch(() => {});
    },
    exit() { if (isOpen()) void document.exitFullscreen?.(); },
  };
}

/** Prompt DB pipe overrides come from nodes linked on the ComfyUI canvas; a web page has no graph links. */
export async function resolvePipeOverrides(_self: any, _state: any): Promise<null> { return null; }
export function applyOverridesTemp(_clipState: any, _overrides: any): (() => void) | null { return null; }
