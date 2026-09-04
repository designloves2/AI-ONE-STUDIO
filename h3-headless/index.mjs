#!/usr/bin/env node
// index.mjs — headless MiniMax H3 single-clip generator.
//
//   node index.mjs --config comfy.json --job job.json [--dry-run] [--out ./result]
//
// or programmatically:
//   import { generate } from "./index.mjs";
//   const result = await generate(jobSpec, comfyConfig);
//
// Extracts what the AI-ONE-STUDIO frontend does internally (buildClipGraph -> /prompt ->
// /history) with zero DOM / build step / npm deps. See README.md.

import { readFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { makeClient, extractOutputs } from "./comfy.mjs";
import { buildClipGraph } from "./graph.mjs";
import { applyPresetByName } from "./presets.mjs";
import {
  FPS, defaultState, applyConfig, jobModeToGenerationMode,
  alignFrameCount, composePrompt, randomSeed,
} from "./core-helpers.mjs";

const HELP = `h3-headless — MiniMax H3 single-clip generator (AI-ONE-STUDIO extract)

USAGE
  node index.mjs --config <comfy.json> --job <job.json> [--dry-run] [--out <dir>]

  --config   ComfyUI connection: { baseUrl, headers?, timeoutMs? }
  --job      generation params: { mode, preset, durationSeconds, megapixels, seed,
             prompt, refImages, firstFrame, lastFrame, model?/unetFirstLast?/unetReference? }
  --dry-run  build the graph and print it; do NOT submit to /prompt
  --out      download the finished file(s) into this directory

job.mode      ref2va | fl2va | l2va | t2va
job.preset    a name from the studio's saved presets (queried live from the ComfyUI config),
              or a built-in alias: stock | dense | turbo-4step | everyday | sla-turbo | pdd-spectrum.
              null -> keep the config defaults. Match is case / space / _ / - insensitive.
job.prompt    { integrated_multimodal_description, overall_soundscape, non_diegetic_music }
              or a plain string.
job.refImages absolute paths, in <Picture 1>, <Picture 2>, ... order (ref2va).
job.model     shorthand: sets unetFirstLast AND unetReference. Or set them separately.

OUTPUT (stdout, JSON)
  ok:true  -> { promptId, outputs:[{type,filename,subfolder,url}], localFiles:[...], graphSubmitted }
  ok:false -> { error, stage }   stage: config|preset|auth|upload|submit|generate|timeout|download|network
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

/**
 * @param {object} job        the job spec (see --job)
 * @param {object} comfyConfig { baseUrl, headers?, timeoutMs? }
 * @param {object} [opts]      { dryRun?:bool, outDir?:string, onPoll?:fn }
 * @returns {Promise<object>}  { ok, promptId, outputs, localFiles, graphSubmitted, meta } | { ok:false, error, stage }
 */
export async function generate(job, comfyConfig, opts = {}) {
  const { dryRun = false, outDir = null, onPoll } = opts;
  try {
    if (!job || typeof job !== "object") throw tag(new Error("job spec is required"), "config");
    const client = makeClient(comfyConfig);

    // 1. backend config -> state
    const cfg = await client.cfg();
    const state = defaultState();
    applyConfig(state, cfg);

    // 2. mode
    state.generationMode = jobModeToGenerationMode(job.mode);

    // 3. preset (queried live from cfg.user_presets, then built-in fallback)
    let presetInfo = { source: "none", name: null };
    if (job.preset != null && job.preset !== "") {
      presetInfo = applyPresetByName(state, job.preset, cfg.user_presets);
    }

    // 4. job overrides (after the preset, so a job can still tweak a preset)
    if (job.megapixels != null) state.megapixels = Number(job.megapixels);
    if (job.aspect) state.aspect = job.aspect;
    if (job.durationSeconds != null) {
      state.clipFrames = alignFrameCount(Number(job.durationSeconds) * FPS);
    } else if (job.frames != null) {
      state.clipFrames = alignFrameCount(Number(job.frames));
    }
    const modelOverride = job.model || job.unet || null;
    if (modelOverride) { state.unetFirstLast = modelOverride; state.unetReference = modelOverride; }
    if (job.unetFirstLast) state.unetFirstLast = job.unetFirstLast;
    if (job.unetReference) state.unetReference = job.unetReference;

    const seed = job.seed == null ? randomSeed() : Number(job.seed);
    const promptText = composePrompt(job.prompt);

    // 5. upload local images
    const refPaths = Array.isArray(job.refImages) ? job.refImages : [];
    const refImages = [];
    for (const p of refPaths) refImages.push(await client.uploadImage(abspath(p)));
    const firstFrame = job.firstFrame ? await client.uploadImage(abspath(job.firstFrame)) : null;
    const lastFrame = job.lastFrame ? await client.uploadImage(abspath(job.lastFrame)) : null;
    if (state.generationMode === "reference") {
      state.refImages = refImages;
      state.refImagesMp = refImages.map(() => 0); // send as uploaded; job could add per-image MP later
    }

    // 6. availability + graph
    const avail = await client.nodeAvailability();
    const { graph, meta } = buildClipGraph(state, avail, { nodeId: "1", promptText, seed, firstFrame, lastFrame, refImages });

    const base = {
      mode: job.mode || "t2va",
      generationMode: state.generationMode,
      preset: presetInfo,
      model: { unetFirstLast: state.unetFirstLast, unetReference: state.unetReference, used: state.generationMode === "reference" ? state.unetReference : state.unetFirstLast },
      resolution: { width: meta.width, height: meta.height, megapixels: state.megapixels, aspect: state.aspect },
      frames: meta.frames,
      seed,
      steps: meta.steps,
      sampler: meta.samplerUsed,
      turboEffective: meta.turboEffective,
      graphSubmitted: graph,
    };

    if (dryRun) return { ok: true, dryRun: true, ...base };

    // 7. submit + poll
    const { promptId, outputs } = await client.submitGraph(graph, { onPoll });
    const files = extractOutputs(outputs, meta.videoNode);
    const outputsOut = files.map((f) => ({ ...f, url: client.viewUrl(f.filename, f.subfolder, f.fileType) }));

    // 8. download
    let localFiles = [];
    if (outDir) {
      for (const f of files) localFiles.push(await client.downloadOutput({ filename: f.filename, subfolder: f.subfolder, type: f.fileType }, abspath(outDir)));
    }

    return { ok: true, promptId, outputs: outputsOut, localFiles, ...base };
  } catch (e) {
    return { ok: false, error: e.message || String(e), stage: e.stage || "unknown" };
  }
}

function tag(err, stage) { err.stage = stage; return err; }

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
    onPoll: (pid) => { if (process.env.H3_HEADLESS_VERBOSE) process.stderr.write(`… still generating (${pid})\n`); },
  });

  // Set exitCode and let the loop drain rather than process.exit() — a hard exit can race
  // undici's socket teardown and crash on some Node builds. `Connection: close` (comfy.mjs)
  // keeps the drain instant.
  await new Promise((r) => process.stdout.write(JSON.stringify(result, null, 2) + "\n", r));
  process.exitCode = result.ok ? 0 : 1;
}
