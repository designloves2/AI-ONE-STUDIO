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
  { key: "acestep", label: "Ace-Step 1.5" },
  { key: "minimax", label: "MiniMax Music 3" },
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
    engine: saved.engine || "acestep",   // "acestep" | "minimax"

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
    // stage 1 always runs; stages 2 & 3 are sequential opt-in (3 needs 2 on)
    // all three stages default cfg = 1 (stage 1 used to be 0 — that was wrong).
    aceStages:      Array.isArray(saved.aceStages)
                    ? saved.aceStages.map((s: any, i: number) => ({ steps: s.steps, cfg: (i === 0 && s.cfg === 0) ? 1 : s.cfg, on: i === 0 ? true : s.on !== false }))
                    : [{ steps: 30, cfg: 1, on: true }, { steps: 20, cfg: 1, on: true }, { steps: 15, cfg: 1, on: true }],
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

/** Exports the panel's current settings as music-headless's `job` object (README's field
 * table: caption/lyrics/instrumental/duration/title/bpm/keyscale/timesignature/language/
 * vocalGender/vocalStyle/voiceTone/loras/format/audioQuality, plus the engine-specific
 * sampling params) — the inner object of a Hermes `{tool:"music", job:{...}, target:"..."}`
 * job file. `caption`/`lyrics` are taken as finished text exactly as music-headless expects —
 * no LLM step on either side. */
