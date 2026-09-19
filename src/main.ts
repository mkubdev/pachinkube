import { Run } from "./game/run.js";
import { FixedStepper } from "./sim/loop.js";
import type { Snapshot } from "./sim/types.js";
import { BoardRenderer } from "./render/scene.js";
import { GameUI } from "./game/ui.js";
import { GameAudio } from "./game/audio.js";
import { Music } from "./game/music.js";
import type { CharmId } from "./game/charms.js";
import { BALL_TYPES, type BallTypeId } from "./game/balls.js";
import { ELEMENTS } from "./game/elements.js";
import { SyncedMetaStore } from "./game/metaSync.js";
import { RULES_VERSION } from "./game/version.js";
import { getSession, signInUrl, signOutUrl } from "./game/auth.js";
import {
  LocalMetaStore,
  newTracker,
  recordDrop,
  recordEvents,
  recordOffers,
  recordRunEnd,
  recordRunStart,
  unlockedPool,
} from "./game/meta.js";

const NEON_MAGENTA = 0xff2d95;
const NEON_CYAN = 0x2de2ff;
const GOLD = 0xffd34d;
const ballColor = (tag: string): number => BALL_TYPES[tag as BallTypeId]?.color ?? 0xfff1a8;

const params = new URLSearchParams(location.search);
let seed = params.get("seed") ?? `run-${Date.now().toString(36)}`;

const canvas = document.getElementById("game") as HTMLCanvasElement;

// Progression lives in localStorage for now; the store interface is what a
// per-Discord-user server store will implement later.
const metaStore = new SyncedMetaStore(new LocalMetaStore(typeof localStorage === "undefined" ? null : localStorage));
metaStore.load();
// Signed-in players get their server profile merged in before the run starts,
// so the shop pool reflects everything they have unlocked on any device.
const meta = await metaStore.pull();
const pool = unlockedPool(meta);
const tracker = newTracker();
recordRunStart(meta);
metaStore.save(meta);

let run = await Run.create(seed, { pool });
let runEnded = false;
// ?charms=firestorm,frost_bite — dev aid to start a run holding charms.
const devCharms = (params.get("charms") ?? "").split(",").filter(Boolean) as CharmId[];
// Dev aids change the run without going through the input log, so such a run
// can never verify: submit it without a log rather than fail at the end.
let tainted = devCharms.length > 0 || Number(params.get("pre") ?? 0) > 0;
// ?bag=rainbow,abyss,heavy — dev aid: the bag holds only these types.
const devBag = (params.get("bag") ?? "").split(",").filter((b): b is BallTypeId => b in BALL_TYPES);
// ?end=1 — dev aid: the first step ends round 1 unpassed, straight to the end screen.
const devEnd = params.get("end") === "1";
tainted ||= devBag.length > 0 || devEnd;
if (devEnd) run.ballsLeft = 0;
if (devCharms.length || devBag.length) {
  run.charms.push(...devCharms);
  if (devBag.length) run.ownedBalls.splice(0, run.ownedBalls.length, ...devBag, ...devBag, ...devBag);
  (run as unknown as { startRound(): void }).startRound();
}

const music = new Music();
music.onChange = () => ui.setMusic(music.playing, music.volume, music.station);
const dims = { width: run.sim.config.width, height: run.sim.config.height, buckets: run.sim.config.buckets };
const view = new BoardRenderer(canvas, dims);
view.setPegs(run.sim.pegs);
void view.loadCabinet("assets/models/cabinet.glb");
void view.loadEnvironment("assets/env/neon_photostudio_1k.hdr");

const audio = new GameAudio();
audio.enabled = params.get("mute") !== "1";

view.elementOf = (id) => run.ballElements.get(id) ?? null;
const ui = new GameUI((x, y) => view.project(x, y));
ui.setPockets(run.sim.bucketCenters, run.pocketMultipliers());
view.setPocketMults(run.pocketMultipliers(), run.lotteryPocketIndex);
ui.onPick = (i) => {
  run.pick(i);
  ui.toasts(recordRunEnd(meta, run).filter((n) => n.kind !== "discover")); // charm discoveries → collection
  metaStore.save(meta);
  view.resetPegs();
  ui.updatePocketMults(run.pocketMultipliers());
  ui.updateCharms(run);
};
ui.onNewRun = () => void newRun(`run-${Date.now().toString(36)}`);

