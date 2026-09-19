import { describe, expect, it } from "vitest";
import { DELETE, GET, POST, submitScore, usingRedis } from "../api/scores.js";
import { RULES_VERSION } from "../src/game/version.js";

const post = (body: unknown) =>
  POST(new Request("http://t/api/scores", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

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

  it("a log from other rules is stored unverified instead of rejected", async () => {
    const res = await post({ name: "older", score: 999_999, seed: "s", ticks: 1, rules: RULES_VERSION - 1, log: [{ tick: 0, action: { type: "drop", x: 0 } }] });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { verified: boolean; reason?: string; rules: number };
    expect(data.verified).toBe(false);
    expect(data.reason).toBe("rules_version");
    expect(data.rules).toBe(RULES_VERSION);
    const board = (await (await GET(new Request("http://t/api/scores"))).json()) as { rules: number };
    expect(board.rules).toBe(RULES_VERSION);
  });

  it("DELETE needs the admin token and removes members", async () => {
    const del = (auth: string | null, body: unknown) =>
      DELETE(new Request("http://t/api/scores", { method: "DELETE", body: JSON.stringify(body), headers: auth ? { authorization: auth } : {} }));
    expect((await del("Bearer x", { members: ["a"] })).status).toBe(404); // no token configured
    process.env.ADMIN_TOKEN = "t0k";
    expect((await del("Bearer wrong", { members: ["a"] })).status).toBe(403);
    await post({ name: "zed", score: 5, seed: "s", ticks: 1 });
    const ok = await del("Bearer t0k", { members: ["zed", "nobody"] });
    expect(((await ok.json()) as { removed: string[] }).removed).toEqual(["zed"]);
    delete process.env.ADMIN_TOKEN;
  });

  it("signed-in players are keyed by Discord id and named by Discord", async () => {
    const u = { discordId: "42", name: "Maxime" };
    const r1 = await submitScore({ name: "ignored", score: 300, seed: "s", ticks: 1 }, u);
    expect(r1.status).toBe(201);
    expect(((await r1.json()) as { name: string }).name).toBe("Maxime");
    // Renamed on Discord, lower score: row keeps the best score but shows the new name.
    await submitScore({ name: "x", score: 100, seed: "s", ticks: 1 }, { discordId: "42", name: "Kube" });
    const res = await GET(new Request("http://t/api/scores"));
    const data = (await res.json()) as { top: Array<{ name: string; score: number; discord?: boolean }> };
    const row = data.top.find((r) => r.discord);
    expect(row).toMatchObject({ name: "Kube", score: 300, discord: true });
  });

  it("keeps only each player's best and orders the board", async () => {
    expect((await post({ name: "max", score: 100, seed: "s", ticks: 10 })).status).toBe(201);
    expect((await post({ name: "max", score: 50, seed: "s", ticks: 10 })).status).toBe(201);
    expect((await post({ name: "ana", score: 250, seed: "s", ticks: 10 })).status).toBe(201);
    const res = await GET(new Request("http://t/api/scores"));
    const data = (await res.json()) as { top: Array<{ name: string; score: number; verified: boolean; discord?: boolean }> };
    // No log was sent, so these are stored unverified.
    expect(data.top.filter((r) => !r.discord && (r.name === "ana" || r.name === "max"))).toEqual([
      { name: "ana", score: 250, verified: false, discord: false },
      { name: "max", score: 100, verified: false, discord: false },
    ]);
  });
});
