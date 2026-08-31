import { getComfyBase } from "../../shared/comfyBase";
// api.ts — MiniMax H3의 백엔드 호출 (원본 web/minimax/api_minimax.js 이식).
// 프롬프트 에디터의 LLM(Ollama) 기능은 ComfyUI가 서빙하는 `/minimax_h3_one/llm/*` 라우트를
// 그대로 부르므로, 이 파일만으로도 ComfyUI가 CORS 허용 상태로 켜져 있으면 바로 동작한다
// (§3-2 comfy-client.ts 전체가 완성되기 전에도 이 기능만은 먼저 살아있게 하기 위함).
import { API, SUBFOLDER, type UserPipelinePreset } from "./core";

// TODO(§3-2): comfy-client.ts가 완성되면 이 BASE/fetchApi를 그쪽 공용 클라이언트로 교체.
const BASE = getComfyBase();

async function fetchApi(path: string, opts?: RequestInit) {
  return fetch(`${BASE}${path}`, opts);
}

export interface ModelLists {
  diffusion_models?: string[];
  text_encoders?: string[];
  vaes?: string[];
  loras?: string[];
  upscale_models?: string[];
  vae_approx?: string[];
  pdd_acc?: string[]; // MiniMaxH3PDDAccApply's models/pdd_acc folder — empty if the pack isn't installed, not an error.
  [key: string]: string[] | undefined;
}

// models/vae_approx 목록 — ModelPreviewOverrideKJ(KJNodes)의 optional tiny_vae 콤보에 쓰인다.
// 원본 노드는 이 목록을 자기 /minimax_h3_one/models 응답에 vae_approx 필드로 얹어서 준다(같은
// 백엔드를 쓰는 이 사이트도 getModels()가 갱신되는 대로 그대로 받는다). 아직 그 필드가 없는
// 예전 백엔드에서도 동작하도록, ComfyUI 코어의 범용 /object_info를 폴백으로 쓴다.
export async function getPreviewTinyVaeOptions(modelData?: ModelLists): Promise<string[]> {
  if (modelData?.vae_approx?.length) return ["none", ...modelData.vae_approx.filter((v) => v !== "none")];
  try {
    const r = await fetchApi("/object_info/ModelPreviewOverrideKJ");
    if (!r.ok) return ["none"];
    const d = await r.json();
    const opts = d?.ModelPreviewOverrideKJ?.input?.optional?.tiny_vae?.[1]?.options;
    return Array.isArray(opts) && opts.length ? opts : ["none"];
  } catch {
    return ["none"];
  }
}

export async function getModels(): Promise<ModelLists> {
  try {
    const r = await fetchApi(`${API}/models`);
    if (!r.ok) return {};
    return await r.json();
  } catch {
    return {};
  }
}

export interface MmhConfig {
  unet_first_last?: string;
  unet_reference?: string;
  clip_name?: string;
  vae_video?: string;
  vae_audio?: string;
  turbo_lora?: string;
  turbo_lora_strength?: number;
  upscale_model?: string;
  save_subfolder?: string;
  prompt_suffix?: string;
  avg_minutes_per_clip?: number;
  preview_tiny_vae?: string;
  preview_enabled?: boolean;
  preview_frames?: number;
  preview_fps?: number;
  preview_max_res?: number;
  preview_quality?: number;
  turbo_lora_low_vram?: boolean;
  sampler?: string;
  scheduler?: string;
  denoise?: number;
  shift_video?: number;
  shift_audio?: number;
  use_sage_attn?: boolean;
  sage_attn_mode?: string;
  use_mem_eff_sage?: boolean;
  use_torch_patch?: boolean;
  fp16_accum?: boolean;
  use_ck_attention?: boolean;
  ck_attention_backend?: string;
  use_sla_attention?: boolean;
  sla_sparsity?: number;
  sla_block_size?: string;
  sla_min_seq_len?: number;
  sla_dense_last_steps?: number;
  sla_protect_audio?: boolean;
  fbc_mode?: string;
  fbc_threshold?: number;
  fbc_start_percent?: number;
  fbc_end_percent?: number;
  fbc_max_consecutive_hits?: number;
  fbc_temporal_guard?: boolean;
  cache_threshold?: number;
  cache_start?: number;
  cache_end?: number;
  cache_max_steps?: number;
  vision_source?: string;
  native_vision_clip?: string;
  filename_prefix?: string;
  stitch_at_end?: boolean;
  trim_last_clip?: boolean;
  unload_between_clips?: boolean;
  user_presets?: UserPipelinePreset[];
}

