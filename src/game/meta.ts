/**
 * Meta-progression: what persists between runs.
 *
 * Pure data + pure functions, no DOM: the same module will run server-side
 * per Discord user once auth is live. Persistence is behind `MetaStore`.
 *
 * Three ideas:
 * - discoveries: the first time you see a charm/ball, it enters the collection
 * - feats: one-off moments (first 50-combo, first Bomb detonation, ...)
 * - unlocks: rarer content gated behind lifetime stats, so runs 2–20 keep
 *   changing what the shop can offer
 */
import { BALL_IDS, BALL_TYPES, type BallTypeId } from "./balls.js";
import { CHARMS, CHARM_IDS, type CharmId } from "./charms.js";
import type { GameEvent, Offer, Run } from "./run.js";

export const META_VERSION = 3; // 3: second-wave reset — 24-ball ladder, gated charm tiers

export interface MetaStats {
  runs: number;
  wins: number;
  losses: number;
  ballsDropped: number;
  pegHits: number;
  jackpots: number;
  roundsCleared: number;
  bestRound: number;
  bestCombo: number;
  bestScore: number;
  bestBallScore: number;
  totalScore: number;
  /** Elemental reactions of any kind, and steam specifically. */
  reactions: number;
  steams: number;
  /** Combo events fired, and portal rides taken. */
  comboEvents: number;
  portals: number;
  /** Balls popped off bumper pegs. */
  bumperHits: number;
}

export interface MetaState {
  version: number;
  stats: MetaStats;
  discovered: { charms: CharmId[]; balls: BallTypeId[] };
  feats: Partial<Record<string, string>>; // feat id -> ISO date achieved
  /** Unlock ids already announced, so the toast fires once. */
  announced: string[];
  /**
   * Server reset generation. A progression wipe bumps the server's epoch;
   * any profile carrying another epoch is discarded by the client and refused
   * by the server, so a wipe reaches every device — including tabs that were
   * open during it — without a version bump.
   */
  epoch?: number;
}

export function emptyMeta(): MetaState {
  return {
    version: META_VERSION,
    stats: {
      runs: 0, wins: 0, losses: 0, ballsDropped: 0, pegHits: 0, jackpots: 0,
      roundsCleared: 0, bestRound: 0, bestCombo: 0, bestScore: 0, bestBallScore: 0, totalScore: 0,
      reactions: 0, steams: 0, comboEvents: 0, portals: 0, bumperHits: 0,
    },
    discovered: { charms: [], balls: ["steel"] },
    feats: {},
    announced: [],
  };
}

// --- unlock rules -----------------------------------------------------------

export type StatKey = keyof MetaStats;

export interface UnlockRule {
  kind: "charm" | "ball";
  id: CharmId | BallTypeId;
  stat: StatKey;
  value: number;
  /** Shown on the locked card. */
  hint: string;
}

