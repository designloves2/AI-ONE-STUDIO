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

# v1.23.2 additions (node commit `762b011`)

## 6. "Also save the clip before deblur / upscale" (left-panel toggle)

`state.saveUnprocessed` (bool, default false). A `checkboxRow` at the bottom of the
**Upscale** accordion body — rendered only when `deblurNow !== "none" || upscaleMode !==
"none"`. Label: "Also save the clip before deblur / upscale".

- `buildClipGraph`: `const saveRawToo = !!state.saveUnprocessed && !!(deblurUsed ||
  upscaleUsed)`. When true, add `N.videoRaw` (CreateVideo on the **pre-process** images —
  captured as `preProcImages = [N.decode, 0]` right before the deblur/upscale block
  reassigns `images`; same audio wiring as `N.video`) + `N.saveRaw` (SaveVideo, filename
  prefix gets a `_raw` suffix). Return `rawVideoNode: saveRawToo ? N.saveRaw : null` in
  the meta.
- Run loop, right after the main clip's `saveMeta`: `const rawVid = ran?.rawVideoNode ?
  firstOutput(res.byNode, ran.rawVideoNode) : null;`. If present, build `rawMeta = {
  ...clipMeta, deblur: null, upscale: null, unprocessed: true, processedSibling:
  vid.filename }`, `delete rawMeta.sourceW/sourceH`, reset `w/h` to
  `resolveResolution(rs.aspect, rs.megapixels)`, then `await reconcileGeometry(rawMeta,
  rawVid, { noSource: true })`, then `saveMeta`. **Never** `clipRecords.push(rawVid)` —
  the raw clip is a keeper, not part of the stitch or the last-frame chain.
- `reconcileGeometry` gains `{ noSource }`: when set, it still overwrites `w/h/fps/frames`
  from the probe but never records `sourceW/H` (the `_raw` file IS the original, a size
  difference from the seeded `meta.w` isn't a "pre-op size").

## 7. `⇄` interpolation badge

The bottom-left badge stack (§5) gets a third glyph: `⇄` when `m.interpolate` (title
`Interpolated — Nfps` from `m.interpolate.targetFps`). Glyphs are `⇪` / `✧` / `⇄`, in
that order, any can show. The ⓘ `⚙`-line synthesis (§5) also appends `"interpolation"`
when `m.interpolate` is set and `m.postProcess` is absent.

## 8. Bug fix — `refreshUpBar` TDZ (present since v1.20.0, node-only find)

In `ui_gallery_minimax.js refreshUpBar()`, `const ready = … (noUpscale ? (deblurOn &&
deblurOk) : …)` referenced `noUpscale` / `deblurOn` / `deblurOk` **three lines before**
their `const` declarations → `ReferenceError` on every call → `upGoBtn.disabled` (line
after) never ran, so the gallery `⬆ Upscale` and `✦ Deblur` buttons were stuck disabled
(they defaulted disabled). Fix: move the three `const`s above `ready`. Check the web's
equivalent (`refreshUpBar` / the post-process bar's ready check) for the same ordering.

---

## Verify — DONE node-side (2026-09-02, real ComfyUI renders)

- §1: module import, 5 cases.
- §2: real PDD 8-step / 0.2MP render, Upscale = model ×2 + Deblur MEDIUM → meta
  `w/h` 1088×704, `sourceW/H` 544×352, `deblur: "MEDIUM"`, `upscale: {method:"model",
  model:"RealESRGAN_x2.pth"}`, no `postProcess` (inline).
- §3: ↩ Reuse of an inline clip → node state `deblurStrength` / `upscaleMode` /
  `upscaleModel` restored.
- §4: real gallery deblur+upscale pass → `postProcess: "deblur + upscale"`, structured
  `deblur` / `upscale`, `sourceW/H` 1440×960 → `w/h` 2880×1920.
- §5 + §7: `⇪` / `✧` / `⇄` badges all render with correct titles; ⓘ tooltip
  `⚙ deblur + upscale (from 1440×960)`.
- §6: real render with the toggle on → both `_00002` (upscaled) and `_raw_00001`
  (544×352, `unprocessed: true`, `processedSibling`, no badges) written.
- §8: fix confirmed — the gallery `⬆ Upscale` button went from permanently disabled to
  enabling on a valid pick, and the combined pass ran.
