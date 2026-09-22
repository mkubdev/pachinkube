# Phoenix Nerf, Split Shot Rarity & Fever UI Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Phoenix a 10-round temporary charm, bump Split Shot to rare, and replace fever's pinned full-screen bloom with a big tier-colored multiplier readout in the HUD.

**Architecture:** Tasks 1 is game-layer (deterministic, replay-affecting → RULES_VERSION bump to 17; note the spec says 16 but the gravity-flip change already took 16). Tasks 2–3 are presentation-only (main.ts wiring + ui.ts/index.html DOM) and do not affect replays. The generic charm-duration machinery in `run.ts` (expiry, rounds-left chips, re-pick-extends) already exists — Phoenix only needs `duration: 10`.

**Tech Stack:** TypeScript, vitest, Vite. Sim/game layers are headless (no DOM/Three.js imports). DOM code (`ui.ts`, `index.html`) is not covered by vitest — verify in the browser.

Spec: `docs/superpowers/specs/2026-09-22-phoenix-fever-ui-design.md`

---

### Task 1: Phoenix duration, Split Shot rarity, RULES_VERSION 17

**Files:**
- Modify: `src/game/charms.ts` (phoenix def ~line 400, split_shot def ~line 292)
- Modify: `src/game/version.ts`
- Modify: `docs/superpowers/specs/2026-09-22-phoenix-fever-ui-design.md` (versioning section: 16 → 17)
- Test: `tests/run.test.ts`

The expiry/extension machinery is already covered by `tests/elements.test.ts` ("temporary charms imbue balls and expire after their duration"), so the new test asserts the data that drives it.

- [ ] **Step 1: Write the failing test**

In `tests/run.test.ts`, after the test `"Split Shot + Phoenix + Boomerang terminates (shards can't split, so multiball is bounded)"` (ends ~line 161), add:

```ts
  it("Phoenix is a 10-round temporary charm and Split Shot is rare", () => {
    // Balance pass 2026-09-22: permanent Phoenix was oppressive, Split Shot too frequent.
    expect(CHARMS.phoenix.duration).toBe(10);
    expect(CHARMS.phoenix.desc).toContain("next 10 rounds");
    expect(CHARMS.split_shot.rarity).toBe("rare");
  });

  it("Phoenix expires after its 10-round window", async () => {
    const run = await Run.create("phx-window", { rounds: 30 });
    runs.push(run);
    // Simulate taking Phoenix from the shop (pick() sets charmExpires from duration).
    run.charms.push("phoenix");
    (run as unknown as { charmExpires: Map<number, number> }).charmExpires.set(0, run.round + CHARMS.phoenix.duration!);
    // Advance past the window; expireCharms runs at round start.
    (run as unknown as { round: number }).round += 11;
    (run as unknown as { startRound(): void }).startRound();
    const events = run.step();
    expect(run.charms).not.toContain("phoenix");
    expect(events.some((e) => e.type === "charmExpired" && e.id === "phoenix")).toBe(true);
  });
```

