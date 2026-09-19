/**
 * Score model: every ball earns CHIPS from peg hits and carries a MULT.
 * When it lands, ball score = chips × mult × pocket multiplier.
 * Charms mostly push one of those three numbers.
 */
export const BASE_CHIPS_FRESH = 10;
export const BASE_CHIPS_REPEAT = 3;

/** Pocket multipliers, symmetric, centre is the jackpot. */
export function bucketMultipliers(buckets: number): number[] {
  const mid = (buckets - 1) / 2;
  return Array.from({ length: buckets }, (_, i) => {
    const d = Math.abs(i - mid);
    if (d < 0.5) return 5;
    if (d < 1.5) return 3;
    if (d < 2.5) return 2;
    return 1;
  });
}

export function ballScore(chips: number, mult: number, bucketMult: number): number {
  return Math.floor(chips * mult * bucketMult);
}

/**
 * Round targets, tuned with the balance probe against a dumb policy:
 * ~100% pass on round 1, ~50% by rounds 5–7. Combos made the early game much
 * richer, so the base is high and the growth gentle.
 */
export function roundTarget(round: number): number {
  return Math.floor(900 * Math.pow(1.62, round - 1));
}