// If the server's rules moved under this tab, the next run can only verify
// after a refresh: say so once, when the board is fetched.
void fetch("/api/scores")
  .then((r) => r.json())
  .then((d: { rules?: number }) => {
    if (d.rules !== undefined && d.rules !== RULES_VERSION) ui.notice("GAME UPDATED — refresh for verified scores");
  })
  .catch(() => {});

/** Start a fresh run in place: no page reload, no re-fetching assets. */
async function newRun(nextSeed: string): Promise<void> {
  const old = run;
  seed = nextSeed;
  const url = new URL(location.href);
  url.searchParams.set("seed", seed);
  url.searchParams.delete("pre");
  url.searchParams.delete("charms");
  history.replaceState(null, "", url);

  const freshPool = unlockedPool(meta);
  run = await Run.create(seed, { pool: freshPool });
  old.dispose();
  runEnded = false;
  tainted = false; // a fresh in-place run has no dev modifications
  bestBefore = meta.stats.bestScore;
  auto = false;
  Object.assign(tracker, newTracker());
  recordRunStart(meta);
  metaStore.save(meta);

  view.resetForNewRun();
  view.setPegs(run.sim.pegs);
  view.resetPegs();
  ui.resetRun();
  ui.setPockets(run.sim.bucketCenters, run.pocketMultipliers());
  view.setPocketMults(run.pocketMultipliers(), run.lotteryPocketIndex);
  ui.updateCharms(run);
  prev = curr = run.sim.snapshot();
  stepper.reset();
  ui.notice("NEW RUN");
}
/** Submit the finished run; shared by the manual form and auto-submit. */
async function submitRun(name: string): Promise<string> {
  const res = await fetch("/api/scores", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // The input log lets the server replay the run and verify the score. A
    // tainted (dev-modified) run sends no log and is stored unverified.
    body: JSON.stringify({
      name, score: run.totalScore, seed, ticks: run.sim.tick, rules: RULES_VERSION,
      ...(tainted ? {} : { log: run.log, pool: run.pool }),
    }),
  });
  const data = (await res.json()) as { improved?: boolean; verified?: boolean; reason?: string; error?: string };
  if (!res.ok) return `error: ${data.error}`;
  const v = data.verified ? "verified · " : data.reason === "rules_version" ? "unverified (game updated mid-run) · " : tainted ? "unverified (dev run) · " : "unverified · ";
  return v + (data.improved ? "new personal best!" : "submitted (not your best)");
}
ui.onSubmit = submitRun;

/** Best score saved before this run started; auto-submit only beats it. */
let bestBefore = meta.stats.bestScore;

const stepper = new FixedStepper(run.sim.config.dt);
// Presentation-only time dilation (slow-mo combo event): scales wall time
// before it reaches the fixed stepper, so the simulation itself is untouched.
let timeScale = 1;
let slowmoUntil = 0;
let prev: Snapshot = run.sim.snapshot();
let curr: Snapshot = prev;
let aimX: number | null = 0;
// ?auto=1 starts the deterministic auto-drop: dev/screenshot aid, not a feature.
let auto = params.get("auto") === "1";

function drop(): void {
  audio.unlock();
  if (aimX === null) return;
  if (run.drop(aimX)) recordDrop(meta);
}

