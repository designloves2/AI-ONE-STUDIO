// core.ts — MiniMax H3 ONE STUDIO 상수/상태/헬퍼.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/minimax/core_minimax.js (거의 그대로 이식,
// 정사각형 위젯 전용 레이아웃 상수(NODE_W/PREVIEW_SIZE/LEFT_W)는 웹 레이아웃에서 쓰지 않으므로 제외)

export const LS_KEY = "minimax_h3_one_state_v1";
export const API = "/minimax_h3_one";
export const SUBFOLDER = "one_minimax_h3";
export const FPS = 24;

export interface PromptEntry {
  text: string;
  // Always-on, ungated per-clip first-frame override — independent of `override` below. Forces
  // this one clip into First/Last mode (even during a Reference-mode run) regardless of the
  // override checkbox; used e.g. to resume a stopped Last-Frame-Chain run from a saved frame.
  firstFrame: string;
  enabled: boolean;
  // Per-clip override (SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §1/§2) — all-or-nothing: when
  // `override` is on, this clip renders with its own refImages/refVideos/refAudios/lastFrame
  // and header/footer instead of the common state.* set. This is the actual render-time
  // reference set (same one the left panel's Images accordion edits) — Enhance's vision step
  // reads the same resolved list (via clipAssets()) rather than a separate copy, so there is
  // only ever one active image set per clip, seen by both sides. briefImageMode (how many of
  // those images vision actually reads — 2 for First/Last-style briefs, 8 for Reference-style)
  // is a vision-only cap, not a render input, so it stays common-only and outside this override.
  override?: boolean;
  refImages?: string[];
  refImagesMp?: number[];
  refVideos?: MinimaxState["refVideos"];
  refAudios?: MinimaxState["refAudios"];
  lastFrame?: string;
  header?: string;
  footer?: string;
}

export interface LoraEntry {
  name: string;
  strength: number;
  triggerWord: string;
  enabled: boolean;
}

export interface MinimaxState {
  unetFirstLast: string;
  unetReference: string;
  clipName: string;
  vaeVideo: string;
  vaeAudio: string;
  turboLora: string;
  turboLoraReference: string;
  turboLoraStrength: number;
  turboLoraLowVram: boolean;
  // PDD Acc (alibaba-pai) — SPEC_MINIMAX_H3_PDD_AND_TELEMETRY.md. Per-mode file slots (the
  // release is split into Ref2VA/FL2VA, and pairing a file with the wrong UNET is a silent
  // quality failure, not an error), plus the two blend strengths its apply node takes. nfe is
  // a string because it's a choice from a fixed list (PDD_NFE_CHOICES), not a free number.
  pddFile: string;
  pddFileReference: string;
  pddNfe: string;
  pddLoraStrength: number;
  pddHeadStrength: number;
  upscaleModel: string;
  targetLength: string;
  audioLock: boolean;
  lockAudioFile: string;
  audioLockMode: string;
  audioLockStrength: number;
  audioLockFit: string;
  audioLockTrimStart: number;
  audioLockTrimEnd: number;
  loras: LoraEntry[];
  generationMode: string;
  accelMode: string;
  upscaleMode: string;
  // RTX Deblur (SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §15) — a pre-pass before upscale, not one
  // of its options: each has its own "none", so "Deblur only, no upscale" is a real, valid
  // combination. Same-resolution by definition — never derived from a scale factor.
  // "none" | "LOW" | "MEDIUM" | "HIGH" | "ULTRA"
  deblurStrength: string;
  // SPEC_MINIMAX_H3_INLINE_POSTPROCESS_META.md §6 — when a deblur/upscale runs inline, also
  // write the pre-process decode as a separate `_raw` clip.
  saveUnprocessed: boolean;
  continuityMode: string;
  oneTakeLockAudio: boolean;
  oneTakeAutoStitch: boolean;
  oneTakeAudioOverride: boolean;
  aspect: string;
  megapixels: number;
  clipFrames: number;
  clipLengthCustom: boolean;
  clipLengthCustomSec: number;
  totalSeconds: number;
  trimLastClip: boolean;
  avgMinutesPerClip: number;
  unloadBetweenClips: boolean;
  prompts: PromptEntry[];
  promptHeader: string;
  promptFooter: string;
  promptSuffix: string;
  firstFrameImage: string | null;
  lastFrameImage: string | null;
  firstFrameMp: number;
  lastFrameMp: number;
  refImages: string[];
  refImagesMp: number[];
  refImageSize: string;
  refVideos: { file: string; start: number; end: number; withAudio?: boolean }[];
  refAudios: { file: string; start: number; end: number }[];
  refTypes: { images?: boolean; videos?: boolean; audios?: boolean };
  steps: number;
  turboSteps: number;
  slaTurboSteps: number; // lightx2v's own step count — separate from turboSteps (larryvrh) and steps (no turbo)
  sampler: string;
  scheduler: string;
  denoise: number;
  seed: number;
  seedMode: string;
  seedPerClip: boolean;
  useCache: boolean;
  useFirstBlockCache: boolean;
  saveSubfolder: string;
  filenamePrefix: string;
  stitchAtEnd: boolean;
  targetLengthSeconds?: string;
  // Renamed from ollamaImageMode (SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §6 removed the Ollama
  // backend but this field lived on — it's the Image → Brief cap: "First/Last" 2 vs
  // "Reference" 8, how many of a clip's resolved refImages the vision step actually reads).
  // Node side (comfyui-tj-node-studio-one) made the same rename; migrated from the old key in
  // defaultState(). There is no separate ollamaImages array — Enhance reads
  // clipAssets().refImages directly (§1's "one active set, seen by both rendering and vision"
  // design), so a dedicated vision-only copy would just be a second place for the same
  // picture to go stale in.
  briefImageMode: string;
  visionSource: string; // was "ollama" | "native" — Ollama removed, always native now; field kept for saved-state compat
  nativeVisionClip: string;
  nativeBriefClip: string;

  // Turbo LoRA
  turboLoraStrength: number;
  turboLoraLowVram: boolean;
  // SolAttn (SolAttnPatch)
  solTau: number;
  solMinTokens: number;
  solStart: number;
  solEnd: number;
  // Spectrum (SpectrumApplyMiniMaxH3)
  specBlendWeight: number;
  specDegree: number;
  specRidgeLambda: number;
  specWindowSize: number;
  specFlexWindow: number;
  specWarmupSteps: number;
  specTailSteps: number;
  specMaxHistory: number;
  specHistoryStore: string;

  // RTX VSR upscale
  rtxScale: number;
  rtxQuality: string;

  // Sigma shift (MiniMaxH3SigmaShift)
  shiftVideo: number;
  shiftAudio: number;

  // Model patches
  useSageAttn: boolean;
  sageAttnMode: string;
  useMemEffSage: boolean;
  useCkAttention: boolean;
  ckAttentionBackend: string;
  useTorchPatch: boolean;
  fp16Accum: boolean;
  cacheThreshold: number;
  cacheMaxSteps: number;
  cacheStart: number;
  cacheEnd: number;

  // H3 SLA Attention (block-sparse, last before the sampler)
  useSlaAttention: boolean;
  slaSparsity: number;
  slaBlockSize: string;
  slaMinSeqLen: number;
  slaDenseLastSteps: number;
  slaProtectAudio: boolean;
  slaRunEnabled: boolean;

