// core.ts — MusicMaker ONE STUDIO (TJ) constants, state, helpers.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/music/core_music.js — 1:1 이식
// (노드 위젯 전용 레이아웃 상수 NODE_W/LEFT_W 등은 값 그대로 유지, el/clear/randomSeed/
//  fmtDur/settingsBadge 헬퍼도 원본 그대로 — 원본 view가 이 헬퍼들을 그대로 쓴다).
export const BRAND = "#7612DA";
export const C = {
  lime: BRAND, bg0: "#0b0b0b", bg1: "#111111", bg2: "#181818",
  bg3: "#222222", border: "#2a2a2a", borderH: "#3c3c3c",
  text: "#dedede", muted: "#565656", dim: "#2e2e2e",
  warn: "#ffb347", err: "#ff6767",
};

export const NODE_W    = 1180;
export const LEFT_W    = 380;
export const PLAYER_H  = 56;
export const PAD       = 12;
export const SUBFOLDER = "one_music";
export const API       = "/music_one";
export const LS_KEY    = "music_one_state_v1";

// ── engine axis ──────────────────────────────────────────────────────────────
export const ENGINES = [
  { key: "minimax", label: "MiniMax Music 3" },
  { key: "acestep", label: "Ace-Step 1.5" },
];
export const ACE_LANGUAGES = ["en", "ko", "ja", "zh", "es", "fr", "de", "auto"];
export const ACE_KEYSCALES = [
  "C major", "A minor", "G major", "E minor", "D major", "B minor",
  "F major", "D minor", "A major", "F# minor", "Bb major", "G minor",
  "auto",
];
export const ACE_TIMESIGS = ["4", "3", "6", "2"];

export const SAMPLERS   = ["euler", "euler_ancestral", "dpmpp_2m", "heun"];
export const SCHEDULERS = ["simple", "sgm_uniform", "normal", "karras"];
export const LORA_MAX   = 3;
export const AUDIO_FORMATS = ["flac", "mp3", "opus"];

export const DURATION_MIN = 15;
export const DURATION_MAX = 300;
export const DURATION_DEFAULT = 120;

export const STYLE_CHIPS = [
  "upbeat pop", "emotional ballad", "lofi hip-hop", "cinematic orchestral",
  "synthwave", "acoustic", "K-ballad", "city pop", "jazz", "rock band",
  "anime rock", "EDM dance-pop", "choir", "instrumental (no vocals)",
];

export const LLM_ROLES = [
  "lyrics_from_theme", "lyrics_from_title", "lyrics_enhance",
  "caption_rewrite", "title", "cover_prompt",
];

// State fields that belong to ONE engine — swapped when the engine switches.
export const ENGINE_FIELDS = [
  "lyricsInput", "lyrics", "caption", "captionBrief", "styleChips", "instrumental",
  "vocalGender", "vocalStyle", "voiceTone",
  "duration", "seed", "seedMode", "format", "audioQuality", "loras",
  "steps", "cfg", "cfgScale", "topK", "sampler", "scheduler", "tiledDecode",
  "bpm", "keyscale", "timesignature", "language",
  "cfgScaleAce", "temperature", "topP", "minP", "topKAce", "genAudioCodes",
  "aceStages", "aceShift", "aceScheduler", "aceSamplerName",
];

export const VOCAL_GENDER = ["auto", "female", "male", "duet (f + m)", "group / choir", "instrumental (no vocals)"];
export const VOCAL_STYLE  = ["auto", "smooth", "powerful belt", "breathy", "raspy", "whispered", "falsetto", "spoken word", "rap / flow", "operatic", "auto-tuned", "harmonized"];
export const VOICE_TONE   = ["auto", "warm", "bright", "dark", "airy", "gritty", "deep", "nasal", "youthful", "mature", "androgynous"];

export const LLM_BACKENDS = [
  { key: "local",      label: "Local (TJ_NODE GGUF)" },
  { key: "openrouter", label: "OpenRouter" },
  { key: "comfy",      label: "ComfyUI TextGenerate" },
];
export const LLM_CLIP_TYPES = ["qwen_image", "lumina2", "ltxv", "pixart", "hidream", "wan", "hunyuan_image", "flux2", "sd3", "stable_diffusion"];

export const LYRIC_TAGS = [
  "[Intro]", "[Verse]", "[Pre-Chorus]", "[Chorus]", "[Post-Chorus]",
  "[Bridge]", "[Instrumental]", "[Break]", "[Outro]",
];

// ── lyrics-box intent router ─────────────────────────────────────────────────
export function lyricsIntent(text: string): "empty" | "enhance" | "brief" | "hook" {
  const s = String(text || "").trim();
  if (!s) return "empty";
  const hasTags = /\[(intro|verse|chorus|bridge|outro|pre-chorus|instrumental|break)\]/i.test(s);
  const metaLang = /(가사|만들어|써\s?줘|작사|이야기로|느낌의|느낌으로|짜리|분\s*짜리|write.*lyrics|about|make.*song)/i.test(s);
  const lineCount = s.split(/\n/).filter((l) => l.trim()).length;
  if (hasTags) return "enhance";
  if (metaLang) return "brief";
  if (lineCount >= 4) return "enhance";
  return "hook";
}

