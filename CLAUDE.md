# CLAUDE.md — AI ONE STUDIO (웹 쌍둥이) 인수인계

이 문서는 Claude가 아닌 모델(OpenRouter 경유 포함)이 이 저장소를 이어받아도 바로 일할 수 있게 쓴 안내입니다.
확실하지 않은 것은 "확인 필요"로 표시했습니다. 상세 내용은 아래 문서로 연결합니다.

## 1. 이 저장소의 역할
- **AI ONE STUDIO**(`AI-ONE-STUDIO`, 이 저장소): ComfyUI 위에서 도는 **독립 실행형 웹 프론트엔드**(Vite + TypeScript).
  샘플링·모델 로딩은 직접 하지 않고 이미 실행 중인 ComfyUI 서버를 호출만 합니다.
- 4개 저장소 관계:
  - `ComfyUI-TJ_NODE` — 메인 코어(업스트림).
  - `ComfyUI-TJ_NODE_STUDIO_ONE` — 원노드 방식(메인 코어 기반). **이 웹앱의 원본(기준)** 이고 서버 라우트(`nodes.py`)도 여기 있습니다.
  - `AI-ONE-STUDIO` — **이 저장소**. 원노드의 UI를 웹으로 1:1 옮긴 쌍둥이.
  - `AI-One-Studio-Canvers` — 원스튜디오 기반 웹앱(지능형 캔버스형). 이 저장소와 별개이며 경로는 확인 필요.
- 핵심 원칙: **노드와 웹은 기능·라벨·키·문구·순서가 같아야 합니다.** 달라도 되는 것은 화면 비율, 상단 메뉴, 폰 레이아웃뿐.
  새 기능은 항상 노드 소스를 읽고 그대로 옮깁니다(추측 금지).
- 경로(이 PC): 웹 `C:\AI\AI_One_Studio`, 노드 `C:\AI\ComfyUI-Easy-Install\ComfyUI\custom_nodes\ComfyUI-TJ_NODE_STUDIO_ONE`,
  업스트림 `...\custom_nodes\ComfyUI-TJ_NODE`.

## 2. 먼저 읽을 문서 (순서대로)
1. `README.md`, `NOTICE.md`, `LICENSE` — 개요와 라이선스.
2. `PORT_LEDGER.md` — 노드↔웹 변경 장부(행 번호순, 최신은 맨 끝). **무엇이 이식됐는지의 기준.**
3. `CHANGELOG.md` — 버전별 변경(최신이 맨 위).
4. `docs/SPEC_AI_ONE_STUDIO_WEBSITE.md` — 웹앱 전체 명세. 이어서 `docs/SPEC_MINIMAX_H3_*.md`, `docs/SPEC_CLIP_METADATA_REUSE.md`,
   `docs/SPEC_GALLERY_UPSCALE_INTERPOLATE.md`, `docs/SPEC_PROMPT_TEMPLATE_SYNC.md` (필요한 기능만).
5. 노드 쪽 명세: 노드 저장소 루트의 `SPEC_RELAY_V1_xx_x.md`(버전별 이식 지시서) — 이 저장소 밖에 있음.
6. `docs/HEADLESS_HANDOFF.md` — 서버용 `*-headless/` CLI 패키지 안내(웹앱 본체와는 별개).
7. `docs/ONE_SHOT_INSTALL.md` — 새 PC에 ComfyUI+노드+웹앱을 설치하는 절차(AI에게 붙여넣는 방식).

## 3. 디렉터리 구조
- `src/main.ts`, `src/router.ts` — 진입점과 라우팅(해시 `#krea2` 식). `src/landing/` 첫 화면, `src/gallery/` 갤러리.
- `src/identity.ts` — 공통 색/브랜드(`BRAND`, `C`).
- `src/tools/<tool>/` — 도구별 폴더: `core.ts`(상태·기본값·헬퍼), `view.ts`(화면), `api.ts`/`comfyClient.ts`(서버 호출),
  `graphBuilder.ts`(ComfyUI 그래프), `settings.ts`, `galleryOverlay.ts` 등. 도구: `minimax_h3`(기준 모델), `ltx25`, `music`,
  `krea2`, `zimage`, `klein`, `qwen21`, `qwen2511`, `sdxl`, `anima`, `moss`, `itda`.
