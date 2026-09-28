# SPEC — Gallery: Upscale + Frame Interpolation on a finished clip

Status: implemented in ComfyUI-TJ_NODE_STUDIO_ONE. Port to web.

Two new buttons in the gallery header, right of `🔗 Stitch`:

```
★ stitched only | 🔗 Stitch | ⬆ Upscale | 🎞 Interpolate | ↻ | 📂 Open folder | ✕ Close
```

Both work like stitch mode — arm the mode, pick from the grid, run from a bar that appears
under the header — with one difference: **the target is a single video**, not a multi-pick.
Both operations are per-file, and a multi-pick would just be a batch queue nobody asked for.

---

## Mode handling

The three modes (stitch / upscale / interpolate) are **mutually exclusive**: they all take
over what a click on a grid card means. One `setMode(m, render = true)` arms one and
disarms the rest, resetting `stitchOrder` / `postPick` and toggling each bar's visibility.
The stitch button now routes through it too rather than toggling itself.

- `postMode`: `null | "upscale" | "rife"`
- `postPick`: a single video key (`subfolder|filename`), toggled by clicking a card
- picked card gets a `✓` badge (stitch keeps its ordinal number badge)
- `postRunning` blocks mode switching, card picking, and a second Run while a job is queued
- closing the gallery calls `setMode(null, false)` — `render:false` because `hide()` has
  just emptied the grid to stop the hover videos, and re-rendering would put them back.
  Skipped entirely while `postRunning`, so a queued job's bar survives a close/reopen.

---

## Upscale bar

Offers both methods from the left panel, defaulting to whatever that panel is set to, so a
clip can be upscaled after the fact with the settings it would have been given during the run.

| control | notes |
|---|---|
| method | `Upscale Model` \| `RTX VSR` (from `UPSCALE_MODES`, minus `none`) |
| model | `upscale_models` from `getModels()`; rebuilt on every gallery open, since that fetch may land after the gallery was built |
| scale / quality | RTX only — `1–4`, and `LOW/MEDIUM/HIGH/ULTRA` |

Graph (`buildUpscaleGraph`):

```
VHS_LoadVideo → [ RTXVideoSuperResolution | UpscaleModelLoader→ImageUpscaleWithModel ]
              → CreateVideo(fps: 24, audio: [load,2]) → SaveVideo(<folder>/<stem>_upscaled)
```

RTX keeps the dot-addressed dynamic combo the render path already uses:
`resize_type: "scale by multiplier"`, `"resize_type.scale": n`.

---

## Interpolate bar

**Node: `RIFEInterpolation` (display name "RIFE Frame Interpolation", category
`image/animation`).** This is NOT ComfyUI-Frame-Interpolation's `RIFE VFI` — they are
different nodes with different interfaces. `RIFE VFI` takes an integer `multiplier`;
this one takes an explicit **source/target fps pair**, so 24 → 60 is expressible instead
of being rounded to the nearest whole multiple.

| control | value |
|---|---|
| source fps | **hardcoded 24** (`FPS`) — every clip in this gallery was rendered at 24, so there is nothing to choose |
| target fps | editable, default 48, must be `> 24` |
| scale | `0.25 / 0.5 / 1.0 / 2.0 / 4.0`, default 1.0 — *processing* scale (motion estimation), not output size |
| batch | 1–32, default 8 — frames in parallel; higher is faster and uses more VRAM |
| fp16 | default on |

`model_name` is `flownet.pkl` (the node's only option) and is not exposed.

Graph (`buildInterpolateGraph`):

```
VHS_LoadVideo → RIFEInterpolation(source_fps, target_fps, scale, model_name, batch_size, use_fp16)
              → CreateVideo(fps: target_fps, audio: [load,2]) → SaveVideo(<folder>/<stem>_<n>fps)
```

**The encode uses `target_fps`**, so the clip keeps its original running time and simply
moves more smoothly. Encoding at the source rate would turn the extra frames into slow
motion — a real effect, but not what this button claims, and the audio would no longer line up.

---

## Progress

A shared readout per bar: a label plus a fill bar, driven by `queuePrompt`'s `onProgress`.

- `ImageUpscaleWithModel` and `RIFEInterpolation` tick per frame → real percentage bar.
- `RTXVideoSuperResolution` reports nothing — it upscales the whole batch inside one node
  call, so there is no per-step event. The bar just says it is working. This is expected,
  not a bug to chase.

---

## Run wrapper

```
copyOutputToInput(file)        # VHS_LoadVideo only lists input/; copy_to_input is
                               # format-agnostic, it just moves bytes
→ build graph
→ queuePrompt(graph, { onProgress })
→ refresh()                    # result lands in the same output subfolder, so a plain
                               # reload is enough — no special-casing in the grid
```

Failures land in the bar (`✕ <message>`) and a popup; `postRunning` is cleared in `finally`.

**Cleanup — required.** `copy_to_input` names every copy `<prefix>_<uuid8>_<name>`, so each
run leaves a fresh file in the input folder. That is the same accumulation
SPEC_MINIMAX_H3_TEMP_FILE_CLEANUP.md just fixed, so the copy is deleted in the wrapper's
`finally` (success and failure alike) via a new route:

```
POST /minimax_h3_one/discard_input   { filename }
```

It refuses any name that does not start with the pack prefix (`mmh3_`), so it can never be
pointed at a user's own asset — verified: a copied file returns `{ok:true}`,
`Architecture.png` returns `{ok:false,"not a copied file"}`. Client side it is
`discardInputCopy(filename)`, fire-and-forget.

---

## Availability

`RIFEInterpolation`, `UpscaleModelLoader`, and `ImageUpscaleWithModel` were added to the
optional-node list (both the JS constant and `MMH3_OPTIONAL_NODES` in `nodes.py`) so
`ctx.availability` reports them. Each bar greys its Run button and says which node is
missing when it isn't installed.

---

## Gotcha worth copying

`el()` funnels unknown props through `setAttribute`, so `selected: false` on an `<option>`
still sets the attribute and the parser reads it as selected. Build the options bare and
assign `select.value` afterwards.
