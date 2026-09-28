# SPEC — 프롬프트 템플릿 저장소를 노드 쪽과 동일하게 맞추기

## 배경

`ComfyUI-TJ_NODE_STUDIO_ONE` v1.13.0에서 커스텀("MY TEMPLATES") 프롬프트 템플릿 저장소를
Klein의 `config_klein.json`에 얹혀사는 방식에서 완전히 독립된 공용 저장소로 분리했다.
이 웹사이트(AI ONE STUDIO)도 **반드시 같은 저장소를 같은 방식으로 읽고 써야** 한다 —
웹에서 저장한 템플릿이 ComfyUI 노드에서도 보이고 그 반대도 성립해야 하기 때문이다
(이게 원래 이 사이트 존재 이유이자 이번 분리 작업의 계기였다). 웹만 따로 고치면
동기화가 깨진다.

## 노드 쪽 최종 아키텍처 (그대로 미러링할 것)

**백엔드** (ComfyUI-TJ_NODE_STUDIO_ONE의 `nodes.py`, 이미 배포됨 — 이 저장소는 그 서버에
붙어서 도는 클라이언트이므로 백엔드 코드는 건드릴 필요 없음, 아래는 참고용):

```
GET  /shared/prompt_templates?pool=nl|tag   → { "templates": [...] }
POST /shared/prompt_templates?pool=nl|tag   body: { "templates": [...] }  → { "ok": true }
```

- **nl 풀** (자연어 프롬프트): Klein · Krea2 · Z-Image · Qwen2511 · Anima 5개 도구가
  전부 이 하나의 목록을 공유한다.
- **tag 풀** (태그/가중치 방식 프롬프트): SDXL 전용, nl 풀과 완전히 분리.
- 저장 파일은 어느 한 도구의 `config_*.json`이 아니라 독립 파일
  (`templates_prompt_nl.json` / `templates_prompt_tag.json`).

**프론트엔드** (`ComfyUI-TJ_NODE_STUDIO_ONE/web/`, 원본 노드 UI):

- 새 공용 모듈 `web/shared/api_templates.js`:
  ```js
  export async function getTemplates(pool) { … GET /shared/prompt_templates?pool=${pool} … }
  export async function saveTemplates(pool, templates) { … POST 같은 URL, body { templates } … }
  ```
- `web/klein/ui_prompt_templates.js`의 `createTemplateOverlay(state, ctx, onApply, pool = "nl")`가
  네 번째 인자로 풀 이름을 받는다. Klein 자기 자신을 포함해 Krea2/Z-Image/Qwen2511/Anima
  전부 이 파일을 `pool="nl"`로 호출하고, SDXL만 `pool="tag"`로 호출한다.
- Z-Image가 따로 갖고 있던 사본(`web/zimage/ui_prompt_templates.js`)은 삭제되고
  Klein 파일을 그대로 쓰도록 바뀌었다.

## 지금 이 웹사이트(AI_One_Studio)의 현재 상태 (문제)

`src/tools/{klein,krea2,qwen2511,zimage,anima}/promptTools.ts` 5개 파일 전부, 커스텀
템플릿을 각자 **자기 도구 전용** `getConfig()`/`saveConfig()`로 저장하고 있다
(`src/tools/<tool>/api.ts`, 각자 다른 백엔드 라우트: `/flux_klein/config`,
`/krea2_one/config`, `/qwen2511_one/config`, `/z_image_turbo/config`,
`/anima_one/config`). 5개 파일 모두 다음과 똑같은 패턴:

```ts
function saveCustom() { saveConfig({ t2i_templates: customTemplates }).catch(() => {}); }
...
getConfig().then((cfg) => {
  customTemplates = Array.isArray(cfg.t2i_templates) ? cfg.t2i_templates : [];
  ...
});
```

이건 노드 쪽의 **예전(v1.12 이전) 방식**과 같다 — Klein/Krea2/Qwen2511은 우연히 같은
파일(`config_klein.json`)을 공유해서 동기화가 됐었지만, Z-Image와 Anima는 이미 그때도
분리돼 있었다. 지금 노드 쪽은 전부 `/shared/prompt_templates?pool=nl|tag`로 바뀌었으므로,
**웹사이트를 고치지 않으면 웹 ↔ 노드 템플릿이 서로 다르게 보인다.**

