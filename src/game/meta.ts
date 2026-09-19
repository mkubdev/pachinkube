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
import { BALL_IDS, BALL_TYPES, type BallTypeId } from "./balls";
import { CHARMS, CHARM_IDS, type CharmId } from "./charms";
import type { GameEvent, Offer, Run } from "./run";

export const META_VERSION = 1;

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
}

export interface MetaState {
  version: number;
  stats: MetaStats;
  discovered: { charms: CharmId[]; balls: BallTypeId[] };
  feats: Partial<Record<FeatId, string>>; // ISO date achieved
  /** Unlock ids already announced, so the toast fires once. */
  announced: string[];
}

export function emptyMeta(): MetaState {
  return {
    version: META_VERSION,
    stats: {
      runs: 0, wins: 0, losses: 0, ballsDropped: 0, pegHits: 0, jackpots: 0,
      roundsCleared: 0, bestRound: 0, bestCombo: 0, bestScore: 0, bestBallScore: 0, totalScore: 0,
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
  // balls
  { kind: "ball", id: "gold", stat: "roundsCleared", value: 3, hint: "Clear 3 rounds (lifetime)" },
  { kind: "ball", id: "feather", stat: "ballsDropped", value: 100, hint: "Drop 100 balls" },
  { kind: "ball", id: "cannon", stat: "bestCombo", value: 30, hint: "Reach a 30 combo" },
  { kind: "ball", id: "magnet", stat: "jackpots", value: 10, hint: "Land 10 balls in the centre pocket" },
  { kind: "ball", id: "twin", stat: "bestRound", value: 4, hint: "Reach round 4" },
  { kind: "ball", id: "prism", stat: "pegHits", value: 2000, hint: "Hit 2,000 pegs" },
  { kind: "ball", id: "bomb", stat: "bestCombo", value: 50, hint: "Reach a 50 combo" },
  // charms
  { kind: "charm", id: "split_shot", stat: "bestCombo", value: 25, hint: "Reach a 25 combo" },
  { kind: "charm", id: "sharpshooter", stat: "jackpots", value: 5, hint: "Land 5 balls in the centre pocket" },
  { kind: "charm", id: "grand_finale", stat: "bestRound", value: 4, hint: "Reach round 4" },
  { kind: "charm", id: "momentum", stat: "ballsDropped", value: 200, hint: "Drop 200 balls" },
  { kind: "charm", id: "compound", stat: "totalScore", value: 100_000, hint: "Score 100K across all runs" },
  { kind: "charm", id: "bumper_kings", stat: "bestRound", value: 5, hint: "Reach round 5" },
  { kind: "charm", id: "overflow", stat: "bestBallScore", value: 5000, hint: "Score 5,000 with a single ball" },
  { kind: "charm", id: "phoenix", stat: "losses", value: 3, hint: "Lose 3 runs" },
  { kind: "charm", id: "insurance", stat: "bestRound", value: 6, hint: "Reach round 6" },
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

export type FeatId =
  | "first_win" | "combo_25" | "combo_50" | "combo_100" | "first_bomb" | "first_split"
  | "first_revive" | "first_bullseye" | "ball_5k" | "ball_50k" | "round_5" | "run_1m" | "jackpot_streak";

export const FEATS: Record<FeatId, { name: string; desc: string }> = {
  first_win: { name: "Machine Cleared", desc: "Beat round 8. The machine keeps going." },
  combo_25: { name: "Warming Up", desc: "Reach a 25 combo." },
  combo_50: { name: "Overdrive", desc: "Reach a 50 combo." },
  combo_100: { name: "Meltdown", desc: "Reach a 100 combo." },
  first_bomb: { name: "Fire in the Hole", desc: "Detonate a Bomb ball." },
  first_split: { name: "Mitosis", desc: "Trigger Split Shot." },
  first_revive: { name: "Rise Again", desc: "Have Phoenix relaunch a ball." },
  first_bullseye: { name: "Called It", desc: "Sharpshooter pays out." },
  ball_5k: { name: "Fat Ball", desc: "Score 5,000 with one ball." },
  ball_50k: { name: "Obese Ball", desc: "Score 50,000 with one ball." },
  round_5: { name: "Deep Machine", desc: "Reach round 5." },
  run_1m: { name: "Seven Digits", desc: "Score 1,000,000 in a run." },
  jackpot_streak: { name: "Dead Centre", desc: "Land 3 balls in a row in the centre pocket." },
};

export type MetaNotice =
  | { kind: "discover"; what: "charm" | "ball"; id: string; label: string }
  | { kind: "unlock"; what: "charm" | "ball"; id: string; label: string }
  | { kind: "feat"; id: FeatId; label: string };

// --- recording -----------------------------------------------------------------

function discover(meta: MetaState, what: "charm" | "ball", id: string, out: MetaNotice[]): void {
  const list = meta.discovered[what === "charm" ? "charms" : "balls"] as string[];
  if (list.includes(id)) return;
  list.push(id);
  const label = what === "charm" ? CHARMS[id as CharmId].name : BALL_TYPES[id as BallTypeId].name;
  out.push({ kind: "discover", what, id, label });
}

function feat(meta: MetaState, id: FeatId, out: MetaNotice[], now: () => string): void {
  if (meta.feats[id]) return;
  meta.feats[id] = now();
  out.push({ kind: "feat", id, label: FEATS[id].name });
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
}

export function newTracker(): RunTracker {
  return { jackpotStreak: 0 };
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
  for (const e of events) {
    switch (e.type) {
      case "pegHit":
        s.pegHits++;
        discover(meta, "ball", e.tag, out);
        break;
      case "combo":
        if (e.count > s.bestCombo) s.bestCombo = e.count;
        if (e.count >= 25) feat(meta, "combo_25", out, now);
        if (e.count >= 50) feat(meta, "combo_50", out, now);
        if (e.count >= 100) feat(meta, "combo_100", out, now);
        break;
      case "ballScored": {
        const centre = (run.sim.config.buckets - 1) / 2;
        if (e.bucket === centre) {
          s.jackpots++;
          tracker.jackpotStreak++;
          if (tracker.jackpotStreak >= 3) feat(meta, "jackpot_streak", out, now);
        } else tracker.jackpotStreak = 0;
        if (e.score > s.bestBallScore) s.bestBallScore = e.score;
        if (e.score >= 5000) feat(meta, "ball_5k", out, now);
        if (e.score >= 50_000) feat(meta, "ball_50k", out, now);
        break;
      }
      case "fx":
        if (e.kind === "bomb") feat(meta, "first_bomb", out, now);
        else if (e.kind === "split") feat(meta, "first_split", out, now);
        else if (e.kind === "revive") feat(meta, "first_revive", out, now);
        else if (e.kind === "bullseye") feat(meta, "first_bullseye", out, now);
        break;
      case "roundEnd":
        if (e.passed) {
          s.roundsCleared++;
          if (e.round + 1 > s.bestRound) s.bestRound = e.round + 1;
          if (e.round + 1 >= 5) feat(meta, "round_5", out, now);
        }
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
  if (run.totalScore >= 1_000_000) feat(meta, "run_1m", out, now);
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
  checkUnlocks(meta, out);
  return out;
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

function fresh(): MetaState {
  const m = emptyMeta();
  settleAnnouncements(m);
  return m;
}
