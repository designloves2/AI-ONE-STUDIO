#!/usr/bin/env node
// index.mjs — headless Flux2 Klein image generator.
//
//   node index.mjs --config comfy.json --job job.json [--dry-run] [--out ./result]
//
// or:  import { generate } from "./index.mjs";
//      const result = await generate(jobSpec, comfyConfig);
//
// Extracts src/tools/klein/ (fetch pre-made workflow JSON -> patch -> /prompt -> /history) with
// zero DOM / build step / npm deps. Node 20+. See README.md.

import { readFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { makeClient, extractOutputs } from "./comfy.mjs";
import { buildGraph } from "./graph.mjs";
import { API, defaultState, applyConfig, randomSeed } from "./core-helpers.mjs";

const HELP = `klein-headless — Flux2 Klein image generator (AI-ONE-STUDIO extract)

USAGE
  node index.mjs --config <comfy.json> --job <job.json> [--dry-run] [--out <dir>]

  --config   ComfyUI connection: { baseUrl, headers?, timeoutMs? }
  --job      generation params (see below)
  --dry-run  build the (patched) graph and print it; do NOT submit
             (still needs a reachable ComfyUI — the workflow JSON is fetched from it)
  --out      download the finished image(s) into this directory

job.json
  {
    "mode": "t2i" | "i2i" | "edit" | "inpaint" | "outpaint" | "faceswap",
    "prompt": "a red bicycle ...",          // or { "positive": "...", "negative": "..." }
    "negativePrompt": "blurry, text",       // optional
    "width": 1024, "height": 1536,          // t2i / edit(manual size)
    "steps": 4, "cfg": 1, "sampler": "euler", "scheduler": "simple",
    "seed": null,                           // null -> random
    "kvCacheOverride": "auto",              // "auto" | "on" | "off" (Flux KV cache)
    "loras": [ { "name": "x.safetensors", "strength": 1.0, "triggerWord": "", "enabled": true } ],
    "model": "...", "textEncoder": "...", "vae": "...",   // optional; else from ComfyUI config
    "saveSubfolder": "one_flux2-klein",
    "outputMode": "save",                   // "save" | "preview"

    // i2i:      "i2iImage": "/abs/src.png", "i2iDenoise": 0.75, "i2iWidth": null, "i2iHeight": null,
    // edit:     "editImage1": "/abs/a.png", "editImage2": "/abs/b.png" (optional),
    //           "editSizeSource": "img1" | "manual",
    // inpaint:  "inpaintImage": "/abs/src.png", "inpaintMaskImage": "/abs/mask.png",
    //           "inpaintDenoise": 0.85,
    // outpaint: "outpaintImage": "/abs/src.png",
    //           "outpaintUp": 256, "outpaintDown": 0, "outpaintLeft": 0, "outpaintRight": 0,
    //           "outpaintPadR": 0, "outpaintPadG": 0, "outpaintPadB": 0,
    // faceswap: "faceswapTarget": "/abs/scene.png", "faceswapSource": "/abs/face.png",
    //           "faceswapDenoise": 1.0,
    //           "bfsLora": { "name": "bfs.safetensors", "strength": 1.0, "enabled": true }
  }

OUTPUT (stdout JSON)
  ok:true  -> { promptId, outputs:[{type,filename,subfolder,url}], localFiles:[...], graphSubmitted }
  ok:false -> { error, stage }   stage: config|auth|upload|submit|generate|timeout|download|network
`;

const MODES = new Set(["t2i", "i2i", "edit", "inpaint", "outpaint", "faceswap"]);

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

const abspath = (p, from = process.cwd()) => {
  if (p == null) return p;
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) return resolve(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(from, p);
};
function tag(err, stage) { err.stage = stage; return err; }

export async function generate(job, comfyConfig, opts = {}) {
  const { dryRun = false, outDir = null, onPoll } = opts;
  try {
    if (!job || typeof job !== "object") throw tag(new Error("job spec is required"), "config");
    // studio convention: mode "inpaint" + paintSubMode "outpaint" == outpaint
    let mode = String(job.mode || "t2i");
    if (mode === "inpaint" && (job.paintSubMode === "outpaint")) mode = "outpaint";
    if (!MODES.has(mode)) throw tag(new Error(`unknown mode "${mode}" — one of ${[...MODES].join(" / ")}`), "config");

    const client = makeClient(comfyConfig, { apiPrefix: API });
    const loadWorkflow = async (name) => {
      try {
        return await client.getJson(`/flux_klein/workflow_${name}`);
      } catch (e) {
        if (e.stage === "auth") throw e;
        throw tag(new Error(`could not load the "${name}" workflow from ComfyUI (${e.message}) — is the flux_klein node pack installed? try restarting ComfyUI.`), "config");
      }
    };

    const cfg = await client.cfg();
    const state = defaultState();
    applyConfig(state, cfg);
    state.mode = mode; // graph.mjs switches on state.mode ("outpaint" is a first-class case)
    if (mode === "outpaint") state.paintSubMode = "outpaint";

    // prompt
    const p = job.prompt;
    const promptText = p && typeof p === "object" ? (p.positive || "") : (p || "");
    state.prompt = String(promptText);
    const key = mode === "outpaint" ? "outpaint" : mode;
    state.promptsByMode = { ...state.promptsByMode, [key]: String(promptText) };
    if (p && typeof p === "object" && p.negative != null) state.negativePrompt = String(p.negative);
    if (job.negativePrompt != null) state.negativePrompt = String(job.negativePrompt);

    // scalar overrides
    for (const k of [
      "steps", "cfg", "sampler", "scheduler", "width", "height", "kvCacheOverride",
      "saveSubfolder", "model", "textEncoder", "vae", "outputMode",
      "i2iDenoise", "i2iWidth", "i2iHeight", "editSizeSource",
      "inpaintDenoise", "faceswapDenoise",
      "outpaintUp", "outpaintDown", "outpaintLeft", "outpaintRight",
      "outpaintPadR", "outpaintPadG", "outpaintPadB",
    ]) {
      if (job[k] != null) state[k] = job[k];
    }
    if (Array.isArray(job.loras)) state.loras = job.loras;
    if (job.bfsLora && typeof job.bfsLora === "object") state.bfsLora = job.bfsLora;
    const seed = job.seed == null ? randomSeed() : Number(job.seed);
    state.seed = seed;

    // per-mode image uploads
    const up = (path) => client.uploadImage(abspath(path));
    if (mode === "i2i") {
      if (!job.i2iImage) throw tag(new Error("i2i mode needs job.i2iImage"), "config");
      state.i2iImage = await up(job.i2iImage);
    } else if (mode === "edit") {
      if (!job.editImage1) throw tag(new Error("edit mode needs job.editImage1"), "config");
      state.editImage1 = await up(job.editImage1);
      if (job.editImage2) state.editImage2 = await up(job.editImage2);
    } else if (mode === "inpaint") {
      if (!job.inpaintImage) throw tag(new Error("inpaint needs job.inpaintImage"), "config");
      if (!job.inpaintMaskImage) throw tag(new Error("inpaint needs job.inpaintMaskImage"), "config");
      state.inpaintImage = await up(job.inpaintImage);
      state.inpaintMaskImage = await up(job.inpaintMaskImage);
    } else if (mode === "outpaint") {
      if (!job.outpaintImage) throw tag(new Error("outpaint needs job.outpaintImage"), "config");
      state.outpaintImage = await up(job.outpaintImage);
    } else if (mode === "faceswap") {
      if (!job.faceswapTarget) throw tag(new Error("faceswap needs job.faceswapTarget"), "config");
      if (!job.faceswapSource) throw tag(new Error("faceswap needs job.faceswapSource"), "config");
      state.faceswapTarget = await up(job.faceswapTarget);
      state.faceswapSource = await up(job.faceswapSource);
    }

    const { graph, meta } = await buildGraph(state, loadWorkflow);

    const base = {
      mode,
      model: { used: state.model, textEncoder: state.textEncoder, vae: state.vae },
      prompt: state.prompt,
      negativePrompt: state.negativePrompt,
      resolution: meta.width && meta.height ? { width: meta.width, height: meta.height } : undefined,
      steps: meta.steps,
      cfg: meta.cfg,
      seed,
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
    onPoll: (pid) => { if (process.env.KLEIN_HEADLESS_VERBOSE) process.stderr.write(`… still generating (${pid})\n`); },
  });

  await new Promise((r) => process.stdout.write(JSON.stringify(result, null, 2) + "\n", r));
  process.exitCode = result.ok ? 0 : 1;
}
