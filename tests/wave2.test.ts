import { afterEach, describe, expect, it } from "vitest";
import { Run, type GameEvent } from "../src/game/run.js";
import { EDGE_GAP, Sim } from "../src/sim/world.js";
import { BALL_IDS, BALL_TYPES } from "../src/game/balls.js";
import { CHARMS, type BallScoreState } from "../src/game/charms.js";
import { FEATS, UNLOCK_RULES, emptyMeta, newTracker, recordEvents, unlockedPool } from "../src/game/meta.js";
import { charmIcon } from "../src/game/icons.js";

const runs: Run[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) r.dispose();
});

type Priv = {
  startRound(): void;
  handle(ev: unknown, out: GameEvent[]): void;
  resolveElement(ball: BallScoreState, pegId: number, peg: { x: number; y: number }, fresh: boolean, ctx: unknown, out: GameEvent[]): void;
  ctxFor(ball: BallScoreState, out: GameEvent[]): unknown;
};

async function make(seed: string, ...charms: string[]) {
  const run = await Run.create(seed);
  runs.push(run);
  if (charms.length) {
    run.charms.push(...(charms as never[]));
    (run as unknown as Priv).startRound();
  }
  return run;
}
function fakeBall(run: Run, type: string, hits = 0): BallScoreState {
  const b: BallScoreState = { id: 5000 + Math.floor(Math.random() * 1e6), type: type as never, chips: 10, mult: 1, hits, freshHits: hits, revives: 0, zaps: 0 };
  run.balls.set(b.id, b);
  return b;
}
function react(run: Run, el: "fire" | "ice" | "storm" | null, pegId: number, fresh = true) {
  const ball = fakeBall(run, "steel", 1);
  if (el) run.ballElements.set(ball.id, el);
  const out: GameEvent[] = [];
  const priv = run as unknown as Priv;
  priv.resolveElement(ball, pegId, run.sim.pegs[pegId]!, fresh, priv.ctxFor(ball, out), out);
  return { ball, out };
}
/** Drop `type` at x and step until it hits `hits` pegs or lands; returns the events. */
function play(run: Run, type: string, x: number, maxTicks = 3000): GameEvent[] {
  run.bag[0] = type as never;
  run.drop(x);
  const out: GameEvent[] = [];
  for (let t = 0; t < maxTicks && run.inFlight > 0; t++) out.push(...run.step());
  return out;
}

describe("board geometry", () => {
  it("keeps every peg EDGE_GAP clear of the walls, even at full drift", async () => {
    const sim = await Sim.create({ seed: "gap" });
    const half = sim.config.width / 2;
    const biggest = Math.max(...BALL_IDS.map((id) => BALL_TYPES[id].physics.radius ?? sim.config.ballRadius));
    expect(EDGE_GAP).toBeGreaterThan(biggest * 2 + 0.05);
    for (const p of sim.pegs) expect(half - Math.abs(p.x) - p.radius).toBeGreaterThanOrEqual(EDGE_GAP - 0.05);
    sim.setPegMotion({ amplitude: 0.6, omega: 0.05 });
    for (let t = 0; t < 200; t++) sim.step();
    for (const p of sim.pegs) {
      const q = sim.pegPosition(p.id);
      expect(half - Math.abs(q.x) - p.radius).toBeGreaterThanOrEqual(EDGE_GAP - 1e-6);
    }
    sim.dispose();
  });

  it("a Heavy ball dropped along either wall reaches a pocket quickly", async () => {
    for (const x of [-2.75, 2.75, -2.55, 2.55]) {
      const sim = await Sim.create({ seed: `wedge-${x}` });
      const heavy = BALL_TYPES.heavy.physics;
      const id = sim.spawnBall({ x, ...heavy });
      let lostAt = -1;
      for (let t = 0; t < 120 * 10 && lostAt < 0; t++) for (const e of sim.step()) if (e.type === "ballLost" && e.ball === id) lostAt = t;
      expect(lostAt, `x=${x}`).toBeGreaterThan(0);
      expect(lostAt).toBeLessThan(120 * 6);
      sim.dispose();
    }
  });
});