- `src/shared/` — 도구 공용 모듈: `promptEditPopup.ts`(이미지 도구 Prompt Edit), `bilingual*.ts`·`translateConfig.ts`·`koSetting.ts`
  (한/영 토글과 번역), `llmSettings*.ts`·`llmBackendPanel.ts`(LLM 설정), `settingsTabs.ts`, `galleryLayout.ts`(Grid/Masonry),
  `leftResize.ts`, `livePreview.ts`, `comfyBase.ts`(서버 주소) 등.
- `*-headless/` — 의존성 없는 Node CLI(Hermes 에이전트용). `vite.config.ts` — 개발 서버와 ComfyUI 프록시 경로 목록.
- `dist/`, `node_modules/`, `graphify-out/`는 생성물(커밋 안 함).

## 4. 실행·빌드 (package.json 확인됨)
- 설치: `npm install`
- 개발 서버: `npm run dev` → http://127.0.0.1:8774 (Windows는 `ai-one-studio-run.bat`이 ComfyUI 대기 후 브라우저를 엽니다).
- 타입 검사: `npx tsc --noEmit -p .` (**이 저장소의 사실상 유일한 자동 검사**. 자동 테스트 스크립트는 없음).
- 빌드: `npm run build` (= `tsc && vite build`).
- ComfyUI 서버 주소: `VITE_COMFY_PORT` 환경변수 > `public/comfy_port.txt` > 8188. `.env`는 커밋하지 않고 `.env.example`만 커밋합니다.
- 새 라우트를 쓰면 `vite.config.ts`의 프록시 경로 목록(`comfyPaths`)에 추가해야 합니다.

## 5. 코딩 규칙 (저장소에서 이미 지키는 것)
- 채팅·보고는 한국어, **코드·UI 문구·스크립트는 영어**(예외: 번역 안내문 등 노드와 같은 한국어 문구는 그대로).
- 한/영 이중 입력: 칸의 영어 값이 모델에 가는 값, `<key>Ko` / `<key>Newest` / `<key>View`가 한국어 보기. 새 프롬프트 칸은
  `attachBilingual`로 감싸고, 저장 상태 기본값에 `bilingualSlots(...)`를 넣어야 새로고침해도 한국어 칸이 남습니다. 자세한 구조는 `src/shared/bilingual.ts` 머리 주석.
- 도구 상태는 `core.ts`의 `defaultState(saved)`에 **키를 추가하지 않으면 저장되지 않습니다**(화이트리스트 방식).
- 모바일(≤767px) 레이아웃은 기능과 같은 작업에서 같이 만듭니다.
- 파일 인코딩: 한글·특수문자가 있는 파일을 PowerShell `Set-Content`/`Out-File`로 쓰면 깨집니다. 편집 도구나 BOM 없는 UTF-8로 쓸 것. 줄바꿈은 기존 파일(CRLF/LF)을 유지.
- 버전: `package.json`의 `version`(semver). 기능 이식 = minor, 수정 = patch. 올릴 때 `npm version X.Y.Z --no-git-tag-version`.
- CHANGELOG: 새 버전을 맨 위에 `## [X.Y.Z] — YYYY-MM-DD` + `### Added/Changed/Fixed`. 노드 이식이면 `PORT_LEDGER.md` 행 번호를 적습니다.
- 커밋 메시지: `release vX.Y.Z: <요약>` (릴리즈), `fix(영역): ...`, `feat(영역): ...`. 끝에 `Co-Authored-By: <모델 이름> <noreply@anthropic.com>` 줄(Claude 사용 시).
- 릴리즈 절차: CHANGELOG + PORT_LEDGER + 버전 → 커밋 → 주석 태그 `vX.Y.Z` → `git push origin master vX.Y.Z` → `git ls-remote --tags origin vX.Y.Z`로 확인.

