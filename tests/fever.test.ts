import { afterEach, describe, expect, it } from "vitest";
import { FEVER_IGNITION, FEVER_RAMP, feverMultiplier } from "../src/game/fever.js";
import { CHARMS } from "../src/game/charms.js";
import { Run, type GameEvent } from "../src/game/run.js";
import { BALL_TYPES } from "../src/game/balls.js";

describe("fever formula", () => {
  it("is ×1 below ignition", () => {
    expect(feverMultiplier(0)).toBe(1);
    expect(feverMultiplier(49)).toBe(1);
  });
  it("ignites at the threshold and grows quadratically", () => {
    expect(feverMultiplier(50)).toBe(1);
    expect(feverMultiplier(100)).toBe(2); // 1 + (50/50)²
    expect(feverMultiplier(150)).toBe(5); // 1 + (100/50)²
    expect(feverMultiplier(400)).toBe(50); // 1 + (350/50)²
  });
  it("respects custom ignition and ramp", () => {
    expect(feverMultiplier(50, 30, 50)).toBeCloseTo(1 + (20 / 50) ** 2);
    expect(feverMultiplier(100, 50, 40)).toBeCloseTo(1 + (50 / 40) ** 2);
  });
  it("exports the tuned defaults", () => {
    expect(FEVER_IGNITION).toBe(50);
    expect(FEVER_RAMP).toBe(50);
  });
});

describe("heat charms", () => {
  it("are defined with the spec'd fields", () => {
    expect(CHARMS.fever_pitch).toMatchObject({ rarity: "rare", feverIgnitionDelta: -10 });
    expect(CHARMS.heat_sink).toMatchObject({ rarity: "rare", feverRampDelta: -10 });
    expect(CHARMS.afterglow).toMatchObject({ rarity: "uncommon", afterglowTicks: 240 });
    expect(CHARMS.thermal_mass).toMatchObject({ rarity: "rare", comboCarry: 0.25 });
    expect(CHARMS.inferno_engine).toMatchObject({ rarity: "legendary", infernoEngine: true });
  });
  it("compounding charms explain their stacks", () => {
    expect(CHARMS.fever_pitch.stackNote!(2)).toContain("30");
    expect(CHARMS.heat_sink.stackNote!(4)).toContain("20"); // floor
    expect(CHARMS.thermal_mass.stackNote!(4)).toContain("75"); // cap
  });
});

const runs: Run[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) r.dispose();
});
type Priv = { startRound(): void; handle(ev: unknown, out: GameEvent[]): void; closeCombo(out: GameEvent[]): void };

async function make(seed: string, ...charms: string[]) {
  const run = await Run.create(seed);
  runs.push(run);
  run.charms.push(...(charms as never[]));
  (run as unknown as Priv).startRound();
  return run;
}

function land(run: Run, bucket: number, chips = 100): GameEvent[] {
  const id = 900 + runs.length * 1000 + Math.floor(run.sim.streams.fx.next() * 100);
  run.balls.set(id, { id, type: "steel", chips, mult: 1, hits: 1, freshHits: 1, revives: 0, zaps: 0, shard: false } as never);
  const out: GameEvent[] = [];
  (run as unknown as Priv).handle({ type: "ballLost", ball: id, bucket }, out);
  return out;
}