addEventListener("pointermove", (e) => {
  aimX = view.boardXAt(e.clientX, e.clientY);
  view.setAim(run.phase === "drop" ? aimX : null);
});
canvas.addEventListener("pointerdown", drop);
addEventListener("keydown", (e) => {
  // On the end screen, space/enter start the next run; the input field keeps its keys.
  const again = document.querySelector<HTMLButtonElement>("#modal:not([hidden]) #again");
  if (again && (e.code === "Space" || e.code === "Enter") && !(e.target instanceof HTMLInputElement)) {
    e.preventDefault();
    again.click();
    return;
  }
  if (e.code === "Space") { e.preventDefault(); drop(); }
  if (e.code === "KeyA") auto = !auto;
  if (e.code === "KeyC") ui.toggleCollection(meta);
  if (e.code === "KeyL") void ui.toggleBoard();
  if (e.code === "KeyM") music.toggle();
});
ui.onCollection = () => ui.toggleCollection(meta);
ui.onResetMeta = () => metaStore.resetMine();
// The server wiped progression while this tab was open: the profile object
// was reset in place; tell the player and refresh what is on screen.
metaStore.onReset = () => ui.notice("PROGRESSION RESET — fresh start");
void getSession()
  .then((user) => {
    ui.accountName = user?.name ?? null;
    ui.setAccount(user ? { name: user.name ?? "player", signOut: signOutUrl } : { signIn: signInUrl });
    ui.showSignInCallout();
  })
  .catch(() => {
    ui.authAvailable = false; // no Discord configured on the server
    ui.setAccount(null);
  });
ui.onBoard = () => void ui.toggleBoard();
ui.onMusic = () => music.toggle();
ui.onVolume = (v) => music.setVolume(v);
ui.onStation = (id) => music.setStation(id as "lofi" | "dnb");
ui.setMusic(false, music.volume, music.station);

