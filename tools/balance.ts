/**
 * Headless balance probe: play many seeded runs with a dumb policy and print
 * what a mediocre player scores per round. Targets in scoring.ts are tuned so
 * early rounds are forgiving and late rounds demand real synergies.
 *
 *   BALANCE=1 npx vitest run tests/balance.probe.test.ts   (seeds via BALANCE_SEEDS)
 */
import { Run } from "../src/game/run";
import { Rng } from "../src/sim/rng";
import { roundTarget } from "../src/game/scoring";
import { ROUNDS } from "../src/game/run";

async function playOne(seed: string, maxTicks: number) {
  const run = await Run.create(seed);
  const policy = new Rng(7 + seed.length);
  const perRound: number[] = [];
  const reached = { round: 1, phase: run.phase };
  for (let t = 0; t < maxTicks; t++) {
    if (run.phase === "shop") {
      // Prefer charms over balls; otherwise first offer.
      const i = run.offers.findIndex((o) => o.kind === "charm");
      run.pick(i >= 0 ? i : 0);
    }
    if (run.phase === "won" || run.phase === "lost") break;
    if (run.ballsLeft > 0 && run.inFlight < 2 && t % 20 === 0) {
      // Aim near the centre with noise: what a casual player does.
      run.drop(policy.range(-1.6, 1.6));
    }
    for (const e of run.step()) {
      if (e.type === "roundEnd") perRound[e.round - 1] = e.roundScore;
    }
    reached.round = run.round;
    reached.phase = run.phase;
  }
  run.dispose();
  return { perRound, final: run.phase, round: run.round, total: run.totalScore, charms: run.charms };
}

export async function runBalance(seeds = 60, ticksPerRound = 6000): Promise<string[]> {
const maxTicks = ticksPerRound * ROUNDS;
const lines: string[] = [];
const log = (s: string) => lines.push(s);
const results = [];
for (let i = 0; i < seeds; i++) results.push(await playOne(`bal-${i}`, maxTicks));

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
};

log(`seeds=${seeds}  won=${results.filter((r) => r.final === "won").length}  ` +
  `lost=${results.filter((r) => r.final === "lost").length}  unfinished=${results.filter((r) => r.final === "drop").length}`);
log("round  target     p25       p50       p75     reached  passRate");
for (let r = 1; r <= ROUNDS; r++) {
  const scores = results.map((x) => x.perRound[r - 1]).filter((v): v is number => v !== undefined);
  if (!scores.length) break;
  const pass = scores.filter((s) => s >= roundTarget(r)).length / scores.length;
  log(
    `${String(r).padStart(5)}  ${String(roundTarget(r)).padStart(6)}  ${String(q(scores, 0.25)).padStart(8)}  ` +
    `${String(q(scores, 0.5)).padStart(8)}  ${String(q(scores, 0.75)).padStart(8)}  ${String(scores.length).padStart(7)}  ${(pass * 100).toFixed(0).padStart(6)}%`,
  );
}
const charmCounts = new Map<string, number>();
for (const r of results) for (const c of r.charms) charmCounts.set(c, (charmCounts.get(c) ?? 0) + 1);
log("charm pick frequency: " + JSON.stringify(Object.fromEntries([...charmCounts].sort((a, b) => b[1] - a[1]))));
return lines;
}