## 6. 하지 말 것
- **노드 저장소(`ComfyUI-TJ_NODE_STUDIO_ONE`)와 `nodes.py`를 이 작업에서 고치지 않습니다.** 서버 쪽 변경은 노드 세션의 일입니다.
- 서버의 공용 설정 값(`config_*.json`의 모델·mmproj 등)은 사용자가 손으로 고른 값입니다. 추측해서 쓰거나 덮어쓰지 말고, 원인이 불분명하면 먼저 보고.
  설정 화면을 시험하다 바꿨다면 원래 값으로 되돌리세요.
- 브라우저 `localStorage`의 `aos_sensitive_media_v1`은 테스트 코드에서 쓰거나 지우지 않습니다.
- 라이선스: 오픈소스가 아닙니다. 코드 복사·재배포는 허가 필요(`NOTICE.md`). 이 저장소를 참고해 **다른 프로젝트를 만들 때는 코드를 그대로 옮기지 말고 새로 작성**.
- GPU는 공유 16GB입니다. 사용자가 서버가 비었다고 하기 전에는 렌더/LLM 시험 작업을 돌리지 않습니다. 렌더 중 ComfyUI 재시작 금지(`GET /queue`가 비어 있을 때만 재시작 가능).
- 다른 세션(예: Canvers)을 돕는 경우 **조언만** 하고 그쪽 파일을 고치지 않습니다.
- `.claude/worktrees/`는 건드리지 않습니다.

## 7. 다른 저장소와의 연동
- 서버 라우트는 노드의 `nodes.py`가 제공합니다(`/minimax_h3_one/*`, `/tj_shared/*`, `/tj_studio_one/*` 등). 노드가 라우트·설정 키를 바꾸면 웹의
  `api.ts`, `vite.config.ts`, 해당 `defaultState`를 같이 확인해야 합니다. 서버 변경은 ComfyUI 재시작 후 적용.
- 노드가 새 버전을 내면 `SPEC_RELAY_V1_xx_x.md`가 이식 지시서입니다. 노드 소스(`web/*.js`)를 grep해서 라벨·키·순서·문구를 그대로 옮기고 `PORT_LEDGER.md`에 행 추가.
- 웹에서 찾은 노드 버그는 노드 세션에 보고(`PORT_LEDGER.md`의 `web→node`).
- Canvers는 카드/그래프 방식이라 같은 기능이 그대로 대응하지 않습니다(번역 토글 등은 매핑을 따로 제안). 웹이 쓰는 갤러리·썸네일 방식 등 공유 지식은 조언으로 전달.
- 업스트림 `ComfyUI-TJ_NODE`의 변경은 `PORT_LEDGER.md`의 "Upstream" 구역 참고.

## 8. 현재 진행 상황 (2026-10-28 기준)
- 최신 릴리즈 **v0.18.5**. 최근 흐름: v0.14.x 노드 v1.47/1.48(7+1 업스케일, Latent Upscale 분할 모드) → v0.15.0 노드 v1.49.0
  (KO/EN 토글, Translation LLM, Merge clips, Prompt Write 메뉴) → v0.15.1 번역 중 표시 → v0.15.2 노드 v1.49.2(번역 on/off, 설정 탭)
  → v0.15.3 OpenRouter 모델 비었을 때 안내. 각 항목은 `PORT_LEDGER.md` 행 65~73.
