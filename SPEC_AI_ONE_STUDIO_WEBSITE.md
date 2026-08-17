# SPEC — AI ONE STUDIO (독립 웹사이트)

**대상**: 이 스펙 하나만 보고 새 세션에서 프로젝트를 시작할 수 있도록 작성했다. 지금
`ComfyUI-TJ_NODE_STUDIO_ONE`의 컨텍스트를 몰라도 되게 필요한 배경을 전부 이 문서에 담았다.

## 0. 한 줄 요약

지금 6개 ONE STUDIO 노드(Flux2 Klein, Z-Image, Krea2, Qwen2511, SDXL, MiniMax H3)는
**ComfyUI 안에서 커스텀 노드의 DOM 위젯**으로 돌고 있다. 이 프로젝트는 그 UI들을 **ComfyUI
밖의 독립 웹사이트**로 옮긴다 — 메뉴에서 도구를 고르면 그 UI가 풀스크린으로 뜨고, 뒤에서는
**이미 켜져 있는 ComfyUI 서버**에 그대로 그래프를 제출한다. 샘플링·모델 로딩 등 무거운 로직은
전혀 다시 만들지 않는다 — ComfyUI가 엔진이고, 이 프로젝트는 그 엔진을 부르는 프론트엔드일
뿐이다.

**전제조건**: ComfyUI가 `ComfyUI-TJ_NODE_STUDIO_ONE` + `ComfyUI-TJ_NODE`가 설치된 채로 먼저
실행 중이어야 한다. 이 웹사이트 혼자서는 아무것도 못 한다.

---

## 1. 기술 스택

| 항목 | 선택 | 이유 |
|---|---|---|
| 빌드 도구 | **Vite** | 지금 코드가 프레임워크 없는 순수 JS(ES 모듈)라 Vite의 "vanilla" 템플릿과 거의 그대로 맞는다. HMR도 빠르다 |
| 언어 | **Vanilla TypeScript** | 기존 6개 모듈이 JS라, 처음엔 JS 그대로 옮기고(§5) 점진적으로 `.ts`로 바꿔도 된다. 프레임워크(React/Vue/Svelte) 도입은 전면 재작성을 뜻하므로 하지 않는다 |
| 스타일 | **Tailwind CSS** | 유틸리티 클래스라 지금처럼 인라인 `style` 객체를 많이 쓰는 코드베이스에 이질감이 적다. 랜딩 페이지·메뉴 등 새로 만드는 화면에 주로 쓰고, 이식된 도구 내부 UI는 기존 인라인 스타일을 그대로 둔다 |
| 애니메이션 | **Motion One** (또는 GSAP) | 메뉴 전환·카드 hover·풀스크린 진입 트랜지션에 사용. 가볍고(Motion One은 ~5KB) Web Animations API 기반이라 프레임워크 종속이 없다 |
| 라우팅 | **없음 — 해시 기반 수동 전환** | 도구가 6개뿐이라 SPA 라우터(예: `vue-router`)는 과함. `location.hash`(`#klein`, `#minimax_h3` 등)로 어느 도구가 열려 있는지만 관리하면 충분하다 |

## 2. TJ 아이덴티티 — 그대로 가져갈 것

모든 ONE STUDIO 모듈이 공유하는 팩 전체 브랜드 컬러와 팔레트다(6개 `core_*.js` 파일 전부에서
확인, 이름만 `BRAND` 또는 `LIME`으로 다름 — 값은 전부 동일):

```ts
// identity.ts — 새 프로젝트에서 그대로 사용
export const BRAND = "#7612DA";   // TJ 퍼플 — 버튼·액센트·포커스 테두리
export const C = {
  bg0: "#0b0b0b",   // 페이지 배경 (가장 어두움)
  bg1: "#111111",   // 카드/패널 배경
  bg2: "#181818",   // 인풋/버튼 기본 배경
  bg3: "#222222",   // 선택된 상태 배경
  border:  "#2a2a2a",
  borderH: "#3c3c3c",   // hover 시 테두리
  text:  "#dedede",
  muted: "#565656",
  dim:   "#2e2e2e",
  warn: "#ffb347",
  err:  "#ff6767",
  ok:   "#5fd38d",
};
```

