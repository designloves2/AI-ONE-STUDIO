// view.ts — MiniMax H3 ONE STUDIO, 웹 레이아웃 재설계판.
// 원본은 ComfyUI 노드 위젯(정사각형에 가까운 고정 1000x820 박스) 안에서 좌측 320px 컨트롤 +
// 우측 프리뷰/프롬프트 구조였다. 여기서는 그 정사각형 제약을 버리고, 넓어진 가로 폭을
// 살려 좌측 컨트롤 레일(고정폭, 스크롤) + 우측 프리뷰/프롬프트(넓은 가변폭)로 재배치했다.
// 백엔드 연결은 다음 단계(§4-2) — 지금은 정적 UI + 로컬 상태 저장까지만 동작한다.
import type { MinimaxState } from "./core";
import {
  ASPECTS,
  ATTN_BACKENDS,
  ATTN_FORWARDS,
  BLOCK_CACHES,
  H3_OPTIMIZERS,
  CLIP_LENGTHS,
  FPS,
  SAMPLERS,
  SCHEDULERS,
  SUBFOLDER,
  UPSCALE_MODES,
  attnBackendBlockedReason,
  attnForwardBlockedReason,
  attnForwardOverlapNote,
  h3OptimizerBlockedReason,
  h3OptimizerOverlapNote,
  activePrompts,
  alignFrameCount,
  blockCacheBlockedReason,
  clipPlan,
  composeClipPrompt,
  configIssues,
  continuityModesFor,
  defaultState,
  explainGenerationError,
  formatDuration,
  framesToSeconds,
  generationModesFor,
  groupShots,
  loadState,
  parseBrief,
  promptFirstFrame,
  pddFileForMode,
  PDD_NFE_CHOICES,
  PIPELINE_PRESETS,
  matchPreset,
  matchUserPreset,
  applyPreset,
  presetFromState,
  type UserPipelinePreset,
  composeStitchedPrompt,
  buildAgentJob,
  clipAssets,
  promptOverrides,
  promptEnabled,
  promptText,
  randomSeed,
  resolveResolution,
  saveState,
  turboModesFor,
} from "./core";
import { applyMobileCollapsibleLayout, button, checkboxRow, clear, col, el, iconBtn, label, modeBar, numberField, panel, row, searchableSelect, select, promptDialog, confirmDialog } from "../../shared/ui";
import { keepTabAlive } from "../../shared/tabKeepAlive";
import { takeReuse } from "../../shared/galleryHandoff";
import { openAudioGalleryPicker } from "../../shared/audioGalleryPicker";
import { C, BRAND } from "../../identity";
import { createPromptEditOverlay } from "./promptEdit";
import { createSettingsOverlay, type SettingsCtx } from "./settings";
import { createGalleryOverlay } from "./galleryOverlay";
import { mountImagePanel } from "./imagesPanel";
import { createCommonPromptOverlay } from "./commonPromptOverlay";
import { renderDepBanner } from "./depBanner";
import {
  checkInputExists,
  getUserPresets,
  saveUserPresets,
  copyOutputToInput,
  freeMemory,
  getLoraTriggers,
  getMediaFiles,
  getMediaInfo,
  getModels,
  getNodeAvailability,
  getQueueStatus,
  getVideoInfo,
  interrupt,
  outputViewUrl,
  pickChainFrame,
  saveMeta,
  setLastResult,
  stitchClips,
  uploadMedia,
  viewUrl,
  deleteVideo,
  analyzeImagesOpenRouter,
  analyzeImagesNative,
  writeBriefOpenRouter,
  writeBriefNative,
  scanFaceRefine,
  listPromptSets,
  getPromptSet,
} from "./api";
import { comfyApi, queuePrompt } from "./comfyClient";
import { buildClipGraph, buildLtxUpscaleGraph, buildFaceRefineGraph, NODE_IDS, ONE_TAKE_OVERLAP_FRAMES, previewNodeKey, turboEffective, effectiveSteps } from "./graphBuilder";
import { ltxUpscaleReady, ltxUpscaleMissing, type LtxLoraEntry } from "./core";
import { faceRefineReady, faceRefineMissing } from "./core";

