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

/** Board features: obstacles charms place in the field (see run.ts for scoring). */
export type FeatureKind = "target_bank" | "drop_target" | "spinner" | "orbit";

/** One collider of a feature. `r` = circle; `w`/`h` = axis-aligned bar. */
export interface FeaturePart {
  x: number;
  y: number;
  r?: number;
  w?: number;
  h?: number;
}

export interface BoardFeature {
  id: number;
  kind: FeatureKind;
  /** Anchor position; `parts` carry absolute world coordinates. */
  x: number;
  y: number;
  parts: FeaturePart[];
}

/**
 * Part layout per kind, as offsets from the feature anchor. Kinds absent here
 * are not implemented yet and `Sim.addFeature` refuses them — wave 2 (spinner)
 * and wave 3 (orbit) fill them in.
 */
export const FEATURE_SHAPES: Partial<Record<FeatureKind, FeaturePart[]>> = {
  target_bank: [
    { x: -0.34, y: 0, r: 0.1 },
    { x: 0, y: 0.16, r: 0.1 },
    { x: 0.34, y: 0, r: 0.1 },
  ],
  drop_target: [{ x: 0, y: 0, w: 0.5, h: 0.1 }],
};

/** Features bounce like bumpers so a hit reads as a hit. */
export const FEATURE_RESTITUTION = 0.85;

/**
 * A peg this close to a feature part is switched off: anything tighter could
 * wedge the widest ball (Heavy, r = 0.2) between peg and feature.
 */
export const FEATURE_CLEARANCE = 0.45;

/**
 * Legal anchor points as fractions of board width (x, 0 = centre) and height
 * (y). The low row sits in the clear band between the bottom peg row and the
 * pocket dividers; the two mid anchors sit inside the field and displace pegs.
 */
export const FEATURE_ANCHORS: ReadonlyArray<{ x: number; y: number }> = [
  { x: -0.3, y: 0.15 },
  { x: 0, y: 0.15 },
  { x: 0.3, y: 0.15 },
  { x: -0.33, y: 0.4 },
  { x: 0.33, y: 0.4 },
];

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
  /** A ball struck part `part` of board feature `feature`. */
  | { type: "featureHit"; ball: number; feature: number; part: number; speed: number }
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
