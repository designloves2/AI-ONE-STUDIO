# SPEC — MiniMax H3: Continue-a-clip, gallery Extend, full user presets

Node side shipped in **ComfyUI-TJ_NODE_STUDIO_ONE v1.21.0**. Port to the web twin.
As always: this doc carries the **why + traps**; read the **node source** for what to build.
Verify in a browser with a real (tiny) render, not just a syntax check.

Node files touched: `web/minimax/ui_prompt_edit_minimax.js`, `web/minimax/ui_gallery_minimax.js`,
`web/minimax/ui_video_picker_minimax.js`, `web/minimax/api_minimax.js`,
`web/minimax/presets_minimax.js`, `web/one_node_minimax_h3.js`, `nodes.py`.

---

## 1. Backend route — `POST /minimax_h3_one/clip_last_frame`

`nodes.py` (`mmh3_clip_last_frame`). Body `{filename, subfolder}` of a rendered clip →
finds `frames/<stem>_last*.png` next to it (strip SaveVideo's trailing `_NNNNN_` off the
stem first), else extracts the final frame with ffmpeg (`-sseof -1 -update 1`), copies it
to `input/`, returns `{ok, filename}`. Web `api_minimax`: `getClipLastFrame(filename, subfolder)`.

## 2. Prompt Edit — "Continue generating the clip"

The per-prompt first-frame slot (`fiRow`): label `▶ Continue generating the clip.`
(→ `Continuing from: <file>` once set), button `Select from the gallery`, `✕` = clear.

Button opens the gallery clip picker in **frame mode** (`openVideoGalleryPicker(onPick, {mode:"frame"})`
— same picker as reference-video, but calls `getClipLastFrame` instead of `copy_to_input`,
and `onPick(inputFilename, clipItem)`).

On pick:
- **Snapshot** every prompt's `enabled` into `state._resumeSnapshot` (once — don't overwrite).
- `state.prompts[selected].firstFrame = inputFilename`.
- clips **before** `selected` → `enabled = false`; `selected` and after → `enabled = true`.
- The "override for this clip" checkbox is greyed (`disabled`) for any clip with `enabled === false`.

On `✕` (clear): `firstFrame = ""`; if `_resumeSnapshot` exists, restore each `enabled` from it
and delete the snapshot. **Also delete `state._resumeSnapshot` when a prompt set is loaded**
(the list changed, the snapshot is meaningless).

**Why:** resuming a stopped multi-clip run. The prompt-list side already works (save the N
prompts as a set, reload, untick 1–3, run). The only gap was seeding clip 4 — previously a
manual upload of `output/one_minimax_h3/frames/MMH3_clipNNN_last_*.png`. The entry whose
button you clicked **is** the resume point — no clip-number matching.

## 3. Gallery — `Extend`

Card action bar goes from 2 buttons to 3: `↩ Reuse` / `⧉ Copy` / `⏭ Extend`.

Extend opens a small centred popup — **prompt only**:
- seed-frame thumbnail (fetched via `getClipLastFrame(v.filename, v.subfolder)` on open),
- one textarea, mode buttons `LLM: Review` / `LLM: Auto`, Cancel / Extend.
- Review: first click enhances and drops the result into the textarea for editing; second
  click fires. Auto: enhance then fire. Enhance = `analyzeImagesNative(nativeVisionClip,
  [seedFrame], ...)` (only if a vision CLIP is set) + `writeBriefNative(nativeBriefClip,
  systemPrompt, user)`. Needs `state.nativeBriefClip`.
- On fire: close popup, **close the gallery**, run.

The run (node: `ctx.runExtend({sourceClip, seedFrame, prompt, sourcePrompt})` in
`one_node_minimax_h3.js`):
- `reuseAll(sourceClip.meta || sourceClip)` for settings, **then probe the source video**
  (`getVideoInfo(filename, subfolder, "output")`) and set `state.megapixels` +
  `state.aspect` from its real width/height — a clip without meta would otherwise render
  the continuation at a default 0.2 MP and the concat would fail.
- `state.prompts = [{text: finalPrompt, firstFrame: seedFrame, enabled:true}]`,
  `generationMode = "firstlast"`, `continuityMode = "none"`. Bail with a popup if the
  First/Last UNET is not set.
- Set `state._extendFrom = {clip:{filename,subfolder}, sourcePrompt}` then `runGeneration()`.

At the end of `runGeneration`, a branch: `if (rs._extendFrom && clipRecords.length === 1
&& !stopRequested)` → `stitchClips([rs._extendFrom.clip, clipRecords[0]], prefix, null,
framesToSeconds(alignFrameCount(1)), null)` (trim 1 duplicated seed frame), then
`saveMeta` with `composeStitchedPrompt([sourcePrompt, newPrompt])`, `stitched:true`,
`extended:true`, `prompts:[…]`. `showResultVideo`, `setLastResult`.

**Traps:**
- Read `rs._extendFrom`, **not** `state._extendFrom` — `runGeneration` repaints the live
  state back to the panel during the run, so the flag is gone from `state` by the branch.
  Clear `state._extendFrom` in the `finally` for hygiene.
- `runExtend` is `async` (it awaits `getVideoInfo`); the gallery calls it fire-and-forget.
- `/minimax_h3_one/stitch` overlap branch now scales+pads every clip to the first clip's
  WxH before concat — carry that fix (probe `paths[0]` with ffprobe, inject
  `scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2,setsar=1`
  into each `[i:v]` filter). Otherwise mismatched-size clips give a 0-byte file — this
  also fixes the web's manual gallery Combine.

## 4. User pipeline presets carry the full recipe

`presets_minimax.js`: a preset the **user saves** now stores, on top of the axes,
`RECIPE_KEYS = [steps, sampler, scheduler, denoise, shiftVideo, shiftAudio, turboSteps,
slaTurboSteps, turboLora, turboLoraReference, pddFile, pddFileReference, slaTurboLora]`.
`captureAxes` = `{...axesOf(state), ...recipeOf(state)}` (recipeOf only includes keys that
are `!== undefined`). `applyPreset` restores each RECIPE_KEY that the preset carries.

**The six built-in presets are unchanged — axes only.** `matchPreset` still compares axes
only, so "which preset is active" is unaffected and a step-count change doesn't drop you to
"Custom".

**Why:** applying a saved "PDD" preset restored `turboMode = "pdd"` but not `pddFile` /
`pddFileReference` (mode-specific), so `effectiveTurbo()` silently fell back to `"none"` and
the run used `state.steps` (20) instead of the PDD 8. Reported by the user on the web side.

## 5. Fix to carry — `_mmh3_last`

`nodes.py`: `mmh3_set_last_image` and `TJ_H3_Output.get_output` referenced `_mmh3_last`
(a per-node dict) and `_mmh3_drop_stale_last_frame`, neither defined — `NameError` on every
render. Both are now defined near the route (dict + a best-effort temp-file cleanup helper,
matching the `_fk_last_images` / `_zit_last_images` pattern). Check the web's backend for the
same gap if it has an equivalent route.

---

## Port order

1. §1 route + §5 fix (backend). 2. §4 presets (small, self-contained). 3. §2 Continue.
4. §3 Extend (biggest — needs §1 + the stitch scale/pad).
