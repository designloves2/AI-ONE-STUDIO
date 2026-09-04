#!/usr/bin/env node
// index.mjs — headless Z-Image Turbo image generator (Text->Image / Image->Image).
//
//   node index.mjs --config comfy.json --job job.json [--dry-run] [--out ./result]
//
// or:  import { generate } from "./index.mjs";
//
// Extracts src/tools/zimage/ (buildT2IGraph / buildI2IGraph -> /prompt -> /history) with zero
// DOM / build step / npm deps. Node 20+. See README.md.

import { readFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { makeClient, extractOutputs } from "./comfy.mjs";
import { buildGraph } from "./graph.mjs";
import { API, defaultState, applyConfig, randomSeed } from "./core-helpers.mjs";

const HELP = `zimage-headless — Z-Image Turbo T2I / I2I image generator (AI-ONE-STUDIO extract)

USAGE
  node index.mjs --config <comfy.json> --job <job.json> [--dry-run] [--out <dir>]

  --config   ComfyUI connection: { baseUrl, headers?, timeoutMs? }
  --job      generation params (see below)
  --dry-run  build the graph and print it; do NOT submit
  --out      download the finished image(s) into this directory

job.json
  {
    "mode": "t2i" | "i2i",
    "prompt": "a red bicycle ...",          // or { "positive": "...", "negative": "..." }
    "negativePrompt": "blurry, text",       // optional
    "width": 1024, "height": 1536,          // t2i
    "steps": 8, "cfg": 1, "shift": 3, "sampler": "euler", "scheduler": "simple",
    "seed": null,                           // null -> random
    "loras": [ { "name": "x.safetensors", "strength": 1, "triggerWord": "", "enabled": true } ],
    "model": "...", "textEncoder": "...", "vae": "...",   // optional; else from ComfyUI config
    "saveSubfolder": "one_z-image",
    // i2i:
    "i2iImage": "/abs/path/src.png", "i2iDenoise": 0.75, "i2iWidth": null, "i2iHeight": null
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
    const mode = job.mode === "i2i" ? "i2i" : "t2i";
    const client = makeClient(comfyConfig, { apiPrefix: API });

    const cfg = await client.cfg();
    const state = defaultState();
    applyConfig(state, cfg);
    state.mode = mode;

    const p = job.prompt;
    const promptText = p && typeof p === "object" ? (p.positive || "") : (p || "");
    state.prompt = String(promptText);
    if (p && typeof p === "object" && p.negative != null) state.negativePrompt = String(p.negative);
    if (job.negativePrompt != null) state.negativePrompt = String(job.negativePrompt);

    for (const k of ["steps", "cfg", "shift", "sampler", "scheduler", "width", "height", "i2iDenoise", "i2iWidth", "i2iHeight", "saveSubfolder", "model", "textEncoder", "vae", "outputMode"]) {
      if (job[k] != null) state[k] = job[k];
    }
    if (Array.isArray(job.loras)) state.loras = job.loras;
    const seed = job.seed == null ? randomSeed() : Number(job.seed);
    state.seed = seed;

    if (mode === "i2i") {
      if (!job.i2iImage) throw tag(new Error("i2i mode needs job.i2iImage"), "config");
      state.i2iImage = await client.uploadImage(abspath(job.i2iImage));
    }

    const { graph, meta } = buildGraph(state);

    const base = {
      mode,
      model: { used: state.model, textEncoder: state.textEncoder, vae: state.vae },
      prompt: state.prompt,
      negativePrompt: state.negativePrompt,
      resolution: meta.width && meta.height ? { width: meta.width, height: meta.height } : undefined,
      steps: meta.steps,
      seed,
      shift: meta.shift,
      sampler: meta.samplerUsed,
      denoise: meta.denoise,
      loras: state.loras.filter((l) => l && l.name && l.name !== "none" && l.enabled !== false).map((l) => l.name),
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
    onPoll: (pid) => { if (process.env.ZIMAGE_HEADLESS_VERBOSE) process.stderr.write(`… still generating (${pid})\n`); },
  });

  await new Promise((r) => process.stdout.write(JSON.stringify(result, null, 2) + "\n", r));
  process.exitCode = result.ok ? 0 : 1;
}