/** Content not listed here is available from the first run. */
export const UNLOCK_RULES: UnlockRule[] = [
  // balls: one ladder, lifetime peg hits. Steel is all you start with.
  ...(
    [
      ["rubber", 400], ["heavy", 1_000], ["spark", 2_000], ["gold", 3_500], ["feather", 5_000],
      ["cannon", 7_500], ["ricochet", 10_000], ["orbit", 13_000], ["twin", 16_000], ["ember", 20_000],
      ["prism", 24_000], ["frost", 28_000], ["bomb", 33_000], ["volt", 38_000], ["mirror", 44_000],
      ["cluster", 50_000], ["comet", 57_000], ["anchor", 65_000], ["glass", 75_000], ["pearl", 85_000],
      ["rainbow", 100_000], ["boomerang", 115_000], ["quantum", 130_000], ["abyss", 150_000],
    ] as Array<[BallTypeId, number]>
  ).map(([id, value]) => ({ kind: "ball" as const, id, stat: "pegHits" as const, value, hint: `Hit ${value.toLocaleString("en-US")} pegs (lifetime)` })),
  // charms: the first runs unlock something every time, then it slows down
  { kind: "charm", id: "wide_net", stat: "runs", value: 2, hint: "Play a 2nd run" },
  { kind: "charm", id: "duplicator", stat: "runs", value: 3, hint: "Play a 3rd run" },
  { kind: "charm", id: "long_fuse", stat: "bestCombo", value: 20, hint: "Reach a 20 combo" },
  { kind: "charm", id: "milestone_maker", stat: "bestCombo", value: 30, hint: "Reach a 30 combo" },
  { kind: "charm", id: "low_gravity", stat: "ballsDropped", value: 150, hint: "Drop 150 balls" },
  { kind: "charm", id: "hot_pocket", stat: "roundsCleared", value: 3, hint: "Clear 3 rounds (lifetime)" },
  { kind: "charm", id: "pocket_lottery", stat: "jackpots", value: 6, hint: "Land 6 balls in the centre pocket" },
  { kind: "charm", id: "groove", stat: "roundsCleared", value: 8, hint: "Clear 8 rounds (lifetime)" },
  { kind: "charm", id: "split_shot", stat: "bestCombo", value: 40, hint: "Reach a 40 combo" },
  { kind: "charm", id: "chain_lightning", stat: "roundsCleared", value: 5, hint: "Clear 5 rounds (lifetime)" },
  { kind: "charm", id: "sharpshooter", stat: "jackpots", value: 12, hint: "Land 12 balls in the centre pocket" },
  { kind: "charm", id: "grand_finale", stat: "bestRound", value: 4, hint: "Reach round 4" },
  { kind: "charm", id: "momentum", stat: "ballsDropped", value: 400, hint: "Drop 400 balls" },
  { kind: "charm", id: "compound", stat: "totalScore", value: 500_000, hint: "Score 500K across all runs" },
  { kind: "charm", id: "bumper_kings", stat: "bestRound", value: 5, hint: "Reach round 5" },
  { kind: "charm", id: "overflow", stat: "bestBallScore", value: 25_000, hint: "Score 25,000 with a single ball" },
  { kind: "charm", id: "phoenix", stat: "losses", value: 3, hint: "Lose 3 runs" },
  { kind: "charm", id: "insurance", stat: "bestRound", value: 6, hint: "Reach round 6" },
  // elemental: the three basics are open, everything else is earned with reactions
  { kind: "charm", id: "conductor", stat: "reactions", value: 40, hint: "Trigger 40 elemental reactions" },
  { kind: "charm", id: "firestorm", stat: "reactions", value: 60, hint: "Trigger 60 elemental reactions" },
  { kind: "charm", id: "tinder", stat: "reactions", value: 80, hint: "Trigger 80 elemental reactions" },
  { kind: "charm", id: "flashpoint", stat: "reactions", value: 100, hint: "Trigger 100 elemental reactions" },
  { kind: "charm", id: "deep_freeze", stat: "reactions", value: 120, hint: "Trigger 120 elemental reactions" },
  { kind: "charm", id: "backdraft", stat: "reactions", value: 150, hint: "Trigger 150 elemental reactions" },
  { kind: "charm", id: "lightning_rod", stat: "reactions", value: 300, hint: "Trigger 300 elemental reactions" },
  { kind: "charm", id: "aurora", stat: "reactions", value: 500, hint: "Trigger 500 elemental reactions" },
  { kind: "charm", id: "permafrost", stat: "steams", value: 10, hint: "Trigger 10 steam reactions" },
  { kind: "charm", id: "thermal_shock", stat: "steams", value: 60, hint: "Trigger 60 steam reactions" },
  { kind: "charm", id: "cold_snap", stat: "roundsCleared", value: 12, hint: "Clear 12 rounds (lifetime)" },
  { kind: "charm", id: "ball_lightning", stat: "bestCombo", value: 60, hint: "Reach a 60 combo" },
  { kind: "charm", id: "melting_point", stat: "steams", value: 30, hint: "Trigger 30 steam reactions" },
  // bumpers
  { kind: "charm", id: "pop_bumpers", stat: "roundsCleared", value: 5, hint: "Clear 5 rounds (lifetime)" },
  { kind: "charm", id: "super_bumpers", stat: "bestCombo", value: 50, hint: "Reach a 50 combo" },
  { kind: "charm", id: "bumper_crown", stat: "bumperHits", value: 150, hint: "Pop off 150 bumpers" },
  { kind: "charm", id: "elemental_surge", stat: "reactions", value: 800, hint: "Trigger 800 elemental reactions" },
  { kind: "charm", id: "solstice", stat: "bestRound", value: 7, hint: "Reach round 7" },
  { kind: "charm", id: "thunderhead", stat: "reactions", value: 200, hint: "Trigger 200 elemental reactions" },
  { kind: "charm", id: "drift", stat: "bestRound", value: 4, hint: "Reach round 4" },
  { kind: "charm", id: "roulette", stat: "jackpots", value: 40, hint: "Land 40 balls in the centre pocket" },
  { kind: "charm", id: "jackpot_growth", stat: "bestRound", value: 8, hint: "Reach round 8" },
  { kind: "charm", id: "inversion", stat: "roundsCleared", value: 25, hint: "Clear 25 rounds (lifetime)" },
  { kind: "charm", id: "echo_chamber", stat: "comboEvents", value: 10, hint: "Trigger 10 combo events" },
  { kind: "charm", id: "second_wind", stat: "bestCombo", value: 80, hint: "Reach an 80 combo" },
  { kind: "charm", id: "overclock", stat: "bestRound", value: 10, hint: "Reach round 10" },
  { kind: "charm", id: "restless_board", stat: "roundsCleared", value: 40, hint: "Clear 40 rounds (lifetime)" },
];

