// Production server: serves the built app (dist/) and forwards ComfyUI + STUDIO_ONE traffic, like the Vite dev proxy does.
//   COMFY_URL=http://127.0.0.1:8188 PORT=8778 node serve.mjs
// ComfyUI address: COMFY_URL (env) > VITE_COMFY_PORT (env) > dist/comfy_port.txt > 8188.
// The desktop app (src-tauri) runs this same file and also sets AOS_APP / AOS_CONFIG (see server-lib/connection.mjs).
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleConnection, applySaved } from './server-lib/connection.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'dist');
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'comfy_paths.json'), 'utf8'));
const PROXIED = cfg.paths;
const ORIGIN_PRESERVED = cfg.originPreserved ?? [];   // ComfyUI-TJ_NODE's asset library checks Origin host == Host, so these keep the browser's headers

function comfyPort() {
  const env = (process.env.VITE_COMFY_PORT ?? '').trim();
  if (/^\d+$/.test(env)) return env;
  for (const f of [path.join(root, 'comfy_port.txt'), path.join(here, 'public', 'comfy_port.txt')]) {
    try { const v = fs.readFileSync(f, 'utf8').trim(); if (/^\d+$/.test(v)) return v; } catch {}
  }
  return '8188';
}
const defaultTarget = new URL(process.env.COMFY_URL ?? `http://127.0.0.1:${comfyPort()}`);
let target = defaultTarget;   // the ComfyUI this server forwards to; the desktop app's connection setup can change it
let targetHeaders = {};       // extra headers for that address (a Cloudflare Access service token)
const secure = () => target.protocol === 'https:';
const targetPort = () => Number(target.port || (secure() ? 443 : 80));
const connApi = { getTarget: () => target, setTarget(url, headers) { target = url ? new URL(/^https?:\/\//.test(url) ? url : `http://${url}`) : defaultTarget; targetHeaders = headers ?? {}; } };
applySaved(connApi);
const port = Number(process.env.PORT ?? 8778);

const matches = (list, p) => list.some((x) => p === x || p.startsWith(x + '/'));
const isProxied = (p) => matches(PROXIED, p) || matches(ORIGIN_PRESERVED, p) || p === '/ws';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.wasm': 'application/wasm',
};

function upstreamHeaders(req, keepOrigin) {
  if (keepOrigin) return { ...req.headers };
  return {
    ...req.headers, ...targetHeaders, host: target.host,
    ...(req.headers.origin ? { origin: target.origin } : {}),
    ...(req.headers.referer ? { referer: target.origin + '/' } : {}),
  };
}

const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (await handleConnection(req, res, connApi)) return;
  if (p === '/aos/target') {   // lets another desktop app recognise this address as an AI ONE STUDIO server
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ url: target.origin, token: Object.keys(targetHeaders).length > 0 }));
    return;
  }
  if (isProxied(p)) {
    const keep = matches(ORIGIN_PRESERVED, p);
    const up = (secure() ? https : http).request({ host: target.hostname, port: targetPort(), path: req.url, method: req.method, headers: upstreamHeaders(req, keep) }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
      r.on('error', () => res.destroy());
    });
    // a closed tab / aborted video range request must release the upstream socket, or they pile up until the proxy stalls
    res.on('close', () => { if (!res.writableFinished) up.destroy(); });
    up.on('error', (e) => {
      if (res.headersSent) return res.destroy();
      res.writeHead(504, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `upstream proxy error: ${e.code || e.message}`, stage: 'proxy' }));
    });
    req.pipe(up);
    return;
  }
  // static files from dist/, falling back to index.html (single-page app)
  let file = path.join(root, decodeURIComponent(p === '/' ? '/index.html' : p));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); res.end('dist/ is missing - run "npm run build" first.'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

// LLM / render routes can run for minutes: never time the connection out on our side
server.requestTimeout = 0;
server.timeout = 0;
server.keepAliveTimeout = 65_000;

// WebSocket: tunnel the raw upgrade to ComfyUI (tls when the target is https)
server.on('upgrade', (req, socket, head) => {
  const onOpen = () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(upstreamHeaders(req, false)).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
    if (head?.length) up.write(head);
    socket.pipe(up).pipe(socket);
  };
  const up = secure() ? tls.connect({ host: target.hostname, port: targetPort(), servername: target.hostname }, onOpen) : net.connect(targetPort(), target.hostname, onOpen);
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.listen(port, '0.0.0.0', () => console.log(`AI ONE STUDIO → http://localhost:${port}   (ComfyUI: ${target.origin})`));
