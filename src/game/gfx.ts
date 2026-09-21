/**
 * Graphics settings: frame-rate cap and render quality.
 *
 * The sim always steps on its fixed accumulator; these settings only decide
 * how often and how expensively the board is *drawn*, so they never touch
 * gameplay, determinism, or replays.
 */

export type FpsSetting = 60 | "max";
export type Quality = "low" | "medium" | "high";

export interface GfxSettings {
  /** 60 caps drawing at 60fps; "max" draws every rAF (the display's refresh). */
  fps: FpsSetting;
  /** low: DPR 1, no post. medium: DPR 1.5, bloom only. high: DPR 2, everything. */
  quality: Quality;
}

const KEY = "pachinkube.gfx";
const QUALITIES: Quality[] = ["low", "medium", "high"];

type StoreRead = { getItem(key: string): string | null };
type StoreWrite = { setItem(key: string, value: string): void };

/** Phones default to medium: bloom at full DPR is too much for a mobile GPU. */
export function defaultGfx(coarse: boolean): GfxSettings {
  return { fps: 60, quality: coarse ? "medium" : "high" };
}

export function loadGfx(store: StoreRead, coarse: boolean): GfxSettings {
  const fallback = defaultGfx(coarse);
  try {
    const raw = store.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<GfxSettings>;
    return {
      fps: parsed.fps === 60 || parsed.fps === "max" ? parsed.fps : fallback.fps,
      quality: QUALITIES.includes(parsed.quality as Quality) ? (parsed.quality as Quality) : fallback.quality,
    };
  } catch {
    return fallback;
  }
}

export function saveGfx(store: StoreWrite, gfx: GfxSettings): void {
  try {
    store.setItem(KEY, JSON.stringify(gfx));
  } catch {
    // Private browsing: the setting just won't stick.
  }
}

export function cycleQuality(q: Quality): Quality {
  return QUALITIES[(QUALITIES.indexOf(q) + 1) % QUALITIES.length]!;
}

export function toggleFps(f: FpsSetting): FpsSetting {
  return f === 60 ? "max" : 60;
}

/**
 * Minimum milliseconds between drawn frames (0 = draw every rAF).
 * Idle screens (shop, end of run) drop to 30fps whatever the setting.
 */
export function renderInterval(fps: FpsSetting, idle: boolean): number {
  if (idle) return 1000 / 30;
  return fps === 60 ? 1000 / 60 : 0;
}