/** One fixed simulation step plus the presentation reactions to its events. */
function simStep(): void {
  if (auto && run.phase === "drop" && run.sim.tick % 24 === 0 && run.ballsLeft > 0) {
    // Deterministic sweep for the dev auto-drop: no Math.random in inputs.
    if (run.drop(Math.sin(run.sim.tick / 37) * 2.2)) recordDrop(meta);
  }
  prev = curr;
  const events = run.step();
  curr = run.sim.snapshot();
  for (const e of events) {
    switch (e.type) {
      case "pegLit":
        view.setPegLit(e.peg, true);
        break;
      case "pegHit": {
        view.pulsePeg(e.peg);
        const c = ballColor(e.tag);
        view.fx.burst(e.x, e.y, c, e.fresh ? 10 : 4, 2.2 + Math.min(e.speed, 8) * 0.25, 0.14, 0.45);
        if (e.fresh) view.fx.ring(e.x, e.y, c, 0.45, 0.3);
        break;
      }
      case "zap":
        view.fx.zap(e.from, e.to, NEON_CYAN);
        view.fx.burst(e.to.x, e.to.y, NEON_CYAN, 12, 3.5, 0.12, 0.4);
        break;
      case "fx":
        if (e.kind === "split") {
          view.fx.burst(e.x, e.y, GOLD, 60, 5, 0.2, 0.7);
          view.fx.ring(e.x, e.y, GOLD, 1.4, 0.5);
          view.kickBloom(0.6);
          ui.flash("#ffd34d", 0.25);
        } else if (e.kind === "revive") {
          view.fx.burst(e.x, e.y, 0xff8f2d, 80, 6, 0.22, 0.9, -3);
          view.fx.ring(e.x, e.y, 0xff8f2d, 2.2, 0.6);
          view.kickBloom(0.8);
        } else if (e.kind === "boomerang") {
          view.fx.burst(e.x, e.y, 0xffc46b, 50, 5, 0.18, 0.8, 6); // rises with the ball
          view.fx.ring(e.x, e.y, 0xffc46b, 1.6, 0.5);
          view.kickBloom(0.5);
          ui.notice("BOOMERANG — coming back");
        } else if (e.kind === "collapse") {
          view.shock(e.x, e.y, 0.5 + e.strength * 0.5);
          view.fx.burst(e.x, e.y, 0x7a3cff, 90, 7, 0.2, 0.9, 4);
          view.fx.ring(e.x, e.y, 0x7a3cff, 3.5, 0.8);
          view.kickBloom(1.2);
          view.addShake(0.6);
          ui.flash("#3a1a6a", 0.45);
        } else if (e.kind === "overflow") {
          view.fx.ring(e.x, e.y, NEON_MAGENTA, 4.5, 0.8);
          view.kickBloom(1.2);
          ui.flash("#ff2d95", 0.4);
        } else if (e.kind === "metal") {
          view.fx.burst(e.x, e.y, 0x9aa4b0, 40, 4, 0.18, 0.6);
          view.fx.ring(e.x, e.y, 0x9aa4b0, 1.6, 0.4);
        } else if (e.kind === "bomb") {
          view.shock(e.x, e.y, 1);
          view.fx.burst(e.x, e.y, 0xff6a00, 120, 7, 0.24, 0.8, -4);
          view.fx.ring(e.x, e.y, 0xff6a00, 1.5, 0.35);
          view.fx.ring(e.x, e.y, 0xffd34d, 2.4, 0.55);
          view.kickBloom(1.0);
          view.addShake(0.5);
          ui.flash("#ff6a00", 0.35);
        } else if (e.kind === "bullseye") {
          view.fx.ring(e.x, e.y, NEON_CYAN, 1.0, 0.3);
          view.fx.ring(e.x, e.y, NEON_CYAN, 1.8, 0.45);
          view.fx.burst(e.x, e.y, NEON_CYAN, 40, 4, 0.16, 0.5);
        } else if (e.kind === "prism") {
          view.fx.burst(e.x, e.y, 0xf5b0ff, 8, 2.5, 0.12, 0.35, -2);
        } else if (e.kind === "finale") {
          view.fx.ring(e.x, e.y, GOLD, 2.6, 0.6);
          view.fx.burst(e.x, e.y, GOLD, 70, 5, 0.2, 0.8);
          view.kickBloom(0.8);
          ui.flash("#ffd34d", 0.3);
        }
        break;
      case "retry":
        ui.flash("#2de2ff", 0.45);
        view.kickBloom(1.0);
        view.resetPegs();
        ui.notice(`INSURANCE — round ${e.round} again (${e.left} left)`);
        break;
      case "cleared":
        view.shock(0, run.sim.config.height * 0.5, 1);
        ui.flash("#ffd34d", 0.5);
        view.kickBloom(1.5);
        view.fx.ring(0, run.sim.config.height * 0.5, GOLD, 5, 0.9);
        ui.notice("MACHINE CLEARED — keep going");
        break;
      case "pegElement":
        view.setPegElement(e.peg, e.el);
        break;
      case "comboEvent": {
        ui.banner(e.label);
        view.kickBloom(1.2);
        switch (e.kind) {
          case "laser":
            view.laserSweep(e.y);
            view.shock(0, e.y, 0.6);
            ui.flash("#ff2d95", 0.3);
            break;
          case "portal":
            view.fx.ring(0, 0.6, 0xb46cff, 3.2, 0.7);
            ui.flash("#b46cff", 0.25);
            break;
          case "quake":
            view.addShake(1);
            view.setTint(0xff6a00, 0.5);
            break;
          case "rain":
            view.fx.burst(0, run.sim.config.height + 0.4, 0xffffff, 60, 4, 0.16, 0.7, -8);
            break;
          case "gravity_flip":
            view.setTint(0x2de2ff, 0.8);
            view.shock(0, run.sim.config.height * 0.5, 1);
            ui.flash("#2de2ff", 0.35);
            break;
          case "magnet_storm":
            view.setTint(0xb46cff, 0.7);
            break;
          case "slowmo":
            timeScale = 0.3;
            slowmoUntil = performance.now() + 1500;
            view.setHeat(1);
            ui.flash("#ffffff", 0.2);
            break;
          default:
            break;
        }
        break;
      }
      case "comboEventEnd":
        view.setTint(null);
        break;
      case "portal":
        view.portal(e.from, e.to);
        view.shock(e.from.x, e.from.y, 0.5);
        break;
      case "blink":
        view.portal(e.from, e.to);
        view.fx.burst(e.from.x, e.from.y, 0xd6a8ff, 30, 4, 0.12, 0.4, 0);
        view.shock(e.to.x, e.to.y, 0.35);
        ui.flash("#d6a8ff", 0.12);
        break;
      case "pockets":
        ui.updatePocketMults(e.mults, e.lottery);
        view.setPocketMults(e.mults, e.lottery);
        break;
      case "charmExpired":
        ui.notice(`${e.id.replace(/_/g, " ").toUpperCase()} faded`);
        ui.updateCharms(run);
        break;
      case "element": {
        const c = ELEMENTS[e.el].color;
        switch (e.kind) {
          case "ignite":
            view.fx.burst(e.x, e.y, c, 14, 2.5, 0.16, 0.5, -2);
            break;
          case "freeze":
            view.fx.ring(e.x, e.y, c, 0.5, 0.3);
            view.fx.burst(e.x, e.y, 0xffffff, 6, 1.5, 0.1, 0.4, 0);
            break;
          case "charge":
            view.fx.burst(e.x, e.y, c, 10, 4, 0.1, 0.25, 0);
            break;
          case "thicken":
            view.fx.ring(e.x, e.y, 0x9fe8ff, 0.4 + e.count * 0.15, 0.3);
            view.fx.burst(e.x, e.y, 0xffffff, 8 + e.count * 3, 1.5, 0.1, 0.4, 0);
            break;
          case "flare":
            view.shock(e.x, e.y, 0.35);
            view.fx.burst(e.x, e.y, 0xffd34d, 20 + e.count * 8, 4.5, 0.2, 0.6, -3);
            view.fx.ring(e.x, e.y, 0xff6a00, 1.0, 0.35);
            view.kickBloom(0.5);
            break;
          case "burn":
            view.fx.burst(e.x, e.y, c, 8 + e.count * 6, 3, 0.18, 0.55, -3);
            break;
          case "shatter":
            view.fx.burst(e.x, e.y, 0xdff6ff, 30 + e.count * 10, 5, 0.14, 0.6, -6);
            view.fx.ring(e.x, e.y, c, 0.9, 0.35);
            break;
          case "steam":
            view.shock(e.x, e.y, 0.6);
            view.fx.burst(e.x, e.y, 0xffffff, 70, 3.5, 0.28, 1.0, 2.5); // rises
            view.fx.ring(e.x, e.y, 0xff6a00, 1.2, 0.4);
            view.fx.ring(e.x, e.y, 0x9fe8ff, 1.8, 0.5);
            view.kickBloom(0.8);
            ui.flash("#dff6ff", 0.14);
            break;
          case "zap":
            view.fx.burst(e.x, e.y, c, 16, 5, 0.1, 0.3, 0);
            view.kickBloom(0.3);
            break;
          case "wildfire":
            view.shock(e.x, e.y, 0.8);
            view.fx.burst(e.x, e.y, 0xff6a00, 40 + e.count * 12, 6, 0.22, 0.8, -4);
            view.fx.ring(e.x, e.y, 0xff6a00, 2.2, 0.5);
            view.kickBloom(1.0);
            ui.flash("#ff6a00", 0.3);
            break;
          case "shatter_chain":
            view.shock(e.x, e.y, Math.min(1, 0.4 + e.count * 0.1));
            view.fx.burst(e.x, e.y, 0xdff6ff, 40 + e.count * 14, 7, 0.16, 0.8, -6);
            view.fx.ring(e.x, e.y, 0x7df9ff, 1.4 + e.count * 0.3, 0.55);
            view.kickBloom(0.6 + e.count * 0.1);
            view.addShake(0.3 + e.count * 0.05);
            ui.flash("#7df9ff", 0.2 + e.count * 0.03);
            break;
          default:
            break;
        }
        break;
      }
      case "combo":
        ui.setCombo(e.count, e.milestone);
        view.setHeat(Math.min(1, e.count / 45));
        if (e.milestone) {
          view.kickBloom(0.7);
          ui.flash(e.count >= 30 ? "#ff2d95" : "#ffd34d", 0.3);
          view.fx.ring(0, run.sim.config.height * 0.55, GOLD, 2.0, 0.45);
          audio.mult();
        }
        break;
      case "comboEnd":
        ui.endCombo(e.count);
        view.setHeat(0);
        break;
      case "ballScored": {
        const cx = run.sim.bucketCenters[e.bucket] ?? 0;
        const mag = Math.min(1, Math.log10(e.score + 1) / 6);
        view.fx.burst(cx, 0.5, NEON_MAGENTA, 30 + Math.floor(mag * 90), 4 + mag * 6, 0.18 + mag * 0.12, 0.6 + mag * 0.5);
        view.fx.ring(cx, 0.5, NEON_MAGENTA, 0.9 + mag * 2.6, 0.4 + mag * 0.3);
        view.kickBloom(0.4 + mag * 1.2);
        if (mag > 0.45) ui.flash("#ff2d95", 0.15 + mag * 0.35);
        ui.scorePopup(cx, 1.2, e.score);
        break;
      }
      case "shake":
        view.addShake(e.strength);
        audio.score(e.strength);
        break;
      case "popup":
        if (e.kind === "chips" && e.hits !== undefined) audio.peg(e.hits, e.fresh ?? false);
        else if (e.kind === "mult") {
          audio.mult();
          view.fx.burst(e.x, e.y, GOLD, 18, 3, 0.16, 0.5);
        }
        break;
      default:
        break;
    }
  }
  ui.handle(events, run);

  // Progression: fold this step's events into the profile.
  if (events.length) {
    ui.toasts(recordEvents(meta, events, run, tracker));
    for (const e of events) {
      if (e.type === "phase" && e.phase === "shop") ui.toasts(recordOffers(meta, run.offers));
      if (e.type === "phase" && (e.phase === "won" || e.phase === "lost") && !runEnded) {
        runEnded = true;
        // Signed in and above the saved best: the run posts itself.
        if (ui.accountName && run.totalScore > bestBefore && run.totalScore > 0) {
          bestBefore = run.totalScore;
          setTimeout(() => void submitRun(ui.accountName!).then((msg) => ui.setAutoSubmit(`auto-saved · ${msg}`)).catch(() => ui.setAutoSubmit("could not save — try again from a new run", false)), 50);
        } else if (ui.accountName) {
          setTimeout(() => ui.setAutoSubmit(`not your best (${bestBefore.toLocaleString("en-US")}) — nothing to save`, false), 50);
        }
        ui.toasts(recordRunEnd(meta, run));
        ui.showRunDiscoveries(meta, run);
      }
    }
    metaStore.save(meta);
  }
}

