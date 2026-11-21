# macOS 앱 작업 명세서 (Xcode / Swift + WKWebView) — 맥 세션 전달용

작성: 웹 세션, 2026-11-21. 대상 독자: 이 저장소를 받아 **맥에서 Xcode로 앱을 만드는 세션/사람**.
이 문서는 만들 것·만들지 않을 것·확인 방법까지 적은 명세입니다. 추측으로 채운 부분은 "확인 필요"로 표시했습니다.

> 두 PC(웹/Windows, 맥)의 상황 전달 방식: **`docs/MAC_SYNC_FROM_WEB.md`**(웹 세션이 쓰는 변경 기록·맥 영향) ↔ **`macos/STATUS.md`**(맥 세션이 쓰는 진행 상황). 반드시 먼저 읽을 것.

## 0. 한 줄 요약
Windows 앱(`docs/DESKTOP_APP.md`, Tauri/Rust)과 **같은 웹앱을 한 줄도 바꾸지 않고**, macOS에서는 **Swift + WKWebView 네이티브 껍데기**로 감쌉니다.
맥 앱은 **원격 접속이 기본**입니다: 백엔드(ComfyUI + AI ONE STUDIO 서버 `serve.mjs`)는 **Windows PC**에서 돌고, 맥 앱은 그 주소를 창에 엽니다.
맥 안에서 서버를 직접 띄우는 "로컬 모드"는 v1 범위에서 뺍니다(§9에 2단계로 적어 둠).

## 1. 목표와 하지 않을 것
**목표**
1. 맥에서 아이콘을 눌러 켜면 AI ONE STUDIO 화면이 앱 창으로 열린다(브라우저 주소창 없이).
2. 처음 한 번 Windows 서버 주소를 넣으면 저장되고, 다음부터 자동 연결된다.
3. 주소를 바꾸거나 연결을 다시 고르는 길이 항상 있다(메뉴 + 화면 구석 버튼).
4. 로그인이 필요한 주소(Cloudflare Access 등)도 앱 창 안에서 로그인해서 쓸 수 있다.
5. 서명·공증된 `.dmg`와 자동 업데이트(Sparkle)를 GitHub 릴리즈로 배포한다.

**하지 않을 것 (v1)**
- 웹앱 코드(`src/`) 수정. 맥 때문에 웹앱을 고쳐야 하는 일이 생기면 먼저 웹 세션에 보고(§11).
- 맥 안에서 Node/`serve.mjs`/ComfyUI 실행(로컬 모드), 맥에서 렌더. 맥은 **화면만** 담당합니다.
- App Store 배포, App Sandbox 강제(Developer ID 직접 배포 기준, §8).
- Windows 쪽 파일(`src-tauri/`, `serve.mjs` 등) 수정. 서버 쪽 변경이 필요하면 웹 세션 일입니다(§10).

## 2. 이미 있는 것 (Windows 쪽, 그대로 재사용)
| 항목 | 내용 |
|---|---|
| 서버 | `serve.mjs`(Node). `dist/` 서빙 + ComfyUI 프록시(`comfy_paths.json`) + `/ws` 웹소켓 중계. 기본 포트 **8778**, `0.0.0.0` 바인딩. 요청 시간 제한 없음(긴 LLM·렌더 호출 대비). |
| 서버 식별 | `GET /aos/target` → `{"url": "<ComfyUI 주소>", "token": false}` 이면 "AI ONE STUDIO 서버". 연결 확인에 씁니다. |
| 연결 설정 파일 형식 | `connection.json` = `{mode: local\|proxy\|remote, address, id, secret}`. 맥 앱은 `mode: "remote"`만 씁니다. |
| 같은 출처 | 웹앱은 자기 서버(같은 출처)로만 `/prompt`, `/ws` 등을 부릅니다. 그래서 **창이 서버 주소를 직접 열면** 별도 설정이 필요 없습니다. |
| Windows 앱 동작 참고 | `src-tauri/src/lib.rs`(메뉴·⇄ 버튼·단축키), `server-lib/connection.mjs`(주소 알아보기 규칙, 화면 문구). 규칙은 맥에서도 같게 맞춥니다. |

