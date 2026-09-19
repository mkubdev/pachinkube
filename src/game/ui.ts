/**
 * DOM overlay: HUD, score popups, pocket labels, shop, end screen.
 * Roguelite menus are far easier in HTML than in-canvas, and it stays crisp
 * at any resolution.
 */
import { CHARMS, CHARM_IDS } from "./charms.js";
import { BALL_IDS, BALL_TYPES } from "./balls.js";
import { formatMult, formatScore } from "./format.js";
import type { GameEvent, Offer, Run } from "./run.js";
import { FEATS, UNLOCK_RULES, isUnlocked, ruleFor, unlockProgress, type MetaNotice, type MetaState, type FeatId } from "./meta.js";
import { ballIcon, charmIcon, featIcon } from "./icons.js";
import type { CharmId } from "./charms.js";
import type { BallTypeId } from "./balls.js";

type Projector = (x: number, y: number) => { x: number; y: number };

const POPUP_POOL = 48;

export class GameUI {
  private readonly root: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly charmsEl: HTMLElement;
  private readonly modal: HTMLElement;
  private readonly comboEl: HTMLElement;
  private readonly comboN: HTMLElement;
  private readonly flashEl: HTMLElement;
  private comboHideAt = 0;
  private readonly labels: HTMLElement[] = [];
  private pocketCenters: number[] = [];
  private pocketsResizeBound = false;
  private readonly popups: HTMLElement[] = [];
  private popupIdx = 0;
  private lastHash = "--------";
  private readonly flightEl: HTMLElement;
  /** Name used on the last manual submission, to highlight the row on the board. */
  private submittedName: string | null = null;
  private live: Array<{ el: HTMLElement; x: number; y: number; born: number }> = [];
  onPick: ((index: number) => void) | null = null;
  onNewRun: (() => void) | null = null;
  onSubmit: ((name: string) => Promise<string>) | null = null;
  onCollection: (() => void) | null = null;
  onBoard: (() => void) | null = null;
  /** Signed-in Discord name; when set the end screen does not ask for a name. */
  accountName: string | null = null;
  /** False when the server has no Discord configured: hide every sign-in pitch. */
  authAvailable = true;
  signInUrl = "/api/auth/signin";
  onMusic: (() => void) | null = null;
  /** "Reset my collection" in the collection panel (confirmed by the player). */
  onResetMeta: (() => Promise<void>) | null = null;
  onStation: ((id: string) => void) | null = null;
  onVolume: ((v: number) => void) | null = null;
  private runDiscoveries: MetaNotice[] = [];

  constructor(private readonly project: Projector) {
    this.root = document.getElementById("ui")!;
    this.root.innerHTML = `
      <div id="left"><div id="hud"></div><div id="flight" hidden></div></div>
      <div id="charms"></div>
      <div id="labels"></div>
      <div id="popups"></div>
      <div id="combo" hidden><div class="n"></div><div class="l">COMBO</div></div>
      <div id="flash"></div>
      <div id="toasts"></div>
      <div id="modal" hidden></div>
      <div id="collection" hidden></div>
      <div id="board-panel" hidden></div>
      <div id="dock">
        <input id="music-vol" type="range" min="0" max="100" title="music volume" />
        <span id="stations"><button data-station="lofi" title="lofi girl radio">lofi</button><button data-station="dnb" title="drum &amp; bass radio">dnb</button></span>
        <button id="music-btn" title="music on/off (M)">♪</button>
        <button id="board-btn" title="Scoreboard (L)">◇ scores</button>
        <button id="collection-btn" title="Collection (C)">◈ collection</button>
        <span id="account"></span>
      </div>
      <div id="hint">move: aim · click / space: drop · A: auto · C: collection · L: scores · M: music</div>`;
    this.hud = this.root.querySelector("#hud")!;
    this.flightEl = this.root.querySelector("#flight")!;
    this.charmsEl = this.root.querySelector("#charms")!;
    this.modal = this.root.querySelector("#modal")!;
    this.comboEl = this.root.querySelector("#combo")!;
    this.comboN = this.comboEl.querySelector(".n")!;
    this.flashEl = this.root.querySelector("#flash")!;
    this.root.querySelector("#collection-btn")!.addEventListener("click", () => this.onCollection?.());
    this.root.querySelector("#board-btn")!.addEventListener("click", () => this.onBoard?.());
    this.root.querySelector("#music-btn")!.addEventListener("click", () => this.onMusic?.());
    this.root.querySelectorAll<HTMLButtonElement>("#stations button").forEach((b) =>
      b.addEventListener("click", () => this.onStation?.(b.dataset.station!)),
    );
    this.root.querySelector<HTMLInputElement>("#music-vol")!.addEventListener("input", (e) =>
      this.onVolume?.(Number((e.target as HTMLInputElement).value)),
    );
    const popups = this.root.querySelector("#popups")!;
    for (let i = 0; i < POPUP_POOL; i++) {
      const el = document.createElement("div");
      el.className = "popup";
      el.hidden = true;
      popups.appendChild(el);
      this.popups.push(el);
    }
  }

