import { describe, expect, it } from "vitest";
import { Sim } from "../src/sim/world.js";

describe("balls never fall asleep", () => {
  it("a ball held against a peg by a pull falls as soon as the pull ends", async () => {
    const sim = await Sim.create({ seed: "sleepy" });
    // Right of an even-row edge peg: a strong centre pull presses the ball onto it.
    const peg = sim.pegs.find((p) => p.x > 2.2 && p.y > 6)!;
    const id = sim.spawnBall({ x: peg.x + 0.25, y: peg.y + 0.05, radius: 0.14 });
    sim.setGlobalPull(3);
    for (let t = 0; t < 120 * 3; t++) sim.step();
    const held = sim.ballPosition(id);
    if (!held) return; // it found a way down during the pull: nothing to prove
    sim.setGlobalPull(0);
    // Balanced on top of the peg it may need the 0.5 s unstick nudge first; three seconds is plenty.
    let after = sim.ballPosition(id);
    for (let t = 0; t < 120 * 3 && after && after.y > held.y - 0.3; t++) {
      sim.step();
      after = sim.ballPosition(id);
    }
    expect(after === null || after.y < held.y - 0.3, JSON.stringify({ held, after })).toBe(true);
    sim.dispose();
  });

  it("a pulled ball is subject to the shorter timer even when the pull is global", async () => {
    const { PULLED_LIFETIME_TICKS } = await import("../src/sim/world.js");
    const sim = await Sim.create({ seed: "storm-timer" });
    const peg = sim.pegs.find((p) => p.x > 2.2 && p.y > 6)!;
    const id = sim.spawnBall({ x: peg.x + 0.25, y: peg.y + 0.05, radius: 0.14 });
    sim.setGlobalPull(3);
    let lostAt = -1;
    for (let t = 0; t < PULLED_LIFETIME_TICKS + 24 && lostAt < 0; t++) for (const e of sim.step()) if (e.type === "ballLost") lostAt = t;
    expect(lostAt).toBeGreaterThan(0);
    sim.dispose();
  });
});