## 3. 구조
```
macos/
  AIOneStudio.xcodeproj
  AIOneStudio/
    AIOneStudioApp.swift        앱 진입점, 메뉴(Commands), 창 설정
    ConnectionStore.swift       연결 설정 저장/읽기 (Application Support/connection.json)
    ConnectionProbe.swift       주소 정규화 + 서버 확인(URLSession)
    ConnectView.swift           SwiftUI 연결 화면 (처음 실행·메뉴로 다시 열기)
    WebContainer.swift          NSViewRepresentable WKWebView + 델리게이트들
    SwitchButtonScript.swift    ⇄ 버튼 주입용 JS 문자열(WKUserScript)
    Updater.swift               Sparkle 2 연결
  appcast.xml                   Sparkle 업데이트 피드(저장소 파일, 릴리즈 아님)
  STATUS.md                     맥 세션이 쓰는 진행 상황(웹 세션은 읽기만)
    Info.plist / AIOneStudio.entitlements
  scripts/
    (맥 앱 버전은 웹 버전과 독립: Xcode의 MARKETING_VERSION을 직접 올린다)
    release-mac.sh              빌드 → 서명 → 공증 → dmg → appcast.xml 갱신 → `mac-vX.Y.Z` 릴리즈(latest 아님)
```
- 번들 ID: `cloud.tjtj.aionestudio` (Windows와 같은 식별자). 앱 이름 `AI ONE STUDIO`.
- 최소 macOS **13 (Ventura)**, Apple Silicon + Intel 유니버설. (`isInspectable`가 13.3+라 디버그에서만 `#available`로 감쌉니다.)
- 외부 의존성은 **Sparkle 2** 하나(Swift Package Manager). 그 외 서드파티 금지.

## 4. 동작 명세

### 4.1 시작 흐름
1. 시작 시 `Application Support/cloud.tjtj.aionestudio/connection.json`을 읽는다.
2. 파일이 없다 → **연결 화면(ConnectView)** 표시.
3. 있다(`mode: remote`) → `GET <address>/aos/target`로 3초 안에 확인(§4.3).
   - 성공 → WKWebView가 `<address>/`를 연다.
   - 실패 → 창에 "서버에 연결하지 못했습니다" 화면 + **[다시 시도] [연결 설정…]** 두 버튼(자동으로 연결 화면으로 넘기지 않음: 서버가 켜지는 중일 수 있음).
4. 연결 화면과 웹앱은 **같은 창**을 번갈아 씁니다(창 여러 개 금지, 단일 창).

### 4.2 연결 화면 (ConnectView)
- 제목 "AI ONE STUDIO", 설명 "Windows 서버(백엔드)가 어디에 있나요?"
- 입력칸 1개: **접속 주소** (도메인 · 터널 주소 · IP:포트). 예시 placeholder: `studio.example.com / 192.168.0.20:8778`.
- 저장된 주소가 있으면 미리 채운다. [연결] 버튼 + Enter.
- 로컬(이 Mac) 선택지는 **표시하지 않는다**(v1). 문구에 "이 Mac에는 서버가 필요 없습니다. 렌더는 Windows PC에서 돌아갑니다."를 작게 안내.
- 결과 줄(진행/오류)을 입력칸 아래에 표시. 한국어/영어는 **시스템 언어**를 따른다(`Locale`), 문구는 `connection.mjs`의 `MSG` 표와 같은 뜻으로.

