// promptTemplatesApi.ts — 커스텀 프롬프트 템플릿, 특정 tool의 config가 아니라
// ComfyUI-TJ_NODE_STUDIO_ONE nodes.py의 /shared/prompt_templates 공용 저장소를 직접 씀.
// nl 풀(자연어): Klein/Krea2/Z-Image/Qwen2511/Anima 공유. tag 풀(태그): SDXL 전용.
// 원본 근거: SPEC_PROMPT_TEMPLATE_SYNC.md (ComfyUI-TJ_NODE_STUDIO_ONE v1.13.0에서 전달됨).
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
