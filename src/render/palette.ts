/**
 * Reaction & combo colour language. One place to tune the palette: the
 * element-event dispatch in main.ts and the combo counter read from here.
 * Pure data — no Three.js, no DOM — so game/ code and Node tests may import it.
 */
import type { ElementFxKind } from "../game/elements.js";

export interface ReactionFx {
  /** Main particle colour. */
  primary: number;
  /** burst2 lerps each particle between primary and secondary. */
  secondary: number;
  /** Ring / arc colour where a reaction draws one. */
  accent?: number;
  /** Full-screen flash as a CSS colour; absent = no flash. */
  flash?: string;
}

export const REACTION_FX: Partial<Record<ElementFxKind, ReactionFx>> = {
  ignite: { primary: 0xff6a00, secondary: 0xffd34d },
  freeze: { primary: 0x9fe8ff, secondary: 0xffffff },
  charge: { primary: 0xb44bff, secondary: 0xffffff },
  thicken: { primary: 0x3b6fff, secondary: 0xffffff },
  burn: { primary: 0xff6a00, secondary: 0xff2222 },
  flare: { primary: 0xffd34d, secondary: 0xffffff, accent: 0xff6a00, flash: "#ffd34d" },
  steam: { primary: 0xffffff, secondary: 0xff9ec7, accent: 0xff9ec7, flash: "#ffd7e8" },
  shatter: { primary: 0xdff6ff, secondary: 0xffe9b0, accent: 0x9fe8ff },
  zap: { primary: 0xb44bff, secondary: 0xffffff },
  wildfire: { primary: 0xff6a00, secondary: 0xff2d95, accent: 0xff2d95, flash: "#ff2d95" },
  shatter_chain: { primary: 0xdff6ff, secondary: 0xffffff, accent: 0x9fe8ff, flash: "#c9f2ff" },
};

/** Combo counter hue journey: white → gold → orange → magenta → violet. */
export function comboTier(count: number): 0 | 1 | 2 | 3 | 4 | 5 {
  return count >= 160 ? 5 : count >= 80 ? 4 : count >= 40 ? 3 : count >= 20 ? 2 : count >= 10 ? 1 : 0;
}

/** Milestone flash per tier (index = tier). */
export const COMBO_TIER_FLASH = ["#ffffff", "#ffd34d", "#ff8c1a", "#ff2d95", "#b44bff", "#fff6e0"] as const;
