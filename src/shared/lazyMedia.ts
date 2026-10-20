// Gallery tiles used to give every <video> its src at creation, so opening a gallery fired one /view request per
// clip at once. ComfyUI's /view can stall (200 with no body); piled-up connections then starve everything else.
// lazyVideoSrc: the src is set only once the tile is (nearly) visible, and at most MAX_ACTIVE videos load at a time
// (a slot frees on loadedmetadata, on error, or after SLOT_MS).
const MAX_ACTIVE = 6;
const SLOT_MS = 20000;
let active = 0;
const waiting: Array<() => void> = [];

function release() {
  active = Math.max(0, active - 1);
  const next = waiting.shift();
  if (next) next();
}

function load(vid: HTMLVideoElement, url: string) {
  active++;
  let done = false;
  const fin = () => { if (done) return; done = true; clearTimeout(timer); release(); };
  const timer = setTimeout(fin, SLOT_MS);
  vid.addEventListener("loadedmetadata", fin, { once: true });
  vid.addEventListener("error", fin, { once: true });
  vid.src = url;
}

export function lazyVideoSrc(vid: HTMLVideoElement, url: string) {
  const start = () => { if (active < MAX_ACTIVE) load(vid, url); else waiting.push(() => load(vid, url)); };
  if (typeof IntersectionObserver === "undefined") { start(); return; }
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    start();
  }, { rootMargin: "200px" });
  io.observe(vid);
}
