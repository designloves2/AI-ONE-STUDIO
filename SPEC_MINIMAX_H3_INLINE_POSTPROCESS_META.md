# SPEC — MiniMax H3: inline deblur/upscale meta + gallery badges

Node **ComfyUI-TJ_NODE_STUDIO_ONE v1.23.1** (commit `8cada97`). Port to the web twin.
Node files: `web/minimax/graph_builder_minimax.js`, `web/one_node_minimax_h3.js`,
`web/minimax/ui_gallery_minimax.js`.

The node is authoritative. This carries the intent + the exact field shape it landed on —
read the node source for the wiring. No wire-format / API changes; `mmh3_video_info` and
`save_meta` already exist and already return `width/height/frames/fps`.

---

## The bug

A clip generated with **inline** deblur (`TJ_RTXDeblur`) or upscale
(`ImageUpscaleWithModel` / `RTXVideoSuperResolution`) wired into the render graph got a
sidecar whose `w/h` were still `resolveResolution(aspect, megapixels)` — the pre-decode
size. The upscaled dimensions were never written and there was no deblur/upscale marker at
all. The **gallery** post-process path already re-probes the output and records
`postProcess` + `sourceW/H`; the generation path had no equivalent. Also: a combined
gallery deblur→upscale pass recorded `postProcess: "upscale"` only — the deblur was lost.

---

## 1. `buildClipGraph` meta — the two new keys

Where the graph conditionally wires the frame ops, track what actually ran and add to the
returned `meta`:

```js
deblur:  <strengthString> | null      // e.g. "0.35"; null when TJ_RTXDeblur wasn't wired
upscale: { method: "model", model: <name> }
       | { method: "rtx", scale: <number>, quality: <string> }
       | null
```

`deblur` is set only inside the `if (state.deblurStrength && ... && has(avail,"TJ_RTXDeblur"))`
block; `upscale` only inside the `up === "model"` / `up === "rtx"` branches — i.e. mirror
the exact conditions that add the nodes, don't recompute from raw state.

## 2. Generation save path — re-probe on upscale

New helper in `one_node_minimax_h3.js` (next to `metaForVideo`):

```js
async function reconcileGeometry(meta, file, { keepFrames = false } = {}) {
  // getVideoInfo(file.filename, file.subfolder, file.type||"output")
  // on a real size change: meta.sourceW/H = old meta.w/h
  // always: meta.w/h/fps <- probed; frames + durationSeconds too unless keepFrames
  // swallow errors — keep computed geometry rather than fail the run
}
```

Call sites:
- **per clip** (`saveMeta(vid...)`): pull `ran.deblur` / `ran.upscale` into the meta
  `extra`; then `if (ran?.upscale) await reconcileGeometry(clipMeta, vid);`
  (deblur alone never resizes — skip the round trip).
- **One-Take stitch**: `await reconcileGeometry(oneTakeMeta, out, { keepFrames: true });`
  — its `durationSeconds` is already the overlap-trimmed total, don't clobber it.
- **Extend stitch**: `await reconcileGeometry(extendMeta, out);` (frames were `null`,
  the probe fills them in).

## 3. `reuseAll` — restore an inline pass

```js
if (!meta.postProcess) {                       // inline only — a gallery post-processed
  if (meta.deblur !== undefined)               // file carries the SOURCE's meta and §5
    state.deblurStrength = meta.deblur || "none";  // Reuse rebuilds that original
  if (meta.upscale === null)            state.upscaleMode = "none";
  else if (meta.upscale?.method==="rtx") { state.upscaleMode="rtx";
    state.rtxScale = meta.upscale.scale; state.rtxQuality = meta.upscale.quality; }
  else if (meta.upscale?.method==="model"){ state.upscaleMode="model";
    state.upscaleModel = meta.upscale.model; }
}
```

## 4. Gallery `writePostMeta` — record every stage

- new arg `postInfo` (`{ deblur, upscale, interpolate }`), threaded from `runPost`
  through `stashPostJob` (so a resumed job still writes it) to `writePostMeta`.
- `postProcess` is now `postLabel(fallback, postInfo)` — joins the stages that ran:
  `"deblur + upscale"`, `"rtx upscale"`, `"interpolation"`, … falls back to the bare
  label lower-cased.
- write `deblur` / `upscale` / `interpolate` as their own keys (same shapes as §1;
  `interpolate` = `{ targetFps }`).
- `sourceW/H` now written **only on a real size change** (was: always = source w/h),
  so a deblur-only pass no longer shows a redundant "(from 896×896)".
- `runUpscale` builds `upscale` from `upMethod` + the rtx/model inputs; `runDeblur`
  passes `{ deblur, upscale:null }`; `runInterpolate` passes `{ interpolate:{targetFps} }`.

## 5. Thumbnail card badges + tooltip

- bottom-left badge stack on the thumb wrapper, read from `v.meta`:
  `⇪` when `m.upscale` (title = `RTX VSR ×N (QUALITY)` or the model basename),
  `✧` when `m.deblur && m.deblur !== "none"` (title = `strength X`). Both can show.
  Same 18px `rgba(0,0,0,0.6)` chip style as the ✕ / ⓘ buttons.
- these keys are identical whether the pass was inline (§1) or a gallery job (§4), so
  one badge block covers both.
- ⓘ tooltip: the `⚙` line falls back to synthesising a label from `m.deblur`/`m.upscale`
  when `m.postProcess` is absent (the inline case).

---

## Verify (once a run is free)

Generate one clip with Upscale = RTX ×2 set in the left panel → gallery card shows `⇪`,
ⓘ shows `⚙ rtx upscale (from W×H)` and the upscaled `w×h`. Gallery deblur→upscale on a
clip → card shows `⇪` + `✧`, meta `postProcess: "deblur + upscale"`. Reuse the inline
clip → left panel comes back with Upscale = RTX ×2.