export async function getConfig(): Promise<MmhConfig> {
  try {
    const r = await fetchApi(`${API}/config`);
    if (!r.ok) return {};
    return await r.json();
  } catch {
    return {};
  }
}

export async function saveConfig(patch: MmhConfig) {
  try {
    return await fetchApi(`${API}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch {
    return null;
  }
}

/** User pipeline presets (SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §14) live in this same shared
 * config, not localStorage — has to survive a browser reset. */
export async function getUserPresets(): Promise<UserPipelinePreset[]> {
  const cfg = await getConfig();
  return Array.isArray(cfg.user_presets) ? cfg.user_presets : [];
}
export async function saveUserPresets(list: UserPipelinePreset[]) {
  return saveConfig({ user_presets: list });
}

export const MMH3_OPTIONAL_NODES = [
  "PathchSageAttentionKJ",
  "ModelPreviewOverrideKJ",
  "ModelPatchTorchSettings",
  "MiniMaxH3MemoryEfficientSageAttentionPatch",
  "MiniMaxH3ScheduledSolAttentionPatch",
  "MiniMaxH3FusedModulation",
  "ModelAttentionBackend",
  "H3SLAAttention",
  "MiniMaxH3Cache",
  "ApplyMiniMaxH3FirstBlockCache",
  "MiniMaxH3TurboSampler",
  "MiniMaxH3TurboLoRA",
  "SolAttnPatch",
  "SpectrumApplyMiniMaxH3",
  "RTXVideoSuperResolution",
  // Gallery post-processing (Upscale/Interpolate on an already-finished clip) —
  // SPEC_GALLERY_UPSCALE_INTERPOLATE.md. RIFEInterpolation is "RIFE Frame Interpolation"
  // (image/animation category) — NOT ComfyUI-Frame-Interpolation's RIFE VFI, a different node
  // with a different interface (source_fps/target_fps pair vs an integer multiplier).
  "RIFEInterpolation",
  "UpscaleModelLoader",
  "ImageUpscaleWithModel",
  "VHS_LoadVideo",
  "LoadAudio",
  "TrimAudioDuration",
  "TJ_H3_AudioLock",
  "TJ_H3_LatentContinuation",
  "TJ_H3_SaveLatentCheckpoint",
  "TJ_H3_LoadLatentCheckpoint",
  "TJ_MultiImageLoader",
  "TextGenerate",
  "TJStudioOneTextOutput",
  "TJ_FreeTextEncoderVRAM",
  // PDD Acc turbo mode — SPEC_MINIMAX_H3_PDD_AND_TELEMETRY.md.
  "MiniMaxH3PDDAccApply",
  // RTX Deblur — SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §15.
  "TJ_RTXDeblur",
];
export const MMH3_CORE_NODES = ["MiniMaxH3ImageToVideo", "MiniMaxH3ReferenceToVideo", "MiniMaxH3SigmaShift", "SamplerCustomAdvanced", "CreateVideo", "SaveVideo"];

export interface NodeAvailability {
  ok: boolean;
  available: Record<string, boolean>;
  core_ok: boolean;
  missing_core: string[];
  missing_optional: string[];
  // The node's /node_availability route (v1.20.3+) names the exact install
  // script so the "packs missing" banner can show a copy-paste command. Absent
  // on older backends — depBanner falls back to sensible defaults.
  install_dir?: string;
  install_script_win?: string;
  install_script_nix?: string;
}

/** Which pipeline nodes this ComfyUI install actually has (no LiteGraph registry here — pure backend query). */
export async function getNodeAvailability(): Promise<NodeAvailability> {
  const all = [...MMH3_CORE_NODES, ...MMH3_OPTIONAL_NODES];
  try {
    const r = await fetchApi(`${API}/node_availability`);
    const d = await r.json();
    const available: Record<string, boolean> = d.available || {};
    const missingCore = MMH3_CORE_NODES.filter((n) => !available[n]);
    const missingOptional = MMH3_OPTIONAL_NODES.filter((n) => !available[n]);
    return {
      ok: true, available, core_ok: missingCore.length === 0,
      missing_core: missingCore, missing_optional: missingOptional,
      install_dir: d.install_dir, install_script_win: d.install_script_win, install_script_nix: d.install_script_nix,
    };
  } catch {
    const available: Record<string, boolean> = {};
    for (const n of all) available[n] = false;
    return { ok: false, available, core_ok: false, missing_core: MMH3_CORE_NODES, missing_optional: MMH3_OPTIONAL_NODES };
  }
}

// ── 프롬프트 세트 — 서버 파일로 저장되는 이름 붙은 프롬프트 묶음(원본 A5) ─────
export interface PromptSetSummary {
  name: string;
  count: number;
}
// v2 (SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §7) — a prompt set now also carries the images/
// video/audio it takes to reproduce a Reference/First-Last piece, not just the text. `prompts[]`
// entries are saved whole (override/refImages/etc. included), not trimmed to text/firstFrame/
// enabled, so a set built with per-clip overrides round-trips intact. The server route this
// posts to is shared with the node build, which already writes/reads all of these fields — see
// that side's payload version bump for the matching whitelist fix.
export interface PromptSetData {
  clipFrames?: number;
  promptHeader?: string;
  promptFooter?: string;
  prompts: Record<string, any>[];
  generationMode?: string;
  refTypes?: { images?: boolean; videos?: boolean; audios?: boolean };
  refImages?: string[];
  refImagesMp?: number[];
  firstFrameImage?: string | null;
  lastFrameImage?: string | null;
  refVideos?: { file: string; start: number; end: number; withAudio?: boolean }[];
  refAudios?: { file: string; start: number; end: number }[];
}

export async function listPromptSets(): Promise<PromptSetSummary[]> {
  const r = await fetchApi(`${API}/prompt_sets`);
  const d = await r.json();
  return d.sets || [];
}
export async function getPromptSet(name: string): Promise<PromptSetData> {
  const r = await fetchApi(`${API}/prompt_sets/get?name=${encodeURIComponent(name)}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
}
export async function savePromptSet(payload: { name: string } & PromptSetData) {
  const r = await fetchApi(`${API}/prompt_sets/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || "save failed");
  return d;
}
export async function deletePromptSet(name: string) {
  const r = await fetchApi(`${API}/prompt_sets/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || "delete failed");
  return d;
}

/** Which of these input/-folder filenames no longer exist — SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md
 * §8. A prompt set remembers filenames, and input/ gets cleaned out independently of any set, so
 * a name can go stale silently. One batched call (not one HEAD per file) against a shared,
 * cross-tool route — not under the minimax_h3-specific API prefix. Names come from saved state,
 * not a trusted path, so this never assumes they're safe to use as-is beyond the existence check
 * itself. On any failure, nothing is reported missing — a ghost badge is a nuisance, but wrongly
 * flagging every image as missing because the route was briefly unreachable is worse. */
export async function checkInputExists(names: string[]): Promise<string[]> {
  const unique = [...new Set((names || []).filter(Boolean))];
  if (!unique.length) return [];
  try {
    const r = await fetchApi("/tj_shared/input_exists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ names: unique }) });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d.missing) ? d.missing : [];
  } catch {
    return [];
  }
}

export async function getLoraTriggers(loraName: string): Promise<{ ok: boolean; triggers?: string[] }> {
  try {
    const r = await fetchApi(`${API}/lora_triggers?name=${encodeURIComponent(loraName)}`);
    return await r.json();
  } catch {
    return { ok: false };
  }
}

export async function getSystemPrompt(name = "minimax") {
  try {
    const r = await fetchApi(`${API}/llm/system_prompt?name=${encodeURIComponent(name)}`);
    if (r.status === 404) return { ok: false, instruction: "", needsRestart: true };
    return await r.json();
  } catch {
    return { ok: false, instruction: "" };
  }
}

export async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("image", file);
  fd.append("subfolder", "");
  fd.append("type", "input");
  const r = await fetchApi("/upload/image", { method: "POST", body: fd });
  if (!r.ok) throw new Error(`upload failed (${r.status})`);
  const d = await r.json();
  return d.name;
}

export function viewUrl(filename: string) {
  return `${BASE}/view?filename=${encodeURIComponent(filename)}&type=input`;
}

export function outputViewUrl(filename: string, subfolder = "", type = "output") {
  return `${BASE}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${type}&t=${Date.now()}`;
}

/** Upload a non-image asset (video/audio) into ComfyUI's input folder. */
export async function uploadMedia(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("image", file);
  fd.append("subfolder", "");
  fd.append("type", "input");
  const r = await fetchApi("/upload/image", { method: "POST", body: fd });
  if (!r.ok) throw new Error(`upload failed (${r.status})`);
  const d = await r.json();
  return d.name;
}

export interface MediaInfo {
  ok: boolean;
  duration?: number;
  fps?: number;
  has_audio?: boolean;
}

/** Duration / audio-track presence for an input file. */
export async function getMediaInfo(file: string): Promise<MediaInfo> {
  try {
    const r = await fetchApi(`${API}/media_info?file=${encodeURIComponent(file)}`);
    if (!r.ok) return { ok: false };
    return await r.json();
  } catch {
    return { ok: false };
  }
}

export interface VideoInfo {
  ok: boolean;
  width?: number;
  height?: number;
  frames?: number;
  fps?: number;
  duration?: number;
  [key: string]: any;
}

/** Width/height/frame count for chunk-sizing a gallery post-process job (SPEC_MINIMAX_H3_
 * PER_CLIP_OVERRIDE.md §16) — throws on failure so the caller's own catch can fall back to a
 * single whole-file chunk rather than silently misreporting frame count as 0. */
export async function getVideoInfo(filename: string, subfolder?: string, type?: string): Promise<VideoInfo> {
  const r = await fetchApi(`${API}/video_info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, subfolder: subfolder || "", type: type || "input" }),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || "video_info failed");
  return d;
}

export async function getMediaFiles(): Promise<{ videos: string[]; audios: string[] }> {
  const grab = async (node: string, field: string) => {
    try {
      const r = await fetchApi(`/object_info/${node}`);
      if (!r.ok) return [];
      const d = await r.json();
      const inp = d?.[node]?.input;
      const spec = (inp?.required || {})[field] || (inp?.optional || {})[field];
      const opts = Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options || [];
      return Array.isArray(opts) ? opts.filter((x: any) => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  const [videos, audios] = await Promise.all([grab("VHS_LoadVideo", "video"), grab("LoadAudio", "audio")]);
  return { videos, audios };
}

/** Copy a generated frame back into ComfyUI's input/ so the next clip can LoadImage it. */
export async function copyOutputToInput(filename: string, subfolder?: string, type?: string): Promise<string> {
  const r = await fetchApi(`${API}/copy_to_input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, subfolder: subfolder || "", type: type || "output" }),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || "copy failed");
  return d.filename;
}

