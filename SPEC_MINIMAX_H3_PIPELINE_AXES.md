# SPEC — MiniMax H3 파이프라인 축 분리 + 아코디언 UI (노드 → 웹 포팅)

원본: `ComfyUI-TJ_NODE_STUDIO_ONE` v1.17.0 (커밋 `a20d7c1`)
대상: `AI-ONE-STUDIO` (`src/tools/minimax_h3/*.ts`)

노드 쪽에서 **가속 옵션들이 실제로 어느 계층을 패치하는지 전수 감사**한 뒤 UI를 재구성했습니다.
그 과정에서 **조용히 아무 일도 안 하고 있던 조합 2건**을 발견했는데, 웹 버전에도 같은 문제가
있을 가능성이 높으니 이 부분부터 확인해 주세요.

---

## Part 0 — 먼저 확인할 것: 조용한 덮어쓰기 2건

### ① SLA가 다른 어텐션을 말없이 덮어씀

`ComfyUI-H3-SLA-Attention/sla/patch.py`:
```python
to["optimized_attention_override"] = _make_override(...)   # 기존 값 확인/보존 없음
```

같은 키를 쓰는 노드들:

| 노드 | 키 |
|---|---|
| `PathchSageAttentionKJ` (Sage) | `optimized_attention_override` |
| `SolAttnPatch` (kijai) | `optimized_attention_override` |
| `H3SLAAttention` | `optimized_attention_override` |
| `ModelAttentionBackend` (CK) | `set_model_optimized_attention` (형제 키) |

→ 둘 이상 켜면 **그래프상 뒤에 오는 하나만 실제로 동작**하고 나머지는 무시됩니다.
에러도 경고도 없어서 "둘 다 켰다"고 착각하게 됩니다. (kijai/Saganaki22 노드는 기존 값을
fallback으로 보존하지만, SLA는 안 합니다.)

### ② MemEff Sage와 override 백엔드의 겹침 — **막지 말고 안내만** (노드 `0876abc`, 2026-08-27)

`MiniMaxH3MemoryEfficientSageAttentionPatch`는 이렇게 합니다:
```python
model_clone.add_object_patch(f"diffusion_model.blocks.{idx}.attn.forward", minimax_sageattn_forward...)
```

`optimized_attention_override`는 **stock attn.forward가 호출될 때만** 참조됩니다. 그 forward를
통째로 교체해 버리면 override는 트랜스포머 블록에서 영영 호출되지 않습니다.

**초기 결론(이 스펙 최초 버전)은 "forward 패치를 막아라"였고, 그게 거꾸로였습니다.**
겹칠 때 트랜스포머 블록에 도달 못 하는 건 **override 백엔드(CK/SolAttn kijai/SLA)** 쪽이지
forward 패치가 아닙니다. 게다가 forward 패치(MemEff Sage)가 **둘 중 더 빠른 쪽**입니다.
forward를 막으면 빠른 걸 끄고 무력한 백엔드만 남습니다. CK + MemEff Sage 는 **정상 조합** —
MemEff가 블록을, CK가 그 바깥(텍스트 리파이너·크로스 어텐션)을 담당합니다.

→ **막지 않습니다.** 유일한 실제 차단은 `larryvrh` 터보(4스텝)에서 **sparse forward 커널**
(`solattn_saganaki`)뿐입니다. 겹침이 발생하면 회색 처리 대신 안내문을 표시:
> "{백엔드명} only applies outside the transformer blocks here — this forward patch replaces the blocks' own attention."

**웹 대응**: `attnForwardBlockedReason`에서 `attnBackend` 분기 제거(larryvrh+non-dense만 유지),
`attnForwardOverlapNote(state, key)` 신규 + 어텐션 아코디언에 힌트 표시, `graphBuilder`는
`attnForward` 값으로 두 노드 다 emit. 마이그레이션도 SLA가 백엔드 슬롯을 먼저 가로채지 않게
순서 조정(SLA는 다른 백엔드가 슬롯을 안 가져갔을 때만). — 웹 커밋은 PORT_LEDGER 참조.

