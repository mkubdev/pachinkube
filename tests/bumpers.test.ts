import { afterEach, describe, expect, it } from "vitest";
import { BUMPERS_PER_ROUND, BUMPER_COMBO, Run, type GameEvent } from "../src/game/run.js";
import { BUMPER_RADIUS } from "../src/sim/types.js";
import type { BallScoreState } from "../src/game/charms.js";

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

describe("bumper pegs", () => {
  it("seeds a few bumpers per round in the middle rows and announces them", async () => {
    const run = await make("bump");
    expect(run.bumpers.size).toBe(BUMPERS_PER_ROUND);
    const H = run.sim.config.height;
    for (const id of run.bumpers) {
      const p = run.sim.pegs[id]!;
      expect(p.y).toBeLessThan(H * 0.8);
      expect(p.y).toBeGreaterThan(H * 0.3);
    }
    const first = run.step();
    const ann = first.find((e) => e.type === "bumpers");
    expect(ann && ann.type === "bumpers" ? ann.pegs : []).toEqual([...run.bumpers].sort((a, b) => a - b));
    // Same seed, same bumpers: they are part of the replay.
    const again = await make("bump");
    expect([...again.bumpers]).toEqual([...run.bumpers]);
    const more = await make("bump", "pop_bumpers");
    expect(more.bumpers.size).toBe(BUMPERS_PER_ROUND + 2);
  });

  it("a bumper hit counts as several combo hits, pays chips, and pops the ball", async () => {
    const run = await make("bump-hit");
    run.bag[0] = "steel";
    run.drop(0);
    const ball = [...run.balls.values()][0]!;
    const bumper = [...run.bumpers][0]!;
    const peg = run.sim.pegs[bumper]!;
    // Park the ball just above the bumper so the kick direction is well defined.
    run.sim.teleportBall(ball.id, peg.x, peg.y + BUMPER_RADIUS + 0.14);
    const before = run.sim.snapshot().balls[0]!;
    const out: GameEvent[] = [];
    run.combo = 8;
    (run as unknown as Priv).handle({ type: "pegHit", ball: ball.id, peg: bumper, speed: 2 }, out);
    expect(run.combo).toBe(8 + 1 + BUMPER_COMBO);
    const ev = out.find((e) => e.type === "bumper");
    expect(ev).toBeDefined();
    // Crossing 10 on the way to 12 still pays the milestone exactly once.
    expect(ball.mult).toBe(2);
    expect(ball.chips).toBeGreaterThan(10);
    const after = run.sim.snapshot().balls[0]!;
    expect(after.vy).toBeGreaterThan(before.vy + 1);
  });

  it("Super Bumpers and Bumper Crown stack onto the pop", async () => {
    const run = await make("bump-charms", "super_bumpers", "bumper_crown");
    const b: BallScoreState = { id: 4242, type: "steel", chips: 0, mult: 1, hits: 0, freshHits: 0, revives: 0, zaps: 0 };
    run.balls.set(b.id, b);
    const bumper = [...run.bumpers][0]!;
    const out: GameEvent[] = [];
    (run as unknown as Priv).handle({ type: "pegHit", ball: b.id, peg: bumper, speed: 1 }, out);
    expect(run.combo).toBe(1 + BUMPER_COMBO + 3);
    expect(b.mult).toBe(2); // +1 from the crown (no milestone crossed at 7)
  });

  it("a plain peg is not a bumper: one combo, no pop", async () => {
    const run = await make("bump-plain");
    const b: BallScoreState = { id: 4243, type: "steel", chips: 0, mult: 1, hits: 0, freshHits: 0, revives: 0, zaps: 0 };
    run.balls.set(b.id, b);
    const plain = run.sim.pegs.find((p) => !run.bumpers.has(p.id))!.id;
    const out: GameEvent[] = [];
    (run as unknown as Priv).handle({ type: "pegHit", ball: b.id, peg: plain, speed: 1 }, out);
    expect(run.combo).toBe(1);
    expect(out.some((e) => e.type === "bumper")).toBe(false);
  });
});

