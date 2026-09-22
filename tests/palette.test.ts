import { describe, expect, it } from "vitest";
import { COMBO_TIER_FLASH, comboTier, REACTION_FX } from "../src/render/palette.js";

describe("reaction palette", () => {
  it("covers every reaction the run can emit", () => {
    const kinds = [
      "ignite", "freeze", "charge", "thicken", "burn", "flare",
      "steam", "shatter", "zap", "wildfire", "shatter_chain",
    ] as const;
    for (const k of kinds) {
      const p = REACTION_FX[k];
      expect(p, k).toBeDefined();
      expect(p!.primary).toBeGreaterThanOrEqual(0);
      expect(p!.secondary).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives steam, wildfire and shatter_chain their own flash colours", () => {
    expect(REACTION_FX.steam!.flash).toBeDefined();
    expect(REACTION_FX.wildfire!.flash).toBeDefined();
    expect(REACTION_FX.shatter_chain!.flash).toBeDefined();
  });
});

describe("combo hue journey", () => {
  it("climbs white → gold → orange → magenta → violet → white-hot", () => {
    expect(comboTier(0)).toBe(0);
    expect(comboTier(9)).toBe(0);
    expect(comboTier(10)).toBe(1);
    expect(comboTier(19)).toBe(1);
    expect(comboTier(20)).toBe(2);
    expect(comboTier(39)).toBe(2);
    expect(comboTier(40)).toBe(3);
    expect(comboTier(79)).toBe(3);
    expect(comboTier(80)).toBe(4);
    expect(comboTier(159)).toBe(4);
    expect(comboTier(160)).toBe(5);
    expect(comboTier(500)).toBe(5);
  });

  it("has one flash colour per tier", () => {
    expect(COMBO_TIER_FLASH).toHaveLength(6);
  });
});