export function ruleFor(kind: "charm" | "ball", id: string): UnlockRule | undefined {
  return UNLOCK_RULES.find((r) => r.kind === kind && r.id === id);
}

export function isUnlocked(meta: MetaState, kind: "charm" | "ball", id: string): boolean {
  const rule = ruleFor(kind, id);
  return !rule || meta.stats[rule.stat] >= rule.value;
}

export function unlockProgress(meta: MetaState, rule: UnlockRule): { current: number; target: number } {
  return { current: Math.min(meta.stats[rule.stat], rule.value), target: rule.value };
}

export interface Pool {
  charms: CharmId[];
  balls: BallTypeId[];
}

/** What the shop may roll for this player right now. */
export function unlockedPool(meta: MetaState): Pool {
  return {
    charms: CHARM_IDS.filter((id) => isUnlocked(meta, "charm", id)),
    balls: BALL_IDS.filter((id) => id !== "steel" && BALL_TYPES[id].shopWeight > 0 && isUnlocked(meta, "ball", id)),
  };
}

export const FULL_POOL: Pool = {
  charms: [...CHARM_IDS],
  balls: BALL_IDS.filter((id) => id !== "steel" && BALL_TYPES[id].shopWeight > 0),
};

// --- feats (discoveries you *do*) ---------------------------------------------

/** Feats earned by crossing a lifetime/best stat. Generated into FEATS below. */
export interface ThresholdFeat {
  id: string;
  name: string;
  desc: string;
  stat: StatKey;
  value: number;
}

const tier = (stat: StatKey, prefix: string, names: string[], values: number[], fmt: (v: number) => string): ThresholdFeat[] =>
  values.map((value, i) => ({ id: `${prefix}_${value}`, name: names[i]!, desc: fmt(value), stat, value }));

