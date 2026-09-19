/**
 * Procedural sound: no assets, just oscillators. Voice-limited so a screen
 * full of peg hits becomes a texture instead of white noise, and pitch rises
 * with the ball's combo so chaos is audibly "going up".
 */
const MAX_VOICES = 14;

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private active = 0;
  private lastPing = 0;
  enabled = true;

  /** Browsers require a user gesture before audio can start. */
  unlock(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
  }

  private voice(build: (ctx: AudioContext, out: GainNode, t: number) => number): void {
    if (!this.enabled || !this.ctx || !this.master || this.active >= MAX_VOICES) return;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    const out = this.ctx.createGain();
    out.connect(this.master);
    const t = this.ctx.currentTime;
    const dur = build(this.ctx, out, t);
    this.active++;
    setTimeout(() => {
      out.disconnect();
      this.active--;
    }, dur * 1000 + 30);
  }

  /** Short metallic ping; pitch follows the ball's hit count. */
  peg(hits: number, fresh: boolean): void {
    const now = performance.now();
    // Rate-limit identical pings inside one frame burst.
    if (now - this.lastPing < 12) return;
    this.lastPing = now;
    this.voice((ctx, out, t) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      const base = fresh ? 620 : 440;
      const f = base * Math.pow(1.0595, Math.min(hits, 24));
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.09);
      out.gain.setValueAtTime(fresh ? 0.5 : 0.25, t);
      out.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(out);
      osc.start(t);
      osc.stop(t + 0.13);
      return 0.13;
    });
  }

  /** Mult gain: a bright two-note chime. */
  mult(): void {
    this.voice((ctx, out, t) => {
      for (const [i, f] of [880, 1320].entries()) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + i * 0.06);
        g.gain.exponentialRampToValueAtTime(0.4, t + i * 0.06 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.25);
        osc.connect(g).connect(out);
        osc.start(t + i * 0.06);
        osc.stop(t + i * 0.06 + 0.26);
      }
      return 0.34;
    });
  }

  /** Ball landed: low thump scaled by score, plus a jackpot sparkle when big. */
  score(magnitude: number): void {
    this.voice((ctx, out, t) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(48, t + 0.25);
      out.gain.setValueAtTime(0.6 + Math.min(magnitude, 1) * 0.4, t);
      out.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(out);
      osc.start(t);
      osc.stop(t + 0.36);
      if (magnitude > 0.5) {
        const sp = ctx.createOscillator();
        sp.type = "square";
        sp.frequency.setValueAtTime(1760, t + 0.05);
        sp.frequency.exponentialRampToValueAtTime(3520, t + 0.3);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.08, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        sp.connect(g).connect(out);
        sp.start(t + 0.05);
        sp.stop(t + 0.41);
      }
      return 0.45;
    });
  }
}
