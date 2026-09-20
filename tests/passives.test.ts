import { afterEach, describe, expect, it } from "vitest";
import { Run, type GameEvent } from "../src/game/run.js";
import { BALL_IDS, BALL_TYPES, SHOP_BALLS } from "../src/game/balls.js";
import { CHARMS, CHARM_IDS } from "../src/game/charms.js";

const runs: Run[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) r.dispose();
});

async function make(seed: string, opts = {}) {
  const run = await Run.create(seed, opts);
  runs.push(run);
  return run;
}

/** Step until every ball in flight has landed (or `max` ticks). */
function settle(run: Run, max = 4000): GameEvent[] {
  const out: GameEvent[] = [];
  for (let t = 0; t < max && (run.inFlight > 0 || t === 0); t++) out.push(...run.step());
  return out;
}

describe("ball types", () => {
  it("all types have consistent metadata and shop balls exclude steel", () => {
    for (const id of BALL_IDS) expect(BALL_TYPES[id].id).toBe(id);
    expect(SHOP_BALLS).not.toContain("steel");
    expect(SHOP_BALLS.length).toBeGreaterThanOrEqual(10);
  });

  it("twin drops two balls from one bag slot", async () => {
    const run = await make("twin");
    run.bag[0] = "twin";
    const left = run.ballsLeft;
    expect(run.drop(0)).toBe(true);
    expect(run.inFlight).toBe(2);
    expect(run.ballsLeft).toBe(left - 1);
    const tags = run.sim.snapshot().balls.map((b) => b.tag);
    expect(tags).toEqual(["twin", "twin"]);
  });

  it("cannon launches downward, feather floats", async () => {
    const run = await make("cannon");
    run.bag[0] = "cannon";
    run.bag[1] = "feather";
    run.drop(-1);
    run.drop(1);
    run.step();
    const balls = run.sim.snapshot().balls;
    const cannon = balls.find((b) => b.tag === "cannon")!;
    const feather = balls.find((b) => b.tag === "feather")!;
    expect(cannon.vy).toBeLessThan(-6);
    expect(feather.vy).toBeGreaterThan(cannon.vy);
    // Feather must fall slower than a normal ball would over the same time.
    for (let i = 0; i < 30; i++) run.step();
    const f2 = run.sim.snapshot().balls.find((b) => b.tag === "feather")!;
    expect(f2.vy).toBeGreaterThan(-3);
  });

  it("magnet drifts toward the centre", async () => {
    const a = await make("magnet-a");
    a.bag[0] = "magnet";
    a.drop(-2.4);
    for (let i = 0; i < 25; i++) a.step();
    const magnet = a.sim.snapshot().balls[0]!;
    const b = await make("magnet-a");
    b.drop(-2.4);
    for (let i = 0; i < 25; i++) b.step();
    const steel = b.sim.snapshot().balls[0]!;
    expect(magnet.x).toBeGreaterThan(steel.x);
  });

  it("gold adds mult on landing", async () => {
    const run = await make("gold");
    run.bag[0] = "gold";
    run.drop(0);
    const events = settle(run);
    const scored = events.find((e) => e.type === "ballScored");
    expect(scored && scored.type === "ballScored" ? scored.mult : 0).toBeGreaterThanOrEqual(2);
  });
});

