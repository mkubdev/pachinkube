import { describe, expect, it } from "vitest";
import { GET, sharePage } from "../api/share.js";

describe("share links", () => {
  it("carries the score and name into Open Graph tags, escaped, and forwards humans to the game", async () => {
    const { html } = sharePage(new URLSearchParams({ score: "4505110", name: "Kube <b>" }));
    expect(html).toContain('og:title" content="Try to beat my score: 4,505,110"');
    expect(html).not.toContain("Kube <b>"); // invalid characters: the name is dropped, never injected
    const ok = sharePage(new URLSearchParams({ score: "4505110", name: "Kube" }));
    expect(ok.html).toContain("Kube scored 4,505,110 in PACHINKUBE");
    expect(ok.html).toContain("/?challenge=4505110&amp;by=Kube");
    expect(ok.html).toContain("og.png");
    const res = await GET(new Request("https://pachinkube.vercel.app/s?score=12"));
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Try to beat my score: 12");
    // Garbage degrades to the plain site preview.
    expect(sharePage(new URLSearchParams({ score: "lol" })).html).toContain('og:title" content="PACHINKUBE"');
  });
});
