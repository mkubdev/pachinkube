# Board Features (wave 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a general board-feature layer to the sim and two charm-driven obstacles — a three-part target bank and a breakable drop target — that pay chips and mult.

**Architecture:** `src/sim/` gains geometry and a `featureHit` contact event only; all state, scoring and charm wiring lives in `src/game/run.ts`, mirroring how pop bumpers already work. Features are placed from a fixed anchor table, seeded per round from the shop RNG stream, and disable any pegs they overlap. `src/render/scene.ts` draws them; `src/main.ts` wires the new game events.

**Tech Stack:** TypeScript, Rapier2D (`@dimforge/rapier2d-compat`), Three.js (render only), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-board-features-design.md`

**Deviation from the spec (intentional):** the spec calls the per-hit flag on the
`featureHit` game event `lit`. This plan names it `fresh`, with identical
meaning ("the part was in its fresh state before this hit"), to match the
existing `pegHit` event's `fresh` field.

---

## Ground rules for every task

- `src/sim/` and `src/game/` must never import Three.js or touch the DOM.
- No `Math.random` anywhere in `src/sim/` or `src/game/` — use `this.sim.streams.{layout,drop,shop,fx}`.
- Run `npm run typecheck` before every commit.
- Run the single new test file while iterating: `npx vitest run tests/features.test.ts`.
- Run the whole suite before the final task: `npm test`.

---

## File structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src/sim/types.ts` | modify | `FeatureKind`, `FeaturePart`, `BoardFeature`, shape table, anchors, constants, `featureHit` SimEvent |
| `src/sim/world.ts` | modify | feature colliders, contact → `featureHit`, `setPegEnabled`, `pegsUnderFeature` |
| `src/game/charms.ts` | modify | `features` passive field, `onFeatureHit` hook, two new charms |
| `src/game/run.ts` | modify | per-round feature state, placement, scoring, new game events, `addCombo` extraction |
| `src/game/meta.ts` | modify | `featureHits` stat, feat tier, two unlock rows |
| `src/game/icons.ts` | modify | glyphs for the two charms and the feat family |
| `src/render/scene.ts` | modify | `setFeatures`, `litFeaturePart`, `breakFeaturePart`, `setPegsHidden` |
| `src/main.ts` | modify | three new event cases |
| `src/game/version.ts` | modify | `RULES_VERSION` 19 → 20 |
| `tests/features.test.ts` | create | the whole feature layer: sim, placement, scoring, determinism |
| `tests/wiring.test.ts` | modify | assert the new `main.ts` call sites |
| `README.md` | modify | document the two charms and the layer |

---

## Task 1: Feature geometry types

**Files:**
- Modify: `src/sim/types.ts`
- Test: `tests/features.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/features.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FEATURE_ANCHORS, FEATURE_SHAPES, FEATURE_CLEARANCE, FEATURE_RESTITUTION } from "../src/sim/types.js";

describe("feature geometry", () => {
  it("defines shapes for the wave-1 kinds only", () => {
    expect(FEATURE_SHAPES.target_bank).toHaveLength(3);
    expect(FEATURE_SHAPES.drop_target).toHaveLength(1);
    expect(FEATURE_SHAPES.spinner).toBeUndefined();
    expect(FEATURE_SHAPES.orbit).toBeUndefined();
  });

  it("every bank part is a circle and the drop target is a bar", () => {
    for (const p of FEATURE_SHAPES.target_bank!) expect(p.r).toBeGreaterThan(0);
    const bar = FEATURE_SHAPES.drop_target![0]!;
    expect(bar.w).toBeGreaterThan(bar.h ?? 0);
  });

  it("anchors are board fractions that stay clear of the pocket dividers", () => {
    expect(FEATURE_ANCHORS.length).toBeGreaterThanOrEqual(5);
    for (const a of FEATURE_ANCHORS) {
      expect(Math.abs(a.x)).toBeLessThan(0.5);
      expect(a.y).toBeGreaterThan(0.12); // dividers top out at y = 0.9 on a height-10 board
      expect(a.y).toBeLessThan(0.6);
    }
  });

  it("clearance leaves room for the widest ball", () => {
    expect(FEATURE_CLEARANCE).toBeGreaterThanOrEqual(0.4); // Heavy is r = 0.2
    expect(FEATURE_RESTITUTION).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/features.test.ts`
Expected: FAIL — `FEATURE_ANCHORS` is not exported from `src/sim/types.ts`.

- [ ] **Step 3: Add the types**

Append to `src/sim/types.ts`, after the `BUMPER_RESTITUTION` constant:

```ts
/** Board features: obstacles charms place in the field (see run.ts for scoring). */
export type FeatureKind = "target_bank" | "drop_target" | "spinner" | "orbit";

/** One collider of a feature. `r` = circle; `w`/`h` = axis-aligned bar. */
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
  /** Anchor position; `parts` carry absolute world coordinates. */
  x: number;
  y: number;
  parts: FeaturePart[];
}

/**
 * Part layout per kind, as offsets from the feature anchor. Kinds absent here
 * are not implemented yet and `Sim.addFeature` refuses them — wave 2 (spinner)
 * and wave 3 (orbit) fill them in.
 */
export const FEATURE_SHAPES: Partial<Record<FeatureKind, FeaturePart[]>> = {
  target_bank: [
    { x: -0.34, y: 0, r: 0.1 },
    { x: 0, y: 0.16, r: 0.1 },
    { x: 0.34, y: 0, r: 0.1 },
  ],
  drop_target: [{ x: 0, y: 0, w: 0.5, h: 0.1 }],
};

/** Features bounce like bumpers so a hit reads as a hit. */
export const FEATURE_RESTITUTION = 0.85;

/**
 * A peg this close to a feature part is switched off: anything tighter could
 * wedge the widest ball (Heavy, r = 0.2) between peg and feature.
 */
export const FEATURE_CLEARANCE = 0.45;

/**
 * Legal anchor points as fractions of board width (x, 0 = centre) and height
 * (y). The low row sits in the clear band between the bottom peg row and the
 * pocket dividers; the two mid anchors sit inside the field and displace pegs.
 */
export const FEATURE_ANCHORS: ReadonlyArray<{ x: number; y: number }> = [
  { x: -0.3, y: 0.15 },
  { x: 0, y: 0.15 },
  { x: 0.3, y: 0.15 },
  { x: -0.33, y: 0.4 },
  { x: 0.33, y: 0.4 },
];
```

Then add the new event to the `SimEvent` union, after the `pegHit` member:

```ts
  /** A ball struck part `part` of board feature `feature`. */
  | { type: "featureHit"; ball: number; feature: number; part: number; speed: number }
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/features.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/sim/types.ts tests/features.test.ts
git commit -m "feat(sim): board feature geometry types and anchors"
```

