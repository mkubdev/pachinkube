import type { BallSpawn } from "../sim/types.js";
import type { Element } from "./elements.js";

export type BallTypeId =
  | "steel" | "rubber" | "heavy" | "spark"
  | "gold" | "feather" | "cannon" | "ricochet" | "twin" | "prism" | "bomb"
  | "mirror" | "comet" | "glass"
  // second wave
  | "orbit" | "ember" | "frost" | "volt" | "cluster" | "anchor" | "pearl"
  | "rainbow" | "boomerang" | "quantum" | "abyss";

/** Mechanical quirks the run reads; physics quirks go through `physics`. */
export interface BallTraits {
  /** Balls spawned per drop (they share one bag slot). */
  count?: number;
  /** Mult added when the ball lands. */
  multOnLand?: number;
  /** Extra chips per hit = impact speed × this. */
  speedChips?: number;
  /** Combo hits per peg hit (1 by default — Cannon counts double). */
  comboHits?: number;
  /** On a fresh hit, also light this many nearest unlit pegs. */
  lightNeighbor?: number;
  /** On this hit number, light every unlit peg within `detonateRadius`. */
  detonateAt?: number;
  detonateRadius?: number;
  /** Landing also pays the pocket mirrored across the centre. */
  mirrorPocket?: boolean;
  /** Every Nth hit ignites a bare peg. */
  igniteEvery?: number;
  /** On this hit the ball shatters: chips ×2 and `shatterShards` shards spawn. */
  shatterAt?: number;
  shatterShards?: number;
  /** The ball is always imbued with this element (ignores active charms). */
  element?: Element;
  /** Rainbow: the element rotates fire → ice → storm on every hit. */
  cycleElement?: boolean;
  /** Every Nth hit: +`multEveryAmount` mult. */
  multEvery?: number;
  multEveryAmount?: number;
  /** When it lands it is relaunched from the top this many times, keeping chips and mult. */
  relaunch?: number;
  /** On this hit the ball blinks to a random spot in the upper field. */
  blinkAt?: number;
  /** On landing: +1 mult per other ball still in flight (they were being dragged along). */
  collapse?: boolean;
  /** Ricochet: chips per wall hit, and the kick (m/s) back toward the centre. */
  wallChips?: number;
  wallKick?: number;
  /** Orbit: sideways kick (m/s) on every peg hit, alternating left/right. */
  swerve?: number;
  /** Orbit: pocket multiplier factor when it lands in an edge pocket. */
  edgeMult?: number;
}