### 4.3 주소 알아보기 (ConnectionProbe)
`server-lib/connection.mjs`의 `normalize`/`probe`와 **같은 규칙**을 Swift로 옮긴다.
- **정규화**: 앞뒤 공백·끝 `/` 제거. `http(s)://`가 없으면, `localhost`·`127.`·`10.`·`192.168.`·`172.16–31.`·`.local`이면 `http://`, 그 외엔 `https://`를 붙인다. 결과는 origin(스킴+호스트+포트)만 저장.
- **확인 순서**
  1. `GET {origin}/aos/target` (리다이렉트 따라가지 않음, 8초 제한, 요청 헤더 없음).
     - 200이고 JSON에 문자열 `url`이 있으면 → **AI ONE STUDIO 서버** → 저장하고 창이 연다.
     - 401/403이거나 `Location`에 `cloudflareaccess|/cdn-cgi/access|login|signin`이 있으면 → **로그인 벽** → 저장하고 창이 그 주소를 열어 사용자가 로그인하게 한다.
  2. 그 외 → "AI ONE STUDIO 서버가 아닙니다 (응답 N 또는 오류 코드)" 표시, 저장하지 않음.
- **ComfyUI 직접 주소(`/system_stats`만 응답하는 주소)는 v1에서 지원하지 않는다.** 이유: 맥에는 프록시(`serve.mjs`)가 없어서 웹앱이 같은 출처로 ComfyUI를 부를 수 없다. 이 경우 "이 주소는 ComfyUI입니다. 맥 앱은 AI ONE STUDIO 서버 주소(Windows PC에서 `serve.mjs` 실행)가 필요합니다"라고 안내.
- 서비스 토큰(Cloudflare `CF-Access-Client-Id/Secret`)은 v1 범위에서 **뺀다**(§7 한계 참고). 로그인 벽은 창 안 로그인으로만 처리.

### 4.4 메뉴·단축키·버튼 (Windows 앱과 같은 위치/키)
- 메뉴 **연결** → **연결 설정… (로컬 / 원격)**, 단축키 **⌘⇧K**. 항목 문구는 "연결 설정…" 으로 두되 "(로컬 / 원격)"은 뺀다(로컬이 없으므로).
- 메뉴 **보기** → 다시 불러오기 **⌘R**, 강제 새로 고침(캐시 무시) **⌘⇧R**, 전체 화면 **⌃⌘F**, 확대/축소 **⌘+ / ⌘- / ⌘0**(WKWebView `pageZoom`).
- 메뉴 **앱 이름** → 정보, 업데이트 확인…(Sparkle), 종료 **⌘Q**.
- **⇄ 버튼**: 모든 페이지(연결 화면 제외) **오른쪽 아래**, 24px 원, 배경 `#7612DA`, 평소 불투명도 .35, 마우스를 올리면 1. 클릭하면 네이티브 연결 화면으로 간다.
  - 구현: `WKUserScript`(injectionTime `.atDocumentEnd`, 메인 프레임만)로 `<a id="aos-switch">`를 body에 붙이되, 링크는 `aos-native://connect` 같은 **커스텀 스킴**으로 하고, `WKNavigationDelegate`가 그 스킴을 가로채 연결 화면으로 전환(웹 서버 주소에 의존하지 않음).
  - Windows 앱의 `SWITCH_JS`(`src-tauri/src/lib.rs`)와 같은 모양·위치. Canvers 앱은 캔버스 컨트롤 때문에 왼쪽 아래로 옮겼음 — 웹은 오른쪽 아래 유지, 겹치면 §11로 보고.

