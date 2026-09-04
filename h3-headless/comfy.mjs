// comfy.mjs — ComfyUI HTTP client for the headless generator. Node 20+ (global fetch /
// FormData / Blob). Ported from src/tools/minimax_h3/api.ts + comfyClient.ts, minus the
// WebSocket path — a plain /history poll is all a server-side caller needs.
//
// Every request carries comfyConfig.headers (Cloudflare Access service token, etc.).
// A 401/403 anywhere throws an Error tagged `.stage = "auth"`.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";

export function makeClient(comfyConfig) {
  const baseUrl = String(comfyConfig.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("comfy.json: baseUrl is required");
  const headers = comfyConfig.headers || {};
  const timeoutMs = comfyConfig.timeoutMs ?? 30 * 60 * 1000;
  const clientId = comfyConfig.clientId || randomUUID();

  async function req(path, init = {}) {
    const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
    let r;
    try {
      // `Connection: close` so Node's fetch doesn't leave a pooled keep-alive socket open —
      // otherwise the CLI hangs ~4s after finishing, or crashes on some Node builds if
      // process.exit() races undici's socket teardown.
      r = await fetch(url, { ...init, headers: { connection: "close", ...headers, ...(init.headers || {}) } });
    } catch (e) {
      const err = new Error(`network error reaching ${url}: ${e.message}`);
      err.stage = "network";
      throw err;
    }
    if (r.status === 401 || r.status === 403) {
      const err = new Error(`${r.status} from ${url} — check comfy.json headers (Cloudflare Access service token).`);
      err.stage = "auth";
      throw err;
    }
    return r;
  }

  async function getJson(path) {
    const r = await req(path);
    if (!r.ok) {
      const err = new Error(`GET ${path} -> ${r.status}`);
      err.stage = "config";
      throw err;
    }
    return r.json();
  }

  async function postJson(path, body) {
    const r = await req(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const text = await r.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
    if (!r.ok) {
      const err = new Error(`POST ${path} -> ${r.status}: ${text.slice(0, 500)}`);
      err.stage = "submit";
      err.body = data;
      throw err;
    }
    return data;
  }

  /** Upload a local image into ComfyUI's input/ folder. Returns the stored filename. */
  async function uploadImage(absPath) {
    const buf = await readFile(absPath);
    const fd = new FormData();
    fd.append("image", new Blob([buf]), basename(absPath));
    fd.append("subfolder", "");
    fd.append("type", "input");
    fd.append("overwrite", "false");
    const r = await req("/upload/image", { method: "POST", body: fd });
    if (!r.ok) {
      const err = new Error(`upload failed for ${absPath} -> ${r.status}`);
      err.stage = "upload";
      throw err;
    }
    const d = await r.json();
    // ComfyUI returns { name, subfolder, type }. LoadImage wants "name" (or "subfolder/name").
    return d.subfolder ? `${d.subfolder}/${d.name}` : d.name;
  }

  const cfg = () => getJson("/minimax_h3_one/config");
  const models = () => getJson("/minimax_h3_one/models").catch(() => ({}));
  const nodeAvailability = () =>
    getJson("/minimax_h3_one/node_availability")
      .then((d) => d.available || {})
      .catch(() => ({}));

  function viewUrl(filename, subfolder = "", type = "output") {
    const q = new URLSearchParams({ filename, subfolder: subfolder || "", type });
    return `${baseUrl}/view?${q.toString()}`;
  }

  /** POST /prompt, then poll /history/{id} every `pollMs` until completed / errored / timeout. */
  async function submitGraph(graph, { pollMs = 700, onPoll } = {}) {
    const data = await postJson("/prompt", { prompt: graph, client_id: clientId });
    if (data.error) {
      const detail = data.node_errors ? ` (${Object.keys(data.node_errors).join(", ")})` : "";
      const err = new Error(`${data.error.message || "queue failed"}${detail}`);
      err.stage = "submit";
      err.body = data;
      throw err;
    }
    const promptId = data.prompt_id;
    if (!promptId) {
      const err = new Error("no prompt_id in /prompt response");
      err.stage = "submit";
      throw err;
    }

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (Date.now() > deadline) {
        const err = new Error(`timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${promptId}`);
        err.stage = "timeout";
        err.promptId = promptId;
        throw err;
      }
      await new Promise((res) => setTimeout(res, pollMs));
      let hd;
      try {
        hd = await getJson(`/history/${promptId}`);
      } catch (e) {
        if (e.stage === "auth") throw e;
        continue; // transient — retry
      }
      const entry = hd?.[promptId];
      if (!entry) { onPoll?.(promptId); continue; }
      const status = entry.status || {};
      const msgTypes = Array.isArray(status.messages) ? status.messages.map((m) => m?.[0]) : [];
      if (msgTypes.includes("execution_interrupted")) {
        const err = new Error("generation was interrupted server-side");
        err.stage = "interrupted";
        err.promptId = promptId;
        throw err;
      }
      if (status.status_str === "error" || msgTypes.includes("execution_error")) {
        const msg = (status.messages || [])
          .map((m) => m?.[1]?.exception_message || m?.[1]?.exception_type || "")
          .filter(Boolean)
          .join(" | ") || "execution error";
        const err = new Error(msg);
        err.stage = "generate";
        err.promptId = promptId;
        err.history = entry;
        throw err;
      }
      if (status.completed) {
        return { promptId, outputs: entry.outputs || {}, status };
      }
      onPoll?.(promptId);
    }
  }

  /** Download a /view file to destDir. Returns the local path. */
  async function downloadOutput(outFile, destDir) {
    await mkdir(destDir, { recursive: true });
    const url = viewUrl(outFile.filename, outFile.subfolder || "", outFile.type || "output");
    const r = await req(url);
    if (!r.ok) {
      const err = new Error(`GET /view -> ${r.status} for ${outFile.filename}`);
      err.stage = "download";
      throw err;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const dest = join(destDir, basename(outFile.filename));
    await writeFile(dest, buf);
    return dest;
  }

  return { baseUrl, clientId, req, getJson, postJson, uploadImage, cfg, models, nodeAvailability, viewUrl, submitGraph, downloadOutput };
}

/** Pull the video/image outputs out of a SaveVideo/SaveImage node result. */
export function extractOutputs(outputsByNode, saveNode) {
  const out = outputsByNode?.[saveNode] || {};
  const files = out.images || out.gifs || out.videos || [];
  return files.map((f) => ({
    type: /\.(mp4|webm|mov|mkv|gif)$/i.test(f.filename || "") ? "video" : "image",
    filename: f.filename,
    subfolder: f.subfolder || "",
    fileType: f.type || "output",
  }));
}
