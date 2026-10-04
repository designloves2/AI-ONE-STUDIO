# HANDOFF — h3-headless is done

**To:** the Hermes Agent management session (Mac)
**From:** the AI-ONE-STUDIO repo session
**Status:** built, committed (`AI-ONE-STUDIO` `1eadcc0`), verified against a live ComfyUI.

The single-clip headless H3 generator from `INSTRUCTIONh3headless.md` is ready. It lives at
`h3-headless/` in the AI-ONE-STUDIO repo. Copy that folder to `~/.hermes/skills/h3-generate/`
and call it with `node`.

---

## 1. Install (Mac)

```
cp -r <AI-ONE-STUDIO>/h3-headless ~/.hermes/skills/h3-generate
# nothing else — zero npm deps, Node 20+ only
node ~/.hermes/skills/h3-generate/index.mjs --help
```

## 2. How the skill calls it

```
node ~/.hermes/skills/h3-generate/index.mjs \
  --config ~/.hermes/skills/h3-generate/comfy.json \
  --job    /tmp/h3-job-<id>.json \
  --out    /tmp/h3-out-<id>
```

- **stdout** is a single JSON object. `ok:true` → read `outputs[]` / `localFiles[]`.
  `ok:false` → read `error` + `stage`.
- exit code: `0` ok, `1` failure, `2` bad invocation.
- Or import it: `import { generate } from ".../index.mjs"; const r = await generate(job, comfyConfig, { outDir });`

## 3. `comfy.json` (write once, keep with the skill)

```json
{
  "baseUrl": "https://studio.tjtj.cloud",
  "headers": {
    "CF-Access-Client-Id": "<service-token-id>.access",
    "CF-Access-Client-Secret": "<service-token-secret>"
  },
  "timeoutMs": 1800000
}
```

The headers are the **Cloudflare Access service token** for the studio tunnel — created in the
Cloudflare Zero Trust dashboard (Access → Service Auth → Service Tokens), then added to the
studio's Access application policy as an allowed service token. They ride on every request
(`/upload/image`, `/prompt`, `/history`, `/view`). A `401`/`403` → `{ ok:false, stage:"auth" }`.
If the studio is reachable without Access, omit `headers`.

## 4. `job.json` schema

```json
{
  "mode": "ref2va",
  "preset": "pdd-8step",
  "durationSeconds": 8,
  "megapixels": 1.0,
  "seed": null,
  "prompt": {
    "integrated_multimodal_description": "[Shot 1] <Picture 1> ...  [Shot 2] At 00:03.500, ...",
    "overall_soundscape": "steady rain, distant traffic",
    "non_diegetic_music": "sparse ambient synth pads"
  },
  "refImages": ["/abs/img1.png", "/abs/img2.png"],
  "firstFrame": null,
  "lastFrame": null
}
```

| field | rule |
|---|---|
| `mode` | `ref2va` \| `fl2va` \| `l2va` \| `t2va` (clip modes) \| `facerefine` \| `imagegen_t2i` \| `imagegen_ref2i` \| `charsheet` \| `imageupscale` — see §9 for the non-clip modes' own fields |
| `preset` | preset name (below). Case / space / `_` / `-` insensitive. `null` → studio config defaults. |
| `prompt` | the 3 H3 fields **or** a plain string. The prompt skill produces this; h3-headless just concatenates the 3 fields. |
| `refImages` | absolute paths, in `<Picture 1>`, `<Picture 2>`, … order. `ref2va` only. Max 9. |
| `firstFrame` / `lastFrame` | absolute paths. `fl2va` only. |
| `durationSeconds` | snapped to H3's 17k+5 frame grid. |
| `megapixels`, `aspect` | `aspect` default `"16:9 Landscape"`. |
| `seed` | `null` → random. |
| `model` / `unetFirstLast` / `unetReference` | optional per-job model override. **Not needed normally** — see §6. |

## 5. Presets

**The skill does NOT hardcode presets.** h3-headless queries the studio's ComfyUI config
(`GET /minimax_h3_one/config` → `user_presets[]`) on every run, so any preset the owner adds
in the studio is callable by name immediately — no code change, no redeploy.

Currently registered (owner-created, live now):