  // H3 FirstBlockCache (step reuse) — three calibrated presets + a manual Custom mode.
  // Manual fields (fbcThreshold/fbcStartPercent/fbcEndPercent/fbcMaxConsecutiveHits/
  // fbcTemporalGuard) only take effect when fbcMode is "Custom — manual values".
  fbcMode: string;
  fbcThreshold: number;
  fbcStartPercent: number;
  fbcEndPercent: number;
  fbcMaxConsecutiveHits: number;
  fbcTemporalGuard: boolean;

  // ── Pipeline axes (v1.17.0 port, SPEC_MINIMAX_H3_PIPELINE_AXES.md) ──────────────────────
  // One control per patch layer, replacing the old single accelMode + scattered booleans.
  // These are now the source of truth for buildModelChain(); the legacy fields above
  // (accelMode, useSageAttn, useCkAttention, useSlaAttention, useMemEffSage, useCache,
  // useFirstBlockCache) are read only by migratePipelineState() to seed these once.
  turboMode: string; // "none" | "larryvrh" | "lightx2v" | "pdd" (lightx2v is a regular LoRA — add it in the LoRA section; picking it here just forces attnBackend to "sla" and suggests 6 steps. pdd is not a LoRA either — it swaps the model's final projection via MiniMaxH3PDDAccApply and forces sampler=euler + SigmaShift 12/3, see SPEC_MINIMAX_H3_PDD_AND_TELEMETRY.md)
  attnBackend: string; // "none" | "sage" | "ck" | "solattn_kijai" | "sla" — L6/L7, single-select
  attnForward: string; // "none" | "memeff_sage" | "solattn_saganaki" — L5, blocked whenever attnBackend replaces attn.forward itself (ck/solattn_kijai/sla)
  blockCache: string; // "none" | "h3cache" | "fbcache" — L2/L3, blocked entirely under either Turbo mode
  // H3-Optimizations (Zironic) — backend-preserving VRAM / sparse axis. "none" | "memory" | "memory_sparse"
  h3Optimizer: string;
  h3MemChunkRows: number;
  h3MemPrecision: string;      // Auto | BF16 | Preserve native | Force quant
  h3MemQkvStreaming: string;   // Auto | Off | Forced
  h3MemLowVram: boolean;
  h3SparseBudget: number;
  h3SparseDenserEdges: boolean;
  h3SparseLayerBudgets: string;
  useSpectrum: boolean; // L1, independent of attnBackend/blockCache — orthogonal axis
  useFusedModulation: boolean; // L4, safe with every other axis
  pipelineMigrated: boolean;
  // MiniMaxH3ScheduledSolAttentionPatch (Saganaki22/ComfyUI-sol-attn) — strict superset of
  // that pack's MemoryEfficient variant; set tau_start==tau_end for the old fixed-tau behavior.
  solSchedTauStart: number;
  solSchedTauEnd: number;
  solSchedCurve: string; // "linear" | "cosine" | "sqrt" | "smoothstep"
  solSchedMinTokens: number;
  solSchedStrict: boolean;
  solSchedDensePercent: number;
  solSchedThreshType: string; // "diag" | "exact"
  solSchedInt8Qk: boolean;
  solSchedInt8Pv: boolean;
  solSchedSinkConditioning: string; // "exact_kv" | "exact_kv_and_rows" | "off"
  solSchedDenseBlocks: string;

  // Live preview (ModelPreviewOverrideKJ)
  previewEnabled: boolean;
  previewFrames: number;
  previewFps: number;
  previewMaxRes: number;
  previewQuality: number;
  // "none"(기본, Latent2RGB로 폴백) 또는 models/vae_approx의 파일명 — 지정하면 진짜 VAE로
  // 디코드한 실시간 프리뷰가 나온다(Latent2RGB보다 정확하지만 스텝마다 약간 더 느림).
  previewTinyVae: string;
  // Prompt Edit's LOCAL ENHANCE block collapsed state (SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md
  // §10) — collapsing it hands its whole height to the clip editor above.
  enhCollapsed: boolean;
}

export const CLIP_LENGTHS = (() => {
  const out: { frames: number; seconds: number; label: string }[] = [];
  for (let n = 124; n <= 362; n += 17) {
    const sec = n / FPS;
    out.push({ frames: n, seconds: sec, label: `${sec.toFixed(2)}s  (${n}f)` });
  }
  return out;
})();
export const DEFAULT_FRAMES = 192; // 8.000s

export function framesToSeconds(frames: number) {
  return frames / FPS;
}

/** Mirrors comfy_extras/nodes_minimax_h3.py's align_frame_count (17k+5 frame grid, rounds up). */
export function alignFrameCount(n: number): number {
  let f = Math.max(5, Math.round(n));
  while (f % 17 !== 5) f++;
  return f;
}

/** Turn the tensor errors these packs throw into something actionable. */
export function explainGenerationError(message: string): string | null {
  const m = String(message || "");
  if (/must match the size of tensor b \(2\)/.test(m) || /adaln/i.test(m)) {
    return "The turbo LoRA doesn't match this mode's base model — turbo LoRAs are fl2v-only. Switch Acceleration to SolAttn, Spectrum or None.";
  }
  if (/failed to extract audio/i.test(m)) {
    return "A reference video has no audio track but its soundtrack was requested — untick \"also use this clip's soundtrack\" for that video.";
  }
  if (/VAEDecodeAudio/i.test(m) && /must match the size of tensor/i.test(m)) {
    return "The audio VAE couldn't decode this latent. Check that the Audio VAE in ⚙ Settings is the MiniMax audio VAE and that the mode's UNET matches (Reference needs the Ref2VA model).";
  }
  if (/shape mismatch/i.test(m) && /cannot be broadcast/i.test(m)) {
    return "The sampler rejected the reference tokens. Check the Reference UNET in ⚙ Settings is the Ref2VA model, and that Acceleration isn't Turbo.";
  }
  return null;
}

// Portrait -> Square -> Landscape
export const ASPECTS = [
  { label: "9:16 Portrait", w: 9, h: 16 },
  { label: "2:3 Portrait", w: 2, h: 3 },
  { label: "3:4 Portrait", w: 3, h: 4 },
  { label: "4:5 Portrait", w: 4, h: 5 },
  { label: "1:1 Square", w: 1, h: 1 },
  { label: "5:4 Landscape", w: 5, h: 4 },
  { label: "4:3 Landscape", w: 4, h: 3 },
  { label: "3:2 Landscape", w: 3, h: 2 },
  { label: "16:9 Landscape", w: 16, h: 9 },
  { label: "21:9 Cinema", w: 21, h: 9 },
];

export function resolveResolution(aspectLabel: string, megapixels: number) {
  const a = ASPECTS.find((x) => x.label === aspectLabel) || ASPECTS[0];
  const mp = Math.max(0.1, megapixels || 1.0);
  const target = mp * 1_000_000;
  const ratio = a.w / a.h;
  let h = Math.sqrt(target / ratio);
  let w = h * ratio;
  const snap = (v: number) => Math.max(32, Math.round(v / 32) * 32);
  return { width: snap(w), height: snap(h) };
}

