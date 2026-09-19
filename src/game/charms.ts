/**
 * Charms are data: a name, a rarity, and hooks that react to gameplay events.
 * Synergies emerge from composition, so hooks must stay small and honest about
 * what they touch (chips, mult, spawns, the bag).
 */
import type { Rng } from "../sim/rng.js";
import type { BallSpawn, Peg, SimEvent } from "../sim/types.js";
import type { BallTypeId } from "./balls.js";
import type { Element } from "./elements.js";

export type Rarity = "common" | "uncommon" | "rare";
export const RARITY_WEIGHT: Record<Rarity, number> = { common: 60, uncommon: 30, rare: 10 };

/** Per-ball scoring state the hooks can read and push. */
export interface BallScoreState {
  id: number;
  type: BallTypeId;
  chips: number;
  mult: number;
  hits: number;
  freshHits: number;
  /** How many times Phoenix-style revives have fired for this ball. */
  revives: number;
}

export interface CharmCtx {
  round: number;
  buckets: number;
  ball: BallScoreState;
  pegs: readonly Peg[];
  lit: ReadonlySet<number>;
  rng: Rng;
  has(charm: CharmId): boolean;
  count(charm: CharmId): number;
  addChips(n: number, label?: string): void;
  addMult(n: number, label?: string): void;
  mulMult(f: number, label?: string): void;
  /** Light a peg; pass `fromPeg` to draw a lightning arc between them. */
  lightPeg(peg: number, fromPeg?: number): boolean;
  spawnBall(spawn: BallSpawn & { type: BallTypeId }): void;
  addToBag(type: BallTypeId, count?: number): void;
  /** Purely presentational burst at a board position. */
  fx(kind: FxKind, x: number, y: number, strength?: number): void;
}

export type FxKind = "split" | "revive" | "overflow" | "zap" | "metal" | "bomb" | "bullseye" | "insurance" | "prism" | "finale";

export interface Charm {
  id: CharmId;
  name: string;
  desc: string;
  rarity: Rarity;
  /** Modify the physics of every ball as it spawns. */
  onSpawn?(spawn: BallSpawn, ctx: { round: number; type: BallTypeId }): BallSpawn;
  /** Fires once when the charm is taken from the shop. */
  onAcquire?(ctx: Omit<CharmCtx, "ball">): void;
  onRoundStart?(ctx: Omit<CharmCtx, "ball">): void;
  onPegHit?(ctx: CharmCtx, ev: Extract<SimEvent, { type: "pegHit" }>, fresh: boolean): void;
  onWallHit?(ctx: CharmCtx): void;
  /** Return false to veto the ball being scored/removed (used for revives). */
  onBallLost?(ctx: CharmCtx, bucket: number, bucketMult: number): boolean | void;
  // --- passive fields: no hooks, the run reads them directly ---------------
  /** Extra balls per round. */
  extraBalls?: number;
  /** Additive bonus to every pocket multiplier. */
  bucketBonus?: number;
  /** Additive bonus to the two edge pockets only. */
  edgeBonus?: number;
  /** Multiplier applied to the centre pocket only. */
  jackpotFactor?: number;
  /** Extra shop offers per visit. */
  extraOffers?: number;
  /** Extra balls in every ball offer. */
  ballOfferBonus?: number;
  /** Chips every ball starts with. */
  startChips?: number;
  /** Mult each ball starts with per ball already landed this round. */
  momentum?: number;
  /** Mult factor for the last ball of a round. */
  finaleMult?: number;
  /** Extra chips on fresh / repeat peg hits. */
  freshChipBonus?: number;
  repeatChipBonus?: number;
  /** Extra ticks the combo stays alive between hits. */
  comboWindowBonus?: number;
  /** Change to the combo milestone interval (10 by default, floor 5). */
  milestoneDelta?: number;
  /** Failed rounds you may replay, once each. */
  retries?: number;
  /** Round score is multiplied by this before the target check. */
  roundEndMult?: number;
  /** Mult factor when a ball lands in the pocket it was aimed at. */
  sharpshooter?: number;

