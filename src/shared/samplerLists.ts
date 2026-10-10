// samplerLists.ts — Sampler / scheduler choices for the image tools: ComfyUI's own full lists, read once per page
// load from the KSampler node definition (new samplers added to ComfyUI show up without touching this app).
// The short lists are only a fallback for when /object_info can't be read.
// Port of ComfyUI-TJ_NODE_STUDIO_ONE/web/shared/sampler_lists.js (node bd435ee). Z-Image keeps its own
// getKSamplerOptions() (same source), MiniMax H3 / music have their own lists and are not image tools.
import { getComfyBase } from "./comfyBase";

const FALLBACK_SAMPLERS = ["euler", "euler_ancestral", "heun", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "dpm_adaptive",
  "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_sde", "er_sde", "uni_pc", "ddim"];
const FALLBACK_SCHEDULERS = ["simple", "normal", "karras", "exponential", "sgm_uniform", "beta", "ddim_uniform"];

async function readLists(): Promise<{ samplers: string[]; schedulers: string[]; fromServer: boolean }> {
  try {
    const r = await fetch(`${getComfyBase()}/object_info/KSampler`, { credentials: "include" });
    const req = (await r.json()).KSampler.input.required;
    const samplers: string[] = req.sampler_name[0], schedulers: string[] = req.scheduler[0];
    if (samplers.length && schedulers.length) return { samplers, schedulers, fromServer: true };
  } catch { /* use the fallback lists */ }
  return { samplers: FALLBACK_SAMPLERS, schedulers: FALLBACK_SCHEDULERS, fromServer: false };
}

const lists = await readLists();
export const SAMPLERS: string[] = lists.samplers;
export const SCHEDULERS: string[] = lists.schedulers;
/** true when the lists came from ComfyUI (not the short fallback) — Z-Image keeps its own fallback when false. */
export const LISTS_FROM_SERVER = lists.fromServer;

/** The list with a saved value kept selectable: a saved sampler / scheduler that is not in the list still
 *  displays (and is never silently reset to the first entry). */
export function withCurrent(list: string[], value: string | undefined | null): string[] {
  return !value || list.includes(value) ? list : [value, ...list];
}