export const SAMPLERS = ["euler", "euler_ancestral", "heun", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_3m_sde", "ddim", "uni_pc", "res_multistep", "er_sde", "lcm", "deis"];
export const SCHEDULERS = ["simple", "normal", "karras", "exponential", "sgm_uniform", "beta", "ddim_uniform"];

export const GENERATION_MODES = [
  { key: "t2v", label: "Text only", hint: "prompt only (T2VA)" },
  { key: "firstlast", label: "First/Last Frame", hint: "start + end keyframe (FL2VA)" },
  { key: "reference", label: "Reference", hint: "up to 9 reference images (REF2VA)" },
];

export const ACCEL_MODES = [
  { key: "turbo", label: "Turbo LoRA(larryvrh)", node: "MiniMaxH3TurboLoRA", modes: ["t2v", "firstlast", "reference"] },
  { key: "solattn", label: "SolAttn", node: "SolAttnPatch" },
  { key: "spectrum", label: "Spectrum", node: "SpectrumApplyMiniMaxH3" },
  { key: "none", label: "None", node: null },
];

export function accelModesFor(generationMode: string) {
  return ACCEL_MODES.filter((m) => !m.modes || m.modes.includes(generationMode || "t2v"));
}

// ── Pipeline axes (v1.17.0 port) — one control per patch layer instead of one accelMode. ──

export const TURBO_MODES = [
  { key: "none", label: "None" },
  { key: "larryvrh", label: "Turbo LoRA (larryvrh)", modes: ["t2v", "firstlast", "reference"] },
  { key: "lightx2v", label: "SLA Turbo (lightx2v)" },
  { key: "pdd", label: "PDD Acc (alibaba-pai)" },
] as const;
export function turboModesFor(generationMode: string) {
  return TURBO_MODES.filter((m: any) => !m.modes || m.modes.includes(generationMode || "t2v"));
}

/** The evaluation counts the released PDD checkpoints were partitioned for — a fixed list,
 * not a free number: the apply node's head bank was trained on this exact 32-interval grid,
 * and any other step count is off the trained envelope (renders as noise). */
export const PDD_NFE_CHOICES = ["8", "4", "6"];

/** The PDD Acc file for the current generation mode. The release is per-variant (Ref2VA for
 * reference, FL2VA for t2v/firstlast) — pairing a file with the wrong UNET is a silent quality
 * failure rather than an error, so the two are kept in separate slots instead of one field the
 * user has to remember to change. */
export function pddFileForMode(state: MinimaxState): string {
  const isRef = (state.generationMode || "t2v") === "reference";
  const pick = isRef ? state.pddFileReference : state.pddFile;
  return pick && pick !== "none" ? pick : "";
}

// ── Pipeline presets (SPEC_MINIMAX_H3_PRESETS.md) ───────────────────────────────────────
// New feature, not a bug port: sets six pipeline axes at once from a named, benchmarked
// combination. Never touches steps/seed/length/resolution/model pickers — those are what a
// comparison is held constant against. Numeric ids (1, 4, 5, 18, 31, 38) are carried over
// from the node side's 39-configuration bench so a preset here and a row in that (private)
// report are the same thing — kept as-is, not renumbered 1-6.
export interface PipelinePreset {
  id: number;
  category: string;
  label: string;
  note: string;
  turbo: string;
  backend: string;
  forward: string;
  cache: string;
  spectrum: boolean;
  torch: boolean;
  fused: boolean;
  nfe?: string; // only meaningful for turbo === "pdd"
}

export const PIPELINE_PRESETS: PipelinePreset[] = [
  {
    id: 18, category: "Everyday", label: "Sage + MemEff + FirstBlockCache",
    note: "The default. 17.5 min for an 8s clip at 1.0MP / 25 steps, against 30.4 with nothing on — the cache is the whole 44%. For fast camera or character motion raise steps to 40-50; that is the one change that visibly cleared smearing, and no accelerator here substitutes for it.",
    turbo: "none", backend: "sage", forward: "memeff_sage", cache: "fbcache", spectrum: false, torch: true, fused: false,
  },
  {
    id: 31, category: "Fast", label: "SLA Turbo (lightx2v)",
    note: "6.3 min at the same quality as the 25-step stacks — the quickest configuration that held up. 64 s/step against larryvrh's 95, because the SLA kernel actually removes work. In Reference mode it needs the ref2v LoRA; the fl2v file silently does nothing.",
    turbo: "lightx2v", backend: "sla", forward: "none", cache: "none", spectrum: false, torch: true, fused: false,
  },
  {
    id: 38, category: "Fast", label: "PDD 8 nfe + Spectrum",
    note: "8.2 min, eight evaluations instead of six, quality indistinguishable from the full stacks. PDD cannot use a block cache, which is exactly why Spectrum belongs here — with nothing else skipping steps it takes 27% off (11.3 -> 8.2).",
    turbo: "pdd", backend: "none", forward: "none", cache: "none", spectrum: true, torch: true, fused: false, nfe: "8",
  },
  {
    id: 4, category: "Cautious", label: "No cache, no forecasting",
    note: "Dense attention only; nothing skips or approximates a step. 30.7 min against 17.5, and the bench found no quality difference to justify that — but its quality scores could not resolve anything under two points. Reach for this when output looks wrong and you want the caches ruled out.",
    turbo: "none", backend: "sage", forward: "memeff_sage", cache: "none", spectrum: false, torch: true, fused: true,
  },
  {
    id: 1, category: "Cautious", label: "Stock — no patches at all",
    note: "Everything off, including the Torch patch. The honest floor, and the first thing to try when you need to know whether the pipeline caused a problem or the model did.",
    turbo: "none", backend: "none", forward: "none", cache: "none", spectrum: false, torch: false, fused: false,
  },
  {
    id: 5, category: "First-Last / Text", label: "larryvrh 4-step turbo",
    note: "6.3 min, but only outside Reference mode: larryvrh publishes no reference-mode weights, and in Reference the LoRA does not take — it scored 2/5 with heavy blur across every run. Untested for first-last and text so far. Use preset 31 for fast Reference work.",
    turbo: "larryvrh", backend: "sage", forward: "memeff_sage", cache: "none", spectrum: false, torch: true, fused: true,
  },
];

/** Which preset (if any) the state's axes currently match — derived, never stored, so a
 * hand-edited control falls back to "Custom" on its own instead of going on naming a
 * combination that no longer applies. */
export function matchPreset(state: MinimaxState): PipelinePreset | null {
  return (
    PIPELINE_PRESETS.find(
      (p) =>
        p.turbo === state.turboMode &&
        p.backend === state.attnBackend &&
        p.forward === state.attnForward &&
        p.cache === state.blockCache &&
        p.spectrum === !!state.useSpectrum &&
        p.torch === (state.useTorchPatch !== false) &&
        p.fused === !!state.useFusedModulation &&
        // nfe only matters for pdd rows; null everywhere else so it never blocks a match
        (p.nfe ?? null) === (state.turboMode === "pdd" ? String(state.pddNfe ?? "8") : null)
    ) ?? null
  );
}

/** Writes a preset's six axes onto state — nothing else (steps/seed/length/resolution/model
 * pickers are left untouched; a preset that moved them would invalidate whatever comparison
 * it was picked for). */
export function applyPreset(state: MinimaxState, preset: PipelinePreset | UserPipelinePreset): void {
  state.turboMode = preset.turbo;
  state.attnBackend = preset.backend;
  state.attnForward = preset.forward;
  state.blockCache = preset.cache;
  state.useSpectrum = preset.spectrum;
  state.useTorchPatch = preset.torch;
  state.useFusedModulation = preset.fused;
  if (preset.nfe) state.pddNfe = preset.nfe;
  state.fp16Accum = true; // rides along with the Torch patch on every preset that has it
  // Restore the user-recipe fields when the preset carries them (built-ins never do). SPEC §4.
  for (const k of RECIPE_KEYS) if ((preset as any)[k] !== undefined) (state as any)[k] = (preset as any)[k];
}

// ── User pipeline presets (SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §14) ───────────────────────
// Same six axes as the built-in PIPELINE_PRESETS, but named and saved by the user — stored
// server-side (not localStorage): it has to survive a browser reset, and a preset is something
// you tell someone else by name, which only means anything if it lives somewhere shared.
// Keyed by name (no separate id) — matches the node side's actual saved shape exactly.
//
// SPEC_MINIMAX_H3_CONTINUE_AND_EXTEND.md §4 — a *user*-saved preset also carries the full
// left-panel recipe (sampling row + the turbo section's own step counts and model files), on
// top of the axes. Built-in presets stay axes-only. matchPreset/matchUserPreset still compare
// axes only, so "which preset is active" is unaffected and a step-count change won't drop you
// to Custom. Why: an applied "PDD" preset restored turboMode but not pddFile/pddFileReference,
// so effectiveTurbo() fell back to "none" and the run used state.steps (20) not the PDD 8.
export const RECIPE_KEYS = [
  "steps", "sampler", "scheduler", "denoise", "shiftVideo", "shiftAudio",
  "turboSteps", "slaTurboSteps",
  "turboLora", "turboLoraReference", "pddFile", "pddFileReference",
] as const;
export type RecipeKey = (typeof RECIPE_KEYS)[number];

function recipeOf(state: MinimaxState): Partial<Pick<UserPipelinePreset, RecipeKey>> {
  const out: Record<string, unknown> = {};
  for (const k of RECIPE_KEYS) if ((state as any)[k] !== undefined) out[k] = (state as any)[k];
  return out as Partial<Pick<UserPipelinePreset, RecipeKey>>;
}

export interface UserPipelinePreset {
  name: string;
  turbo: string;
  backend: string;
  forward: string;
  cache: string;
  spectrum: boolean;
  torch: boolean;
  fused: boolean;
  nfe?: string;
  // Recipe fields (SPEC §4) — present on presets saved after v1.21.0's web port, absent on
  // older ones. applyPreset only restores the keys actually present.
  steps?: number;
  sampler?: string;
  scheduler?: string;
  denoise?: number;
  shiftVideo?: number;
  shiftAudio?: number;
  turboSteps?: number;
  slaTurboSteps?: number;
  turboLora?: string;
  turboLoraReference?: string;
  pddFile?: string;
  pddFileReference?: string;
}

/** Same matching rule as matchPreset(), against the user's own saved list. */
export function matchUserPreset(state: MinimaxState, presets: UserPipelinePreset[]): UserPipelinePreset | null {
  return (
    (presets || []).find(
      (p) =>
        p.turbo === state.turboMode &&
        p.backend === state.attnBackend &&
        p.forward === state.attnForward &&
        p.cache === state.blockCache &&
        p.spectrum === !!state.useSpectrum &&
        p.torch === (state.useTorchPatch !== false) &&
        p.fused === !!state.useFusedModulation &&
        (p.nfe ?? null) === (state.turboMode === "pdd" ? String(state.pddNfe ?? "8") : null)
    ) ?? null
  );
}

/** The current axes as a savable preset row — everything applyPreset()/matchUserPreset() read,
 * nothing else (steps/seed/length/resolution/model pickers are never part of a preset). */
export function presetFromState(state: MinimaxState, name: string): UserPipelinePreset {
  return {
    name,
    turbo: state.turboMode,
    backend: state.attnBackend,
    forward: state.attnForward,
    cache: state.blockCache,
    spectrum: !!state.useSpectrum,
    torch: state.useTorchPatch !== false,
    fused: !!state.useFusedModulation,
    ...(state.turboMode === "pdd" ? { nfe: String(state.pddNfe ?? "8") } : {}),
    ...recipeOf(state), // SPEC §4 — the user's whole recipe, not just the axes
  };
}

export const ATTN_BACKENDS = [
  { key: "none", label: "None" },
  { key: "sage", label: "Sage", node: "PathchSageAttentionKJ" },
  { key: "ck", label: "CK-Attention", node: "ModelAttentionBackend" },
  { key: "solattn_kijai", label: "SolAttn (kijai)", node: "SolAttnPatch" },
  { key: "sla", label: "H3 SLA Attention", node: "H3SLAAttention" },
] as const;

export const ATTN_FORWARDS = [
  { key: "none", label: "None", dense: true },
  { key: "memeff_sage", label: "MemEff Sage", node: "MiniMaxH3MemoryEfficientSageAttentionPatch", dense: true },
  // Scheduled Sol forward runs a block-sparse kernel — the "sparse" half of the larryvrh gate.
  { key: "solattn_saganaki", label: "SolAttn (Saganaki22, scheduled)", node: "MiniMaxH3ScheduledSolAttentionPatch", dense: false },
] as const;

export const BLOCK_CACHES = [
  { key: "none", label: "None" },
  { key: "h3cache", label: "H3 Cache", node: "MiniMaxH3Cache" },
  { key: "fbcache", label: "FirstBlockCache", node: "ApplyMiniMaxH3FirstBlockCache" },
] as const;

// H3-Optimizations (Zironic) — a backend-preserving axis. `memory` wraps whatever dense
// backend is selected (Sage / Comfy Kitchen / stock) with chunked QKV/MLP/FinalLayer and
// early embedding release; it is the way to get a memory-efficient CK, which the KJ MemEff
// forward patch cannot do (that one hard-swaps the blocks' attention to a sage kernel).
// `memory_sparse` adds H3 Sparse Attention after it — a real attention approximation.
export const H3_OPTIMIZERS = [
  { key: "none", label: "None", node: null },
  { key: "memory", label: "H3 Memory Opt", node: "H3MemoryOptimization" },
  { key: "memory_sparse", label: "H3 Memory Opt + Sparse", node: "H3SparseAttention" },
] as const;

/** H3-Optimizations axis. Memory Opt is pure VRAM/execution and composes with anything, so
 * it is never blocked. The Sparse stage is an attention approximation, so it's gated the
 * same way the sparse attention backends are: out under any turbo schedule (too few steps
 * to average its error away), and not stacked on a backend that is already sparse. */
export function h3OptimizerBlockedReason(state: MinimaxState, key: string): string {
  if (!key || key === "none" || key === "memory") return "";
  if (key === "memory_sparse") {
    if (state.turboMode && state.turboMode !== "none") {
      return "The Sparse stage approximates attention — a few-step turbo schedule can't absorb that. Use plain H3 Memory Opt.";
    }
    if (state.attnBackend === "solattn_kijai" || state.attnBackend === "sla") {
      return "The attention backend is already sparse — H3 Sparse on top double-sparsifies. Use plain H3 Memory Opt.";
    }
  }
  return "";
}

/** Not a block — a note. When an H3 attention-forward patch (KJ MemEff Sage / Saganaki Sol)
 * is on, it owns `blocks[i].attn.forward`; the optimizer's QKV-streaming step then self-defers
 * while its MLP and embedding savings still apply. "" when there's nothing to note. */
export function h3OptimizerOverlapNote(state: MinimaxState, key: string): string {
  if (!key || key === "none" || !state.attnForward || state.attnForward === "none") return "";
  return "An H3 attention-forward patch owns the blocks' attention — the optimizer keeps its MLP / embedding savings, but its QKV-streaming step defers to that patch.";
}

/** Why an attention-backend option is greyed out, or "" if it's fine. Shown inline, never hidden. */
export function attnBackendBlockedReason(state: MinimaxState, key: string): string {
  if (key === "none" || key === "sage") return "";
  if (state.turboMode === "larryvrh" && (key === "solattn_kijai" || key === "sla")) {
    return "Turbo LoRA (larryvrh) needs dense attention — its 4 steps leave no room for sparse-approximation error to average out.";
  }
  if (state.turboMode === "lightx2v" && key !== "sla") {
    return "SLA Turbo (lightx2v) is a LoRA distilled against the SLA kernel — it gives no speedup and isn't validated without SLA attention.";
  }
  return "";
}

/** Why an attention-forward option is greyed out, or "" if it's fine.
 *
 * Node `0876abc` (2026-08-27): the CK/SolAttn/SLA gate that used to live here had the
 * reasoning backwards. MemEff Sage replaces `blocks[i].attn.forward`; an override-based
 * backend writes `optimized_attention_override`, which only the *stock* forward reads — so
 * when both are on it's the BACKEND that stops reaching the transformer blocks, not the
 * forward patch (and the forward patch is the faster of the two). Both are legal now; the
 * panel shows an overlap note instead (see `attnForwardOverlapNote`). The only real block
 * left is a 4-step turbo schedule with a sparse forward kernel. */
export function attnForwardBlockedReason(state: MinimaxState, key: string): string {
  const f = ATTN_FORWARDS.find((x) => x.key === key);
  if (!f || key === "none") return "";
  if (state.turboMode === "larryvrh" && !f.dense) {
    return "Turbo LoRA (larryvrh) runs 4 steps — a sparse forward kernel's approximation error is too large to absorb there.";
  }
  return "";
}

/** Not a block — a hint. When an override-based backend (CK / SolAttn kijai / SLA) is on
 * *and* a forward patch is selected, the forward patch replaces the blocks' own attention,
 * so the backend only ends up applying outside the transformer blocks (text refiner,
 * cross-attention). Both still run; this just says what the overlap means. "" when there's
 * nothing to note. */
export function attnForwardOverlapNote(state: MinimaxState, key: string): string {
  if (!key || key === "none") return "";
  if (state.attnBackend === "ck" || state.attnBackend === "solattn_kijai" || state.attnBackend === "sla") {
    const name = ATTN_BACKENDS.find((b) => b.key === state.attnBackend)?.label || state.attnBackend;
    return `${name} only applies outside the transformer blocks here — this forward patch replaces the blocks' own attention.`;
  }
  return "";
}

/** Why a block-cache option is greyed out, or "" if it's fine. */
export function blockCacheBlockedReason(state: MinimaxState, key: string): string {
  if (key === "none") return "";
  if (state.turboMode === "larryvrh" || state.turboMode === "lightx2v" || state.turboMode === "pdd") {
    return "A turbo schedule is only a handful of steps — it never reaches the threshold these caches reuse steps at.";
  }
  return "";
}

/**
 * One-time conversion from the old accelMode + scattered attention/cache booleans into the
 * new axis fields, so saved workflows don't reset. SLA is given priority when multiple old
 * backends were on at once, since it was the one silently winning before this port (bug ①
 * in SPEC_MINIMAX_H3_PIPELINE_AXES.md). Mutates `saved` in place; call before defaultState()
 * reads turboMode/attnBackend/etc. off it. Guarded by pipelineMigrated so it only ever runs once.
 */
export function migratePipelineState(saved: Partial<MinimaxState> & Record<string, any>): void {
  if (saved.pipelineMigrated) return;

  if (saved.turboMode == null) {
    saved.turboMode = saved.accelMode === "turbo" ? "larryvrh" : "none";
  }
  if (saved.useSpectrum == null) {
    saved.useSpectrum = saved.accelMode === "spectrum" ? true : !!saved.useSpectrum;
  }
  if (saved.attnBackend == null) {
    // Node `0876abc`: the backend a run was actually configured with wins. SLA was its own
    // checkbox alongside the others in the old UI, so mapping it first here would take the
    // slot away from the backend the user picked — and the old attnForward gate then took
    // the H3 forward patch down with it. SLA is only adopted when nothing else claimed it.
    if (saved.accelMode === "solattn") saved.attnBackend = "solattn_kijai";
    else if (saved.useCkAttention) saved.attnBackend = "ck";
    else if (saved.useSageAttn) saved.attnBackend = "sage";
    else if (saved.useSlaAttention) saved.attnBackend = "sla";
    else saved.attnBackend = "none";
  }
  if (saved.attnForward == null) {
    saved.attnForward = saved.useMemEffSage ? "memeff_sage" : "none";
  }
  if (saved.blockCache == null) {
    saved.blockCache = saved.useFirstBlockCache ? "fbcache" : saved.useCache ? "h3cache" : "none";
  }
  saved.pipelineMigrated = true;
}

export const UPSCALE_MODES = [
  { key: "none", label: "None" },
  { key: "model", label: "Upscale Model" },
  { key: "rtx", label: "RTX VSR" },
];

export const CONTINUITY_MODES = [
  { key: "none", label: "None", hint: "nothing is handed between clips — each one is made from its prompt, on the run's own model; only the common prompt keeps them consistent" },
  {
    key: "onetake",
    label: "One-Take (latent)",
    hint: "each clip's sampled latent tail feeds straight into the next clip's head — no VAE round trip, and the run's own mode (including Reference) carries on unchanged",
    refHint: "each clip's sampled latent tail feeds straight into the next clip's head — reference images keep conditioning every clip, unlike Last Frame Chain which drops them after the first",
  },
  { key: "reference", label: "Reference", refOnly: true, hint: "every clip re-uses the same reference images — the mode carries on unchanged" },
  {
    key: "lastframe",
    label: "Last Frame Chain",
    hint: "each clip starts from the previous clip's final frame",
    refHint: "clips after the first start from the previous clip's final frame (rendered by FL2VA, so the reference images shape the first clip only — the common prompt carries the rest)",
  },
] as const;

const isSet = (v: string | undefined) => !!v && v !== "none";

export function modelAvailability(state: MinimaxState) {
  return {
    fl: isSet(state.unetFirstLast),
    ref: isSet(state.unetReference),
    clip: isSet(state.clipName),
    vaeVideo: isSet(state.vaeVideo),
    vaeAudio: isSet(state.vaeAudio),
  };
}

export function configIssues(state: MinimaxState) {
  const a = modelAvailability(state);
  const missing: string[] = [];
  if (!a.fl && !a.ref) missing.push("a UNET (First/Last or Reference)");
  if (!a.clip) missing.push("the text encoder");
  if (!a.vaeVideo) missing.push("the video VAE");
  if (!a.vaeAudio) missing.push("the audio VAE");
  return missing;
}

export function generationModesFor(state: MinimaxState) {
  const a = modelAvailability(state);
  return GENERATION_MODES.map((m) => {
    const ok = m.key === "reference" ? a.ref : a.fl;
    return { ...m, enabled: ok, reason: ok ? "" : `Set the ${m.key === "reference" ? "Reference" : "First/Last"} UNET in ⚙ Settings → Models` };
  });
}

export function continuityModesFor(generationMode: string, state?: MinimaxState) {
  const isRef = (generationMode || "t2v") === "reference";
  const a = state ? modelAvailability(state) : { fl: true, ref: true };
  const need: Record<string, "fl" | "ref" | null> = { lastframe: "fl", reference: "ref", none: null, onetake: null };
  return CONTINUITY_MODES.map((m: any) => {
    if (m.refOnly && !isRef) {
      return { key: m.key, label: m.label, hint: m.hint, disabled: true, reason: "Only available in Reference mode" };
    }
    const k = need[m.key];
    const ok = !k || (a as any)[k];
    return {
      key: m.key,
      label: m.label,
      hint: isRef && m.refHint ? m.refHint : m.hint,
      disabled: !ok,
      reason: ok ? "" : `Needs the ${k === "ref" ? "Reference" : "First/Last"} UNET — set it in ⚙ Settings → Models`,
    };
  });
}

export function activePrompts(state: MinimaxState) {
  const list = state.prompts || [{ text: "", firstFrame: "", enabled: true }];
  return list.map((p, i) => ({ p, i })).filter(({ p }) => promptEnabled(p));
}

export const ONE_TAKE_OVERLAP_FRAMES = 39;

export function clipPlan(state: MinimaxState) {
  const frames = state.clipFrames ?? 192;
  const clipSec = framesToSeconds(frames);
  const total = Math.max(1, (state.prompts || [{ text: "" }]).length);
  const count = Math.max(0, activePrompts(state).length);
  const avg = state.avgMinutesPerClip ?? 13;
  const actualSeconds = count * clipSec;

  // One-Take + auto-stitch: the finished result isn't `count` clips end-to-end — each clip
  // after the first shares `overlap` seconds with the previous one, and the auto-stitch step
  // trims that overlap out. Same formula as the real stitch (view.ts's onetake-finish handler
  // and galleryOverlay.ts's manual Stitch), kept here too so the estimate shown before a run
  // matches what actually gets saved.
  const isOneTakeStitched = state.continuityMode === "onetake" && state.oneTakeAutoStitch !== false;
  const overlapSec = framesToSeconds(alignFrameCount(ONE_TAKE_OVERLAP_FRAMES));
  const stitchedSeconds = count > 1 ? actualSeconds - (count - 1) * overlapSec : actualSeconds;

  return { count, clipSec, actualSeconds, isOneTakeStitched, stitchedSeconds, estimateMinutes: count * avg, promptCount: total };
}

export function formatDuration(minutes: number) {
  if (!isFinite(minutes) || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60),
    m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export const promptText = (p: PromptEntry | string) => (typeof p === "string" ? p : p?.text || "");
export const promptEnabled = (p: PromptEntry | string) => (typeof p === "string" ? true : p?.enabled !== false);
export const promptFirstFrame = (p: PromptEntry | string) => (typeof p === "string" ? "" : p?.firstFrame || "");
export const promptOverrides = (p: PromptEntry | string | undefined): boolean => typeof p !== "string" && !!p?.override;

export interface ClipAssets {
  own: boolean; // true = this clip's own set (from the prompt entry), false = the common set
  refImages: string[];
  refImagesMp: number[];
  refVideos: MinimaxState["refVideos"];
  refAudios: MinimaxState["refAudios"];
  lastFrame: string;
}

/** Single resolver for "what does this clip actually render with" — the render loop, the
 * Prompt Edit attachment area (which Enhance's vision step also reads from, so vision and
 * rendering can never disagree about which images a clip used), and saved metadata all go
 * through this. All-or-nothing per SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §1. */
export function clipAssets(state: MinimaxState, i: number): ClipAssets {
  const p = (state.prompts || [])[i];
  if (promptOverrides(p)) {
    const e = p as PromptEntry;
    return {
      own: true,
      refImages: (e.refImages || []).filter(Boolean),
      refImagesMp: e.refImagesMp || [],
      refVideos: e.refVideos || [],
      refAudios: e.refAudios || [],
      lastFrame: e.lastFrame || "",
    };
  }
  return {
    own: false,
    refImages: (state.refImages || []).filter(Boolean),
    refImagesMp: state.refImagesMp || [],
    refVideos: state.refVideos || [],
    refAudios: state.refAudios || [],
    lastFrame: state.lastFrameImage || "",
  };
}

/** Header/footer counterpart to clipAssets() — same all-or-nothing rule (SPEC_MINIMAX_H3_
 * PER_CLIP_OVERRIDE.md §2): a clip that changed its reference images but kept the common
 * header/tail would render the previous shot's visual style and music over the new scene,
 * silently. */
export function clipFraming(state: MinimaxState, i: number): { own: boolean; header: string; footer: string } {
  const p = (state.prompts || [])[i];
  if (promptOverrides(p)) {
    const e = p as PromptEntry;
    return { own: true, header: e.header || "", footer: e.footer || "" };
  }
  return { own: false, header: state.promptHeader || "", footer: state.promptFooter || "" };
}

/** Joins each source clip's already-composed prompt (header+body+tail) with a `[Clip N]`
 * marker so a stitched result's saved prompt says where one shot ends and the next begins —
 * a blank line alone doesn't survive a later Reuse or a human re-reading the sidecar
 * (SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §5). */
export function composeStitchedPrompt(clipPrompts: (string | null | undefined)[]): string {
  const parts = (clipPrompts || []).map((t) => String(t || "").trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] || "";
  return parts.map((t, i) => `[Clip ${i + 1}]\n${t}`).join("\n\n");
}

export function parseTargetSeconds(text: string): number {
  const raw = String(text || "").trim().toLowerCase();
  if (!raw) return 0;
  const clock = raw.match(/^(\d+)\s*:\s*([0-5]?\d(?:\.\d+)?)$/);
  if (clock) return +clock[1] * 60 + +clock[2];
  const min = raw.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes|분)/);
  const sec = raw.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds|초)/);
  if (min || sec) return (min ? +min[1] * 60 : 0) + (sec ? +sec[1] : 0);
  const plain = raw.match(/^(\d+(?:\.\d+)?)$/);
  return plain ? +plain[1] : 0;
}