| name | pipeline | model | steps |
|---|---|---|---|
| `pdd-8step` | Turbo LoRA (Basic; the PDD Acc file) + Sage + MemEff | config default UNET, per mode (FL2VA/Ref2VA) | 8 (steps) |
| `fast-8step` | Sage + MemEff + Spectrum | `MinimaxH3\h3ErosMax_beta4.safetensors` (hybrid, both modes) | 8 |

Built-in fallback aliases (used only if the name misses `user_presets[]`):
`stock` · `dense` · `turbo-4step` · `everyday` · `sla-turbo` · `pdd-spectrum`.

Unknown name → `{ ok:false, stage:"preset", error:"unknown preset '<name>'" }`.

## 6. Model selection (automatic)

The skill never needs to name a model for the common case:

1. **Default** — h3-headless reads `unet_first_last` / `unet_reference` from the studio config
   and `buildClipGraph` picks the one matching `job.mode`.
2. **Preset-pinned** — a preset can carry `unetFirstLast` / `unetReference` (e.g. `fast-8step`
   pins the hybrid ErosMax checkpoint). Still mode-auto.
3. **Job override** — `job.model` (or the two `unet*` fields) wins over both. One-off only.

If the owner adds a new model-bound preset in the studio, prepare **both** an FL2VA and a
Ref2VA file (or one hybrid for both) and set the preset's `unetFirstLast` / `unetReference` —
then the skill just calls it by name.

## 7. Output

```json
{
  "ok": true,
  "promptId": "bf45cede-...",
  "outputs": [
    { "type": "video", "filename": "MMH3_clip001_00001_.mp4", "subfolder": "one_minimax_h3", "url": "https://studio.tjtj.cloud/view?..." }
  ],
  "localFiles": ["/tmp/h3-out-<id>/MMH3_clip001_00001_.mp4"],
  "preset": { "source": "user", "name": "pdd-8step" },
  "model": { "used": "MinimaxH3\\minimax_h3_fl2va_pruned_int8_convrot.safetensors" },
  "resolution": { "width": 928, "height": 544 },
  "frames": 107, "seed": 999, "steps": 8, "turboEffective": "pdd",
  "graphSubmitted": { "MM:unet": { "...": "..." } }
}
```

`stage` on failure: `config | preset | auth | upload | submit | generate | interrupted | timeout | download | network`.

## 8. Verified

- `--dry-run` graph for `pdd-8step` / `ref2va` / 8s / 1.0MP is **node-for-node identical** to
  the studio UI's `buildClipGraph` output (compared against the running studio).
- Real `t2va` / `pdd-8step` submit → ComfyUI rendered it → `--out` downloaded a valid
  `ftypisom` MP4 (~570 KB, 4.5 s clip).
- `--help` runs with zero deps; unknown preset and unreachable host return the right `stage`.

## 9. Non-clip modes (added after the initial single-clip build)

`h3-headless` now also covers 5 more `job.mode`s, ported node-for-node from
`src/tools/minimax_h3/graphBuilder.ts`'s other graph builders:

| `job.mode` | builder | fields (beyond `seed`/`aspect`/`megapixels`) |
|---|---|---|
| `facerefine` | `buildFaceRefineGraph` | `sourceFile` (required, a clip path), `prompt`, `faceDetector`, `refImages` |
| `imagegen_t2i` / `imagegen_ref2i` | `buildImageGenGraph` | `prompt`, `refImages` (ref2i), `steps`, `turboOn`, `turboLora`, `final`, `imgLatentMode` (`basic`|`fizgig`) |
| `charsheet` | `buildCharacterSheetVideoGraph` + `buildCharacterSheetGridGraph` | `refImages` (required, 1-9), `prompt`, `deblur`, `rtx`, `frameIndices`, `cellWidth`/`cellHeight` |
| `imageupscale` | `buildImageUpscaleGraph` | `inputFile` (required, a still image), `deblur`, `rtx` |

`charsheet` is the one two-stage mode: it submits the 124-frame turnaround render first, waits
for its output, calls `POST /minimax_h3_one/copy_to_input` to move that rendered video from
ComfyUI's `output/` back into `input/`, then submits the grid-assembly graph against it. Both
stages' outputs land in the one result's `outputs[]`.

`--help` (`node index.mjs --help`) lists every mode's exact field set.

## 10. Not in scope (per the spec)

