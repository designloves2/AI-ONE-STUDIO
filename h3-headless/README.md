# h3-headless

Headless **MiniMax H3 single-clip generator** — the graph-build + ComfyUI submit logic from
AI-ONE-STUDIO's `src/tools/minimax_h3/`, extracted to a **zero-dependency Node package**.
No browser, no build step, no npm install. Copy this folder anywhere with Node 20+ and run it.

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
| `index.mjs` | CLI + `generate()` — the flow: config → preset → job → upload → `buildClipGraph` → `/prompt` → `/history` poll → `/view` download |
| `graph.mjs` | `buildClipGraph` port (single clip; no relay / gallery / post-process) |
| `comfy.mjs` | ComfyUI HTTP client — `/config`, `/models`, `/node_availability`, `/upload/image`, `/prompt`, `/history`, `/view`. Injects `comfy.json.headers` on every request. |
| `presets.mjs` | preset resolution — backend `user_presets[]` first, then 6 built-in fallbacks |
| `core-helpers.mjs` | `resolveResolution`, `alignFrameCount`, `defaultState`, `applyConfig`, `applyPreset`, gating rules — ported from `core.ts` |

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

## Scope

Single clip only. No clip relay / stitching, no gallery, no post-process (upscale / interpolate).
Prompt authoring is done upstream (the Hermes prompt skill); this takes finished text.
