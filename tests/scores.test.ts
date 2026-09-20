import { describe, expect, it } from "vitest";
import { DELETE, GET, POST, submitScore, usingRedis } from "../api/scores.js";
import { RULES_VERSION } from "../src/game/version.js";
import { Run } from "../src/game/run.js";

const post = (body: Record<string, unknown>) =>
  POST(new Request("http://t/api/scores", { method: "POST", body: JSON.stringify({ anon: "browser-aaaaaaaa", ...body }), headers: { "content-type": "application/json" } }));

/** Play one round headlessly so a submission carries a log the server can replay. */
async function played(seed: string) {
  const run = await Run.create(seed);
  for (let t = 0; t < 120 * 40 && run.phase === "drop"; t++) {
    if (t % 30 === 0 && run.ballsLeft > 0) run.drop(Math.sin(t / 11) * 2);
    run.step();
  }
  const out = { score: run.totalScore, seed, ticks: run.sim.tick, rules: RULES_VERSION, log: run.log, pool: run.pool };
  run.dispose();
  return out;
}

describe("scores api (memory fallback)", () => {
  it("runs without Upstash configured", () => {
    expect(usingRedis).toBe(false);
  });

  it("rejects bad submissions", async () => {
    expect((await post({ name: "", score: 1, seed: "s", ticks: 1 })).status).toBe(400);
    expect((await post({ name: "ok", score: -1, seed: "s", ticks: 1 })).status).toBe(400);
    expect((await post({ name: "ok", score: 1, seed: "", ticks: 1 })).status).toBe(400);
    expect((await post({ name: "ok", score: 1, seed: "s", ticks: 1.5 })).status).toBe(400);
    expect((await post({ name: "<script>", score: 1, seed: "s", ticks: 1 })).status).toBe(400);
  });

  it("a typed name belongs to the first browser that posted it; Discord identities keep their own", async () => {
    const a = await played("own-a");
    const b = await played("own-b");
    expect((await post({ name: "Kubik", anon: "browser-one00001", ...a })).status).toBe(201);
    // Another browser, same name: refused, whatever the score.
    const other = await post({ name: "kubik", anon: "browser-two00002", ...b });
    expect(other.status).toBe(409);
    expect(((await other.json()) as { reason: string }).reason).toBe("name_taken");
    // The owner can keep posting under it.
    expect((await post({ name: "Kubik", anon: "browser-one00001", ...b })).status).toBe(201);
    // Anonymous without an id: refused.
    expect((await POST(new Request("http://t/api/scores", { method: "POST", body: JSON.stringify({ name: "ghost", ...a }) }))).status).toBe(400);
    // A Discord user named like an anonymous player is not blocked, and then owns the name.
    const d = await submitScore({ name: "x", ...a }, { discordId: "777", name: "Kubik" });
    expect(d.status).toBe(201);
    expect((await post({ name: "Kubik", anon: "browser-one00001", ...b })).status).toBe(409);
  });

  it("unverified runs are acknowledged but never stored", async () => {
    // Other rules (deploy mid-run) and no log at all: both come back stored:false and leave the board alone.
    const other = await post({ name: "older", score: 999_999, seed: "s", ticks: 1, rules: RULES_VERSION - 1, log: [{ tick: 0, action: { type: "drop", x: 0 } }] });
    expect(other.status).toBe(200);
    expect(await other.json()).toMatchObject({ stored: false, verified: false, reason: "rules_version", rules: RULES_VERSION });
    const nolog = await post({ name: "claimer", score: 999_999, seed: "s", ticks: 1 });
    expect(await nolog.json()).toMatchObject({ stored: false, verified: false, reason: "no_log" });
    const board = (await (await GET(new Request("http://t/api/scores"))).json()) as { top: Array<{ name: string }>; rules: number };
    expect(board.rules).toBe(RULES_VERSION);
    expect(board.top.some((r) => r.name === "older" || r.name === "claimer")).toBe(false);
  });

  it("DELETE needs the admin token and removes members", async () => {
    const del = (auth: string | null, body: unknown) =>
      DELETE(new Request("http://t/api/scores", { method: "DELETE", body: JSON.stringify(body), headers: auth ? { authorization: auth } : {} }));
    expect((await del("Bearer x", { members: ["a"] })).status).toBe(404); // no token configured
    process.env.ADMIN_TOKEN = "t0k";
    expect((await del("Bearer wrong", { members: ["a"] })).status).toBe(403);
    await post({ name: "zed", anon: "browser-zed00000", ...(await played("zed-run")) });
    // Owner listing shows raw members (anonymous rows are keyed a:<anon id>).
    const list = await GET(new Request("http://t/api/scores?admin=1", { headers: { authorization: "Bearer t0k" } }));
    expect(((await list.json()) as { rows: Array<{ member: string; name?: string }> }).rows.some((r) => r.member === "a:browser-zed00000" && r.name === "zed")).toBe(true);
    expect((await GET(new Request("http://t/api/scores?admin=1"))).status).toBe(403);
    const ok = await del("Bearer t0k", { members: ["a:browser-zed00000", "nobody"] });
    expect(((await ok.json()) as { removed: string[] }).removed).toEqual(["a:browser-zed00000"]);
    // Removing the row frees the name.
    expect((await post({ name: "zed", anon: "browser-other000", ...(await played("zed-run")) })).status).toBe(201);
    delete process.env.ADMIN_TOKEN;
  });

  it("signed-in players are keyed by Discord id and named by Discord", async () => {
    const u = { discordId: "42", name: "Maxime" };
    const a = await played("disc-a");
    const b = await played("disc-b");
    const [hi, lo] = a.score >= b.score ? [a, b] : [b, a];
    const r1 = await submitScore({ name: "ignored", ...hi }, u);
    expect(r1.status).toBe(201);
    expect(((await r1.json()) as { name: string }).name).toBe("Maxime");
    // Renamed on Discord, lower score: row keeps the best score but shows the new name.
    await submitScore({ name: "x", ...lo }, { discordId: "42", name: "Kube" });
    const res = await GET(new Request("http://t/api/scores"));
    const data = (await res.json()) as { top: Array<{ name: string; score: number; discord?: boolean }> };
    const row = data.top.find((r) => r.discord && r.name === "Kube");
    expect(row).toMatchObject({ name: "Kube", score: hi.score, discord: true });
  });

  it("keeps only each player's best, verified, and orders the board", async () => {
    const runs = [await played("best-1"), await played("best-2"), await played("best-3")].sort((x, y) => y.score - x.score);
    expect((await post({ name: "max", anon: "browser-max00000", ...runs[1]! })).status).toBe(201);
    expect((await post({ name: "max", anon: "browser-max00000", ...runs[2]! })).status).toBe(201);
    expect((await post({ name: "ana", anon: "browser-ana00000", ...runs[0]! })).status).toBe(201);
    const res = await GET(new Request("http://t/api/scores"));
    const data = (await res.json()) as { top: Array<{ name: string; score: number; verified: boolean; discord?: boolean }> };
    expect(data.top.filter((r) => !r.discord && (r.name === "ana" || r.name === "max"))).toEqual([
      { name: "ana", score: runs[0]!.score, verified: true, discord: false },
      { name: "max", score: runs[1]!.score, verified: true, discord: false },
    ]);
  });
});