### 4.5 WKWebView가 알아서 안 해 주는 것 (반드시 구현)
웹앱이 실제로 쓰는 기능 기준입니다(저장소 `src/`를 grep해서 확인한 것).
| 웹앱이 쓰는 것 | 맥 앱에서 할 일 |
|---|---|
| `alert()` / `confirm()` / `prompt()` (도구 화면·Prompt Edit 등 100곳 이상) | `WKUIDelegate`의 `runJavaScriptAlertPanel` / `ConfirmPanel` / `TextInputPanel`을 구현해 `NSAlert`로 표시. **구현하지 않으면 모두 조용히 무시되어 기능이 멈춘다.** |
| `window.open(url, "_blank")` (H3 결과 열기 등) | `createWebViewWith`에서 새 창을 만들지 말고 **같은 서버 도메인이면 현재 창에서 열기, 외부 도메인이면 기본 브라우저(`NSWorkspace`)로 열기**. 로그인 팝업은 같은 창 안에서 처리. |
| 파일 업로드(`<input type=file>`, 이미지/영상/오디오 선택) | `runOpenPanel`로 `NSOpenPanel` 표시(다중 선택 허용 여부는 `parameters.allowsMultipleSelection`). |
| 파일 저장/다운로드(`<a download>`, 영상·이미지·zip) | `WKDownloadDelegate`로 저장 위치 선택(`NSSavePanel`) 또는 `~/Downloads`에 저장 후 Finder에서 표시. |
| 영상/오디오 재생(`<video>`, 갤러리·미리보기) | `mediaTypesRequiringUserActionForPlayback = []` 설정, `allowsInlineMediaPlayback`. 큰 mp4 **Range 요청**이 서버로 그대로 가는지 확인. |
| 전체 화면(`element.requestFullscreen()`, 영상·미리보기 ⛶) | `WKWebViewConfiguration.preferences.isElementFullscreenEnabled = true` (macOS 12.3+). |
| `beforeunload` 닫기 확인(`src/shared/closeGuard.ts`, 상단 "Warn on close" 체크) | WKWebView는 창 닫을 때 `beforeunload`를 띄우지 않는다. `NSWindowDelegate.windowShouldClose`에서 `evaluateJavaScript`로 웹앱의 닫기 가드 상태를 읽고, 켜져 있으면 `NSAlert`로 확인. 읽는 방법(전역 함수/플래그)은 `closeGuard.ts`를 읽고 맞출 것(**확인 필요**). |
| `navigator.clipboard`(복사 버튼) | 보안 컨텍스트에서만 동작. 서버 주소가 **http://IP**면 막힌다 → 가능하면 **https 도메인(터널)** 사용을 안내(§7). 막힐 때를 위한 대체(`document.execCommand("copy")`)는 웹앱이 이미 쓰는지 확인(**확인 필요**). |
| 웹소켓 `/ws`(진행률, 라이브 프리뷰 프레임) | 같은 출처 `ws://` 또는 `wss://`. http 서버면 ATS 예외 필요(§6). |
| `localStorage`(설정·프리셋·갤러리 데이터) | `WKWebsiteDataStore.default()` 사용(영구 저장). **저장소는 출처(주소)별**이라 서버 주소가 바뀌면 이전 설정이 보이지 않는다 → 연결 화면에 "주소를 바꾸면 저장된 설정이 따로 보입니다" 안내. 데이터 삭제 메뉴는 v1에 넣지 않음. |
| 외부 링크(`https://…`) | 서버 도메인이 아니면 기본 브라우저로. |

## 5. 저장 위치
- 연결 설정: `~/Library/Application Support/cloud.tjtj.aionestudio/connection.json` (`{mode:"remote", address:"https://..."}`), 파일 권한 0600. 비밀번호/토큰은 v1에서 저장하지 않음.
- WebView 데이터(쿠키·localStorage): WKWebsiteDataStore 기본 위치(앱 컨테이너 밖 `~/Library/WebKit/<bundle id>/`).
- 로그: `os.Logger`(subsystem `cloud.tjtj.aionestudio`). 주소·토큰 같은 값은 로그에 남기지 않는다.

## 6. 보안·권한 설정 (Info.plist / entitlements)
- **ATS(App Transport Security)**: 사용자가 `http://192.168.x.x:8778` 같은 LAN 주소를 쓰는 경우가 있으므로 WKWebView 콘텐츠에 한해 허용:
  `NSAppTransportSecurity` → `NSAllowsArbitraryLoadsInWebContent = YES`, `NSAllowsLocalNetworking = YES`. (`NSAllowsArbitraryLoads` 전체 허용은 쓰지 말 것.) URLSession으로 하는 연결 확인(§4.3)은 웹 콘텐츠가 아니므로 `http://` LAN 주소 확인을 위해 `NSAllowsLocalNetworking`으로 충분한지 시험해서 안 되면 도메인 단위 예외(**확인 필요**).
