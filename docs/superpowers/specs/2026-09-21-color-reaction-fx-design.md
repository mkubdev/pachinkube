# Color & Reaction FX Pass — Design

**Date:** 2026-09-21
**Slice:** 1 of 3 (next: elemental charms & complementarity, then new combo events)
**Scope:** presentation only — no sim/game logic changes, no `RULES_VERSION` bump, replays stay valid.

## Problem

The screen lacks color variety. Two concrete causes:

1. `src/game/elements.ts` gives Ice `0x9fe8ff` and Storm `0x7df9ff` — nearly the
   same cyan. The element triad reads orange/cyan/cyan.
2. Reactions (steam, wildfire, shatter chain, …) have no palette of their own;
   the FX dispatch in `src/main.ts` reuses element colors, so the biggest
   moments repeat the same hues.

## Design

### 1. Element triad (`src/game/elements.ts`)

| Element | Color | Change |
|---|---|---|
| Fire | `0xff6a00` | unchanged |
| Ice | `0x9fe8ff` | unchanged |
| Storm | `0xb44bff` electric violet | **was `0x7df9ff` cyan** |

One-line change: icons, auras, ball trails, and the peg shader all read
`ELEMENTS[el].color`, so violet propagates automatically. Storm arcs
additionally get white-hot cores: each `zap` call is doubled — one wide violet
bolt, one thin white bolt on the same path (existing pool, MAX_ZAPS=32 is
ample).

### 2. Reaction palette module (`src/render/palette.ts`, new)

Export `REACTION_FX: Record<reaction kind, { primary; secondary; accent?; flash? }>`
(hex numbers; `flash` as CSS string for `ui.flash`). Consumed by the `element`
event dispatch in `src/main.ts` (currently hardcoded hexes at ~517–577) and by
the combo milestone flash. Signature palettes:

| Reaction | Palette | Treatment |
|---|---|---|
| ignite | orange → yellow | two-tone burst |
| freeze | glacial cyan + white | same shape, brighter core |
| charge | violet + white core | double zap |
| thicken | deep blue → white | ring deepens with stacks |
| burn | orange → red embers | two-tone |
| flare | yellow → white-hot | flash goes gold |
| steam | **white → rose pink**, rising | two-tone, pink flash |
| shatter | **ice-white → pale gold glints** | two-tone |
| zap | **violet + white forks** | recolored from cyan |
| wildfire | **orange → magenta gradient** | two-tone, magenta flash |
| shatter_chain | **prismatic** per-particle hue walk | the showpiece |

### 3. FxSystem additions (`src/render/fx.ts`)

- `burst2(x, y, colorA, colorB, count, …)` — identical to `burst` but each
  particle's tint lerps between two colors by a per-particle random `t`.
- `burstPrism(x, y, count, …)` — per-particle HSL hue rotation (full or partial
  hue walk), for shatter_chain.

Same particle pool, same single draw call, ~25 lines. No new allocations
(reuse `tmpColor` plus one extra scratch `THREE.Color`).

### 4. Combo heat hue journey

- `src/game/ui.ts`: combo counter tiers become a hue journey —
  t0 white, t1 gold (10+), t2 orange (20+), t3 magenta (40+), **new t4 violet
  (80+)**. CSS classes already exist for t0–t3; add t4.
- `src/main.ts` combo milestone flash (~line 584): flash color follows the
  current tier's color instead of the fixed gold/pink pair.
- `src/render/scene.ts` heat post-processing stays as-is (intensity ramp);
  only the UI counter and flash colors change.

## Non-goals

- No changes to `src/sim/` or `src/game/` logic (except the Storm hex, which
  is data the sim never reads).
- No rarity tints, pocket strips, popup or per-ball-type trail recolors (that
  was the "full identity pass" option, declined).
- No runtime theme/tweak panel.

## Testing & verification

- `npm test` and `npm run typecheck` stay green (no logic touched; the icons
  test reads element colors — update snapshot/expectation if it pins Storm's
  hex).
- Before/after headless Edge screenshots per README workflow
  (`?seed=…&auto=1&pre=430`), focusing on: a storm board, a steam moment, a
  shatter chain, combo counter at 80+.
- Final ring sizes/intensities flagged for a real-GPU pass (existing known
  follow-up).

## Approaches considered

- **A (chosen):** central palette module + two FxSystem burst variants.
  Slightly more code than inline edits, but slices 2–3 will add reactions and
  events that want palette entries.
- **B:** inline hex edits in place — scatters the palette across three files.
- **C:** runtime theme system with tweak panel — scope creep.
