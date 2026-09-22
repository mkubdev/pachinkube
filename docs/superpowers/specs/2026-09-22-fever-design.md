# FEVER — combo-depth scoring engine

**Date:** 2026-09-22
**Status:** approved design, awaiting implementation plan

## Why

The Split Shot nerf (shards never split, `f87e32a`) removed the game's only
compounding loop. Runs now grow linearly and stall around 1.5–2M. FEVER
replaces exponential multiball with a new compounding engine that lives in the
combo counter — the game's centerpiece — and rewards sustaining deep chains
while landing balls inside them. Target ceiling: **100M–1B** on a great run,
numbers stay human-readable (locale formatting, no e-notation).

## Core mechanic

The running combo drives a global **fever multiplier** applied to every ball
that lands while the chain is alive:

```
fever(combo) = combo < IGNITION ? 1 : 1 + ((combo − IGNITION) / RAMP)²
IGNITION = 50   // combo hits before fever ignites
RAMP     = 50   // divisor controlling steepness

score = floor(chips × mult × pocketMult × fever)
```

Reference points (base values): combo 50 → ×1, 150 → ×5, 400 → ×50,
750 → ×197.

Rules:

- Fever is evaluated at the moment a ball is scored (`ballScored` path in
  `run.ts`). Balls landing after `comboEnd` get ×1 (except Afterglow, below).
- `comboEnd` (window lapse or round end) resets fever with the combo.
- Ignition is thresholded at 50 so rounds 1–8 and their tuned targets stay
  valid; the engine only ignites in engineered multiball turns. No target
  retune. Campaign is easy anyway (user's call), so incidental early fever is
  acceptable.
- Entirely in `src/game/run.ts` — deterministic, no `src/sim/` changes, no
  `Math.random`.

## Support charms (new "heat" archetype)

| id | Name | Rarity | Effect |
|---|---|---|---|
| `fever_pitch` | Fever Pitch | rare | Ignition 50 → 40 (−10 per copy, floor 10). Additive stack; `stackNote` shows the resulting ignition point. |
| `heat_sink` | Heat Sink | rare | Ramp divisor 50 → 40 (−10 per copy, floor 20). Compounds hard; `stackNote` required. |
| `afterglow` | Afterglow | uncommon | On `comboEnd`, fever decays linearly to ×1 over 240 ticks (2 s) instead of snapping. Balls landing in the grace window cash the decayed fever. Duration +240 ticks per copy. |
| `thermal_mass` | Thermal Mass | rare | Combo resets to 25% of its value instead of 0 (per-copy: +25%, cap 75%). Applies on window lapse only, not on round end. |
| `inferno_engine` | Inferno Engine | legendary | While fever ≥ ×2, peg-hit chip gains are also multiplied by the current fever. The compounding 1B enabler: chips grow under fever *and* the total is fever-multiplied at landing. Non-stackable (add to `NON_STACKABLE`). |

Ball rework (no new ball — 25 stays 25):

| id | Name | Change |
|---|---|---|
| `cannon` | Cannon | Reworked into the fever ball. Keeps its fired-downward physics (`vy: -9`, dense). Loses `speedChips` (imperceptible, never picked); instead **every peg hit counts as 2 combo hits**. `chipFactor` 1.2 → 0.8 as the cost. New desc: "Fired downward. Every peg hit counts as 2 combo hits." |

Anchor also carries `speedChips`; it keeps it for now (distinct identity:
gravity 1.8, chipFactor 1.4). If speed-chips still feels dead after FEVER
ships, rework Anchor in a follow-up.

All numeric effects go through existing passive-field / `sumCharm` patterns in
`charms.ts` where possible; hooks only where state is needed (Afterglow decay
tick, Thermal Mass on combo close).

## Combo event rework

Events gain a **fever tier**: `tier = max(1, floor(sqrt(fever)))`, evaluated
when the event fires.

- Tier scales each event's duration (`ticks × tier`, capped per event) and any
  reward it pays (+mult grants × tier).
- Physical strength scaling (quake amplitude, magnet force) is per-event and
  capped so the board stays playable.
- Tier is carried on the `comboEvent` GameEvent so the renderer can scale FX.

## UI / FX

- Combo counter gains a FEVER state at ignition: `FEVER ×N.N` line under the
  count; extend the existing hue journey with a white-hot tier past the 80+
  violet.
- Ignition moment: screen flash + bloom kick (reuse milestone FX channel).
- `ballScored` popup appends `×N FEVER` when fever > 1.
- Shop: new charms get `stackNote`s where copies compound.

## Plumbing

- **Bump `RULES_VERSION`** in `src/game/version.ts` (scoring change).
- New GameEvent `{ type: "fever", value: number }` emitted when the displayed
  value changes (throttle to 0.1 steps to keep replay logs small — display
  only; scoring always uses the exact value).
- `comboEvent` event gains a `tier` field.
- New render call sites wired in `src/main.ts` → update `tests/wiring.test.ts`.

## Testing

- Unit tests: fever formula (below/at/past ignition), fever applied at landing,
  reset on comboEnd, Afterglow decay window, Thermal Mass partial reset,
  Fever Pitch / Heat Sink stacking math, Inferno Engine chip amplification,
  Cannon double combo count, event tier scaling.
- Replay determinism: a seeded run with fever charms replays to the same score.
- `BALANCE=1` probe after implementation: pass rates for rounds 1–8 expected
  ~unchanged (dumb policy rarely sustains 50+ combos); investigate if not.

## Out of scope

- Round target retune.
- Number formatting changes (1B fits current display).
- New combo event kinds (existing kinds scale; new kinds are a follow-up).