## 해야 할 변경

### 1. 신규 공용 API 모듈 추가

`src/shared/promptTemplatesApi.ts` (신규 파일, 어느 한 tool 폴더에도 속하지 않음):

```ts
// promptTemplatesApi.ts — 커스텀 프롬프트 템플릿, 특정 tool의 config가 아니라
// ComfyUI-TJ_NODE_STUDIO_ONE nodes.py의 /shared/prompt_templates 공용 저장소를 직접 씀.
// nl 풀(자연어): Klein/Krea2/Z-Image/Qwen2511/Anima 공유. tag 풀(태그): SDXL 전용.
import { getComfyBase } from "./comfyBase";

export type TemplatePool = "nl" | "tag";

export interface PromptTemplate {
  name: string;
  prompt: string;
}

export async function getTemplates(pool: TemplatePool): Promise<PromptTemplate[]> {
  try {
    const r = await fetch(`${getComfyBase()}/shared/prompt_templates?pool=${pool}`);
    const d = await r.json();
    return Array.isArray(d.templates) ? d.templates : [];
  } catch {
    return [];
  }
}

export async function saveTemplates(pool: TemplatePool, templates: PromptTemplate[]): Promise<void> {
  await fetch(`${getComfyBase()}/shared/prompt_templates?pool=${pool}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templates }),
  }).catch(() => {});
}
```

`getComfyBase()`는 이미 `src/shared/comfyBase.ts`에 있으니 그대로 재사용 — 이 새 모듈은
어느 tool의 `comfyClient`에도 의존하지 않는다(공용 엔드포인트라서 tool별 clientId/웹소켓과
무관).

### 2. 5개 promptTools.ts 수정 — nl 풀

`src/tools/klein/promptTools.ts`, `krea2/promptTools.ts`, `qwen2511/promptTools.ts`,
`zimage/promptTools.ts`, `anima/promptTools.ts` — 5개 파일 전부 동일하게:

- `import { getConfig, saveConfig } from "./api";` 대신 (또는 추가로)
  `import { getTemplates, saveTemplates } from "../../shared/promptTemplatesApi";`
- `saveCustom()`:
  ```ts
  function saveCustom() { saveTemplates("nl", customTemplates).catch(() => {}); }
  ```
- 로드하는 부분:
  ```ts
  getTemplates("nl").then((templates) => {
    customTemplates = templates;
    ...
  });
  ```
- 이 도구들의 `getConfig()`/`saveConfig()` 자체는 그대로 둔다 — 모델 선택 등 다른 설정은
  계속 그 라우트를 쓴다. **`t2i_templates` 필드만** 빠지는 것.

### 3. SDXL — 아직 이 사이트에 템플릿 기능 자체가 없음

`src/tools/sdxl/promptTools.ts`가 없다 (원본 노드에 있는 템플릿 UI가 웹에는 아직
포팅 안 됨). 지금 당장 급한 건 아니지만, 나중에 포팅할 때는 처음부터
`saveTemplates("tag", ...)` / `getTemplates("tag")`로 붙여서 nl 풀과 섞이지 않게 할 것.

### 4. 마이그레이션 관련 — 신경 안 써도 됨

기존 사용자 템플릿 병합·중복 제거는 **백엔드(nodes.py)가 서버 최초 기동 시 1회** 이미
처리했다(`/shared/prompt_templates` 최초 GET 시 `config_klein.json` +
`config_zimage.json`의 옛 `t2i_templates`를 합쳐서 `templates_prompt_nl.json`에 시딩).
웹사이트 쪽에서 별도로 마이그레이션 로직을 짤 필요 없음 — 그냥 새 엔드포인트를 호출하면
이미 병합된 최신 목록이 온다.

## 확인 방법

1. ComfyUI를 켜고 웹사이트에서 Klein 템플릿 하나 새로 저장
2. 실제 ComfyUI 캔버스에서 `Krea 2 ONE STUDIO (TJ)` 노드를 열어 📋 Templates에서 방금
   저장한 항목이 보이는지 확인 (nl 풀 공유 확인)
3. 웹사이트에서 SDXL 쪽(포팅되면) 템플릿을 저장해도 위 nl 풀 목록에 안 섞이는지 확인