describe("combo lifecycle", () => {
  it("closes an open combo when the round ends instead of leaving it hanging", async () => {
    const run = await make("combo-end");
    run.combo = 7;
    run.ballsLeft = 0;
    run.roundScore = run.target; // pass the round so it heads for the shop
    const out = run.step();
    expect(out.find((e) => e.type === "comboEnd")).toEqual({ type: "comboEnd", count: 7 });
    expect(run.combo).toBe(0);
    expect(run.phase).toBe("shop");
  });
});

describe("second-wave balls", () => {
  it("Rainbow rotates fire → ice → storm on each hit", async () => {
    const run = await make("rainbow");
    const b = fakeBall(run, "rainbow");
    run.ballElements.set(b.id, "fire");
    const priv = run as unknown as Priv;
    const seen: string[] = [];
    for (const peg of [3, 8, 13, 18]) {
      priv.handle({ type: "pegHit", ball: b.id, peg, speed: 2 }, []);
      seen.push(run.ballElements.get(b.id)!);
    }
    expect(seen).toEqual(["ice", "storm", "fire", "ice"]);
  });

  it("Ember, Frost and Volt are imbued regardless of charms", async () => {
    const run = await make("inherent");
    for (const [type, el] of [["ember", "fire"], ["frost", "ice"], ["volt", "storm"]] as const) {
      run.bag[0] = type;
      run.drop(0);
      const id = run.sim.snapshot().balls.at(-1)!.id;
      expect(run.ballElements.get(id)).toBe(el);
    }
  });

  it("Boomerang comes back once with its chips and mult, then scores", async () => {
    const run = await make("boomerang");
    const b = fakeBall(run, "boomerang");
    b.chips = 123;
    b.mult = 4;
    const priv = run as unknown as Priv;
    const out: GameEvent[] = [];
    priv.handle({ type: "ballLost", ball: b.id, bucket: 3 }, out);
    expect(out.some((e) => e.type === "ballScored")).toBe(false);
    expect(out.some((e) => e.type === "fx" && e.kind === "boomerang")).toBe(true);
    expect(run.inFlight).toBe(1);
    const again = [...run.balls.values()][0]!;
    expect(again).toMatchObject({ type: "boomerang", chips: 123, mult: 4, revives: 1 });
    const out2: GameEvent[] = [];
    priv.handle({ type: "ballLost", ball: again.id, bucket: 3 }, out2);
    expect(out2.some((e) => e.type === "ballScored")).toBe(true);
  });

  it("Quantum blinks back into the upper field on its 6th hit", async () => {
    const run = await make("quantum");
    const out = play(run, "quantum", 0.3);
    const blink = out.find((e) => e.type === "blink");
    expect(blink).toBeDefined();
    if (blink?.type === "blink") expect(blink.to.y).toBeGreaterThan(run.sim.config.height * 0.8);
  });

  it("Abyss drags other balls toward it and lands with +1 mult per ball in flight", async () => {
    const withWell = await make("abyss-a");
    withWell.bag.splice(0, 2, "abyss", "steel");
    withWell.drop(0);
    withWell.drop(2.2);
    const control = await make("abyss-a");
    control.bag.splice(0, 2, "steel", "steel");
    control.drop(0);
    control.drop(2.2);
    for (let i = 0; i < 40; i++) {
      withWell.step();
      control.step();
    }
    const pulled = withWell.sim.snapshot().balls.find((b) => b.tag === "steel")!;
    const free = control.sim.snapshot().balls[1]!;
    expect(pulled.x).toBeLessThan(free.x - 0.05);

    const run = await make("abyss-b");
    run.bag.splice(0, 3, "steel", "steel", "abyss");
    run.drop(-1);
    run.drop(1);
    run.drop(0);
    const abyss = [...run.balls.values()].find((b) => b.type === "abyss")!;
    const out: GameEvent[] = [];
    (run as unknown as Priv).handle({ type: "ballLost", ball: abyss.id, bucket: 3 }, out);
    const scored = out.find((e) => e.type === "ballScored");
    // three bodies still in the world at this point (the sim removes the abyss only in its own step)
    expect(scored && scored.type === "ballScored" ? scored.mult : 0).toBe(1 + 3);
    expect(out.some((e) => e.type === "fx" && e.kind === "collapse")).toBe(true);
  });

  it("two Abyss wells above a light ball can never hold it up", async () => {
    const sim = await Sim.create({ seed: "levitate" });
    const H = sim.config.height;
    const feather = BALL_TYPES.feather.physics;
    const light = sim.spawnBall({ x: 0, y: H - 1.5, ...feather });
    const a = sim.spawnBall({ x: -0.6, y: H - 0.6, ...BALL_TYPES.abyss.physics });
    const b = sim.spawnBall({ x: 0.6, y: H - 0.6, ...BALL_TYPES.abyss.physics });
    const y0 = sim.ballPosition(light)!.y;
    for (let t = 0; t < 60; t++) sim.step();
    expect(sim.ballPosition(light)!.y).toBeLessThan(y0 - 0.3);
    // and wells do not orbit each other: both abysses fall too
    expect(sim.ballPosition(a)!.y).toBeLessThan(H - 0.9);
    expect(sim.ballPosition(b)!.y).toBeLessThan(H - 0.9);
    sim.dispose();
  });

  it("Pearl gains mult every 4th hit; Cluster drops three", async () => {
    const run = await make("pearl");
    const b = fakeBall(run, "pearl", 3);
    const out: GameEvent[] = [];
    (run as unknown as Priv).handle({ type: "pegHit", ball: b.id, peg: 10, speed: 1 }, out);
    expect(b.mult).toBe(1.5);
    run.bag[0] = "cluster";
    const before = run.inFlight;
    run.drop(0);
    expect(run.inFlight - before).toBe(3);
  });
});

