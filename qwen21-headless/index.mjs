#!/usr/bin/env node
// index.mjs — headless QWEN IMAGE 2.1 image generator (T2I / I2I / Ref to Image / Edit / Pose).
//
//   node index.mjs --config comfy.json --job job.json [--dry-run] [--out ./result]
//
// or:  import { generate } from "./index.mjs";
//
// Extracts src/tools/qwen21/ (buildT2IGraph / buildI2IGraph / buildRefToImageGraph /
// buildEditGraph / buildPoseExtractGraph+buildPoseGraph -> /prompt -> /history) with zero
// DOM / build step / npm deps. Node 20+. See README.md.
//
// Scope: t2i, i2i, ref2i, edit, pose only. Paint (inpaint/outpaint) and Upscale (SeedVR2) are
// NOT included — out of scope for this package.

import { readFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { makeClient, extractOutputs } from "./comfy.mjs";
import { buildGraph, buildPoseExtractGraph, buildPoseGraph } from "./graph.mjs";
import { API, defaultState, applyConfig, randomSeed } from "./core-helpers.mjs";

const HELP = `qwen21-headless — QWEN IMAGE 2.1 T2I / I2I / Ref-to-Image / Edit / Pose generator (AI-ONE-STUDIO extract)

USAGE
  node index.mjs --config <comfy.json> --job <job.json> [--dry-run] [--out <dir>]

  --config   ComfyUI connection: { baseUrl, headers?, timeoutMs? }
  --job      generation params (see below)
  --dry-run  build the graph and print it; do NOT submit
             (pose mode still needs a reachable ComfyUI: Stage 1 must actually run so Stage 2's
             graph has a poseRenderImage filename to reference — dry-run for pose returns the
             Stage 2 graph only after a real Stage 1 submission)
  --out      download the finished image(s) into this directory

MODES  (job.mode)
  t2i     — text to image
  i2i     — single source image (job.i2iImage), denoise-based
  ref2i   — up to 10 reference images (job.refImages[]), composed at their own output size
            (this is the web studio's "I2I -> Ref to Image" sub-mode, flattened to its own
            top-level mode here for a clearer job spec — see README "mode mapping")
  edit    — Image 1 required (job.editImage1) + up to 9 more (job.editImage2, job.editRefImages[])
            NOTE: no "Draw annotation" support — headless has no canvas. Plain images only.
  pose    — two-stage: Stage 1 extracts a SAM3D-Body pose render from job.poseImage (used as-is,
            uncropped, at its native size — the web's client-side crop tool is not replicated
            here), Stage 2 generates using that render (<image1>) + job.poseCharacterImage
            (<image2>) through the VNCCS PoseStudio LoRA.

job.json (shared fields)
  {
    "mode": "t2i" | "i2i" | "ref2i" | "edit" | "pose",
    "prompt": "...",                        // or { "positive": "...", "negative": "..." }
    "negativePrompt": "blurry, text",       // optional
    "width": 1024, "height": 1024,          // t2i / edit / pose (resolution input)
    "resolution": 1024,                     // TextEncodeQwenImage21's own int input
    "steps": 20, "cfg": 1.0, "sampler": "euler", "scheduler": "simple",
    "maxShift": 0.69, "baseShift": 0.5,     // ModelSamplingFlux
    "useCache": true, "useSageAttention": false,
    "seed": null,                           // null -> random
    "loras": [ { "name": "x.safetensors", "strength": 1, "triggerWord": "", "enabled": true } ],
    "model": "...", "textEncoder": "...", "vae": "...",   // optional; else from ComfyUI config
    "saveSubfolder": "qwen21-one-tj", "outputMode": "save",   // "save" | "preview"
    "refMaxMegapixels": 0,                  // ref2i/edit/pose image auto-downscale, 0 = off

    // i2i:
    "i2iImage": "/abs/src.png", "i2iDenoise": 0.75, "i2iWidth": null, "i2iHeight": null,
    // ref2i:
    "refImages": ["/abs/r1.png", "/abs/r2.png"], "refWidth": 1024, "refHeight": 1024, "refDenoise": 1.0,
    // edit:
    "editImage1": "/abs/img1.png", "editImage2": "/abs/img2.png",
    "editRefImages": ["/abs/r3.png", ...],   // up to 9 total across editImage2 + editRefImages
    // pose:
    "poseImage": "/abs/pose_source.png",     // used as-is, uncropped, at native size
    "poseCharacterImage": "/abs/character.png",
    "poseLoraModel": "vnccs_posestudio.safetensors",  // or set via ComfyUI config
    "poseLoraStrength": 1, "poseSamModel": "sam_3d_body_dinov3_bf16.safetensors",
    "poseSystemPrompt": "replace the pose of <image 2> with the pose of <image 1>. keep the character of <image 2>."
  }

OUTPUT (stdout JSON)
  ok:true  -> { promptId, outputs:[{type,filename,subfolder,url}], localFiles:[...], graphSubmitted }
              pose adds: poseExtract:{ promptId, renderImage }
  ok:false -> { error, stage }   stage: config|auth|upload|submit|generate|timeout|download|network
`;

const MODES = new Set(["t2i", "i2i", "ref2i", "edit", "pose"]);

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
    const mode = String(job.mode || "t2i");
    if (!MODES.has(mode)) throw tag(new Error(`unknown mode "${mode}" — one of ${[...MODES].join(" / ")}`), "config");

    const client = makeClient(comfyConfig, { apiPrefix: API });

    const cfg = await client.cfg();
    const state = defaultState();
    applyConfig(state, cfg);
    state.mode = mode;

    // prompt
    const p = job.prompt;
    const promptText = p && typeof p === "object" ? (p.positive || "") : (p || "");
    state.prompt = String(promptText);
    const promptKey = mode === "ref2i" ? "ref2img" : mode;
    state.promptsByMode = { ...state.promptsByMode, [promptKey]: String(promptText) };
    if (p && typeof p === "object" && p.negative != null) state.negativePrompt = String(p.negative);
    if (job.negativePrompt != null) state.negativePrompt = String(job.negativePrompt);

    // scalar overrides
    for (const k of [
      "steps", "cfg", "sampler", "scheduler", "width", "height", "resolution",
      "maxShift", "baseShift", "useCache", "useSageAttention",
      "saveSubfolder", "model", "textEncoder", "vae", "outputMode", "refMaxMegapixels",
      "i2iDenoise", "i2iWidth", "i2iHeight",
      "refWidth", "refHeight", "refDenoise",
      "poseLoraModel", "poseLoraStrength", "poseSamModel", "poseSystemPrompt",
    ]) {
      if (job[k] != null) state[k] = job[k];
    }
    if (Array.isArray(job.loras)) state.loras = job.loras;
    const seed = job.seed == null ? randomSeed() : Number(job.seed);
    state.seed = seed;

    // per-mode image uploads
    const up = (path) => client.uploadImage(abspath(path));
    if (mode === "i2i") {
      if (!job.i2iImage) throw tag(new Error("i2i mode needs job.i2iImage"), "config");
      state.i2iImage = await up(job.i2iImage);
    } else if (mode === "ref2i") {
      const paths = Array.isArray(job.refImages) ? job.refImages : [];
      if (!paths.length) throw tag(new Error("ref2i mode needs job.refImages (array of absolute paths)"), "config");
      state.refImages = [];
      for (const path of paths.slice(0, 10)) state.refImages.push({ filename: await up(path) });
    } else if (mode === "edit") {
      if (!job.editImage1) throw tag(new Error("edit mode needs job.editImage1"), "config");
      state.editImage1 = await up(job.editImage1);
      if (job.editImage2) state.editImage2 = await up(job.editImage2);
      const extraPaths = Array.isArray(job.editRefImages) ? job.editRefImages : [];
      state.editRefImages = [];
      for (const path of extraPaths.slice(0, 9)) state.editRefImages.push({ filename: await up(path) });
    } else if (mode === "pose") {
      if (!job.poseImage) throw tag(new Error("pose mode needs job.poseImage"), "config");
      if (!job.poseCharacterImage) throw tag(new Error("pose mode needs job.poseCharacterImage"), "config");
      state.poseImage = await up(job.poseImage);
      state.poseCharacterImage = await up(job.poseCharacterImage);
    }

    // ── POSE: two sequential queued generations. Stage 1 (SAM3D pose extract) must finish and
    // hand its output filename to Stage 2 (the actual Qwen generation) before Stage 2's graph
    // can even be built — mirrors view.ts's generate() branch for state.mode === "pose".
    let poseExtractMeta = null;
    if (mode === "pose") {
      const { graph: extractGraph, meta: extractGraphMeta } = buildPoseExtractGraph(state);
      if (dryRun) {
        return { ok: true, dryRun: true, mode, stage: "poseExtract-only", note: "pose dry-run only builds Stage 1's graph — Stage 2 needs a real render filename from a submitted Stage 1.", graphSubmitted: extractGraph };
      }
      const { promptId: extractPromptId, outputs: extractOutputs_ } = await client.submitGraph(extractGraph, { onPoll });
      const extractFiles = extractOutputs(extractOutputs_, extractGraphMeta.saveNode);
      const renderFile = extractFiles[0];
      if (!renderFile) throw tag(new Error("pose extraction (Stage 1) produced no image."), "generate");
      // SAM3D's render lands in output/ but Stage 2's LoadImage only validates input/ — copy it
      // over first (mirrors api.ts's copyOutputToInput / the studio's "Send to" reuse flow).
      const copyResp = await client.postJson(`${API}/copy_to_input`, { filename: renderFile.filename, subfolder: renderFile.subfolder || "", type: renderFile.fileType || "output" });
      if (!copyResp.ok) throw tag(new Error(copyResp.error || "copy_to_input failed for the pose render"), "generate");
      state.poseRenderImage = copyResp.filename;
      poseExtractMeta = { promptId: extractPromptId, renderImage: state.poseRenderImage };
    }

    const { graph, meta } = mode === "pose" ? buildPoseGraph(state, state.poseRenderImage || "") : buildGraph(state);

    const base = {
      mode,
      model: { used: state.model, textEncoder: state.textEncoder, vae: state.vae },
      prompt: state.prompt,
      negativePrompt: state.negativePrompt,
      resolution: meta.width && meta.height ? { width: meta.width, height: meta.height } : undefined,
      steps: meta.steps,
      seed,
      sampler: meta.samplerUsed,
      denoise: meta.denoise,
      loras: state.loras.filter((l) => l && l.name && l.name !== "none" && l.enabled !== false).map((l) => l.name),
      poseExtract: poseExtractMeta || undefined,
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
    onPoll: (pid) => { if (process.env.QWEN21_HEADLESS_VERBOSE) process.stderr.write(`… still generating (${pid})\n`); },
  });

  await new Promise((r) => process.stdout.write(JSON.stringify(result, null, 2) + "\n", r));
  process.exitCode = result.ok ? 0 : 1;
}
