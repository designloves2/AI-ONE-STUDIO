// mounts.ts — per-tool adapters for the standalone gallery page.
//
// Each tool ships a `createGalleryOverlay(...)` and a `createSettingsOverlay(...)` used inside
// its own page. Here we reuse both verbatim: one shared `state` object per tool feeds the
// gallery and the settings panel, so changing "Save Folder" in Settings makes the gallery
// re-query that folder on its next refresh. Reuse / Send-to write the tool's saved
// localStorage the same way the in-app handlers do, then jump to the generator app.

import type { ToolId } from "../shared/tools";
import { navigateToTool } from "../shared/galleryNav";
import { stashReuse } from "../shared/galleryHandoff";

import * as krea2Core from "../tools/krea2/core";
import { createGalleryOverlay as krea2Gallery } from "../tools/krea2/galleryOverlay";
import { createSettingsOverlay as krea2Settings } from "../tools/krea2/settings";
import * as zimageCore from "../tools/zimage/core";
import { createGalleryOverlay as zimageGallery } from "../tools/zimage/galleryOverlay";
import { createSettingsOverlay as zimageSettings } from "../tools/zimage/settings";
import * as animaCore from "../tools/anima/core";
import { createGalleryOverlay as animaGallery } from "../tools/anima/galleryOverlay";
import { createSettingsOverlay as animaSettings } from "../tools/anima/settings";
import * as kleinCore from "../tools/klein/core";
import { createGalleryOverlay as kleinGallery } from "../tools/klein/galleryOverlay";
import { createSettingsOverlay as kleinSettings } from "../tools/klein/settings";
import * as qwenCore from "../tools/qwen2511/core";
import { createGalleryOverlay as qwenGallery } from "../tools/qwen2511/galleryOverlay";
import { createSettingsOverlay as qwenSettings } from "../tools/qwen2511/settings";
import * as sdxlCore from "../tools/sdxl/core";
import { createGalleryOverlay as sdxlGallery } from "../tools/sdxl/galleryOverlay";
import { createSettingsOverlay as sdxlSettings } from "../tools/sdxl/settings";
import * as h3Core from "../tools/minimax_h3/core";
import { createGalleryOverlay as h3Gallery } from "../tools/minimax_h3/galleryOverlay";
import { createSettingsOverlay as h3Settings } from "../tools/minimax_h3/settings";
import { getNodeAvailability } from "../tools/minimax_h3/api";

export interface GalleryMount {
  el: HTMLElement;
  show: () => void;
  hide: () => void;
  toggleSettings: () => boolean; // returns the new open state
}

type Core = {
  loadState: () => any;
  saveState: (s: any) => void;
  defaultState: (saved?: any) => any;
};

