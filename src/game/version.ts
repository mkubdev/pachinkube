/**
 * Bump RULES_VERSION whenever a change alters what a replay would compute:
 * sim physics, scoring, charms, combo rules, targets, shop rolls.
 *
 * A submission carries the version its client played under. If the server is
 * on a different version the score is stored *unverified* rather than
 * rejected: a deploy mid-run must never eat a real run.
 */
export const RULES_VERSION = 8; // 8: 15 s / 10 s ball timers, fins only on the top two odd rows // 5: magnet pull dead zone / rest skip