describe("passive charms", () => {
  it("every charm has consistent metadata", () => {
    expect(CHARM_IDS.length).toBeGreaterThanOrEqual(25);
    for (const id of CHARM_IDS) expect(CHARMS[id].id).toBe(id);
  });

  it("warm start seeds chips; momentum grows starting mult", async () => {
    const run = await make("warm");
    run.charms.push("warm_start", "warm_start", "momentum");
    run.drop(0);
    const first = [...run.balls.values()][0]!;
    expect(first.chips).toBe(60);
    expect(first.mult).toBe(1);
    settle(run);
    run.drop(0.5);
    const second = [...run.balls.values()][0]!;
    expect(second.mult).toBeCloseTo(1.2);
  });

  it("long fuse and milestone maker change combo parameters", async () => {
    const run = await make("fuse");
    expect(run.comboWindow()).toBe(54);
    expect(run.comboMilestone()).toBe(10);
    run.charms.push("long_fuse", "milestone_maker", "milestone_maker", "milestone_maker");
    expect(run.comboWindow()).toBe(84);
    expect(run.comboMilestone()).toBe(5); // floored
  });

  it("wide net and golden pocket reshape pocket multipliers", async () => {
    const run = await make("pockets");
    run.charms.push("wide_net", "golden_pocket", "jackpot_lens");
    expect(run.pocketMultipliers()).toEqual([4, 3, 4, 12, 4, 3, 4]);
  });

  it("loaded dice and duplicator enlarge the shop", async () => {
    const run = await make("dice");
    run.charms.push("loaded_dice", "duplicator");
    const offers = (run as unknown as { rollOffers(): Array<{ kind: string; count?: number }> }).rollOffers();
    expect(offers).toHaveLength(4);
    for (const o of offers) if (o.kind === "ball") expect(o.count).toBe(3);
  });

  it("insurance replays a failed round instead of losing", async () => {
    // One ball per round against a 400 target almost never passes.
    const run = await make("insure", { ballsPerRound: 1, rounds: 3 });
    run.charms.push("insurance");
    run.drop(2.7);
    const events = settle(run, 6000);
    const retry = events.find((e) => e.type === "retry");
    if (run.roundScore < run.target || retry) {
      expect(retry).toBeDefined();
      expect(run.phase).toBe("drop");
      expect(run.round).toBe(1);
      expect(run.ballsLeft).toBe(1);
      expect(run.retriesLeft()).toBe(0);
    }
  });

  it("compound scales the round score at round end", async () => {
    const run = await make("compound", { ballsPerRound: 1, rounds: 1 });
    run.charms.push("compound", "insurance", "insurance", "insurance");
    run.drop(0);
    let raw = 0;
    const events = settle(run, 6000);
    for (const e of events) if (e.type === "ballScored") raw += e.score;
    // Either the round ended (scaled) or insurance restarted it; both keep totals consistent.
    if (run.phase !== "drop") expect(run.roundScore).toBe(Math.floor(raw * 1.15));
    else expect(run.totalScore).toBe(0);
  });
});

describe("board motion and ball scaling", () => {
  it("adds a ball every three rounds", async () => {
    const run = await make("scale");
    const at = (round: number) => {
      (run as unknown as { round: number }).round = round;
      (run as unknown as { startRound(): void }).startRound();
      return run.ballsLeft;
    };
    expect(at(1)).toBe(6);
    expect(at(3)).toBe(6);
    expect(at(4)).toBe(7);
    expect(at(7)).toBe(8);
    expect(at(10)).toBe(9);
  });

  it("drift moves pegs deterministically and Restless Board keeps them moving", async () => {
    const a = await make("drift-a");
    a.charms.push("drift");
    (a as unknown as { startRound(): void }).startRound();
    expect(a.sim.pegMotion).not.toBeNull();
    for (let i = 0; i < 60; i++) a.step();
    const offA = a.sim.snapshot().pegOffsets!;
    expect(Math.max(...offA.map(Math.abs))).toBeGreaterThan(0.1);
    // Alternating rows move in opposite directions.
    expect(Math.sign(offA[0]!)).not.toBe(Math.sign(offA[a.sim.config.pegCols]!));
    const b = await make("drift-a");
    b.charms.push("drift");
    (b as unknown as { startRound(): void }).startRound();
    for (let i = 0; i < 60; i++) b.step();
    expect(Array.from(b.sim.snapshot().pegOffsets!)).toEqual(Array.from(offA));
    // Pegs never leave the walls.
    for (let i = 0; i < a.sim.pegs.length; i++) {
      expect(Math.abs(a.sim.pegPosition(i).x)).toBeLessThan(a.sim.config.width / 2 - 0.2);
    }
    // Motion stops when the charm is gone.
    a.charms.length = 0;
    (a as unknown as { startRound(): void }).startRound();
    expect(a.sim.pegMotion).toBeNull();
    expect(a.sim.snapshot().pegOffsets).toBeUndefined();
  });
});