/** Deletes a copy previously made by copyOutputToInput/copy_to_input — server refuses any
 * filename that doesn't start with the pack prefix (mmh3_), so it can never touch a user's own
 * input asset. Fire-and-forget: a failed cleanup is cosmetic, never worth failing the caller. */
export function discardInputCopy(filename: string) {
  fetchApi(`${API}/discard_input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  }).catch(() => {});
}

export async function setLastResult(nodeId: string | number, opts: { image?: any; videoPath?: string } = {}) {
  const body: Record<string, any> = { unique_id: String(nodeId) };
  if (opts.image !== undefined) body.image = opts.image;
  if (opts.videoPath !== undefined) body.video_path = opts.videoPath;
  await fetchApi(`${API}/set_last_image`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
}

export async function saveMeta(filename: string, subfolder: string, stateObj: any) {
  try {
    await fetchApi(`${API}/save_meta`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename, subfolder: subfolder || "", meta: stateObj }) });
  } catch (e) {
    console.warn("[MMH3] saveMeta:", e);
  }
}

export async function pickChainFrame(images: { filename: string; subfolder: string; type: string }[]): Promise<{ ok: boolean; picked?: any; steppedBack?: boolean; checked?: any } | null> {
  try {
    const r = await fetchApi(`${API}/pick_chain_frame`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images }) });
    const d = await r.json();
    return d.ok ? d : null;
  } catch (e) {
    console.warn("[MMH3] pickChainFrame:", e);
    return null;
  }
}

export interface StitchAudioOverride {
  filename: string;
  subfolder?: string;
  type?: "input" | "output";
  start?: number;
}

export async function stitchClips(
  clips: any[],
  filenamePrefix: string,
  trimSeconds: number | null,
  overlapSeconds: number | null,
  overrideAudio?: StitchAudioOverride | null
) {
  const r = await fetchApi(`${API}/stitch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clips,
      filename_prefix: filenamePrefix,
      trim_seconds: trimSeconds ?? null,
      overlap_seconds: overlapSeconds ?? null,
      override_audio: overrideAudio || null,
    }),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || "stitch failed");
  return d;
}

