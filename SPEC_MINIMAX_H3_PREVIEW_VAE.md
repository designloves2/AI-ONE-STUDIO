# SPEC — MiniMax H3 라이브 프리뷰에 tiny/approx VAE 선택 추가

## 배경

`ComfyUI-TJ_NODE_STUDIO_ONE`의 MiniMax H3 노드는 라이브 프리뷰를 KJNodes의
`ModelPreviewOverrideKJ`로 처리한다. 이 노드는 선택적으로 `tiny_vae`
(models/vae_approx/ 안의 파일, taesd류 근사 디코더)를 받을 수 있는데, 그래프
빌더 쪽 배선(`state.previewTinyVae`)은 이미 있었지만 정작 그 값을 고를 수 있는
UI가 없어서 **항상 비어 있었다** — 즉 지금까지 노드도 웹사이트도 vae_approx를
실제로는 안 쓰고 있었다.

## 원본 노드 쪽 변경 (이미 적용됨)

1. **백엔드** `nodes.py` — `/minimax_h3_one/models` GET 응답에 필드 추가:
   ```json
   { ..., "vae_approx": ["파일명1.pth", "파일명2.safetensors", ...] }
   ```
   `models/vae_approx/` 폴더를 스캔한 목록 (`.pth`, `.safetensors`).

2. **프론트엔드** `web/minimax/ui_app_settings_minimax.js` — Settings → Preview
   탭에 드롭다운 추가:
   ```js
   const vx = ["none", ...(modelData.vae_approx || []).filter(x => x !== "none")];
   const sel = searchableSelect(vx, state.previewTinyVae || "none", v => { state.previewTinyVae = v; ctx.persist(); });
   ```
   라벨: `"Preview VAE (tiny/approx, optional — models/vae_approx/)"`

   `state.previewTinyVae`는 이미 존재하던 필드(`core_minimax.js`의
   `defaultState`)라 새로 만들 필요 없음 — 그래프 빌더 쪽 배선도 이미 있었음
   (`graph_builder_minimax.js`의 `applyPreview()`, `tiny_vae` 조건부 전달).
   빠진 건 UI 하나뿐이었다.

3. 서버 사이드 config(get/save)에는 안 넣음 — 프리뷰 설정 전체(previewEnabled/
   Frames/Fps/MaxRes/Quality/TinyVae)가 원래 server config round-trip 대상이
   아니고, 워크플로우에 직렬화되는 노드 자체 상태(`tj_state` 위젯)로만
   저장된다. 웹사이트 쪽도 이 패턴을 그대로 따르면 됨.

## 웹사이트 쪽 해야 할 것

`src/tools/minimax_h3/` 안에서:

1. 모델 목록 API 응답 타입에 `vae_approx: string[]` 필드 추가 (백엔드가 이미
   내려주므로 프론트에서 타입/파싱만 추가하면 됨)
2. MiniMax H3 Settings의 Preview 섹션에 같은 드롭다운 추가 — `state`에
   `previewTinyVae` 필드가 이미 있으면(원본 노드 상태 구조를 그대로 포팅했다면)
   그걸 그대로 쓰면 됨, 없으면 추가
3. 그래프 빌더 쪽에서 `ModelPreviewOverrideKJ` 노드를 만드는 부분에
   `tiny_vae` 조건부 전달 로직이 이미 있는지 확인 — 원본 그래프 빌더 로직을
   1:1로 포팅했다면 이미 있을 가능성이 높음, 없으면 원본의 `applyPreview()`
   참고해서 추가

## 확인 방법

Settings 열어서 Preview 탭에 "Preview VAE" 드롭다운이 뜨고, `models/vae_approx/`
안의 실제 파일명이 목록에 나오는지 확인.
