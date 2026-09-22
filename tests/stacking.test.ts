import { afterEach, describe, expect, it } from "vitest";
import { MAX_STACK, NON_STACKABLE, Run } from "../src/game/run.js";
import { CHARM_IDS, CHARMS } from "../src/game/charms.js";
import { emptyMeta, hasUsed, mergeMeta, recordPick } from "../src/game/meta.js";

const runs: Run[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) r.dispose();
});
type Priv = { startRound(): void; rollOffers(): Array<{ kind: string; id: string }>; endRound(out: unknown[]): void };

async function make(seed: string, ...charms: string[]) {
  const run = await Run.create(seed);
  runs.push(run);
  if (charms.length) {
    run.charms.push(...(charms as never[]));
    (run as unknown as Priv).startRound();
  }
  return run;
}

describe("charm stacking", () => {
  it("every charm except flags can be offered again while held, up to MAX_STACK", async () => {
    const run = await make("stack");
    for (const id of CHARM_IDS) {
      run.charms.length = 0;
      run.charms.push(id);
      expect(run.canStack(id), id).toBe(!NON_STACKABLE.has(id));
      run.charms.push(id, id, id, id);
      expect(run.charmLevel(id)).toBe(MAX_STACK);
      expect(run.canStack(id)).toBe(false);
    }
  });

  it("a re-picked permanent charm adds a copy and its numbers grow", async () => {
    const run = await make("stack-perm", "long_fuse");
    const w1 = run.comboWindow();
    // Force an offer for the held charm and take it.
    run.ballsLeft = 0;
    run.roundScore = run.target;
    run.step(); // -> shop
    expect(run.phase).toBe("shop");
    run.offers = [{ kind: "charm", id: "long_fuse" }];
    expect(run.pick(0)).toBe(true);
    expect(run.charmLevel("long_fuse")).toBe(2);
    expect(run.comboWindow()).toBe(w1 + (CHARMS.long_fuse.comboWindowBonus ?? 0));
  });

  it("a re-picked temporary charm extends its rounds instead of doubling", async () => {
    const run = await make("stack-temp");
    run.ballsLeft = 0;
    run.roundScore = run.target;
    run.step();
    run.offers = [{ kind: "charm", id: "firestorm" }];
    run.pick(0); // round 2 begins holding Firestorm (3 rounds)
    expect(run.charmRoundsLeft(0)).toBe(3);
    run.ballsLeft = 0;
    run.roundScore = run.target;
    run.step();
    run.offers = [{ kind: "charm", id: "firestorm" }];
    run.pick(0); // round 3: one round used, +3
    expect(run.charmLevel("firestorm")).toBe(1);
    expect(run.charmRoundsLeft(0)).toBe(5);
  });

  it("the shop actually re-offers held charms and never the flags", async () => {
    const run = await make("stack-shop", "magnet_coil", "tinder");
    const roll = (run as unknown as Priv).rollOffers.bind(run);
    const ids = new Set<string>();
    for (let i = 0; i < 400; i++) for (const o of roll()) if (o.kind === "charm") ids.add(o.id);
    expect(ids.has("magnet_coil")).toBe(true);
    expect(ids.has("tinder")).toBe(false);
  });

  it("min-based fields tighten with copies: Static Field zaps every 5th hit when doubled", async () => {
    const run = await make("stack-zap", "static_field", "static_field");
    const b = { id: 77, type: "steel" as const, chips: 0, mult: 1, hits: 0, freshHits: 0, revives: 0, zaps: 0, shard: false };
    run.balls.set(b.id, b);
    let zaps = 0;
    for (let h = 1; h <= 12; h++) {
      const out: Array<{ type: string; kind?: string }> = [];
      (run as unknown as { handle(ev: unknown, out: unknown[]): void }).handle({ type: "pegHit", ball: b.id, peg: 20 + h, speed: 1 }, out);
      if (out.some((e) => e.type === "element" && e.kind === "zap")) zaps++;
    }
    expect(zaps).toBe(2); // every 5th hit (6 − 1): 5 and 10; a single copy gives 6 and 12
  });
});

describe("used content", () => {
  it("picks mark content used; merge unions; old profiles without the field still work", () => {
    const meta = emptyMeta();
    expect(hasUsed(meta, "charm", "extra_ball")).toBe(false);
    recordPick(meta, { kind: "charm", id: "extra_ball" });
    recordPick(meta, { kind: "ball", id: "rubber", count: 2 });
    expect(hasUsed(meta, "charm", "extra_ball")).toBe(true);
    expect(hasUsed(meta, "ball", "rubber")).toBe(true);
    const old = emptyMeta();
    delete (old as { used?: unknown }).used;
    expect(hasUsed(old, "charm", "extra_ball")).toBe(false);
    const merged = mergeMeta(old, meta);
    expect(merged.used?.charms).toEqual(["extra_ball"]);
  });
});