export interface BallType {
  id: BallTypeId;
  name: string;
  desc: string;
  /** 0xRRGGBB for the renderer. */
  color: number;
  physics: Pick<BallSpawn, "radius" | "restitution" | "density" | "gravityScale" | "pull" | "vy" | "well">;
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
    id: "cannon", name: "Cannon", desc: "Fired downward. Every peg hit counts as 2 combo hits.",
    color: 0xff4d4d, physics: { radius: 0.15, density: 12, vy: -9 }, chipFactor: 0.8, traits: { comboHits: 2 }, shopWeight: 7,
  },
  ricochet: {
    id: "ricochet", name: "Ricochet", desc: "Slams off the walls: every wall hit pays +12 chips and kicks it back into the field.",
    color: 0xb46cff, physics: { radius: 0.13, restitution: 0.8, density: 6 }, chipFactor: 1, traits: { wallChips: 12, wallKick: 2.6 }, shopWeight: 7,
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
  mirror: {
    id: "mirror", name: "Mirror", desc: "Lands in two pockets at once: its own and the one mirrored across the centre.",
    color: 0xc8f0ff, physics: { radius: 0.13, density: 6 }, chipFactor: 1, traits: { mirrorPocket: true }, shopWeight: 5,
  },
  comet: {
    id: "comet", name: "Comet", desc: "Every 3rd peg it touches catches fire.",
    color: 0xffb347, physics: { radius: 0.12, density: 5, restitution: 0.7 }, chipFactor: 1, traits: { igniteEvery: 3 }, shopWeight: 5,
  },
  glass: {
    id: "glass", name: "Glass", desc: "×2 chips. Shatters on its 6th hit into three shards.",
    color: 0xe0ffff, physics: { radius: 0.14, density: 3, restitution: 0.75 }, chipFactor: 2, traits: { shatterAt: 6, shatterShards: 3 }, shopWeight: 4,
  },

  // --- second wave -----------------------------------------------------------
  orbit: {
    id: "orbit", name: "Orbit", desc: "Swerves left, then right, off every peg and sweeps the whole board. Edge pockets pay ×2 for it.",
    color: 0x9ad0ff, physics: { radius: 0.13, density: 6 }, chipFactor: 1.2, traits: { swerve: 1.5, edgeMult: 2 }, shopWeight: 6,
  },
  ember: {
    id: "ember", name: "Ember", desc: "Always Fire. Ignites bare pegs, flares on burning ones.",
    color: 0xff6a00, physics: { radius: 0.13, density: 6 }, chipFactor: 1, traits: { element: "fire" }, shopWeight: 6,
  },
  frost: {
    id: "frost", name: "Frost", desc: "Always Ice. Freezes bare pegs and thickens frozen ones.",
    color: 0x9fe8ff, physics: { radius: 0.13, density: 6, restitution: 0.7 }, chipFactor: 1, traits: { element: "ice" }, shopWeight: 6,
  },
  volt: {
    id: "volt", name: "Volt", desc: "Always Storm. Charges pegs and zaps charged ones.",
    color: 0xb44bff, physics: { radius: 0.12, density: 5 }, chipFactor: 1, traits: { element: "storm" }, shopWeight: 6,
  },
  cluster: {
    id: "cluster", name: "Cluster", desc: "Three tiny balls from one slot. ×0.6 chips each.",
    color: 0xc6ff5e, physics: { radius: 0.085, density: 4 }, chipFactor: 0.6, traits: { count: 3 }, shopWeight: 5,
  },
  anchor: {
    id: "anchor", name: "Anchor", desc: "Falls almost twice as fast. Chips scale with impact speed.",
    color: 0x5e6b7a, physics: { radius: 0.15, density: 14, gravityScale: 1.8 }, chipFactor: 1.4, traits: { speedChips: 0.6 }, shopWeight: 5,
  },
  pearl: {
    id: "pearl", name: "Pearl", desc: "×0.7 chips, but +0.5 mult on every 4th peg hit.",
    color: 0xfff0f5, physics: { radius: 0.13, density: 5, restitution: 0.65 }, chipFactor: 0.7, traits: { multEvery: 4, multEveryAmount: 0.5 }, shopWeight: 4,
  },
  rainbow: {
    id: "rainbow", name: "Rainbow", desc: "Cycles Fire → Ice → Storm on every hit. Every reaction, eventually.",
    color: 0xff2d95, physics: { radius: 0.13, density: 6 }, chipFactor: 1, traits: { cycleElement: true, element: "fire" }, shopWeight: 3,
  },
  boomerang: {
    id: "boomerang", name: "Boomerang", desc: "Comes back: relaunched once from the top after it lands, keeping chips and mult.",
    color: 0xffc46b, physics: { radius: 0.13, density: 6 }, chipFactor: 0.9, traits: { relaunch: 1 }, shopWeight: 3,
  },
  quantum: {
    id: "quantum", name: "Quantum", desc: "On its 6th hit it blinks back into the upper field.",
    color: 0xd6a8ff, physics: { radius: 0.12, density: 5 }, chipFactor: 1.1, traits: { blinkAt: 6 }, shopWeight: 3,
  },
  abyss: {
    id: "abyss", name: "Abyss", desc: "A black hole. Drags every nearby ball toward it; lands with +1 mult per ball still in flight. ×0.6 chips.",
    color: 0x14091f, physics: { radius: 0.15, density: 22, well: 0.9 }, chipFactor: 0.6, traits: { collapse: true }, shopWeight: 2,
  },
};

export const BALL_IDS = Object.keys(BALL_TYPES) as BallTypeId[];
export const SHOP_BALLS = BALL_IDS.filter((id) => BALL_TYPES[id].shopWeight > 0);

export const STARTING_BAG: BallTypeId[] = ["steel", "steel", "steel", "steel", "steel", "steel"];
