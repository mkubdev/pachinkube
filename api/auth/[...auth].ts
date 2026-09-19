/**
 * Discord sign-in via Auth.js core, served as a Vercel function.
 *
 * Endpoints (all under /api/auth): signin, signout, callback/discord, session,
 * csrf, providers. Auth.js renders its own minimal signin/signout pages, so
 * the client only needs to link to /api/auth/signin and read /api/auth/session.
 *
 * Requires AUTH_DISCORD_ID, AUTH_DISCORD_SECRET, AUTH_SECRET, AUTH_URL.
 */
import { Auth } from "@auth/core";
import { authConfig } from "../../src/server/auth.js";

async function handle(req: Request): Promise<Response> {
  const cfg = authConfig();
  if (!cfg) {
    return new Response(
      JSON.stringify({ error: "Auth not configured: set AUTH_DISCORD_ID, AUTH_DISCORD_SECRET, AUTH_SECRET" }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }
  return Auth(req, cfg);
}

export const GET = handle;
export const POST = handle;