describe("second-wave elements", () => {
  it("ice on ice thickens up to the cap, then shatters for the thick payout", async () => {
    const run = await make("thicken");
    react(run, "ice", 12);
    expect(run.pegElements.get(12)).toEqual({ el: "ice", stacks: 1 });
    const t = react(run, "ice", 12);
    expect(run.pegElements.get(12)).toEqual({ el: "ice", stacks: 2 });
    expect(t.out.some((e) => e.type === "element" && e.kind === "thicken")).toBe(true);
    react(run, "ice", 12);
    react(run, "ice", 12);
    expect(run.pegElements.get(12)?.stacks).toBe(4);
    const s = react(run, "ice", 12);
    expect(run.pegElements.has(12)).toBe(false);
    expect(s.ball.chips).toBeGreaterThanOrEqual(10 + 48);
  });

  it("fire on fire flares: bigger chips and two pegs catch", async () => {
    const run = await make("flare");
    react(run, "fire", 12);
    const before = [...run.pegElements.values()].filter((s) => s.el === "fire").length;
    const f = react(run, "fire", 12, false);
    const flare = f.out.find((e) => e.type === "element" && e.kind === "flare");
    expect(flare).toBeDefined();
    expect([...run.pegElements.values()].filter((s) => s.el === "fire").length).toBe(before + 2);
    expect(f.ball.chips).toBeGreaterThan(10);
  });

  it("Permafrost thickens every freeze; Thermal Shock refreezes after steam", async () => {
    const run = await make("perma", "permafrost", "thermal_shock");
    react(run, "ice", 20);
    expect(run.pegElements.get(20)).toEqual({ el: "ice", stacks: 2 });
    const s = react(run, "fire", 20);
    expect(s.out.some((e) => e.type === "element" && e.kind === "steam")).toBe(true);
    expect(run.pegElements.has(20)).toBe(false);
    expect([...run.pegElements.values()].filter((st) => st.el === "ice").length).toBe(3);
  });

  it("Lightning Rod keeps the charge; Ball Lightning pays mult every 3rd zap", async () => {
    const run = await make("rod", "lightning_rod", "ball_lightning");
    react(run, "storm", 30);
    const ball = fakeBall(run, "steel", 1);
    const priv = run as unknown as Priv;
    for (let i = 0; i < 3; i++) {
      const out: GameEvent[] = [];
      priv.resolveElement(ball, 30, run.sim.pegs[30]!, false, priv.ctxFor(ball, out), out);
      expect(out.some((e) => e.type === "element" && e.kind === "zap")).toBe(true);
    }
    expect(run.pegElements.get(30)?.el).toBe("storm");
    expect(ball.zaps).toBe(3);
    expect(ball.mult).toBe(2);
  });

  it("Flashpoint spreads ignitions; Aurora hands out random elements", async () => {
    const run = await make("flash", "flashpoint");
    react(run, "fire", 25);
    expect([...run.pegElements.values()].filter((s) => s.el === "fire").length).toBe(3);
    const aurora = await make("aurora", "aurora");
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(aurora.activeElement()!);
    expect([...seen].sort()).toEqual(["fire", "ice", "storm"]);
  });
});