**"저VRAM + CK 커널"은 이 조합으로는 안 됩니다.** KJ `MiniMaxH3MemoryEfficientSageAttentionPatch`는
`blocks.*.attn.forward`를 **sage 커널로 통째 교체** — 커널이 sage로 고정됩니다. CK 백엔드와 같이
켜도 CK 커널은 블록에서 안 돌고 텍스트 리파이너 등 바깥만 담당합니다. 메모리 효율을 유지한 채
CK(comfy kitchen) 커널을 블록에서 쓰려면 **백엔드 보존형** 최적화가 필요합니다:

> **`H3-Optimizations` 팩(Zironic)의 `H3MemoryOptimization` 노드** — forward를 교체하지 않고,
> ComfyUI가 고른 dense 백엔드(sage / **comfy kitchen** / 스톡)를 **그대로 둔 채** 주위만 감쌉니다
> (chunked QKV/MLP/FinalLayer, streamed Q, block 0 전 embed 해제). README: *"preserves the dense
> attention selected by ComfyUI ... This includes external SageAttention, external Comfy Kitchen"*.
> → **CK 백엔드 + `H3MemoryOptimization` = 메모리 효율 CK.**

→ 통합 완료: **§③ H3 Optimizer 축** 참조 (노드 `b34876c` = v1.24.0, 웹은 PORT_LEDGER 참조).

### ③ H3 Optimizer 축 — 백엔드 보존형 VRAM + 선택적 sparse (노드 `b34876c`, v1.24.0)

어텐션 아코디언의 **세 번째 컨트롤** (backend / H3 forward 아래). Zironic `H3-Optimizations` 팩을 감쌈.

| `h3Optimizer` | 노드 | 설명 |
|---|---|---|
| `none` | — | |
| `memory` | `H3MemoryOptimization` | 선택된 dense 백엔드(sage / comfy kitchen / stock)를 **보존한 채** chunked QKV/MLP/FinalLayer + early embedding release로 감쌈. **어떤 백엔드·터보와도 조합 가능, 절대 차단 안 됨.** ← 메모리 효율 CK를 얻는 방법 |
| `memory_sparse` | `+ H3SparseAttention` | 위에 sparse attention 근사 추가 (video attention budget, denser early/late steps) |

**패치 키** (노드 `b34876c`, `h3_optimizations/patch.py` 추적):
- `memory` 의 MLP/FinalLayer/embedding 절약 → `blocks.{i}.forward` (어텐션과 **다른 키**) → forward 패치와 안 겹침
- `H3SparseAttention` → `blocks.{i}.attn.forward` (KJ MemEff / Saganaki Sol 과 **같은 키**). H3-Optimizations
  apply 코드는 남의 패치를 보면 `conflicts.append(key); continue` — **덮어쓰지도 에러도 안 냄, 그냥 skip**.
  그래서 forward 패치가 있으면 H3 Sparse 는 전 블록에서 무력화됨.

**게이팅** — `h3OptimizerBlockedReason(state, key)`:
- `memory` 는 **절대 차단 안 함** (다른 키, 순수 VRAM/실행). H3 forward 패치와 조합 = 유용 (벤치된
  "Sage + chunked MLP/FinalLayer" 스택 — 어텐션은 forward 패치가, MLP/FinalLayer/embed 는 옵티마이저가)
- `memory_sparse` 차단 조건 (차단 시 자동으로 `memory` 폴백, `none` 아님, 사유 인라인):
  - 아무 터보 스케줄 → "근사 오차를 흡수 못 함"
  - `attnBackend` 이미 sparse (`solattn_kijai` / `sla`) → "이중 sparse"
  - **`attnForward` 켜짐** (`memeff_sage` / `solattn_saganaki`) → "forward 패치가 attn.forward 를 소유,
    H3 Sparse 가 우회 못 함"

**오버랩 노트** — `h3OptimizerOverlapNote(state, key)`: **`key === "memory"` 일 때만** (memory_sparse 는
forward 패치와 애초에 차단). forward 패치 켜져 있으면: "forward 패치가 블록 어텐션 유지 — 옵티마이저는
MLP / FinalLayer / embedding 절약을 그 위에 추가."

