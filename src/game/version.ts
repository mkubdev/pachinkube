/**
 * Bump RULES_VERSION whenever a change alters what a replay would compute:
 * sim physics, scoring, charms, combo rules, targets, shop rolls.
 *
 * A submission carries the version its client played under. If the server is
 * on a different version the score is stored *unverified* rather than
 * rejected: a deploy mid-run must never eat a real run.
 */
export const RULES_VERSION = 7; // 7: bumper pegs, balls every 3 rounds, 0.45 s combo window // 5: magnet pull dead zone / rest skip
