/**
 * The roguelite run: rounds, targets, a bag of balls, charms, and a shop.
 *
 * Headless and deterministic like the sim under it: the same seed and the same
 * `drop()`/`pick()` calls at the same ticks produce the same final score.
 * Everything the UI needs arrives as `GameEvent`s from `step()`.
 */
import { Sim } from "../sim/world.js";
import { BUMPER_RESTITUTION } from "../sim/types.js";
import type { Rng } from "../sim/rng.js";
import type { BallSpawn, SimEvent } from "../sim/types.js";
import { BALL_TYPES, SHOP_BALLS, STARTING_BAG, type BallTypeId } from "./balls.js";
import {
  CHARMS,
  CHARM_IDS,
  RARITY_WEIGHT,
  type BallScoreState,
  type Charm,
  type CharmCtx,
  type CharmId,
  type FxKind,
} from "./charms.js";
import { BASE_CHIPS_FRESH, BASE_CHIPS_REPEAT, ballScore, bucketMultipliers, roundTarget } from "./scoring.js";
import { ICE_RESTITUTION, react, type Element, type PegElementState, type Reaction } from "./elements.js";
import { COMBO_EVENTS, COMBO_EVENT_COOLDOWN_TICKS, COMBO_EVENT_EVERY, COMBO_EVENT_KINDS, type ComboEventKind } from "./comboEvents.js";
import { FEVER_IGNITION, FEVER_RAMP, feverMultiplier } from "./fever.js";

/** Runs are endless: targets keep climbing until you miss one. Round 8 is the
 *  "machine cleared" milestone, not the end. Tests pass a finite `rounds`. */
export const CLEAR_ROUND = 8;
export const ROUNDS = Number.POSITIVE_INFINITY;
export const BALLS_PER_ROUND = 6;
/** Copies of one charm a run may hold. */
export const MAX_STACK = 5;
/** Flags and largest-wins charms: a second copy would change nothing. */
export const NON_STACKABLE: ReadonlySet<CharmId> = new Set<CharmId>(["tinder", "lightning_rod", "restless_board", "aurora", "inversion", "inferno_engine"]);
/** One extra ball per round every this many rounds. */
export const BALL_EVERY_ROUNDS = 3;
/** Pop bumpers: seeded pegs that shove the ball and count as several combo hits. */
export const BUMPERS_PER_ROUND = 3;
export const BUMPER_COMBO = 3; // on top of the hit itself
export const BUMPER_KICK = 3.2;
export const BUMPER_CHIPS = 15;
export const SHOP_OFFERS = 3;

export type Phase = "drop" | "shop" | "won" | "lost";

export type Offer = { kind: "charm"; id: CharmId } | { kind: "ball"; id: BallTypeId; count: number };

/** Peg hits closer together than this (in ticks) chain into one combo. */
export const COMBO_WINDOW_TICKS = 54; // 0.3 s at 120 Hz: multiball must actually be dense
export const COMBO_MILESTONE = 10;

export type GameEvent =
  | { type: "popup"; x: number; y: number; text: string; kind: "chips" | "mult" | "score" | "info"; hits?: number; fresh?: boolean; tag?: string }
  | { type: "pegLit"; peg: number }
  | { type: "pegHit"; peg: number; x: number; y: number; fresh: boolean; tag: string; speed: number }
  | { type: "zap"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: "fx"; kind: FxKind; x: number; y: number; strength: number }
  /** Running combo count changed; `milestone` is true on every 10th hit. */
  | { type: "combo"; count: number; milestone: boolean }
  | { type: "comboEnd"; count: number }
  /** Insurance fired: the failed round restarts instead of ending the run. */
  | { type: "retry"; round: number; left: number }
  /** The machine-cleared milestone (round CLEAR_ROUND beaten); the run goes on. */
  | { type: "cleared"; round: number }
  /** A peg's element changed (null = cleared). */
  | { type: "pegElement"; peg: number; el: Element | null }
  /** An elemental reaction resolved at a peg; `count` = pegs involved. */
  | { type: "element"; kind: Reaction["kind"] | "spread"; peg: number; x: number; y: number; el: Element; count: number; chips: number }
  /** A temporary charm ran out. */
  | { type: "charmExpired"; id: CharmId }
  /** Pocket multipliers changed; `lottery` is the highlighted pocket or -1. */
  | { type: "pockets"; mults: number[]; lottery: number }
  /** A combo event fired. Laser: `y` is the beam height. */
  | { type: "comboEvent"; kind: ComboEventKind; x: number; y: number; ticks: number; label: string }
  /** A physical combo effect ended (quake, gravity flip, magnet storm). */
  | { type: "comboEventEnd"; kind: ComboEventKind }
  /** A portal sent a ball back to the top. */
  | { type: "portal"; ball: number; from: { x: number; y: number }; to: { x: number; y: number } }
  /** Quantum ball teleported. */
  | { type: "blink"; ball: number; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: "pegsReset" }
  /** This round's bumper pegs (renderer sizes and colours them). */
  | { type: "bumpers"; pegs: number[] }
  /** A ball popped off a bumper. */
  | { type: "bumper"; peg: number; x: number; y: number; combo: number; ball: number }
  | { type: "ballScored"; ball: number; score: number; bucket: number; chips: number; mult: number; fever: number }
  | { type: "roundEnd"; round: number; passed: boolean; roundScore: number; target: number }
  | { type: "phase"; phase: Phase }
  | { type: "shake"; strength: number }
  /** Displayed fever multiplier changed (0.1 steps). ×1 = cold. */
  | { type: "fever"; value: number };

export interface RunInput {
  tick: number;
  action: { type: "drop"; x: number } | { type: "pick"; index: number };
}

export interface RunOptions {
  rounds?: number;
  ballsPerRound?: number;
  /** What the shop may roll: the player's unlocked content. Defaults to everything. */
  pool?: { charms: CharmId[]; balls: BallTypeId[] };
}

export class Run {
  phase: Phase = "drop";
  round = 1;
  roundScore = 0;
  totalScore = 0;
  ballsLeft = 0;
  bag: BallTypeId[] = [];
  /** Types added by charms/shop, drawn from every round. */
  readonly ownedBalls: BallTypeId[] = [...STARTING_BAG];
  readonly charms: CharmId[] = [];
  readonly lit = new Set<number>();
  /** Peg ids that are pop bumpers this round. */
  readonly bumpers = new Set<number>();
  offers: Offer[] = [];
  readonly log: RunInput[] = [];
  readonly balls = new Map<number, BallScoreState>();
  /** Set once the run has cleared CLEAR_ROUND; the run itself continues. */
  cleared = false;
  /** Peg hits chained within the combo window across all balls in flight. */
  combo = 0;
  bestCombo = 0;
  private lastHitTick = -1;
  private landedThisRound = 0;
  private retriesUsed = 0;
  /** Per-ball extras the charms/traits need at landing time. */
  private readonly ballExtra = new Map<number, { aimBucket: number; finale: boolean }>();
  /** Element state per peg for the current round. */
  readonly pegElements = new Map<number, PegElementState>();
  /** Element carried by each ball in flight (renderer reads this for auras). */
  readonly ballElements = new Map<number, Element>();
  /** Round on which each temporary charm (by index in `charms`) expires. */
  private readonly charmExpires = new Map<number, number>();
  /** Round on which each charm (by index in `charms`) was bought; growth charms read it. */
  private readonly charmAcquired = new Map<number, number>();
  // Dynamic pocket state (per round unless noted).
  private pocketRotation = 0;
  private pocketHot: number[] = [];
  private lotteryPocket = -1;
  private lastPocket = -1;
  private pocketStreak = 0;
  /** Rounds cleared this run: feeds Jackpot Growth. */
  private clearedThisRun = 0;
  /** Timed combo effects in flight: tick on which each ends. */
  private readonly activeEffects = new Map<ComboEventKind, number>();
  private lastComboEventTick = -1_000_000;
  private secondWindUsed = false;
  /** Afterglow: fever fades from `from` to ×1 by `until` (over `ticks`). */
  private afterglow: { from: number; until: number; ticks: number } | null = null;
  private lastFeverShown = 1;

