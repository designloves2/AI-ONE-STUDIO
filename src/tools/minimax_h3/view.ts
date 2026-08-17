// view.ts — MiniMax H3 ONE STUDIO, 웹 레이아웃 재설계판.
// 원본은 ComfyUI 노드 위젯(정사각형에 가까운 고정 1000x820 박스) 안에서 좌측 320px 컨트롤 +
// 우측 프리뷰/프롬프트 구조였다. 여기서는 그 정사각형 제약을 버리고, 넓어진 가로 폭을
// 살려 좌측 컨트롤 레일(고정폭, 스크롤) + 우측 프리뷰/프롬프트(넓은 가변폭)로 재배치했다.
// 백엔드 연결은 다음 단계(§4-2) — 지금은 정적 UI + 로컬 상태 저장까지만 동작한다.
import type { MinimaxState } from "./core";
import {
  ACCEL_MODES,
  ASPECTS,
  CLIP_LENGTHS,
  SUBFOLDER,
  UPSCALE_MODES,
  accelModesFor,
  activePrompts,
  alignFrameCount,
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
  promptEnabled,
  promptFirstFrame,
  promptText,
  randomSeed,
  resolveResolution,
  saveState,
} from "./core";
import { applyMobileCollapsibleLayout, button, checkboxRow, clear, col, el, iconBtn, label, modeBar, numberField, panel, row, searchableSelect, select } from "../../shared/ui";
import { C, BRAND } from "../../identity";
import { createPromptEditOverlay } from "./promptEdit";
import { createSettingsOverlay, type SettingsCtx } from "./settings";
import { createGalleryOverlay } from "./galleryOverlay";
import { mountImagePanel } from "./imagesPanel";
import { createCommonPromptOverlay } from "./commonPromptOverlay";
import {
  copyOutputToInput,
  freeMemory,
  getLoraTriggers,
  getMediaFiles,
  getModels,
  getNodeAvailability,
  getQueueStatus,
  interrupt,
  outputViewUrl,
  pickChainFrame,
  saveMeta,
  setLastResult,
  stitchClips,
  uploadMedia,
} from "./api";
import { comfyApi, queuePrompt } from "./comfyClient";
import { buildClipGraph, NODE_IDS, ONE_TAKE_OVERLAP_FRAMES, previewNodeKey } from "./graphBuilder";

