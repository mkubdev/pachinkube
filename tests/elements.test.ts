import { afterEach, describe, expect, it } from "vitest";
import { ICE_RESTITUTION, react } from "../src/game/elements.js";
import { Run, type GameEvent } from "../src/game/run.js";
import type { BallScoreState } from "../src/game/charms.js";

const runs: Run[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) r.dispose();
});

type Priv = {
  resolveElement(ball: BallScoreState, pegId: number, peg: { x: number; y: number }, fresh: boolean, ctx: unknown, out: GameEvent[]): void;
  ctxFor(ball: BallScoreState, out: GameEvent[]): unknown;
  startRound(): void;
};

async function make(seed: string) {
  const run = await Run.create(seed);
  runs.push(run);
  return run;
}

/** Drive a reaction directly at peg `pegId` with a ball carrying `el`. */
function hit(run: Run, el: "fire" | "ice" | "storm" | null, pegId: number, fresh = true) {
  const ball: BallScoreState = { id: 999, type: "steel", chips: 0, mult: 1, hits: 1, freshHits: 1, revives: 0, zaps: 0, shard: false };
  run.balls.set(ball.id, ball);
  if (el) run.ballElements.set(ball.id, el);
  else run.ballElements.delete(ball.id);
  const out: GameEvent[] = [];
  const priv = run as unknown as Priv;
  const peg = run.sim.pegs[pegId]!;
  priv.resolveElement(ball, pegId, peg, fresh, priv.ctxFor(ball, out), out);
  return { ball, out };
}

describe("reaction table", () => {
  it("resolves every ball × peg combination", () => {
    expect(react("fire", null).kind).toBe("ignite");
    expect(react("ice", null).kind).toBe("freeze");
    expect(react("storm", null).kind).toBe("charge");
    expect(react(null, null).kind).toBe("none");
    expect(react(null, { el: "fire", stacks: 1 }).kind).toBe("burn");
    expect(react("storm", { el: "fire", stacks: 2 })).toEqual({ kind: "wildfire", spread: 5 });
    expect(react("fire", { el: "ice", stacks: 2 })).toMatchObject({ kind: "steam", chips: 80 });
    expect(react("storm", { el: "ice", stacks: 1 }).kind).toBe("shatter_chain");
    expect(react("ice", { el: "ice", stacks: 1 })).toEqual({ kind: "thicken", stacks: 2 });
    expect(react("ice", { el: "ice", stacks: 4 }).kind).toBe("shatter"); // max thickness
    expect(react("fire", { el: "fire", stacks: 1 })).toEqual({ kind: "flare", chipMult: 2.5, spread: 2 });
    expect(react("storm", { el: "storm", stacks: 1 })).toEqual({ kind: "zap", arcs: 4 });
  });
});

describe("elements in a run", () => {
  it("fire ignites, then a neutral ball burns it for bonus chips and spreads", async () => {
    const run = await make("el-fire");
    const a = hit(run, "fire", 20);
    expect(run.pegElements.get(20)?.el).toBe("fire");
    expect(a.out.some((e) => e.type === "element" && e.kind === "ignite")).toBe(true);
    const b = hit(run, null, 20, false);
    expect(b.ball.chips).toBeGreaterThan(0);
    const burn = b.out.find((e) => e.type === "element" && e.kind === "burn");
    expect(burn).toBeDefined();
    expect([...run.pegElements.values()].filter((s) => s.el === "fire").length).toBeGreaterThanOrEqual(1);
  });

  it("fire on ice makes steam: chips, mult, and the peg thaws", async () => {
    const run = await make("el-steam");
    hit(run, "ice", 10);
    expect(run.pegElements.get(10)?.el).toBe("ice");
    const { ball, out } = hit(run, "fire", 10);
    expect(out.some((e) => e.type === "element" && e.kind === "steam")).toBe(true);
    expect(ball.mult).toBe(2);
    expect(ball.chips).toBe(40);
    expect(run.pegElements.has(10)).toBe(false);
  });

  it("storm shatters a whole frozen chain and zaps arcs", async () => {
    const run = await make("el-chain");
    // Freeze three neighbouring pegs on the same row.
    const row = run.sim.pegs.filter((p) => Math.abs(p.y - run.sim.pegs[0]!.y) < 0.05).slice(0, 3);
    for (const p of row) run.pegElements.set(p.id, { el: "ice", stacks: 1 });
    const { ball, out } = hit(run, "storm", row[1]!.id);
    const chain = out.find((e) => e.type === "element" && e.kind === "shatter_chain");
    expect(chain && chain.type === "element" ? chain.count : 0).toBe(3);
    expect(ball.chips).toBe(36);
    expect(run.pegElements.size).toBe(0);
    expect(out.filter((e) => e.type === "zap").length).toBe(2);
  });

  it("frost bite freezes pegs at round start and makes them glassy", async () => {
    const run = await make("el-frost");
    run.charms.push("frost_bite");
    (run as unknown as Priv).startRound();
    const events = run.step();
    const frozen = [...run.pegElements.values()].filter((s) => s.el === "ice");
    expect(frozen).toHaveLength(6);
    expect(events.filter((e) => e.type === "pegElement" && e.el === "ice")).toHaveLength(6);
    expect(ICE_RESTITUTION).toBeGreaterThan(run.sim.config.restitution);
  });

  it("temporary charms imbue balls and expire after their duration", async () => {
    const run = await make("el-temp", );
    // Simulate taking Firestorm from the shop after round 1.
    run.charms.push("firestorm");
    (run as unknown as { charmExpires: Map<number, number> }).charmExpires.set(0, run.round + 3);
    expect(run.activeElement()).toBe("fire");
    expect(run.charmRoundsLeft(0)).toBe(4);
    run.drop(0);
    const id = [...run.balls.keys()][0]!;
    expect(run.ballElements.get(id)).toBe("fire");
    // Advance rounds past expiry.
    (run as unknown as { round: number }).round = run.round + 4;
    (run as unknown as Priv).startRound();
    const events = run.step();
    expect(run.charms).not.toContain("firestorm");
    expect(events.some((e) => e.type === "charmExpired" && e.id === "firestorm")).toBe(true);
    expect(run.activeElement()).toBeNull();
  });
});