export const THRESHOLD_FEATS: ThresholdFeat[] = [
  ...tier("bestCombo", "combo", ["Warming Up", "Overdrive", "Meltdown", "Critical Mass", "Singularity", "Event Horizon", "Beyond"], [40, 80, 150, 200, 300, 400, 500], (v) => `Reach a ${v} combo.`),
  ...tier("bestScore", "run", ["Six Digits", "Seven Digits", "Whale", "Leviathan", "Kraken"], [250_000, 1_000_000, 5_000_000, 25_000_000, 100_000_000], (v) => `Score ${v.toLocaleString("en-US")} in one run.`),
  ...tier("bestBallScore", "ball", ["Fat Ball", "Obese Ball", "Planet", "Star", "Black Hole"], [5_000, 50_000, 500_000, 5_000_000, 50_000_000], (v) => `Score ${v.toLocaleString("en-US")} with one ball.`),
  ...tier("bestRound", "round", ["Deep Machine", "Double Digits", "Bottomless", "Abyss", "The Void"], [5, 10, 15, 20, 30], (v) => `Reach round ${v}.`),
  ...tier("runs", "runs", ["Regular", "Habit", "Lifer"], [10, 50, 200], (v) => `Play ${v} runs.`),
  ...tier("wins", "wins", ["Cleared Twice", "Clearing House", "Machine Whisperer"], [2, 10, 50], (v) => `Clear the machine ${v} times.`),
  ...tier("ballsDropped", "drops", ["Bucket", "Truckload", "Avalanche of Steel"], [500, 2_500, 10_000], (v) => `Drop ${v.toLocaleString("en-US")} balls.`),
  ...tier("pegHits", "pegs", ["Percussionist", "Drummer", "Thunderstorm"], [5_000, 25_000, 100_000], (v) => `Hit ${v.toLocaleString("en-US")} pegs.`),
  ...tier("jackpots", "jackpots", ["Marksman", "Sniper", "Dead Eye"], [25, 100, 500], (v) => `Land ${v} balls in the centre pocket.`),
  ...tier("reactions", "reactions", ["Chemist", "Alchemist", "Elementalist"], [250, 1_000, 5_000], (v) => `Trigger ${v.toLocaleString("en-US")} elemental reactions.`),
  ...tier("comboEvents", "events", ["Trigger Happy", "Chaos Agent", "Storm Chaser"], [5, 25, 100], (v) => `Fire ${v} combo events.`),
  ...tier("portals", "portals", ["Round Trip", "Frequent Flyer"], [5, 25], (v) => `Ride the portal ${v} times.`),
  ...tier("steams", "steams", ["Kettle", "Boiler", "Geyser"], [10, 100, 500], (v) => `Trigger ${v} steam reactions.`),
  ...tier("roundsCleared", "cleared", ["Journeyman", "Veteran", "Machine Spirit"], [25, 100, 400], (v) => `Clear ${v} rounds (lifetime).`),
  ...tier("totalScore", "total", ["Millionaire", "Multimillionaire", "Billionaire"], [1_000_000, 10_000_000, 1_000_000_000], (v) => `Score ${v.toLocaleString("en-US")} across all runs.`),
  ...tier("losses", "losses", ["Bruised", "Stubborn", "Unbreakable"], [5, 25, 100], (v) => `Lose ${v} runs and come back.`),
  ...tier("bumperHits", "bumpers", ["Pinball", "Wizard", "Tilt"], [50, 500, 5000], (v) => `Pop off ${v} bumpers.`),
];

const MOMENT_FEATS = {
  first_win: { name: "Machine Cleared", desc: "Beat round 8. The machine keeps going." },
  first_bomb: { name: "Fire in the Hole", desc: "Detonate a Bomb ball." },
  first_split: { name: "Mitosis", desc: "Trigger Split Shot." },
  first_revive: { name: "Rise Again", desc: "Have Phoenix relaunch a ball." },
  first_bullseye: { name: "Called It", desc: "Sharpshooter pays out." },
  jackpot_streak: { name: "Dead Centre", desc: "Land 3 balls in a row in the centre pocket." },
  first_steam: { name: "Steam Engine", desc: "Melt a frozen peg with fire." },
  first_wildfire: { name: "Wildfire", desc: "Hit a burning peg with a Storm ball." },
  first_shatter_chain: { name: "Glass Cannon", desc: "Shatter a frozen chain with Storm." },
  big_shatter: { name: "Avalanche", desc: "Shatter 8 or more frozen pegs at once." },
  first_laser: { name: "Pew", desc: "See a Laser Sweep." },
  first_portal: { name: "Wormhole", desc: "Open a Portal." },
  first_quake: { name: "Richter", desc: "Survive a Quake." },
  first_rain: { name: "Hailstorm", desc: "Watch Ball Rain fall." },
  first_gravity_flip: { name: "Upside Down", desc: "Flip gravity." },
  first_magnet_storm: { name: "Attractive", desc: "Summon a Magnet Storm." },
  first_slowmo: { name: "Bullet Time", desc: "Bend time." },
  full_hand: { name: "Full Hand", desc: "Hold 10 charms at once." },
  five_in_flight: { name: "Juggler", desc: "Have 8 balls in play at the same time." },
  // second wave
  first_thicken: { name: "Thick Ice", desc: "Thicken a frozen peg with Ice." },
  first_flare: { name: "Flare-Up", desc: "Hit a burning peg with Fire." },
  first_blink: { name: "Blink", desc: "Watch a Quantum ball teleport." },
  first_boomerang: { name: "Comeback", desc: "A Boomerang returns to the top." },
  first_collapse: { name: "Event Horizon", desc: "An Abyss ball lands while others are still in flight." },
  trinity: { name: "Trinity", desc: "Fire, ice and storm on the board at the same time." },
  inferno: { name: "Inferno", desc: "15 pegs burning at once." },
  glacier: { name: "Glacier", desc: "15 pegs frozen at once." },
  power_grid: { name: "Power Grid", desc: "10 pegs charged at once." },
  hat_trick: { name: "Hat Trick", desc: "Fire 3 combo events in one round." },
  grand_tour: { name: "Grand Tour", desc: "Land in every pocket during one round." },
  overkill: { name: "Overkill", desc: "Score 10× the target in a single round." },
  clutch: { name: "Clutch", desc: "Pass a round only thanks to its very last ball." },
  hoarder: { name: "Hoarder", desc: "Own 20 balls." },
} as const;