---

## Task 2: Feature colliders and the featureHit event

**Files:**
- Modify: `src/sim/world.ts`
- Test: `tests/features.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/features.test.ts`:

```ts
import { Sim } from "../src/sim/world.js";

describe("Sim.addFeature", () => {
  it("places parts at absolute coordinates and refuses unimplemented kinds", async () => {
    const sim = await Sim.create({ seed: "feat-add" });
    const id = sim.addFeature("target_bank", 1, 1.5);
    expect(id).toBe(0);
    const f = sim.features[0]!;
    expect(f.kind).toBe("target_bank");
    expect(f.parts).toHaveLength(3);
    expect(f.parts[0]!.x).toBeCloseTo(1 - 0.34, 6);
    expect(f.parts[1]!.y).toBeCloseTo(1.5 + 0.16, 6);
    expect(() => sim.addFeature("spinner", 0, 2)).toThrow(/not implemented/);
    sim.clearFeatures();
    expect(sim.features).toHaveLength(0);
    sim.dispose();
  });

  it("reports a featureHit when a ball strikes a part, and stops after the part is removed", async () => {
    const sim = await Sim.create({ seed: "feat-hit" });
    sim.addFeature("drop_target", 0, 5);
    const bar = sim.features[0]!.parts[0]!;
    sim.spawnBall({ x: bar.x, y: bar.y + 0.6 });
    let hits = 0;
    for (let t = 0; t < 240; t++) for (const e of sim.step()) if (e.type === "featureHit") hits++;
    expect(hits).toBeGreaterThan(0);

    const sim2 = await Sim.create({ seed: "feat-hit" });
    sim2.addFeature("drop_target", 0, 5);
    sim2.removeFeaturePart(0, 0);
    sim2.spawnBall({ x: bar.x, y: bar.y + 0.6 });
    let hits2 = 0;
    for (let t = 0; t < 240; t++) for (const e of sim2.step()) if (e.type === "featureHit") hits2++;
    expect(hits2).toBe(0);
    sim.dispose();
    sim2.dispose();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/features.test.ts`
Expected: FAIL — `sim.addFeature is not a function`.

- [ ] **Step 3: Implement in `src/sim/world.ts`**

Extend the type import at the top of the file (the existing `import { ... } from "./types.js"` block) with:

```ts
  FEATURE_CLEARANCE,
  FEATURE_RESTITUTION,
  FEATURE_SHAPES,
  type BoardFeature,
  type FeatureKind,
  type FeaturePart,
```

Add these fields next to `private readonly pegColliders: RAPIER.Collider[] = [];`:

```ts
  /** Board features placed this round; a feature's `id` is its index here. */
  readonly features: BoardFeature[] = [];
  private readonly featureColliders: Array<Array<RAPIER.Collider | null>> = [];
  private readonly colliderToFeature = new Map<number, { feature: number; part: number }>();
  private featureBody: RAPIER.RigidBody | null = null;
```

Add this section just before `// --- balls ---`:

```ts
  // --- board features ------------------------------------------------------

  /**
   * Put a feature on the board at an anchor. Parts are stored in absolute
   * world coordinates so the renderer and the game layer never redo the maths.
   */
  addFeature(kind: FeatureKind, x: number, y: number): number {
    const shape = FEATURE_SHAPES[kind];
    if (!shape) throw new Error(`feature kind not implemented: ${kind}`);
    this.featureBody ??= this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const id = this.features.length;
    const parts: FeaturePart[] = [];
    const cols: Array<RAPIER.Collider | null> = [];
    for (let i = 0; i < shape.length; i++) {
      const s = shape[i]!;
      const px = x + s.x;
      const py = y + s.y;
      const desc = (s.r !== undefined
        ? RAPIER.ColliderDesc.ball(s.r)
        : RAPIER.ColliderDesc.cuboid((s.w ?? 0.5) / 2, (s.h ?? 0.1) / 2))
        .setTranslation(px, py)
        .setRestitution(FEATURE_RESTITUTION)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const c = this.world.createCollider(desc, this.featureBody);
      this.colliderToFeature.set(c.handle, { feature: id, part: i });
      cols.push(c);
      parts.push({ ...s, x: px, y: py });
    }
    this.features.push({ id, kind, x, y, parts });
    this.featureColliders.push(cols);
    return id;
  }

  /** Drop every feature (called at the start of each round). */
  clearFeatures(): void {
    for (const cols of this.featureColliders) {
      for (const c of cols) {
        if (!c) continue;
        this.colliderToFeature.delete(c.handle);
        this.world.removeCollider(c, false);
      }
    }
    this.featureColliders.length = 0;
    this.features.length = 0;
  }

  /**
   * Remove one part's collider — a drop target breaking. The geometry stays in
   * `features` so the renderer can animate it away. Never call this from
   * inside a contact callback; the game layer calls it after `step()` returns.
   */
  removeFeaturePart(feature: number, part: number): void {
    const c = this.featureColliders[feature]?.[part];
    if (!c) return;
    this.colliderToFeature.delete(c.handle);
    this.world.removeCollider(c, false);
    this.featureColliders[feature]![part] = null;
  }

  /** Pegs sitting too close to any part of `feature` to leave a ball a path. */
  pegsUnderFeature(feature: number): number[] {
    const f = this.features[feature];
    if (!f) return [];
    const out: number[] = [];
    for (const p of this.pegs) {
      for (const part of f.parts) {
        const extent = part.r ?? Math.hypot((part.w ?? 0) / 2, (part.h ?? 0) / 2);
        if (Math.hypot(p.x - part.x, p.y - part.y) < extent + p.radius + FEATURE_CLEARANCE) {
          out.push(p.id);
          break;
        }
      }
    }
    return out;
  }
```

In `step()`, inside `drainCollisionEvents`, add this block immediately after the
`const peg = this.colliderToPeg.get(other); if (peg !== undefined) { ... return; }`
block and before the `if (this.wallHandles.has(other))` line:

```ts
      const hitPart = this.colliderToFeature.get(other);
      if (hitPart !== undefined) {
        const v = this.balls.get(ballId)?.linvel() ?? { x: 0, y: 0 };
        out.push({ type: "featureHit", ball: ballId, feature: hitPart.feature, part: hitPart.part, speed: Math.hypot(v.x, v.y) });
        return;
      }
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/features.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/sim/world.ts tests/features.test.ts
git commit -m "feat(sim): feature colliders and featureHit contacts"
```

---

## Task 3: Switching pegs off under a feature

**Files:**
- Modify: `src/sim/world.ts`
- Test: `tests/features.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/features.test.ts`:

