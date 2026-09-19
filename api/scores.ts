/**
 * Leaderboard: GET top runs, POST a run.
 *
 * Storage is an Upstash Redis sorted set (`ZADD` with GT keeps only a player's
 * best). With no Upstash env vars it falls back to process memory so local dev
 * and previews work; that data vanishes on restart and is per-instance.
 *
 * Verification: when the client includes its input `log`, the run is replayed
 * headless and the score must reproduce exactly. Submissions without a log are
 * accepted but stored unverified, so the board can show the difference.
 */
import { Redis } from "@upstash/redis";
import { replay, validateLog, validatePool } from "../src/game/replay.js";
import type { RunInput } from "../src/game/run.js";
import type { Pool } from "../src/game/meta.js";

const KEY = "pachinkube:scores:v1";
const TOP_N = 20;

interface RunSubmission {
  name: string;
  score: number;
  seed: string;
  ticks: number;
}

interface RunRecord extends RunSubmission {
  at: string;
  verified: boolean;
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

// --- storage -----------------------------------------------------------------

interface Store {
  top(n: number): Promise<Array<{ name: string; score: number; verified?: boolean }>>;
  submit(run: RunRecord): Promise<{ improved: boolean }>;
  detail(name: string): Promise<RunRecord | null>;
}

function redisStore(): Store | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const redis = new Redis({ url, token });
  return {
    async top(n) {
      const flat = await redis.zrange<string[]>(KEY, 0, n - 1, { rev: true, withScores: true });
      const out: Array<{ name: string; score: number; verified?: boolean }> = [];
      for (let i = 0; i < flat.length; i += 2) out.push({ name: String(flat[i]), score: Number(flat[i + 1]) });
      if (out.length) {
        const runs = await redis.hmget<Record<string, string>>(`${KEY}:runs`, ...out.map((o) => o.name));
        for (const o of out) {
          const raw = runs?.[o.name];
          if (raw) o.verified = (JSON.parse(raw) as RunRecord).verified;
        }
      }
      return out;
    },
    async submit(run) {
      const before = await redis.zscore(KEY, run.name);
      await redis.zadd(KEY, { gt: true }, { score: run.score, member: run.name });
      const improved = before === null || run.score > Number(before);
      if (improved) await redis.hset(`${KEY}:runs`, { [run.name]: JSON.stringify(run) });
      return { improved };
    },
    async detail(name) {
      const raw = await redis.hget<string>(`${KEY}:runs`, name);
      return raw ? (JSON.parse(raw) as RunRecord) : null;
    },
  };
}

const memory = new Map<string, RunRecord>();
const memoryStore: Store = {
  async top(n) {
    return [...memory.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map(({ name, score, verified }) => ({ name, score, verified }));
  },
  async submit(run) {
    const prev = memory.get(run.name);
    const improved = !prev || run.score > prev.score;
    if (improved) memory.set(run.name, run);
    return { improved };
  },
  async detail(name) {
    return memory.get(name) ?? null;
  },
};

const store: Store = redisStore() ?? memoryStore;
export const usingRedis = store !== memoryStore;

// --- validation ----------------------------------------------------------------

function parseSubmission(body: unknown): (RunSubmission & { log?: RunInput[]; pool?: Pool }) | string {
  if (typeof body !== "object" || body === null) return "body must be an object";
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name.length < 1 || name.length > 24) return "name must be 1-24 chars";
  if (!/^[\p{L}\p{N} _.-]+$/u.test(name)) return "name has invalid characters";
  const score = Number(b.score);
  if (!Number.isFinite(score) || score < 0) return "score must be a non-negative number";
  const seed = typeof b.seed === "string" ? b.seed : "";
  if (seed.length < 1 || seed.length > 64) return "seed must be 1-64 chars";
  const ticks = Number(b.ticks);
  if (!Number.isInteger(ticks) || ticks < 0) return "ticks must be a non-negative integer";
  if (b.log !== undefined && !validateLog(b.log)) return "log is malformed";
  if (b.pool !== undefined && !validatePool(b.pool)) return "pool is malformed";
  return { name, score, seed, ticks, log: b.log as RunInput[] | undefined, pool: b.pool as Pool | undefined };
}

// --- handlers ------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  const name = new URL(req.url).searchParams.get("name");
  if (name) {
    const run = await store.detail(name);
    return run ? json(run) : json({ error: "not found" }, 404);
  }
  return json({ top: await store.top(TOP_N), storage: usingRedis ? "redis" : "memory" });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const parsed = parseSubmission(body);
  if (typeof parsed === "string") return json({ error: parsed }, 400);
  const { log, pool, ...run } = parsed;
  let verified = false;
  if (log) {
    // The pool the client played with shapes the shop, so the replay needs it.
    const r = await replay(run.seed, log, pool);
    if (r.score !== run.score) {
      return json({ error: "score does not reproduce from log", replayed: r.score }, 422);
    }
    verified = true;
  }
  const result = await store.submit({ ...run, verified, at: new Date().toISOString() });
  return json({ ok: true, verified, ...result }, 201);
}
