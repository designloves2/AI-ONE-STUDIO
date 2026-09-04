# zimage-headless

Headless **Z-Image Turbo Text→Image / Image→Image** generator — the graph-build + ComfyUI
submit logic from AI-ONE-STUDIO's `src/tools/zimage/`, extracted to a **zero-dependency Node
package**. No browser, no build step, no `npm install`. Node 20+.

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
| `index.mjs` | CLI + `generate()` — config → job → (upload) → `buildGraph` → `/prompt` → `/history` poll → `/view` download |
| `graph.mjs` | `buildT2IGraph` / `buildI2IGraph` port — node-for-node identical to the studio build. Uses `ModelSamplingAuraFlow(shift)`, GGUF clip type `lumina2` |
| `comfy.mjs` | ComfyUI HTTP client. Injects `comfy.json.headers` on every request. `401`/`403` → `{ ok:false, stage:"auth" }` |
| `core-helpers.mjs` | `defaultState`, `applyConfig` (GET `/z_image_turbo/config` → state) |

## `comfy.json`

```json
{
  "baseUrl": "https://comfy.example.com",
  "headers": { "CF-Access-Client-Id": "xxx.access", "CF-Access-Client-Secret": "xxx" },
  "timeoutMs": 1800000
}
```

## `job.json`

```json
{
  "mode": "t2i",
  "prompt": "a lighthouse on a cliff at dusk",
  "negativePrompt": "blurry, text",
  "width": 1024, "height": 1536,
  "steps": 8, "cfg": 1, "shift": 3, "sampler": "euler", "scheduler": "simple",
  "seed": null,
  "loras": [{ "name": "x.safetensors", "strength": 1, "triggerWord": "", "enabled": true }]
}
```

| field | notes |
|---|---|
| `mode` | `t2i` \| `i2i` |
| `prompt` | a string, or `{ "positive": "...", "negative": "..." }` |
| `shift` | ModelSamplingAuraFlow shift (default 3) |
| `model` / `textEncoder` / `vae` | optional override — otherwise from the ComfyUI config (`selected_model` etc.) |
| `seed` | `null` → random |
| i2i | `i2iImage` (abs path, required), `i2iDenoise` (0.75), `i2iWidth` / `i2iHeight` |

## Output (stdout JSON)

```json
{ "ok": true, "promptId": "...", "outputs": [{ "type": "image", "filename": "ZIT_00001_.png",
  "subfolder": "one_z-image", "url": "https://.../view?..." }], "localFiles": ["./result/ZIT_00001_.png"],
  "seed": 777, "steps": 8, "shift": 3, "graphSubmitted": { } }
```

Failure: `{ "ok": false, "error": "...", "stage": "config|auth|upload|submit|generate|timeout|download|network" }`.
Exit `0` on success, `1` otherwise (`2` bad invocation).

## Scope

`t2i` / `i2i` only. Inpaint / Redraw-BG / ControlNet / Face-Redraw and SeedVR2 Upscale are not
included (`upscale-headless/` covers the last one). Prompt authoring is done upstream.