let last = performance.now();
let frame = 0;
function loop(now: number): void {
  const dtSec = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (slowmoUntil && now > slowmoUntil) {
    slowmoUntil = 0;
    timeScale = 1;
    view.setHeat(Math.min(1, run.combo / 45));
  }
  const alpha = stepper.advance(dtSec * timeScale, simStep);

  view.setAim(run.phase === "drop" ? aimX : null);
  view.render(prev, curr, alpha, dtSec);
  ui.tickPopups(now);
  // First frame too: on a slow GPU the sixth frame can be a second away.
  if (++frame === 1 || frame % 6 === 0) ui.updateHud(run, seed, auto);
  requestAnimationFrame(loop);
}
ui.updateCharms(run);

// ?pre=N&auto=1 steps the sim N ticks before the first frame: a deterministic
// way to land a screenshot mid-run (software GL is too slow to get there live).
const pre = Number(params.get("pre") ?? 0);
if (pre > 0) {
  for (let i = 0; i < pre; i++) simStep();
  curr = run.sim.snapshot();
  prev = curr;
}
if (params.get("collection") === "1") ui.toggleCollection(meta);
// ?debugmeta=1 prints the profile after the pre-roll (headless verification aid).
if (params.get("debugmeta") === "1") {
  console.log("META", JSON.stringify({ stats: meta.stats, feats: Object.keys(meta.feats), announced: meta.announced.length, signedIn: metaStore.signedIn }));
}
requestAnimationFrame(loop);
