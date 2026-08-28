# SPEC — settings persistence (workflow copy vs. browser's last-used)

Relayed from `ComfyUI-TJ_NODE_STUDIO_ONE`, earlier in the 2026-08-27/28 session — missed
in the first relay pass, caught 2026-08-28 when checking what postdates
`SPEC_GALLERY_UPSCALE_INTERPOLATE.md`.

## The bug

`onConfigure` (loading a saved workflow) always let the workflow file's serialized node
state overwrite whatever was already on screen — including a browser's own more-recent
settings, seeded from localStorage when the node was first dropped. Opening an older
saved workflow silently reverted every setting changed since. User explicitly wants: "the
left panel should remember the last value used; only use defaults on first drop; deleting
and recreating the node keeps the last-queued settings."

## The fix

Every settings write is now stamped with a timestamp:

```js
// core_minimax.js
export function saveState(s) {
  localStorage.setItem(LS_KEY, JSON.stringify({ ...s, savedAt: Date.now() }));
}
export function lastUsedAt() {
  const v = loadState().savedAt;
  return typeof v === "number" ? v : 0;
}
```

`defaultState()` normalization now carries `savedAt` through (so it survives being
embedded in a workflow file).

The node-state restore helper takes an optional newer-than guard:

```js
// shared/node_state.js
export function restoreNodeState(node, { preferNewerThan = 0 } = {}) {
  // ...same as before, except: if preferNewerThan is set and the workflow's
  // stored savedAt is older than it, skip applying — keep what's on screen.
}
```

Caller (the node's `onConfigure`):

```js
restoreNodeState(this, { preferNewerThan: lastUsedAt() });
```

Passing nothing (`restoreNodeState(this)`) keeps the old unconditional behavior — this is
intentional back-compat for any other node/site path that doesn't want the guard yet.

Additionally: `persist()` is now also called at queue time, so the settings that produced
a render are "the last used" even if the user tweaks something afterward without queueing
again.

## What the site needs to check

If the website has its own copy of node-state save/restore for MiniMax H3 (or any other
ONE STUDIO tool) backed by the same localStorage-seed-then-workflow-overwrite pattern,
the same bug is very likely present there: opening an older saved project/workflow will
silently discard settings changed since. Same fix shape applies — stamp saves with a
timestamp, compare on restore, keep the newer one.

If the site instead treats server state as sole source of truth (no per-browser
localStorage seed), this may not apply — confirm which model it uses before porting.