**서브파라미터** (`memory`|`memory_sparse` 일 때): precision (Auto/BF16/Preserve native/Force quant),
qkv streaming (Auto/Off/Forced), Lower VRAM 체크박스.
(`memory_sparse` && !blocked): video attention budget (0.01–1, 기본 0.15), Denser early/late steps 체크박스.

**그래프 배치**: 블록 캐시 뒤, Spectrum 래퍼 안 (H3-Optimizations 노드는 order-independent, prepare-sampling에서
reconcile). 체인: `... → H3MemoryOptimization → H3SparseAttention → ...`.
`H3MemoryOptimization` inputs에 legacy hidden 슬롯(`fused_qkv`/`preserve_precision`/`embedding_memory_mode`)을
넣어야 API 그래프 검증 통과.

**Fused Modulation 과의 관계** (게이팅 아님 — 참고): Fused Modulation 도 `blocks.{i}.forward` 를 패치함
→ H3 Memory Opt 의 MLP chunking 이 그 블록들에선 비활성 (로그만, 비치명적). FinalLayer / embedding 절약은
계속 적용. 두 개 같이 켜도 되지만 MLP chunking 이득은 사라짐.

**메타/Reuse**: 클립 메타에 `h3Optimizer` (+ `memory_sparse` 일 때 `h3SparseBudget`); `applyClipSettings` 복원.

**설치**: `install_comfyui_dependencies.bat` REPOS + ALT 폴더 `h3-optimizations` (pip deps 없음).
availability 리스트: 웹 `api.ts` `MMH3_OPTIONAL_NODES` + 노드 양쪽에 `H3MemoryOptimization` / `H3SparseAttention`.

---

## Part 1 — 패치 계층 감사 결과

| 계층 | 훅 | 노드 |
|---|---|---|
| L1 샘플러 래퍼 | `OUTER_SAMPLE` / `PREDICT_NOISE` | Spectrum, H3 Cache, FirstBlockCache |
| L2 블록루프 전체 | `patches_replace["dit"][("block_loop",0)]` | **H3 Cache** |
| L3 블록 개별 | `patches_replace["dit"][("double_block",i)]` | **FirstBlockCache** |
| L4 블록 forward | `add_object_patch("blocks.{i}.forward")` | **Fused Modulation** |
| L5 어텐션 forward | `add_object_patch("blocks.{i}.attn.forward")` | MemEff Sage, Sol(Saganaki22) |
| L6 어텐션 override | `optimized_attention_override` | Sage, SolAttn(kijai), SLA |
| L7 어텐션 함수 | `set_model_optimized_attention` | CK-Attention |
| L8 가중치 | LoRA | Turbo LoRA |

**중요한 발견들:**

- **L1~L4는 중첩 실행되며 서로 충돌하지 않습니다.** 실제 호출 체인을 따라가 확인했습니다:
  `block_loop → _run_blocks → double_block → block() → 패치된 forward`
  (H3 Cache 팩이 `MiniMaxH3Model._forward`를 클래스 레벨에서 monkeypatch하지만, 그 대체
  구현도 `double_block` 디스패치와 `block()` 호출을 그대로 유지합니다.)
- **Fused Modulation은 모든 것과 안전하게 조합됩니다.** `blocks[i].forward`를 패치하지만
  내부에서 `block.adaln_proj(t_emb)`를 **모듈 호출로** 부르기 때문에, Turbo LoRA가
  `adaln_proj.forward`에 심어둔 LoRA 주입이 그대로 살아남습니다. (AdaLN *투영*이 아니라
  그 결과의 *scale/shift 적용*만 fuse합니다.)
- **Spectrum과 블록 캐시는 상보적입니다.** Spectrum은 스텝 전체를 latent 외삽으로 건너뛰고
  (L1), 캐시는 스텝 *안에서* 블록 재계산을 건너뜁니다(L2/L3). 축이 달라 함께 쓸 수 있고,
  실제로 `Sage + MemEff + FirstBlockCache + Spectrum` 조합이 가장 빠른 검증된 세팅입니다.
