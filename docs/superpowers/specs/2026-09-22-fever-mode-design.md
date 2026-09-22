# FEVER MODE — gauge, timed jackpot, re-chain (fever rebalance)

**Date:** 2026-09-22
**Status:** approved design, awaiting implementation plan
**Replaces:** the always-on quadratic fever of
`2026-09-22-fever-design.md` (mechanic only — charm names, Cannon, and the
chain-feeder events survive, remapped below).

## Why

Playtest verdict after RULES_VERSION 17: the game is trivially easy
*everywhere*, rounds 1–8 included. The always-on fever loop feeds itself:

1. `feverMultiplier` is uncapped and quadratic in combo depth (combo 750 →
   ×197; 309B observed at round 51).
2. The chain feeders sustain the chain for free: `time_lock` makes it
   unkillable *and* restarts the window when it ends (`run.ts` `endEffect`);
   `overdrive` doubles combo gain.
3. Event tier scales with `√fever`, so fever buys richer events which buy
   more fever.
4. Round targets grow ×1.38/round past r8; quadratic fever wins that race
   with no player skill.

Owner's goals for the rebalance: **nerf fever, not round targets**; a run
with no fever charms should top out around ×2–3 ("nearly nothing"); the big
multipliers exist only if you build for them — restoring "let's try another
run with the correct charms". Fix legibility at the same time: the UI must
*show* how fever works.

## Core mechanic

Fever becomes a pachinko-style timed jackpot with re-chaining:

- **Gauge.** 0–100 units. +1 per **combo hit** (peg hit while the chain is
  alive, counted *after* Cannon/bumper/overdrive doubling, so those
  investments charge it faster). Persists across combo breaks within a
  round; resets at round end. No passive decay — the timed mode is the
  limiter.
- **Mode.** Gauge full → FEVER MODE level 1 fires immediately and the gauge
  empties. For **960 ticks (8 s)**, every ball scored has its score
  multiplied by `feverMult(level)`. Evaluated at landing, exactly like the
  old fever.
- **Re-chain.** Hits during the mode keep charging the gauge. Refill it
  before the timer expires → level +1, timer resets to 960 ticks, gauge
  resets. The refill requirement grows **+25% per level** (100, 125, 156,
  195, …, `floor(100 × 1.25^level)`), so infinite chains are structurally
  impossible.
- **Multiplier.** `feverMult(level) = 1 + 2·level` baseline (L1 ×3, L2 ×5,
  L3 ×7). Charms steepen this (below).
- **Mode end.** Timer (plus any Afterglow grace) expires with the gauge
  short → level resets to 0, gauge resets to 0 (Thermal Mass softens this).
  Round end always ends the mode and zeroes everything.
- **Combo counter unchanged.** Combos still drive milestones and combo
  events. Fever no longer reads combo *depth* — only sustained activity,
  bounded by a timer. That is the structural nerf.

All state lives in `src/game/` (deterministic, tick-based, no `Math.random`,
no `src/sim/` changes). `src/game/fever.ts` is rewritten around
`feverMult(level, curveBoost)` and the gauge-requirement function.

Baseline sanity: filling 100 hits inside 8 s essentially requires an
engineered multiball turn, so charmless runs see L1, rarely L2 → effective
×2–3. ✔

## Charm remap (names and rarities unchanged)

| Charm | Old effect | New effect |
|---|---|---|
| `fever_pitch` (rare) | Ignition −10/copy | **Gauge 15% smaller per copy** (multiplicative, floor 50% of base) — modes trigger and re-chain sooner. `stackNote` shows resulting gauge size. |
| `heat_sink` (rare) | Ramp −10/copy | **Steeper level curve**: each copy adds `+0.5 × level²` to `feverMult`. The ceiling-maker. `stackNote` required. |
| `afterglow` (uncommon) | 2 s fever decay after combo | **+240 ticks (2 s) grace per copy** after the mode timer to finish a re-chain refill. The mode's multiplier does not apply during grace (grace is refill time, not scoring time). |
| `thermal_mass` (rare) | Combo carries 25% on lapse | **Gauge keeps 25%/copy (cap 75%) when a mode ends un-chained.** No effect on round end. |
| `inferno_engine` (legendary) | Chips ×fever while ≥×2 | **During fever mode, peg-hit chip gains are multiplied by the current `feverMult`.** Still `NON_STACKABLE`. |