- **로컬 네트워크 권한**(macOS 15+): `NSLocalNetworkUsageDescription` = "같은 네트워크의 Windows PC에서 돌아가는 AI ONE STUDIO 서버에 연결합니다." 처음 LAN 주소로 접속할 때 시스템 팝업이 뜬다. 거부하면 접속이 실패하므로, 실패 화면에 "시스템 설정 → 개인정보 보호 및 보안 → 로컬 네트워크에서 AI ONE STUDIO를 허용" 안내를 넣는다.
- **entitlements**(Developer ID 배포, 샌드박스 없음): Hardened Runtime 켬. `com.apple.security.network.client`(샌드박스를 켤 때만 필요하지만 명시해 둠). 파일 열기/저장은 `NSOpenPanel`/`NSSavePanel`이라 별도 권한 불필요. 카메라·마이크·위치는 **쓰지 않음**.
- 외부 주소 열기는 `https://`·`http://`만 허용(`file:`, 사용자 정의 스킴은 `aos-native://` 하나만 내부 처리, 나머지는 거부).
- 개발자 도구: 디버그 빌드에서만 `webView.isInspectable = true`.

## 7. 알려진 한계 (정직하게 문서화할 것)
1. **서비스 토큰 헤더 미지원(v1)**: WKWebView는 모든 요청(서브리소스·웹소켓)에 임의 헤더를 붙일 수 없다. Cloudflare Access는 **창 안 로그인(쿠키)** 으로만 지원. 토큰이 꼭 필요하면 2단계(§9)에서 로컬 프록시를 고려.
2. **http 주소에서는 클립보드 API 등 보안 컨텍스트 기능이 막힐 수 있다** → 가능하면 https(터널/도메인).
3. **서버 인증이 없다**: Windows의 `serve.mjs`는 로그인 없이 누구나 접속·사용할 수 있게 열려 있다(`0.0.0.0`). 인터넷에 직접 열지 말고 **Cloudflare Access / Tailscale / VPN** 뒤에 둘 것. (맥 앱의 문제가 아니라 배포 전제 조건.)
4. 서버 주소가 바뀌면 웹앱의 저장 데이터(localStorage)는 주소별로 따로 보인다(§4.5).
5. 맥에서 `revealOutputFolder`류 버튼("폴더 열기")은 **Windows PC의 폴더를 연다**(맥에는 영향 없음, 동작해 보이지 않을 수 있음) → 웹앱 동작이라 앱에서 고치지 않고 §11에 기록.

## 8. 빌드·서명·배포
**준비물(확인 필요: 사용자 계정 상태)**: 맥, Xcode 15+, **Apple Developer Program 계정**(Developer ID Application 인증서 + 공증용 앱 암호/API 키). 계정이 없으면 서명·공증 없이는 Gatekeeper 경고가 뜨므로 **사용자 결정 필요**.