export function loadState(): any {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
}
export function saveState(s: any) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}

export function defaultState(saved: any): any {
  saved = saved || {};
  return {
    engine: saved.engine || "minimax",

    dit:  saved.dit  || "",
    clip: saved.clip || "",
    dav:  saved.dav  || "",

    aceUnet:  saved.aceUnet  || "",
    aceClip1: saved.aceClip1 || "",
    aceClip2: saved.aceClip2 || "",
    aceVae:   saved.aceVae   || "",
    aceShift:       saved.aceShift       ?? 3,
    aceSamplerName: saved.aceSamplerName || "jkass_quality",
    aceScheduler:   saved.aceScheduler   || "sgm_uniform",
    aceStages:      Array.isArray(saved.aceStages) ? saved.aceStages
                    : [{ steps: 30, cfg: 0 }, { steps: 20, cfg: 1 }, { steps: 15, cfg: 1 }],
    bpm:          saved.bpm          ?? 120,
    keyscale:     saved.keyscale     || "A minor",
    timesignature: saved.timesignature || "4",
    language:     saved.language     || "en",
    cfgScaleAce:  saved.cfgScaleAce  ?? 2.5,
    temperature:  saved.temperature  ?? 0.75,
    topP:         saved.topP         ?? 0.9,
    minP:         saved.minP         ?? 0,
    topKAce:      saved.topKAce      ?? 0,
    genAudioCodes: saved.genAudioCodes ?? true,

    lyricsInput:  saved.lyricsInput  || "",
    lyrics:       saved.lyrics       || "",
    captionBrief: saved.captionBrief || "",
    caption:      saved.caption      || "",
    styleChips:   Array.isArray(saved.styleChips) ? saved.styleChips : [],
    styleFamily:  saved.styleFamily  || "",
    title:        saved.title        || "",
    instrumental: saved.instrumental ?? false,
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
    seedMode:  saved.seedMode  || "random",
    batch:     saved.batch     ?? 1,
    tiledDecode: saved.tiledDecode ?? false,
    format:      saved.format      || "flac",
    audioQuality: saved.audioQuality || "V0",

    makeCover:  saved.makeCover  ?? true,
    coverBrief: saved.coverBrief || "",

    loras: (Array.isArray(saved.loras) ? saved.loras : [])
      .filter((l: any) => l && l.name && l.name !== "none")
      .slice(0, LORA_MAX)
      .map((l: any) => ({ name: l.name, strength: l.strength ?? 1.0, enabled: l.enabled !== false })),

    llmBackend:   saved.llmBackend   || "local",
    llmModel:     saved.llmModel     || "",
    llmOrModel:   saved.llmOrModel   || "",
    llmClip:      saved.llmClip      || "",
    llmClipType:  saved.llmClipType  || "qwen_image",

    engineStash: (saved.engineStash && typeof saved.engineStash === "object") ? saved.engineStash : {},

    advanced:   saved.advanced   ?? true,
    continuous: saved.continuous ?? true,
    leftW:      saved.leftW      ?? LEFT_W,
    lyricsH:    saved.lyricsH    ?? 160,
    styleH:     saved.styleH     ?? 160,

    saveSubfolder: saved.saveSubfolder || "",
    filenamePrefix: saved.filenamePrefix || "MMM",
  };
}

export function el(tag: string, props?: any, children?: any[]): any {
  const node = document.createElement(tag);
  if (props) {
    for (const k in props) {
      if (k === "style") Object.assign(node.style, props.style);
      else if (k === "text") node.textContent = props.text;
      else if (k === "html") node.innerHTML = props.html;
      else if (k === "className" || k === "class") node.className = props[k];
      else if (k === "value") (node as any).value = props[k];
      else if (k.startsWith("on") && typeof props[k] === "function") node.addEventListener(k.slice(2), props[k]);
      else node.setAttribute(k, props[k]);
    }
  }
  (children || []).forEach((c) => { if (c) node.appendChild(c); });
  return node;
}
export function clear(node: Node) { while (node.firstChild) node.removeChild(node.firstChild); }
export function randomSeed() { return Math.floor(Math.random() * 1e15); }

/** mm:ss from seconds */
export function fmtDur(sec: number) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A readable one-line summary of a track's render settings (playlist badge). */
export function settingsBadge(meta: any) {
  if (!meta) return "";
  const bits: string[] = [];
  if (meta.seconds) bits.push(fmtDur(meta.seconds));
  if (meta.steps) bits.push(`${meta.steps}st`);
  if (meta.sampler) bits.push(meta.sampler);
  if (meta.instrumental) bits.push("instrumental");
  return bits.join(" · ");
}
