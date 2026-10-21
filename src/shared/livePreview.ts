// livePreview.ts — live sampling preview for the ONE STUDIO image tools.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/shared/live_preview.js (node 73001e5+) — 동작 1:1 이식.
//
// ModelPreviewOverrideKJ (KJNodes) is put in front of every sampler's model and streams the decoded latent to the
// frontend over the `kj_preview_override` socket event, tagged with the KJ node's own graph id. The id is derived
// from the tool id so two tools never pick up each other's frames. No colon in it: ComfyUI reads `parent:child` as a
// dynamic-expansion path and hands back a truncated hidden.unique_id.

/** The slice of a tool's comfyClient (`comfyApi`) this helper needs. */
export interface PreviewApi {
  addEventListener(type: string, fn: (ev: any) => void): void;
  removeEventListener(type: string, fn: (ev: any) => void): void;
  fetchApi(path: string, opts?: RequestInit): Promise<Response>;
}

export const previewKey = (instanceId: string) => `ONE_preview_${instanceId}`;

const availability = new WeakMap<object, Promise<boolean>>();
function hasPreviewNode(api: PreviewApi): Promise<boolean> {
  let p = availability.get(api);
  if (!p) {
    p = api.fetchApi("/object_info/ModelPreviewOverrideKJ").then((r) => r.ok, () => false);
    availability.set(api, p);
  }
  return p;
}

/** Put the preview node in front of every sampler's model in the graph about to be queued (no-op without KJNodes). */
export async function addLivePreview(graph: Record<string, any>, instanceId: string, api: PreviewApi): Promise<void> {
  if (!(await hasPreviewNode(api))) return;
  const key = previewKey(instanceId);
  const links = new Map<string, string>(); // one preview node per distinct model link
  for (const node of Object.values(graph)) {
    const model = node?.inputs?.model;
    if (!/Sampler/.test(node?.class_type ?? "") || !Array.isArray(model)) continue;
    const linkKey = model.join();
    if (!links.has(linkKey)) {
      const id = `${key}_${links.size}`;
      links.set(linkKey, id);
      graph[id] = {
        class_type: "ModelPreviewOverrideKJ",
        inputs: { model, max_resolution: 1024, jpeg_quality: 100, suppress_default_preview: true, preview_frames: 1, preview_fps: 1 },
      };
    }
    node.inputs.model = [links.get(linkKey), 0];
  }
}

/** Frames of this tool's run through onFrame(dataUrl, step, total); returns the stop function. */
export function listenLivePreview(instanceId: string, api: PreviewApi, onFrame: (url: string, step?: number, total?: number) => void): () => void {
  const prefix = `${previewKey(instanceId)}_`;
  // The image tools' comfyClient hands the socket payload itself to listeners; the H3 / LTX clients wrap it as { detail }.
  const handler = (ev: any) => {
    const d = (ev && typeof ev === "object" && "detail" in ev ? ev.detail : ev) || {};
    if (!String(d.node_id).startsWith(prefix) || !d.image) return;
    onFrame(`data:${d.mime || "image/jpeg"};base64,${d.image}`, d.step, d.total);
  };
  api.addEventListener("kj_preview_override", handler);
  return () => api.removeEventListener("kj_preview_override", handler);
}

const bars = new WeakMap<HTMLElement, { root: HTMLElement; fill: HTMLElement; text: HTMLElement }>();

/** "Preview [n/total]" strip along the bottom of the preview box: black 50% overlay with a step progress bar. */
export function showStepBar(box: HTMLElement, step: number, total: number) {
  let bar = bars.get(box);
  if (!bar) {
    const mk = (css: string, parent?: HTMLElement) => { const e = document.createElement("div"); e.style.cssText = css; parent?.appendChild(e); return e; };
    const root = mk("position:absolute;left:0;right:0;bottom:0;height:22px;background:rgba(0,0,0,0.5);z-index:11;pointer-events:none;overflow:hidden");
    const fill = mk("position:absolute;left:0;top:0;bottom:0;width:0;background:rgba(167,139,250,0.55);transition:width .2s", root);
    const text = mk("position:absolute;right:8px;top:0;bottom:0;display:flex;align-items:center;color:#fff;font:600 11px/1 sans-serif", root);
    bar = { root, fill, text };
    bars.set(box, bar);
  }
  if (bar.root.parentNode !== box) box.appendChild(bar.root);
  bar.fill.style.width = `${Math.min(100, (step / total) * 100)}%`;
  bar.text.textContent = `Preview [${step}/${total}]`;
}

/** Remove the strip once the final image is shown (or the run ended). */
export function hideStepBar(box: HTMLElement) {
  bars.get(box)?.root.remove();
}
