/**
 * The roguelite run: rounds, targets, a bag of balls, charms, and a shop.
 *
 * Headless and deterministic like the sim under it: the same seed and the same
 * `drop()`/`pick()` calls at the same ticks produce the same final score.
 * Everything the UI needs arrives as `GameEvent`s from `step()`.
 */
import { Sim } from "../sim/world.js";
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

/** Runs are endless: targets keep climbing until you miss one. Round 8 is the
 *  "machine cleared" milestone, not the end. Tests pass a finite `rounds`. */
export const CLEAR_ROUND = 8;
export const ROUNDS = Number.POSITIVE_INFINITY;
export const BALLS_PER_ROUND = 6;
export const SHOP_OFFERS = 3;

export type Phase = "drop" | "shop" | "won" | "lost";

export type Offer = { kind: "charm"; id: CharmId } | { kind: "ball"; id: BallTypeId; count: number };

/** Peg hits closer together than this (in ticks) chain into one combo. */
export const COMBO_WINDOW_TICKS = 72; // 0.6 s at 120 Hz
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
  | { type: "pegsReset" }
  | { type: "ballScored"; ball: number; score: number; bucket: number; chips: number; mult: number }
  | { type: "roundEnd"; round: number; passed: boolean; roundScore: number; target: number }
  | { type: "phase"; phase: Phase }
  | { type: "shake"; strength: number };

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

  /** Pocket multipliers after charm bonuses, for UI and scoring. */
  pocketMultipliers(): number[] {
    const bonus = this.sumCharm((c) => c.bucketBonus ?? 0);
    const edge = this.sumCharm((c) => c.edgeBonus ?? 0);
    const jackpot = this.charms.reduce((f, id) => f * (CHARMS[id].jackpotFactor ?? 1), 1);
    const last = this.bucketMults.length - 1;
    const mid = last / 2;
    return this.bucketMults.map((m, i) => (m + bonus + (i === 0 || i === last ? edge : 0)) * (i === mid ? jackpot : 1));
  }

  comboWindow(): number {
    return COMBO_WINDOW_TICKS + this.sumCharm((c) => c.comboWindowBonus ?? 0);
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

  /** Take shop offer `index`. */
  pick(index: number): boolean {
    if (this.phase !== "shop") return false;
    const offer = this.offers[index];
    if (!offer) return false;
    this.log.push({ tick: this.sim.tick, action: { type: "pick", index } });
    if (offer.kind === "charm") {
      this.charms.push(offer.id);
      const dur = CHARMS[offer.id].duration;
      // Acquired after round N ends: lasts rounds N+1 .. N+dur.
      if (dur) this.charmExpires.set(this.charms.length - 1, this.round + dur);
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

    if (this.combo > 0 && this.sim.tick - this.lastHitTick > this.comboWindow()) {
      out.push({ type: "comboEnd", count: this.combo });
      this.combo = 0;
    }
    if (this.ballsLeft === 0 && this.sim.ballCount === 0) this.endRound(out);
    return out;
  }

  // --- internals -----------------------------------------------------------------

  /** Remove temporary charms whose last round has passed. Returns their ids. */
  private expireCharms(): CharmId[] {
    const gone: CharmId[] = [];
    for (let i = this.charms.length - 1; i >= 0; i--) {
      const until = this.charmExpires.get(i);
      if (until !== undefined && this.round > until) {
        gone.push(this.charms[i]!);
        this.charms.splice(i, 1);
        this.charmExpires.delete(i);
        // Re-key expiries above the removed index.
        for (const [k, v] of [...this.charmExpires]) {
          if (k > i) {
            this.charmExpires.delete(k);
            this.charmExpires.set(k - 1, v);
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
    for (let i = this.charms.length - 1; i >= 0; i--) {
      const el = CHARMS[this.charms[i]!].element;
      if (el) return el;
    }
    return null;
  }

  private setPegElement(peg: number, state: PegElementState | null, out: GameEvent[]): void {
    if (state) this.pegElements.set(peg, state);
    else this.pegElements.delete(peg);
    this.sim.setPegRestitution(peg, state?.el === "ice" ? ICE_RESTITUTION : this.sim.config.restitution);
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
    // Frost: freeze N pegs chosen by the layout stream, thickest at the top.
    const frozen = this.sumCharm((c) => c.frozenAtStart ?? 0);
    if (frozen > 0) {
      const ids = shuffle(this.sim.pegs.map((p) => p.id), this.sim.streams.layout).slice(0, frozen);
      for (const peg of ids) this.setPegElement(peg, { el: "ice", stacks: 1 }, pending);
    }
    this.pendingRoundEvents = pending;
    this.combo = 0;
    this.lastHitTick = -1;
    this.landedThisRound = 0;
    this.ballExtra.clear();
    this.phase = "drop";
    // One more ball every five rounds, so deep runs keep widening.
    this.ballsLeft = this.ballsPerRound + Math.floor((this.round - 1) / 5) + this.sumCharm((c) => c.extraBalls ?? 0);
    // Board motion: the largest drift among held charms wins.
    const drift = this.charms
      .map((id) => CHARMS[id].pegDrift)
      .filter((d): d is { amplitude: number; period: number } => !!d)
      .sort((a, b) => b.amplitude - a.amplitude)[0];
    this.sim.setPegMotion(drift ? { amplitude: drift.amplitude, omega: (2 * Math.PI) / (drift.period / this.sim.config.dt) } : null);
    // Shuffle the owned balls with the shop stream so the order is seeded.
    this.bag = shuffle([...this.ownedBalls], this.sim.streams.shop).slice(0, this.ballsLeft);
    while (this.bag.length < this.ballsLeft) this.bag.push("steel");
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
      // Stackable charms may repeat; the rest only appear if not owned.
      const stackable =
        id === "magnet_coil" || id === "neon_sign" || id === "extra_ball" ||
        id === "warm_start" || id === "fresh_paint" || id === "echo" || id === "insurance";
      if (seen.has(id) || (!stackable && this.charms.includes(id))) continue;
      seen.add(id);
      offers.push({ kind: "charm", id });
    }
    return offers;
  }

  private spawn(req: BallSpawn & { type: BallTypeId; element?: Element | null }, fromBag: boolean): number {
    const type = BALL_TYPES[req.type];
    let spawn: BallSpawn = { ...type.physics, ...req, tag: req.tag ?? req.type };
    for (const id of this.charms) {
      const c = CHARMS[id];
      if (c.onSpawn) spawn = c.onSpawn(spawn, { round: this.round, type: req.type });
    }
    const ballId = this.sim.spawnBall(spawn);
    const el = req.element !== undefined ? req.element : fromBag ? this.activeElement() : null;
    if (el) this.ballElements.set(ballId, el);
    this.balls.set(ballId, {
      id: ballId,
      type: req.type,
      // Passives that shape a ball before it touches anything.
      chips: fromBag ? this.sumCharm((c) => c.startChips ?? 0) : 0,
      mult: 1 + (fromBag ? this.sumCharm((c) => c.momentum ?? 0) * this.landedThisRound : 0),
      hits: 0,
      freshHits: 0,
      revives: 0,
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
      const base = Math.round(((fresh ? BASE_CHIPS_FRESH : BASE_CHIPS_REPEAT) + bonus) * type.chipFactor + speedChips);
      ball.chips += base;
      out.push({ type: "pegHit", peg: ev.peg, x: peg.x, y: peg.y, fresh, tag: ball.type, speed: ev.speed });
      out.push({ type: "popup", x: peg.x, y: peg.y, text: `+${Math.round(base)}`, kind: "chips", hits: ball.hits, fresh, tag: ball.type });

      // Combo: hits chained across every ball in flight. Milestones pay out
      // +1 mult to all balls in play, so multiball is worth engineering.
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.lastHitTick = this.sim.tick;
      const milestone = this.combo % this.comboMilestone() === 0;
      out.push({ type: "combo", count: this.combo, milestone });
      if (milestone) {
        for (const b of this.balls.values()) b.mult += 1;
        out.push({ type: "popup", x: 0, y: this.sim.config.height * 0.55, text: `COMBO ${this.combo} · +1 mult all`, kind: "mult" });
        out.push({ type: "shake", strength: 0.35 });
      }

      if (ball.type === "spark" && this.sim.streams.fx.next() < 0.25) ctx.addMult(1, "spark");

      // Elements: ball element × peg state → reaction.
      this.resolveElement(ball, ev.peg, peg, fresh, ctx, out);

      // Ball traits that react to hits.
      const t = type.traits;
      if (t?.lightNeighbor && fresh) {
        for (const p of this.nearestUnlit(peg.x, peg.y, t.lightNeighbor, ev.peg)) {
          if (ctx.lightPeg(p.id, ev.peg)) ctx.addChips(5, "prism");
        }
        ctx.fx("prism", peg.x, peg.y, 0.5);
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
        const every = Math.min(...zapEvery);
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
      for (const id of this.charms) CHARMS[id].onWallHit?.(ctx);
      return;
    }

    // ballLost
    const mults = this.pocketMultipliers();
    const bucketMult = ev.bucket >= 0 ? (mults[ev.bucket] ?? 1) : 0;
    const extra = this.ballExtra.get(ev.ball);
    const cxLand = this.sim.bucketCenters[ev.bucket] ?? 0;

    const landTraits = BALL_TYPES[ball.type].traits;
    if (landTraits?.multOnLand) ctx.addMult(landTraits.multOnLand, "gold");
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

    let scored = true;
    for (const id of this.charms) {
      if (CHARMS[id].onBallLost?.(ctx, ev.bucket, bucketMult) === false) scored = false;
    }
    this.balls.delete(ev.ball);
    this.ballExtra.delete(ev.ball);
    this.ballElements.delete(ev.ball);
    if (!scored) return;
    this.landedThisRound++;
    const score = ballScore(ball.chips, ball.mult, bucketMult);
    this.roundScore += score;
    this.totalScore += score;
    const cx = this.sim.bucketCenters[ev.bucket] ?? 0;
    out.push({ type: "ballScored", ball: ev.ball, score, bucket: ev.bucket, chips: ball.chips, mult: ball.mult });
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
      case "ignite":
        this.setPegElement(pegId, { el: "fire", stacks: 2 }, out);
        emit("ignite", "fire", 1, 0);
        return;
      case "freeze":
        this.setPegElement(pegId, { el: "ice", stacks: 1 }, out);
        emit("freeze", "ice", 1, 0);
        return;
      case "charge":
        this.setPegElement(pegId, { el: "storm", stacks: 1 }, out);
        emit("charge", "storm", 1, 0);
        return;
      case "burn": {
        const base = fresh ? BASE_CHIPS_FRESH : BASE_CHIPS_REPEAT;
        const chips = pay(base * (rx.chipMult - 1) + 6, "burn");
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
          this.setPegElement(p.id, { el: "ice", stacks: 1 }, out);
          count++;
        }
        emit("shatter", "ice", count, chips);
        return;
      }
      case "steam": {
        const chips = pay(rx.chips, "steam");
        ctx.addMult(rx.mult + this.sumCharm((c) => c.steamMult ?? 0), "steam");
        this.setPegElement(pegId, null, out);
        emit("steam", "fire", 1, chips);
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
        st.stacks--;
        if (st.stacks <= 0) this.setPegElement(pegId, null, out);
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