export type FeatId = keyof typeof MOMENT_FEATS | (typeof THRESHOLD_FEATS)[number]["id"];

export const FEATS: Record<string, { name: string; desc: string }> = {
  ...MOMENT_FEATS,
  ...Object.fromEntries(THRESHOLD_FEATS.map((f) => [f.id, { name: f.name, desc: f.desc }])),
};

export type MetaNotice =
  | { kind: "discover"; what: "charm" | "ball"; id: string; label: string }
  | { kind: "unlock"; what: "charm" | "ball"; id: string; label: string }
  | { kind: "feat"; id: string; label: string };

// --- recording -----------------------------------------------------------------

function discover(meta: MetaState, what: "charm" | "ball", id: string, out: MetaNotice[]): void {
  const list = meta.discovered[what === "charm" ? "charms" : "balls"] as string[];
  if (list.includes(id)) return;
  list.push(id);
  const label = what === "charm" ? CHARMS[id as CharmId].name : BALL_TYPES[id as BallTypeId].name;
  out.push({ kind: "discover", what, id, label });
}

function feat(meta: MetaState, id: string, out: MetaNotice[], now: () => string): void {
  if (meta.feats[id] || !FEATS[id]) return;
  meta.feats[id] = now();
  out.push({ kind: "feat", id, label: FEATS[id].name });
}

/** Stat-threshold feats: evaluated after every stats change. */
function checkThresholdFeats(meta: MetaState, out: MetaNotice[], now: () => string): void {
  for (const f of THRESHOLD_FEATS) if (meta.stats[f.stat] >= f.value) feat(meta, f.id, out, now);
}

/** Compare unlock state before/after a stats change and announce new ones once. */
function checkUnlocks(meta: MetaState, out: MetaNotice[]): void {
  for (const r of UNLOCK_RULES) {
    const key = `${r.kind}:${r.id}`;
    if (meta.announced.includes(key) || !isUnlocked(meta, r.kind, r.id)) continue;
    meta.announced.push(key);
    const label = r.kind === "charm" ? CHARMS[r.id as CharmId].name : BALL_TYPES[r.id as BallTypeId].name;
    out.push({ kind: "unlock", what: r.kind, id: r.id, label });
  }
}

/** Mark everything already unlocked as announced (fresh profiles, migrations). */
export function settleAnnouncements(meta: MetaState): void {
  for (const r of UNLOCK_RULES) {
    const key = `${r.kind}:${r.id}`;
    if (isUnlocked(meta, r.kind, r.id) && !meta.announced.includes(key)) meta.announced.push(key);
  }
}

export interface RunTracker {
  jackpotStreak: number;
  /** Per-round bookkeeping for Grand Tour, Hat Trick and Clutch; reset on roundEnd. */
  pocketsThisRound: number[];
  eventsThisRound: number;
  lastBallScore: number;
}

export function newTracker(): RunTracker {
  return { jackpotStreak: 0, pocketsThisRound: [], eventsThisRound: 0, lastBallScore: 0 };
}

export function recordRunStart(meta: MetaState): void {
  meta.stats.runs++;
}

