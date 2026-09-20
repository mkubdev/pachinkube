import { describe, expect, it } from "vitest";
import { GET, sharePage } from "../api/share.js";
import { signShare, verifyShare } from "../src/server/share.js";

describe("share links", () => {
  it("tokens round-trip and any edit breaks them", async () => {
    const t = await signShare({ s: 4_505_110, n: "Kube" });
    expect(await verifyShare(t)).toEqual({ s: 4_505_110, n: "Kube" });
    const [body, mac] = t.split(".") as [string, string];
    // Forge a bigger score with the same signature: refused.
    const forgedBody = Buffer.from(JSON.stringify({ s: 99_999_999, n: "Kube" })).toString("base64url");
    expect(await verifyShare(`${forgedBody}.${mac}`)).toBeNull();
    // Flip a signature character: refused.
    const flipped = mac[0] === "A" ? "B" : "A";
    expect(await verifyShare(`${body}.${flipped}${mac.slice(1)}`)).toBeNull();
    expect(await verifyShare("garbage")).toBeNull();
    expect(await verifyShare("")).toBeNull();
  });

  it("renders the verified score and name into Open Graph tags and forwards humans to the game", async () => {
    const t = await signShare({ s: 4_505_110, n: "Kube" });
    const { html } = await sharePage(new URLSearchParams({ t }));
    expect(html).toContain('og:title" content="Try to beat my score: 4,505,110"');
    expect(html).toContain("Kube scored 4,505,110 in PACHINKUBE");
    expect(html).toContain("/?challenge=4505110&amp;by=Kube");
    expect(html).toContain("og.png");
    const res = await GET(new Request(`https://pachinkube.vercel.app/s?t=${encodeURIComponent(t)}`));
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Try to beat my score: 4,505,110");
    // Names with markup are dropped rather than injected, even when signed.
    const evil = await signShare({ s: 5, n: "Kube <b>" });
    expect((await sharePage(new URLSearchParams({ t: evil }))).html).not.toContain("<b>");
    // No token, a forged token, or the old ?score= form: plain site preview, no score.
    const bad: Array<Record<string, string>> = [{}, { score: "999999" }, { t: "abc.def" }];
    for (const q of bad) {
      expect((await sharePage(new URLSearchParams(q))).html).toContain('og:title" content="PACHINKUBE"');
    }
  });
});
