import { describe, expect, it } from "vitest";
import { FEVER_IGNITION, FEVER_RAMP, feverMultiplier } from "../src/game/fever.js";

describe("fever formula", () => {
  it("is ×1 below ignition", () => {
    expect(feverMultiplier(0)).toBe(1);
    expect(feverMultiplier(49)).toBe(1);
  });
  it("ignites at the threshold and grows quadratically", () => {
    expect(feverMultiplier(50)).toBe(1);
    expect(feverMultiplier(100)).toBe(2); // 1 + (50/50)²
    expect(feverMultiplier(150)).toBe(5); // 1 + (100/50)²
    expect(feverMultiplier(400)).toBe(50); // 1 + (350/50)²
  });
  it("respects custom ignition and ramp", () => {
    expect(feverMultiplier(50, 30, 50)).toBeCloseTo(1 + (20 / 50) ** 2);
    expect(feverMultiplier(100, 50, 40)).toBeCloseTo(1 + (50 / 40) ** 2);
  });
  it("exports the tuned defaults", () => {
    expect(FEVER_IGNITION).toBe(50);
    expect(FEVER_RAMP).toBe(50);
  });
});
