# SPEC — MiniMax H3: stop the relay leaving temp files behind

Status: implemented in ComfyUI-TJ_NODE_STUDIO_ONE, needs the same treatment on web.

Two separate leaks, both from the multi-clip relay. Neither affects output — they just
pile up files nobody reads.

---

## 1. Chain frames copied to `input/` in every continuity mode

**Symptom.** 89 stray `mmh3_*_ComfyUI_temp_*.png` in the ComfyUI input folder
(the user's is remapped to `C:\AI\input`), on a run that was **not** Last Frame Chain.

**Cause.** In the run loop, after each clip finishes:

```js
if (lastImg) {
  await setLastResult(self.id, { image: lastImg });
  let carry = lastImg;
  const tail = allOutputs(res.byNode, NODE_IDS.tailPrev);
  ... pickChainFrame ...
  chainFrame = await copyOutputToInput(carry.filename, ...);   // ← always ran
}
```

`chainFrame` is only ever *consumed* when `continuityMode === "lastframe"`. In every
other mode the copy was made and immediately orphaned — one per clip, forever, because
nothing cleans the input folder.

**Fix.** Gate the whole chain-frame block on the mode. Continuity is fixed for the
duration of a run, so read it off the run snapshot (`rs`), not live state:

```js
if (lastImg) {
  await setLastResult(self.id, { image: lastImg });
  if (rs.continuityMode === "lastframe") {
    ...pickChainFrame / copyOutputToInput...
  }
}
```

**Related.** The tail previews only exist to let `pickChainFrame` step back past a
fade-to-black, so they are dead weight in the other modes too — eight temp PNGs per
clip. `buildClipGraph` takes a new option:

```js
buildClipGraph({ ..., saveLastFrame: true, saveTailPreviews: rs.continuityMode === "lastframe" })
```

and the builder wraps its `MM:tail_frames` / `MM:tail_preview` nodes in
`if (saveTailPreviews) { ... }`. Default `true`, so no other caller changes.

---

## 2. One last-frame PNG per clip kept forever in `output/<pack>/frames`

**Symptom.** 400 `MMH3_clip001_last_00139_.png`-style files.

**Why they can't just be dropped.** The node's `last_frame` output slot doesn't hold a
tensor — `get_output` re-opens the recorded file from disk on every RUN:

```python
rec = _mmh3_last.get(uid, {})
info = rec.get("image", {})
path = os.path.join(base, info["subfolder"], info["filename"])
img  = Image.open(path).convert("RGB")
```

So the *current* file has to survive the render. But only the current one is ever read,
and `_mmh3_last` is an in-memory dict that's empty again after a restart — nothing older
is reachable by anything.

**Fix.** `SaveImage` always appends a counter and cannot overwrite, so instead of
fighting it, delete the previous file when a new one replaces it. Keeping exactly one
live file is the same end state as overwriting a fixed name.

Server side, in the `set_last_image` route, before `rec["image"] = nxt`:

```python
def _mmh3_drop_stale_last_frame(prev, nxt):
    # deliberately narrow: only a .png this node just wrote, in a ".../frames"
    # subfolder, resolved under the output root. Anything unexpected is left alone.
    ...
    root = os.path.realpath(folder_paths.get_output_directory())
    path = os.path.realpath(os.path.join(root, sub, old_name))
    if os.path.commonpath([root, path]) != root: return
    if os.path.isfile(path): os.remove(path)
```

Guards, all of which must pass: filename ends `.png`; `type == "output"`; subfolder is
`frames` or ends `/frames`; the new record isn't the same file; and the resolved path is
inside the output root (path-traversal check). Wrapped in try/except — a failed cleanup
must never break the run, it just logs.

If the web build's last-frame handoff keeps the image in memory rather than round-tripping
through a saved PNG, item 2 doesn't apply; item 1 does either way.

---

## Existing files

Both fixes are forward-looking only. The already-accumulated files (89 in input, 400 in
output/frames on the desktop install) are left in place — deleting a user's output
folder is their call, not the patch's.
