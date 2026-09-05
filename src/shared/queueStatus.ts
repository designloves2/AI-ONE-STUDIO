// queueStatus.ts — ComfyUI's real /queue counts. Used by the standalone gallery page so a
// user browsing there still sees when another screen (or a pre-refresh job) is generating.
// The per-tool views keep their own richer poll (they also match a prompt_id).
import { getComfyBase } from "./comfyBase";

export async function getQueueCounts(): Promise<{ running: number; pending: number }> {
  try {
    const r = await fetch(`${getComfyBase()}/queue`, { credentials: "include" });
    if (!r.ok) return { running: 0, pending: 0 };
    const d = await r.json();
    return { running: (d.queue_running || []).length, pending: (d.queue_pending || []).length };
  } catch {
    return { running: 0, pending: 0 };
  }
}
