# qwen21-headless

Headless **QWEN IMAGE 2.1** image generator (Text→Image / Image→Image / Ref to Image / Edit /
Pose) — the graph-build + ComfyUI submit logic from AI-ONE-STUDIO's `src/tools/qwen21/`,
extracted to a **zero-dependency Node package**. No browser, no build step, no `npm install`.
Node 20+.

```
node index.mjs --config comfy.json --job job.json [--dry-run] [--out ./result]
```

or from code:

```js
import { generate } from "./index.mjs";
const result = await generate(jobSpec, comfyConfig);
```

## Scope

Covers **5 modes only**: `t2i`, `i2i`, `ref2i`, `edit`, `pose`. **Paint (inpaint/outpaint) and
Upscale (SeedVR2) are out of scope and not implemented** — the source `graphBuilder.ts` has
`buildInpaintGraph` / `buildOutpaintGraph` / `buildUpscaleGraph` too, but this package
deliberately does not port them.

## Two deviations from the web UI

1. **EDIT has no "Draw annotation" support.** The web app flattens a canvas-drawn annotation
   (magenta marks over the original) into whichever image slot it was drawn on, replacing that
   slot's `images.image_N` input. A headless CLI has no `<canvas>`, so this package skips
   annotation entirely — `editImage1` / `editImage2` / `editRefImages` are wired as **plain,
   verbatim images**, exactly like `graphBuilder.ts`'s own code path when no annotation exists
   for a slot. If you need annotated edits, composite the marks into the image file yourself
   before passing its path in.

2. **POSE takes the source image as-is — no crop.** The web UI has an interactive drag-a-box
   crop tool (`poseCrop.ts`) that crops/resizes `poseImage` client-side via `<canvas>` before
   Stage 1 (SAM3D-Body extraction) ever runs. This headless package does not replicate that —
   `job.poseImage` is loaded and sent to `SAM3DBody_Predict` uncropped, at its native pixel
   size. If you need a specific crop/framing, crop the source file yourself (e.g. with an
   external tool) before passing its path in.

## Mode mapping

The web studio's `state.mode` uses `"i2i"` for **both** plain single-image i2i and the
multi-reference "Ref to Image" sub-mode, distinguished internally by `state.i2iSubMode`
(`"i2i"` vs `"ref2img"`). For a headless job spec that nesting is confusing to an external
caller, so this package uses two flat, distinct top-level `job.mode` values instead:

| web (`state.mode` / `state.i2iSubMode`) | headless `job.mode` |
|---|---|
| `i2i` / `i2i` | `i2i` |
| `i2i` / `ref2img` | `ref2i` |
| `edit` | `edit` |
| `pose` | `pose` |
| `t2i` | `t2i` |

## Files

| file | what |
|---|---|
| `index.mjs` | CLI + `generate()` — config → job → (upload) → `buildGraph` (or the pose 2-stage sequence) → `/prompt` → `/history` poll → `/view` download |
| `graph.mjs` | `buildT2IGraph` / `buildI2IGraph` / `buildRefToImageGraph` / `buildEditGraph` / `buildPoseExtractGraph` / `buildPoseGraph` — ported node-for-node from `src/tools/qwen21/graphBuilder.ts`. Same `ModelSamplingFlux` / `QwenImage21Cache` / `PathchSageAttentionKJ` / `TextEncodeQwenImage21` node types and wiring |
| `comfy.mjs` | ComfyUI HTTP client, copied verbatim from `zimage-headless/comfy.mjs` (tool-agnostic). Injects `comfy.json.headers` on every request. `401`/`403` → `{ ok:false, stage:"auth" }` |
| `core-helpers.mjs` | `defaultState`, `applyConfig` (GET `/qwenimage21_one/config` → state), restricted to the 5 in-scope modes' fields |

## `comfy.json`

```json
{
  "baseUrl": "https://comfy.example.com",
  "headers": { "CF-Access-Client-Id": "xxx.access", "CF-Access-Client-Secret": "xxx" },
  "timeoutMs": 1800000
}
```

## `job.json`

Shared fields, plus per-mode fields:

