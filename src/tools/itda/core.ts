// core.ts — ITDA Studio state model. Ported (structurally, not code-for-code) from
// web/itda_studio/itda_app_ported.js in ComfyUI-TJ_NODE_STUDIO_ONE. Project/track/clip shapes
// mirror what itda_studio_backend/project.py persists so save/load round-trips losslessly.
import * as api from "./api";
import type { ItdaProject, MediaItem, RenderMode } from "./api";

export interface ItdaClip {
  id: string;
  media_path: string;
  kind: "video" | "audio" | "image";
  track: number;
  start: number; // timeline frame where the clip begins
  duration: number; // frames on the timeline (post-trim)
  source_in: number; // trim-in, source frames
  source_out: number; // trim-out, source frames
  fps?: number;
  label?: string;
}

export interface ItdaTrack {
  index: number;
  kind: "video" | "audio";
  clips: ItdaClip[];
}

export interface DragState {
  clipId: string;
  mode: "move" | "trim-left" | "trim-right";
  startX: number;
  origStart: number;
  origSourceIn: number;
  origSourceOut: number;
  origDuration: number;
}

export const DEFAULT_FPS = 24;
export const DEFAULT_TOTAL_FRAMES = 24 * 60 * 5; // 5 min ceiling until a project sets its own

export class ItdaState {
  project = "itda-project-1";
  fps = DEFAULT_FPS;
  totalFrames = DEFAULT_TOTAL_FRAMES;
  tracks: ItdaTrack[] = [{ index: 0, kind: "video", clips: [] }, { index: 1, kind: "audio", clips: [] }];
  media: MediaItem[] = [];
  playhead = 0;
  selectedClipId: string | null = null;
  zoomPxPerFrame = 2;
  snap = true;
  dirty = false;

  // Real last-clip end across all tracks — export/prerender length and the Properties panel's
  // "End Frame" jump both use this instead of stretching to Total Frames (export.py §content_end).
  contentEnd(): number {
    let end = 0;
    for (const t of this.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.duration);
    return end;
  }

  addTrack(kind: "video" | "audio") {
    const index = this.tracks.length;
    this.tracks.push({ index, kind, clips: [] });
    this.dirty = true;
  }

  findClip(id: string): { track: ItdaTrack; clip: ItdaClip } | null {
    for (const t of this.tracks) {
      const c = t.clips.find((c) => c.id === id);
      if (c) return { track: t, clip: c };
    }
    return null;
  }

  addClip(trackIndex: number, media: MediaItem, startFrame: number): ItdaClip | null {
    const track = this.tracks[trackIndex];
    if (!track) return null;
    const fps = media.fps || this.fps;
    const durationFrames = Math.max(1, Math.round((media.duration || 1) * fps));
    const clip: ItdaClip = {
      id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      media_path: media.path,
      kind: (media.kind as any) || "video",
      track: trackIndex,
      start: Math.max(0, startFrame),
      duration: durationFrames,
      source_in: 0,
      source_out: durationFrames,
      fps,
      label: media.name || media.path.split(/[\\/]/).pop(),
    };
    this.clampToTotalFrames(clip);
    track.clips.push(clip);
    this.dirty = true;
    return clip;
  }

  removeClip(id: string) {
    for (const t of this.tracks) {
      const i = t.clips.findIndex((c) => c.id === id);
      if (i >= 0) {
        t.clips.splice(i, 1);
        this.dirty = true;
        return;
      }
    }
  }

  // Clips whose start+duration runs past Total Frames auto-clamp (node behavior) — trims the
  // tail rather than silently rendering short or erroring at export time.
  clampToTotalFrames(clip: ItdaClip) {
    const maxEnd = this.totalFrames;
    if (clip.start >= maxEnd) {
      clip.start = Math.max(0, maxEnd - 1);
    }
    const overshoot = clip.start + clip.duration - maxEnd;
    if (overshoot > 0) {
      clip.duration = Math.max(1, clip.duration - overshoot);
      clip.source_out = clip.source_in + clip.duration;
    }
  }

