/**
 * Signed share tokens. The share preview (/s) must never show a score the
 * board does not hold, so the server issues a token for stored scores and the
 * preview only renders what verifies. HMAC-SHA256 over a compact payload;
 * anyone may share anyone's token — it is the truth, not a claim.
 */
export interface SharePayload {
  s: number; // score
  n: string; // display name ("" when anonymous name was dropped)
}

const secret = (): string => process.env.SHARE_SECRET ?? process.env.ADMIN_TOKEN ?? "pachinkube-dev-share-secret";

const b64u = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const unb64u = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64url"));

async function hmac(data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

export async function signShare(p: SharePayload): Promise<string> {
  const body = b64u(new TextEncoder().encode(JSON.stringify({ s: Math.floor(p.s), n: p.n.slice(0, 24) })));
  const mac = b64u((await hmac(body)).slice(0, 16)); // 128-bit tag is plenty for a share link
  return `${body}.${mac}`;
}

export async function verifyShare(token: string): Promise<SharePayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]{1,400}$/.test(parts[0]!) || !/^[A-Za-z0-9_-]{16,32}$/.test(parts[1]!)) return null;
  const expect = b64u((await hmac(parts[0]!)).slice(0, 16));
  if (expect.length !== parts[1]!.length) return null;
  let diff = 0;
  for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ parts[1]!.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(unb64u(parts[0]!))) as Partial<SharePayload>;
    if (typeof p.s !== "number" || !Number.isFinite(p.s) || p.s < 0 || typeof p.n !== "string") return null;
    return { s: Math.floor(p.s), n: p.n.slice(0, 24) };
  } catch {
    return null;
  }
}