1. **버전**: 맥 앱은 **웹 버전과 독립된 자체 버전**(`mac-v1.0.0`부터)을 쓴다. Xcode `MARKETING_VERSION`(표시 버전)과 `CURRENT_PROJECT_VERSION`(빌드 번호, 단조 증가)을 직접 올린다. 웹 화면 변경은 서버가 내려 주므로 맥 버전을 올릴 필요가 없다(`docs/MAC_SYNC_FROM_WEB.md` §2).
2. **빌드**: `xcodebuild -project macos/AIOneStudio.xcodeproj -scheme AIOneStudio -configuration Release -archivePath build/AIOneStudio.xcarchive archive` → `xcodebuild -exportArchive`(method `developer-id`).
3. **공증**: `xcrun notarytool submit <zip|dmg> --keychain-profile <프로필> --wait` → `xcrun stapler staple`.
4. **DMG**: `create-dmg`(또는 `hdiutil`)로 `AI-ONE-STUDIO_<버전>_macOS.dmg` 생성(이름에 공백 없음 — GitHub가 공백을 바꿈). Applications 바로가기 포함.
5. **자동 업데이트(Sparkle 2)**:
   - EdDSA 키 한 쌍을 `generate_keys`로 한 번만 만든다. **공개 키는 Info.plist(`SUPublicEDKey`)에, 비공개 키는 키체인에만**(저장소에 넣지 말 것, 잃어버리면 이미 설치된 앱에 업데이트를 보낼 수 없음 → 백업). Windows 서명 키(`.tauri\ai-one-studio.key`)와 **별개**.
   - `SUFeedURL` = `https://raw.githubusercontent.com/designloves2/AI-ONE-STUDIO/master/macos/appcast.xml` (**릴리즈 파일이 아니라 저장소 파일**). `generate_appcast`로 만든 `appcast.xml`을 `macos/appcast.xml`에 갱신·커밋한다. 각 항목의 dmg 주소는 `https://github.com/designloves2/AI-ONE-STUDIO/releases/download/mac-vX.Y.Z/<dmg 이름>`.
   - 업데이트 확인은 실행 시 자동(`SUEnableAutomaticChecks`) + 메뉴 "업데이트 확인…".
   - **주의(Windows 업데이트 보호)**: Windows 앱의 자동 업데이트는 GitHub **"latest" 릴리즈**의 `latest.json`을 읽는다. 맥 릴리즈가 latest가 되면 Windows 업데이트가 조용히 실패하므로, 맥 릴리즈는 **반드시 `--latest=false`** 로 만든다.
6. **릴리즈 업로드**: `gh release create mac-vX.Y.Z AI-ONE-STUDIO_X.Y.Z_macOS.dmg --latest=false --title "AI ONE STUDIO macOS X.Y.Z" --notes-file <노트> --repo designloves2/AI-ONE-STUDIO`, 그 뒤 `macos/appcast.xml`을 커밋·푸시. 맥 세션은 웹 릴리즈(`vX.Y.Z`)를 만들거나 덮어쓰지 않는다(Windows `latest.json` 보호).

## 9. 2단계(v1 이후, 지금 만들지 말 것)
- **맥 로컬 모드**: 번들에 macOS용 `node` 바이너리 + `serve.mjs` + `server-lib` + `dist` + `comfy_paths.json`을 넣고 `Process`로 띄운 뒤(포트 8778) 창이 `http://127.0.0.1:8778/`을 연다. 맥에서 ComfyUI를 돌리는 사용자용. 이때 `AOS_APP=1`, `AOS_CONFIG=<Application Support>/connection.json` 환경변수가 Windows 앱과 같게 필요. 앱 종료 시 자식 프로세스 정리, 강제 종료 시 남은 서버 처리(Windows에서 겪은 문제: 이미 떠 있는 서버를 재사용하면 앱을 닫아도 서버가 남음).
- **ComfyUI 직접 주소 + 서비스 토큰**: 위 로컬 서버를 프록시로 쓰면 가능.
- Mac 전용 기능(메뉴 막대 상태, Handoff 등)은 요구가 생기면.

## 10. 웹 세션(Windows) 쪽에서 해 줄 일 / 맥 세션이 확인할 서버 전제
- Windows PC에서 `serve.mjs`가 떠 있어야 한다(`start.bat` 또는 Windows 앱). 맥에서 접속하려면 방화벽에서 **8778 인바운드 허용**(LAN) 또는 터널 연결.
- 서버 코드 변경 요청이 생기면(예: `/aos/target`에 앱 최소 버전·서버 버전 필드 추가, 간단한 접속 비밀번호) 웹 세션에 요청. 맥 세션이 `serve.mjs`를 직접 고치지 않는다.
- 변경 전달: 웹 세션은 커밋/릴리즈마다 `docs/MAC_SYNC_FROM_WEB.md`의 변경 기록에 **맥 영향**(없음/확인/조치 필요)을 적고, 맥 세션은 `macos/STATUS.md`에 진행 상황·검증 결과·"웹 세션에 요청"을 적는다. 두 PC는 git으로만 주고받는다.

