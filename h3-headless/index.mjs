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
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { makeClient, extractOutputs } from "./comfy.mjs";
import {
  buildClipGraph, buildFaceRefineGraph, buildImageGenGraph,
  buildCharacterSheetVideoGraph, buildCharacterSheetGridGraph, buildImageUpscaleGraph,
} from "./graph.mjs";
import { applyPresetByName } from "./presets.mjs";
import {
  FPS, defaultState, applyConfig, jobModeToGenerationMode,
  alignFrameCount, composePrompt, randomSeed, resolveResolution,
  CHARSHEET_FRAMES, CHARSHEET_DEFAULT_FRAME_INDICES,
} from "./core-helpers.mjs";

const HELP = `h3-headless — MiniMax H3 generator (AI-ONE-STUDIO extract)

USAGE
  node index.mjs --config <comfy.json> --job <job.json> [--dry-run] [--out <dir>]

  --config   ComfyUI connection: { baseUrl, headers?, timeoutMs? }
  --job      generation params — shape depends on job.mode (see below)
  --dry-run  build the graph(s) and print them; do NOT submit to /prompt
  --out      download the finished file(s) into this directory

job.mode values
  ref2va | fl2va | l2va | t2va   the original single-clip video modes (buildClipGraph)
  facerefine                     H3 Face Refine — re-render a small/distant face per frame
  imagegen_t2i | imagegen_ref2i  Image Generator — single still (T2I / Reference to Image)
  charsheet                      Character Sheet — ref2va turnaround video + grid assembly
                                  (two ComfyUI submissions: render, then grid-extract)
  imageupscale                   still-image Deblur / RTX VSR post-process

job.preset    (clip modes only) a name from the studio's saved presets (queried live from the
              ComfyUI config), or a built-in alias: stock | dense | turbo-4step | everyday |
              sla-turbo | pdd-spectrum. null -> keep the config defaults. Match is case /
              space / _ / - insensitive.
job.prompt    { integrated_multimodal_description, overall_soundscape, non_diegetic_music }
              or a plain string. (clip modes)
job.refImages absolute paths, in <Picture 1>, <Picture 2>, ... order (ref2va / ref2i / charsheet).
job.model     shorthand: sets unetFirstLast AND unetReference. Or set them separately.

job.mode:"facerefine" fields
  sourceFile        absolute path to the clip to refine (uploaded as a video input)
  prompt            plain string (reference-style conditioning)
  faceDetector      required — overrides config faceDetector
  seed, refImages    optional

job.mode:"imagegen_t2i" / "imagegen_ref2i" fields
  prompt, refImages (ref2i only), seed, aspect, megapixels, steps, turboOn, turboLora,
  final (default true — a headless run always does the full two-pass render)

job.mode:"charsheet" fields
  refImages (required), prompt, aspect, megapixels, seed, deblur ("none"|"LOW"|"MEDIUM"|
  "HIGH"|"ULTRA"), rtx:{rtxScale,rtxQuality}, frameIndices (8 ints, default the studio's own),
  cellWidth/cellHeight (default = render resolution)

job.mode:"imageupscale" fields
  inputFile (absolute path, uploaded as an image), deblur, rtx:{rtxScale,rtxQuality,srcW,srcH}

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

const abspath = (p, from = process.cwd()) => {
  if (p == null) return p;
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) return resolve(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(from, p);
};

/**
 * @param {object} job        the job spec (see --job)
 * @param {object} comfyConfig { baseUrl, headers?, timeoutMs? }
 * @param {object} [opts]      { dryRun?:bool, outDir?:string, onPoll?:fn }
 * @returns {Promise<object>}  { ok, promptId, outputs, localFiles, graphSubmitted, meta } | { ok:false, error, stage }
 */
const CLIP_MODES = new Set(["ref2va", "reference", "fl2va", "firstlast", "first_last", "l2va", "t2va", "text"]);

export async function generate(job, comfyConfig, opts = {}) {
  const { dryRun = false, outDir = null, onPoll } = opts;
  try {
    if (!job || typeof job !== "object") throw tag(new Error("job spec is required"), "config");
    const client = makeClient(comfyConfig);

    const cfg = await client.cfg();
    const state = defaultState();
    applyConfig(state, cfg);
    const avail = await client.nodeAvailability();

    const mode = String(job.mode || "t2va").toLowerCase();
    if (CLIP_MODES.has(mode)) return await runClip(job, state, cfg, avail, client, { dryRun, outDir, onPoll });
    if (mode === "facerefine") return await runFaceRefine(job, state, avail, client, { dryRun, outDir, onPoll });
    if (mode === "imagegen_t2i" || mode === "imagegen_ref2i") return await runImageGen(job, state, avail, client, { dryRun, outDir, onPoll, subMode: mode === "imagegen_ref2i" ? "ref2i" : "t2i" });
    if (mode === "charsheet") return await runCharSheet(job, state, avail, client, { dryRun, outDir, onPoll });
    if (mode === "imageupscale") return await runImageUpscale(job, state, avail, client, { dryRun, outDir, onPoll });
    throw tag(new Error(`unknown job.mode '${job.mode}'`), "config");
  } catch (e) {
    return { ok: false, error: e.message || String(e), stage: e.stage || "unknown" };
  }
}

function tag(err, stage) { err.stage = stage; return err; }

/** Submit one graph + poll + (optionally) download, sharing the same result contract across
 *  every mode below. `videoNode`/`saveNode` names the SaveImage/SaveVideo/VHS_VideoCombine
 *  node whose outputs to extract. */
async function submitAndCollect(client, graph, saveNode, { dryRun, outDir, onPoll, base }) {
  if (dryRun) return { ok: true, dryRun: true, ...base, graphSubmitted: graph };
  const { promptId, outputs } = await client.submitGraph(graph, { onPoll });
  const files = extractOutputs(outputs, saveNode);
  const outputsOut = files.map((f) => ({ ...f, url: client.viewUrl(f.filename, f.subfolder, f.fileType) }));
  let localFiles = [];
  if (outDir) {
    for (const f of files) localFiles.push(await client.downloadOutput({ filename: f.filename, subfolder: f.subfolder, type: f.fileType }, abspath(outDir)));
  }
  return { ok: true, promptId, outputs: outputsOut, localFiles, ...base };
}

// ── clip modes (ref2va/fl2va/l2va/t2va) — the original single-clip generator, unchanged ────
async function runClip(job, state, cfg, avail, client, { dryRun, outDir, onPoll }) {
  state.generationMode = jobModeToGenerationMode(job.mode);

  let presetInfo = { source: "none", name: null };
  if (job.preset != null && job.preset !== "") presetInfo = applyPresetByName(state, job.preset, cfg.user_presets);

  if (job.megapixels != null) state.megapixels = Number(job.megapixels);
  if (job.aspect) state.aspect = job.aspect;
  if (job.durationSeconds != null) state.clipFrames = alignFrameCount(Number(job.durationSeconds) * FPS);
  else if (job.frames != null) state.clipFrames = alignFrameCount(Number(job.frames));
  const modelOverride = job.model || job.unet || null;
  if (modelOverride) { state.unetFirstLast = modelOverride; state.unetReference = modelOverride; }
  if (job.unetFirstLast) state.unetFirstLast = job.unetFirstLast;
  if (job.unetReference) state.unetReference = job.unetReference;

  const seed = job.seed == null ? randomSeed() : Number(job.seed);
  const promptText = composePrompt(job.prompt);

  const refPaths = Array.isArray(job.refImages) ? job.refImages : [];
  const refImages = [];
  for (const p of refPaths) refImages.push(await client.uploadImage(abspath(p)));
  const firstFrame = job.firstFrame ? await client.uploadImage(abspath(job.firstFrame)) : null;
  const lastFrame = job.lastFrame ? await client.uploadImage(abspath(job.lastFrame)) : null;
  if (state.generationMode === "reference") {
    state.refImages = refImages;
    state.refImagesMp = refImages.map(() => 0);
  }

  const { graph, meta } = buildClipGraph(state, avail, { nodeId: "1", promptText, seed, firstFrame, lastFrame, refImages });
  const base = {
    mode: job.mode || "t2va",
    generationMode: state.generationMode,
    preset: presetInfo,
    model: { unetFirstLast: state.unetFirstLast, unetReference: state.unetReference, used: state.generationMode === "reference" ? state.unetReference : state.unetFirstLast },
    resolution: { width: meta.width, height: meta.height, megapixels: state.megapixels, aspect: state.aspect },
    frames: meta.frames, seed, steps: meta.steps, sampler: meta.samplerUsed, turboEffective: meta.turboEffective,
  };
  return submitAndCollect(client, graph, meta.videoNode, { dryRun, outDir, onPoll, base });
}

// ── facerefine ───────────────────────────────────────────────────────────────────────────
async function runFaceRefine(job, state, avail, client, { dryRun, outDir, onPoll }) {
  if (!job.sourceFile) throw tag(new Error("job.sourceFile is required for mode 'facerefine'"), "config");
  if (job.faceDetector) state.faceDetector = job.faceDetector;
  if (job.frSelect) state.frSelect = job.frSelect;
  if (job.frConfirmedPick) state.frConfirmedPick = job.frConfirmedPick;
  if (job.frUnet) { state.frUseCustomModel = true; state.frUnet = job.frUnet; }
  if (job.frClip) state.frClip = job.frClip;

  const sourceFile = await client.uploadImage(abspath(job.sourceFile));
  const refPaths = Array.isArray(job.refImages) ? job.refImages : [];
  const refImages = [];
  for (const p of refPaths) refImages.push(await client.uploadImage(abspath(p)));

  const seed = job.seed == null ? randomSeed() : Number(job.seed);
  const promptText = typeof job.prompt === "string" ? job.prompt : composePrompt(job.prompt);

  const { graph, meta } = buildFaceRefineGraph(state, avail, { sourceFile, promptText, seed, refImages: refImages.length ? refImages : null });
  const base = { mode: "facerefine", source: sourceFile, select: meta.select, denoise: meta.denoise, steps: meta.steps, turboMode: meta.turboMode, seed: meta.seed };
  return submitAndCollect(client, graph, meta.videoNode, { dryRun, outDir, onPoll, base });
}

// ── imagegen_t2i / imagegen_ref2i ───────────────────────────────────────────────────────
async function runImageGen(job, state, avail, client, { dryRun, outDir, onPoll, subMode }) {
  if (job.megapixels != null) state.megapixels = Number(job.megapixels);
  if (job.aspect) state.aspect = job.aspect;
  const modelOverride = job.model || job.unet || null;
  if (modelOverride) { state.unetFirstLast = modelOverride; state.unetReference = modelOverride; }
  if (job.unetFirstLast) state.unetFirstLast = job.unetFirstLast;
  if (job.unetReference) state.unetReference = job.unetReference;

  const previewRes = resolveResolution(state.aspect, Math.min(state.megapixels || 1.0, 0.35));
  const finalRes = resolveResolution(state.aspect, state.megapixels || 1.0);
  const seed = job.seed == null ? randomSeed() : Number(job.seed);
  const prompt = typeof job.prompt === "string" ? job.prompt : composePrompt(job.prompt);

  const refPaths = Array.isArray(job.refImages) ? job.refImages : [];
  const refImages = [];
  for (const p of refPaths) refImages.push(await client.uploadImage(abspath(p)));

  const turboOn = !!job.turboOn;
  const turboLora = job.turboLora || (subMode === "ref2i" ? state.imgTurboLoraRef2i : state.imgTurboLoraT2i);
  const filenamePrefix = `${(state.saveSubfolder || "one_minimax_h3").replace(/\\/g, "/")}/${state.filenamePrefix || "MMH3"}_IMG`;

  const { graph, saveNode } = buildImageGenGraph(state, avail, {
    subMode, final: job.final !== false, refImages, refImageSize: job.refImageSize || state.refImageSize,
    prompt, seed, previewRes, finalRes, filenamePrefix,
    steps: job.steps ?? 8, turboOn, turboLora, turboLoraStrength: job.turboLoraStrength ?? state.imgTurboLoraStrength,
    savePreview: job.savePreview,
  });
  const base = { mode: `imagegen_${subMode}`, seed, resolution: finalRes, prompt };
  return submitAndCollect(client, graph, saveNode, { dryRun, outDir, onPoll, base });
}

// ── charsheet (two ComfyUI submissions: render, then grid-extract) ─────────────────────────
async function runCharSheet(job, state, avail, client, { dryRun, outDir, onPoll }) {
  const refPaths = Array.isArray(job.refImages) ? job.refImages : [];
  if (!refPaths.length) throw tag(new Error("job.refImages is required for mode 'charsheet'"), "config");
  if (job.megapixels != null) state.megapixels = Number(job.megapixels);
  if (job.aspect) state.aspect = job.aspect;
  const modelOverride = job.model || job.unetReference || null;
  if (modelOverride) state.unetReference = modelOverride;

  const { width, height } = resolveResolution(state.aspect, state.megapixels || 1.0);
  const seed = job.seed == null ? randomSeed() : Number(job.seed);
  const prompt = typeof job.prompt === "string" ? job.prompt : composePrompt(job.prompt) || state.charSheetPrompt;
  const refImages = [];
  for (const p of refPaths) refImages.push(await client.uploadImage(abspath(p)));
  const folder = (state.saveSubfolder || "one_minimax_h3").replace(/\\/g, "/");
  const stem = state.filenamePrefix || "MMH3";

  const useLatentUpscale = !!job.useLatentUpscale;
  const firstPassRes = useLatentUpscale
    ? resolveResolution(state.aspect, (state.megapixels || 1.0) * (job.firstPassRatio ?? state.charSheetFirstPassRatio ?? 0.36))
    : null;
  const rtx = job.rtxVsr || job.rtx ? { rtxScale: job.rtx?.rtxScale ?? 2.0, rtxQuality: job.rtx?.rtxQuality ?? "ULTRA" } : null;

  const stage1 = buildCharacterSheetVideoGraph(state, avail, {
    refImages, refImageSize: job.refImageSize || state.refImageSize, prompt,
    deblur: job.deblur ?? state.charSheetDeblur, rtx, rtxSupersample: !!job.rtxSupersample,
    useLatentUpscale, firstPassRes, width, height, seed,
    filenamePrefix: `${folder}/${stem}_CHARSHEET`,
  });

  if (dryRun) {
    return { ok: true, dryRun: true, mode: "charsheet", stage: "video+grid (video graph shown; grid graph needs stage 1's real output filename)", resolution: { width, height }, seed, graphSubmitted: stage1.graph };
  }

  // Stage 1: render the turnaround video.
  const { promptId: promptId1, outputs: outputs1 } = await client.submitGraph(stage1.graph, { onPoll });
  const videoFiles = extractOutputs(outputs1, stage1.saveNode);
  if (!videoFiles.length) throw tag(new Error("Character Sheet stage 1 produced no video output"), "generate");
  const videoOut = videoFiles[0];

  // Copy the rendered video from output/ back into input/ so stage 2 can VHS_LoadVideo it,
  // and copy the first reference image too (grid cell 0). Mirrors api.ts copyOutputToInput —
  // comfy.mjs has no dedicated helper for this, so it's called directly via the client's
  // exposed postJson (already returned by makeClient for exactly this kind of one-off route).
  const videoInputName = await copyOutputToInput(client, videoOut.filename, videoOut.subfolder, videoOut.fileType);

  const cellWidth = job.cellWidth || state.charSheetCellW || width;
  const cellHeight = job.cellHeight || state.charSheetCellH || height;
  const stage2 = buildCharacterSheetGridGraph({
    videoFile: videoInputName, refImage: refImages[0],
    frameIndices: job.frameIndices || state.charSheetFrameIndices || CHARSHEET_DEFAULT_FRAME_INDICES,
    cellWidth, cellHeight, maxDimension: job.maxDimension || state.charSheetMaxSize || 2048,
    saveEachFrames: !!job.saveEachFrames,
    framesFilenamePrefix: `${folder}/${stem}_CHARSHEET_frames`,
    filenamePrefix: `${folder}/${stem}_CHARSHEET_grid`,
  }, avail);

  const { promptId: promptId2, outputs: outputs2 } = await client.submitGraph(stage2.graph, { onPoll });
  const gridFiles = extractOutputs(outputs2, stage2.saveNode);
  const outputsOut = [...videoFiles, ...gridFiles].map((f) => ({ ...f, url: client.viewUrl(f.filename, f.subfolder, f.fileType) }));

  let localFiles = [];
  if (outDir) {
    for (const f of [...videoFiles, ...gridFiles]) localFiles.push(await client.downloadOutput({ filename: f.filename, subfolder: f.subfolder, type: f.fileType }, abspath(outDir)));
  }

  return {
    ok: true, promptId: promptId2, videoPromptId: promptId1, outputs: outputsOut, localFiles,
    mode: "charsheet", resolution: { width, height }, seed,
  };
}

// ── imageupscale (still image: Deblur / RTX VSR) ────────────────────────────────────────────
async function runImageUpscale(job, state, avail, client, { dryRun, outDir, onPoll }) {
  if (!job.inputFile) throw tag(new Error("job.inputFile is required for mode 'imageupscale'"), "config");
  const inputFile = await client.uploadImage(abspath(job.inputFile));
  const folder = (state.saveSubfolder || "one_minimax_h3").replace(/\\/g, "/");
  const stem = state.filenamePrefix || "MMH3";
  const rtx = job.rtx ? { rtxScale: job.rtx.rtxScale ?? 2.0, rtxQuality: job.rtx.rtxQuality ?? "ULTRA", srcW: job.rtx.srcW || 1024, srcH: job.rtx.srcH || 1024 } : null;

  const { graph, saveNode } = buildImageUpscaleGraph({ inputFile, deblur: job.deblur || "none", rtx, folder, stem, saveSuffix: job.saveSuffix || "_post" }, avail);
  const base = { mode: "imageupscale", source: inputFile };
  return submitAndCollect(client, graph, saveNode, { dryRun, outDir, onPoll, base });
}

/** POST /minimax_h3_one/copy_to_input — moves a just-rendered output/ file into input/ so a
 *  second graph (Character Sheet's grid stage) can VHS_LoadVideo/LoadImage it. Mirrors
 *  src/tools/minimax_h3/api.ts copyOutputToInput(); comfy.mjs stays generic (shared by every
 *  *-headless/ folder) so this one MiniMax-H3-specific route is called from here via the
 *  client's already-exposed postJson, not added to comfy.mjs itself. */
async function copyOutputToInput(client, filename, subfolder, type) {
  const d = await client.postJson("/minimax_h3_one/copy_to_input", { filename, subfolder: subfolder || "", type: type || "output" });
  if (!d.ok) { const err = new Error(d.error || "copy_to_input failed"); err.stage = "submit"; throw err; }
  return d.filename;
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
    onPoll: (pid) => { if (process.env.H3_HEADLESS_VERBOSE) process.stderr.write(`… still generating (${pid})\n`); },
  });

  // Set exitCode and let the loop drain rather than process.exit() — a hard exit can race
  // undici's socket teardown and crash on some Node builds. `Connection: close` (comfy.mjs)
  // keeps the drain instant.
  await new Promise((r) => process.stdout.write(JSON.stringify(result, null, 2) + "\n", r));
  process.exitCode = result.ok ? 0 : 1;
}