export function buildAgentJob(state: any): Record<string, any> {
  const job: Record<string, any> = {
    engine: state.engine || "acestep",
    caption: state.caption || "",
    duration: state.duration ?? DURATION_DEFAULT,
    seed: state.seedMode === "random" ? null : state.seed ?? 0,
  };
  if (state.instrumental) job.instrumental = true;
  else if (state.lyrics) job.lyrics = state.lyrics;
  if (state.title) job.title = state.title;
  if (state.bpm != null) job.bpm = state.bpm;
  if (state.keyscale) job.keyscale = state.keyscale;
  if (state.timesignature) job.timesignature = state.timesignature;
  if (state.vocalGender && state.vocalGender !== "auto") job.vocalGender = state.vocalGender;
  if (state.vocalStyle && state.vocalStyle !== "auto") job.vocalStyle = state.vocalStyle;
  if (state.voiceTone && state.voiceTone !== "auto") job.voiceTone = state.voiceTone;
  if (state.format) job.format = state.format;
  if (state.audioQuality) job.audioQuality = state.audioQuality;

  const loras = (state.loras || []).filter((l: any) => l && l.enabled !== false && l.name && l.name !== "none");
  if (loras.length) job.loras = loras.map((l: any) => ({ name: l.name, strength: l.strength ?? 1.0, enabled: true }));

  if (state.engine === "minimax") {
    job.steps = state.steps ?? 30;
    job.cfgScale = state.cfgScale ?? 1.7;
    job.topK = state.topK ?? 50;
    job.sampler = state.sampler || "euler";
    job.scheduler = state.scheduler || "simple";
    job.tiledDecode = !!state.tiledDecode;
  } else {
    job.language = state.language || "en";
    job.cfgScaleAce = state.cfgScaleAce ?? 2.5;
    job.temperature = state.temperature ?? 0.75;
    job.topP = state.topP ?? 0.9;
    job.minP = state.minP ?? 0;
    job.topKAce = state.topKAce ?? 0;
    job.genAudioCodes = state.genAudioCodes ?? true;
    job.aceShift = state.aceShift ?? 3;
    job.aceSamplerName = state.aceSamplerName || "jkass_quality";
    job.aceScheduler = state.aceScheduler || "sgm_uniform";
    job.aceStages = (state.aceStages || []).map((s: any) => ({ steps: s.steps, cfg: s.cfg, on: s.on !== false }));
  }
  return job;
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

// Injects the `.mmm-*` design system once. Used by the MusicMaker tool view and the
// standalone gallery page's music library mount (原本 one_node_music.js `#mmm-styles` 블록).
export function ensureMusicStyles() {
  if (document.getElementById("mmm-styles")) return;
  const s = document.createElement("style"); s.id = "mmm-styles";
  s.textContent = `
    .mmm-lp{scrollbar-width:thin;scrollbar-color:${C.border} transparent}
    .mmm-lp::-webkit-scrollbar{width:6px}
    .mmm-lp::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
    .mmm-lp::-webkit-scrollbar-track{background:transparent}

    .mmm-row{display:flex;align-items:center;gap:11px;padding:8px 10px;border-radius:12px;
             transition:background .13s ease;cursor:default}
    .mmm-row:hover{background:${C.bg2}}
    .mmm-row.on{background:${C.bg3}}
    .mmm-cover{width:52px;height:52px;border-radius:10px;flex-shrink:0;background:${C.bg3};
               background-size:cover;background-position:center;box-shadow:0 2px 8px rgba(0,0,0,.45);
               display:flex;align-items:center;justify-content:center;font-size:18px;color:${C.muted};
               cursor:pointer;position:relative;overflow:hidden}
    .mmm-engtxt{font-weight:800;letter-spacing:.5px;color:${C.text};font-family:inherit}
    .mmm-cover::after{content:"⤢";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
               font-size:15px;color:#fff;background:rgba(0,0,0,.42);opacity:0;transition:opacity .13s}
    .mmm-row:hover .mmm-cover::after{opacity:1}
    .mmm-dur{position:absolute;right:3px;bottom:3px;background:rgba(0,0,0,.72);color:#fff;font-size:9px;
             line-height:1;padding:2px 4px;border-radius:4px;letter-spacing:.2px}
    .mmm-tt{font-size:13.5px;color:${C.text};font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;flex:0 1 auto;min-width:0}
    .mmm-tt:hover{color:#fff}
    .mmm-row.on .mmm-tt{color:${BRAND}}
    .mmm-trow{display:flex;align-items:center;gap:6px;min-width:0}
    .mmm-trow .mmm-acts{margin-left:auto}
    .mmm-eng{flex-shrink:0;font-size:9px;font-weight:600;letter-spacing:.2px;color:${C.muted};
             border:1px solid ${C.border};border-radius:5px;padding:1px 5px;line-height:1.4;text-transform:uppercase}
    .mmm-sub{font-size:11px;color:${C.muted};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}

    .mmm-ib{background:transparent;border:0;color:${C.muted};cursor:pointer;width:28px;height:28px;
            border-radius:50%;font-size:13px;display:flex;align-items:center;justify-content:center;
            transition:background .12s,color .12s;flex-shrink:0}
    .mmm-ib:hover{background:${C.bg3};color:${C.text}}
    .mmm-ib.act{color:${BRAND}}
    .mmm-acts{display:flex;gap:1px;flex-shrink:0;opacity:.55;transition:opacity .13s}
    .mmm-row:hover .mmm-acts,.mmm-row.on .mmm-acts{opacity:1}
    .mmm-lcol{display:flex;flex-direction:column;align-items:center;gap:5px;flex-shrink:0;width:16px}
    .mmm-cb{opacity:0;transition:opacity .12s;accent-color:${BRAND};width:14px;height:14px;flex-shrink:0;cursor:pointer}
    .mmm-row:hover .mmm-cb,.mmm-cb:checked,.mmm-selmode .mmm-cb{opacity:1}
    .mmm-fav{background:transparent;border:0;color:${C.text};cursor:pointer;font-size:14px;line-height:1;
             padding:0;width:16px;height:16px;opacity:0;transition:opacity .12s,color .12s}
    .mmm-row:hover .mmm-fav{opacity:1}
    .mmm-fav:hover{color:${BRAND}}
    .mmm-fav.act{opacity:1;color:${BRAND}}
    @media(pointer:coarse){.mmm-acts,.mmm-cb,.mmm-fav{opacity:1}}

    .mmm-spark{background:${BRAND};border:0;color:#fff;cursor:pointer;width:30px;height:30px;
               border-radius:50%;font-size:14px;display:flex;align-items:center;justify-content:center;
               box-shadow:0 2px 8px ${BRAND}55;transition:transform .1s,filter .1s;flex-shrink:0}
    .mmm-spark:hover{filter:brightness(1.12)}
    .mmm-spark:active{transform:scale(.92)}
    .mmm-spark:disabled{background:${C.bg3};box-shadow:none;color:${C.muted}}

    .mmm-chip{background:${C.bg2};border:1px solid ${C.border};color:${C.text};border-radius:999px;
              padding:4px 11px;font-size:11px;cursor:pointer;transition:border-color .12s,background .12s}
    .mmm-chip:hover{border-color:${BRAND};background:${C.bg3}}

    .mmm-sh{display:flex;align-items:center;gap:5px}
    .mmm-sh .t{flex:1;font-weight:700;font-size:12.5px;color:${C.text}}
    .mmm-tb{background:transparent;border:0;color:${C.muted};cursor:pointer;font-family:inherit;
            font-size:10.5px;padding:4px 7px;border-radius:6px;white-space:nowrap;transition:background .12s,color .12s}
    .mmm-tb:hover{background:${C.bg2};color:${C.text}}
    .mmm-cinfo{background:${BRAND};border:0;color:#fff;cursor:pointer;font-family:inherit;
               font-size:11px;padding:8px 12px;border-radius:8px;white-space:nowrap;flex-shrink:0;
               line-height:1.15;transition:filter .12s}
    .mmm-cinfo:hover{filter:brightness(1.12)}

    .mmm-bar{flex-shrink:0;display:flex;align-items:center;gap:12px;padding:0 12px;
             border-top:1px solid ${C.border};background:rgba(20,20,20,.72);
             backdrop-filter:blur(6px);border-radius:10px}
    .mmm-pp{background:${BRAND};border:0;color:#fff;width:38px;height:34px;border-radius:9px;
            display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;
            box-shadow:0 2px 10px ${BRAND}55;transition:filter .1s,transform .08s;flex-shrink:0}
    .mmm-pp svg{display:block;fill:#fff}
    .mmm-pp:hover{filter:brightness(1.12)} .mmm-pp:active{transform:scale(.95)}
    .mmm-seek{flex:1;accent-color:${BRAND};height:4px}
    .mmm-vol{width:74px;accent-color:${BRAND};height:4px}

    .mmm-top{display:flex;align-items:center;gap:10px;flex-shrink:0}
    .mmm-brand{color:${BRAND};font-weight:800;font-size:12px;letter-spacing:.5px}
    .mmm-brand .m{color:${C.muted};font-weight:600;margin-left:6px;letter-spacing:0}

    .mmm-seg{display:flex;background:${C.bg1};border:1px solid ${C.border};border-radius:9px;padding:2px;gap:2px}
    .mmm-seg button{flex:1;border:0;background:transparent;color:${C.muted};cursor:pointer;
                    padding:5px 12px;font-size:11px;border-radius:7px;white-space:nowrap;
                    transition:background .12s,color .12s}
    .mmm-seg button:hover{color:${C.text}}
    .mmm-seg button.on{background:${BRAND};color:#fff;font-weight:600}

    .mmm-lbl{font-size:10.5px;color:${C.muted};font-weight:600;margin-bottom:3px;display:block}
    .mmm-fld,.mmm-sel{width:100%;box-sizing:border-box;background:${C.bg2};color:${C.text};
                      border:1px solid ${C.border};border-radius:8px;padding:7px 9px;font-size:12px;
                      font-family:inherit;outline:none;transition:border-color .12s}
    .mmm-fld:focus,.mmm-sel:focus{border-color:${BRAND}}
    .mmm-sel{cursor:pointer;appearance:none;
             background-image:linear-gradient(45deg,transparent 50%,${C.muted} 50%),linear-gradient(135deg,${C.muted} 50%,transparent 50%);
             background-position:calc(100% - 15px) 52%,calc(100% - 10px) 52%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
    .mmm-range{width:100%;accent-color:${BRAND};height:4px;margin:6px 0}

    .mmm-acc{display:flex;flex-direction:column;gap:9px;padding:11px;background:${C.bg1};
             border:1px solid ${C.border};border-radius:10px}
    .mmm-acc .hd{font-size:10.5px;color:${C.muted};font-weight:700;letter-spacing:.3px;text-transform:uppercase}
    .mmm-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .mmm-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}

    .mmm-go{flex:1;background:${BRAND};border:0;color:#fff;font-weight:700;font-size:13px;cursor:pointer;
            padding:11px;border-radius:10px;box-shadow:0 3px 12px ${BRAND}55;transition:filter .1s,transform .08s}
    .mmm-go:hover{filter:brightness(1.12)} .mmm-go:active{transform:scale(.98)}
    .mmm-go:disabled{background:${C.bg3};color:${C.muted};box-shadow:none;cursor:default}
    .mmm-stop{background:${C.bg2};border:1px solid ${C.border};color:${C.text};cursor:pointer;
              padding:11px 16px;border-radius:10px;font-size:12px;flex-shrink:0;font-family:inherit}
    .mmm-stop:hover{border-color:${C.err};color:${C.err}}
    .mmm-status{font-size:11px;color:#ffcf3f;font-weight:600;min-height:15px;text-align:center;
                text-shadow:0 1px 2px rgba(0,0,0,.5)}

    .mmm-menu{position:fixed;z-index:10001;background:${C.bg1};border:1px solid ${C.border};
              border-radius:10px;padding:4px;min-width:150px;box-shadow:0 8px 28px rgba(0,0,0,.55)}
    .mmm-menu .it{padding:8px 11px;font-size:12px;cursor:pointer;border-radius:7px;color:${C.text};
                  display:flex;align-items:center;gap:8px;white-space:nowrap}
    .mmm-menu .it:hover{background:${C.bg3}}
    .mmm-menu .it.danger:hover{background:${C.err}22;color:${C.err}}
    .mmm-menu .sep{height:1px;background:${C.border};margin:4px 6px}

    .mmm-ov{position:absolute;inset:0;z-index:9999;background:rgba(8,8,8,.985);border-radius:inherit;
            display:flex;flex-direction:column;padding:18px;gap:12px;box-sizing:border-box}
    .mmm-ov-hd{display:flex;align-items:center;gap:10px;flex-shrink:0}
    .mmm-ov-hd .t{flex:1;font-size:14px;font-weight:700;color:#fff}
    .mmm-x{background:${C.bg2};border:1px solid ${C.border};color:${C.text};cursor:pointer;
           padding:6px 12px;border-radius:8px;font-size:12px}
    .mmm-x:hover{border-color:${C.err};color:${C.err}}
    .mmm-tabs{display:flex;gap:2px;background:${C.bg1};border:1px solid ${C.border};border-radius:9px;padding:2px;flex-shrink:0}
    .mmm-tabs button{flex:1;border:0;background:transparent;color:${C.muted};cursor:pointer;padding:7px;
                     font-size:11.5px;border-radius:7px;transition:background .12s,color .12s}
    .mmm-tabs button.on{background:${BRAND};color:#fff;font-weight:600}
    .mmm-tabs button:hover:not(.on){color:${C.text}}
    .mmm-save{background:${BRAND};border:0;color:#fff;font-weight:700;font-size:12.5px;cursor:pointer;
              padding:10px;border-radius:9px;box-shadow:0 3px 12px ${BRAND}55}
    .mmm-save:hover{filter:brightness(1.12)}
    .mmm-ov-body{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
    .mmm-ov-body pre{white-space:pre-wrap;font-size:11px;color:${C.text};margin:2px 0;
                     background:${C.bg1};border:1px solid ${C.border};border-radius:8px;padding:9px}
    .mmm-k{color:${BRAND};font-size:10.5px;font-weight:700;margin-top:8px;text-transform:uppercase;letter-spacing:.3px}

    .mmm-ss{width:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:4px}
    .mmm-ss .f{width:100%;box-sizing:border-box;background:${C.bg2};color:${C.text};border:1px solid ${C.border};
               border-radius:8px;padding:5px 9px;font-size:11px;font-family:inherit;outline:none;display:block}
    .mmm-ss .f:focus{border-color:${BRAND}}
    .mmm-ss select{width:100%;box-sizing:border-box;background:${C.bg2};color:${C.text};border:1px solid ${C.border};
                   border-radius:8px;padding:7px 9px;font-size:12px;font-family:inherit;outline:none;cursor:pointer}
    .mmm-ss select:focus{border-color:${BRAND}}

    .mmm-lora{display:flex;gap:6px;align-items:flex-start}
    .mmm-lora .mmm-ss{flex:1;min-width:0}
    .mmm-add{background:${C.bg2};border:1px dashed ${C.borderH};color:${C.text};cursor:pointer;
             padding:7px;border-radius:8px;font-size:11.5px;width:100%;transition:border-color .12s}
    .mmm-add:hover{border-color:${BRAND};color:${BRAND}}
    .mmm-del{background:transparent;border:1px solid ${C.border};color:${C.muted};cursor:pointer;
             flex-shrink:0;border-radius:8px;font-size:11px;padding:5px 0}
    .mmm-del:hover{border-color:${C.err};color:${C.err}}
    .mmm-hint{font-size:10px;color:${C.muted};text-align:center;padding:2px;line-height:1.5}

    .mmm-pop{position:absolute;inset:0;z-index:10000;background:rgba(6,6,6,.75);display:flex;
             align-items:center;justify-content:center;border-radius:inherit}
    .mmm-pop .box{width:min(440px,84%);background:${C.bg1};border:1px solid ${C.borderH};border-radius:14px;
                  padding:16px;display:flex;flex-direction:column;gap:10px;box-shadow:0 12px 40px rgba(0,0,0,.6)}
    .mmm-pop .box h4{margin:0;font-size:13px;color:#fff;font-weight:700}
    .mmm-pop .box p{margin:0;font-size:10.5px;color:${C.muted};line-height:1.5}
    .mmm-pop textarea{min-height:96px;resize:vertical}
    .mmm-pop .btns{display:flex;gap:6px;justify-content:flex-end}

    @keyframes mmm-pulse{0%,100%{opacity:.55}50%{opacity:1}}
    .mmm-llmbusy{position:absolute;inset:0;z-index:5;border-radius:8px;
                 background:rgba(12,12,12,.45);backdrop-filter:blur(3px);
                 display:flex;align-items:center;justify-content:center;gap:7px;
                 font-size:11.5px;font-weight:600;color:${BRAND}}
    .mmm-llmbusy .dot{width:7px;height:7px;border-radius:50%;background:${BRAND};animation:mmm-pulse 1s ease-in-out infinite}

    .mmm-row.gen{background:${C.bg2};cursor:default}
    .mmm-row.gen .mmm-cover{color:${C.muted}}
    .mmm-row.gen .mmm-cover::after{content:none}
    @keyframes mmm-sheen{0%{background-position:-140px 0}100%{background-position:220px 0}}
    .mmm-row.gen .mmm-cover.busy{background-image:linear-gradient(100deg,transparent 20%,${BRAND}44 50%,transparent 80%);
               background-size:200px 100%;background-repeat:no-repeat;animation:mmm-sheen 1.1s linear infinite}
    @keyframes mmm-spin{to{transform:rotate(360deg)}}
    .mmm-cover.regen::before{content:"";position:absolute;inset:0;z-index:1;
               background:linear-gradient(100deg,transparent 15%,${BRAND}66 50%,transparent 85%);
               background-size:200px 100%;background-repeat:no-repeat;animation:mmm-sheen 1.1s linear infinite}
    .mmm-cover.regen::after{content:"↻";opacity:1;z-index:2;background:rgba(0,0,0,.55);
               animation:mmm-spin .9s linear infinite}
    .mmm-prog{height:4px;border-radius:3px;background:${C.bg3};overflow:hidden;margin-top:6px}
    .mmm-prog i{display:block;height:100%;background:${BRAND};border-radius:3px;transition:width .25s ease}
    .mmm-stage{font-size:10.5px;color:${BRAND};margin-top:3px;display:flex;justify-content:space-between;gap:8px}
    .mmm-stage .p{color:${C.muted}}
    .mmm-row.gen.err .mmm-stage{color:${C.err}}
    .mmm-row.gen.err .mmm-prog i{background:${C.err}}

    /* ── mobile (≤767px) — the SUNO 2-pane layout stacks: compose on top, playlist
       below, player bar pinned at the bottom. The drag-resize handle is gone. ── */
    @media (max-width:767px){
      .mmm-root{padding:8px;gap:8px}
      .mmm-top{flex-wrap:wrap;row-gap:6px}
      .mmm-top .mmm-seg{flex:1 1 100%}
      .mmm-main{flex-direction:column;overflow-y:auto;gap:10px}
      .mmm-dragh{display:none}
      .mmm-composewrap{width:100%!important;flex:0 0 auto;min-height:0}
      .mmm-compose{overflow-y:visible;flex:0 0 auto;padding-right:0}
      .mmm-playlistwrap{flex:0 0 auto;min-height:70vh}
      .mmm-bar{gap:8px}
      .mmm-bar .mmm-nowwrap,.mmm-bar .mmm-vol{display:none}
      .mmm-grid2,.mmm-grid3{grid-template-columns:1fr 1fr}
      .mmm-lib-grid{grid-template-columns:1fr!important}
    }
  `;
  document.head.appendChild(s);
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