  private readonly rounds: number;
  private readonly ballsPerRound: number;
  private readonly bucketMults: number[];
  readonly pool: { charms: CharmId[]; balls: BallTypeId[] };

  private constructor(readonly sim: Sim, opts: RunOptions) {
    this.rounds = opts.rounds ?? ROUNDS;
    this.ballsPerRound = opts.ballsPerRound ?? BALLS_PER_ROUND;
    this.bucketMults = bucketMultipliers(sim.config.buckets);
    // Sorted so that two equal pools roll identically regardless of input order.
    this.pool = {
      charms: [...(opts.pool?.charms ?? CHARM_IDS)].sort(),
      balls: [...(opts.pool?.balls ?? SHOP_BALLS)].sort(),
    };
  }

  static async create(seed: string, opts: RunOptions = {}): Promise<Run> {
    const sim = await Sim.create({ seed });
    const run = new Run(sim, opts);
    run.startRound();
    return run;
  }

  get target(): number {
    return roundTarget(this.round);
  }

  get inFlight(): number {
    return this.sim.ballCount;
  }

  get nextBall(): BallTypeId | undefined {
    return this.bag[0];
  }

  /** Pocket multipliers after charm bonuses and this round's dynamics, for UI and scoring. */
  pocketMultipliers(): number[] {
    const n = this.bucketMults.length;
    const bonus = this.sumCharm((c) => c.bucketBonus ?? 0);
    const edge = this.sumCharm((c) => c.edgeBonus ?? 0);
    const growth = this.sumCharm((c) => c.jackpotGrowth ?? 0) * this.clearedThisRun;
    const jackpot = this.charms.reduce((f, id) => f * (CHARMS[id].jackpotFactor ?? 1), 1);
    const invert = this.charms.some((id) => CHARMS[id].invertPockets);
    const last = n - 1;
    const mid = last / 2;
    // Base pattern, optionally inverted (edges ↔ centre), then rotated.
    let pattern = invert ? this.bucketMults.map((m) => 6 - m) : [...this.bucketMults];
    if (this.pocketRotation) pattern = pattern.map((_, i) => pattern[(i - this.pocketRotation + n * 1000) % n]!);
    return pattern.map((m, i) => {
      const isEdge = i === 0 || i === last;
      const isMid = i === mid;
      const hot = this.pocketHot[i] ?? 0;
      const lotto = i === this.lotteryPocket ? this.sumCharm((c) => c.lottery ?? 0) : 0;
      return (m + bonus + (isEdge ? edge : 0) + (isMid ? growth : 0) + hot + lotto) * (isMid ? jackpot : 1);
    });
  }

  get lotteryPocketIndex(): number {
    return this.lotteryPocket;
  }

  private emitPockets(out: GameEvent[]): void {
    out.push({ type: "pockets", mults: this.pocketMultipliers(), lottery: this.lotteryPocket });
  }

  comboWindow(): number {
    return COMBO_WINDOW_TICKS + this.sumCharm((c) => c.comboWindowBonus ?? 0);
  }

  feverIgnition(): number {
    return Math.max(10, FEVER_IGNITION + this.sumCharm((c) => c.feverIgnitionDelta ?? 0));
  }

  feverRamp(): number {
    return Math.max(20, FEVER_RAMP + this.sumCharm((c) => c.feverRampDelta ?? 0));
  }

  /** Live fever multiplier: from the running combo, or the afterglow fade. */
  feverValue(): number {
    const live = feverMultiplier(this.combo, this.feverIgnition(), this.feverRamp());
    if (this.afterglow && this.sim.tick < this.afterglow.until) {
      const k = (this.afterglow.until - this.sim.tick) / this.afterglow.ticks;
      return Math.max(live, 1 + (this.afterglow.from - 1) * k);
    }
    return live;
  }

  private emitFever(out: GameEvent[]): void {
    const v = Math.round(this.feverValue() * 10) / 10;
    if (v !== this.lastFeverShown) {
      this.lastFeverShown = v;
      out.push({ type: "fever", value: v });
    }
  }

  comboMilestone(): number {
    return Math.max(5, COMBO_MILESTONE + this.sumCharm((c) => c.milestoneDelta ?? 0));
  }

  retriesLeft(): number {
    return this.sumCharm((c) => c.retries ?? 0) - this.retriesUsed;
  }

