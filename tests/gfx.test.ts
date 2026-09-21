import { describe, expect, it } from "vitest";
import {
  cycleQuality, defaultGfx, loadGfx, renderInterval, saveGfx, toggleFps,
  type GfxSettings,
} from "../src/game/gfx.js";

/** Minimal in-memory Storage stand-in (tests run under node). */
function memStore(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe("gfx settings", () => {
  it("defaults to 60fps, high quality on desktop and medium on touch", () => {
    expect(defaultGfx(false)).toEqual({ fps: 60, quality: "high" });
    expect(defaultGfx(true)).toEqual({ fps: 60, quality: "medium" });
  });

  it("round-trips through storage", () => {
    const store = memStore();
    const gfx: GfxSettings = { fps: "max", quality: "low" };
    saveGfx(store, gfx);
    expect(loadGfx(store, false)).toEqual(gfx);
  });

  it("falls back to defaults on missing or garbage storage", () => {
    expect(loadGfx(memStore(), true)).toEqual(defaultGfx(true));
    expect(loadGfx(memStore({ "pachinkube.gfx": "not json" }), false)).toEqual(defaultGfx(false));
    expect(loadGfx(memStore({ "pachinkube.gfx": '{"fps":999,"quality":"ultra"}' }), false)).toEqual(defaultGfx(false));
  });

  it("cycles quality low → medium → high → low", () => {
    expect(cycleQuality("low")).toBe("medium");
    expect(cycleQuality("medium")).toBe("high");
    expect(cycleQuality("high")).toBe("low");
  });

  it("toggles fps between 60 and max", () => {
    expect(toggleFps(60)).toBe("max");
    expect(toggleFps("max")).toBe(60);
  });
});

describe("renderInterval", () => {
  it("caps at 60fps and lets max run uncapped", () => {
    expect(renderInterval(60, false)).toBeCloseTo(1000 / 60);
    expect(renderInterval("max", false)).toBe(0);
  });

  it("throttles to 30fps when idle, whatever the fps setting", () => {
    expect(renderInterval(60, true)).toBeCloseTo(1000 / 30);
    expect(renderInterval("max", true)).toBeCloseTo(1000 / 30);
  });
});