  setPockets(centers: number[], mults: number[]): void {
    const box = this.root.querySelector("#labels")!;
    box.innerHTML = "";
    this.labels.length = 0;
    centers.forEach((_, i) => {
      const el = document.createElement("div");
      el.className = "pocket" + (i === (centers.length - 1) / 2 ? " jackpot" : "");
      el.textContent = formatMult(mults[i] ?? 1);
      box.appendChild(el);
      this.labels.push(el);
    });
    this.pocketCenters = centers;
    this.layoutPockets(centers);
    // One listener for the lifetime of the UI; new runs just swap the centres.
    if (!this.pocketsResizeBound) {
      this.pocketsResizeBound = true;
      addEventListener("resize", () => this.layoutPockets(this.pocketCenters));
    }
  }

  updatePocketMults(mults: number[], lottery = -1): void {
    // "Jackpot" styling follows the best pocket, wherever Roulette/Inversion put it.
    const best = Math.max(...mults);
    this.labels.forEach((el, i) => {
      el.classList.toggle("jackpot", (mults[i] ?? 0) === best);
      const next = formatMult(mults[i] ?? 1);
      if (el.textContent !== next) {
        el.textContent = next;
        el.classList.remove("bump");
        void el.offsetWidth;
        el.classList.add("bump");
      }
      el.classList.toggle("lottery", i === lottery);
    });
  }

  private layoutPockets(centers: number[]): void {
    centers.forEach((cx, i) => {
      const p = this.project(cx, -0.35);
      const el = this.labels[i]!;
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    });
  }

  /** Cheap: string building only every few frames, hash only on ball loss. */
  updateHud(run: Run, seed: string, auto: boolean): void {
    const pct = Math.min(100, (run.roundScore / run.target) * 100);
    const next = run.nextBall ? BALL_TYPES[run.nextBall] : null;
    this.hud.innerHTML = `
      <div class="title">PACHINKUBE</div>
      <div class="row big"><span class="display">round ${run.round}${run.cleared ? '<small class="cleared"> ✓ cleared</small>' : ""}</span><span class="display">${formatScore(run.totalScore)}<small> total</small></span></div>
      <div class="bar"><div style="width:${pct}%"></div></div>
      <div class="row"><span>${formatScore(run.roundScore)} <small>/ ${formatScore(run.target)}</small></span><span>${run.ballsLeft}<small> balls</small> · ${run.inFlight}<small> in play</small></span></div>
      <div class="row dim"><span>next: <b style="color:#${(next?.color ?? 0xffffff).toString(16).padStart(6, "0")}">${next?.name ?? "—"}</b></span><span>${auto ? "auto " : ""}tick ${run.sim.tick}</span></div>
      <div class="row dim bag">${run
        .bagSummary()
        .map((b) => `<span style="color:#${BALL_TYPES[b.type].color.toString(16).padStart(6, "0")}">${BALL_TYPES[b.type].name}${b.count > 1 ? ` ×${b.count}` : ""}</span>`)
        .join("")}</div>
      <div class="row dim"><span>seed <code>${seed}</code></span><span>hash <code>${this.lastHash}</code></span></div>`;
    this.updateFlight(run);
  }