export function evenBreaks(count: number, groups: number): number[] {
  const n = Math.max(1, Math.min(groups || 1, count));
  const per = Math.ceil(count / n);
  const b: number[] = [];
  for (let i = per; i < count; i += per) b.push(i);
  return b;
}

export function groupShotsWithBreaks(shots: string[], groups: number, breaks?: number[]) {
  if (!shots.length) return [];
  if (breaks && breaks.length) {
    const cuts = [...new Set(breaks)].filter((i) => i > 0 && i < shots.length).sort((a, b) => a - b);
    const out: string[][] = [];
    let prev = 0;
    for (const c of cuts) {
      out.push(shots.slice(prev, c));
      prev = c;
    }
    out.push(shots.slice(prev));
    return out.map((g) => g.join("\n\n"));
  }
  return groupShots(shots, groups);
}

export const IMAGE_BRIEF_MODES = [
  { key: "fl", label: "First/Last (max 2)", max: 2, hint: "image 1 = the starting frame, image 2 = the ending frame — write the brief as a first/last-frame shot" },
  { key: "ref", label: "Reference (max 8)", max: 8, hint: "each image is a <Picture N> reference, in upload order" },
];
export function imageBriefMax(mode: string) {
  return (IMAGE_BRIEF_MODES.find((m) => m.key === mode) || IMAGE_BRIEF_MODES[1]).max;
}