- 2026-11-13 (미릴리즈, 버전/태그 없음): 노드 미커밋 작업 3가지를 웹으로 이식 완료 — [1] ReCaVSR·RelayVSR 업스케일(행 86), [2] H3 Image Generator 공식 노드 T2I/R2I + Generate 버튼 버그 수정(행 87), [3] ComfyUI 네이티브 Generate Text 옵션(행 88, `src/shared/nativeLlmOpts.ts`). 웹 설치 배치에 웹이 쓰는 팩 5개 추가. 스튜디오 세션 지시: 웹 버전업·릴리즈·태그는 사용자에게 먼저 확인(커밋만 했고 push 전).
- 2026-11-08 v0.18.5: LTX 2.5 Resize 설정 9개와 `saveUnprocessed`가 새로고침하면 사라지던 문제 수정(`defaultState` 허용 목록에 없었음, 노드 a74267c). 화면이 `state.x =`로 쓰는 키는 반드시 해당 도구 `core.ts`의 `defaultState`에도 넣을 것. `PORT_LEDGER.md` 행 85.
- 2026-11-08 v0.18.4: (웹 전용, 사용자 요청) Split Sigma Final MP가 Start MP보다 작으면 Start MP로 올림(`hiresMp()`), FlashVSR 시드 0 = 랜덤(LTX·H3). 노드는 그대로라 노드와 차이가 생김 — 노드 세션에 알림. `PORT_LEDGER.md` 행 84. 실제 렌더는 미검증.
- 2026-11-08 v0.18.3: LAN 주소(http)로 열면 앱이 시작 못 하던 문제 수정 — `crypto.randomUUID()`는 보안 컨텍스트에서만 있음. 새 코드는 `src/shared/uuid.ts`의 `uuid()`를 쓸 것. `PORT_LEDGER.md` 행 83. 실제 다른 PC에서의 접속은 미검증.
- 2026-11-08 v0.18.2: 전체 점검 — 버그 3건 수정(도구 화면을 다시 열 때마다 큐 감시 타이머가 쌓임: `src/shared/viewScope.ts`, 인용문 속 `@태그` 번역 실패: `bilingual.ts`, LLM 줄이 안 사라질 수 있음: `llmLive.ts`). `PORT_LEDGER.md` 행 82. 새 화면 코드에서 `setInterval`/`document.addEventListener`를 직접 쓰지 말고 `viewInterval`/`viewListener`를 쓸 것(라우터가 화면을 다시 그리므로).
- 2026-11-03 v0.18.1: 이미지 도구 8종의 원본 이미지 칸 — 404 확인 중에 이미지를 바꾸면 새 이미지가 지워지던 버그 수정(노드 8898422, `PORT_LEDGER.md` 행 81). 경쟁 상황 자체는 미검증.
- 2026-11-03 v0.18.0: LLM 실시간 줄(화면 왼쪽 아래) 추가 — `src/shared/llmLive.ts`, `tj_llm_progress` + 웹이 직접 큐에 넣는 TextGenerate 그래프. `PORT_LEDGER.md` 행 80(행 79 정정). 로컬 GGUF 실제 호출로 줄(입력 읽는 중 -> 쓰는 중 토큰 수 -> 완료) 확인함. OpenRouter/Custom·네이티브 TextGenerate 그래프 실제 실행은 미검증.
- 2026-11-03: 노드 e0f4075(LLM 라우트 `tj_llm_progress`/`call_id`/`usage`) 확인 — 서버만 바뀜, 웹 변경 없음(`PORT_LEDGER.md` 행 79). 웹에 `~토큰` 표시를 넣으려면 노드에 없는 UI라 표시 위치 결정이 먼저 필요.
- 2026-11-03 v0.17.1: 설치 배치 `install_comfyui_dependencies.bat`에 Tiled 팩 추가(REPOS[26], ALT[26]), 설치 안내 문서 갱신. `PORT_LEDGER.md` 행 78(행 77의 "웹에 설치 목록 없음" 정정). 배치 실행은 미검증. 웹 배치는 노드의 목록(29번까지)보다 짧음 — 이번 지시 범위 밖.
- 2026-11-03 v0.17.0: H3 업스케일러 B를 Kimchy -> 자체 포크 "H3 Latent Upscale Tiled (TJ)"로 교체(노드 id `TJLatentUpscaleTiledMP`, 값 `tiled`, 키 `hiresTiled*`/`ppH3TiledFinalMp`, 옛 저장값·프리셋·클립 메타 자동 변환). `PORT_LEDGER.md` 행 77. 실제 렌더와 새 팩은 미검증.
- 2026-11-03 v0.16.2: Split Sigma 설명 블록을 체크박스 옆 `?` 툴팁으로 교체(노드 반영). `PORT_LEDGER.md` 행 76.
- 2026-11-03 v0.16.1: 노드 885bf51 이식(Split Sigma 칸 = LOW Sigma step, 그 아래 읽기 전용 HIGH Sigma 줄, 크기 줄은 크기만). `PORT_LEDGER.md` 행 75. 실제 렌더는 미검증.
- 2026-11-03 v0.16.0: 노드 e5fbdd0 이식(H3 "7+1" -> Split Sigma 이름 변경, Latent Upscaler 분할 스텝 입력 `hiresSplitStep` 1~7, 업스케일 배너). `PORT_LEDGER.md` 행 74. 실제 렌더(분할 스텝 < 7)와 실행 중 배너는 미검증.
- **직접 검증 못 한 것**(GPU 작업이 필요해서): 실제 분할 렌더/조각 재연결, 실제 Long Shot·One-Take Write, 실제 Refine 결과 창,
  "한글 번역 사용"을 끈 채 실제 Generate, 프롬프트 세트의 한국어 저장/불러오기 왕복(서버 재시작 필요), Charsheet 헤더 버튼 화면 확인.