  /**
   * Live score of every ball in play: chips × mult, before the pocket
   * multiplier it will land in. Drop order, so a ball keeps its row.
   */
  private updateFlight(run: Run): void {
    const balls = [...run.balls.values()].sort((a, b) => a.id - b.id).slice(0, 10);
    if (!balls.length) {
      this.flightEl.hidden = true;
      return;
    }
    this.flightEl.hidden = false;
    const rows = balls.map((b) => {
      const type = BALL_TYPES[b.type];
      const el = run.ballElements.get(b.id);
      const color = `#${type.color.toString(16).padStart(6, "0")}`;
      const proj = Math.round(b.chips * b.mult);
      return `<div class="fb${el ? ` el-${el}` : ""}${b.type === "rainbow" ? " rainbow" : ""}"><i style="background:${color}"></i><span class="nm">${type.name}</span><span class="ch">${b.chips.toLocaleString("en-US")}</span><span class="op">×</span><span class="mu">${Number.isInteger(b.mult) ? b.mult : b.mult.toFixed(1)}</span><span class="eq">${formatScore(proj)}</span></div>`;
    });
    this.flightEl.innerHTML = `<div class="fh"><span>IN PLAY</span><span>chips × mult</span></div>${rows.join("")}${run.balls.size > 10 ? `<div class="fb more">+${run.balls.size - 10} more</div>` : ""}`;
  }

  /** Close overlays and clear per-run presentation state. */
  resetRun(): void {
    this.modal.hidden = true;
    this.root.querySelector<HTMLElement>("#collection")!.hidden = true;
    this.root.querySelector<HTMLElement>("#board-panel")!.hidden = true;
    this.comboEl.hidden = true;
    this.comboHideAt = 0;
    for (const el of this.popups) el.hidden = true;
    this.live = [];
    this.runDiscoveries = [];
    this.lastHash = "--------";
    this.charmsEl.innerHTML = "";
  }

  /** Centre banner for run-level moments (insurance, etc.). */
  notice(text: string): void {
    this.popup(0, 6.5, text, "info", 1.6);
  }

