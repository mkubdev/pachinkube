/** Tiny client for the Auth.js endpoints in api/auth. */
export interface SessionUser {
  name?: string | null;
  image?: string | null;
  discordId?: string;
}

/** Resolves null when signed out; throws when auth is not configured (503). */
export async function getSession(): Promise<SessionUser | null> {
  const res = await fetch("/api/auth/session", { credentials: "same-origin" });
  if (res.status === 503) throw new Error("auth not configured");
  if (!res.ok) return null;
  const data = (await res.json()) as { user?: SessionUser } | null;
  return data?.user ?? null;
}

export const signInUrl = "/api/auth/signin";
export const signOutUrl = "/api/auth/signout";