- **H3 Cache ↔ FirstBlockCache는 배타로 두세요.** 기전이 달라(`block_loop` vs `double_block`)
  서로의 충돌 검사에 안 걸리지만, 같은 근사를 이중으로 적용하게 됩니다.

---

## Part 2 — Turbo가 두 종류이고 요구 어텐션이 정반대

| | larryvrh | lightx2v SLA turbo |
|---|---|---|
| 형태 | 전용 노드 `MiniMaxH3TurboLoRA` (adaln patch + 전용 샘플러) | **일반 LoRA** |
| 스텝 | 4 | 6 (문서 권장) |
| 어텐션 | **dense 전용** (Sage / CK / None) | **SLA 필수** |
| 이유 | 4스텝이라 sparse 근사 오차가 평균화될 여지가 없어 결과가 붕괴 | SLA 커널에 맞춰 distill됨 — 문서: *"the LoRA gives no speedup on its own"*, *"The LoRA's job is to make the model tolerate the sparsity, not to provide it"* |

- lightx2v 권장 sparsity: `0.85`(공식) / `0.90`(SLA 팩에서 검증, ~15% 더 빠름)
- SLA 팩 실측(5090, 768p/15s): dense 44 s/it → 0.85에서 31 → 0.90에서 25 (**1.4~1.75배**)
- SLA 문서: *"Sparsity did NOT drive the speech artefacts on H3 — step count did, so use 6 steps"*

**→ Turbo를 드롭다운(None / larryvrh / lightx2v)으로 만들고, 선택에 따라 어텐션 목록을
게이팅하세요.** lightx2v를 고르면 SLA를 자동 선택 + 잠금.

---

## Part 3 — 제안 UI 구조

노드 쪽에서 채택한 구조입니다. 축 하나 = 컨트롤 하나.

```
▶ Turbo            None | Turbo LoRA (larryvrh) | SLA Turbo (lightx2v)
                   └ LoRA 선택(검색+목록) · strength · steps · low VRAM
▶ 어텐션           백엔드  [None | Sage | CK | SolAttn(kijai) | SLA]      ← L6/L7
                   H3 fwd [None | MemEff Sage | SolAttn(Saganaki22)]      ← L5
▶ 블록 캐시        [None | H3 Cache | FirstBlockCache]                    ← L2/L3
▶ Spectrum         ☑ (독립 — 캐시와 함께 사용 가능)                        ← L1
▶ 모델 패치        ☑ Fused Modulation  ☑ Torch/fp16                       ← L4
▶ 업스케일 / ▶ 연속성 / ▶ 오디오 락 / ▶ Images / ▶ LoRA
STEPS              Turbo 켜지면 비활성 + "Turbo steps 사용 중" 안내
```

**게이팅 규칙** (노드에서는 `attnBlockedReason` / `attnForwardBlockedReason` /
`blockCacheBlockedReason` 세 함수로 구현):

| 상황 | 막히는 것 |
|---|---|
| Turbo = larryvrh | sparse 어텐션 전부(SolAttn kijai, SLA, Sol Saganaki22), 블록 캐시 전부 |
| Turbo = lightx2v | SLA 외 모든 어텐션 백엔드, 블록 캐시 전부 |
| 백엔드 = CK / SolAttn(kijai) / SLA | H3 attn forward 전부(위 ② 이유) |

**UI 원칙**: 못 쓰는 옵션은 **숨기지 말고 회색 + 사유를 드롭다운 라벨에 인라인**으로.
사라지면 버그로 보입니다.

**아코디언**: 좌측 패널이 좁고 옵션이 39개나 되므로 섹션별로 접고, **접힌 상태에서도 헤더에
현재 설정 요약**을 표시(`Sage + MemEff`, `FirstBlockCache · Fast`, `ON`). 펼침 상태는 저장.

---

## Part 4 — 신규 노드 2종 (Saganaki22/ComfyUI-sol-attn)

`git clone https://github.com/Saganaki22/ComfyUI-sol-attn` — 별도 의존성 없음, Triton 필요.

