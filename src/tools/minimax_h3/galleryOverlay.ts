// galleryOverlay.ts — MiniMax H3 클립 갤러리 + 풀스크린 플레이어 (원본: web/minimax/ui_gallery_minimax.js)
// 결과가 비디오라서 공용 shared/gallery.ts(정적 이미지 그리드)로는 부족한 기능들 —
// 썸네일 지연로딩, 호버 미리재생, 더블클릭 풀스크린, 프롬프트 표시/Reuse/Copy, 삭제,
// 스티치 — 을 전부 이 도구 전용 오버레이로 이식했다.
import type { MinimaxState } from "./core";
import { SUBFOLDER, FPS, UPSCALE_MODES, framesToSeconds, composeStitchedPrompt } from "./core";
import { button, el, clear, confirmDialog, alertDialog, select, numberField } from "../../shared/ui";
import { C, BRAND } from "../../identity";
import {
  analyzeImagesNative,
  clipViewUrl,
  copyOutputToInput,
  deleteVideo,
  discardInputCopy,
  getClipLastFrame,
  getMediaFiles,
  getModels,
  getSystemPrompt,
  getVideoInfo,
  listVideos,
  revealOutputFolder,
  saveMeta,
  stitchClips,
  thumbUrl,
  viewUrl,
  writeBriefNative,
  type GalleryVideo,
} from "./api";
import { queuePrompt, type QueueResult } from "./comfyClient";
import { buildInterpolateGraph, buildUpscaleGraph } from "./graphBuilder";
import { keepTabAlive } from "../../shared/tabKeepAlive";

// A single-shot post-process (upscale/deblur/interpolate) queues its ComfyUI job, then does the
// meta write + cleanup client-side. If the tab is reloaded or iOS-discarded in between, the job
// still finishes server-side but the result lands bare. Stash the job on queue so the next
// gallery open can reattach (queuePrompt existingPromptId → /history), finish it, and clean up.
// Chunked jobs aren't covered — the loop can't resume, the warning line covers that case.
const POST_JOB_KEY = "aos_mmh3_post_job";
// SPEC_MINIMAX_H3_INLINE_POSTPROCESS_META.md §4 — the structured record of which stages a
// post-process pass ran. Same field shapes buildClipGraph writes for an inline pass, so the
// card badges / Reuse / info tooltip read one field set whichever path produced the file.
interface PostInfo {
  deblur?: string;
  upscale?: { method: "model"; model: string } | { method: "rtx"; scale: number; quality: string } | null;
  interpolate?: { targetFps: number };
}
interface PostJob {
  promptId: string;
  saveNode: string;
  source: string;
  sourceMeta: any;
  label: string;
  outFolder: string;
  copied: string;
  savedAt: number;
  postInfo?: PostInfo;
}
// A human `postProcess` label that names every stage that ran, so a combined deblur→upscale
// pass no longer reads as just "upscale". Falls back to the bare label lower-cased.
function postLabel(fallback: string, info: PostInfo = {}): string {
  const parts: string[] = [];
  if (info.deblur && info.deblur !== "none") parts.push("deblur");
  if (info.upscale) parts.push(info.upscale.method === "rtx" ? "rtx upscale" : "upscale");
  if (info.interpolate) parts.push("interpolation");
  return parts.length ? parts.join(" + ") : String(fallback).toLowerCase();
}
function savePostJob(j: PostJob) { try { localStorage.setItem(POST_JOB_KEY, JSON.stringify(j)); } catch {} }
function loadPostJob(): PostJob | null { try { const s = localStorage.getItem(POST_JOB_KEY); return s ? JSON.parse(s) : null; } catch { return null; } }
function clearPostJob() { try { localStorage.removeItem(POST_JOB_KEY); } catch {} }

