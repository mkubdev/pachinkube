import { afterEach, describe, expect, it } from "vitest";
import { FEVER_GAUGE_BASE, FEVER_MODE_TICKS, feverGaugeRequirement, feverMult } from "../src/game/fever.js";
import { CHARMS } from "../src/game/charms.js";
import { Run, type GameEvent } from "../src/game/run.js";
import { BALL_TYPES } from "../src/game/balls.js";

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
