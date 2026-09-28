# SPEC — MiniMax H3 Prompt Edit: Enhance-result apply modes + brief parsing

Node **ComfyUI-TJ_NODE_STUDIO_ONE v1.22.0**. Port to the web twin.
Node files: `web/minimax/ui_prompt_edit_minimax.js`, `web/minimax/core_minimax.js`.
Read the node source for the exact wiring; this carries the intent + traps.

---

## 1. Result review — three apply modes (chosen AFTER the model answers)

The enhance result review (`reviewOv` / `openReview` / `applyReview` in
`ui_prompt_edit_minimax.js`) previously auto-split header/shots/tail and only let the user
Apply or ↻ Enhance again. Now:

- The result **cards are always a preview** (COMMON — HEADER / CLIP N / COMMON — SOUND ·
  MUSIC), regardless of mode.
- A **mode block sits between the cards and the Discard/Apply footer** (not at the top): a
  centred caption **"Choose how to apply this result"** over three toggle buttons
  `1. One Prompt` / `2. Auto Split` / `3. Use selected`. Active button = brand fill.
- Default mode = **`split`** (`2. Auto Split`).

`applyReview` branches on the mode:

| mode | apply |
|---|---|
| **`one`** | `state.prompts[selected].text = reviewText` (the whole brief, verbatim). Header/footer untouched. Other cards render at 0.5 opacity as "not used". |
| **`split`** | the old behaviour: `parseBrief` → `promptHeader` / prompts / `promptFooter`; for target `"all"` replace `state.prompts` with one entry per parsed shot. |
| **`manual`** | only the cards in the `reviewSel` Set. `header`/`footer` keys gate the common fields; `shot:${i}` keys pick which shots. For target `"all"` the picked shots become the new prompt list; for `"one"` they're joined into the current clip. |

Manual-mode card styling (the user was specific): **selected** = `2px solid BRAND` border,
no dim; **unselected** = `1px solid #3a3a3a` border + an inset black scrim
(`box-shadow: inset 0 0 0 999px rgba(0,0,0,0.55)`) so it plainly reads as off. Marker text
`● selected` / `○ off`. `openReview` seeds `reviewSel` with **everything ticked**, so
switching to manual and applying == auto-split until the user removes a card.

Guard: manual mode with an empty `reviewSel` → popup "Pick at least one card", don't apply.

### Shot-count mismatch note

For a target-`"all"` enhance, `renderReviewCards` compares `parsed.shots.length` to the
target shot count (`targetPlan().shots`) and appends to the info line:
`⚠ asked for N — use ✂ Split or ↻ Enhance again` when they differ. The small local brief
model frequently writes 1–3 shots regardless of the "write exactly N" instruction — this
is a model limitation, not a bug, so surface it rather than trying to fix it.

## 2. `parseBrief` — structured audio section + echo stripping (`core_minimax.js`)

The brief model has two output styles for the trailing audio section:
- simple: `Ambient sound:` / `Music:`
- structured: `overall_soundscape:` / `non_diegetic_music:` (sometimes markdown-bolded
  `**overall_soundscape**:`, sometimes hyphenated `non-diegetic music:`)

`TAIL_RE` only matched the simple one, so a structured brief left the whole soundscape +
music glued onto the last shot. Broadened `TAIL_RE` to match both, plus `soundscape:`,
`sound design:`, `score:`, `SFX`, `Foley`, `효과음`, and the underscore/hyphen spellings.

Also added `ECHO_RE` + a `stripEcho()` pass: the model often echoes its own instructions /
the vision analysis at the end of a block (`Target duration: …`, `Write exactly N shots`,
`The following images…`, `Image N: …`). `stripEcho` cuts a block from the first line
matching `ECHO_RE` to the end. Applied to header, every shot, and the footer.
`parseBrief` now returns `{ header: stripEcho(header), shots: blocks.map(stripEcho)…,
footer: stripEcho(footer) }`.

Trap: don't let `ECHO_RE` catch `retention_analysis` lines — those use `<Picture N>:`
(bracketed), so `Image N:` is safe but bare `Picture N:` would not be — it was left out.

---

## Verify

Real enhance in the browser: `→ split into all clips`, length e.g. `16`. Check the
review shows the mismatch warning; the SOUND/MUSIC card contains only
`overall_soundscape:` + `non_diegetic_music:` with no `Target duration:` / `Image N:`
leak; the last CLIP card ends on shot action; switching modes re-renders the cards;
manual click toggles the scrim.
