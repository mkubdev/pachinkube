import { afterEach, describe, expect, it } from "vitest";
import { Run, type GameEvent } from "../src/game/run.js";
import { FEATS, THRESHOLD_FEATS, emptyMeta, newTracker, recordEvents } from "../src/game/meta.js";
import { featIcon } from "../src/game/icons.js";
import type { BallScoreState } from "../src/game/charms.js";

const runs: Run[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) r.dispose();
});
type Priv = { startRound(): void; handle(ev: unknown, out: GameEvent[]): void };

describe("discoveries", () => {
  it("threshold feats are unique, ordered and all have icons", () => {
    const ids = THRESHOLD_FEATS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(40);
    for (const f of THRESHOLD_FEATS) {
      expect(FEATS[f.id]).toBeDefined();
      expect(featIcon(f.id, true).startsWith("<svg")).toBe(true);
    }
    expect(Object.keys(FEATS).length).toBeGreaterThanOrEqual(60);
  });

  it("a 320 combo earns every combo tier up to 300 in one go", () => {
    const meta = emptyMeta();
    const run = { totalScore: 0, charms: [], inFlight: 0, sim: { config: { buckets: 7 } } } as unknown as Run;
    const n = recordEvents(meta, [{ type: "combo", count: 320, milestone: false }], run, newTracker(), () => "t");
    const feats = n.filter((x) => x.kind === "feat").map((x) => x.id).sort();
    expect(feats).toEqual(["combo_150", "combo_200", "combo_300", "combo_40", "combo_80"]);
    expect(meta.feats.combo_400).toBeUndefined();
  });

  it("combo events and portals count and unlock their feats", () => {
    const meta = emptyMeta();
    const run = { totalScore: 0, charms: [], inFlight: 0, sim: { config: { buckets: 7 } } } as unknown as Run;
    const events: GameEvent[] = [
      { type: "comboEvent", kind: "laser", x: 0, y: 5, ticks: 0, label: "LASER", tier: 1 },
      { type: "portal", ball: 1, from: { x: 0, y: 0 }, to: { x: 0, y: 10 } },
    ];
    const n = recordEvents(meta, events, run, newTracker(), () => "t");
    expect(n.some((x) => x.kind === "feat" && x.id === "first_laser")).toBe(true);
    expect(meta.stats.comboEvents).toBe(1);
    expect(meta.stats.portals).toBe(1);
  });

  it("run score threshold fires from totalScore, not only at run end", () => {
    const meta = emptyMeta();
    const run = { totalScore: 260_000, charms: [], inFlight: 0, sim: { config: { buckets: 7 } } } as unknown as Run;
    const n = recordEvents(meta, [{ type: "pegLit", peg: 0 }], run, newTracker(), () => "t");
    expect(n.some((x) => x.kind === "feat" && x.id === "run_250000")).toBe(true);
  });
});

describe("new unlockables", () => {
  async function make(seed: string, ...charms: string[]) {
    const run = await Run.create(seed);
    runs.push(run);
    run.charms.push(...(charms as never[]));
    (run as unknown as Priv).startRound();
    return run;
  }
  function ball(run: Run, type: string, hits = 0): BallScoreState {
    const b: BallScoreState = { id: 700 + Math.floor(Math.random() * 1e6), type: type as never, chips: 10, mult: 1, hits, freshHits: hits, revives: 0, zaps: 0, shard: false };
    run.balls.set(b.id, b);
    return b;
  }

  it("mirror pays its own pocket plus the mirrored one", async () => {
    const run = await make("mirror");
    const b = ball(run, "mirror");
    const out: GameEvent[] = [];
    (run as unknown as Priv).handle({ type: "ballLost", ball: b.id, bucket: 0 }, out);
    const scored = out.find((e) => e.type === "ballScored");
    // pocket 0 = ×1, mirrored pocket 6 = ×1 → chips 10 × mult 1 × 2
    expect(scored && scored.type === "ballScored" ? scored.score : 0).toBe(20);
  });

  it("glass shatters into three shards on its 6th hit and doubles chips", async () => {
    const run = await make("glass");
    const b = ball(run, "glass", 5);
    const before = run.inFlight;
    const out: GameEvent[] = [];
    (run as unknown as Priv).handle({ type: "pegHit", ball: b.id, peg: 10, speed: 3 }, out);
    expect(run.inFlight).toBe(before + 3);
    expect(b.hits).toBe(6);
    expect(out.some((e) => e.type === "popup" && e.text === "SHATTER ×2")).toBe(true);
  });

  it("comet ignites every third peg it touches", async () => {
    const run = await make("comet");
    const b = ball(run, "comet", 2);
    const out: GameEvent[] = [];
    (run as unknown as Priv).handle({ type: "pegHit", ball: b.id, peg: 12, speed: 3 }, out);
    expect(run.pegElements.get(12)?.el).toBe("fire");
  });

  it("echo chamber shortens the event cadence; second wind grants a ball once", async () => {
    const run = await make("echo", "echo_chamber", "second_wind");
    // Force a combo end at 60+ by faking state.
    const priv = run as unknown as { combo: number; lastHitTick: number };
    priv.combo = 65;
    priv.lastHitTick = -1000;
    const left = run.ballsLeft;
    const events = run.step();
    expect(run.ballsLeft).toBe(left + 1);
    expect(events.some((e) => e.type === "popup" && e.text.startsWith("SECOND WIND"))).toBe(true);
    priv.combo = 70;
    priv.lastHitTick = -1000;
    run.step();
    expect(run.ballsLeft).toBe(left + 1); // once per round
  });

  it("second wind fires on the round's last ball and keeps the round alive", async () => {
    const run = await make("sw-finale", "second_wind");
    const priv = run as unknown as { combo: number; lastHitTick: number };
    // The last ball just pocketed: no balls left, none in flight, and the big
    // combo it built is still inside its window when the round would end.
    run.ballsLeft = 0;
    priv.combo = 65;
    priv.lastHitTick = run.sim.tick;
    const events = run.step();
    expect(events.some((e) => e.type === "popup" && e.text.startsWith("SECOND WIND"))).toBe(true);
    expect(run.ballsLeft).toBe(1);
    expect(run.phase).toBe("drop"); // the granted ball is immediately usable
  });
});
