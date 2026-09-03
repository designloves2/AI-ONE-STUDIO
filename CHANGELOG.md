# Changelog

이 프로젝트의 주요 변경 사항을 기록합니다. 형식은 [Keep a Changelog](https://keepachangelog.com/)를
느슨하게 따릅니다. 아직 버전 태그를 매기지 않고 있어 날짜 단위로 묶었습니다.

## [0.2.0] — 2026-09-03

MiniMax H3 brought to parity with `ComfyUI-TJ_NODE_STUDIO_ONE` v1.20.0 → v1.24.0. Ported
overnight in coordination with the node repo; each item verified against a live ComfyUI.
See `PORT_LEDGER.md` for the per-change node↔web mapping.

### Added
- **Continue / Extend** (node v1.21.0–1.21.2) — resume a multi-clip run from a finished
  clip ("Continue generating the clip", gallery frame picker), one-click **Extend** from a
  gallery clip (LLM-drafted continuation prompt → FL2VA render → auto-stitch), and user
  pipeline presets that carry the full left-panel recipe (steps / sampler / PDD file /
  turbo axes), not just the accelerator mode
- **Enhance result — 3 apply modes** (node v1.22.0): One Prompt / Auto Split (default) /
  Use selected, chosen after the model answers; `parseBrief` broadened for structured audio
  sections and instruction/vision-echo stripping
- **Per-field Undo / Clear** on the three Prompt Edit text fields, button text dimming when
  it can't act (node v1.22.1–1.22.2)
- **Drag-reorder** the CLIPS list and every attached-media grid (reference images, per-clip
  images, the shared video/audio tiles); CLIPS rows labelled `N - Clip Prompt #N`;
  drag-resizable preview box (node v1.23.0)
- **Inline deblur / upscale now recorded in clip metadata** (node v1.23.1–1.23.2): the
  sidecar re-probes the real output size, keeps `sourceW/H`; gallery post-process names
  every stage (`deblur + upscale`, `rtx upscale`, `interpolation`); thumbnail cards show
  `⇪` upscaled / `✧` deblurred / `⇄` interpolated badges; a "save the clip before
  deblur/upscale" toggle keeps the raw decode as a separate `_raw` clip
- **H3 attention forward patch no longer gated on the backend** (node `0876abc`) — CK /
  SolAttn / SLA no longer disable MemEff Sage; both run, with an overlap note explaining
  which layer each covers. The migration no longer lets SLA hijack the backend slot
- **H3 optimizer axis** (node v1.24.0, `SPEC_MINIMAX_H3_PIPELINE_AXES.md` §③) — a third
  Attention-accordion control wrapping Zironic `H3-Optimizations`. **H3 Memory Opt**
  preserves the selected dense backend (Sage / **Comfy Kitchen** / stock) and wraps it —
  the way to run a memory-efficient CK; never blocked. **+ Sparse** adds `H3SparseAttention`,
  gated wherever it can't own the attention (any turbo, an already-sparse backend, or an H3
  forward patch)
- `install_comfyui_dependencies.bat`: finds ComfyUI Desktop's `<ComfyUI>\.venv` Python (was
  falling through to system Python); the system-Python fallback is opt-in only now; adds
  `ComfyUI-VFI` (gallery interpolate) and `H3-Optimizations`; 7-entry Python discovery order
  matching the node's installer
- `.gitattributes` forces CRLF on `*.bat` / `*.cmd` / `*.ps1`
- `ONE_SHOT_INSTALL.md` — a copy-paste full-stack install prompt for Claude Code / Codex users

### Fixed
- **PDD Acc file (FL2VA / Ref2VA) selections weren't persisting** — missing from the
  `saveConfig` payload and the `getConfig` restore; the node's `mmh3_get_config` also
  dropped them
- **"Sampling · step N/M" showed wrong totals** — the progress handler forwarded every
  ComfyUI `progress` event; now filtered to the sampler node + running job