  // --- temporary charms ------------------------------------------------------
  /** Rounds the charm stays; undefined = permanent. Counted from acquisition. */
  duration?: number;

  // --- elemental passives ----------------------------------------------------
  /** Every ball from the bag is imbued with this element. */
  element?: Element;
  /** Chance (0..1) a fresh hit ignites the peg regardless of ball element. */
  igniteChance?: number;
  /** Pegs frozen at the start of every round. */
  frozenAtStart?: number;
  /** Every Nth peg hit fires a zap from the peg to its 2 nearest pegs. */
  zapEvery?: number;
  /** Extra chips per lightning arc. */
  arcChips?: number;
  /** Extra mult on every steam reaction. */
  steamMult?: number;
  /** Multiplier on every elemental chip payout. */
  elementBoost?: number;
  /** Burning pegs also spread when hit again (not only on ignite). */
  spreadOnRepeat?: boolean;

  // --- board motion ---------------------------------------------------------
  /** Pegs drift sideways: amplitude in board units, period in seconds. */
  pegDrift?: { amplitude: number; period: number };

  // --- pockets (the multiplier row) -----------------------------------------
  /** Rotate the multiplier pattern by this many pockets after every landing. */
  pocketRotate?: number;
  /** +N to the pocket just landed in, for the round (cap `hotPocketCap`). */
  hotPocket?: number;
  hotPocketCap?: number;
  /** Consecutive landings in one pocket: ball mult × (1 + streak × this). */
  groove?: number;
  /** Centre pocket +N per round cleared in this run. */
  jackpotGrowth?: number;
  /** One seeded pocket per round gets +N (shown highlighted). */
  lottery?: number;
  /** Reverse the pattern: edges become the jackpots. */
  invertPockets?: boolean;

  // --- combo economy ---------------------------------------------------------
  /** Change to how many combo hits a combo event needs (50 by default, floor 20). */
  eventEveryDelta?: number;
  /** When a combo of at least this many hits ends, +1 ball this round (once per round). */
  secondWindAt?: number;
}

export type CharmId =
  | "magnet_coil"
  | "neon_sign"
  | "split_shot"
  | "jackpot_lens"
  | "rubber_soul"
  | "heavy_metal"
  | "chain_lightning"
  | "bumper_kings"
  | "overflow"
  | "extra_ball"
  | "phoenix"
  | "golden_pocket"
  | "loaded_dice"
  | "wide_net"
  | "warm_start"
  | "momentum"
  | "grand_finale"
  | "fresh_paint"
  | "echo"
  | "long_fuse"
  | "milestone_maker"
  | "insurance"
  | "duplicator"
  | "compound"
  | "sharpshooter"
  | "low_gravity"
  // elemental passives
  | "ember_core"
  | "frost_bite"
  | "static_field"
  | "conductor"
  | "melting_point"
  | "tinder"
  | "elemental_surge"
  // temporary elemental actives (N rounds, then gone)
  | "firestorm"
  | "deep_freeze"
  | "thunderhead"
  | "solstice"
  // board motion
  | "drift"
  | "restless_board"
  // pockets
  | "roulette"
  | "hot_pocket"
  | "groove"
  | "jackpot_growth"
  | "pocket_lottery"
  | "inversion"
  // combo economy
  | "echo_chamber"
  | "second_wind"
  | "overclock";

