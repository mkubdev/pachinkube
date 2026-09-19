/**
 * Per-player progression, keyed by Discord id.
 *
 * GET  → { meta } for the signed-in player (null if none yet); 401 signed out;
 *        503 when auth is not configured.
 * POST → { meta } merges the client's profile into the stored one and returns
 *        the result. Merging (not replacing) means two devices never clobber
 *        each other and a stale tab cannot roll progress back.
 */
import { Redis } from "@upstash/redis";
import { mergeMeta, validateMeta, type MetaState } from "../src/game/meta.js";
import { authConfigured, getSessionUser } from "../src/server/auth.js";

const KEY = "pachinkube:meta:v1";

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

interface Store {
  get(id: string): Promise<MetaState | null>;
  set(id: string, meta: MetaState): Promise<void>;
}

function redisStore(): Store | null {
  // Vercel's Upstash integration injects KV_REST_API_*; a hand-made Upstash
  // database uses UPSTASH_REDIS_REST_*. Accept either.
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const redis = new Redis({ url, token });
  return {
    async get(id) {
      const raw = await redis.hget<string | MetaState>(KEY, id);
      if (!raw) return null;
      return typeof raw === "string" ? (JSON.parse(raw) as MetaState) : raw;
    },
    async set(id, meta) {
      await redis.hset(KEY, { [id]: JSON.stringify(meta) });
    },
  };
}

const memory = new Map<string, MetaState>();
const memoryStore: Store = {
  async get(id) {
    return memory.get(id) ?? null;
  },
  async set(id, meta) {
    memory.set(id, meta);
  },
};
const store: Store = redisStore() ?? memoryStore;

/** Pure handler, separated from session resolution so it can be tested. */
export async function handleMeta(method: string, body: unknown, userId: string): Promise<Response> {
  if (method === "GET") return json({ meta: await store.get(userId) });
  if (method !== "POST") return json({ error: "method not allowed" }, 405);
  const incoming = (body as { meta?: unknown } | null)?.meta;
  if (!validateMeta(incoming)) return json({ error: "meta is malformed" }, 400);
  const current = await store.get(userId);
  const merged = current ? mergeMeta(current, incoming) : incoming;
  await store.set(userId, merged);
  return json({ meta: merged });
}

async function withUser(req: Request): Promise<Response> {
  if (!authConfigured()) return json({ error: "auth not configured" }, 503);
  const user = await getSessionUser(req);
  if (!user) return json({ error: "sign in required" }, 401);
  let body: unknown = null;
  if (req.method === "POST") {
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid JSON" }, 400);
    }
  }
  return handleMeta(req.method, body, user.discordId);
}

export const GET = withUser;
export const POST = withUser;