describe("wall fins", () => {
  it("nothing falls the side channel untouched, and Heavy still gets out", async () => {
    const { Sim } = await import("../src/sim/world.js");
    const { BALL_TYPES } = await import("../src/game/balls.js");
    for (const x of [-2.9, -2.75, -2.6, 2.6, 2.75, 2.9]) {
      for (const type of ["steel", "heavy", "cluster"] as const) {
        const sim = await Sim.create({ seed: `fin-${x}` });
        const id = sim.spawnBall({ x, ...BALL_TYPES[type].physics });
        let touched = false;
        let lostAt = -1;
        for (let t = 0; t < 120 * 12 && lostAt < 0; t++) {
          for (const e of sim.step()) {
            if (e.ball !== id) continue;
            if (e.type === "pegHit" || e.type === "wallHit") touched = true;
            if (e.type === "ballLost") lostAt = t;
          }
        }
        expect(touched, `${type} at x=${x} fell untouched`).toBe(true);
        expect(lostAt, `${type} at x=${x} never landed`).toBeGreaterThan(0);
        expect(lostAt, `${type} at x=${x} took too long`).toBeLessThan(120 * 10);
        sim.dispose();
      }
    }
  });

  it("drops are clamped to the outermost peg column and every drop meets a peg", async () => {
    const run = await make("fin-drop");
    const lim = run.sim.dropLimit;
    expect(lim).toBeGreaterThan(2);
    expect(lim).toBeLessThan(2.6);
    for (const x of [-9, -2.9, -1.3, 0.4, 2.2, 9]) { // six drops: the round's whole bag
      run.bag[0] = "steel";
      run.drop(x);
      const ball = run.sim.snapshot().balls.at(-1)!;
      expect(Math.abs(ball.x)).toBeLessThanOrEqual(lim + 0.01);
      let pegHits = 0;
      for (let t = 0; t < 120 * 12 && run.inFlight > 0; t++) for (const e of run.step()) if (e.type === "pegHit") pegHits++;
      expect(pegHits, `drop at ${x}`).toBeGreaterThan(0);
    }
  });
});

describe("ball timers", () => {
  it("no ball outlives 15 s, a Magnet no more than 10 s, even when parked", async () => {
    const { Sim, BALL_LIFETIME_TICKS, PULLED_LIFETIME_TICKS } = await import("../src/sim/world.js");
    const { BALL_TYPES } = await import("../src/game/balls.js");
    const sim = await Sim.create({ seed: "timer" });
    // Park a Magnet on top of a peg with zero velocity and a Feather beside it.
    const peg = sim.pegs[30]!;
    const magnet = sim.spawnBall({ x: peg.x, y: peg.y + 0.3, ...BALL_TYPES.magnet.physics });
    const feather = sim.spawnBall({ x: peg.x + 0.02, y: peg.y + 0.6, ...BALL_TYPES.feather.physics, gravityScale: 0.01 });
    const lost = new Map<number, number>();
    for (let t = 0; t <= BALL_LIFETIME_TICKS + 12 && lost.size < 2; t++) {
      for (const e of sim.step()) if (e.type === "ballLost") lost.set(e.ball, t);
    }
    expect(lost.get(magnet)).toBeDefined();
    expect(lost.get(magnet)!).toBeLessThanOrEqual(PULLED_LIFETIME_TICKS + 12);
    expect(lost.get(feather)).toBeDefined();
    expect(lost.get(feather)!).toBeLessThanOrEqual(BALL_LIFETIME_TICKS + 12);
    sim.dispose();
  });

  it("only the top two odd rows carry fins, so the lower side channel reaches the edge pockets", async () => {
    const run = await make("fins-open");
    const H = run.sim.config.height;
    expect(run.sim.fins.length).toBe(4);
    for (const f of run.sim.fins) expect(f.y1).toBeGreaterThan(H * 0.55);
  });
});
