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
 * Round targets, tuned with the balance probe against a dumb policy (120 seeds,
 * `.cache/tune.txt`): ~95%+ pass through round 3, easing to ~65% by round 8, so
 * the clear is a real wall rather than a cliff after seven free rounds.
 */
export function roundTarget(round: number): number {
  // Dumb-policy scores grow ~1.23×/round, so the old 800 base × 1.58 started
  // twelve times under the player and only caught up at round 8. The base now
  // sits just under the bottom decile of round 1 and climbs 1.37× through the
  // "machine cleared" round (r8 ≈ 27K), then 1.32× so endless is a climb:
  // r10 ≈ 47K, r12 ≈ 82K, r15 ≈ 189K.
  const base = 3000 * Math.pow(1.37, Math.min(round, 8) - 1);
  return Math.floor(round <= 8 ? base : base * Math.pow(1.32, round - 8));
}
