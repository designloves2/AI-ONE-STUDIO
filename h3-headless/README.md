# h3-headless

Headless **MiniMax H3 generator** — the graph-build + ComfyUI submit logic from
AI-ONE-STUDIO's `src/tools/minimax_h3/`, extracted to a **zero-dependency Node package**.
No browser, no build step, no npm install. Copy this folder anywhere with Node 20+ and run it.

Covers 6 `job.mode`s: the original single-clip video generator (`ref2va`/`fl2va`/`l2va`/`t2va`),
`facerefine` (H3 Face Refine), `imagegen_t2i`/`imagegen_ref2i` (Image Generator stills),
`charsheet` (Character Sheet turnaround + grid), and `imageupscale` (still-image Deblur/RTX VSR).
Out of scope: LTX 2.5 Upscale and the Postprocess mode family (Deblur/Denoise/Upscale/Skin
Retouch/Grain/Interpolate/Resize chained on an existing clip) — both are UI-adjacent gallery
post-processing features, deliberately excluded from this port.

```
node index.mjs --config comfy.json --job job.json [--dry-run] [--out ./result]
```

or from code:

```js
import { generate } from "./index.mjs";
const result = await generate(jobSpec, comfyConfig);
```

## Files

| file | what |
|---|---|
| `index.mjs` | CLI + `generate()` — dispatches on `job.mode` to one of 6 flows, each: config → job → upload → `buildXGraph` → `/prompt` → `/history` poll → `/view` download. `charsheet` submits twice (render, then grid-extract), copying the stage-1 output back into ComfyUI's `input/` via `/minimax_h3_one/copy_to_input` in between. |
| `graph.mjs` | `buildClipGraph`, `buildFaceRefineGraph`, `buildImageGenGraph`, `buildCharacterSheetVideoGraph`, `buildCharacterSheetGridGraph`, `buildImageUpscaleGraph` — ported node-for-node from `graphBuilder.ts` |
| `comfy.mjs` | ComfyUI HTTP client — `/config`, `/models`, `/node_availability`, `/upload/image`, `/prompt`, `/history`, `/view`. Injects `comfy.json.headers` on every request. Stays generic (shared verbatim by every other `*-headless/` folder) — the one MiniMax-H3-specific `copy_to_input` call lives in `index.mjs` instead, via the client's exposed `postJson`. |
| `presets.mjs` | preset resolution — backend `user_presets[]` first, then 6 built-in fallbacks (clip modes only) |
| `core-helpers.mjs` | `resolveResolution`, `computeRtxTarget`, `alignFrameCount`, `defaultState`, `applyConfig`, `applyPreset`, gating rules — ported from `core.ts` |

## `comfy.json`

```json
{
  "baseUrl": "https://studio.example.com",
  "headers": {
    "CF-Access-Client-Id": "xxxxx.access",
    "CF-Access-Client-Secret": "xxxxx"
  },
  "timeoutMs": 1800000
}
```

- `headers` — optional. Cloudflare Access service token (or any auth headers). Sent on **every**
  request. A `401`/`403` anywhere → `{ ok:false, stage:"auth" }`.
- `timeoutMs` — how long to poll `/history` before giving up (default 30 min).

## `job.json`

```json
{
  "mode": "ref2va",
  "preset": "pdd-8step",
  "durationSeconds": 8,
  "megapixels": 1.0,
  "seed": null,
  "prompt": {
    "integrated_multimodal_description": "[Shot 1] <Picture 1> ...",
    "overall_soundscape": "...",
    "non_diegetic_music": "..."
  },
  "refImages": ["/abs/path/img1.png", "/abs/path/img2.png"],
  "firstFrame": null,
  "lastFrame": null
}
```

