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
import { getSessionUser } from "../src/server/auth.js";
import { RULES_VERSION } from "../src/game/version.js";

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
  /** Set when the run was submitted by a signed-in Discord user. */
  discordId?: string;
}

/**
 * Sorted-set member: signed-in players are keyed by Discord id so a rename
 * keeps one row; anonymous players are keyed by the typed name.
 */
const memberFor = (run: RunRecord): string => (run.discordId ? `d:${run.discordId}` : run.name);
const isDiscordMember = (m: string): boolean => m.startsWith("d:");

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

// --- storage -----------------------------------------------------------------

export interface BoardRow {
  name: string;
  score: number;
  verified?: boolean;
  discord?: boolean;
}

interface Store {
  top(n: number): Promise<BoardRow[]>;
  submit(run: RunRecord): Promise<{ improved: boolean }>;
  detail(member: string): Promise<RunRecord | null>;
  remove(member: string): Promise<boolean>;
  /** Owner maintenance: members with their stored record. */
  topMembers(n: number): Promise<Array<{ member: string; score: number; verified?: boolean; name?: string }>>;
}

function redisStore(): Store | null {
  // Vercel's Upstash integration injects KV_REST_API_*; a hand-made Upstash
  // database uses UPSTASH_REDIS_REST_*. Accept either.
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const redis = new Redis({ url, token });
  return {
    async top(n) {
      const flat = await redis.zrange<string[]>(KEY, 0, n - 1, { rev: true, withScores: true });
      const members: Array<{ member: string; score: number }> = [];
      for (let i = 0; i < flat.length; i += 2) members.push({ member: String(flat[i]), score: Number(flat[i + 1]) });
      if (!members.length) return [];
      const runs = await redis.hmget<Record<string, string | RunRecord>>(`${KEY}:runs`, ...members.map((m) => m.member));
      return members.map(({ member, score }) => {
        const rec = parseRecord(runs?.[member]);
        return { name: rec?.name ?? member, score, verified: rec?.verified, discord: isDiscordMember(member) };
      });
    },
    async submit(run) {
      const member = memberFor(run);
      const before = await redis.zscore(KEY, member);
      await redis.zadd(KEY, { gt: true }, { score: run.score, member });
      const improved = before === null || run.score > Number(before);
      // Always refresh the record for signed-in players so a Discord rename shows.
      if (improved || run.discordId) {
        const stored = improved ? run : { ...(parseRecord(await redis.hget(`${KEY}:runs`, member)) ?? run), name: run.name };
        await redis.hset(`${KEY}:runs`, { [member]: JSON.stringify(stored) });
      }
      return { improved };
    },
    async detail(member) {
      return parseRecord(await redis.hget<string | RunRecord>(`${KEY}:runs`, member));
    },
    async topMembers(n) {
      const flat = (await redis.zrange(KEY, 0, n - 1, { rev: true, withScores: true })) as Array<string | number>;
      const rows: Array<{ member: string; score: number; verified?: boolean; name?: string }> = [];
      for (let i = 0; i < flat.length; i += 2) {
        const member = String(flat[i]);
        const rec = parseRecord(await redis.hget<string | RunRecord>(`${KEY}:runs`, member));
        rows.push({ member, score: Number(flat[i + 1]), verified: rec?.verified, name: rec?.name });
      }
      return rows;
    },
    async remove(member) {
      const n = await redis.zrem(KEY, member);
      await redis.hdel(`${KEY}:runs`, member);
      return n > 0;
    },
  };
}

/** @upstash/redis auto-deserializes JSON strings on read, so accept both shapes. */
function parseRecord(raw: string | RunRecord | null | undefined): RunRecord | null {
  if (!raw) return null;
  return typeof raw === "string" ? (JSON.parse(raw) as RunRecord) : raw;
}

const memory = new Map<string, RunRecord>();
const memoryStore: Store = {
  async top(n) {
    return [...memory.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, n)
      .map(([member, { name, score, verified }]) => ({ name, score, verified, discord: isDiscordMember(member) }));
  },
  async submit(run) {
    const member = memberFor(run);
    const prev = memory.get(member);
    const improved = !prev || run.score > prev.score;
    if (improved) memory.set(member, run);
    else if (prev && run.discordId) memory.set(member, { ...prev, name: run.name });
    return { improved };
  },
  async detail(member) {
    return memory.get(member) ?? null;
  },
  async remove(member) {
    return memory.delete(member);
  },
  async topMembers(n) {
    return [...memory].sort((a, b) => b[1].score - a[1].score).slice(0, n).map(([member, r]) => ({ member, score: r.score, verified: r.verified, name: r.name }));
  },
};

const store: Store = redisStore() ?? memoryStore;
export const usingRedis = store !== memoryStore;

