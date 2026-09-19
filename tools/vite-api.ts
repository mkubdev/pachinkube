/**
 * Dev-only bridge so `npm run dev` serves the Vercel functions in ./api
 * without the Vercel CLI. Handlers use the Web `Request`/`Response` signature
 * (`export function GET/POST(req: Request)`), which Vercel's Node runtime
 * also accepts, so the same file runs in both places.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Plugin } from "vite";

const ROUTES: Array<[RegExp, string]> = [
  [/^\/api\/auth(\/.*)?$/, "api/auth.ts"],
  [/^\/api\/scores\/?$/, "api/scores.ts"],
  [/^\/api\/meta\/?$/, "api/meta.ts"],
];

async function toWebRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  const method = req.method ?? "GET";
  return new Request(new URL(req.url ?? "/", origin), {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
}

async function sendWebResponse(res: ServerResponse, out: Response): Promise<void> {
  res.statusCode = out.status;
  out.headers.forEach((v, k) => {
    // Multiple Set-Cookie headers must not be joined.
    if (k.toLowerCase() === "set-cookie") res.appendHeader("set-cookie", v);
    else res.setHeader(k, v);
  });
  const cookies = (out.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.();
  if (cookies?.length) res.setHeader("set-cookie", cookies);
  res.end(Buffer.from(await out.arrayBuffer()));
}

export function vercelApiDev(): Plugin {
  return {
    name: "pachinkube:vercel-api-dev",
    apply: "serve",
    configureServer(server) {
      // Make .env available to the handlers, not just VITE_* to the client.
      const env = loadEnv(server.config.mode, server.config.root, "");
      for (const [k, v] of Object.entries(env)) process.env[k] ??= v;

      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? "").split("?")[0] ?? "";
        const route = ROUTES.find(([re]) => re.test(path));
        if (!route) return next();
        const file = resolve(server.config.root, route[1]);
        if (!existsSync(file)) return next();
        try {
          const mod = (await server.ssrLoadModule(file)) as Record<string, unknown>;
          const origin = process.env.AUTH_URL ?? `http://localhost:${server.config.server.port ?? 5173}`;
          const request = await toWebRequest(req, origin);
          const fn = (mod[request.method] ?? mod.default) as ((r: Request) => Promise<Response>) | undefined;
          if (!fn) {
            res.statusCode = 405;
            return res.end("method not allowed");
          }
          await sendWebResponse(res, await fn(request));
        } catch (err) {
          server.config.logger.error(String(err));
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}

