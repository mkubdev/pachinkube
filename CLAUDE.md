# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

PACHINKUBE — a pachinko-inspired roguelite (Three.js + Rapier2D), hosted on Vercel with a replay-verified leaderboard. The README is detailed and current; read it for game rules, balance history, and deploy details. Specs and implementation plans live in `docs/superpowers/{specs,plans}`.

## Commands

```bash
npm run dev          # rebuilds asset manifest (python3), then Vite at :5173 — also serves api/ via tools/vite-api.ts, no Vercel CLI needed
npm test             # vitest run (all tests in tests/)
npx vitest run tests/run.test.ts        # single test file
npx vitest run -t "name"                # single test by name
npm run typecheck    # tsc --noEmit
npm run build        # production bundle to dist/
BALANCE=1 npx vitest run tests/balance.probe.test.ts   # 40 seeded runs, pass rates → .cache/balance.txt
```

Node 22 (`.nvmrc`). `assets:manifest` needs `python3`. Deploy is automatic on push to `main` (Vercel project `pachinkube`); manual: `npx vercel@latest deploy --prod`.

## The one architectural rule

**`src/sim/` and `src/game/` never import Three.js or touch the DOM** — they run headless in Node. This is what makes determinism tests, server-side replay verification (`api/scores.ts` replays `seed + input log` via `src/game/replay.ts` and rejects mismatches), and the balance probe possible. Supporting rules:

- **No `Math.random`** in `sim/` or `game/` — use the four named seeded streams (`layout`, `drop`, `shop`, `fx` in `src/sim/rng.ts`) so e.g. a shop roll can never change a bounce.
- Fixed 120 Hz timestep (`src/sim/loop.ts`); the renderer interpolates. Time-feel effects (slow motion) are render-pacing only so replays stay exact.
- **Bump `RULES_VERSION` in `src/game/version.ts` on any change that affects scoring or physics** — otherwise mid-run deploys make valid runs fail verification (they are stored unverified, keyed on that version).

## Layers

- `src/sim/` — deterministic physics: `world.ts` (board, pockets, balls, stuck-ball recovery) emits `SimEvent[]`.
- `src/game/` — roguelite layer, also pure TS: `run.ts` (rounds/bag/shop) emits `GameEvent[]`; `charms.ts` (56 charms) and `balls.ts` (25 ball types) are data-driven; `scoring.ts` (chips × mult × pocket, round targets); `meta.ts` (profile, feats, unlocks); `ui.ts` is the DOM overlay (game layer, but browser-only — the exception).
- `src/render/` — Three.js presentation only, driven by `GameEvent`s; `fx.ts` is pooled/pre-allocated particles.
- `src/main.ts` — wiring. **Wiring here is only covered by `tests/wiring.test.ts`** (unit tests all passed while the browser was silently broken once); keep it updated when adding call sites.
- `api/` — Vercel functions (Web `Request`/`Response` signature, runs both under Vercel and the Vite dev bridge). Upstash Redis with a per-instance memory fallback.

## Gotchas (already paid for — see README for the full list)

- Vercel functions are ESM and don't rewrite extensionless imports: **every relative import reachable from `api/` must end in `.js`** or it 500s in production only.
- Rapier forces are persistent (`addForce` accumulates); `applyPulls` resets every ball's forces per step. Don't add a new pull without going through it.
- `InstancedMesh` with `count = 0` at first draw gets an empty bounding sphere forever — set `frustumCulled = false` on dynamic instanced meshes.
- Vite's `defineConfig` must come from `vitest/config` for the `test` key to typecheck.
- Scripted `str.replace` edits on `main.ts` have silently no-op'd before; verify anchors matched.
- Dev URL params: `?seed=…`, `?auto=1`, `?pre=N` (pre-roll ticks), `?charms=a,b`, `?mute=1`, `?collection=1`.
- The replay test `reproduces a live run's score from its log` is intentionally skipped (hangs since pool/endless changes).