describe("fever in a run", () => {
  it("multiplies a landing while the chain is hot", async () => {
    const run = await make("fv1");
    run.combo = 150; // fever ×5
    const before = run.roundScore;
    const out = land(run, 3, 100); // centre ×5 pocket: 100 × 1 × 5 × fever 5 = 2500
    expect(run.roundScore - before).toBe(2500);
    const scored = out.find((e) => e.type === "ballScored") as Extract<GameEvent, { type: "ballScored" }>;
    expect(scored.fever).toBe(5);
  });
  it("is ×1 below ignition and after the combo ends", async () => {
    const run = await make("fv2");
    run.combo = 49;
    expect(run.feverValue()).toBe(1);
    run.combo = 150;
    const out: GameEvent[] = [];
    (run as unknown as Priv).closeCombo(out);
    expect(run.feverValue()).toBe(1);
  });
  it("Fever Pitch and Heat Sink move ignition and ramp with floors", async () => {
    const run = await make("fv3", "fever_pitch", "fever_pitch", "heat_sink");
    expect(run.feverIgnition()).toBe(30);
    expect(run.feverRamp()).toBe(40);
    for (let i = 0; i < 5; i++) run.charms.push("fever_pitch" as never, "heat_sink" as never);
    expect(run.feverIgnition()).toBe(10); // floor
    expect(run.feverRamp()).toBe(20); // floor
  });
  it("Afterglow decays fever linearly after comboEnd", async () => {
    const run = await make("fv4", "afterglow");
    run.combo = 150; // ×5
    const out: GameEvent[] = [];
    (run as unknown as Priv).closeCombo(out);
    expect(run.feverValue()).toBeCloseTo(5); // tick 0 of the decay
    // half-way through 240 ticks the bonus is halved: 1 + 4·0.5 = 3
    (run as unknown as { afterglow: { until: number; ticks: number; from: number } }).afterglow.until = run.sim.tick + 120;
    expect(run.feverValue()).toBeCloseTo(3);
  });
  it("Thermal Mass keeps a quarter of the combo, never on an empty board at round end", async () => {
    const run = await make("fv5", "thermal_mass");
    run.combo = 100;
    const out: GameEvent[] = [];
    (run as unknown as Priv).closeCombo(out);
    expect(run.combo).toBe(25);
    expect(out.some((e) => e.type === "combo" && e.count === 25)).toBe(true);
  });
  it("emits fever events on 0.1 steps only", async () => {
    const run = await make("fv6");
    run.combo = 100;
    const out: GameEvent[] = [];
    (run as unknown as { emitFever(out: GameEvent[]): void }).emitFever(out);
    (run as unknown as { emitFever(out: GameEvent[]): void }).emitFever(out);
    expect(out.filter((e) => e.type === "fever")).toHaveLength(1);
    expect((out[0] as Extract<GameEvent, { type: "fever" }>).value).toBe(2);
  });
  it("Inferno Engine multiplies peg chips while fever ≥ 2", async () => {
    const run = await make("fv7", "inferno_engine");
    run.combo = 100; // fever ×2
    const id = 4242;
    run.balls.set(id, { id, type: "steel", chips: 0, mult: 1, hits: 0, freshHits: 0, revives: 0, zaps: 0, shard: false } as never);
    const peg = run.sim.pegs[0]!;
    const out: GameEvent[] = [];
    (run as unknown as Priv).handle({ type: "pegHit", ball: id, peg: peg.id, speed: 0 }, out);
    // fresh peg: base 10 chips × fever 2 = 20 (steel has chipFactor 1, no bonuses)
    expect(run.balls.get(id)!.chips).toBe(20);
  });
});

describe("fever determinism", () => {
  it("two identical seeded runs with heat charms score identically", async () => {
    const play = async () => {
      const run = await Run.create("fever-replay");
      run.charms.push("fever_pitch" as never, "afterglow" as never, "thermal_mass" as never);
      (run as unknown as Priv).startRound();
      while (run.phase === "drop" && run.ballsLeft > 0) {
        if (!run.drop(0)) break;
        for (let i = 0; i < 2000 && run.sim.ballCount > 0; i++) run.step();
      }
      for (let i = 0; i < 200; i++) run.step(); // let the round close
      expect(run.phase).not.toBe("drop");
      const score = run.totalScore;
      run.dispose();
      return score;
    };
    const a = await play();
    const b = await play();
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
  });
});

describe("cannon rework", () => {
  it("counts double toward the combo and lost its speed chips", () => {
    expect(BALL_TYPES.cannon.traits?.comboHits).toBe(2);
    expect(BALL_TYPES.cannon.traits?.speedChips).toBeUndefined();
    expect(BALL_TYPES.cannon.chipFactor).toBe(0.8);
  });
  it("a cannon peg hit advances the combo by 2", async () => {
    const run = await make("fv-cannon");
    const id = 5151;
    run.balls.set(id, { id, type: "cannon", chips: 0, mult: 1, hits: 0, freshHits: 0, revives: 0, zaps: 0, shard: false } as never);
    const peg = run.sim.pegs[0]!;
    const out: GameEvent[] = [];
    (run as unknown as Priv).handle({ type: "pegHit", ball: id, peg: peg.id, speed: 0 }, out);
    expect(run.combo).toBe(2);
  });
});
