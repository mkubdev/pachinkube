/**
 * Headless replay of a run from its seed and input log.
 *
 * Because the sim and the run are deterministic, replaying the same inputs at
 * the same ticks reproduces the same score. The leaderboard uses this to
 * verify submissions instead of trusting the client's number.
 */
import { Run, type RunInput } from "./run";

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

export async function replay(seed: string, log: RunInput[], maxTicks = MAX_REPLAY_TICKS): Promise<ReplayResult> {
  const run = await Run.create(seed);
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
      // Nothing left to apply and the board is empty: the round can only end
      // once all balls are gone, so keep stepping until it settles.
      run.step();
      if (i >= log.length && run.ballsLeft > 0 && run.inFlight === 0) break;
    }
    return { score: run.totalScore, ticks: run.sim.tick, phase: run.phase, round: run.round };
  } finally {
    run.dispose();
  }
}
