// On a tunnel deploy the ComfyUI backend (VITE_COMFY_URL) is a different origin from the page, so
// an <img>/Image loaded straight from `${base}/view?...` taints any canvas it is drawn on, and
// toBlob/toDataURL/getImageData then throw "Tainted canvases may not be exported". A plain
// crossOrigin="anonymous" isn't an option: the backend sits behind Cloudflare Access and the auth
// cookie only rides requests made with credentials. So fetch the bytes the same way the API calls
// do (credentials: "include") and hand back a same-origin blob: URL. Same-origin / blob / data URLs
// (localhost dev, already-local images) pass through untouched.
const cache = new Map<string, string>();
const CACHE_MAX = 24; // each entry is a full-size image held in memory

export async function sameOriginSrc(url: string): Promise<string> {
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return url;
  let abs: URL;
  try { abs = new URL(url, location.href); } catch { return url; }
  if (abs.origin === location.origin) return url;
  const hit = cache.get(abs.href);
  if (hit) return hit;
  const r = await fetch(abs.href, { credentials: "include" });
  if (!r.ok) throw new Error(`image fetch failed (${r.status})`);
  const obj = URL.createObjectURL(await r.blob());
  cache.set(abs.href, obj);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value as string;
    URL.revokeObjectURL(cache.get(oldest)!);
    cache.delete(oldest);
  }
  return obj;
}
