# Color & Reaction FX Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recolor Storm to electric violet, give each of the 11 element reactions a signature palette via a central palette module, add two-tone and prismatic particle bursts, and turn the combo counter into a hue journey with a new violet tier at 80+.

**Architecture:** One new pure-data module `src/render/palette.ts` holds every reaction color and the combo tier logic; `src/main.ts`'s element dispatch and `src/game/ui.ts`'s combo counter read from it. `FxSystem` gains `burst2` (two-tone) and `burstPrism` (per-particle hue) built on a shared private `spawnAt`. Everything is presentation-only: no `src/sim/` or game-logic change, no `RULES_VERSION` bump.

**Tech Stack:** TypeScript, Three.js (scene-graph only in tests — no WebGL needed), Vitest, Vite.

**Spec:** `docs/superpowers/specs/2026-09-21-color-reaction-fx-design.md`

**Verify before starting:** `cd /Users/maxime/dev/80.perso/pachinkube && npm test` is green and `git status` is clean.

---

### Task 1: Palette module

**Files:**
- Create: `src/render/palette.ts`
- Test: `tests/palette.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/palette.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COMBO_TIER_FLASH, comboTier, REACTION_FX } from "../src/render/palette.js";

describe("reaction palette", () => {
  it("covers every reaction the run can emit", () => {
    const kinds = [
      "ignite", "freeze", "charge", "thicken", "burn", "flare",
      "steam", "shatter", "zap", "wildfire", "shatter_chain",
    ] as const;
    for (const k of kinds) {
      const p = REACTION_FX[k];
      expect(p, k).toBeDefined();
      expect(p!.primary).toBeGreaterThanOrEqual(0);
      expect(p!.secondary).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives steam, wildfire and shatter_chain their own flash colours", () => {
    expect(REACTION_FX.steam!.flash).toBeDefined();
    expect(REACTION_FX.wildfire!.flash).toBeDefined();
    expect(REACTION_FX.shatter_chain!.flash).toBeDefined();
  });
});

describe("combo hue journey", () => {
  it("climbs white → gold → orange → magenta → violet", () => {
    expect(comboTier(0)).toBe(0);
    expect(comboTier(9)).toBe(0);
    expect(comboTier(10)).toBe(1);
    expect(comboTier(19)).toBe(1);
    expect(comboTier(20)).toBe(2);
    expect(comboTier(39)).toBe(2);
    expect(comboTier(40)).toBe(3);
    expect(comboTier(79)).toBe(3);
    expect(comboTier(80)).toBe(4);
    expect(comboTier(500)).toBe(4);
  });

  it("has one flash colour per tier", () => {
    expect(COMBO_TIER_FLASH).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/palette.test.ts`
Expected: FAIL — cannot resolve `../src/render/palette.js`.

- [ ] **Step 3: Write the implementation**

Create `src/render/palette.ts`:

```ts
/**
 * Reaction & combo colour language. One place to tune the palette: the
 * element-event dispatch in main.ts and the combo counter read from here.
 * Pure data — no Three.js, no DOM — so game/ code and Node tests may import it.
 */
import type { ElementFxKind } from "../game/elements.js";

export interface ReactionFx {
  /** Main particle colour. */
  primary: number;
  /** burst2 lerps each particle between primary and secondary. */
  secondary: number;
  /** Ring / arc colour where a reaction draws one (defaults to primary). */
  accent?: number;
  /** Full-screen flash as a CSS colour; absent = no flash. */
  flash?: string;
}

export const REACTION_FX: Partial<Record<ElementFxKind, ReactionFx>> = {
  ignite: { primary: 0xff6a00, secondary: 0xffd34d },
  freeze: { primary: 0x9fe8ff, secondary: 0xffffff },
  charge: { primary: 0xb44bff, secondary: 0xffffff },
  thicken: { primary: 0x3b6fff, secondary: 0xffffff },
  burn: { primary: 0xff6a00, secondary: 0xff2222 },
  flare: { primary: 0xffd34d, secondary: 0xffffff, accent: 0xff6a00, flash: "#ffd34d" },
  steam: { primary: 0xffffff, secondary: 0xff9ec7, accent: 0xff9ec7, flash: "#ffd7e8" },
  shatter: { primary: 0xdff6ff, secondary: 0xffe9b0, accent: 0x9fe8ff },
  zap: { primary: 0xb44bff, secondary: 0xffffff },
  wildfire: { primary: 0xff6a00, secondary: 0xff2d95, accent: 0xff2d95, flash: "#ff2d95" },
  shatter_chain: { primary: 0xdff6ff, secondary: 0xffffff, accent: 0x9fe8ff, flash: "#c9f2ff" },
};

/** Combo counter hue journey: white → gold → orange → magenta → violet. */
export function comboTier(count: number): 0 | 1 | 2 | 3 | 4 {
  return count >= 80 ? 4 : count >= 40 ? 3 : count >= 20 ? 2 : count >= 10 ? 1 : 0;
}

/** Milestone flash per tier (index = tier). */
export const COMBO_TIER_FLASH = ["#ffffff", "#ffd34d", "#ff8c1a", "#ff2d95", "#b44bff"] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/palette.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/palette.ts tests/palette.test.ts
git commit -m "feat: central reaction/combo colour palette"
```