```ts
describe("pegs under a feature", () => {
  it("finds the overlapped pegs and a disabled peg stops reporting hits", async () => {
    const sim = await Sim.create({ seed: "feat-pegs" });
    // Anchor the bank right on a mid-field peg.
    const target = sim.pegs[30]!;
    sim.addFeature("target_bank", target.x, target.y);
    const under = sim.pegsUnderFeature(0);
    expect(under).toContain(target.id);

    for (const id of under) sim.setPegEnabled(id, false);
    expect(sim.pegIsEnabled(target.id)).toBe(false);
    sim.spawnBall({ x: target.x, y: target.y + 2 });
    let pegHits = 0;
    for (let t = 0; t < 240; t++) for (const e of sim.step()) if (e.type === "pegHit" && under.includes(e.peg)) pegHits++;
    expect(pegHits).toBe(0);

    for (const id of under) sim.setPegEnabled(id, true);
    expect(sim.pegIsEnabled(target.id)).toBe(true);
    sim.dispose();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/features.test.ts`
Expected: FAIL — `sim.setPegEnabled is not a function`.

- [ ] **Step 3: Implement**

Add the field next to the other peg arrays in `src/sim/world.ts`:

```ts
  private readonly pegEnabled: boolean[] = [];
```

Add these methods right after `setPegBumper`:

```ts
  /** Switch a peg's collider off (a feature sits on it) or back on. */
  setPegEnabled(peg: number, on: boolean): void {
    const c = this.pegColliders[peg];
    if (!c) return;
    c.setEnabled(on);
    this.pegEnabled[peg] = on;
  }

  pegIsEnabled(peg: number): boolean {
    return this.pegEnabled[peg] !== false;
  }
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/features.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/sim/world.ts tests/features.test.ts
git commit -m "feat(sim): disable pegs displaced by a feature"
```

---

## Task 4: Extract the combo block in run.ts (no behaviour change)

Feature hits must feed the same combo machinery as peg hits. Rather than copy
40 lines, pull them out first and prove nothing moved.

**Files:**
- Modify: `src/game/run.ts`
- Test: existing `tests/run.test.ts`, `tests/bumpers.test.ts`, `tests/comboEvents.test.ts`, `tests/determinism.test.ts`

- [ ] **Step 1: Record the baseline**

Run: `npx vitest run tests/run.test.ts tests/bumpers.test.ts tests/comboEvents.test.ts tests/determinism.test.ts`
Expected: PASS. Note the count; it must be identical after the refactor.

- [ ] **Step 2: Add the method**

Add to `src/game/run.ts`, immediately before `private handle(`:

```ts
  /**
   * Advance the combo by `gain` hits and resolve everything a crossing
   * triggers: milestones (+1 mult to every ball in flight) and combo events.
   * Shared by peg hits and board-feature hits.
   */
  private addCombo(gain: number, out: GameEvent[]): void {
    const prevCombo = this.combo;
    this.combo += gain;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.lastHitTick = this.sim.tick;
    const m = this.comboMilestone();
    const milestones = Math.floor(this.combo / m) - Math.floor(prevCombo / m);
    out.push({ type: "combo", count: this.combo, milestone: milestones > 0 });
    // Combo events: every 50th hit, but never two within the cooldown.
    const every = Math.max(20, COMBO_EVENT_EVERY + this.sumCharm((c) => c.eventEveryDelta ?? 0));
    const crossedEvent = Math.floor(this.combo / every) > Math.floor(prevCombo / every);
    if (crossedEvent && this.sim.tick - this.lastComboEventTick >= COMBO_EVENT_COOLDOWN_TICKS) {
      this.lastComboEventTick = this.sim.tick;
      const kind = weightedPick(this.sim.streams.fx, COMBO_EVENT_KINDS, (k) => COMBO_EVENTS[k].weight);
      this.triggerComboEvent(kind, out);
    }
    if (milestones > 0) {
      for (const b of this.balls.values()) b.mult += milestones;
      out.push({ type: "popup", x: 0, y: this.sim.config.height * 0.55, text: `COMBO ${this.combo} · +${milestones} mult all`, kind: "mult" });
      out.push({ type: "shake", strength: 0.35 });
    }
  }
```

- [ ] **Step 3: Replace the inline block**

In `handle()`'s `pegHit` branch, delete everything from `const prevCombo = this.combo;`
through the closing brace of `if (milestones > 0) { ... }`, keeping the lines
that compute `comboGain`. The branch should read:

```ts
      // Combo: hits chained across every ball in flight. Milestones pay out
      // +1 mult to all balls in play, so multiball is worth engineering.
      // A bumper counts as several hits at once, so milestones and events are
      // detected by crossing, not equality.
      const isBumper = this.bumpers.has(ev.peg);
      const bumperCombo = isBumper ? BUMPER_COMBO + this.sumCharm((c) => c.bumperCombo ?? 0) : 0;
      const traitCombo = (type.traits?.comboHits ?? 1) - 1;
      const overdrive = this.activeEffects.has("overdrive") ? 2 : 1;
      const comboGain = (1 + bumperCombo + traitCombo) * overdrive;
      this.addCombo(comboGain, out);
```

Everything below (`if (isBumper) { ... }`) stays exactly as it was.

- [ ] **Step 4: Run the same tests**

Run: `npx vitest run tests/run.test.ts tests/bumpers.test.ts tests/comboEvents.test.ts tests/determinism.test.ts`
Expected: PASS, same count as Step 1. A failure here means the extraction
changed ordering — the `combo` event must still be pushed before the milestone
popup, and `triggerComboEvent` must still run before milestones are applied.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/game/run.ts
git commit -m "refactor(run): extract addCombo from the pegHit branch"
```

---

## Task 5: Charm fields and the two new charms

**Files:**
- Modify: `src/game/charms.ts`, `src/game/icons.ts`, `src/game/meta.ts`
- Test: `tests/features.test.ts`, existing `tests/icons.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/features.test.ts`:

```ts
import { CHARMS } from "../src/game/charms.js";
import { UNLOCKS } from "../src/game/meta.js";

describe("feature charms", () => {
  it("Target Bank and Drop Target each place one feature and are unlockable", () => {
    expect(CHARMS.target_bank.features).toEqual([{ kind: "target_bank", count: 1 }]);
    expect(CHARMS.drop_target.features).toEqual([{ kind: "drop_target", count: 1 }]);
    expect(CHARMS.target_bank.rarity).toBe("uncommon");
    expect(CHARMS.drop_target.rarity).toBe("uncommon");
    for (const id of ["target_bank", "drop_target"]) {
      expect(UNLOCKS.some((u) => u.kind === "charm" && u.id === id), `${id} unlock`).toBe(true);
    }
  });
});
```

If `UNLOCKS` is not exported from `src/game/meta.ts`, export it (`export const UNLOCKS`).

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/features.test.ts`
Expected: FAIL — `Property 'target_bank' does not exist` / undefined.

