// galleryOverlay.ts — MiniMax H3 클립 갤러리 + 풀스크린 플레이어 (원본: web/minimax/ui_gallery_minimax.js)
// 결과가 비디오라서 공용 shared/gallery.ts(정적 이미지 그리드)로는 부족한 기능들 —
// 썸네일 지연로딩, 호버 미리재생, 더블클릭 풀스크린, 프롬프트 표시/Reuse/Copy, 삭제,
// 스티치 — 을 전부 이 도구 전용 오버레이로 이식했다.
import type { MinimaxState } from "./core";
import { SUBFOLDER, alignFrameCount, framesToSeconds } from "./core";
import { button, el, clear, confirmDialog, select, numberField } from "../../shared/ui";
import { C, BRAND } from "../../identity";
import { clipViewUrl, deleteVideo, getMediaFiles, listVideos, revealOutputFolder, saveMeta, stitchClips, thumbUrl, type GalleryVideo } from "./api";

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
  if (meta.w && meta.h) lines.push(`${meta.w}×${meta.h}`);
  if (meta.frames != null) lines.push(`${meta.frames} frames`);
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

  let stitchMode = false;
  let stitchOrder: string[] = [];
  const vKey = (v: GalleryVideo) => `${v.subfolder || ""}|${v.filename}`;

  const stitchBtn = toolBtn("🔗 Stitch", "Pick clips in order, then combine into one file");
  stitchBtn.addEventListener("click", () => {
    stitchMode = !stitchMode;
    stitchOrder = [];
    oneTakeUserSet = false;
    selectedKeys.clear();
    refreshDeleteSelBtn();
    stitchBtn.style.background = stitchMode ? BRAND : C.bg2;
    stitchBtn.style.borderColor = stitchMode ? BRAND : C.border;
    stitchBar.style.display = stitchMode ? "flex" : "none";
    audioOverrideBar.style.display = stitchMode ? "flex" : "none";
    renderGrid();
  });
  hdr.append(deleteSelBtn, fullBtn, stitchBtn, refreshBtn, folderBtn, button("✕ Close", () => hide(), "danger"));

  const stitchBar = el("div", { class: "hidden items-center gap-2 shrink-0 rounded-lg", style: { background: C.bg1, border: `1px solid ${BRAND}`, padding: "7px 10px" } });
  const stitchInfo = el("div", { class: "flex-1 text-[10.5px]", style: { color: C.text } });
  const stitchClearBtn = el("button", { type: "button", text: "✕ Clear", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "10.5px", padding: "5px 10px", borderRadius: "6px", background: C.bg2, color: C.muted, border: `1px solid ${C.border}` } });
  stitchClearBtn.addEventListener("click", () => { stitchOrder = []; oneTakeUserSet = false; renderGrid(); });

  const oneTakeLabel = el("label", { class: "flex items-center gap-1.5 text-[10.5px] cursor-pointer", style: { color: C.text } });
  const oneTakeCb = el("input", { type: "checkbox" }) as HTMLInputElement;
  oneTakeCb.style.cursor = "pointer";
  let oneTakeUserSet = false;
  oneTakeCb.addEventListener("change", () => { oneTakeUserSet = true; });
  oneTakeLabel.append(oneTakeCb, el("span", { text: "One-Take (trim overlap)" }));

  const stitchGoBtn = button("🔗 Combine", () => runStitch(), "primary");
  stitchBar.append(stitchInfo, oneTakeLabel, stitchClearBtn, stitchGoBtn);

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
      const trimmed = oneTakeCb.checked && picked.length > 1 ? total! - (picked.length - 1) * framesToSeconds(alignFrameCount(39)) : total!;
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
    const overlapSec = oneTakeCb.checked ? framesToSeconds(alignFrameCount(39)) : null;
    stitchInfo.textContent = `Stitching ${picked.length} clips${overlapSec ? ` (One-Take, ${overlapSec.toFixed(3)}s overlap trimmed)` : ""}…`;
    try {
      const folder = (state.saveSubfolder || SUBFOLDER).replace(/\\/g, "/");
      const audioOverride = audioOverrideOn && audioOverrideFile ? { filename: audioOverrideFile, start: audioOverrideStart } : null;
      const out = await stitchClips(picked.map((v) => ({ filename: v.filename, subfolder: v.subfolder || "" })), `${folder}/${state.filenamePrefix || "MMH3"}_full`, null, overlapSec, audioOverride);
      const known = picked.map((v) => ((v as any).meta?.frames ? framesToSeconds((v as any).meta.frames) : null));
      const rawTotal = known.every((s) => s != null) ? known.reduce((a, b) => a! + b!, 0) : null;
      const durationSeconds = rawTotal != null && overlapSec ? rawTotal! - (picked.length - 1) * overlapSec : rawTotal;
      await saveMeta(out.filename, out.subfolder || "", {
        v: 1, prompt: picked.map((v) => (v as any).prompt || "").filter(Boolean).join("\n\n"),
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
    }
  }

  const grid = el("div", { class: "flex-1 min-h-0 overflow-y-auto grid gap-2", style: { gridTemplateColumns: "repeat(auto-fill, minmax(252px, 1fr))", gridAutoRows: "min-content", alignContent: "start", paddingRight: "4px" } });
  const hint = el("div", { class: "shrink-0 text-[10px] text-center", style: { color: C.muted } });
  hint.innerHTML = "double-click a clip to play it full screen · <b>space</b> play/pause · <b>← →</b> seek · <b>[ ]</b> previous / next · <b>Esc</b> close";

  ov.append(hdr, stitchBar, audioOverrideBar, grid, hint);

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

  // ⓘ 아이콘 정보 팝업 — 원본 노드 버전(ui_gallery_minimax.js)과 동일하게 열 때마다 새
  // 엘리먼트를 만들어 document.body에 붙이고, 닫을 때 완전히 제거한다(공유 엘리먼트를
  // display로 껐다 켰다 하는 대신) — 원본에서 이미 검증된 단순한 방식을 그대로 따른다.
  let openInfoPopup: HTMLElement | null = null;
  function showInfoPopup(anchorRect: DOMRect, meta: any) {
    openInfoPopup?.remove();
    const p = el("div", {
      class: "fixed z-[999] pointer-events-none whitespace-pre-line",
      style: { background: "rgba(10,10,10,0.95)", color: "#fff", border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px 8px", fontSize: "10px", lineHeight: "1.5", maxWidth: "220px", boxShadow: "0 4px 14px rgba(0,0,0,0.5)" },
    });
    p.textContent = metaInfoLines(meta).join("\n");
    document.body.appendChild(p);
    const left = Math.min(anchorRect.left, window.innerWidth - 230);
    p.style.top = `${anchorRect.bottom + 4}px`;
    p.style.left = `${Math.max(4, left)}px`;
    openInfoPopup = p;
  }
  function hideInfoPopup() {
    openInfoPopup?.remove();
    openInfoPopup = null;
  }
  // 모바일은 호버가 없어서(mouseenter가 안 옴) 탭으로도 열고 닫을 수 있어야 한다 — 팝업이
  // 열려 있을 때 바깥을 탭/클릭하면 닫는다. 데스크톱 호버는 mouseleave로 그대로 닫힘.
  const onDocClickCloseInfo = (e: MouseEvent) => {
    if (!openInfoPopup) return;
    if (e.target === openInfoPopup) return;
    hideInfoPopup();
  };
  document.addEventListener("click", onDocClickCloseInfo);
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
      const pickIdx = stitchMode ? stitchOrder.indexOf(vKey(v)) : -1;
      const picked = pickIdx !== -1;
      const isFull = !!(v as any).is_full;
      const card = el("div", {
        class: "relative flex flex-col rounded-lg cursor-pointer",
        style: { background: C.bg1, border: `1px solid ${picked ? BRAND : isFull ? BRAND : C.border}`, opacity: stitchMode && !picked && stitchOrder.length >= STITCH_MAX ? "0.4" : "1" },
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
        // ⓘ(U+24D8) 유니코드 글리프가 일부 시스템 폰트에 없어서 미확인 문자(□/?)로
        // 깨져 보이는 경우가 있어, 항상 렌더되는 일반 "i" 글자를 원형 배지 스타일로
        // 대신 쓴다. title(네이티브 브라우저 툴팁)도 커스텀 팝업과 겹쳐 보여서 제거.
        type: "button", text: "i",
        class: "absolute bottom-1 right-1 z-[3]",
        style: { width: "18px", height: "18px", lineHeight: "16px", padding: "0", cursor: "help", fontSize: "11px", fontStyle: "italic", fontWeight: "700", fontFamily: "Georgia, 'Times New Roman', serif", background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "50%" },
      });
      // 호버/클릭/터치 셋 다 그냥 열기만 하게 — 어느 입력이든 먼저 오는 게 여는 거고,
      // 서로 토글/닫기로 부딪힐 일이 없다(기기별 이벤트 순서 차이를 신경 안 써도 됨).
      // 닫기는 오직 바깥을 탭/클릭했을 때(아래 document 리스너)만 일어난다.
      const openInfo = () => showInfoPopup(infoBtn.getBoundingClientRect(), (v as any).meta);
      infoBtn.addEventListener("click", (e) => { e.stopPropagation(); openInfo(); });
      infoBtn.addEventListener("mouseenter", openInfo);
      infoBtn.addEventListener("mouseleave", hideInfoPopup);
      infoBtn.addEventListener("touchstart", (e) => { e.stopPropagation(); openInfo(); }, { passive: true });
      thumbWrap.appendChild(infoBtn);

      // 다중 선택 체크박스(좌상단) — 스티치 모드에선 그 자리를 순번 배지가 쓰므로 숨긴다.
      if (!stitchMode) {
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

      if (stitchMode) {
        card.addEventListener("click", () => {
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
          })
        );
        meta.appendChild(bar);
      }
      card.append(thumbWrap, meta);
      grid.appendChild(card);
    });
    if (stitchMode) refreshStitchBar();
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

  function hide() {
    closePlayer();
    stopGridVideos();
    ov.style.display = "none";
    clear(grid);
    stitchMode = false;
    stitchOrder = [];
    oneTakeUserSet = false;
    stitchBtn.style.background = C.bg2;
    stitchBtn.style.borderColor = C.border;
    stitchBar.style.display = "none";
    deleteConfirmOv.style.display = "none";
    pendingDelete = null;
    selectedKeys.clear();
    refreshDeleteSelBtn();
  }

  return {
    el: ov,
    playerEl: player,
    show() {
      ov.style.display = "flex";
      refresh();
    },
    hide,
    isOpen: () => ov.style.display !== "none",
    isPlaying: () => player.style.display !== "none",
    destroy() {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keydown", onDeleteConfirmKey, true);
      document.removeEventListener("click", onDocClickCloseInfo);
      hideInfoPopup();
    },
  };
}
