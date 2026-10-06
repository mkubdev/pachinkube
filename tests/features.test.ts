import { describe, expect, it } from "vitest";
import { FEATURE_ANCHORS, FEATURE_SHAPES, FEATURE_CLEARANCE, FEATURE_RESTITUTION } from "../src/sim/types.js";
import { Sim } from "../src/sim/world.js";

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
      expect(a.y).toBeGreaterThan(0.12);
      expect(a.y).toBeLessThan(0.6);
    }
  });

  it("clearance leaves room for the widest ball", () => {
    expect(FEATURE_CLEARANCE).toBeGreaterThanOrEqual(0.4);
    expect(FEATURE_RESTITUTION).toBeGreaterThan(0.5);
  });
});

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

import { CHARMS } from "../src/game/charms.js";
import { UNLOCK_RULES } from "../src/game/meta.js";

describe("feature charms", () => {
  it("Target Bank and Drop Target each place one feature and are unlockable", () => {
    expect(CHARMS.target_bank.features).toEqual([{ kind: "target_bank", count: 1 }]);
    expect(CHARMS.drop_target.features).toEqual([{ kind: "drop_target", count: 1 }]);
    expect(CHARMS.target_bank.rarity).toBe("uncommon");
    expect(CHARMS.drop_target.rarity).toBe("uncommon");
    for (const id of ["target_bank", "drop_target"]) {
      expect(UNLOCK_RULES.some((u) => u.kind === "charm" && u.id === id), `${id} unlock`).toBe(true);
    }
  });
});

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

  it("caps placed features at the anchor count and reports the overflow instead of dropping it silently", async () => {
    const requested = ["target_bank", "target_bank", "target_bank", "drop_target", "drop_target", "drop_target"];
    const run = await make("feat-overflow", ...requested);
    expect(run.sim.features).toHaveLength(FEATURE_ANCHORS.length);

    const ann = run.step().find((e) => e.type === "features");
    expect(ann).toBeDefined();
    if (ann?.type === "features") {
      expect(ann.dropped).toBe(requested.length - FEATURE_ANCHORS.length);
      expect(ann.dropped).toBeGreaterThan(0);
    }

    const positions = run.sim.features.map((f) => `${f.x},${f.y}`);
    expect(new Set(positions).size).toBe(positions.length);
  });
});

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
    const st = run.featureState.get(0)!;
    expect(st.done).toBe(false);
    if (st.kind !== "target_bank") throw new Error("expected target_bank state");
    expect(st.lit.size).toBe(0);
  });

  it("two balls alternating on the same bank: completion fires once, mult lands on the completing ball, chips are per-ball", async () => {
    const run = await make("bank-multiball", "target_bank");
    const a = fakeBall(9004);
    const b = fakeBall(9005);
    run.balls.set(a.id, a);
    run.balls.set(b.id, b);
    const out: GameEvent[] = [];
    const hit = (ball: BallScoreState, part: number) =>
      (run as unknown as Priv).handle({ type: "featureHit", ball: ball.id, feature: 0, part, speed: 2 }, out);

    hit(a, 0); // a lights part 0
    hit(b, 1); // b lights part 1
    hit(a, 2); // a lights part 2 and completes the bank

    const done = out.filter((e) => e.type === "featureDone");
    expect(done).toHaveLength(1);
    expect(run.featureState.get(0)!.done).toBe(true);

    // a earned two fresh hits plus the completion bonus; b earned one fresh hit only.
    expect(a.chips).toBe(BANK_CHIPS_FRESH * 2 + BANK_COMPLETE_CHIPS);
    expect(b.chips).toBe(BANK_CHIPS_FRESH);

    // The completion mult landed on a (the ball whose hit completed it), not b.
    expect(a.mult).toBeGreaterThanOrEqual(1 + BANK_COMPLETE_MULT);
    expect(b.mult).toBe(1);

    // The bank is done: further hits from either ball pay nothing more.
    const aChips = a.chips;
    const bChips = b.chips;
    hit(b, 0);
    expect(a.chips).toBe(aChips);
    expect(b.chips).toBe(bChips);
  });
});

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
    const st = run.featureState.get(0)!;
    if (st.kind !== "drop_target") throw new Error("expected drop_target state");
    expect(st.hits).toBe(0);
    expect(st.done).toBe(false);
    // The collider is live again: a ball dropped onto it reports a hit.
    const bar = run.sim.features[0]!.parts[0]!;
    run.sim.spawnBall({ x: bar.x, y: bar.y + 0.6 });
    let hits = 0;
    for (let t = 0; t < 240; t++) for (const e of run.sim.step()) if (e.type === "featureHit") hits++;
    expect(hits).toBeGreaterThan(0);
  });
});