const STITCH_MAX = 10;
const IS_TOUCH_DEVICE = typeof window !== "undefined" && ("ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0);

function fmtSize(bytes?: number) {
  if (!bytes) return "";
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`;
}
function fmtWhen(mtime?: number) {
  try {
    return mtime ? new Date(mtime * 1000).toLocaleString() : "";
  } catch {
    return "";
  }
}
function fmtElapsed(sec?: number) {
  if (sec == null) return "";
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
function metaInfoLines(meta: any): string[] {
  if (!meta) return ["No settings saved for this clip."];
  const lines: string[] = [];
  // Gallery post-process writes `postProcess`; an inline generation-time pass writes only the
  // structured deblur/upscale keys — synthesize a label from those.
  const ppLabel = meta.postProcess || [
    meta.deblur && meta.deblur !== "none" ? "deblur" : null,
    meta.upscale ? (meta.upscale.method === "rtx" ? "rtx upscale" : "upscale") : null,
    meta.interpolate ? "interpolation" : null,
  ].filter(Boolean).join(" + ");
  if (ppLabel) {
    const from = meta.sourceW && meta.sourceH ? ` (from ${meta.sourceW}×${meta.sourceH})` : "";
    lines.push(`⚙ ${ppLabel}${from}`);
  }
  if (meta.w && meta.h) lines.push(`${meta.w}×${meta.h}`);
  if (meta.frames != null) lines.push(`${meta.frames} frames${meta.fps ? ` @ ${Math.round(meta.fps)}fps` : ""}`);
  if (meta.steps != null) lines.push(`${meta.steps} steps`);
  if (meta.sampler) lines.push(String(meta.sampler));
  if (meta.accel) lines.push(`accel: ${meta.accel}`);
  if (meta.elapsedSec != null) lines.push(`⏱ ${fmtElapsed(meta.elapsedSec)}`);
  if (meta.seed != null) lines.push(`seed: ${meta.seed}`);
  if (meta.accel === "turbo" && meta.turboLora) {
    lines.push(`turbo LoRA: ${meta.turboLora} (${meta.turboLoraStrength ?? 1})${meta.turboLoraLowVram ? " · low VRAM" : ""}`);
  }
  const loras = Array.isArray(meta.loras) ? meta.loras.filter((l: any) => l && l.name && l.name !== "none") : [];
  if (loras.length) {
    lines.push("LoRA:");
    for (const l of loras) lines.push(`  ${l.enabled === false ? "○" : "●"} ${l.name} (${l.strength ?? 1})`);
  }
  return lines.length ? lines : ["No settings saved for this clip."];
}

export interface GalleryOverlayCtx {
  showPopup: (msg: string, isError?: boolean) => void;
  reusePrompt?: (meta: any) => boolean;
  availability?: Record<string, boolean>;
  // SPEC_MINIMAX_H3_CONTINUE_AND_EXTEND.md §3 — render one continuation clip from a finished
  // clip's last frame and auto-stitch [source, continuation]. Fire-and-forget (it's async).
  runExtend?: (opts: { sourceClip: any; seedFrame: string; prompt: string; sourcePrompt: string }) => void;
}

export interface GalleryOverlayHandle {
  el: HTMLElement;
  playerEl: HTMLElement;
  show(): void;
  hide(): void;
  isOpen(): boolean;
  isPlaying(): boolean;
  destroy(): void;
}

export function createGalleryOverlay(state: MinimaxState, ctx: GalleryOverlayCtx): GalleryOverlayHandle {
  const ov = el("div", {
    class: "fixed inset-0 z-[9998] flex-col p-3 gap-2 box-border",
    style: { display: "none", background: "rgba(11,11,11,0.985)" },
  });

  let videos: GalleryVideo[] = [];
  let filterFull = false;

  // ── delete confirm ──────────────────────────────────────────────────────
  const deleteConfirmOv = el("div", { class: "hidden fixed inset-0 z-[99999] items-center justify-center", style: { display: "none", background: "rgba(0,0,0,0.55)" } });
  const deleteConfirmBox = el("div", { class: "flex flex-col gap-2.5", style: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "18px 20px", width: "320px", boxSizing: "border-box", boxShadow: "0 8px 30px rgba(0,0,0,0.5)" } });
  deleteConfirmBox.append(
    el("div", { text: "Delete this clip?", class: "text-white text-[13px] font-bold" }),
    el("div", { id: "mmh3-del-name", class: "text-[11px] leading-relaxed break-all", style: { color: C.muted } }),
    el("div", { text: "This can't be undone.", class: "text-[11.5px] leading-relaxed", style: { color: C.muted } })
  );
  const deleteConfirmName = deleteConfirmBox.children[1] as HTMLElement;
  const deleteBtnRow = el("div", { class: "flex justify-end gap-2 mt-1" });
  const deleteCancelBtn = el("button", { type: "button", text: "Cancel", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11.5px", padding: "6px 14px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` } });
  const deleteConfirmBtn = button("Delete", () => runDelete(), "danger");
  function cancelDelete() {
    deleteConfirmOv.style.display = "none";
    pendingDelete = null;
  }
  deleteCancelBtn.addEventListener("click", cancelDelete);
  deleteBtnRow.append(deleteCancelBtn, deleteConfirmBtn);
  deleteConfirmBox.appendChild(deleteBtnRow);
  deleteConfirmOv.appendChild(deleteConfirmBox);
  deleteConfirmOv.addEventListener("click", (e) => { if (e.target === deleteConfirmOv) cancelDelete(); });
  document.body.appendChild(deleteConfirmOv);

  const onDeleteConfirmKey = (e: KeyboardEvent) => {
    if (deleteConfirmOv.style.display === "none") return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelDelete(); }
    else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); runDelete(); }
  };
  document.addEventListener("keydown", onDeleteConfirmKey, true);

  let pendingDelete: { filename: string; subfolder: string } | null = null;
  function askDelete(v: GalleryVideo) {
    pendingDelete = { filename: v.filename, subfolder: v.subfolder || "" };
    deleteConfirmName.textContent = v.filename;
    deleteConfirmOv.style.display = "flex";
  }
  async function runDelete() {
    if (!pendingDelete) return;
    const { filename, subfolder } = pendingDelete;
    deleteConfirmBtn.setAttribute("disabled", "true");
    try {
      const d = await deleteVideo(filename, subfolder);
      if (!d.ok) throw new Error(d.error || "delete failed");
      deleteConfirmOv.style.display = "none";
      pendingDelete = null;
      await refresh();
    } catch (e: any) {
      ctx.showPopup(`Delete failed: ${e.message || e}`, true);
    } finally {
      deleteConfirmBtn.removeAttribute("disabled");
    }
  }

  // ── header ──────────────────────────────────────────────────────────────
  const hdr = el("div", { class: "aos-gallery-hdr flex items-center gap-2 shrink-0" });
  hdr.appendChild(el("div", { text: "🖼 Gallery", class: "text-white text-sm font-bold" }));
  const countTag = el("div", { class: "text-[10.5px] flex-1", style: { color: C.muted } });
  hdr.appendChild(countTag);

  function toolBtn(text: string, title?: string) {
    return el("button", { type: "button", text, title, style: { cursor: "pointer", fontFamily: "inherit", fontSize: "10.5px", padding: "5px 11px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` } });
  }
  // 카드마다 좌상단 체크박스로 여러 개 선택해서 한 번에 삭제.
  const selectedKeys = new Set<string>();
  const deleteSelBtn = el("button", {
    type: "button", text: "🗑 Delete Selection", title: "Delete the checked clips",
    style: { cursor: "pointer", fontFamily: "inherit", fontSize: "10.5px", padding: "5px 11px", borderRadius: "6px", background: C.bg2, color: C.err, border: `1px solid ${C.border}`, opacity: "0.5" },
  }) as HTMLButtonElement;
  deleteSelBtn.disabled = true;
  function refreshDeleteSelBtn() {
    const n = selectedKeys.size;
    deleteSelBtn.textContent = n ? `🗑 Delete Selection (${n})` : "🗑 Delete Selection";
    deleteSelBtn.disabled = n === 0;
    deleteSelBtn.style.opacity = n === 0 ? "0.5" : "1";
  }
  deleteSelBtn.addEventListener("click", async () => {
    const picked = [...selectedKeys].map((k) => videos.find((v) => vKey(v) === k)).filter(Boolean) as GalleryVideo[];
    if (!picked.length) return;
    if (!(await confirmDialog(`Delete ${picked.length} selected clip(s)? This can't be undone.`))) return;
    deleteSelBtn.disabled = true;
    let failed = 0;
    for (const v of picked) {
      try {
        const d = await deleteVideo(v.filename, v.subfolder || "");
        if (!d.ok) failed++;
      } catch {
        failed++;
      }
    }
    selectedKeys.clear();
    refreshDeleteSelBtn();
    await refresh();
    if (failed) ctx.showPopup(`${failed} failed to delete`, true);
    else ctx.showPopup(`Deleted ${picked.length} clip(s).`, false);
  });

  const fullBtn = toolBtn("★ stitched only");
  fullBtn.addEventListener("click", () => {
    filterFull = !filterFull;
    fullBtn.style.background = filterFull ? BRAND : C.bg2;
    fullBtn.style.borderColor = filterFull ? BRAND : C.border;
    renderGrid();
  });
  const refreshBtn = toolBtn("↻", "Refresh");
  refreshBtn.addEventListener("click", () => refresh());
  const folderBtn = toolBtn("📂 Open folder");
  folderBtn.addEventListener("click", async () => {
    const r = await revealOutputFolder(state.saveSubfolder || SUBFOLDER);
    if (!r.ok) ctx.showPopup(`Could not open the folder: ${r.error || "unknown"}`, true);
  });

  let mode: null | "stitch" | "upscale" | "rife" = null;
  let stitchOrder: string[] = [];
  let postPick: string | null = null;
  let postRunning = false;
  const vKey = (v: GalleryVideo) => `${v.subfolder || ""}|${v.filename}`;

  const stitchBtn = toolBtn("🔗 Stitch", "Pick clips in order, then combine into one file");
  const upscaleBtn = toolBtn("⬆ Upscale", "Upscale a single clip");
  const interpBtn = toolBtn("🎞 Interpolate", "Smooth a single clip with frame interpolation");

  // The three modes take over what a click on a grid card means, so only one can be armed at
  // a time. render:false is used by hide() — the grid was just emptied to stop hover videos,
  // and re-rendering here would put them back.
  function setMode(m: typeof mode, doRender = true) {
    mode = m;
    stitchOrder = [];
    postPick = null;
    oneTakeUserSet = false;
    selectedKeys.clear();
    refreshDeleteSelBtn();
    stitchBtn.style.background = mode === "stitch" ? BRAND : C.bg2;
    stitchBtn.style.borderColor = mode === "stitch" ? BRAND : C.border;
    stitchBar.style.display = mode === "stitch" ? "flex" : "none";
    audioOverrideBar.style.display = mode === "stitch" ? "flex" : "none";
    upscaleBtn.style.background = mode === "upscale" ? BRAND : C.bg2;
    upscaleBtn.style.borderColor = mode === "upscale" ? BRAND : C.border;
    upscaleBar.style.display = mode === "upscale" ? "flex" : "none";
    interpBtn.style.background = mode === "rife" ? BRAND : C.bg2;
    interpBtn.style.borderColor = mode === "rife" ? BRAND : C.border;
    interpBar.style.display = mode === "rife" ? "flex" : "none";
    if (doRender) renderGrid();
  }
  stitchBtn.addEventListener("click", () => { if (!postRunning) setMode(mode === "stitch" ? null : "stitch"); });
  upscaleBtn.addEventListener("click", () => { if (!postRunning) { rebuildUpscaleModels(); setMode(mode === "upscale" ? null : "upscale"); } });
  interpBtn.addEventListener("click", () => { if (!postRunning) setMode(mode === "rife" ? null : "rife"); });
  hdr.append(deleteSelBtn, fullBtn, stitchBtn, upscaleBtn, interpBtn, refreshBtn, folderBtn, button("✕ Close", () => hide(), "danger"));

  const stitchBar = el("div", { class: "hidden items-center gap-2 shrink-0 rounded-lg", style: { background: C.bg1, border: `1px solid ${BRAND}`, padding: "7px 10px" } });
  const stitchInfo = el("div", { class: "flex-1 text-[10.5px]", style: { color: C.text } });
  const stitchClearBtn = el("button", { type: "button", text: "✕ Clear", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "10.5px", padding: "5px 10px", borderRadius: "6px", background: C.bg2, color: C.muted, border: `1px solid ${C.border}` } });
  stitchClearBtn.addEventListener("click", () => { stitchOrder = []; oneTakeUserSet = false; renderGrid(); });

  const oneTakeLabel = el("label", { class: "flex items-center gap-1.5 text-[10.5px] cursor-pointer", style: { color: C.text } });
  const oneTakeCb = el("input", { type: "checkbox" }) as HTMLInputElement;
  oneTakeCb.style.cursor = "pointer";
  let oneTakeUserSet = false;
  oneTakeCb.addEventListener("change", () => { oneTakeUserSet = true; refreshStitchBar(); });
  oneTakeLabel.append(oneTakeCb, el("span", { text: "One-Take (trim overlap)" }));

  // The auto-stitch at run-finish always trims exactly the 39-frame carried-latent overlap
  // (ONE_TAKE_OVERLAP_FRAMES) — kept as-is there so a bad automatic result can still be
  // re-stitched by hand. Manual gallery re-stitch gets its own editable frame count instead:
  // the One-Take seam has a real color-flicker artifact at the splice point (frames 39-42 of
  // every continued clip — see SPEC_H3_LATENT_CONTINUATION_SEAM.md in the TJ_NODE repo for the
  // root-cause writeup), so trimming a few frames past the raw overlap cuts the bad frames out
  // of the combined output. Default 43 = 39 overlap + 4 frames of guard. Not run through
  // alignFrameCount() — that's for generation-time latent/frame-count alignment, unrelated to
  // this post-hoc video trim.
  let stitchTrimFrames = 43;
  const trimFrameInput = numberField(stitchTrimFrames, (v) => { stitchTrimFrames = Math.max(0, Math.round(v)); refreshStitchBar(); }, 1);
  (trimFrameInput as HTMLElement).style.width = "56px";
  const trimFrameWrap = el("div", { class: "flex items-center gap-1.5 text-[10.5px]", style: { color: C.muted } }, [el("span", { text: "trim frames" }), trimFrameInput]);

  const stitchGoBtn = button("🔗 Combine", () => runStitch(), "primary");
  stitchBar.append(stitchInfo, oneTakeLabel, trimFrameWrap, stitchClearBtn, stitchGoBtn);

  // 스티치 결과의 오디오를 클립 각각에 구워진 생성 오디오 대신 별도 음원 파일로 통째로
  // 교체하는 옵션 — MiniMax H3 One-Take의 "Audio Lock 원본으로 교체" 옵션과 같은 기능을
  // 갤러리에서 임의로 고른 클립들 스티치에도 그대로 쓸 수 있게 한 것.
  let audioOverrideOn = false;
  let audioOverrideFile = "";
  let audioOverrideStart = 0;
  let audioFilesCache: string[] | undefined;

  const audioOverrideBar = el("div", { class: "hidden items-center gap-2 shrink-0 rounded-lg flex-wrap", style: { display: "none", background: C.bg1, border: `1px solid ${C.border}`, padding: "7px 10px" } });
  const audioOverrideLabel = el("label", { class: "flex items-center gap-1.5 text-[10.5px] cursor-pointer", style: { color: C.text } });
  const audioOverrideCb = el("input", { type: "checkbox" }) as HTMLInputElement;
  audioOverrideCb.style.cursor = "pointer";
  audioOverrideLabel.append(audioOverrideCb, el("span", { text: "🎵 Replace audio with:" }));
  const audioSelectWrap = el("div", { style: { minWidth: "180px" } });
  const startField = numberField(0, (v) => { audioOverrideStart = Math.max(0, v); }, 0.1);
  const startFieldWrap = el("div", { class: "flex items-center gap-1.5 text-[10.5px]", style: { color: C.muted } }, [el("span", { text: "start(s)" }), startField]);
  audioOverrideBar.append(audioOverrideLabel, audioSelectWrap, startFieldWrap);

  function renderAudioSelect() {
    clear(audioSelectWrap);
    const files = audioFilesCache || [];
    const opts = ["", ...files].map((f) => ({ value: f, label: f || (audioFilesCache ? "— pick a file —" : "loading…") }));
    const sel = select(opts, audioOverrideFile, (v) => { audioOverrideFile = v; });
    (sel as HTMLElement).style.fontSize = "10.5px";
    audioSelectWrap.appendChild(sel);
  }
  renderAudioSelect();

  audioOverrideCb.addEventListener("change", () => {
    audioOverrideOn = audioOverrideCb.checked;
    if (audioOverrideOn && audioFilesCache === undefined) {
      getMediaFiles()
        .then((d) => { audioFilesCache = d.audios || []; renderAudioSelect(); })
        .catch(() => { audioFilesCache = []; renderAudioSelect(); });
    }
  });

  function refreshStitchBar() {
    const picked = stitchOrder.map((k) => videos.find((v) => vKey(v) === k)).filter(Boolean) as GalleryVideo[];
    const known = picked.map((v) => ((v as any).meta?.frames ? framesToSeconds((v as any).meta.frames) : null));
    const total = known.every((s) => s != null) ? known.reduce((a, b) => a! + b!, 0) : null;
    const sizes = new Set(picked.map((v) => `${(v as any).meta?.w || "?"}x${(v as any).meta?.h || "?"}`));

    if (!oneTakeUserSet) oneTakeCb.checked = picked.length > 0 && picked.every((v) => (v as any).meta?.onetake === true);

    let text = `${picked.length} / ${STITCH_MAX} selected`;
    if (picked.length >= STITCH_MAX) text += " · longer edits need a real video editor";
    if (total != null) {
      const trimmed = oneTakeCb.checked && picked.length > 1 ? total! - (picked.length - 1) * framesToSeconds(stitchTrimFrames) : total!;
      text += ` · ≈${trimmed.toFixed(2)}s`;
    }
    if (sizes.size > 1) text += ` · ⚠ mixed resolution (${[...sizes].join(", ")}) — stitch may fail or look off`;
    stitchInfo.textContent = text;
    stitchGoBtn.disabled = picked.length < 2;
    stitchGoBtn.style.opacity = picked.length < 2 ? "0.5" : "1";
  }

  async function runStitch() {
    const picked = stitchOrder.map((k) => videos.find((v) => vKey(v) === k)).filter(Boolean) as GalleryVideo[];
    if (picked.length < 2) return;
    stitchGoBtn.disabled = true;
    keepTabAlive(true);
    const overlapSec = oneTakeCb.checked ? framesToSeconds(stitchTrimFrames) : null;
    stitchInfo.textContent = `Stitching ${picked.length} clips${overlapSec ? ` (One-Take, ${overlapSec.toFixed(3)}s overlap trimmed)` : ""}… 창을 닫거나 탭을 이동하지 마세요.`;
    try {
      const folder = (state.saveSubfolder || SUBFOLDER).replace(/\\/g, "/");
      const audioOverride = audioOverrideOn && audioOverrideFile ? { filename: audioOverrideFile, start: audioOverrideStart } : null;
      const out = await stitchClips(picked.map((v) => ({ filename: v.filename, subfolder: v.subfolder || "" })), `${folder}/${state.filenamePrefix || "MMH3"}_full`, null, overlapSec, audioOverride);
      const known = picked.map((v) => ((v as any).meta?.frames ? framesToSeconds((v as any).meta.frames) : null));
      const rawTotal = known.every((s) => s != null) ? known.reduce((a, b) => a! + b!, 0) : null;
      const durationSeconds = rawTotal != null && overlapSec ? rawTotal! - (picked.length - 1) * overlapSec : rawTotal;
      // SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §5 — copy the first clip's meta as the base (pipeline
      // settings are normally the same across one run's clips) so a manual gallery stitch is just
      // as self-describing as the auto-stitch-at-run-end path; only the prompt/clip-count fields
      // get rebuilt. [Clip N] markers via composeStitchedPrompt so the joined prompt says where
      // one shot ends and the next begins — a blank line alone doesn't survive a later Reuse or a
      // human re-reading the sidecar.
      const baseMeta = (picked[0] as any).meta || {};
      await saveMeta(out.filename, out.subfolder || "", {
        ...baseMeta,
        v: 1, prompt: composeStitchedPrompt(picked.map((v) => (v as any).prompt || "")),
        clips: picked.length, stitched: true, onetake: !!overlapSec, node: "minimax_h3", created: Date.now(), durationSeconds,
        prompts: picked.map((v) => (v as any).prompt || ""),
      });
      ctx.showPopup(`Stitched ${picked.length} clips → ${out.filename}`, false);
      stitchOrder = [];
      oneTakeUserSet = false;
      await refresh();
    } catch (e: any) {
      ctx.showPopup(`Stitch failed: ${e.message || e}`, true);
      refreshStitchBar();
    } finally {
      keepTabAlive(false);
    }
  }

  // ── shared progress readout for Upscale/Interpolate bars ────────────────
  function makeProgressReadout() {
    const wrap = el("div", { class: "flex flex-col gap-1 flex-1", style: { display: "none" } });
    const bar = el("div", { class: "flex items-center gap-2" });
    const label = el("div", { class: "text-[10.5px]", style: { color: C.muted, minWidth: "90px" } });
    const track = el("div", { class: "flex-1 rounded-full overflow-hidden", style: { height: "6px", background: C.bg2 } });
    const fill = el("div", { class: "h-full rounded-full", style: { width: "0%", background: BRAND, transition: "width 0.15s" } });
    track.appendChild(fill);
    bar.append(label, track);
    // Post-process runs client-side: the ComfyUI job survives a reload but the result's
    // metadata + cleanup do not, and a chunked job's remaining chunks are never queued.
    // iOS Safari reloads a backgrounded tab within ~30-60s, so this warning matters most there.
    const warn = el("div", {
      text: "진행 중입니다. 창을 닫거나 다른 앱/탭으로 전환하면 진행이 멈출 수 있으니 그대로 기다려 주세요. 모델 업스케일은 수 분 이상 걸릴 수 있습니다.",
      class: "text-[9.5px]", style: { color: C.warn, lineHeight: "1.45" },
    });
    wrap.append(bar, warn);
    return {
      wrap,
      start(msg: string) { wrap.style.display = "flex"; label.textContent = msg; fill.style.width = "0%"; },
      progress(v: number, m: number) { label.textContent = m ? `${Math.round((v / m) * 100)}%` : "working…"; fill.style.width = m ? `${Math.min(100, (v / m) * 100)}%` : "0%"; },
      // Overall progress across a chunked job (§16): chunk index plus how far the current
      // chunk's own step got, so the bar advances smoothly instead of resetting to 0% at
      // every chunk boundary.
      chunkStep(idx: number, count: number, v: number, m: number) {
        wrap.style.display = "flex";
        const within = m ? v / m : 0;
        const pct = Math.max(0, Math.min(100, ((idx + within) / count) * 100));
        fill.style.width = `${pct.toFixed(1)}%`;
        label.textContent = count > 1 ? `chunk ${idx + 1}/${count} · ${Math.round(within * 100)}% (${Math.round(pct)}% overall)` : `${Math.round(pct)}% · ${v} / ${m}`;
      },
      // Label-only update — no change to the fill. Used for the "still working" heartbeat while
      // the WS is quiet on mobile and only the /history poll is reporting.
      note(msg: string) { wrap.style.display = "flex"; label.textContent = msg; },
      done() { wrap.style.display = "none"; },
      fail(msg: string) { label.textContent = `✕ ${msg}`; fill.style.width = "0%"; },
    };
  }

  function findPost(): GalleryVideo | null {
    if (!postPick) return null;
    return videos.find((v) => vKey(v) === postPick) || null;
  }

  // Run wrapper shared by Upscale/Interpolate: copy the source clip into ComfyUI's input/
  // (VHS_LoadVideo only lists input/), queue the graph, refresh the grid on success, and — in
  // finally, success and failure alike — delete the input copy so it doesn't accumulate (same
  // leak SPEC_MINIMAX_H3_TEMP_FILE_CLEANUP.md fixed for the main relay).
  // Every requested frame gets materialized as a float32 RGBA array by VHS_LoadVideo before
  // any node touches it, so asking for a whole long/high-res clip in one shot can exceed
  // available RAM — a "★ stitched" full run easily runs into the thousands of frames. The
  // budget is per-chunk RAM, not resolution, so it scales the chunk length down automatically
  // for a bigger frame: a 1088x736 clip and a 4K one both stay under roughly the same
  // footprint per chunk (SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §16).
  const CHUNK_BUDGET_BYTES = 1.25 * 1024 ** 3;
  const CHUNK_MIN_FRAMES = 8;
  const CHUNK_MAX_FRAMES = 240;

  // Per-method chunk policy for Upscale/Deblur (user rule, 2026-09-01). Returns chunk length
  // in seconds; 0 = run the whole file in one shot. RTX VSR and the RTX-based deblur run
  // single-shot below 15s and slice into 15s chunks at/above it; the upscale-model path is
  // heavier, so it slices into 5s chunks once the clip is 10s or longer. Overrides the
  // byte-budget sizing below when supplied.
  function upscaleChunkSeconds(method: "rtx" | "model" | "none", durationSec: number): number {
    if (method === "model") return durationSec >= 10 ? 5 : 0;
    return durationSec >= 15 ? 15 : 0; // rtx, or deblur-only — both RTX-based
  }

  type ChunkOpts = { folder?: string; skipFirstFrames?: number; frameLoadCap?: number; saveSuffix?: string };

  /** Shared run wrapper: copy the source into input/, queue the graph (chunked if the source
   * is long or large enough to risk exhausting RAM), reload the grid.
   *
   * `buildFn(inputFile, stem, chunkOpts)` returns `{ graph, saveNode }`; chunkOpts is `{}` for
   * a plain single-shot job, or carries the chunk slice when chunking — both graph builders
   * default those fields to their old whole-file behavior, so a caller that ignores chunkOpts
   * still works unchanged. */
  async function runPost(
    v: GalleryVideo,
    buildFn: (inputFilename: string, stem: string, chunkOpts: ChunkOpts) => { graph: Record<string, any>; saveNode: string },
    readout: ReturnType<typeof makeProgressReadout>,
    runBtn: HTMLButtonElement,
    label: string,
    finalSuffix: string,
    /** Chunk length in seconds for this run; 0 = whole file. When given, overrides the
     *  byte-budget sizing (Upscale/Deblur pass a per-method rule — see upscaleChunkSeconds). */
    chunkPlan?: (durationSec: number) => number,
    /** Which stages this pass ran — recorded on the output's meta (SPEC §4). */
    postInfo: PostInfo = {},
  ) {
    postRunning = true;
    runBtn.disabled = true;
    keepTabAlive(true); // silent-audio loop — stops desktop browsers discarding the tab mid-job
    readout.start(`Preparing ${v.filename}…`);
    let copied: string | null = null;
    const chunkFiles: { filename: string; subfolder: string }[] = [];
    try {
      // VHS_LoadVideo only lists ComfyUI's input folder, so the finished mp4 has to be copied
      // there first — copy_to_input is format-agnostic, it just moves bytes.
      copied = await copyOutputToInput(v.filename, v.subfolder || "", "output");
      const stem = v.filename.replace(/\.[^.]+$/, "");
      const outFolder = state.saveSubfolder || SUBFOLDER;

      // Chunk sizing. If video_info can't be read (ffprobe missing, odd container), fall back
      // to a single whole-file job rather than failing outright — that's exactly the old
      // behavior, so short clips are unaffected either way.
      let chunkFrames = 0, totalFrames = 0;
      try {
        const info = await getVideoInfo(copied, "", "input");
        totalFrames = info.frames || 0;
        const fps = info.fps || FPS;
        if (chunkPlan) {
          const durationSec = info.duration || (totalFrames ? totalFrames / fps : 0);
          const secs = chunkPlan(durationSec);
          chunkFrames = secs > 0 ? Math.max(1, Math.round(secs * fps)) : (totalFrames || 1);
        } else {
          const perFrameBytes = Math.max(1, (info.width || 0) * (info.height || 0) * 16);
          chunkFrames = Math.max(CHUNK_MIN_FRAMES, Math.min(CHUNK_MAX_FRAMES, Math.floor(CHUNK_BUDGET_BYTES / perFrameBytes)));
        }
      } catch { /* chunkCount defaults to 1 below */ }
      const chunkCount = totalFrames > 0 && chunkFrames > 0 ? Math.max(1, Math.ceil(totalFrames / chunkFrames)) : 1;

      let outFile: { filename: string; subfolder: string } | null = null;
      if (chunkCount === 1) {
        const { graph, saveNode } = buildFn(copied, stem, {});
        readout.start(`${label}…`);
        const cap = copied;
        const res = await queuePrompt(graph, {
          onProgress: (val, max) => readout.chunkStep(0, 1, val, max),
          onPoll: () => readout.note(`${label} · still working (connection quiet)…`),
          onQueued: (pid) => savePostJob({ promptId: pid, saveNode, source: v.filename, sourceMeta: (v as any).meta ?? null, label, outFolder, copied: cap, savedAt: Date.now(), postInfo }),
        });
        outFile = await finishPost(res, saveNode, v.filename, (v as any).meta, label, outFolder, postInfo);
      } else {
        // Same VHS_LoadVideo source, sliced by skip_first_frames/frame_load_cap — audio slices
        // the same way (VHS derives its start/duration from those two fields), so each chunk's
        // own soundtrack lines up with its frames. Chunks land in a scratch subfolder and get
        // stream-copy concatenated afterward, then deleted (success and failure alike).
        const chunkSub = `${outFolder}/._post_chunks`;
        for (let i = 0; i < chunkCount; i++) {
          const skip = i * chunkFrames;
          const cap = Math.min(chunkFrames, totalFrames - skip);
          const { graph, saveNode } = buildFn(copied, `${stem}_c${String(i).padStart(3, "0")}`, { folder: chunkSub, skipFirstFrames: skip, frameLoadCap: cap, saveSuffix: "" });
          readout.start(`${label} — preparing chunk ${i + 1}/${chunkCount}…`);
          const res = await queuePrompt(graph, {
            onProgress: (val, max) => readout.chunkStep(i, chunkCount, val, max),
            onPoll: () => readout.note(`${label} · chunk ${i + 1}/${chunkCount} · still working (connection quiet)…`),
          });
          const out = res.byNode?.[saveNode];
          const o = (out?.images || out?.gifs || [])[0];
          if (!o) throw new Error(`chunk ${i + 1}/${chunkCount} produced no output`);
          chunkFiles.push({ filename: o.filename, subfolder: o.subfolder || chunkSub });
        }
        readout.start(`${label} — joining ${chunkCount} chunks…`);
        // Every chunk shares the same codec, resolution, and fps, so this is a plain stream-copy
        // concat (overlap/trim both 0) — no re-encode, no quality loss.
        // The suffix a non-chunked single-shot call would have used — otherwise a chunked
        // upscale/deblur's final file is indistinguishable by name from a fresh render.
        const joined = await stitchClips(chunkFiles, `${outFolder}/${stem}${finalSuffix}`, 0, 0, null);
        if (joined?.filename) outFile = { filename: joined.filename, subfolder: joined.subfolder || outFolder };
      }

      // Single-shot wrote its meta in finishPost(). The chunked path's output is the joined
      // file, so patch its meta here the same way.
      if (outFile && chunkCount !== 1) {
        await patchPostMeta(outFile, (v as any).meta, v.filename, label, postInfo).catch(() => {});
      }
      readout.done();
      await refresh();
      ctx.showPopup(`${label} finished — the new file is at the top of the gallery.`, false);
    } catch (e: any) {
      readout.fail(e?.message || String(e));
      ctx.showPopup(`${label} failed: ${e?.message || e}`, true);
    } finally {
      // Clean up in both the success and failure paths: whatever chunks did get written, and
      // the source copy that only ever existed to feed VHS_LoadVideo.
      for (const f of chunkFiles) await deleteVideo(f.filename, f.subfolder).catch(() => {});
      if (copied) discardInputCopy(copied);
      clearPostJob(); // this run is settled (ok or failed) — nothing to resume
      keepTabAlive(false);
      postRunning = false;
      runBtn.disabled = false;
    }
  }

  // Patch a post-processed file's meta: keep the source's prompt/seed/pipeline for Reuse
  // (SPEC §5) but overwrite w/h/frames/fps with the real output (upscale changes size,
  // interpolation changes frame count/fps), drop the source's render time, record the source.
  async function patchPostMeta(outFile: { filename: string; subfolder: string }, sourceMeta: any, sourceName: string, label: string, postInfo: PostInfo = {}) {
    const base: any = { ...(sourceMeta || {}) };
    base.created = Date.now();
    base.postProcess = postLabel(label, postInfo);
    base.postSource = sourceName;
    delete base.elapsedSec;
    delete base.sourceW; delete base.sourceH; // recomputed below, only on a real size change
    if (postInfo.deblur && postInfo.deblur !== "none") base.deblur = postInfo.deblur;
    if (postInfo.upscale) base.upscale = postInfo.upscale;
    if (postInfo.interpolate) base.interpolate = postInfo.interpolate;
    try {
      const oi = await getVideoInfo(outFile.filename, outFile.subfolder || "", "output");
      if (oi.width || oi.height) {
        if ((oi.width && oi.width !== sourceMeta?.w) || (oi.height && oi.height !== sourceMeta?.h)) {
          base.sourceW = sourceMeta?.w;
          base.sourceH = sourceMeta?.h;
        }
        if (oi.width) base.w = oi.width;
        if (oi.height) base.h = oi.height;
      }
      if (oi.frames) { base.frames = oi.frames; base.durationSeconds = oi.frames / (oi.fps || FPS); }
      if (oi.fps) base.fps = oi.fps;
    } catch { /* probe failed — leave whatever the source meta had */ }
    await saveMeta(outFile.filename, outFile.subfolder || "", base);
  }

  /** Pull the output file out of a queue result, then patch its meta. Returns the output. */
  async function finishPost(res: QueueResult, saveNode: string, sourceName: string, sourceMeta: any, label: string, outFolder: string, postInfo: PostInfo = {}) {
    const out = res.byNode?.[saveNode];
    const o = (out?.images || out?.gifs || [])[0];
    if (!o) return null;
    const outFile = { filename: o.filename, subfolder: o.subfolder || outFolder };
    await patchPostMeta(outFile, sourceMeta, sourceName, label, postInfo).catch(() => {});
    return outFile;
  }

  // Re-attach to a single-shot post-process that was in flight when the tab was reloaded /
  // iOS-discarded: /history says done → finish it (meta + cleanup + gallery refresh); still
  // running → wait it out. Called on every gallery open.
  async function resumePostJob() {
    if (postRunning) return;
    const job = loadPostJob();
    if (!job) return;
    if (Date.now() - job.savedAt > 45 * 60_000) { clearPostJob(); return; }
    postRunning = true;
    keepTabAlive(true);
    upscaleReadout.start(`Resuming ${job.label}…`);
    try {
      const res = await queuePrompt(null, {
        existingPromptId: job.promptId,
        onProgress: (v, m) => upscaleReadout.chunkStep(0, 1, v, m),
        onPoll: () => upscaleReadout.note(`${job.label} · still working (connection quiet)…`),
      });
      const outFile = await finishPost(res, job.saveNode, job.source, job.sourceMeta, job.label, job.outFolder, job.postInfo || {});
      upscaleReadout.done();
      if (job.copied) discardInputCopy(job.copied);
      await refresh();
      ctx.showPopup(outFile
        ? `${job.label} finished while you were away — it's at the top of the gallery.`
        : `${job.label} finished but its output couldn't be located.`, !outFile);
    } catch (e: any) {
      upscaleReadout.fail(e?.message || String(e));
      if (job.copied) discardInputCopy(job.copied);
      ctx.showPopup(`Couldn't recover the previous ${job.label}: ${e?.message || e}`, true);
    } finally {
      clearPostJob();
      keepTabAlive(false);
      postRunning = false;
    }
  }

  // ── Upscale bar ───────────────────────────────────────────────────────────
  // "None" belongs in the method list — SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §15: with deblur
  // beside it, "no upscale" is a real choice, and it's what lets ⬆ Run do a deblur-only pass.
  const upscaleMethods = UPSCALE_MODES;
  let upscaleMethod: string = state.upscaleMode && state.upscaleMode !== "none" ? state.upscaleMode : "model";
  let upscaleModelVal = state.upscaleModel || "";
  let upscaleRtxScale = state.rtxScale ?? 2.0;
  let upscaleRtxQuality = state.rtxQuality || "ULTRA";
  // Deblur sharpens at the clip's own resolution and is a separate job from upscaling: its own
  // button runs it alone, and the same select also feeds the Upscale button so one pass can
  // deblur then upscale without writing an intermediate file. Pressing one never triggers the
  // other's work.
  let deblurStrength = "none";

  const upscaleMethodWrap = el("div", { style: { minWidth: "140px" } });
  const upscaleModelWrap = el("div", { style: { minWidth: "180px" } });
  const upscaleRtxWrap = el("div", { class: "flex items-center gap-2" });
  const deblurWrap = el("div", { style: { minWidth: "100px" } });
  const upscaleReadout = makeProgressReadout();
  const upscaleRunBtn = button("⬆ Run", () => {
    const v = findPost();
    if (!v) return;
    const upscale: PostInfo["upscale"] =
      upscaleMethod === "none" ? null
      : upscaleMethod === "rtx" ? { method: "rtx", scale: upscaleRtxScale, quality: upscaleRtxQuality }
      : { method: "model", model: upscaleModelVal };
    runPost(
      v,
      (f, stem, chunkOpts) => buildUpscaleGraph(f, chunkOpts.folder || (state.saveSubfolder || SUBFOLDER).replace(/\\/g, "/"), stem, {
        method: upscaleMethod as "model" | "rtx" | "none", upscaleModel: upscaleModelVal, rtxScale: upscaleRtxScale, rtxQuality: upscaleRtxQuality, deblur: deblurStrength,
        skipFirstFrames: chunkOpts.skipFirstFrames, frameLoadCap: chunkOpts.frameLoadCap,
        saveSuffix: upscaleMethod === "none" && chunkOpts.saveSuffix === undefined ? "_deblur" : chunkOpts.saveSuffix,
      }, ctx.availability),
      upscaleReadout, upscaleRunBtn, "Upscale", upscaleMethod === "none" ? "_deblur" : "_upscaled",
      (durationSec) => upscaleChunkSeconds(upscaleMethod as "rtx" | "model" | "none", durationSec),
      { deblur: deblurStrength, upscale },
    );
  }, "primary") as HTMLButtonElement;
  /** Deblur with no upscale: method "none" makes the graph builder skip both upscalers. */
  const deblurRunBtn = button("✦ Deblur", () => {
    const v = findPost();
    if (v)
      runPost(
        v,
        (f, stem, chunkOpts) => buildUpscaleGraph(f, chunkOpts.folder || (state.saveSubfolder || SUBFOLDER).replace(/\\/g, "/"), stem, {
          method: "none", deblur: deblurStrength,
          skipFirstFrames: chunkOpts.skipFirstFrames, frameLoadCap: chunkOpts.frameLoadCap,
          saveSuffix: chunkOpts.saveSuffix === undefined ? "_deblur" : chunkOpts.saveSuffix,
        }, ctx.availability),
        upscaleReadout, deblurRunBtn, "Deblur", "_deblur",
        (durationSec) => upscaleChunkSeconds("none", durationSec), // deblur is RTX-based → 15s rule
        { deblur: deblurStrength, upscale: null },
      );
  }) as HTMLButtonElement;
  const upscaleBar = el("div", { class: "hidden items-center gap-2 shrink-0 rounded-lg flex-wrap", style: { display: "none", background: C.bg1, border: `1px solid ${BRAND}`, padding: "7px 10px" } });

  function renderUpscaleMethod() {
    clear(upscaleMethodWrap);
    const sel = select(upscaleMethods.map((m) => ({ value: m.key, label: m.label })), upscaleMethod, (v) => { upscaleMethod = v; renderUpscaleControls(); });
    (sel as HTMLElement).style.fontSize = "10.5px";
    upscaleMethodWrap.appendChild(sel);
  }
  function renderUpscaleModel(models: string[]) {
    clear(upscaleModelWrap);
    const opts = models.length ? models : [""];
    if (!upscaleModelVal && models.length) upscaleModelVal = models[0];
    const sel = select(opts.map((m) => ({ value: m, label: m || "— no models found —" })), upscaleModelVal, (v) => { upscaleModelVal = v; });
    (sel as HTMLElement).style.fontSize = "10.5px";
    upscaleModelWrap.appendChild(sel);
  }
  function renderUpscaleRtx() {
    clear(upscaleRtxWrap);
    const scaleField = numberField(upscaleRtxScale, (v) => { upscaleRtxScale = Math.max(1, Math.min(4, v)); }, 1);
    (scaleField as HTMLElement).style.width = "50px";
    const qualitySel = select(["LOW", "MEDIUM", "HIGH", "ULTRA"], upscaleRtxQuality, (v) => { upscaleRtxQuality = v; });
    (qualitySel as HTMLElement).style.fontSize = "10.5px";
    upscaleRtxWrap.append(
      el("span", { text: "scale", class: "text-[10.5px]", style: { color: C.muted } }), scaleField,
      el("span", { text: "quality", class: "text-[10.5px]", style: { color: C.muted } }), qualitySel
    );
  }
  function renderDeblur() {
    clear(deblurWrap);
    const sel = select([{ value: "none", label: "off" }, { value: "LOW", label: "Low" }, { value: "MEDIUM", label: "Medium" }, { value: "HIGH", label: "High" }, { value: "ULTRA", label: "Ultra" }], deblurStrength, (v) => { deblurStrength = v; renderUpscaleControls(); });
    (sel as HTMLElement).style.fontSize = "10.5px";
    deblurWrap.append(el("span", { text: "deblur ", class: "text-[10.5px]", style: { color: C.muted } }), sel);
  }
  function refreshUpscaleAvailability() {
    const avail = ctx.availability;
    const deblurOn = deblurStrength !== "none";
    const deblurOk = !avail || !Object.keys(avail).length || !!avail.TJ_RTXDeblur;
    const isNone = upscaleMethod === "none";
    const nodeName = upscaleMethod === "rtx" ? "RTXVideoSuperResolution" : "ImageUpscaleWithModel";
    const upscalerOk = !avail || !Object.keys(avail).length || !!avail[nodeName];
    // With Upscale = None, Run needs deblur set rather than a model or the RTX node.
    const upMissing = isNone ? !(deblurOn && deblurOk) : !upscalerOk;
    upscaleRunBtn.disabled = !postPick || upMissing || postRunning;
    upscaleRunBtn.style.opacity = upscaleRunBtn.disabled ? "0.5" : "1";
    upscaleRunBtn.title = isNone ? (deblurOk ? "" : "Missing node: TJ_RTXDeblur") : upscalerOk ? "" : `Missing node: ${nodeName}`;

    const deblurMissing = !deblurOn || !deblurOk;
    deblurRunBtn.disabled = !postPick || deblurMissing || postRunning;
    deblurRunBtn.style.opacity = deblurRunBtn.disabled ? "0.5" : "1";
    deblurRunBtn.title = !deblurOk ? "Missing node: TJ_RTXDeblur" : !deblurOn ? "Pick a deblur strength first" : "";
  }
  function renderUpscaleControls() {
    renderUpscaleMethod();
    renderDeblur();
    upscaleRtxWrap.style.display = upscaleMethod === "rtx" ? "flex" : "none";
    upscaleModelWrap.style.display = upscaleMethod === "rtx" || upscaleMethod === "none" ? "none" : "block";
    if (upscaleMethod === "rtx") renderUpscaleRtx();
    refreshUpscaleAvailability();
  }
  function rebuildUpscaleModels() {
    getModels()
      .then((m) => renderUpscaleModel(m.upscale_models || []))
      .catch(() => renderUpscaleModel([]));
  }
  renderUpscaleControls();
  renderUpscaleModel(upscaleModelVal ? [upscaleModelVal] : []);
  upscaleBar.append(
    el("div", { text: "Upscale:", class: "text-[10.5px] font-bold", style: { color: C.text } }),
    deblurWrap, deblurRunBtn, upscaleMethodWrap, upscaleModelWrap, upscaleRtxWrap, upscaleReadout.wrap, upscaleRunBtn
  );

  // ── Interpolate bar ───────────────────────────────────────────────────────
  let interpTargetFps = 48;
  let interpScale = 1.0;
  let interpBatch = 8;
  let interpFp16 = true;

  const interpTargetField = numberField(interpTargetFps, (v) => { interpTargetFps = Math.max(FPS + 1, Math.round(v)); }, 1);
  (interpTargetField as HTMLElement).style.width = "60px";
  const interpScaleSel = select(["0.25", "0.5", "1.0", "2.0", "4.0"], String(interpScale), (v) => { interpScale = parseFloat(v); });
  (interpScaleSel as HTMLElement).style.fontSize = "10.5px";
  const interpBatchField = numberField(interpBatch, (v) => { interpBatch = Math.max(1, Math.min(32, Math.round(v))); }, 1);
  (interpBatchField as HTMLElement).style.width = "50px";
  const interpFp16Label = el("label", { class: "flex items-center gap-1.5 text-[10.5px] cursor-pointer", style: { color: C.text } });
  const interpFp16Cb = el("input", { type: "checkbox" }) as HTMLInputElement;
  interpFp16Cb.checked = interpFp16;
  interpFp16Cb.style.cursor = "pointer";
  interpFp16Cb.addEventListener("change", () => { interpFp16 = interpFp16Cb.checked; });
  interpFp16Label.append(interpFp16Cb, el("span", { text: "fp16" }));

  const interpReadout = makeProgressReadout();
  const interpRunBtn = button("🎞 Run", () => {
    const v = findPost();
    if (v)
      runPost(
        v,
        (f, stem, chunkOpts) => buildInterpolateGraph(f, chunkOpts.folder || (state.saveSubfolder || SUBFOLDER).replace(/\\/g, "/"), stem, {
          targetFps: interpTargetFps, scale: interpScale, batchSize: interpBatch, useFp16: interpFp16,
          skipFirstFrames: chunkOpts.skipFirstFrames, frameLoadCap: chunkOpts.frameLoadCap,
          saveSuffix: chunkOpts.saveSuffix,
        }),
        interpReadout, interpRunBtn, "Interpolation", `_${interpTargetFps}fps`,
        undefined, // no chunkPlan → interpolate keeps the RAM byte-budget sizing
        { interpolate: { targetFps: interpTargetFps } },
      );
  }, "primary") as HTMLButtonElement;
  const interpBar = el("div", { class: "hidden items-center gap-2 shrink-0 rounded-lg flex-wrap", style: { display: "none", background: C.bg1, border: `1px solid ${BRAND}`, padding: "7px 10px" } });
  interpBar.append(
    el("div", { text: `Interpolate: ${FPS} →`, class: "text-[10.5px] font-bold", style: { color: C.text } }),
    interpTargetField,
    el("span", { text: "fps · scale", class: "text-[10.5px]", style: { color: C.muted } }), interpScaleSel,
    el("span", { text: "batch", class: "text-[10.5px]", style: { color: C.muted } }), interpBatchField,
    interpFp16Label, interpReadout.wrap, interpRunBtn
  );
  function refreshInterpAvailability() {
    const avail = ctx.availability;
    const missing = avail && Object.keys(avail).length && !avail.RIFEInterpolation;
    interpRunBtn.disabled = !postPick || !!missing || postRunning;
    interpRunBtn.style.opacity = interpRunBtn.disabled ? "0.5" : "1";
    interpRunBtn.title = missing ? "Missing node: RIFEInterpolation" : "";
  }

  function refreshPostBar() {
    if (mode === "upscale") refreshUpscaleAvailability();
    else if (mode === "rife") refreshInterpAvailability();
  }

  const grid = el("div", { class: "flex-1 min-h-0 overflow-y-auto grid gap-2", style: { gridTemplateColumns: "repeat(auto-fill, minmax(252px, 1fr))", gridAutoRows: "min-content", alignContent: "start", paddingRight: "4px" } });
  const hint = el("div", { class: "shrink-0 text-[10px] text-center", style: { color: C.muted } });
  hint.innerHTML = "double-click a clip to play it full screen · <b>space</b> play/pause · <b>← →</b> seek · <b>[ ]</b> previous / next · <b>Esc</b> close";

  ov.append(hdr, stitchBar, audioOverrideBar, upscaleBar, interpBar, grid, hint);

  // ── fullscreen player ───────────────────────────────────────────────────
  const player = el("div", { class: "hidden fixed inset-0 z-[100000] flex-col", style: { display: "none", background: "rgba(0,0,0,0.97)" } });
  const pTop = el("div", { class: "shrink-0 flex items-center gap-2.5 text-white", style: { padding: "10px 14px" } });
  const pTitle = el("div", { class: "text-[13px] font-semibold flex-1 overflow-hidden text-ellipsis whitespace-nowrap" });
  const pPos = el("div", { class: "text-[11px]", style: { color: "#9a9a9a" } });
  const pClose = el("button", { type: "button", text: "✕", title: "Close (Esc)", style: { cursor: "pointer", background: "rgba(255,255,255,0.1)", color: "#fff", border: "none", borderRadius: "6px", width: "30px", height: "30px", fontSize: "14px" } });
  pTop.append(pTitle, pPos, pClose);

  const pVideo = el("video", { controls: "", playsinline: "", class: "flex-1 min-h-0 w-full", style: { objectFit: "contain", background: "#000" } }) as HTMLVideoElement;
  const pFoot = el("div", { class: "shrink-0 text-[11px] text-center", style: { padding: "8px 14px 14px", color: "#7a7a7a" } });
  pFoot.innerHTML = "<b>space</b> play/pause · <b>← →</b> ±5s · <b>Shift+← →</b> ±1s · <b>[ ]</b> previous / next clip · <b>f</b> browser fullscreen · <b>Esc</b> close";
  player.append(pTop, pVideo, pFoot);

  let playIndex = -1;
  function shown() {
    return filterFull ? videos.filter((v) => (v as any).is_full) : videos;
  }

  function openPlayer(i: number) {
    const list = shown();
    if (!list.length) return;
    stopGridVideos();
    playIndex = Math.max(0, Math.min(i, list.length - 1));
    const v = list[playIndex];
    pVideo.src = clipViewUrl(v.filename, v.subfolder);
    pTitle.textContent = v.filename;
    pPos.textContent = `${playIndex + 1} / ${list.length}`;
    player.classList.remove("hidden");
    player.style.display = "flex";
    pVideo.play?.().catch(() => {});
    setTimeout(() => pVideo.focus(), 30);
  }
  function closePlayer() {
    player.style.display = "none";
    player.classList.add("hidden");
    try { pVideo.pause(); } catch {}
    pVideo.removeAttribute("src");
    pVideo.load?.();
  }
  function step(delta: number) {
    const list = shown();
    if (!list.length) return;
    openPlayer((playIndex + delta + list.length) % list.length);
  }
  pClose.addEventListener("click", closePlayer);

  const onKey = (e: KeyboardEvent) => {
    if (player.style.display === "none") return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const k = e.key;
    if (k === "Escape") { e.preventDefault(); e.stopPropagation(); closePlayer(); return; }
    if (k === " ") { e.preventDefault(); e.stopPropagation(); pVideo.paused ? pVideo.play() : pVideo.pause(); return; }
    if (k === "ArrowRight") { e.preventDefault(); e.stopPropagation(); pVideo.currentTime += e.shiftKey ? 1 : 5; return; }
    if (k === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); pVideo.currentTime -= e.shiftKey ? 1 : 5; return; }
    if (k === "]") { e.preventDefault(); e.stopPropagation(); step(1); return; }
    if (k === "[") { e.preventDefault(); e.stopPropagation(); step(-1); return; }
    if (k === "f" || k === "F") {
      e.preventDefault();
      e.stopPropagation();
      if (document.fullscreenElement) document.exitFullscreen?.();
      else player.requestFullscreen?.();
    }
  };
  document.addEventListener("keydown", onKey, true);

  // ── hover-preview (single shared <video> moved into the hovered card) ──
  const hoverVideo = el("video", { muted: "", playsinline: "", preload: "none", class: "absolute inset-0 w-full h-full pointer-events-none", style: { objectFit: "contain", background: "#000" } }) as HTMLVideoElement;

  hoverVideo.muted = true;
  function stopGridVideos() {
    try { hoverVideo.pause(); } catch {}
    hoverVideo.removeAttribute("src");
    hoverVideo.load();
    hoverVideo.parentElement?.removeChild(hoverVideo);
  }

  function renderGrid() {
    stopGridVideos();
    clear(grid);
    const list = shown();
    countTag.textContent = `${list.length} clip${list.length === 1 ? "" : "s"}${filterFull ? " (stitched)" : ""} · ${state.saveSubfolder || SUBFOLDER}`;
    if (!list.length) {
      grid.appendChild(el("div", { text: filterFull ? "No stitched videos yet." : "No clips yet — generate something first.", class: "text-xs text-center", style: { color: C.muted, gridColumn: "1 / -1", padding: "30px 0" } }));
      return;
    }
    list.forEach((v, i) => {
      const pickIdx = mode === "stitch" ? stitchOrder.indexOf(vKey(v)) : -1;
      const postPicked = (mode === "upscale" || mode === "rife") && postPick === vKey(v);
      const picked = pickIdx !== -1 || postPicked;
      const isFull = !!(v as any).is_full;
      const card = el("div", {
        class: "relative flex flex-col rounded-lg cursor-pointer",
        style: { background: C.bg1, border: `1px solid ${picked ? BRAND : isFull ? BRAND : C.border}`, opacity: mode === "stitch" && !picked && stitchOrder.length >= STITCH_MAX ? "0.4" : "1" },
      });

      const thumbWrap = el("div", { class: "relative w-full" });
      const thumb = el("img", { loading: "lazy", src: thumbUrl(v.filename, v.subfolder), class: "w-full block", style: { aspectRatio: "1 / 1", objectFit: "contain", background: "#000", borderRadius: "7px 7px 0 0" } });
      thumbWrap.appendChild(thumb);

      const deleteBtn = el("button", {
        type: "button", text: "✕", title: "Delete this clip",
        class: "absolute top-1 right-1 z-[3]",
        style: { width: "18px", height: "18px", lineHeight: "16px", padding: "0", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "4px" },
      });
      deleteBtn.addEventListener("click", (e) => { e.stopPropagation(); askDelete(v); });
      thumbWrap.appendChild(deleteBtn);

      const infoBtn = el("button", {
        // 커스텀 JS 팝업(위치 계산/이벤트 순서/z-index 등)이 실기기에서 계속 안 뜬다는
        // 신고가 반복돼서, 브라우저가 직접 그려주는 네이티브 title 툴팁으로 바꾼다 —
        // 이건 위치·타이밍·스택 컨텍스트를 브라우저가 알아서 처리해서 우리 쪽 코드가
        // 틀릴 여지가 없다. title은 "\n"으로 실제 줄바꿈이 된다(모든 주요 브라우저 지원).
        type: "button", text: "i", title: metaInfoLines((v as any).meta).join("\n"),
        class: "absolute bottom-1 right-1 z-[3]",
        style: { width: "18px", height: "18px", lineHeight: "16px", padding: "0", cursor: "pointer", fontSize: "11px", fontStyle: "italic", fontWeight: "700", fontFamily: "Georgia, 'Times New Roman', serif", background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "50%" },
      });
      infoBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        // title 호버 툴팁은 터치에선 안 뜨고, "터치 기기인지" 자체를 기기가 속이는 경우도
        // 있다(아이패드의 데스크톱 사이트 요청 모드는 maxTouchPoints를 0으로 보고함) — 기기
        // 판별을 아예 하지 말고 클릭/탭이면 무조건 팝업 띄운다. 데스크톱은 호버 툴팁과
        // 겹치지만(클릭하면 둘 다 뜸) 안 뜨는 것보다 훨씬 낫다. 네이티브 alert()는
        // 프리뷰 브라우저에서 억제되므로 공용 alertDialog 사용 — §9.
        alertDialog(metaInfoLines((v as any).meta).join("\n"));
      });
      thumbWrap.appendChild(infoBtn);

      // SPEC_MINIMAX_H3_INLINE_POSTPROCESS_META.md §5/§7 — post-decode frame ops, bottom-left.
      // Set the same way whether the pass ran inline at generation time (buildClipGraph meta)
      // or afterward from this gallery (patchPostMeta). ⇪ = upscaled, ✧ = deblurred,
      // ⇄ = interpolated; any can show.
      {
        const m = (v as any).meta || {};
        const marks: [string, string][] = [];
        if (m.upscale) marks.push(["⇪", m.upscale.method === "rtx"
          ? `Upscaled — RTX VSR ×${m.upscale.scale} (${m.upscale.quality})`
          : `Upscaled — ${String(m.upscale.model || "model").split(/[\\/]/).pop()}`]);
        if (m.deblur && m.deblur !== "none") marks.push(["✧", `Deblurred — strength ${m.deblur}`]);
        if (m.interpolate) marks.push(["⇄", `Interpolated${m.interpolate.targetFps ? ` — ${Math.round(m.interpolate.targetFps)}fps` : ""}`]);
        if (marks.length) {
          const bar = el("div", { class: "absolute z-[3] flex", style: { bottom: "4px", left: "4px", gap: "3px" } });
          marks.forEach(([glyph, tip]) => bar.appendChild(el("div", {
            text: glyph, title: tip,
            style: { width: "18px", height: "18px", lineHeight: "18px", textAlign: "center", fontSize: "11px", borderRadius: "4px", color: "#fff", background: "rgba(0,0,0,0.6)" },
          })));
          thumbWrap.appendChild(bar);
        }
      }

      // 다중 선택 체크박스(좌상단) — 어떤 모드든 그 자리를 순번/✓ 배지가 쓰므로 숨긴다.
      if (!mode) {
        const key = vKey(v);
        const checkWrap = el("label", {
          class: "absolute top-1 left-1 z-[3] flex items-center justify-center rounded",
          style: { width: "18px", height: "18px", background: "rgba(0,0,0,0.6)", cursor: "pointer" },
        });
        const checkbox = el("input", { type: "checkbox" }) as HTMLInputElement;
        checkbox.checked = selectedKeys.has(key);
        checkbox.style.cursor = "pointer";
        checkbox.addEventListener("click", (e) => e.stopPropagation());
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selectedKeys.add(key);
          else selectedKeys.delete(key);
          refreshDeleteSelBtn();
        });
        checkWrap.appendChild(checkbox);
        thumbWrap.appendChild(checkWrap);
      }

      // 호버 미리재생은 터치에서 의미가 없고(호버 상태가 없음), 터치의 합성 mouseenter가
      // 불필요한 비디오 로드를 시작시켜 다른 탭 상호작용을 지연시킬 수 있으니 진짜 터치
      // 기기(ontouchstart/maxTouchPoints로 판별 — hover 미디어쿼리보다 신뢰도 높음)에서는
      // 아예 안 건다.
      if (!IS_TOUCH_DEVICE) {
        thumbWrap.addEventListener("mouseenter", () => {
          stopGridVideos();
          hoverVideo.src = clipViewUrl(v.filename, v.subfolder);
          thumbWrap.appendChild(hoverVideo);
          hoverVideo.currentTime = 0;
          hoverVideo.play?.().catch(() => {});
        });
        thumbWrap.addEventListener("mouseleave", stopGridVideos);
      }

      if (mode === "stitch") {
        card.addEventListener("click", () => {
          if (postRunning) return;
          const key = vKey(v);
          const idx = stitchOrder.indexOf(key);
          if (idx !== -1) stitchOrder.splice(idx, 1);
          else if (stitchOrder.length < STITCH_MAX) stitchOrder.push(key);
          else { ctx.showPopup(`${STITCH_MAX} / ${STITCH_MAX} · longer edits need a real video editor`, true); return; }
          renderGrid();
        });
        if (picked) {
          card.appendChild(el("div", { text: String(pickIdx + 1), class: "absolute top-1 left-1 z-[2] rounded-full flex items-center justify-center font-bold text-[11px]", style: { width: "20px", height: "20px", background: BRAND, color: "#fff" } }));
        }
      } else if (mode === "upscale" || mode === "rife") {
        card.addEventListener("click", () => {
          if (postRunning) return;
          const key = vKey(v);
          postPick = postPick === key ? null : key;
          renderGrid();
        });
        if (postPicked) {
          card.appendChild(el("div", { text: "✓", class: "absolute top-1 left-1 z-[2] rounded-full flex items-center justify-center font-bold text-[11px]", style: { width: "20px", height: "20px", background: BRAND, color: "#fff" } }));
        }
      } else {
        card.addEventListener("dblclick", () => openPlayer(i));
      }

      const durationSec = (v as any).meta?.durationSeconds ?? ((v as any).meta?.frames ? framesToSeconds((v as any).meta.frames) : null);
      const durationText = durationSec != null ? `${durationSec.toFixed(2)}s · ` : "";
      const meta = el("div", { class: "flex flex-col gap-0.5", style: { padding: "5px 7px" } });
      meta.append(
        el("div", { text: v.filename, class: "text-[10px] overflow-hidden text-ellipsis whitespace-nowrap", style: { color: C.text } }),
        el("div", { text: `${durationText}${fmtSize((v as any).size)} · ${fmtWhen((v as any).mtime)}`, class: "text-[9px]", style: { color: C.muted } })
      );
      if (isFull) meta.appendChild(el("div", { text: "★ stitched", class: "text-[9px] font-bold", style: { color: BRAND } }));

      const promptTextVal = String((v as any).prompt || (v as any).meta?.prompt || "").trim();
      if (promptTextVal) {
        const p = el("div", { text: promptTextVal, class: "text-[9px] leading-snug mt-0.5 cursor-text", style: { color: C.muted, display: "-webkit-box", WebkitLineClamp: "3", WebkitBoxOrient: "vertical", overflow: "hidden" } });
        p.title = promptTextVal;
        meta.appendChild(p);

        const bar = el("div", { class: "flex gap-1 mt-1" });
        const mini = (txt: string, tip: string, fn: () => void) => {
          const b = el("button", { text: txt, style: { flex: "1", fontSize: "9px", padding: "3px 0", cursor: "pointer", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "4px" } });
          b.title = tip;
          b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
          return b;
        };
        bar.append(
          mini("↩ Reuse", "Restore the prompt and every generation setting used for this clip (resolution, steps, LoRAs, seed, ...)", () => {
            const ok = ctx.reusePrompt?.((v as any).meta || { prompt: promptTextVal }) ?? false;
            ctx.showPopup(ok ? "Prompt and settings loaded into the editor." : "No prompt stored for this clip.", !ok);
            if (ok) hide();
          }),
          mini("⧉ Copy", "Copy the prompt to the clipboard", () => {
            navigator.clipboard?.writeText(promptTextVal).then(() => ctx.showPopup("Prompt copied.", false)).catch(() => ctx.showPopup("Copy failed.", true));
          }),
          mini("⏭ Extend", "Add a continuation from this clip's last frame — the result is one longer, stitched video", () => {
            openExtendPopup(v, promptTextVal);
          })
        );
        meta.appendChild(bar);
      }
      card.append(thumbWrap, meta);
      grid.appendChild(card);
    });
    if (mode === "stitch") refreshStitchBar();
    else if (mode === "upscale" || mode === "rife") refreshPostBar();
  }

  async function refresh() {
    countTag.textContent = "loading…";
    try {
      const d = await listVideos(state.saveSubfolder || SUBFOLDER, { limit: 300 });
      videos = d.videos || [];
    } catch {
      videos = [];
    }
    renderGrid();
  }

  // ── Extend — one continuation clip from this clip's last frame, auto-stitched (§3) ──
  async function extendBrief(seedFrame: string, rough: string): Promise<string> {
    let sys = "";
    try { sys = (await getSystemPrompt("minimax")).instruction || ""; } catch {}
    let vision = "";
    if (state.nativeVisionClip) {
      try {
        vision = (await analyzeImagesNative(state.nativeVisionClip, [seedFrame],
          "Describe this frame factually and concisely. It is the final frame of a video clip "
          + "and the starting point for what happens next.")).trim();
      } catch {}
    }
    const user = (vision ? `The clip so far ends on this frame:\n${vision}\n\n` : "")
      + `Continue the same shot. What happens next: ${rough}`;
    return (await writeBriefNative(state.nativeBriefClip, sys, user)).trim();
  }

  function openExtendPopup(clip: GalleryVideo, sourcePrompt: string) {
    if (!state.nativeBriefClip) { ctx.showPopup("Set a brief CLIP in ⚙ Settings → Models first.", true); return; }
    let seedFrame: string | null = null;
    let mode: "review" | "auto" = "review";
    let reviewed = false;
    let busy = false;

    const thumb = el("img", { style: { width: "100%", height: "150px", objectFit: "contain", background: "#000", borderRadius: "6px", border: `1px solid ${C.border}` } }) as HTMLImageElement;
    const ta = el("textarea", { placeholder: "What happens next — a rough line is enough.", style: { width: "100%", minHeight: "70px", resize: "vertical", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "8px", fontSize: "12px", fontFamily: "inherit", outline: "none" } }) as HTMLTextAreaElement;
    const modeRow = el("div", { style: { display: "flex", gap: "6px" } });
    const modeBtns: Record<string, HTMLButtonElement> = {};
    ([["review", "LLM: Review"], ["auto", "LLM: Auto"]] as const).forEach(([k, lbl]) => {
      const b = el("button", { type: "button", text: lbl, style: { flex: "1", cursor: "pointer", fontFamily: "inherit", fontSize: "10.5px", padding: "5px 0", borderRadius: "5px", border: `1px solid ${C.border}`, background: C.bg2, color: C.text } }) as HTMLButtonElement;
      b.addEventListener("click", () => { mode = k; reviewed = false; paintModes(); });
      modeBtns[k] = b;
      modeRow.appendChild(b);
    });
    function paintModes() {
      for (const k in modeBtns) {
        const on = k === mode;
        modeBtns[k].style.background = on ? BRAND : C.bg2;
        modeBtns[k].style.color = on ? "#fff" : C.text;
        modeBtns[k].style.fontWeight = on ? "700" : "400";
      }
      goBtn.textContent = mode === "review" && !reviewed ? "Enhance →" : "Extend";
    }

    const cancelBtn = el("button", { type: "button", text: "Cancel", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "6px 12px", borderRadius: "6px", border: `1px solid ${C.border}`, background: C.bg2, color: C.text } });
    const goBtn = el("button", { type: "button", text: "Enhance →", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: "700", padding: "6px 16px", borderRadius: "6px", border: "1px solid transparent", background: BRAND, color: "#fff" } });

    const box = el("div", { style: { background: "#141414", border: `1px solid ${C.border}`, borderRadius: "10px", width: "420px", maxWidth: "92%", padding: "16px", display: "flex", flexDirection: "column", gap: "9px", boxShadow: "0 16px 50px rgba(0,0,0,0.65)" } }, [
      el("div", { text: "Extend clip", style: { color: "#fff", fontSize: "13px", fontWeight: "700" } }),
      thumb, ta,
      el("div", { text: "LLM analyses the frame above + your line. Review shows the result first; Auto renders straight away.", style: { fontSize: "9.5px", color: C.muted, lineHeight: "1.5" } }),
      modeRow,
      el("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "2px" } }, [cancelBtn, goBtn]),
    ]);
    const pop = el("div", { style: { position: "fixed", inset: "0", zIndex: "100060", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.72)" } }, [box]);
    const closePop = () => pop.remove();
    cancelBtn.addEventListener("click", closePop);
    pop.addEventListener("mousedown", (e) => { if (e.target === pop) closePop(); });
    document.body.appendChild(pop);
    paintModes();

    (async () => {
      try {
        seedFrame = await getClipLastFrame(clip.filename, clip.subfolder || "");
        thumb.src = viewUrl(seedFrame) + `&t=${Date.now()}`;
      } catch (e: any) {
        ctx.showPopup(`Could not read the last frame: ${e?.message || e}`, true);
        closePop();
      }
    })();

    goBtn.addEventListener("click", async () => {
      if (busy || !seedFrame) return;
      const rough = ta.value.trim();
      if (!rough) { ctx.showPopup("Write what happens next.", true); return; }
      if (mode === "review" && !reviewed) {
        busy = true; goBtn.disabled = true; goBtn.textContent = "Enhancing…";
        try {
          ta.value = await extendBrief(seedFrame, rough);
          reviewed = true;
        } catch (e: any) { ctx.showPopup(`Enhance failed: ${e?.message || e}`, true); }
        busy = false; goBtn.disabled = false; paintModes();
        return;
      }
      busy = true; goBtn.disabled = true; goBtn.textContent = "Working…";
      let finalText = rough;
      try {
        if (mode === "auto") finalText = await extendBrief(seedFrame, rough);
        else finalText = ta.value.trim() || rough;
      } catch (e: any) {
        ctx.showPopup(`Enhance failed: ${e?.message || e}`, true);
        busy = false; goBtn.disabled = false; paintModes();
        return;
      }
      closePop();
      hide();
      ctx.runExtend?.({ sourceClip: clip, seedFrame, prompt: finalText, sourcePrompt });
    });
  }

  function hide() {
    closePlayer();
    stopGridVideos();
    ov.style.display = "none";
    clear(grid);
    // render:false — the grid was just emptied above to stop the hover videos, and
    // re-rendering would put them back. Skipped entirely while postRunning, so a queued
    // Upscale/Interpolate job's bar survives a close/reopen.
    if (!postRunning) setMode(null, false);
    deleteConfirmOv.style.display = "none";
    pendingDelete = null;
  }

  return {
    el: ov,
    playerEl: player,
    show() {
      ov.style.display = "flex";
      refresh();
      resumePostJob();
    },
    hide,
    isOpen: () => ov.style.display !== "none",
    isPlaying: () => player.style.display !== "none",
    destroy() {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keydown", onDeleteConfirmKey, true);
    },
  };
}
