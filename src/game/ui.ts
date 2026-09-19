/**
 * DOM overlay: HUD, score popups, pocket labels, shop, end screen.
 * Roguelite menus are far easier in HTML than in-canvas, and it stays crisp
 * at any resolution.
 */
import { CHARMS, CHARM_IDS } from "./charms";
import { BALL_IDS, BALL_TYPES } from "./balls";
import { formatMult, formatScore } from "./format";
import type { GameEvent, Offer, Run } from "./run";
import { FEATS, UNLOCK_RULES, isUnlocked, ruleFor, unlockProgress, type MetaNotice, type MetaState, type FeatId } from "./meta";

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
  private readonly popups: HTMLElement[] = [];
  private popupIdx = 0;
  private lastHash = "--------";
  private live: Array<{ el: HTMLElement; x: number; y: number; born: number }> = [];
  onPick: ((index: number) => void) | null = null;
  onNewRun: (() => void) | null = null;
  onSubmit: ((name: string) => Promise<string>) | null = null;
  onCollection: (() => void) | null = null;
  private runDiscoveries: MetaNotice[] = [];

  constructor(private readonly project: Projector) {
    this.root = document.getElementById("ui")!;
    this.root.innerHTML = `
      <div id="hud"></div>
      <div id="charms"></div>
      <div id="labels"></div>
      <div id="popups"></div>
      <div id="combo" hidden><div class="n"></div><div class="l">COMBO</div></div>
      <div id="flash"></div>
      <div id="toasts"></div>
      <div id="modal" hidden></div>
      <div id="collection" hidden></div>
      <button id="collection-btn" title="Collection (C)">◈ collection</button>
      <div id="hint">move: aim · click / space: drop · A: auto · C: collection</div>`;
    this.hud = this.root.querySelector("#hud")!;
    this.charmsEl = this.root.querySelector("#charms")!;
    this.modal = this.root.querySelector("#modal")!;
    this.comboEl = this.root.querySelector("#combo")!;
    this.comboN = this.comboEl.querySelector(".n")!;
    this.flashEl = this.root.querySelector("#flash")!;
    this.root.querySelector("#collection-btn")!.addEventListener("click", () => this.onCollection?.());
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
    this.layoutPockets(centers);
    addEventListener("resize", () => this.layoutPockets(centers));
  }

  updatePocketMults(mults: number[]): void {
    this.labels.forEach((el, i) => (el.textContent = formatMult(mults[i] ?? 1)));
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
  }

  /** Centre banner for run-level moments (insurance, etc.). */
  notice(text: string): void {
    this.popup(0, 6.5, text, "info", 1.6);
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
      const detail = n.kind === "feat" ? FEATS[n.id].desc : n.kind === "unlock" ? "now appears in the shop" : "added to your collection";
      el.innerHTML = `<span class="head">${head}</span><b>${escapeHtml(n.label)}</b><small>${escapeHtml(detail)}</small>`;
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
      if (!unlocked) {
        const rule = ruleFor(kind, id)!;
        const p = unlockProgress(meta, rule);
        return `<div class="card locked"><span class="tag">locked</span><b>???</b><p>${escapeHtml(rule.hint)}</p><div class="prog"><div style="width:${(p.current / p.target) * 100}%"></div></div><small>${p.current.toLocaleString("en-US")} / ${p.target.toLocaleString("en-US")}</small></div>`;
      }
      if (!seen) return `<div class="card unseen"><span class="tag ${rarity}">${rarity}</span><b>?</b><p>Available — not yet seen in a run.</p></div>`;
      return `<div class="card ${rarity}"><span class="tag ${rarity}">${rarity}</span><b style="${color ? `color:${color}` : ""}">${escapeHtml(name)}</b><p>${escapeHtml(desc)}</p></div>`;
    };
    const feats = (Object.keys(FEATS) as FeatId[])
      .map((id) => {
        const got = meta.feats[id];
        return `<div class="card feat ${got ? "" : "locked"}"><b>${got ? FEATS[id].name : "???"}</b><p>${FEATS[id].desc}</p>${got ? `<small>${new Date(got).toLocaleDateString()}</small>` : ""}</div>`;
      })
      .join("");
    const unlockedCount = UNLOCK_RULES.filter((r) => isUnlocked(meta, r.kind, r.id)).length;
    el.innerHTML = `
      <div class="panel wide">
        <div class="row"><h2>Collection</h2><button id="collection-close">close</button></div>
        <p class="dim">${s.runs} runs · ${s.wins} wins · best ${formatScore(s.bestScore)} · best combo ${s.bestCombo} · ${unlockedCount}/${UNLOCK_RULES.length} unlocks · ${Object.keys(meta.feats).length}/${Object.keys(FEATS).length} discoveries</p>
        <h3>Balls</h3><div class="grid">${BALL_IDS.filter((b) => b !== "steel").map((b) => card("ball", b)).join("")}</div>
        <h3>Charms</h3><div class="grid">${CHARM_IDS.map((c) => card("charm", c)).join("")}</div>
        <h3>Discoveries</h3><div class="grid">${feats}</div>
      </div>`;
    el.querySelector("#collection-close")!.addEventListener("click", () => (el.hidden = true));
  }

  /** On the end screen: what this run added to the collection. */
  showRunDiscoveries(meta: MetaState, run: Run): void {
    void meta;
    void run;
    const box = this.modal.querySelector("#run-discoveries");
    if (!box) return;
    const items = this.runDiscoveries;
    box.innerHTML = items.length
      ? `<h3>this run</h3><ul>${items.map((n) => `<li><span class="tag ${n.kind}">${n.kind}</span> ${escapeHtml(n.label)}</li>`).join("")}</ul>`
      : "";
  }

  updateCharms(run: Run): void {
    const counts = new Map<string, number>();
    for (const c of run.charms) counts.set(c, (counts.get(c) ?? 0) + 1);
    this.charmsEl.innerHTML = [...counts]
      .map(([id, n]) => {
        const c = CHARMS[id as keyof typeof CHARMS];
        return `<div class="charm ${c.rarity}" title="${c.desc}">${c.name}${n > 1 ? ` ×${n}` : ""}</div>`;
      })
      .join("");
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
      return `<button data-i="${i}" class="offer ${c.rarity}"><span class="tag">${c.rarity}</span><b>${c.name}</b><p>${c.desc}</p></button>`;
    }
    const b = BALL_TYPES[o.id];
    return `<button data-i="${i}" class="offer ball"><span class="tag">ball ×${o.count}</span><b style="color:#${b.color.toString(16).padStart(6, "0")}">${b.name}</b><p>${b.desc}</p></button>`;
  }

  private showEnd(run: Run, phase: "won" | "lost"): void {
    this.modal.hidden = false;
    this.modal.innerHTML = `
      <div class="panel">
        <h2>${phase === "won" ? "Machine cleared" : run.cleared ? "Deep run over" : "Run over"}</h2>
        <p class="score display">${formatScore(run.totalScore)}</p>
        <p class="dim">${phase === "won" ? "Every round beaten." : `Fell at round ${run.round} — ${formatScore(run.roundScore)} of ${formatScore(run.target)}.${run.cleared ? " Machine cleared on the way." : ""}`}</p>
        <form id="submit"><input name="name" maxlength="24" placeholder="your name" required /><button type="submit">submit score</button></form>
        <p id="submit-msg" class="dim"></p>
        <div id="run-discoveries" class="dim"></div>
        <div id="board" class="dim">loading leaderboard…</div>
        <button id="again" class="primary">new run</button>
      </div>`;
    this.modal.querySelector("#again")!.addEventListener("click", () => this.onNewRun?.());
    const form = this.modal.querySelector<HTMLFormElement>("#submit")!;
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const name = (new FormData(form).get("name") as string).trim();
      const msg = this.modal.querySelector("#submit-msg")!;
      msg.textContent = "…";
      msg.textContent = (await this.onSubmit?.(name)) ?? "";
      void this.loadBoard();
    });
    void this.loadBoard();
  }

  async loadBoard(): Promise<void> {
    const box = this.modal.querySelector("#board");
    if (!box) return;
    try {
      const res = await fetch("/api/scores");
      const data = (await res.json()) as {
        top: Array<{ name: string; score: number; verified?: boolean }>;
        storage: string;
      };
      box.innerHTML =
        `<h3>best runs <small>(${data.storage})</small></h3>` +
        (data.top.length
          ? `<ol>${data.top
              .map(
                (r) =>
                  `<li><span>${escapeHtml(r.name)}${r.verified ? ' <i class="ok" title="replay verified">✓</i>' : ""}</span><span>${formatScore(r.score)}</span></li>`,
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
