/**
 * Discord sign-in via Auth.js core, served as a Vercel function.
 *
 * Flat file + a vercel.json rewrite of /api/auth/* onto it: Vercel's
 * filesystem catch-all did not match two-segment paths like
 * /api/auth/callback/discord in production. The function still receives the
 * original URL, which is what Auth.js parses for the action.
 *
 * Endpoints (all under /api/auth): signin, signout, callback/discord, session,
 * csrf, providers. Auth.js renders its own minimal signin/signout pages, so
 * the client only needs to link to /api/auth/signin and read /api/auth/session.
 *
 * Requires AUTH_DISCORD_ID, AUTH_DISCORD_SECRET, AUTH_SECRET, AUTH_URL.
 */
import { Auth } from "@auth/core";
import { authConfig } from "../src/server/auth.js";

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
