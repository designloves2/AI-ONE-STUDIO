// core.ts — ITDA Studio state model. Ported (structurally, not code-for-code) from
// web/itda_studio/itda_app_ported.js in ComfyUI-TJ_NODE_STUDIO_ONE. Project/track/clip shapes
// mirror what itda_studio_backend/project.py persists so save/load round-trips losslessly.
import * as api from "./api";
import type { ItdaProject, MediaItem, RenderMode } from "./api";

export interface ItdaClip {
  id: string;
  media_path: string;
  kind: "video" | "audio" | "image" | "stitched";
  track: number;
  start: number; // timeline frame where the clip begins
  duration: number; // frames on the timeline (post-trim)
  source_in: number; // trim-in, source frames
  source_out: number; // trim-out, source frames
  fps?: number;
  label?: string;
  // ── stitch (🧵) — a "stitched" clip is a plain layer container, not a real media
  // clip: it has no media_path of its own, just its original children preserved so
  // 🪢 UnStitch can restore them at their exact original track/start. Structurally
  // mirrors itda_app_ported.js's stitchSelected()/unstitchSelected() (children carry
  // orig_start/orig_track instead of a source file).
  children?: ItdaClip[];
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
  // scrollLeft of the timeline scroll container at drag-start — needed so the
  // autoscroll-while-dragging-near-an-edge feature (view.ts) can fold its own
  // scroll movement back into the drag delta, matching itda_app_ported.js's
  // onClipPointer scrollDelta term.
  startScrollLeft: number;
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
  // Multi-select (ctrl/shift-click, view.ts) — Stitch needs 2+ clips at once. Properties
  // panel and single-clip actions (trim/split/snapshot) keep using selectedClipId, which
  // view.ts always sets to the most-recently-clicked clip.
  selectedClipIds: Set<string> = new Set();
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

  // Topmost video/image clip covering `frame` — later tracks occlude earlier
  // ones (same "higher track wins" rule as the node's lane-priority preview
  // compositor), used to drive the scrub/preview <video> element in view.ts.
  clipAtFrame(frame: number): ItdaClip | null {
    for (let i = this.tracks.length - 1; i >= 0; i--) {
      for (const c of this.tracks[i].clips) {
        if ((c.kind === "video" || c.kind === "image") && frame >= c.start && frame < c.start + c.duration) return c;
      }
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

  // ── ✂ Split — cut the selected clip at the current playhead frame into two clips on the
  // same track. Structural port of itda_app_ported.js's splitSelected() (pure local edit, no
  // backend call — same as the node). No-op if the playhead isn't strictly inside the clip.
  splitSelectedAtPlayhead(): boolean {
    if (!this.selectedClipId) return false;
    const found = this.findClip(this.selectedClipId);
    if (!found) return false;
    const { track, clip } = found;
    if (clip.kind === "stitched") return false;
    const end = clip.start + clip.duration;
    if (this.playhead <= clip.start || this.playhead >= end) return false;
    const leftLen = this.playhead - clip.start;
    const rightLen = end - this.playhead;
    const left: ItdaClip = { ...clip, id: `clip_${Date.now()}_L`, duration: leftLen, source_out: clip.source_in + leftLen };
    const right: ItdaClip = {
      ...clip,
      id: `clip_${Date.now()}_R`,
      start: this.playhead,
      duration: rightLen,
      source_in: clip.source_in + leftLen,
      source_out: clip.source_in + leftLen + rightLen,
    };
    const i = track.clips.findIndex((c) => c.id === clip.id);
    track.clips.splice(i, 1, left, right);
    this.selectedClipId = right.id;
    this.selectedClipIds = new Set([right.id]);
    this.dirty = true;
    return true;
  }

  // ── 🧵 Stitch — combine 2+ selected clips (any track) into one "stitched" layer container
  // spanning their min-start..max-end, children preserved verbatim (own track/start intact)
  // so 🪢 UnStitch can restore them exactly. Structural port of stitchSelected(). The
  // container is placed on the lowest track among the selected clips' tracks, matching the
  // node's `lane=Math.min(...cs.map(c=>c.lane))`.
  stitchSelected(): ItdaClip | null {
    const picked: { track: ItdaTrack; clip: ItdaClip }[] = [];
    for (const id of this.selectedClipIds) {
      const found = this.findClip(id);
      if (found && found.clip.kind !== "stitched") picked.push(found);
    }
    if (picked.length < 2) return null;
    const minStart = Math.min(...picked.map((p) => p.clip.start));
    const maxEnd = Math.max(...picked.map((p) => p.clip.start + p.clip.duration));
    const minTrackIdx = Math.min(...picked.map((p) => p.track.index));
    const children = picked.map((p) => ({ ...p.clip }));
    const stitched: ItdaClip = {
      id: `stitched_${Date.now()}`,
      media_path: "",
      kind: "stitched",
      track: minTrackIdx,
      start: minStart,
      duration: maxEnd - minStart,
      source_in: 0,
      source_out: maxEnd - minStart,
      label: `Stitched Clip (${picked.length})`,
      children,
    };
    for (const { track, clip } of picked) {
      const i = track.clips.findIndex((c) => c.id === clip.id);
      if (i >= 0) track.clips.splice(i, 1);
    }
    const hostTrack = this.tracks.find((t) => t.index === minTrackIdx) || this.tracks[0];
    hostTrack.clips.push(stitched);
    this.selectedClipId = stitched.id;
    this.selectedClipIds = new Set([stitched.id]);
    this.dirty = true;
    return stitched;
  }

  // ── 🪢 UnStitch — reverse: drop the selected "stitched" container's children back onto
  // their own original tracks at their own original start. Structural port of
  // unstitchSelected().
  unstitchSelected(): boolean {
    if (!this.selectedClipId) return false;
    const found = this.findClip(this.selectedClipId);
    if (!found || found.clip.kind !== "stitched" || !found.clip.children?.length) return false;
    const { track: hostTrack, clip: stitched } = found;
    const i = hostTrack.clips.findIndex((c) => c.id === stitched.id);
    if (i >= 0) hostTrack.clips.splice(i, 1);
    const restoredIds: string[] = [];
    for (const child of stitched.children || []) {
      const dest = this.tracks.find((t) => t.index === child.track) || hostTrack;
      dest.clips.push(child);
      restoredIds.push(child.id);
    }
    this.selectedClipId = restoredIds[0] || null;
    this.selectedClipIds = new Set(restoredIds);
    this.dirty = true;
    return true;
  }

  // ── ▣ Snapshot candidate — the clip under the playhead on the topmost (highest-index)
  // video/image-bearing track, preferring the current selection when it qualifies. Mirrors
  // snapshotClipCandidate()/topVisualClip() (node picks the top-most visual lane; here
  // "topmost" = highest track index, since tracks render top-to-bottom by index in view.ts).
  snapshotCandidate(): ItdaClip | null {
    if (this.selectedClipId) {
      const found = this.findClip(this.selectedClipId);
      if (found && found.clip.kind !== "stitched" && found.clip.kind !== "audio") {
        const { clip } = found;
        if (this.playhead >= clip.start && this.playhead < clip.start + clip.duration) return clip;
      }
    }
    let best: ItdaClip | null = null;
    let bestTrackIndex = -1;
    for (const t of this.tracks) {
      for (const c of t.clips) {
        if (c.kind === "audio" || c.kind === "stitched") continue;
        if (this.playhead >= c.start && this.playhead < c.start + c.duration && t.index > bestTrackIndex) {
          best = c;
          bestTrackIndex = t.index;
        }
      }
    }
    return best;
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