export interface QueueStatus {
  running: number;
  pending: number;
}

/**
 * ComfyUI의 실제 큐 상태 — 페이지를 새로고침하면 이 사이트가 자체적으로 추적하던 진행 중인
 * 생성(clip relay loop)은 다 끊기지만, ComfyUI 서버 자체는 그 작업을 계속 처리한다. 새로고침
 * 직후에도 "지금 뭔가 돌고 있다/기다리고 있다"는 사실만큼은 놓치지 않도록 별도로 폴링한다.
 */
export async function getQueueStatus(): Promise<QueueStatus> {
  try {
    const r = await fetchApi("/queue");
    if (!r.ok) return { running: 0, pending: 0 };
    const d = await r.json();
    return { running: (d.queue_running || []).length, pending: (d.queue_pending || []).length };
  } catch {
    return { running: 0, pending: 0 };
  }
}

export async function freeMemory(opts: { unloadModels?: boolean; emptyCache?: boolean } = {}) {
  try {
    await fetchApi("/free", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unload_models: opts.unloadModels ?? true, free_memory: opts.emptyCache ?? true }) });
  } catch {}
}

export async function interrupt() {
  try {
    await fetchApi("/interrupt", { method: "POST" });
  } catch {}
}

export interface GalleryVideo {
  filename: string;
  subfolder?: string;
  type?: string;
  meta?: any;
}

