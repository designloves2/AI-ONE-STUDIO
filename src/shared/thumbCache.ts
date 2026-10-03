// Gallery thumbnails are served by the shared /tj_shared/thumb route (a 384px webp cached on disk,
// written at save_meta time and removed with the image). Images without one — older files,
// loose input/output folder files — are generated once on first request; the Cache button
// pre-builds a whole folder in one go (POST /tj_shared/build_thumbs, polled via
// /tj_shared/build_thumbs_status).
import { C } from "../identity";
import { el, thumbSrc } from "./ui";
import { getComfyBase } from "./comfyBase";

// One <img> per request is what made tunnel galleries crawl (~4-5 cards/s): each request pays a
// Cloudflare + Access + tunnel round trip even though a thumbnail is 5-30 KB. So cards register
// here and everything created in the same tick is fetched with ONE POST /tj_shared/thumbs
// (chunks of 30, in parallel) that returns data URIs. A card whose entry is missing — or the
// whole batch if the route doesn't exist — falls back to its own /tj_shared/thumb URL, and that
// to the full-size file.
const BATCH_CHUNK = 30;
const memo = new Map<string, string>();
type Pending = { im: HTMLImageElement; key: string; item: { root: string; filename: string; subfolder: string }; single: string; full: string };
let queue: Pending[] = [];
let scheduled = false;

function parseView(viewUrl: string) {
  const i = viewUrl.indexOf("/view?");
  if (i < 0) return null;
  const p = new URLSearchParams(viewUrl.slice(i + 6));
  const root = p.get("type") || "output";
  if (root !== "input" && root !== "output") return null;
  return { root, filename: p.get("filename") || "", subfolder: p.get("subfolder") || "" };
}

async function flush() {
  scheduled = false;
  const batch = queue; queue = [];
  const useSingle = (p: Pending) => { p.im.src = p.single; };
  const chunks: Pending[][] = [];
  for (let i = 0; i < batch.length; i += BATCH_CHUNK) chunks.push(batch.slice(i, i + BATCH_CHUNK));
  await Promise.all(chunks.map(async (chunk) => {
    try {
      const r = await api("/tj_shared/thumbs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: chunk.map((p) => p.item) }),
      });
      const d = r.ok ? await r.json() : null;
      if (!d || !Array.isArray(d.thumbs)) { chunk.forEach(useSingle); return; }
      chunk.forEach((p, i) => {
        const uri = d.thumbs[i];
        if (typeof uri === "string" && uri.startsWith("data:")) { memo.set(p.key, uri); p.im.src = uri; }
        else useSingle(p);
      });
    } catch { chunk.forEach(useSingle); }
  }));
}

/** Give a grid-card <img> its thumbnail (batched), falling back to single, then full-size. */
export function applyThumb(im: HTMLImageElement, viewUrl: string) {
  const item = parseView(viewUrl);
  if (!item) { im.src = viewUrl; return; }
  const single = thumbSrc(viewUrl);
  im.addEventListener("error", () => { if (im.src === single) im.src = viewUrl; });
  const key = `${item.root}|${item.subfolder}|${item.filename}|${new URL(viewUrl, location.href).searchParams.get("t") || ""}`;
  const hit = memo.get(key);
  if (hit) { im.src = hit; return; }
  queue.push({ im, key, item, single, full: viewUrl });
  if (!scheduled) { scheduled = true; setTimeout(flush, 0); }
}

export interface CacheScope { root: "input" | "output"; subfolder: string; recursive: boolean }

const api = (path: string, init?: RequestInit) => fetch(`${getComfyBase()}${path}`, { ...init, credentials: "include" });

export function createCacheButton(getScope: () => CacheScope, onDone?: () => void): HTMLButtonElement {
  const idle = "🗂 Cache";
  const b = el("button", {
    type: "button", text: idle,
    title: "Build thumbnails for every image here that doesn't have one yet",
    style: {
      cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "5px 10px", borderRadius: "6px",
      border: `1px solid ${C.border}`, background: "#2a2a3a", color: "#fff",
    },
  }) as HTMLButtonElement;
  const done = (msg: string, ms = 5000) => {
    b.textContent = msg; b.disabled = false; b.style.opacity = "1";
    setTimeout(() => { if (!b.disabled) b.textContent = idle; }, ms);
  };
  b.addEventListener("click", async () => {
    if (b.disabled) return;
    const scope = getScope();
    b.disabled = true; b.style.opacity = "0.7"; b.textContent = "Caching…";
    let poll: ReturnType<typeof setInterval> | null = setInterval(async () => {
      try {
        const s = await (await api("/tj_shared/build_thumbs_status")).json();
        if (s?.running) b.textContent = `Caching… ${s.done ?? 0}/${s.total ?? "?"}`;
      } catch { /* status is cosmetic */ }
    }, 700);
    try {
      const r = await api("/tj_shared/build_thumbs", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scope),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409) { done("Already running…", 3000); return; }
      if (!r.ok || d.ok === false) throw new Error(d.error || `HTTP ${r.status}`);
      done(`✓ ${d.built ?? 0} built · ${d.skipped ?? 0} had · ${d.failed ?? 0} failed`);
      onDone?.();
    } catch (e: any) {
      done("Cache failed — " + String(e?.message || e).slice(0, 40), 6000);
    } finally {
      if (poll) clearInterval(poll);
      poll = null;
    }
  });
  return b;
}
