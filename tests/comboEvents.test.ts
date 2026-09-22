import { afterEach, describe, expect, it } from "vitest";
import { Run, type GameEvent } from "../src/game/run.js";
import { COMBO_EVENTS, COMBO_EVENT_KINDS } from "../src/game/comboEvents.js";

const runs: Run[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) r.dispose();
});

async function make(seed: string) {
  const run = await Run.create(seed);
  runs.push(run);
  return run;
}

describe("combo events", () => {
  it("every kind has metadata and a positive weight", () => {
    for (const k of COMBO_EVENT_KINDS) {
      expect(COMBO_EVENTS[k].kind).toBe(k);
      expect(COMBO_EVENTS[k].weight).toBeGreaterThan(0);
      expect(COMBO_EVENTS[k].name.length).toBeGreaterThan(0);
    }
  });

  it("laser lights a whole row and pays every ball in flight", async () => {
    const run = await make("ce-laser");
    run.drop(0);
    run.drop(1);
    const out: GameEvent[] = [];
    run.triggerComboEvent("laser", out);
    const ev = out.find((e) => e.type === "comboEvent");
    expect(ev && ev.type === "comboEvent" ? ev.kind : "").toBe("laser");
    const lit = out.filter((e) => e.type === "pegLit").length;
    expect(lit).toBeGreaterThanOrEqual(6);
    for (const b of run.balls.values()) expect(b.chips).toBe(lit * 6);
  });

  it("portal returns the next balls to the top with +2 mult", async () => {
    const run = await make("ce-portal");
    const out: GameEvent[] = [];
    run.triggerComboEvent("portal", out);
    expect(run.sim.portalsArmedCount).toBe(2);
    run.drop(0.2);
    const id = [...run.balls.keys()][0]!;
    let portals = 0;
    for (let t = 0; t < 4000 && portals === 0; t++) {
      for (const e of run.step()) if (e.type === "portal") portals++;
    }
    expect(portals).toBe(1);
    expect(run.balls.get(id)?.mult).toBe(3);
    expect(run.sim.ballPosition(id)!.y).toBeGreaterThan(run.sim.config.height * 0.5);
    expect(run.sim.portalsArmedCount).toBe(1);
  });

  it("timed effects end on schedule and restore physics", async () => {
    const run = await make("ce-timed");
    const out: GameEvent[] = [];
    run.triggerComboEvent("quake", out);
    run.triggerComboEvent("gravity_flip", out);
    run.triggerComboEvent("magnet_storm", out);
    expect(run.sim.pegMotion).not.toBeNull();
    run.drop(0);
    for (let i = 0; i < 20; i++) run.step();
    // Gravity is flipped: the fresh ball is rising.
    expect(run.sim.snapshot().balls[0]!.vy).toBeGreaterThan(0);
    const ends: string[] = [];
    for (let t = 0; t < 400; t++) for (const e of run.step()) if (e.type === "comboEventEnd") ends.push(e.kind);
    expect(ends.sort()).toEqual(["gravity_flip", "magnet_storm", "quake"]);
    expect(run.sim.pegMotion).toBeNull();
  });

  it("rain spawns three shards and fires every 20 combo, deterministically", async () => {
    const run = await make("ce-rain");
    const out: GameEvent[] = [];
    run.triggerComboEvent("rain", out);
    expect(run.inFlight).toBe(3);
    expect(run.sim.snapshot().balls.every((b) => b.tag === "shard")).toBe(true);

    const play = async (seed: string) => {
      const r = await make(seed);
      r.charms.push("firestorm", "static_field", "low_gravity");
      (r as unknown as { startRound(): void }).startRound();
      const kinds: string[] = [];
      for (let t = 0; t < 4000; t++) {
        if (r.phase === "shop") r.pick(0);
        if (t % 30 === 0 && r.ballsLeft > 0) r.drop(Math.sin(t / 37) * 2.2);
        for (const e of r.step()) if (e.type === "comboEvent") kinds.push(e.kind);
      }
      return kinds;
    };
    const a = await play("ce-det");
    const b = await play("ce-det");
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });
});

describe("chain feeders", () => {
  it("overdrive doubles combo gain while active", async () => {
    const run = await make("cf-overdrive");
    const out: GameEvent[] = [];
    run.triggerComboEvent("overdrive", out);
    const id = 6001;
    run.balls.set(id, { id, type: "steel", chips: 0, mult: 1, hits: 0, freshHits: 0, revives: 0, zaps: 0, shard: false } as never);
    const peg = run.sim.pegs[0]!;
    (run as unknown as { handle(ev: unknown, out: GameEvent[]): void }).handle({ type: "pegHit", ball: id, peg: peg.id, speed: 0 }, out);
    expect(run.combo).toBe(2);
  });
  it("time_lock keeps the chain alive past the window, with a grace restart", async () => {
    const run = await make("cf-lock");
    run.combo = 30;
    const out: GameEvent[] = [];
    run.triggerComboEvent("time_lock", out);
    for (let i = 0; i < 320; i++) run.step(); // window 54 ticks; lock 300, grace restarts lastHitTick at lock end
    expect(run.combo).toBe(30);
  });
  it("fresh_coat unlights every peg", async () => {
    const run = await make("cf-coat");
    run.lit.add(run.sim.pegs[0]!.id).add(run.sim.pegs[1]!.id);
    const out: GameEvent[] = [];
    run.triggerComboEvent("fresh_coat", out);
    expect(run.lit.size).toBe(0);
  });
});

describe("fever tiers", () => {
  it("cold events fire at tier 1 with base duration", async () => {
    const run = await make("tier-1");
    const out: GameEvent[] = [];
    run.triggerComboEvent("quake", out);
    const ev = out.find((e) => e.type === "comboEvent") as Extract<GameEvent, { type: "comboEvent" }>;
    expect(ev.tier).toBe(1);
    expect(ev.ticks).toBe(360);
  });
  it("hot events scale duration, capped", async () => {
    const run = await make("tier-hot");
    run.combo = 400; // fever ×50 → tier 7
    const out: GameEvent[] = [];
    run.triggerComboEvent("quake", out);
    const q = out.find((e) => e.type === "comboEvent") as Extract<GameEvent, { type: "comboEvent" }>;
    expect(q.ticks).toBe(1080); // 360 × 3 cap
    run.triggerComboEvent("overdrive", out);
    const o = out.filter((e) => e.type === "comboEvent").at(-1) as Extract<GameEvent, { type: "comboEvent" }>;
    expect(o.ticks).toBe(720); // 360 + 120·(tier−1), cap 720
    run.triggerComboEvent("time_lock", out);
    const t = out.filter((e) => e.type === "comboEvent").at(-1) as Extract<GameEvent, { type: "comboEvent" }>;
    expect(t.ticks).toBe(600); // 300 + 60·(tier−1), cap 600
  });
  it("hot rain drops more shards, capped at 9", async () => {
    const run = await make("tier-rain");
    run.combo = 400;
    const before = run.sim.ballCount;
    const out: GameEvent[] = [];
    run.triggerComboEvent("rain", out);
    expect(run.sim.ballCount - before).toBe(9);
  });
});
