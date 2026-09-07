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
| `krea2-headless/` | Krea2 image | t2i, i2i, identity-edit (+ optional ControlNet) |
| `zimage-headless/` | Z-Image Turbo image | t2i, i2i |
| `upscale-headless/` | SeedVR2 image upscale (shared Krea2/Z-Image graph) | — |
| `video-rtx-headless/` | RTX video upscale / deblur (RTXVideoSuperResolution + TJ_RTXDeblur) | upscale / deblur / both |
| `music-headless/` | MusicMaker song / instrumental | engine: acestep \| minimax |

Each folder has its own `README.md` with the full `job.json` schema. This doc is the overview.

---

## Install (Mac)

```
git clone https://github.com/designloves2/AI-ONE-STUDIO
cp -r AI-ONE-STUDIO/krea2-headless   ~/.hermes/skills/krea2-generate
cp -r AI-ONE-STUDIO/zimage-headless  ~/.hermes/skills/zimage-generate
cp -r AI-ONE-STUDIO/upscale-headless ~/.hermes/skills/upscale
cp -r AI-ONE-STUDIO/music-headless   ~/.hermes/skills/music-generate
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
- **krea2 identity edit** — `mode:"identity"`, `identityImage:"/abs/portrait.png"`, and
  `prompt` is the edit instruction. The identity-edit LoRA comes from the config
  (`identity_lora`); pass `identityLora` only to override. Needs `comfyui-krea2edit` on the
  server. Optional: `identityImageB`, `identityLoraStrength`, `identityFitMode`,
  `identityRefBoost`, `identityGroundingPx` (0 = native), `identityWidth`/`identityHeight`.
  `negativePrompt` is ignored (breaks identity grounding). Full schema: `krea2-headless/README.md`.

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

**video-rtx (RTX video upscale / deblur — RTX only)**

```json
{ "op": "upscale", "video": "/abs/clip.mp4", "scale": 2.0, "quality": "HIGH" }
{ "op": "deblur",  "video": "/abs/clip.mp4", "quality": "HIGH" }
{ "op": "both",    "video": "/abs/clip.mp4", "scale": 2.0, "quality": "HIGH" }
```

- `op` = `upscale` | `deblur` | `both`. `quality` = `LOW|MEDIUM|HIGH|ULTRA` (default `HIGH`),
  used for both the deblur strength and the upscale quality. `scale` default `2.0`.
- `fps` default `24` — set it if the source clip isn't 24fps.
- "영상 업스케일 해줘. 2.0배율, HIGH옵션" → `{op:"upscale", scale:2.0, quality:"HIGH", video:"…"}`.
  "영상 디블러 해줘, HIGH옵션" → `{op:"deblur", quality:"HIGH", video:"…"}`.

**music (MusicMaker song / instrumental)**

```json
{ "engine": "acestep", "caption": "warm K-ballad, piano and strings, female vocal",
  "lyrics": "[Verse]\n...\n[Chorus]\n...", "duration": 210, "title": "Leaving at Dawn",
  "bpm": 72, "keyscale": "D minor", "vocalGender": "female" }
{ "engine": "minimax", "caption": "lofi hip-hop, rainy night", "instrumental": true, "duration": 120 }
```

- **`caption` and `lyrics` are finished text** — no LLM step here (prompt authoring stays with
  the Hermes prompt skill). `instrumental:true` forces no vocals. Album cover is out of scope.
- `engine` = `acestep` (default, cleaner 48 kHz) or `minimax`. Model files come from
  `GET /music_one/config` — omit `dit`/`aceUnet`/etc. normally.
- Ace-Step reads `bpm`/`keyscale`/`timesignature` as structured inputs; MiniMax folds them
  into the caption text (it has no structured fields).
- `aceStages` = `[{steps,cfg,on?}]`; stage 1 always runs, 2 & 3 opt-in and sequential.
- Renders are long — bump `comfy.json` `timeoutMs` (a 3-min Ace-Step 3-stage can take 30+ min
  on a 16 GB card). Output type is `"audio"`; `format` `flac`|`mp3`|`opus`.
- Full `job.json` schema in `music-headless/README.md`.

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
  Identity edit (`mode:"identity"`) — `--dry-run` graph matches the studio's `buildIdentityGraph`
  (`Krea2EditModelPatch` / `Krea2EditGroundedEncode` + identity LoRA from `identity_lora`).
- **zimage** — `--dry-run` t2i graph identical to the studio (`ModelSamplingAuraFlow`, clip
  type `lumina2`); real `t2i` submit → `ZIT_00092_.png` rendered → downloaded.
- **upscale** — `--dry-run` graph identical to the studio's `buildUpscaleGraph`;
  `--list-models` returns the server's 5 SeedVR2 files.
- **video-rtx** — `--dry-run` graph identical to the studio's `buildUpscaleGraph` RTX path;
  real `op:"upscale"` scale 2.0 / HIGH on a 544×352 clip → `srcclip_upscaled_00001_.mp4`
  rendered (822 KB, ~2.2× the source) → `--out` downloaded a valid `ftypisom` MP4.
- **music** — `--dry-run` acestep graph = 16 nodes (unet/shift/clip/vae/pos/neg/lat/sel +
  3× sched/SamplerCustom + dec/save), minimax graph = 9 nodes, both node-for-node identical
  to the studio's `buildMusicGraph`; model files auto-pulled from `GET /music_one/config`;
  vocal/BPM/key hints folded into the caption (minimax) or set as structured inputs (acestep);
  `SaveAudioAdvanced` dotted key `format.quality`. Real minimax 30 s instrumental mp3 submit
  → `MMM_00010.mp3` rendered → `--out` downloaded a valid 410 KB MP3.
- All `.mjs` pass `node --check`; `--help` runs with zero deps.

## Not in scope

Single output per call. No batching, no gallery, no post-processing chains, no clip relay.
Z-Image inpaint/rebg/controlnet/face-redraw are not ported (Krea2 t2i/i2i/identity and
ControlNet are).
MusicMaker's LLM (caption/lyric authoring), album cover, generation queue, and tagged-MP3
export are not ported — music-headless takes finished caption + lyrics and returns the raw
`SaveAudioAdvanced` file. Prompt authoring stays with the Hermes prompt skill — these
consume finished text.
