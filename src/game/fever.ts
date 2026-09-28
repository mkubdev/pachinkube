/**
 * FEVER MODE: a gauge charged by combo hits; when full, a timed jackpot mode
 * multiplies every landing. Refill the gauge before the timer runs out to
 * re-chain to the next level. Replaces the always-on quadratic fever.
 * Spec: docs/superpowers/specs/2026-09-22-fever-mode-design.md
 */
export const FEVER_GAUGE_BASE = 100;
export const FEVER_MODE_TICKS = 960; // 8 s at 120 Hz
export const FEVER_REQ_GROWTH = 1.25;

/** Mode multiplier at `level`; `curveBoost` (Heat Sink) adds boost × level². */
export function feverMult(level: number, curveBoost = 0): number {
  if (level <= 0) return 1;
  return 1 + 2 * level + curveBoost * level * level;
}

/** Gauge units to go from `level` to `level + 1` (level 0 = first ignition). */
export function feverGaugeRequirement(level: number, scale = 1): number {
  return Math.max(1, Math.floor(FEVER_GAUGE_BASE * scale * FEVER_REQ_GROWTH ** level));
}
