// gallery/main.ts — standalone gallery page (gallery.html). Not linked from the app menu;
// reached only by its own URL. Shares the app's topbar; below it a thin bar with a per-tool
// ⚙ Settings toggle and a live ComfyUI-queue readout, then the picked tool's real gallery
// (browse / favourite / delete / copy prompt / open folder / reuse / send-to all work —
// Reuse and Send-to hop to the generator app).
import "../style.css";
import { createTopbar } from "../shared/topbar";
import { TOOLS, toolFromHash, type ToolId } from "../shared/tools";
import { setGalleryNavTarget } from "../shared/galleryNav";
import { getQueueCounts } from "../shared/queueStatus";
import { createGalleryMount, type GalleryMount } from "./mounts";

// From this separate document, a "go to tool" action must load the generator app.
setGalleryNavTarget((toolHash) => location.assign("/" + toolHash));

const app = document.querySelector<HTMLDivElement>("#app")!;
app.className = "flex flex-col h-screen overflow-hidden";
app.appendChild(createTopbar({ onBrand: () => location.assign("/") }));

const content = document.createElement("main");
content.className = "flex-1 min-h-0 flex flex-col overflow-hidden";
app.appendChild(content);

// ── thin bar under the topbar: ⚙ Settings toggle, pinned right ──────────────
const bar = document.createElement("div");
bar.className = "shrink-0 flex items-center justify-end gap-2 px-3 h-9 border-b border-border bg-bg1";
const settingsBtn = document.createElement("button");
settingsBtn.className = "h-7 px-3 rounded-md text-xs text-muted hover:text-text hover:bg-bg2 border border-border whitespace-nowrap";
settingsBtn.textContent = "⚙ Settings";
bar.appendChild(settingsBtn);
content.appendChild(bar);

const stage = document.createElement("div");
stage.className = "flex-1 min-h-0 relative overflow-hidden";
content.appendChild(stage);

// ── queue readout: pinned to the very bottom, always visible ────────────────
const queueBanner = document.createElement("div");
queueBanner.className = "shrink-0 text-xs px-3 py-1.5 border-t border-border bg-bg1 truncate text-center";
queueBanner.style.color = "var(--color-warn, #ffb347)";
queueBanner.hidden = true;
content.appendChild(queueBanner);

const mounts = new Map<ToolId, GalleryMount>();
let active: ToolId | null = null;

settingsBtn.addEventListener("click", () => {
  if (!active) return;
  const open = mounts.get(active)!.toggleSettings();
  settingsBtn.textContent = open ? "✕ Close settings" : "⚙ Settings";
});

function show(id: ToolId) {
  if (active === id) {
    mounts.get(id)?.show();
    return;
  }
  if (active) mounts.get(active)?.hide();
  let m = mounts.get(id);
  if (!m) {
    m = createGalleryMount(id);
    stage.appendChild(m.el);
    mounts.set(id, m);
  }
  active = id;
  settingsBtn.textContent = "⚙ Settings";
  m.show();
}

function route() {
  const tool = toolFromHash(location.hash);
  if (!tool) {
    location.replace(TOOLS[0].hash); // no tool picked → default to the first tab
    return;
  }
  show(tool.id);
}

window.addEventListener("hashchange", route);
route();

// ── ComfyUI queue readout (so a gallery-only visit still sees other work running) ──
async function pollQueue() {
  const { running, pending } = await getQueueCounts();
  if (running > 0 || pending > 0) {
    queueBanner.textContent = `⚠ ComfyUI queue: ${running} running · ${pending} pending — if this screen didn't queue it, progress/preview won't show here.`;
    queueBanner.hidden = false;
  } else {
    queueBanner.hidden = true;
  }
}
pollQueue();
setInterval(pollQueue, 4000);
