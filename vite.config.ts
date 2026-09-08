import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

// Local ComfyUI port for the dev proxy. Same precedence the old client-side getComfyBase used,
// minus the per-browser ?comfy_port= override (that can't reach a build-time config — it now
// forces a direct connection instead, see src/shared/comfyBase.ts):
//   VITE_COMFY_PORT (env)  >  public/comfy_port.txt  >  8188
function localComfyPort(): string {
  const fromEnv = process.env.VITE_COMFY_PORT;
  if (fromEnv && /^\d+$/.test(fromEnv.trim())) return fromEnv.trim();
  try {
    const p = fileURLToPath(new URL("./public/comfy_port.txt", import.meta.url));
    const val = readFileSync(p, "utf8").trim();
    if (/^\d+$/.test(val)) return val;
  } catch {}
  return "8188";
}

const COMFY = `http://127.0.0.1:${localComfyPort()}`;

// LLM routes (OpenRouter / local GGUF / TextGenerate) can legitimately run a minute or more
// server-side. http-proxy defaults to a short socket timeout and, on timeout, silently RESETs
// the connection — the browser then sees only a raw `TypeError: Failed to fetch` with no
// status to surface. Give upstream a long leash, and when it does fail, hand back a readable
// 504 JSON body instead of a dead socket.
const PROXY_TIMEOUT_MS = 600_000;
const longProxy = (extra: Record<string, unknown> = {}) => ({
  target: COMFY,
  changeOrigin: true,
  timeout: PROXY_TIMEOUT_MS,
  proxyTimeout: PROXY_TIMEOUT_MS,
  configure: (proxy: any) => {
    proxy.on("error", (err: any, _req: any, res: any) => {
      if (res && !res.headersSent && typeof res.writeHead === "function") {
        res.writeHead(504, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: `upstream proxy error: ${err?.code || err?.message || "failed"}`, stage: "proxy" }));
      } else if (res && typeof res.end === "function") {
        try { res.end(); } catch {}
      }
    });
  },
  ...extra,
});

// Every path prefix ComfyUI (core + the TJ_NODE_STUDIO_ONE packs + Manager) serves. On a local
// or LAN visit the frontend talks to its own origin (getComfyBase() === "") and Vite forwards
// these here — so a direct :8774→:8188 request, which the studio-only --enable-cors-header would
// otherwise block, never happens.
const comfyPaths = [
  "/prompt", "/queue", "/interrupt", "/free", "/history", "/view", "/upload",
  "/object_info", "/system_stats", "/embeddings", "/extensions", "/internal",
  "/manager", "/api", "/userdata",
  "/shared", "/tj_shared", "/tj_studio_one",
  "/minimax_h3_one", "/krea2_one", "/qwen2511_one", "/sdxl_one",
  "/flux_klein", "/z_image_turbo", "/anima_one", "/music_one",
];

export default defineConfig({
  plugins: [tailwindcss()],
  // index.html = the studio app; gallery.html = the standalone gallery-only page
  // (not linked from the menu, reached by its own URL).
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        gallery: resolve(root, "gallery.html"),
      },
    },
  },
  server: {
    // true = bind 0.0.0.0 so another machine on the LAN can reach http://<this PC's LAN IP>:8774
    // directly. External tunnels forward to this same port; studio.tjtj.cloud stays allowed via
    // allowedHosts. (127.0.0.1-only used to leave LAN visitors' HMR socket unable to connect,
    // looping reconnects/refreshes — host must actually be open for the HMR client too.)
    host: true,
    port: 8774,
    strictPort: true,
    allowedHosts: ["studio.tjtj.cloud"],
    proxy: {
      ...Object.fromEntries(comfyPaths.map((p) => [p, longProxy()])),
      "/ws": longProxy({ target: COMFY.replace(/^http/, "ws"), ws: true }),
    },
  },
});
