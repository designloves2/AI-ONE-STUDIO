#!/usr/bin/env node
// index.mjs — headless MusicMaker generator (MiniMax Music 3 / Ace-Step 1.5).
//
//   node index.mjs --config comfy.json --job job.json [--dry-run] [--out ./result]
//
// or:  import { generate } from "./index.mjs";
//      const result = await generate(jobSpec, comfyConfig);
//
// Extracts ComfyUI-TJ_NODE_STUDIO_ONE/web/music/graph_builder_music.js
// (buildMusicGraph -> /prompt -> /history -> /view) with zero DOM / build step / deps.
// Node 20+. The caption + lyrics are FINISHED TEXT the caller supplies — there is no
// LLM step here (same split as krea2-headless). Album-cover generation is out of scope.

import { readFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { makeClient, extractOutputs } from "./comfy.mjs";
import { buildMusicGraph } from "./graph.mjs";
import { API, defaultState, applyConfig, randomSeed } from "./core-helpers.mjs";

const HELP = `music-headless — MusicMaker MiniMax Music 3 / Ace-Step 1.5 (AI-ONE-STUDIO extract)

USAGE
  node index.mjs --config <comfy.json> --job <job.json> [--dry-run] [--out <dir>]

  --config   ComfyUI connection: { baseUrl, headers?, timeoutMs? }
  --job      generation params (see below)
  --dry-run  build the graph and print it; do NOT submit
  --out      download the finished audio into this directory

job.json
  {
    "engine": "acestep" | "minimax",        // default: from studio config, else acestep
    "caption": "moody synthwave, midnight drive, female vocal",  // REQUIRED — finished style text
    "lyrics": "[Verse]\\n...\\n[Chorus]\\n...",   // finished lyrics; omit for instrumental
    "instrumental": false,                   // true -> no vocals, lyrics forced empty
    "duration": 180,                         // seconds (15-300). A "3:00"/"3분" in caption/lyricsInput wins.
    "title": "Neon Drive",                   // written into the track meta
    "seed": null,                            // null -> random

    "bpm": 120, "keyscale": "A minor", "timesignature": "4", "language": "en",
    "vocalGender": "female", "vocalStyle": "auto", "voiceTone": "auto",   // "auto" = leave to the model

    // MiniMax Music 3
    "steps": 30, "cfg": 1.7, "cfgScale": 1.7, "topK": 50,
    "sampler": "euler", "scheduler": "simple", "tiledDecode": false,

    // Ace-Step 1.5
    "cfgScaleAce": 2.5, "temperature": 0.75, "topP": 0.9, "minP": 0, "topKAce": 0,
    "aceShift": 3, "aceSamplerName": "jkass_quality", "aceScheduler": "sgm_uniform",
    "aceStages": [ {"steps":30,"cfg":0}, {"steps":20,"cfg":1,"on":true}, {"steps":15,"cfg":1,"on":true} ],
    //   stage 1 always runs; 2 & 3 opt-in and sequential (3 needs 2 on)

    "loras": [ { "name": "x.safetensors", "strength": 1.0, "enabled": true } ],
    "format": "flac" | "mp3" | "opus", "audioQuality": "V0",
    "saveSubfolder": "one_music", "filenamePrefix": "MMM",

    // model overrides — omit normally, taken from GET /music_one/config
    "dit": "...", "clip": "...", "dav": "...",
    "aceUnet": "...", "aceClip1": "...", "aceClip2": "...", "aceVae": "..."
  }

OUTPUT (stdout JSON)
  ok:true  -> { promptId, outputs:[{type:"audio",filename,subfolder,url}], localFiles:[...], meta, graphSubmitted }
  ok:false -> { error, stage }   stage: config|auth|submit|generate|interrupted|timeout|download|network
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

const JOB_KEYS = [
  "engine", "caption", "captionBrief", "lyrics", "lyricsInput", "instrumental", "title", "styleFamily",
  "duration", "bpm", "keyscale", "timesignature", "language",
  "vocalGender", "vocalStyle", "voiceTone",
  "steps", "cfg", "cfgScale", "topK", "sampler", "scheduler", "tiledDecode",
  "cfgScaleAce", "temperature", "topP", "minP", "topKAce", "genAudioCodes",
  "aceStages", "aceShift", "aceSamplerName", "aceScheduler",
  "format", "audioQuality", "saveSubfolder", "filenamePrefix",
  "dit", "clip", "dav", "aceUnet", "aceClip1", "aceClip2", "aceVae",
];

export async function generate(job, comfyConfig, opts = {}) {
  const { dryRun = false, outDir = null, onPoll } = opts;
  try {
    if (!job || typeof job !== "object") throw tag(new Error("job spec is required"), "config");
    if (!String(job.caption || "").trim()) throw tag(new Error("job.caption is required (finished style text)"), "config");

    const client = makeClient(comfyConfig, { apiPrefix: API });
    const cfg = await client.cfg();

    const state = defaultState(job);
    applyConfig(state, cfg, job);
    for (const k of JOB_KEYS) if (job[k] != null) state[k] = job[k];
    if (state.instrumental) state.lyrics = "";

    const seed = job.seed == null ? randomSeed() : Number(job.seed);
    state.seed = seed;

    const { graph, meta, saveNode, seedUsed } = buildMusicGraph(state, { seed });

    const base = {
      engine: state.engine,
      title: state.title || undefined,
      seconds: meta.seconds,
      seed: seedUsed,
      instrumental: meta.instrumental,
      meta,
      graphSubmitted: graph,
    };

    if (dryRun) return { ok: true, dryRun: true, ...base };

    const { promptId, outputs } = await client.submitGraph(graph, { onPoll });
    const files = extractOutputs(outputs, saveNode);
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
    onPoll: (pid) => { if (process.env.MUSIC_HEADLESS_VERBOSE) process.stderr.write(`… still generating (${pid})\n`); },
  });

  await new Promise((r) => process.stdout.write(JSON.stringify(result, null, 2) + "\n", r));
  process.exitCode = result.ok ? 0 : 1;
}
