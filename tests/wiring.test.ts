import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * main.ts is DOM-bound and cannot run under vitest, but its event switch is
 * where scripted edits have silently missed before. Assert the call sites
 * that keep game events reaching progression, renderer and UI.
 */
const main = readFileSync("src/main.ts", "utf8");

describe("main.ts wiring", () => {
  it("feeds progression from the simulation step", () => {
    expect(main).toMatch(/recordEvents\(meta, events, run, tracker\)/);
    expect(main).toMatch(/recordOffers\(meta, run\.offers\)/);
    expect(main).toMatch(/recordRunEnd\(meta, run\)/);
    expect(main).toMatch(/showRunDiscoveries\(meta, run\)/);
    expect((main.match(/recordDrop\(meta\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(main).toMatch(/metaStore\.save\(meta\)/);
  });

  it("handles every presentation-relevant game event", () => {
    for (const c of ["pegLit", "pegHit", "zap", "fx", "combo", "comboEnd", "ballScored", "shake", "popup", "retry", "cleared", "pegElement", "element", "charmExpired", "pockets", "comboEvent", "comboEventEnd", "portal"]) {
      expect(main, `case "${c}"`).toMatch(new RegExp(`case "${c}"`));
    }
    for (const k of ["bomb", "bullseye", "prism", "finale", "split", "revive", "overflow", "metal"]) {
      expect(main, `fx kind ${k}`).toMatch(new RegExp(`e\\.kind === "${k}"`));
    }
    for (const k of ["laser", "quake", "rain", "gravity_flip", "magnet_storm", "slowmo"]) {
      expect(main, `combo event ${k}`).toMatch(new RegExp(`case "${k}"`));
    }
    for (const k of ["ignite", "freeze", "charge", "burn", "shatter", "steam", "zap", "wildfire", "shatter_chain"]) {
      expect(main, `element kind ${k}`).toMatch(new RegExp(`case "${k}"`));
    }
  });

  it("keeps the renderer fed", () => {
    expect(main).toMatch(/view\.elementOf = /);
    expect(main).toMatch(/view\.setPegElement\(e\.peg, e\.el\)/);
    expect(main).toMatch(/view\.setPocketMults\(/);
    expect((main.match(/view\.shock\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
