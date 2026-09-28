# SPEC — add a pipeline preset dropdown (new feature, not a port of an existing bug)

Relayed 2026-08-28. Unlike the other MiniMax H3 specs this isn't porting a fix — the node
side added a feature (`web/minimax/presets_minimax.js`) that the site does not have at
all. Please build the equivalent.

## What it is

A "Preset" dropdown, one entry per named pipeline combination, that sets six axes at once
(turboMode, attnBackend, attnForward, blockCache, useSpectrum, useTorchPatch,
useFusedModulation, and pddNfe when relevant). It never touches steps, seed, length,
resolution, or model pickers — those are what a comparison is held constant against, and a
preset that moved them would invalidate whatever it was picked for.

The current selection is **derived**, not stored: on every render, compute which preset (if
any) the state's axes currently match, and show that. If someone hand-edits one of the
underlying controls, the dropdown falls back to "— Custom —" on its own rather than going
on naming a combination that no longer applies. This matters because a wrong label on a
render that takes 15-30 minutes is expensive to discover late.

## The six presets (node's `presets_minimax.js`, verbatim)

These came out of a 39-configuration benchmark on Reference mode / 1.0MP / 8s / 25 steps,
one fixed seed, ~16 hours of rendering. Headline finding, if useful context for whoever
builds this: FirstBlockCache alone is worth ~44% of render time and everything else was
noise around it (five attention backends landed within 4% of each other once it was on);
Spectrum forecasting is a net loss stacked on top of that cache (re-confirmed at 50 steps)
but a real win with no cache running underneath, which is why it only appears on the PDD
entry below.

```js
// id, category, label, note, turbo, backend, forward, cache, spectrum, torch, fused, nfe

18, "Everyday", "Sage + MemEff + FirstBlockCache",
  "The default. 17.5 min for an 8s clip at 1.0MP / 25 steps, against 30.4 with nothing on
   — the cache is the whole 44%. For fast camera or character motion raise steps to
   40-50; that is the one change that visibly cleared smearing, and no accelerator here
   substitutes for it."
  turbo=none backend=sage forward=memeff_sage cache=fbcache spectrum=false torch=true fused=false

31, "Fast", "SLA Turbo (lightx2v)",
  "6.3 min at the same quality as the 25-step stacks — the quickest configuration that
   held up. 64 s/step against larryvrh's 95, because the SLA kernel actually removes
   work. In Reference mode it needs the ref2v LoRA; the fl2v file silently does nothing."
  turbo=lightx2v backend=sla forward=none cache=none spectrum=false torch=true fused=false

38, "Fast", "PDD 8 nfe + Spectrum",
  "8.2 min, eight evaluations instead of six, quality indistinguishable from the full
   stacks. PDD cannot use a block cache, which is exactly why Spectrum belongs here —
   with nothing else skipping steps it takes 27% off (11.3 -> 8.2)."
  turbo=pdd backend=none forward=none cache=none spectrum=true torch=true fused=false nfe="8"

4, "Cautious", "No cache, no forecasting",
  "Dense attention only; nothing skips or approximates a step. 30.7 min against 17.5,
   and the bench found no quality difference to justify that — but its quality scores
   could not resolve anything under two points. Reach for this when output looks wrong
   and you want the caches ruled out."
  turbo=none backend=sage forward=memeff_sage cache=none spectrum=false torch=true fused=true

1, "Cautious", "Stock — no patches at all",
  "Everything off, including the Torch patch. The honest floor, and the first thing to
   try when you need to know whether the pipeline caused a problem or the model did."
  turbo=none backend=none forward=none cache=none spectrum=false torch=false fused=false

5, "First-Last / Text", "larryvrh 4-step turbo",
  "6.3 min, but only outside Reference mode: larryvrh publishes no reference-mode
   weights, and in Reference the LoRA does not take — it scored 2/5 with heavy blur
   across every run. Untested for first-last and text so far. Use preset 31 for fast
   Reference work."
  turbo=larryvrh backend=sage forward=memeff_sage cache=none spectrum=false torch=true fused=true
```

The numeric ids (1, 4, 5, 18, 31, 38) are retained from the 39-row benchmark so a preset
here and a row in the (private) bench report are the same thing. Keep them as-is; don't
renumber 1-6.

## Web-side field-name mapping

The web port doesn't have `attnForward`/`slaTurboLora` in quite the shape the node does
(per the earlier PDD relay: lightx2v stays a plain `loras[]` entry here, not a dedicated
field). Map onto whatever the web state actually calls each axis — turboMode,
attention-backend selector, attention-forward selector (or its web equivalent), block
cache selector, the Spectrum toggle, the Torch-patch toggle, Fused Modulation toggle, and
`pddNfe` for the PDD entry. The match/apply logic below is field-name agnostic; substitute
your real state keys.

## Two functions

```ts
// derive: which preset (if any) do the current axes match?
function matchPreset(state): Preset | null {
  return PRESETS.find(p =>
    p.turbo === state.turboMode &&
    p.backend === state.attnBackend &&
    p.forward === state.attnForward &&
    p.cache === state.blockCache &&
    p.spectrum === !!state.useSpectrum &&
    p.torch === (state.useTorchPatch !== false) &&
    p.fused === !!state.useFusedModulation &&
    // nfe only matters for pdd rows; null everywhere else so it never blocks a match
    (p.nfe ?? null) === (state.turboMode === "pdd" ? String(state.pddNfe ?? "8") : null)
  ) ?? null;
}

// apply: write a preset's axes onto state, nothing else
function applyPreset(state, preset) {
  state.turboMode = preset.turbo;
  state.attnBackend = preset.backend;
  state.attnForward = preset.forward;
  state.blockCache = preset.cache;
  state.useSpectrum = preset.spectrum;
  state.useTorchPatch = preset.torch;
  state.useFusedModulation = preset.fused;
  if (preset.nfe) state.pddNfe = preset.nfe;
  state.fp16Accum = true; // rides along with the Torch patch on every preset that has it
}
```

## UI

A dropdown above/near the Turbo section (the node puts it right under Clip length, but
place it wherever the site's layout makes sense), showing:

```
— Custom —                              (when matchPreset() returns null)
Everyday — Sage + MemEff + FirstBlockCache
Fast — SLA Turbo (lightx2v)
Fast — PDD 8 nfe + Spectrum
Cautious — No cache, no forecasting
Cautious — Stock — no patches at all
First-Last / Text — larryvrh 4-step turbo
```

Selecting an entry calls `applyPreset` then re-renders. The chosen entry's `note` string
should show somewhere near the dropdown (a hint line, tooltip, whatever the site's pattern
is) — it's the "why would I pick this" text and is most of the value of having presets at
all.

## Not required

The node's `matchPreset` is recomputed on every render call rather than cached/stored —
match whatever reactivity pattern the site already uses to get the same "falls back to
Custom automatically" behavior; the implementation doesn't need to be structured
identically to the node's vanilla-JS version.
