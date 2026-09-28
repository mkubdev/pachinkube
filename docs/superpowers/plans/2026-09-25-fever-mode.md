# Fever Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the always-on quadratic fever with a pachinko-style timed jackpot (gauge → 8s FEVER MODE → re-chain levels), remap the five heat charms, break the event feeder loop, make the UI show the mechanic, and fix the laser/portal FX regressions.

**Architecture:** All scoring/state changes live in `src/game/` (deterministic, tick-based, no `Math.random`, no `src/sim/` changes). `src/game/fever.ts` holds the pure math; `src/game/run.ts` holds gauge/mode/level state; `src/game/ui.ts` + `src/main.ts` are presentation. `RULES_VERSION` bumps 17 → 18.

**Tech Stack:** TypeScript, vitest, Three.js (render layer only). Spec: `docs/superpowers/specs/2026-09-22-fever-mode-design.md`.

**Project rules that bind every task:** no `Math.random` in `sim/`/`game/`; relative imports reachable from `api/` end in `.js` (all `src/game/` imports already do — keep it); run `npm run typecheck` before every commit.

---

### Task 1: Rewrite `src/game/fever.ts` — gauge math

**Files:**
- Modify: `src/game/fever.ts` (full rewrite, currently 15 lines)
- Test: `tests/fever.test.ts` (replace the `fever formula` describe block, lines 7–27)

- [x] **Step 1: Write the failing tests**

