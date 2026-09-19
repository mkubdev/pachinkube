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
const seed = params.get("seed") ?? `run-${Date.now().toString(36)}`;

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
if (devCharms.length) {
  run.charms.push(...devCharms);
  (run as unknown as { startRound(): void }).startRound();
}

const music = new Music();
music.onChange = () => ui.setMusic(music.playing, music.volume);
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
ui.onPick = (i) => {
  run.pick(i);
  ui.toasts(recordRunEnd(meta, run).filter((n) => n.kind !== "discover")); // charm discoveries → collection
  metaStore.save(meta);
  view.resetPegs();
  ui.updatePocketMults(run.pocketMultipliers());
  ui.updateCharms(run);
};
ui.onNewRun = () => {
  const url = new URL(location.href);
  url.searchParams.set("seed", `run-${Date.now().toString(36)}`);
  location.href = url.toString();
};
ui.onSubmit = async (name) => {
  const res = await fetch("/api/scores", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // The input log lets the server replay the run and verify the score.
    body: JSON.stringify({ name, score: run.totalScore, seed, ticks: run.sim.tick, log: run.log, pool: run.pool }),
  });
  const data = (await res.json()) as { improved?: boolean; verified?: boolean; error?: string };
  if (!res.ok) return `error: ${data.error}`;
  const v = data.verified ? "verified · " : "";
  return v + (data.improved ? "new personal best!" : "submitted (not your best)");
};

const stepper = new FixedStepper(run.sim.config.dt);
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
  if (e.code === "Space") { e.preventDefault(); drop(); }
  if (e.code === "KeyA") auto = !auto;
  if (e.code === "KeyC") ui.toggleCollection(meta);
  if (e.code === "KeyL") void ui.toggleBoard();
  if (e.code === "KeyM") music.toggle();
});
ui.onCollection = () => ui.toggleCollection(meta);
void getSession()
  .then((user) => ui.setAccount(user ? { name: user.name ?? "player", signOut: signOutUrl } : { signIn: signInUrl }))
  .catch(() => ui.setAccount(null));
ui.onBoard = () => void ui.toggleBoard();
ui.onMusic = () => music.toggle();
ui.onVolume = (v) => music.setVolume(v);
ui.setMusic(false, music.volume);

/** One fixed simulation step plus the presentation reactions to its events. */
function simStep(): void {
  if (auto && run.phase === "drop" && run.sim.tick % 24 === 0 && run.ballsLeft > 0) {
    // Deterministic sweep for the dev auto-drop: no Math.random in inputs.
    run.drop(Math.sin(run.sim.tick / 37) * 2.2);
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
        } else if (e.kind === "overflow") {
          view.fx.ring(e.x, e.y, NEON_MAGENTA, 4.5, 0.8);
          view.kickBloom(1.2);
          ui.flash("#ff2d95", 0.4);
        } else if (e.kind === "metal") {
          view.fx.burst(e.x, e.y, 0x9aa4b0, 40, 4, 0.18, 0.6);
          view.fx.ring(e.x, e.y, 0x9aa4b0, 1.6, 0.4);
        } else if (e.kind === "bomb") {
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
        ui.flash("#ffd34d", 0.5);
        view.kickBloom(1.5);
        view.fx.ring(0, run.sim.config.height * 0.5, GOLD, 5, 0.9);
        ui.notice("MACHINE CLEARED — keep going");
        break;
      case "pegElement":
        view.setPegElement(e.peg, e.el);
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
          case "burn":
            view.fx.burst(e.x, e.y, c, 8 + e.count * 6, 3, 0.18, 0.55, -3);
            break;
          case "shatter":
            view.fx.burst(e.x, e.y, 0xdff6ff, 30 + e.count * 10, 5, 0.14, 0.6, -6);
            view.fx.ring(e.x, e.y, c, 0.9, 0.35);
            break;
          case "steam":
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
            view.fx.burst(e.x, e.y, 0xff6a00, 40 + e.count * 12, 6, 0.22, 0.8, -4);
            view.fx.ring(e.x, e.y, 0xff6a00, 2.2, 0.5);
            view.kickBloom(1.0);
            ui.flash("#ff6a00", 0.3);
            break;
          case "shatter_chain":
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
}

let last = performance.now();
let frame = 0;
function loop(now: number): void {
  const dtSec = Math.min((now - last) / 1000, 0.1);
  last = now;

  const alpha = stepper.advance(dtSec, simStep);

  view.setAim(run.phase === "drop" ? aimX : null);
  view.render(prev, curr, alpha, dtSec);
  ui.tickPopups(now);
  if (++frame % 6 === 0) ui.updateHud(run, seed, auto);
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
requestAnimationFrame(loop);