- 미완료/다음 할 일: 노드의 다음 `SPEC_RELAY_*`가 오면 이식. 구체적인 대기 작업 목록 파일은 없음(확인 필요).
- 2026-10-29: 사용자 지시로 이 세션이 **Canvers 저장소**(`C:\AI\AI-One-Studio-Canvers`)에 Director Mode(모드 3개: Director / Canvas / Simple)를 만드는 중. 이 웹 저장소 코드는 바뀌지 않음. 설계·진행·미검증 목록은 Canvers의 `CLAUDE.md` 8절과 `docs/DIRECTOR_MODE_IMPLEMENTATION_PLAN.md`에 있음(기능이 끝날 때마다 커밋 + 인수인계 갱신, 최신 커밋 c5e96be). 인계받는 모델은 그쪽 `CLAUDE.md`부터 읽을 것.

## 9. 작업을 끝낼 때 갱신할 것
1. `CHANGELOG.md`(새 버전 항목)  2. `PORT_LEDGER.md`(새 행: 무엇을, 어떻게 확인했고 무엇은 못 했는지)  3. `package.json` 버전
4. **커밋/푸시/릴리즈/버전업을 할 때마다 이 `CLAUDE.md`를 반드시 갱신해 같은 커밋에 포함**(특히 8절: 최신 버전, 최근 작업, 미검증 항목, 다음 할 일; 낡은 구조·명령·규칙도 함께)  5. `npx tsc --noEmit -p .` 통과 확인 후 커밋·태그·push.
- 보고는 쉬운 말로: 끝남/안 끝남, 되는 것/안 되는 것, **확인한 것과 확인 못 한 것을 구분**.

## 10. Claude Code 전용 기능에 기대는 부분 (다른 모델은 무시해도 됨)
- `.claude/skills/`(`hermes-job-json`, `ltx25prompt`, `minimax-h3-prompt`, `studio-image-prompt`): 프롬프트·job.json 작성용 스킬. 같은 규칙은 해당 폴더의 `SKILL.md`를 일반 문서처럼 읽으면 됩니다.
- `.claude/launch.json`: 미리보기 도구용 개발 서버 설정(`npm run dev`, 포트 8774)일 뿐, 수동으로 같은 명령을 실행하면 됩니다.
- 메모리 파일/세션 간 메시지(`TJ_STUDIO_ONE-10월` 등 다른 Claude 세션과의 지시 전달)는 Claude 환경 기능입니다. 지시는 위 `SPEC_RELAY_*` 문서와 `PORT_LEDGER.md`로 대체 가능.
