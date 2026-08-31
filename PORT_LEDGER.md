# PORT LEDGER — node ↔ web twin

One row per portable change between `ComfyUI-TJ_NODE_STUDIO_ONE` (the node) and
`AI_One_Studio` (the web twin). Both sessions write to this file. It exists so
node/web drift stops depending on one session's memory of what it already relayed
— three things went unported on 2026-08-31 and every one was a *relay* failure,
not a coding failure.

## How to use it

- Add a row the moment a change lands on either side, even if the other side is
  still `—`. A missing row is the failure mode this file prevents.
- `origin` records **which way the change travelled**:
  - `node→web` — spec-driven: built and verified on the node, relayed via a `SPEC_*.md`
  - `web→node` — found on the web side and reported back upstream (bugs in shipped
    node code have gone this way)
  - `user` — the user asked for it directly on one side; never entered a spec
- `verified` is the date the change was confirmed **working in a browser** on the
  side that lists it — not the commit date, not a syntax check.
- The spec carries **why** and the traps. The web reads the **node source** for
  what to build. That switch is what made the web ports start landing correctly.

## Anchors

| repo | commit | meaning |
|---|---|---|
| node | `da412e7` | v1.20.0 — the whole §1–§16 bundle |
| node | `cc644fe` | chunked-output suffix fix + dead `ollamaImages` list removal |
| node | `b31afc6` | README brought up to v1.20.0 |
| web  | `91ccc3b` | `ollamaImageMode` → `briefImageMode` rename |
| web  | `8d17c6b` | §6 note updated after node `cc644fe` |

## SPEC_MINIMAX_H3_PER_CLIP_OVERRIDE.md

