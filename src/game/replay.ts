/**
 * Headless replay of a run from its seed and input log.
 *
 * Because the sim and the run are deterministic, replaying the same inputs at
 * the same ticks reproduces the same score. The leaderboard uses this to
 * verify submissions instead of trusting the client's number.
 */
import { Run, type RunInput } from "./run";
import { BALL_IDS, type BallTypeId } from "./balls";
import { CHARM_IDS, type CharmId } from "./charms";
import type { Pool } from "./meta";

export interface ReplayResult {
  score: number;
  ticks: number;
  phase: string;
  round: number;
}

export const MAX_REPLAY_TICKS = 120 * 60 * 40; // 40 minutes of game time
export const MAX_LOG_ENTRIES = 2000;

export function validateLog(log: unknown): log is RunInput[] {
  if (!Array.isArray(log) || log.length > MAX_LOG_ENTRIES) return false;
  let lastTick = -1;
  for (const e of log) {
    if (typeof e !== "object" || e === null) return false;
    const { tick, action } = e as RunInput;
    if (!Number.isInteger(tick) || tick < lastTick || tick > MAX_REPLAY_TICKS) return false;
    lastTick = tick;
    if (typeof action !== "object" || action === null) return false;
    if (action.type === "drop") {
      if (!Number.isFinite(action.x) || Math.abs(action.x) > 10) return false;
    } else if (action.type === "pick") {
      if (!Number.isInteger(action.index) || action.index < 0 || action.index > 8) return false;
    } else return false;
  }
  return true;
}

/** A pool is a subset of known ids; the server cannot know if it was earned, only that it is well-formed. */
export function validatePool(pool: unknown): pool is Pool {
  if (typeof pool !== "object" || pool === null) return false;
  const p = pool as { charms?: unknown; balls?: unknown };
  const ok = (xs: unknown, known: readonly string[]) =>
    Array.isArray(xs) && xs.length <= known.length && xs.every((x) => typeof x === "string" && known.includes(x)) &&
    new Set(xs).size === xs.length;
  return ok(p.charms, CHARM_IDS) && ok(p.balls, BALL_IDS);
}

export async function replay(seed: string, log: RunInput[], pool?: Pool, maxTicks = MAX_REPLAY_TICKS): Promise<ReplayResult> {
  const run = await Run.create(seed, pool ? { pool: { charms: pool.charms as CharmId[], balls: pool.balls as BallTypeId[] } } : {});
  try {
    let i = 0;
    // Inputs are applied before the step of the tick they were recorded on,
    // exactly as the live loop does (drop/pick happen between steps).
    while (run.sim.tick < maxTicks) {
      while (i < log.length && log[i]!.tick === run.sim.tick) {
        const a = log[i]!.action;
        if (a.type === "drop") run.drop(a.x);
        else run.pick(a.index);
        i++;
      }
      if (run.phase === "won" || run.phase === "lost") break;
      // In the shop the sim does not advance; without a pick in the log the
      // run can go no further. Break rather than spin until maxTicks.
      if (run.phase === "shop") break;
      // Nothing left to apply and the board is empty: the round can only end
      // once all balls are gone, so keep stepping until it settles.
      const before = run.sim.tick;
      run.step();
      if (run.sim.tick === before) break; // defensive: never loop without progress
      if (i >= log.length && run.ballsLeft > 0 && run.inFlight === 0) break;
    }
    return { score: run.totalScore, ticks: run.sim.tick, phase: run.phase, round: run.round };
  } finally {
    run.dispose();
  }
}