/** Fold one step's events into the profile. Returns notices for toasts. */
export function recordEvents(
  meta: MetaState,
  events: GameEvent[],
  run: Run,
  tracker: RunTracker,
  now: () => string = () => new Date().toISOString(),
): MetaNotice[] {
  const out: MetaNotice[] = [];
  const s = meta.stats;
  let boardFeats = false;
  for (const e of events) {
    switch (e.type) {
      case "pegHit":
        s.pegHits++;
        discover(meta, "ball", e.tag, out);
        break;
      case "combo":
        if (e.count > s.bestCombo) s.bestCombo = e.count;
        break;
      case "comboEvent":
        s.comboEvents++;
        feat(meta, `first_${e.kind}`, out, now);
        if (++tracker.eventsThisRound >= 3) feat(meta, "hat_trick", out, now);
        break;
      case "portal":
        s.portals++;
        break;
      case "blink":
        feat(meta, "first_blink", out, now);
        break;
      case "bumper":
        s.bumperHits++;
        break;
      case "ballScored": {
        const centre = (run.sim.config.buckets - 1) / 2;
        if (e.bucket === centre) {
          s.jackpots++;
          tracker.jackpotStreak++;
          if (tracker.jackpotStreak >= 3) feat(meta, "jackpot_streak", out, now);
        } else tracker.jackpotStreak = 0;
        if (e.score > s.bestBallScore) s.bestBallScore = e.score;
        tracker.lastBallScore = e.score;
        if (e.bucket >= 0 && !tracker.pocketsThisRound.includes(e.bucket)) tracker.pocketsThisRound.push(e.bucket);
        if (tracker.pocketsThisRound.length >= run.sim.config.buckets) feat(meta, "grand_tour", out, now);
        break;
      }
      case "element":
        s.reactions++;
        if (e.kind === "steam") {
          s.steams++;
          feat(meta, "first_steam", out, now);
        } else if (e.kind === "wildfire") feat(meta, "first_wildfire", out, now);
        else if (e.kind === "shatter_chain") {
          feat(meta, "first_shatter_chain", out, now);
          if (e.count >= 8) feat(meta, "big_shatter", out, now);
        } else if (e.kind === "shatter" && e.count >= 8) feat(meta, "big_shatter", out, now);
        else if (e.kind === "thicken") feat(meta, "first_thicken", out, now);
        else if (e.kind === "flare") feat(meta, "first_flare", out, now);
        boardFeats = true;
        break;
      case "fx":
        if (e.kind === "bomb") feat(meta, "first_bomb", out, now);
        else if (e.kind === "split") feat(meta, "first_split", out, now);
        else if (e.kind === "revive") feat(meta, "first_revive", out, now);
        else if (e.kind === "bullseye") feat(meta, "first_bullseye", out, now);
        else if (e.kind === "boomerang") feat(meta, "first_boomerang", out, now);
        else if (e.kind === "collapse") feat(meta, "first_collapse", out, now);
        break;
      case "roundEnd":
        if (e.passed) {
          s.roundsCleared++;
          if (e.round + 1 > s.bestRound) s.bestRound = e.round + 1;
          if (e.roundScore >= e.target * 10) feat(meta, "overkill", out, now);
          if (tracker.lastBallScore > 0 && e.roundScore - tracker.lastBallScore < e.target) feat(meta, "clutch", out, now);
        }
        tracker.pocketsThisRound = [];
        tracker.eventsThisRound = 0;
        tracker.lastBallScore = 0;
        break;
      case "cleared":
        // Endless runs: "winning" means clearing round 8; the run continues.
        s.wins++;
        feat(meta, "first_win", out, now);
        break;
      case "phase":
        if (e.phase === "won") {
          // Finite runs (tests / future modes) still count as a clear.
          if (!run.cleared) s.wins++;
          feat(meta, "first_win", out, now);
        } else if (e.phase === "lost") s.losses++;
        break;
      default:
        break;
    }
  }
  if (run.totalScore > s.bestScore) s.bestScore = run.totalScore;
  if (run.charms.length >= 10) feat(meta, "full_hand", out, now);
  if (run.inFlight >= 8) feat(meta, "five_in_flight", out, now);
  if ((run.ownedBalls?.length ?? 0) >= 20) feat(meta, "hoarder", out, now);
  // Board-state feats only when an element changed this step (cheap, and the
  // fakes in tests may not carry a peg map at all).
  if (boardFeats && run.pegElements instanceof Map) {
    let fire = 0, ice = 0, storm = 0;
    for (const st of run.pegElements.values()) {
      if (st.el === "fire") fire++;
      else if (st.el === "ice") ice++;
      else storm++;
    }
    if (fire && ice && storm) feat(meta, "trinity", out, now);
    if (fire >= 15) feat(meta, "inferno", out, now);
    if (ice >= 15) feat(meta, "glacier", out, now);
    if (storm >= 10) feat(meta, "power_grid", out, now);
  }
  checkThresholdFeats(meta, out, now);
  checkUnlocks(meta, out);
  return out;
}

