/**
 * Seeded randomness for the simulation.
 *
 * Never use Math.random anywhere in `sim/`. Every source of randomness is a
 * named stream derived from the run seed, so that e.g. the charm shop pulling
 * a number cannot change how the next ball bounces.
 */

/** FNV-1a: stable string -> uint32, used to derive stream seeds. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: tiny, fast, good enough statistical quality for gameplay. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick from empty array");
    return items[Math.floor(this.next() * items.length)] as T;
  }
}

export const STREAMS = ["layout", "drop", "shop", "fx"] as const;
export type StreamName = (typeof STREAMS)[number];

export type Streams = Record<StreamName, Rng>;

/** One independent generator per stream, all reproducible from the run seed. */
export function makeStreams(seed: string | number): Streams {
  const base = typeof seed === "number" ? seed >>> 0 : hash32(seed);
  const out = {} as Streams;
  for (const name of STREAMS) {
    out[name] = new Rng(hash32(`${base}:${name}`));
  }
  return out;
}
