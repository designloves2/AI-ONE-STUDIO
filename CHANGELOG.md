# Changelog

이 프로젝트의 주요 변경 사항을 기록합니다. 형식은 [Keep a Changelog](https://keepachangelog.com/)를
느슨하게 따릅니다. 아직 버전 태그를 매기지 않고 있어 날짜 단위로 묶었습니다.

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
