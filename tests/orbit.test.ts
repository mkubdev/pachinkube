import { afterEach, describe, expect, it } from "vitest";
import { Run, type GameEvent } from "../src/game/run.js";
import { BALL_TYPES } from "../src/game/balls.js";

const runs: Run[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) r.dispose();
});
type Priv = { handle(ev: unknown, out: GameEvent[]): void };

describe("orbit", () => {
  it("has no pull and swerves in alternating directions off pegs", async () => {
    expect(BALL_TYPES.orbit.physics.pull).toBeUndefined();
    const run = await Run.create("orbit");
    runs.push(run);
    run.bag[0] = "orbit";
    run.drop(0);
    const ball = [...run.balls.values()][0]!;
    const peg = run.sim.pegs[30]!;
    run.sim.teleportBall(ball.id, peg.x, peg.y + 0.4);
    const vx = () => run.sim.snapshot().balls.find((b) => b.id === ball.id)!.vx;
    const priv = run as unknown as Priv;
    priv.handle({ type: "pegHit", ball: ball.id, peg: 30, speed: 1 }, []);
    const v1 = vx();
    priv.handle({ type: "pegHit", ball: ball.id, peg: 30, speed: 1 }, []);
    const v2 = vx();
    expect(Math.abs(v1)).toBeGreaterThan(1);
    expect(Math.sign(v2 - v1)).toBe(-Math.sign(v1)); // the second kick goes the other way
  });

  it("does not hug a wall: dropped at the edge it still lands within the timer and touches pegs", async () => {
    const run = await Run.create("orbit-edge");
    runs.push(run);
    run.bag[0] = "orbit";
    run.drop(-2.4);
    let pegHits = 0;
    let t = 0;
    for (; t < 120 * 15 && run.inFlight > 0; t++) for (const e of run.step()) if (e.type === "pegHit") pegHits++;
    expect(run.inFlight).toBe(0);
    expect(t).toBeLessThan(120 * 10);
    expect(pegHits).toBeGreaterThan(3);
  });

  it("edge pockets pay double for it", async () => {
    const run = await Run.create("orbit-pocket");
    runs.push(run);
    run.bag[0] = "orbit";
    run.drop(0);
    const ball = [...run.balls.values()][0]!;
    ball.chips = 100;
    const out: GameEvent[] = [];
    (run as unknown as Priv).handle({ type: "ballLost", ball: ball.id, bucket: 0 }, out);
    const scored = out.find((e) => e.type === "ballScored");
    expect(scored && scored.type === "ballScored" ? scored.score : 0).toBe(200); // ×1 pocket × edge ×2
  });
});
