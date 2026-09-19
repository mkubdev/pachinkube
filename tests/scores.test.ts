import { describe, expect, it } from "vitest";
import { GET, POST, usingRedis } from "../api/scores.js";

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

  it("keeps only each player's best and orders the board", async () => {
    expect((await post({ name: "max", score: 100, seed: "s", ticks: 10 })).status).toBe(201);
    expect((await post({ name: "max", score: 50, seed: "s", ticks: 10 })).status).toBe(201);
    expect((await post({ name: "ana", score: 250, seed: "s", ticks: 10 })).status).toBe(201);
    const res = await GET(new Request("http://t/api/scores"));
    const data = (await res.json()) as { top: Array<{ name: string; score: number; verified: boolean }> };
    // No log was sent, so these are stored unverified.
    expect(data.top).toEqual([
      { name: "ana", score: 250, verified: false },
      { name: "max", score: 100, verified: false },
    ]);
  });
});