export function renderMinimaxH3(container: HTMLElement) {
  const state: MinimaxState = defaultState(loadState());
  const persist = () => saveState(state);
  // ModelPreviewOverrideKJ가 프레임을 이 id로 태깅해 보낸다 — 탭마다 하나씩 생기므로 고정 문자열로 충분.
  const instanceId = "mmh3_web";
  // 이 클립이 지금 샘플링 중일 때만 true — queuePrompt가 resolve된 뒤(또는 결과 영상을
  // 이미 보여준 뒤) 뒤늦게 도착하는 kj_preview_override 이벤트가 결과 화면을 다시
  // 라이브 프리뷰로 덮어써버리는 버그의 원인이었다. resolve 직후 바로 false로 내린다.
  let samplingActive = false;

  let popTimer: number | undefined;
  const wrap = el("div", { class: "flex flex-col h-full", style: { color: C.text, fontFamily: "inherit" } });

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

  // 도구 전역에서 공유하는 컨텍스트 — Settings/Prompt Edit/(이후) Generate 루프가 같이 씀
  const ctx: SettingsCtx = {
    persist,
    refreshPlan: () => refreshPlan(),
    refreshModes: () => { renderPills(); renderLeft(); refreshPreviewToggleBtn(); },
    availability: {},
    availableModels: undefined,
  };

  // ── 도구 서브바(모드 필/아이콘 버튼) ─────────────────────────────────
  const subBar = el("div", { class: "flex items-center gap-2 px-4 h-12 border-b border-border shrink-0" });
  const pillsWrap = el("div", { class: "flex-1" });
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
        if (!accelModesFor(key).some((m) => m.key === state.accelMode)) state.accelMode = "solattn";
        persist();
        renderPills();
        renderLeft();
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
  const leftOuter = el("div", { class: "flex flex-col w-full lg:w-[450px] shrink-0 gap-2 lg:h-full min-h-0" });
  const leftPanel = el("div", { class: "flex flex-col gap-1.5 overflow-y-auto pr-1 flex-1 min-h-0" });
  leftOuter.appendChild(leftPanel);

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
  // 라이브 프리뷰가 off일 때 샘플링 중에는 이 검은 화면 + 문구만 보여준다(마지막 프레임이
  // 화면에 그대로 남아있지 않게). 다시 on으로 바꾸면 다음 프레임이 도착할 때 자연스럽게
  // showPreviewFrame이 이 화면을 걷어낸다.
  const previewOffMsg = el("div", { class: "text-muted text-xs text-center leading-relaxed hidden" });
  previewOffMsg.innerHTML = "⏸ 라이브 프리뷰 꺼짐<br><span style='font-size:10px'>생성 중입니다…</span>";
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
  previewBox.append(placeholder, previewImg, previewVid, resultVid, previewOffMsg, badge, fsBtn, previewToggleBtn);

  let lastResultURL: string | null = null;
  fsBtn.addEventListener("click", () => {
    if (lastResultURL) window.open(lastResultURL, "_blank");
  });

  function showPreviewFrame(dataURL: string, mime?: string) {
    placeholder.style.display = "none";
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
    fsBtn.classList.remove("hidden");
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
          externalQueueBanner.textContent = `⏳ 내 생성 요청이 ComfyUI 큐에서 대기 중입니다 (대기 ${q.pending}건) — 앞선 작업이 끝나면 자동으로 시작됩니다.`;
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
          externalQueueBanner.textContent = `⚠ ComfyUI 큐: 이 화면의 생성 외에 대기 ${extraPending}건 더 있습니다.`;
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
        externalQueueBanner.textContent = `⚠ ComfyUI 큐: 실행 중 ${q.running} · 대기 ${q.pending} — 이 화면이 큐잉한 작업이 아니라면 진행률/프리뷰는 표시되지 않습니다.`;
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
  const promptHdr = el("div", { class: "flex items-center gap-1.5 h-5" });
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

  function renderPrompts() {
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
      totalLine.innerHTML =
        `<span style="font-size:20px;font-weight:700;color:${BRAND}">${p.actualSeconds.toFixed(2)}s</span>` +
        `<span style="font-size:11px;color:${C.muted}"> total</span>`;
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
    return row([col([sel]), col([up, inp])]);
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

  function accelSettings() {
    const n = (v: number, set: (v: number) => void, step = 0.05) => numberField(v, (x) => { set(x); persist(); }, step);
    switch (state.accelMode) {
      case "turbo":
        return [
          row([
            col([label("Turbo strength"), n(state.turboLoraStrength ?? 1.0, (v) => (state.turboLoraStrength = v))]),
            col([label("Low VRAM"), checkboxRow("low_vram", !!state.turboLoraLowVram, (v) => { state.turboLoraLowVram = v; persist(); })]),
          ]),
        ];
      case "solattn":
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
      case "spectrum":
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
      default:
        return [el("div", { text: "No acceleration patch — slowest, but the most faithful baseline.", style: { fontSize: "10px", color: C.muted } })];
    }
  }

  function renderLeft() {
    const contModes = continuityModesFor(state.generationMode, state);
    const cur = contModes.find((m) => m.key === state.continuityMode);
    if (!cur || cur.disabled) {
      state.continuityMode = "none";
      persist();
    }
    leftPanel.innerHTML = "";

    if (!accelModesFor(state.generationMode).some((m) => m.key === state.accelMode)) {
      state.accelMode = "solattn";
      persist();
    }
    if (state.accelMode === "turbo" && state.useCache) {
      state.useCache = false;
      persist();
    }

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
        select(CLIP_LENGTHS.map((c) => ({ value: String(c.frames), label: c.label })), String(state.clipFrames), (v) => { state.clipFrames = parseInt(v, 10); persist(); refreshPlan(); }),
        totalLine,
        planLine,
        el("div", { text: "Length follows the prompts: one prompt is one clip. Add a prompt (or split the brief into shots) to make the piece longer.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
      ])
    );
    refreshPlan();

    // Pipeline — Acceleration / Upscale / Continuity are separate boxes, not one long
    // panel, so each control group reads as its own thing.
    leftPanel.appendChild(el("div", { text: "Pipeline", style: { color: C.muted, fontSize: "11px", marginTop: "4px", marginBottom: "-2px", textTransform: "uppercase", letterSpacing: "0.04em" } }));

    leftPanel.appendChild(
      panel([
        col([label("Acceleration"), select(accelModesFor(state.generationMode).map((m) => ({ value: m.key, label: m.label })), state.accelMode, (v) => { state.accelMode = v; persist(); renderLeft(); })]),
        ...accelSettings(),
        checkboxRow("H3 Cache (step reuse)", !!state.useCache, (v) => { state.useCache = v; persist(); }, { disabled: state.accelMode === "turbo" }),
      ])
    );

    // Audio Lock — H3는 레퍼런스 오디오를 참고만 하고 새로 만들기 때문에, 립싱크나
    // 음악 영상처럼 원본 오디오를 그대로 유지해야 할 때 이 락이 필요하다.
    leftPanel.appendChild(panel(audioLockControls()));

    leftPanel.appendChild(
      panel([
        col([label("Upscale"), select(UPSCALE_MODES.map((m) => ({ value: m.key, label: m.label })), state.upscaleMode, (v) => { state.upscaleMode = v; persist(); renderLeft(); })]),
        ...(state.upscaleMode === "rtx"
          ? [
              row([
                col([label("RTX scale"), numberField(state.rtxScale ?? 2, (v) => { state.rtxScale = v; persist(); }, 0.5)]),
                col([label("Quality"), select(["LOW", "MEDIUM", "HIGH", "ULTRA"].map((q) => ({ value: q, label: q })), state.rtxQuality || "ULTRA", (v) => { state.rtxQuality = v; persist(); })]),
              ]),
            ]
          : []),
      ])
    );

    leftPanel.appendChild(
      panel([
        col([
          label("Continuity between clips"),
          select(contModes.map((m) => ({ value: m.key, disabled: m.disabled, label: m.disabled ? `${m.label} — ${m.reason}` : m.label })), state.continuityMode, (v) => { state.continuityMode = v; persist(); renderLeft(); }),
        ]),
        el("div", { text: (contModes.find((m) => m.key === state.continuityMode) || ({} as any)).hint || "", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
      ])
    );

    // Output
    leftPanel.appendChild(
      panel([
        label("Output"),
        checkboxRow("Free VRAM between clips", state.unloadBetweenClips !== false, (v) => { state.unloadBetweenClips = v; persist(); }),
        el("div", { text: "Clips are saved separately. Combine them afterward from 🖼 Gallery.", style: { fontSize: "10px", color: C.muted, lineHeight: "1.5" } }),
      ])
    );

    // Steps
    const turbo = state.accelMode === "turbo";
    leftPanel.appendChild(
      panel([
        label("Steps"),
        row([
          col([label(turbo ? "Turbo steps ●" : "Turbo steps"), numberField(state.turboSteps ?? 4, (v) => { state.turboSteps = Math.max(1, Math.round(v)); persist(); }, 1)]),
          col([label(turbo ? "Normal steps" : "Normal steps ●"), numberField(state.steps ?? 20, (v) => { state.steps = Math.max(1, Math.round(v)); persist(); }, 1)]),
        ]),
      ])
    );

    // Images (mode-specific: First/Last keyframes, Reference images/videos/audios)
    const imgPanel = mountImagePanel(state, ctx);
    leftPanel.appendChild(imgPanel.el);
    ctx._rerenderImages = imgPanel.render;

    // LoRA
    leftPanel.appendChild(mountLoraPanel());

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
          showPopup("Could not refresh the model list — ComfyUI가 실행 중인지 확인하세요.", true);
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
  stopBtn.disabled = true;
  seedGenWrap.appendChild(row([genBtn, stopBtn]));

  // ══ 생성 릴레이 루프 ═══════════════════════════════════════════════
  // 원본: one_node_minimax_h3.js의 genBtn.onclick — 클립 하나당 그래프 하나를 큐잉하고,
  // 완료를 기다린 뒤 다음 클립으로 넘어간다(모델을 계속 들고 있지 않도록 클립 사이 VRAM 해제).
  let running = false;
  let stopRequested = false;

  function promptForClip(clipIdx: number) {
    return composeClipPrompt(state, clipIdx);
  }
  function seedForClip(i: number) {
    if (!state.seedPerClip) return state.seed ?? 0;
    return ((state.seed ?? 0) + i) % Number.MAX_SAFE_INTEGER;
  }
  function metaForVideo(promptTextVal: string, extra: Record<string, any> = {}) {
    const { width, height } = resolveResolution(state.aspect, state.megapixels);
    return {
      v: 1, prompt: String(promptTextVal || ""), promptHeader: state.promptHeader || "", promptFooter: state.promptFooter || "",
      w: width, h: height, mode: state.generationMode || "t2v", aspect: state.aspect, megapixels: state.megapixels,
      frames: state.clipFrames, steps: state.steps, sampler: state.sampler, accel: state.accelMode, seed: state.seed,
      node: "minimax_h3", created: Date.now(), ...extra,
    };
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

  genBtn.addEventListener("click", async () => {
    if (running) return;
    running = true;
    stopRequested = false;
    genBtn.disabled = true;
    genBtn.textContent = "⏳ Preparing…";
    stopBtn.disabled = false;
    resetPreview();
    barInner.style.width = "0%";
    startClock();

    try {
      if (!ctx.availability || !Object.keys(ctx.availability).length) {
        const av = await getNodeAvailability();
        ctx.availability = av.available || {};
        ctx.availabilityInfo = av;
      }
      if (ctx.availabilityInfo && ctx.availabilityInfo.core_ok === false) {
        throw new Error(`Missing core nodes: ${(ctx.availabilityInfo.missing_core || []).join(", ")}`);
      }

      if (state.seedMode === "randomize") { state.seed = randomSeed(); seedInput.value = String(state.seed); }
      else if (state.seedMode === "increment") { state.seed = (state.seed || 0) + 1; seedInput.value = String(state.seed); }
      else if (state.seedMode === "decrement") { state.seed = Math.max(0, (state.seed || 0) - 1); seedInput.value = String(state.seed); }
      persist();

      const plan = currentPlan();
      const active = activePrompts(state);
      if (!active.length) throw new Error("No prompts are switched on.");
      totClip = active.length;
      const clipRecords: any[] = [];
      let chainFrame: string | null = state.generationMode === "reference" ? null : state.firstFrameImage || null;
      let prevCheckpointName: string | null = null;
      const clipTimes: number[] = [];

      for (let pos = 0; pos < active.length; pos++) {
        if (stopRequested) { setStatus(`Stopped after ${pos} clip(s).`); break; }
        const i = active[pos].i;
        curClip = pos + 1;
        const clipStart = Date.now();
        setStatus(`Clip ${curClip}/${totClip} (prompt ${i + 1}) · building graph…`);
        badge.classList.remove("hidden");
        badge.textContent = `● CLIP ${curClip}/${totClip}`;

        const isRef = state.generationMode === "reference";
        let firstFrame: string | null = isRef ? null : state.firstFrameImage || null;
        let refImages: string[] = state.refImages || [];
        const continued = pos > 0 && state.continuityMode === "lastframe" && !!chainFrame;
        if (pos > 0) firstFrame = continued ? chainFrame : null;
        if (continued) refImages = [];

        const override = promptFirstFrame(state.prompts[i]);
        let overridden = false;
        if (override) { firstFrame = override; refImages = []; overridden = true; }

        const modeForClip = continued || overridden ? "firstlast" : state.generationMode;
        const clipState: MinimaxState = { ...state, generationMode: modeForClip };

        const isOneTake = state.continuityMode === "onetake";
        const checkpointName = isOneTake ? `${instanceId}_${i}` : null;

        const built = buildClipGraph(clipState, ctx.availability, {
          nodeId: instanceId,
          promptText: promptForClip(i),
          seed: seedForClip(i),
          firstFrame,
          lastFrame: pos === active.length - 1 ? state.lastFrameImage || null : null,
          refImages,
          clipIndex: i,
          saveLastFrame: true,
          prevCheckpointName: isOneTake ? prevCheckpointName : null,
          checkpointName,
        });

        setStatus(`Clip ${curClip}/${totClip} · queued`);
        samplingActive = true;
        applyPreviewOffState();
        let res;
        try {
          res = await queuePrompt(built.graph, { onProgress: (v, m) => setStepProgress(v, m) });
        } finally {
          samplingActive = false;
        }
        if (isOneTake) prevCheckpointName = checkpointName;

        const vid = firstOutput(res.byNode, NODE_IDS.save);
        const lastImg = firstOutput(res.byNode, NODE_IDS.saveLF);
        if (vid) {
          clipRecords.push(vid);
          saveMeta(vid.filename, vid.subfolder || "", metaForVideo(promptForClip(i), {
            clip: curClip, clips: plan.count, seed: seedForClip(i), mode: modeForClip,
            prompts: [promptText(state.prompts?.[i])], onetake: isOneTake,
          }));
          showResultVideo(outputViewUrl(vid.filename, vid.subfolder || "", vid.type || "output"));
          badge.textContent = `CLIP ${curClip}/${totClip} done`;
          refreshGallery();
        }
        if (lastImg) {
          await setLastResult(instanceId, { image: lastImg });
          let carry = lastImg;
          const tail = allOutputs(res.byNode, NODE_IDS.tailPrev);
          if (tail.length) {
            const pick = await pickChainFrame(tail.map((t: any) => ({ filename: t.filename, subfolder: t.subfolder || "", type: t.type || "temp" })));
            if (pick?.picked) carry = pick.picked;
          }
          try { chainFrame = await copyOutputToInput(carry.filename, carry.subfolder || "", carry.type || "output"); } catch { chainFrame = null; }
        }

        clipTimes.push((Date.now() - clipStart) / 60000);
        state.avgMinutesPerClip = +(clipTimes.reduce((a, b) => a + b, 0) / clipTimes.length).toFixed(2);
        persist();
        refreshPlan();

        if (state.unloadBetweenClips && pos < active.length - 1) {
          setStatus(`Clip ${curClip}/${totClip} done · freeing VRAM…`);
          await freeMemory();
        }
      }

      if (state.continuityMode === "onetake" && state.oneTakeAutoStitch !== false && !stopRequested && clipRecords.length > 1) {
        const overlapSec = framesToSeconds(alignFrameCount(ONE_TAKE_OVERLAP_FRAMES));
        setStatus(`Stitching ${clipRecords.length} clips (One-Take, ${overlapSec.toFixed(3)}s overlap trimmed)…`);
        try {
          const folder = (state.saveSubfolder || SUBFOLDER).replace(/\\/g, "/");
          const out = await stitchClips(clipRecords, `${folder}/${state.filenamePrefix || "MMH3"}_full`, null, overlapSec);
          const url = outputViewUrl(out.filename, out.subfolder || "", "output");
          const totalSeconds = clipRecords.length * framesToSeconds(state.clipFrames || 192) - (clipRecords.length - 1) * overlapSec;
          saveMeta(out.filename, out.subfolder || "", metaForVideo(
            active.map(({ i }) => promptForClip(i)).join("\n\n"),
            { clips: clipRecords.length, stitched: true, onetake: true, overlapSeconds: overlapSec, frames: null, durationSeconds: totalSeconds, prompts: (state.prompts || []).map(promptText) }
          ));
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
      try { await freeMemory(); } catch {}
      running = false;
      stopRequested = false;
      genBtn.disabled = false;
      genBtn.textContent = "▶ Generate";
      stopBtn.disabled = true;
      stopClock();
    }
  });

  stopBtn.addEventListener("click", async () => {
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
      stopBtn.disabled = true;
      stopClock();
      setStatus("Stopped (연결 응답 없음 — 강제 종료). ComfyUI 큐를 확인해 주세요.");
      showPopup("Stop 신호는 보냈지만 완료 응답을 못 받아 화면을 강제로 초기화했습니다.", true);
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
  const galleryOv = createGalleryOverlay(state, {
    showPopup,
    reusePrompt(meta: any) {
      if (!meta) return false;
      const parts: string[] = Array.isArray(meta.prompts) && meta.prompts.length ? meta.prompts.slice() : [String(meta.prompt || "")];
      if (!parts.some((p) => String(p || "").trim())) return false;
      state.prompts = parts.map((t) => ({ text: String(t || ""), firstFrame: "", enabled: true }));
      if (Array.isArray(meta.prompts)) {
        state.promptHeader = meta.promptHeader || "";
        state.promptFooter = meta.promptFooter || "";
      }
      persist();
      refreshPlan();
      return true;
    },
  });
  function refreshGallery() {
    // 도구 전용 갤러리는 열릴 때(show()) 스스로 새로고침한다 — 여기서는 클립 저장 직후
    // 갤러리가 이미 열려 있으면 최신 목록을 반영하기 위한 훅.
    if (galleryOv.isOpen()) (galleryOv as any).show?.();
  }

  mainRow.append(leftOuter, rightPanel);

  const promptEditOv = createPromptEditOverlay(
    state,
    { persist, showPopup, currentPlan },
    () => refreshPlan()
  );
  editBtn.addEventListener("click", () => promptEditOv.show());

  const commonPromptOv = createCommonPromptOverlay(state, { persist }, () => {
    refreshPlan();
    promptEditOv.syncCommon();
  });
  commonBtn.addEventListener("click", () => commonPromptOv.show());

  wrap.append(subBar, mainRow, pop, promptEditOv.el, commonPromptOv.el, galleryOv.el, settingsOv.el, helpOv);
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
      if (av.core_ok === false) showPopup(`Missing core nodes: ${(av.missing_core || []).join(", ")}`, true);
    })
    .catch(() => {});
  loadAudioFiles();
  refreshGallery();
  startQueuePolling();
}
