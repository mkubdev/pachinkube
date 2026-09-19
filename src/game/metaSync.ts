/**
 * Keeps the local profile and the signed-in player's server profile in step.
 *
 * Load: fetch the remote profile (401 when signed out → local only), merge
 * both ways, save the merged result locally and remotely. Save: local first
 * (never lose progress to a network blip), then push in the background.
 *
 * Epochs: the server counts progression wipes. A local profile stamped with an
 * older epoch (or none) is discarded on load, and a push carrying a stale
 * epoch is refused with `reset`, after which the in-memory profile is reset in
 * place — so a wipe reaches a tab that was open while it happened.
 */
import { freshMeta, mergeMeta, resetMeta, type MetaState, type MetaStore } from "./meta.js";

export class SyncedMetaStore implements MetaStore {
  signedIn = false;
  /** Fired when the server made this client start over (progression wipe). */
  onReset: (() => void) | null = null;
  private cache: MetaState | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly local: MetaStore) {}

  load(): MetaState {
    this.cache = this.local.load();
    return this.cache;
  }

  /** Call once after load(); resolves to the merged profile when signed in. */
  async pull(): Promise<MetaState> {
    let local = this.cache ?? this.load();
    try {
      const res = await fetch("/api/meta", { credentials: "same-origin" });
      if (res.status === 401 || res.status === 503) {
        // Signed out: still learn the epoch so a wipe resets local play too,
        // and so this profile can merge onto an account later.
        const epoch = await this.fetchEpoch();
        if (epoch !== null && local.epoch !== epoch) {
          local = local.epoch === undefined && isBlank(local) ? Object.assign(local, { epoch }) : freshMeta(epoch);
          this.cache = local;
          this.local.save(local);
        }
        return local;
      }
      if (!res.ok) return local;
      const data = (await res.json()) as { meta: MetaState | null; epoch: number };
      this.signedIn = true;
      if (local.epoch !== data.epoch) local = freshMeta(data.epoch);
      const merged = data.meta ? mergeMeta(local, data.meta) : local;
      merged.epoch = data.epoch;
      this.cache = merged;
      this.local.save(merged);
      void this.push(merged);
      return merged;
    } catch {
      return local;
    }
  }

  save(meta: MetaState): void {
    this.cache = meta;
    this.local.save(meta);
    if (!this.signedIn) return;
    // Debounce: progression changes many times per second during a run.
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.push(meta), 1500);
  }

  /** Forget this player's profile on the server and start over locally, in place. */
  async resetMine(): Promise<void> {
    let epoch = (await this.fetchEpoch()) ?? this.cache?.epoch ?? 0;
    try {
      const res = await fetch("/api/meta?me=1", { method: "DELETE", credentials: "same-origin" });
      if (res.ok) epoch = ((await res.json()) as { epoch: number }).epoch;
    } catch {
      /* signed out or offline: local reset is what matters */
    }
    const meta = this.cache ?? this.load();
    resetMeta(meta, epoch);
    this.cache = meta;
    this.local.save(meta);
  }

  private async fetchEpoch(): Promise<number | null> {
    try {
      const res = await fetch("/api/meta?epoch=1", { credentials: "same-origin" });
      if (!res.ok) return null;
      return ((await res.json()) as { epoch: number }).epoch;
    } catch {
      return null;
    }
  }

  private async push(meta: MetaState): Promise<void> {
    try {
      const res = await fetch("/api/meta", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ meta }),
      });
      if (res.status === 409) {
        const data = (await res.json()) as { epoch: number; reset?: boolean };
        if (data.reset) {
          resetMeta(meta, data.epoch);
          this.local.save(meta);
          this.onReset?.();
        }
      }
    } catch {
      /* offline: the next save retries */
    }
  }
}

/** A profile with no progress at all: safe to adopt an epoch rather than discard. */
function isBlank(meta: MetaState): boolean {
  return Object.values(meta.stats).every((v) => v === 0) && Object.keys(meta.feats).length === 0;
}