describe("second-wave progression", () => {
  it("every ball but Steel sits on a strictly increasing peg-hit ladder ending past 100K", () => {
    const ladder = UNLOCK_RULES.filter((r) => r.kind === "ball");
    expect(ladder.map((r) => r.id).sort()).toEqual(BALL_IDS.filter((b) => b !== "steel").sort());
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]!.value).toBeGreaterThan(ladder[i - 1]!.value);
    expect(ladder.at(-1)!.value).toBeGreaterThanOrEqual(100_000);
  });

  it("a fresh profile opens with a small charm pool and the elemental basics", () => {
    const pool = unlockedPool(emptyMeta());
    expect(pool.charms.length).toBeLessThanOrEqual(15);
    for (const id of ["ember_core", "frost_bite", "static_field", "magnet_coil", "extra_ball"]) expect(pool.charms).toContain(id);
    for (const id of ["aurora", "abyss", "lightning_rod", "long_fuse"]) expect([...pool.charms, ...pool.balls]).not.toContain(id);
    for (const id of Object.keys(CHARMS)) expect(charmIcon(id as never).startsWith("<svg")).toBe(true);
  });

  it("round-shaped feats: hat trick, grand tour, clutch and overkill", () => {
    const meta = emptyMeta();
    const run = { totalScore: 0, charms: [], inFlight: 0, ownedBalls: [], sim: { config: { buckets: 7 } } } as unknown as Run;
    const tracker = newTracker();
    const ev = (kind: string): GameEvent => ({ type: "comboEvent", kind: kind as never, x: 0, y: 5, ticks: 0, label: kind });
    const land = (bucket: number, score: number): GameEvent => ({ type: "ballScored", ball: 1, score, bucket, chips: 1, mult: 1 });
    let n = recordEvents(meta, [ev("laser"), ev("rain"), ev("quake")], run, tracker, () => "t");
    expect(n.some((x) => x.kind === "feat" && x.id === "hat_trick")).toBe(true);
    n = recordEvents(meta, [0, 1, 2, 3, 4, 5, 6].map((b) => land(b, 100)), run, tracker, () => "t");
    expect(n.some((x) => x.kind === "feat" && x.id === "grand_tour")).toBe(true);
    // Last ball scored 900 of a 1000-target round that ended on 1050: clutch.
    n = recordEvents(meta, [land(3, 900), { type: "roundEnd", round: 1, passed: true, roundScore: 1050, target: 1000 }], run, tracker, () => "t");
    expect(n.some((x) => x.kind === "feat" && x.id === "clutch")).toBe(true);
    expect(tracker.pocketsThisRound).toEqual([]);
    n = recordEvents(meta, [{ type: "roundEnd", round: 2, passed: true, roundScore: 20_000, target: 1000 }], run, tracker, () => "t");
    expect(n.some((x) => x.kind === "feat" && x.id === "overkill")).toBe(true);
    for (const id of ["trinity", "inferno", "glacier", "power_grid", "first_blink", "first_collapse", "hoarder", "steams_10", "total_1000000"]) expect(FEATS[id]).toBeDefined();
  });
});
