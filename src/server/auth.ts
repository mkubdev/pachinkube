/**
 * Server-side session lookup shared by the API functions.
 * Runs Auth.js against a synthetic /session request carrying the caller's
 * cookies, so any function can learn who is calling without duplicating the
 * auth config.
 */
import { Auth, type AuthConfig } from "@auth/core";
import Discord from "@auth/core/providers/discord";

export interface SessionUser {
  discordId: string;
  name: string | null;
  image: string | null;
}

export function authConfig(): AuthConfig | null {
  const clientId = process.env.AUTH_DISCORD_ID;
  const clientSecret = process.env.AUTH_DISCORD_SECRET;
  const secret = process.env.AUTH_SECRET;
  if (!clientId || !clientSecret || !secret) return null;
  return {
    secret,
    trustHost: true,
    basePath: "/api/auth",
    providers: [Discord({ clientId, clientSecret })],
    callbacks: {
      jwt({ token, account, profile }) {
        if (account?.provider === "discord" && profile) token.discordId = (profile as { id?: string }).id;
        return token;
      },
      session({ session, token }) {
        (session.user as { discordId?: string }).discordId = token.discordId as string | undefined;
        return session;
      },
    },
  };
}

export const authConfigured = (): boolean => authConfig() !== null;

/** Who is calling, or null when signed out / auth not configured. */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const cfg = authConfig();
  if (!cfg) return null;
  const url = new URL("/api/auth/session", req.url);
  const res = await Auth(new Request(url, { headers: { cookie: req.headers.get("cookie") ?? "" } }), cfg);
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { user?: { discordId?: string; name?: string; image?: string } } | null;
  const id = data?.user?.discordId;
  if (!id) return null;
  return { discordId: id, name: data?.user?.name ?? null, image: data?.user?.image ?? null };
}
