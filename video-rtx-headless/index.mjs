#!/usr/bin/env node
// index.mjs — headless RTX video upscale / deblur.
//
//   node index.mjs --config comfy.json --job job.json [--dry-run] [--out ./result]
//
// or:  import { generate } from "./index.mjs";
//
// RTX-only: RTXVideoSuperResolution + TJ_RTXDeblur (NVIDIA RTX Video SDK). Extracted from
// src/tools/minimax_h3/graphBuilder.ts. Zero DOM / build step / npm deps. Node 20+.

import { readFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { makeClient, extractOutputs } from "./comfy.mjs";
import { buildVideoRtxGraph } from "./graph.mjs";

const HELP = `video-rtx-headless — RTX video upscale / deblur (AI-ONE-STUDIO extract)

USAGE
  node index.mjs --config <comfy.json> --job <job.json> [--dry-run] [--out <dir>]

  --config   ComfyUI connection: { baseUrl, headers?, timeoutMs? }
  --job      { op, video, scale?, quality?, fps?, saveSubfolder? }
  --dry-run  build the graph and print it; do NOT submit
  --out      download the finished video into this directory

job.json
  { "op": "upscale", "video": "/abs/clip.mp4", "scale": 2.0, "quality": "HIGH" }
  { "op": "deblur",  "video": "/abs/clip.mp4", "quality": "HIGH" }
  { "op": "both",    "video": "/abs/clip.mp4", "scale": 2.0, "quality": "HIGH" }

  op         "upscale" | "deblur" | "both"
  scale      upscale multiplier (default 2.0)
  quality    LOW | MEDIUM | HIGH | ULTRA  (default HIGH) — applies to both the deblur and the
             upscale node
  fps        output frame rate (default 24 — set it if the source isn't 24fps)

OUTPUT (stdout JSON)
  ok:true  -> { promptId, outputs:[{type,filename,subfolder,url}], localFiles:[...], graphSubmitted }
  ok:false -> { error, stage }   stage: config|auth|upload|submit|generate|timeout|download|network
`;

function parseArgs(argv) {
  const a = { flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--help" || t === "-h") a.flags.help = true;
    else if (t === "--dry-run") a.flags.dryRun = true;
    else if (t === "--config") a.config = argv[++i];
    else if (t === "--job") a.job = argv[++i];
    else if (t === "--out") a.out = argv[++i];
    else if (t.startsWith("--")) throw new Error(`unknown flag: ${t}`);
  }
  return a;
}

const abspath = (p, from = process.cwd()) => (p == null ? p : isAbsolute(p) ? p : resolve(from, p));
function tag(err, stage) { err.stage = stage; return err; }

export async function generate(job, comfyConfig, opts = {}) {
  const { dryRun = false, outDir = null, onPoll } = opts;
  try {
    if (!job || typeof job !== "object") throw tag(new Error("job spec is required"), "config");
    if (!job.video) throw tag(new Error("job.video is required (an absolute path to the source clip)"), "config");
    const client = makeClient(comfyConfig);

    const uploaded = await client.uploadImage(abspath(job.video)); // /upload/image accepts video too
    const { graph, meta } = buildVideoRtxGraph(uploaded, job);

    const base = {
      op: meta.op,
      scale: meta.scale,
      deblurQuality: meta.deblurQuality,
      upscaleQuality: meta.upscaleQuality,
      fps: meta.fps,
      graphSubmitted: graph,
    };
    if (dryRun) return { ok: true, dryRun: true, ...base };

    const { promptId, outputs } = await client.submitGraph(graph, { onPoll });
    const files = extractOutputs(outputs, meta.saveNode);
    const outputsOut = files.map((f) => ({ ...f, url: client.viewUrl(f.filename, f.subfolder, f.fileType) }));

    let localFiles = [];
    if (outDir) {
      for (const f of files) localFiles.push(await client.downloadOutput({ filename: f.filename, subfolder: f.subfolder, type: f.fileType }, abspath(outDir)));
    }
    return { ok: true, promptId, outputs: outputsOut, localFiles, ...base };
  } catch (e) {
    return { ok: false, error: e.message || String(e), stage: e.stage || "unknown" };
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const a = (() => { try { return parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); } })();
  if (a.flags.help || (!a.config && !a.job)) { process.stdout.write(HELP); process.exit(a.flags.help ? 0 : 2); }
  if (!a.config) { console.error("--config is required"); process.exit(2); }
  if (!a.job) { console.error("--job is required"); process.exit(2); }

  const [comfyConfig, job] = await Promise.all([
    readFile(abspath(a.config), "utf8").then(JSON.parse),
    readFile(abspath(a.job), "utf8").then(JSON.parse),
  ]).catch((e) => { console.error(JSON.stringify({ ok: false, error: `failed to read input: ${e.message}`, stage: "config" })); process.exit(1); });

  const result = await generate(job, comfyConfig, {
    dryRun: !!a.flags.dryRun,
    outDir: a.out || null,
    onPoll: (pid) => { if (process.env.VIDEO_RTX_HEADLESS_VERBOSE) process.stderr.write(`… still processing (${pid})\n`); },
  });

  await new Promise((r) => process.stdout.write(JSON.stringify(result, null, 2) + "\n", r));
  process.exitCode = result.ok ? 0 : 1;
}
