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
/** Reset generation; bumped by every wipe. Clients compare it to `meta.epoch`. */
const EPOCH_KEY = "pachinkube:meta:epoch";

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

interface Store {
  get(id: string): Promise<MetaState | null>;
  set(id: string, meta: MetaState): Promise<void>;
  remove(id: string): Promise<void>;
  epoch(): Promise<number>;
  /** Drop every profile and start a new epoch. Returns how many were dropped. */
  wipe(): Promise<number>;
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
    async remove(id) {
      await redis.hdel(KEY, id);
    },
    async epoch() {
      return Number((await redis.get<number | string>(EPOCH_KEY)) ?? 0);
    },
    async wipe() {
      const n = await redis.hlen(KEY);
      await redis.del(KEY);
      await redis.incr(EPOCH_KEY);
      return n;
    },
  };
}

const memory = new Map<string, MetaState>();
let memoryEpoch = 0;
const memoryStore: Store = {
  async get(id) {
    return memory.get(id) ?? null;
  },
  async set(id, meta) {
    memory.set(id, meta);
  },
  async remove(id) {
    memory.delete(id);
  },
  async epoch() {
    return memoryEpoch;
  },
  async wipe() {
    const n = memory.size;
    memory.clear();
    memoryEpoch++;
    return n;
  },
};
const store: Store = redisStore() ?? memoryStore;

/** Pure handler, separated from session resolution so it can be tested. */
export async function handleMeta(method: string, body: unknown, userId: string): Promise<Response> {
  const epoch = await store.epoch();
  if (method === "GET") return json({ meta: await store.get(userId), epoch });
  if (method === "DELETE") {
    await store.remove(userId);
    return json({ ok: true, epoch });
  }
  if (method !== "POST") return json({ error: "method not allowed" }, 405);
  const incoming = (body as { meta?: unknown } | null)?.meta;
  if (!validateMeta(incoming)) return json({ error: "meta is malformed" }, 400);
  // A profile from before the last wipe (or never synced) must not repopulate
  // the store: tell the client to start over at the current epoch.
  if (incoming.epoch !== epoch) return json({ meta: null, epoch, reset: true }, 409);
  const current = await store.get(userId);
  const merged = current ? mergeMeta(current, incoming) : incoming;
  merged.epoch = epoch;
  await store.set(userId, merged);
  return json({ meta: merged, epoch });
}

/** Everyone's progression gone, new epoch. Exported for the DELETE route and tests. */
export async function handleWipe(): Promise<number> {
  return store.wipe();
}

/** Current epoch, readable without a session so signed-out clients can stamp their profile. */
export async function handleEpoch(): Promise<Response> {
  return json({ epoch: await store.epoch() });
}

async function withUser(req: Request): Promise<Response> {
  if (req.method === "GET" && new URL(req.url).searchParams.has("epoch")) return handleEpoch();
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

/**
 * DELETE ?me=1 → the signed-in player forgets their own server profile.
 * DELETE with Bearer ADMIN_TOKEN → owner reset of every profile; the epoch
 * bump makes every client, open or not, start over on its next sync.
 */
export async function DELETE(req: Request): Promise<Response> {
  if (new URL(req.url).searchParams.has("me")) return withUser(req);
  const token = process.env.ADMIN_TOKEN;
  if (!token) return json({ error: "not found" }, 404);
  if (req.headers.get("authorization") !== `Bearer ${token}`) return json({ error: "forbidden" }, 403);
  const wiped = await handleWipe();
  return json({ ok: true, wiped, epoch: await store.epoch() });
}
