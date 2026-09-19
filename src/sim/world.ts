/**
 * The deterministic pachinko simulation.
 *
 * Pure TypeScript + Rapier2D. No Three.js, no DOM: this module must keep
 * running headless in Node so it can be unit-tested, replayed on the server
 * to verify submitted scores, and batch-run for balance tuning.
 *
 * Determinism contract: same `SimConfig` (incl. seed) + same sequence of
 * `dropBall()` calls at the same ticks => identical `hash()` at every tick.
 */
import RAPIER from "@dimforge/rapier2d-compat";

import { hash32, makeStreams, type Streams } from "./rng.js";
import {
  DEFAULT_CONFIG,
  type BallSpawn,
  type BallState,
  type Peg,
  type SimConfig,
  type SimEvent,
  type Snapshot,
} from "./types.js";

let rapierReady: Promise<void> | null = null;
function initRapier(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export class Sim {
  readonly config: SimConfig;
  readonly streams: Streams;
  readonly pegs: Peg[] = [];
  tick = 0;

  private readonly world: RAPIER.World;
  private readonly events = new RAPIER.EventQueue(true);
  private readonly balls = new Map<number, RAPIER.RigidBody>();
  private readonly ballMeta = new Map<number, { radius: number; tag?: string; collider: number; still: number; nudges: number; pull: number }>();
  private readonly colliderToBall = new Map<number, number>();
  private readonly colliderToPeg = new Map<number, number>();
  private readonly bucketSensors = new Map<number, number>();
  private wallHandles = new Set<number>();
  private nextBallId = 1;
  /** Pocket centre x positions, index = bucket id. */
  readonly bucketCenters: number[] = [];

  private constructor(config: SimConfig) {
    this.config = config;
    this.streams = makeStreams(config.seed);
    this.world = new RAPIER.World({ x: 0, y: config.gravity });
    this.world.timestep = config.dt;
    this.buildBoard();
  }

  static async create(overrides: Partial<SimConfig> = {}): Promise<Sim> {
    await initRapier();
    return new Sim({ ...DEFAULT_CONFIG, ...overrides });
  }

  // --- board ---------------------------------------------------------------

  private buildBoard(): void {
    const { width, height, pegRows, pegCols, pegRadius } = this.config;
    const half = width / 2;
    const fixed = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

    // Side walls, slightly taller than the board so a drop from above stays in.
    const wallThickness = 0.2;
    for (const sx of [-1, 1]) {
      const c = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(wallThickness / 2, height)
          .setTranslation(sx * (half + wallThickness / 2), height / 2)
          .setRestitution(this.config.restitution)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        fixed,
      );
      this.wallHandles.add(c.handle);
    }

    // Pockets along the bottom: short divider walls so a ball settles into
    // exactly one, and a sensor per pocket that reports which one it was.
    const { buckets } = this.config;
    const bw = width / buckets;
    const dividerH = 0.9;
    for (let i = 0; i <= buckets; i++) {
      if (i === 0 || i === buckets) continue; // outer edges are the walls
      const x = -half + i * bw;
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.035, dividerH / 2)
          .setTranslation(x, dividerH / 2)
          .setRestitution(0.3),
        fixed,
      );
    }
    for (let i = 0; i < buckets; i++) {
      const cx = -half + bw * (i + 0.5);
      this.bucketCenters.push(cx);
      const sensor = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(bw / 2 - 0.02, 0.2)
          .setTranslation(cx, -0.45)
          .setSensor(true)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        fixed,
      );
      this.bucketSensors.set(sensor.handle, i);
    }
    // Catch-all far below so nothing can leak out of the world.
    const floor = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half + 2, 0.2)
        .setTranslation(0, -2)
        .setSensor(true)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      fixed,
    );
    this.bucketSensors.set(floor.handle, -1);

    // Staggered peg field. The layout stream adds a tiny per-seed jitter so
    // each run has its own board while staying fully reproducible.
    const layout = this.streams.layout;
    const top = height * 0.86;
    const bottom = height * 0.22;
    const rowGap = (top - bottom) / Math.max(pegRows - 1, 1);
    const margin = 0.45;
    const colGap = (width - margin * 2) / Math.max(pegCols - 1, 1);
    let id = 0;
    for (let r = 0; r < pegRows; r++) {
      const offset = r % 2 === 1 ? colGap / 2 : 0;
      const cols = r % 2 === 1 ? pegCols - 1 : pegCols;
      for (let c = 0; c < cols; c++) {
        const x = -half + margin + offset + c * colGap + layout.range(-0.04, 0.04);
        const y = top - r * rowGap + layout.range(-0.03, 0.03);
        const col = this.world.createCollider(
          RAPIER.ColliderDesc.ball(pegRadius)
            .setTranslation(x, y)
            .setRestitution(this.config.restitution)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
          fixed,
        );
        this.pegs.push({ id, x, y, radius: pegRadius });
        this.colliderToPeg.set(col.handle, id);
        id++;
      }
    }
  }

  // --- balls ---------------------------------------------------------------

  /** Drop a ball from above the board. `x` defaults to the drop stream. */
  dropBall(x?: number, opts: Omit<BallSpawn, "x"> = {}): number {
    const { width } = this.config;
    const px = x ?? this.streams.drop.range(-width / 2 + 0.5, width / 2 - 0.5);
    return this.spawnBall({ x: px, ...opts });
  }

  /** Put a ball anywhere with any velocity: used by drops and by charm effects. */
  spawnBall(spawn: BallSpawn): number {
    const { width, height, ballRadius, restitution } = this.config;
    const half = width / 2;
    const radius = spawn.radius ?? ballRadius;
    const x = Math.min(half - radius - 0.01, Math.max(-half + radius + 0.01, spawn.x));
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, spawn.y ?? height + 0.5)
        .setLinvel(spawn.vx ?? 0, spawn.vy ?? 0)
        .setGravityScale(spawn.gravityScale ?? 1)
        .setCcdEnabled(true),
    );
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.ball(radius)
        .setRestitution(spawn.restitution ?? restitution)
        .setFriction(0.2)
        .setDensity(spawn.density ?? 7.8) // steel by default
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    const id = this.nextBallId++;
    this.balls.set(id, body);
    this.ballMeta.set(id, { radius, tag: spawn.tag, collider: col.handle, still: 0, nudges: 0, pull: spawn.pull ?? 0 });
    this.colliderToBall.set(col.handle, id);
    return id;
  }

  ballPosition(id: number): { x: number; y: number } | null {
    const b = this.balls.get(id);
    return b ? { ...b.translation() } : null;
  }

  ballTag(id: number): string | undefined {
    return this.ballMeta.get(id)?.tag;
  }

  get ballCount(): number {
    return this.balls.size;
  }

  // --- stepping ------------------------------------------------------------

  /** Advance exactly one fixed step and return the gameplay events it produced. */
  step(): SimEvent[] {
    this.applyPulls();
    this.world.step(this.events);
    this.tick++;
    const forced = this.unstickBalls();

    const out: SimEvent[] = [];
    const lost: Array<[number, number]> = [];
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const ballId = this.colliderToBall.get(h1) ?? this.colliderToBall.get(h2);
      if (ballId === undefined) return;
      const other = this.colliderToBall.has(h1) ? h2 : h1;

      const bucket = this.bucketSensors.get(other);
      if (bucket !== undefined) {
        if (!lost.some(([id]) => id === ballId)) lost.push([ballId, bucket]);
        return;
      }
      const peg = this.colliderToPeg.get(other);
      if (peg !== undefined) {
        const v = this.balls.get(ballId)?.linvel() ?? { x: 0, y: 0 };
        out.push({ type: "pegHit", ball: ballId, peg, speed: Math.hypot(v.x, v.y) });
        return;
      }
      if (this.wallHandles.has(other)) out.push({ type: "wallHit", ball: ballId });
    });

    for (const [id, bucket] of forced) if (!lost.some(([l]) => l === id)) lost.push([id, bucket]);
    // Deterministic removal order regardless of event order.
    lost.sort((a, b) => a[0] - b[0]);
    for (const [id, bucket] of lost) {
      const body = this.balls.get(id);
      const meta = this.ballMeta.get(id);
      if (!body || !meta) continue;
      this.colliderToBall.delete(meta.collider);
      this.world.removeRigidBody(body);
      this.balls.delete(id);
      this.ballMeta.delete(id);
      out.push({ type: "ballLost", ball: id, bucket });
    }
    return out;
  }

  /** Balls with `pull` are nudged toward the centre line every step. */
  private applyPulls(): void {
    const g = Math.abs(this.config.gravity);
    for (const [id, body] of this.balls) {
      const meta = this.ballMeta.get(id);
      if (!meta || meta.pull === 0) continue;
      const x = body.translation().x;
      const dir = x > 0.05 ? -1 : x < -0.05 ? 1 : 0;
      if (dir === 0) continue;
      body.addForce({ x: dir * meta.pull * body.mass() * g, y: 0 }, true);
    }
  }

  /**
   * A ball resting on a divider or wedged between pegs would hold the round
   * open forever. After ~0.5 s of stillness it gets a small seeded nudge; after
   * three nudges it is dropped into the pocket under it.
   */
  private unstickBalls(): Array<[number, number]> {
    const forced: Array<[number, number]> = [];
    if (this.tick % 6 !== 0) return forced;
    const stillTicks = 60;
    for (const [id, body] of this.balls) {
      const meta = this.ballMeta.get(id);
      if (!meta) continue;
      const v = body.linvel();
      if (v.x * v.x + v.y * v.y < 0.0025) meta.still += 6;
      else meta.still = 0;
      if (meta.still < stillTicks) continue;
      meta.still = 0;
      if (meta.nudges >= 3) {
        forced.push([id, this.bucketAt(body.translation().x)]);
        continue;
      }
      meta.nudges++;
      const dir = this.streams.fx.next() < 0.5 ? -1 : 1;
      body.applyImpulse({ x: dir * 0.6 * body.mass(), y: 1.5 * body.mass() }, true);
    }
    return forced;
  }

  /** Pocket index under board x. */
  bucketAt(x: number): number {
    const { width, buckets } = this.config;
    const i = Math.floor((x + width / 2) / (width / buckets));
    return Math.max(0, Math.min(buckets - 1, i));
  }

  // --- state ---------------------------------------------------------------

  snapshot(): Snapshot {
    const balls: BallState[] = [];
    for (const [id, body] of this.balls) {
      const p = body.translation();
      const v = body.linvel();
      const meta = this.ballMeta.get(id);
      balls.push({ id, x: p.x, y: p.y, vx: v.x, vy: v.y, radius: meta?.radius ?? this.config.ballRadius, tag: meta?.tag });
    }
    return { tick: this.tick, balls };
  }

  /**
   * Digest of the full dynamic state, for determinism checks and the HUD.
   * Mixes raw float bits (no string building), so it is cheap enough to call
   * on every ball-lost event; still avoid calling it every frame.
   */
  hash(): string {
    const f64 = this.hashScratch;
    const u32 = this.hashScratchU32;
    let h = (0x811c9dc5 ^ this.tick) >>> 0;
    const mix = (v: number): void => {
      h = Math.imul(h ^ v, 0x01000193) >>> 0;
    };
    for (const [id, body] of this.balls) {
      const p = body.translation();
      const v = body.linvel();
      f64[0] = p.x; f64[1] = p.y; f64[2] = v.x; f64[3] = v.y;
      mix(id);
      for (let i = 0; i < 8; i++) mix(u32[i] as number);
    }
    return h.toString(16).padStart(8, "0");
  }

  private readonly hashScratch = new Float64Array(4);
  private readonly hashScratchU32 = new Uint32Array(this.hashScratch.buffer);

  dispose(): void {
    this.events.free();
    this.world.free();
  }
}
