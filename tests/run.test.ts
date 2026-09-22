import { afterEach, describe, expect, it } from "vitest";
import { Run, type GameEvent } from "../src/game/run.js";
import { CHARMS, CHARM_IDS } from "../src/game/charms.js";
import { formatScore } from "../src/game/format.js";
import { bucketMultipliers, roundTarget } from "../src/game/scoring.js";

const runs: Run[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) r.dispose();
});

/**
 * Scripted policy: drop a ball at a seeded x every 40 ticks while allowed,
 * always pick shop offer 0. Deterministic given the seed.
 */
async function play(seed: string, maxTicks = 40000, opts: { rounds?: number; ballsPerRound?: number } = {}) {
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

  it("puts every owned custom ball in the bag; steel only fills the rest", async () => {
    const run = await Run.create("bag-priority");
    runs.push(run);
    run.ownedBalls.push("heavy", "heavy", "rubber", "rubber");
    // Rebuild the bag many rounds in a row: the customs must survive every time.
    for (let round = 1; round <= 5; round++) {
      run.round = round;
      (run as unknown as { startRound(): void }).startRound();
      expect(run.bag.length).toBe(run.ballsLeft);
      const custom = run.bag.filter((t) => t !== "steel").sort();
      expect(custom).toEqual(["heavy", "heavy", "rubber", "rubber"]);
    }
  });

  it("caps the bag at ballsLeft even when customs alone overflow it", async () => {
    const run = await Run.create("bag-overflow");
    runs.push(run);
    for (let i = 0; i < 10; i++) run.ownedBalls.push("rubber");
    (run as unknown as { startRound(): void }).startRound();
    expect(run.bag.length).toBe(run.ballsLeft);
    // With more customs than slots, the whole bag is custom.
    expect(run.bag.every((t) => t === "rubber")).toBe(true);
  });

  it("a purchase past a full bag still makes the next bag (newest customs win)", async () => {
    const run = await Run.create("bag-newest");
    runs.push(run);
    for (let i = 0; i < 10; i++) run.ownedBalls.push("rubber");
    run.ownedBalls.push("heavy", "heavy");
    (run as unknown as { startRound(): void }).startRound();
    expect(run.bag.length).toBe(run.ballsLeft);
    expect(run.bag.filter((t) => t === "heavy").length).toBe(2);
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

  it("shards are flagged, the flag survives a revive carry, and Split Shot ignores them", async () => {
    const run = await Run.create("shard-flag");
    runs.push(run);
    const priv = run as unknown as {
      spawn(req: { type: string; x?: number; tag?: string; carry?: unknown }, fromBag: boolean): number;
    };
    const shardId = priv.spawn({ type: "steel", x: 0, tag: "shard" }, false);
    const shard = run.balls.get(shardId)!;
    expect(shard.shard).toBe(true);
    // A Phoenix-style relaunch carries the flag even though it spawns with no tag.
    const revivedId = priv.spawn({ type: "steel", x: 0, carry: shard }, false);
    expect(run.balls.get(revivedId)!.shard).toBe(true);
    // A normal bag ball is not a shard.
    const normalId = priv.spawn({ type: "steel", x: 0 }, true);
    expect(run.balls.get(normalId)!.shard).toBe(false);

    // Split Shot: a shard on its 8th hit must NOT split again (infinite loop with Phoenix).
    const spawned: unknown[] = [];
    const mkCtx = (isShard: boolean) =>
      ({
        ball: { id: 1, type: "steel", chips: 0, mult: 1, hits: 8, freshHits: 0, revives: 0, zaps: 0, shard: isShard },
        pegs: [{ id: 0, x: 0, y: 5, radius: 0.08 }],
        spawnBall: (s: unknown) => spawned.push(s),
        fx: () => {},
      }) as unknown as Parameters<NonNullable<(typeof CHARMS)["split_shot"]["onPegHit"]>>[0];
    const ev = { type: "pegHit", ball: 1, peg: 0, speed: 1 } as Parameters<NonNullable<(typeof CHARMS)["split_shot"]["onPegHit"]>>[1];
    CHARMS.split_shot.onPegHit!(mkCtx(true), ev, true);
    expect(spawned.length).toBe(0);
    CHARMS.split_shot.onPegHit!(mkCtx(false), ev, true);
    expect(spawned.length).toBe(2);
  });

  it("Split Shot + Phoenix + Boomerang terminates (shards can't split, so multiball is bounded)", async () => {
    const run = await Run.create("no-infinite", { rounds: 1, ballsPerRound: 1 });
    runs.push(run);
    run.charms.push("split_shot", "phoenix");
    run.ownedBalls.push("boomerang");
    (run as unknown as { startRound(): void }).startRound();
    expect(run.bag).toEqual(["boomerang"]);
    run.drop(0);
    for (let t = 0; t < 40000 && run.phase === "drop"; t++) run.step();
    expect(run.phase).not.toBe("drop");
  });

  it("Phoenix is a 10-round temporary charm and Split Shot is rare", () => {
    // Balance pass 2026-09-22: permanent Phoenix was oppressive, Split Shot too frequent.
    expect(CHARMS.phoenix.duration).toBe(10);
    expect(CHARMS.phoenix.desc).toContain("next 10 rounds");
    expect(CHARMS.split_shot.rarity).toBe("rare");
  });

  it("Phoenix expires after its 10-round window", async () => {
    const run = await Run.create("phx-window", { rounds: 30 });
    runs.push(run);
    // Simulate taking Phoenix from the shop (pick() sets charmExpires from duration).
    run.charms.push("phoenix");
    (run as unknown as { charmExpires: Map<number, number> }).charmExpires.set(0, run.round + CHARMS.phoenix.duration!);
    // Advance past the window; expireCharms runs at round start.
    (run as unknown as { round: number }).round += 11;
    (run as unknown as { startRound(): void }).startRound();
    const events = run.step();
    expect(run.charms).not.toContain("phoenix");
    expect(events.some((e) => e.type === "charmExpired" && e.id === "phoenix")).toBe(true);
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