  /** Ball type counts in the bag still to be drawn this round. */
  bagSummary(): Array<{ type: BallTypeId; count: number }> {
    const counts = new Map<BallTypeId, number>();
    for (const t of this.bag) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].map(([type, count]) => ({ type, count }));
  }

  // --- player inputs -------------------------------------------------------------

  /** Drop the next ball from the bag at board x. Returns false if not allowed. */
  drop(x: number): boolean {
    if (this.phase !== "drop" || this.ballsLeft <= 0) return false;
    // Never release a ball outside the outermost peg column.
    const lim = this.sim.dropLimit;
    x = Math.max(-lim, Math.min(lim, x));
    const type = this.bag.shift() ?? "steel";
    this.ballsLeft--;
    this.log.push({ tick: this.sim.tick, action: { type: "drop", x } });
    const count = BALL_TYPES[type].traits?.count ?? 1;
    const finale = this.ballsLeft === 0;
    for (let i = 0; i < count; i++) {
      const dx = count === 1 ? 0 : (i - (count - 1) / 2) * 0.32;
      const id = this.spawn({ x: x + dx, type }, true);
      this.ballExtra.set(id, { aimBucket: this.sim.bucketAt(x), finale });
    }
    return true;
  }

  /** How many copies of a charm the run holds. */
  charmLevel(id: CharmId): number {
    return this.charms.filter((c) => c === id).length;
  }

  /**
   * Whether the shop may offer `id` again. Every numeric charm stacks by
   * holding copies (sums, products, or the min-based fields below); a
   * temporary charm re-picked extends its remaining rounds; only pure flags
   * and "largest wins" charms are single-copy.
   */
  canStack(id: CharmId): boolean {
    const level = this.charmLevel(id);
    if (level === 0) return true;
    if (NON_STACKABLE.has(id)) return false;
    return level < MAX_STACK;
  }

  /** Take shop offer `index`. */
  pick(index: number): boolean {
    if (this.phase !== "shop") return false;
    const offer = this.offers[index];
    if (!offer) return false;
    this.log.push({ tick: this.sim.tick, action: { type: "pick", index } });
    if (offer.kind === "charm") {
      const dur = CHARMS[offer.id].duration;
      const held = this.charms.indexOf(offer.id);
      if (dur && held >= 0 && this.charmExpires.has(held)) {
        // Re-picking a temporary charm extends it instead of doubling it.
        this.charmExpires.set(held, (this.charmExpires.get(held) ?? this.round) + dur);
      } else {
        this.charms.push(offer.id);
        this.charmAcquired.set(this.charms.length - 1, this.round);
        // Acquired after round N ends: lasts rounds N+1 .. N+dur.
        if (dur) this.charmExpires.set(this.charms.length - 1, this.round + dur);
      }
      CHARMS[offer.id].onAcquire?.(this.ctxBase());
    } else {
      for (let i = 0; i < offer.count; i++) this.ownedBalls.push(offer.id);
    }
    this.offers = [];
    this.round++;
    this.startRound();
    return true;
  }

  // --- stepping ------------------------------------------------------------------

  /** Advance one fixed step; returns presentation events. */
  step(): GameEvent[] {
    const out: GameEvent[] = [];
    if (this.phase !== "drop") return out;
    if (this.pendingRoundEvents.length) {
      out.push(...this.pendingRoundEvents);
      this.pendingRoundEvents = [];
    }
    const events = this.sim.step();
    for (const ev of events) this.handle(ev, out);

    for (const [kind, until] of this.activeEffects) {
      if (this.sim.tick >= until) {
        this.activeEffects.delete(kind);
        this.endEffect(kind);
        out.push({ type: "comboEventEnd", kind });
      }
    }
    if (this.afterglow) {
      this.emitFever(out);
      if (this.sim.tick >= this.afterglow.until) this.afterglow = null;
    }
    if (this.combo > 0 && this.sim.tick - this.lastHitTick > this.comboWindow()) {
      this.closeCombo(out);
    }
    if (this.ballsLeft === 0 && this.sim.ballCount === 0) {
      // The last ball often pockets inside the combo window: close the combo
      // here or the counter and heat would hang over the shop. Second Wind can
      // still fire off this close, and the granted ball keeps the round alive.
      if (this.combo > 0) this.closeCombo(out);
      if (this.ballsLeft === 0) this.endRound(out);
    }
    return out;
  }

  // --- internals -----------------------------------------------------------------

  /** Close the running combo. Second Wind: a big combo ending buys one more ball
   *  this round; each extra copy lowers the bar by 10 (never below 20). */
  private closeCombo(out: GameEvent[]): void {
    out.push({ type: "comboEnd", count: this.combo });
    // Afterglow: hold the fever and fade it, so late landings still cash out.
    const glow = this.sumCharm((c) => c.afterglowTicks ?? 0);
    const fever = feverMultiplier(this.combo, this.feverIgnition(), this.feverRamp());
    if (glow > 0 && fever > 1) this.afterglow = { from: fever, until: this.sim.tick + glow, ticks: glow };
    const swAll = this.charms.map((id) => CHARMS[id].secondWindAt ?? 0).filter((n) => n > 0);
    const sw = swAll.length ? Math.max(20, Math.min(...swAll) - 10 * (swAll.length - 1)) : Infinity;
    if (!this.secondWindUsed && this.combo >= sw) {
      this.secondWindUsed = true;
      this.ballsLeft++;
      this.bag.push("steel");
      out.push({ type: "popup", x: 0, y: this.sim.config.height * 0.5, text: "SECOND WIND · +1 ball", kind: "mult" });
    }
    // Thermal Mass: a lapsed combo keeps a fraction — pointless once the board is empty.
    const carry = Math.min(0.75, this.sumCharm((c) => c.comboCarry ?? 0));
    const boardLive = this.ballsLeft > 0 || this.sim.ballCount > 0;
    this.combo = carry > 0 && boardLive ? Math.floor(this.combo * carry) : 0;
    if (this.combo > 0) {
      this.lastHitTick = this.sim.tick;
      out.push({ type: "combo", count: this.combo, milestone: false });
    }
    this.emitFever(out);
  }

  /** Remove temporary charms whose last round has passed. Returns their ids. */
  private expireCharms(): CharmId[] {
    const gone: CharmId[] = [];
    for (let i = this.charms.length - 1; i >= 0; i--) {
      const until = this.charmExpires.get(i);
      if (until !== undefined && this.round > until) {
        gone.push(this.charms[i]!);
        this.charms.splice(i, 1);
        // Re-key the per-index charm maps above the removed index.
        for (const map of [this.charmExpires, this.charmAcquired]) {
          map.delete(i);
          for (const [k, v] of [...map]) {
            if (k > i) {
              map.delete(k);
              map.set(k - 1, v);
            }
          }
        }
      }
    }
    return gone;
  }

  /** Rounds left on a temporary charm (by index), or null if permanent. */
  charmRoundsLeft(index: number): number | null {
    const until = this.charmExpires.get(index);
    return until === undefined ? null : Math.max(0, until - this.round + 1);
  }

  /** Element every bag ball carries this round, from temporary/permanent charms. */
  activeElement(): Element | null {
    if (this.charms.some((id) => CHARMS[id].randomElement)) {
      const pick = ["fire", "ice", "storm"] as const;
      return pick[Math.floor(this.sim.streams.fx.next() * 3)] ?? "fire";
    }
    for (let i = this.charms.length - 1; i >= 0; i--) {
      const el = CHARMS[this.charms[i]!].element;
      if (el) return el;
    }
    return null;
  }

  /** Freeze a peg; Permafrost & co. make the ice thicker. */
  private freezePeg(peg: number, out: GameEvent[]): void {
    this.setPegElement(peg, { el: "ice", stacks: 1 + this.sumCharm((c) => c.frostStacks ?? 0) }, out);
  }

  /** Board motion from charms: the largest drift among held charms wins. */
  private applyBoardMotion(): void {
    const drift = this.charms
      .map((id) => CHARMS[id].pegDrift)
      .filter((d): d is { amplitude: number; period: number } => !!d)
      .sort((a, b) => b.amplitude - a.amplitude)[0];
    this.sim.setPegMotion(drift ? { amplitude: drift.amplitude, omega: (2 * Math.PI) / (drift.period / this.sim.config.dt) } : null);
  }

  // --- combo events ------------------------------------------------------------

  /** Fire a combo event; exported for tests and dev tooling. */
  triggerComboEvent(kind: ComboEventKind, out: GameEvent[]): void {
    const def = COMBO_EVENTS[kind];
    const H = this.sim.config.height;
    let x = 0;
    let y = H * 0.55;
    switch (kind) {
      case "laser": {
        // Pick a peg row; light every unlit peg on it and pay every ball in flight.
        const rows = [...new Set(this.sim.pegs.map((p) => Math.round(p.y * 100) / 100))];
        y = this.sim.streams.fx.pick(rows);
        let lit = 0;
        for (const p of this.sim.pegs) {
          if (Math.abs(p.y - y) < 0.05 && !this.lit.has(p.id)) {
            this.lit.add(p.id);
            out.push({ type: "pegLit", peg: p.id });
            lit++;
          }
        }
        const chips = lit * 6;
        for (const b of this.balls.values()) b.chips += chips;
        if (chips) out.push({ type: "popup", x: 0, y, text: `+${chips} laser · all balls`, kind: "chips" });
        break;
      }
      case "portal":
        this.sim.armPortals(this.sim.portalsArmedCount + 2);
        y = 0.6;
        break;
      case "quake":
        this.sim.setPegMotion({ amplitude: 0.55, omega: (2 * Math.PI) / (0.9 / this.sim.config.dt) });
        break;
      case "rain": {
        for (let i = 0; i < 3; i++) {
          x = this.sim.streams.fx.range(-2.2, 2.2);
          this.spawn({ x, type: "steel", radius: 0.09, density: 4, tag: "shard", element: this.activeElement() }, false);
        }
        y = H + 0.4;
        break;
      }
      case "gravity_flip":
        this.sim.setGravityScaleAll(-0.55);
        break;
      case "magnet_storm":
        this.sim.setGlobalPull(0.6); // 0.9 pressed balls into the edge peg columns
        break;
      case "slowmo":
        break;
    }
    if (def.ticks > 0) this.activeEffects.set(kind, this.sim.tick + def.ticks);
    out.push({ type: "comboEvent", kind, x, y, ticks: def.ticks, label: def.name });
  }

  private endEffect(kind: ComboEventKind): void {
    if (kind === "quake") this.applyBoardMotion();
    else if (kind === "gravity_flip") this.sim.setGravityScaleAll(1);
    else if (kind === "magnet_storm") this.sim.setGlobalPull(0);
  }

  private setPegElement(peg: number, state: PegElementState | null, out: GameEvent[]): void {
    if (state) this.pegElements.set(peg, state);
    else this.pegElements.delete(peg);
    this.sim.setPegRestitution(peg, state?.el === "ice" ? ICE_RESTITUTION : this.bumpers.has(peg) ? BUMPER_RESTITUTION : this.sim.config.restitution);
    out.push({ type: "pegElement", peg, el: state?.el ?? null });
  }

  /** Called from startRound with the events buffer of the *next* step. */
  private pendingRoundEvents: GameEvent[] = [];

  private startRound(): void {
    this.roundScore = 0;
    this.lit.clear();
    this.balls.clear();
    this.ballElements.clear();
    this.pegElements.clear();
    this.sim.resetPegRestitution();
    const pending: GameEvent[] = [];
    for (const id of this.expireCharms()) pending.push({ type: "charmExpired", id });
    // Pocket dynamics reset each round; the lottery pocket is drawn from the shop stream.
    this.pocketRotation = 0;
    this.pocketHot = new Array<number>(this.sim.config.buckets).fill(0);
    this.lastPocket = -1;
    this.pocketStreak = 0;
    this.lotteryPocket = this.charms.some((id) => CHARMS[id].lottery) ? this.sim.streams.shop.int(0, this.sim.config.buckets - 1) : -1;
    this.emitPockets(pending);
    // Frost: freeze N pegs chosen by the layout stream, thickest at the top.
    const frozen = this.sumCharm((c) => c.frozenAtStart ?? 0);
    if (frozen > 0) {
      const ids = shuffle(this.sim.pegs.map((p) => p.id), this.sim.streams.layout).slice(0, frozen);
      for (const peg of ids) this.freezePeg(peg, pending);
    }
    // Bumpers: a few seeded pegs in the middle rows (never the top row, where a
    // pop would fire the drop straight back up, nor the bottom row).
    for (const p of this.bumpers) this.sim.setPegBumper(p, false);
    this.bumpers.clear();
    const H = this.sim.config.height;
    const nb = BUMPERS_PER_ROUND + this.sumCharm((c) => c.extraBumpers ?? 0);
    const candidates = this.sim.pegs.filter((p) => p.y < H * 0.8 && p.y > H * 0.3 && !this.pegElements.has(p.id)).map((p) => p.id);
    for (const id of shuffle(candidates, this.sim.streams.layout).slice(0, nb)) {
      this.bumpers.add(id);
      this.sim.setPegBumper(id, true);
    }
    pending.push({ type: "bumpers", pegs: [...this.bumpers].sort((a, b) => a - b) });
    this.pendingRoundEvents = pending;
    this.combo = 0;
    this.afterglow = null;
    this.lastFeverShown = 1;
    this.lastHitTick = -1;
    this.landedThisRound = 0;
    this.ballExtra.clear();
    this.phase = "drop";
    // One more ball every few rounds, so deep runs keep widening.
    this.ballsLeft = this.bagCapacity();
    this.activeEffects.clear();
    this.secondWindUsed = false;
    this.sim.setGravityScaleAll(1);
    this.sim.setGlobalPull(0);
    this.sim.armPortals(0);
    this.applyBoardMotion();
    // Custom balls always make the bag; steel is only filler. When customs
    // overflow the bag, the newest purchases win — a shop pick must never be a
    // no-op. Shuffled with the shop stream so the draw order is seeded.
    const custom = this.ownedBalls.filter((t) => t !== "steel");
    this.bag = custom.slice(-this.ballsLeft);
    while (this.bag.length < this.ballsLeft) this.bag.push("steel");
    this.bag = shuffle(this.bag, this.sim.streams.shop);
    for (const id of this.charms) CHARMS[id].onRoundStart?.(this.ctxBase());
  }

  private endRound(out: GameEvent[]): void {
    const endMult = this.charms.reduce((f, id) => f * (CHARMS[id].roundEndMult ?? 1), 1);
    if (endMult !== 1) {
      const boosted = Math.floor(this.roundScore * endMult);
      this.totalScore += boosted - this.roundScore;
      this.roundScore = boosted;
    }
    const passed = this.roundScore >= this.target;
    if (!passed && this.retriesLeft() > 0) {
      this.retriesUsed++;
      out.push({ type: "retry", round: this.round, left: this.retriesLeft() });
      this.totalScore -= this.roundScore;
      this.startRound();
      return;
    }
    out.push({ type: "roundEnd", round: this.round, passed, roundScore: this.roundScore, target: this.target });
    if (passed) this.clearedThisRun++;
    if (passed && this.round >= CLEAR_ROUND && !this.cleared) {
      this.cleared = true;
      out.push({ type: "cleared", round: this.round });
    }
    if (!passed) {
      this.phase = "lost";
    } else if (this.round >= this.rounds) {
      this.phase = "won";
    } else {
      this.phase = "shop";
      this.offers = this.rollOffers();
    }
    out.push({ type: "phase", phase: this.phase });
  }

  private rollOffers(): Offer[] {
    const rng = this.sim.streams.shop;
    const offers: Offer[] = [];
    const seen = new Set<string>();
    const want = SHOP_OFFERS + this.sumCharm((c) => c.extraOffers ?? 0);
    const ballCount = 2 + this.sumCharm((c) => c.ballOfferBonus ?? 0);
    let guard = 0;
    while (offers.length < want && guard++ < 80) {
      // 1 in 3 offers is a ball type instead of a charm.
      if (rng.next() < 0.34 && this.pool.balls.length > 0) {
        const id = weightedPick(rng, this.pool.balls, (b) => BALL_TYPES[b].shopWeight);
        if (seen.has(`ball:${id}`)) continue;
        seen.add(`ball:${id}`);
        offers.push({ kind: "ball", id, count: ballCount });
        continue;
      }
      if (this.pool.charms.length === 0) break;
      const id = weightedPick(rng, this.pool.charms, (c) => RARITY_WEIGHT[CHARMS[c].rarity]);
      // Owned charms may be offered again as an upgrade (see canStack), up to MAX_STACK.
      if (seen.has(id) || !this.canStack(id)) continue;
      seen.add(id);
      offers.push({ kind: "charm", id });
    }
    return offers;
  }

  private spawn(req: BallSpawn & { type: BallTypeId; element?: Element | null; carry?: BallScoreState }, fromBag: boolean): number {
    const type = BALL_TYPES[req.type];
    const { carry, element, ...rest } = req;
    let spawn: BallSpawn = { ...type.physics, ...rest, tag: req.tag ?? req.type };
    for (const id of this.charms) {
      const c = CHARMS[id];
      if (c.onSpawn) spawn = c.onSpawn(spawn, { round: this.round, type: req.type });
    }
    const ballId = this.sim.spawnBall(spawn);
    // Inherent element (Ember/Frost/Volt/Rainbow) beats the charm element.
    const el = type.traits?.element ?? (element !== undefined ? element : fromBag || carry ? this.activeElement() : null);
    if (el) this.ballElements.set(ballId, el);
    this.balls.set(ballId, {
      id: ballId,
      type: req.type,
      // Passives that shape a ball before it touches anything.
      chips: carry ? carry.chips : fromBag ? this.sumCharm((c) => c.startChips ?? 0) : 0,
      mult: carry ? carry.mult : 1 + (fromBag ? this.sumCharm((c) => c.momentum ?? 0) * this.landedThisRound : 0),
      hits: carry ? carry.hits : 0,
      freshHits: carry ? carry.freshHits : 0,
      revives: carry ? carry.revives : 0,
      zaps: carry ? carry.zaps : 0,
      // Relaunches (Phoenix, ricochet) drop the tag, so the flag rides the carry.
      shard: spawn.tag === "shard" || (carry?.shard ?? false),
    });
    return ballId;
  }

  private handle(ev: SimEvent, out: GameEvent[]): void {
    const ball = this.balls.get(ev.ball);
    if (!ball) return;
    const ctx = this.ctxFor(ball, out);

    if (ev.type === "pegHit") {
      const peg = this.sim.pegs[ev.peg] && { ...this.sim.pegs[ev.peg]!, ...this.sim.pegPosition(ev.peg) };
      if (!peg) return;
      const fresh = !this.lit.has(ev.peg);
      ball.hits++;
      if (fresh) {
        ball.freshHits++;
        this.lit.add(ev.peg);
        out.push({ type: "pegLit", peg: ev.peg });
      }
      const type = BALL_TYPES[ball.type];
      const bonus = fresh ? this.sumCharm((c) => c.freshChipBonus ?? 0) : this.sumCharm((c) => c.repeatChipBonus ?? 0);
      const speedChips = (type.traits?.speedChips ?? 0) * ev.speed;
      const feverNow = this.feverValue();
      const inferno = feverNow >= 2 && this.charms.some((id) => CHARMS[id].infernoEngine);
      const base = Math.round((((fresh ? BASE_CHIPS_FRESH : BASE_CHIPS_REPEAT) + bonus) * type.chipFactor + speedChips) * (inferno ? feverNow : 1));
      ball.chips += base;
      out.push({ type: "pegHit", peg: ev.peg, x: peg.x, y: peg.y, fresh, tag: ball.type, speed: ev.speed });
      out.push({ type: "popup", x: peg.x, y: peg.y, text: `+${Math.round(base)}`, kind: "chips", hits: ball.hits, fresh, tag: ball.type });

      // Combo: hits chained across every ball in flight. Milestones pay out
      // +1 mult to all balls in play, so multiball is worth engineering.
      // A bumper counts as several hits at once, so milestones and events are
      // detected by crossing, not equality.
      const prevCombo = this.combo;
      const isBumper = this.bumpers.has(ev.peg);
      const bumperCombo = isBumper ? BUMPER_COMBO + this.sumCharm((c) => c.bumperCombo ?? 0) : 0;
      const traitCombo = (type.traits?.comboHits ?? 1) - 1;
      this.combo += 1 + bumperCombo + traitCombo;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.lastHitTick = this.sim.tick;
      const m = this.comboMilestone();
      const milestones = Math.floor(this.combo / m) - Math.floor(prevCombo / m);
      out.push({ type: "combo", count: this.combo, milestone: milestones > 0 });
      this.emitFever(out);
      // Combo events: every 50th hit, but never two within the cooldown.
      const every = Math.max(20, COMBO_EVENT_EVERY + this.sumCharm((c) => c.eventEveryDelta ?? 0));
      const crossedEvent = Math.floor(this.combo / every) > Math.floor(prevCombo / every);
      if (crossedEvent && this.sim.tick - this.lastComboEventTick >= COMBO_EVENT_COOLDOWN_TICKS) {
        this.lastComboEventTick = this.sim.tick;
        const kind = weightedPick(this.sim.streams.fx, COMBO_EVENT_KINDS, (k) => COMBO_EVENTS[k].weight);
        this.triggerComboEvent(kind, out);
      }
      if (milestones > 0) {
        for (const b of this.balls.values()) b.mult += milestones;
        out.push({ type: "popup", x: 0, y: this.sim.config.height * 0.55, text: `COMBO ${this.combo} · +${milestones} mult all`, kind: "mult" });
        out.push({ type: "shake", strength: 0.35 });
      }
      if (isBumper) {
        ball.chips += Math.round(BUMPER_CHIPS * type.chipFactor);
        const bm = this.sumCharm((c) => c.bumperMult ?? 0);
        if (bm > 0) ctx.addMult(bm, "bumper");
        this.sim.kickBall(ball.id, peg.x, peg.y, BUMPER_KICK);
        out.push({ type: "bumper", peg: ev.peg, x: peg.x, y: peg.y, combo: this.combo, ball: ball.id });
        out.push({ type: "popup", x: peg.x, y: peg.y + 0.35, text: `BUMPER +${1 + bumperCombo} combo`, kind: "mult" });
      }

      if (ball.type === "spark" && this.sim.streams.fx.next() < 0.25) ctx.addMult(1, "spark");

      // Ball traits that react to hits.
      const t = type.traits;
      // Rainbow: rotate the element before the reaction resolves.
      if (t?.cycleElement) {
        const cycle: Element[] = ["fire", "ice", "storm"];
        const cur = this.ballElements.get(ball.id) ?? "storm";
        this.ballElements.set(ball.id, cycle[(cycle.indexOf(cur) + 1) % 3]!);
      }

      // Elements: ball element × peg state → reaction.
      this.resolveElement(ball, ev.peg, peg, fresh, ctx, out);

      if (t?.multEvery && ball.hits % t.multEvery === 0) ctx.addMult(t.multEveryAmount ?? 1, "pearl");
      // Orbit: a sideways shove that alternates, so it zig-zags across the field
      // instead of hugging one side (its old pull pinned it to the wall).
      if (t?.swerve) {
        const dir = ball.hits % 2 === 0 ? 1 : -1;
        this.sim.kickBall(ball.id, peg.x - dir, peg.y, t.swerve);
      }
      if (t?.blinkAt && ball.hits === t.blinkAt) {
        // Blink into the upper field, never straight onto a peg: aim between two top-row pegs.
        const H = this.sim.config.height;
        const tx = this.sim.streams.fx.range(-this.sim.config.width / 2 + 0.6, this.sim.config.width / 2 - 0.6);
        const ty = H * 0.86 + 0.45;
        if (this.sim.teleportBall(ball.id, tx, ty)) {
          out.push({ type: "blink", ball: ball.id, from: { x: peg.x, y: peg.y }, to: { x: tx, y: ty } });
          ctx.addMult(1, "blink");
        }
      }
      if (t?.lightNeighbor && fresh) {
        for (const p of this.nearestUnlit(peg.x, peg.y, t.lightNeighbor, ev.peg)) {
          if (ctx.lightPeg(p.id, ev.peg)) ctx.addChips(5, "prism");
        }
        ctx.fx("prism", peg.x, peg.y, 0.5);
      }
      if (t?.igniteEvery && ball.hits % t.igniteEvery === 0 && !this.pegElements.has(ev.peg)) {
        this.setPegElement(ev.peg, { el: "fire", stacks: 1 }, out);
        out.push({ type: "element", kind: "ignite", peg: ev.peg, x: peg.x, y: peg.y, el: "fire", count: 1, chips: 0 });
      }
      if (t?.shatterAt && ball.hits === t.shatterAt) {
        ball.chips *= 2;
        for (let i = 0; i < (t.shatterShards ?? 3); i++) {
          const a = (i / (t.shatterShards ?? 3)) * Math.PI + Math.PI * 0.15;
          this.spawn({ type: "steel", x: peg.x + Math.cos(a) * 0.25, y: peg.y + 0.2, vx: Math.cos(a) * 2.2, vy: 1.5, radius: 0.08, density: 3, tag: "shard", element: this.ballElements.get(ball.id) ?? null }, false);
        }
        ctx.fx("split", peg.x, peg.y, 1);
        out.push({ type: "popup", x: peg.x, y: peg.y, text: "SHATTER ×2", kind: "mult" });
      }
      if (t?.detonateAt && ball.hits === t.detonateAt) {
        const r2 = (t.detonateRadius ?? 1) ** 2;
        let lit = 0;
        for (const p of this.sim.pegs) {
          if (this.lit.has(p.id) || (p.x - peg.x) ** 2 + (p.y - peg.y) ** 2 > r2) continue;
          if (ctx.lightPeg(p.id)) lit++;
        }
        if (lit) ctx.addChips(lit * 8, "boom");
        ctx.fx("bomb", peg.x, peg.y, 1);
      }

      const zapEvery = this.charms.map((id) => CHARMS[id].zapEvery ?? 0).filter((n) => n > 0);
      if (zapEvery.length) {
        // Stacked copies zap more often: every copy past the first shaves one hit off.
        const every = Math.max(2, Math.min(...zapEvery) - (zapEvery.length - 1));
        if (ball.hits % every === 0) {
          const arcChips = 4 + this.sumCharm((c) => c.arcChips ?? 0);
          let count = 0;
          for (const p of this.nearestPegs(peg.x, peg.y, 2, ev.peg)) {
            if (ctx.lightPeg(p.id, ev.peg)) {
              ctx.addChips(arcChips, "arc");
              count++;
            }
          }
          out.push({ type: "element", kind: "zap", peg: ev.peg, x: peg.x, y: peg.y, el: "storm", count, chips: arcChips * count });
        }
      }

      for (const id of this.charms) CHARMS[id].onPegHit?.(ctx, ev, fresh);
      return;
    }

    if (ev.type === "wallHit") {
      // Ricochet: the wall is a scoring surface and a springboard.
      const t = BALL_TYPES[ball.type].traits;
      if (t?.wallChips) {
        const p = this.sim.ballPosition(ball.id);
        ball.chips += Math.round(t.wallChips * BALL_TYPES[ball.type].chipFactor);
        if (p) {
          const half = this.sim.config.width / 2;
          this.sim.kickBall(ball.id, Math.sign(p.x || 1) * (half + 1), p.y, t.wallKick ?? 2);
          out.push({ type: "popup", x: p.x, y: p.y, text: `+${t.wallChips} wall`, kind: "chips" });
          out.push({ type: "fx", kind: "metal", x: p.x, y: p.y, strength: 0.5 });
        }
      }
      for (const id of this.charms) CHARMS[id].onWallHit?.(ctx);
      return;
    }

    if (ev.type === "portal") {
      ctx.addMult(2, "portal");
      const cx = this.sim.bucketCenters[ev.bucket] ?? 0;
      out.push({ type: "portal", ball: ev.ball, from: { x: cx, y: 0.6 }, to: { x: cx, y: this.sim.config.height + 0.5 } });
      return;
    }

    // ballLost
    const mults = this.pocketMultipliers();
    let bucketMult = ev.bucket >= 0 ? (mults[ev.bucket] ?? 1) : 0;
    if (BALL_TYPES[ball.type].traits?.mirrorPocket && ev.bucket >= 0) {
      const mirrored = mults[mults.length - 1 - ev.bucket] ?? 0;
      bucketMult += mirrored;
      out.push({ type: "popup", x: this.sim.bucketCenters[mults.length - 1 - ev.bucket] ?? 0, y: 0.9, text: `mirror ×${mirrored}`, kind: "mult" });
    }
    const extra = this.ballExtra.get(ev.ball);
    const cxLand = this.sim.bucketCenters[ev.bucket] ?? 0;

    const landTraits = BALL_TYPES[ball.type].traits;
    if (landTraits?.edgeMult && (ev.bucket === 0 || ev.bucket === mults.length - 1)) {
      bucketMult *= landTraits.edgeMult;
      out.push({ type: "popup", x: cxLand, y: 0.9, text: `edge ×${landTraits.edgeMult}`, kind: "mult" });
    }
    // Boomerang: back to the top above its pocket, state intact, scored on the next landing.
    if (landTraits?.relaunch && ball.revives < landTraits.relaunch && ev.bucket >= 0) {
      ball.revives++;
      ctx.fx("boomerang", cxLand, 0.8, 1);
      this.spawn({ type: ball.type, x: cxLand, vx: cxLand > 0 ? -1 : 1, carry: ball }, false);
      this.balls.delete(ev.ball);
      this.ballExtra.delete(ev.ball);
      this.ballElements.delete(ev.ball);
      return;
    }
    if (landTraits?.multOnLand) ctx.addMult(landTraits.multOnLand, "gold");
    if (landTraits?.collapse && this.sim.ballCount > 0) {
      ctx.addMult(this.sim.ballCount, "collapse");
      ctx.fx("collapse", cxLand, 0.8, Math.min(1, 0.4 + this.sim.ballCount * 0.15));
    }
    if (extra?.finale) {
      const f = this.charms.reduce((m, id) => m * (CHARMS[id].finaleMult ?? 1), 1);
      if (f !== 1) {
        ctx.mulMult(f, "finale");
        ctx.fx("finale", cxLand, 0.8, 1);
      }
    }
    const sharp = this.charms.reduce((m, id) => m * (CHARMS[id].sharpshooter ?? 1), 1);
    if (sharp !== 1 && extra && extra.aimBucket === ev.bucket) {
      ctx.mulMult(sharp, "bullseye");
      ctx.fx("bullseye", cxLand, 0.8, 1);
    }
    // Groove: consecutive landings in the same pocket build a streak.
    const groove = this.sumCharm((c) => c.groove ?? 0);
    if (ev.bucket >= 0 && ev.bucket === this.lastPocket) this.pocketStreak++;
    else this.pocketStreak = 0;
    if (groove > 0 && this.pocketStreak > 0) ctx.mulMult(1 + this.pocketStreak * groove, "groove");
    this.lastPocket = ev.bucket;

    let scored = true;
    for (const id of this.charms) {
      if (CHARMS[id].onBallLost?.(ctx, ev.bucket, bucketMult) === false) scored = false;
    }
    this.balls.delete(ev.ball);
    this.ballExtra.delete(ev.ball);
    this.ballElements.delete(ev.ball);
    if (!scored) return;
    this.landedThisRound++;
    const fever = this.feverValue();
    const score = Math.floor(ballScore(ball.chips, ball.mult, bucketMult) * fever);
    this.roundScore += score;
    this.totalScore += score;
    const cx = this.sim.bucketCenters[ev.bucket] ?? 0;
    out.push({ type: "ballScored", ball: ev.ball, score, bucket: ev.bucket, chips: ball.chips, mult: ball.mult, fever });
    // Pocket dynamics after the landing: hot pockets and roulette.
    let changed = false;
    const hot = this.sumCharm((c) => c.hotPocket ?? 0);
    if (hot > 0 && ev.bucket >= 0) {
      const cap = Math.max(...this.charms.map((id) => CHARMS[id].hotPocketCap ?? 0), 0);
      const cur = this.pocketHot[ev.bucket] ?? 0;
      if (cur < cap) {
        this.pocketHot[ev.bucket] = Math.min(cap, cur + hot);
        changed = true;
      }
    }
    const rot = this.sumCharm((c) => c.pocketRotate ?? 0);
    if (rot > 0) {
      this.pocketRotation = (this.pocketRotation + rot) % this.sim.config.buckets;
      changed = true;
    }
    if (changed) this.emitPockets(out);
    void cx;
    if (score > 0) out.push({ type: "shake", strength: Math.min(1, Math.log10(score + 1) / 6) });
  }

  private ctxBase(): Omit<CharmCtx, "ball"> {
    return {
      round: this.round,
      buckets: this.sim.config.buckets,
      pegs: this.sim.pegs,
      lit: this.lit,
      rng: this.sim.streams.fx,
      has: (c) => this.charms.includes(c),
      count: (c) => this.charms.filter((x) => x === c).length,
      addChips: () => {},
      addMult: () => {},
      mulMult: () => {},
      lightPeg: (peg) => {
        if (this.lit.has(peg)) return false;
        this.lit.add(peg);
        return true;
      },
      fx: () => {},
      spawnBall: (s) => void this.spawn(s, false),
      addToBag: (type, count = 1) => {
        for (let i = 0; i < count; i++) this.ownedBalls.push(type);
      },
    };
  }

  private ctxFor(ball: BallScoreState, out: GameEvent[]): CharmCtx {
    const pos = () => this.sim.ballPosition(ball.id) ?? { x: 0, y: this.sim.config.height / 2 };
    const base = this.ctxBase();
    return {
      ...base,
      ball,
      addChips: (n, label) => {
        ball.chips += n;
        const p = pos();
        out.push({ type: "popup", x: p.x, y: p.y, text: `+${n}${label ? ` ${label}` : ""}`, kind: "chips" });
      },
      addMult: (n, label) => {
        ball.mult += n;
        const p = pos();
        out.push({ type: "popup", x: p.x, y: p.y, text: `+${n} mult${label ? ` ${label}` : ""}`, kind: "mult" });
      },
      mulMult: (f, label) => {
        ball.mult *= f;
        const p = pos();
        out.push({ type: "popup", x: p.x, y: p.y, text: `×${f} mult${label ? ` ${label}` : ""}`, kind: "mult" });
      },
      lightPeg: (peg, fromPeg) => {
        const ok = base.lightPeg(peg);
        if (ok) {
          out.push({ type: "pegLit", peg });
          const to = this.sim.pegs[peg];
          const from = fromPeg !== undefined ? this.sim.pegs[fromPeg] : undefined;
          if (to && from) out.push({ type: "zap", from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } });
        }
        return ok;
      },
      fx: (kind, x, y, strength = 1) => out.push({ type: "fx", kind, x, y, strength }),
    };
  }

  // --- elements --------------------------------------------------------------

  private resolveElement(
    ball: BallScoreState,
    pegId: number,
    peg: { x: number; y: number },
    fresh: boolean,
    ctx: CharmCtx,
    out: GameEvent[],
  ): void {
    const boost = this.charms.reduce((m, id) => m * (CHARMS[id].elementBoost ?? 1), 1);
    let ballEl = this.ballElements.get(ball.id) ?? null;
    // Ember Core & co: a neutral fresh hit may ignite on its own.
    if (!ballEl && fresh && !this.pegElements.has(pegId)) {
      const chance = this.sumCharm((c) => c.igniteChance ?? 0);
      if (chance > 0 && this.sim.streams.fx.next() < chance) ballEl = "fire";
    }
    const state = this.pegElements.get(pegId) ?? null;
    const rx = react(ballEl, state);
    const emit = (kind: Reaction["kind"] | "spread", el: Element, count: number, chips: number) =>
      out.push({ type: "element", kind, peg: pegId, x: peg.x, y: peg.y, el, count, chips });
    const pay = (n: number, label: string) => {
      const v = Math.round(n * boost);
      if (v > 0) ctx.addChips(v, label);
      return v;
    };

    switch (rx.kind) {
      case "none":
        return;
      case "ignite": {
        this.setPegElement(pegId, { el: "fire", stacks: 2 }, out);
        let count = 1;
        const spread = this.sumCharm((c) => c.igniteSpread ?? 0);
        for (const p of this.nearestUnstated(peg.x, peg.y, spread, pegId)) {
          this.setPegElement(p.id, { el: "fire", stacks: 1 }, out);
          count++;
        }
        emit("ignite", "fire", count, 0);
        return;
      }
      case "freeze":
        this.freezePeg(pegId, out);
        emit("freeze", "ice", 1, 0);
        return;
      case "thicken": {
        this.setPegElement(pegId, { el: "ice", stacks: rx.stacks }, out);
        const chips = pay(4 * rx.stacks, "thicken");
        emit("thicken", "ice", rx.stacks, chips);
        return;
      }
      case "flare": {
        const base = fresh ? BASE_CHIPS_FRESH : BASE_CHIPS_REPEAT;
        const chips = pay(base * (rx.chipMult - 1) + 10, "flare");
        const burnMult = this.sumCharm((c) => c.burnMult ?? 0);
        if (burnMult > 0) ctx.addMult(burnMult, "backdraft");
        let count = 1;
        for (const p of this.nearestUnstated(peg.x, peg.y, rx.spread, pegId)) {
          this.setPegElement(p.id, { el: "fire", stacks: 1 }, out);
          count++;
        }
        emit("flare", "fire", count, chips);
        return;
      }
      case "charge":
        this.setPegElement(pegId, { el: "storm", stacks: 1 }, out);
        emit("charge", "storm", 1, 0);
        return;
      case "burn": {
        const base = fresh ? BASE_CHIPS_FRESH : BASE_CHIPS_REPEAT;
        const chips = pay(base * (rx.chipMult - 1) + 6, "burn");
        const burnMult = this.sumCharm((c) => c.burnMult ?? 0);
        if (burnMult > 0) ctx.addMult(burnMult, "backdraft");
        const st = state!;
        const spread = fresh || this.charms.some((id) => CHARMS[id].spreadOnRepeat);
        let count = 1;
        if (spread && st.stacks > 0) {
          st.stacks--;
          for (const p of this.nearestUnstated(peg.x, peg.y, 1, pegId)) {
            this.setPegElement(p.id, { el: "fire", stacks: 1 }, out);
            count++;
          }
        }
        emit("burn", "fire", count, chips);
        return;
      }
      case "shatter": {
        const chips = pay(rx.chips, "shatter");
        this.setPegElement(pegId, null, out);
        // Cold spreads: the nearest bare peg freezes.
        let count = 1;
        for (const p of this.nearestUnstated(peg.x, peg.y, 1, pegId)) {
          this.freezePeg(p.id, out);
          count++;
        }
        emit("shatter", "ice", count, chips);
        return;
      }
      case "steam": {
        const chips = pay(rx.chips, "steam");
        ctx.addMult(rx.mult + this.sumCharm((c) => c.steamMult ?? 0), "steam");
        this.setPegElement(pegId, null, out);
        // Thermal Shock: the cloud refreezes the neighbourhood.
        const refreeze = this.sumCharm((c) => c.steamFreeze ?? 0);
        for (const p of this.nearestUnstated(peg.x, peg.y, refreeze, pegId)) this.freezePeg(p.id, out);
        emit("steam", "fire", 1 + refreeze, chips);
        return;
      }
      case "zap": {
        const arcChips = 4 + this.sumCharm((c) => c.arcChips ?? 0);
        let chips = 0;
        let count = 0;
        for (const p of this.nearestPegs(peg.x, peg.y, rx.arcs, pegId)) {
          if (ctx.lightPeg(p.id, pegId)) {
            chips += pay(arcChips, "arc");
            count++;
          }
          // Arcs shatter frozen pegs they touch.
          const ps = this.pegElements.get(p.id);
          if (ps?.el === "ice") {
            chips += pay(rx.arcs * 6, "shatter");
            this.setPegElement(p.id, null, out);
          }
        }
        const st = state!;
        if (!this.charms.some((id) => CHARMS[id].permanentCharge)) {
          st.stacks--;
          if (st.stacks <= 0) this.setPegElement(pegId, null, out);
        }
        ball.zaps++;
        const every = this.charms.map((id) => CHARMS[id].zapMultEvery ?? 0).filter((n) => n > 0);
        if (every.length && ball.zaps % Math.max(1, Math.min(...every) - (every.length - 1)) === 0) ctx.addMult(1, "ball lightning");
        emit("zap", "storm", count, chips);
        return;
      }
      case "wildfire": {
        let count = 0;
        for (const p of this.nearestUnstated(peg.x, peg.y, rx.spread, pegId)) {
          this.setPegElement(p.id, { el: "fire", stacks: 1 }, out);
          count++;
        }
        const chips = pay(8 * count, "wildfire");
        emit("wildfire", "fire", count, chips);
        return;
      }
      case "shatter_chain": {
        // Flood-fill through frozen pegs within reach of each other.
        const frozen = [...this.pegElements].filter(([, st]) => st.el === "ice").map(([id]) => id);
        const reach2 = 1.3 * 1.3;
        const visited = new Set<number>([pegId]);
        const queue = [pegId];
        while (queue.length) {
          const cur = this.sim.pegs[queue.shift()!]!;
          for (const id of frozen) {
            if (visited.has(id)) continue;
            const p = this.sim.pegs[id]!;
            if ((p.x - cur.x) ** 2 + (p.y - cur.y) ** 2 <= reach2) {
              visited.add(id);
              queue.push(id);
            }
          }
        }
        let chips = 0;
        for (const id of visited) {
          const st = this.pegElements.get(id);
          chips += pay((st?.stacks ?? 1) * 12, "chain");
          this.setPegElement(id, null, out);
          const p = this.sim.pegs[id]!;
          if (id !== pegId) out.push({ type: "zap", from: { x: peg.x, y: peg.y }, to: { x: p.x, y: p.y } });
        }
        if (visited.size >= 4) ctx.addMult(1, "chain");
        emit("shatter_chain", "storm", visited.size, chips);
        return;
      }
    }
  }

  /** Nearest pegs with no element state, excluding one. */
  private nearestUnstated(x: number, y: number, n: number, exclude: number) {
    return this.sim.pegs
      .filter((p) => p.id !== exclude && !this.pegElements.has(p.id))
      .map((p) => ({ p, d: (p.x - x) ** 2 + (p.y - y) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n)
      .map((e) => e.p);
  }

  private nearestPegs(x: number, y: number, n: number, exclude: number) {
    return this.sim.pegs
      .filter((p) => p.id !== exclude)
      .map((p) => ({ p, d: (p.x - x) ** 2 + (p.y - y) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n)
      .map((e) => e.p);
  }

  private sumCharm(f: (c: Charm) => number): number {
    return this.charms.reduce((acc, id) => acc + f(CHARMS[id]), 0);
  }

  /** Growth charms (Snowball): each copy pays its growth once per round held. */
  /** Bag slots for `round` (default: current). The shop asks about round+1 to warn when a ball offer will evict old customs. */
  bagCapacity(round = this.round): number {
    return this.ballsPerRound + Math.floor((round - 1) / BALL_EVERY_ROUNDS) + this.sumCharm((c) => c.extraBalls ?? 0) + this.growthBalls(round);
  }

  private growthBalls(round: number): number {
    let n = 0;
    for (let i = 0; i < this.charms.length; i++) {
      const g = CHARMS[this.charms[i]!].extraBallsGrowth ?? 0;
      if (g) n += g * Math.max(0, round - (this.charmAcquired.get(i) ?? 0));
    }
    return n;
  }

  private nearestUnlit(x: number, y: number, n: number, excludePeg: number) {
    return this.sim.pegs
      .filter((p) => p.id !== excludePeg && !this.lit.has(p.id))
      .map((p) => ({ p, d: (p.x - x) ** 2 + (p.y - y) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n)
      .map((e) => e.p);
  }

  dispose(): void {
    this.sim.dispose();
  }
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
  }
  return arr;
}

function weightedPick<T>(rng: Rng, items: readonly T[], weight: (t: T) => number): T {
  const total = items.reduce((a, t) => a + weight(t), 0);
  let r = rng.next() * total;
  for (const t of items) {
    r -= weight(t);
    if (r <= 0) return t;
  }
  return items[items.length - 1] as T;
}
