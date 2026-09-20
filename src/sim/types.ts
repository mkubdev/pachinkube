export interface Vec2 {
  x: number;
  y: number;
}

export interface Peg extends Vec2 {
  id: number;
  radius: number;
}

/** A wall fin: fixed ramp from the wall (x1,y1) down and inward to its tip (x2,y2). */
export interface Fin {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BallState extends Vec2 {
  id: number;
  vx: number;
  vy: number;
  radius: number;
  tag?: string;
}

export interface SimConfig {
  seed: string | number;
  /** Board dimensions in metres; origin is bottom-centre of the play field. */
  width: number;
  height: number;
  pegRows: number;
  pegCols: number;
  pegRadius: number;
  ballRadius: number;
  gravity: number;
  restitution: number;
  /** Fixed physics step in seconds. */
  dt: number;
  /** Scoring pockets along the bottom edge. Odd numbers give a centre jackpot. */
  buckets: number;
}

/** Everything needed to put a ball into the world. */
export interface BallSpawn {
  x: number;
  y?: number;
  vx?: number;
  vy?: number;
  radius?: number;
  restitution?: number;
  density?: number;
  /** 1 = normal gravity; < 1 floats, > 1 plummets. */
  gravityScale?: number;
  /** Constant horizontal force toward x = 0, as a multiple of the ball's weight. */
  pull?: number;
  /** Gravity well: other balls within `WELL_RADIUS` are pulled toward this ball, this × their weight. */
  well?: number;
  /** Opaque label for the game layer, e.g. the ball type id. */
  tag?: string;
}

/** Wall fins reach this far in from the wall; their tip must stay a Heavy-width clear of the odd-row edge peg. */
export const FIN_REACH = 0.45;
export const FIN_DROP = 0.44;

/** Bumper pegs: bigger, bouncier, and they pop the ball away (see Sim.setPegBumper). */
export const BUMPER_RADIUS = 0.16;
export const BUMPER_RESTITUTION = 0.9;

export const DEFAULT_CONFIG: SimConfig = {
  seed: "pachinkube",
  width: 6,
  height: 10,
  pegRows: 9,
  pegCols: 7,
  pegRadius: 0.08,
  ballRadius: 0.14,
  gravity: -9.81,
  restitution: 0.55,
  dt: 1 / 120,
  buckets: 7,
};

/** Gameplay events the roguelite layer subscribes to; charms hook in here. */
export type SimEvent =
  | { type: "pegHit"; ball: number; peg: number; speed: number }
  /** A portal caught the ball at pocket `bucket` and sent it back to the top. */
  | { type: "portal"; ball: number; bucket: number }
  /** Ball left the board through pocket `bucket` (0..buckets-1), or -1. */
  | { type: "ballLost"; ball: number; bucket: number }
  | { type: "wallHit"; ball: number };

/** Horizontal drift applied to pegs; alternating rows move in opposite phase. */
export interface PegMotion {
  amplitude: number;
  /** Radians per tick. */
  omega: number;
}

export interface Snapshot {
  tick: number;
  balls: BallState[];
  /** Current x offset per peg id when pegs are moving; absent when static. */
  pegOffsets?: Float32Array;
}
