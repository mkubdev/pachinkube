/** Tiny client for the Auth.js endpoints in api/auth. */
export interface SessionUser {
  name?: string | null;
  image?: string | null;
  discordId?: string;
}

export async function getSession(): Promise<SessionUser | null> {
  const res = await fetch("/api/auth/session", { credentials: "same-origin" });
  if (!res.ok) return null;
  const data = (await res.json()) as { user?: SessionUser } | null;
  return data?.user ?? null;
}

export const signInUrl = "/api/auth/signin";
export const signOutUrl = "/api/auth/signout";
