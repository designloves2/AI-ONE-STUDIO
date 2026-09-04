// comfyBase.ts — where the ComfyUI backend lives, decided at runtime from the page's own host.
//
// Two access paths, and they must not interfere with each other:
//
//   local / LAN   →  getComfyBase() returns ""  (same origin as the page).
//                    Requests go to the Vite dev server, which proxies every ComfyUI route to
//                    127.0.0.1:8188 (see vite.config.ts). No CORS, no cookies. This is the only
//                    thing that works now that ComfyUI runs with `--enable-cors-header
//                    https://studio.tjtj.cloud` — a direct :8774→:8188 fetch is cross-origin and
//                    that flag pins Allow-Origin to the tunnel, so the browser blocks it.
//
//   external      →  getComfyBase() returns VITE_COMFY_URL (e.g. https://comfy.tjtj.cloud).
//                    Cross-origin, behind Cloudflare Access — callers add credentials:"include"
//                    so the CF_Authorization cookie (SameSite=None) rides along.
//
// Escape hatch: ?comfy_port=8189 (remembered in localStorage) forces a *direct* connection to a
// local ComfyUI on that port, bypassing the proxy. Only useful if that ComfyUI was started
// without the studio-only CORS flag, or is same-origin. The everyday "my ComfyUI is on a
// non-8188 port" case is handled by public/comfy_port.txt, which the Vite proxy reads — no
// override needed here.
const LOCAL_PORT_KEY = "aos_comfy_local_port";

function explicitDirectPort(): string | null {
  try {
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get("comfy_port");
    if (fromQuery) {
      localStorage.setItem(LOCAL_PORT_KEY, fromQuery);
      return fromQuery;
    }
    const saved = localStorage.getItem(LOCAL_PORT_KEY);
    if (saved) return saved;
  } catch {}
  return null;
}

function isLocalOrLanHost(host: string): boolean {
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith(".local")
  );
}

export function getComfyBase(): string {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  if (isLocalOrLanHost(host)) {
    const direct = explicitDirectPort();
    return direct ? `http://127.0.0.1:${direct}` : ""; // "" → same-origin → Vite proxy
  }

  const remote = (import.meta as any).env?.VITE_COMFY_URL;
  if (remote) return remote;

  console.warn(
    "[AI ONE STUDIO] VITE_COMFY_URL is not set — external (tunnel/mobile) access can't reach " +
      "the ComfyUI backend. Create a .env file and set VITE_COMFY_URL=https://your-comfyui-tunnel " +
      "then restart the dev server. (see .env.example; local 127.0.0.1 access is unaffected — it " +
      "goes through the Vite dev proxy.)"
  );
  return "https://comfy.tjtj.cloud";
}

/** ws:// (or wss://) base that matches getComfyBase().
 *  When the base is "" (proxy path) `new WebSocket()` still needs an absolute URL, so derive it
 *  from the page origin — Vite proxies /ws to ComfyUI. */
export function getComfyWsBase(): string {
  const base = getComfyBase();
  if (base) return base.replace(/^http/, "ws");
  if (typeof window !== "undefined") return window.location.origin.replace(/^http/, "ws");
  return "ws://127.0.0.1:8774";
}
