/**
 * Share links: /s?t=<signed token>
 *
 * Chat apps (Discord, Slack, iMessage) fetch the URL and read the Open Graph
 * tags, so the preview can say "Try to beat my score: 4,505,110" with the
 * player's name — static index.html tags cannot carry a score. The token is
 * signed by the server for scores that are actually on the board
 * (`src/server/share.ts`), so a link can never claim a score that was not
 * verified; a bad token degrades to the plain preview. Humans are sent
 * straight on to the game, with the challenge in the query for the greeting.
 */
import { verifyShare } from "../src/server/share.js";

const SITE = "https://pachinkube.vercel.app";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function sharePage(params: URLSearchParams): Promise<{ html: string; status: number }> {
  const token = params.get("t") ?? "";
  const payload = token ? await verifyShare(token) : null;
  const score = payload ? payload.s : NaN;
  const rawName = (payload?.n ?? "").trim().slice(0, 24);
  const name = /^[\p{L}\p{N} _.-]*$/u.test(rawName) ? rawName : "";
  const valid = payload !== null && Number.isFinite(score) && score >= 0 && score < 1e15;
  const pretty = valid ? score.toLocaleString("en-US") : "";
  const title = valid ? `Try to beat my score: ${pretty}` : "PACHINKUBE";
  const who = name ? `${name} scored ${pretty} in PACHINKUBE` : valid ? `Someone scored ${pretty} in PACHINKUBE` : "PACHINKUBE";
  const description = valid
    ? `${who} — a pachinko roguelite: balls, charms, elements, absurd combos. Play in the browser, no install.`
    : "A pachinko roguelite: balls, charms, elements, absurd combos. Play in the browser, no install.";
  const target = valid ? `${SITE}/?challenge=${score}${name ? `&by=${encodeURIComponent(name)}` : ""}` : `${SITE}/`;
  const self = valid ? `${SITE}/s?t=${encodeURIComponent(token)}` : `${SITE}/`;
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<title>${esc(title)} · PACHINKUBE</title>
<meta name="description" content="${esc(description)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="PACHINKUBE" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(self)}" />
<meta property="og:image" content="${SITE}/og.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="PACHINKUBE — neon pachinko board" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${SITE}/og.png" />
<meta name="theme-color" content="#07070c" />
<meta http-equiv="refresh" content="0; url=${esc(target)}" />
<style>html{background:#07070c;color:#c8d0d8;font:16px system-ui,sans-serif}body{display:grid;place-items:center;height:100vh;margin:0}a{color:#2de2ff}</style>
</head><body>
<p>${esc(title)} — <a href="${esc(target)}">play PACHINKUBE</a></p>
<script>location.replace(${JSON.stringify(target)});</script>
</body></html>`;
  return { html, status: 200 };
}

export async function GET(req: Request): Promise<Response> {
  const { html, status } = await sharePage(new URL(req.url).searchParams);
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}