- [ ] **Step 3: Implement**

In `src/game/charms.ts`, extend the existing types import:

```ts
import type { BallSpawn, FeatureKind, Peg, SimEvent } from "../sim/types.js";
```

Add to the `Charm` interface, next to the other passive fields:

```ts
  /** Board features this charm puts on the board each round. */
  features?: { kind: FeatureKind; count: number }[];
```

Add to the hooks section of the `Charm` interface, after `onWallHit`:

```ts
  /** Fires when a ball strikes a board feature part (wave-2 extension point). */
  onFeatureHit?(ctx: CharmCtx, feature: number, part: number): void;
```

Add to the `CharmId` union, after the `// bumpers` group:

```ts
  // board features
  | "target_bank"
  | "drop_target"
```

Add to the `CHARMS` record, after the bumpers group:

```ts
  // --- board features --------------------------------------------------------
  target_bank: { id: "target_bank", name: "Target Bank", desc: "A three-target bank every round. Light all three for +60 chips and +2 mult.", rarity: "uncommon", features: [{ kind: "target_bank", count: 1 }] },
  drop_target: { id: "drop_target", name: "Drop Target", desc: "A breakable target every round. Three hits open the lane behind it.", rarity: "uncommon", features: [{ kind: "drop_target", count: 1 }] },
```

In `src/game/icons.ts`, add to the `CHARM_GLYPH` record (the one containing
`pop_bumpers: "gear"`):

```ts
  target_bank: "eye", drop_target: "shield",
```

In `src/game/meta.ts`, add to the `UNLOCKS` array, after the `// bumpers` group:

```ts
  // board features
  { kind: "charm", id: "target_bank", stat: "roundsCleared", value: 10, hint: "Clear 10 rounds (lifetime)" },
  { kind: "charm", id: "drop_target", stat: "bumperHits", value: 75, hint: "Pop off 75 bumpers" },
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/features.test.ts tests/icons.test.ts`
Expected: PASS. If `icons.test.ts` fails with "Cannot read properties of
undefined", a `CHARM_GLYPH` entry is missing — `charmIcon` has no fallback.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/game/charms.ts src/game/icons.ts src/game/meta.ts tests/features.test.ts
git commit -m "feat(charms): Target Bank and Drop Target"
```

---

## Task 6: Seeding features each round

**Files:**
- Modify: `src/game/run.ts`
- Test: `tests/features.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/features.test.ts`:

```ts
import { afterEach } from "vitest";
import { Run, type GameEvent } from "../src/game/run.js";

const runs: Run[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) r.dispose();
});
type Priv = { startRound(): void; handle(ev: unknown, out: GameEvent[]): void };

async function make(seed: string, ...charms: string[]) {
  const run = await Run.create(seed);
  runs.push(run);
  if (charms.length) {
    run.charms.push(...(charms as never[]));
    (run as unknown as Priv).startRound();
  }
  return run;
}

