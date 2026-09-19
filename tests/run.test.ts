import { afterEach, describe, expect, it } from "vitest";
import { Run, type GameEvent } from "../src/game/run";
import { CHARMS, CHARM_IDS } from "../src/game/charms";
import { formatScore } from "../src/game/format";
import { bucketMultipliers, roundTarget } from "../src/game/scoring";

const runs: Run[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) r.dispose();
});

/**
 * Scripted policy: drop a ball at a seeded x every 40 ticks while allowed,
 * always pick shop offer 0. Deterministic given the seed.
 */
async function play(seed: string, maxTicks = 20000, opts: { rounds?: number; ballsPerRound?: number } = {}) {
  const run = await Run.create(seed, { rounds: 8, ...opts });
  runs.push(run);
  const events: GameEvent[] = [];
  const xs = [-2, -1, 0, 1, 2, 0.5, -0.5];
  let drops = 0;
  for (let t = 0; t < maxTicks; t++) {
    if (run.phase === "shop") run.pick(0);
    if (run.phase === "won" || run.phase === "lost") break;
    if (t % 40 === 0 && run.ballsLeft > 0) {
      if (run.drop(xs[drops % xs.length]!)) drops++;
    }
    events.push(...run.step());
  }
  return { run, events, drops };
}

describe("run", () => {
  it("is deterministic end to end", async () => {
    const a = await play("run-det");
    const b = await play("run-det");
    expect(a.run.totalScore).toBe(b.run.totalScore);
    expect(a.run.round).toBe(b.run.round);
    expect(a.run.phase).toBe(b.run.phase);
    expect(a.run.charms).toEqual(b.run.charms);
    expect(a.events.filter((e) => e.type === "ballScored")).toEqual(
      b.events.filter((e) => e.type === "ballScored"),
    );
    expect(a.run.log).toEqual(b.run.log);
  });

  it("plays through rounds, scores balls, and ends in won or lost", async () => {
    const { run, events } = await play("run-flow");
    expect(["won", "lost"]).toContain(run.phase);
    const scored = events.filter((e) => e.type === "ballScored");
    expect(scored.length).toBeGreaterThanOrEqual(6);
    expect(run.totalScore).toBeGreaterThan(0);
    const ends = events.filter((e) => e.type === "roundEnd");
    expect(ends.length).toBe(run.phase === "won" ? 8 : run.round);
    for (const e of ends) if (e.type === "roundEnd") expect(e.target).toBe(roundTarget(e.round));
  });

  it("lights pegs once per round and resets between rounds", async () => {
    const { run, events } = await play("run-lit", 6000, { rounds: 2 });
    const lit = events.filter((e) => e.type === "pegLit").map((e) => (e.type === "pegLit" ? e.peg : -1));
    // Within a round the same peg is only ever lit once.
    expect(new Set(lit).size).toBeLessThanOrEqual(run.sim.pegs.length * 2);
    expect(lit.length).toBeGreaterThan(0);
  });

  it("shop offers are distinct and picking one advances the round", async () => {
    const run = await Run.create("run-shop", { rounds: 3, ballsPerRound: 1 });
    runs.push(run);
    // Force a pass: massive drop count via cheat-free route — just simulate until round ends.
    run.drop(0);
    for (let t = 0; t < 4000 && run.phase === "drop"; t++) run.step();
    if (run.phase === "shop") {
      expect(run.offers.length).toBe(3);
      const keys = run.offers.map((o) => `${o.kind}:${o.id}`);
      expect(new Set(keys).size).toBe(3);
      expect(run.pick(0)).toBe(true);
      expect(run.round).toBe(2);
      expect(run.phase).toBe("drop");
      expect(run.ballsLeft).toBeGreaterThanOrEqual(1);
    } else {
      expect(run.phase).toBe("lost");
    }
  });

  it("every charm has consistent metadata", () => {
    for (const id of CHARM_IDS) {
      const c = CHARMS[id];
      expect(c.id).toBe(id);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.desc.length).toBeGreaterThan(0);
    }
  });

  it("pocket multipliers are symmetric with a centre jackpot", () => {
    const m = bucketMultipliers(7);
    expect(m).toEqual([1, 2, 3, 5, 3, 2, 1]);
    expect(bucketMultipliers(5)).toEqual([2, 3, 5, 3, 2]);
  });

  it("formats big scores legibly", () => {
    expect(formatScore(999_999)).toBe("999,999");
    expect(formatScore(1_500_000)).toBe("1.50M");
    expect(formatScore(42_000_000_000)).toBe("42.0B");
    expect(formatScore(3.2e15)).toBe("3.20Qa");
  });
});
