// core-helpers.mjs — pure state + config→state mapper for the headless MusicMaker
// generator. Ported from src/tools/music/core.ts (defaultState) + view.ts's GET
// /music_one/config → state block. UI-only fields (styles, layout, engineStash,
// cover generation) are dropped — the graph builder never reads them.

export const SUBFOLDER = "one_music";
export const API = "/music_one";

export const DURATION_DEFAULT = 120;

export function randomSeed() {
  return Math.floor(Math.random() * 1e15);
}

/** Music state the graph builder reads. `saved` = a job.json's fields already merged in. */
export function defaultState(saved = {}) {
  return {
    engine: saved.engine === "minimax" ? "minimax" : "acestep",

    // MiniMax Music 3 models
    dit:  saved.dit  || "",
    clip: saved.clip || "",
    dav:  saved.dav  || "",

    // Ace-Step 1.5 models
    aceUnet:  saved.aceUnet  || "",
    aceClip1: saved.aceClip1 || "",
    aceClip2: saved.aceClip2 || "",
    aceVae:   saved.aceVae   || "",
    aceShift:       saved.aceShift       ?? 3,
    aceSamplerName: saved.aceSamplerName || "jkass_quality",
    aceScheduler:   saved.aceScheduler   || "sgm_uniform",
    // stage 1 always runs; stages 2 & 3 are sequential opt-in (3 needs 2 on)
    aceStages: Array.isArray(saved.aceStages)
      ? saved.aceStages.map((s, i) => ({ steps: s.steps, cfg: (i === 0 && s.cfg === 0) ? 1 : s.cfg, on: i === 0 ? true : s.on !== false }))
      : [{ steps: 30, cfg: 1, on: true }, { steps: 20, cfg: 1, on: true }, { steps: 15, cfg: 1, on: true }],

    bpm:           saved.bpm           ?? 120,
    keyscale:      saved.keyscale      || "A minor",
    timesignature: saved.timesignature || "4",
    language:      saved.language      || "en",
    cfgScaleAce:   saved.cfgScaleAce   ?? 2.5,
    temperature:   saved.temperature   ?? 0.75,
    topP:          saved.topP          ?? 0.9,
    minP:          saved.minP          ?? 0,
    topKAce:       saved.topKAce       ?? 0,
    genAudioCodes: saved.genAudioCodes ?? true,

    // finished text — the headless caller supplies these (no LLM step here)
    caption:      saved.caption      || "",
    captionBrief: saved.captionBrief || "",
    lyrics:       saved.lyrics       || "",
    lyricsInput:  saved.lyricsInput  || "",
    instrumental: saved.instrumental ?? false,
    title:        saved.title        || "",
    styleFamily:  saved.styleFamily  || "",
    vocalGender:  saved.vocalGender  || "auto",
    vocalStyle:   saved.vocalStyle   || "auto",
    voiceTone:    saved.voiceTone    || "auto",

    duration:  saved.duration  ?? DURATION_DEFAULT,
    steps:     saved.steps     ?? 30,
    cfg:       saved.cfg       ?? 1.7,
    cfgScale:  saved.cfgScale  ?? 1.7,
    topK:      saved.topK      ?? 50,
    sampler:   saved.sampler   || "euler",
    scheduler: saved.scheduler || "simple",
    seed:      saved.seed      ?? 0,
    tiledDecode: saved.tiledDecode ?? false,
    format:      saved.format      || "flac",
    audioQuality: saved.audioQuality || "V0",

    loras: (Array.isArray(saved.loras) ? saved.loras : [])
      .filter((l) => l && l.name && l.name !== "none")
      .slice(0, 3)
      .map((l) => ({ name: l.name, strength: l.strength ?? 1.0, enabled: l.enabled !== false })),

    // meta only
    llmBackend: saved.llmBackend || "local",
    llmModel:   saved.llmModel   || "",
    llmOrModel: saved.llmOrModel || "",
    llmClip:    saved.llmClip    || "",

    saveSubfolder:  saved.saveSubfolder  || "",
    filenamePrefix: saved.filenamePrefix || "",
  };
}

/** GET /music_one/config → state. Only fills what the job.json didn't set (job wins). */
export function applyConfig(state, cfg = {}, job = {}) {
  const fill = (key, val) => { if ((job[key] == null || job[key] === "") && val) state[key] = val; };
  fill("dit", cfg.dit);
  fill("clip", cfg.clip);
  fill("dav", cfg.dav);
  fill("aceUnet", cfg.ace_unet);
  fill("aceClip1", cfg.ace_clip1);
  fill("aceClip2", cfg.ace_clip2);
  fill("aceVae", cfg.ace_vae);
  fill("aceSamplerName", cfg.ace_sampler_name);
  fill("aceScheduler", cfg.ace_scheduler);
  if (job.aceShift == null && cfg.ace_shift != null) state.aceShift = cfg.ace_shift;
  if (job.engine == null && cfg.engine) state.engine = cfg.engine === "minimax" ? "minimax" : "acestep";
  if (!state.saveSubfolder && cfg.save_subfolder && cfg.save_subfolder !== SUBFOLDER) state.saveSubfolder = cfg.save_subfolder;
  if (job.steps == null && cfg.steps != null) state.steps = cfg.steps;
  if (job.cfg == null && cfg.cfg != null) state.cfg = cfg.cfg;
  if (job.cfgScale == null && cfg.cfg_scale != null) state.cfgScale = cfg.cfg_scale;
  if (job.topK == null && cfg.top_k != null) state.topK = cfg.top_k;
  if (job.sampler == null && cfg.sampler) state.sampler = cfg.sampler;
  if (job.scheduler == null && cfg.scheduler) state.scheduler = cfg.scheduler;
  if (job.format == null && cfg.format) state.format = cfg.format;
  state.llmBackend = cfg.llm_backend || state.llmBackend;
  state.llmModel = cfg.llm_model ?? state.llmModel;
  state.llmOrModel = cfg.llm_or_model ?? state.llmOrModel;
  state.llmClip = cfg.llm_clip ?? state.llmClip;
  return state;
}