describe("feature placement", () => {
  it("places nothing without a charm", async () => {
    const run = await make("feat-none");
    expect(run.sim.features).toHaveLength(0);
  });

  it("a charm places its feature, announces it, and disables the pegs under it", async () => {
    const run = await make("feat-one", "target_bank");
    expect(run.sim.features).toHaveLength(1);
    expect(run.sim.features[0]!.kind).toBe("target_bank");
    const ann = run.step().find((e) => e.type === "features");
    expect(ann).toBeDefined();
    if (ann?.type === "features") {
      expect(ann.list).toHaveLength(1);
      for (const peg of ann.disabled) expect(run.sim.pegIsEnabled(peg)).toBe(false);
    }
  });

  it("placement is seeded: same seed and charms, same anchors", async () => {
    const a = await make("feat-seed", "target_bank", "drop_target");
    const b = await make("feat-seed", "target_bank", "drop_target");
    expect(a.sim.features.map((f) => [f.kind, f.x, f.y])).toEqual(b.sim.features.map((f) => [f.kind, f.x, f.y]));
  });

  it("a new round rebuilds the features and re-enables last round's pegs", async () => {
    const run = await make("feat-round", "target_bank");
    const before = [...run.sim.features];
    (run as unknown as Priv).startRound();
    expect(run.sim.features).toHaveLength(1);
    expect(run.sim.features[0]).not.toBe(before[0]); // rebuilt, not reused
    for (const p of run.sim.pegs) {
      const under = run.sim.pegsUnderFeature(0).includes(p.id);
      expect(run.sim.pegIsEnabled(p.id)).toBe(!under);
    }
  });

  it("never puts a feature on top of a bumper peg", async () => {
    const run = await make("feat-bump", "target_bank", "drop_target");
    const disabled = new Set(run.sim.features.flatMap((f) => run.sim.pegsUnderFeature(f.id)));
    for (const b of run.bumpers) expect(disabled.has(b)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/features.test.ts`
Expected: FAIL — `run.sim.features` is empty with the charm held.

- [ ] **Step 3: Implement**

In `src/game/run.ts`, extend the types import:

```ts
import { BUMPER_RESTITUTION, FEATURE_ANCHORS } from "../sim/types.js";
import type { BallSpawn, BoardFeature, FeatureKind, SimEvent } from "../sim/types.js";
```

Add to the `GameEvent` union, after the `bumper` member:

```ts
  /** This round's board features, and the pegs they switched off. */
  | { type: "features"; list: BoardFeature[]; disabled: number[] }
  /** A ball struck a feature part. `fresh` = the part was unlit / unbroken. */
  | { type: "featureHit"; feature: number; part: number; kind: FeatureKind; x: number; y: number; fresh: boolean }
  /** A bank completed, or a drop target broke. */
  | { type: "featureDone"; feature: number; kind: FeatureKind; x: number; y: number }
```

Add the scoring constants next to the bumper constants near the top:

```ts
/** Board features: a target bank pays per part and bursts when all three light. */
export const BANK_CHIPS_FRESH = 12;
export const BANK_CHIPS_REPEAT = 4;
export const BANK_COMPLETE_CHIPS = 60;
export const BANK_COMPLETE_MULT = 2;
/** A drop target takes this many hits, then breaks open for the rest of the round. */
export const DROP_TARGET_HITS = 3;
export const DROP_TARGET_CHIPS = 10;
export const DROP_TARGET_BREAK_CHIPS = 40;
```

Add the state fields next to `readonly bumpers = new Set<number>();`:

```ts
  /** Per-round state for each board feature, keyed by feature id. */
  readonly featureState = new Map<number, { kind: FeatureKind; lit: Set<number>; hits: number; done: boolean }>();
  /** Pegs switched off because a feature sits on them this round. */
  readonly disabledPegs = new Set<number>();
```

In `startRound()`, insert this block **immediately before** the bumper block
(the one starting `// Bumpers: a few seeded pegs ...`):

```ts
    // Board features: charm-driven, so they roll from the shop stream — a
    // charm choice must never shift a bounce. Placed before bumpers so a
    // bumper is never seeded onto a peg a feature has just switched off.
    this.sim.clearFeatures();
    this.featureState.clear();
    for (const id of this.disabledPegs) this.sim.setPegEnabled(id, true);
    this.disabledPegs.clear();
    const wanted: FeatureKind[] = [];
    for (const id of this.charms) for (const f of CHARMS[id].features ?? []) for (let i = 0; i < f.count; i++) wanted.push(f.kind);
    if (wanted.length > 0) {
      const W = this.sim.config.width;
      const Hb = this.sim.config.height;
      const anchors = shuffle(FEATURE_ANCHORS.map((_, i) => i), this.sim.streams.shop);
      for (let i = 0; i < wanted.length && i < anchors.length; i++) {
        const a = FEATURE_ANCHORS[anchors[i]!]!;
        const fid = this.sim.addFeature(wanted[i]!, a.x * W, a.y * Hb);
        this.featureState.set(fid, { kind: wanted[i]!, lit: new Set(), hits: 0, done: false });
        for (const peg of this.sim.pegsUnderFeature(fid)) {
          this.sim.setPegEnabled(peg, false);
          this.disabledPegs.add(peg);
          this.lit.delete(peg); // a switched-off peg must not count as lit
        }
      }
    }
    pending.push({ type: "features", list: this.sim.features.map((f) => ({ ...f, parts: f.parts.map((p) => ({ ...p })) })), disabled: [...this.disabledPegs].sort((x, y) => x - y) });
```

In the bumper block just below, exclude disabled pegs from the candidates —
change the `candidates` line to:

```ts
    const candidates = this.sim.pegs.filter((p) => p.y < H * 0.8 && p.y > H * 0.3 && !this.pegElements.has(p.id) && !this.disabledPegs.has(p.id)).map((p) => p.id);
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/features.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/game/run.ts tests/features.test.ts
git commit -m "feat(run): seed charm-driven board features each round"
```

---

## Task 7: Target bank scoring

**Files:**
- Modify: `src/game/run.ts`
- Test: `tests/features.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/features.test.ts`:

```ts
import {
  BANK_CHIPS_FRESH, BANK_CHIPS_REPEAT, BANK_COMPLETE_CHIPS, BANK_COMPLETE_MULT,
} from "../src/game/run.js";
import type { BallScoreState } from "../src/game/charms.js";

function fakeBall(id: number): BallScoreState {
  return { id, type: "steel", chips: 0, mult: 1, hits: 0, freshHits: 0, revives: 0, zaps: 0, shard: false };
}

describe("target bank scoring", () => {
  it("pays per part, repeats cheaper, and bursts once when all three light", async () => {
    const run = await make("bank-score", "target_bank");
    const b = fakeBall(9001);
    run.balls.set(b.id, b);
    const out: GameEvent[] = [];
    const hit = (part: number) => (run as unknown as Priv).handle({ type: "featureHit", ball: b.id, feature: 0, part, speed: 2 }, out);

    hit(0);
    expect(b.chips).toBe(BANK_CHIPS_FRESH);
    hit(0); // already lit
    expect(b.chips).toBe(BANK_CHIPS_FRESH + BANK_CHIPS_REPEAT);
    hit(1);
    expect(out.filter((e) => e.type === "featureDone")).toHaveLength(0);
    hit(2);
    const done = out.filter((e) => e.type === "featureDone");
    expect(done).toHaveLength(1);
    expect(b.chips).toBe(BANK_CHIPS_FRESH * 3 + BANK_CHIPS_REPEAT + BANK_COMPLETE_CHIPS);
    expect(b.mult).toBeGreaterThanOrEqual(1 + BANK_COMPLETE_MULT);

    // A completed bank pays nothing more this round.
    const chips = b.chips;
    hit(0);
    expect(b.chips).toBe(chips);
    expect(out.filter((e) => e.type === "featureDone")).toHaveLength(1);
  });

  it("each hit advances the combo by exactly one", async () => {
    const run = await make("bank-combo", "target_bank");
    const b = fakeBall(9002);
    run.balls.set(b.id, b);
    const out: GameEvent[] = [];
    run.combo = 0;
    (run as unknown as Priv).handle({ type: "featureHit", ball: b.id, feature: 0, part: 0, speed: 1 }, out);
    expect(run.combo).toBe(1);
    (run as unknown as Priv).handle({ type: "featureHit", ball: b.id, feature: 0, part: 1, speed: 1 }, out);
    expect(run.combo).toBe(2);
  });

  it("the bank resets with the round", async () => {
    const run = await make("bank-reset", "target_bank");
    const b = fakeBall(9003);
    run.balls.set(b.id, b);
    const out: GameEvent[] = [];
    for (const p of [0, 1, 2]) (run as unknown as Priv).handle({ type: "featureHit", ball: b.id, feature: 0, part: p, speed: 1 }, out);
    expect(run.featureState.get(0)!.done).toBe(true);
    (run as unknown as Priv).startRound();
    expect(run.featureState.get(0)!.done).toBe(false);
    expect(run.featureState.get(0)!.lit.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/features.test.ts`
Expected: FAIL — `b.chips` is 0; `handle` ignores `featureHit`.

- [ ] **Step 3: Implement**

In `handle()`, add this as the **first** branch, immediately after
`const ctx = this.ctxFor(ball, out);`:

```ts
    if (ev.type === "featureHit") {
      this.handleFeatureHit(ball, ev, ctx, out);
      return;
    }
```

Add the method right after `handle()`:

```ts
  /**
   * Board features. Every hit is worth exactly one combo hit (unlike a bumper),
   * and a feature that has done its job pays nothing more until the round ends.
   */
  private handleFeatureHit(
    ball: BallScoreState,
    ev: Extract<SimEvent, { type: "featureHit" }>,
    ctx: CharmCtx,
    out: GameEvent[],
  ): void {
    const f = this.sim.features[ev.feature];
    const st = this.featureState.get(ev.feature);
    if (!f || !st || st.done) return;
    const part = f.parts[ev.part];
    if (!part) return;
    const type = BALL_TYPES[ball.type];
    ball.hits++;
    this.addCombo(1, out);
    for (const id of this.charms) CHARMS[id].onFeatureHit?.(ctx, ev.feature, ev.part);

    if (st.kind === "target_bank") {
      const fresh = !st.lit.has(ev.part);
      if (fresh) st.lit.add(ev.part);
      const chips = Math.round((fresh ? BANK_CHIPS_FRESH : BANK_CHIPS_REPEAT) * type.chipFactor);
      ball.chips += chips;
      out.push({ type: "featureHit", feature: ev.feature, part: ev.part, kind: st.kind, x: part.x, y: part.y, fresh });
      out.push({ type: "popup", x: part.x, y: part.y, text: `+${chips}`, kind: "chips", fresh, tag: ball.type });
      if (st.lit.size === f.parts.length) {
        st.done = true;
        ball.chips += Math.round(BANK_COMPLETE_CHIPS * type.chipFactor);
        ctx.addMult(BANK_COMPLETE_MULT, "bank");
        out.push({ type: "featureDone", feature: ev.feature, kind: st.kind, x: f.x, y: f.y });
        out.push({ type: "popup", x: f.x, y: f.y + 0.4, text: `BANK +${BANK_COMPLETE_CHIPS} · +${BANK_COMPLETE_MULT} mult`, kind: "mult" });
        out.push({ type: "shake", strength: 0.3 });
      }
    }
  }
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/features.test.ts`
Expected: PASS (16 tests). If the chips assertion is off by rounding, check
`BALL_TYPES.steel.chipFactor` is 1.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/game/run.ts tests/features.test.ts
git commit -m "feat(run): target bank scoring"
```

---

## Task 8: Drop target scoring

**Files:**
- Modify: `src/game/run.ts`
- Test: `tests/features.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/features.test.ts`:

```ts
import { DROP_TARGET_BREAK_CHIPS, DROP_TARGET_CHIPS, DROP_TARGET_HITS } from "../src/game/run.js";

describe("drop target scoring", () => {
  it("takes three hits, pays the break bonus once, and removes the collider", async () => {
    const run = await make("drop-score", "drop_target");
    const b = fakeBall(9101);
    run.balls.set(b.id, b);
    const out: GameEvent[] = [];
    const hit = () => (run as unknown as Priv).handle({ type: "featureHit", ball: b.id, feature: 0, part: 0, speed: 2 }, out);

    for (let i = 0; i < DROP_TARGET_HITS; i++) hit();
    expect(b.chips).toBe(DROP_TARGET_CHIPS * DROP_TARGET_HITS + DROP_TARGET_BREAK_CHIPS);
    expect(out.filter((e) => e.type === "featureDone")).toHaveLength(1);
    expect(run.featureState.get(0)!.done).toBe(true);

    // A broken target is inert: the collider is gone, and a stray event pays nothing.
    const chips = b.chips;
    hit();
    expect(b.chips).toBe(chips);
  });

  it("the target is restored at the start of the next round", async () => {
    const run = await make("drop-reset", "drop_target");
    const b = fakeBall(9102);
    run.balls.set(b.id, b);
    const out: GameEvent[] = [];
    for (let i = 0; i < DROP_TARGET_HITS; i++) {
      (run as unknown as Priv).handle({ type: "featureHit", ball: b.id, feature: 0, part: 0, speed: 1 }, out);
    }
    (run as unknown as Priv).startRound();
    expect(run.featureState.get(0)!.hits).toBe(0);
    expect(run.featureState.get(0)!.done).toBe(false);
    // The collider is live again: a ball dropped onto it reports a hit.
    const bar = run.sim.features[0]!.parts[0]!;
    run.sim.spawnBall({ x: bar.x, y: bar.y + 0.6 });
    let hits = 0;
    for (let t = 0; t < 240; t++) for (const e of run.sim.step()) if (e.type === "featureHit") hits++;
    expect(hits).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/features.test.ts`
Expected: FAIL — chips stay 0; `handleFeatureHit` only handles `target_bank`.

- [ ] **Step 3: Implement**

In `handleFeatureHit`, change the bank branch to `return` at its end and append
the drop-target branch:

```ts
    if (st.kind === "target_bank") {
      // ... unchanged body ...
      return;
    }

    // drop_target: three hits, then the bar comes off for the rest of the round.
    st.hits++;
    const chips = Math.round(DROP_TARGET_CHIPS * type.chipFactor);
    ball.chips += chips;
    out.push({ type: "featureHit", feature: ev.feature, part: ev.part, kind: st.kind, x: part.x, y: part.y, fresh: true });
    out.push({ type: "popup", x: part.x, y: part.y, text: `+${chips}`, kind: "chips", fresh: true, tag: ball.type });
    if (st.hits >= DROP_TARGET_HITS) {
      st.done = true;
      // Safe here: handle() runs after sim.step() returns, never inside a contact callback.
      this.sim.removeFeaturePart(ev.feature, ev.part);
      ball.chips += Math.round(DROP_TARGET_BREAK_CHIPS * type.chipFactor);
      out.push({ type: "featureDone", feature: ev.feature, kind: st.kind, x: f.x, y: f.y });
      out.push({ type: "popup", x: f.x, y: f.y + 0.4, text: `TARGET DOWN +${DROP_TARGET_BREAK_CHIPS}`, kind: "chips" });
      out.push({ type: "shake", strength: 0.25 });
    }
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/features.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/game/run.ts tests/features.test.ts
git commit -m "feat(run): drop target scoring"
```

---

## Task 9: Determinism and placement safety

**Files:**
- Test: `tests/features.test.ts`

No production code should be needed. If a test here fails, the fix belongs in
the task that introduced the behaviour.

- [ ] **Step 1: Write the test**

Append to `tests/features.test.ts`:

```ts
describe("features are part of the replay", () => {
  it("two runs with the same seed and charms hash identically every tick", async () => {
    const a = await make("feat-det", "target_bank", "drop_target");
    const b = await make("feat-det", "target_bank", "drop_target");
    a.bag[0] = "steel";
    b.bag[0] = "steel";
    a.drop(0.4);
    b.drop(0.4);
    for (let t = 0; t < 600; t++) {
      a.step();
      b.step();
      expect(a.sim.hash(), `tick ${t}`).toBe(b.sim.hash());
    }
  });

  it("no feature part overlaps a pocket divider or the walls", async () => {
    const run = await make("feat-safe", "target_bank", "drop_target");
    const half = run.sim.config.width / 2;
    for (const f of run.sim.features) {
      for (const p of f.parts) {
        const extent = p.r ?? Math.max((p.w ?? 0) / 2, (p.h ?? 0) / 2);
        expect(p.y - extent, `${f.kind} sits in the pockets`).toBeGreaterThan(0.9);
        expect(Math.abs(p.x) + extent, `${f.kind} touches a wall`).toBeLessThan(half - 0.2);
      }
    }
  });

  it("a ball can still reach every pocket with both features on the board", async () => {
    const run = await make("feat-pass", "target_bank", "drop_target");
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      run.bag[0] = "steel";
      run.drop(-2.4 + (i % 9) * 0.6);
      for (let t = 0; t < 120 * 14 && run.inFlight > 0; t++) {
        for (const e of run.step()) if (e.type === "ballScored") seen.add(e.bucket);
      }
      if (run.phase !== "drop") break;
    }
    expect(seen.size, "balls only reached some pockets").toBeGreaterThanOrEqual(3);
    expect(seen.has(-1), "a ball leaked out of the board").toBe(false);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/features.test.ts`
Expected: PASS (21 tests).

If "a ball can still reach every pocket" fails, a feature is blocking the
board: widen `FEATURE_CLEARANCE` in `src/sim/types.ts` or move the offending
anchor in `FEATURE_ANCHORS`, then re-run every test in this file.

- [ ] **Step 3: Commit**

```bash
git add tests/features.test.ts
git commit -m "test: board features are deterministic and leave the board passable"
```

---

## Task 10: Lifetime stat and feat

**Files:**
- Modify: `src/game/meta.ts`, `src/game/icons.ts`
- Test: `tests/features.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/features.test.ts`:

```ts
import { emptyMeta, recordEvents, FEATS } from "../src/game/meta.js";

describe("feature stats", () => {
  it("counts feature hits and offers a feat family", async () => {
    const run = await make("feat-meta", "target_bank");
    const meta = emptyMeta();
    expect(meta.stats.featureHits).toBe(0);
    const events: GameEvent[] = [
      { type: "featureHit", feature: 0, part: 0, kind: "target_bank", x: 0, y: 1.5, fresh: true },
      { type: "featureHit", feature: 0, part: 1, kind: "target_bank", x: 0, y: 1.5, fresh: true },
    ];
    const tracker = { eventsThisRound: 0, jackpotStreak: 0, lastBallScore: 0, pocketsThisRound: [] as number[] };
    recordEvents(meta, events, run, tracker as never);
    expect(meta.stats.featureHits).toBe(2);
    expect(Object.keys(FEATS).some((id) => id.startsWith("features_"))).toBe(true);
  });
});
```

Check `recordEvents`' real signature and the tracker's real shape in
`src/game/meta.ts` before running, and match them exactly — adjust the literal
above rather than changing `meta.ts`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/features.test.ts`
Expected: FAIL — `meta.stats.featureHits` is `undefined`.

- [ ] **Step 3: Implement**

In `src/game/meta.ts`, add to the `MetaStats` interface, after `bumperHits`:

```ts
  /** Hits on board features (target banks, drop targets). */
  featureHits: number;
```

Add it to `emptyMeta()`'s stats literal (the line holding `bumperHits: 0`):

```ts
      reactions: 0, steams: 0, comboEvents: 0, portals: 0, bumperHits: 0, featureHits: 0,
```

Add a case to `recordEvents`, next to `case "bumper":`:

```ts
      case "featureHit":
        s.featureHits++;
        break;
```

Add a feat tier at the end of `THRESHOLD_FEATS`:

```ts
  ...tier("featureHits", "features", ["Target Practice", "Bank Job", "Demolition"], [50, 500, 2500], (v) => `Hit board features ${v} times.`),
```

In `src/game/icons.ts`, add to `FAMILY_GLYPH`:

```ts
  features: "eye",
```

No `META_VERSION` bump is needed: `LocalMetaStore.load` merges saved stats over
`emptyMeta().stats`, so an older profile picks up `featureHits: 0`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/features.test.ts tests/meta.test.ts tests/icons.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/game/meta.ts src/game/icons.ts tests/features.test.ts
git commit -m "feat(meta): featureHits stat and feat tier"
```

---

## Task 11: Rendering

**Files:**
- Modify: `src/render/scene.ts`
- Test: none (Three.js code is not unit-tested in this repo; `tests/wiring.test.ts` in Task 12 covers the call sites)

- [ ] **Step 1: Add the peg-hiding path**

In `src/render/scene.ts`, add the field next to `private pegBumper = new Uint8Array(0);`:

```ts
  private pegHidden = new Uint8Array(0);
```

In `setPegs`, next to `this.pegBumper = new Uint8Array(pegs.length);`:

```ts
    this.pegHidden = new Uint8Array(pegs.length);
```

Change `pegRadius` so a hidden peg collapses (every matrix-writing loop already
goes through it):

```ts
  private pegRadius(i: number): number {
    if (this.pegHidden[i]) return 0.0001;
    return this.pegBumper[i] ? BUMPER_RADIUS : (this.pegBase[i]?.radius ?? 0.08);
  }
```

Extract the rewrite loop that `setPegBumpers` ends with into a shared method,
and call it from both places:

```ts
  /** Rewrite every peg's matrix and colour from the current flags. */
  private refreshPegs(): void {
    if (!this.pegs) return;
    for (let i = 0; i < this.pegBase.length; i++) {
      const p = this.pegBase[i]!;
      this.dummy.position.set(p.x, p.y, 0);
      this.dummy.scale.setScalar(this.pegRadius(i));
      this.dummy.updateMatrix();
      this.pegs.setMatrixAt(i, this.dummy.matrix);
      this.writePegColor(i, this.pegColor(i));
    }
    this.pegs.instanceMatrix.needsUpdate = true;
  }

  /** This round's bumper pegs: bigger and amber. Called with the new set every round. */
  setPegBumpers(pegs: number[]): void {
    if (!this.pegs) return;
    this.pegBumper.fill(0);
    for (const p of pegs) this.pegBumper[p] = 1;
    this.refreshPegs();
  }

  /** Pegs a board feature has displaced: collapsed to nothing for the round. */
  setPegsHidden(ids: number[]): void {
    if (!this.pegs) return;
    this.pegHidden.fill(0);
    for (const p of ids) this.pegHidden[p] = 1;
    this.refreshPegs();
  }
```

- [ ] **Step 2: Add the feature meshes**

Extend the types import at the top of `scene.ts`:

```ts
import { BUMPER_RADIUS, type BoardFeature, type Fin, type Peg, type Snapshot } from "../sim/types.js";
```

Add the colour constants next to `PEG_BUMPER`:

```ts
/** Features read as live targets: cyan unlit, white-hot once lit. */
const FEATURE_IDLE = new THREE.Color(0.18, 0.88, 1.0).multiplyScalar(1.4);
const FEATURE_LIT = new THREE.Color(1.0, 0.95, 0.6).multiplyScalar(2.6);
```

Add the fields next to `private finMeshes`:

```ts
  private featureMeshes: THREE.Mesh[] = [];
  private readonly featurePartMeshes = new Map<string, THREE.Mesh>();
```

Add these methods after `setFins`:

```ts
  /** This round's board features. Called with the full list every round. */
  setFeatures(list: BoardFeature[]): void {
    for (const m of this.featureMeshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.featureMeshes = [];
    this.featurePartMeshes.clear();
    for (const f of list) {
      f.parts.forEach((p, i) => {
        const geo = p.r !== undefined
          ? new THREE.SphereGeometry(p.r, 18, 12)
          : new THREE.BoxGeometry(p.w ?? 0.5, p.h ?? 0.1, 0.3);
        const mat = new THREE.MeshStandardMaterial({ color: FEATURE_IDLE, emissive: FEATURE_IDLE, emissiveIntensity: 1.5, roughness: 0.35 });
        const m = new THREE.Mesh(geo, mat);
        m.position.set(p.x, p.y, 0);
        this.scene.add(m);
        this.featureMeshes.push(m);
        this.featurePartMeshes.set(`${f.id}:${i}`, m);
      });
    }
  }

  /** A bank part just lit: it stays bright for the round. */
  litFeaturePart(feature: number, part: number): void {
    const m = this.featurePartMeshes.get(`${feature}:${part}`);
    if (!m) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.color.copy(FEATURE_LIT);
    mat.emissive.copy(FEATURE_LIT);
    mat.emissiveIntensity = 2.4;
  }

  /** A drop target broke: the bar comes off the board. */
  breakFeaturePart(feature: number, part: number): void {
    const m = this.featurePartMeshes.get(`${feature}:${part}`);
    if (m) m.visible = false;
  }
```

- [ ] **Step 3: Verify it builds**

```bash
npm run typecheck
npm run build
```
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/render/scene.ts
git commit -m "feat(render): draw board features and hide displaced pegs"
```

---

## Task 12: Wiring in main.ts

**Files:**
- Modify: `src/main.ts`, `tests/wiring.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/wiring.test.ts`, inside the `it("works on phones: ...")` block — next
to the existing `case "bumpers"` assertions — add:

```ts
    expect(main).toMatch(/case "features"/);
    expect(main).toMatch(/case "featureHit"/);
    expect(main).toMatch(/case "featureDone"/);
    expect(main).toMatch(/view\.setFeatures\(e\.list\)/);
    expect(main).toMatch(/view\.setPegsHidden\(e\.disabled\)/);
    expect(main).toMatch(/view\.litFeaturePart\(/);
    expect(main).toMatch(/view\.breakFeaturePart\(/);
```

Also add `"features"`, `"featureHit"` and `"featureDone"` to the event-name
array in the `it("handles every presentation-relevant game event")` block.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/wiring.test.ts`
Expected: FAIL — `case "features"` not found.

- [ ] **Step 3: Implement**

In `src/main.ts`, add these cases to the game-event switch, immediately after
the `case "bumper":` block:

```ts
      case "features":
        view.setFeatures(e.list);
        view.setPegsHidden(e.disabled);
        break;
      case "featureHit":
        if (e.kind === "target_bank" && e.fresh) view.litFeaturePart(e.feature, e.part);
        view.fx.burst(e.x, e.y, 0x2de2ff, 14, 3.5, 0.14, 0.4);
        view.kickBloom(0.25);
        audio.peg();
        break;
      case "featureDone":
        if (e.kind === "drop_target") view.breakFeaturePart(e.feature, 0);
        view.fx.ring(e.x, e.y, 0xffd34d, 1.3, 0.4);
        view.shock(e.x, e.y, 0.5);
        view.kickBloom(0.8);
        ui.flash("#2de2ff", 0.25);
        audio.mult();
        break;
```

Check the real method names on `audio` (`src/game/audio.ts`) and swap `peg()` /
`mult()` for whatever exists — `case "bumper"` already uses `audio.mult()`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/wiring.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, build, commit**

```bash
npm run typecheck && npm run build
git add src/main.ts tests/wiring.test.ts
git commit -m "feat(main): wire board feature events to renderer and audio"
```

---

## Task 13: Version bump, balance check, docs

**Files:**
- Modify: `src/game/version.ts`, `README.md`

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: PASS. The replay test `reproduces a live run's score from its log` is
intentionally skipped — that is expected, not a failure.

- [ ] **Step 2: Bump the rules version**

In `src/game/version.ts`, change `RULES_VERSION` from `19` to `20`, and update
its comment:

```ts
export const RULES_VERSION = 20; // 20: board features — target bank + drop target
```

- [ ] **Step 3: Run the balance probe**

```bash
BALANCE=1 npx vitest run tests/balance.probe.test.ts
cat .cache/balance.txt
```

Record the pass rates per round in the commit message. These charms are
additive and the probe's dumb policy does not aim at features, so the rates
should move very little — a swing of more than ~5 points at any round means
`pegsUnderFeature` is removing too many pegs. If that happens, lower
`FEATURE_CLEARANCE` toward 0.4 or drop the two mid-field anchors from
`FEATURE_ANCHORS`, then re-run `npx vitest run tests/features.test.ts`.

- [ ] **Step 4: Document it**

In `README.md`, in the section listing charms and board elements (search for
`Pop Bumpers`), add:

```markdown
**Board features** (charm-driven, re-seeded every round, state persists for the round):

- **Target Bank** (uncommon) — three targets below the peg field. Each unlit part pays 12 chips, repeats 4. Light all three for +60 chips and +2 mult, once per round.
- **Drop Target** (uncommon) — a breakable bar. 10 chips a hit, three hits to break it for +40 chips, and the lane behind it opens for the rest of the round.

Features switch off the pegs they overlap, so the board never gets denser than a
Heavy ball can pass. Spinner and orbit-lane features are planned (waves 2 and 3).
```

- [ ] **Step 5: Final verification and commit**

```bash
npm run typecheck && npm test && npm run build
git add src/game/version.ts README.md
git commit -m "feat: RULES_VERSION 20 — board features ship (target bank + drop target)"
```

Do not push unless the user asks: pushing to `main` deploys to production.

---

## Self-review notes

- Every spec section maps to a task: sim surface → 1–3, run state/placement →
  6, charms → 5, renderer → 11, meta → 10, wave-1 behaviour → 7–8, testing → 9
  plus per-task tests, version → 13.
- `onFeatureHit` has no consumer in wave 1 by design; it is the documented
  extension point the spec asked for, and it costs one line plus one call site.
- The spec's `lit` field on `featureHit` is named `fresh` here; the deviation is
  stated at the top of this plan.