| § | item | node | web | verified | origin | notes |
|---|---|---|---|---|---|---|
| 1 | Per-clip reference override (explicit checkbox, all-or-nothing, `clipAssets` resolver) | `da412e7` | `9a023ce` | 2026-08-31 | node→web | web `355da29` fixed a real port bug: the override was bound to the vision-only image list, so ticking the box changed nothing in the render. Bind to `refImages`. |
| 2 | Header + sound/music tail follow the override (`clipFraming`, `refreshFraming` at 3 call sites) | `da412e7` | `9a023ce` | 2026-08-31 | node→web | Missing from the node's own first implementation; must ship with §1. |
| 3 | Prompt Edit opens in the enhance mode that matches the node mode | `da412e7` | `9a023ce` | 2026-08-31 | node→web | Trap: text-only state value is `"t2v"`, not `"text"`. Confirm the web's value. |
| 4 | Reuse restores images (`metaForVideo` writes ref fields, `reuseAll` puts them back) | `da412e7` | `9a023ce` | 2026-08-31 | node→web | Must precede §1 — otherwise unrecoverable image sets go from 1 to N. |
| 5 | Upscale / deblur / stitch output metadata (`composeStitchedPrompt`, `[Clip N]` dividers, split on Reuse) | `da412e7` | `9a023ce` | 2026-08-31 | node→web | |
| 6 | Ollama removed, native vision only (`visionSource` default flipped, routes dropped, `LOCAL ENHANCE (native CLIP)`) | `da412e7`, `cc644fe` | `9a023ce`, `91ccc3b`, `8d17c6b` | 2026-08-31 | node→web | `cc644fe` removed write-only `ollamaImages` + `syncImageLists()`; renamed live `ollamaImageMode` → `briefImageMode` (migration reads old key). Web matched in `91ccc3b`. 5 dead `ollama_*` keys still sit in the node's config file; web dropped them on migration. |
| 7 | Prompt sets save/load images + video + audio (payload `v: 2`, whole `prompts[]` entry, old-set protection) | `da412e7` | `292fc54` | 2026-08-31 | node→web | Trap: the server save route whitelist silently dropped every field except `promptHeader`/`promptFooter`/`prompts`. Client-only fix leaves assets missing with no error. |
| 8 | Ghost thumbnails for missing attachments (`POST .../input_exists`, batch lookup, `state.missingAssets`) | `da412e7` | `292fc54` | 2026-08-31 | node→web | Names come from saved state — never trust as a path; `basename(n) != n` → treat as missing. |
| 9 | No browser `prompt`/`confirm` (ComfyUI suppresses them); shared `ui_ask.js` | `da412e7` | `7a417f8` + `7fd17d9` | 2026-08-31 | node→web | Web `7a417f8` = `confirmDialog()`/`promptDialog()` overlays in `src/shared/ui.ts`, all `confirm`/`prompt` call sites swapped. Node's `ui_ask.js` covers **`kind: "text" \| "confirm"` only** — no alert. Info/error popups on the node go through a separate transient toast: `showPopup(msg, isError)` in `one_node_minimax_h3.js` (auto-fades 4s, `.mmh3-pop`), and `ctx.showPopup` is threaded to every submodule. Web straggler found 2026-08-31: `src/tools/minimax_h3/view.ts confirmStopIsOurs()` still called `window.confirm` → silently `false` in the preview browser, Stop button dead while a foreign job ran; fixed to `confirmDialog()` in web `7fd17d9`, which also added `alertDialog()` to `src/shared/ui.ts` for the one gallery-card info-button `alert()` (multi-line meta needs a real OK, not an auto-fade toast). Web MiniMax H3's `showPopup` toast was already fully threaded (~45 sites) and matches the node. Other web tools' error `alert()`s (anima/klein/krea2/qwen/sdxl/zimage) left as-is — matches the node not sweeping its other tools. |
| 10 | Prompt Edit layout — asset band (image/video/audio one row), header/tail boxes, LOCAL ENHANCE accordion, one-line Enhance bar | `da412e7` | `a1c8f1b` | 2026-08-31 | node→web | Web layout differs — port *which problem was solved*, not the pixel dimensions. `a1c8f1b` did the functional part (collapsible LOCAL ENHANCE block). |
| 11 | Reference video/audio slots rebuilt as tiles (`ui_clip_media_slots.js`, 72×54, hover preview, in/out = playback window, clamp to file length) | `da412e7` | `566db78` | 2026-08-31 | node→web | Same module serves Prompt Edit (per-clip) and the left panel (common). Killed the `end: 5` hardcode. |
| 12 | Pick reference video from the MiniMax gallery (`/videos`, hover play, `copy_to_input`) | `da412e7` | `566db78` | 2026-08-31 | node→web | Trap: no `aspect-ratio` for thumb height before metadata loads — cell collapses, scroll never appears. Fixed height + `minHeight: 0` on the flex grid. |
| 13 | Misc — node width +25%, INPUT-folder picker tab, deblur independent of upscale, node fullscreen via DOM reparent | `da412e7` | partial | 2026-08-31 | node→web | Width/fullscreen are node-shell concerns; INPUT tab + independent deblur are the portable parts. |
| 14 | User pipeline presets (Save / Setting, server-stored `user_presets`, user presets above the 6 read-only builtins) | `da412e7` | `1b083f0` | 2026-08-31 | node→web | Distinct from `SPEC_MINIMAX_H3_PRESETS.md` (that doc = builtins only). Trap: Rename/Delete died on `window.prompt`/`confirm` — see §9. |
| 15 | RTX Deblur — pre-upscale stage with its own `None`, same resolution in/out, own node `TJ_RTXDeblur` (not a patch to the RTX pack), hard failure if SDK absent | `da412e7` | `1a461cf` | 2026-08-31 | node→web | `VideoSuperRes` quality levels 12–15; do not reuse the upscale's scale math or size changes silently. `_deblur` suffix, copies source metadata (§5). |
| 16 | Gallery post-process runs long video in chunks (byte-budget sizing, no threshold, stream-copy concat, cleanup on both paths) | `da412e7`, `cc644fe` | `64e1c9b` | 2026-08-31 | node→web | **Relay gap** — landed in v1.20.0, was in no spec; the web caught it only by reading the node source directly. `cc644fe` then fixed the node: chunked output joined under the source's bare stem, colliding with fresh renders — `runPost` now applies the caller's suffix. |

## Outside the spec

