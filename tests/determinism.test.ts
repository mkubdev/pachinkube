import { afterEach, describe, expect, it } from "vitest";
import { Sim } from "../src/sim/world.js";
import type { SimEvent } from "../src/sim/types.js";

const sims: Sim[] = [];
afterEach(() => {
  for (const s of sims.splice(0)) s.dispose();
});

/** A scripted run: drop a ball every 30 ticks for `ticks` ticks. */
async function scripted(seed: string, ticks: number) {
  const sim = await Sim.create({ seed });
  sims.push(sim);
  const events: SimEvent[] = [];
  const hashes: string[] = [];
  for (let t = 0; t < ticks; t++) {
    if (t % 30 === 0) sim.dropBall();
    events.push(...sim.step());
    if (t % 100 === 0) hashes.push(sim.hash());
  }
  return { sim, events, hashes, final: sim.hash() };
}

describe("simulation determinism", () => {
  it("same seed + same inputs => identical state at every checkpoint", async () => {
    const a = await scripted("det-1", 1500);
    const b = await scripted("det-1", 1500);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.final).toBe(b.final);
    expect(a.events).toEqual(b.events);
  });

  it("different seeds diverge (layout jitter + drop positions)", async () => {
    const a = await scripted("det-1", 600);
    const b = await scripted("det-2", 600);
    expect(a.final).not.toBe(b.final);
    expect(a.sim.pegs.map((p) => p.x)).not.toEqual(b.sim.pegs.map((p) => p.x));
  });

  it("balls hit pegs and eventually fall out the bottom", async () => {
    const { events, sim } = await scripted("det-3", 3000);
    const hits = events.filter((e) => e.type === "pegHit").length;
    const lost = events.filter((e) => e.type === "ballLost").length;
    expect(hits).toBeGreaterThan(50);
    expect(lost).toBeGreaterThan(0);
    // Everything dropped early enough has left the board by now.
    expect(sim.ballCount).toBeLessThan(100);
    for (const e of events) if (e.type === "pegHit") expect(e.speed).toBeGreaterThan(0);
  });

  it("reports the pocket every lost ball fell into", async () => {
    const { events, sim } = await scripted("det-4", 3000);
    const lost = events.filter((e) => e.type === "ballLost");
    expect(lost.length).toBeGreaterThan(5);
    for (const e of lost) {
      if (e.type !== "ballLost") continue;
      expect(e.bucket).toBeGreaterThanOrEqual(0);
      expect(e.bucket).toBeLessThan(sim.config.buckets);
    }
    expect(sim.bucketCenters).toHaveLength(sim.config.buckets);
    // Balls spread across pockets rather than all landing in one.
    expect(new Set(lost.map((e) => (e.type === "ballLost" ? e.bucket : -2))).size).toBeGreaterThan(2);
  });

  it("spawned balls carry their tag and radius", async () => {
    const sim = await Sim.create({ seed: "spawn" });
    sims.push(sim);
    const id = sim.spawnBall({ x: 0, y: 5, radius: 0.3, tag: "heavy" });
    sim.step();
    const b = sim.snapshot().balls.find((x) => x.id === id);
    expect(b?.tag).toBe("heavy");
    expect(b?.radius).toBe(0.3);
    expect(sim.ballTag(id)).toBe("heavy");
    expect(sim.ballPosition(id)?.y).toBeLessThan(5);
  });

  it("never leaves a ball stuck forever", async () => {
    // Zero restitution balls love to rest on divider tops; all must still exit.
    const sim = await Sim.create({ seed: "stuck", restitution: 0 });
    sims.push(sim);
    for (let i = 0; i < 20; i++) sim.spawnBall({ x: -2.5 + i * 0.25, restitution: 0 });
    let lost = 0;
    for (let t = 0; t < 6000 && lost < 20; t++) {
      for (const e of sim.step()) if (e.type === "ballLost") lost++;
    }
    expect(lost).toBe(20);
    expect(sim.ballCount).toBe(0);
    expect(sim.bucketAt(-2.9)).toBe(0);
    expect(sim.bucketAt(0)).toBe(3);
    expect(sim.bucketAt(2.9)).toBe(6);
  });

  it("magnet balls never park on the centre column", async () => {
    const sim = await Sim.create({ seed: "magnet-park" });
    sims.push(sim);
    for (let i = 0; i < 12; i++) sim.spawnBall({ x: -2.6 + i * 0.47, pull: 0.55, tag: "magnet" });
    let lost = 0;
    let firstLostTick = -1;
    for (let t = 0; t < 4800 && lost < 12; t++) {
      for (const e of sim.step()) if (e.type === "ballLost") { lost++; if (firstLostTick < 0) firstLostTick = t; }
    }
    // All twelve out well before the 40 s age cap: none was pinned.
    expect(lost).toBe(12);
    expect(sim.tick).toBeLessThan(4800);
  });

  it("builds the expected peg count", async () => {
    const sim = await Sim.create({ seed: "layout", pegRows: 4, pegCols: 5 });
    sims.push(sim);
    // rows alternate 5,4,5,4
    expect(sim.pegs).toHaveLength(18);
  });
});
