// Gallery thumbnails are served by the shared /tj_shared/thumb route (a 384px webp cached on disk,
// written at save_meta time and removed with the image). Images without one — older files,
// loose input/output folder files — are generated once on first request; the Cache button
// pre-builds a whole folder in one go (POST /tj_shared/build_thumbs, polled via
// /tj_shared/build_thumbs_status).
import { C } from "../identity";
import { el } from "./ui";
import { getComfyBase } from "./comfyBase";

/** If a thumbnail 404s/errors, fall back to the full-size file once. */
export function thumbFallback(im: HTMLImageElement, originalUrl: string) {
  im.addEventListener("error", () => {
    if (im.dataset.thumbFb) return;
    im.dataset.thumbFb = "1";
    im.src = originalUrl;
  });
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
