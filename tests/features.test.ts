import { describe, expect, it } from "vitest";
import { FEATURE_ANCHORS, FEATURE_SHAPES, FEATURE_CLEARANCE, FEATURE_RESTITUTION } from "../src/sim/types.js";

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
