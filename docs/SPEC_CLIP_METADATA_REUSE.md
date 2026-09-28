# SPEC — 클립 메타데이터 확장 + 완전 Reuse + 실측 평균 소요시간

## 배경 / 목적
지금 갤러리의 "↩ Reuse"는 프롬프트 텍스트(+헤더/풋터)만 복원한다. 해상도, 프레임수,
스텝, 어텐션(가속) 모드, 터보 LoRA, 그리고 **일반 LoRA(1~3개 슬롯)** 는 전혀 저장되지도,
복원되지도 않는다. 결과적으로 "한 번 잘 나온 클립을 그대로 다시 만들기"가 불가능하다.

또한 "Avg minutes per clip"(설정 화면, `settings.ts:405`)은 지금 순수 수동 입력값
(기본 13분)이라 실제 소요시간과 무관하다. 클립별 실제 소요시간이 어디에도 기록되지
않기 때문이다.

이 스펙은 두 가지를 함께 해결한다:
1. 클립 하나를 만든 모든 설정(+실제 소요시간)을 메타데이터로 저장
2. 그 메타데이터로 (a) 갤러리에서 설정 확인, (b) 완전 Reuse, (c) 실측 평균 소요시간 자동 계산

작업 순서: **일반 LoRA 슬롯(state.loras) 관련 부분은 사용자가 먼저 진행**하고,
나머지(메타 저장/갤러리 UI/평균 계산)는 Claude가 이어서 진행한다.

---

## 1. 현재 상태 파악 (참고용 — 코드 위치)

- `LoraEntry` 인터페이스: `src/tools/minimax_h3/core.ts:16-21`
  ```ts
  export interface LoraEntry {
    name: string;
    strength: number;
    triggerWord: string;
    enabled: boolean;
  }
  ```
- 일반 LoRA 슬롯: `MinimaxState.loras: LoraEntry[]` (1~3개, `core.ts:42`)
- 터보 LoRA(별도 단일 슬롯): `turboLora`, `turboLoraReference`, `turboLoraStrength`,
  `turboLoraLowVram` (`core.ts:29-32`, `98-100`)
- 클립 저장 시 이미 기록되는 meta 필드 (`view.ts:1283-1287`):
  `prompt, promptHeader, promptFooter, w, h, mode, aspect, megapixels, frames, steps,
  sampler, accel, seed`
- 클립 소요시간: **현재 전혀 기록 안 됨.** `runStart`(`view.ts:407`)는 전체 큐 시작
  시각만 잡고, 클립 단위 시작/종료는 없음.
- 현재 Reuse 로직: `reusePrompt` 콜백 (`view.ts:1541-1551`), 프롬프트 텍스트만 복원.
  `galleryOverlay.ts`의 "↩ Reuse" 버튼(`galleryOverlay.ts:460-461`)이 호출.

---

## 2. 작업 A — 일반 LoRA 정보 저장 (사용자가 먼저 진행)

**목표**: 클립을 만들 때 실제로 적용된 일반 LoRA 슬롯(1~3개) 정보를 클립 meta에
그대로 저장해서, 나중에 그 클립을 reuse하면 LoRA 구성까지 완전히 재현되게 한다.

**저장할 필드** (클립 meta에 추가):
```ts
loras: Array<{
  name: string;        // 파일명
  strength: number;
  triggerWord: string;
  enabled: boolean;
}>
```
- `state.loras` 배열을 생성 시점 그대로 스냅샷 떠서 저장(참조 말고 복사 — 나중에
  state가 바뀌어도 과거 클립 meta는 그대로 남아야 함).
- `enabled: false`인 슬롯도 그대로 포함(당시 상태를 있는 그대로 기록 — reuse할 때
  "당시엔 꺼져 있었다"는 정보도 필요).
- 터보 LoRA는 이미 `accel`/`turboLoraStrength`/`turboLoraLowVram` 쪽에서 별도로
  다뤄지므로 이 작업 범위 밖(아래 작업 B에서 함께 처리).

**저장 위치**: `view.ts`에서 클립 meta를 구성하는 지점 (`view.ts:1283` 부근,
`clipRecords`/`meta` 객체 생성부 전체 — one-take/스티치 케이스 포함해서 빠짐없이).

**검증 방법**: 클립 1~2개 생성 후, 저장된 이미지/영상 파일에 붙는 meta(JSON)를 열어
`loras` 배열이 그 시점 `state.loras`와 정확히 일치하는지 확인.

---

## 3. 작업 B — Claude가 이어서 진행할 부분

