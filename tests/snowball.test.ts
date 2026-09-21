import { afterEach, describe, expect, it } from "vitest";
import { Run } from "../src/game/run.js";
import { CHARMS, RARITY_WEIGHT } from "../src/game/charms.js";

const runs: Run[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) r.dispose();
});
type Priv = { startRound(): void };

async function make(seed: string, ...charms: string[]) {
  const run = await Run.create(seed);
  runs.push(run);
  if (charms.length) {
    run.charms.push(...(charms as never[]));
    (run as unknown as Priv).startRound();
  }
  return run;
}

/** Clear the current round and buy `id` in the shop, starting the next round. */
function clearAndPick(run: Run, id: string): void {
  run.ballsLeft = 0;
  run.roundScore = run.target;
  run.step();
  expect(run.phase).toBe("shop");
  run.offers = [{ kind: "charm", id: id as never }];
  expect(run.pick(0)).toBe(true);
}

describe("snowball", () => {
  it("is legendary, and legendary is the rarest shop tier", () => {
    expect(CHARMS.snowball.rarity).toBe("legendary");
    expect(RARITY_WEIGHT.legendary).toBeGreaterThan(0);
    expect(RARITY_WEIGHT.legendary).toBeLessThan(RARITY_WEIGHT.rare);
  });

  it("grants +1 ball per round held, growing every round", async () => {
    const run = await make("snowball", "snowball");
    expect(run.ballsLeft).toBe(7); // 6 base + 1 (held 1 round)
    clearAndPick(run, "long_fuse"); // round 2
    expect(run.ballsLeft).toBe(8); // 6 + 2
    clearAndPick(run, "long_fuse"); // round 3
    expect(run.ballsLeft).toBe(9); // 6 + 3
    clearAndPick(run, "long_fuse"); // round 4
    expect(run.ballsLeft).toBe(11); // 6 + 1 (round progression) + 4
  });

  it("bought in the shop, it starts at +1 the round after the purchase", async () => {
    const run = await make("snowball-shop");
    expect(run.ballsLeft).toBe(6);
    clearAndPick(run, "snowball"); // acquired after round 1; round 2 begins
    expect(run.ballsLeft).toBe(7); // 6 + 1 (held 1 round)
    clearAndPick(run, "long_fuse"); // round 3
    expect(run.ballsLeft).toBe(8); // 6 + 2
  });
});

describe("extra ball", () => {
  it("stays a flat +1 per copy, every round", async () => {
    const run = await make("flat", "extra_ball");
    expect(run.ballsLeft).toBe(7);
    clearAndPick(run, "long_fuse"); // round 2
    expect(run.ballsLeft).toBe(7); // still 6 + 1
  });

  it("its description says the bonus is flat for the run", () => {
    expect(CHARMS.extra_ball.desc).toBe("+1 ball for this run.");
  });
});
