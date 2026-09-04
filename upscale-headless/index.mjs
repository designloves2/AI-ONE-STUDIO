#!/usr/bin/env node
// index.mjs — headless SeedVR2 image upscaler.
//
//   node index.mjs --config comfy.json --job job.json [--dry-run] [--out ./result]
//
// or:  import { generate } from "./index.mjs";
//
// Extracts the SeedVR2 upscale graph shared by src/tools/krea2 and src/tools/zimage. Zero
// DOM / build step / npm deps. Node 20+. See README.md.

import { readFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { makeClient, extractOutputs } from "./comfy.mjs";
import { buildUpscaleGraph } from "./graph.mjs";

// Either tool's config route works to list SeedVR2 models — Krea2's is the one with the
// dedicated /seedvr2_models endpoint. Used only for the --list helper / diagnostics.
const API = "/krea2_one";

const HELP = `upscale-headless — SeedVR2 image upscaler (AI-ONE-STUDIO extract)

USAGE
  node index.mjs --config <comfy.json> --job <job.json> [--dry-run] [--out <dir>]
  node index.mjs --config <comfy.json> --list-models

  --config       ComfyUI connection: { baseUrl, headers?, timeoutMs? }
  --job          upscale params (see below)
  --dry-run      build the graph and print it; do NOT submit
  --out          download the finished image(s) into this directory
  --list-models  print the SeedVR2 DiT / VAE model filenames the server has, then exit

job.json
  {
    "image": "/abs/path/src.png",           // required — the image to upscale
    "ditModel": "seedvr2_ema_3b_fp16.safetensors",   // required
    "vaeModel": "seedvr2_vae_fp16.safetensors",      // required
    "resolution": 2048,                     // target short side
    "maxResolution": 4096,
    "batchSize": 1,
    "blocksToSwap": 0,                      // raise to fit a big model in less VRAM
    "attentionMode": "sdpa",               // sdpa | flash_attn_2 | flash_attn_3 | sageattn_2 | sageattn_3
    "colorCorrection": "lab",              // lab | wavelet | wavelet_adaptive | hsv | adain | none
    "offloadDevice": "cpu",                // cpu | none  (none = keep model on GPU)
    "inputNoiseScale": 0, "latentNoiseScale": 0,
    "seed": 42,
    "saveSubfolder": "one_upscale"
  }

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
    else if (t === "--list-models") a.flags.listModels = true;
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
    const client = makeClient(comfyConfig, { apiPrefix: API });

    const src = await client.uploadImage(abspath(job.image));
    const { graph, meta } = buildUpscaleGraph({ ...job, image: src });

    const base = {
      ditModel: meta.ditModel,
      vaeModel: meta.vaeModel,
      resolution: meta.resolution,
      maxResolution: meta.maxResolution,
      seed: meta.seed,
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
  if (a.flags.help || (!a.config && !a.job && !a.flags.listModels)) { process.stdout.write(HELP); process.exit(a.flags.help ? 0 : 2); }
  if (!a.config) { console.error("--config is required"); process.exit(2); }

  const comfyConfig = await readFile(abspath(a.config), "utf8").then(JSON.parse)
    .catch((e) => { console.error(JSON.stringify({ ok: false, error: `failed to read config: ${e.message}`, stage: "config" })); process.exit(1); });

  if (a.flags.listModels) {
    const client = makeClient(comfyConfig, { apiPrefix: API });
    const [seed, models] = await Promise.all([client.seedvr2Models(), client.models()]);
    const list = seed.models || models.upscale_models || models.seedvr2_models || [];
    await new Promise((r) => process.stdout.write(JSON.stringify({ ok: true, seedvr2Models: list }, null, 2) + "\n", r));
    process.exitCode = 0;
  } else {
    if (!a.job) { console.error("--job is required"); process.exit(2); }
    const job = await readFile(abspath(a.job), "utf8").then(JSON.parse)
      .catch((e) => { console.error(JSON.stringify({ ok: false, error: `failed to read job: ${e.message}`, stage: "config" })); process.exit(1); });

    const result = await generate(job, comfyConfig, {
      dryRun: !!a.flags.dryRun,
      outDir: a.out || null,
      onPoll: (pid) => { if (process.env.UPSCALE_HEADLESS_VERBOSE) process.stderr.write(`… still upscaling (${pid})\n`); },
    });
    await new Promise((r) => process.stdout.write(JSON.stringify(result, null, 2) + "\n", r));
    process.exitCode = result.ok ? 0 : 1;
  }
}
