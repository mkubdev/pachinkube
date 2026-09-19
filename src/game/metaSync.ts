/**
 * Keeps the local profile and the signed-in player's server profile in step.
 *
 * Load: fetch the remote profile (401 when signed out → local only), merge
 * both ways, save the merged result locally and remotely. Save: local first
 * (never lose progress to a network blip), then push in the background.
 */
import { mergeMeta, type MetaState, type MetaStore } from "./meta.js";

export class SyncedMetaStore implements MetaStore {
  signedIn = false;
  private cache: MetaState | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly local: MetaStore) {}

  load(): MetaState {
    this.cache = this.local.load();
    return this.cache;
  }

  /** Call once after load(); resolves to the merged profile when signed in. */
  async pull(): Promise<MetaState> {
    const local = this.cache ?? this.load();
    try {
      const res = await fetch("/api/meta", { credentials: "same-origin" });
      if (res.status === 401 || res.status === 503) return local;
      if (!res.ok) return local;
      const data = (await res.json()) as { meta: MetaState | null };
      this.signedIn = true;
      const merged = data.meta ? mergeMeta(local, data.meta) : local;
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

  private async push(meta: MetaState): Promise<void> {
    try {
      await fetch("/api/meta", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ meta }),
      });
    } catch {
      /* offline: the next save retries */
    }
  }
}
