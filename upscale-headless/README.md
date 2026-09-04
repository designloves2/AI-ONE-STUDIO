# upscale-headless

Headless **SeedVR2 image upscaler** — the upscale graph shared by AI-ONE-STUDIO's Krea2 and
Z-Image tools (`SeedVR2LoadDiTModel` → `SeedVR2LoadVAEModel` → `SeedVR2VideoUpscaler` →
`SaveImage`), extracted to a **zero-dependency Node package**. No diffusion model, no prompt.
Node 20+.

```
node index.mjs --config comfy.json --job job.json [--dry-run] [--out ./result]
node index.mjs --config comfy.json --list-models        # print the server's SeedVR2 model files
```

or from code:

```js
import { generate } from "./index.mjs";
const result = await generate(jobSpec, comfyConfig);
```

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
  "image": "/abs/path/src.png",
  "ditModel": "seedvr2_ema_3b_fp16.safetensors",
  "vaeModel": "ema_vae_fp16.safetensors",
  "resolution": 2048,
  "maxResolution": 4096,
  "batchSize": 1,
  "blocksToSwap": 0,
  "attentionMode": "sdpa",
  "colorCorrection": "lab",
  "offloadDevice": "cpu",
  "inputNoiseScale": 0, "latentNoiseScale": 0,
  "seed": 42,
  "saveSubfolder": "one_upscale"
}
```

| field | notes |
|---|---|
| `image` | absolute path to the source image — **required** |
| `ditModel` / `vaeModel` | SeedVR2 model filenames — **required**. `--list-models` prints what the server has |
| `resolution` | target short side (default 2048); `maxResolution` caps the long side |
| `blocksToSwap` | raise to fit a bigger model in less VRAM (0 = none) |
| `attentionMode` | `sdpa` \| `flash_attn_2` \| `flash_attn_3` \| `sageattn_2` \| `sageattn_3` |
| `colorCorrection` | `lab` \| `wavelet` \| `wavelet_adaptive` \| `hsv` \| `adain` \| `none` |
| `offloadDevice` | `cpu` (default) or `none` to keep the model on the GPU |

## Output (stdout JSON)

```json
{ "ok": true, "promptId": "...", "outputs": [{ "type": "image", "filename": "UP_00001_.png",
  "subfolder": "one_upscale", "url": "https://.../view?..." }], "localFiles": ["./result/UP_00001_.png"],
  "ditModel": "...", "resolution": 2048, "graphSubmitted": { } }
```

Failure: `{ "ok": false, "error": "...", "stage": "config|auth|upload|submit|generate|timeout|download|network" }`.
Exit `0` on success, `1` otherwise (`2` bad invocation).

## Files

`index.mjs` (CLI + `generate()`) · `graph.mjs` (`buildUpscaleGraph` port) · `comfy.mjs` (ComfyUI client).