export function recordDrop(meta: MetaState): void {
  meta.stats.ballsDropped++;
}

/** Seeing something in the shop counts as discovering it. */
export function recordOffers(meta: MetaState, offers: Offer[]): MetaNotice[] {
  const out: MetaNotice[] = [];
  for (const o of offers) discover(meta, o.kind, o.id, out);
  return out;
}

export function recordRunEnd(meta: MetaState, run: Run): MetaNotice[] {
  const out: MetaNotice[] = [];
  const s = meta.stats;
  s.totalScore += run.totalScore;
  if (run.totalScore > s.bestScore) s.bestScore = run.totalScore;
  for (const c of run.charms) discover(meta, "charm", c, out);
  checkThresholdFeats(meta, out, () => new Date().toISOString());
  checkUnlocks(meta, out);
  return out;
}

// --- merging ---------------------------------------------------------------------

/**
 * Combine two profiles (e.g. this browser's and the server's). Stats take the
 * max — they are all monotonic — discoveries union, feats keep the earliest.
 * Safe to apply in either direction, repeatedly.
 */
export function mergeMeta(a: MetaState, b: MetaState): MetaState {
  const out = emptyMeta();
  for (const k of Object.keys(out.stats) as StatKey[]) out.stats[k] = Math.max(a.stats[k] ?? 0, b.stats[k] ?? 0);
  out.discovered.charms = [...new Set([...a.discovered.charms, ...b.discovered.charms])];
  out.discovered.balls = [...new Set([...a.discovered.balls, ...b.discovered.balls])];
  const featIds = new Set([...Object.keys(a.feats), ...Object.keys(b.feats)]) as Set<FeatId>;
  for (const id of featIds) {
    const x = a.feats[id];
    const y = b.feats[id];
    out.feats[id] = x && y ? (x < y ? x : y) : (x ?? y);
  }
  out.announced = [...new Set([...a.announced, ...b.announced])];
  out.epoch = a.epoch ?? b.epoch;
  settleAnnouncements(out);
  return out;
}

/** Turn `meta` into a fresh profile in place (callers keep their reference). */
export function resetMeta(meta: MetaState, epoch: number): MetaState {
  const f = freshMeta(epoch);
  for (const k of Object.keys(meta)) delete (meta as unknown as Record<string, unknown>)[k];
  return Object.assign(meta, f);
}

/** Shape check for profiles arriving over the network. */
export function validateMeta(x: unknown): x is MetaState {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Partial<MetaState>;
  if (m.version !== META_VERSION || typeof m.stats !== "object" || m.stats === null) return false;
  for (const v of Object.values(m.stats)) if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return false;
  if (!m.discovered || !Array.isArray(m.discovered.charms) || !Array.isArray(m.discovered.balls)) return false;
  if (typeof m.feats !== "object" || m.feats === null) return false;
  if (m.epoch !== undefined && (typeof m.epoch !== "number" || !Number.isInteger(m.epoch) || m.epoch < 0)) return false;
  return true;
}

// --- persistence ---------------------------------------------------------------

export interface MetaStore {
  load(): MetaState;
  save(meta: MetaState): void;
}

/** Minimal storage shape so tests can pass a Map-backed fake. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const META_KEY = "pachinkube.meta.v1";

export class LocalMetaStore implements MetaStore {
  constructor(private readonly kv: KeyValue | null) {}

  load(): MetaState {
    try {
      const raw = this.kv?.getItem(META_KEY);
      if (!raw) return fresh();
      const parsed = JSON.parse(raw) as Partial<MetaState>;
      if (parsed.version !== META_VERSION) return fresh();
      const meta = { ...emptyMeta(), ...parsed, stats: { ...emptyMeta().stats, ...(parsed.stats ?? {}) } };
      return meta;
    } catch {
      return fresh();
    }
  }

  save(meta: MetaState): void {
    try {
      this.kv?.setItem(META_KEY, JSON.stringify(meta));
    } catch {
      // Private mode / quota: progression simply does not persist this session.
    }
  }
}

export function freshMeta(epoch?: number): MetaState {
  const m = emptyMeta();
  if (epoch !== undefined) m.epoch = epoch;
  settleAnnouncements(m);
  return m;
}

const fresh = (): MetaState => freshMeta();