## 11. 검증 체크리스트 (수동 — 이 저장소엔 자동 테스트가 없음)
맥에서 직접 확인하고 **한 것/못 한 것**을 구분해서 보고한다.
1. 처음 실행 → 연결 화면 → `https://` 도메인 주소 입력 → 앱 창에 AI ONE STUDIO가 열린다.
2. 같은 주소를 `http://<LAN IP>:8778`로 → (로컬 네트워크 권한 팝업 허용) → 열린다.
3. 앱을 종료했다 다시 켜면 연결 화면 없이 바로 열린다.
4. ⌘⇧K와 오른쪽 아래 ⇄ 버튼 → 연결 화면으로 돌아가고, 다른 주소로 바꾸면 그 주소가 열린다.
5. 서버를 꺼 둔 상태에서 실행 → "서버에 연결하지 못했습니다" + [다시 시도]/[연결 설정…].
6. `alert/confirm/prompt`가 뜨는 동작(예: 프리셋 삭제 확인, Prompt Edit 알림)이 실제로 대화상자로 나온다.
7. 이미지·영상·오디오 업로드(파일 선택창), 결과 다운로드 저장이 된다.
8. 영상 재생·전체 화면(⛶)·넘기기(Range)가 된다. 웹소켓 진행 표시와 라이브 프리뷰 프레임이 갱신된다(렌더는 **Windows 서버가 비었을 때만** 시험 — GPU 공유, 사용자 확인 후).
9. "Warn on close"를 켠 상태로 창 닫기 → 확인창이 뜬다.
10. 로그인 벽(Cloudflare Access) 주소에서 창 안 로그인 후 재실행해도 로그인이 유지된다.
11. 서명·공증 후 **다른 맥**(인터넷에서 받은 dmg)에서 Gatekeeper 경고 없이 열린다.
12. 0.x.y → 0.x.(y+1) 업데이트 안내가 뜨고 설치 후 재시작된다(테스트용 버전 2개 필요).

## 12. 사용자가 정해 줄 것 (맥 세션 시작 전)
1. **Apple Developer 계정**(유료)이 있는가? 없으면 서명·공증 없이 "우클릭 → 열기"로 배포하는 임시 방식으로 진행할지.
2. 맥에서 접속할 **서버 주소 형태**: 도메인(터널·https) / LAN IP(http) / Tailscale. (https를 권장: 클립보드 등 보안 컨텍스트 기능, ATS.)
3. 인터넷 쪽 접속이면 **접속 보호**(Cloudflare Access 또는 VPN)를 어떻게 할지 — 지금 서버에는 인증이 없음(§7-3).
4. 배포 방식: GitHub 릴리즈의 dmg(공개 저장소라 누구나 받을 수 있음) 그대로 괜찮은가. 라이선스상 코드 복사·재배포는 허가가 필요하므로 배포 대상은 사용자가 정한다.
5. 맥 세션이 저장소를 받는 방법(clone, 이 저장소의 `macos/` 폴더에 커밋) — Windows 쪽 파일과 충돌하지 않게 **`macos/` 폴더 안에서만** 작업.

## 13. 완료 기준
- §11 체크리스트 1~10 통과(맥에서 직접 확인) + 서명·공증된 dmg + 다른 맥 설치 확인.
- `mac-vX.Y.Z` 릴리즈(latest 아님)에 dmg가 올라가 있고 `macos/appcast.xml`이 갱신되어 있으며, 최신(latest) 릴리즈의 Windows `latest.json`은 그대로 있다.
- 맥 세션이 웹 세션에 보고: 커밋 해시, 태그, 릴리즈 URL, 확인한 것/못 한 것. 웹 세션이 CHANGELOG·PORT_LEDGER·CLAUDE.md에 반영.