export async function listVideos(subfolder?: string, opts: { offset?: number; limit?: number } = {}): Promise<{ videos: GalleryVideo[] } & Record<string, any>> {
  const { offset = 0, limit = 120 } = opts;
  const r = await fetchApi(`${API}/videos?offset=${offset}&limit=${limit}&subfolder=${encodeURIComponent(subfolder || "")}`);
  if (!r.ok) return { videos: [] };
  return r.json();
}

export function clipViewUrl(filename: string, subfolder?: string) {
  return `${BASE}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder || "")}&type=output`;
}

export function thumbUrl(filename: string, subfolder?: string) {
  return `${BASE}${API}/thumb?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder || "")}`;
}

export async function revealOutputFolder(subfolder?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetchApi(`${API}/reveal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subfolder: subfolder || SUBFOLDER }) });
    if (r.status === 404) return { ok: false, error: "restart ComfyUI to enable this" };
    return await r.json();
  } catch (e: any) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteVideo(filename: string, subfolder?: string): Promise<{ ok: boolean; error?: string }> {
  const r = await fetchApi(`${API}/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename, subfolder: subfolder || "" }) });
  return r.json();
}

const CLIENT_ID = (() => {
  try {
    return crypto.randomUUID();
  } catch {
    return String(Math.random()).slice(2);
  }
})();