export function composeClipPrompt(state: MinimaxState, i: number) {
  const list = state.prompts || [];
  let body = "";
  for (let k = Math.min(i, list.length - 1); k >= 0; k--) {
    const t = promptText(list[k]).trim();
    if (t) {
      body = t;
      break;
    }
  }
  const { header, footer } = clipFraming(state, i);
  return [header, body, footer, loraTriggers(state), state.promptSuffix]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function loraTriggers(state: MinimaxState) {
  return (state.loras || [])
    .filter((l) => l && l.enabled !== false && l.name && l.name !== "none" && l.triggerWord)
    .map((l) => String(l.triggerWord).trim())
    .filter(Boolean)
    .join(", ");
}

export function parseBrief(text: string) {
  const SHOT_LINE_RE = /^[ \t]*\[(?:Shot|SHOT|샷)[ \t]*\d+\][^\n]*$/gm;
  // The brief model ends with an audio section in two styles: simple ("Ambient sound:" /
  // "Music:") and structured ("overall_soundscape:" / "non_diegetic_music:", sometimes
  // markdown-bolded or hyphenated). Match both + the underscore/hyphen spellings it emits.
  // SPEC_MINIMAX_H3_ENHANCE_APPLY_MODES.md §2.
  const TAIL_RE = /^[ \t>*_-]*(?:Ambient[ _]?sound|Ambience|Sound(?:[ _]?design|scape)?|Music|Soundtrack|Score|overall[ _]?soundscape|non[ _-]?diegetic[ _]?music|diegetic[ _]?sound|SFX|Foley|Audio|배경음|음악|사운드|효과음)[ \t_*]*:/i;
  // The model often echoes its own instructions / vision analysis at the end of a block —
  // drop everything from the first such line to the end. `Image N:` is bracketed-safe;
  // bare `Picture N:` is deliberately NOT matched (retention_analysis uses `<Picture N>:`).
  const ECHO_RE = /^[ \t>*_-]*(?:Target duration|Write exactly|The following images?|USER REQUEST|Structure:|Output ONLY|Refer to media|Image \d+\s*:)/i;
  const raw = String(text || "").trim();
  if (!raw) return { header: "", shots: [] as string[], footer: "" };

  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = SHOT_LINE_RE.exec(raw)) !== null) starts.push(m.index);

  if (!starts.length) {
    const parts = raw
      .split(/^\s*-{3,}\s*$/m)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length > 1 ? { header: "", shots: parts, footer: "" } : { header: "", shots: [raw], footer: "" };
  }

  const header = raw.slice(0, starts[0]).trim();
  const blocks = starts.map((s, i) => raw.slice(s, i + 1 < starts.length ? starts[i + 1] : undefined).trim());

  let footer = "";
  const last = blocks[blocks.length - 1];
  const lines = last.split("\n");
  let cut = -1;
  for (let i = 1; i < lines.length; i++) {
    if (TAIL_RE.test(lines[i])) {
      cut = i;
      break;
    }
  }
  if (cut > 0) {
    blocks[blocks.length - 1] = lines.slice(0, cut).join("\n").trim();
    footer = lines.slice(cut).join("\n").trim();
  }
  const stripEcho = (s: string) => {
    const ls = s.split("\n");
    const cutAt = ls.findIndex((l) => ECHO_RE.test(l));
    return (cutAt >= 0 ? ls.slice(0, cutAt) : ls).join("\n").trim();
  };
  return {
    header: stripEcho(header),
    shots: blocks.map(stripEcho).filter(Boolean),
    footer: stripEcho(footer),
  };
}

