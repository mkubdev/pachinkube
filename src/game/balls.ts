import type { BallSpawn } from "../sim/types.js";

export type BallTypeId =
  | "steel" | "rubber" | "heavy" | "spark"
  | "gold" | "feather" | "cannon" | "magnet" | "twin" | "prism" | "bomb";

/** Mechanical quirks the run reads; physics quirks go through `physics`. */
export interface BallTraits {
  /** Balls spawned per drop (they share one bag slot). */
  count?: number;
  /** Mult added when the ball lands. */
  multOnLand?: number;
  /** Extra chips per hit = impact speed × this. */
  speedChips?: number;
  /** On a fresh hit, also light this many nearest unlit pegs. */
  lightNeighbor?: number;
  /** On this hit number, light every unlit peg within `detonateRadius`. */
  detonateAt?: number;
  detonateRadius?: number;
}

export interface BallType {
  id: BallTypeId;
  name: string;
  desc: string;
  /** 0xRRGGBB for the renderer. */
  color: number;
  physics: Pick<BallSpawn, "radius" | "restitution" | "density" | "gravityScale" | "pull" | "vy">;
  /** Multiplier on chips earned per peg hit. */
  chipFactor: number;
  traits?: BallTraits;
  /** Weight in the shop's ball-offer roll. */
  shopWeight: number;
}

export const BALL_TYPES: Record<BallTypeId, BallType> = {
  steel: {
    id: "steel", name: "Steel", desc: "The classic. Reliable, unremarkable.",
    color: 0xe8ecf2, physics: {}, chipFactor: 1, shopWeight: 0,
  },
  rubber: {
    id: "rubber", name: "Rubber", desc: "Bouncy and light. Hits many more pegs.",
    color: 0xff8f2d, physics: { radius: 0.12, restitution: 0.88, density: 1.5 }, chipFactor: 0.8, shopWeight: 10,
  },
  heavy: {
    id: "heavy", name: "Heavy", desc: "Big and dense. Few hits, each worth ×3 chips.",
    color: 0x6f7a8a, physics: { radius: 0.2, restitution: 0.25, density: 18 }, chipFactor: 3, shopWeight: 10,
  },
  spark: {
    id: "spark", name: "Spark", desc: "Every peg hit has a 25% chance of +1 mult.",
    color: 0x2de2ff, physics: { radius: 0.13 }, chipFactor: 1, shopWeight: 8,
  },
  gold: {
    id: "gold", name: "Gold", desc: "×2 chips per hit and +1 mult when it lands.",
    color: 0xffd34d, physics: { radius: 0.13, density: 12 }, chipFactor: 2, traits: { multOnLand: 1 }, shopWeight: 6,
  },
  feather: {
    id: "feather", name: "Feather", desc: "Barely falls. Drifts through the whole field.",
    color: 0xd7f7ff, physics: { radius: 0.11, restitution: 0.7, density: 0.8, gravityScale: 0.45 }, chipFactor: 0.7, shopWeight: 8,
  },
  cannon: {
    id: "cannon", name: "Cannon", desc: "Fired downward. Chips scale with impact speed.",
    color: 0xff4d4d, physics: { radius: 0.15, density: 12, vy: -9 }, chipFactor: 1.2, traits: { speedChips: 0.8 }, shopWeight: 7,
  },
  magnet: {
    id: "magnet", name: "Magnet", desc: "Pulled toward the centre pocket.",
    color: 0xb46cff, physics: { radius: 0.14, pull: 0.55 }, chipFactor: 1, shopWeight: 7,
  },
  twin: {
    id: "twin", name: "Twin", desc: "Drops as two small balls from one slot.",
    color: 0x7dff9a, physics: { radius: 0.1, density: 5 }, chipFactor: 0.8, traits: { count: 2 }, shopWeight: 7,
  },
  prism: {
    id: "prism", name: "Prism", desc: "Each fresh peg it lights also lights its nearest neighbour.",
    color: 0xf5b0ff, physics: { radius: 0.13 }, chipFactor: 1, traits: { lightNeighbor: 1 }, shopWeight: 6,
  },
  bomb: {
    id: "bomb", name: "Bomb", desc: "On its 12th hit, lights every peg nearby.",
    color: 0xff6a00, physics: { radius: 0.16, density: 9 }, chipFactor: 1, traits: { detonateAt: 12, detonateRadius: 1.3 }, shopWeight: 5,
  },
};

export const BALL_IDS = Object.keys(BALL_TYPES) as BallTypeId[];
export const SHOP_BALLS = BALL_IDS.filter((id) => BALL_TYPES[id].shopWeight > 0);

export const STARTING_BAG: BallTypeId[] = ["steel", "steel", "steel", "steel", "steel", "steel"];