---

### Task 2: Storm goes electric violet

**Files:**
- Modify: `src/game/elements.ts:19`

- [ ] **Step 1: Change the hex**

In `src/game/elements.ts`, change:

```ts
  storm: { name: "Storm", color: 0x7df9ff, verb: "charge" },
```

to:

```ts
  storm: { name: "Storm", color: 0xb44bff, verb: "charge" },
```

Every consumer (icons, aura shader, ball trails, peg shader lerp at `scene.ts:720`) reads `ELEMENTS[el].color`, so violet propagates with this one line. The sim never reads colors, so replays are unaffected.

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: all green — no test pins element hexes (verified 2026-09-22).

- [ ] **Step 3: Commit**

```bash
git add src/game/elements.ts
git commit -m "feat: storm element recoloured to electric violet"
```

---

### Task 3: FxSystem burst2 and burstPrism

**Files:**
- Modify: `src/render/fx.ts:129-153` (the `burst` method)
- Test: `tests/fx.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/fx.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FxSystem } from "../src/render/fx.js";

/** FxSystem only touches the scene graph, so it runs headless under Node. */
describe("fx bursts", () => {
  it("burst2 and burstPrism spawn the requested particle counts", () => {
    const fx = new FxSystem(new THREE.Scene());
    fx.burst2(0, 0, 0xffffff, 0xff9ec7, 20);
    expect(fx.activeParticles).toBe(20);
    fx.burstPrism(0, 0, 15);
    expect(fx.activeParticles).toBe(35);
    fx.clear();
    expect(fx.activeParticles).toBe(0);
  });

  it("burst still works (delegates to burst2)", () => {
    const fx = new FxSystem(new THREE.Scene());
    fx.burst(0, 0, 0xff6a00, 8);
    expect(fx.activeParticles).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fx.test.ts`
Expected: FAIL — `fx.burst2 is not a function`.

- [ ] **Step 3: Implement**

In `src/render/fx.ts`:

a) Next to the existing `tmpColor` field (line ~70), add:

```ts
  private readonly tmpColor2 = new THREE.Color();
```

b) Replace the whole `burst` method (lines 129–153) with:

