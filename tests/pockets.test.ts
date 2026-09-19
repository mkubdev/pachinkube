import { afterEach, describe, expect, it } from "vitest";
import { Run, type GameEvent } from "../src/game/run.js";
import { roundTarget } from "../src/game/scoring.js";

const runs: Run[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) r.dispose();
});
type Priv = { startRound(): void; handle(ev: unknown, out: GameEvent[]): void };

async function make(seed: string, ...charms: string[]) {
  const run = await Run.create(seed);
  runs.push(run);
  run.charms.push(...(charms as never[]));
  (run as unknown as Priv).startRound();
  return run;
}

/** Simulate a ball landing in `bucket` without physics. */
function land(run: Run, bucket: number, chips = 100): GameEvent[] {
  const id = 900 + Math.floor(Math.random() * 1e6);
  run.balls.set(id, { id, type: "steel", chips, mult: 1, hits: 1, freshHits: 1, revives: 0, zaps: 0 });
  const out: GameEvent[] = [];
  (run as unknown as Priv).handle({ type: "ballLost", ball: id, bucket }, out);
  return out;
}

describe("pocket charms", () => {
  it("baseline is unchanged", async () => {
    const run = await make("p0");
    expect(run.pocketMultipliers()).toEqual([1, 2, 3, 5, 3, 2, 1]);
  });

  it("hot pocket stacks on the landed pocket up to the cap and resets each round", async () => {
    const run = await make("p1", "hot_pocket");
    for (let i = 0; i < 7; i++) land(run, 2);
    expect(run.pocketMultipliers()[2]).toBe(3 + 5);
    expect(run.pocketMultipliers()[3]).toBe(5);
    (run as unknown as Priv).startRound();
    expect(run.pocketMultipliers()[2]).toBe(3);
  });

  it("roulette rotates the pattern after every landing", async () => {
    const run = await make("p2", "roulette");
    land(run, 0);
    expect(run.pocketMultipliers()).toEqual([1, 1, 2, 3, 5, 3, 2]);
    land(run, 0);
    expect(run.pocketMultipliers()).toEqual([2, 1, 1, 2, 3, 5, 3]);
  });

  it("inversion makes the edges the jackpots", async () => {
    const run = await make("p3", "inversion");
    expect(run.pocketMultipliers()).toEqual([5, 4, 3, 1, 3, 4, 5]);
  });

  it("lottery picks one seeded pocket per round and adds its bonus", async () => {
    const a = await make("p4", "pocket_lottery");
    const b = await make("p4", "pocket_lottery");
    expect(a.lotteryPocketIndex).toBe(b.lotteryPocketIndex);
    expect(a.lotteryPocketIndex).toBeGreaterThanOrEqual(0);
    const base = [1, 2, 3, 5, 3, 2, 1];
    const m = a.pocketMultipliers();
    for (let i = 0; i < 7; i++) expect(m[i]).toBe(base[i]! + (i === a.lotteryPocketIndex ? 3 : 0));
  });

  it("groove multiplies consecutive landings in the same pocket", async () => {
    const run = await make("p5", "groove");
    const first = land(run, 3).find((e) => e.type === "ballScored");
    const second = land(run, 3).find((e) => e.type === "ballScored");
    const third = land(run, 3).find((e) => e.type === "ballScored");
    const other = land(run, 1).find((e) => e.type === "ballScored");
    const mult = (e: GameEvent | undefined) => (e && e.type === "ballScored" ? e.mult : 0);
    expect(mult(first)).toBe(1);
    expect(mult(second)).toBe(1.5);
    expect(mult(third)).toBe(2);
    expect(mult(other)).toBe(1);
  });

  it("jackpot growth follows rounds cleared this run", async () => {
    const run = await make("p6", "jackpot_growth");
    expect(run.pocketMultipliers()[3]).toBe(5);
    (run as unknown as { clearedThisRun: number }).clearedThisRun = 3;
    expect(run.pocketMultipliers()[3]).toBe(8);
  });

  it("pocket changes are announced for the UI", async () => {
    const run = await make("p7", "hot_pocket");
    const out = land(run, 4);
    const ev = out.find((e) => e.type === "pockets");
    expect(ev && ev.type === "pockets" ? ev.mults[4] : 0).toBe(4);
  });
});

describe("target curve", () => {
  it("bends after round 8", () => {
    expect(roundTarget(8)).toBe(Math.floor(800 * 1.58 ** 7));
    expect(roundTarget(10)).toBeLessThan(40_000);
    expect(roundTarget(12)).toBeLessThan(75_000);
    for (let r = 2; r < 20; r++) expect(roundTarget(r)).toBeGreaterThan(roundTarget(r - 1));
  });
});