| item | node | web | verified | origin | notes |
|---|---|---|---|---|---|
| Move Sampler / Scheduler / Denoise / Sigma-Shift into a left-panel Sampling accordion | — | `d4d4fe6` | 2026-08-31 | user | Asked for on the web side, never relayed to the node in either direction. Node still has these where they were — **open port, web→node**, if the node should match. |
| Panel keeps the settings you last used, not a workflow's older serialised copy (`preferNewerThan`, queue-time stamping) | `3cdca12` | — | 2026-08-31 | node | Node-only so far. Check whether the web twin has the same stale-restore path. |
| Extend forcing `firstlast` doesn't carry the PDD accelerator when the source clip used PDD in **reference** mode — `pddFileForMode` reads `pddFile` (empty) not `pddFileReference`. Renders fine (falls back to turboSteps), just not with PDD. | — | — | — | web→node | Found during the v1.21.0 web verify (§3 real render). **Deferred to 2026-09-02** by both sessions overnight to save token budget. Fix ≈ 2 lines in `runExtend` (populate the firstlast turbo file from the reference one when forcing the mode). Do **node + web together** when the user resumes. |
| Missing-dependency-pack warnings (v1.20.4: post-copy popup removed as a ClickFix false-positive — Win32/ClickFix quarantine, plausible Registry-flag cause): startup console banner (`dependency_check.py`), then a persistent red/amber strip on the MiniMax H3 node with the installer's absolute path, per-line Copy buttons and a step-by-step run-it popup; `/minimax_h3_one/node_availability` returns `install_dir` + script names; `install_requirements.*` now also clone `ComfyUI-TJ_NODE` and restore numpy | `291d84a` (v1.20.1) → `v1.20.3` | n/a | 2026-08-31 | node → web | Console check reads only `custom_nodes/` dir names; no subprocess/network. **Relayed + decided 2026-08-31**: (a) numpy record/restore — web done (`AI-ONE-STUDIO` `05a7044`); web installer already clones `ComfyUI-TJ_NODE` (REPOS[19]). (b) **NO auto-run installer route** — studio.tjtj.cloud is cloudflared-public and an exec route on ComfyUI would be an internet-reachable RCE, matching the pattern under Registry-flag investigation. Web mirrors the node's guidance instead: script path + Copy button + "open cmd, paste, run, restart" in the missing-node warnings. Supported web setup = manual 5-step (install ComfyUI → clone kit → run install script → start server → open app). Web guidance-text port pending. |

## Upstream (ComfyUI-TJ_NODE — the third repo)

| item | TJ_NODE commit | notes |
|---|---|---|
| One-Take seam artifact — measured write-up | `400d68b` | `TJ_H3_LatentContinuation` hard-splices with no feathering; frames 39–42 of every continued clip break. STUDIO_ONE hides it by trimming 43 frames on manual stitch (a workaround). Real fix belongs here; proposed directions in that write-up are unverified. |
| Free Text Encoder VRAM port | — | `SPEC_FREE_TEXT_ENCODER_VRAM_PORT.md` in the node repo. |
| MiniMax H3 Audio Lock port | — | `SPEC_MINIMAX_H3_AUDIO_LOCK_PORT.md` in the node repo. `HANDOFF_REGISTRY.md` records the split. |

## SPEC_MINIMAX_H3_CONTINUE_AND_EXTEND.md

| § | item | node | web | verified | origin | notes |
|---|---|---|---|---|---|---|
| 1 | `POST /minimax_h3_one/clip_last_frame` + `getClipLastFrame` | `v1.21.0` | `54a5634` | 2026-09-01 | node→web | frames-glob then ffmpeg `-sseof -1` fallback → input/. Web = client fn only (route is the node's). Live-verified: returns `mmh3_seed_*.png`. |
| 2 | Prompt Edit "Continue generating the clip" (gallery frame picker, before-clips off + override greyed, `_resumeSnapshot` restore, clear on set-load) | `v1.21.0` | `54a5634` | 2026-09-01 | node→web | Resume seed only — prompt-list resume already worked via set + enable toggles. Web keeps `_resumeSnapshot` untyped (`as any`), matching the node. |
| 3 | Gallery `Extend` (3-button bar, prompt-only popup, LLM Review/Auto, `ctx.runExtend` → FL2VA continuation → auto-stitch `[source, continuation]`, §5 meta) | `v1.21.0` | `54a5634` | 2026-09-01 | node→web | Traps: read `rs._extendFrom` not `state._extendFrom`; probe source dims (`getVideoInfo`) → megapixels/aspect or the concat 0-bytes; `/stitch` scale+pad is node-side (also fixes manual Combine — nothing carried to web). Live-verified: real 0.2MP/192f render → 15s playable EXTENDED video, meta `{stitched, extended}`. Web extracted `reusePrompt` body → shared `applyClipSettings`. |
| 4 | User pipeline presets carry the full left-panel recipe (`RECIPE_KEYS`) | `v1.21.0` | `54a5634` | 2026-09-01 | web→node | User reported: a saved "PDD" preset restored `turboMode` but not `pddFile` → `effectiveTurbo` fell back to none → 20 steps not 8. Built-in 6 unchanged (axes only); `matchPreset` unchanged. Web `RECIPE_KEYS` omits node's `slaTurboLora` (no such field web-side — SLA turbo LoRA is a plain LoRA-list entry). Live-verified: saved preset carries steps/sampler/pddFile in the node config. |
| 5 | `_mmh3_last` / `_mmh3_drop_stale_last_frame` were referenced but never defined — NameError on every mmh3 render, node last-frame output broken | `v1.21.0` | n/a | 2026-09-01 | web→node | Web has no Python backend — all `/minimax_h3_one/*` routes are the node's. Nothing to port. |