// --- validation ----------------------------------------------------------------

function parseSubmission(body: unknown, sessionName?: string): (RunSubmission & { log?: RunInput[]; pool?: Pool; rules?: number }) | string {
  if (typeof body !== "object" || body === null) return "body must be an object";
  const b = body as Record<string, unknown>;
  // Signed in: the Discord username is the name, whatever the client sent.
  const name = sessionName ? sessionName.slice(0, 24) : typeof b.name === "string" ? b.name.trim() : "";
  if (name.length < 1 || name.length > 24) return "name must be 1-24 chars";
  if (!sessionName && !/^[\p{L}\p{N} _.-]+$/u.test(name)) return "name has invalid characters";
  const score = Number(b.score);
  if (!Number.isFinite(score) || score < 0) return "score must be a non-negative number";
  const seed = typeof b.seed === "string" ? b.seed : "";
  if (seed.length < 1 || seed.length > 64) return "seed must be 1-64 chars";
  const ticks = Number(b.ticks);
  if (!Number.isInteger(ticks) || ticks < 0) return "ticks must be a non-negative integer";
  if (b.log !== undefined && !validateLog(b.log)) return "log is malformed";
  if (b.pool !== undefined && !validatePool(b.pool)) return "pool is malformed";
  const rules = b.rules === undefined ? undefined : Number(b.rules);
  if (rules !== undefined && !Number.isInteger(rules)) return "rules must be an integer";
  return { name, score, seed, ticks, log: b.log as RunInput[] | undefined, pool: b.pool as Pool | undefined, rules };
}

// --- handlers ------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const name = url.searchParams.get("name");
  if (name) {
    const run = await store.detail(name);
    return run ? json(run) : json({ error: "not found" }, 404);
  }
  // Owner view: the raw sorted-set members (typed name or d:<discordId>) for maintenance.
  if (url.searchParams.has("admin")) {
    const token = process.env.ADMIN_TOKEN;
    if (!token || req.headers.get("authorization") !== `Bearer ${token}`) return json({ error: "forbidden" }, 403);
    return json({ rows: await store.topMembers(TOP_N) });
  }
  return json({ top: await store.top(TOP_N), storage: usingRedis ? "redis" : "memory", rules: RULES_VERSION });
}

/**
 * Owner maintenance: remove rows. `authorization: Bearer <ADMIN_TOKEN>`,
 * body `{ members: string[] }` where a member is a typed name or `d:<discordId>`.
 * 404 when no token is configured, so the route does not exist in effect.
 */
export async function DELETE(req: Request): Promise<Response> {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return json({ error: "not found" }, 404);
  if (req.headers.get("authorization") !== `Bearer ${token}`) return json({ error: "forbidden" }, 403);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const members = (body as { members?: unknown } | null)?.members;
  if (!Array.isArray(members) || members.some((m) => typeof m !== "string") || members.length > 50) {
    return json({ error: "members must be a list of up to 50 strings" }, 400);
  }
  const removed: string[] = [];
  for (const m of members as string[]) if (await store.remove(m)) removed.push(m);
  return json({ ok: true, removed });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  // Null when signed out or auth is not configured: anonymous submission.
  const user = await getSessionUser(req).catch(() => null);
  return submitScore(body, user ? { discordId: user.discordId, name: user.name ?? `discord-${user.discordId.slice(-4)}` } : null);
}

/** Testable core of POST: `user` is the resolved session, if any. */
export async function submitScore(body: unknown, user: { discordId: string; name: string } | null): Promise<Response> {
  const parsed = parseSubmission(body, user?.name);
  if (typeof parsed === "string") return json({ error: parsed }, 400);
  const { log, pool, rules, ...run } = parsed;
  // Only replay-verified runs reach the board. Anything else (played under
  // other rules after a mid-run deploy, dev-modified, no log) is acknowledged
  // but not stored: the leaderboard is proof, not a claim.
  if (!log) return json({ ok: false, stored: false, verified: false, reason: "no_log", rules: RULES_VERSION }, 200);
  if (rules !== undefined && rules !== RULES_VERSION) {
    return json({ ok: false, stored: false, verified: false, reason: "rules_version", rules: RULES_VERSION }, 200);
  }
  // The pool the client played with shapes the shop, so the replay needs it.
  const r = await replay(run.seed, log, pool);
  if (r.score !== run.score) {
    return json({ error: "score does not reproduce from log", replayed: r.score }, 422);
  }
  const result = await store.submit({ ...run, verified: true, at: new Date().toISOString(), discordId: user?.discordId });
  return json({ ok: true, stored: true, verified: true, name: run.name, rules: RULES_VERSION, ...result }, 201);
}