```json
{
  "mode": "t2i",
  "prompt": "a lighthouse on a cliff at dusk",
  "negativePrompt": "blurry, text",
  "width": 1024, "height": 1024, "resolution": 1024,
  "steps": 20, "cfg": 1.0, "sampler": "euler", "scheduler": "simple",
  "maxShift": 0.69, "baseShift": 0.5,
  "useCache": true, "useSageAttention": false,
  "seed": null,
  "loras": [{ "name": "x.safetensors", "strength": 1, "triggerWord": "", "enabled": true }]
}
```

| field | notes |
|---|---|
| `mode` | `t2i` \| `i2i` \| `ref2i` \| `edit` \| `pose` |
| `prompt` | a string, or `{ "positive": "...", "negative": "..." }` |
| `resolution` | `TextEncodeQwenImage21`'s own `resolution` int input (separate from `width`/`height`) |
| `maxShift` / `baseShift` | `ModelSamplingFlux` inputs |
| `useCache` | `QwenImage21Cache` toggle, default on |
| `useSageAttention` | `PathchSageAttentionKJ` toggle, default off |
| `model` / `textEncoder` / `vae` | optional override — otherwise from the ComfyUI config (`selected_model` etc.) |
| `refMaxMegapixels` | auto-downscale for ref2i/edit/pose reference images via `ImageScaleToTotalPixels`; `0` (default) = send as uploaded |
| `seed` | `null` → random |

### Per-mode inputs (all image paths are absolute)

| mode | required | optional |
|---|---|---|
| `i2i` | `i2iImage` | `i2iDenoise` (0.75), `i2iWidth` / `i2iHeight` (null → keep source size) |
| `ref2i` | `refImages` (array of paths, up to 10) | `refWidth` / `refHeight` (1024), `refDenoise` (1.0) |
| `edit` | `editImage1` | `editImage2` (Image 2), `editRefImages` (array of paths, up to 9 total across `editImage2` + `editRefImages`) — **no annotation, see "Two deviations" above** |
| `pose` | `poseImage` (Image 1 source — used as-is, uncropped), `poseCharacterImage` (Image 2) | `poseLoraModel` (else from ComfyUI config), `poseLoraStrength` (1), `poseSamModel` (`sam_3d_body_dinov3_bf16.safetensors`), `poseSystemPrompt` (prepended to your `prompt`) |

## POSE — two-stage submit

`pose` mode queues **two** graphs in sequence, mirroring `view.ts`'s `generate()`:

1. **Stage 1** (`buildPoseExtractGraph`) — `LoadImage(poseImage)` → `SAM3DBody_Loader` →
   `SAM3DBody_Predict` → `SAM3DBody_Smooth` → `SAM3DBody_Render` → `SaveImage`. Submitted and
   awaited first.
2. Its render output lands in ComfyUI's `output/` folder, but Stage 2's `LoadImage` only
   validates `input/` — so the render is copied over via `POST /qwenimage21_one/copy_to_input`
   (the same route `api.ts`'s `copyOutputToInput` uses) before Stage 2 is built.
3. **Stage 2** (`buildPoseGraph`) — the copied render becomes `<image1>`, `poseCharacterImage`
   becomes `<image2>`, run through the VNCCS PoseStudio LoRA (`poseLoraModel` — must be
   configured, either in the job or the ComfyUI Settings) with `poseSystemPrompt` prepended to
   your `prompt`.

The result's `poseExtract` field reports Stage 1's `{ promptId, renderImage }`.

`--dry-run` on `pose` only builds and prints Stage 1's graph — Stage 2 cannot be built without a
real render filename, so a true `pose` dry run still requires a reachable ComfyUI to complete
Stage 1.

## Output (stdout JSON)

```json
{ "ok": true, "promptId": "...", "outputs": [{ "type": "image", "filename": "Q21_00001_.png",
  "subfolder": "qwen21-one-tj", "url": "https://.../view?..." }], "localFiles": ["./result/Q21_00001_.png"],
  "seed": 777, "steps": 20, "poseExtract": { "promptId": "...", "renderImage": "..." }, "graphSubmitted": { } }
```

Failure: `{ "ok": false, "error": "...", "stage": "config|auth|upload|submit|generate|timeout|download|network" }`.
Exit `0` on success, `1` otherwise (`2` bad invocation).