export function groupShots(shots: string[], groups: number) {
  if (!shots.length) return [];
  const n = Math.max(1, Math.min(groups || 1, shots.length));
  const per = Math.ceil(shots.length / n);
  const out: string[] = [];
  for (let i = 0; i < shots.length; i += per) out.push(shots.slice(i, i + per).join("\n\n"));
  return out;
}

export function loadState(): Partial<MinimaxState> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}
export function saveState(s: MinimaxState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
}

export function defaultState(saved: Partial<MinimaxState> = {}): MinimaxState {
  migratePipelineState(saved as any);
  return {
    unetFirstLast: saved.unetFirstLast || "",
    unetReference: saved.unetReference || "",
    clipName: saved.clipName || "",
    vaeVideo: saved.vaeVideo || "",
    vaeAudio: saved.vaeAudio || "",
    turboLora: saved.turboLora || "",
    turboLoraReference: saved.turboLoraReference || "",
    turboLoraStrength: saved.turboLoraStrength ?? 1.0,
    turboLoraLowVram: saved.turboLoraLowVram ?? false,
    upscaleModel: saved.upscaleModel || "",
    targetLength: saved.targetLength || "",
    audioLock: saved.audioLock ?? false,
    lockAudioFile: saved.lockAudioFile || "",
    audioLockMode: saved.audioLockMode || "lock",
    audioLockStrength: saved.audioLockStrength ?? 0.5,
    audioLockFit: saved.audioLockFit || "pad_silence",
    audioLockTrimStart: saved.audioLockTrimStart ?? 0,
    audioLockTrimEnd: saved.audioLockTrimEnd ?? 0,
    loras: Array.isArray(saved.loras)
      ? saved.loras.map((l) => ({ name: l.name || "none", strength: l.strength ?? 1.0, triggerWord: l.triggerWord || "", enabled: l.enabled !== false }))
      : [],
    generationMode: saved.generationMode || "t2v",
    accelMode: saved.accelMode || "solattn",
    upscaleMode: saved.upscaleMode || "none",
    deblurStrength: saved.deblurStrength || "none",
    saveUnprocessed: !!saved.saveUnprocessed,
    continuityMode: saved.continuityMode || "onetake",
    oneTakeLockAudio: saved.oneTakeLockAudio ?? false,
    oneTakeAutoStitch: saved.oneTakeAutoStitch ?? true,
    oneTakeAudioOverride: !!saved.oneTakeAudioOverride,
    aspect: saved.aspect || "9:16 Portrait",
    megapixels: saved.megapixels ?? 1.0,
    clipFrames: saved.clipFrames ?? DEFAULT_FRAMES,
    clipLengthCustom: !!saved.clipLengthCustom,
    clipLengthCustomSec: saved.clipLengthCustomSec ?? framesToSeconds(saved.clipFrames ?? DEFAULT_FRAMES),
    totalSeconds: saved.totalSeconds ?? 8,
    trimLastClip: saved.trimLastClip ?? false,
    avgMinutesPerClip: saved.avgMinutesPerClip ?? 13,
    unloadBetweenClips: saved.unloadBetweenClips ?? true,
    prompts: (Array.isArray(saved.prompts) && saved.prompts.length ? saved.prompts : [{ text: "", firstFrame: "", enabled: true }]).map((p: any) =>
      typeof p === "string" ? { text: p, firstFrame: "", enabled: true } : { text: p?.text || "", firstFrame: p?.firstFrame || "", enabled: p?.enabled !== false }
    ),
    promptHeader: saved.promptHeader || "",
    promptFooter: saved.promptFooter || "",
    promptSuffix: saved.promptSuffix || "",
    firstFrameImage: saved.firstFrameImage || null,
    lastFrameImage: saved.lastFrameImage || null,
    firstFrameMp: saved.firstFrameMp ?? 1.0,
    lastFrameMp: saved.lastFrameMp ?? 1.0,
    refImages: Array.isArray(saved.refImages) ? saved.refImages.slice(0, 9) : [],
    refImagesMp: Array.isArray(saved.refImagesMp) ? saved.refImagesMp.slice(0, 9) : [],
    refImageSize: saved.refImageSize || "match",
    refVideos: Array.isArray(saved.refVideos) ? saved.refVideos.slice(0, 3).map((v) => ({ file: v.file || "", start: v.start ?? 0, end: v.end ?? 5, withAudio: v.withAudio !== false })) : [],
    refAudios: Array.isArray(saved.refAudios) ? saved.refAudios.slice(0, 3).map((a) => ({ file: a.file || "", start: a.start ?? 0, end: a.end ?? 5 })) : [],
    refTypes: { images: saved.refTypes?.images !== false, videos: saved.refTypes?.videos ?? false, audios: saved.refTypes?.audios ?? false },
    steps: saved.steps ?? 20,
    turboSteps: saved.turboSteps ?? 4,
    slaTurboSteps: saved.slaTurboSteps ?? 6,
    sampler: saved.sampler || "res_multistep",
    scheduler: saved.scheduler || "simple",
    denoise: saved.denoise ?? 1.0,
    seed: saved.seed ?? 0,
    seedMode: saved.seedMode || "randomize",
    seedPerClip: saved.seedPerClip ?? true,
    useCache: saved.useCache ?? true,
    useFirstBlockCache: saved.useFirstBlockCache ?? false,
    saveSubfolder: saved.saveSubfolder || "",
    filenamePrefix: saved.filenamePrefix || "MMH3",
    stitchAtEnd: saved.stitchAtEnd ?? true,
    briefImageMode: saved.briefImageMode || (saved as any).ollamaImageMode || "ref",
    visionSource: "native", // Ollama removed — always native regardless of what was saved before
    nativeVisionClip: saved.nativeVisionClip || "Qwen3\\qwen_3vl_8b_nvfp4.safetensors",
    nativeBriefClip: saved.nativeBriefClip || "LTX\\gemma4_e2b_it_bf16.safetensors",
    turboLoraStrength: saved.turboLoraStrength ?? 1.0,
    turboLoraLowVram: saved.turboLoraLowVram ?? false,
    pddFile: saved.pddFile || "none",
    pddFileReference: saved.pddFileReference || "none",
    pddNfe: String(saved.pddNfe ?? "8"),
    pddLoraStrength: saved.pddLoraStrength ?? 1.0,
    pddHeadStrength: saved.pddHeadStrength ?? 1.0,
    solTau: saved.solTau ?? 1.3,
    solMinTokens: saved.solMinTokens ?? 4096,
    solStart: saved.solStart ?? 0.2,
    solEnd: saved.solEnd ?? 0.9,
    specBlendWeight: saved.specBlendWeight ?? 0.5,
    specDegree: saved.specDegree ?? 1,
    specRidgeLambda: saved.specRidgeLambda ?? 0.1,
    specWindowSize: saved.specWindowSize ?? 2.0,
    specFlexWindow: saved.specFlexWindow ?? 0.75,
    specWarmupSteps: saved.specWarmupSteps ?? 1,
    specTailSteps: saved.specTailSteps ?? 1,
    specMaxHistory: saved.specMaxHistory ?? 8,
    specHistoryStore: saved.specHistoryStore || "system_ram",
    rtxScale: saved.rtxScale ?? 2.0,
    rtxQuality: saved.rtxQuality || "ULTRA",
    shiftVideo: saved.shiftVideo ?? 12,
    shiftAudio: saved.shiftAudio ?? 3,
    useSageAttn: saved.useSageAttn ?? true,
    sageAttnMode: saved.sageAttnMode || "auto",
    useMemEffSage: saved.useMemEffSage ?? true,
    useCkAttention: saved.useCkAttention ?? false,
    ckAttentionBackend: saved.ckAttentionBackend || "comfy_kitchen",
    useTorchPatch: saved.useTorchPatch ?? true,
    fp16Accum: saved.fp16Accum ?? true,
    useSlaAttention: saved.useSlaAttention ?? false,
    slaSparsity: saved.slaSparsity ?? 0.9,
    slaBlockSize: saved.slaBlockSize || "64",
    slaMinSeqLen: saved.slaMinSeqLen ?? 8192,
    slaDenseLastSteps: saved.slaDenseLastSteps ?? 0,
    slaProtectAudio: saved.slaProtectAudio !== false,
    slaRunEnabled: saved.slaRunEnabled !== false,
    fbcMode: saved.fbcMode || "H3 Fast — 0.10 / max 2",
    fbcThreshold: saved.fbcThreshold ?? 0.1,
    fbcStartPercent: saved.fbcStartPercent ?? 0.1,
    fbcEndPercent: saved.fbcEndPercent ?? 0.95,
    fbcMaxConsecutiveHits: saved.fbcMaxConsecutiveHits ?? 2,
    fbcTemporalGuard: saved.fbcTemporalGuard ?? false,
    cacheThreshold: saved.cacheThreshold ?? 0.3,
    cacheMaxSteps: saved.cacheMaxSteps ?? 2,
    cacheStart: saved.cacheStart ?? 0.15,
    cacheEnd: saved.cacheEnd ?? 0.9,
    previewEnabled: saved.previewEnabled ?? true,
    previewFrames: saved.previewFrames ?? 8,
    previewFps: saved.previewFps ?? 12,
    previewMaxRes: saved.previewMaxRes ?? 512,
    previewQuality: saved.previewQuality ?? 85,
    previewTinyVae: saved.previewTinyVae || "none",
    enhCollapsed: !!saved.enhCollapsed,
    turboMode: saved.turboMode || "none",
    attnBackend: saved.attnBackend || "none",
    attnForward: saved.attnForward || "none",
    blockCache: saved.blockCache || "none",
    h3Optimizer: saved.h3Optimizer || "none",
    h3MemChunkRows: saved.h3MemChunkRows ?? 4096,
    h3MemPrecision: saved.h3MemPrecision || "Auto",
    h3MemQkvStreaming: saved.h3MemQkvStreaming || "Auto",
    h3MemLowVram: !!saved.h3MemLowVram,
    h3SparseBudget: saved.h3SparseBudget ?? 0.15,
    h3SparseDenserEdges: saved.h3SparseDenserEdges !== false,
    h3SparseLayerBudgets: saved.h3SparseLayerBudgets || "",
    useSpectrum: !!saved.useSpectrum,
    useFusedModulation: saved.useFusedModulation ?? false,
    pipelineMigrated: !!saved.pipelineMigrated,
    solSchedTauStart: saved.solSchedTauStart ?? 1.3,
    solSchedTauEnd: saved.solSchedTauEnd ?? 0.8,
    solSchedCurve: saved.solSchedCurve || "linear",
    solSchedMinTokens: saved.solSchedMinTokens ?? 4096,
    solSchedStrict: saved.solSchedStrict ?? false,
    solSchedDensePercent: saved.solSchedDensePercent ?? 0.0,
    solSchedThreshType: saved.solSchedThreshType || "diag",
    solSchedInt8Qk: saved.solSchedInt8Qk ?? false,
    solSchedInt8Pv: saved.solSchedInt8Pv ?? false,
    solSchedSinkConditioning: saved.solSchedSinkConditioning || "exact_kv_and_rows",
    solSchedDenseBlocks: saved.solSchedDenseBlocks || "",
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e15);
}
