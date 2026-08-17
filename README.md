# AI ONE STUDIO

**ComfyUI 커스텀 노드를, 독립 실행형 웹 스튜디오로.**

[`ComfyUI-TJ_NODE_STUDIO_ONE`](https://github.com/designloves2/ComfyUI-TJ_NODE_STUDIO_ONE) 커스텀 노드 패키지에
DOM 위젯으로 담겨 있던 6개의 생성 도구를 ComfyUI 캔버스 밖으로 꺼내 독립 웹 UI로 옮긴
사이트입니다. 워크플로우를 손으로 배선할 필요 없이, 이미 실행 중인 ComfyUI 서버에 그대로
연결해 브라우저에서 곧바로 생성·편집 작업을 할 수 있습니다. 각 도구의 기능과 파라미터는
원본 노드와 1:1로 동일하며, 레이아웃만 웹 환경에 맞게 재구성했습니다.

샘플링·모델 로딩 같은 무거운 로직은 이 프로젝트가 새로 만들지 않습니다 — **ComfyUI가
엔진이고, 이 프로젝트는 그 엔진을 호출하는 프론트엔드**일 뿐입니다.

## 포함된 도구

| 도구 | 대상 모델 | 지원 모드 |
|---|---|---|
| 🎬 **MiniMax H3** | MiniMax H3 영상+오디오 생성 모델 | Text / First-Last(FL2VA) / Reference(REF2VA) · 클립 릴레이 + 자동 합본 · 라이브 프리뷰 |
| 🖼 **Krea 2** | Krea.ai 이미지 생성 모델 | T2I · I2I · ControlNet(depth/canny) · Identity · Upscale(SeedVR2) |
| 🖼 **Z-Image** | Z-Image Turbo | T2I · I2I · Inpaint · Outpaint · RE-BG · ControlNet · Face Redraw · Upscale |
| 🖼 **Flux2 Klein** | Flux.2-Klein (9B / 4B) | T2I · I2I · Edit · Inpaint · Outpaint · Faceswap · Upscale |
| 🖼 **Qwen Image 2511** | Qwen2.5-VL 기반 Image Edit 모델 | T2I · I2I · Edit(최대 5장) · Inpaint · Outpaint · Faceswap · Angle(3D 카메라 컨트롤) · Upscale |
| 🖼 **SDXL** | SDXL Checkpoint / Separate UNet | T2I · I2I · Inpaint · Outpaint · Upscale(ESRGAN / Refiner / SeedVR2) |

이미지 도구 5종은 서로의 갤러리를 넘나들며 이미지를 골라 다른 도구의 소스 이미지로 보낼
수 있고, MiniMax H3의 First/Last Frame·Reference 슬롯으로도 곧바로 보낼 수 있습니다.

## 기술 스택

- **Vite** + **Vanilla TypeScript** — 프레임워크 없이 `el()` 기반 DOM 헬퍼로 구성
- **Tailwind CSS** — 랜딩 페이지 등 새로 만든 화면에 사용, 이식된 도구 내부는 기존 인라인
  스타일 그대로
- **해시 기반 라우팅** (`#klein`, `#minimax_h3` 등) — 도구가 6개뿐이라 별도 SPA 라우터 없음
- ComfyUI와는 REST + WebSocket으로 통신 (`/prompt`, `/upload/image`, `/view`, `/ws`)

## 사전 준비

이 사이트 혼자서는 아무것도 하지 못합니다. 아래 두 가지가 먼저 필요합니다.

1. **실행 중인 ComfyUI 서버** (기본값: `http://127.0.0.1:8188`, `--enable-cors-header` 플래그
   필요)
2. ComfyUI에 [`ComfyUI-TJ_NODE_STUDIO_ONE`](https://github.com/designloves2/ComfyUI-TJ_NODE_STUDIO_ONE)
   커스텀 노드 패키지와 그 의존 노드들이 설치되어 있어야 합니다.

저장소에 포함된 `install_comfyui_dependencies.bat`을 실행하면 기존 ComfyUI 설치 경로를
입력받아 `ComfyUI-TJ_NODE_STUDIO_ONE`과 필요한 의존 커스텀 노드 전부를 자동으로 설치합니다
(이미 설치된 항목은 건너뜁니다). 모델 파일(체크포인트 등)은 용량 문제로 이 스크립트가
다루지 않으며, 자세한 목록은 `ComfyUI-TJ_NODE_STUDIO_ONE`의 README를 참고하세요.

```bash
install_comfyui_dependencies.bat
```

## 시작하기

```bash
npm install
npm run dev
```

기본적으로 `http://127.0.0.1:8774`에서 열립니다. ComfyUI 서버 주소를 바꾸려면
`.env`에 `VITE_COMFY_URL`을 설정하세요 (기본값 `http://127.0.0.1:8188`).

```bash
npm run build     # 프로덕션 빌드
npm run preview   # 빌드 결과 미리보기
```

## 프로젝트 구조

```
src/
  identity.ts          # 브랜드 컬러/팔레트 (모든 도구 공유)
  router.ts            # 해시 기반 도구 전환
  shared/               # 공용 UI 헬퍼, 갤러리 피커, 확인 다이얼로그 등
  tools/
    minimax_h3/          # 영상 생성 도구
    krea2/                # 이미지 생성 도구
    zimage/
    klein/
    qwen2511/
    sdxl/
```

각 도구 폴더는 `core.ts`(상태/상수) · `api.ts`(REST 호출) · `comfyClient.ts`(WebSocket)
· `graphBuilder.ts`(ComfyUI 그래프 조립) · `settings.ts` · `galleryOverlay.ts` ·
`view.ts`(화면 조립)로 구성됩니다.

## 라이선스

[MIT](LICENSE)
