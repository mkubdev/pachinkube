# PACHINKUBE

A pachinko-inspired roguelite. Aim and drop steel balls through a neon machine,
stack charms and ball types, and chase absurd chain-reaction scores. Eight
rounds, ~20–30 minutes. Hosted on Vercel for a friend group, with a shared,
**replay-verified** leaderboard.

**Status: first playable.** Full loop — aim → drop → score → shop → next round →
endless → submit — with 36 charms (incl. 4 temporary), 11 ball types, three
elements with reactions, combos, meta-progression, effects, audio, lofi radio,
a Blender cabinet, and server-side score verification. Balance is probe-tuned.

## How it plays

- **Aim** with the mouse, **drop** with click or space. Six balls a round (more with charms).
- Every peg hit earns **chips** (fresh peg: 10, already-lit peg: 3). A ball carries a **mult**.
- The **pocket** it lands in multiplies the lot: `×1 ×2 ×3 ×5 ×3 ×2 ×1`, centre is the jackpot.
- Ball score = `chips × mult × pocket`. Beat the round target or the run ends.
- Clear a round → pick **one of three** offers (charm, or two balls of a new type).

**Balls** (`src/game/balls.ts`) — physics and traits are data:

| Ball | Quirk |
|---|---|
| Steel | baseline |
| Rubber | light, very bouncy, many hits at ×0.8 chips |
| Heavy | dense, few hits at ×3 chips |
| Spark | 25% chance of +1 mult per hit |
| Gold | ×2 chips, +1 mult on landing |
| Feather | 45% gravity, drifts through the whole field |
| Cannon | fired downward; chips scale with impact speed |
| Magnet | pulled toward the centre pocket |
| Twin | two small balls from one bag slot |
| Prism | each fresh peg also lights its nearest neighbour |
| Bomb | 12th hit lights every peg within 1.3 |

**Charms** (`src/game/charms.ts`) are trigger→effect data. Active: Magnet Coil,
Neon Sign, Split Shot, Jackpot Lens, Rubber Soul, Heavy Metal, Chain Lightning,
Bumper Kings, Overflow, Extra Ball, Phoenix, Golden Pocket. Passive (plain
fields the run reads): Loaded Dice, Wide Net, Warm Start, Momentum, Grand
Finale, Fresh Paint, Echo, Long Fuse, Milestone Maker, Insurance, Duplicator,
Compound, Sharpshooter, Low Gravity. Elemental: Ember Core, Frost Bite, Static
Field, Conductor, Melting Point, Tinder, Elemental Surge, plus the four
temporary actives above.

**Elements** (`src/game/elements.ts`). Pegs can be *burning*, *frozen* or
*charged*; balls can be imbued (Firestorm, Deep Freeze, Thunderhead, Solstice —
temporary charms that last N rounds and then fade). Ball element × peg state
resolves through one table: fire ignites and burning pegs pay ×1.5 and spread;
ice freezes and frozen pegs are glassy and shatter for chips; storm charges and
charged pegs arc lightning. Cross-reactions are the payoff — **fire on ice =
steam** (chips + mult), **storm on ice = shatter chain** through every touching
frozen peg, **storm on fire = wildfire**. Pegs render through a custom instanced
shader (rolling flame noise, faceted ice glints, electric crackle).

**Combos.** Peg hits closer than 0.6 s apart — across every ball in flight —
chain into one combo. Every 10th hit is a milestone: **+1 mult to all balls in
play**, so multiball is worth engineering. The counter climbs through colour
tiers (10 / 20 / 40) and the whole screen heats up with it.

**Progression** (`src/game/meta.ts`). A profile persists across runs: lifetime
stats, discoveries (first time you see a charm/ball), 17 feats, and 20 unlock
rules that gate rarer content behind stats. The shop rolls only from your
unlocked pool. Signed in with Discord, the profile also lives on the server keyed
by your Discord id and merges across devices (`api/meta.ts`, `SyncedMetaStore`).

Keys: **C** collection · **L** global scoreboard · **M** lofi girl radio
(YouTube, loads only when toggled) · **A** auto-drop. Dev aids: `?seed=…`,
`?auto=1`, `?pre=N` (pre-roll N ticks), `?charms=a,b` (start holding charms),
`?mute=1`, `?collection=1`.

## Visual effects

All presentation-only, driven by `GameEvent`s, pooled and pre-allocated
(`src/render/fx.ts`): 6,000 additive particles in one `Points` draw, 48
shockwave rings in one `InstancedMesh`, 32 lightning arcs.

| Trigger | Effect |
|---|---|
| peg hit | spark burst in the ball's colour, peg flashes white-hot and decays, thin ring on a fresh peg |
| fast ball | particle trail |
| mult gain | gold burst + chime |
| combo | centre counter pops; bloom, chromatic aberration and vignette ramp with combo "heat" |
| combo milestone | screen flash, bloom kick, big gold ring |
| Chain Lightning | jittered arc peg→peg + cyan burst |
| Split Shot / Phoenix / Overflow / Heavy Metal | bespoke burst + ring + flash |
| pocket landing | magenta shockwave and burst scaled by log₁₀(score), popup size follows, camera shake |

