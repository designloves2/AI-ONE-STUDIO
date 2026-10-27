// bilingualImage.ts — the KO / EN button for the single prompt box of an image tool (one prompt per mode).
// Port of ComfyUI-TJ_NODE_STUDIO_ONE/web/shared/bilingual_image.js (node v1.49.0).
// The English text stays where the tool keeps it (getModePrompt / setModePrompt); the Korean text, the newest mark
// and the view are kept per mode in state.promptSlots[mode], so a tool only has to whitelist `promptSlots`.
import { attachBilingual, type BilingualHandle } from "./bilingualUi";
import { ensureEnglish, fieldSetBoth, fieldSetView } from "./bilingual";
import { translateLlm } from "./translateConfig";
import { useKoFor } from "./koSetting";

const KEY = "prompt";

export interface ImagePromptBilingualOpts {
  state: any;
  getModePrompt: (mode: string) => string;
  setModePrompt: (mode: string, text: string) => void;
  persist: () => void;
  onError?: (message: string) => void;
}

export function createImagePromptBilingual({ state, getModePrompt, setModePrompt, persist, onError }: ImagePromptBilingualOpts) {
  // one Proxy per mode's slots, so the same field is always the same object (the "being translated" mark is looked up by it)
  const proxies = new WeakMap<object, any>();
  const target = () => {
    const mode = state.mode;
    if (!state.promptSlots) state.promptSlots = {};
    const slots = state.promptSlots[mode] || (state.promptSlots[mode] = {});
    if (!proxies.has(slots)) proxies.set(slots, new Proxy(slots, {
      get: (t: any, k: any) => (k === KEY ? getModePrompt(mode) : t[k]),
      set: (t: any, k: any, v: any) => { if (k === KEY) setModePrompt(mode, v); else t[k] = v; return true; },
    }));
    return proxies.get(slots);
  };
  const protect = () => [] as string[];
  let main: BilingualHandle | null = null;
  return {
    // handed to the shared Prompt Edit panel — the panel is built before the main box exists
    panel: { target, key: KEY, protect, onError, getMainBil: () => main },
    // wraps the main prompt box; use the returned element where the textarea was
    attach(promptTA: HTMLTextAreaElement) {
      main = attachBilingual(promptTA, { target, key: KEY, persist, protect, onError });
      return main;
    },
    refresh: () => main?.refresh(),
    // a template / loaded preset replaces the prompt: English text, no Korean yet
    setEnglish(text: string) {
      const o = target();
      fieldSetBoth(o, KEY, text, "");
      fieldSetView(o, KEY, "en");
      persist(); main?.refresh();
    },
    // Generate guard: a Korean-only edit becomes English before the graph is built
    async ensure() {
      if (main && !useKoFor(main.el)) return;
      if (await ensureEnglish(target(), KEY, translateLlm(), { protect: protect() })) { persist(); main?.refresh(); }
    },
  };
}