```ts
  /** Radial burst of `count` sparks. `spread` < 1 biases upward. */
  burst(x: number, y: number, color: THREE.Color | number, count: number, speed = 3, size = 0.16, life = 0.5, gravity = -9): void {
    this.burst2(x, y, color, color, count, speed, size, life, gravity);
  }

  /** Radial burst whose particles each blend between two colours. */
  burst2(x: number, y: number, colorA: THREE.Color | number, colorB: THREE.Color | number, count: number, speed = 3, size = 0.16, life = 0.5, gravity = -9): void {
    const ca = this.tmpColor.set(colorA);
    const cb = this.tmpColor2.set(colorB);
    for (let n = 0; n < count; n++) {
      const i = this.free.pop();
      if (i === undefined) return;
      const mix = Math.random();
      const tint = 0.75 + Math.random() * 0.5;
      this.spawnAt(
        i, x, y, speed, size, life, gravity,
        (ca.r + (cb.r - ca.r) * mix) * tint,
        (ca.g + (cb.g - ca.g) * mix) * tint,
        (ca.b + (cb.b - ca.b) * mix) * tint,
      );
    }
  }

  /** Prismatic burst: every particle gets its own hue around the wheel. */
  burstPrism(x: number, y: number, count: number, speed = 3, size = 0.16, life = 0.5, gravity = -9): void {
    for (let n = 0; n < count; n++) {
      const i = this.free.pop();
      if (i === undefined) return;
      const c = this.tmpColor.setHSL(Math.random(), 1, 0.65);
      this.spawnAt(i, x, y, speed, size, life, gravity, c.r, c.g, c.b);
    }
  }

  /** Shared particle kinematics: one slot, one radial spark. */
  private spawnAt(i: number, x: number, y: number, speed: number, size: number, life: number, gravity: number, r: number, g: number, b: number): void {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.35 + Math.random() * 0.85);
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = 0.15 + Math.random() * 0.2;
    this.vel[i * 3] = Math.cos(a) * s;
    this.vel[i * 3 + 1] = Math.sin(a) * s + speed * 0.25;
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * s * 0.4;
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
    this.size[i] = size * (0.6 + Math.random() * 0.8);
    this.life[i] = 1;
    this.decay[i] = 1 / (life * (0.6 + Math.random() * 0.8));
    this.gravity[i] = gravity;
    this.alive.push(i);
  }
```

Note the old `burst` applied its tint jitter to a single color; `burst2(x, y, c, c, …)` reproduces that exactly (the `mix` term cancels when both colors are equal). `Math.random` is fine here — this is `src/render/`, outside the no-`Math.random` zone.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/fx.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/render/fx.ts tests/fx.test.ts
git commit -m "feat: two-tone and prismatic particle bursts"
```

---

### Task 4: Rewire the element FX dispatch to the palette

**Files:**
- Modify: `src/main.ts` — the `case "zap":` block (~line 376) and the `case "element":` block (~lines 517–577)

- [ ] **Step 1: Add the import**

At the top of `src/main.ts`, next to the existing `ELEMENTS` import, add:

```ts
import { COMBO_TIER_FLASH, comboTier, REACTION_FX } from "./render/palette.js";
```

(`COMBO_TIER_FLASH`/`comboTier` are used in Task 5 — importing them now keeps this a single import change; if the linter flags them as unused between commits, add them in Task 5 instead.)

- [ ] **Step 2: Recolor the lightning arcs**

Replace (at ~line 376):

```ts
      case "zap":
        view.fx.zap(e.from, e.to, NEON_CYAN);
        view.fx.burst(e.to.x, e.to.y, NEON_CYAN, 12, 3.5, 0.12, 0.4);
        break;
```

with:

```ts
      case "zap": {
        const zp = REACTION_FX.zap!;
        view.fx.zap(e.from, e.to, zp.primary);
        view.fx.zap(e.from, e.to, zp.secondary, 0.18, false); // white-hot core
        view.fx.burst2(e.to.x, e.to.y, zp.primary, zp.secondary, 12, 3.5, 0.12, 0.4);
        break;
      }