function toast(msg: string, isError = false) {
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText = `position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;padding:10px 16px;border-radius:8px;font-size:13px;color:#fff;background:${isError ? "#c0392b" : "#2a2a3a"};box-shadow:0 4px 16px rgba(0,0,0,0.4)`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function persistAndGo(core: Core, state: any, hash: string, patch: Record<string, any>) {
  Object.assign(state, patch);
  core.saveState(state);
  navigateToTool(hash);
}

let h3Avail: Record<string, boolean> = {};
getNodeAvailability().then((a) => { h3Avail = a.available || {}; }).catch(() => {});

// image tools: onSendTo(mode, field, filename)
const sendTo3 = ([mode, field, filename]: any[]) => ({ [field]: filename, mode });
// klein / qwen: onSendTo(mode, field, extra, filename) — extra = paint sub-mode
const sendTo4Paint = ([mode, field, extra, filename]: any[]) => {
  const p: Record<string, any> = { [field]: filename, mode };
  if (field === "inpaintImage") p.outpaintImage = filename;
  if (field === "outpaintImage") p.inpaintImage = filename;
  if (extra) p.paintSubMode = extra;
  return p;
};
// sdxl: onSendTo(mode, field, _extra, filename)
const sendTo4Plain = ([mode, field, , filename]: any[]) => ({ [field]: filename, mode });

/** Common wrapper: gallery + settings share one state; Reuse/Send-to hop to the generator. */
function imageMount(
  core: Core,
  hash: string,
  makeGallery: (state: any, onReuse: (m: any) => void, onSendTo: (...a: any[]) => void) => { el: HTMLElement; show: () => void; hide: () => void },
  makeSettings: (state: any, ctx: any) => { el: HTMLElement; show: () => void; hide: () => void },
  sendToPatch: (args: any[]) => Record<string, any>
): GalleryMount {
  const state = core.defaultState(core.loadState());

  const gallery = makeGallery(
    state,
    (meta: any) => {
      if (!meta || !meta.mode) return;
      persistAndGo(core, state, hash, meta);
    },
    (...args: any[]) => persistAndGo(core, state, hash, sendToPatch(args))
  );

  let loras: string[] = [];
  const settings = makeSettings(state, {
    persist: () => core.saveState(state),
    get availableLoras() { return loras; },
    set availableLoras(v: string[]) { loras = v; },
    appConfig: { output_mode_visible: true },
    onModelsRefreshed: () => {},
    onOutputVisibilityChanged: () => {},
    onLightningChange: () => {},
  });

  return wrap(gallery, settings);
}

function h3Mount(): GalleryMount {
  const hash = "#minimax_h3";
  const state = h3Core.defaultState(h3Core.loadState());

  const gallery = h3Gallery(state, {
    showPopup: (m, e) => toast(m, e),
    get availability() { return h3Avail; },
    reusePrompt: (meta: any) => {
      stashReuse("minimax_h3", meta || {});
      navigateToTool(hash);
      return true;
    },
    // runExtend omitted — Extend queues a render + stitch, which needs the generator page.
  });
  // Tool overlay is `fixed inset-0` — re-anchor so it sits under the shared topbar.
  gallery.el.classList.remove("fixed");
  gallery.el.classList.add("absolute");
  const hideExtend = document.createElement("style");
  hideExtend.textContent = `.aos-gallery-page-mount button[title^="Add a continuation"]{display:none!important}`;
  gallery.el.appendChild(hideExtend);

  const settings = h3Settings(state, {
    persist: () => h3Core.saveState(state),
    showPopup: (m: string, e?: boolean) => toast(m, e),
    get availability() { return h3Avail; },
  } as any);
  settings.el.classList.remove("fixed");
  settings.el.classList.add("absolute");

  return wrap(gallery, settings);
}

function wrap(
  gallery: { el: HTMLElement; show: () => void; hide: () => void },
  settings: { el: HTMLElement; show: () => void; hide: () => void }
): GalleryMount {
  const box = document.createElement("div");
  box.className = "aos-gallery-page-mount";
  box.style.cssText = "position:absolute;inset:0;display:none";
  gallery.el.style.position = "absolute";
  gallery.el.style.inset = "0";
  settings.el.style.position = "absolute";
  settings.el.style.inset = "0";
  box.append(gallery.el, settings.el);

  let settingsOpen = false;
  return {
    el: box,
    show() {
      box.style.display = "block";
      if (!settingsOpen) gallery.show();
    },
    hide() {
      box.style.display = "none";
    },
    toggleSettings() {
      settingsOpen = !settingsOpen;
      if (settingsOpen) {
        settings.show();
      } else {
        settings.hide();
        gallery.show(); // re-query — the Save Folder may have changed
      }
      return settingsOpen;
    },
  };
}

export function createGalleryMount(id: ToolId): GalleryMount {
  switch (id) {
    case "krea2":
      return imageMount(krea2Core as any, "#krea2", krea2Gallery as any, krea2Settings as any, sendTo3);
    case "zimage":
      return imageMount(zimageCore as any, "#zimage", zimageGallery as any, zimageSettings as any, sendTo3);
    case "anima":
      return imageMount(animaCore as any, "#anima", animaGallery as any, animaSettings as any, sendTo3);
    case "klein":
      return imageMount(kleinCore as any, "#klein", kleinGallery as any, kleinSettings as any, sendTo4Paint);
    case "qwen2511":
      return imageMount(qwenCore as any, "#qwen2511", qwenGallery as any, qwenSettings as any, sendTo4Paint);
    case "sdxl":
      return imageMount(sdxlCore as any, "#sdxl", sdxlGallery as any, sdxlSettings as any, sendTo4Plain);
    case "minimax_h3":
      return h3Mount();
  }
}