No Last Frame Chain continuity (only One-Take is wired — see §12), no gallery browsing. LTX 2.5
Upscale and the Postprocess mode family (Deblur/Denoise/Upscale/Skin Retouch/Grain/Interpolate/
Resize chained on an existing clip) were deliberately excluded — both are gallery/UI-adjacent
post-processing features, not part of this headless port. (`buildClipGraph`'s own inline upscale
step, including its `flashvsr` option, *is* in scope — that lives inside the generation graph
itself, not the gallery post-process.) Prompt authoring stays with the Hermes prompt skill (or
the README's "Writing prompts for One-Take" section for multi-clip runs); this consumes
finished text.

## 12. `job.mode: "onetake"` — multi-clip continuous shot (added after §9)

**Fixes the bug that motivated this section:** asking for "N clips as one continuous shot" via
plain `ref2va`/`t2va` job files produced N *unrelated* clips — `buildClipGraph` never wired
continuity, and `index.mjs` had no multi-clip loop at all. `onetake` is the fix: it chains N
clips together via ComfyUI-server-side latent checkpoints (`TJ_H3_SaveLatentCheckpoint` /
`TJ_H3_LoadLatentCheckpoint` / `TJ_H3_LatentContinuation`), submitting them **sequentially**
(clip i+1's graph references clip i's saved checkpoint by name, so it must exist on the server
first — no parallelism, no client-side file passing between clips), then auto-stitches all N
into one final video via `POST /minimax_h3_one/stitch`.

```json
{
  "mode": "onetake",
  "clipMode": "t2va",
  "clipSeconds": 10,
  "prompts": [
    "clip 1 prompt — sets the scene and starts the motion",
    "clip 2 prompt — continues the SAME shot, describes what happens next",
    "clip 3 prompt — continues further, no scene cuts, no scene restatement"
  ],
  "seed": null,
  "oneTakeAutoStitch": true
}
```

Key fields (full list: `node index.mjs --help`): `prompts` (array, required — per-clip; a
shorter array reuses its last non-empty entry for later clips), `clipCount` (default
`prompts.length`), `clipSeconds` (per-clip duration), `clipMode` (`t2va`/`fl2va`/`ref2va`,
default `t2va`), `oneTakeLockAudio` (default `false`), `oneTakeAutoStitch` (default `true`),
`seedPerClip` (default `true` — clip i's seed is `seed + i`), plus the usual `model`/`aspect`/
`megapixels`/`preset`/`refImages`/`firstFrame`/`lastFrame` fields (first frame only applies to
clip 0, last frame only to the final clip).

**Result shape** adds two things beyond the single-clip contract: `outputs[]` has one entry per
clip (each tagged `clipIndex`), and `stitchedOutput` carries the final concatenated video —
`{ filename, subfolder, url, overlapSeconds, durationSeconds }`, or `{ error }` if the stitch
call itself failed (the per-clip files are still valid and still in `outputs[]`/`localFiles[]`
in that case — a stitch failure doesn't fail the whole job).

**Prompt-writing note** (this was reported separately: the agent operating this CLI "doesn't
know prompt-writing tips" for multi-clip continuity either — i.e. it wrote N independent scene
descriptions instead of one continuing shot). See the README's "Writing prompts for One-Take"
section before generating a `prompts[]` array — the short version: each entry after the first
continues the ongoing shot ("she keeps walking, camera pulling back...") rather than starting a
new one ("cut to...", "a new shot of...").

**Verification (no live ComfyUI available for this change):** `node --check` on every touched
file; `--help` prints the new mode and exits 0; a standalone script called `buildClipGraph`
directly for 3 synthetic clips and confirmed clip 1's `TJ_H3_LoadLatentCheckpoint.checkpoint_name`
equals clip 0's `TJ_H3_SaveLatentCheckpoint.checkpoint_name` (and clip 2 → clip 1, clip 0 has no
load node) — i.e. the continuity chain is wired correctly end-to-end at the graph level. A real
submit-wait-submit-wait run against a live ComfyUI + `/stitch` endpoint is still unverified.

## 11. One repo-side change that shipped with this

`RECIPE_KEYS` in `src/tools/minimax_h3/core.ts` gained `unetFirstLast` / `unetReference`
(commit `ba8b3b8`) so a **saved user preset can pin its model**. Backward-compatible: old
presets and the 6 built-ins are unaffected. The studio's "Save preset" now also captures the
current model; "Apply preset" restores it.