  // ── snap: cross-track candidate edges (other clips' start/end only) ────────────────────────
  // Ported node-for-node from snapMoveStart/snapEdge in itda_app_ported.js (lines 569-609):
  // threshold is `Math.max(4, 14/pxPerFrame)` frames (a floor of 4 frames, not a raw px/zoom
  // ratio), candidates come ONLY from other clips' start/end across ALL tracks (cross-track,
  // per user: "스냅은 동일트랙만이 아니고 아래 위 트랙도 인식하게해줘") — the node does NOT
  // snap to the playhead, 0, or totalFrames for either move or trim drags. Peak/beat-match
  // candidates (state.peakSnap, from cached waveform + detected beats) are a separate,
  // not-yet-ported feature — left out here, tracked in PORT_LEDGER.md.
  private snapThresholdFrames(): number {
    return Math.max(4, 14 / this.zoomPxPerFrame);
  }

  private otherClipEdges(excludeClipId: string): { start: number; end: number }[] {
    const out: { start: number; end: number }[] = [];
    for (const t of this.tracks) {
      for (const c of t.clips) {
        if (c.id === excludeClipId) continue;
        out.push({ start: c.start, end: c.start + c.duration });
      }
    }
    return out;
  }

  // Public snap entry point for a brand-new (not-yet-placed) clip's drop position — same
  // threshold/candidate rules as snapEdge (no length offset, since there's no clip yet).
  snapFrame(proposedFrame: number, excludeClipId: string): number {
    if (!this.snap) return Math.round(proposedFrame);
    const threshold = this.snapThresholdFrames();
    let best: number | null = null;
    let bestDist = Infinity;
    for (const o of this.otherClipEdges(excludeClipId)) {
      for (const cand of [o.start, o.end]) {
        const d = Math.abs(cand - proposedFrame);
        if (d <= threshold && d < bestDist) {
          bestDist = d;
          best = cand;
        }
      }
    }
    return best != null ? Math.round(best) : Math.round(proposedFrame);
  }

  // Move-drag: snap the CLIP'S START, matching against both start-aligned and end-aligned
  // (start - length / end - length) candidates in one pass — mirrors node's snapMoveStart.
  snapMoveStart(clip: ItdaClip, proposedStart: number): number {
    if (!this.snap) return Math.round(proposedStart);
    const threshold = this.snapThresholdFrames();
    const length = clip.duration;
    let bestEdge: number | null = null;
    let bestDist = Infinity;
    for (const o of this.otherClipEdges(clip.id)) {
      for (const cand of [o.start, o.end, o.start - length, o.end - length]) {
        const d = Math.abs(cand - proposedStart);
        if (d <= threshold && d < bestDist) {
          bestDist = d;
          bestEdge = cand;
        }
      }
    }
    return bestEdge != null ? Math.max(0, Math.round(bestEdge)) : Math.max(0, Math.round(proposedStart));
  }

  // Trim-drag: snap the edge being dragged to another clip's plain start/end (no length offset)
  // — mirrors node's snapEdge.
  snapEdge(clip: ItdaClip, _edge: "left" | "right", proposedFrame: number): number {
    if (!this.snap) return Math.round(proposedFrame);
    const threshold = this.snapThresholdFrames();
    let best: number | null = null;
    let bestDist = Infinity;
    for (const o of this.otherClipEdges(clip.id)) {
      for (const cand of [o.start, o.end]) {
        const d = Math.abs(cand - proposedFrame);
        if (d <= threshold && d < bestDist) {
          bestDist = d;
          best = cand;
        }
      }
    }
    return best != null ? Math.round(best) : Math.round(proposedFrame);
  }

  async loadProject(name: string) {
    const res = await api.getProject(name);
    this.applyProject(res.project);
  }

  applyProject(p: ItdaProject) {
    this.project = p.name || this.project;
    this.fps = p.fps || DEFAULT_FPS;
    this.totalFrames = p.total_frames || DEFAULT_TOTAL_FRAMES;
    if (Array.isArray(p.tracks) && p.tracks.length) {
      this.tracks = p.tracks as ItdaTrack[];
    }
    this.dirty = false;
  }

  toProject(): ItdaProject {
    return {
      name: this.project,
      fps: this.fps,
      total_frames: this.totalFrames,
      tracks: this.tracks,
    };
  }

  async save() {
    await api.saveProject(this.project, this.toProject());
    this.dirty = false;
  }

  async refreshMedia() {
    const res = await api.getMedia(this.project);
    this.media = res.items || [];
  }

  async render(mode: RenderMode) {
    await this.save();
    return api.renderToGallery(this.project, mode);
  }
}