```

(If `NEON_CYAN` in `main.ts` has no other use afterwards, delete its declaration at line 29 — check with `grep -n NEON_CYAN src/main.ts`.)

- [ ] **Step 3: Rewrite the element case**

Replace the whole `case "element": { ... }` block (~lines 517–577) with:

```ts
      case "element": {
        const c = ELEMENTS[e.el].color;
        const p = REACTION_FX[e.kind];
        switch (e.kind) {
          case "ignite":
            view.fx.burst2(e.x, e.y, p!.primary, p!.secondary, 14, 2.5, 0.16, 0.5, -2);
            break;
          case "freeze":
            view.fx.ring(e.x, e.y, c, 0.5, 0.3);
            view.fx.burst2(e.x, e.y, p!.secondary, p!.primary, 6, 1.5, 0.1, 0.4, 0);
            break;
          case "charge":
            view.fx.burst2(e.x, e.y, p!.primary, p!.secondary, 10, 4, 0.1, 0.25, 0);
            break;
          case "thicken":
            view.fx.ring(e.x, e.y, p!.primary, 0.4 + e.count * 0.15, 0.3);
            view.fx.burst2(e.x, e.y, p!.secondary, p!.primary, 8 + e.count * 3, 1.5, 0.1, 0.4, 0);
            break;
          case "flare":
            view.shock(e.x, e.y, 0.35);
            view.fx.burst2(e.x, e.y, p!.primary, p!.secondary, 20 + e.count * 8, 4.5, 0.2, 0.6, -3);
            view.fx.ring(e.x, e.y, p!.accent!, 1.0, 0.35);
            view.kickBloom(0.5);
            ui.flash(p!.flash!, 0.12);
            break;
          case "burn":
            view.fx.burst2(e.x, e.y, p!.primary, p!.secondary, 8 + e.count * 6, 3, 0.18, 0.55, -3);
            break;
          case "shatter":
            view.fx.burst2(e.x, e.y, p!.primary, p!.secondary, 30 + e.count * 10, 5, 0.14, 0.6, -6);
            view.fx.ring(e.x, e.y, p!.accent!, 0.9, 0.35);
            break;
          case "steam":
            view.shock(e.x, e.y, 0.6);
            view.fx.burst2(e.x, e.y, p!.primary, p!.secondary, 70, 3.5, 0.28, 1.0, 2.5); // rises
            view.fx.ring(e.x, e.y, p!.accent!, 1.2, 0.4);
            view.fx.ring(e.x, e.y, p!.primary, 1.8, 0.5);
            view.kickBloom(0.8);
            ui.flash(p!.flash!, 0.14);
            break;
          case "zap":
            view.fx.burst2(e.x, e.y, p!.primary, p!.secondary, 16, 5, 0.1, 0.3, 0);
            view.kickBloom(0.3);
            break;
          case "wildfire":
            view.shock(e.x, e.y, 0.8);
            view.fx.burst2(e.x, e.y, p!.primary, p!.secondary, 40 + e.count * 12, 6, 0.22, 0.8, -4);
            view.fx.ring(e.x, e.y, p!.accent!, 2.2, 0.5);
            view.kickBloom(1.0);
            ui.flash(p!.flash!, 0.3);
            break;
          case "shatter_chain":
            view.shock(e.x, e.y, Math.min(1, 0.4 + e.count * 0.1));
            view.fx.burstPrism(e.x, e.y, 40 + e.count * 14, 7, 0.16, 0.8, -6);
            view.fx.ring(e.x, e.y, p!.accent!, 1.4 + e.count * 0.3, 0.55);
            view.kickBloom(0.6 + e.count * 0.1);
            view.addShake(0.3 + e.count * 0.05);
            ui.flash(p!.flash!, 0.2 + e.count * 0.03);
            break;
          default:
            break;
        }
        break;
      }
```

Shapes, counts and speeds are identical to the old block — only colors moved to the palette (plus the new gold flash on flare and the prismatic shatter chain).

- [ ] **Step 4: Run the suite**

Run: `npm test && npm run typecheck`
Expected: all green. `tests/wiring.test.ts` asserts each `case "<kind>"` string still exists in `main.ts` — the rewrite keeps every one.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: reaction FX read the signature palette; violet arcs with white cores"
```

---

### Task 5: Combo heat hue journey

**Files:**
- Modify: `src/game/ui.ts:454` (tier computation)
- Modify: `src/main.ts:584` (milestone flash)
- Modify: `index.html:107-109` (tier CSS) and `index.html:254` (mobile sizes)

- [ ] **Step 1: Tier logic reads the palette**

In `src/game/ui.ts`, add the import at the top:

```ts
import { comboTier } from "../render/palette.js";
```

(`palette.ts` is pure data — no Three.js, no DOM — so this import keeps `ui.ts` Node-safe for tests.)

Then in `setCombo` (line 454), replace:

```ts
    const tier = count >= 40 ? 3 : count >= 20 ? 2 : count >= 10 ? 1 : 0;
```

with:

```ts
    const tier = comboTier(count);
```

- [ ] **Step 2: Milestone flash follows the tier**

In `src/main.ts` (~line 584), replace:

