# Board Features — design

Date: 2026-10-06
Status: approved, wave 1 ready to plan

## Problem

PACHINKUBE scores from pegs, pop bumpers, and bottom pockets. Every drop meets
the same three surfaces. There is no mid-board obstacle a player can chase, and
no scoring surface that a build decision puts on the board.

## Goal

A general **board feature** layer: seeded obstacles that sit in the peg field,
react to ball contact, and pay chips and mult. Four kinds are wanted long term
— target bank, drop target, spinner, orbit lane. This spec defines the layer
and the first two kinds. Spinner and orbit lane are deliberately out of scope
here and get their own spec and plan.

## Decisions

- **One shared layer, built in waves.** The alternative — four one-off systems
  like `bumpers` — duplicates placement, event plumbing, and render paths three
  more times.
- **Charm-driven.** The default board has zero features. Charms put them there,
  so features are a build choice, not a board constant.
- **Per-round persistence.** A lit bank stays lit and a broken target stays
  broken until the round ends. State resets in `startRound`, not per ball.

## Architecture

### `src/sim/` — geometry and contact only

New `BoardFeature` type in `src/sim/types.ts`:

```ts
export type FeatureKind = "target_bank" | "drop_target" | "spinner" | "orbit";

export interface FeaturePart {
  x: number;
  y: number;
  r?: number;
  w?: number;
  h?: number;
}

export interface BoardFeature {
  id: number;
  kind: FeatureKind;
  x: number;
  y: number;
  parts: FeaturePart[];
}
```

`Sim` gains:

- `readonly features: BoardFeature[]`
- `addFeature(kind: FeatureKind, x: number, y: number): number`
- `clearFeatures(): void`
- `removeFeaturePart(feature: number, part: number): void` — used when a drop
  target breaks
- `setPegEnabled(peg: number, on: boolean): void` — disables pegs a feature
  overlaps
- a `colliderToFeature` map mirroring the existing `colliderToPeg`

One new `SimEvent`:

```ts
| { type: "featureHit"; ball: number; feature: number; part: number; speed: number }
```

The sim holds no scoring, no hit counters, and no charm knowledge — the same
discipline `pegHit` already follows.

### Placement

The peg field runs y≈2.2→8.6; the pocket dividers top out at y=0.9. Placement
picks a seeded anchor from a small table of legal points:

- the band below the peg field, y≈1.2–2.1
- gaps left of and right of centre inside the field

A feature **disables every peg it overlaps** via `setPegEnabled(peg, false)`, so
the board never gets denser than a Heavy ball (r=0.2) can pass, and `EDGE_GAP`
stays intact. `setPegEnabled(peg, false)` also clears that peg's lit state, or
the lit-peg count drifts across the round.

An anchor already taken by another feature is skipped, not stacked.

### `src/game/run.ts` — all state and scoring

Mirrors how `bumpers` works today:

- a `features` array, cleared and re-rolled in `startRound`
- positions rolled from the **shop** stream (features are charm-driven, so they
  belong to the shop stream, not `layout`; this keeps a charm choice from
  shifting a bounce)
- per-round counters: which bank parts are lit, which banks are complete, hits
  taken per drop target
- new charm hook `onFeatureHit?(ctx: CharmCtx, feature: number, part: number): void`

New `GameEvent`s for the renderer:

```ts
| { type: "features"; list: BoardFeature[] }
| { type: "featureHit"; feature: number; part: number; x: number; y: number; lit: boolean }
| { type: "featureDone"; feature: number; kind: FeatureKind; x: number; y: number }
```

`featureDone` covers both a completed bank and a broken drop target. On
`featureHit`, `lit` means "this part was in its fresh state before the hit" —
an unlit bank part, or a drop target with hits left.

Every `featureHit` counts as **one** combo hit, like a peg, regardless of kind.
Only the bumper gets the `BUMPER_COMBO` multi-hit treatment.

### Charms

New passive field on `Charm`, read directly by the run exactly like
`extraBumpers`:

```ts
/** Board features this charm adds each round. */
features?: { kind: FeatureKind; count: number }[];
```

### `src/render/scene.ts`

Draws each kind from the `features` event: bank parts as small circles that
switch to a lit colour, drop targets as a bar that vanishes on break. Dynamic
instanced meshes need `frustumCulled = false` (see CLAUDE.md).

### `src/game/meta.ts`

New lifetime stat `featureHits`, incremented on `featureHit`, with a feat tier
alongside the existing `bumperHits` tiers.

## Wave 1 behaviour

### Target bank

Three static circles, r≈0.1, in a shallow arc. Solid colliders, restitution at
`BUMPER_RESTITUTION`.

| Event | Reward |
| --- | --- |
| Part hit, unlit | 12 chips |
| Part hit, already lit | 4 chips |
| All three lit (once per round) | +60 chips, +2 mult |

A completed bank stays complete for the rest of the round. It does not reset to
a higher tier — that was considered and cut as balance risk.

### Drop target

One static wall segment, ≈0.5 × 0.1, angled under the peg field in a spot that
gates a 3× or 5× pocket.

| Event | Reward |
| --- | --- |
| Hit (3 needed) | 10 chips |
| Break | +40 chips, collider removed for the rest of the round |

The real reward is positional: breaking it opens a lane to a rich pocket.

The collider is removed between physics steps, never inside a contact callback.

### New charms

Both `uncommon`, both unlocked through `meta.ts` the way `pop_bumpers` is, both
need an entry in `icons.ts`:

- **Target Bank** — "One three-target bank every round. Light all three for +60
  chips and +2 mult." → `features: [{ kind: "target_bank", count: 1 }]`
- **Drop Target** — "One breakable target every round, guarding a rich pocket.
  Three hits open the lane." → `features: [{ kind: "drop_target", count: 1 }]`

## Testing

- determinism: same seed + same charms → identical `hash()` every tick and
  identical feature placement
- bank completion fires exactly once per round and resets on `startRound`
- drop target: exactly three hit events, one break event, no fourth hit
- placement: no feature overlaps a pocket divider, and `EDGE_GAP` holds
- `tests/wiring.test.ts`: a case per new `GameEvent`
- `BALANCE=1 npx vitest run tests/balance.probe.test.ts` before and after. These
  charms are additive, so the question is whether they outclass the existing
  uncommons, not whether rounds got easier.

## Version

`RULES_VERSION` → **20** in `src/game/version.ts`. New events and new scoring:
runs recorded under 19 must not verify against 20.

## Out of scope

- Spinner (kinematic rotation) — wave 2
- Orbit lane — wave 3
- Features that persist across rounds
- Bank tiers that reset to a higher payout