export function renderMinimaxH3(container: HTMLElement) {
  const state: MinimaxState = defaultState(loadState());
  const persist = () => saveState(state);

  // Pipeline accordion — collapsible sections for the per-axis controls (SPEC_MINIMAX_H3_
  // PIPELINE_AXES.md Part 3). Expand state persists across reloads but isn't part of
  // MinimaxState (it's UI-only, not a generation setting).
  const ACCORDION_KEY = "aos_mmh3_accordion_open";
  let accordionOpen: Record<string, boolean> = {};
  try { accordionOpen = JSON.parse(localStorage.getItem(ACCORDION_KEY) || "{}"); } catch {}
  function saveAccordionOpen() {
    try { localStorage.setItem(ACCORDION_KEY, JSON.stringify(accordionOpen)); } catch {}
  }
  // bodyThunk only runs while the section is (or becomes) open, so a collapsed section builds
  // nothing — matters for the heavier ones (Images/LoRA mount their own sub-panels).
  function accordion(key: string, title: string, summary: string, bodyThunk: () => (Node | null | undefined)[]) {
    const det = el("details", {}) as HTMLDetailsElement;
    det.open = accordionOpen[key] === true; // default collapsed
    const sum = el("summary", { style: { cursor: "pointer", fontSize: "11px", color: C.text, fontWeight: "700", userSelect: "none" } });
    sum.append(el("span", { text: title }), el("span", { text: `  —  ${summary}`, style: { color: C.muted, fontWeight: "400", textTransform: "none" } }));
    const bodyWrap = el("div", { style: { marginTop: "6px" } });
    if (det.open) bodyWrap.append(...bodyThunk().filter((b): b is Node => !!b));
    det.addEventListener("toggle", () => {
      accordionOpen[key] = det.open;
      saveAccordionOpen();
      if (det.open && !bodyWrap.childNodes.length) bodyWrap.append(...bodyThunk().filter((b): b is Node => !!b));
    });
    det.append(sum, bodyWrap);
    return panel([det]);
  }
  // ModelPreviewOverrideKJ가 프레임을 이 id로 태깅해 보낸다 — 탭마다 하나씩 생기므로 고정 문자열로 충분.
  const instanceId = "mmh3_web";
  // 이 클립이 지금 샘플링 중일 때만 true — queuePrompt가 resolve된 뒤(또는 결과 영상을
  // 이미 보여준 뒤) 뒤늦게 도착하는 kj_preview_override 이벤트가 결과 화면을 다시
  // 라이브 프리뷰로 덮어써버리는 버그의 원인이었다. resolve 직후 바로 false로 내린다.
  let samplingActive = false;

  let popTimer: number | undefined;
  const wrap = el("div", { class: "flex flex-col h-full", style: { color: C.text, fontFamily: "inherit" } });

  // Persistent "backend node packs missing" strip — mirrors the node pack's
  // banner. Guidance only, no in-app installer (depBanner.ts). Re-rendered on
  // every availability refresh; hides itself when nothing is missing.
  const depBannerEl = el("div", { style: { display: "none", flexShrink: "0" } });
  const depBannerDismissed = { v: false };
  const refreshDepBanner = () => renderDepBanner(depBannerEl, ctx.availabilityInfo, depBannerDismissed);

  const pop = el("div", {
    style: {
      position: "fixed", bottom: "30px", left: "50%", transform: "translateX(-50%)",
      background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "6px",
      padding: "6px 14px", fontSize: "11px", color: C.text, zIndex: "10001",
      maxWidth: "80%", textAlign: "center", pointerEvents: "none", transition: "opacity .3s", opacity: "0",
    },
  });
  function showPopup(msg: string, isError = true) {
    pop.textContent = msg;
    pop.style.color = isError ? C.err : BRAND;
    pop.style.opacity = "1";
    window.clearTimeout(popTimer);
    popTimer = window.setTimeout(() => (pop.style.opacity = "0"), 4000);
  }

  // SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §8 — filenames confirmed missing from ComfyUI's
  // input/ folder, checked in one batch (not per-tile) right after a prompt-set load. A getter
  // (not a plain field copied at construction time) so every ctx holding a reference — the
  // shared one below and Prompt Edit's own — sees the same up-to-date set without restaging.
  // SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §14 — user-saved pipeline presets. Server-side (not
  // localStorage): has to survive a browser reset, and a preset is something you tell someone
  // else by name, which only means anything if it lives somewhere shared.
  let userPresets: UserPipelinePreset[] = [];
  let userPresetsLoaded = false;
  async function loadUserPresets() {
    try {
      userPresets = await getUserPresets();
    } catch {}
    userPresetsLoaded = true;
    renderLeft();
  }

  // Reorder / rename / delete a saved preset. Reorder is up/down buttons rather than drag —
  // same end result (the list order persists and is what the dropdown shows), simpler to get
  // right on a short list. Delete is the one irreversible action here, so it always confirms.
  async function savePresetList(next: UserPipelinePreset[]) {
    userPresets = next;
    try {
      await saveUserPresets(next);
    } catch (e: any) {
      showPopup(`Save failed: ${e.message || e}`, true);
    }
  }
  function openPresetManager() {
    const ov = el("div", { class: "fixed inset-0 z-[100060] flex items-center justify-center", style: { background: "rgba(0,0,0,0.7)" } });
    const box = el("div", { class: "flex flex-col gap-2", style: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "16px 18px", width: "380px", maxWidth: "94%", maxHeight: "80vh", boxShadow: "0 16px 50px rgba(0,0,0,0.6)" } });
    const hdr = el("div", { class: "flex items-center gap-2" }, [
      el("div", { text: "Manage saved presets", class: "flex-1", style: { color: "#fff", fontSize: "13px", fontWeight: "700" } }),
      button("✕", () => ov.remove(), "danger"),
    ]);
    const list = el("div", { class: "flex flex-col gap-1.5 overflow-y-auto", style: { minHeight: "0" } });
    box.append(hdr, list);
    ov.appendChild(box);
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);

    function renderList() {
      clear(list);
      if (!userPresets.length) {
        list.appendChild(el("div", { text: "No saved presets yet — use Save on the Preset dropdown.", style: { fontSize: "11px", color: C.muted, padding: "8px 0" } }));
        return;
      }
      userPresets.forEach((p, i) => {
        const row2 = el("div", { class: "flex items-center gap-1.5 rounded-md", style: { background: C.bg2, border: `1px solid ${C.border}`, padding: "6px 8px" } });
        row2.appendChild(el("div", { text: p.name, class: "flex-1 overflow-hidden text-ellipsis whitespace-nowrap", style: { fontSize: "11.5px", color: C.text } }));
        const up = el("button", { type: "button", text: "▲", title: "Move up", style: { cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? "0.35" : "1", background: "transparent", color: C.text, border: "none", fontSize: "11px", padding: "2px 4px" } });
        const down = el("button", { type: "button", text: "▼", title: "Move down", style: { cursor: i === userPresets.length - 1 ? "default" : "pointer", opacity: i === userPresets.length - 1 ? "0.35" : "1", background: "transparent", color: C.text, border: "none", fontSize: "11px", padding: "2px 4px" } });
        const ren = el("button", { type: "button", text: "✎", title: "Rename", style: { cursor: "pointer", background: "transparent", color: C.text, border: "none", fontSize: "12px", padding: "2px 4px" } });
        const del = el("button", { type: "button", text: "🗑", title: "Delete", style: { cursor: "pointer", background: "transparent", color: C.err, border: "none", fontSize: "12px", padding: "2px 4px" } });
        up.addEventListener("click", async () => {
          if (i === 0) return;
          const next = userPresets.slice();
          [next[i - 1], next[i]] = [next[i], next[i - 1]];
          await savePresetList(next);
          renderList();
          renderLeft();
        });
        down.addEventListener("click", async () => {
          if (i === userPresets.length - 1) return;
          const next = userPresets.slice();
          [next[i + 1], next[i]] = [next[i], next[i + 1]];
          await savePresetList(next);
          renderList();
          renderLeft();
        });
        ren.addEventListener("click", async () => {
          const name = await promptDialog("Rename this preset:", p.name);
          if (name == null) return;
          const trimmed = name.trim();
          if (!trimmed || trimmed === p.name) return;
          if (userPresets.some((x) => x.name === trimmed)) { showPopup(`"${trimmed}" already exists.`, true); return; }
          const next = userPresets.map((x, j) => (j === i ? { ...x, name: trimmed } : x));
          await savePresetList(next);
          renderList();
          renderLeft();
        });
        del.addEventListener("click", async () => {
          if (!(await confirmDialog(`Delete "${p.name}"? This can't be undone.`))) return;
          const next = userPresets.filter((_, j) => j !== i);
          await savePresetList(next);
          renderList();
          renderLeft();
        });
        row2.append(up, down, ren, del);
        list.appendChild(row2);
      });
    }
    renderList();
  }

  let missingAssets = new Set<string>();
  async function refreshMissingAssets() {
    const names = new Set<string>();
    const addAll = (list: (string | null | undefined)[]) => list.forEach((n) => n && names.add(n));
    addAll([state.firstFrameImage, state.lastFrameImage, ...(state.refImages || [])]);
    (state.refVideos || []).forEach((v) => v?.file && names.add(v.file));
    (state.refAudios || []).forEach((a) => a?.file && names.add(a.file));
    (state.prompts || []).forEach((raw) => {
      const p = raw as any;
      if (typeof p === "string" || !p) return;
      if (promptOverrides(p)) {
        addAll([p.firstFrame, p.lastFrame, ...(p.refImages || [])]);
        (p.refVideos || []).forEach((v: any) => v?.file && names.add(v.file));
        (p.refAudios || []).forEach((a: any) => a?.file && names.add(a.file));
      } else if (p.firstFrame) {
        names.add(p.firstFrame);
      }
    });
    const missing = await checkInputExists([...names]);
    missingAssets = new Set(missing);
    if (missing.length) {
      const shown = missing.slice(0, 4).join(", ");
      const more = missing.length > 4 ? ` and ${missing.length - 4} more` : "";
      showPopup(`${missing.length} file(s) missing from the input folder: ${shown}${more}`, true);
    }
    renderLeft();
  }

  // 도구 전역에서 공유하는 컨텍스트 — Settings/Prompt Edit/(이후) Generate 루프가 같이 씀
  const ctx: SettingsCtx = {
    persist,
    showPopup,
    refreshPlan: () => refreshPlan(),
    refreshModes: () => { renderPills(); renderLeft(); refreshPreviewToggleBtn(); },
    availability: {},
    availableModels: undefined,
    get missingAssets() { return missingAssets; },
  };

  // ── 도구 서브바(모드 필/아이콘 버튼) ─────────────────────────────────
  const subBar = el("div", { class: "aos-sub-bar flex items-center gap-2 px-4 h-12 border-b border-border shrink-0" });
  const pillsWrap = el("div", { class: "aos-mode-bar-wrap flex-1" });
  const warnTag = el("div", {
    class: "hidden items-center gap-1.5 cursor-pointer text-xs rounded-md px-2.5 py-1 max-w-md truncate",
    style: { color: C.warn, background: "rgba(255,179,71,0.12)", border: `1px solid ${C.warn}` },
  });
  const settingsOv = createSettingsOverlay(state, ctx);

  // ── Help 오버레이 (원본 6개 섹션 그대로) ────────────────────────────
  const helpOv = el("div", {
    class: "fixed inset-0 z-[9998] flex-col p-3.5 gap-2.5 box-border",
    style: { display: "none", background: "rgba(11,11,11,0.98)" },
  });
  const helpTop = el("div", { class: "flex items-center gap-2 shrink-0" });
  helpTop.append(el("div", { text: "MiniMax H3 ONE STUDIO — Help", class: "text-white text-sm font-bold flex-1" }), button("✕", () => (helpOv.style.display = "none"), "danger"));
  const helpBody = el("div", { class: "flex-1 overflow-y-auto flex flex-col gap-2.5" });
  ([
    ["How the relay works", "A clip's length is capped by the model's frame grid, so a long video is rendered as several clips, one queue submission each. Every clip is saved on its own, and when the run finishes they're concatenated into one file. ComfyUI unloads models between submissions, which is what keeps a 16GB card from spilling into system memory on a long run."],
    ["Clip length", "MiniMax H3 only accepts frame counts on a 17k+5 grid, so the dropdown lists the exact legal lengths instead of letting you type seconds that would silently snap. 8.00s (192 frames) is the only option that lands on a whole second at 24fps."],
    ["Modes", "Text only — prompt alone. First/Last Frame — supply a start (and optionally end) keyframe. Reference — up to 9 reference images, addressed in the prompt as <Picture 1>, <Picture 2>…  Reference mode uses its own UNET, set separately in Settings."],
    ["Continuity", "Last Frame Chain feeds each clip's final frame in as the next clip's first frame — motion continues, but colour and detail drift a little every hop, which usually shows past 6-8 clips. Reference keeps a face consistent but does not carry motion across the cut. Neither is perfect; that's the model, not the node."],
    ["Live preview", "While a clip samples, decoded frames are streamed into the preview box. Raise Preview frames in Settings for a moving preview (mp4) rather than a still; it costs a little time per step. Needs comfyui-kjnodes."],
    ["Audio", "H3 generates a soundtrack per clip, so a stitched video has an audible seam at each clip boundary. For music, lay a separate track over the result instead of relying on the per-clip audio."],
  ] as const).forEach(([title, bodyText]) => {
    const block = el("div", { class: "rounded-lg", style: { background: C.bg1, border: `1px solid ${C.border}`, padding: "10px 12px" } });
    block.append(el("div", { text: title, class: "text-xs font-bold mb-1.5", style: { color: BRAND } }), el("div", { text: bodyText, class: "text-[11.5px] leading-relaxed", style: { color: C.text } }));
    helpBody.appendChild(block);
  });
  helpOv.append(helpTop, helpBody);

  subBar.append(
    pillsWrap,
    warnTag,
    iconBtn("⚙", "Settings", () => settingsOv.show()),
    iconBtn("🖼", "Gallery", () => galleryOv.show()),
    iconBtn("?", "Help", () => (helpOv.style.display = "flex"))
  );

  function renderPills() {
    pillsWrap.innerHTML = "";
    const modes = generationModesFor(state);
    if (!modes.find((m) => m.key === state.generationMode)?.enabled) {
      const first = modes.find((m) => m.enabled);
      if (first) {
        state.generationMode = first.key;
        persist();
      }
    }
    pillsWrap.appendChild(
      modeBar(modes, state.generationMode, (key) => {
        state.generationMode = key;
        if (!turboModesFor(key).some((m) => m.key === state.turboMode)) state.turboMode = "none";
        persist();
        renderPills();
        renderLeft();
        renderPrompts();
      })
    );

    const issues = configIssues(state);
    const off = modes.filter((m) => !m.enabled).map((m) => m.label);
    const parts: string[] = [];
    if (issues.length) parts.push(`Settings needs ${issues.join(", ")}`);
    else if (off.length) parts.push(`${off.join(" / ")} unavailable — UNET not set`);
    if (parts.length) {
      warnTag.innerHTML = `<span>⚠</span><span>${parts.join(" · ")}</span>`;
      warnTag.title = `${parts.join("\n")}\n\nClick to open Settings.`;
      warnTag.classList.remove("hidden");
      warnTag.classList.add("flex");
    } else {
      warnTag.classList.add("hidden");
      warnTag.classList.remove("flex");
    }
  }
  warnTag.addEventListener("click", () => settingsOv.show());

  // ── 메인 영역: 좌측 컨트롤 레일 + 우측 프리뷰/프롬프트 ───────────────
  // 갤러리는 하단에 고정 크기(shrink-0)로 두고, 이 mainRow가 flex-1로 남는 세로 공간을
  // 전부 차지한다 — 화면이 커질수록 프리뷰/컨트롤이 비례해서 커지고, 갤러리 크기는 안정적으로 유지.
  const mainRow = el("div", { class: "flex flex-col lg:flex-row gap-4 p-4 flex-1 min-h-0" });
  const leftOuter = el("div", { class: "flex flex-col w-full lg:w-[450px] shrink-0 gap-2 lg:h-full min-h-0", style: { position: "relative" } });
  // LTX Upscale has no per-field disable wiring (unlike H3's own controls) — a single
  // blocking overlay over the whole left column is simpler and covers all of it (source
  // pick/upload, refine params, segment planner, LoRA list, post finish) while a run is in
  // progress. Toggled on/off in runLtxUpscale(); never shown for the other generation modes.
  const leftLockOverlay = el("div", {
    class: "absolute inset-0 z-[20] hidden items-center justify-center text-center text-[11px]",
    style: { background: "rgba(10,10,14,0.55)", cursor: "not-allowed", color: "#cfcfcf", borderRadius: "8px" },
  });
  leftLockOverlay.innerHTML = "⏳ LTX Upscale running…<br><span style='font-size:9px'>settings locked until it finishes</span>";
  function setLeftLocked(on: boolean) {
    leftLockOverlay.classList.toggle("hidden", !on);
    leftLockOverlay.classList.toggle("flex", on);
  }
  const leftPanel = el("div", { class: "flex flex-col gap-1.5 overflow-y-auto pr-1 flex-1 min-h-0" });
  leftOuter.appendChild(leftPanel);
  leftOuter.appendChild(leftLockOverlay);

  const rightPanel = el("div", { class: "flex flex-col gap-4 flex-1 min-w-0 min-h-0" });

  // ── 프리뷰 박스 ───────────────────────────────────────────────────
  // 고정 vh 상한 대신 남는 공간을 채우는 flex-1 — 위 mainRow가 커지면 이것도 같이 커진다.
  // 내용물(이미지/비디오)은 object-fit:contain이라 박스 자체가 정확히 16:9가 아니어도
  // 레터박스로 비율이 유지된다.
  const previewBox = el("div", {
    class: "relative w-full min-h-[220px] flex items-center justify-center overflow-hidden rounded-lg bg-black border border-border mx-auto",
    style: { maxWidth: "100%", flex: "6.60 1 0%" },
  });
  const placeholder = el("div", { class: "text-muted text-xs text-center leading-relaxed" });
  placeholder.innerHTML = "▶ Generate to render the first clip<br><span style='font-size:10px'>live sampling frames appear here</span>";
  const FIT = { width: "100%", height: "100%", objectFit: "contain" as const, display: "none" };
  const previewImg = el("img", { style: { ...FIT } });
  // controls 추가 — 생성 중 스트리밍되는 라이브 프리뷰(mp4 스니펫)도 재생/일시정지/탐색 가능.
  // 새 프레임이 도착하면 src가 갱신되지만, controls 자체는 계속 유지된다.
  const previewVid = el("video", { autoplay: "", loop: "", muted: "", playsinline: "", controls: "", style: { ...FIT } }) as HTMLVideoElement;
  previewVid.muted = true;
  const resultVid = el("video", { controls: "", loop: "", playsinline: "", style: { ...FIT } }) as HTMLVideoElement;
  const badge = el("div", {
    class: "absolute top-2 left-1/2 -translate-x-1/2 z-[6] rounded-full text-[10px] font-bold tracking-wide hidden",
    style: { background: "rgba(0,0,0,0.7)", color: "#fff", padding: "3px 10px" },
  });
  const fsBtn = el("button", {
    type: "button", text: "⛶", title: "Fullscreen",
    class: "absolute top-1.5 right-1.5 z-[6] hidden",
    style: { background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", borderRadius: "4px", width: "22px", height: "22px", cursor: "pointer", fontSize: "12px", padding: "0" },
  });
  // Face Refine / LTX Upscale results have a source clip to compare against — those two
  // modes get this button instead of fsBtn (openCompareViewer already covers fullscreen
  // viewing via its own overlay). The 3 core generation modes (t2v/firstlast/reference)
  // keep fsBtn untouched.
  const compareBtn = el("button", {
    type: "button", text: "◐", title: "Compare with original",
    class: "absolute top-1.5 right-1.5 z-[6] hidden",
    style: { background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", borderRadius: "4px", width: "22px", height: "22px", cursor: "pointer", fontSize: "12px", padding: "0" },
  });
  // 라이브 프리뷰가 off일 때 샘플링 중에는 이 검은 화면 + 문구만 보여준다(마지막 프레임이
  // 화면에 그대로 남아있지 않게). 다시 on으로 바꾸면 다음 프레임이 도착할 때 자연스럽게
  // showPreviewFrame이 이 화면을 걷어낸다.
  const previewOffMsg = el("div", { class: "text-muted text-xs text-center leading-relaxed hidden" });
  previewOffMsg.innerHTML = "⏸ Live preview off<br><span style='font-size:10px'>Generating…</span>";
  // Face Refine's own pre-sampling banner — tracking/detection runs before sampling and
  // streams nothing of its own, so the screen would otherwise look stuck for that whole
  // stretch. Mirrors the node's frDetectBanner (one_node_minimax_h3.js runFaceRefine). Cleared
  // from BOTH paths that mean "real content is now arriving": a live preview frame
  // (showPreviewFrame) and a numeric step-progress callback (setStepProgress / onKJPreview) —
  // whichever happens to arrive first for a given run.
  const frDetectBanner = el("div", {
    class: "absolute inset-0 z-[5] flex items-center justify-center text-center hidden",
    style: { background: "rgba(0,0,0,0.55)" },
  });
  frDetectBanner.innerHTML = "<div style='font-size:18px;font-weight:700;color:#b57bff;text-shadow:0 0 12px rgba(181,123,255,0.5);padding:24px 16px;'>🔍 Detecting &amp; tracking faces…</div>";
  // 라이브 프리뷰 온/오프 — off일 때는 새 스텝이 와도 화면을 갱신하지 않는다(진행률 텍스트는 계속 반영).
  // Settings의 previewEnabled와 같은 값을 공유해 여기서 끄면 Settings에도 반영된다.
  const previewToggleBtn = el("button", {
    type: "button", title: "Toggle live preview while sampling",
    class: "absolute top-1.5 right-9 z-[6]",
    style: { background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", borderRadius: "4px", height: "22px", padding: "0 8px", cursor: "pointer", fontSize: "10px", fontWeight: "700" },
  });
  function refreshPreviewToggleBtn() {
    const on = state.previewEnabled !== false;
    previewToggleBtn.textContent = on ? "🔴 LIVE" : "⏸ LIVE OFF";
    previewToggleBtn.style.color = on ? "#fff" : "#999";
    applyPreviewOffState();
  }
  // off로 바뀌는 순간(또는 off 상태에서 샘플링이 시작되는 순간) 화면을 즉시 검은 화면 +
  // 문구로 비우고, on이면 그 화면을 치운다(실제 프레임 표시는 다음 onKJPreview가 담당).
  function applyPreviewOffState() {
    const shouldBlank = state.previewEnabled === false && samplingActive;
    if (shouldBlank) {
      placeholder.style.display = "none";
      previewImg.style.display = "none";
      previewVid.style.display = "none";
      try { resultVid.pause(); } catch {}
      resultVid.style.display = "none";
      previewOffMsg.classList.remove("hidden");
    } else {
      previewOffMsg.classList.add("hidden");
    }
  }
  previewToggleBtn.addEventListener("click", () => {
    state.previewEnabled = state.previewEnabled === false ? true : false;
    persist();
    refreshPreviewToggleBtn();
  });
  refreshPreviewToggleBtn();

  // Drag-resize the preview box height (node v1.23.0 parity). Node's canvas widget has a fixed
  // total node height, so shrinking the preview grows the PROMPTS list below it for free — same
  // effect here: switching previewBox from its flex-ratio default to a fixed px height leaves
  // promptWrap (flex: 2 1 0%) to absorb whatever space that frees in rightPanel.
  const PREVIEW_H_KEY = "aos_mmh3_preview_h";
  const resizeHandle = el("div", {
    class: "absolute bottom-0 inset-x-0 z-[6]",
    style: { height: "8px", cursor: "ns-resize" },
    title: "Drag to resize the preview box",
  });
  resizeHandle.addEventListener("mouseenter", () => { resizeHandle.style.background = "rgba(255,255,255,0.08)"; });
  resizeHandle.addEventListener("mouseleave", () => { resizeHandle.style.background = "transparent"; });
  // Pointer Events + setPointerCapture instead of window mousemove/mouseup (node-side fix
  // 64fdd02): a drag that crosses the native <video> control's toolbar can let the control
  // swallow the mouseup before it reaches a window listener, leaving the handle stuck
  // "grabbed". Capturing the pointer on the handle itself guarantees it keeps getting
  // pointermove/pointerup regardless of what's under the cursor.
  resizeHandle.addEventListener("pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    resizeHandle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = previewBox.getBoundingClientRect().height;
    const onMove = (ev: PointerEvent) => {
      const h = Math.max(220, Math.min(720, Math.round(startH + (ev.clientY - startY))));
      previewBox.style.flex = `0 0 ${h}px`;
    };
    const onUp = (ev: PointerEvent) => {
      resizeHandle.removeEventListener("pointermove", onMove);
      resizeHandle.removeEventListener("pointerup", onUp);
      resizeHandle.removeEventListener("pointercancel", onUp);
      try { resizeHandle.releasePointerCapture(ev.pointerId); } catch {}
      try { localStorage.setItem(PREVIEW_H_KEY, String(parseInt(previewBox.style.flex.split(" ")[2] || "0", 10))); } catch {}
    };
    resizeHandle.addEventListener("pointermove", onMove);
    resizeHandle.addEventListener("pointerup", onUp);
    resizeHandle.addEventListener("pointercancel", onUp);
  });
  try {
    const savedH = parseInt(localStorage.getItem(PREVIEW_H_KEY) || "", 10);
    if (savedH && Number.isFinite(savedH)) previewBox.style.flex = `0 0 ${Math.max(220, Math.min(720, savedH))}px`;
  } catch {}

  previewBox.append(placeholder, previewImg, previewVid, resultVid, previewOffMsg, frDetectBanner, badge, fsBtn, compareBtn, previewToggleBtn, resizeHandle);

  let lastResultURL: string | null = null;
  fsBtn.addEventListener("click", () => {
    if (lastResultURL) window.open(lastResultURL, "_blank");
  });
  compareBtn.addEventListener("click", () => {
    if (!lastResultURL) return;
    const origFile = state.generationMode === "facerefine" ? state.frSource
                    : state.generationMode === "ltxupscale" ? state.ltxSource : null;
    if (!origFile) return;
    openCompareViewer(`${comfyApi.base}/view?filename=${encodeURIComponent(origFile)}&type=input`, lastResultURL);
  });

  // Original / Restored / Compare (wipe) / Side-by-side viewer for a finished Face Refine
  // or LTX Upscale result against the clip it started from. Ported from
  // one_node_minimax_h3.js openCompareViewer(). Wheel to zoom, drag to pan, double-click to
  // reset — same gestures on Original/Restored/Compare; Side-by-side keeps both clips at
  // 1:1 so a direct pixel comparison isn't distorted by an unsynced zoom on only one side.
  function openCompareViewer(originalUrl: string, restoredUrl: string) {
    let mode: "original" | "restored" | "compare" | "side" = "compare";
    let wipe = 50; // percent, compare mode only
    let zoom = 1, panX = 0, panY = 0;
    const CFPS = 24; // this app's clips are constant-framerate 24fps throughout
    let kh: ((e: KeyboardEvent) => void) | null = null;

    const ov = el("div", { style: {
      position: "fixed", inset: "0", background: "rgba(10,10,14,0.97)", zIndex: "100060",
      display: "flex", flexDirection: "column",
    }});

    const tabsWrap = el("div", { style: {
      display: "flex", alignItems: "center", gap: "6px", padding: "10px 14px",
      borderBottom: `1px solid ${C.border}`, background: "#14141a", flexShrink: "0",
    }});
    const closeBtn = el("button", { type: "button", text: "✕ Close", style: {
      marginLeft: "auto", cursor: "pointer", fontFamily: "inherit", fontSize: "12px",
      padding: "6px 12px", borderRadius: "6px", background: "transparent", color: C.err,
      border: `1px solid ${C.border}`,
    }});
    function tabBtn(labelText: string, key: typeof mode) {
      const on = mode === key;
      const b = el("button", { type: "button", text: labelText, style: {
        cursor: "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: "600",
        padding: "6px 12px", borderRadius: "6px",
        border: `1px solid ${on ? BRAND : C.border}`, background: on ? BRAND : "transparent",
        color: on ? "#fff" : C.text,
      }});
      b.addEventListener("click", () => { mode = key; zoom = 1; panX = 0; panY = 0; renderTabs(); renderStage(); });
      return b;
    }
    function renderTabs() {
      clear(tabsWrap);
      tabsWrap.append(
        tabBtn("Original", "original"), tabBtn("Restored", "restored"),
        tabBtn("◐ Compare", "compare"), tabBtn("▦ Side by side", "side"), closeBtn,
      );
    }

    const stage = el("div", { style: {
      flex: "1", position: "relative", overflow: "hidden", background: "#000",
      display: "flex", alignItems: "center", justifyContent: "center", cursor: "grab",
    }});
    const stageInner = el("div", { style: {
      position: "relative", width: "100%", height: "100%",
      display: "flex", alignItems: "center", justifyContent: "center",
    }});
    stage.appendChild(stageInner);

    // Geometry (left/top/width/height) is set explicitly by layoutVideos() below, from
    // origVid's own aspect ratio only — NOT objectFit:"contain" on each video
    // independently. LTX Upscale's restored clip has a different native resolution than
    // the original (2x upscale); letting each <video> auto-fit against its OWN native size
    // independently visibly mismatched the two pictures (upscaled side showed noticeably
    // larger/closer subjects than the original side). objectFit:"fill" here is deliberate:
    // it forces restVid's pixels to exactly match origVid's on-screen rectangle rather than
    // trusting the file's own reported aspect ratio. Face Refine has no such mismatch (same
    // canvas in/out) but this shared rect is harmless for it too.
    const origVid = el("video", { src: originalUrl, loop: "", muted: "", playsinline: "",
      style: { position: "absolute", objectFit: "fill" } }) as HTMLVideoElement;
    const restVid = el("video", { src: restoredUrl, loop: "", muted: "", playsinline: "",
      style: { position: "absolute", objectFit: "fill" } }) as HTMLVideoElement;
    origVid.muted = true; restVid.muted = true;

    const makeLabel = (text: string, side: "left" | "right") => el("div", { text, style: {
      position: "absolute", top: "10px", [side]: "10px", zIndex: "2",
      color: "#fff", fontSize: "12px", fontWeight: "700", textShadow: "0 1px 4px rgba(0,0,0,0.8)",
    } as any });
    const origLabel = makeLabel("Original", "left");
    const restLabel = makeLabel("Restored", "right");
    // Divider lives directly on `stage`, NOT inside a transformed container — it must stay
    // pinned at a fixed screen position while zoom/pan moves the footage underneath it, or
    // comparing while zoomed in is pointless. Same reasoning for restMask below.
    const divider = el("div", { style: {
      position: "absolute", top: "0", bottom: "0", width: "2px", background: "#fff",
      left: "50%", zIndex: "3", cursor: "ew-resize", touchAction: "none", display: "none",
    }});
    const divHandle = el("div", { text: "↔", style: {
      position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
      width: "34px", height: "34px", borderRadius: "50%", background: "#fff", color: "#111",
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.5)", cursor: "ew-resize", touchAction: "none",
    }});
    divider.appendChild(divHandle);

    // restVid's own wrapper: `restMask` is screen-fixed (same as `stage`, never
    // transformed) and does the wipe clipping in real screen pixels; `restInner` inside it
    // gets the exact same pan/zoom transform as `stageInner` so the restored footage still
    // zooms/pans in lock-step with the original — only the CUT LINE stays put.
    const restMask = el("div", { style: { position: "absolute", inset: "0", overflow: "hidden" } });
    const restInner = el("div", { style: {
      position: "relative", width: "100%", height: "100%",
      display: "flex", alignItems: "center", justifyContent: "center",
    }});
    restMask.appendChild(restInner);

    // Side-by-side pane (built once, plain 1:1 — no zoom/pan, so left vs right stays a true
    // pixel comparison rather than two independently-panned crops).
    const sideWrap = el("div", { style: {
      position: "absolute", inset: "0", display: "none", gap: "2px",
    }});
    // flex:1 belongs on the WRAPPER (the actual flex child of sideWrap) — putting it on the
    // <video> itself does nothing (its parent isn't a flex container), and leaves width:0 as
    // the only surviving rule, collapsing both videos to zero width.
    const sideOrig = el("video", { src: originalUrl, loop: "", muted: "", playsinline: "",
      style: { width: "100%", height: "100%", objectFit: "contain", background: "#000" } }) as HTMLVideoElement;
    const sideRest = el("video", { src: restoredUrl, loop: "", muted: "", playsinline: "",
      style: { width: "100%", height: "100%", objectFit: "contain", background: "#000" } }) as HTMLVideoElement;
    sideOrig.muted = true; sideRest.muted = true;
    const sideOrigWrap = el("div", { style: { position: "relative", flex: "1", height: "100%" } }, [sideOrig, makeLabel("Original", "left")]);
    const sideRestWrap = el("div", { style: { position: "relative", flex: "1", height: "100%" } }, [sideRest, makeLabel("Restored", "left")]);
    sideWrap.append(sideOrigWrap, sideRestWrap);

    stageInner.append(origVid);
    restInner.append(restVid);
    // Labels are fixed UI chrome, same reasoning as the divider — not appended inside
    // stageInner/restInner, or they'd zoom/pan along with the footage too.
    stage.append(restMask, divider, origLabel, restLabel, sideWrap);

    function applyTransform() {
      const t = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      stageInner.style.transform = t;
      restInner.style.transform = t;
    }
    // A "contain" fit inside `stage` can letterbox/pillarbox when the video's aspect ratio
    // doesn't match the stage's — a wipe % of the whole STAGE width then lands somewhere
    // other than that same % across the actual picture. Computed from origVid's aspect
    // ratio ONLY, and BOTH videos are explicitly sized/positioned to this exact rect
    // (objectFit:"fill" on both, see their creation above) — an upscale changes resolution,
    // not framing, but letting restVid auto-fit against its own (higher) native resolution
    // independently still visibly mismatched the two pictures' apparent scale. Forcing one
    // shared rect guarantees they always register at identical scale/position.
    function contentRect() {
      const cw = stage.clientWidth || 1, ch = stage.clientHeight || 1;
      const vw = origVid.videoWidth || cw, vh = origVid.videoHeight || ch;
      const fit = Math.min(cw / vw, ch / vh);
      const dispW = vw * fit, dispH = vh * fit;
      return { left: (cw - dispW) / 2, top: (ch - dispH) / 2, width: dispW, height: dispH };
    }
    function layoutVideos() {
      const r = contentRect();
      for (const v of [origVid, restVid]) {
        v.style.left = `${r.left}px`; v.style.top = `${r.top}px`;
        v.style.width = `${r.width}px`; v.style.height = `${r.height}px`;
      }
      return r;
    }
    function wipePx() {
      const r = layoutVideos();
      return r.left + (wipe / 100) * r.width;
    }
    function renderStage() {
      const isSide = mode === "side";
      stageInner.style.display = isSide ? "none" : "flex";
      restMask.style.display = isSide ? "none" : "block";
      sideWrap.style.display = isSide ? "flex" : "none";
      origVid.style.display = mode === "original" || mode === "compare" ? "block" : "none";
      restVid.style.display = mode === "restored" || mode === "compare" ? "block" : "none";
      origLabel.style.display = mode === "compare" ? "block" : "none";
      restLabel.style.display = mode === "compare" ? "block" : "none";
      divider.style.display = mode === "compare" ? "block" : "none";
      if (!isSide) layoutVideos();
      if (mode === "compare") {
        const px = wipePx();
        divider.style.left = `${px}px`;
        restMask.style.clipPath = `inset(0 0 0 ${px}px)`;
      } else {
        restMask.style.clipPath = "none";
      }
      wipeRow.style.display = mode === "compare" ? "flex" : "none";
      applyTransform();
    }
    // videoWidth/videoHeight are 0 until metadata loads, and the modal's own size can change
    // (window resize) — recompute the content rect whenever either happens.
    origVid.addEventListener("loadedmetadata", () => renderStage());
    const onWinResize = () => renderStage();
    window.addEventListener("resize", onWinResize);

    // ── wheel-zoom (cursor-anchored) + drag-to-pan + double-click reset ──
    stage.addEventListener("wheel", (e) => {
      if (mode === "side") return;
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - rect.height / 2;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const nextZoom = Math.min(6, Math.max(1, zoom * factor));
      panX = mx - (mx - panX) * (nextZoom / zoom);
      panY = my - (my - panY) * (nextZoom / zoom);
      zoom = nextZoom;
      if (zoom === 1) { panX = 0; panY = 0; }
      applyTransform();
    }, { passive: false });
    stage.addEventListener("pointerdown", (e) => {
      if (mode === "side" || e.target === divider || e.target === divHandle) return;
      stage.setPointerCapture(e.pointerId);
      stage.style.cursor = "grabbing";
      const startX = e.clientX, startY = e.clientY, baseX = panX, baseY = panY;
      const onMove = (ev: PointerEvent) => { panX = baseX + (ev.clientX - startX); panY = baseY + (ev.clientY - startY); applyTransform(); };
      const onUp = (ev: PointerEvent) => {
        stage.releasePointerCapture(ev.pointerId);
        stage.style.cursor = "grab";
        stage.removeEventListener("pointermove", onMove);
        stage.removeEventListener("pointerup", onUp);
        stage.removeEventListener("pointercancel", onUp);
      };
      stage.addEventListener("pointermove", onMove);
      stage.addEventListener("pointerup", onUp);
      stage.addEventListener("pointercancel", onUp);
    });
    stage.addEventListener("dblclick", () => { zoom = 1; panX = 0; panY = 0; applyTransform(); });

    // ── compare divider drag ──
    const onDividerDown = (e: PointerEvent) => {
      e.stopPropagation();
      divider.setPointerCapture(e.pointerId);
      const onMove = (ev: PointerEvent) => {
        const rect = stage.getBoundingClientRect();
        const r = contentRect();
        const px = ev.clientX - rect.left;
        wipe = Math.min(100, Math.max(0, ((px - r.left) / r.width) * 100));
        const clampedPx = wipePx();
        divider.style.left = `${clampedPx}px`;
        restMask.style.clipPath = `inset(0 0 0 ${clampedPx}px)`;
        wipeSlider.value = String(Math.round(wipe));
        wipeLabel.textContent = `${Math.round(wipe)}%`;
      };
      const onUp = (ev: PointerEvent) => {
        divider.releasePointerCapture(ev.pointerId);
        divider.removeEventListener("pointermove", onMove);
        divider.removeEventListener("pointerup", onUp);
      };
      divider.addEventListener("pointermove", onMove);
      divider.addEventListener("pointerup", onUp);
    };
    divider.addEventListener("pointerdown", onDividerDown);
    divHandle.addEventListener("pointerdown", onDividerDown);

    // ── footer: sync play/pause + scrub across whichever videos are active ──
    const footer = el("div", { style: {
      display: "flex", flexDirection: "column", gap: "8px", padding: "10px 14px",
      borderTop: `1px solid ${C.border}`, background: "#14141a", flexShrink: "0",
    }});
    const scrub = el("input", { type: "range", min: "0", max: "1000", value: "0", style: { width: "100%" } }) as HTMLInputElement;
    const timeRow = el("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "11px", color: C.muted } });
    const timeText = el("div", { text: "00:00.000 / 00:00.000" });
    timeRow.append(timeText);
    const ctrlRow = el("div", { style: { display: "flex", alignItems: "center", gap: "10px" } });
    const playBtn = el("button", { type: "button", text: "▶", style: {
      cursor: "pointer", fontFamily: "inherit", fontSize: "13px", width: "34px", height: "28px",
      borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`,
    }});
    const prevBtn = el("button", { type: "button", text: "◀|", style: {
      cursor: "pointer", fontFamily: "inherit", fontSize: "11px", width: "34px", height: "28px",
      borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`,
    }});
    const nextBtn = el("button", { type: "button", text: "|▶", style: {
      cursor: "pointer", fontFamily: "inherit", fontSize: "11px", width: "34px", height: "28px",
      borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`,
    }});
    const frameText = el("div", { text: "Frame 0 / 0", style: { fontSize: "11px", color: C.muted } });
    const wipeRow = el("div", { style: { display: "none", alignItems: "center", gap: "8px", marginLeft: "auto" } });
    const wipeSlider = el("input", { type: "range", min: "0", max: "100", value: "50", style: { width: "140px" } }) as HTMLInputElement;
    const wipeLabel = el("div", { text: "50%", style: { fontSize: "11px", color: C.muted, minWidth: "32px" } });
    wipeRow.append(el("div", { text: "Wipe", style: { fontSize: "11px", color: C.muted } }), wipeSlider, wipeLabel);
    ctrlRow.append(playBtn, prevBtn, nextBtn, frameText, wipeRow);
    footer.append(scrub, timeRow, ctrlRow);

    wipeSlider.addEventListener("input", () => {
      wipe = parseFloat(wipeSlider.value);
      const px = wipePx();
      divider.style.left = `${px}px`;
      restMask.style.clipPath = `inset(0 0 0 ${px}px)`;
      wipeLabel.textContent = `${Math.round(wipe)}%`;
    });

    function fmtT(s: number) {
      s = Math.max(0, s || 0);
      const m = Math.floor(s / 60), sec = s - m * 60;
      return `${String(m).padStart(2, "0")}:${sec.toFixed(3).padStart(6, "0")}`;
    }
    // The "master" clock is always origVid — restVid (and the two side clips) are kept in
    // lock-step with it, since a Face Refine / LTX Upscale output has the same frame count
    // as the clip it started from.
    function allVids() { return [origVid, restVid, sideOrig, sideRest]; }
    function syncTo(t: number) {
      for (const v of allVids()) { if (Math.abs(v.currentTime - t) > 0.03) { try { v.currentTime = t; } catch {} } }
    }
    let playing = false;
    function setPlaying(p: boolean) {
      playing = p;
      playBtn.textContent = playing ? "⏸" : "▶";
      for (const v of allVids()) { try { playing ? v.play().catch(() => {}) : v.pause(); } catch {} }
    }
    playBtn.addEventListener("click", () => setPlaying(!playing));
    prevBtn.addEventListener("click", () => { setPlaying(false); syncTo(Math.max(0, origVid.currentTime - 1 / CFPS)); });
    nextBtn.addEventListener("click", () => { setPlaying(false); syncTo(Math.min(origVid.duration || 0, origVid.currentTime + 1 / CFPS)); });
    scrub.addEventListener("input", () => {
      setPlaying(false);
      const dur = origVid.duration || 0;
      syncTo((parseFloat(scrub.value) / 1000) * dur);
    });
    origVid.addEventListener("timeupdate", () => {
      const dur = origVid.duration || 0;
      if (dur > 0) scrub.value = String(Math.round((origVid.currentTime / dur) * 1000));
      timeText.textContent = `${fmtT(origVid.currentTime)} / ${fmtT(dur)}`;
      frameText.textContent = `Frame ${Math.round(origVid.currentTime * CFPS)} / ${Math.round(dur * CFPS)}`;
    });

    function close() {
      if (kh) document.removeEventListener("keydown", kh);
      window.removeEventListener("resize", onWinResize);
      for (const v of allVids()) { try { v.pause(); v.removeAttribute("src"); v.load(); } catch {} }
      document.body.removeChild(ov);
    }
    kh = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", kh);
    closeBtn.addEventListener("click", close);

    ov.append(tabsWrap, stage, footer);
    document.body.appendChild(ov);
    // Must attach to the document first — renderStage()/layoutVideos() read
    // stage.clientWidth/Height, which are 0 on a detached element.
    renderTabs(); renderStage();
  }

  function showPreviewFrame(dataURL: string, mime?: string) {
    placeholder.style.display = "none";
    frDetectBanner.style.display = "none";
    previewOffMsg.classList.add("hidden");
    try { resultVid.pause(); } catch {}
    resultVid.style.display = "none";
    if (mime === "video/mp4") {
      previewImg.style.display = "none";
      previewVid.src = dataURL;
      previewVid.style.display = "block";
      previewVid.play?.().catch(() => {});
    } else {
      try { previewVid.pause(); } catch {}
      previewVid.style.display = "none";
      previewImg.src = dataURL;
      previewImg.style.display = "block";
    }
    badge.classList.remove("hidden");
  }
  function showResultVideo(url: string) {
    lastResultURL = url;
    placeholder.style.display = "none";
    previewOffMsg.classList.add("hidden");
    previewImg.style.display = "none";
    try { previewVid.pause(); } catch {}
    previewVid.style.display = "none";
    resultVid.src = url;
    resultVid.style.display = "block";
    try {
      resultVid.pause();
      resultVid.currentTime = 0;
    } catch {}
    const hasOriginal = (state.generationMode === "facerefine" && !!state.frSource)
      || (state.generationMode === "ltxupscale" && !!state.ltxSource);
    // The compare viewer already covers fullscreen viewing (its own overlay, zoom/pan) for
    // these two modes, so a separate fullscreen button is redundant there.
    fsBtn.classList.toggle("hidden", hasOriginal);
    compareBtn.classList.toggle("hidden", !hasOriginal);
  }
  function resetPreview() {
    placeholder.style.display = "block";
    previewOffMsg.classList.add("hidden");
    previewImg.style.display = "none";
    previewVid.style.display = "none";
    try {
      previewVid.pause();
      previewVid.removeAttribute("src");
      previewVid.load();
    } catch {}
    try { resultVid.pause(); } catch {}
    resultVid.style.display = "none";
    badge.classList.add("hidden");
    fsBtn.classList.add("hidden");
    compareBtn.classList.add("hidden");
  }

  const onKJPreview = (d: any) => {
    try {
      if (String(d?.node_id) !== previewNodeKey(instanceId)) return;
      if (d.step != null && d.total) setStepProgress(d.step, d.total);
      if (!samplingActive) return; // 늦게 도착한 프레임 — 이미 결과가 표시됐으면 무시
      if (!d.image) return;
      if (state.previewEnabled === false) return; // 꺼져 있으면 화면은 갱신하지 않는다
      showPreviewFrame(`data:${d.mime || "image/jpeg"};base64,${d.image}`, d.mime);
    } catch {}
  };
  comfyApi.addEventListener("kj_preview_override", onKJPreview);

  // ── 상태 바 ───────────────────────────────────────────────────────
  const statusWrap = el("div", { class: "flex flex-col gap-1 shrink-0" });
  const statusLine = el("div", { class: "flex items-center gap-2.5 text-xs" });
  const statusText = el("div", { text: "Idle", class: "flex-1 truncate" });
  const clockText = el("div", { text: "00:00:00", class: "text-muted tabular-nums" });
  statusLine.append(statusText, clockText);
  const barOuter = el("div", { class: "h-1.5 rounded overflow-hidden border border-border", style: { background: C.bg2 } });
  const barInner = el("div", { class: "h-full", style: { width: "0%", background: BRAND, transition: "width .15s linear" } });
  barOuter.appendChild(barInner);
  // 외부 큐 배너 — 새로고침하면 이 사이트가 자체 추적하던 진행 상황(relay loop)은
  // 끊기지만, ComfyUI 서버 자체는 그 작업을 계속 처리한다. 우리가 큐잉한 게 아니어도
  // "지금 뭔가 돌고 있다/기다리고 있다"는 사실은 주기적으로 폴링해서 놓치지 않는다.
  const externalQueueBanner = el("div", {
    class: "hidden items-center gap-1.5 text-[11px] rounded-md px-2 py-1",
    style: { color: C.warn, background: "rgba(255,179,71,0.12)", border: `1px solid ${C.warn}` },
  });
  statusWrap.append(statusLine, barOuter, externalQueueBanner);

  let queuePollTimer: number | undefined;
  function startQueuePolling() {
    window.clearInterval(queuePollTimer);
    const poll = async () => {
      const q = await getQueueStatus();
      if (running && !samplingActive) {
        // 이 화면이 방금 큐잉했지만 아직 진행률(step)이 한 번도 안 들어왔다 — 앞에 다른
        // 작업이 돌고 있어서 ComfyUI 큐에서 대기 중인 상태일 수 있다. samplingActive가
        // true로 바뀌는 순간(=내 클립의 첫 스텝이 들어오는 순간) 이 배너는 사라진다.
        if (q.pending > 0 || q.running > 0) {
          externalQueueBanner.textContent = `⏳ My generation request is waiting in the ComfyUI queue (${q.pending} pending) — it'll start automatically once earlier jobs finish.`;
          externalQueueBanner.classList.remove("hidden");
          externalQueueBanner.classList.add("flex");
        } else {
          externalQueueBanner.classList.add("hidden");
          externalQueueBanner.classList.remove("flex");
        }
        return;
      }
      if (running) {
        // 내 클립은 이미 실행 중 — 그 뒤로 추가로 대기 중인 게 있으면(다른 곳에서 더
        // 큐잉한 경우) 그것만 알려준다.
        const extraPending = Math.max(0, q.pending);
        if (extraPending > 0) {
          externalQueueBanner.textContent = `⚠ ComfyUI queue: ${extraPending} more pending besides this screen's generation.`;
          externalQueueBanner.classList.remove("hidden");
          externalQueueBanner.classList.add("flex");
        } else {
          externalQueueBanner.classList.add("hidden");
          externalQueueBanner.classList.remove("flex");
        }
        return;
      }
      // 이 화면이 아무것도 큐잉하지 않은 상태 — ComfyUI가 뭔가 돌고 있으면(새로고침 전에
      // 시작된 내 작업이거나 남의 큐) 그대로 알려준다.
      if (q.running > 0 || q.pending > 0) {
        externalQueueBanner.textContent = `⚠ ComfyUI queue: ${q.running} running · ${q.pending} pending — if this screen didn't queue it, progress/preview won't show here.`;
        externalQueueBanner.classList.remove("hidden");
        externalQueueBanner.classList.add("flex");
      } else {
        externalQueueBanner.classList.add("hidden");
        externalQueueBanner.classList.remove("flex");
      }
    };
    poll();
    queuePollTimer = window.setInterval(poll, 4000);
  }

  let runStart = 0;
  let clockTimer: number | undefined;
  let curClip = 0;
  let totClip = 0;
  function setStatus(msg: string) {
    statusText.textContent = msg;
  }
  function formatClock(ms: number) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  function setStepProgress(step: number, total: number) {
    // Numeric progress is the OTHER sign that sampling has really started (the live preview
    // image might never arrive if previewEnabled is off, or an image is slow) — clear the
    // pre-sampling banner here too so it never lingers over the "no preview" case.
    frDetectBanner.style.display = "none";
    placeholder.style.display = "none";
    const clipFrac = total ? step / total : 0;
    const overall = totClip ? (curClip - 1 + clipFrac) / totClip : clipFrac;
    barInner.style.width = `${Math.max(0, Math.min(100, overall * 100)).toFixed(1)}%`;
    badge.textContent = totClip > 1 ? `● LIVE  CLIP ${curClip}/${totClip}  ·  step ${step}/${total}` : `● LIVE  step ${step}/${total}`;
    setStatus(totClip > 1 ? `Clip ${curClip}/${totClip} · step ${step}/${total}` : `Sampling · step ${step}/${total}`);
  }
  function startClock() {
    runStart = Date.now();
    window.clearInterval(clockTimer);
    clockTimer = window.setInterval(() => { clockText.textContent = formatClock(Date.now() - runStart); }, 1000);
  }
  function stopClock() {
    window.clearInterval(clockTimer);
    clockTimer = undefined;
  }

  // ── 프롬프트 편집 ─────────────────────────────────────────────────
  const promptWrap = el("div", { class: "flex flex-col gap-1.5 min-h-[140px]", style: { flex: "2 1 0%" } });
  const promptHdr = el("div", { class: "aos-prompt-hdr flex items-center gap-1.5 h-5" });
  const promptTitle = el("div", { text: "PROMPTS", class: "text-muted text-[11px] uppercase tracking-wide" });
  const promptCount = el("span", { class: "text-muted text-[10px]" });
  promptHdr.append(promptTitle, promptCount);

  const smallBtnStyle = { cursor: "pointer", fontFamily: "inherit", fontSize: "10px", padding: "3px 9px", borderRadius: "5px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` };
  const commonBtn = el("button", { type: "button", text: "🧩 Common", title: "Edit the header / sound-music text shared by every clip", style: smallBtnStyle, class: "ml-auto" });
  const editBtn = el("button", { type: "button", text: "📝 Prompt Edit", title: "Open the full prompt editor (with Ollama enhance)", style: { ...smallBtnStyle, border: `1px solid ${BRAND}`, fontWeight: "600" } });
  const splitBtn = el("button", { type: "button", text: "✂ Split into clips", style: smallBtnStyle });
  const addBtn = el("button", { type: "button", text: "+ Add", style: smallBtnStyle });
  promptHdr.append(commonBtn, editBtn, splitBtn, addBtn);

  const promptList = el("div", { class: "flex flex-col gap-2 flex-1 overflow-y-auto" });
  promptWrap.append(promptHdr, promptList);

  function currentPlan() {
    return clipPlan(state);
  }

  // Hermes agent job file: {tool:"h3", job:{...}, target:"..."} — straight from this clip's
  // resolved state, see buildAgentJob(). `target` (e.g. "telegram:<chat id>") is agent-side
  // delivery routing this studio has no notion of — left blank for the user to fill in.
  function downloadAgentJob(i: number) {
    const presetName = matchUserPreset(state, userPresets)?.name || matchPreset(state)?.label || null;
    const job = buildAgentJob(state, i, presetName);
    const envelope = { tool: "h3", job, target: "" };
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    // job_<seed>_<clip label>.json — same per-clip seed resolution as buildAgentJob() itself.
    const seed = state.seedPerClip ? ((state.seed ?? 0) + i) % Number.MAX_SAFE_INTEGER : state.seed ?? 0;
    const a = el("a", { href: url, download: `job_${seed}_C${i + 1}.json` }) as HTMLAnchorElement;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── LTX Upscale — bottom prompt area (replaces the H3 shot list in this mode) ──
  // One prompt + one negative, and a ✨ that reads the source clip's first frame and writes
  // a matching prompt. The refine follows the prompt closely at low denoise, so "matches the
  // original" is the whole job. Mirrors renderLtxPrompt/ltxWritePrompt/ltxConvertToLtx (node
  // 8427b5b + review rounds).
  let _ltxBusy = false;
  async function grabFirstFrameFile(): Promise<string> {
    if (!state.ltxSource) throw new Error("No source clip.");
    const v = document.createElement("video");
    v.src = `${comfyApi.base}/view?filename=${encodeURIComponent(state.ltxSource)}&type=input`;
    v.muted = true; v.crossOrigin = "anonymous";
    await new Promise<void>((res, rej) => {
      v.addEventListener("loadeddata", () => res(), { once: true });
      v.addEventListener("error", () => rej(new Error("Could not read the source video.")), { once: true });
      setTimeout(() => rej(new Error("Source video load timed out.")), 15000);
    });
    try { v.currentTime = 0.05; await new Promise((r) => v.addEventListener("seeked", r, { once: true })); } catch {}
    const cv = document.createElement("canvas");
    cv.width = v.videoWidth || 1024; cv.height = v.videoHeight || 576;
    cv.getContext("2d")!.drawImage(v, 0, 0, cv.width, cv.height);
    const blob: Blob = await new Promise((r) => cv.toBlob((b) => r(b!), "image/png"));
    return uploadMedia(new File([blob], `ltx_srcframe_${Date.now()}.png`, { type: "image/png" }));
  }
  function ltxVisionLabel() {
    if ((state.ltxVisionBackend || "native") === "openrouter") return `OpenRouter · ${(state.ltxVisionOrModel || "(model not set)").split("/").pop()}`;
    return `native CLIP · ${(state.ltxVisionClip || "(clip not set)").split(/[\\/]/).pop()}`;
  }
  async function ltxWritePrompt() {
    if (_ltxBusy) return;
    if (!state.ltxSource) { showPopup("Pick a source clip first.", true); return; }
    const backend = state.ltxVisionBackend || "native";
    if (backend === "openrouter" && !(state.ltxVisionOrModel || "").trim()) { showPopup("Set the OpenRouter vision model in ⚙ Settings → LLM Setting → LTX Upscale.", true); return; }
    if (backend !== "openrouter" && !(state.ltxVisionClip || "").trim()) { showPopup("Set the native vision CLIP in ⚙ Settings → LLM Setting → LTX Upscale (or switch that backend to OpenRouter).", true); return; }
    _ltxBusy = true; renderPrompts();
    try {
      const frame = await grabFirstFrameFile();
      const instr = (state.ltxLlmPrompt || "").trim() || "Describe this video frame as one text-to-image prompt matching exactly what is shown.";
      const text = backend === "openrouter"
        ? await analyzeImagesOpenRouter([frame], instr, state.ltxVisionOrModel)
        : await analyzeImagesNative(state.ltxVisionClip, [frame], instr, "ltxv");
      if (text && text.trim()) { state.ltxPrompt = text.trim(); persist(); showPopup("Prompt written from the source clip's first frame.", false); }
      else showPopup("The vision model returned nothing — try again or write the prompt by hand.", true);
    } catch (e: any) { showPopup(e.message, true); }
    _ltxBusy = false; renderPrompts();
  }
  // "H3 → LTX 2.5" — a gallery clip's saved prompt is a MiniMax-H3 structured brief; rewrite
  // it into a plain LTX-2.5 prompt. Text-only (no frame needed). Uses the same LTX Upscale LLM.
  async function ltxConvertToLtx() {
    if (_ltxBusy) return;
    const src = String(state.ltxPrompt || "").trim();
    if (!src) { showPopup("Nothing to convert — the prompt box is empty. Load a gallery clip or use ✨.", true); return; }
    const backend = state.ltxVisionBackend || "native";
    if (backend === "openrouter" && !(state.ltxVisionOrModel || "").trim()) { showPopup("Set the OpenRouter model in ⚙ Settings → LLM Setting → LTX Upscale.", true); return; }
    if (backend !== "openrouter" && !(state.ltxVisionClip || "").trim()) { showPopup("Set the native LLM CLIP in ⚙ Settings → LLM Setting → LTX Upscale.", true); return; }
    _ltxBusy = true; renderPrompts();
    try {
      const sys = (state.ltxConvertPrompt || "").trim() || "Rewrite this MiniMax-H3 brief as one LTX-2.5 prompt paragraph.";
      const text = backend === "openrouter"
        ? await writeBriefOpenRouter(sys, src, state.ltxVisionOrModel)
        : await writeBriefNative(state.ltxVisionClip, sys, src, "ltxv");
      if (text && text.trim()) { state.ltxPrompt = text.trim(); persist(); showPopup("Converted the H3 brief to an LTX 2.5 prompt.", false); }
      else showPopup("The model returned nothing — try again.", true);
    } catch (e: any) { showPopup(e.message, true); }
    _ltxBusy = false; renderPrompts();
  }
  function renderLtxPrompt() {
    promptList.innerHTML = "";
    promptCount.textContent = state.ltxSource ? "" : "(no source clip)";
    // Locked while the LLM is writing (_ltxBusy) OR the actual upscale run is in progress —
    // editing the prompt mid-render wouldn't affect the graph that's already queued, so it
    // reads as broken rather than just inert. The left panel gets the same treatment via
    // leftLockOverlay.
    const locked = _ltxBusy || running;
    const ta = el("textarea", {
      placeholder: "Prompt for the refine pass — should match the source clip closely. Gallery picks auto-fill from the clip's saved prompt; ✨ writes one from an upload.",
      style: { flex: "1", width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "8px", fontSize: "12px", fontFamily: "inherit", outline: "none", resize: "none", minHeight: "0" },
    }) as HTMLTextAreaElement;
    ta.value = state.ltxPrompt || "";
    ta.addEventListener("input", () => { state.ltxPrompt = ta.value; persist(); });
    ta.addEventListener("focus", () => (ta.style.borderColor = BRAND));
    ta.addEventListener("blur", () => (ta.style.borderColor = C.border));
    if (locked) {
      ta.disabled = true; ta.style.opacity = "0.6";
      ta.value = _ltxBusy ? "✨ LLM is writing the prompt from the source clip — please wait…" : "⏳ LTX Upscale running — please wait…";
    }

    const enh = el("button", {
      type: "button", text: _ltxBusy ? "✨ …" : "✨ Write from frame",
      style: { cursor: locked ? "wait" : "pointer", fontFamily: "inherit", fontSize: "11px", padding: "5px 10px", borderRadius: "6px", background: BRAND, color: "#fff", border: "none", fontWeight: "600", opacity: (locked || !state.ltxSource) ? "0.55" : "1" },
    }) as HTMLButtonElement;
    enh.disabled = locked || !state.ltxSource;
    enh.addEventListener("click", ltxWritePrompt);
    const conv = el("button", {
      type: "button", text: "H3 → LTX 2.5", title: "Rewrite the current prompt (a MiniMax H3 brief) as an LTX 2.5 prompt",
      style: { cursor: locked ? "wait" : "pointer", fontFamily: "inherit", fontSize: "11px", padding: "5px 10px", borderRadius: "6px", background: C.bg3, color: C.text, border: `1px solid ${C.border}`, opacity: (locked || !String(state.ltxPrompt || "").trim()) ? "0.55" : "1" },
    }) as HTMLButtonElement;
    conv.disabled = locked || !String(state.ltxPrompt || "").trim();
    conv.addEventListener("click", ltxConvertToLtx);

    const neg = el("input", {
      type: "text", value: state.ltxNegPrompt || "", placeholder: "Negative (optional)",
      style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px 8px", fontSize: "11px", fontFamily: "inherit", outline: "none" },
    }) as HTMLInputElement;
    neg.addEventListener("input", () => { state.ltxNegPrompt = neg.value; persist(); });
    if (locked) neg.disabled = true;

    const btnRow = el("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexShrink: "0", flexWrap: "wrap" } });
    btnRow.append(enh, conv, el("div", { style: { flex: "1", minWidth: "0" } }),
      el("div", { text: `LLM: ${ltxVisionLabel()}`, title: "Configured in ⚙ Settings → LLM Setting → LTX Upscale", style: { fontSize: "10px", color: C.muted } }));

    promptList.style.gap = "6px";
    promptList.append(ta, neg, btnRow);
    if (_ltxBusy) promptList.append(el("div", { text: "⏳ Running the LLM — the prompt box is locked until it returns.", style: { fontSize: "10px", color: BRAND, fontWeight: "600" } }));
    else if (running) promptList.append(el("div", { text: "⏳ LTX Upscale is rendering — the prompt is locked until it finishes.", style: { fontSize: "10px", color: BRAND, fontWeight: "600" } }));
  }

  // Shared "load a saved prompt preset" row for the LTX Upscale / Face Refine prompt-edit
  // modals — a select of the same server-side prompt sets the main shot-list editor
  // saves/loads (Prompt Sets), but these two modes have one flat prompt, not a per-clip
  // list, so loading here only takes the FIRST prompt entry's TEXT and drops everything else
  // that set carries (images, header/footer, ref video/audio, clip length) — per the user's
  // explicit ask: "불러오는 데이터는 프롬포트 항목만 불어오는 걸로." (mirrors node `1dd704b`).
  function promptPresetLoadRow(onLoad: (text: string, name: string) => void) {
    const wrap = el("div", { style: { display: "flex", gap: "6px", alignItems: "center" } });
    const sel = el("select", {
      style: { flex: "1", minWidth: "0", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "5px 7px", fontSize: "11px", fontFamily: "inherit", outline: "none" },
    }) as HTMLSelectElement;
    const loadBtn = el("button", {
      type: "button", text: "📂 Load preset", title: "Load a saved prompt preset — text only, no images/refs",
      style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "5px 10px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, flexShrink: "0" },
    }) as HTMLButtonElement;
    listPromptSets().then((sets) => {
      clear(sel);
      if (!sets.length) sel.appendChild(el("option", { text: "(no saved prompt presets)", value: "" }));
      else sets.forEach((s) => sel.appendChild(el("option", { text: `${s.name} · ${s.count}`, value: s.name })));
    }).catch(() => { clear(sel); sel.appendChild(el("option", { text: "(failed to load)", value: "" })); });
    loadBtn.addEventListener("click", async () => {
      const name = sel.value;
      if (!name) return;
      try {
        const s = await getPromptSet(name);
        const first = Array.isArray(s.prompts) && s.prompts.length ? s.prompts[0] : null;
        const text = first ? (typeof first === "string" ? first : ((first as any).text || "")) : "";
        onLoad(text, name);
      } catch (e: any) {
        showPopup(`Load failed: ${e.message || e}`, true);
      }
    });
    wrap.append(sel, loadBtn);
    return wrap;
  }

  // "Prompt Edit" in LTX mode → a modal: source video on top, prompt below. ✓ Apply keeps
  // the edits (already bound live to state); ✕ Cancel reverts to the on-open snapshot.
  function openLtxPromptEdit() {
    const snap = { p: state.ltxPrompt || "", n: state.ltxNegPrompt || "" };
    const box = el("div", { style: { background: "#0e0e0e", border: `1px solid ${C.border}`, borderRadius: "10px", width: "760px", maxWidth: "94%", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 16px 50px rgba(0,0,0,0.65)" } });
    const head = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: "0" } },
      [el("div", { text: "📝 Upscale prompt", style: { color: "#fff", fontSize: "13px", fontWeight: "700", flex: "1" } })]);
    const ov = el("div", { style: { position: "fixed", inset: "0", zIndex: "100050", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.72)" } }, [box]);
    const finish = (apply: boolean) => {
      if (!apply) { state.ltxPrompt = snap.p; state.ltxNegPrompt = snap.n; }
      persist(); ov.remove();
      try { renderPrompts(); } catch (e) { console.warn("[MMH3] LTX prompt sync:", e); }
    };
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) finish(true); });
    head.appendChild(el("button", { type: "button", text: "✕ Cancel", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "4px 10px", borderRadius: "6px", background: "transparent", color: C.err, border: `1px solid ${C.border}` }, onclick: () => finish(false) }));

    const body = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px", padding: "12px", overflow: "auto" } });
    if (state.ltxSource) {
      const pv = el("video", { src: `${comfyApi.base}/view?filename=${encodeURIComponent(state.ltxSource)}&type=input`, controls: true, muted: true, loop: true, preload: "metadata", style: { width: "100%", maxHeight: "300px", objectFit: "contain", borderRadius: "6px", background: "#000" } });
      body.append(pv);
      if (_ltxSrcInfo) body.append(el("div", { text: `${_ltxSrcInfo.width}×${_ltxSrcInfo.height} · ${(_ltxSrcInfo.duration || 0).toFixed(2)}s · ${(_ltxSrcInfo.fps || 0).toFixed(2)} fps · ${_ltxSrcInfo.has_audio ? "audio" : "no audio"}`, style: { fontSize: "10px", color: C.muted } }));
    } else {
      body.append(el("div", { text: "No source clip — pick one in the left panel.", style: { fontSize: "11px", color: C.warn } }));
    }

    const llmWrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } });
    const llmLabel = el("div", { text: `LLM: ${ltxVisionLabel()}`, style: { fontSize: "10px", color: C.muted, alignSelf: "center" } });
    const syncLlmCfg = () => comfyApi.fetchApi("/minimax_h3_one/config", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ltx_vision_backend: state.ltxVisionBackend || "native", ltx_vision_clip: state.ltxVisionClip || "", ltx_vision_or_model: state.ltxVisionOrModel || "" }),
    }).catch(() => {});
    function renderLlmPicker() {
      clear(llmWrap);
      const backend = state.ltxVisionBackend || "native";
      const bSel = select([{ value: "native", label: "Native CLIP (local)" }, { value: "openrouter", label: "OpenRouter (cloud)" }], backend, (v) => {
        state.ltxVisionBackend = v; persist(); syncLlmCfg(); renderLlmPicker(); llmLabel.textContent = `LLM: ${ltxVisionLabel()}`;
      });
      let mSel: HTMLElement;
      if (backend === "openrouter") {
        const s = el("select", { style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px", fontSize: "12px", fontFamily: "inherit", outline: "none" } }) as HTMLSelectElement;
        s.appendChild(el("option", { value: state.ltxVisionOrModel || "", text: state.ltxVisionOrModel || "loading models…" }));
        s.addEventListener("change", () => { state.ltxVisionOrModel = s.value; persist(); syncLlmCfg(); llmLabel.textContent = `LLM: ${ltxVisionLabel()}`; });
        comfyApi.fetchApi("/music_one/openrouter_models").then((r) => r.json()).then((d) => {
          const ms: string[] = d.models || []; clear(s);
          if (!ms.length) s.appendChild(el("option", { value: "", text: "(no models — set the OpenRouter key in Settings)" }));
          ms.forEach((m) => { const o = el("option", { value: m, text: m }) as HTMLOptionElement; if (m === state.ltxVisionOrModel) o.selected = true; s.appendChild(o); });
          if (!state.ltxVisionOrModel && ms[0]) { state.ltxVisionOrModel = ms[0]; persist(); syncLlmCfg(); llmLabel.textContent = `LLM: ${ltxVisionLabel()}`; }
        }).catch(() => {});
        mSel = s;
      } else {
        const te = ["none", ...((ctx.availableModels?.text_encoders_all || ctx.availableModels?.text_encoders || []).filter((x: string) => x !== "none"))];
        mSel = select(te.map((x: string) => ({ value: x, label: x })), state.ltxVisionClip || "none", (v) => { state.ltxVisionClip = v === "none" ? "" : v; persist(); syncLlmCfg(); llmLabel.textContent = `LLM: ${ltxVisionLabel()}`; });
      }
      llmWrap.append(row([col([label("LLM backend"), bSel]), col([label(backend === "openrouter" ? "OpenRouter model" : "Vision CLIP"), mSel])]));
    }

    const bigTA = el("textarea", { style: { width: "100%", minHeight: "200px", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "10px", fontSize: "13px", fontFamily: "inherit", outline: "none", resize: "vertical" } }) as HTMLTextAreaElement;
    bigTA.value = state.ltxPrompt || "";
    bigTA.addEventListener("input", () => { state.ltxPrompt = bigTA.value; persist(); });
    const bigNeg = el("input", { type: "text", value: state.ltxNegPrompt || "", placeholder: "Negative (optional)", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "8px", fontSize: "12px", fontFamily: "inherit", outline: "none" } }) as HTMLInputElement;
    bigNeg.addEventListener("input", () => { state.ltxNegPrompt = bigNeg.value; persist(); });
    const lockBig = (on: boolean, msg?: string) => {
      bigTA.disabled = on; bigNeg.disabled = on; enh2.disabled = on || !state.ltxSource; conv2.disabled = on || !String(state.ltxPrompt || "").trim();
      bigTA.style.opacity = on ? "0.6" : "1";
      if (on) bigTA.value = msg || "✨ LLM is writing — please wait…";
    };
    const enh2 = button("✨ Write from frame", async () => {
      lockBig(true, "✨ LLM is writing the prompt from the source clip's first frame…");
      try { await ltxWritePrompt(); } finally { lockBig(false); bigTA.value = state.ltxPrompt || ""; renderLlmPicker(); }
    }, "primary") as HTMLButtonElement;
    enh2.disabled = _ltxBusy || !state.ltxSource;
    const conv2 = button("H3 → LTX 2.5", async () => {
      lockBig(true, "🔄 Converting the H3 brief to an LTX 2.5 prompt…");
      try { await ltxConvertToLtx(); } finally { lockBig(false); bigTA.value = state.ltxPrompt || ""; renderLlmPicker(); }
    }, "default") as HTMLButtonElement;
    conv2.disabled = _ltxBusy || !String(state.ltxPrompt || "").trim();
    renderLlmPicker();
    const ltxPresetRow = promptPresetLoadRow((text, name) => {
      state.ltxPrompt = text; bigTA.value = text; persist();
      showPopup(`Loaded prompt from "${name}".`, false);
    });
    body.append(label("LLM"), llmWrap, label("Prompt"), ltxPresetRow, bigTA, label("Negative"), bigNeg, row([enh2, conv2, el("div", { style: { flex: "1" } }), llmLabel]));

    const foot = el("div", { style: { display: "flex", gap: "8px", padding: "10px 12px", borderTop: `1px solid ${C.border}`, flexShrink: "0", justifyContent: "flex-end" } });
    foot.append(button("✕ Cancel", () => finish(false)), button("✓ Apply", () => finish(true), "primary"));

    box.append(head, body, foot);
    document.body.appendChild(ov);
    bigTA.focus();
  }

  // ── Face Refine — bottom prompt area (own frPrompt, independent of the H3 shot list) ──
  // Face Refine conditions like Reference mode (refs + one prompt, no keyframes) — it must
  // never read/write state.prompts, which belongs to the 3 core generation modes and would
  // otherwise leak a stale shot-list prompt into a refine pass that has nothing to do with it.
  function renderFaceRefinePrompt() {
    promptList.innerHTML = "";
    promptCount.textContent = state.frSource ? "" : "(no source clip)";
    const locked = running;
    const ta = el("textarea", {
      placeholder: "Prompt for the refine pass — describe the subject/scene. Gallery picks auto-fill from the clip's saved prompt.",
      style: { flex: "1", width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "8px", fontSize: "12px", fontFamily: "inherit", outline: "none", resize: "none", minHeight: "0" },
    }) as HTMLTextAreaElement;
    ta.value = state.frPrompt || "";
    ta.addEventListener("input", () => { state.frPrompt = ta.value; persist(); });
    ta.addEventListener("focus", () => (ta.style.borderColor = BRAND));
    ta.addEventListener("blur", () => (ta.style.borderColor = C.border));
    if (locked) { ta.disabled = true; ta.style.opacity = "0.6"; ta.value = "⏳ Face Refine running — please wait…"; }
    promptList.style.gap = "6px";
    promptList.append(ta);
    if (running) promptList.append(el("div", { text: "⏳ Face Refine is rendering — the prompt is locked until it finishes.", style: { fontSize: "10px", color: BRAND, fontWeight: "600" } }));
  }

  // "Prompt Edit" in Face Refine mode → a small modal: source video on top, one prompt box
  // below. No LLM writer here (unlike LTX Upscale) — Face Refine's prompt just needs to
  // describe the subject for the img2img pass, not match a full LTX-style scene brief.
  function openFrPromptEdit() {
    const snap = { p: state.frPrompt || "" };
    const box = el("div", { style: { background: "#0e0e0e", border: `1px solid ${C.border}`, borderRadius: "10px", width: "640px", maxWidth: "94%", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 16px 50px rgba(0,0,0,0.65)" } });
    const head = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: "0" } },
      [el("div", { text: "📝 Face Refine prompt", style: { color: "#fff", fontSize: "13px", fontWeight: "700", flex: "1" } })]);
    const ov = el("div", { style: { position: "fixed", inset: "0", zIndex: "100050", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.72)" } }, [box]);
    const finish = (apply: boolean) => {
      if (!apply) state.frPrompt = snap.p;
      persist(); ov.remove();
      try { renderPrompts(); } catch (e) { console.warn("[MMH3] Face Refine prompt sync:", e); }
    };
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) finish(true); });
    head.appendChild(el("button", { type: "button", text: "✕ Cancel", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "4px 10px", borderRadius: "6px", background: "transparent", color: C.err, border: `1px solid ${C.border}` }, onclick: () => finish(false) }));

    const body = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px", padding: "12px", overflow: "auto" } });
    if (state.frSource) {
      body.append(el("video", { src: `${comfyApi.base}/view?filename=${encodeURIComponent(state.frSource)}&type=input`, controls: true, muted: true, loop: true, preload: "metadata", style: { width: "100%", maxHeight: "300px", objectFit: "contain", borderRadius: "6px", background: "#000" } }));
    } else {
      body.append(el("div", { text: "No source clip — pick one in the left panel.", style: { fontSize: "11px", color: C.warn } }));
    }
    const bigTA = el("textarea", { style: { width: "100%", minHeight: "200px", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "10px", fontSize: "13px", fontFamily: "inherit", outline: "none", resize: "vertical" } }) as HTMLTextAreaElement;
    bigTA.value = state.frPrompt || "";
    bigTA.addEventListener("input", () => { state.frPrompt = bigTA.value; persist(); });
    const frPresetRow = promptPresetLoadRow((text, name) => {
      state.frPrompt = text; bigTA.value = text; persist();
      showPopup(`Loaded prompt from "${name}".`, false);
    });
    body.append(label("Prompt"), frPresetRow, bigTA);

    const foot = el("div", { style: { display: "flex", gap: "8px", padding: "10px 12px", borderTop: `1px solid ${C.border}`, flexShrink: "0", justifyContent: "flex-end" } });
    foot.append(button("✕ Cancel", () => finish(false)), button("✓ Apply", () => finish(true), "primary"));

    box.append(head, body, foot);
    document.body.appendChild(ov);
    bigTA.focus();
  }

  function renderPrompts() {
    const isLtx = state.generationMode === "ltxupscale";
    const isFaceRefine = state.generationMode === "facerefine";
    const hidesShotList = isLtx || isFaceRefine;
    commonBtn.style.display = hidesShotList ? "none" : "";
    splitBtn.style.display = hidesShotList ? "none" : "";
    addBtn.style.display = hidesShotList ? "none" : "";
    promptTitle.textContent = isLtx ? "UPSCALE PROMPT" : isFaceRefine ? "REFINE PROMPT" : "PROMPTS";
    if (isLtx) { renderLtxPrompt(); return; }
    if (isFaceRefine) { renderFaceRefinePrompt(); return; }
    promptList.innerHTML = "";
    const plan = currentPlan();
    const onCount = state.prompts.filter((p) => promptEnabled(p)).length;
    promptCount.textContent = `(${plan.promptCount} prompt${plan.promptCount > 1 ? "s" : ""} · ${onCount} on → ${plan.count} clip${plan.count > 1 ? "s" : ""} · ${plan.actualSeconds.toFixed(2)}s)`;

    state.prompts.forEach((p, i) => {
      const on = promptEnabled(p);
      const line = el("div", { class: "flex gap-2 items-start", style: { opacity: on ? "1" : "0.5" } });
      const sideCol = el("div", { class: "flex flex-col gap-1 items-center pt-1 w-7 shrink-0" });
      sideCol.appendChild(el("div", { text: `C${i + 1}`, style: { fontSize: "9px", fontWeight: "700", color: BRAND } }));
      const cb = el("input", { type: "checkbox" });
      cb.checked = on;
      cb.className = "cursor-pointer";
      cb.addEventListener("change", () => {
        state.prompts[i].enabled = cb.checked;
        persist();
        refreshPlan();
      });
      sideCol.appendChild(cb);
      const jsonBtn = el("button", {
        type: "button", text: "⬇", title: "Download this clip as a job.json for the h3-headless agent",
        style: { cursor: "pointer", background: "transparent", color: C.muted, border: "none", fontSize: "11px", padding: "0" },
      });
      jsonBtn.addEventListener("click", () => downloadAgentJob(i));
      sideCol.appendChild(jsonBtn);

      const ta = el("textarea", {
        placeholder: i === 0 ? "Describe the shot…" : "(blank = reuse the previous prompt)",
        style: { flex: "1", minHeight: "90px", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px", fontSize: "12px", fontFamily: "inherit", outline: "none", resize: "vertical" },
      });
      ta.value = promptText(p);
      ta.addEventListener("input", () => {
        state.prompts[i].text = ta.value;
        persist();
      });
      ta.addEventListener("focus", () => (ta.style.borderColor = BRAND));
      ta.addEventListener("blur", () => (ta.style.borderColor = C.border));

      const del = el("button", { type: "button", text: "✕", title: "Remove", style: { flexShrink: "0", cursor: "pointer", background: "transparent", color: C.muted, border: "none", fontSize: "11px", padding: "6px 2px" } });
      del.addEventListener("click", () => {
        if (state.prompts.length <= 1) state.prompts = [{ text: "", firstFrame: "", enabled: true }];
        else state.prompts.splice(i, 1);
        persist();
        refreshPlan();
      });
      line.append(sideCol, ta, del);
      promptList.appendChild(line);
    });
  }

  addBtn.addEventListener("click", () => {
    state.prompts.push({ text: "", firstFrame: "", enabled: true });
    persist();
    refreshPlan();
  });
  splitBtn.addEventListener("click", () => {
    const joined = state.prompts.map(promptText).filter((t) => t && t.trim()).join("\n\n");
    if (!joined.trim()) {
      showPopup("Nothing to split — write the brief in the first box.", true);
      return;
    }
    const { header, shots, footer } = parseBrief(joined);
    if (shots.length <= 1) {
      showPopup("Could not find clip boundaries ([Shot N], --- or blank lines).", true);
      return;
    }
    const parts = groupShots(shots, shots.length);
    if (header) state.promptHeader = header;
    if (footer) state.promptFooter = footer;
    state.prompts = parts.map((t) => ({ text: t, firstFrame: "", enabled: true }));
    persist();
    refreshPlan();
    const carried = [header && "header", footer && "tail"].filter(Boolean).join(" + ");
    showPopup(`Split into ${parts.length} clips${carried ? ` — shared ${carried} kept on every clip` : ""}.`, false);
  });

  rightPanel.append(previewBox, statusWrap, promptWrap);

  // ── 좌측 패널 렌더 ────────────────────────────────────────────────
  let planLine: HTMLElement | null = null;
  let totalLine: HTMLElement | null = null;

  function refreshPlan() {
    const p = currentPlan();
    const { width, height } = resolveResolution(state.aspect, state.megapixels);
    if (totalLine) {
      // 원테이크(continuityMode==="onetake") + Auto-stitch가 둘 다 켜져 있고 클립이 2개 이상이면
      // 실제 저장되는 결과는 클립 단순 합("single")이 아니라 겹침 구간을 뺀 값("onetake")이라
      // 둘 다 보여준다 — 하나만 보여주면 실제 생성 시간과 안 맞아서 혼란스럽다.
      if (p.isOneTakeStitched && p.count > 1) {
        totalLine.innerHTML =
          `<span style="font-size:13px;color:${C.muted}">single: </span>` +
          `<span style="font-size:15px;font-weight:700;color:${C.muted}">${p.actualSeconds.toFixed(2)}s</span>` +
          `<span style="font-size:13px;color:${C.muted}"> / </span>` +
          `<span style="font-size:13px;color:${C.muted}">onetake: </span>` +
          `<span style="font-size:20px;font-weight:700;color:${BRAND}">${p.stitchedSeconds.toFixed(2)}s</span>` +
          `<span style="font-size:11px;color:${C.muted}"> total</span>`;
      } else {
        totalLine.innerHTML =
          `<span style="font-size:20px;font-weight:700;color:${BRAND}">${p.actualSeconds.toFixed(2)}s</span>` +
          `<span style="font-size:11px;color:${C.muted}"> total</span>`;
      }
    }
    if (planLine) {
      planLine.innerHTML =
        `<b>${p.count}</b> clip${p.count > 1 ? "s" : ""} from <b>${p.promptCount}</b> prompt${p.promptCount > 1 ? "s" : ""}` +
        ` · est. <b>${formatDuration(p.estimateMinutes)}</b>` +
        `<br><span style="color:${C.muted}">${width}×${height} · ${p.clipSec.toFixed(2)}s/clip · ${state.clipFrames} frames</span>`;
    }
    renderPrompts();
  }

  function loadAudioFiles() {
    getMediaFiles()
      .then((d) => { ctx.audioFiles = d.audios || []; renderLeft(); })
      .catch(() => { ctx.audioFiles = []; });
  }

  function audioFilePicker() {
    const files = ctx.audioFiles || [];
    const opts = ["", ...files].map((f) => ({ value: f, label: f || (ctx.audioFiles ? "— pick a file —" : "loading…") }));
    const sel = select(opts, state.lockAudioFile || "", (v) => { state.lockAudioFile = v; persist(); renderLeft(); });
    const up = el("button", { type: "button", text: "⬆ upload", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "10px", padding: "4px 8px", borderRadius: "5px", background: C.bg3, color: C.text, border: `1px solid ${C.border}` } });
    const inp = el("input", { type: "file", accept: "audio/*", style: { display: "none" } }) as HTMLInputElement;
    up.addEventListener("click", () => inp.click());
    inp.addEventListener("change", async () => {
      const f = inp.files?.[0];
      inp.value = "";
      if (!f) return;
      up.textContent = "…";
      try {
        state.lockAudioFile = await uploadMedia(f);
        ctx.audioFiles = undefined;
        persist();
        loadAudioFiles();
        renderLeft();
      } catch (e: any) {
        showPopup(e.message, true);
        up.textContent = "⬆ upload";
      }
    });
    const mm = el("button", { type: "button", text: "🎵 playlist", title: "Pick from the MusicMaker playlist", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "10px", padding: "4px 8px", borderRadius: "5px", background: C.bg3, color: C.text, border: `1px solid ${C.border}` } });
    mm.addEventListener("click", () => openAudioGalleryPicker((name) => {
      state.lockAudioFile = name;
      ctx.audioFiles = undefined;
      persist();
      loadAudioFiles();
      renderLeft();
    }));
    return col([row([col([sel]), col([up, mm, inp])]), state.lockAudioFile ? audioPreviewPlayer(state.lockAudioFile) : null]);
  }

  function audioPreviewPlayer(filename: string) {
    const audio = el("audio", { preload: "metadata", src: viewUrl(filename), style: { display: "none" } }) as HTMLAudioElement;
    const playBtn = el("button", {
      type: "button",
      text: "▶",
      style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", width: "26px", height: "26px", borderRadius: "5px", background: C.bg3, color: C.text, border: `1px solid ${C.border}`, flexShrink: "0" },
    });
    const timeLbl = el("span", { text: "0:00 / 0:00", style: { fontSize: "10px", color: C.muted, minWidth: "72px", textAlign: "center", flexShrink: "0" } });
    const seek = el("input", { type: "range", min: "0", max: "1000", value: "0", style: { flex: "1", accentColor: BRAND, minWidth: "0" } }) as HTMLInputElement;
    let seeking = false;
    let loopOn = false;
    const loopBtn = el("button", {
      type: "button",
      text: "🔁",
      title: "Loop the trimmed range",
      style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", width: "26px", height: "26px", borderRadius: "5px", background: C.bg3, color: C.muted, border: `1px solid ${C.border}`, flexShrink: "0" },
    });
    loopBtn.addEventListener("click", () => {
      loopOn = !loopOn;
      loopBtn.style.background = loopOn ? BRAND : C.bg3;
      loopBtn.style.color = loopOn ? "#fff" : C.muted;
    });

    const fmt = (s: number) => {
      if (!isFinite(s) || s < 0) return "0:00";
      const m = Math.floor(s / 60);
      const ss = Math.floor(s % 60).toString().padStart(2, "0");
      return `${m}:${ss}`;
    };

    // 재생/탐색은 항상 트림된 구간([effStart, effEnd]) 안으로만 — 트림 밖 구간은
    // 어차피 오디오 락에 안 쓰이니 미리듣기도 거기에 맞춰야 실제 결과와 일치한다.
    const effStart = () => Math.max(0, state.audioLockTrimStart || 0);
    const effEnd = () => {
      const dur = audio.duration || 0;
      const e = state.audioLockTrimEnd || 0;
      return e > 0 ? Math.min(e, dur || e) : dur;
    };

    playBtn.addEventListener("click", () => {
      if (audio.paused) {
        const s = effStart(), e = effEnd();
        if (audio.currentTime < s || (e > s && audio.currentTime >= e)) audio.currentTime = s;
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    });
    audio.addEventListener("play", () => { playBtn.textContent = "⏸"; });
    audio.addEventListener("pause", () => { playBtn.textContent = "▶"; });
    audio.addEventListener("ended", () => { playBtn.textContent = "▶"; });
    audio.addEventListener("timeupdate", () => {
      if (seeking) return;
      const s = effStart(), e = effEnd();
      if (e > s && audio.currentTime >= e) {
        if (loopOn) { audio.currentTime = s; audio.play().catch(() => {}); }
        else { audio.pause(); audio.currentTime = e; }
      }
      const span = Math.max(0.001, e - s);
      const pos = Math.min(1, Math.max(0, (audio.currentTime - s) / span));
      seek.value = String(pos * 1000);
      timeLbl.textContent = `${fmt(Math.max(0, audio.currentTime - s))} / ${fmt(span)}`;
    });
    audio.addEventListener("loadedmetadata", () => {
      audio.currentTime = effStart();
      timeLbl.textContent = `0:00 / ${fmt(effEnd() - effStart())}`;
      updateTrimHint();
    });
    seek.addEventListener("input", () => {
      seeking = true;
      const s = effStart(), e = effEnd();
      const span = Math.max(0.001, e - s);
      audio.currentTime = s + (parseFloat(seek.value) / 1000) * span;
      timeLbl.textContent = `${fmt(audio.currentTime - s)} / ${fmt(span)}`;
    });
    seek.addEventListener("change", () => { seeking = false; });

    const trimHint = el("div", { text: "", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } });
    function updateTrimHint() {
      const dur = audio.duration || 0;
      const s = effStart();
      const e = effEnd();
      const len = Math.max(0, e - s);
      trimHint.textContent = dur ? `In use: ${fmt(s)} – ${fmt(e)} (${len.toFixed(1)}s available) — preview plays this range only` : "";
      // 트림 범위가 바뀌어서 현재 재생 위치가 밖으로 밀려났으면 안으로 당겨온다.
      if (audio.currentTime < s || (e > s && audio.currentTime > e)) audio.currentTime = s;
      // 재생 중이 아니어도(timeupdate가 안 도는 상태) 시간 표시/탐색바는 입력값 바뀔 때마다 바로 갱신.
      const span = Math.max(0.001, e - s);
      const pos = Math.min(1, Math.max(0, (audio.currentTime - s) / span));
      seek.value = String(pos * 1000);
      timeLbl.textContent = `${fmt(Math.max(0, audio.currentTime - s))} / ${fmt(span)}`;
    }
    const startField = numberField(state.audioLockTrimStart || 0, (v) => { state.audioLockTrimStart = Math.max(0, v); persist(); updateTrimHint(); }, 0.1);
    const endField = numberField(state.audioLockTrimEnd || 0, (v) => { state.audioLockTrimEnd = Math.max(0, v); persist(); updateTrimHint(); }, 0.1);
    const setBtnStyle = { cursor: "pointer", fontFamily: "inherit", fontSize: "10px", padding: "4px 6px", borderRadius: "5px", background: C.bg3, color: C.text, border: `1px solid ${C.border}`, flexShrink: "0" };
    const setStartBtn = el("button", { type: "button", text: "from playhead", style: setBtnStyle });
    const setEndBtn = el("button", { type: "button", text: "from playhead", style: setBtnStyle });
    const setEndFullBtn = el("button", { type: "button", text: "full length", style: setBtnStyle });
    setStartBtn.addEventListener("click", () => {
      state.audioLockTrimStart = Math.round((audio.currentTime || 0) * 100) / 100;
      startField.value = String(state.audioLockTrimStart);
      persist();
      updateTrimHint();
    });
    setEndBtn.addEventListener("click", () => {
      state.audioLockTrimEnd = Math.round((audio.currentTime || 0) * 100) / 100;
      endField.value = String(state.audioLockTrimEnd);
      persist();
      updateTrimHint();
    });
    setEndFullBtn.addEventListener("click", () => {
      state.audioLockTrimEnd = Math.round((audio.duration || 0) * 100) / 100;
      endField.value = String(state.audioLockTrimEnd);
      persist();
      updateTrimHint();
    });
    updateTrimHint();

    const trimRow = row([
      col([label("Trim start (s)"), row([startField, setStartBtn])]),
      col([label("Trim end (s) — 0 = to end"), row([endField, setEndBtn, setEndFullBtn])]),
    ]);

    return col([row([playBtn, loopBtn, seek, timeLbl, audio], "6px"), trimRow, trimHint]);
  }

  function audioLockControls() {
    const lockAvailable = !!ctx.availability?.TJ_H3_AudioLock;
    const hasTrim = !!ctx.availability?.TrimAudioDuration;
    const kids: (Node | null)[] = [label("Audio Lock")];
    kids.push(
      ...(lockAvailable
        ? [checkboxRow("Lock audio (keep the source track)", !!state.audioLock, (v) => { state.audioLock = v; persist(); renderLeft(); })]
        : [el("div", { html: "⚠ <code>TJ_H3_AudioLock</code> not installed — audio lock unavailable. It ships with <b>TJ_NODE</b>.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } })])
    );
    if (lockAvailable && state.audioLock) {
      kids.push(col([label("Audio file"), audioFilePicker()]));
      if (!hasTrim) {
        kids.push(el("div", { html: "⚠ <code>TrimAudioDuration</code> missing — every clip would lock onto the start of the track. Install it, or keep this to a single clip.", style: { fontSize: "10px", color: C.warn, lineHeight: "1.5" } }));
      }
      kids.push(
        row([
          col([
            label("Mode"),
            select(
              [
                { value: "lock", label: "Lock — source as-is" },
                { value: "remix", label: "Remix — partly kept" },
              ],
              state.audioLockMode || "lock",
              (v) => { state.audioLockMode = v; persist(); renderLeft(); }
            ),
          ]),
          ...(state.audioLockMode === "remix" ? [col([label("Strength"), numberField(state.audioLockStrength ?? 0.5, (v) => { state.audioLockStrength = Math.min(1, Math.max(0, v)); persist(); }, 0.05)])] : []),
        ])
      );
      kids.push(
        col([
          label("Fit"),
          select(
            [
              { value: "pad_silence", label: "Pad silence" },
              { value: "loop", label: "Loop" },
              { value: "stretch_none", label: "None (pad + warn)" },
            ],
            state.audioLockFit || "pad_silence",
            (v) => { state.audioLockFit = v; persist(); }
          ),
        ])
      );
      kids.push(el("div", { text: "The saved video uses the source audio directly — no codec round trip.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }));
    }
    return kids;
  }

  // ── Pipeline axis detail fields (SPEC_MINIMAX_H3_PIPELINE_AXES.md Part 3) ────────────────
  const n = (v: number, set: (v: number) => void, step = 0.05) => numberField(v, (x) => { set(x); persist(); }, step);

  function turboSummary() {
    if (state.turboMode === "none") return "Off";
    const eff = turboEffective(state, ctx.availability);
    const label = state.turboMode === "larryvrh" ? "larryvrh" : state.turboMode === "pdd" ? "PDD Acc" : "lightx2v";
    if (eff === state.turboMode) return `${label} · ${effectiveSteps(state, ctx.availability)} steps`;
    const reason =
      state.turboMode === "larryvrh" && !turboLoraSet() ? "no turbo LoRA set"
      : state.turboMode === "larryvrh" ? "MiniMaxH3TurboLoRA not installed"
      : state.turboMode === "pdd" && !pddFileForMode(state) ? "no PDD Acc LoRA set for this mode"
      : "unavailable";
    return `${label} · inactive — ${reason}`;
  }
  function turboLoraSet() {
    return !!state.turboLora && state.turboLora !== "none";
  }
  function turboSettings() {
    if (state.turboMode === "larryvrh") {
      return [
        row([
          col([label("Turbo strength"), n(state.turboLoraStrength ?? 1.0, (v) => (state.turboLoraStrength = v))]),
          col([label("Low VRAM"), checkboxRow("low_vram", !!state.turboLoraLowVram, (v) => { state.turboLoraLowVram = v; persist(); })]),
        ]),
        col([label("Turbo steps"), n(state.turboSteps ?? 4, (v) => (state.turboSteps = Math.max(1, Math.round(v))), 1)]),
        el("div", { text: "Uses the dedicated MiniMaxH3TurboLoRA node + this step count. The LoRA file itself is set in ⚙ Settings → Models.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
        ...(turboLoraSet() ? [] : [el("div", { text: "⚠ No turbo LoRA file selected in ⚙ Settings → Models — this falls back to no Turbo until one is set.", style: { fontSize: "10px", color: C.warn, lineHeight: "1.5" } })]),
      ];
    }
    if (state.turboMode === "lightx2v") {
      return [
        col([label("Steps"), n(state.slaTurboSteps ?? 6, (v) => (state.slaTurboSteps = Math.max(1, Math.round(v))), 1)]),
        el("div", {
          text: "This is a regular LoRA, not a dedicated node — add the SLA-turbo LoRA file itself in the LoRA section below. Selecting this here just locks Attention to SLA (required — the LoRA gives no speedup without it).",
          style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" },
        }),
      ];
    }
    if (state.turboMode === "pdd") {
      return [
        col([
          label("Model evaluations (nfe)"),
          select(PDD_NFE_CHOICES.map((s) => ({ value: s, label: s })), String(state.pddNfe ?? "8"), (v) => { state.pddNfe = v; persist(); }),
        ]),
        col([label("LoRA strength"), n(state.pddLoraStrength ?? 1.0, (v) => (state.pddLoraStrength = v))]),
        el("div", {
          text: "8 = trained block size 4. 4 regroups two blocks per step (faster, official); 6 uses the non-uniform default partition. Higher counts are off the training envelope and render as noise.",
          style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" },
        }),
        el("div", {
          text: "Core-native since ComfyUI v0.35.0 — the Acc file loads as a plain model-only LoRA (no separate pack); euler runs on a normal schedule and core's FinalLayer picks the per-interval head off it. Still forces sampler=euler + SigmaShift 12/3. Use the ComfyUI-converted file (…_pruned_comfy.safetensors) — the raw alibaba-pai one applies 0 patches. The Acc LoRA itself (per generation mode) is set in ⚙ Settings → Models.",
          style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" },
        }),
        ...(pddFileForMode(state) ? [] : [el("div", { text: "⚠ No PDD Acc LoRA selected in ⚙ Settings → Models for this generation mode — this falls back to no Turbo until one is set.", style: { fontSize: "10px", color: C.warn, lineHeight: "1.5" } })]),
      ];
    }
    return [el("div", { text: "No Turbo — slowest, but the most faithful baseline.", style: { fontSize: "10px", color: C.muted } })];
  }

  function attnSummary() {
    const backend = ATTN_BACKENDS.find((b) => b.key === state.attnBackend)?.label || "None";
    const fwd = ATTN_FORWARDS.find((f) => f.key === state.attnForward)?.label;
    let s = state.attnForward !== "none" && fwd ? `${backend} + ${fwd}` : backend;
    if (state.h3Optimizer === "memory") s += " · MemOpt";
    else if (state.h3Optimizer === "memory_sparse") s += " · MemOpt+Sparse";
    return s;
  }
  // H3-Optimizations (Zironic) — third control in the attention accordion.
  function h3OptimizerSettings(): (Node | null)[] {
    const rows: (Node | null)[] = [
      col([label("H3 optimizer (VRAM / sparse)"), select(
        H3_OPTIMIZERS.map((o) => {
          const reason = h3OptimizerBlockedReason(state, o.key);
          return { value: o.key, label: reason ? `${o.label} — ${reason}` : o.label, disabled: !!reason };
        }),
        state.h3Optimizer,
        (v) => { state.h3Optimizer = v; persist(); renderLeft(); },
      )]),
    ];
    if (state.h3Optimizer === "none") return rows;
    const node = H3_OPTIMIZERS.find((o) => o.key === state.h3Optimizer)?.node;
    const installed = !ctx.availability || !Object.keys(ctx.availability).length || !!(node && ctx.availability[node]);
    const nt = h3OptimizerOverlapNote(state, state.h3Optimizer);
    if (nt) rows.push(el("div", { text: `ⓘ ${nt}`, style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }));
    if (state.h3Optimizer === "memory" || state.h3Optimizer === "memory_sparse") {
      rows.push(
        row([
          col([label("precision"), select(["Auto", "BF16", "Preserve native", "Force quant"].map((x) => ({ value: x, label: x })), state.h3MemPrecision || "Auto", (v) => { state.h3MemPrecision = v; persist(); })]),
          col([label("qkv streaming"), select(["Auto", "Off", "Forced"].map((x) => ({ value: x, label: x })), state.h3MemQkvStreaming || "Auto", (v) => { state.h3MemQkvStreaming = v; persist(); })]),
        ]),
        checkboxRow("Lower VRAM (slower attention V handling)", !!state.h3MemLowVram, (v) => { state.h3MemLowVram = v; persist(); }, { title: "Two-pass attention V handling — trims peak memory further at a speed cost." }),
        el("div", {
          text: installed
            ? "Wraps the selected dense backend (Sage / Comfy Kitchen / stock) with chunked QKV/MLP/FinalLayer — the backend still runs. This is how to get a memory-efficient CK."
            : "⚠ H3-Optimizations pack not installed — run install_comfyui_dependencies.bat.",
          style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" },
        }),
      );
    }
    if (state.h3Optimizer === "memory_sparse" && !h3OptimizerBlockedReason(state, "memory_sparse")) {
      rows.push(
        col([label("video attention budget"), n(state.h3SparseBudget ?? 0.15, (v) => (state.h3SparseBudget = Math.min(1, Math.max(0.01, v))), 0.05)]),
        checkboxRow("Denser early/late steps (≥ 50% for first & last 20%)", state.h3SparseDenserEdges !== false, (v) => { state.h3SparseDenserEdges = v; persist(); }),
        el("div", { text: "Sparse attention changes the result — no budget is lossless for every prompt. 0.15 is the pack default; raise it if motion or prompt adherence degrades. H3 is most sensitive in the early steps.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
      );
    }
    return rows;
  }
  function attnBackendSettings() {
    switch (state.attnBackend) {
      case "sage":
        return [col([label("mode"), select(["auto", "disabled", "sageattn3", "sageattn3_per_block_mean", "sageattn_qk_int8_pv_fp16_cuda", "sageattn_qk_int8_pv_fp8_cuda"].map((s) => ({ value: s, label: s })), state.sageAttnMode || "auto", (v) => { state.sageAttnMode = v; persist(); })])];
      case "ck":
        return [col([label("attention"), select([{ value: "comfy_kitchen", label: "comfy kitchen attention" }, { value: "pytorch", label: "pytorch attention" }], state.ckAttentionBackend || "comfy_kitchen", (v) => { state.ckAttentionBackend = v; persist(); })])];
      case "solattn_kijai":
        return [
          row([
            col([label("tau"), n(state.solTau ?? 1.3, (v) => (state.solTau = v))]),
            col([label("min tokens"), n(state.solMinTokens ?? 4096, (v) => (state.solMinTokens = Math.round(v)), 512)]),
          ]),
          row([
            col([label("start %"), n(state.solStart ?? 0.2, (v) => (state.solStart = v))]),
            col([label("end %"), n(state.solEnd ?? 0.9, (v) => (state.solEnd = v))]),
          ]),
        ];
      case "sla":
        return [
          row([
            col([label("sparsity ratio"), n(state.slaSparsity ?? 0.9, (v) => (state.slaSparsity = v))]),
            col([label("block size"), select(["64", "128"].map((s) => ({ value: s, label: s })), state.slaBlockSize || "64", (v) => { state.slaBlockSize = v; persist(); })]),
          ]),
          row([
            col([label("min seq len"), n(state.slaMinSeqLen ?? 8192, (v) => (state.slaMinSeqLen = Math.round(v)), 1024)]),
            col([label("dense last steps"), n(state.slaDenseLastSteps ?? 0, (v) => (state.slaDenseLastSteps = Math.round(v)), 1)]),
          ]),
          checkboxRow("Protect audio (always attend text/cond/audio prefix)", state.slaProtectAudio !== false, (v) => { state.slaProtectAudio = v; persist(); }),
          checkboxRow("Enabled (node's own bypass — off runs dense attention without removing the node)", state.slaRunEnabled !== false, (v) => { state.slaRunEnabled = v; persist(); }),
        ];
      default:
        return [];
    }
  }
  function attnForwardSettings() {
    if (state.attnForward === "solattn_saganaki") {
      return [
        row([
          col([label("tau start"), n(state.solSchedTauStart ?? 1.3, (v) => (state.solSchedTauStart = v))]),
          col([label("tau end"), n(state.solSchedTauEnd ?? 0.8, (v) => (state.solSchedTauEnd = v))]),
        ]),
        el("div", { text: "Set tau start = tau end for the old fixed-tau behavior (this pack's MemoryEfficient variant) — this node is a strict superset.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
        row([
          col([label("curve"), select(["linear", "cosine", "sqrt", "smoothstep"].map((c) => ({ value: c, label: c })), state.solSchedCurve || "linear", (v) => { state.solSchedCurve = v; persist(); })]),
          col([label("min tokens"), n(state.solSchedMinTokens ?? 4096, (v) => (state.solSchedMinTokens = Math.round(v)), 512)]),
        ]),
        row([
          col([label("thresh type"), select(["diag", "exact"].map((t) => ({ value: t, label: t })), state.solSchedThreshType || "diag", (v) => { state.solSchedThreshType = v; persist(); })]),
          col([label("dense %"), n(state.solSchedDensePercent ?? 0.0, (v) => (state.solSchedDensePercent = v))]),
        ]),
        col([label("sink conditioning"), select(["exact_kv", "exact_kv_and_rows", "off"].map((s) => ({ value: s, label: s })), state.solSchedSinkConditioning || "exact_kv_and_rows", (v) => { state.solSchedSinkConditioning = v; persist(); })]),
        row([
          col([checkboxRow("strict", !!state.solSchedStrict, (v) => { state.solSchedStrict = v; persist(); })]),
          col([checkboxRow("int8 qk", !!state.solSchedInt8Qk, (v) => { state.solSchedInt8Qk = v; persist(); })]),
          col([checkboxRow("int8 pv", !!state.solSchedInt8Pv, (v) => { state.solSchedInt8Pv = v; persist(); })]),
        ]),
        col([label("dense blocks (comma-separated indices, optional)"), el("input", { type: "text", value: state.solSchedDenseBlocks || "", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px", fontSize: "12px", fontFamily: "inherit" }, oninput: (e: any) => { state.solSchedDenseBlocks = e.target.value; persist(); } })]),
      ];
    }
    return [];
  }

  function blockCacheSummary() {
    return BLOCK_CACHES.find((b) => b.key === state.blockCache)?.label || "None";
  }
  function blockCacheSettings() {
    if (state.blockCache === "fbcache") {
      return [
        col([
          label("mode"),
          select(
            ["H3 Safe — 0.08 / max 2", "H3 Fast — 0.10 / max 2", "H3 Aggressive — 0.12 / max 2", "Custom — manual values"].map((m) => ({ value: m, label: m })),
            state.fbcMode || "H3 Fast — 0.10 / max 2",
            (v) => { state.fbcMode = v; persist(); renderLeft(); }
          ),
        ]),
        el("div", { text: "The fields below only apply in \"Custom — manual values\" mode; presets ignore them.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
        row([
          col([label("threshold"), n(state.fbcThreshold ?? 0.1, (v) => (state.fbcThreshold = v), 0.005)]),
          col([label("max consecutive hits"), n(state.fbcMaxConsecutiveHits ?? 2, (v) => (state.fbcMaxConsecutiveHits = Math.round(v)), 1)]),
        ]),
        row([
          col([label("start %"), n(state.fbcStartPercent ?? 0.1, (v) => (state.fbcStartPercent = v), 0.01)]),
          col([label("end %"), n(state.fbcEndPercent ?? 0.95, (v) => (state.fbcEndPercent = v), 0.01)]),
        ]),
        checkboxRow("Temporal guard", !!state.fbcTemporalGuard, (v) => { state.fbcTemporalGuard = v; persist(); }),
      ];
    }
    return [];
  }

  function spectrumSettings() {
    return [
      row([
        col([label("blend weight"), n(state.specBlendWeight ?? 0.5, (v) => (state.specBlendWeight = v))]),
        col([label("degree"), n(state.specDegree ?? 1, (v) => (state.specDegree = Math.round(v)), 1)]),
      ]),
      row([
        col([label("ridge lambda"), n(state.specRidgeLambda ?? 0.1, (v) => (state.specRidgeLambda = v))]),
        col([label("window size"), n(state.specWindowSize ?? 2.0, (v) => (state.specWindowSize = v), 0.25)]),
      ]),
      row([
        col([label("flex window"), n(state.specFlexWindow ?? 0.75, (v) => (state.specFlexWindow = v))]),
        col([label("max history"), n(state.specMaxHistory ?? 8, (v) => (state.specMaxHistory = Math.round(v)), 1)]),
      ]),
      row([
        col([label("warmup steps"), n(state.specWarmupSteps ?? 1, (v) => (state.specWarmupSteps = Math.round(v)), 1)]),
        col([label("tail steps"), n(state.specTailSteps ?? 1, (v) => (state.specTailSteps = Math.round(v)), 1)]),
      ]),
      col([label("history storage"), select([{ value: "system_ram", label: "system_ram" }, { value: "vram", label: "vram" }], state.specHistoryStore || "system_ram", (v) => { state.specHistoryStore = v; persist(); })]),
    ];
  }

  /** Enforces the gating rules from SPEC_MINIMAX_H3_PIPELINE_AXES.md whenever an axis changes,
   * so blocked combinations can never actually be reached even by clicking through quickly. */
  function fixupPipelineAxes() {
    if (!turboModesFor(state.generationMode).some((m) => m.key === state.turboMode)) state.turboMode = "none";
    if (state.turboMode === "lightx2v") {
      state.attnBackend = "sla";
      state.blockCache = "none";
    } else if (state.turboMode === "larryvrh") {
      if (attnBackendBlockedReason(state, state.attnBackend)) state.attnBackend = "none";
      state.blockCache = "none";
    } else if (state.turboMode === "pdd") {
      state.blockCache = "none";
    }
    if (attnForwardBlockedReason(state, state.attnForward)) state.attnForward = "none";
    // Only the sparse stage is ever blocked — fall back to plain Memory Opt, not off.
    if (h3OptimizerBlockedReason(state, state.h3Optimizer)) state.h3Optimizer = "memory";
  }

  // ══ LTX 2.5 Upscale mode — left panel ═══════════════════════════════════
  // A standalone 2x latent-upscale + light refine pass on the LTX 2.5 model — nothing to do
  // with the H3 conditioning/sampler chain. Its prompt + LLM live in the bottom prompt area
  // (renderPrompts), its seed on the fixed bottom row. Only the source, the refine params,
  // its own LoRA list and the RTX finisher are here. Mirrors one_node_minimax_h3.js
  // renderLtxUpscaleLeft (node 8427b5b + review rounds through 941217f).
  const LTX_SAMPLERS = ["euler_ancestral", "euler", "dpmpp_2m", "dpmpp_sde", "res_multistep", "lcm"];
  const LTX_SCHEDULERS = ["simple", "normal", "sgm_uniform", "beta", "linear_quadratic", "karras"];
  let _ltxSrcInfo: { width?: number; height?: number; duration?: number; fps?: number; has_audio?: boolean } | null = null;

  async function loadLtxSrcInfo() {
    _ltxSrcInfo = null;
    if (!state.ltxSource) { renderLeft(); return; }
    try {
      const d = await getMediaInfo(state.ltxSource);
      if (d && d.ok) _ltxSrcInfo = d;
    } catch {}
    renderLeft();
  }
  function setLtxSource(inputFilename: string, kind: string, item?: any) {
    state.ltxSource = inputFilename; state.ltxSourceKind = kind;
    // A gallery pick means "refine THIS clip" — load its saved prompt/negative (from the
    // sidecar meta) straight into the boxes, replacing whatever was there. An upload carries
    // no prompt, so leave the boxes for ✨ / manual entry.
    let m = (item && item.meta) || {};
    if (typeof m === "string") { try { m = JSON.parse(m); } catch { m = {}; } }
    const p = (item && item.prompt) || m.prompt || (Array.isArray(m.prompts) && m.prompts[0]) || "";
    const n = m.negativePrompt || m.negative || "";
    if (kind === "gallery") {
      if (String(p).trim()) { state.ltxPrompt = String(p); showPopup("Prompt loaded from the clip's saved metadata.", false); }
      else showPopup("That clip has no prompt saved in its metadata — write one or use ✨.", true);
      if (String(n).trim()) state.ltxNegPrompt = String(n);
    } else {
      if (String(p).trim() && !String(state.ltxPrompt || "").trim()) state.ltxPrompt = String(p);
      if (String(n).trim() && !String(state.ltxNegPrompt || "").trim()) state.ltxNegPrompt = String(n);
    }
    const durM = m.durationSeconds || m.seconds || (m.frames && m.fps ? m.frames / m.fps : 0) || 0;
    state.ltxSourceMeta = (m.w || m.h || m.fps || m.frames || durM)
      ? { w: m.w || 0, h: m.h || 0, fps: m.fps || 0, frames: m.frames || 0, duration: durM }
      : null;
    _ltxSrcInfo = null;
    persist(); renderLeft(); renderPrompts();
    loadLtxSrcInfo();
  }

  function renderLtxUpscaleLeft() {
    setLeftLocked(running);
    leftPanel.innerHTML = "";

    if (!ltxUpscaleReady(state)) {
      leftPanel.appendChild(panel([
        el("div", { html: "⚙ <b>LTX 2.5 Upscale</b> needs its models set first.<br>Open <b>⚙ Settings → LTX 2.5 Upscale</b> and pick:" }),
        el("div", { text: "missing: " + ltxUpscaleMissing(state).join(", "), style: { fontSize: "11px", color: C.err, marginTop: "4px" } }),
      ]));
      return;
    }

    // ── source clip — square card, controls BELOW the video, clean frame ──
    const srcKids: (Node | null)[] = [label("Source clip")];
    const hasSrc = !!state.ltxSource;
    const card = el("div", { style: {
      position: "relative", width: "100%", aspectRatio: "1 / 1", background: "#000",
      borderRadius: "8px", overflow: "hidden", border: `1px solid ${hasSrc ? BRAND : C.border}`,
      display: "flex", alignItems: "center", justifyContent: "center",
    } });

    if (hasSrc) {
      const vid = el("video", {
        src: `${comfyApi.base}/view?filename=${encodeURIComponent(state.ltxSource)}&type=input`,
        muted: true, loop: true, playsinline: true, preload: "metadata",
        style: { width: "100%", height: "100%", objectFit: "contain", background: "#000", display: "block", cursor: "pointer" },
      }) as HTMLVideoElement;
      vid.addEventListener("click", () => { vid.paused ? vid.play() : vid.pause(); });
      card.appendChild(vid);
      card.appendChild(el("button", {
        type: "button", text: "✕", title: "Clear source", style: {
          position: "absolute", top: "6px", right: "6px", zIndex: "3", width: "24px", height: "24px",
          border: "none", borderRadius: "6px", background: "rgba(0,0,0,0.7)", color: "#fff", cursor: "pointer", fontSize: "12px",
        },
        onclick: () => { state.ltxSource = ""; state.ltxSourceKind = "gallery"; state.ltxSourceMeta = null; _ltxSrcInfo = null; persist(); renderLeft(); renderPrompts(); },
      }));
      srcKids.push(card);

      const fmtT = (s: number) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); const ss = Math.floor(s % 60); return `${m}:${String(ss).padStart(2, "0")}`; };
      const btnStyle = { width: "30px", height: "26px", flexShrink: "0", border: `1px solid ${C.border}`, borderRadius: "5px", background: C.bg2, color: C.text, cursor: "pointer", fontSize: "11px" };
      const playBtn = el("button", { type: "button", text: "▶", style: btnStyle });
      const muteBtn = el("button", { type: "button", text: "🔇", title: "Unmute", style: btnStyle });
      const seek = el("input", { type: "range", min: "0", max: "1000", value: "0", style: { flex: "1", accentColor: BRAND, cursor: "pointer" } }) as HTMLInputElement;
      playBtn.addEventListener("click", () => { vid.paused ? vid.play() : vid.pause(); });
      vid.addEventListener("play", () => (playBtn.textContent = "⏸"));
      vid.addEventListener("pause", () => (playBtn.textContent = "▶"));
      muteBtn.addEventListener("click", () => { vid.muted = !vid.muted; muteBtn.textContent = vid.muted ? "🔇" : "🔊"; muteBtn.title = vid.muted ? "Unmute" : "Mute"; });
      let seeking = false;
      seek.addEventListener("input", () => { seeking = true; if (vid.duration) vid.currentTime = (parseFloat(seek.value) / 1000) * vid.duration; });
      seek.addEventListener("change", () => { seeking = false; });
      vid.addEventListener("timeupdate", () => { if (!seeking && vid.duration) seek.value = String(Math.round((vid.currentTime / vid.duration) * 1000)); });
      srcKids.push(el("div", { style: { display: "flex", alignItems: "center", gap: "8px", padding: "6px 2px" } }, [playBtn, seek, muteBtn]));

      const durLabel = el("span", { text: "0:00 / 0:00" });
      const fpsSpan = el("span", { text: "—", style: { color: C.muted } });
      const sizeSpan = el("span", { text: "—", style: { color: C.muted } });
      const refreshInfo = () => {
        const info = _ltxSrcInfo, sm = state.ltxSourceMeta || ({} as any);
        const dur = vid.duration || info?.duration || sm.duration || 0;
        const w = vid.videoWidth || info?.width || sm.w || 0;
        const h = vid.videoHeight || info?.height || sm.h || 0;
        let fps = info?.fps || sm.fps || 0;
        if (!fps && sm.frames && dur) fps = sm.frames / dur;
        durLabel.textContent = `${fmtT(vid.currentTime)} / ${fmtT(dur)}`;
        if (fps) { fpsSpan.textContent = `${Math.round(fps)}fps`; fpsSpan.style.color = C.text; }
        if (w && h) { sizeSpan.textContent = `${w}x${h}`; sizeSpan.style.color = C.text; }
      };
      vid.addEventListener("loadedmetadata", refreshInfo);
      vid.addEventListener("timeupdate", refreshInfo);
      refreshInfo();
      srcKids.push(el("div", { style: { display: "flex", alignItems: "center", gap: "16px", padding: "0 2px", fontSize: "11px", color: C.text } }, [durLabel, fpsSpan, sizeSpan]));
      if (_ltxSrcInfo && _ltxSrcInfo.has_audio === false) srcKids.push(el("div", {
        text: "⚠ No audio track — the LTX audio branch needs one. Add audio to the clip first.",
        style: { fontSize: "10px", color: C.warn, lineHeight: "1.5" },
      }));
    } else {
      card.appendChild(el("div", { text: "no source clip", style: { color: C.muted, fontSize: "12px" } }));
      srcKids.push(card);
    }

    const fileInp = el("input", { type: "file", accept: "video/*", style: { display: "none" } }) as HTMLInputElement;
    fileInp.addEventListener("change", async () => {
      const f = fileInp.files?.[0]; fileInp.value = "";
      if (!f) return;
      try { showPopup("Uploading…", false); const name = await uploadMedia(f); setLtxSource(name, "upload"); }
      catch (e: any) { showPopup(e.message, true); }
    });
    // From gallery | Upload — equal width. The real clip gallery (badges, 눈가리기 blur,
    // info, everything) opens in pick mode instead of a separate, stripped-down grid.
    const galBtn = button("🖼 From gallery", () => galleryOv.showPicker((inputFilename, item) => setLtxSource(inputFilename, "gallery", item)));
    const upBtn = button("⬆ Upload", () => fileInp.click());
    galBtn.style.flex = "1"; upBtn.style.flex = "1";
    srcKids.push(el("div", { style: { display: "flex", gap: "8px" } }, [galBtn, upBtn]));
    srcKids.push(fileInp);
    srcKids.push(el("div", { text: "The whole clip is upscaled 2× and its audio is carried through. Gallery picks auto-fill the prompt from the clip's saved meta.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }));
    leftPanel.appendChild(panel(srcKids));

    // ── refine sampling ──────────────────────────────────────────────────
    leftPanel.appendChild(panel([
      label("Refine"),
      row([
        col([label("Steps"), numberField(state.ltxSteps ?? 3, (v) => { state.ltxSteps = Math.max(1, Math.round(v)); persist(); }, 1)]),
        col([label("Denoise"), numberField(state.ltxDenoise ?? 0.15, (v) => { state.ltxDenoise = Math.min(1, Math.max(0.01, v)); persist(); }, 0.01)]),
      ]),
      row([
        col([label("Sampler"), select(LTX_SAMPLERS.map((s) => ({ value: s, label: s })), state.ltxSampler || "euler_ancestral", (v) => { state.ltxSampler = v; persist(); })]),
        col([label("Scheduler"), select(LTX_SCHEDULERS.map((s) => ({ value: s, label: s })), state.ltxScheduler || "simple", (v) => { state.ltxScheduler = v; persist(); })]),
      ]),
      (() => {
        // "seconds" derives the piece count from a target size; "count" takes it directly.
        const durNow = () => _ltxSrcInfo?.duration || state.ltxSourceMeta?.duration || 0;
        const segWrap = el("div", {});
        const renderSegWrap = () => {
          clear(segWrap);
          const mode = state.ltxSegmentMode === "count" ? "count" : "seconds";
          const segHint = el("div", { style: { fontSize: "13px", fontWeight: "700", color: BRAND, whiteSpace: "nowrap" } });
          const updateSegHint = () => {
            const d = durNow();
            if (mode === "count") {
              const n = Math.max(1, Math.round(Number(state.ltxSegmentCount) || 1));
              if (n <= 1) segHint.textContent = "1 = whole clip, one pass";
              else if (!d) segHint.textContent = `${n} piece(s) — pick a source to see the length`;
              else segHint.textContent = `${n} piece(s) → ~${(d / n).toFixed(1)}s each      Total : ${d.toFixed(1)}s clip`;
            } else {
              const s = Math.max(0, Number(state.ltxSegmentSeconds) || 0);
              if (!s) segHint.textContent = "0 = whole clip, one pass";
              else if (!d) segHint.textContent = `${s}s per piece — pick a source to see the piece count`;
              else segHint.textContent = `${s}s per piece → ${Math.max(1, Math.round(d / s))} piece(s)      Total : ${d.toFixed(1)}s clip`;
            }
          };
          updateSegHint();
          const modeSel = select([{ value: "seconds", label: "By seconds" }, { value: "count", label: "By count" }], mode, (v) => { state.ltxSegmentMode = v; persist(); renderSegWrap(); });
          const valueField = mode === "count"
            ? numberField(state.ltxSegmentCount ?? 2, (v) => { state.ltxSegmentCount = Math.max(1, Math.round(v)); persist(); updateSegHint(); }, 1)
            : numberField(state.ltxSegmentSeconds ?? 5, (v) => { state.ltxSegmentSeconds = Math.max(0, Math.round(v)); persist(); updateSegHint(); }, 1);
          const captionLabel = label(mode === "count" ? "Piece count (1 = whole clip)" : "Seconds per piece (0 = whole clip)");
          segWrap.append(el("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } }, [
            el("div", { style: { display: "flex", alignItems: "center", gap: "4px" } }, [
              label("Split mode"),
              el("span", { text: "❔", title: "Splitting a long/large clip into fixed-length pieces upscales each on its own queue turn (VRAM freed between turns) then ffmpeg-concats — each piece is first-frame-anchored + low-denoise so the joins are seamless.", style: { cursor: "help", fontSize: "11px" } }),
            ]),
            row([col([modeSel]), col([valueField])]),
            captionLabel,
            segHint,
          ]));
        };
        renderSegWrap();
        return segWrap;
      })(),
      el("div", { text: "2x latent upscale + a light refine. Verified defaults: 3 steps / 0.15 denoise / euler_ancestral / simple. ~0.8MP / 8s per piece on 16GB (~6 min each).", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
    ]));

    // ── LTX LoRA (own list — different model from H3) ────────────────────
    // availableLoras is otherwise only lazy-loaded by H3's own mountLoraPanel() — reaching
    // LTX Upscale without ever opening that accordion in another mode left this list empty
    // (dropdown with nothing in it, search with nothing to search).
    if (!availableLoras.length) {
      getModels().then((d) => { availableLoras = d.loras || []; renderLeft(); }).catch(() => {});
    }
    const loraOpts = ["none", ...availableLoras.filter((x) => x !== "none")];
    const ltxL: LtxLoraEntry[] = state.ltxLoras ||= [];
    const ltxLoraWrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } });
    const renderLtxLoras = () => {
      clear(ltxLoraWrap);
      ltxL.forEach((l, i) => {
        const off = l.enabled === false;
        const lcard = el("div", { style: { border: `1px solid ${off ? C.dim : C.border}`, borderRadius: "6px", padding: "6px", display: "flex", flexDirection: "column", gap: "5px", opacity: off ? "0.55" : "1" } });
        const head = el("div", { style: { display: "flex", alignItems: "center", gap: "5px" } });
        const tog = el("button", {
          type: "button", text: off ? "OFF" : "ON",
          style: { flexShrink: "0", cursor: "pointer", fontFamily: "inherit", fontSize: "10px", padding: "3px 9px", borderRadius: "10px", border: "none", fontWeight: "700", background: off ? "#444" : BRAND, color: "#fff" },
          onclick: () => { l.enabled = off; persist(); renderLtxLoras(); },
        });
        const strWrap = el("div", { style: { flexShrink: "0", width: "62px" } });
        strWrap.appendChild(numberField(l.strength ?? 1.0, (v) => { l.strength = v; persist(); }, 0.05));
        const del = el("button", {
          type: "button", text: "✕", title: "Remove",
          style: { flexShrink: "0", cursor: "pointer", background: "transparent", color: C.err, border: "none", fontSize: "11px", padding: "2px 4px" },
          onclick: () => { ltxL.splice(i, 1); persist(); renderLtxLoras(); },
        });
        head.append(tog, el("div", { style: { flex: "1" } }), strWrap, del);
        const sel = searchableSelect(loraOpts, l.name || "none", (v) => { l.name = v; persist(); });
        lcard.append(head, sel.el);
        ltxLoraWrap.appendChild(lcard);
      });
      const add = el("button", {
        type: "button", text: "+ Add LoRA",
        style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "5px 10px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` },
        onclick: () => { ltxL.push({ name: "none", strength: 1.0, enabled: true }); persist(); renderLtxLoras(); },
      });
      ltxLoraWrap.appendChild(add);
      ltxLoraWrap.appendChild(el("div", { text: "Loads on the LTX 2.5 unet (before the attention patch). Separate from the H3 LoRA list.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }));
    };
    renderLtxLoras();
    const ltxLoraOn = ltxL.filter((l) => l?.name && l.name !== "none" && l.enabled !== false).length;
    leftPanel.appendChild(accordion("ltxlora", "LTX LoRA", ltxLoraOn ? `${ltxLoraOn} on` : "OFF", () => [ltxLoraWrap]));

    // ── post finish — Deblur + RTX VSR, both a quality dropdown (none = off) ──
    const QUAL = ["none", "LOW", "MEDIUM", "HIGH", "ULTRA"].map((v) => ({ value: v, label: v === "none" ? "None" : v }));
    const deblurNow = state.deblurStrength || "none";
    const rtxQualNow = state.upscaleMode === "rtx" ? (state.rtxQuality || "ULTRA") : "none";
    const rtxOn = rtxQualNow !== "none";
    leftPanel.appendChild(accordion("upscale", "Post finish",
      [deblurNow !== "none" && `Deblur ${deblurNow}`, rtxOn && `RTX VSR ${state.rtxScale ?? 2}×`].filter(Boolean).join(" → ") || "OFF",
      () => [
        col([label("Deblur"), select(QUAL, deblurNow, (v) => { state.deblurStrength = v; persist(); renderLeft(); })]),
        col([label("RTX Video Super Resolution"), select(QUAL, rtxQualNow, (v) => {
          if (v === "none") state.upscaleMode = "none";
          else { state.upscaleMode = "rtx"; state.rtxQuality = v; if (!(state.rtxScale > 0)) state.rtxScale = 2; }
          persist(); renderLeft();
        })]),
        col([label("Scale (×)"), (() => {
          const f = numberField(state.rtxScale ?? 2, (v) => { state.rtxScale = Math.max(1, v); persist(); }, 0.5);
          if (!rtxOn) { (f as HTMLInputElement).disabled = true; f.style.opacity = "0.4"; }
          return f;
        })()]),
        !ctx.availability?.RTXVideoSuperResolution ? el("div", { html: "⚠ <code>RTXVideoSuperResolution</code> not installed — RTX VSR is skipped.", style: { fontSize: "10px", color: C.warn, lineHeight: "1.5" } }) : null,
        el("div", { text: "Runs on the LTX-upscaled frames after decode. Deblur sharpens at the same size; RTX VSR scales it further (e.g. 2× → 4K).", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
      ]));

    leftPanel.appendChild(el("div", {
      html: `Models: <code>${(state.ltxUnet || "?").split(/[\\/]/).pop()}</code> · clip <code>${(state.ltxClip || "?").split(/[\\/]/).pop()}</code> — change in ⚙ Settings.`,
      style: { fontSize: "9px", color: C.muted, lineHeight: "1.6", marginTop: "2px", wordBreak: "break-all" },
    }));

    // The H3 branch below re-appends this on every render too — it lives outside leftPanel
    // (leftPanel.innerHTML = "" would otherwise wipe it), so missing this line just meant
    // it was never attached at all on a first render that lands in LTX mode.
    leftOuter.appendChild(seedGenWrap);
  }

  // ══ H3 Face Refine mode — left panel ═════════════════════════════════════
  // Tracks the face per frame, crops it to fill a canvas, re-renders it through H3, then
  // stitches it back onto the original frames. Mirrors one_node_minimax_h3.js
  // renderFaceRefineLeft (node 2235-2449) — same field names (fr*), same section order:
  // source clip -> face selection -> Face LoRA -> crop/canvas -> denoise -> stitch. Its own
  // Turbo switch is independent of the main H3 generation modes' turbo axis. Prompt lives in
  // the bottom prompt strip (renderFaceRefinePrompt in the JS source — not part of this pass);
  // the Pick Faces modal (openFacePickModal) is a later section, stubbed here.
  const FR_SELECT_MODES = [
    "largest_face", "smallest_face", "left_most", "right_most", "top_most",
    "bottom_most", "centre_most", "closest_to_xy", "manual",
  ];

  // Clears a previously confirmed manual pick whenever anything that could change what the
  // Pick Faces scan/numbering means gets edited — a stale pick would silently refine the wrong
  // face (same bug class as the picker/render numbering mismatch — SPEC §20).
  function invalidateFacePicks() {
    state.frConfirmedPick = "";
    state.frChainPicks = [];
  }
  function setFrSource(inputFilename: string, kind: string, item?: any) {
    state.frSource = inputFilename;
    state.frSourceKind = kind;
    state.frSourceMeta = null;
    invalidateFacePicks();
    // A gallery pick means "refine THIS clip" — load its saved prompt from the sidecar meta,
    // same as LTX Upscale's setLtxSource. An upload carries no prompt, so leave the box alone
    // (don't clobber a prompt the user already typed for a different clip).
    let m = (item && item.meta) || {};
    if (typeof m === "string") { try { m = JSON.parse(m); } catch { m = {}; } }
    const p = (item && item.prompt) || m.prompt || (Array.isArray(m.prompts) && m.prompts[0]) || "";
    if (kind === "gallery") {
      if (String(p).trim()) { state.frPrompt = String(p); showPopup("Prompt loaded from the clip's saved metadata.", false); }
      else showPopup("That clip has no prompt saved in its metadata — write one by hand.", true);
    } else if (String(p).trim() && !String(state.frPrompt || "").trim()) {
      state.frPrompt = String(p);
    }
    persist();
    renderLeft();
    renderPrompts();
  }

  function renderFaceRefineLeft() {
    setLeftLocked(running);
    leftPanel.innerHTML = "";

    if (!faceRefineReady(state)) {
      leftPanel.appendChild(panel([
        el("div", { html: "⚙ <b>H3 Face Refine</b> needs a face detector set first.<br>Open <b>⚙ Settings → Models → H3 Face Refine</b> and pick one.", style: { fontSize: "12px", lineHeight: "1.6" } }),
        el("div", { text: "missing: " + faceRefineMissing(state).join(", "), style: { fontSize: "11px", color: C.warn, marginTop: "4px" } }),
      ]));
      leftOuter.appendChild(seedGenWrap);
      return;
    }

    // ── source clip ────────────────────────────────────────────────────────
    const hasSrc = !!state.frSource;
    const srcKids: (Node | null)[] = [label("Source clip")];
    const card = el("div", { style: {
      position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#000",
      borderRadius: "8px", overflow: "hidden", border: `1px solid ${hasSrc ? BRAND : C.border}`,
      display: "flex", alignItems: "center", justifyContent: "center",
    } });
    if (hasSrc) {
      const vid = el("video", {
        src: `${comfyApi.base}/view?filename=${encodeURIComponent(state.frSource)}&type=input`,
        controls: true, muted: true, preload: "metadata",
        style: { width: "100%", height: "100%", objectFit: "contain", background: "#000", display: "block" },
      });
      card.appendChild(vid);
      card.appendChild(el("button", {
        type: "button", text: "✕", title: "Clear source", style: {
          position: "absolute", top: "6px", right: "6px", zIndex: "3", width: "24px", height: "24px",
          border: "none", borderRadius: "6px", background: "rgba(0,0,0,0.7)", color: "#fff", cursor: "pointer", fontSize: "12px",
        },
        onclick: () => { state.frSource = ""; state.frSourceKind = "gallery"; state.frSourceMeta = null; persist(); renderLeft(); renderPrompts(); },
      }));
    } else {
      card.appendChild(el("div", { text: "no source clip", style: { color: C.muted, fontSize: "12px" } }));
    }
    srcKids.push(card);

    const fileInp = el("input", { type: "file", accept: "video/*", style: { display: "none" } }) as HTMLInputElement;
    fileInp.addEventListener("change", async () => {
      const f = fileInp.files?.[0]; fileInp.value = "";
      if (!f) return;
      try { showPopup("Uploading…", false); const name = await uploadMedia(f); setFrSource(name, "upload"); }
      catch (e: any) { showPopup(e.message, true); }
    });
    const galBtn = button("🖼 From gallery", () => galleryOv.showPicker((inputFilename, item) => setFrSource(inputFilename, "gallery", item)));
    const upBtn = button("⬆ Upload", () => fileInp.click());
    galBtn.style.flex = "1"; upBtn.style.flex = "1";
    srcKids.push(el("div", { style: { display: "flex", gap: "8px" } }, [galBtn, upBtn]));
    srcKids.push(fileInp);
    srcKids.push(el("div", {
      text: "Tracks the face per frame, crops it to fill a canvas, re-renders it through H3, then stitches it back onto the original frames.",
      style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" },
    }));
    leftPanel.appendChild(panel(srcKids));

    // ── face selection ────────────────────────────────────────────────────
    const isManualSelect = state.frSelect === "manual";
    leftPanel.appendChild(accordion("frface", "Face selection", isManualSelect ? "Manual" : (state.frSelect || "largest_face"), () => {
      const kids: (Node | null)[] = [
        row([
          col([label("Select"), select(FR_SELECT_MODES.map((s) => ({ value: s, label: s })), state.frSelect || "largest_face", (v) => { state.frSelect = v; invalidateFacePicks(); persist(); renderLeft(); })]),
          col([label("Confidence"), numberField(state.frConfidence ?? 0.35, (v) => { state.frConfidence = Math.min(0.95, Math.max(0.05, v)); invalidateFacePicks(); persist(); }, 0.05)]),
        ]),
        row([
          col([checkboxRow("Identity reference", state.frIdentityTrack !== false, (v) => { state.frIdentityTrack = v; persist(); })]),
          col([checkboxRow("Cut detection", !!state.frCutDetection, (v) => { state.frCutDetection = v; invalidateFacePicks(); persist(); })]),
        ]),
      ];
      if (isManualSelect) {
        const pickBtn = button("🎯 Pick Faces", () => openFacePickModal());
        pickBtn.style.width = "100%";
        // The scan endpoint decodes the whole clip up front — never call it while anything
        // else is queued/running on this screen (SPEC_MINIMAX_H3_FACE_REFINE.md §21: scanning
        // during another render can wedge the ComfyUI process). Same `running` flag every
        // other run-gated control on this screen already checks.
        if (running) {
          pickBtn.disabled = true;
          pickBtn.style.opacity = "0.5";
          pickBtn.title = "A render is already running — wait for it to finish first.";
        }
        kids.push(pickBtn);
        if (running) kids.push(el("div", { text: "⏳ A render is running — Pick Faces is disabled until it finishes.", style: { fontSize: "10px", color: C.warn } }));
      }
      kids.push(el("div", {
        text: isManualSelect
          ? "Manual: you choose the subject per shot in Pick Faces."
          : "Which face is the subject, chosen once per shot (or per clip if Cut detection is off). "
            + "Identity reference holds one person through a crowd once a face is locked on.",
        style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" },
      }));
      return kids;
    }));

    // ── crop / canvas ─────────────────────────────────────────────────────
    leftPanel.appendChild(accordion("frcrop", "Crop / Canvas", state.frCanvasMode === "manual" ? `Manual ${state.frCanvasWidth ?? 768}x${state.frCanvasHeight ?? 768}` : (state.frCanvasMode || "auto_capped_768"), () => [
      row([
        col([label("Crop factor"), numberField(state.frCropFactor ?? 2.5, (v) => { state.frCropFactor = Math.min(8, Math.max(1.2, v)); persist(); }, 0.1)]),
        col([label("Canvas mode"), select([
          { value: "auto_capped_768", label: "Auto (capped 768)" },
          { value: "auto_no_downscale", label: "Auto (no downscale)" },
          { value: "manual", label: "Manual" },
        ], state.frCanvasMode || "auto_capped_768", (v) => { state.frCanvasMode = v; persist(); renderLeft(); })]),
      ]),
      state.frCanvasMode === "manual" ? row([
        col([label("Canvas width"), numberField(state.frCanvasWidth ?? 768, (v) => { state.frCanvasWidth = Math.round(v); persist(); }, 32)]),
        col([label("Canvas height"), numberField(state.frCanvasHeight ?? 768, (v) => { state.frCanvasHeight = Math.round(v); persist(); }, 32)]),
      ]) : null,
      row([
        col([label("Smooth window"), numberField(state.frSmoothWindow ?? 21, (v) => { state.frSmoothWindow = Math.max(1, Math.round(v)); persist(); }, 2)]),
      ]),
    ]));

    // ── denoise ────────────────────────────────────────────────────────────
    // Face Refine's own Turbo switch — independent of whatever the main H3 generation modes
    // are set to. OFF: Steps/Sampler below are free-editable. ON: a saved turbo preset's full
    // accel recipe applies and Steps/Sampler are hidden — a turbo LoRA's step count is not a
    // preference to override.
    const frTurboPresets: { id: string; label: string }[] = [
      ...userPresets.filter((p) => p.turbo && p.turbo !== "none").map((p) => ({ id: `u:${p.name}`, label: `★ ${p.name}` })),
      ...PIPELINE_PRESETS.filter((p) => p.turbo && p.turbo !== "none").map((p) => ({ id: `s:${p.id}`, label: p.label })),
    ];
    leftPanel.appendChild(accordion("frdenoise", "Denoise", state.frTurboOn ? "Turbo" : `${state.frSteps ?? 8} steps`, () => {
      const kids: (Node | null)[] = [
        row([col([checkboxRow("Turbo", !!state.frTurboOn, (v) => { state.frTurboOn = v; persist(); renderLeft(); })])]),
      ];
      if (state.frTurboOn) {
        if (frTurboPresets.length) {
          const curId = state.frTurboPreset || frTurboPresets[0].id;
          if (!state.frTurboPreset) { state.frTurboPreset = curId; persist(); }
          kids.push(row([col([label("Turbo preset"), select(frTurboPresets.map((p) => ({ value: p.id, label: p.label })), curId, (v) => { state.frTurboPreset = v; persist(); })])]));
        } else {
          kids.push(el("div", { text: "No turbo preset found — save one (with a turbo LoRA set) from the main panel's Preset menu first.", style: { fontSize: "10px", color: C.warn } }));
        }
      } else {
        kids.push(row([
          col([label("Steps"), numberField(state.frSteps ?? 8, (v) => { state.frSteps = Math.max(1, Math.round(v)); persist(); }, 1)]),
          col([label("Sampler"), select(SAMPLERS.map((s) => ({ value: s, label: s })), state.frSampler || "euler", (v) => { state.frSampler = v; persist(); })]),
        ]));
      }
      kids.push(row([
        col([label("Base denoise"), numberField(state.frDenoise ?? 0.40, (v) => { state.frDenoise = Math.min(1, Math.max(0.01, v)); persist(); }, 0.01)]),
      ]));
      kids.push(row([
        col([label("Small-face ×"), numberField(state.frDenoiseMulSmall ?? 1.0, (v) => { state.frDenoiseMulSmall = Math.min(1, Math.max(0, v)); persist(); }, 0.05)]),
        col([label("Large-face ×"), numberField(state.frDenoiseMulLarge ?? 0.35, (v) => { state.frDenoiseMulLarge = Math.min(1, Math.max(0, v)); persist(); }, 0.05)]),
      ]));
      kids.push(row([
        col([label("Small face px"), numberField(state.frFacePxSmall ?? 30.0, (v) => { state.frFacePxSmall = Math.max(1, v); persist(); }, 1)]),
        col([label("Large face px"), numberField(state.frFacePxLarge ?? 120.0, (v) => { state.frFacePxLarge = Math.max(1, v); persist(); }, 1)]),
      ]));
      kids.push(el("div", {
        text: "Base denoise and the two multipliers are tuned as a set — the default 0.40 base is gentled down per frame by these (small face = full strength, large face = ×0.35). Change one, expect to retune the others.",
        style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" },
      }));
      return kids;
    }));

    // ── Face LoRA (own list — e.g. a face-detail LoRA, never state.loras) ─────
    const loraOpts = ["none", ...availableLoras.filter((x) => x !== "none")];
    const frL: LtxLoraEntry[] = state.frLoras ||= [];
    const frLoraWrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } });
    const renderFrLoras = () => {
      clear(frLoraWrap);
      frL.forEach((l, i) => {
        const off = l.enabled === false;
        const lcard = el("div", { style: { border: `1px solid ${off ? C.dim : C.border}`, borderRadius: "6px", padding: "6px", display: "flex", flexDirection: "column", gap: "5px", opacity: off ? "0.55" : "1" } });
        const head = el("div", { style: { display: "flex", alignItems: "center", gap: "5px" } });
        const tog = el("button", {
          type: "button", text: off ? "OFF" : "ON",
          style: { flexShrink: "0", cursor: "pointer", fontFamily: "inherit", fontSize: "10px", padding: "3px 9px", borderRadius: "10px", border: "none", fontWeight: "700", background: off ? "#444" : BRAND, color: "#fff" },
          onclick: () => { l.enabled = off; persist(); renderFrLoras(); },
        });
        const strWrap = el("div", { style: { flexShrink: "0", width: "62px" } });
        strWrap.appendChild(numberField(l.strength ?? 1.0, (v) => { l.strength = v; persist(); }, 0.05));
        const del = el("button", {
          type: "button", text: "✕", title: "Remove",
          style: { flexShrink: "0", cursor: "pointer", background: "transparent", color: C.err, border: "none", fontSize: "11px", padding: "2px 4px" },
          onclick: () => { frL.splice(i, 1); persist(); renderFrLoras(); },
        });
        head.append(tog, el("div", { style: { flex: "1" } }), strWrap, del);
        const sel = searchableSelect(loraOpts, l.name || "none", (v) => { l.name = v; persist(); });
        lcard.append(head, sel.el);
        frLoraWrap.appendChild(lcard);
      });
      const add = el("button", {
        type: "button", text: "+ Add LoRA",
        style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "5px 10px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` },
        onclick: () => { frL.push({ name: "none", strength: 1.0, enabled: true }); persist(); renderFrLoras(); },
      });
      frLoraWrap.appendChild(add);
      frLoraWrap.appendChild(el("div", { text: "Applied on top of the model this run uses — e.g. a face-detail LoRA. Separate from the main H3 LoRA list.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }));
    };
    renderFrLoras();
    const frLoraOn = frL.filter((l) => l?.name && l.name !== "none" && l.enabled !== false).length;
    leftPanel.appendChild(accordion("frlora", "Face LoRA", frLoraOn ? `${frLoraOn} on` : "OFF", () => [frLoraWrap]));

    // ── stitch ─────────────────────────────────────────────────────────────
    leftPanel.appendChild(accordion("frstitch", "Stitch", state.frPasteRegion || "face_only", () => [
      row([
        col([label("Paste region"), select([
          { value: "face_only", label: "Face only" },
          { value: "face_ellipse", label: "Face (ellipse)" },
          { value: "full_crop", label: "Full crop" },
        ], state.frPasteRegion || "face_only", (v) => { state.frPasteRegion = v; persist(); })]),
        col([label("Feather"), numberField(state.frFeather ?? 6, (v) => { state.frFeather = Math.max(0, Math.round(v)); persist(); }, 2)]),
      ]),
      row([
        col([label("Colour match"), numberField(state.frColourMatch ?? 1.0, (v) => { state.frColourMatch = Math.min(1, Math.max(0, v)); persist(); }, 0.05)]),
        col([label("Blend"), numberField(state.frBlend ?? 1.0, (v) => { state.frBlend = Math.min(1, Math.max(0, v)); persist(); }, 0.05)]),
      ]),
    ]));

    leftOuter.appendChild(seedGenWrap);
  }

  // Pick Faces modal — mirrors one_node_minimax_h3.js openFacePickModal (node 1978-2234).
  // Scans the source clip once via /h3_facerefine/scan, then lets the user pick the subject
  // face(s): a single-shot clip gets an ORDERED multi-click chain (each click chains another
  // H3 Face Refine pass over the previous pass's own output — runFaceRefine below); a
  // multi-shot (cut-detected) clip gets one face pick per shot instead.
  async function openFacePickModal() {
    if (!state.frSource) { showPopup("Pick a source clip first.", true); return; }
    if (running) { showPopup("A render is already running — wait for it to finish before scanning for faces.", true); return; }

    const overlay = el("div", { style: {
      position: "fixed", inset: "0", background: "rgba(0,0,0,0.75)", zIndex: "100060",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "20px",
    } });
    const modal = el("div", { style: {
      background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px",
      width: "min(900px, 100%)", maxHeight: "90vh", overflowY: "auto", padding: "16px",
      display: "flex", flexDirection: "column", gap: "12px", boxSizing: "border-box",
    } });
    const title = el("div", { text: "Pick Faces", style: { fontSize: "14px", fontWeight: "700", color: C.text } });
    // The scan is one blocking request with nothing to show yet — same big-centered-purple
    // treatment as the main render's own pre-sampling banner, then drops back to small/muted
    // once real content (shot cards, or an error) has something to show.
    const status = el("div", { text: "🔍 Scanning the clip for faces and cuts…", style: {
      fontSize: "18px", fontWeight: "700", color: "#b57bff", textAlign: "center",
      padding: "24px 16px", textShadow: "0 0 12px rgba(181,123,255,0.5)",
    } });
    const scanningStyle = () => {
      status.style.fontSize = "12px"; status.style.fontWeight = "400";
      status.style.color = C.muted; status.style.textAlign = "left";
      status.style.padding = "0"; status.style.textShadow = "none";
    };
    const capWarn = el("div", { style: { fontSize: "11px", color: C.warn, display: "none" } });
    const cardsWrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "12px" } });
    const closeBtn = button("✕ Cancel", () => overlay.remove(), "default");
    const useBtn = button("✓ Use these", () => {}, "primary");
    useBtn.disabled = true; useBtn.style.opacity = "0.5";
    const footer = el("div", { style: { display: "flex", gap: "8px", justifyContent: "flex-end" } }, [closeBtn, useBtn]);
    modal.append(title, status, capWarn, cardsWrap, footer);
    overlay.appendChild(modal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    let shots: any[] = [];
    const picks: (number | null)[] = [];   // per-shot single chosen face index (multi-shot path); -1 = "not in this shot"; null = unanswered
    const order: number[] = [];            // single-shot path: ORDERED list of face indices to chain through — §12

    // /h3_facerefine/scan decodes the WHOLE clip into memory up front (same class of issue
    // the gallery's chunked post-process already works around) — CPU+RAM, not GPU/VRAM, so a
    // long/large clip can exhaust system RAM and hang the whole ComfyUI process rather than
    // erroring cleanly. Cap frame_load_cap with the same byte-budget formula used for gallery
    // post-process chunking (1.25 GB / (w*h*16), clamped 8..240) so a long clip only scans its
    // opening window instead of loading everything.
    let scanFrameCap = 0;
    try {
      const info = await getVideoInfo(state.frSource, "", "input");
      const totalFrames = info.frames || 0;
      const perFrameBytes = Math.max(1, (info.width || 0) * (info.height || 0) * 16);
      const budgetFrames = Math.max(8, Math.min(240, Math.floor((1.25 * 1024 ** 3) / perFrameBytes)));
      if (totalFrames > budgetFrames) scanFrameCap = budgetFrames;
    } catch { /* video_info unavailable — scan uncapped, same as before */ }

    try {
      const d = await scanFaceRefine({
        video: state.frSource, detector: state.faceDetector, confidence: state.frConfidence ?? 0.35,
        cut_detection: state.frCutDetection ? "auto (pyscenedetect)" : "none",
        cut_threshold: state.frCutThreshold ?? 3.0,
        frame_load_cap: scanFrameCap,
      });
      scanningStyle();
      if (scanFrameCap) {
        capWarn.textContent = `⚠ Large clip — scan capped to the first ${scanFrameCap} frames to avoid exhausting RAM. Cuts after that point won't show up here.`;
        capWarn.style.display = "";
      }
      shots = d.shots || [];
      if (!shots.length) throw new Error("No shots found.");

      if (shots.length === 1) {
        // ── single-shot clip: pick MULTIPLE faces, in the order to chain them ──
        // Each pick becomes its own H3 Face Refine pass over the PREVIOUS pass's own output
        // (runFaceRefine's chain loop) — "5 faces found, only 3/5/7 in this order" is exactly
        // clicking them in that order here.
        const shot = shots[0];
        status.textContent = `${shot.faces} face(s) found — click them in the order to refine (skip anyone you don't want).`;
        const imgWrap = el("div", { style: { position: "relative", width: "100%", background: "#000", borderRadius: "6px", overflow: "hidden" } });
        const chipsWrap = el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } });
        const orderLine = el("div", { style: { fontSize: "11px", color: C.muted } });

        function renderChips() {
          clear(chipsWrap);
          for (let fi = 0; fi < shot.faces; fi++) {
            const pos = order.indexOf(fi);
            const on = pos >= 0;
            const chip = el("button", { type: "button", text: on ? `${fi} (${pos + 1})` : String(fi), style: {
              minWidth: "34px", height: "26px", borderRadius: "13px", cursor: "pointer", fontSize: "11px",
              padding: "0 8px", border: `1px solid ${on ? BRAND : C.border}`, background: on ? BRAND : C.bg2,
              color: on ? "#fff" : C.text,
            } });
            chip.addEventListener("click", () => {
              const p = order.indexOf(fi);
              if (p >= 0) order.splice(p, 1); else order.push(fi);
              renderChips(); renderBoxes();
            });
            chipsWrap.appendChild(chip);
          }
          orderLine.textContent = order.length
            ? `Order: ${order.join(" → ")} (${order.length} pass${order.length > 1 ? "es" : ""})` : "Nothing picked yet.";
          useBtn.disabled = order.length === 0;
          useBtn.style.opacity = useBtn.disabled ? "0.5" : "1";
        }
        function renderBoxes() {
          clear(imgWrap);
          if (!shot.jpg) {
            imgWrap.appendChild(el("div", { text: "no face found", style: { color: C.muted, fontSize: "11px", padding: "24px", textAlign: "center" } }));
            return;
          }
          imgWrap.appendChild(el("img", { src: `data:image/jpeg;base64,${shot.jpg}`, style: { width: "100%", display: "block" } }));
          (shot.boxes || []).forEach((b: number[], fi: number) => {
            const [x0, y0, x1, y1] = b;
            const pos = order.indexOf(fi);
            const on = pos >= 0;
            const box = el("div", { title: `Face ${fi}`, style: {
              position: "absolute", left: `${x0 * 100}%`, top: `${y0 * 100}%`,
              width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%`,
              border: `2px solid ${on ? BRAND : "rgba(255,255,255,0.7)"}`, borderRadius: "3px",
              cursor: "pointer", boxSizing: "border-box",
            } });
            if (on) box.appendChild(el("div", { text: String(pos + 1), style: {
              position: "absolute", top: "-9px", left: "-9px", width: "18px", height: "18px",
              borderRadius: "9px", background: BRAND, color: "#fff", fontSize: "10px",
              display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "700",
            } }));
            box.addEventListener("click", () => {
              const p = order.indexOf(fi);
              if (p >= 0) order.splice(p, 1); else order.push(fi);
              renderChips(); renderBoxes();
            });
            imgWrap.appendChild(box);
          });
        }
        renderBoxes(); renderChips();
        cardsWrap.appendChild(el("div", { style: { border: `1px solid ${C.border}`, borderRadius: "8px", padding: "8px", display: "flex", flexDirection: "column", gap: "6px" } }, [imgWrap, chipsWrap, orderLine]));
      } else {
        // ── multiple shots (cuts): one subject per shot, no cross-person chain ──
        status.textContent = `${shots.length} shot(s) found${d.cached ? " (cached scan)" : ""} — click a face per shot.`;
        const prior = String(state.frConfirmedPick || "").split(",").map((s) => parseInt(s.trim(), 10));
        const priorValid = prior.length === shots.length && prior.every((n) => !Number.isNaN(n));

        shots.forEach((shot, i) => {
          picks[i] = priorValid ? prior[i] : null;
          const card = el("div", { style: { border: `1px solid ${C.border}`, borderRadius: "8px", padding: "8px", display: "flex", flexDirection: "column", gap: "6px" } });
          const imgWrap = el("div", { style: { position: "relative", width: "100%", background: "#000", borderRadius: "6px", overflow: "hidden" } });
          const chipsWrap = el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } });

          function renderChips() {
            clear(chipsWrap);
            for (let fi = 0; fi < shot.faces; fi++) {
              const on = picks[i] === fi;
              const chip = el("button", { type: "button", text: String(fi), style: {
                width: "26px", height: "26px", borderRadius: "13px", cursor: "pointer", fontSize: "11px",
                border: `1px solid ${on ? BRAND : C.border}`, background: on ? BRAND : C.bg2,
                color: on ? "#fff" : C.text,
              } });
              chip.addEventListener("click", () => { picks[i] = fi; renderChips(); renderBoxes(); });
              chipsWrap.appendChild(chip);
            }
            const noneOn = picks[i] === -1;
            const noneChip = el("button", { type: "button", text: "not in this shot", style: {
              padding: "4px 8px", borderRadius: "6px", cursor: "pointer", fontSize: "11px",
              border: `1px solid ${noneOn ? BRAND : C.border}`, background: noneOn ? BRAND : C.bg2,
              color: noneOn ? "#fff" : C.text,
            } });
            noneChip.addEventListener("click", () => { picks[i] = -1; renderChips(); renderBoxes(); });
            chipsWrap.appendChild(noneChip);
            useBtn.disabled = picks.some((p) => p == null);
            useBtn.style.opacity = useBtn.disabled ? "0.5" : "1";
          }

          function renderBoxes() {
            clear(imgWrap);
            if (!shot.jpg) {
              imgWrap.appendChild(el("div", { text: "no face found in this shot", style: { color: C.muted, fontSize: "11px", padding: "24px", textAlign: "center" } }));
              return;
            }
            imgWrap.appendChild(el("img", { src: `data:image/jpeg;base64,${shot.jpg}`, style: { width: "100%", display: "block" } }));
            (shot.boxes || []).forEach((b: number[], fi: number) => {
              const [x0, y0, x1, y1] = b;
              const on = picks[i] === fi;
              const box = el("div", { title: `Face ${fi}`, style: {
                position: "absolute", left: `${x0 * 100}%`, top: `${y0 * 100}%`,
                width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%`,
                border: `2px solid ${on ? BRAND : "rgba(255,255,255,0.7)"}`, borderRadius: "3px",
                cursor: "pointer", boxSizing: "border-box",
              } });
              box.addEventListener("click", () => { picks[i] = fi; renderChips(); renderBoxes(); });
              imgWrap.appendChild(box);
            });
          }

          renderBoxes(); renderChips();
          card.append(
            el("div", { text: `Shot ${i + 1} — frame ${shot.frame} — ${shot.faces} face(s) detected`, style: { fontSize: "11px", color: C.muted } }),
            imgWrap, chipsWrap,
          );
          cardsWrap.appendChild(card);
        });
        useBtn.disabled = picks.some((p) => p == null);
        useBtn.style.opacity = useBtn.disabled ? "0.5" : "1";
      }
    } catch (e: any) {
      scanningStyle();
      status.textContent = `Error: ${e.message}`;
      status.style.color = C.warn;
    }

    useBtn.addEventListener("click", () => {
      if (shots.length === 1) {
        if (!order.length) return;
        state.frChainPicks = order.slice();
        state.frConfirmedPick = String(order[0]);
        persist();
        overlay.remove();
        showPopup(`Face picks saved — ${order.length} pass${order.length > 1 ? "es" : ""} queued.`, false);
      } else {
        if (picks.some((p) => p == null)) return;
        state.frChainPicks = [];
        state.frConfirmedPick = picks.join(",");
        persist();
        overlay.remove();
        showPopup(`Face picks saved — ${shots.length} shot(s).`, false);
      }
      renderLeft();
    });
  }

  // Face Refine run — mirrors one_node_minimax_h3.js runFaceRefine (node 3885-4000). Single
  // queue, no pre-planned segmentation (unlike LTX Upscale — the frame count here is unknown
  // until the tracker actually runs, so there's nothing to segment-plan up front). A manual
  // multi-face pick (frChainPicks.length > 1) chains that many H3 Face Refine passes, each one
  // over the PREVIOUS pass's own queued output; only the last pass's output is saved to the
  // gallery, with the full pick order recorded in its meta.
  async function runFaceRefine() {
    if (running) return;
    if (!faceRefineReady(state)) { showPopup("Set a face detector in ⚙ Settings → Models first — missing: " + faceRefineMissing(state).join(", "), true); return; }
    if (!state.frSource) { showPopup("Pick a source clip (gallery) or upload a video.", true); return; }
    if (state.frSelect === "manual" && !String(state.frConfirmedPick || "").trim() && !(state.frChainPicks || []).length) {
      showPopup("Select is Manual but no face has been picked yet.", true); return;
    }

    if (state.seedMode === "randomize") { state.seed = randomSeed(); seedInput.value = String(state.seed); }
    else if (state.seedMode === "increment") { state.seed = (state.seed || 0) + 1; seedInput.value = String(state.seed); }
    else if (state.seedMode === "decrement") { state.seed = Math.max(0, (state.seed || 0) - 1); seedInput.value = String(state.seed); }
    persist();
    const rs: MinimaxState = JSON.parse(JSON.stringify(state));
    const chain = rs.frSelect === "manual" && Array.isArray(rs.frChainPicks) && rs.frChainPicks.length > 1
      ? rs.frChainPicks : null;

    running = true; stopRequested = false;
    genBtn.disabled = true; genBtn.textContent = "⏳ Face Refine…";
    nextGenBtn.style.display = "none";
    setLeftLocked(true);
    resetPreview(); barInner.style.width = "0%";
    startClock();
    keepTabAlive(true);
    let out: any = null;
    try {
      if (!ctx.availability || !Object.keys(ctx.availability).length) {
        const av = await getNodeAvailability();
        ctx.availability = av.available || {}; ctx.availabilityInfo = av;
      }

      let sourceFile = rs.frSource;
      let lastMeta: any = null;
      const steps = chain || [null as number | null]; // null = single-subject run, uses rs.frConfirmedPick as-is

      for (let i = 0; i < steps.length; i++) {
        if (stopRequested) throw new Error("Stopped.");
        const passLabel = chain ? ` — pass ${i + 1}/${chain.length} (face ${chain[i]})` : "";
        setStatus(`Face Refine${passLabel} · queued (tracking + per-frame img2img)`);
        // Detection/tracking runs before sampling and streams nothing of its own — show the
        // big centered banner for that silent stretch, cleared by either a live preview frame
        // or the first numeric step callback (both wired above).
        placeholder.style.display = "none";
        frDetectBanner.style.display = "flex";
        samplingActive = true;
        applyPreviewOffState();

        const built = buildFaceRefineGraph(rs, ctx.availability, {
          nodeId: instanceId, sourceFile, promptText: rs.frPrompt, seed: rs.seed,
          refImages: rs.refImages, userPresets,
          confirmedPickOverride: chain ? String(chain[i]) : undefined,
        });
        lastMeta = built.meta;
        let r;
        try {
          r = await queuePrompt(built.graph, {
            onProgress: (v, m) => {
              setStepProgress(chain ? (i + (v || 0) / (m || 1)) : v, chain ? chain.length : m);
              setStatus(`Face Refine${passLabel} · step ${v}/${m}`);
            },
            samplerNode: "MM:sampler",
          });
        } finally {
          samplingActive = false;
          frDetectBanner.style.display = "none";
        }
        out = firstOutput(r.byNode, "FR:save");
        if (!out) throw new Error(`Face Refine${passLabel} produced no output.`);

        // Not the last pass: this pass's own output becomes the next pass's source — copy to
        // input/ so the next VHS_LoadVideo/H3FaceSelect can read it.
        if (i < steps.length - 1) {
          sourceFile = await copyOutputToInput(out.filename, out.subfolder || "", "output");
          try { await freeMemory(); } catch {}
        }
      }
      if (!out) throw new Error("Face Refine produced no output.");

      const clipMeta: any = {
        v: 1, prompt: String(rs.frPrompt || ""), mode: "facerefine",
        source: rs.frSource, sourceKind: rs.frSourceKind,
        faceRefine: {
          select: rs.frSelect, detector: rs.faceDetector, cropFactor: rs.frCropFactor,
          canvasMode: rs.frCanvasMode, denoise: rs.frDenoise,
          turboMode: lastMeta?.turboMode, loras: lastMeta?.loras || [],
          // Records the full chain order (not just the last pass's own single pick) so a
          // later Reuse/inspection can see every subject this clip's passes ran through.
          ...(chain ? { chainPicks: chain } : {}),
        },
        steps: lastMeta?.steps, seed: lastMeta?.seed,
        elapsedSec: (Date.now() - runStart) / 1000,
      };
      await reconcileGeometry(clipMeta, out);
      saveMeta(out.filename, out.subfolder || "", clipMeta);

      const url = outputViewUrl(out.filename, out.subfolder || "", out.type || "output");
      showResultVideo(url);
      badge.classList.remove("hidden");
      badge.textContent = "FACE REFINED";
      setStatus(`Done — ${out.filename}`);
      barInner.style.width = "100%";
      try { refreshGallery(); } catch {}
    } catch (e: any) {
      if (e.message === "Stopped.") {
        setStatus("Stopped.");
      } else {
        const why = explainGenerationError(e.message);
        setStatus(why ? `Error: ${why}` : `Error: ${e.message}`);
        showPopup(why || e.message, true);
      }
    } finally {
      frDetectBanner.style.display = "none";
      samplingActive = false;
      try { await freeMemory(); } catch {}
      running = false; stopRequested = false;
      genBtn.disabled = false; genBtn.textContent = "▶ Generate";
      placeholder.innerHTML = "▶ Generate to render the first clip<br><span style='font-size:10px'>live sampling frames appear here</span>";
      setLeftLocked(false);
      stopClock();
      keepTabAlive(false);
    }
  }

  function renderLeft() {
    if (state.generationMode === "ltxupscale") { renderLtxUpscaleLeft(); return; }
    if (state.generationMode === "facerefine") { renderFaceRefineLeft(); return; }
    setLeftLocked(false); // the lock overlay is LTX Upscale-only
    const contModes = continuityModesFor(state.generationMode, state);
    const cur = contModes.find((m) => m.key === state.continuityMode);
    if (!cur || cur.disabled) {
      state.continuityMode = "none";
      persist();
    }
    leftPanel.innerHTML = "";

    fixupPipelineAxes();
    persist();

    // Canvas
    leftPanel.appendChild(
      panel([
        label("Canvas"),
        row([
          col([label("Aspect"), select(ASPECTS.map((a) => ({ value: a.label, label: a.label })), state.aspect, (v) => { state.aspect = v; persist(); refreshPlan(); })]),
          col([label("Megapixels"), numberField(state.megapixels ?? 1.0, (v) => { state.megapixels = Math.max(0.1, v); persist(); refreshPlan(); }, 0.1)]),
        ]),
      ])
    );

    // Clip length
    planLine = el("div", { style: { fontSize: "11px", lineHeight: "1.65", color: C.text } });
    totalLine = el("div", { style: { textAlign: "center", padding: "6px 0 2px", lineHeight: "1.1", borderBottom: `1px solid ${C.border}`, marginBottom: "5px" } });
    leftPanel.appendChild(
      panel([
        label("Clip length"),
        select(
          [...CLIP_LENGTHS.map((c) => ({ value: String(c.frames), label: c.label })), { value: "custom", label: "Custom (seconds)…" }],
          state.clipLengthCustom ? "custom" : String(state.clipFrames),
          (v) => {
            if (v === "custom") {
              state.clipLengthCustom = true;
              state.clipFrames = alignFrameCount(state.clipLengthCustomSec * FPS);
            } else {
              state.clipLengthCustom = false;
              state.clipFrames = parseInt(v, 10);
            }
            persist();
            renderLeft();
          }
        ),
        state.clipLengthCustom
          ? row([
              numberField(state.clipLengthCustomSec, (v) => {
                state.clipLengthCustomSec = Math.max(0.1, v);
                state.clipFrames = alignFrameCount(state.clipLengthCustomSec * FPS);
                persist();
                refreshPlan();
              }, 0.1),
            ])
          : null,
        totalLine,
        planLine,
        el("div", { text: "Length follows the prompts: one prompt is one clip. Add a prompt (or split the brief into shots) to make the piece longer. Clips are saved separately — combine them afterward from 🖼 Gallery.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
      ])
    );
    refreshPlan();

    // Preset — sets six pipeline axes at once from a named combination, either one of the six
    // built-in benchmarked ones (SPEC_MINIMAX_H3_PRESETS.md) or a user's own saved combination
    // (SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §14). The selection is derived, never stored:
    // matchPreset()/matchUserPreset() re-check the axes on every render, so hand-editing any
    // control underneath falls back to "Custom" on its own instead of going on naming a
    // combination that no longer applies. Never touches steps/seed/length/resolution/model
    // pickers. User presets sort above the built-ins in the dropdown and are the only ones
    // Save/Setting can create or touch — the six built-ins stay read-only, since a user preset
    // that shadowed one would silently change what a shared preset number means.
    {
      const userMatch = matchUserPreset(state, userPresets);
      const sysMatch = userMatch ? null : matchPreset(state);
      const options: { value: string; label: string; disabled?: boolean }[] = [{ value: "", label: "— Custom (current settings) —" }];
      if (userPresets.length) {
        options.push({ value: "__sep_user__", label: "────── User Preset ──────", disabled: true });
        userPresets.forEach((p) => options.push({ value: `u:${p.name}`, label: `★ ${p.name}` }));
      }
      options.push({ value: "__sep_sys__", label: "───── System Preset ─────", disabled: true });
      PIPELINE_PRESETS.forEach((p) => options.push({ value: `s:${p.id}`, label: `${p.category} — ${p.label}` }));

      const selected = userMatch ? `u:${userMatch.name}` : sysMatch ? `s:${sysMatch.id}` : "";
      const noteText = userMatch ? null : sysMatch?.note || null;

      const saveBtn = button("Save", async () => {
        const existing = userMatch?.name || "";
        const name = await promptDialog("Save this pipeline combination as:", existing);
        if (name == null) return;
        const trimmed = name.trim();
        if (!trimmed) { showPopup("Name can't be empty.", true); return; }
        const willOverwrite = userPresets.some((p) => p.name === trimmed);
        if (willOverwrite && !(await confirmDialog(`"${trimmed}" already exists — overwrite it?`))) return;
        const entry = presetFromState(state, trimmed);
        const next = willOverwrite ? userPresets.map((p) => (p.name === trimmed ? entry : p)) : [...userPresets, entry];
        try {
          await saveUserPresets(next);
          userPresets = next;
          showPopup(`Saved "${trimmed}".`, false);
          renderLeft();
        } catch (e: any) {
          showPopup(`Save failed: ${e.message || e}`, true);
        }
      });
      const settingBtn = button("Setting", () => openPresetManager());
      // Same full width as the dropdown, split 50:50; 5px below it.
      const btnRow = el("div", { class: "flex gap-1.5", style: { marginTop: "5px" } }, [
        el("div", { class: "flex-1" }, [saveBtn]),
        el("div", { class: "flex-1" }, [settingBtn]),
      ]);
      (saveBtn as HTMLElement).style.width = "100%";
      (settingBtn as HTMLElement).style.width = "100%";

      leftPanel.appendChild(
        panel([
          label("Preset"),
          select(options, selected, (v) => {
            if (v === "__sep_user__" || v === "__sep_sys__") return; // disabled — select() shouldn't land here, but never apply a separator
            if (!v) return; // "— Custom —" itself changes nothing — there's nothing to apply
            if (v.startsWith("u:")) {
              const p = userPresets.find((x) => x.name === v.slice(2));
              if (!p) return;
              applyPreset(state, p);
            } else if (v.startsWith("s:")) {
              const p = PIPELINE_PRESETS.find((x) => String(x.id) === v.slice(2));
              if (!p) return;
              applyPreset(state, p);
            }
            persist();
            renderLeft();
          }),
          btnRow,
          noteText ? el("div", { text: noteText, style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }) : null,
          !userPresetsLoaded ? el("div", { text: "Loading saved presets…", style: { fontSize: "10px", color: C.muted } }) : null,
        ])
      );
    }

    // Pipeline — Acceleration / Upscale / Continuity are separate boxes, not one long
    // panel, so each control group reads as its own thing.
    leftPanel.appendChild(el("div", { text: "Pipeline", style: { color: C.muted, fontSize: "11px", marginTop: "4px", marginBottom: "-2px", textTransform: "uppercase", letterSpacing: "0.04em" } }));

    function gatedSelect(opts: readonly { key: string; label: string }[], blockedFn: (k: string) => string, value: string, onChange: (v: string) => void) {
      return select(
        opts.map((o) => {
          const reason = blockedFn(o.key);
          return { value: o.key, label: reason ? `${o.label} — ${reason}` : o.label, disabled: !!reason };
        }),
        value,
        onChange
      );
    }

    leftPanel.appendChild(
      accordion("turbo", "Turbo", turboSummary(), () => [
        col([select(turboModesFor(state.generationMode).map((m) => ({ value: m.key, label: m.label })), state.turboMode, (v) => {
          state.turboMode = v;
          persist();
          renderLeft();
        })]),
        ...turboSettings(),
      ])
    );

    leftPanel.appendChild(
      accordion("attn", "Attention", attnSummary(), () => [
        col([label("backend"), gatedSelect(ATTN_BACKENDS, (k) => attnBackendBlockedReason(state, k), state.attnBackend, (v) => { state.attnBackend = v; persist(); renderLeft(); })]),
        ...attnBackendSettings(),
        col([label("H3 forward"), gatedSelect(ATTN_FORWARDS, (k) => attnForwardBlockedReason(state, k), state.attnForward, (v) => { state.attnForward = v; persist(); renderLeft(); })]),
        ...attnForwardSettings(),
        (() => {
          const nt = attnForwardOverlapNote(state, state.attnForward);
          return nt ? el("div", { text: `ⓘ ${nt}`, style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }) : null;
        })(),
        ...h3OptimizerSettings(),
      ])
    );

    leftPanel.appendChild(
      accordion("blockCache", "Block Cache", blockCacheSummary(), () => [
        col([select(BLOCK_CACHES.map((b) => {
          const reason = blockCacheBlockedReason(state, b.key);
          return { value: b.key, label: reason ? `${b.label} — ${reason}` : b.label, disabled: !!reason };
        }), state.blockCache, (v) => { state.blockCache = v; persist(); renderLeft(); })]),
        ...blockCacheSettings(),
      ])
    );

    leftPanel.appendChild(
      accordion("spectrum", "Spectrum", state.useSpectrum ? "ON" : "Off", () => [
        checkboxRow("Enabled — independent of Attention/Block Cache (skips whole steps via latent extrapolation, orthogonal axis)", !!state.useSpectrum, (v) => { state.useSpectrum = v; persist(); renderLeft(); }),
        ...(state.useSpectrum ? spectrumSettings() : []),
      ])
    );

    leftPanel.appendChild(
      accordion(
        "modelPatches", "Model Patches",
        [state.useFusedModulation && "Fused Modulation", state.useTorchPatch && "Torch", state.fp16Accum && "fp16"].filter(Boolean).join(" + ") || "Off",
        () => [
          checkboxRow("Fused Modulation (AdaLN scale/shift + gated residual, Triton) — safe with every other axis", !!state.useFusedModulation, (v) => { state.useFusedModulation = v; persist(); renderLeft(); }),
          row([
            col([checkboxRow("Torch settings patch", !!state.useTorchPatch, (v) => { state.useTorchPatch = v; persist(); })]),
            col([checkboxRow("fp16 accumulation", !!state.fp16Accum, (v) => { state.fp16Accum = v; persist(); })]),
          ]),
        ]
      )
    );

    leftPanel.appendChild(
      accordion(
        "upscale",
        "Upscale",
        [
          state.deblurStrength && state.deblurStrength !== "none" ? `Deblur ${state.deblurStrength}` : null,
          UPSCALE_MODES.find((m) => m.key === state.upscaleMode)?.label || "None",
        ]
          .filter(Boolean)
          .join(" + "),
        () => [
          // Deblur is a pre-pass before upscale, not one of its options — each has its own
          // "none", so "Deblur only, no upscale" is a valid, real combination (SPEC_MINIMAX_H3_
          // PER_CLIP_OVERRIDE.md §15). Same resolution either way; this never touches width/height.
          col([
            label("Deblur (before upscale)"),
            select(
              [{ value: "none", label: "None" }, { value: "LOW", label: "Low" }, { value: "MEDIUM", label: "Medium" }, { value: "HIGH", label: "High" }, { value: "ULTRA", label: "Ultra" }],
              state.deblurStrength || "none",
              (v) => { state.deblurStrength = v; persist(); renderLeft(); }
            ),
          ]),
          col([label("Upscale"), select(UPSCALE_MODES.map((m) => ({ value: m.key, label: m.label })), state.upscaleMode, (v) => { state.upscaleMode = v; persist(); renderLeft(); })]),
          ...(state.upscaleMode === "rtx"
            ? [
                row([
                  col([label("RTX scale"), numberField(state.rtxScale ?? 2, (v) => { state.rtxScale = v; persist(); }, 0.5)]),
                  col([label("Quality"), select(["LOW", "MEDIUM", "HIGH", "ULTRA"].map((q) => ({ value: q, label: q })), state.rtxQuality || "ULTRA", (v) => { state.rtxQuality = v; persist(); })]),
                ]),
              ]
            : []),
          // SPEC_MINIMAX_H3_INLINE_POSTPROCESS_META.md §6 — only meaningful once deblur or
          // upscale is doing something: off just saves the final clip, on also keeps the raw
          // decode as a separate `_raw` file (never joins a stitch or the last-frame chain).
          ...((state.deblurStrength && state.deblurStrength !== "none") || (state.upscaleMode && state.upscaleMode !== "none")
            ? [checkboxRow("Also save the clip before deblur / upscale", !!state.saveUnprocessed, (v) => { state.saveUnprocessed = v; persist(); })]
            : []),
        ]
      )
    );

    leftPanel.appendChild(
      accordion("continuity", "Continuity", contModes.find((m) => m.key === state.continuityMode)?.label || "None", () => [
        col([
          select(contModes.map((m) => ({ value: m.key, disabled: m.disabled, label: m.disabled ? `${m.label} — ${m.reason}` : m.label })), state.continuityMode, (v) => { state.continuityMode = v; persist(); renderLeft(); }),
        ]),
        el("div", { text: (contModes.find((m) => m.key === state.continuityMode) || ({} as any)).hint || "", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
        el("div", {
          text: "One prompt renders one clip. To make a longer piece that holds together, split the brief into shots — each shot becomes a clip and continuity carries the look forward.",
          style: { fontSize: "10px", color: C.muted, lineHeight: "1.5", marginTop: "2px" },
        }),
        ...(state.continuityMode === "onetake"
          ? (() => {
              const onetakeAvailable = !!ctx.availability?.TJ_H3_LatentContinuation;
              return [
                ...(onetakeAvailable
                  ? []
                  : [el("div", {
                      html: "⚠ <code>TJ_H3_LatentContinuation</code> not installed — update the TJ_NODE pack, or switch Continuity to something else.",
                      style: { fontSize: "10px", color: C.warn, lineHeight: "1.5", marginTop: "4px" },
                    })]),
                checkboxRow("Lock the whole audio stream (with Latent Continuation)", !!state.oneTakeLockAudio, (v) => {
                  state.oneTakeLockAudio = v; persist();
                }),
                checkboxRow("Auto-stitch into one clip when the run finishes (overlap trimmed)", state.oneTakeAutoStitch !== false, (v) => {
                  state.oneTakeAutoStitch = v; persist(); renderLeft();
                }),
                el("div", {
                  text: state.oneTakeAutoStitch !== false
                    ? "The stitched result (overlap trimmed) is what lands in the Gallery. Per-clip files and checkpoints stay on disk too, for resuming a stopped run."
                    : "Off — clips stay separate, same as any other run; nothing gets auto-combined.",
                  style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" },
                }),
                ...(state.oneTakeAutoStitch !== false
                  ? [
                      checkboxRow(
                        "Replace with Audio Lock source (skip generated audio)",
                        !!state.oneTakeAudioOverride,
                        (v) => { state.oneTakeAudioOverride = v; persist(); },
                        { disabled: !state.audioLock || !state.lockAudioFile }
                      ),
                      el("div", {
                        text: state.audioLock && state.lockAudioFile
                          ? "The stitched result's audio track is swapped for the locked source file itself (trimmed to match), instead of the model's generated audio."
                          : "Needs Audio Lock on with a file selected.",
                        style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" },
                      }),
                    ]
                  : []),
              ];
            })()
          : []),
      ])
    );

    // Audio Lock — H3는 레퍼런스 오디오를 참고만 하고 새로 만들기 때문에, 립싱크나
    // 음악 영상처럼 원본 오디오를 그대로 유지해야 할 때 이 락이 필요하다.
    leftPanel.appendChild(accordion("audioLock", "Audio Lock", state.audioLock ? "ON" : "Off", () => audioLockControls()));

    // Images (mode-specific: First/Last keyframes, Reference images/videos/audios)
    leftPanel.appendChild(
      accordion("images", "Images", generationModesFor(state).find((m) => m.key === state.generationMode)?.label || "", () => {
        const imgPanel = mountImagePanel(state, ctx);
        ctx._rerenderImages = imgPanel.render;
        return [imgPanel.el];
      })
    );

    // LoRA
    leftPanel.appendChild(
      accordion("lora", "LoRA", `${(state.loras || []).filter((l) => l.enabled !== false && l.name && l.name !== "none").length} active`, () => [mountLoraPanel()])
    );

    // Sampling — sampler/scheduler/denoise + sigma shift, moved from Settings so they sit next
    // to Steps/Turbo as per-run controls instead of fixed config.
    leftPanel.appendChild(
      accordion("sampling", "Sampling", `${state.sampler || "er_sde"} · ${state.scheduler || "simple"}`, () => [
        row([
          col([label("Sampler"), select(SAMPLERS.map((s) => ({ value: s, label: s })), state.sampler || "er_sde", (v) => { state.sampler = v; persist(); })]),
          col([label("Scheduler"), select(SCHEDULERS.map((s) => ({ value: s, label: s })), state.scheduler || "simple", (v) => { state.scheduler = v; persist(); })]),
        ]),
        col([label("Denoise"), n(state.denoise ?? 1.0, (v) => (state.denoise = v), 0.01)]),
        row([
          col([label("shift_video"), n(state.shiftVideo ?? 12, (v) => (state.shiftVideo = v), 0.5)]),
          col([label("shift_audio"), n(state.shiftAudio ?? 3, (v) => (state.shiftAudio = v), 0.5)]),
        ]),
        el("div", { text: "Sigma shift feeds MiniMaxH3SigmaShift.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
      ])
    );

    // Steps — exactly one field is ever editable: whichever count the run will actually use.
    // Turbo's own step count lives in the Turbo accordion next to its LoRA/strength instead.
    leftPanel.appendChild(
      (() => {
        const eff = turboEffective(state, ctx.availability);
        const turboActive = eff === "larryvrh" || eff === "lightx2v";
        const stepsInput = numberField(state.steps ?? 20, (v) => { state.steps = Math.max(1, Math.round(v)); persist(); }, 1);
        if (turboActive) {
          (stepsInput as HTMLInputElement).disabled = true;
          stepsInput.style.opacity = "0.4";
        }
        return panel([
          label("Steps"),
          stepsInput,
          el("div", {
            text: turboActive
              ? `Turbo is on — ${effectiveSteps(state, ctx.availability)} steps from the Turbo section are used instead.`
              : "Used as-is.",
            style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" },
          }),
        ]);
      })()
    );

    leftOuter.appendChild(seedGenWrap);
  }

  // ══ LoRA panel ══════════════════════════════════════════════════════════
  let availableLoras: string[] = [];

  function mountLoraPanel() {
    const wrap = el("div");
    function render() {
      clear(wrap);
      const loras = state.loras || [];
      const countEl = label("");
      const refreshCount = () => {
        const on = loras.filter((l) => l.enabled !== false && l.name && l.name !== "none").length;
        countEl.textContent = `LoRA (${on}/${loras.length} on)`;
      };
      refreshCount();

      const reload = el("button", {
        type: "button", text: "⟳", title: "Rescan the LoRA folder",
        style: { flexShrink: "0", cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "1px 7px", borderRadius: "5px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` },
      });
      reload.addEventListener("click", async () => {
        reload.disabled = true;
        reload.textContent = "…";
        try {
          const before = availableLoras.length;
          const d = await getModels();
          availableLoras = d.loras || [];
          const after = availableLoras.length;
          showPopup(after === before ? `LoRA list refreshed — ${after} found.` : `LoRA list refreshed — ${after} found (${after - before > 0 ? "+" : ""}${after - before}).`, false);
        } catch {
          showPopup("Could not refresh the model list — check that ComfyUI is running.", true);
        }
        reload.disabled = false;
        reload.textContent = "⟳";
        render();
      });

      const head0 = el("div", { class: "flex items-center gap-1.5" });
      head0.append(countEl, el("div", { class: "flex-1" }), reload);
      const kids: (Node | null)[] = [head0];
      const all = ["none", ...availableLoras.filter((x) => x !== "none")];

      loras.forEach((l, i) => {
        const off = l.enabled === false;
        const card = el("div", {
          class: "flex flex-col gap-1.5 p-1.5 rounded-md",
          style: { border: `1px solid ${off ? C.dim : C.border}`, opacity: off ? "0.55" : "1" },
        });

        const head = el("div", { class: "flex items-center gap-1.5" });
        const tog = el("button", {
          type: "button", text: off ? "OFF" : "ON",
          style: { flexShrink: "0", cursor: "pointer", fontFamily: "inherit", fontSize: "10px", padding: "3px 9px", borderRadius: "10px", border: "none", fontWeight: "700", background: off ? "#444" : BRAND, color: "#fff" },
        });
        tog.title = off ? "Switched off — neither the weights nor its trigger words are used" : "Switched on";
        tog.addEventListener("click", () => { l.enabled = off; persist(); render(); });

        const del = el("button", {
          type: "button", text: "✕", title: "Remove",
          style: { flexShrink: "0", cursor: "pointer", fontFamily: "inherit", fontSize: "11px", background: "transparent", color: C.err, border: "none", padding: "2px 4px" },
        });
        del.addEventListener("click", () => { state.loras.splice(i, 1); persist(); render(); });

        const strWrap = el("div", { class: "shrink-0", style: { width: "62px" } });
        strWrap.appendChild(numberField(l.strength ?? 1.0, (v) => { l.strength = v; persist(); }, 0.05));

        head.append(tog, el("div", { class: "flex-1" }), strWrap, del);

        const tw = el("input", {
          type: "text", placeholder: "Trigger word…",
          style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "4px 6px", fontSize: "11px", fontFamily: "inherit", outline: "none" },
        }) as HTMLInputElement;
        tw.value = l.triggerWord || "";
        tw.title = "Added to every clip's prompt while this LoRA is on";
        tw.addEventListener("input", () => { l.triggerWord = tw.value; persist(); });

        const picker = searchableSelect(all, l.name || "none", async (v) => {
          const prev = l.name;
          l.name = v;
          persist();
          if (v && v !== "none") {
            if (v !== prev) { l.triggerWord = ""; tw.value = ""; }
            if (!l.triggerWord) {
              tw.placeholder = "Loading…";
              try {
                const d = await getLoraTriggers(v);
                if (d.ok && d.triggers?.length) {
                  l.triggerWord = d.triggers.join(", ");
                  tw.value = l.triggerWord;
                  persist();
                }
              } catch {}
              tw.placeholder = "Trigger word…";
            }
          } else {
            l.triggerWord = "";
            tw.value = "";
            persist();
          }
          refreshCount();
        });

        card.append(head, picker.el, tw);
        kids.push(card);
      });

      const add = el("button", {
        type: "button", text: "+ Add LoRA",
        style: { width: "100%", cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "6px", borderRadius: "6px", background: C.bg2, color: C.text, border: `1px solid ${C.border}` },
      });
      add.addEventListener("click", () => {
        if (!state.loras) state.loras = [];
        if (state.loras.length >= 4) { showPopup("4 LoRAs max.", true); return; }
        state.loras.push({ name: "none", strength: 1.0, triggerWord: "", enabled: true });
        persist();
        render();
      });
      kids.push(add);
      wrap.appendChild(panel(kids));
    }
    if (!availableLoras.length) {
      getModels()
        .then((d) => { availableLoras = d.loras || []; render(); })
        .catch(() => {});
    }
    render();
    return wrap;
  }

  // ── 시드 + 생성 버튼 ──────────────────────────────────────────────
  const seedInput = numberField(state.seed, (v) => { state.seed = v; persist(); }, 1);
  const seedModeDD = select(
    [
      { value: "randomize", label: "Random" },
      { value: "fixed", label: "Fixed" },
      { value: "increment", label: "+1" },
      { value: "decrement", label: "-1" },
    ],
    state.seedMode,
    (v) => { state.seedMode = v; persist(); }
  );
  const seedGenWrap = el("div", { class: "flex flex-col gap-1.5 pt-2 shrink-0 border-t border-border" });
  seedGenWrap.appendChild(panel([row([col([label("SEED"), seedInput]), col([label("MODE"), seedModeDD])])]));

  const genBtn = button("▶ Generate", null, "primary");
  genBtn.className = "flex-1 py-2.5 text-sm whitespace-nowrap";
  const stopBtn = button("■ Stop", null);
  stopBtn.className += " shrink-0";
  stopBtn.title = "Interrupt whatever ComfyUI is currently running — works even if this page didn't start it (e.g. a queue sent before a disconnect, or from another session).";
  // 예전엔 이 세션이 직접 큐를 넣었을 때만(running===true) 활성화됐는데, 그러면 "실수로 큐를
  // 보냈는데 연결이 끊겨서 이 세션은 running=false인 채 새로고침됐다" 같은 경우 Stop을 아예
  // 누를 수가 없었다. /interrupt는 어차피 ComfyUI 전역 인터럽트라 누가 큐를 넣었는지와 무관하게
  // 항상 보낼 수 있어야 한다 — 그래서 상시 활성화로 바꾼다.
  // Only offered for a single-prompt run: with one prompt, the whole clip's graph is
  // already built and queued by the time this could be clicked, so editing the panel
  // afterward (to prepare the next run) can never leak into the one in flight. A
  // multi-clip run reads state.prompts live per clip on purpose, and that's exactly
  // what this queue would corrupt if it were allowed there too.
  //
  // Like ComfyUI's own queue: every click snapshots the whole panel as-is and appends
  // it as one more entry. When the current run finishes cleanly, entry #1 takes over
  // the panel and restarts; when THAT one finishes, #2 takes over, and so on — a plain
  // FIFO, not a single toggle.
  const nextGenBtn = button("⏭ Next Gen", null);
  nextGenBtn.style.flexShrink = "0";
  nextGenBtn.style.display = "none";
  nextGenBtn.title = "Snapshot this exact panel and append it to the queue — takes over once everything ahead of it finishes.";
  const queueListBtn = el("button", {
    type: "button", text: "📋", title: "View queued runs",
    style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "0 8px", borderRadius: "6px", background: C.bg3, color: C.text, border: `1px solid ${C.border}`, display: "none", flexShrink: "0", position: "relative" },
  });
  const queueCountDot = el("div", {
    style: { position: "absolute", top: "-5px", right: "-5px", minWidth: "14px", height: "14px", borderRadius: "7px", background: BRAND, color: "#fff", fontSize: "9px", fontWeight: "700", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 2px" },
  });
  queueListBtn.appendChild(queueCountDot);
  let nextQueue: MinimaxState[] = [];
  function summarizeQueued(snap: MinimaxState) {
    const active = (snap.prompts || []).filter((p) => p && p.enabled !== false && (p.text || "").trim());
    const first = active[0]?.text || "(no prompt text)";
    return `${active.length} clip${active.length === 1 ? "" : "s"} · ${String(first).slice(0, 40)}${first.length > 40 ? "…" : ""}`;
  }
  function renderNextQueue() {
    nextGenBtn.textContent = nextQueue.length ? `⏭ Next Gen (${nextQueue.length})` : "⏭ Next Gen";
    nextGenBtn.style.background = nextQueue.length ? BRAND : "";
    queueListBtn.style.display = nextQueue.length ? "flex" : "none";
    queueCountDot.textContent = String(nextQueue.length);
    if (queueListOv.style.display !== "none") renderQueueListPopup();
  }
  nextGenBtn.addEventListener("click", () => {
    nextQueue.push(JSON.parse(JSON.stringify(state)));
    renderNextQueue();
  });
  queueListBtn.addEventListener("click", () => {
    renderQueueListPopup();
    queueListOv.style.display = "flex";
  });
  seedGenWrap.appendChild(row([genBtn, stopBtn, nextGenBtn, queueListBtn]));

  // ── Next Gen queue popup ──────────────────────────────────────────
  const queueListOv = el("div", {
    class: "fixed inset-0 z-[9998] flex-col p-3.5 gap-2.5 box-border",
    style: { display: "none", background: "rgba(11,11,11,0.97)" },
  });
  const queueListTop = el("div", { class: "flex items-center gap-2 shrink-0" });
  queueListTop.append(
    el("div", { text: "Next Gen queue", class: "text-white text-sm font-bold flex-1" }),
    button("✕", () => { queueListOv.style.display = "none"; }, "danger")
  );
  const queueListBody = el("div", { class: "flex-1 overflow-y-auto flex flex-col gap-1.5" });
  queueListOv.append(queueListTop, queueListBody);
  function renderQueueListPopup() {
    clear(queueListBody);
    if (!nextQueue.length) {
      queueListBody.appendChild(el("div", { text: "Nothing queued.", style: { color: C.muted, fontSize: "11px" } }));
      return;
    }
    nextQueue.forEach((snap, idx) => {
      const rowEl = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "8px 10px" } });
      rowEl.appendChild(el("div", { text: `#${idx + 1}`, style: { color: BRAND, fontSize: "12px", fontWeight: "700", flexShrink: "0" } }));
      rowEl.appendChild(el("div", { text: summarizeQueued(snap), style: { flex: "1", fontSize: "11px", color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }));
      const cancelBtn = el("button", { type: "button", text: "✕ Cancel", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "10px", padding: "4px 8px", borderRadius: "5px", background: "#c0392b", color: "#fff", border: "none", flexShrink: "0" } });
      cancelBtn.addEventListener("click", () => {
        nextQueue.splice(idx, 1);
        renderNextQueue();
        renderQueueListPopup();
      });
      rowEl.appendChild(cancelBtn);
      queueListBody.appendChild(rowEl);
    });
  }

  // ══ 생성 릴레이 루프 ═══════════════════════════════════════════════
  // 원본: one_node_minimax_h3.js의 genBtn.onclick — 클립 하나당 그래프 하나를 큐잉하고,
  // 완료를 기다린 뒤 다음 클립으로 넘어간다(모델을 계속 들고 있지 않도록 클립 사이 VRAM 해제).
  let running = false;
  let stopRequested = false;

  // 브라우저가 백그라운드 탭을 스스로 디스카드했다가 다시 그리면(사용자가 새로고침을
  // 누른 게 아님) 이 클로저 전체가 사라지고 릴레이 루프도 완전히 끊긴다 — 서버(ComfyUI)는
  // 이미 큐에 들어간 클립을 계속 처리하지만, 그다음 클립을 다시 큐에 넣어줄 코드가 없어져서
  // 거기서 멈춘다. 매 클립 경계마다 진행 상황을 localStorage에 남겨두고, 페이지가 다시
  // 그려질 때 그걸 보고 이어서(새 큐를 보내지 않고 이미 떠 있는 작업에 재부착해서) 계속
  // 진행하게 한다.
  const RUN_PROGRESS_KEY = "aos_mmh3_run_progress";
  interface RunProgress {
    pos: number;
    totClip: number;
    clipRecords: any[];
    prevCheckpointName: string | null;
    chainFrame: string | null;
    promptId: string | null;
    savedAt: number;
    // 런 시작 시점 패널 전체 스냅샷 — 새로고침 후 이어갈 때도 그사이 라이브 state가
    // 바뀌었을 수 있으므로(사용자가 다음 런을 준비하며 설정을 만졌을 수 있음) 라이브
    // state가 아니라 이 스냅샷을 그대로 읽어야 지금 돌던 런이 안전하게 이어진다.
    runState: MinimaxState;
  }
  function saveRunProgress(p: RunProgress | null) {
    try {
      if (p) localStorage.setItem(RUN_PROGRESS_KEY, JSON.stringify(p));
      else localStorage.removeItem(RUN_PROGRESS_KEY);
    } catch {}
  }
  function loadRunProgress(): RunProgress | null {
    try {
      const raw = localStorage.getItem(RUN_PROGRESS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as RunProgress;
      // 24시간 넘은 기록은 그냥 죽은 것으로 본다 — ComfyUI가 그사이 재시작됐을 확률이 높다.
      if (!p || Date.now() - (p.savedAt || 0) > 24 * 3600 * 1000) return null;
      return p;
    } catch {
      return null;
    }
  }

  function promptForClip(rs: MinimaxState, clipIdx: number) {
    return composeClipPrompt(rs, clipIdx);
  }
  function seedForClip(rs: MinimaxState, i: number) {
    if (!rs.seedPerClip) return rs.seed ?? 0;
    return ((rs.seed ?? 0) + i) % Number.MAX_SAFE_INTEGER;
  }
  function metaForVideo(rs: MinimaxState, promptTextVal: string, extra: Record<string, any> = {}) {
    const { width, height } = resolveResolution(rs.aspect, rs.megapixels);
    return {
      v: 1, prompt: String(promptTextVal || ""), promptHeader: rs.promptHeader || "", promptFooter: rs.promptFooter || "",
      w: width, h: height, mode: rs.generationMode || "t2v", aspect: rs.aspect, megapixels: rs.megapixels,
      frames: rs.clipFrames, steps: rs.steps, sampler: rs.sampler,
      // accel stays for pre-split readers only (this session's own Reuse now reads the axis
      // fields below directly) — a peer session on the node port confirmed accelMode is
      // otherwise vestigial post-split and nothing keeps it in sync, so a bare accelMode value
      // here would go stale immediately.
      accel: rs.attnBackend || "none",
      turboMode: rs.turboMode, attnBackend: rs.attnBackend, attnForward: rs.attnForward,
      blockCache: rs.blockCache, useSpectrum: !!rs.useSpectrum, useFusedModulation: !!rs.useFusedModulation,
      h3Optimizer: rs.h3Optimizer || "none",
      h3SparseBudget: rs.h3Optimizer === "memory_sparse" ? (rs.h3SparseBudget ?? 0.15) : null,
      // SPEC_MINIMAX_H3_PDD_AND_TELEMETRY.md #3 — useTorchPatch was silently missing before:
      // two clips differing only in it were indistinguishable after the fact. preset is always
      // null on this port — the web tool has no preset list to match against (see spec #4).
      useTorchPatch: !!rs.useTorchPatch, fp16Accum: rs.fp16Accum !== false, preset: null,
      // SPEC_MINIMAX_H3_CONTINUE_AND_EXTEND.md §4 / node v1.21.2 — the turbo section's own step
      // counts and model files were never written, so Reuse of a PDD clip restored
      // turboMode="pdd" with no file and effectiveTurbo fell back to normal steps. (The restore
      // branch in applyClipSettings for the turboLora fields was dead for the same reason.)
      pddFile: rs.pddFile, pddFileReference: rs.pddFileReference, pddNfe: rs.pddNfe,
      turboLora: rs.turboLora, turboLoraReference: rs.turboLoraReference,
      turboLoraStrength: rs.turboLoraStrength, turboLoraLowVram: rs.turboLoraLowVram,
      turboSteps: rs.turboSteps, slaTurboSteps: rs.slaTurboSteps,
      scheduler: rs.scheduler, denoise: rs.denoise, shiftVideo: rs.shiftVideo, shiftAudio: rs.shiftAudio,
      // SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §4 — refImages/refImagesMp/firstFrameImage/
      // lastFrameImage/refVideos/refAudios were never saved before, so Reuse on a Reference-mode
      // clip restored nothing. Defaults here are the common set; per-clip callers override with
      // the clip's own resolved assets via `extra`.
      refImages: rs.refImages || [], refImagesMp: rs.refImagesMp || [],
      firstFrameImage: rs.firstFrameImage || null, lastFrameImage: rs.lastFrameImage || null,
      refVideos: rs.refVideos || [], refAudios: rs.refAudios || [],
      seed: rs.seed,
      node: "minimax_h3", created: Date.now(), ...extra,
    };
  }
  // metaForVideo()'s w/h come from resolveResolution() — the pre-decode size. An inline
  // deblur/upscale (or a stitch re-encode) makes the real file differ, so probe what actually
  // landed and correct w/h/fps in place. On a size change the pre-op size is kept as
  // sourceW/H — the same shape the gallery post-process (patchPostMeta) writes, so the info
  // tooltip and Reuse read one field set either way. `keepFrames` is for the One-Take path,
  // whose durationSeconds is already the overlap-trimmed total.
  async function reconcileGeometry(meta: any, file: { filename: string; subfolder?: string; type?: string }, opts: { keepFrames?: boolean; noSource?: boolean } = {}) {
    try {
      const oi = await getVideoInfo(file.filename, file.subfolder || "", file.type || "output");
      if (!oi || (!oi.width && !oi.height && !oi.frames)) return meta;
      // noSource: the file IS the original (the `_raw` un-processed clip) — record its real
      // dimensions, never treat a difference from meta.w as a pre-op size.
      if (!opts.noSource && ((oi.width && oi.width !== meta.w) || (oi.height && oi.height !== meta.h))) {
        meta.sourceW = meta.w;
        meta.sourceH = meta.h;
      }
      if (oi.width) meta.w = oi.width;
      if (oi.height) meta.h = oi.height;
      if (oi.fps) meta.fps = oi.fps;
      if (!opts.keepFrames && oi.frames) {
        meta.frames = oi.frames;
        meta.durationSeconds = oi.frames / (oi.fps || FPS);
      }
    } catch { /* keep the computed geometry rather than fail the run */ }
    return meta;
  }
  function firstOutput(byNode: Record<string, any>, nodeKey: string) {
    const out = byNode?.[nodeKey];
    const arr = out?.images || out?.gifs || [];
    return arr.length ? arr[0] : null;
  }
  function allOutputs(byNode: Record<string, any>, nodeKey: string) {
    const out = byNode?.[nodeKey];
    return out?.images || out?.gifs || [];
  }

  // ── LTX 2.5 Upscale run — segmented, survives a page reload ─────────────
  // Each segment is queued as its own /prompt; state._ltxRelay persists the plan + finished
  // parts + the in-flight prompt_id after every step. queuePrompt()'s own existingPromptId
  // reattach (it checks /history first) does the "reconnect after a reload" work — no
  // separate polling helper needed the way the node's port required. Mirrors
  // runLtxUpscale (node 006f9a5 segmenting, 9763749 reload-survival, 830f426 8n+1 align).
  async function runLtxUpscale(resume = false) {
    if (running) return;

    let rs: MinimaxState, passes: { window: { skip: number; cap: number } | null; suffix: string }[], parts: any[], segSec: number, sourceFile: string, folder: string;
    if (resume) {
      const R = state._ltxRelay;
      if (!R || !Array.isArray(R.passes) || !Array.isArray(R.parts) || !R.rs) { delete state._ltxRelay; persist(); return; }
      rs = R.rs; passes = R.passes; parts = R.parts.slice(); segSec = R.segSec || 0;
    } else {
      if (state.seedMode === "randomize") { state.seed = randomSeed(); seedInput.value = String(state.seed); }
      else if (state.seedMode === "increment") { state.seed = (state.seed || 0) + 1; seedInput.value = String(state.seed); }
      else if (state.seedMode === "decrement") { state.seed = Math.max(0, (state.seed || 0) - 1); seedInput.value = String(state.seed); }
      persist();
      rs = JSON.parse(JSON.stringify(state));
      if (!ltxUpscaleReady(rs)) { showPopup("Set the LTX 2.5 models in ⚙ Settings first — missing: " + ltxUpscaleMissing(rs).join(", "), true); return; }
      if (!rs.ltxSource) { showPopup("Pick a source clip (gallery) or upload a video.", true); return; }
      rs.seedMode = "fixed"; // every segment shares one seed so the low-denoise refine stays coherent across joins
      sourceFile = rs.ltxSource;
      folder = (rs.saveSubfolder || SUBFOLDER).replace(/\\/g, "/");
      segSec = 0; passes = []; parts = [];
    }
    sourceFile = rs.ltxSource;
    folder = (rs.saveSubfolder || SUBFOLDER).replace(/\\/g, "/");

    running = true; stopRequested = false;
    genBtn.disabled = true; genBtn.textContent = "⏳ LTX Upscale…";
    nextGenBtn.style.display = "none";
    setLeftLocked(true);
    renderPrompts();
    if (!resume) resetPreview();
    // A blank/disconnected preview during an active run reads as "stuck", not "working" — the
    // idle placeholder ("▶ Generate to render…") is misleading here, so swap its text while
    // this run owns the screen. Restored in the finally below regardless of how it ends.
    placeholder.innerHTML = "🔄 LTX Upscale in progress…<br><span style='font-size:10px'>reconnecting to the live preview — this is not stuck</span>";
    if (!resume) barInner.style.width = "0%";
    startClock();
    keepTabAlive(true);
    try {
      if (!ctx.availability || !Object.keys(ctx.availability).length) {
        const av = await getNodeAvailability();
        ctx.availability = av.available || {}; ctx.availabilityInfo = av;
      }

      // ── plan the passes (fresh run only) ────────────────────────────────
      if (!resume) {
        const segMode = rs.ltxSegmentMode === "count" ? "count" : "seconds";
        const s = Math.max(0, Number(rs.ltxSegmentSeconds) || 0);
        const segCount = Math.max(1, Math.round(Number(rs.ltxSegmentCount) || 1));
        segSec = s;
        passes = [{ window: null, suffix: "" }];
        if ((segMode === "count" && segCount > 1) || (segMode === "seconds" && s > 0)) {
          let srcInfo: any = null;
          try { srcInfo = await getVideoInfo(sourceFile, "", "input"); } catch {}
          const sFps = srcInfo?.fps || state.ltxSourceMeta?.fps || FPS;
          const total = srcInfo?.frames || Math.round((state.ltxSourceMeta?.duration || 0) * sFps) || 0;
          // LTX 2.5's video VAE only takes 8n+1 pixel frames cleanly — not the same 17k+5
          // rule H3's own transformer uses (unrelated model, this pass never touches it).
          const snap8n1 = (n: number) => 8 * Math.max(0, Math.round((n - 1) / 8)) + 1;
          let nPieces: number;
          if (segMode === "count") nPieces = Math.min(segCount, Math.max(1, Math.floor(total / 9)));
          else { const targetSeg = Math.max(9, snap8n1(s * sFps)); nPieces = Math.max(1, Math.round(total / targetSeg)); }
          if (nPieces > 1 && total > 9) {
            const pieceLen = Math.max(9, snap8n1(Math.round(total / nPieces)));
            passes = [];
            let skip = 0;
            for (let k = 0; k < nPieces; k++) {
              const isLast = k === nPieces - 1;
              const cap = isLast ? total - skip : pieceLen;
              if (cap <= 0) break;
              passes.push({ window: { skip, cap }, suffix: `_seg${String(k).padStart(2, "0")}` });
              skip += cap;
            }
          }
        }
        parts = [];
        state._ltxRelay = { rs, passes, parts, segSec, curPromptId: null }; persist();
      }

      let meta: any = null;
      let inFlightId: string | null = resume ? (state._ltxRelay?.curPromptId || null) : null;
      for (let i = parts.length; i < passes.length; i++) {
        if (stopRequested) throw new Error("Stopped.");
        const p = passes[i];
        setStatus(passes.length > 1
          ? `LTX Upscale · segment ${i + 1}/${passes.length}${p.window ? ` (frames ${p.window.skip}–${p.window.skip + p.window.cap})` : ""}`
          : "LTX Upscale · queued (≈6 min sampling on 16GB)");
        const built = buildLtxUpscaleGraph(rs, ctx.availability, { nodeId: instanceId, sourceFile, window: p.window, saveSuffix: p.suffix });
        meta = built.meta;

        const reattachId = inFlightId || undefined;
        inFlightId = null;
        // Without this the external-queue banner never clears (it hides once samplingActive
        // flips true) and the live-preview WS handler drops every frame (it early-returns
        // while !samplingActive) — both looked like the run was stuck even though ComfyUI
        // was actually rendering. Same flag H3's own runGenerate sets before its queuePrompt.
        samplingActive = true;
        applyPreviewOffState();
        let r;
        try {
        r = await queuePrompt(built.graph, {
          // LTX segments don't fit H3's curClip/totClip-driven setStepProgress() — drive the
          // bar directly off this segment's own step/max, offset by how many segments are
          // already done.
          onProgress: (v, m) => {
            // This numeric callback is the OTHER clear path for the "reconnecting to the live
            // preview" placeholder text set above — previously only a live preview frame
            // (showPreviewFrame) ever cleared it, so a run with previewEnabled off (or one
            // whose first image frame is slow) could sit on that text long after sampling had
            // actually started. Clear it here too, same as setStepProgress does for the main
            // H3 path and Face Refine's own detect banner.
            placeholder.style.display = "none";
            const segFrac = m ? v / m : 0;
            const overall = (i + segFrac) / passes.length;
            barInner.style.width = `${Math.max(0, Math.min(100, overall * 100)).toFixed(1)}%`;
            const label = passes.length > 1 ? `seg ${i + 1}/${passes.length} · step ${v}/${m}` : `step ${v}/${m}`;
            badge.classList.remove("hidden");
            badge.textContent = `● LIVE  ${label}`;
            setStatus(`LTX Upscale · ${label}`);
          },
          samplerNode: "LX:sampler",
          existingPromptId: reattachId,
          onQueued: (pid) => { if (state._ltxRelay) { state._ltxRelay.curPromptId = pid; persist(); } },
        });
        } finally {
          samplingActive = false;
        }
        const out = firstOutput(r.byNode, "LX:save");
        if (!out) throw new Error(`LTX Upscale segment ${i + 1} produced no output.`);
        parts.push(out);
        if (state._ltxRelay) { state._ltxRelay.parts = parts; state._ltxRelay.curPromptId = null; persist(); }
        try { await freeMemory(); } catch {}
      }

      // ── assemble ─────────────────────────────────────────────────────────
      let vid: any;
      if (parts.length === 1) {
        vid = parts[0];
      } else {
        setStatus(`Assembling ${parts.length} segments with ffmpeg…`);
        const st = await stitchClips(parts.map((p) => ({ filename: p.filename, subfolder: p.subfolder || "" })), `${folder}/${rs.filenamePrefix || "MMH3"}_LTXUP_full`, null, null, null);
        vid = { filename: st.filename, subfolder: st.subfolder || "", type: "output" };
        for (const p of parts) { try { await deleteVideo(p.filename, p.subfolder || ""); } catch {} }
      }
      if (!vid) throw new Error("LTX Upscale finished but produced no video output.");
      delete state._ltxRelay; persist();
      meta = meta || {};
      const clipMeta = {
        v: 1, prompt: String(rs.ltxPrompt || ""), mode: "ltxupscale",
        source: rs.ltxSource, sourceKind: rs.ltxSourceKind,
        ltx: { unet: rs.ltxUnet, clip: rs.ltxClip, latentUpscaler: rs.ltxLatentUpscaler, vaeVideo: rs.ltxVaeVideo, vaeAudio: rs.ltxVaeAudio },
        steps: meta.steps, denoise: meta.denoise, sampler: meta.sampler, scheduler: meta.scheduler, seed: meta.seed, fps: meta.fps,
        deblur: meta.deblur || null, upscale: meta.upscale || null, loras: meta.loras || [],
        negativePrompt: String(rs.ltxNegPrompt || ""), segments: passes.length,
        ...(passes.length > 1 ? { stitched: true, segmentSeconds: segSec } : {}),
      };
      saveMeta(vid.filename, vid.subfolder || "", clipMeta);
      showResultVideo(outputViewUrl(vid.filename, vid.subfolder || "", vid.type || "output"));
      badge.classList.remove("hidden");
      badge.textContent = "LTX UPSCALED";
      setStatus(`Done — ${vid.filename}`);
      barInner.style.width = "100%";
      try { refreshGallery(); } catch {}
    } catch (e: any) {
      if (e.message === "Stopped." || e.message === "cancelled") {
        setStatus("Stopped.");
      } else {
        delete state._ltxRelay; persist();
        const why = explainGenerationError(e.message);
        setStatus(why ? `Error: ${why}` : `Error: ${e.message}`);
        showPopup(why || e.message, true);
      }
    } finally {
      try { await freeMemory(); } catch {}
      running = false; stopRequested = false;
      genBtn.disabled = false; genBtn.textContent = "▶ Generate";
      placeholder.innerHTML = "▶ Generate to render the first clip<br><span style='font-size:10px'>live sampling frames appear here</span>";
      setLeftLocked(false);
      renderPrompts();
      stopClock();
      keepTabAlive(false);
    }
  }

  genBtn.addEventListener("click", () => {
    if (state.generationMode === "ltxupscale") { runLtxUpscale(); return; }
    if (state.generationMode === "facerefine") { runFaceRefine(); return; }
    runGenerate();
  });

  async function runGenerate(resume?: RunProgress) {
    if (running) return;
    running = true;
    stopRequested = false;
    genBtn.disabled = true;
    genBtn.textContent = resume ? "⏳ Reconnecting to previous run…" : "⏳ Preparing…";
    nextGenBtn.style.display = "none";
    if (!resume) resetPreview();
    barInner.style.width = "0%";
    startClock();
    keepTabAlive(true);

    try {
      if (!ctx.availability || !Object.keys(ctx.availability).length) {
        const av = await getNodeAvailability();
        ctx.availability = av.available || {};
        ctx.availabilityInfo = av;
      }
      if (ctx.availabilityInfo && ctx.availabilityInfo.core_ok === false) {
        throw new Error(`Missing core nodes: ${(ctx.availabilityInfo.missing_core || []).join(", ")}`);
      }

      if (!resume) {
        if (state.seedMode === "randomize") { state.seed = randomSeed(); seedInput.value = String(state.seed); }
        else if (state.seedMode === "increment") { state.seed = (state.seed || 0) + 1; seedInput.value = String(state.seed); }
        else if (state.seedMode === "decrement") { state.seed = Math.max(0, (state.seed || 0) - 1); seedInput.value = String(state.seed); }
        persist();
      }

      // 런 시작 시점 패널 전체를 얼려서 이 런의 모든 클립이 이 스냅샷만 읽게 한다(컴피
      // 자체 큐와 동일한 방식) — 실행 도중 라이브 state를 고쳐도(예: Next Gen으로 다음
      // 런을 미리 준비) 지금 도는 런에는 전혀 영향 없다. 새로고침 재개 시엔 그때 저장해둔
      // 스냅샷을 그대로 다시 읽어서, 그사이 라이브 state가 바뀌었어도 안전하게 이어진다.
      // resume.runState may be missing on progress saved before this snapshot field existed —
      // fall back to the live panel rather than crash the reconnect.
      const rs: MinimaxState = resume?.runState ? resume.runState : JSON.parse(JSON.stringify(state));
      const plan = clipPlan(rs);
      const active = activePrompts(rs);
      if (!active.length) throw new Error("No prompts are switched on.");
      totClip = active.length;
      // 예전엔 "활성 프롬프트 1개일 때만" 노출했는데, 런 시작 시 패널 전체를 스냅샷
      // 고정(위 rs)하는 지금은 그 제약이 필요 없다 — 몇 클립짜리 런이든 실행 중이면
      // 항상 노출해서 다음 런을 계속 대기열에 쌓을 수 있게 한다.
      nextGenBtn.style.display = "";
      const clipRecords: any[] = resume ? [...resume.clipRecords] : [];
      let chainFrame: string | null = resume ? resume.chainFrame : (rs.generationMode === "reference" ? null : rs.firstFrameImage || null);
      let prevCheckpointName: string | null = resume ? resume.prevCheckpointName : null;
      const clipTimes: number[] = [];
      let resumePromptId: string | null = resume?.promptId || null;

      if (!resume) saveRunProgress({ pos: 0, totClip, clipRecords: [], prevCheckpointName: null, chainFrame, promptId: null, savedAt: Date.now(), runState: rs });

      for (let pos = resume ? resume.pos : 0; pos < active.length; pos++) {
        if (stopRequested) { setStatus(`Stopped after ${pos} clip(s).`); break; }
        const i = active[pos].i;
        curClip = pos + 1;
        const clipStart = Date.now();
        setStatus(`Clip ${curClip}/${totClip} (prompt ${i + 1}) · building graph…`);
        badge.classList.remove("hidden");
        badge.textContent = `● CLIP ${curClip}/${totClip}`;

        // clipAssets() resolves this clip's actual render input — its own refImages/refVideos/
        // refAudios/lastFrame when overridden (SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §1), else
        // the common set. The per-clip first-frame override (prompts[i].firstFrame) is a
        // separate, always-on mechanism, ungated by the §1 override checkbox.
        const assets = clipAssets(rs, i);
        const isRef = rs.generationMode === "reference";
        let firstFrame: string | null = isRef ? null : rs.firstFrameImage || null;
        let refImages: string[] = assets.refImages;
        const continued = pos > 0 && rs.continuityMode === "lastframe" && !!chainFrame;
        if (pos > 0) firstFrame = continued ? chainFrame : null;
        if (continued) refImages = [];

        const override = promptFirstFrame(rs.prompts[i]);
        let overridden = false;
        if (override) { firstFrame = override; refImages = []; overridden = true; }

        const modeForClip = continued || overridden ? "firstlast" : rs.generationMode;
        // Per-clip refImagesMp/refVideos/refAudios ride along on this shallow-copied clipState —
        // buildConditioning() already reads all three straight off `state`, so no graphBuilder.ts
        // change is needed to make the per-clip set actually render.
        const clipState: MinimaxState = { ...rs, generationMode: modeForClip, refImagesMp: assets.refImagesMp, refVideos: assets.refVideos, refAudios: assets.refAudios };

        const isOneTake = rs.continuityMode === "onetake";
        const checkpointName = isOneTake ? `${instanceId}_${i}` : null;

        const built = buildClipGraph(clipState, ctx.availability, {
          nodeId: instanceId,
          promptText: promptForClip(rs, i),
          seed: seedForClip(rs, i),
          firstFrame,
          lastFrame: pos === active.length - 1 ? (assets.lastFrame || rs.lastFrameImage || null) : null,
          refImages,
          clipIndex: i,
          saveLastFrame: true,
          saveTailPreviews: rs.continuityMode === "lastframe",
          prevCheckpointName: isOneTake ? prevCheckpointName : null,
          checkpointName,
        });

        setStatus(`Clip ${curClip}/${totClip} · queued`);
        samplingActive = true;
        applyPreviewOffState();
        const reattachId = pos === (resume?.pos ?? -1) ? resumePromptId || undefined : undefined;
        let res;
        try {
          res = await queuePrompt(built.graph, {
            onProgress: (v, m) => setStepProgress(v, m),
            samplerNode: NODE_IDS.sampler,
            existingPromptId: reattachId,
            onQueued: (promptId) => saveRunProgress({ pos, totClip, clipRecords: [...clipRecords], prevCheckpointName, chainFrame, promptId, savedAt: Date.now(), runState: rs }),
            onPoll: () => setStatus(`Clip ${curClip}/${totClip} · still rendering (connection quiet)…`),
          });
        } finally {
          samplingActive = false;
          resumePromptId = null;
        }
        if (isOneTake) prevCheckpointName = checkpointName;
        // 렌더가 실제로 끝난 시점 — 체인 프레임 복사 등 후처리 오버헤드는 빼고, 모델이
        // 걸린 시간에 더 가깝게 여기서 잡는다.
        const elapsedSec = (Date.now() - clipStart) / 1000;

        const vid = firstOutput(res.byNode, NODE_IDS.save);
        const lastImg = firstOutput(res.byNode, NODE_IDS.saveLF);
        if (vid) {
          clipRecords.push(vid);
          const clipMeta = metaForVideo(rs, promptForClip(rs, i), {
            clip: curClip, clips: plan.count, seed: seedForClip(rs, i), mode: modeForClip,
            prompts: [promptText(rs.prompts?.[i])], onetake: isOneTake,
            elapsedSec,
            turboLora: rs.turboLora, turboLoraReference: rs.turboLoraReference,
            turboLoraStrength: rs.turboLoraStrength, turboLoraLowVram: rs.turboLoraLowVram,
            loras: JSON.parse(JSON.stringify(rs.loras || [])),
            // SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §4 — the assets this clip actually rendered
            // with (post-override via clipAssets()), not just the common set, so Reuse can put
            // back exactly what made this clip instead of nothing at all.
            refImages: assets.refImages, refImagesMp: assets.refImagesMp,
            firstFrameImage: firstFrame || null, lastFrameImage: pos === active.length - 1 ? (assets.lastFrame || rs.lastFrameImage || null) : null,
            refVideos: JSON.parse(JSON.stringify(assets.refVideos || [])), refAudios: JSON.parse(JSON.stringify(assets.refAudios || [])),
            // SPEC_MINIMAX_H3_PDD_AND_TELEMETRY.md #3 — from the graph actually built for this
            // clip, not re-derived, so it can never drift from what really ran.
            stepsEffective: built.meta.stepsEffective, samplerUsed: built.meta.samplerUsed,
            turboFile: built.meta.turboFile, pddNfe: built.meta.pddNfe,
            // SPEC_MINIMAX_H3_INLINE_POSTPROCESS_META.md — post-decode frame ops wired into
            // this clip's graph (null when not run).
            deblur: built.meta.deblur || null, upscale: built.meta.upscale || null,
          });
          // An inline upscale changes the frame size metaForVideo() can't predict, so re-probe
          // the file. Deblur alone never resizes — skip the round trip for it.
          if (built.meta.upscale) await reconcileGeometry(clipMeta, vid);
          saveMeta(vid.filename, vid.subfolder || "", clipMeta);

          // §6 "Also save the clip before deblur / upscale" — the second file the graph wrote
          // straight off the decode. Its own sidecar (no deblur/upscale marker, its own real
          // size), shown in the gallery like any clip, but it never joins the stitch or the
          // last-frame chain — the processed clip above stays the real one.
          const rawVid = built.meta.rawVideoNode ? firstOutput(res.byNode, built.meta.rawVideoNode) : null;
          if (rawVid) {
            const rawMeta: any = { ...clipMeta, deblur: null, upscale: null, unprocessed: true, processedSibling: vid.filename };
            // clipMeta was reconciled to the upscaled size — the raw clip is the decode's own
            // resolution, no pre-op size.
            delete rawMeta.sourceW; delete rawMeta.sourceH;
            const rr = resolveResolution(rs.aspect, rs.megapixels);
            rawMeta.w = rr.width; rawMeta.h = rr.height;
            await reconcileGeometry(rawMeta, rawVid, { noSource: true });
            saveMeta(rawVid.filename, rawVid.subfolder || "", rawMeta);
          }
          showResultVideo(outputViewUrl(vid.filename, vid.subfolder || "", vid.type || "output"));
          badge.textContent = `CLIP ${curClip}/${totClip} done`;
          refreshGallery();
        }
        if (lastImg) {
          await setLastResult(instanceId, { image: lastImg });
          // chainFrame is only ever consumed when continuity is Last Frame Chain — copying it
          // to input/ in every other mode just orphaned one PNG per clip, forever (nothing
          // cleans that folder). Continuity is fixed for the run, so gate on the snapshot (rs),
          // not live state. See SPEC_MINIMAX_H3_TEMP_FILE_CLEANUP.md.
          if (rs.continuityMode === "lastframe") {
            let carry = lastImg;
            const tail = allOutputs(res.byNode, NODE_IDS.tailPrev);
            if (tail.length) {
              const pick = await pickChainFrame(tail.map((t: any) => ({ filename: t.filename, subfolder: t.subfolder || "", type: t.type || "temp" })));
              if (pick?.picked) carry = pick.picked;
            }
            try { chainFrame = await copyOutputToInput(carry.filename, carry.subfolder || "", carry.type || "output"); } catch { chainFrame = null; }
          }
        }

        clipTimes.push((Date.now() - clipStart) / 60000);
        // avgMinutesPerClip은 이 도구 전역 통계라 라이브 state에 그대로 반영(런별 설정이
        // 아니라 UI에 항상 보이는 값이므로 스냅샷과 무관하게 최신으로 유지).
        state.avgMinutesPerClip = +(clipTimes.reduce((a, b) => a + b, 0) / clipTimes.length).toFixed(2);
        persist();
        refreshPlan();
        saveRunProgress(pos < active.length - 1 ? { pos: pos + 1, totClip, clipRecords: [...clipRecords], prevCheckpointName, chainFrame, promptId: null, savedAt: Date.now(), runState: rs } : null);

        if (rs.unloadBetweenClips && pos < active.length - 1) {
          setStatus(`Clip ${curClip}/${totClip} done · freeing VRAM…`);
          await freeMemory();
        }
      }

      if (rs.continuityMode === "onetake" && rs.oneTakeAutoStitch !== false && !stopRequested && clipRecords.length > 1) {
        const overlapSec = framesToSeconds(alignFrameCount(ONE_TAKE_OVERLAP_FRAMES));
        setStatus(`Stitching ${clipRecords.length} clips (One-Take, ${overlapSec.toFixed(3)}s overlap trimmed)…`);
        try {
          const folder = (rs.saveSubfolder || SUBFOLDER).replace(/\\/g, "/");
          const audioOverride = rs.oneTakeAudioOverride && rs.audioLock && rs.lockAudioFile
            ? { filename: rs.lockAudioFile, start: Math.max(0, rs.audioLockTrimStart || 0) }
            : null;
          const out = await stitchClips(clipRecords, `${folder}/${rs.filenamePrefix || "MMH3"}_full`, null, overlapSec, audioOverride);
          const url = outputViewUrl(out.filename, out.subfolder || "", "output");
          const totalSeconds = clipRecords.length * framesToSeconds(rs.clipFrames || 192) - (clipRecords.length - 1) * overlapSec;
          const oneTakeMeta = metaForVideo(
            rs,
            composeStitchedPrompt(active.map(({ i }) => promptForClip(rs, i))),
            { clips: clipRecords.length, stitched: true, onetake: true, overlapSeconds: overlapSec, frames: null, durationSeconds: totalSeconds, prompts: (rs.prompts || []).map(promptText) }
          );
          // Clips may have been upscaled inline — the stitched file inherits that size.
          // keepFrames: its durationSeconds is already the overlap-trimmed total.
          await reconcileGeometry(oneTakeMeta, out, { keepFrames: true });
          saveMeta(out.filename, out.subfolder || "", oneTakeMeta);
          showResultVideo(url);
          badge.textContent = `FULL · ${clipRecords.length} clips (One-Take)`;
          await setLastResult(instanceId, { videoPath: out.path });
          setStatus(`Done — ${clipRecords.length} clips stitched (One-Take) → ${out.filename}`);
          showPopup(`One-Take stitched: ${out.filename}`, false);
          refreshGallery();
        } catch (e: any) {
          setStatus(`Clips saved, One-Take stitch failed: ${e.message}`);
          showPopup(`One-Take stitch failed: ${e.message} — per-clip files are still on disk.`, true);
        }
      } else if ((rs as any)._extendFrom && clipRecords.length === 1 && !stopRequested) {
        // Gallery Extend (SPEC_MINIMAX_H3_CONTINUE_AND_EXTEND.md §3) — one continuation clip
        // was rendered from the source's last frame; concat [source, continuation] into the
        // extended video, trimming the one duplicated seed frame off the continuation's head.
        // Read from the frozen snapshot rs — the live state is repainted back to the panel
        // during the run, so state._extendFrom is already gone by here.
        const ext = (rs as any)._extendFrom as { clip: { filename: string; subfolder: string }; sourcePrompt: string };
        setStatus("Stitching the extended clip…");
        try {
          const folder = (rs.saveSubfolder || SUBFOLDER).replace(/\\/g, "/");
          const trimSec = framesToSeconds(alignFrameCount(1));
          const out = await stitchClips([ext.clip, clipRecords[0]], `${folder}/${rs.filenamePrefix || "MMH3"}_full`, null, trimSec, null);
          const url = outputViewUrl(out.filename, out.subfolder || "", "output");
          const clipPrompts = [ext.sourcePrompt || "", promptForClip(rs, 0)];
          const extendMeta = metaForVideo(
            rs,
            composeStitchedPrompt(clipPrompts),
            { clips: 2, stitched: true, extended: true, frames: null, prompts: clipPrompts }
          );
          // frames were null — the probe fills them in, and picks up any inline upscale size.
          await reconcileGeometry(extendMeta, out);
          saveMeta(out.filename, out.subfolder || "", extendMeta);
          showResultVideo(url);
          badge.textContent = "EXTENDED";
          await setLastResult(instanceId, { videoPath: out.path });
          setStatus(`Done — extended → ${out.filename}`);
          showPopup(`Extended: ${out.filename}`, false);
          refreshGallery();
        } catch (e: any) {
          setStatus(`Continuation saved, stitch failed: ${e.message}`);
          showPopup(`Extend stitch failed: ${e.message} — the new clip is on disk.`, true);
        }
      } else if (clipRecords.length) {
        setStatus(stopRequested ? `Stopped — ${clipRecords.length} clip(s) saved.` : `Done — ${clipRecords.length} clip(s) saved.`);
      }

      barInner.style.width = "100%";
    } catch (e: any) {
      if (e.message === "cancelled") {
        setStatus("Cancelled.");
      } else {
        const why = explainGenerationError(e.message);
        setStatus(why ? `Error: ${why}` : `Error: ${e.message}`);
        showPopup(why || e.message, true);
      }
    } finally {
      delete (state as any)._extendFrom; // one-shot: never let a stale flag stitch a later run
      try { await freeMemory(); } catch {}
      // Entry #1 of the Next Gen queue takes over the live panel and restarts, but only
      // on a clean finish — a stopped or errored run shouldn't silently barrel into
      // whatever's queued, so Stop drops the whole queue, not just this run.
      const queued = !stopRequested && nextQueue.length ? nextQueue.shift() : null;
      if (stopRequested) nextQueue = [];
      renderNextQueue();
      running = false;
      stopRequested = false;
      genBtn.disabled = false;
      genBtn.textContent = "▶ Generate";
      stopClock();
      keepTabAlive(false);
      saveRunProgress(null);
      if (queued) {
        Object.assign(state, queued);
        persist();
        renderPills();
        renderLeft();
        setTimeout(() => runGenerate(), 50);
      }
    }
  }

  // /interrupt는 ComfyUI 전역 엔드포인트라 "지금 서버에서 실행 중인 것"을 그냥 죽인다 —
  // 어느 세션/탭이 큐에 넣었는지는 전혀 구분하지 않는다. 다른 노드/세션이 새치기해서 지금
  // 그게 실행 중이면 Stop이 이 화면의 클립이 아니라 엉뚱한 남의 생성 작업을 끊어버린다.
  // /queue의 queue_running[0] 그래프에 이 화면 고유 프리뷰 키(라이브 프리뷰 소켓 필터링에
  // 쓰는 것과 동일)가 있는지 봐서, 없으면 확인창을 띄운다. /queue 조회 자체가 실패하면
  // 판단 불가이니 사용자를 막지 않고 그냥 통과시킨다.
  async function confirmStopIsOurs(): Promise<boolean> {
    try {
      const r = await comfyApi.fetchApi("/queue");
      const q = await r.json();
      const runningEntry = (q.queue_running || [])[0];
      if (!runningEntry) return true; // 아무것도 안 돌고 있으면 Stop은 어차피 영향 없음
      const prompt = runningEntry[2] || {};
      const isOurs = Object.prototype.hasOwnProperty.call(prompt, previewNodeKey(instanceId));
      if (isOurs) return true;
      // 프리뷰 브라우저는 window.confirm을 억제해 조용히 false를 반환한다(→ Stop이 먹통).
      // 공용 confirmDialog 오버레이 사용 — SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §9.
      return confirmDialog(
        "The job currently running on the ComfyUI server doesn't look like this screen's clip — Stop may interrupt someone else's generation. Continue anyway?"
      );
    } catch {
      return true; // 조회 실패 — 판단 불가, 사용자 발 묶지 않기
    }
  }

  stopBtn.addEventListener("click", async () => {
    if (!(await confirmStopIsOurs())) return;
    // running이 false여도(새로고침 등으로 이 세션이 추적을 놓쳤거나, 애초에 이 세션이 큐를
    // 넣은 게 아니어도) 그냥 인터럽트를 보낸다 — /interrupt는 ComfyUI 전역 신호라 누가 큐를
    // 넣었는지와 무관하게 항상 유효하다("실수로 큐 보냈는데 연결 끊겨서 못 멈춘다" 방지).
    if (!running) {
      await interrupt();
      showPopup("Sent an interrupt signal to ComfyUI.", false);
      return;
    }
    stopRequested = true;
    setStatus("Stopping after the current clip…");
    await interrupt();
    // ComfyUI가 인터럽트를 받아도, 웹소켓 이벤트가 (재연결/HMR 등으로) 유실되면
    // await queuePrompt(...)가 영원히 안 풀려서 버튼이 계속 비활성 상태로 남을 수 있다.
    // 몇 초 안에 실제로 멈추지 않으면 화면만이라도 강제로 되돌린다 — 사용자가 "Stop을
    // 눌렀는데 아무 반응이 없다"고 느끼는 상황을 만들지 않기 위한 안전장치.
    window.setTimeout(() => {
      if (!running) return;
      running = false;
      stopRequested = false;
      genBtn.disabled = false;
      genBtn.textContent = "▶ Generate";
      stopClock();
      setStatus("Stopped (no response — forced reset). Please check the ComfyUI queue.");
      showPopup("Sent the stop signal but got no completion response, so the screen was reset forcibly.", true);
    }, 6000);
  });

  // 프리뷰 창 초기화 — 라이브 토글과 반대쪽(좌상단)에 배치.
  const previewResetBtn = el("button", {
    type: "button", text: "↺", title: "Reset preview",
    class: "absolute top-1.5 left-1.5 z-[6]",
    style: { background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", borderRadius: "4px", width: "22px", height: "22px", cursor: "pointer", fontSize: "12px", padding: "0" },
  });
  previewResetBtn.addEventListener("click", () => resetPreview());
  previewBox.appendChild(previewResetBtn);

  // ── 갤러리(도구 전용 오버레이) ────────────────────────────────────
  // 썸네일/호버 프리뷰/더블클릭 풀스크린/Reuse·Copy/삭제/스티치까지 갖춘 전용 갤러리
  // (원본 ui_gallery_minimax.js 이식) — shared/gallery.ts의 단순 그리드로는 부족해서 별도 구현.
  // Restore a saved clip's prompt + every render setting into the panel. Shared by the
  // gallery's Reuse button and runExtend (SPEC_MINIMAX_H3_CONTINUE_AND_EXTEND.md §3).
  function applyClipSettings(meta: any): boolean {
      if (!meta) return false;
      const parts: string[] = Array.isArray(meta.prompts) && meta.prompts.length ? meta.prompts.slice() : [String(meta.prompt || "")];
      if (!parts.some((p) => String(p || "").trim())) return false;
      state.prompts = parts.map((t) => ({ text: String(t || ""), firstFrame: "", enabled: true }));
      if (Array.isArray(meta.prompts)) {
        state.promptHeader = meta.promptHeader || "";
        state.promptFooter = meta.promptFooter || "";
      }
      // 저장된 클립을 만든 설정 전체를 그대로 복원한다("한 번 잘 나온 클립을 그대로 다시
      // 만들기") — meta에 없는 필드(이 기능 적용 전 저장된 옛날 클립)는 조용히 건너뛰고
      // 현재 패널 값을 그대로 둔다. 시드는 버튼 하나로 항상 동일하게 복원하고 seedMode도
      // "fixed"로 같이 바꿔서 다음 Generate에서 재랜덤되지 않게 한다 — 다른 시드로
      // 변주하고 싶으면 Reuse 후 사용자가 직접 시드 모드를 바꾸면 됨.
      if (meta.aspect != null) state.aspect = meta.aspect;
      if (meta.megapixels != null) state.megapixels = meta.megapixels;
      if (meta.frames != null) state.clipFrames = meta.frames;
      if (meta.steps != null) state.steps = meta.steps;
      if (meta.sampler != null) state.sampler = meta.sampler;
      // Prefer the real axis fields when the clip was saved post-split; only fall back to
      // translating the (otherwise-vestigial, nothing-keeps-it-current) `accel` string for
      // clips saved before this fix — pre-split values ("turbo"/"solattn"/"spectrum"/"none")
      // aren't valid attnBackend keys, so those need the same mapping migratePipelineState()
      // uses, not a direct assignment.
      if (meta.turboMode != null || meta.attnBackend != null || meta.blockCache != null) {
        if (meta.turboMode != null) state.turboMode = meta.turboMode;
        if (meta.attnBackend != null) state.attnBackend = meta.attnBackend;
        if (meta.attnForward != null) state.attnForward = meta.attnForward;
        if (meta.blockCache != null) state.blockCache = meta.blockCache;
        if (meta.h3Optimizer != null) state.h3Optimizer = meta.h3Optimizer;
        if (meta.h3SparseBudget != null) state.h3SparseBudget = meta.h3SparseBudget;
        if (meta.useSpectrum != null) state.useSpectrum = !!meta.useSpectrum;
        if (meta.useFusedModulation != null) state.useFusedModulation = !!meta.useFusedModulation;
      } else if (typeof meta.accel === "string") {
        if (meta.accel.startsWith("turbo:")) state.turboMode = meta.accel.slice("turbo:".length);
        else if (meta.accel === "turbo") state.turboMode = "larryvrh";
        else if (meta.accel === "spectrum") state.useSpectrum = true;
        else if (meta.accel === "solattn") state.attnBackend = "solattn_kijai";
        else if (["none", "sage", "ck", "solattn_kijai", "sla"].includes(meta.accel)) state.attnBackend = meta.accel;
      }
      if (meta.seed != null) { state.seed = meta.seed; state.seedMode = "fixed"; }
      if (meta.turboLora != null) state.turboLora = meta.turboLora;
      if (meta.turboLoraReference != null) state.turboLoraReference = meta.turboLoraReference;
      if (meta.turboLoraStrength != null) state.turboLoraStrength = meta.turboLoraStrength;
      if (meta.turboLoraLowVram != null) state.turboLoraLowVram = meta.turboLoraLowVram;
      // node v1.21.2 — the turbo section's own step counts + model files + the sampling row.
      // Same bug class as the presets: Reuse of a PDD clip restored turboMode="pdd" with no
      // file → effectiveTurbo fell back to normal steps. != null so a pre-v1.21.2 clip (none of
      // these fields) leaves the panel alone. slaTurboLora is skipped — plain LoRA entry here.
      if (meta.pddFile != null) state.pddFile = meta.pddFile;
      if (meta.pddFileReference != null) state.pddFileReference = meta.pddFileReference;
      if (meta.pddNfe != null) state.pddNfe = String(meta.pddNfe);
      if (meta.turboSteps != null) state.turboSteps = meta.turboSteps;
      if (meta.slaTurboSteps != null) state.slaTurboSteps = meta.slaTurboSteps;
      if (meta.scheduler != null) state.scheduler = meta.scheduler;
      if (meta.denoise != null) state.denoise = meta.denoise;
      if (meta.shiftVideo != null) state.shiftVideo = meta.shiftVideo;
      if (meta.shiftAudio != null) state.shiftAudio = meta.shiftAudio;
      if (Array.isArray(meta.loras)) state.loras = meta.loras.map((l: any) => ({ name: l.name || "none", strength: l.strength ?? 1.0, triggerWord: l.triggerWord || "", enabled: l.enabled !== false }));
      // SPEC_MINIMAX_H3_INLINE_POSTPROCESS_META.md §3 — inline deblur/upscale the clip was made
      // with, reproduce it. Only for a clip whose pass ran INLINE at generation time: a gallery
      // post-processed file (meta.postProcess set) carries the SOURCE's meta and §5 Reuse
      // rebuilds that un-processed original, not the upscale-again.
      if (!meta.postProcess) {
        if (meta.deblur !== undefined) state.deblurStrength = meta.deblur || "none";
        if (meta.upscale === null) {
          state.upscaleMode = "none";
        } else if (meta.upscale && meta.upscale.method === "rtx") {
          state.upscaleMode = "rtx";
          if (meta.upscale.scale != null) state.rtxScale = meta.upscale.scale;
          if (meta.upscale.quality) state.rtxQuality = meta.upscale.quality;
        } else if (meta.upscale && meta.upscale.method === "model") {
          state.upscaleMode = "model";
          if (meta.upscale.model) state.upscaleModel = meta.upscale.model;
        }
      }
      // SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §4 — restore the actual image/video/audio inputs.
      // Array.isArray/!== undefined guards (not a bare truthy check) so a clip saved before this
      // fix — which has none of these fields at all — leaves whatever is already on screen alone
      // instead of wiping it to empty.
      if (Array.isArray(meta.refImages)) state.refImages = meta.refImages.slice();
      if (Array.isArray(meta.refImagesMp)) state.refImagesMp = meta.refImagesMp.slice();
      if (meta.firstFrameImage !== undefined) state.firstFrameImage = meta.firstFrameImage || null;
      if (meta.lastFrameImage !== undefined) state.lastFrameImage = meta.lastFrameImage || null;
      if (Array.isArray(meta.refVideos)) state.refVideos = JSON.parse(JSON.stringify(meta.refVideos));
      if (Array.isArray(meta.refAudios)) state.refAudios = JSON.parse(JSON.stringify(meta.refAudios));
      persist();
      refreshPlan();
      renderPills();
      renderLeft();
      return true;
  }

  // Gallery Extend (SPEC_MINIMAX_H3_CONTINUE_AND_EXTEND.md §3) — render one continuation clip
  // from a finished clip's last frame, then auto-stitch [source, continuation] into one longer
  // video. All render settings come from the source via applyClipSettings; the caller supplies
  // only the new prompt + seed frame. async (awaits getVideoInfo); the gallery calls it
  // fire-and-forget.
  async function runExtend({ sourceClip, seedFrame, prompt, sourcePrompt }: { sourceClip: any; seedFrame: string; prompt: string; sourcePrompt: string }) {
    if (running) { showPopup("A render is already running.", true); return; }
    if (!sourceClip || !seedFrame || !String(prompt || "").trim()) {
      showPopup("Extend needs a clip, a seed frame and a prompt.", true);
      return;
    }
    try { applyClipSettings(sourceClip.meta || sourceClip); } catch {} // best-effort; missing meta leaves panel defaults
    // The continuation must match the source's real size or the stitch concat produces a
    // 0-byte file. applyClipSettings covers it when the clip has meta; probe the file otherwise.
    try {
      const info = await getVideoInfo(sourceClip.filename, sourceClip.subfolder || "", "output");
      if (info?.width && info?.height) {
        state.megapixels = Math.max(0.1, Math.round((info.width * info.height) / 1e4) / 100);
        const r = info.width / info.height;
        state.aspect = ASPECTS.reduce((best, a) =>
          Math.abs(a.w / a.h - r) < Math.abs(best.w / best.h - r) ? a : best).label;
      }
    } catch {}
    state.prompts = [{ text: String(prompt), firstFrame: seedFrame, enabled: true, override: false }];
    state.promptHeader = "";
    state.promptFooter = "";
    state.generationMode = "firstlast";
    state.continuityMode = "none";
    // Extend always renders First/Last. A source made in Reference mode keeps its turbo files
    // in the *reference* slots, which firstlast never reads — carry them over (node v1.21.1).
    if (!state.pddFile || state.pddFile === "none") state.pddFile = state.pddFileReference || state.pddFile;
    if (!state.turboLora || state.turboLora === "none") state.turboLora = state.turboLoraReference || state.turboLora;
    if (!generationModesFor(state).find((m) => m.key === "firstlast")?.enabled) {
      showPopup("Set the First/Last UNET in ⚙ Settings → Models to use Extend.", true);
      return;
    }
    (state as any)._extendFrom = {
      clip: { filename: sourceClip.filename, subfolder: sourceClip.subfolder || "" },
      sourcePrompt: sourcePrompt || "",
    };
    persist();
    renderPills();
    renderLeft();
    refreshPlan();
    runGenerate();
  }

  const galleryOv = createGalleryOverlay(state, {
    showPopup,
    get availability() { return ctx.availability; },
    reusePrompt: applyClipSettings,
    runExtend,
  });
  function refreshGallery() {
    // 도구 전용 갤러리는 열릴 때(show()) 스스로 새로고침한다 — 여기서는 클립 저장 직후
    // 갤러리가 이미 열려 있으면 최신 목록을 반영하기 위한 훅.
    if (galleryOv.isOpen()) (galleryOv as any).show?.();
  }

  // Reuse coming from the standalone gallery page (gallery.html) — run it through the tool's
  // own applyClipSettings so the field reshaping is identical to an in-app Reuse.
  const _galleryReuse = takeReuse("minimax_h3");
  if (_galleryReuse) applyClipSettings(_galleryReuse);

  mainRow.append(leftOuter, rightPanel);

  const promptEditOv = createPromptEditOverlay(
    state,
    { persist, showPopup, currentPlan, get missingAssets() { return missingAssets; }, checkMissingAssets: refreshMissingAssets },
    // Loading a prompt set (SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md §7) can change generationMode,
    // which the left panel's mode buttons and Images accordion need to see, not just the plan line.
    () => { refreshPlan(); renderLeft(); }
  );
  editBtn.addEventListener("click", () => {
    if (state.generationMode === "ltxupscale") { openLtxPromptEdit(); return; }
    if (state.generationMode === "facerefine") { openFrPromptEdit(); return; }
    promptEditOv.show();
  });

  const commonPromptOv = createCommonPromptOverlay(state, { persist }, () => {
    refreshPlan();
    promptEditOv.syncCommon();
  });
  commonBtn.addEventListener("click", () => commonPromptOv.show());

  wrap.append(depBannerEl, subBar, mainRow, pop, promptEditOv.el, commonPromptOv.el, galleryOv.el, settingsOv.el, helpOv, queueListOv);
  container.appendChild(wrap);
  document.body.appendChild(galleryOv.playerEl); // 풀스크린 플레이어는 다른 모든 것 위에 떠야 하므로 body 직속

  renderPills();
  renderLeft();
  applyMobileCollapsibleLayout(mainRow, leftOuter, leftPanel, rightPanel);

  // 백그라운드로 모델/가용성/갤러리 초기 로드 — 도착하는 대로 관련 UI를 다시 그린다.
  getModels()
    .then((d) => { ctx.availableModels = d; renderLeft(); })
    .catch(() => {});
  getNodeAvailability()
    .then((av) => {
      ctx.availability = av.available || {};
      ctx.availabilityInfo = av;
      renderPills();
      renderLeft();
      refreshDepBanner();
    })
    .catch(() => {});
  loadAudioFiles();
  loadUserPresets();
  refreshGallery();
  startQueuePolling();

  // 탭이 사용자 모르게 디스카드/리로드됐다가 다시 그려진 경우 — 죽기 전에 남겨둔 진행
  // 상황이 있으면(24시간 이내) 새 큐를 보내는 대신 그 자리에 재부착해서 이어간다.
  const pending = loadRunProgress();
  if (pending) {
    setStatus(`Reconnecting to previous run… (clip ${pending.pos + 1}/${pending.totClip})`);
    runGenerate(pending);
  } else if (state._ltxRelay) {
    setStatus(`Reconnecting to previous LTX Upscale run… (segment ${state._ltxRelay.parts.length + 1}/${state._ltxRelay.passes.length})`);
    runLtxUpscale(true);
  }
}