- Stitched mp4s wouldn't play on iOS Safari over the tunnel (node added `-movflags
  +faststart`); gallery upscale/interpolate hang on iPhone (missing `/history` completion
  poll on the fresh-submit path); post-process meta showed source dimensions, not the
  upscaled/interpolated output
- Duration-based chunk sizing for gallery post-process (RTX VSR whole-file < 15s / 15s
  chunks; upscale model whole-file < 10s / 5s chunks)
- Single-shot gallery post-process now survives a tab reload (snapshot on queue, resume on
  next gallery open)
- Both `.bat` files had LF line endings — `cmd.exe` misparses an LF-only batch file once
  labels / subroutines are involved
- The installer's numpy version probe printed "The filename … is incorrect" and skipped the
  numpy pin-back (a `for /f ('"%PYTHON%" … | findstr …')` quoting bug)
- `groundingdino-py` `UnicodeDecodeError` on cp949 Windows (the web installer already set
  `PYTHONUTF8=1`; the node adopted it)
- `public/comfy_port.txt` no longer tracked — it's machine-local config the installer writes

## [0.1.0] — 2026-08-26

First tagged release. Highlights since the last untagged snapshot (2026-08-18):

### Added
- **Next Gen FIFO queue** for MiniMax H3 — queue up follow-up runs (any clip count) while one
  is in progress, with a popup to inspect/cancel individual queued entries
- Run-state snapshot freeze: a run now reads only the panel state captured at its own start,
  so editing the live panel for a queued Next Gen entry no longer affects a run in progress
- Refresh-recovery hardening — `/history` polling fallback on reattach, so a genuine tab
  close+reopen (not just a refresh) no longer leaves a resumed run stuck forever
- Tab-close warning (checkbox, on by default) plus a "Force Stop Queue" escape hatch in the
  restart popup for a job stuck past what the ordinary Stop button can clear
- Stop button now checks whether the currently-running server job is actually this screen's
  clip before interrupting, with a confirm if it looks like someone else's
- Gallery clip metadata now records per-clip LoRA config (turbo + general slots) and actual
  render time; gallery "Reuse" restores a clip's full generation settings, not just the prompt
- Settings' "Avg minutes per clip" is now measured from past clips matching the current
  settings, instead of a fixed manual guess
- **MiniMax H3 pipeline axis redesign** (ported from ComfyUI-TJ_NODE_STUDIO_ONE v1.17.0) —
  replaced the single Acceleration dropdown + scattered attention/cache checkboxes with one
  control per patch layer (Turbo / Attention backend+forward / Block Cache / Spectrum / Model
  Patches), each shown as a collapsible section in the left panel; blocked combinations are
  greyed out with the reason shown inline instead of hidden. Fixes two silent no-op bugs found
  in the audit (H3 SLA Attention could silently overwrite Sage/SolAttn; MemEff Sage could
  silently disable whichever attention backend was selected). Adds the
  `MiniMaxH3FusedModulation` and `MiniMaxH3ScheduledSolAttentionPatch` nodes. Saved workflows
  migrate to the new axes automatically on load
- Free Text Encoder VRAM optimization for MiniMax H3 (`TJ_FreeTextEncoderVRAM`) — frees the
  text encoder right after conditioning is built, before the diffuse model needs full VRAM
- H3 FirstBlockCache detail settings (mode presets + custom threshold/window/hits/temporal
  guard), previously hardcoded
- Local ComfyUI port is now configurable (`?comfy_port=` URL override, `public/comfy_port.txt`,
  or `VITE_COMFY_PORT`) instead of a hardcoded 8188 — needed for running multiple ComfyUI
  installs side by side
- `install_comfyui_dependencies.bat` overhaul: rewritten fully in English, restructured to
  avoid a class of `cmd.exe` parenthesis-parsing bugs, now upgrades pip/setuptools/wheel and
  installs `wheel-stub` up front, retries a failed install with `--no-build-isolation`,
  re-checks/updates (`git pull`) already-cloned repos instead of skipping them outright, and
  adds the `ComfyUI-TJ_NODE` and `ComfyUI-PlagueKind-Nodes` dependencies that were missing

### Fixed
- Image gallery picker (used by MiniMax H3's frame/reference slots and the Ollama vision
  picker) defaulted to the first image tool's gallery instead of the INPUT tab
- Gallery hover-preview video was loading on touch-device taps due to synthesized mouseenter
  events, silently eating the tap meant for the info icon next to it

## [Unreleased] — 2026-08-18

### Added
- ComfyUI 서버 주소를 **접속 호스트에 따라 런타임에 자동 선택** (`shared/comfyBase.ts`) —
  `127.0.0.1`/`localhost`로 열면 항상 로컬 ComfyUI로 직접 연결, 그 외 도메인(터널 등)으로
  열면 `VITE_COMFY_URL`을 사용. 로컬 접속과 외부(모바일) 접속이 재시작·설정 전환 없이
  동시에 동작한다. 저장소가 public으로 전환됨에 따라 실제 `.env`는 gitignore 처리하고
  플레이스홀더 값의 `.env.example`만 커밋 (README에 외부 접속 설정 안내 추가)
- 이미지 도구 5종(Krea2/Z-Image/Klein/Qwen2511/SDXL) 갤러리의 Select 모드에 **→ FL2VA** /
  **→ REF2VA** 버튼 추가 — 선택한 결과 이미지를 MiniMax H3의 First/Last Frame 또는
  Reference 슬롯으로 보내고 해당 모드로 자동 전환
- 도구 간 공용 **갤러리 이미지 피커** (`shared/imageGalleryPicker.ts`) — 5개 이미지 도구의
  갤러리를 한 오버레이에서 상단 탭으로 넘나들며 볼 수 있음
- MiniMax H3와 5개 이미지 도구의 **모든 이미지 업로드 카드**에 갤러리 피커 버튼 추가 —
  로컬 업로드/드래그 외에 다른 도구의 갤러리에서 바로 소스 이미지를 선택 가능
- 이미지 업로드 카드에 현재 선택된 이미지를 지우는 **✕ 삭제 버튼** 추가 (기존에는
  MiniMax H3에만 있었음)
- ComfyUI 백엔드 의존성 자동 설치 배치 스크립트 (`install_comfyui_dependencies.bat`) —
  ComfyUI 설치 경로를 입력받아 `ComfyUI-TJ_NODE_STUDIO_ONE`과 필요한 의존 커스텀 노드
  전부를 설치(이미 설치된 항목은 스킵)

### Fixed
- 갤러리 피커에서 네이티브 `align-items: center` 중앙 정렬 flex 레이어와 스크롤 그리드가
  겹치며 썸네일이 얇게 눌려 보이던 버그 수정 (`min-height: 0` + `grid-auto-rows: min-content`)
- 프리뷰 브라우저 환경에서 네이티브 `confirm()`/`prompt()` 다이얼로그가 조용히 실패해
  Reset 버튼·갤러리 삭제·템플릿 삭제가 먹통이던 문제를 자체 오버레이 다이얼로그
  (`confirmDialog`/`promptDialog`)로 교체해 해결 (6개 도구 전체 영향)

### Changed
- 갤러리 이미지 피커 크기를 6열 그리드, 가로 1056px·세로 840px로 확대

## 2026-08-17

### Added
- **SDXL** 도구 포팅 — T2I/I2I/Inpaint/Outpaint/Upscale(ESRGAN·Refiner·SeedVR2), Checkpoint
  ↔ Separate(UNet+DualCLIP+VAE) 모델 로딩 전환, 옵션형 Refiner
- **Qwen Image Edit 2511** 도구 포팅 — 7개 모드(T2I/I2I/Edit/Inpaint·Outpaint/Faceswap/
  Angle/Upscale)와 3D 카메라 각도 인터랙티브 컨트롤(Angle 모드), Lightning LoRA
- **Flux2 Klein** 도구 포팅 — T2I/I2I/Edit/Inpaint+Outpaint/Faceswap/Upscale, KV Cache 토글
- **Z-Image Turbo** 도구 포팅 — Phase 1(T2I/I2I/Upscale) 이후 Phase 2로 Inpaint/RE-BG(→
  REDRAW-BG로 개명)/ControlNet/Face Redraw 모드 완성
- 상단 메뉴를 4개 카테고리로 재구성하고 랜딩 페이지 재설계
- `ComfyUI-TJ_NODE_STUDIO_ONE` 저장소 링크, `127.0.0.1:8774`에서 서비스

### Fixed
- 여러 도구에서 반복 발견된 **프롬프트 누수 버그** — 모드 전환 시 이전 모드의 프롬프트가
  새 모드로 새어 들어가던 문제 (Z-Image → Krea2에서 동일 근본 원인 확인 후 일괄 수정)
- 프롬프트 마이그레이션 로직이 리로드할 때마다 마지막으로 입력한 프롬프트를 계속
  재누출시키던 문제
- 프롬프트 템플릿 오버레이가 도구마다 동일한 사본을 보여주던 버그
- I2I/Identity 모드에서 Send-to 이후 W/H 필드가 512 플레이스홀더로 보이던 문제
- Re-BG 모드의 BG Removal Model 드롭다운이 채워지지 않던 문제
- Inpaint 마스크 브러시 커서가 십자선 대신 실제 브러시 크기의 원으로 보이도록 수정

## 초기 커밋 — 2026-08-17

- Vite + Vanilla TypeScript + Tailwind CSS 스캐폴딩, 해시 기반 라우팅
- 공용 UI 헬퍼(`shared/ui.ts`)와 갤러리 컴포넌트
- **MiniMax H3** 도구 포팅 — Text/First-Last(FL2VA)/Reference(REF2VA) 모드, 클립 릴레이 +
  자동 합본, LLM 프롬프트 보강 오버레이, Settings, 실시간 생성 큐 연동, 갤러리
- **Krea 2** 도구 포팅 — T2I/I2I/ControlNet/Identity/Upscale(SeedVR2)
