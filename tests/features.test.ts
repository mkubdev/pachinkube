import { describe, expect, it } from "vitest";
import { FEATURE_ANCHORS, FEATURE_SHAPES, FEATURE_CLEARANCE, FEATURE_RESTITUTION } from "../src/sim/types.js";
import { Sim } from "../src/sim/world.js";

describe("feature geometry", () => {
  it("defines shapes for the wave-1 kinds only", () => {
    expect(FEATURE_SHAPES.target_bank).toHaveLength(3);
    expect(FEATURE_SHAPES.drop_target).toHaveLength(1);
    expect(FEATURE_SHAPES.spinner).toBeUndefined();
    expect(FEATURE_SHAPES.orbit).toBeUndefined();
  });

  it("every bank part is a circle and the drop target is a bar", () => {
    for (const p of FEATURE_SHAPES.target_bank!) expect(p.r).toBeGreaterThan(0);
    const bar = FEATURE_SHAPES.drop_target![0]!;
    expect(bar.w).toBeGreaterThan(bar.h ?? 0);
  });

  it("anchors are board fractions that stay clear of the pocket dividers", () => {
    expect(FEATURE_ANCHORS.length).toBeGreaterThanOrEqual(5);
    for (const a of FEATURE_ANCHORS) {
      expect(Math.abs(a.x)).toBeLessThan(0.5);
      expect(a.y).toBeGreaterThan(0.12);
      expect(a.y).toBeLessThan(0.6);
    }
  });

  it("clearance leaves room for the widest ball", () => {
    expect(FEATURE_CLEARANCE).toBeGreaterThanOrEqual(0.4);
    expect(FEATURE_RESTITUTION).toBeGreaterThan(0.5);
  });
});

describe("Sim.addFeature", () => {
  it("places parts at absolute coordinates and refuses unimplemented kinds", async () => {
    const sim = await Sim.create({ seed: "feat-add" });
    const id = sim.addFeature("target_bank", 1, 1.5);
    expect(id).toBe(0);
    const f = sim.features[0]!;
    expect(f.kind).toBe("target_bank");
    expect(f.parts).toHaveLength(3);
    expect(f.parts[0]!.x).toBeCloseTo(1 - 0.34, 6);
    expect(f.parts[1]!.y).toBeCloseTo(1.5 + 0.16, 6);
    expect(() => sim.addFeature("spinner", 0, 2)).toThrow(/not implemented/);
    sim.clearFeatures();
    expect(sim.features).toHaveLength(0);
    sim.dispose();
  });

  it("reports a featureHit when a ball strikes a part, and stops after the part is removed", async () => {
    const sim = await Sim.create({ seed: "feat-hit" });
    sim.addFeature("drop_target", 0, 5);
    const bar = sim.features[0]!.parts[0]!;
    sim.spawnBall({ x: bar.x, y: bar.y + 0.6 });
    let hits = 0;
    for (let t = 0; t < 240; t++) for (const e of sim.step()) if (e.type === "featureHit") hits++;
    expect(hits).toBeGreaterThan(0);

    const sim2 = await Sim.create({ seed: "feat-hit" });
    sim2.addFeature("drop_target", 0, 5);
    sim2.removeFeaturePart(0, 0);
    sim2.spawnBall({ x: bar.x, y: bar.y + 0.6 });
    let hits2 = 0;
    for (let t = 0; t < 240; t++) for (const e of sim2.step()) if (e.type === "featureHit") hits2++;
    expect(hits2).toBe(0);
    sim.dispose();
    sim2.dispose();
  });
});

describe("pegs under a feature", () => {
  it("finds the overlapped pegs and a disabled peg stops reporting hits", async () => {
    const sim = await Sim.create({ seed: "feat-pegs" });
    // Anchor the bank right on a mid-field peg.
    const target = sim.pegs[30]!;
    sim.addFeature("target_bank", target.x, target.y);
    const under = sim.pegsUnderFeature(0);
    expect(under).toContain(target.id);

    for (const id of under) sim.setPegEnabled(id, false);
    expect(sim.pegIsEnabled(target.id)).toBe(false);
    sim.spawnBall({ x: target.x, y: target.y + 2 });
    let pegHits = 0;
    for (let t = 0; t < 240; t++) for (const e of sim.step()) if (e.type === "pegHit" && under.includes(e.peg)) pegHits++;
    expect(pegHits).toBe(0);

    for (const id of under) sim.setPegEnabled(id, true);
    expect(sim.pegIsEnabled(target.id)).toBe(true);
    sim.dispose();
  });
});
