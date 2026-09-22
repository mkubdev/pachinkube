# Phoenix nerf, Split Shot rarity, Fever UI rework — design

Date: 2026-09-22
Status: approved

Playtest feedback after the FEVER release (RULES_VERSION 15): Phoenix is
oppressive as a permanent charm, Split Shot shows up too often, and fever's
on-screen representation is wrong — a sustained full-screen bloom "bloat"
while the multiplier itself is a tiny line nobody reads.

Explicitly out of scope (owner's call): fever's quadratic scaling and endless
round targets stay untouched this pass, even though round ~51 runs snowball
(309B observed). Revisit with `BALANCE=1` probe data if it still bothers us.

## 1. Phoenix becomes a 10-round charm

`src/game/charms.ts`, `phoenix`:

- Add `duration: 10`.
- Description becomes: "For the next 10 rounds, a ball lost in an edge pocket
  is relaunched once (50%)."
- Behaviour (edge pockets only, once per ball via `revives` carry, 50% roll on
  the `drop` stream) is unchanged.

No new machinery: the generic duration system already expires the charm after
round `acquired + 10`, shows rounds-left on the charm chip, emits
`charmExpired`, and extends the timer when a held temporary charm is
re-picked in the shop (`run.ts` `pick()` / `expireCharms()`).

Rarity stays `rare`. If the timed version lands too weak, the knob to turn
later is the 50% revive chance, not the duration.

## 2. Split Shot rarity: uncommon → rare

`src/game/charms.ts`, `split_shot`: `rarity: "uncommon"` → `rarity: "rare"`
(shop weight 30 → 10). Mechanics unchanged.

## 3. Fever UI rework (presentation only)

No sim/game logic changes; replays are unaffected by this section.

### Un-pin the heat

`src/main.ts` currently pins render heat to 1 whenever fever > ×1
(`feverHot`), which drives bloom +1.1, chromatic aberration and vignette
full-time — the center-screen bloat. Change: heat always tracks raw combo
(`Math.min(1, combo / 45)`); delete the `feverHot` pinning at every
`setHeat` call site. The one-shot ignition flash + bloom kick at the moment
fever first exceeds ×1 stays — the transition beat is good, the sustained
glow is not. `tests/wiring.test.ts` updated if the handler shape changes.

### Promote the multiplier

`src/game/ui.ts` `setFever` / the `#combo .f` element:

- The fever readout gets roughly the same visual weight as the combo number
  (large type, not the current small line).
- Pulse animation whenever the displayed value changes (same restart-animation
  trick the combo counter uses).
- Tier-colored by value: white-hot ×1–2, orange ×2–5, magenta ×5–20,
  cyan past ×20.
- Formatting: one decimal below ×10 (`×4.2`), whole numbers from ×10
  (`×137`), `formatScore`-style suffixes beyond (`×1.2K`).

`feverPopup` on landings is unchanged.

## Versioning

Bump `RULES_VERSION` 15 → 16 in `src/game/version.ts`: Phoenix duration and
Split Shot rarity both change gameplay/shop outcomes, so pre-change replays
must not verify against the new rules.

## Testing

- New tests: Phoenix carries `duration: 10` and expires (with `charmExpired`)
  once its window lapses. Re-pick extension is the pre-existing generic
  `pick()` machinery, unchanged by this work.
- Split Shot: assert `CHARMS.split_shot.rarity === "rare"` (guards the shop
  weight).
- Existing determinism/replay suites and `npm run typecheck` must pass.
- UI changes verified in the browser (`npm run dev`, `?charms=phoenix` /
  a high-combo seed) since DOM code is untested by vitest.
