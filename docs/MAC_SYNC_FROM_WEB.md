# 웹 세션 → 맥 세션 전달 문서 (변경 기록과 맥 영향)

**쓰는 사람: 웹 세션(Windows PC)만.** 맥 세션은 이 파일을 **읽기만** 하고, 자기 진행 상황은 `macos/STATUS.md`에 씁니다
(한 파일에는 한 쪽만 써서 git 충돌을 피합니다).
PC가 다르므로 두 세션은 **git(GitHub `designloves2/AI-ONE-STUDIO`, 브랜치 `master`)으로만** 서로 상황을 전달합니다.
맥 앱 전체 명세는 `docs/MACOS_APP_SPEC.md`입니다.

## 1. 맥 세션이 매번 하는 순서
1. `git pull --rebase origin master`
2. `macos/STATUS.md`의 **"마지막으로 반영한 웹 커밋"** 을 확인한다.
3. 아래 **§4 변경 기록**에서 그 커밋보다 **새로 올라온 항목**을 위에서부터 읽는다. 항목마다 "맥 영향"이 있다(§3).
4. 영향이 `조치 필요`/`확인`인 항목만 작업한다. `없음`은 건너뛴다.
5. 작업이 끝나면 `macos/STATUS.md`를 갱신하고 `macos/` 안만 커밋·푸시한다(`git pull --rebase` 후 push).

## 2. 가장 중요한 사실: 웹 화면 변경은 맥을 다시 컴파일할 필요가 없다
맥 앱은 **Windows 서버가 내려 주는 화면을 창에 여는 껍데기**입니다(v1은 원격 전용). 그래서
- 웹 기능·버튼·설정·그래프 수정은 Windows 서버(`serve.mjs`)가 새 `dist`를 서빙하면 **맥에서도 바로 새 화면이 뜹니다.** 맥 재빌드 불필요.
- 맥을 다시 만들어야 하는 경우는 **맥 앱이 기대고 있는 약속(§3)** 이 바뀔 때뿐입니다.

