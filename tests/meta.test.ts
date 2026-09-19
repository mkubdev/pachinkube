import { afterEach, describe, expect, it } from "vitest";
import { Run, type GameEvent } from "../src/game/run.js";
import {
  FULL_POOL,
  LocalMetaStore,
  META_KEY,
  UNLOCK_RULES,
  emptyMeta,
  isUnlocked,
  newTracker,
  recordDrop,
  recordEvents,
  recordOffers,
  recordRunEnd,
  recordRunStart,
  settleAnnouncements,
  unlockedPool,
} from "../src/game/meta.js";
import { replay, validatePool } from "../src/game/replay.js";

const runs: Run[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) r.dispose();
});

const fakeKv = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), map: m };
};

describe("meta progression", () => {
  it("a fresh profile has only ungated content and steel discovered", () => {
    const meta = emptyMeta();
    const pool = unlockedPool(meta);
    for (const r of UNLOCK_RULES) {
      const list = r.kind === "charm" ? pool.charms : pool.balls;
      expect(list).not.toContain(r.id);
    }
    expect([...pool.balls].sort()).toEqual(["heavy", "rubber", "spark"]);
    expect(meta.discovered.balls).toEqual(["steel"]);
    expect(pool.charms.length + UNLOCK_RULES.filter((r) => r.kind === "charm").length).toBe(FULL_POOL.charms.length);
  });

  it("stats unlock content and announce it exactly once", () => {
    const meta = emptyMeta();
    settleAnnouncements(meta);
    const run = { totalScore: 0, sim: { config: { buckets: 7 } } } as unknown as Run;
    const tracker = newTracker();
    const events: GameEvent[] = [{ type: "combo", count: 30, milestone: true }];
    const notices = recordEvents(meta, events, run, tracker, () => "2026-09-19T00:00:00Z");
    // 30 combo: cannon (30) and split_shot (25) unlock, plus the 25-combo feat.
    expect(notices.map((n) => `${n.kind}:${"id" in n ? n.id : ""}`).sort()).toEqual(
      ["feat:combo_25", "unlock:cannon", "unlock:split_shot"].sort(),
    );
    expect(isUnlocked(meta, "ball", "cannon")).toBe(true);
    expect(isUnlocked(meta, "ball", "bomb")).toBe(false);
    // Same event again: nothing new to announce.
    expect(recordEvents(meta, events, run, tracker, () => "x")).toEqual([]);
  });

  it("jackpot streak feat needs three centre landings in a row", () => {
    const meta = emptyMeta();
    const run = { totalScore: 0, sim: { config: { buckets: 7 } } } as unknown as Run;
    const tracker = newTracker();
    const centre = (b: number): GameEvent => ({ type: "ballScored", ball: 1, score: 10, bucket: b, chips: 1, mult: 1 });
    recordEvents(meta, [centre(3), centre(3), centre(0)], run, tracker);
    expect(meta.feats.jackpot_streak).toBeUndefined();
    const n = recordEvents(meta, [centre(3), centre(3), centre(3)], run, tracker);
    expect(n.some((x) => x.kind === "feat" && x.id === "jackpot_streak")).toBe(true);
    expect(meta.stats.jackpots).toBe(5);
  });

  it("shop offers and owned charms become discoveries; run end folds totals", async () => {
    const meta = emptyMeta();
    const run = await Run.create("meta-run");
    runs.push(run);
    recordRunStart(meta);
    recordDrop(meta);
    const offers = recordOffers(meta, [{ kind: "charm", id: "magnet_coil" }, { kind: "ball", id: "rubber", count: 2 }]);
    expect(offers).toHaveLength(2);
    expect(meta.discovered.charms).toContain("magnet_coil");
    expect(meta.discovered.balls).toContain("rubber");
    run.charms.push("neon_sign");
    (run as unknown as { totalScore: number }).totalScore = 1234;
    recordRunEnd(meta, run);
    expect(meta.stats).toMatchObject({ runs: 1, ballsDropped: 1, totalScore: 1234, bestScore: 1234 });
    expect(meta.discovered.charms).toContain("neon_sign");
  });

  it("persists through the store and survives garbage", () => {
    const kv = fakeKv();
    const store = new LocalMetaStore(kv);
    const meta = store.load();
    meta.stats.bestCombo = 77;
    store.save(meta);
    expect(store.load().stats.bestCombo).toBe(77);
    kv.setItem(META_KEY, "{not json");
    expect(store.load().stats.bestCombo).toBe(0);
    kv.setItem(META_KEY, JSON.stringify({ version: 999 }));
    expect(store.load().version).toBe(1);
    expect(new LocalMetaStore(null).load().stats.runs).toBe(0);
  });

  it("the shop never offers locked content, and the pool is part of the replay", async () => {
    const pool = unlockedPool(emptyMeta());
    const run = await Run.create("gated", { pool });
    runs.push(run);
    const roll = (run as unknown as { rollOffers(): Array<{ kind: string; id: string }> }).rollOffers.bind(run);
    for (let i = 0; i < 60; i++) {
      for (const o of roll()) {
        const list = o.kind === "charm" ? pool.charms : pool.balls;
        expect(list).toContain(o.id);
      }
    }
    // Play a short run with the gated pool and verify it replays with it.
    const live = await Run.create("gated-replay", { pool });
    runs.push(live);
    for (let t = 0; t < 20000; t++) {
      if (live.phase === "shop") live.pick(0);
      if (live.phase !== "drop") break;
      if (t % 50 === 0 && live.ballsLeft > 0) live.drop([-1, 0.5, 1.5, -2][t % 4]!);
      live.step();
    }
    const withPool = await replay("gated-replay", [...live.log], pool);
    expect(withPool.score).toBe(live.totalScore);
    expect(validatePool(pool)).toBe(true);
    expect(validatePool({ charms: ["nope"], balls: [] })).toBe(false);
    expect(validatePool({ charms: ["magnet_coil", "magnet_coil"], balls: [] })).toBe(false);
  });
});