  /** Huge Orbitron banner for combo events. */
  banner(text: string): void {
    const el = document.createElement("div");
    el.className = "banner";
    el.textContent = text;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  // --- progression -------------------------------------------------------------

  /** Bottom-right toast stack for discoveries, unlocks and feats. */
  toasts(notices: MetaNotice[]): void {
    if (!notices.length) return;
    const box = this.root.querySelector("#toasts")!;
    for (const n of notices) {
      this.runDiscoveries.push(n);
      const el = document.createElement("div");
      el.className = `toast ${n.kind}`;
      const head = n.kind === "unlock" ? "UNLOCKED" : n.kind === "feat" ? "DISCOVERY" : "NEW";
      const detail = n.kind === "feat" ? (FEATS[n.id]?.desc ?? "") : n.kind === "unlock" ? "now appears in the shop" : "added to your collection";
      const icon = n.kind === "feat" ? featIcon(n.id, true) : n.what === "charm" ? charmIcon(n.id as CharmId) : ballIcon(n.id as BallTypeId);
      el.innerHTML = `<div class="ic">${icon}</div><div><span class="head">${head}</span><b>${escapeHtml(n.label)}</b><small>${escapeHtml(detail)}</small></div>`;
      box.appendChild(el);
      setTimeout(() => el.classList.add("out"), 3600);
      setTimeout(() => el.remove(), 4300);
    }
    while (box.children.length > 5) box.firstElementChild?.remove();
  }

  toggleCollection(meta: MetaState): void {
    const el = this.root.querySelector<HTMLElement>("#collection")!;
    if (!el.hidden) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const s = meta.stats;
    const card = (kind: "charm" | "ball", id: string) => {
      const name = kind === "charm" ? CHARMS[id as keyof typeof CHARMS].name : BALL_TYPES[id as keyof typeof BALL_TYPES].name;
      const desc = kind === "charm" ? CHARMS[id as keyof typeof CHARMS].desc : BALL_TYPES[id as keyof typeof BALL_TYPES].desc;
      const rarity = kind === "charm" ? CHARMS[id as keyof typeof CHARMS].rarity : "ball";
      const color = kind === "ball" ? `#${BALL_TYPES[id as keyof typeof BALL_TYPES].color.toString(16).padStart(6, "0")}` : "";
      const unlocked = isUnlocked(meta, kind, id);
      const seen = (kind === "charm" ? meta.discovered.charms : meta.discovered.balls).includes(id as never);
      const icon = kind === "charm" ? charmIcon(id as CharmId, !unlocked) : ballIcon(id as BallTypeId, !unlocked);
      if (!unlocked) {
        const rule = ruleFor(kind, id)!;
        const p = unlockProgress(meta, rule);
        return `<div class="card locked"><div class="ic">${icon}</div><span class="tag">locked</span><b>???</b><p>${escapeHtml(rule.hint)}</p><div class="prog"><div style="width:${(p.current / p.target) * 100}%"></div></div><small>${p.current.toLocaleString("en-US")} / ${p.target.toLocaleString("en-US")}</small></div>`;
      }
      const fresh = seen ? "" : ' <span class="tag new">new</span>';
      return `<div class="card ${rarity}${seen ? "" : " fresh"}"><div class="ic">${icon}</div><span class="tag ${rarity}">${rarity}</span>${fresh}<b style="${color ? `color:${color}` : ""}">${escapeHtml(name)}</b><p>${escapeHtml(desc)}</p></div>`;
    };
    const feats = Object.keys(FEATS)
      .map((id) => {
        const got = meta.feats[id];
        const f = FEATS[id]!;
        return `<div class="card feat ${got ? "" : "locked"}"><div class="ic">${featIcon(id, !!got)}</div><b>${got ? f.name : "???"}</b><p>${f.desc}</p>${got ? `<small>${new Date(got).toLocaleDateString()}</small>` : ""}</div>`;
      })
      .join("");
    const unlockedCount = UNLOCK_RULES.filter((r) => isUnlocked(meta, r.kind, r.id)).length;
    el.innerHTML = `
      <div class="panel wide">
        <div class="row"><h2>Collection</h2><span class="row" style="gap:8px"><button id="collection-reset" class="danger" title="Start your collection over (scores are kept)">reset my collection</button><button id="collection-close">close</button></span></div>
        <p class="dim">${s.runs} runs · ${s.wins} wins · best ${formatScore(s.bestScore)} · best combo ${s.bestCombo} · ${unlockedCount}/${UNLOCK_RULES.length} unlocks · ${Object.keys(meta.feats).length}/${Object.keys(FEATS).length} discoveries</p>
        <h3>Balls</h3><div class="grid">${BALL_IDS.filter((b) => b !== "steel").map((b) => card("ball", b)).join("")}</div>
        <h3>Charms</h3><div class="grid">${CHARM_IDS.map((c) => card("charm", c)).join("")}</div>
        <h3>Discoveries</h3><div class="grid">${feats}</div>
      </div>`;
    el.querySelector("#collection-close")!.addEventListener("click", () => (el.hidden = true));
    el.querySelector("#collection-reset")!.addEventListener("click", async () => {
      if (!this.onResetMeta || !confirm("Reset your whole collection and stats? Your scores on the leaderboard stay.")) return;
      await this.onResetMeta();
      el.hidden = true;
      this.toggleCollection(meta); // re-render from the (now fresh) profile
      this.notice("COLLECTION RESET");
    });
  }

  /** Dock account chip: sign-in link, or name + sign-out. Hidden when auth is off. */
  setAccount(state: { signIn: string } | { name: string; signOut: string } | null): void {
    const el = this.root.querySelector<HTMLElement>("#account")!;
    if (!state) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML =
      "signIn" in state
        ? `<a class="btn" href="${state.signIn}" title="Sign in with Discord to save your collection across devices">⌁ sign in</a>`
        : `<span class="who">${escapeHtml(state.name)}</span><a class="btn" href="${state.signOut}" title="Sign out">out</a>`;
  }

  /** Reflect music state on the dock. */
  setMusic(playing: boolean, volume: number, station: string): void {
    const dock = this.root.querySelector("#dock")!;
    const btn = this.root.querySelector("#music-btn")!;
    dock.classList.toggle("music-on", playing);
    btn.classList.toggle("on", playing);
    btn.textContent = playing ? "♪ on" : "♪ off";
    this.root.querySelectorAll<HTMLButtonElement>("#stations button").forEach((b) =>
      b.classList.toggle("on", b.dataset.station === station),
    );
    this.root.querySelector<HTMLInputElement>("#music-vol")!.value = String(volume);
  }

  /** Global scoreboard, available any time (L). */
  async toggleBoard(): Promise<void> {
    const el = this.root.querySelector<HTMLElement>("#board-panel")!;
    if (!el.hidden) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = `<div class="panel"><div class="row"><h2>Scoreboard</h2><button id="board-close">close</button></div><div id="board" class="dim">loading…</div></div>`;
    el.querySelector("#board-close")!.addEventListener("click", () => (el.hidden = true));
    await this.loadBoard(el);
  }

  /** On the end screen: what this run added to the collection. */
  showRunDiscoveries(meta: MetaState, run: Run): void {
    void meta;
    void run;
    const box = this.modal.querySelector("#run-discoveries");
    if (!box) return;
    const items = this.runDiscoveries;
    const icon = (n: MetaNotice) => (n.kind === "feat" ? featIcon(n.id, true) : n.what === "charm" ? charmIcon(n.id as CharmId) : ballIcon(n.id as BallTypeId));
    box.innerHTML = items.length
      ? `<h3>THIS RUN</h3><ul>${items.map((n) => `<li class="${n.kind}">${icon(n)}<span><span class="tag ${n.kind}">${n.kind === "feat" ? "discovery" : n.kind}</span>${escapeHtml(n.label)}</span></li>`).join("")}</ul>`
      : "";
  }

  updateCharms(run: Run): void {
    // Permanent charms collapse into counts; temporary ones show rounds left.
    const counts = new Map<string, number>();
    const temps: Array<{ id: string; left: number }> = [];
    run.charms.forEach((c, i) => {
      const left = run.charmRoundsLeft(i);
      if (left === null) counts.set(c, (counts.get(c) ?? 0) + 1);
      else temps.push({ id: c, left });
    });
    const perm = [...counts].map(([id, n]) => {
      const c = CHARMS[id as CharmId];
      const el = c.element ? ` el-${c.element}` : "";
      return `<div class="charm ${c.rarity}${el}" title="${c.desc}">${charmIcon(id as CharmId)}<span>${c.name}${n > 1 ? ` ×${n}` : ""}</span></div>`;
    });
    const temp = temps.map(({ id, left }) => {
      const c = CHARMS[id as CharmId];
      const el = c.element ? ` el-${c.element}` : "";
      return `<div class="charm temp${el}" title="${c.desc}">${charmIcon(id as CharmId)}<span>${c.name}</span><span class="left">${left} round${left === 1 ? "" : "s"}</span></div>`;
    });
    this.charmsEl.innerHTML = [...temp, ...perm].join("");
  }

  handle(events: GameEvent[], run: Run): void {
    for (const e of events) {
      if (e.type === "popup") this.popup(e.x, e.y, e.text, e.kind);
      else if (e.type === "ballScored") this.lastHash = run.sim.hash();
      else if (e.type === "phase") {
        if (e.phase === "shop") this.showShop(run.offers);
        else if (e.phase === "won" || e.phase === "lost") this.showEnd(run, e.phase);
      }
    }
  }

  private popup(x: number, y: number, text: string, kind: string, scale = 1): void {
    const el = this.popups[this.popupIdx++ % POPUP_POOL]!;
    el.className = `popup ${kind}`;
    el.textContent = text;
    el.hidden = false;
    el.style.fontSize = "";
    if (scale !== 1) el.style.fontSize = `${Math.round(13 * scale)}px`;
    this.live = this.live.filter((l) => l.el !== el);
    this.live.push({ el, x, y, born: performance.now() });
  }

  /** Big landing: popup size follows log10 of the score. */
  scorePopup(x: number, y: number, score: number): void {
    const mag = Math.max(0, Math.log10(score + 1));
    this.popup(x, y, formatScore(score), "score", 1.2 + mag * 0.45);
  }

  /** Combo counter: grows and shifts colour tier with the count. */
  setCombo(count: number, milestone: boolean): void {
    this.comboEl.hidden = false;
    this.comboN.textContent = String(count);
    const tier = count >= 40 ? 3 : count >= 20 ? 2 : count >= 10 ? 1 : 0;
    this.comboEl.className = `t${tier}${milestone ? " hit" : ""}`;
    // Re-trigger the pop animation.
    this.comboEl.style.animation = "none";
    void this.comboEl.offsetWidth;
    this.comboEl.style.animation = "";
    this.comboHideAt = 0;
  }

  endCombo(count: number): void {
    if (count >= 5) {
      this.comboEl.className += " out";
      this.comboHideAt = performance.now() + 700;
    } else {
      this.comboEl.hidden = true;
    }
  }

  /** Full-screen colour flash that fades out. */
  flash(color: string, strength: number): void {
    this.flashEl.style.background = color;
    this.flashEl.style.transition = "none";
    this.flashEl.style.opacity = String(Math.min(0.55, strength));
    void this.flashEl.offsetWidth;
    this.flashEl.style.transition = "opacity 380ms ease-out";
    this.flashEl.style.opacity = "0";
  }

  /** Called every frame: popups drift up and fade, pinned to board space. */
  tickPopups(now: number): void {
    if (this.comboHideAt && now > this.comboHideAt) {
      this.comboEl.hidden = true;
      this.comboHideAt = 0;
    }
    const keep: typeof this.live = [];
    for (const l of this.live) {
      // rAF timestamps are frame-start times and can trail performance.now();
      // a negative age would flip the scale sign and draw the text rotated 180°.
      const age = Math.max(0, (now - l.born) / 1000);
      if (age > 1.1) {
        l.el.hidden = true;
        continue;
      }
      const p = this.project(l.x, l.y + age * 0.9);
      l.el.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px) scale(${1 + Math.min(age * 2, 0.3)})`;
      l.el.style.opacity = String(1 - Math.max(0, age - 0.5) / 0.6);
      keep.push(l);
    }
    this.live = keep;
  }

  private showShop(offers: Offer[]): void {
    this.modal.hidden = false;
    this.modal.innerHTML = `
      <div class="panel">
        <h2>Round cleared</h2>
        <p class="dim">Pick one. Every decision matters.</p>
        <div class="offers">${offers.map((o, i) => this.offerCard(o, i)).join("")}</div>
      </div>`;
    this.modal.querySelectorAll<HTMLButtonElement>("button[data-i]").forEach((b) =>
      b.addEventListener("click", () => {
        this.modal.hidden = true;
        this.onPick?.(Number(b.dataset.i));
      }),
    );
  }

  private offerCard(o: Offer, i: number): string {
    if (o.kind === "charm") {
      const c = CHARMS[o.id];
      const dur = c.duration ? `<span class="dur">${c.duration} round${c.duration === 1 ? "" : "s"}</span>` : "";
      const el = c.element ? ` el-${c.element}` : "";
      return `<button data-i="${i}" class="offer ${c.rarity}${el}"><span class="tag">${c.rarity}${dur}</span><div class="ic">${charmIcon(o.id)}</div><b>${c.name}</b><p>${c.desc}</p></button>`;
    }
    const b = BALL_TYPES[o.id];
    return `<button data-i="${i}" class="offer ball"><span class="tag">ball ×${o.count}</span><div class="ic">${ballIcon(o.id)}</div><b style="color:#${b.color.toString(16).padStart(6, "0")}">${b.name}</b><p>${b.desc}</p></button>`;
  }

  private showEnd(run: Run, phase: "won" | "lost"): void {
    this.modal.hidden = false;
    this.flightEl.hidden = true;
    const verdict = phase === "won" ? "MACHINE CLEARED" : run.cleared ? "DEEP RUN OVER" : "RUN OVER";
    const sub = phase === "won"
      ? "Every round beaten."
      : `Fell at round ${run.round} · ${formatScore(run.roundScore)} of ${formatScore(run.target)} needed${run.cleared ? " · machine cleared on the way" : ""}`;
    const drops = run.log.filter((l) => l.action.type === "drop").length;
    const stat = (v: string | number, label: string) => `<div><b>${v}</b><small>${label}</small></div>`;
    this.modal.innerHTML = `
      <div class="panel end ${phase === "won" || run.cleared ? "gold" : ""}">
        <div class="verdict">${verdict}</div>
        <div class="score display">${formatScore(run.totalScore)}</div>
        <p class="sub">${sub}</p>
        <div class="stats">${stat(run.round, "round")}${stat(run.bestCombo, "best combo")}${stat(drops, "balls dropped")}${stat(run.charms.length, "charms")}</div>
        ${
          this.accountName
            ? `<p id="submit-msg" class="auto">saving as <b>${escapeHtml(this.accountName)}</b>…</p>`
            : `<form id="submit"><input name="name" maxlength="24" placeholder="your name" required autocomplete="off" /><button type="submit">SUBMIT SCORE</button></form>
               <p id="submit-msg" class="dim"></p>
               ${this.authAvailable ? `<a class="discord-cta" href="${this.signInUrl}"><span class="dc-logo">⌁</span><span><b>Sign in with Discord</b><small>saves your collection and posts your best scores automatically</small></span></a>` : ""}`
        }
        <div id="run-discoveries"></div>
        <div id="board" class="dim">loading leaderboard…</div>
        <button id="again" class="primary big">▶ &nbsp;NEW RUN</button>
        <small class="keys">space / enter · new run</small>
      </div>`;
    this.modal.querySelector("#again")!.addEventListener("click", () => this.onNewRun?.());
    const form = this.modal.querySelector<HTMLFormElement>("#submit");
    form?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const name = ((new FormData(form).get("name") as string) ?? "").trim();
      const msg = this.modal.querySelector("#submit-msg")!;
      msg.textContent = "…";
      this.submittedName = name;
      msg.textContent = (await this.onSubmit?.(name)) ?? "";
      void this.loadBoard();
    });
    void this.loadBoard();
  }

  /** Result line of an automatic (signed-in) submission on the end screen. */
  setAutoSubmit(text: string, ok = true): void {
    const msg = this.modal.querySelector<HTMLElement>("#submit-msg");
    if (!msg) return;
    msg.className = ok ? "auto ok" : "auto";
    msg.textContent = text;
    void this.loadBoard();
  }

  /** First-visit callout above the dock; dismissible, never shown once signed in. */
  showSignInCallout(): void {
    if (!this.authAvailable || this.accountName) return;
    try {
      if (localStorage.getItem("pachinkube.signin.dismissed")) return;
    } catch {
      /* fine */
    }
    const el = document.createElement("div");
    el.id = "signin-callout";
    el.innerHTML = `<a class="discord-cta compact" href="${this.signInUrl}"><span class="dc-logo">⌁</span><span><b>Sign in with Discord</b><small>keep your collection · best scores post themselves</small></span></a><button class="x" title="dismiss">×</button>`;
    el.querySelector(".x")!.addEventListener("click", () => {
      el.remove();
      try {
        localStorage.setItem("pachinkube.signin.dismissed", "1");
      } catch {
        /* fine */
      }
    });
    this.root.appendChild(el);
  }

  async loadBoard(root: ParentNode = this.modal): Promise<void> {
    const box = root.querySelector("#board");
    if (!box) return;
    try {
      const res = await fetch("/api/scores");
      const data = (await res.json()) as {
        top: Array<{ name: string; score: number; verified?: boolean; discord?: boolean }>;
        storage: string;
      };
      const me = (this.accountName ?? this.submittedName ?? "").toLowerCase();
      box.innerHTML =
        `<h3>BEST RUNS <small>(${data.storage})</small></h3>` +
        (data.top.length
          ? `<ol>${data.top
              .map(
                (r, i) =>
                  `<li class="${me && r.name.toLowerCase() === me ? "me" : ""}${i === 0 ? " first" : ""}"><span class="rank">${i + 1}</span><span class="who">${r.discord ? '<i class="dc" title="Discord account">⌁</i> ' : ""}${escapeHtml(r.name)}${r.verified ? ' <i class="ok" title="replay verified">✓</i>' : ""}</span><span class="pts">${formatScore(r.score)}</span></li>`,
              )
              .join("")}</ol>`
          : `<p>nobody yet</p>`);
    } catch {
      box.textContent = "leaderboard unavailable";
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