```ts
          ui.flash(e.count >= 30 ? "#ff2d95" : "#ffd34d", 0.3);
```

with:

```ts
          ui.flash(COMBO_TIER_FLASH[comboTier(e.count)], 0.3);
```

(Imports were added in Task 4 Step 1.)

- [ ] **Step 3: CSS hue journey + new t4**

In `index.html`, replace lines 107–109:

```css
      #combo.t1 .n { color: var(--cyan); text-shadow: 0 0 22px rgba(45,226,255,.9); }
      #combo.t2 .n { color: var(--gold); text-shadow: 0 0 26px rgba(255,211,77,.95); font-size: 76px; }
      #combo.t3 .n { color: var(--magenta); text-shadow: 0 0 32px rgba(255,45,149,1), 0 0 60px rgba(255,45,149,.6); font-size: 92px; }
```

with:

```css
      #combo.t1 .n { color: var(--gold); text-shadow: 0 0 22px rgba(255,211,77,.9); }
      #combo.t2 .n { color: #ff8c1a; text-shadow: 0 0 26px rgba(255,140,26,.95); font-size: 76px; }
      #combo.t3 .n { color: var(--magenta); text-shadow: 0 0 32px rgba(255,45,149,1), 0 0 60px rgba(255,45,149,.6); font-size: 92px; }
      #combo.t4 .n { color: #b44bff; text-shadow: 0 0 36px rgba(180,75,255,1), 0 0 70px rgba(180,75,255,.65); font-size: 104px; }
```

And in the mobile media query (line 254), replace:

```css
        #combo .n { font-size: 44px; } #combo.t2 .n { font-size: 52px; } #combo.t3 .n { font-size: 60px; }
```

with:

```css
        #combo .n { font-size: 44px; } #combo.t2 .n { font-size: 52px; } #combo.t3 .n { font-size: 60px; } #combo.t4 .n { font-size: 68px; }
```

- [ ] **Step 4: Run the suite**

Run: `npm test && npm run typecheck`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/game/ui.ts src/main.ts index.html
git commit -m "feat: combo counter hue journey with violet t4 at 80+"
```

---

### Task 6: Visual verification and wrap-up

**Files:** none (verification only)

- [ ] **Step 1: Build + full suite**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green, build succeeds.

- [ ] **Step 2: Headless screenshots**

Start the dev server (`npm run dev`), then capture busy moments. On macOS use headless Chrome (the README's Edge/WSL recipe is for the Windows machine):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --window-size=1400,900 --virtual-time-budget=14000 \
  --screenshot=/tmp/pachinkube-after.png \
  "http://localhost:5173/?seed=palette&auto=1&mute=1&pre=430&charms=static_field,ember_core,frost_bite"
```

Check the charm ids in `src/game/charms.ts` first (`grep -n "id:" src/game/charms.ts | head -40`) and pick a trio that forces storm + fire + ice on the board so zaps, steam and shatter chains all fire. Read the PNG and confirm: violet arcs with white cores, pink-tinged steam, no cyan storm anywhere.

- [ ] **Step 3: Confirm no sim drift**

Run: `npx vitest run tests/determinism.test.ts tests/replay.test.ts`
Expected: PASS — proves the pass stayed presentation-only.

- [ ] **Step 4: Note the real-GPU follow-up**

Append to README "Known follow-ups" if not already covered: the new palette (ring sizes, prism lightness 0.65, flash strengths) was tuned from headless screenshots and deserves a pass on a real GPU. Commit as `docs: note palette GPU-tuning follow-up`.

---

## Self-review (done at planning time)

- **Spec coverage:** triad recolor → Task 2; palette module → Task 1; burst2/burstPrism → Task 3; all 11 reaction treatments → Task 4; double-zap white core → Task 4 Step 2; combo hue journey + t4 + milestone flash → Task 5; testing/screenshots → Task 6. No gaps.
- **Placeholders:** none — every code step shows the code.
- **Type consistency:** `REACTION_FX` keys use `ElementFxKind` from `elements.ts`; `burst2`/`burstPrism`/`spawnAt` signatures match between Task 3 and Task 4 call sites; `comboTier`/`COMBO_TIER_FLASH` match between Tasks 1, 4 and 5.
