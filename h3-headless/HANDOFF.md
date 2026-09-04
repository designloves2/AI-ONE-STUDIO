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
| `mode` | `ref2va` \| `fl2va` \| `l2va` \| `t2va` |
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
| `pdd-8step` | PDD Acc + Sage + MemEff | config default UNET, per mode (FL2VA/Ref2VA) | 8 (nfe) |
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

## 9. Not in scope (per the spec)

Single clip only — no clip relay / stitching, no gallery, no upscale / interpolate. Prompt
authoring stays with the Hermes prompt skill; this consumes finished text.

## 10. One repo-side change that shipped with this

`RECIPE_KEYS` in `src/tools/minimax_h3/core.ts` gained `unetFirstLast` / `unetReference`
(commit `ba8b3b8`) so a **saved user preset can pin its model**. Backward-compatible: old
presets and the 6 built-ins are unaffected. The studio's "Save preset" now also captures the
current model; "Apply preset" restores it.