Old passive fields `feverIgnitionDelta` / `feverRampDelta` are removed. New
fields — `feverGaugeScale`, `feverCurveBoost`, `feverGraceTicks`,
`feverGaugeCarry` — follow the existing passive-field / `sumCharm` pattern.

**Cannon** is untouched: "every peg hit counts as 2 combo hits" now also
means 2 gauge units. Descriptions of all five charms rewritten to the new
effects.

Ceiling check: a god build (2× Heat Sink, Fever Pitch, Afterglow, Inferno,
Cannon) chaining to L8–10 reaches ×65–100 on landings plus
Inferno-amplified chips during modes — 100M–1B stays reachable deep in
endless, but every level is re-earned inside an 8-second window.

## Combo events — feeder-loop break and retier

- **Tier = `min(3, 1 + fever level)` while a mode runs; 1 otherwise.**
  Events no longer read the multiplier. Existing per-kind scaling (laser
  chips ×tier, rain shard count, duration curves and caps) is otherwise
  unchanged.
- **`time_lock` no longer resets `lastHitTick` when it ends** (`endEffect`).
  It protects the chain while running; the free fresh window afterward is
  gone.
- **Weights:** overdrive 14 → 10, time_lock 10 → 7. They remain valuable as
  gauge chargers; they stop being chain-immortality engines.
- **Portal:** arms `2 + level` balls, **cap 4** (down from `2×tier`, cap 6)
  — fewer, more visible teleports.

## UI / FX

Legibility is a design goal, not a polish pass:

- **Gauge always on screen**: a vertical fill bar beside the combo counter,
  tier-colored as it fills. Charging is visible per hit.
- **Mode start**: keep the one-shot ignition flash + bloom kick; add a
  **FEVER banner with a countdown ring and level badge** ("FEVER Lv.2 ×5").
- **Re-chain**: banner slams to the next level with a bloom kick.
- **Afterglow grace**: gauge bar flashes while the countdown blinks.
- Landings during a mode keep the existing `×N FEVER` popup. `setFever` /
  the big tier-colored readout is replaced by the banner + gauge.

### FX regression fixes (folded in — root causes found 2026-09-22)

The laser/portal render code never changed; the regressions are emergent
from fever-era load:

- **Per-kind tint clearing**: `comboEventEnd` in `main.ts` currently calls
  `view.setTint(null)` unconditionally; with five overlapping tick-based
  kinds the first to expire clears everyone's tint (or a late one leaves a
  stale cast). Track active tints per kind; clear only when no tinting
  event remains.
- **Tint strength for overdrive/time_lock drops 0.6 → 0.35** so the laser's
  magenta beam reads against the board again (tinting events rose from 26%
  to 39% of the pool and fire far more often).
- **Portal announce gets a real beat**: shock ring at each armed portal
  mouth plus a brief tint, instead of the single bottom-of-board ring that
  drowns in fever-era FX traffic.
- **`tests/wiring.test.ts` kind list gains `"portal"`** (it was always
  missing; the outer case passed trivially off the inner one).

## Plumbing

- **Bump `RULES_VERSION` 17 → 18** (scoring rework).
- GameEvent `fever` becomes `{ type: "fever", gauge, level, mult,
  ticksLeft }` (gauge normalized 0–1; throttled — display only, scoring
  always uses exact state).
- `comboEvent.tier` keeps its field; new semantics documented.
- New/changed render call sites wired in `src/main.ts` →
  `tests/wiring.test.ts` updated.

## Testing

- Unit: gauge charge (+1/combo hit, Cannon 2, overdrive doubling), mode
  trigger at full gauge, mult per level, +25% requirement growth, re-chain
  within window, reset on timeout and on round end, Afterglow grace refill
  (and that grace doesn't score), Thermal Mass carry, Fever Pitch gauge
  scaling, Heat Sink curve, Inferno chips during mode only, tier from
  level with cap 3, time_lock no longer resetting the window.
- Replay determinism: seeded run with fever charms replays to the same
  score.
- `BALANCE=1` probe before/after: rounds 1–8 pass rates should fall back
  toward the tuned ~50% by r5–7.
- UI verified in the browser (`npm run dev`, `?charms=…`, high-combo seed) —
  DOM code is untested by vitest.

## Tuning knobs (for playtest, in priority order)

Gauge size (100), mode duration (960 ticks), requirement growth (+25%),
level curve (1 + 2·level). Change these before touching charm numbers.

## Out of scope

- Round target retune (owner's call — fever is the thing being fixed).
- Number formatting.
- Anchor's `speedChips` rework (still a follow-up).