## Stack

| Layer | Choice | Why |
|---|---|---|
| Simulation | [Rapier2D](https://rapier.rs) (WASM) | pachinko is 2D physics; Rapier is fast and **deterministic** |
| Rendering | Three.js + `postprocessing` | neon = emissive + bloom; instanced pegs/balls |
| Audio | WebAudio oscillators | no assets; voice-limited so chaos stays musical |
| Build | Vite 7, TypeScript, Vitest | Node **22** (`.nvmrc`) |
| Hosting | Vercel (static + `/api` functions) | |
| Leaderboard | Upstash Redis sorted set | `ZADD GT` = keep each player's best |
| Auth | Auth.js core + Discord | friends already live on Discord |
| Assets | Blender 5.2 via MCP, Poly Haven (CC0) | cabinet + HDRI, see below |

### The one architectural rule

**`src/sim/` and `src/game/` never import Three.js or touch the DOM.** They run
in Node. That single constraint pays for:

- **Determinism tests** — same seed + same inputs ⇒ identical state hash and
  identical final score (`tests/determinism.test.ts`, `tests/run.test.ts`).
- **Replay verification** — the client submits `seed + input log`; `api/scores`
  replays it headless (`src/game/replay.ts`) and rejects scores that do not
  reproduce (HTTP 422). Verified runs get a ✓ on the board.
- **Balance probe** — `BALANCE=1 npx vitest run tests/balance.probe.test.ts`
  plays 40 seeded runs with a dumb policy and writes per-round pass rates to
  `.cache/balance.txt`. Targets in `scoring.ts` (`900 × 1.62^(r−1)`) were set
  from it: currently 95/95/97/77/48/46/50/67 % pass by round, 2 wins in 40.

Supporting rules: **fixed 120 Hz timestep** (`sim/loop.ts`, renderer
interpolates), and **no `Math.random`** in `sim/` or `game/` — four named
seeded streams (`layout`, `drop`, `shop`, `fx`) so the shop can never change a bounce.

## Develop

```bash
nvm use
cp .env.example .env      # optional: Upstash / Discord
npm install
npm run dev               # http://localhost:5173
```

| Command | |
|---|---|
| `npm test` | 49 tests: RNG, sim, run, balls, passives, elements, meta, replay, scores/meta API |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | production bundle to `dist/` |

`npm run dev` serves the Vercel functions in `api/` through `tools/vite-api.ts`,
so no Vercel CLI is needed. Handlers use the Web `Request`/`Response` signature
Vercel's Node runtime accepts, so the same files run in both places.

### Visual verification without a browser at hand

Windows Edge can screenshot the WSL dev server headlessly (WSL forwards localhost):

```bash
"/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=1400,900 --virtual-time-budget=14000 --screenshot='C:\Users\mkubd\shot.png' "http://localhost:5173/?seed=x&auto=1&mute=1"
```

Budgets above ~15 s tend to time out under SwiftShader, and the sim only
advances ~8 ticks per (slow) frame, so use `&pre=430` to pre-roll into a busy
moment; with heavy particle load keep the window ≤ 1100×720.

## Layout

```
src/sim/         deterministic physics — pure TS + Rapier, runs in Node
  rng.ts           seeded streams        loop.ts   fixed-timestep accumulator
  world.ts         board, pockets, balls, stuck-ball recovery → SimEvent[]
src/game/        roguelite layer — also pure TS, runs in Node
  run.ts           rounds, bag, shop, scoring dispatch → GameEvent[]
  charms.ts        12 charms as data     balls.ts  4 ball types
  scoring.ts       chips × mult × pocket, round targets
  replay.ts        headless replay for verification
  ui.ts            DOM overlay (HUD, popups, shop, end screen, leaderboard)
  audio.ts         procedural sound
src/render/      Three.js presentation only
api/scores.ts    leaderboard + replay verification (Upstash; memory fallback)
api/auth/        Discord sign-in via Auth.js core
tools/           asset pipeline, balance probe, dev API bridge
public/assets/   cabinet.glb, barrel_01.glb, env/neon_photostudio_1k.hdr, manifest.json
```

## Deploy

**Live: https://pachinkube.vercel.app** — Vercel project `pachinkube` in the
personal scope `mkubdevs-projects`, connected to `github.com/mkubdev/pachinkube`
so every push to `main` deploys. Manual deploy: `npx vercel@latest deploy --prod`.

Until Upstash is configured the leaderboard runs on per-instance memory (scores
vanish on cold start) and `/api/auth/*` returns 503. Environment variables:

```
UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   (Vercel Marketplace → Upstash)
AUTH_DISCORD_ID / AUTH_DISCORD_SECRET               (discord.com/developers → OAuth2)
AUTH_SECRET                                          (openssl rand -base64 32)
AUTH_URL                                             (https://<project>.vercel.app)
```

Discord redirect URI: `https://<project>.vercel.app/api/auth/callback/discord`
(plus the `http://localhost:5173/...` one for dev). Without Upstash the board is
per-instance memory; without Discord vars `/api/auth/*` returns 503 with a message.

### Turning on accounts (one-time, ~10 minutes)

1. **Upstash**: Vercel dashboard → Storage → Marketplace → Upstash Redis → create
   → it injects `UPSTASH_REDIS_REST_URL/TOKEN` into the project.
2. **Discord**: discord.com/developers → New Application → OAuth2 → add both
   redirect URIs above → copy Client ID / Client Secret.
3. In Vercel → Settings → Environment Variables add `AUTH_DISCORD_ID`,
   `AUTH_DISCORD_SECRET`, `AUTH_SECRET` (`openssl rand -base64 32`),
   `AUTH_URL=https://pachinkube.vercel.app`. Redeploy.

After that the dock shows **sign in**; signed-in players' collections sync via
`/api/meta` and their leaderboard entries can be keyed by Discord id.

## Asset pipeline

Blender 5.2 runs on Windows, this repo in WSL; Blender reaches it over
`\\wsl.localhost\Ubuntu\...`, and the MCP server runs Windows-side because WSL2
NAT cannot reach the add-on's `localhost:9876`.

- **Cabinet**: `tools/blender_cabinet.py`, procedural, 1,744 tris, 21 KB GLB.
  Authored in board coordinates and converted with `B()`/`S()` because glTF is
  Y-up (Blender Y → glTF −Z). Materials named `*neon*` and `*body*` are
  re-tuned in `scene.ts` on load.
- **Environment**: `python3 tools/fetch_polyhaven.py --type hdri neon_photostudio --res 1k`
  → `RGBELoader` → PMREM. Room environment is used until it arrives.
- **Props**: `tools/fetch_polyhaven.py <id>` + `tools/blender_lowpoly.py`
  (decimate → flat shade → GLB with Draco + WebP). Poly Haven models are
  archviz-density; expect the decimate stage to do real work.

## Known follow-ups

- **Bundle**: ~980 KB gzipped, mostly `rapier2d-compat` inlining WASM as
  base64. Switch to `@dimforge/rapier2d` + `vite-plugin-wasm`.
- **HDRI weight**: 1.6 MB `.hdr`; downsample or pre-filter to KTX2.
- **Leaderboard identity**: key on `discordId` once auth is configured.
- **Balance**: only probed with a dumb policy; targets will need a pass once
  real players report. Tune in `scoring.ts` and re-run the probe.
- **Rate limiting** on `POST /api/scores` (replay costs CPU).
- **Cabinet body** still reads light under the studio HDRI; darken or re-export.
- **Leaderboard identity**: `api/scores` still keys on the typed name; switch to
  the session's `discordId` once auth is on.
- **Replay test** `reproduces a live run's score from its log` is skipped: it
  hangs synchronously since the pool/endless changes. The tamper-rejection and
  stall tests still cover the verifier.
- **Effects tuning** was done from headless SwiftShader screenshots; ring sizes,
  aberration and flash strengths deserve a pass on a real GPU at 60 fps.

## Gotchas already paid for

- `InstancedMesh` computes its bounding sphere on first draw; with `count = 0`
  it is empty forever → **set `frustumCulled = false`** on dynamic instanced meshes.
- glTF is Y-up: author Blender geometry with Z as "up" or convert, or the
  export lies flat.
- Stuck balls hold a round open forever; the sim nudges after 0.5 s of
  stillness and force-pockets after three nudges.
- Compare Blender RNA nodes by `.name`, never `is`.
- Poly Haven's API 403s on urllib's default User-Agent.
- `pkill -f` matches its own shell command line; use `pgrep -f "[v]ite ..."`.
- Vite's `defineConfig` must come from `vitest/config` for the `test` key to typecheck.
- **Vercel functions are ESM and do not rewrite extensionless imports**: every
  relative import in the server chain must carry `.js` (TS maps it to `.ts`),
  or the function dies with `ERR_MODULE_NOT_FOUND` in production only.
- zsh does not word-split `$VAR` with spaces: `V="npx vercel"; $V x` fails.
- **Scripted `str.replace` edits fail silently** when the anchor drifts (here: a
  re-indent). Four rounds of `main.ts` wiring no-op'd unnoticed. Assert the anchor
  exists, or grep for the result.
- rAF timestamps can trail `performance.now()`; a negative popup age flipped
  `scale()` negative and drew text rotated 180°. Clamp ages at 0.
