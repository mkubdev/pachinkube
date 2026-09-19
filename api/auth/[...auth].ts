/**
 * Discord sign-in via Auth.js core, served as a Vercel function.
 *
 * Endpoints (all under /api/auth): signin, signout, callback/discord, session,
 * csrf, providers. Auth.js renders its own minimal signin/signout pages, so
 * the client only needs to link to /api/auth/signin and read /api/auth/session.
 *
 * Requires AUTH_DISCORD_ID, AUTH_DISCORD_SECRET, AUTH_SECRET, AUTH_URL.
 * NOTE: not exercisable without a Discord application; verified by typecheck only.
 */
import { Auth, type AuthConfig } from "@auth/core";
import Discord from "@auth/core/providers/discord";

function config(): AuthConfig {
  const clientId = process.env.AUTH_DISCORD_ID;
  const clientSecret = process.env.AUTH_DISCORD_SECRET;
  const secret = process.env.AUTH_SECRET;
  if (!clientId || !clientSecret || !secret) {
    throw new Error("Auth not configured: set AUTH_DISCORD_ID, AUTH_DISCORD_SECRET, AUTH_SECRET");
  }
  return {
    secret,
    trustHost: true,
    basePath: "/api/auth",
    providers: [Discord({ clientId, clientSecret })],
    callbacks: {
      // Expose the stable Discord user id so the leaderboard can key on it
      // instead of a display name that anyone can type.
      jwt({ token, account, profile }) {
        if (account?.provider === "discord" && profile) {
          token.discordId = (profile as { id?: string }).id;
        }
        return token;
      },
      session({ session, token }) {
        (session.user as { discordId?: string }).discordId = token.discordId as string | undefined;
        return session;
      },
    },
  };
}

async function handle(req: Request): Promise<Response> {
  try {
    return await Auth(req, config());
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
}

export const GET = handle;
export const POST = handle;
