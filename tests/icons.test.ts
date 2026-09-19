import { describe, expect, it } from "vitest";
import { ballIcon, charmIcon, featIcon, GLYPH_NAMES } from "../src/game/icons.js";
import { CHARM_IDS } from "../src/game/charms.js";
import { BALL_IDS } from "../src/game/balls.js";
import { FEATS, type FeatId } from "../src/game/meta.js";

describe("8-bit icons", () => {
  it("every charm, ball and feat renders a non-empty crisp SVG", () => {
    for (const id of CHARM_IDS) {
      const svg = charmIcon(id);
      expect(svg.startsWith("<svg")).toBe(true);
      expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThan(10);
      expect(svg).toContain('shape-rendering="crispEdges"');
      expect(charmIcon(id, true)).toContain("#2a2f3a"); // locked palette
    }
    for (const id of BALL_IDS) expect((ballIcon(id).match(/<rect/g) ?? []).length).toBeGreaterThan(30);
    for (const id of Object.keys(FEATS) as FeatId[]) {
      // Every glyph has primary pixels; not every glyph has secondary ones.
      expect(featIcon(id, true)).toContain("#c9962a");
      expect(featIcon(id, false)).toContain("#2a2f3a");
    }
    expect(GLYPH_NAMES.length).toBeGreaterThanOrEqual(18);
  });

  it("glyph maps are 12 columns wide", async () => {
    const src = await import("node:fs").then((fs) => fs.readFileSync("src/game/icons.ts", "utf8"));
    for (const m of src.matchAll(/"([.#+o]{12})"/g)) expect(m[1]).toHaveLength(12);
    expect(src.match(/"[.#+o]{13,}"/)).toBeNull();
    expect(src.match(/"[.#+o]{1,11}"(?=,|\])/)).toBeNull();
  });
});