/**
 * Submits a small graph straight to /prompt and polls /history (no websocket needed —
 * polling is simpler than wiring up the progress socket this early). These native
 * Text/Image→Brief graphs run an actual local LLM model load + token generation, which can
 * genuinely take a couple minutes on a slow/large model (confirmed live: a real run logged
 * "Prompt executed in 129.19 seconds", just over the old 120s timeout, causing a false
 * "timed out waiting for ComfyUI" even though generation had already finished successfully) —
 * Some local models run even longer than that, so this is generous (20 min) rather than tight —
 * pair it with the Stop button (interrupt()) in promptEdit.ts rather than trying to guess a
 * "safe" ceiling, since a genuinely stuck run should be cancelled by the user, not by a timer.
 */
async function submitGraph(promptGraph: Record<string, any>, timeoutMs = 1_200_000): Promise<Record<string, any>> {
  const resp = await fetchApi("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: promptGraph, client_id: CLIENT_ID }),
  });
  const data = await resp.json();
  if (data.error) {
    const detail = data.node_errors ? ` (${Object.keys(data.node_errors).join(", ")})` : "";
    throw new Error((data.error.message || "queue failed") + detail);
  }
  const promptId = data.prompt_id as string;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 700));
    const h = await fetchApi(`/history/${promptId}`);
    const hd = await h.json();
    const entry = hd[promptId];
    if (!entry) continue;
    if (entry.status?.completed) return entry.outputs || {};
    if (entry.status?.status_str === "error") throw new Error("native generation failed");
  }
  throw new Error("timed out waiting for ComfyUI");
}

/** Native Image → Brief analysis — batches images through one CLIP call, no Ollama. */
export async function analyzeImagesNative(clipName: string, images: string[], promptText: string): Promise<string> {
  const g = {
    clip: { class_type: "CLIPLoader", inputs: { clip_name: clipName, type: "minimax", device: "default" } },
    batch: {
      class_type: "TJ_MultiImageLoader",
      inputs: {
        image_paths_json: JSON.stringify(images),
        auto_set: true,
        match_mode: "Megapixel",
        resize_input: "none",
        edge_size: 1024,
        custom_width: 1024,
        custom_height: 1536,
        megapixel: 1.0,
        interpolation: "lanczos",
        scale_method: "Center Crop",
        batch_select: "",
      },
    },
    gen: {
      class_type: "TextGenerate",
      inputs: {
        clip: ["clip", 0],
        prompt: promptText,
        image: ["batch", 0],
        max_length: 1024,
        sampling_mode: "on",
        "sampling_mode.temperature": 0.7,
        "sampling_mode.top_k": 64,
        "sampling_mode.top_p": 0.95,
        "sampling_mode.min_p": 0.05,
        "sampling_mode.repetition_penalty": 1.05,
        "sampling_mode.seed": 0,
        thinking: false,
        use_default_template: true,
      },
    },
    out: { class_type: "TJStudioOneTextOutput", inputs: { text: ["gen", 0] } },
  };
  const outputs = await submitGraph(g);
  const text = outputs?.out?.text?.[0];
  if (!text) throw new Error("native analysis produced no text");
  return text;
}

/** Native brief writing — text-only counterpart to analyzeImagesNative(). */
export async function writeBriefNative(clipName: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const g = {
    clip: { class_type: "CLIPLoader", inputs: { clip_name: clipName, type: "minimax", device: "default" } },
    gen: {
      class_type: "TextGenerate",
      inputs: {
        clip: ["clip", 0],
        prompt: `${systemPrompt}\n\n${userPrompt}`,
        max_length: 2048,
        sampling_mode: "on",
        "sampling_mode.temperature": 0.7,
        "sampling_mode.top_k": 64,
        "sampling_mode.top_p": 0.95,
        "sampling_mode.min_p": 0.05,
        "sampling_mode.repetition_penalty": 1.05,
        "sampling_mode.seed": 0,
        thinking: false,
        use_default_template: true,
      },
    },
    out: { class_type: "TJStudioOneTextOutput", inputs: { text: ["gen", 0] } },
  };
  const outputs = await submitGraph(g);
  const text = outputs?.out?.text?.[0];
  if (!text) throw new Error("native brief-writing produced no text");
  return text;
}