`CHARMS` and `Run` are already imported in this file, and `runs` is the file's dispose-tracking array (see the existing tests for the pattern). If `Run.create("phx-window", { rounds: 30 })` doesn't match the options type used elsewhere in this file, copy the options shape from the `"no-infinite"` test at ~line 152.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/run.test.ts -t "Phoenix is a 10-round"`
Expected: FAIL — `expected undefined to be 10`.

- [ ] **Step 3: Implement**

In `src/game/charms.ts`, change the phoenix definition (currently `desc: "A ball lost in an edge pocket is relaunched once (50%)."` at ~line 403) to:

```ts
  phoenix: {
    id: "phoenix",
    name: "Phoenix",
    desc: "For the next 10 rounds, a ball lost in an edge pocket is relaunched once (50%).",
    rarity: "rare",
    duration: 10,
    onBallLost(ctx, bucket) {
```

(the `onBallLost` body is unchanged).

In the split_shot definition (~line 296), change:

```ts
    rarity: "uncommon",
```

to:

```ts
    rarity: "rare",
```

In `src/game/version.ts`, change line 9 to:

```ts
export const RULES_VERSION = 17; // 17: Phoenix lasts 10 rounds; Split Shot uncommon → rare
```

In `docs/superpowers/specs/2026-09-22-phoenix-fever-ui-design.md`, update the Versioning section's first line to say `16 → 17` (the gravity-flip change already consumed 16):

```markdown
Bump `RULES_VERSION` 16 → 17 in `src/game/version.ts`: Phoenix duration and
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/run.test.ts`
Expected: all PASS (including the bounded-multiball test — Phoenix mechanics are unchanged inside its window).

- [ ] **Step 5: Run the full suite (shop rolls and determinism touch these tables)**

Run: `npm test`
Expected: all PASS. If a test asserts a specific shop offer sequence and now fails, the rarity change shifted a weighted pick — update that test's expected offer, not the rarity.

- [ ] **Step 6: Commit**

```bash
git add src/game/charms.ts src/game/version.ts tests/run.test.ts docs/superpowers/specs/2026-09-22-phoenix-fever-ui-design.md
git commit -m "feat: phoenix lasts 10 rounds, split shot is rare (RULES_VERSION 17)"
```

---

### Task 2: Un-pin the fever heat in main.ts

**Files:**
- Modify: `src/main.ts` (lines ~199, ~600, ~610, ~612–622, ~657–660, ~688)
- Test: `tests/wiring.test.ts` (existing — no new assertions expected)

`feverHot` survives, but only to detect the ignition edge for the one-shot flash/bloom kick. Heat always tracks the raw combo count. Presentation-only: no replay impact, no version bump.

Scripted `str.replace` edits on `main.ts` have silently no-op'd before (see CLAUDE.md) — make each edit with an exact-match Edit and verify the anchor matched.

- [ ] **Step 1: Update the `combo` case (~line 600)**

Change:

```ts
        view.setHeat(feverHot ? 1 : Math.min(1, e.count / 45));
```

to:

```ts
        view.setHeat(Math.min(1, e.count / 45));
```

- [ ] **Step 2: Update the `comboEnd` case (~line 610)**

Change:

```ts
        view.setHeat(feverHot ? 1 : 0);
```

to:

```ts
        view.setHeat(0);
```

- [ ] **Step 3: Update the `fever` case (~lines 612–622)**

Change:

```ts
      case "fever": {
        const wasHot = feverHot;
        feverHot = e.value > 1;
        if (feverHot && !wasHot) {
          view.kickBloom(1.2);
          ui.flash("#ffb02d", 0.35);
        }
        ui.setFever(e.value);
        view.setHeat(feverHot ? 1 : Math.min(1, run.combo / 45));
        break;
      }
```

to:

```ts
      case "fever": {
        // Heat stays combo-driven (the sustained full-screen bloom read as
        // bloat); fever keeps only the one-shot ignition flash + the readout.
        const wasHot = feverHot;
        feverHot = e.value > 1;
        if (feverHot && !wasHot) {
          view.kickBloom(1.2);
          ui.flash("#ffb02d", 0.35);
        }
        ui.setFever(e.value);
        break;
      }
```

- [ ] **Step 4: Update the declaration comment (~line 199)**

Change:

```ts
let feverHot = false; // fever > 1: heat pinned to max regardless of combo count
```

to:

```ts
let feverHot = false; // fever > 1: detects the ignition edge for the one-shot flash
```

- [ ] **Step 5: Update the shop-phase reset comment (~lines 657–660)**

Change:

```ts
        // Belt-and-braces: the shop step()s early, so a stale hot flag would
        // otherwise pin heat at max for the whole next round (see Fix 1).
        feverHot = false;
        view.setHeat(0);
```

to:

```ts
        // Re-arm the ignition flash for the next round.
        feverHot = false;
        view.setHeat(0);
```

- [ ] **Step 6: Update the slow-mo restore (~line 688)**

Change:

```ts
    view.setHeat(feverHot ? 1 : Math.min(1, run.combo / 45));
```

to:

```ts
    view.setHeat(Math.min(1, run.combo / 45));
```

- [ ] **Step 7: Verify no pinning remains**

Run: `grep -n "feverHot ? 1" src/main.ts`
Expected: no output.

- [ ] **Step 8: Typecheck and wiring test**

Run: `npm run typecheck && npx vitest run tests/wiring.test.ts`
Expected: both PASS (the `fever` case still exists, so the wiring test's handled-events list is satisfied).

- [ ] **Step 9: Commit**

```bash
git add src/main.ts
git commit -m "fix: fever no longer pins the heat/bloom — ignition flash only"
```

---

### Task 3: Big tier-colored fever readout

**Files:**
- Modify: `src/game/ui.ts` (`setFever`, ~line 459)
- Modify: `index.html` (`#combo .f` CSS, line 108; keyframes after line 118)

DOM code — not covered by vitest; verified in the browser in Task 4.

- [ ] **Step 1: Rewrite `setFever` in `src/game/ui.ts`**

Change (~lines 459–463):

```ts
  /** Fever readout under the combo count; hidden while cold (×1). */
  setFever(value: number): void {
    this.comboF.hidden = value <= 1;
    this.comboF.textContent = `FEVER ×${value.toFixed(1)}`;
  }
```

to:

```ts
  /** Fever readout under the combo count; hidden while cold (×1). */
  setFever(value: number): void {
    this.comboF.hidden = value <= 1;
    if (value <= 1) return;
    // Tier colours: white-hot → orange → magenta → cyan as the fever climbs.
    const tier = value < 2 ? 1 : value < 5 ? 2 : value < 20 ? 3 : 4;
    this.comboF.className = `f f${tier}`;
    this.comboF.textContent = `×${value < 10 ? value.toFixed(1) : formatScore(Math.round(value))} FEVER`;
    // Re-trigger the pulse; fever events are already throttled to 0.1 steps.
    this.comboF.style.animation = "none";
    void this.comboF.offsetWidth;
    this.comboF.style.animation = "";
  }
```

`formatScore` is already imported in `ui.ts` (line 9). `formatScore` renders 137 as `137` and 1_200_000 as `1.20M`, which covers the spec's whole-numbers-from-×10 and suffixes-beyond rules.

- [ ] **Step 2: Replace the `.f` CSS in `index.html`**

Change line 108:

```css
      #combo .f { font-size: 0.42em; color: #ffb02d; letter-spacing: 0.12em; text-shadow: 0 0 12px #ff6a00; }
```

to:

```css
      #combo .f { font-family: var(--display); font-size: 36px; font-weight: 900; line-height: 1.1; letter-spacing: 0.08em; margin-top: 6px; animation: feverPulse .3s ease-out both; }
      #combo .f1 { color: #fff6e0; text-shadow: 0 0 18px rgba(255,246,224,.9); }
      #combo .f2 { color: #ffb02d; text-shadow: 0 0 22px rgba(255,140,26,.95); }
      #combo .f3 { color: var(--magenta); text-shadow: 0 0 26px rgba(255,45,149,1), 0 0 50px rgba(255,45,149,.6); }
      #combo .f4 { color: #7ef0ff; text-shadow: 0 0 30px rgba(126,240,255,1), 0 0 60px rgba(126,240,255,.65); }
```

Then add the pulse keyframes directly after the `comboOut` keyframes (line 118):

```css
      @keyframes feverPulse { 0% { transform: scale(1.25); filter: brightness(2); } 100% { transform: scale(1); filter: brightness(1); } }
```

Note: `setFever` sets `className = "f fN"`, which keeps the `querySelector(".f")` lookup in the UI constructor and the base `.f` rule working.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/game/ui.ts index.html
git commit -m "feat: big tier-colored fever readout under the combo count"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 2: Browser smoke test**

Run: `npm run dev`, then open:

- `http://localhost:5173/?seed=fever-ui&charms=fever_pitch,heat_sink,thermal_mass&auto=1` — build a combo past ignition and confirm: (a) the board no longer sits at max bloom while fever is hot (bloom follows the combo count), (b) the ignition flash still fires once when fever first exceeds ×1, (c) the fever readout is large, pulses on change, and shifts white → orange → magenta → cyan as the value climbs, (d) values ≥ ×10 show whole numbers.
- `http://localhost:5173/?seed=phx&charms=phoenix` — confirm the Phoenix charm chip shows rounds-left and disappears after its window (or fast-check via the charm HUD after a few rounds).

- [ ] **Step 3: Report**

Report the results (including any visual issues) to the user before any push. The FEVER feature on local main is still unpushed — pushing deploys to production, so leave pushing to the user's call.
