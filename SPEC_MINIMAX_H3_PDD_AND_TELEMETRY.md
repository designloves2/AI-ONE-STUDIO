# SPEC — PDD Acc turbo, temperature telemetry, preset trim

Relayed from `ComfyUI-TJ_NODE_STUDIO_ONE` 2026-08-28. Backend/API surface changes the
website's MiniMax H3 tool needs to mirror.

## 1. New turbo mode: `pdd`

`turboMode` now has a third value alongside `none | larryvrh | lightx2v`: **`pdd`**.

Not a LoRA. The checkpoint (alibaba-pai's PDD Acc release) carries a trunk LoRA plus a
32-interval output-head bank, applied via the `MiniMaxH3PDDAccApply` node
(package `Jalen-Brunson/ComfyUI-MiniMax-H3-PDD-Acc`, optional — gate on it like any other
third-party node).

New per-mode state fields (mirror the larryvrh/lightx2v pattern — separate slots per
generation mode, since the release is split into Ref2VA / FL2VA files):

```
pddFile            // FL2VA file, for firstlast/t2v
pddFileReference   // Ref2VA file, for reference mode
pddNfe             // "8" | "4" | "6" — string, a discrete choice not a free number
pddLoraStrength    // default 1.0
pddHeadStrength    // default 1.0
```

When `turboMode === "pdd"`, the graph:
- gets `MiniMaxH3PDDAccApply` inserted where the other turbo LoRAs go (right after SigmaShift)
- takes its `sigmas` output instead of `BasicScheduler`'s
- forces the sampler to `euler` (KSamplerSelect, not the turbo sampler)
- forces `MiniMaxH3SigmaShift` to `12/3` regardless of the panel's shiftVideo/shiftAudio
  (the node's wrapper hard-errors on any other shift, and it does mid-render — pin it,
  don't just default it)
- effective step count is `Number(pddNfe)`, not the panel's `steps` field
- block cache is force-disabled the same as under larryvrh/lightx2v (a turbo schedule
  never reaches the caches' reuse threshold)

`GET /minimax_h3_one/models` now also returns a `pdd_acc` array (files from the
`pdd_acc` model folder, gated on the node pack being installed — empty array otherwise,
not an error).

## 2. GPU temperature telemetry

`GET /minimax_h3_one/vram_stats` now also returns (best-effort, via `pynvml`; absent if
NVML is unavailable):

```
gpuTempC     // instantaneous, Celsius
gpuPowerW    // instantaneous, Watts
gpuUtilPct   // instantaneous, 0-100
```

Rationale for the site if it ever surfaces this: GPU utilisation reads ~100% even while
a render is silently spilling to system RAM (the kernel is resident but stalled on
PCIe), so it cannot distinguish "slow" from "hung." Temperature can — idle sits ~52C,
real sampling runs 58-80C on this class of card. Site does not need to act on this, just
be aware the field exists if a future feature wants it.

Clip metadata sidecars now also carry `gpuTempMaxC`, `gpuPowerMaxW`, and `gpuIdlePct`
(share of samples under 58C — high value on a finished clip means it was spilling, not
that the configuration is expensive). Same shape/writer as the existing
`vramFreeMinMiB` etc. — no site action needed unless it renders metadata fields.

## 3. Metadata sidecar — new fields

Alongside the existing pipeline fields, clips now also record:

```
useTorchPatch     // bool — was silently missing before; two clips differing only in
                  //        this were previously indistinguishable after the fact
fp16Accum         // bool
preset            // int|null — id of the named preset the axes matched, if any
stepsEffective    // int — the sampler's actual step count (turbo overrides the panel's steps)
samplerUsed       // string — the sampler node actually wired (turbo overrides the panel's)
turboFile         // string|null — the LoRA/checkpoint the active turbo mode actually loaded
pddNfe            // string|null — set when turboUsed === "pdd"
```

If the site's Gallery/history view reads or displays sidecar fields, these five
(`stepsEffective`, `samplerUsed`, `turboFile`, `preset`, and the two above) are the ones
worth showing — `steps`/`sampler` alone are misleading on any turbo-mode clip.

## 4. Preset list trimmed to 6

`PIPELINE_PRESETS` in `web/minimax/presets_minimax.js` went from 39 (benchmark-era) down
to the 6 that a 39-configuration bench actually recommended. If the site has its own
copy of this list or calls into it, re-sync. Ids are stable for the 6 kept
(1, 4, 5, 18, 31, 38); the other 33 numbers are retired, not reassigned — do not reuse
them for new presets on either side.

Headline finding, if the site ever wants to explain the defaults: FirstBlockCache alone
is worth ~44% render time; Spectrum forecasting is a net loss layered on top of it
(measured at both 25 and 50 steps) but a real win with no cache running underneath
(used on the PDD preset for that reason).