- 다크 테마 고정(라이트 모드 없음) — 지금 6개 도구가 전부 이렇다
- 폰트는 시스템 UI 폰트를 그대로 쓴다(`inherit`) — 지금 코드가 그렇게 돼 있고, 이식할 위젯
  내부 텍스트가 갑자기 다른 폰트로 보이면 위화감이 크다
- 랜딩 페이지·메뉴처럼 **새로 만드는 화면**은 이 팔레트를 Tailwind 테마 토큰으로 등록해서
  (`tailwind.config` → `colors.brand = "#7612DA"` 등) 일관되게 쓴다

## 3. ComfyUI와의 통신 — cross-origin

지금은 이 코드가 ComfyUI 프로세스 **안에서** 서빙되므로 `fetch("/minimax_h3_one/videos")`
같은 상대 경로가 그냥 통했다. 독립 사이트가 되면 **다른 origin**(예: `http://localhost:5173`)
에서 ComfyUI(`http://127.0.0.1:8188`)를 불러야 하므로 두 가지가 필요하다.

### 3-1. ComfyUI 쪽 — CORS 허용

ComfyUI는 실행 플래그로 CORS를 지원한다(`comfy/cli_args.py`):

```
python main.py --enable-cors-header http://localhost:5173
```

(전체 허용은 `--enable-cors-header` 만 붙이면 `*`가 기본값 — 로컬 전용이면 상관없지만, 어떤
origin이든 API를 부를 수 있게 된다는 뜻이니 배포 환경에서는 특정 origin으로 좁힐 것)

### 3-2. 새 사이트 쪽 — API 클라이언트 재작성

기존 6개 `api_*.js`는 ComfyUI가 제공하는 `../../scripts/api.js`의 `api` 객체를 가져와
`api.fetchApi(path, opts)`(상대 경로 fetch 래퍼)와 `api.clientId`(웹소켓 진행률 이벤트를
자기 것끼리 구분하는 id)를 쓴다. 이 모듈은 ComfyUI가 서빙하는 파일이라 독립 사이트에서는
가져올 수 없다 — **같은 인터페이스의 얇은 대체 클라이언트를 새로 하나 만든다**:

```ts
// comfy-client.ts
const BASE = import.meta.env.VITE_COMFY_URL || "http://127.0.0.1:8188";

export const api = {
  clientId: crypto.randomUUID(),
  async fetchApi(path: string, opts: RequestInit = {}) {
    return fetch(`${BASE}${path}`, opts);   // 상대경로 대신 절대 origin
  },
  // 웹소켓: ComfyUI의 /ws?clientId=... 에 연결, 'status'/'progress'/'executed'/
  // 'execution_error' 이벤트를 기존 코드가 기대하는 EventTarget 인터페이스로 재발행
  addEventListener(type: string, fn: (e: any) => void) { /* ws 위에 얹기 */ },
};
```

이렇게 만들면 **기존 `api_*.js`의 나머지 코드는 한 줄도 안 바뀐다** — `import { api } from
"../../scripts/api.js"` 한 줄만 `import { api } from "./comfy-client.ts"`로 바꾸면 끝이다.
`queuePrompt()`가 쓰는 `POST /prompt`, `GET /view`, `POST /upload/image` 등은 전부 이미
표준 ComfyUI REST 엔드포인트라 그대로 호출된다.

### 3-3. 각 도구의 자체 백엔드 라우트

`nodes.py`에 등록된 `/minimax_h3_one/*`, `/flux_klein/*` 등도 전부 ComfyUI 프로세스 위에
얹힌 aiohttp 라우트라 **서버 쪽은 손댈 것이 없다** — CORS만 켜져 있으면 새 사이트에서도 같은
방식(절대 URL)으로 호출된다.

---

## 4. 화면 구조

```
/                      랜딩 — 상단 고정 메뉴바(6개 도구) + 하단은 기본적으로 갤러리 노출
#klein                 Flux2 Klein ONE STUDIO
#zimage                Z-Image Turbo ONE STUDIO
#krea2                 Krea2 ONE STUDIO
#qwen2511              Qwen2511 ONE STUDIO
#sdxl                  SDXL ONE STUDIO
#minimax_h3            MiniMax H3 ONE STUDIO
```

