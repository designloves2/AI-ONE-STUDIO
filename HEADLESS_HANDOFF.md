# HANDOFF — AI-ONE-STUDIO headless generators

**Repo:** `https://github.com/designloves2/AI-ONE-STUDIO`  (branch `master`)
**To:** the Hermes Agent session (Mac)

Four zero-dependency Node packages that reproduce what the studio frontend does internally
(build the ComfyUI API graph → `POST /prompt` → poll `/history` → download `/view`), for
server-side automation. Each runs standalone — copy the folder, `node index.mjs`. No
`npm install`, no build step, Node 20+.

| package | what | modes |
|---|---|---|
| `h3-headless/` | MiniMax H3 single-clip video | ref2va / fl2va / l2va / t2va |
| `krea2-headless/` | Krea2 image | t2i, i2i (+ optional ControlNet) |
| `zimage-headless/` | Z-Image Turbo image | t2i, i2i |
| `upscale-headless/` | SeedVR2 image upscale (shared Krea2/Z-Image graph) | — |

Each folder has its own `README.md` with the full `job.json` schema. This doc is the overview.

---

## Install (Mac)

```
git clone https://github.com/designloves2/AI-ONE-STUDIO
cp -r AI-ONE-STUDIO/krea2-headless   ~/.hermes/skills/krea2-generate
cp -r AI-ONE-STUDIO/zimage-headless  ~/.hermes/skills/zimage-generate
cp -r AI-ONE-STUDIO/upscale-headless ~/.hermes/skills/upscale
# (h3-headless was delivered earlier)
```

## Call

```
node <pkg>/index.mjs --config comfy.json --job job.json [--dry-run] [--out ./result]
```

- **stdout** = one JSON object. `ok:true` → `outputs[]` (+ `localFiles[]` when `--out`).
  `ok:false` → `error` + `stage`.
- exit `0` ok, `1` failure, `2` bad invocation.
- Or `import { generate } from ".../index.mjs"`.

## `comfy.json` (one file, shared by all four)

```json
{
  "baseUrl": "https://comfy.tjtj.cloud",
  "headers": {
    "CF-Access-Client-Id": "<service-token-id>.access",
    "CF-Access-Client-Secret": "<service-token-secret>"
  },
  "timeoutMs": 1800000
}
```

`headers` = the Cloudflare Access **service token** for the comfy tunnel (Zero Trust → Access →
Service Auth → Service Tokens, then add it to the "comfy" application policy). Sent on every
request. `401`/`403` anywhere → `{ ok:false, stage:"auth" }`. Omit `headers` if the server is
reachable without Access (e.g. `http://127.0.0.1:8188` on the same box).

## `job.json` — quick reference

**krea2 / zimage (t2i / i2i)**

```json
{
  "mode": "t2i",
  "prompt": "a red bicycle on a white wall, morning light",
  "negativePrompt": "blurry, text",
  "width": 1024, "height": 1536,
  "steps": 8, "cfg": 1, "sampler": "euler", "scheduler": "simple",
  "seed": null,
  "i2iImage": "/abs/src.png", "i2iDenoise": 0.75
}
```

- `prompt` — a string, or `{ "positive": "...", "negative": "..." }`.
- `model` / `textEncoder` / `vae` — **omit normally**. Taken from the studio's ComfyUI config
  (`GET /krea2_one/config` / `/z_image_turbo/config`), so whatever the owner picked in the
  studio Settings panel is what runs. Pass them only for a one-off override.
- zimage also takes `shift` (ModelSamplingAuraFlow, default 3).
- krea2 also takes `control: { enabled, type:"depth"|"canny", image:"/abs", strength }` — the
  control-LoRA files come from the config.

**upscale**

```json
{
  "image": "/abs/src.png",
  "ditModel": "seedvr2_ema_3b_fp16.safetensors",
  "vaeModel": "ema_vae_fp16.safetensors",
  "resolution": 2048
}
```

- `ditModel` / `vaeModel` are **required** (not in any config). Run
  `node upscale-headless/index.mjs --config comfy.json --list-models` to see what the server has.

## Output shape

```json
{
  "ok": true,
  "promptId": "1c3bc239-...",
  "outputs": [
    { "type": "image", "filename": "K2_00125_.png", "subfolder": "one_krea2",
      "url": "https://comfy.tjtj.cloud/view?filename=K2_00125_.png&subfolder=one_krea2&type=output" }
  ],
  "localFiles": ["/tmp/out/K2_00125_.png"],
  "seed": 12345, "steps": 8,
  "graphSubmitted": { }
}
```

`stage` on failure: `config | auth | upload | submit | generate | interrupted | timeout | download | network`.

## Verified against a live ComfyUI

- **krea2** — `--dry-run` t2i/i2i graph node-for-node identical to the studio's `buildGraph`
  output; real `t2i` submit → `K2_00125_.png` rendered → `--out` downloaded a valid 1.5 MB PNG.
- **zimage** — `--dry-run` t2i graph identical to the studio (`ModelSamplingAuraFlow`, clip
  type `lumina2`); real `t2i` submit → `ZIT_00092_.png` rendered → downloaded.
- **upscale** — `--dry-run` graph identical to the studio's `buildUpscaleGraph`;
  `--list-models` returns the server's 5 SeedVR2 files.
- All `.mjs` pass `node --check`; `--help` runs with zero deps.

## Not in scope

Single output per call. No batching, no gallery, no post-processing chains, no clip relay.
Krea2 Identity Edit and Z-Image inpaint/rebg/controlnet/face-redraw are not ported. Prompt
authoring stays with the Hermes prompt skill — these consume finished text.