| field | notes |
|---|---|
| `mode` | `ref2va` \| `fl2va` \| `l2va` \| `t2va` |
| `preset` | A name from the studio's saved presets — **queried live** from the ComfyUI config each run, so a preset you add in the studio works immediately, no redeploy. Falls back to a built-in alias (`stock`, `dense`, `turbo-4step`, `everyday`, `sla-turbo`, `pdd-spectrum`). Match ignores case / spaces / `_` / `-` (`pdd-8step` = `PDD 8step` = `pdd_8step`). `null` → keep the config defaults. Unknown → `{ ok:false, stage:"preset" }`. |
| `prompt` | The 3 H3 fields, or a plain string. The 3 fields are joined into one prompt string. |
| `refImages` | Absolute paths, in `<Picture 1>`, `<Picture 2>`, … order. Uploaded to ComfyUI's `input/`. `ref2va` only. |
| `firstFrame` / `lastFrame` | Absolute paths. `fl2va` only. |
| `durationSeconds` | → frames on H3's 17k+5 grid (`alignFrameCount`). |
| `megapixels`, `aspect` | Resolution. `aspect` defaults to `16:9 Landscape`. |
| `seed` | `null` → random. |
| `model` | Shorthand: sets `unetFirstLast` **and** `unetReference`. Or set them separately. Overrides the preset / config UNET. Omit → the model is picked by mode from the ComfyUI config (or from the preset, if it pins one). |

### How the model is chosen

1. ComfyUI config `unet_first_last` (t2va/fl2va) / `unet_reference` (ref2va) — the default, mode-aware.
2. If the resolved preset carries `unetFirstLast` / `unetReference`, those win (e.g. `fast-8step`
   pins a hybrid FL2VA/Ref2VA checkpoint).
3. If `job.json` sets `model` / `unetFirstLast` / `unetReference`, that wins.

The Hermes agent never has to name a model for the normal case.

## Output (stdout, JSON)

```json
{
  "ok": true,
  "promptId": "abc-123",
  "outputs": [
    { "type": "video", "filename": "MMH3_clip001_00001_.mp4", "subfolder": "one_minimax_h3", "url": "https://.../view?..." }
  ],
  "localFiles": ["./result/MMH3_clip001_00001_.mp4"],
  "preset": { "source": "user", "name": "pdd-8step" },
  "model": { "used": "MinimaxH3\\..." },
  "resolution": { "width": 1344, "height": 736 },
  "frames": 192, "seed": 12345, "steps": 8, "turboEffective": "pdd",
  "graphSubmitted": { "...": "..." }
}
```

- `--out <dir>` — download each output file into `<dir>`, fill `localFiles`.
- `--dry-run` — build the graph, print `graphSubmitted`, **do not** submit.

Failures: `{ ok:false, error, stage }` — `stage` is one of
`config | preset | auth | upload | submit | generate | interrupted | timeout | download | network`.
Exit code is `0` on `ok:true`, `1` otherwise (`2` for a bad CLI invocation).

## Other modes

See `node index.mjs --help` for the full `job.json` field list per mode. Briefly:

- **`facerefine`** — `job.sourceFile` (a rendered/uploaded clip), `job.prompt`, `job.faceDetector`,
  optional `job.refImages`. Re-renders a small/distant face crop through H3 and stitches it back.
- **`imagegen_t2i` / `imagegen_ref2i`** — a still image via the same H3 pipeline at 8 frames,
  read back as one frame. `final:true` (default) adds the studio's second latent-upscale pass.
- **`charsheet`** — `job.refImages` (1-9), `job.prompt`. Submits the 124-frame turnaround render,
  then a second cheap grid-assembly graph against that output (ref photo + 8 picked frames, 3-col
  grid). Both `outputs` (video + grid image) come back in one result.
- **`imageupscale`** — `job.inputFile`, `job.deblur` and/or `job.rtx`. Deblur/RTX VSR on a still.

## Scope

No clip relay / stitching, no gallery browsing. No LTX 2.5 Upscale, no Postprocess mode family
(Deblur/Denoise/Upscale/Skin Retouch/Grain/Interpolate/Resize chained on an existing clip) — both
are gallery/UI-adjacent post-processing features, excluded from this headless port by design.
Prompt authoring is done upstream (the Hermes prompt skill); this takes finished text.
