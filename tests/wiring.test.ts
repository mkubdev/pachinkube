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
    expect(main).toMatch(/rules: RULES_VERSION/);
    expect(main).toMatch(/anon: anonId\(\)/);
    expect(main).toMatch(/ui\.enableShare\(data\.share\)/);
    expect(main).toMatch(/ui\.accountName && run\.totalScore > 0/); // auto-submit when signed in; the server judges "best"
    expect(main).not.toMatch(/bestBefore/);
    expect(main).toMatch(/ui\.showSignInCallout\(\)/);
    expect(main).toMatch(/tainted \? \{\} : \{ log: run\.log, pool: run\.pool \}/);
    expect(main).toMatch(/ui\.onResetMeta = \(\) => metaStore\.resetMine\(\)/);
    expect(main).toMatch(/metaStore\.onReset = /);
  });

  it("handles every presentation-relevant game event", () => {
    for (const c of ["pegLit", "pegHit", "zap", "fx", "combo", "comboEnd", "fever", "ballScored", "shake", "popup", "retry", "cleared", "pegElement", "element", "charmExpired", "pockets", "comboEvent", "comboEventEnd", "portal"]) {
      expect(main, `case "${c}"`).toMatch(new RegExp(`case "${c}"`));
    }
    for (const k of ["bomb", "bullseye", "prism", "finale", "split", "revive", "overflow", "metal"]) {
      expect(main, `fx kind ${k}`).toMatch(new RegExp(`e\\.kind === "${k}"`));
    }
    for (const k of ["laser", "quake", "rain", "gravity_flip", "magnet_storm", "slowmo", "overdrive", "time_lock", "fresh_coat"]) {
      expect(main, `combo event ${k}`).toMatch(new RegExp(`case "${k}"`));
    }
    for (const k of ["ignite", "freeze", "charge", "burn", "shatter", "steam", "zap", "wildfire", "shatter_chain"]) {
      expect(main, `element kind ${k}`).toMatch(new RegExp(`case "${k}"`));
    }
  });

  it("works on phones: touch aiming and bar-aware camera", () => {
    expect(main).toMatch(/canvas\.addEventListener\("pointerdown"/);
    expect(main).toMatch(/canvas\.addEventListener\("pointerup"/);
    expect(main).toMatch(/canvas\.addEventListener\("pointercancel"/);
    expect(main).toMatch(/setPointerCapture\(e\.pointerId\)/);
    expect(main).toMatch(/view\.setViewInsets\(/);
    expect(main).toMatch(/function streamTick/);
    expect(main).toMatch(/streamTick\(now\)/);
    expect(main).toMatch(/case "bumpers"/);
    expect(main).toMatch(/case "bumper"/);
    expect(main).toMatch(/view\.setPegBumpers\(e\.pegs\)/);
    expect((main.match(/view\.setFins\(run\.sim\.fins\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(main).toMatch(/run\.sim\.dropLimit/);
    expect(main).toMatch(/new ResizeObserver/);
    const html = readFileSync("index.html", "utf8");
    expect(html).toMatch(/viewport-fit=cover/);
    expect(html).toMatch(/@media \(max-width: 760px\) and \(orientation: portrait\)/);
    expect(html).toMatch(/touch-action: none/);
  });

  it("keeps the renderer fed", () => {
    expect(main).toMatch(/view\.elementOf = /);
    expect(main).toMatch(/view\.setPegElement\(e\.peg, e\.el\)/);
    expect(main).toMatch(/view\.setPocketMults\(/);
    expect((main.match(/view\.shock\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