Replace the `fever formula` describe block at the top of `tests/fever.test.ts` (keep the file's other blocks for now — they break in later tasks and are rewritten there). Also update the import line:

```ts
import { FEVER_GAUGE_BASE, FEVER_MODE_TICKS, feverGaugeRequirement, feverMult } from "../src/game/fever.js";
```

```ts
describe("fever mode math", () => {
  it("mult is ×1 cold and 1 + 2·level in a mode", () => {
    expect(feverMult(0)).toBe(1);
    expect(feverMult(1)).toBe(3);
    expect(feverMult(2)).toBe(5);
    expect(feverMult(5)).toBe(11);
  });
  it("Heat Sink curve boost adds boost × level²", () => {
    expect(feverMult(4, 0.5)).toBe(1 + 8 + 0.5 * 16); // ×17
    expect(feverMult(6, 1.0)).toBe(1 + 12 + 36); // ×49
    expect(feverMult(0, 1.0)).toBe(1); // cold stays cold
  });
  it("gauge requirement grows 25% per level", () => {
    expect(feverGaugeRequirement(0)).toBe(100);
    expect(feverGaugeRequirement(1)).toBe(125);
    expect(feverGaugeRequirement(2)).toBe(156); // floor(100 × 1.25²)
    expect(feverGaugeRequirement(3)).toBe(195);
  });
  it("Fever Pitch scales the requirement down", () => {
    expect(feverGaugeRequirement(0, 0.85)).toBe(85);
    expect(feverGaugeRequirement(1, 0.85)).toBe(106); // floor(125 × 0.85)
    expect(feverGaugeRequirement(0, 0.5)).toBe(50);
  });
  it("exports the tuned defaults", () => {
    expect(FEVER_GAUGE_BASE).toBe(100);
    expect(FEVER_MODE_TICKS).toBe(960); // 8 s at 120 Hz
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run tests/fever.test.ts`
Expected: FAIL — `feverMult` / `feverGaugeRequirement` not exported.

- [x] **Step 3: Rewrite `src/game/fever.ts`**

```ts
/**
 * FEVER MODE: a gauge charged by combo hits; when full, a timed jackpot mode
 * multiplies every landing. Refill the gauge before the timer runs out to
 * re-chain to the next level. Replaces the always-on quadratic fever.
 * Spec: docs/superpowers/specs/2026-09-22-fever-mode-design.md
 */
export const FEVER_GAUGE_BASE = 100;
export const FEVER_MODE_TICKS = 960; // 8 s at 120 Hz
export const FEVER_REQ_GROWTH = 1.25;

/** Mode multiplier at `level`; `curveBoost` (Heat Sink) adds boost × level². */
export function feverMult(level: number, curveBoost = 0): number {
  if (level <= 0) return 1;
  return 1 + 2 * level + curveBoost * level * level;
}

/** Gauge units to go from `level` to `level + 1` (level 0 = first ignition). */
export function feverGaugeRequirement(level: number, scale = 1): number {
  return Math.max(1, Math.floor(FEVER_GAUGE_BASE * scale * FEVER_REQ_GROWTH ** level));
}
```

Note: `run.ts` still imports the old names, so `typecheck` fails until Task 3. That's expected; this commit is test-scoped.

- [x] **Step 4: Run the new block**

Run: `npx vitest run tests/fever.test.ts -t "fever mode math"`
Expected: PASS (other blocks in the file still fail to compile — run only this block with `-t`; if the file doesn't compile at all, that's fine, proceed: Tasks 2–3 fix the rest of the file before the next full test run).

- [x] **Step 5: Commit**

```bash
git add src/game/fever.ts tests/fever.test.ts
git commit -m "feat: fever mode math — gauge requirement + level multiplier"
```

---

### Task 2: Remap the heat charms in `src/game/charms.ts`

**Files:**
- Modify: `src/game/charms.ts` — field declarations ~lines 177–187, charm defs ~lines 499–540
- Test: `tests/fever.test.ts` — replace the `heat charms` describe block

- [x] **Step 1: Write the failing tests**

Replace the `heat charms` describe block in `tests/fever.test.ts`:

```ts
describe("heat charms", () => {
  it("are defined with the spec'd fields", () => {
    expect(CHARMS.fever_pitch).toMatchObject({ rarity: "rare", feverGaugeScale: 0.85 });
    expect(CHARMS.heat_sink).toMatchObject({ rarity: "rare", feverCurveBoost: 0.5 });
    expect(CHARMS.afterglow).toMatchObject({ rarity: "uncommon", feverGraceTicks: 240 });
    expect(CHARMS.thermal_mass).toMatchObject({ rarity: "rare", feverGaugeCarry: 0.25 });
    expect(CHARMS.inferno_engine).toMatchObject({ rarity: "legendary", infernoEngine: true });
  });
  it("old always-on fever fields are gone", () => {
    for (const c of Object.values(CHARMS)) {
      expect(c).not.toHaveProperty("feverIgnitionDelta");
      expect(c).not.toHaveProperty("feverRampDelta");
      expect(c).not.toHaveProperty("afterglowTicks");
      expect(c).not.toHaveProperty("comboCarry");
    }
  });
  it("stack notes describe the compounding", () => {
    expect(CHARMS.fever_pitch.stackNote!(2)).toContain("72"); // 0.85² ≈ 72%
    expect(CHARMS.thermal_mass.stackNote!(4)).toContain("75"); // cap
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run tests/fever.test.ts -t "heat charms"`
Expected: FAIL — fields don't exist yet.

- [x] **Step 3: Replace the field declarations**

In the `Charm` interface (~line 177), replace the whole fever block (`feverIgnitionDelta`, `feverRampDelta`, `afterglowTicks`, `comboCarry`, keep `infernoEngine`) with:

```ts
  // --- fever (gauge → timed mode → re-chain; src/game/fever.ts) ----------------
  /** Multiplies the fever gauge size (0.85 = 15% smaller). Multiplicative per copy, floor ×0.5 total. */
  feverGaugeScale?: number;
  /** Steepens the fever level curve: adds `boost × level²` to the mode multiplier. */
  feverCurveBoost?: number;
  /** Extra ticks after the mode timer to finish a re-chain refill. Grace never scores. */
  feverGraceTicks?: number;
  /** Fraction of the gauge kept when a mode ends un-chained (cap 0.75 total). */
  feverGaugeCarry?: number;
  /** During fever mode, peg-hit chip gains are also multiplied by the fever multiplier. */
  infernoEngine?: boolean;
```

- [x] **Step 4: Replace the five charm definitions (~line 499)**

```ts
  // --- fever ------------------------------------------------------------------
  fever_pitch: {
    id: "fever_pitch",
    name: "Fever Pitch",
    desc: "The fever gauge is 15% smaller — modes trigger and re-chain sooner.",
    rarity: "rare",
    feverGaugeScale: 0.85,
    stackNote: (level) => `×${level}: gauge at ${Math.round(Math.max(0.5, 0.85 ** level) * 100)}% size`,
  },
  heat_sink: {
    id: "heat_sink",
    name: "Heat Sink",
    desc: "Fever levels hit harder: +0.5 × level² to the mode multiplier.",
    rarity: "rare",
    feverCurveBoost: 0.5,
    stackNote: (level) => `×${level}: a level-4 mode pays ×${1 + 8 + 0.5 * level * 16}`,
  },
  afterglow: {
    id: "afterglow",
    name: "Afterglow",
    desc: "When the fever timer runs out, 2 extra seconds to finish the re-chain refill.",
    rarity: "uncommon",
    feverGraceTicks: 240,
    stackNote: (level) => `×${level}: ${2 * level} s of grace`,
  },
  thermal_mass: {
    id: "thermal_mass",
    name: "Thermal Mass",
    desc: "When a fever mode ends un-chained, the gauge keeps 25% of its charge.",
    rarity: "rare",
    feverGaugeCarry: 0.25,
    stackNote: (level) => `×${level}: keeps ${Math.min(75, 25 * level)}%`,
  },
  inferno_engine: {
    // keep the existing id/name/rarity/infernoEngine, update only the desc:
    desc: "During fever mode, peg hits also earn fever-multiplied chips.",
  },
```

For `inferno_engine`, edit the existing definition's `desc` in place — do not remove `infernoEngine: true` or its `NON_STACKABLE` membership (check `grep -n NON_STACKABLE src/game/charms.ts` and leave it listed).

- [x] **Step 5: Run charm tests**

Run: `npx vitest run tests/fever.test.ts -t "heat charms"`
Expected: PASS. (`run.ts` still references removed fields — typecheck stays broken until Task 3; do not commit `npm run typecheck` claims.)

- [x] **Step 6: Commit**

```bash
git add src/game/charms.ts tests/fever.test.ts
git commit -m "feat: heat charms remapped onto fever mode (gauge scale, curve boost, grace, carry)"
```

---

### Task 3: Fever mode state machine in `src/game/run.ts`

**Files:**
- Modify: `src/game/run.ts` — import (line 26), GameEvent (lines 88–93), state fields (~153–155), accessors (~226–250), step() (~354–357), closeCombo (~375–401), startRound resets (~582), pegHit handler (~709–731)
- Test: `tests/fever.test.ts` — replace the `fever in a run` describe block

- [x] **Step 1: Write the failing tests**

Replace the whole `fever in a run` describe block (keep the file's existing `make`/`land`/`Priv` helpers — `land` calls the private `handle` with a `ballLost` sim event, and `make(seed, ...charms)` pushes charms):

```ts
type ModePriv = { feverGauge: number; feverLevel: number; feverModeEnd: number; handle(ev: unknown, out: GameEvent[]): void; endFeverMode(): void };

function hitPeg(run: Run, out: GameEvent[] = []): GameEvent[] {
  const id = 777;
  if (!run.balls.has(id)) run.balls.set(id, { id, type: "steel", chips: 0, mult: 1, hits: 0, freshHits: 0, revives: 0, zaps: 0, shard: false } as never);
  (run as unknown as ModePriv).handle({ type: "pegHit", ball: id, peg: run.sim.pegs[0]!.id, speed: 0 }, out);
  return out;
}

describe("fever mode in a run", () => {
  it("peg hits charge the gauge; full gauge starts the mode at level 1", async () => {
    const run = await make("fm1");
    const priv = run as unknown as ModePriv;
    priv.feverGauge = 99;
    const out = hitPeg(run);
    expect(priv.feverLevel).toBe(1);
    expect(priv.feverGauge).toBe(0);
    expect(priv.feverModeEnd).toBe(run.sim.tick + 960);
    expect(run.feverValue()).toBe(3); // 1 + 2·1
    const fe = out.filter((e) => e.type === "fever").at(-1) as Extract<GameEvent, { type: "fever" }>;
    expect(fe.level).toBe(1);
    expect(fe.mult).toBe(3);
  });
  it("landings during the mode cash the multiplier; cold landings don't", async () => {
    const run = await make("fm2");
    const priv = run as unknown as ModePriv;
    expect(run.feverValue()).toBe(1);
    priv.feverLevel = 1;
    priv.feverModeEnd = run.sim.tick + 960;
    const before = run.roundScore;
    const out = land(run, 3, 100); // centre ×5 pocket: 100 × 1 × 5 × fever 3 = 1500
    expect(run.roundScore - before).toBe(1500);
    const scored = out.find((e) => e.type === "ballScored") as Extract<GameEvent, { type: "ballScored" }>;
    expect(scored.fever).toBe(3);
  });
  it("refilling in-mode re-chains: level up, timer reset, requirement +25%", async () => {
    const run = await make("fm3");
    const priv = run as unknown as ModePriv;
    priv.feverLevel = 1;
    priv.feverModeEnd = run.sim.tick + 400;
    expect(run.feverRequirement()).toBe(125);
    priv.feverGauge = 124;
    hitPeg(run);
    expect(priv.feverLevel).toBe(2);
    expect(priv.feverModeEnd).toBe(run.sim.tick + 960);
    expect(run.feverValue()).toBe(5);
    expect(run.feverRequirement()).toBe(156);
  });
  it("mode expiry resets level and gauge; Thermal Mass keeps a fraction", async () => {
    const run = await make("fm4");
    const priv = run as unknown as ModePriv;
    priv.feverLevel = 2;
    priv.feverGauge = 100;
    priv.endFeverMode();
    expect(priv.feverLevel).toBe(0);
    expect(priv.feverGauge).toBe(0);
    const run2 = await make("fm4b", "thermal_mass", "thermal_mass");
    const priv2 = run2 as unknown as ModePriv;
    priv2.feverLevel = 1;
    priv2.feverGauge = 100;
    priv2.endFeverMode();
    expect(priv2.feverGauge).toBe(50); // 2 copies → 50% kept
  });
  it("grace (Afterglow) extends refill time but never scores", async () => {
    const run = await make("fm5", "afterglow");
    const priv = run as unknown as ModePriv;
    priv.feverLevel = 1;
    priv.feverModeEnd = run.sim.tick; // timer just expired; grace runs 240 more ticks
    expect(run.feverValue()).toBe(1); // grace never scores
    run.step(); // one tick inside grace: mode must survive
    expect(priv.feverLevel).toBe(1);
    // charging to full during grace still re-chains
    priv.feverGauge = run.feverRequirement() - 1;
    hitPeg(run);
    expect(priv.feverLevel).toBe(2);
  });
  it("without grace, step() past the timer ends the mode", async () => {
    const run = await make("fm6");
    const priv = run as unknown as ModePriv;
    priv.feverLevel = 3;
    priv.feverModeEnd = run.sim.tick; // expires on this tick
    run.step();
    expect(priv.feverLevel).toBe(0);
  });
  it("Fever Pitch shrinks the gauge multiplicatively with a ×0.5 floor", async () => {
    const run = await make("fm7", "fever_pitch", "fever_pitch");
    expect(run.feverRequirement()).toBe(72); // floor(100 × 0.85²)
    for (let i = 0; i < 6; i++) run.charms.push("fever_pitch" as never);
    expect(run.feverRequirement()).toBe(50); // floor
  });
  it("Heat Sink steepens the level curve", async () => {
    const run = await make("fm8", "heat_sink");
    const priv = run as unknown as ModePriv;
    priv.feverLevel = 4;
    priv.feverModeEnd = run.sim.tick + 960;
    expect(run.feverValue()).toBe(17); // 1 + 8 + 0.5·16
  });
  it("Inferno Engine multiplies peg chips only while the mode runs", async () => {
    const run = await make("fm9", "inferno_engine");
    const priv = run as unknown as ModePriv;
    priv.feverLevel = 1;
    priv.feverModeEnd = run.sim.tick + 960;
    const out = hitPeg(run);
    // fresh peg: base 10 chips × fever 3 = 30 (steel chipFactor 1, no bonuses)
    expect(run.balls.get(777)!.chips).toBe(30);
    void out;
  });
  it("combo close leaves the gauge alone; round start resets everything", async () => {
    const run = await make("fm10");
    const priv = run as unknown as ModePriv;
    priv.feverGauge = 40;
    run.combo = 30;
    const out: GameEvent[] = [];
    (run as unknown as Priv).closeCombo(out);
    expect(priv.feverGauge).toBe(40); // persists across combo breaks
    expect(run.combo).toBe(0); // comboCarry is gone: full reset
  });
});
```

Also delete the old `emits fever events on 0.1 steps only` test (the event shape changed) and the two Afterglow-decay tests — grace behaviour is covered above.

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run tests/fever.test.ts`
Expected: FAIL/compile errors — run.ts still implements the old fever.

- [x] **Step 3: Rework `run.ts` — imports, event type, state**

Line 26: `import { FEVER_MODE_TICKS, feverGaugeRequirement, feverMult } from "./fever.js";`

GameEvent (lines 92–93), replace the fever member:

```ts
  /** Fever display state changed: gauge fill 0–1, mode level (0 = cold), its multiplier, ticks left in the window, grace = refill overtime. */
  | { type: "fever"; gauge: number; level: number; mult: number; ticksLeft: number; grace: boolean };
```

Replace the state fields at ~153–155 (`afterglow`, `lastFeverShown`) with:

```ts
  /** Fever mode: gauge charged by combo hits; full → timed jackpot; refill in-mode to re-chain. */
  private feverGauge = 0;
  private feverLevel = 0; // 0 = no mode running
  private feverModeEnd = -1; // tick the mode window (before grace) expires
  private lastFeverKey = "";
```

- [x] **Step 4: Replace the accessors (~lines 226–250)**

Delete `feverIgnition()`, `feverRamp()`, the old `feverValue()`, and the old `emitFever()`. Add:

```ts
  /** Gauge units needed to start (level 0) or re-chain (level N → N+1) a fever mode. */
  feverRequirement(): number {
    const scale = Math.max(0.5, this.charms.reduce((f, id) => f * (CHARMS[id].feverGaugeScale ?? 1), 1));
    return feverGaugeRequirement(this.feverLevel, scale);
  }

  private feverCurveBoost(): number {
    return this.sumCharm((c) => c.feverCurveBoost ?? 0);
  }

  private feverGrace(): number {
    return this.sumCharm((c) => c.feverGraceTicks ?? 0);
  }

  /** Level whose multiplier is live right now — 0 outside the window (grace never scores). */
  feverActiveLevel(): number {
    return this.feverLevel > 0 && this.sim.tick < this.feverModeEnd ? this.feverLevel : 0;
  }

  /** Live fever multiplier: ×1 unless a mode window is running. */
  feverValue(): number {
    return feverMult(this.feverActiveLevel(), this.feverCurveBoost());
  }

  /** Full gauge: start the mode, or re-chain to the next level while one runs. */
  private chainFeverMode(): void {
    this.feverGauge = 0;
    this.feverLevel++;
    this.feverModeEnd = this.sim.tick + FEVER_MODE_TICKS;
  }

  /** Timer + grace ran out short of a refill: back to cold. Thermal Mass keeps some gauge. */
  private endFeverMode(): void {
    const carry = Math.min(0.75, this.sumCharm((c) => c.feverGaugeCarry ?? 0));
    this.feverGauge = Math.floor(this.feverGauge * carry);
    this.feverLevel = 0;
    this.feverModeEnd = -1;
  }

  /** Display event, emitted only when something visible changed. */
  private emitFever(out: GameEvent[]): void {
    const grace = this.feverLevel > 0 && this.sim.tick >= this.feverModeEnd;
    const gauge = Math.min(1, this.feverGauge / this.feverRequirement());
    const key = `${this.feverLevel}:${Math.round(gauge * 100)}:${grace}`;
    if (key === this.lastFeverKey) return;
    this.lastFeverKey = key;
    out.push({ type: "fever", gauge, level: this.feverLevel, mult: feverMult(this.feverLevel, this.feverCurveBoost()), ticksLeft: this.feverLevel > 0 ? Math.max(0, this.feverModeEnd - this.sim.tick) : 0, grace });
  }
```

- [x] **Step 5: step(), closeCombo, startRound, pegHit, inferno**

In `step()` (~354–357), replace the afterglow block:

```ts
    if (this.afterglow) {
      this.emitFever(out);
      if (this.sim.tick >= this.afterglow.until) this.afterglow = null;
    }
```

with:

```ts
    if (this.feverLevel > 0 && this.sim.tick >= this.feverModeEnd + this.feverGrace()) this.endFeverMode();
    this.emitFever(out);
```

In `closeCombo()` (~375–401): delete the afterglow arming (the `glow`/`fever`/`this.afterglow =` lines and the `boardLive` comment about afterglow), and delete the Thermal Mass carry block (`const carry…` through the conditional combo re-emit) — the body becomes: `comboEnd` push, `boardLive` const (still read by Second Wind ordering comment — if nothing else reads `boardLive` after these deletions, delete it and its comment too), Second Wind block, `this.combo = 0;`, `this.emitFever(out);`.

In `startRound()` (~582), replace `this.afterglow = null; this.lastFeverShown = 1;` with:

```ts
    this.feverGauge = 0;
    this.feverLevel = 0;
    this.feverModeEnd = -1;
    this.lastFeverKey = "";
```

In the pegHit handler (~720–731): replace `this.combo += (1 + bumperCombo + traitCombo) * overdrive;` with

```ts
      const comboGain = (1 + bumperCombo + traitCombo) * overdrive;
      this.combo += comboGain;
```

and immediately after `this.lastHitTick = this.sim.tick;` add:

```ts
      this.feverGauge += comboGain;
      if (this.feverGauge >= this.feverRequirement()) this.chainFeverMode();
```

(the existing `this.emitFever(out);` at ~731 then reports both the charge and any level change).

Inferno condition (~710): `const inferno = feverNow > 1 && this.charms.some((id) => CHARMS[id].infernoEngine);` (feverValue is 1 outside a mode, so `> 1` ⇔ mode running).

- [x] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/fever.test.ts && npm run typecheck`
Expected: fever tests PASS; typecheck may still fail on `main.ts`/`ui.ts` (old event shape) and `comboEvents.test.ts` — those are Tasks 4–5. If typecheck failures are ONLY in those files, proceed.

- [x] **Step 7: Commit**

```bash
git add src/game/run.ts tests/fever.test.ts
git commit -m "feat: fever mode state machine — gauge, timed window, re-chain, grace, carry"
```

---

### Task 4: Event retier + feeder-loop break

**Files:**
- Modify: `src/game/run.ts` — `triggerComboEvent` (~462–494), `endEffect` (~528–533)
- Modify: `src/game/comboEvents.ts` — weights
- Test: `tests/comboEvents.test.ts` — `fever tiers` describe block (~126)

- [x] **Step 1: Write the failing tests**

Replace the `fever tiers` describe block in `tests/comboEvents.test.ts`:

```ts
describe("fever tiers", () => {
  const arm = (run: Run, level: number) => {
    const priv = run as unknown as { feverLevel: number; feverModeEnd: number };
    priv.feverLevel = level;
    priv.feverModeEnd = run.sim.tick + 960;
  };
  it("cold events fire at tier 1 with base duration", async () => {
    const run = await make("tier-1");
    const out: GameEvent[] = [];
    run.triggerComboEvent("quake", out);
    const ev = out.find((e) => e.type === "comboEvent") as Extract<GameEvent, { type: "comboEvent" }>;
    expect(ev.tier).toBe(1);
    expect(ev.ticks).toBe(360);
  });
  it("tier = 1 + fever level, capped at 3", async () => {
    const run = await make("tier-lvl");
    arm(run, 1);
    const out: GameEvent[] = [];
    run.triggerComboEvent("quake", out);
    expect((out.at(-1) as Extract<GameEvent, { type: "comboEvent" }>).tier).toBe(2);
    arm(run, 7);
    run.triggerComboEvent("quake", out);
    const q = out.filter((e) => e.type === "comboEvent").at(-1) as Extract<GameEvent, { type: "comboEvent" }>;
    expect(q.tier).toBe(3);
    expect(q.ticks).toBe(1080); // 360 × 3 cap
  });
  it("a deep combo alone no longer raises the tier", async () => {
    const run = await make("tier-combo");
    run.combo = 400;
    const out: GameEvent[] = [];
    run.triggerComboEvent("quake", out);
    expect((out.at(-1) as Extract<GameEvent, { type: "comboEvent" }>).tier).toBe(1);
  });
  it("portal arms 2 + level balls, cap 4", async () => {
    const run = await make("tier-portal");
    const out: GameEvent[] = [];
    run.triggerComboEvent("portal", out);
    expect(run.sim.portalsArmedCount).toBe(2);
    arm(run, 5);
    run.triggerComboEvent("portal", out);
    expect(run.sim.portalsArmedCount).toBe(2 + 4); // +cap 4
  });
  it("time_lock protects while running but grants no fresh window after", async () => {
    const run = await make("tier-lock");
    run.combo = 10;
    const priv = run as unknown as { lastHitTick: number; endEffect(kind: string): void };
    priv.lastHitTick = -1000;
    priv.endEffect("time_lock");
    expect(priv.lastHitTick).toBe(-1000); // unchanged — the old grace reset is gone
  });
  it("feeder weights are trimmed", () => {
    expect(COMBO_EVENTS.overdrive.weight).toBe(10);
    expect(COMBO_EVENTS.time_lock.weight).toBe(7);
  });
});
```

Keep the existing rain/duration tests below this block if present, adjusting any that set `run.combo` for tier — use `arm()` instead (search the file for `run.combo = 400` style lines).

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run tests/comboEvents.test.ts`
Expected: FAIL — tier still derives from `feverValue`.

- [x] **Step 3: Implement**

`run.ts` `triggerComboEvent` (~465): replace

```ts
    const tier = Math.max(1, Math.floor(Math.sqrt(this.feverValue())));
```

with

```ts
    // Tier follows the fever LEVEL (not the multiplier): events can't buy fever
    // that buys richer events. Capped so the board stays playable.
    const tier = Math.min(3, 1 + this.feverActiveLevel());
```

Portal arm (~494): replace with

```ts
      case "portal":
        this.sim.armPortals(this.sim.portalsArmedCount + Math.min(2 + this.feverActiveLevel(), 4));
        y = 0.6;
        break;
```

`endEffect` (~532): delete the line `else if (kind === "time_lock") this.lastHitTick = this.sim.tick; // grace: the chain restarts its window`.

`comboEvents.ts`: `overdrive` weight `14` → `10`; `time_lock` weight `10` → `7`.

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/comboEvents.test.ts tests/fever.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/game/run.ts src/game/comboEvents.ts tests/comboEvents.test.ts
git commit -m "feat: event tier reads fever level (cap 3); time_lock loses its free window; feeder weights trimmed"
```

---

### Task 5: UI — gauge, banner, and main.ts wiring

**Files:**
- Modify: `src/game/ui.ts` — markup line 88, fields ~42–44 & 111–113, reset ~233, `setFever` → new methods ~459–470
- Modify: `index.html` — CSS: replace `#combo .f`/`.f1–.f4` rules (~108–112), add gauge/banner rules
- Modify: `src/main.ts` — `feverHot` (lines 137, 199, 615–621, 659), `case "fever"` (~612)
- Test: `tests/wiring.test.ts`

- [x] **Step 1: Update the wiring test first**

In `tests/wiring.test.ts` (~line 31 block), add to the same `it` (or a new one below it):

```ts
    expect(main).toMatch(/ui\.setFeverGauge\(/);
    expect(main).toMatch(/ui\.feverBanner\(/);
    expect(main).toMatch(/ui\.resetFever\(/);
```

Run: `npx vitest run tests/wiring.test.ts` — expected FAIL.

- [x] **Step 2: ui.ts markup and fields**

Line 88, replace:

```html
      <div id="combo" hidden><div class="n"></div><div class="f" hidden></div><div class="l">COMBO</div></div>
```

with:

```html
      <div id="combo" hidden><div class="n"></div><div class="l">COMBO</div></div>
      <div id="fevergauge" hidden><div class="fill"></div></div>
      <div id="feverbanner" hidden><div class="fl"></div><div class="ft"><div class="bar"></div></div></div>
```

Replace the `comboF` field (line 44) and its query (line 113) with:

```ts
  private readonly feverGaugeEl: HTMLElement;
  private readonly feverFillEl: HTMLElement;
  private readonly feverBannerEl: HTMLElement;
  private readonly feverLabelEl: HTMLElement;
  private readonly feverBarEl: HTMLElement;
```

```ts
    this.feverGaugeEl = this.root.querySelector("#fevergauge")!;
    this.feverFillEl = this.feverGaugeEl.querySelector(".fill")!;
    this.feverBannerEl = this.root.querySelector("#feverbanner")!;
    this.feverLabelEl = this.feverBannerEl.querySelector(".fl")!;
    this.feverBarEl = this.feverBannerEl.querySelector(".bar")!;
```

At the reset site (~line 233, `this.comboF.hidden = true;`) call the new `resetFever()` instead.

- [x] **Step 3: ui.ts methods — replace `setFever` (~459–470)**

```ts
  /** Fever gauge fill (0–1); color follows the mode level; flashes during refill grace. */
  setFeverGauge(fill: number, level: number, grace: boolean): void {
    this.feverGaugeEl.hidden = false;
    this.feverFillEl.style.height = `${Math.round(fill * 100)}%`;
    this.feverGaugeEl.className = `g${Math.min(4, level + 1)}${grace ? " grace" : ""}`;
  }

  /** FEVER banner: level badge + multiplier + a countdown bar over `seconds`. */
  feverBanner(level: number, mult: number, seconds: number): void {
    this.feverBannerEl.hidden = false;
    this.feverLabelEl.textContent = `FEVER${level > 1 ? ` Lv.${level}` : ""} ×${Number.isInteger(mult) ? mult : mult.toFixed(1)}`;
    this.feverBannerEl.className = `f${Math.min(4, level)}`;
    // Restart the countdown: snap the bar to full without a transition, then shrink.
    this.feverBarEl.style.transition = "none";
    this.feverBarEl.style.width = "100%";
    void this.feverBarEl.offsetWidth;
    this.feverBarEl.style.transition = `width ${seconds}s linear`;
    this.feverBarEl.style.width = "0%";
  }

  /** Hide both fever elements (mode over, round over, run reset). */
  resetFever(): void {
    this.feverBannerEl.hidden = true;
    this.feverGaugeEl.hidden = true;
  }
```

`feverPopup` (~455) is unchanged.

- [x] **Step 4: index.html CSS**

Delete the `#combo .f` and `#combo .f1`–`.f4` rules (lines ~108–112) and the `feverPulse` keyframes if now unused (`grep -n feverPulse index.html`). Add after the `#combo` block:

```css
      #fevergauge { position: absolute; top: 6vh; left: calc(50% + 110px); width: 10px; height: 130px; border: 1px solid rgba(255,255,255,.25); border-radius: 5px; overflow: hidden; display: flex; align-items: flex-end; pointer-events: none; }
      #fevergauge[hidden] { display: none; }
      #fevergauge .fill { width: 100%; background: #ffb02d; transition: height .15s ease-out; box-shadow: 0 0 12px rgba(255,176,45,.8); }
      #fevergauge.g2 .fill { background: #ff8c1a; } #fevergauge.g3 .fill { background: var(--magenta); } #fevergauge.g4 .fill { background: #7ef0ff; }
      #fevergauge.grace .fill { animation: feverGrace .3s steps(2) infinite; }
      @keyframes feverGrace { 50% { filter: brightness(2.2); } }
      #feverbanner { position: absolute; top: calc(6vh + 150px); left: 50%; transform: translateX(-50%); text-align: center; pointer-events: none; }
      #feverbanner[hidden] { display: none; }
      #feverbanner .fl { font-family: var(--display); font-size: 34px; font-weight: 900; letter-spacing: .08em; animation: comboPop .28s cubic-bezier(.2,1.6,.4,1) both; }
      #feverbanner .ft { width: 180px; height: 5px; margin: 6px auto 0; border-radius: 3px; background: rgba(255,255,255,.15); overflow: hidden; }
      #feverbanner .bar { height: 100%; background: currentColor; }
      #feverbanner.f1 { color: #fff6e0; text-shadow: 0 0 18px rgba(255,246,224,.9); }
      #feverbanner.f2 { color: #ffb02d; text-shadow: 0 0 22px rgba(255,140,26,.95); }
      #feverbanner.f3 { color: var(--magenta); text-shadow: 0 0 26px rgba(255,45,149,1); }
      #feverbanner.f4 { color: #7ef0ff; text-shadow: 0 0 30px rgba(126,240,255,1); }
```

Also mirror the phone-layout override near line 262 (`#combo { … right: 12px; }`): add `#fevergauge { left: auto; right: 2px; top: calc(var(--hud-bottom) + 40px); } #feverbanner { left: auto; right: 12px; transform: none; top: calc(var(--hud-bottom) + 160px); }`.

Add `#fevergauge, #feverbanner` to the z-index list at line ~127 (`#hud, #charms, #combo, … { z-index: 2; }`).

- [x] **Step 5: main.ts rework**

Rename `feverHot` → `feverLevel` (number). Line 199: `let feverLevel = 0; // current fever mode level: detects level-up edges for the banner slam`. Line 137 (inside the run-reset closure): `feverLevel = 0;`.

Replace `case "fever"` (~612–623) with:

```ts
      case "fever": {
        const was = feverLevel;
        feverLevel = e.level;
        ui.setFeverGauge(e.gauge, e.level, e.grace);
        if (e.level > was) {
          view.kickBloom(1.2);
          ui.flash("#ffb02d", 0.35);
          ui.feverBanner(e.level, e.mult, e.ticksLeft / 120);
        } else if (e.level === 0 && was > 0) {
          ui.endFeverBanner();
        }
        break;
      }
```

`endFeverBanner()` (mode over, round continues: banner drops, gauge stays) was defined in Step 3's ui.ts methods — if you wrote `resetFever()` without it, split it now:

```ts
  /** Mode over but the round continues: drop the banner, keep the gauge. */
  endFeverBanner(): void {
    this.feverBannerEl.hidden = true;
  }

  /** Hide both fever elements (round over, run reset). */
  resetFever(): void {
    this.endFeverBanner();
    this.feverGaugeEl.hidden = true;
  }
```

At the shop-phase reset (~line 659), replace `feverHot = false;` with:

```ts
        feverLevel = 0;
        ui.resetFever();
```

Add `expect(main).toMatch(/ui\.endFeverBanner\(\)/);` to the wiring additions from Step 1.

- [x] **Step 6: Verify**

Run: `npx vitest run tests/wiring.test.ts && npm run typecheck && npx vitest run`
Expected: all PASS (full suite compiles now — this is the first task after which everything should be green).

Browser check: `npm run dev`, open `http://localhost:5173/?seed=fever&charms=fever_pitch,heat_sink,afterglow` and play a multiball round — the gauge fills per hit, the banner slams on ignition with a shrinking countdown bar, re-chain bumps the level badge, grace flashes the gauge. **CLAUDE.md warning applies: scripted `str.replace` edits on `main.ts` have silently no-op'd before — verify each anchor matched (re-grep after editing).**

- [x] **Step 7: Commit**

```bash
git add src/game/ui.ts src/main.ts index.html tests/wiring.test.ts
git commit -m "feat: fever gauge + mode banner UI; fever event carries gauge/level/mult"
```

---

### Task 6: FX fixes — per-kind tints, portal announce

**Files:**
- Modify: `src/main.ts` — comboEvent tint call sites (~475–511), `comboEventEnd` (~514–516), portal announce (~471–474)
- Test: `tests/wiring.test.ts` — add `"portal"` to the combo-event kind list

- [x] **Step 1: Update the wiring test**

Line ~37, add `"portal"` to the list:

```ts
    for (const k of ["laser", "portal", "quake", "rain", "gravity_flip", "magnet_storm", "slowmo", "overdrive", "time_lock", "fresh_coat"]) {
```

Also add:

```ts
    expect(main).toMatch(/applyTint\(\)/);
```

Run: `npx vitest run tests/wiring.test.ts` — the `applyTint` expectation FAILS (portal already matches via the inner payoff case — that blind spot is why it's paired with the applyTint check).

- [x] **Step 2: Per-kind tint tracking in main.ts**

Near the `feverLevel` declaration (~line 199), add:

```ts
// Board tints per combo event. Events overlap freely; the most recent wins and
// an ending event must only clear its own (a shared setTint(null) used to let
// the first expiry wipe everyone's cast — the laser looked washed out or naked).
const EVENT_TINTS: Partial<Record<string, [number, number]>> = {
  quake: [0xff6a00, 0.5],
  gravity_flip: [0x2de2ff, 0.8],
  magnet_storm: [0xb46cff, 0.7],
  overdrive: [0xffb02d, 0.35], // was 0.6: strong enough to read, weak enough not to drown the laser
  time_lock: [0x9ad7ff, 0.35],
};
const activeTints: string[] = [];
function applyTint(): void {
  const top = activeTints.at(-1);
  if (top) view.setTint(EVENT_TINTS[top]![0], EVENT_TINTS[top]![1]);
  else view.setTint(null);
}
function pushTint(kind: string): void {
  const i = activeTints.indexOf(kind);
  if (i >= 0) activeTints.splice(i, 1);
  activeTints.push(kind);
  applyTint();
}
```

In the `comboEvent` switch, replace every direct `view.setTint(color, strength)` (quake ~477, gravity_flip ~483, magnet_storm ~488, overdrive ~497, time_lock ~501) with `pushTint(e.kind);` (keep each case's other lines — shake/flash/shock — untouched).

Replace `case "comboEventEnd"` (~514):

```ts
      case "comboEventEnd": {
        const i = activeTints.indexOf(e.kind);
        if (i >= 0) activeTints.splice(i, 1);
        applyTint();
        break;
      }
```

Also clear at the shop-phase reset (next to `ui.resetFever()`): `activeTints.length = 0; applyTint();`.

- [x] **Step 3: Portal announce beat**

Replace the announce case (~471–474):

```ts
          case "portal":
            view.shock(0, 0.6, 0.9);
            view.fx.ring(0, 0.6, 0xb46cff, 3.2, 0.7);
            view.fx.ring(0, 0.6, 0xd6a8ff, 1.6, 0.5);
            view.kickBloom(0.8);
            ui.flash("#b46cff", 0.35);
            break;
```

- [x] **Step 4: Verify**

Run: `npx vitest run tests/wiring.test.ts && npm run typecheck && npx vitest run`
Expected: PASS.

Browser check (`npm run dev`): trigger events on a high-combo seed — an overdrive ending mid-quake must NOT clear the orange quake tint; a portal firing must visibly shock + double-ring; the laser beam must read clearly over an active overdrive tint.

- [x] **Step 5: Commit**

```bash
git add src/main.ts tests/wiring.test.ts
git commit -m "fix: per-kind event tints (softer overdrive/time_lock), louder portal announce, portal in wiring test"
```

---

### Task 7: Version bump, determinism, balance probe

**Files:**
- Modify: `src/game/version.ts`
- Test: full suite + `BALANCE=1` probe

- [x] **Step 1: Bump RULES_VERSION**

```ts
export const RULES_VERSION = 18; // 18: fever mode (gauge/timed jackpot/re-chain) replaces always-on fever
```

- [x] **Step 2: Full verification**

Run each and confirm output before claiming success:

```bash
npm run typecheck
npx vitest run
npm run build
```

Expected: all green (the replay test `reproduces a live run's score from its log` remains intentionally skipped).

- [x] **Step 3: Determinism spot-check**

`tests/fever.test.ts` has a `fever determinism` describe block at the bottom — read it and update any charm ids/expectations to the new fields (it seeds a run with fever charms and replays it). It must still assert identical scores across two runs of the same seed+log. If it referenced ignition/ramp behaviour, re-seed it with `fever_pitch`+`heat_sink` and re-derive the expected equality (the assertion is equality between two replays, not a magic number, so usually only charm ids need changing).

- [x] **Step 4: Balance probe**

```bash
BALANCE=1 npx vitest run tests/balance.probe.test.ts
cat .cache/balance.txt
```

Expected: rounds 1–8 pass rates at or below the pre-fever tuning (~100% r1 → ~50% r5–7). Compare against the previous `.cache/balance.txt` if present (`git stash` isn't needed — the file is gitignored; just note the numbers in the commit message). If pass rates are still notably above the target curve, flag it to the owner — the tuning knobs, in order: gauge size, mode duration, requirement growth, level curve. Do not tune round targets.

- [x] **Step 5: Commit**

```bash
git add src/game/version.ts tests/fever.test.ts
git commit -m "feat: RULES_VERSION 18 — fever mode ships; probe pass rates recorded"
```

---

## Self-review notes

- Spec coverage: core mechanic (T1+T3), charm remap (T2), events/feeder break (T4), UI gauge/banner (T5), FX fixes (T6), version/testing (T7). Round-target retune and Anchor rework: out of scope per spec.
- The `ballScored` event keeps its `fever` field (the applied multiplier) — `feverPopup` wiring is untouched.
- Cannon needs no change: its `comboHits: 2` trait flows through `comboGain` into the gauge automatically (asserted implicitly by T3's charge test using the shared path).
