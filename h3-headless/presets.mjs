// presets.mjs — preset resolution.
//   1. runtime lookup of the backend config's user_presets[] by name
//   2. fallback to the 6 built-ins (SPEC_MINIMAX_H3_PRESETS.md) by alias / label / id
//   3. null preset -> keep the config defaults
//
// A user preset can carry, beyond the 8 axes, a full recipe: steps / sampler / scheduler /
// denoise / shift* / turbo* step counts + files, and (new) unetFirstLast / unetReference —
// so a preset benchmarked on a specific merge/finetune restores that model. Built-ins carry
// axes only; applyPreset writes only the keys a preset actually has.

export { BUILTIN_PRESETS, resolvePreset, applyPreset, RECIPE_KEYS } from "./core-helpers.mjs";

import { resolvePreset, applyPreset } from "./core-helpers.mjs";

/** Resolve `name` against `userPresets`, apply onto `state`. Returns { source, name } or
 *  throws a `.stage = "preset"` error when the name is unknown. */
export function applyPresetByName(state, name, userPresets) {
  const hit = resolvePreset(name, userPresets);
  if (!hit) {
    const err = new Error(`unknown preset '${name}'`);
    err.stage = "preset";
    throw err;
  }
  if (hit.preset) applyPreset(state, hit.preset);
  return { source: hit.source, name: hit.preset ? hit.preset.name || hit.preset.alias : null };
}