### `MiniMaxH3FusedModulation`
```
inputs: model (MODEL), enabled (BOOLEAN)
output: MODEL
```
AdaLN scale/shift + gated residual을 Triton으로 fuse. **모든 옵션과 조합 가능** — 독립
체크박스로 두세요. 로그 `[MiniMax H3 fusion] patched N of M blocks`에서 `N == M` 확인.

### `MiniMaxH3ScheduledSolAttentionPatch`
```
inputs: model, enabled, tau_start(1.3), tau_end(0.8),
        curve(linear|cosine|sqrt|smoothstep), min_tokens(4096), strict(false),
        dense_percent(0.0), thresh_type(diag|exact), int8_qk(false), int8_pv(false),
        sink_conditioning(exact_kv|exact_kv_and_rows|off), dense_blocks("")
outputs: MODEL, IMAGE(tau_graph)   ← tau_graph는 안 쓰면 미연결로 두면 됨
```
- 이 팩의 `MiniMaxH3MemoryEfficientSolAttentionPatch`의 **완전한 상위호환**입니다
  (`tau_start == tau_end`로 두면 동일 — 코드 경로가 같고 tau만 고정값 vs 스케줄).
  **둘 중 Scheduled 하나만 넣으면 됩니다.**
- 이 팩의 범용 `SolAttentionPatch`는 H3에서 열위(q/k/v 복사 발생, `sink_conditioning` 없음)
  이므로 **넣지 마세요.**
- **순서 주의**: MemEff Sage를 **먼저** 설치하면 Sol이 그걸 fallback으로 자동 채택합니다
  (소스 주석: *"adopt an earlier node's attn.forward patch (e.g. a memory-efficient sage
  patch) as the fallback"*). 이 조합은 의도된 스택입니다.

---

## Part 5 — 마이그레이션 (필수)

노드 쪽은 예전에 `accelMode` 하나에 `turbo/solattn/spectrum/none`이 뭉쳐 있었고 어텐션·캐시는
별개 불리언이었습니다. 저장된 워크플로우가 초기화되지 않도록 **로드 시 1회 변환**합니다:

```
accelMode "turbo"    → turboMode = "larryvrh"
accelMode "spectrum" → useSpectrum = true
accelMode "solattn"  → attnBackend = "solattn_kijai"
useSlaAttention      → attnBackend = "sla"   (SLA가 실제로 이기고 있었으므로 그대로 반영)
useCkAttention/useSageAttn → attnBackend = "ck" / "sage"
useMemEffSage        → attnForward = "memeff_sage"
useFirstBlockCache / useCache → blockCache = "fbcache" / "h3cache"
```
`pipelineMigrated` 플래그로 1회만 실행. 웹 버전의 기존 저장 구조에 맞춰 같은 취지로 구현해
주세요.

---

## Part 6 — 함께 고친 버그

**생성 완료 후 프리뷰가 결과 영상으로 안 바뀌던 문제** — KJ 프리뷰 인코더가
`_AsyncPreviewEncoder`(daemon thread + Queue)라 `execution_success` **이후에도 프레임이 도착**
합니다. 그게 이미 표시된 결과 영상을 덮고, `<video loop>`라 무한 재생됩니다(One-Take 스티치
결과 포함).

**수정**: 최종 결과를 표시할 때 프리뷰 박스를 잠그고(`previewLocked`), 늦게 온 프레임은 무시.
런 종료 시 마지막 결과를 한 번 더 확정 표시. 웹 버전도 같은 구조면 동일 증상이 있을 겁니다.

---

## 영향 파일 (노드 → 웹 매핑)

| 노드 | 웹 |
|---|---|
| `web/minimax/core_minimax.js` | `src/tools/minimax_h3/core.ts` — 상태 필드, 게이팅 함수, 마이그레이션 |
| `web/minimax/graph_builder_minimax.js` | `graphBuilder.ts` — 축별 배선, 실행 순서 |
| `web/one_node_minimax_h3.js` | `view.ts` — 아코디언 패널, 프리뷰 잠금 |
| `web/minimax/ui_app_settings_minimax.js` | `settings.ts` — 이동한 항목 제거 |