- **상단 메뉴바 고정** — 6개 도구를 탭처럼 상단에 배치하고 클릭하면 해당 도구 화면으로 전환
  (기존처럼 "뒤로가기 → 카드 메뉴" 왕복 구조가 아니라, 메뉴바가 항상 보이는 구조). 별도의
  "메뉴로 돌아가기" 버튼은 불필요 — 상단 탭 자체가 상시 노출된 네비게이션
- 진입 시 ComfyUI 연결 확인(예: `GET /system_stats` 200 체크) → 실패하면 "ComfyUI가
  실행 중인지 확인하세요, 주소: {BASE}" 안내 화면. **이게 없으면 사용자가 원인 모른 채 빈
  화면만 보게 된다** — 가장 흔한 실패 모드이니 최우선으로 처리
- 메뉴 탭 hover/전환 애니메이션에 Motion One 사용(§1)

### 4-1. 정사각형 위젯 → 웹 레이아웃 재설계 (중요)

기존 6개 도구 UI는 전부 **ComfyUI 노드 위젯**(캔버스 위 정사각형에 가까운 고정 비율 박스)
안에서 동작하도록 만들어졌다. 독립 웹사이트로 옮기면 이 제약이 사라지므로, 정사각형 안에
욱여넣었던 탭/패널/프리뷰 구성을 **그대로 이식하지 않고 도구별로 웹 화면에 맞게 재설계**한다.

- **개별 재설계 원칙**: 6개 도구는 컨트롤 종류·개수가 서로 달라(예: 아코디언 vs 세로 스크롤
  vs 그리드) 공통 템플릿 하나로 억지로 통일하지 않는다. 각 도구 화면은 넓어진 가로 공간을
  살려 좌측(또는 상단) 컨트롤 패널 + 우측(또는 하단) 넓은 프리뷰/결과 영역 같은 구조를
  도구별로 판단해서 짠다
- **공통 요소는 갤러리뿐**: 6개 도구가 공유하는 유일한 공통 컴포넌트는 **갤러리**(생성된
  결과물이 모이는 영역)다. 갤러리는 `src/shared/gallery.ts` 같은 공용 컴포넌트로 만들어
  6개 도구 화면에서 재사용한다. 그 외 컨트롤/탭/패널 레이아웃은 공용화하지 않는다
- 정사각형 제약 해제로 새로 확보되는 공간(주로 가로 폭)은 프리뷰/갤러리 영역을 넓히는 데
  우선 활용한다 — 지금 위젯 안에서 작게 눌려있던 미리보기가 웹에서는 핵심 시인성 포인트

## 4-2. 작업 순서(재확정)

UI 이식(전체 디자인)을 먼저 끝내고, 그 다음에 ComfyUI 백엔드와 연결해 실제로 동작하게
만든다 — §7의 "도구 1개로 엔드투엔드 검증"보다 **디자인 우선 순서**로 진행한다:

1. 6개 도구 전부 UI만 이식·재설계(정적 상태, 실제 생성 동작 없음) — 상단 메뉴바 + 갤러리
   공용 컴포넌트 포함
2. UI 전체가 완성된 뒤 `comfy-client.ts` + 각 도구의 `api_*.js` 연결 → 실제 생성 동작 확인

---

## 5. 코드 재사용 전략 — 이식 절차

각 도구 폴더(`web/klein/`, `web/minimax/` 등)의 파일 구성은 대체로 동일한 패턴이다:
`core_*.js`(상수/상태) · `api_*.js`(백엔드 호출) · `graph_builder_*.js`(그래프 조립) ·
`ui_*.js`(각 탭/패널) · `one_node_*.js`(전체 조립 + ComfyUI 노드 등록).

**포팅 순서(도구 1개 기준)**:

1. `core_*.js` · `graph_builder_*.js` · `ui_*.js` 전부를 새 프로젝트에 **그대로 복사** — 이
   파일들은 ComfyUI API를 몰라도 되는 순수 로직/DOM 빌더라 수정이 거의 없다