## 3. 맥 앱이 기대는 약속 (이 목록이 바뀌면 "조치 필요")
| 약속 | 현재 값 | 어디서 확인 |
|---|---|---|
| 서버 식별 | `GET /aos/target` → 200 + JSON `{url: string, token: boolean}` | `serve.mjs` |
| 서버 기본 포트 | 8778 (`0.0.0.0`) | `serve.mjs`, `docs/DESKTOP_APP.md` |
| 같은 출처 | 웹앱은 자기 서버로만 `/prompt`, `/ws`, `/view` 등을 부른다(프록시 경로 목록 `comfy_paths.json`) | `serve.mjs`, `comfy_paths.json` |
| 웹소켓 | `/ws` (ws:// 또는 wss://) | `serve.mjs` |
| 연결 설정 파일 형식 | `{mode: local\|proxy\|remote, address, id, secret}` (맥은 `remote`만 씀) | `server-lib/connection.mjs` |
| 웹앱이 WKWebView에 요구하는 기능 | `alert/confirm/prompt`, `window.open(_blank)`, 파일 선택/다운로드, 전체 화면, `beforeunload` 닫기 확인(`src/shared/closeGuard.ts`), `localStorage`, (http 주소에서 막히는) `navigator.clipboard` | `docs/MACOS_APP_SPEC.md` §4.5 |
| ⇄ 버튼 모양·위치 | 오른쪽 아래 24px 원, `#7612DA`, 불투명도 .35 | `src-tauri/src/lib.rs`의 `SWITCH_JS` |
| 버전·릴리즈 이름 | 웹/Windows는 `vX.Y.Z`(package.json). 맥은 별도 트랙(아래 §5) | `docs/MACOS_APP_SPEC.md` §8 |

**맥 영향 등급**
- **없음**: 웹 화면/그래프/설정/문서만 바뀜. 맥 작업 없음, 재빌드 불필요.
- **확인**: 웹앱이 새로운 브라우저 기능을 쓰기 시작했을 수 있음(예: 새 `window.open`, 파일 저장 API, 새 전체 화면, 새 권한). 맥 앱에서 실제로 되는지 확인하고, 안 되면 §3 표와 명세를 갱신.
- **조치 필요**: 위 약속(경로·응답 형식·포트·설정 파일 형식)이 바뀜. 맥 코드 수정과 새 빌드가 필요.

## 4. 변경 기록 (최신이 맨 위, 웹 세션이 릴리즈/커밋마다 추가)
형식: `날짜 · 웹 버전 · 커밋 · 태그 · 요약 · 맥 영향`

- **2026-11-21 · (문서) · c13311f · 태그 없음** — `docs/MACOS_APP_SPEC.md` 맥 앱 작업 명세서 추가. 맥 영향: **조치 필요(시작점)** — 이 명세가 맥 작업의 출발점.
- **2026-11-25 · v0.24.0 · 릴리즈 커밋 · v0.24.0** — 노드 Moss I2I Depth / EDIT, 터보 LoRA(8개 이미지 도구), picker H3 탭 이식(웹 화면만, `serve.mjs`·`comfy_paths.json` 변경 없음). 맥 영향: **없음**(새 dist만 서빙하면 맥에도 바로 적용).
- **2026-11-25 · v0.23.1 · 릴리즈 커밋 · v0.23.1** — 이미지 도구 LLM 백엔드 기본값을 Connect Custom으로 변경(웹 화면만). 맥 영향: **없음**.
- **2026-11-22 · v0.23.0 · f2ab360 · v0.23.0** — 노드 v1.56.0 갤러리 도구(🧹 Tools: 정리 / 폴더 병합 / 휴지통) 이식(모든 갤러리 헤더), LTX 2.5 설정 OpenRouter 목록 수정. 서버에 노드 팩 v1.56.0 이상 + ComfyUI 재시작 필요. 맥 영향: **확인** — 맥 재빌드·새 릴리즈 불필요(화면은 서버가 내려 줌). 새로 쓰는 `confirm()`이 맥 앱에서 동작하는지만 확인. 상세: `docs/MAC_HANDOFF_GALLERY_TOOLS.md`.
- **2026-11-21 · (문서) · README 개정 · 태그 없음** — README에 "데스크톱 앱(Windows · macOS)" 절과 프로젝트 구조(serve.mjs, comfy_paths.json, server-lib, src-tauri, macos, scripts) 추가. 맥 영향: **없음**(맥 앱 설명 문구만. 맥 릴리즈 mac-v1.0.0·macos/STATUS.md 내용을 반영함).
- **2026-11-21 · (문서) · 983ba18 · 태그 없음** — 이 파일(`docs/MAC_SYNC_FROM_WEB.md`)과 `macos/STATUS.md` 추가, 명세 §8 수정(맥 앱 자체 버전, 릴리즈 `mac-vX.Y.Z` + `--latest=false`, 업데이트 피드 `macos/appcast.xml`). 맥 영향: **확인** — 맥 릴리즈·피드 방식이 명세 초안(c13311f)과 달라졌으니 최신 명세를 따를 것.
- **2026-11-18 · v0.22.4 · 99adc8d · v0.22.4** — 이미지 도구 LLM 설정의 OpenRouter 텍스트 모델이 되돌아가던 문제(`or_model` + `or_model_text` 같이 저장). 맥 영향: **없음**.
- **2026-11-18 · v0.22.3 · a4dcae7 · v0.22.3** — H3 이미지 LoRA 4개 적용, LLM 실시간 줄을 하단 중앙으로. 맥 영향: **없음**(화면 안의 위치만).
- **2026-11-18 · v0.22.2 · 6c1e104 · v0.22.2** — H3 이미지 LoRA 목록 문제 수정. 맥 영향: **없음**.
- **2026-11-18 · v0.22.1 · e5223a0 · v0.22.1** — Windows 앱에 로컬/원격 전환 버튼(⇄, ⌘/Ctrl+Shift+K), H3 이미지 갤러리 "Images / Video frames" 탭, 프리뷰 첫 프레임에 큐 배너 숨김. 맥 영향: **확인** — ⇄ 버튼·단축키는 Windows 앱(`src-tauri/src/lib.rs`) 동작을 **맥에서 같게 구현**해야 함(명세 §4.4). 갤러리 탭은 웹 화면이라 없음.
- **2026-11-18 · v0.22.0 · 79798f6 · v0.22.0** — 운영 서버 `serve.mjs`(8778), `comfy_paths.json`, 로컬/원격 연결 설정(`server-lib/connection.mjs`, `/aos/*` 경로), Windows 데스크톱 앱(Tauri), H3 설정 탭. 맥 영향: **조치 필요(기준선)** — 맥 앱이 기대는 약속(§3)이 처음 만들어진 버전. 맥은 이 버전 이상의 서버를 전제로 만든다.
- (v0.21.x 이전은 웹/노드 이식 기록이라 맥과 무관: 맥 영향 없음. 상세는 `CHANGELOG.md`.)

> **웹 세션 규칙**: 커밋/릴리즈를 할 때마다 위에 항목을 **한 줄** 추가한다(날짜·버전·커밋 해시·태그·요약·맥 영향). 맥 영향 판단이 어려우면 `확인`으로 쓴다. 약속(§3) 중 하나라도 건드렸으면 **조치 필요**로 쓰고 §3 표도 같이 고친다. 이 파일 수정은 해당 커밋에 같이 포함한다.

## 5. 릴리즈·업데이트 분리 (Windows와 맥이 서로 업데이트를 깨뜨리지 않게)
- Windows 앱의 자동 업데이트는 GitHub **"latest" 릴리즈**의 `latest.json`을 읽습니다. 맥 릴리즈가 "latest"가 되면 **Windows 업데이트 확인이 조용히 실패**합니다.
- 그래서 맥은 **별도 릴리즈 트랙**을 씁니다.
  - 태그: `mac-vX.Y.Z` (맥 앱 자체 버전, 웹 버전과 독립).
  - 릴리즈 생성은 반드시 `gh release create mac-vX.Y.Z --latest=false ...` (**latest로 만들지 않는다**).
  - 업데이트 피드(`appcast.xml`)는 릴리즈가 아니라 **저장소 파일** `macos/appcast.xml`에 두고 `SUFeedURL`을 `https://raw.githubusercontent.com/designloves2/AI-ONE-STUDIO/master/macos/appcast.xml`로 한다. dmg 주소는 `https://github.com/designloves2/AI-ONE-STUDIO/releases/download/mac-vX.Y.Z/<dmg 이름>`.
- 웹 세션은 웹 릴리즈(`vX.Y.Z`)를 만들 때 맥 릴리즈에 신경 쓰지 않아도 되고, 맥 세션은 웹 릴리즈를 만들거나 덮어쓰지 않는다.
- (이 결정으로 `docs/MACOS_APP_SPEC.md` §8을 같이 고쳤다.)

## 6. 맥이 컴파일하는 데 필요한 것
- 맥 앱은 **`macos/` 폴더의 Xcode 프로젝트만** 있으면 컴파일된다(웹 소스·Node가 필요 없음). 준비물은 Xcode, Sparkle(Swift Package), 서명용 인증서(명세 §8).
- 컴파일 확인 명령: `xcodebuild -project macos/AIOneStudio.xcodeproj -scheme AIOneStudio -configuration Debug build`
- 맥에서 웹앱을 직접 열어 보고 싶을 때(개발 확인용)만 `npm ci && npm run build && npm start`(Node 필요, 포트 8778) 또는 Windows 서버 주소로 접속한다.
- 맥 세션이 막히면(서버 응답이 이상함, 서버 변경이 필요함) 코드를 고치지 말고 `macos/STATUS.md`의 **"웹 세션에 요청"** 칸에 적는다. 웹 세션이 읽고 처리한다.
