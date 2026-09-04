# krea2-headless

Headless **Krea2 Text→Image / Image→Image** generator — the graph-build + ComfyUI submit logic
from AI-ONE-STUDIO's `src/tools/krea2/`, extracted to a **zero-dependency Node package**.
No browser, no build step, no `npm install`. Node 20+.

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
| `graph.mjs` | `buildT2IGraph` / `buildI2IGraph` port (+ optional ControlNet chain) — node-for-node identical to the studio build |
| `comfy.mjs` | ComfyUI HTTP client. Injects `comfy.json.headers` on every request. `401`/`403` → `{ ok:false, stage:"auth" }` |
| `core-helpers.mjs` | `defaultState`, `applyConfig` (GET `/krea2_one/config` → state), `buildPromptText`, control helpers |

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
  "width": 1024, "height": 1024,
  "steps": 8, "cfg": 1, "sampler": "euler", "scheduler": "simple",
  "seed": null,
  "loras": [{ "name": "x.safetensors", "strength": 0.8, "triggerWord": "", "enabled": true }]
}
```

| field | notes |
|---|---|
| `mode` | `t2i` \| `i2i` |
| `prompt` | a string, or `{ "positive": "...", "negative": "..." }` |
| `model` / `textEncoder` / `vae` | optional override — otherwise taken from the ComfyUI config (`selected_model` etc.) |
| `seed` | `null` → random |
| i2i | `i2iImage` (abs path, required), `i2iDenoise` (0.75), `i2iWidth` / `i2iHeight` (null → keep source size) |
| `control` | optional: `{ enabled, type: "depth"\|"canny", image: "/abs", strength, imageW, imageH }` — the control LoRA files come from the config (`control_lora_depth` / `control_lora_canny`) |

## Output (stdout JSON)

```json
{ "ok": true, "promptId": "...", "outputs": [{ "type": "image", "filename": "K2_00001_.png",
  "subfolder": "one_krea2", "url": "https://.../view?..." }], "localFiles": ["./result/K2_00001_.png"],
  "seed": 12345, "steps": 8, "graphSubmitted": { } }
```

Failure: `{ "ok": false, "error": "...", "stage": "config|auth|upload|submit|generate|timeout|download|network" }`.
Exit code `0` on success, `1` otherwise (`2` for a bad CLI invocation).

## Scope

`t2i` / `i2i` only. Identity Edit and SeedVR2 Upscale are separate packages
(`upscale-headless/` for the latter). Prompt authoring is done upstream.
