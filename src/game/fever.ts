/**
 * FEVER: the combo counter drives a global multiplier applied to every ball
 * that lands while the chain is alive. Quadratic past ignition so depth
 * compounds — the engine that replaced exponential multiball (Split Shot).
 * Spec: docs/superpowers/specs/2026-09-22-fever-design.md
 */
export const FEVER_IGNITION = 50;
export const FEVER_RAMP = 50;

export function feverMultiplier(combo: number, ignition = FEVER_IGNITION, ramp = FEVER_RAMP): number {
  if (combo < ignition) return 1;
  const t = (combo - ignition) / ramp;
  return 1 + t * t;
}