### B-1. 클립별 실제 소요시간 캡처
- `runGenerate()` 안에서 클립 루프가 도는 지점에 클립 시작 시각(`Date.now()`)을
  잡고, 해당 클립이 끝나는 시점에 `elapsedSec = (Date.now() - clipStart) / 1000`
  계산.
- one-take/스티치 케이스(`clipRecords`, `view.ts:1407` 부근)도 클립 단위로 잡을 것 —
  전체 합산 시간이 아니라 **개별 클립 소요시간**이어야 평균 계산에 의미가 있음.

### B-2. 클립 meta 확장 (터보 LoRA 포함)
클립 meta에 다음 필드 추가:
```ts
elapsedSec: number;
turboLora: string;
turboLoraReference: string;
turboLoraStrength: number;
turboLoraLowVram: boolean;
loras: LoraEntry[];   // 작업 A에서 만든 것
```

### B-3. 갤러리 ⓘ 아이콘 + 호버 팝업
- `galleryOverlay.ts`에 각 썸네일마다 ⓘ 아이콘 추가.
- 호버 시 작은 팝업으로 표시: 해상도, 프레임수, 스텝, 어텐션(가속) 모드, 터보 LoRA
  사용여부/강도, 일반 LoRA 목록(이름+강도+on/off), 소요시간(mm:ss).
- 기존 프롬프트 호버 미리보기 패턴 재사용.

### B-4. Reuse 전체 설정 복원
- `view.ts`의 `reusePrompt` 콜백을 확장(또는 별도 `reuseAll` 콜백 신설)해서,
  프롬프트뿐 아니라 meta에 저장된 모든 생성 설정을 `state`에 복원:
  - 해상도 관련: `aspect`, `megapixels`
  - `clipFrames`(meta의 `frames`), `steps`, `sampler`, `accelMode`(meta의 `accel`)
  - 터보 LoRA: `turboLora`, `turboLoraReference`, `turboLoraStrength`, `turboLoraLowVram`
  - 일반 LoRA: `state.loras = meta.loras` (작업 A 완료 후)
  - `seed`(선택 — 완전히 똑같이 재현하려면 필요하지만, 사용자가 "다른 시드로 변주"를
    원할 수도 있으니 버튼을 두 개로 나눌지(예: "↩ Reuse (same seed)" /
    "↩ Reuse (new seed)") 결정 필요 — 착수 전 확인)
- 갤러리 버튼 라벨/툴팁을 "프롬프트만 복원"이 아니라 "이 클립을 만든 설정 그대로
  복원"임을 알 수 있게 문구 조정.
- 복원 후 `persist()` + `refreshPlan()` 호출(기존 `reusePrompt`와 동일 패턴).

### B-5. 실측 평균 소요시간 자동 계산
- 소스: 위에서 저장된 클립 meta들의 모음(별도 DB 없이 기존 갤러리 저장 파일의
  meta를 그대로 재사용).
- 현재 `state`(해상도×megapixels×frames×accel×터보LoRA 사용여부×일반LoRA 사용여부)와
  **일치하는** 과거 클립들만 필터링해서 `elapsedSec` 평균을 냄.
- 일치 표본이 있으면 `settings.ts`의 "Avg minutes per clip" 값에 자동 반영(수동
  입력 필드는 유지하되, 자동 계산값이 있을 때는 그걸 우선 쓰고 옆에 "(measured
  from N clips)" 같은 표시를 붙여 출처를 밝힘).
- 일치 표본이 없으면 기존처럼 수동 입력값(기본 13분) 폴백.

---

## 4. 영향 파일
- `src/tools/minimax_h3/core.ts` — 필요 시 meta 타입 정의 확장
- `src/tools/minimax_h3/view.ts` — 클립 타이밍 캡처, meta 확장, reuse 확장, 평균 계산
- `src/tools/minimax_h3/galleryOverlay.ts` — ⓘ 아이콘 + 호버 팝업, Reuse 버튼 문구
- `src/tools/minimax_h3/settings.ts` — 평균 소요시간 표시(자동/수동 구분)

## 5. 주의사항
- 이 스펙 적용 이후 생성되는 클립부터만 데이터가 쌓임 — 기존 갤러리 클립은
  `elapsedSec`/`loras`/`turboLora*` 메타가 없어 평균 계산·완전 Reuse 모두 대상에서
  빠짐(reuse 시 없는 필드는 조용히 스킵, 에러 없이 현재 값 유지).
- seed 복원 여부는 B-4 착수 전 확정 필요.