2. `api_*.js`는 `import { api } from "../../scripts/api.js"` 한 줄만 §3-2의
   `comfy-client.ts`로 교체
3. `one_node_*.js`는 **ComfyUI 노드로 등록하는 부분**(`app.registerExtension`,
   `nodeType.prototype.onNodeCreated` 등)이 섞여 있다 — 이 부분만 걷어내고, 대신
   `renderInto(container: HTMLElement, state)` 같은 진입 함수로 감싼다. DOM 빌드 로직 자체는
   그대로 쓴다
4. `previewNodeKey` 등 "이 캔버스의 이 노드 id"에 묶인 것들(라이브 프리뷰 웹소켓 키 등)은
   노드 id 대신 **탭/세션 id**로 대체
5. `localStorage` 키(`LS_KEY`)는 그대로 재사용 가능 — 브라우저가 같으면 설정도 그대로
   이어진다는 뜻(장점)

**하지 않는 것**: ComfyUI 프론트엔드 자체(그래프 캔버스, 다른 사람이 만든 노드)를 재현하는
것. AI ONE STUDIO는 이 6개 도구 전용 UI만 다루고, 일반 노드 그래프 편집 기능은 없다 — 그게
필요하면 그냥 ComfyUI를 열면 된다.

---

## 6. 폴더 구조 (제안)

```
ai-one-studio/
├── src/
│   ├── identity.ts              # §2 팔레트
│   ├── comfy-client.ts          # §3-2 API 클라이언트
│   ├── router.ts                # 해시 기반 화면 전환
│   ├── landing/
│   │   └── menu.ts              # 메뉴 카드 화면
│   └── tools/
│       ├── klein/                # web/klein/*.js 이식본
│       ├── zimage/
│       ├── krea2/
│       ├── qwen2511/
│       ├── sdxl/
│       └── minimax_h3/
├── index.html
├── vite.config.ts
├── tailwind.config.ts
└── package.json
```

## 7. 작업 순서 (권장)

| # | 작업 | 비고 |
|---|---|---|
| 1 | Vite vanilla-ts 스캐폴딩 + Tailwind 설정 + `identity.ts` | `npm create vite@latest -- --template vanilla-ts` |
| 2 | `comfy-client.ts` 작성 + `GET /system_stats`로 연결 확인 화면 | 가장 먼저 되는지 확인해야 나머지가 의미 있음 |
| 3 | 도구 1개(가장 단순한 것부터 — Z-Image 추천) 이식해서 **엔드투엔드 한 번 생성까지 확인** | 패턴이 맞는지 여기서 검증, 나머지 5개는 반복 작업 |
| 4 | 메뉴/라우팅 화면 | |
| 5 | 나머지 5개 도구 이식 | |
| 6 | 애니메이션/폴리시(Motion One) | |

## 8. 리스크 / 주의사항

- **CORS를 안 켜면 아무것도 안 된다** — 가장 먼저, 가장 자주 걸릴 지점(§3-1)
- 웹소켓도 cross-origin 대상이다 — `ws://127.0.0.1:8188/ws?clientId=...`로 직접 연결해야
  하며, 브라우저의 mixed-content 정책상 사이트가 `https`로 서빙되면 ComfyUI도 `wss`여야 한다
  (로컬 개발 단계에서는 둘 다 `http`/`ws`라 문제없음)
- `/upload/image`, `/view` 등은 파일을 주고받는 엔드포인트라 CORS 헤더뿐 아니라
  `Content-Type`/`multipart/form-data` 처리가 맞는지 도구 1개 이식할 때(§7-3) 반드시 실제
  업로드까지 테스트할 것
- 이 문서에 없는 ComfyUI REST 엔드포인트 세부 동작(정확한 응답 스키마 등)은 지금 세션에
  `web/*/api_*.js`가 이미 다 구현해 놓았으니, 새 세션은 그 파일들을 **1차 사료**로 삼으면 된다
  — 이 문서는 "어떻게 옮기는가"의 전략이고, "무엇을 호출하는가"의 디테일은 원본 코드에 있다