function nearestUnlit(ctx: CharmCtx, from: Peg, n: number): Peg[] {
  return ctx.pegs
    .filter((p) => p.id !== from.id && !ctx.lit.has(p.id))
    .map((p) => ({ p, d: (p.x - from.x) ** 2 + (p.y - from.y) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.p);
}

export const CHARMS: Record<CharmId, Charm> = {
  magnet_coil: {
    id: "magnet_coil",
    name: "Magnet Coil",
    desc: "+5 chips on every peg hit.",
    rarity: "common",
    onPegHit(ctx) {
      ctx.addChips(5 * ctx.count("magnet_coil"), "coil");
    },
  },
  neon_sign: {
    id: "neon_sign",
    name: "Neon Sign",
    desc: "Every 5th fresh peg lit by a ball gives it +1 mult.",
    rarity: "common",
    onPegHit(ctx, _ev, fresh) {
      if (fresh && ctx.ball.freshHits % 5 === 0) ctx.addMult(1 * ctx.count("neon_sign"), "neon");
    },
  },
  split_shot: {
    id: "split_shot",
    name: "Split Shot",
    desc: "On its 8th peg hit a ball splits into two shards.",
    rarity: "uncommon",
    onPegHit(ctx, ev) {
      if (ctx.ball.hits !== 8) return;
      const peg = ctx.pegs[ev.peg];
      if (!peg) return;
      ctx.fx("split", peg.x, peg.y, 1);
      for (const dir of [-1, 1]) {
        ctx.spawnBall({
          type: ctx.ball.type,
          x: peg.x + dir * 0.25,
          y: peg.y + 0.2,
          vx: dir * 1.8,
          vy: 1.2,
          radius: 0.08,
          density: 4,
          tag: "shard",
        });
      }
    },
  },
  jackpot_lens: {
    id: "jackpot_lens",
    name: "Jackpot Lens",
    desc: "Centre pocket multiplier ×2.",
    rarity: "uncommon",
    jackpotFactor: 2,
  },
  rubber_soul: {
    id: "rubber_soul",
    name: "Rubber Soul",
    desc: "All balls bounce harder (+0.15 restitution).",
    rarity: "common",
    onSpawn(spawn) {
      return { ...spawn, restitution: Math.min(0.98, (spawn.restitution ?? 0.55) + 0.15) };
    },
  },
  heavy_metal: {
    id: "heavy_metal",
    name: "Heavy Metal",
    desc: "Heavy balls land with +3 mult. Adds a Heavy ball to your bag.",
    rarity: "uncommon",
    onAcquire(ctx) {
      ctx.addToBag("heavy", 1);
    },
    onBallLost(ctx, bucket) {
      if (ctx.ball.type === "heavy") {
        ctx.addMult(3, "metal");
        ctx.fx("metal", 0, 0.8, 0.8);
      }
      void bucket;
    },
  },
  chain_lightning: {
    id: "chain_lightning",
    name: "Chain Lightning",
    desc: "20% chance a peg hit also lights the 3 nearest unlit pegs.",
    rarity: "uncommon",
    onPegHit(ctx, ev) {
      if (ctx.rng.next() >= 0.2) return;
      const from = ctx.pegs[ev.peg];
      if (!from) return;
      for (const p of nearestUnlit(ctx, from, 3)) {
        if (ctx.lightPeg(p.id, from.id)) ctx.addChips(10, "zap");
      }
    },
  },
  bumper_kings: {
    id: "bumper_kings",
    name: "Bumper Kings",
    desc: "Every wall hit gives +2 mult.",
    rarity: "rare",
    onWallHit(ctx) {
      ctx.addMult(2, "bump");
    },
  },
  overflow: {
    id: "overflow",
    name: "Overflow",
    desc: "A ball landing with over 500 chips gets mult ×1.5.",
    rarity: "rare",
    onBallLost(ctx, bucket) {
      if (ctx.ball.chips > 500) {
        ctx.mulMult(1.5, "overflow");
        ctx.fx("overflow", 0, 0.8, 1);
      }
      void bucket;
    },
  },
  extra_ball: {
    id: "extra_ball",
    name: "Extra Ball",
    desc: "+1 ball every round.",
    rarity: "common",
    extraBalls: 1,
  },
  phoenix: {
    id: "phoenix",
    name: "Phoenix",
    desc: "A ball lost in an edge pocket is relaunched once (50%).",
    rarity: "rare",
    onBallLost(ctx, bucket) {
      const edge = bucket === 0 || bucket === ctx.buckets - 1;
      if (!edge || ctx.ball.revives > 0 || ctx.rng.next() >= 0.5) return;
      ctx.ball.revives++;
      ctx.fx("revive", bucket === 0 ? -2.6 : 2.6, 0.6, 1);
      // Relaunch from the top above the pocket it fell into; keeps its chips.
      ctx.spawnBall({
        type: ctx.ball.type,
        x: bucket === 0 ? -2 : 2,
        vx: bucket === 0 ? 1.5 : -1.5,
        tag: `revive:${ctx.ball.id}`,
      });
      return false;
    },
  },
  golden_pocket: {
    id: "golden_pocket",
    name: "Golden Pocket",
    desc: "+1 to every pocket multiplier.",
    rarity: "uncommon",
    bucketBonus: 1,
  },

  // --- passives ------------------------------------------------------------
  loaded_dice: { id: "loaded_dice", name: "Loaded Dice", desc: "The shop shows one more offer.", rarity: "common", extraOffers: 1 },
  wide_net: { id: "wide_net", name: "Wide Net", desc: "Edge pockets +2 multiplier.", rarity: "common", edgeBonus: 2 },
  warm_start: { id: "warm_start", name: "Warm Start", desc: "Every ball starts with 30 chips.", rarity: "common", startChips: 30 },
  momentum: { id: "momentum", name: "Momentum", desc: "Each ball starts with +0.2 mult per ball already landed this round.", rarity: "uncommon", momentum: 0.2 },
  grand_finale: { id: "grand_finale", name: "Grand Finale", desc: "The last ball of each round lands with mult ×2.", rarity: "uncommon", finaleMult: 2 },
  fresh_paint: { id: "fresh_paint", name: "Fresh Paint", desc: "Fresh pegs are worth +5 chips.", rarity: "common", freshChipBonus: 5 },
  echo: { id: "echo", name: "Echo", desc: "Already-lit pegs are worth +4 chips.", rarity: "common", repeatChipBonus: 4 },
  long_fuse: { id: "long_fuse", name: "Long Fuse", desc: "Combos stay alive 0.25 s longer.", rarity: "common", comboWindowBonus: 30 },
  milestone_maker: { id: "milestone_maker", name: "Milestone Maker", desc: "Combo milestones every 8 hits instead of 10.", rarity: "uncommon", milestoneDelta: -2 },
  insurance: { id: "insurance", name: "Insurance", desc: "Fail a round once and replay it instead of losing.", rarity: "rare", retries: 1 },
  duplicator: { id: "duplicator", name: "Duplicator", desc: "Ball offers in the shop give one more ball.", rarity: "common", ballOfferBonus: 1 },
  compound: { id: "compound", name: "Compound", desc: "Round score ×1.15 before the target check.", rarity: "uncommon", roundEndMult: 1.15 },
  sharpshooter: { id: "sharpshooter", name: "Sharpshooter", desc: "Land in the pocket you aimed at: mult ×1.5.", rarity: "uncommon", sharpshooter: 1.5 },
  low_gravity: {
    id: "low_gravity",
    name: "Low Gravity",
    desc: "All balls fall 20% slower and touch more pegs.",
    rarity: "uncommon",
    onSpawn(spawn) {
      return { ...spawn, gravityScale: (spawn.gravityScale ?? 1) * 0.8 };
    },
  },

  // --- elemental passives (permanent) --------------------------------------
  ember_core: { id: "ember_core", name: "Ember Core", desc: "20% of fresh hits ignite the peg. Burning pegs pay ×1.5 chips and spread.", rarity: "uncommon", igniteChance: 0.2 },
  frost_bite: { id: "frost_bite", name: "Frost Bite", desc: "6 pegs start each round frozen. Frozen pegs are glassy and shatter for chips.", rarity: "uncommon", frozenAtStart: 6 },
  static_field: { id: "static_field", name: "Static Field", desc: "Every 6th peg hit zaps the 2 nearest pegs.", rarity: "uncommon", zapEvery: 6 },
  conductor: { id: "conductor", name: "Conductor", desc: "Every lightning arc pays +6 chips.", rarity: "common", arcChips: 6 },
  melting_point: { id: "melting_point", name: "Melting Point", desc: "Steam (fire on ice) gives +2 extra mult.", rarity: "rare", steamMult: 2 },
  tinder: { id: "tinder", name: "Tinder", desc: "Burning pegs spread fire every time they are hit.", rarity: "common", spreadOnRepeat: true },
  elemental_surge: { id: "elemental_surge", name: "Elemental Surge", desc: "All elemental chip payouts ×2.", rarity: "rare", elementBoost: 2 },

  // --- temporary elemental actives -----------------------------------------
  firestorm: { id: "firestorm", name: "Firestorm", desc: "For 3 rounds every ball is Fire.", rarity: "uncommon", duration: 3, element: "fire" },
  deep_freeze: { id: "deep_freeze", name: "Deep Freeze", desc: "For 2 rounds every ball is Ice and 10 pegs start frozen.", rarity: "uncommon", duration: 2, element: "ice", frozenAtStart: 10 },
  thunderhead: { id: "thunderhead", name: "Thunderhead", desc: "For 3 rounds every ball is Storm.", rarity: "uncommon", duration: 3, element: "storm" },
  solstice: { id: "solstice", name: "Solstice", desc: "For 1 round: fire everywhere, 8 frozen pegs, arcs pay +10. Chaos.", rarity: "rare", duration: 1, element: "fire", frozenAtStart: 8, arcChips: 10, igniteChance: 0.5 },

  // --- board motion --------------------------------------------------------
  drift: { id: "drift", name: "Drift", desc: "For 1 round the pegs slide sideways, alternating rows in opposite directions.", rarity: "uncommon", duration: 1, pegDrift: { amplitude: 0.45, period: 3.2 } },
  restless_board: { id: "restless_board", name: "Restless Board", desc: "Pegs never quite sit still.", rarity: "rare", pegDrift: { amplitude: 0.14, period: 2.1 } },

  // --- pockets -------------------------------------------------------------
  roulette: { id: "roulette", name: "Roulette", desc: "The pocket multipliers rotate one slot after every landing.", rarity: "uncommon", pocketRotate: 1 },
  hot_pocket: { id: "hot_pocket", name: "Hot Pocket", desc: "The pocket you land in gains +1 for the round (up to +5).", rarity: "common", hotPocket: 1, hotPocketCap: 5 },
  groove: { id: "groove", name: "Groove", desc: "Land in the same pocket again: ×1.5 mult, then ×2, ×2.5…", rarity: "uncommon", groove: 0.5 },
  jackpot_growth: { id: "jackpot_growth", name: "Jackpot Growth", desc: "Centre pocket +1 for every round you clear this run.", rarity: "rare", jackpotGrowth: 1 },
  pocket_lottery: { id: "pocket_lottery", name: "Pocket Lottery", desc: "Each round one pocket is drawn and carries +3.", rarity: "common", lottery: 3 },
  inversion: { id: "inversion", name: "Inversion", desc: "For 1 round the edges are the jackpots and the centre pays ×1.", rarity: "uncommon", duration: 1, invertPockets: true },

  // --- combo economy -------------------------------------------------------
  echo_chamber: { id: "echo_chamber", name: "Echo Chamber", desc: "Combo events fire every 40 hits instead of 50.", rarity: "rare", eventEveryDelta: -10 },
  second_wind: { id: "second_wind", name: "Second Wind", desc: "When a combo of 60+ ends, gain a ball (once per round).", rarity: "uncommon", secondWindAt: 60 },
  overclock: { id: "overclock", name: "Overclock", desc: "Combos stay alive 0.15 s longer, but milestones come every 12 hits.", rarity: "uncommon", comboWindowBonus: 18, milestoneDelta: 2 },
};

export const CHARM_IDS = Object.keys(CHARMS) as CharmId[];
