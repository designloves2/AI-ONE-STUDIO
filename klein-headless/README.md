# klein-headless

Headless **Flux2 Klein** image generator (T2I / I2I / Edit / Inpaint / Outpaint / Faceswap) —
the graph-build + ComfyUI submit logic from AI-ONE-STUDIO's `src/tools/klein/`, extracted to a
**zero-dependency Node package**. No browser, no build step, no `npm install`. Node 20+.

Source: https://github.com/designloves2/AI-ONE-STUDIO (master).

```
node index.mjs --config comfy.json --job job.json [--dry-run] [--out ./result]
```

or from code:

```js
import { generate } from "./index.mjs";
const result = await generate(jobSpec, comfyConfig);
```

## How Klein is different

Klein doesn't assemble a graph from scratch. The backend serves a **pre-made workflow JSON**
per mode (`GET /flux_klein/workflow_<name>`); this package fetches it and patches only the
known node IDs — the graph's own correctness is the backend workflow file's job. So a running
ComfyUI with the `flux_klein` node pack is required **even for `--dry-run`**.

## Files

| file | what |
|---|---|
| `index.mjs` | CLI + `generate()` — config → job → upload images → fetch workflow → patch → `/prompt` → `/history` poll → `/view` download |
| `graph.mjs` | `buildT2IGraph` / `buildI2IGraph` / `buildEditGraph` / `buildInpaintGraph` / `buildOutpaintGraph` / `buildFaceswapGraph` — the patch logic, node-for-node identical to `src/tools/klein/graphBuilder.ts` |
| `comfy.mjs` | ComfyUI HTTP client. Injects `comfy.json.headers` on every request. `401`/`403` → `{ ok:false, stage:"auth" }` |
| `core-helpers.mjs` | `defaultState`, `applyConfig` (GET `/flux_klein/config` → state), `buildPromptText`, `getUseKV` |

## `comfy.json`

```json
{
  "baseUrl": "https://comfy.example.com",
  "headers": { "CF-Access-Client-Id": "xxx.access", "CF-Access-Client-Secret": "xxx" },
  "timeoutMs": 1800000
}
```

`headers` optional — Cloudflare Access service token (or any auth headers), sent on **every** request.

## `job.json`

```json
{
  "mode": "t2i",
  "prompt": "a red bicycle leaning on a white wall, morning light",
  "negativePrompt": "blurry, text",
  "width": 1024, "height": 1536,
  "steps": 4, "cfg": 1, "sampler": "euler", "scheduler": "simple",
  "seed": null,
  "loras": [{ "name": "x.safetensors", "strength": 1.0, "triggerWord": "", "enabled": true }]
}
```

| field | notes |
|---|---|
| `mode` | `t2i` \| `i2i` \| `edit` \| `inpaint` \| `outpaint` \| `faceswap` |
| `prompt` | a string, or `{ "positive": "...", "negative": "..." }` |
| `model` / `textEncoder` / `vae` | optional override — otherwise from the ComfyUI config (`selected_model` / `selected_text_encoder` / `selected_vae`) |
| `kvCacheOverride` | `"auto"` (default — on when the model name contains `kv`) \| `"on"` \| `"off"` |
| `cfg` | omit → `5` for a `*base*` model, `1` otherwise |
| `seed` | `null` → random |

### Per-mode inputs (all image paths are absolute)

| mode | required | optional |
|---|---|---|
| `i2i` | `i2iImage` | `i2iDenoise` (0.75), `i2iWidth` / `i2iHeight` (null → keep source size) |
| `edit` | `editImage1` | `editImage2` (a second reference), `editSizeSource` (`"img1"` default \| `"manual"` → uses `width`/`height`) |
| `inpaint` | `inpaintImage`, `inpaintMaskImage` (b/w mask) | `inpaintDenoise` (0.85) |
| `outpaint` | `outpaintImage`, and at least one of `outpaintUp` / `outpaintDown` / `outpaintLeft` / `outpaintRight` (px) | `outpaintPadR` / `outpaintPadG` / `outpaintPadB` (fill colour, default black) |
| `faceswap` | `faceswapTarget` (scene), `faceswapSource` (face) | `faceswapDenoise` (1.0), `bfsLora` `{ name, strength, enabled }` — the BFS face-swap LoRA; must be on the server |

`mode: "inpaint"` with `paintSubMode: "outpaint"` (the studio's shape) also routes to outpaint.

## Output (stdout JSON)

```json
{ "ok": true, "promptId": "...", "outputs": [{ "type": "image", "filename": "FK_00001_.png",
  "subfolder": "one_flux2-klein", "url": "https://.../view?..." }],
  "localFiles": ["./result/FK_00001_.png"], "seed": 12345, "steps": 4, "graphSubmitted": { } }
```

Failure: `{ "ok": false, "error": "...", "stage": "config|auth|upload|submit|generate|timeout|download|network" }`.
Exit code `0` on success, `1` otherwise (`2` for a bad CLI invocation).

## Scope

One image per call, `t2i` / `i2i` / `edit` / `inpaint` / `outpaint` / `faceswap`. SeedVR2
Upscale is a separate package (`upscale-headless/`). No batching, no gallery, no prompt
authoring (done upstream).
