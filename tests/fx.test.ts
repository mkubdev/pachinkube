import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FxSystem } from "../src/render/fx.js";

/** FxSystem only touches the scene graph, so it runs headless under Node. */
describe("fx bursts", () => {
  it("burst2 and burstPrism spawn the requested particle counts", () => {
    const fx = new FxSystem(new THREE.Scene());
    fx.burst2(0, 0, 0xffffff, 0xff9ec7, 20);
    expect(fx.activeParticles).toBe(20);
    fx.burstPrism(0, 0, 15);
    expect(fx.activeParticles).toBe(35);
    fx.clear();
    expect(fx.activeParticles).toBe(0);
  });

  it("burst still works (delegates to burst2)", () => {
    const fx = new FxSystem(new THREE.Scene());
    fx.burst(0, 0, 0xff6a00, 8);
    expect(fx.activeParticles).toBe(8);
  });

  it("burst2 blends between its two colours instead of picking one", () => {
    const fx = new FxSystem(new THREE.Scene());
    fx.burst2(0, 0, 0xff0000, 0x0000ff, 50);
    expect(fx.activeParticles).toBe(50);

    const col = (fx as any)["col"] as Float32Array;
    const alive = (fx as any)["alive"] as number[];
    expect(alive.length).toBe(50);

    let minR = Infinity;
    let maxR = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (const i of alive) {
      const r = col[i * 3]!;
      const g = col[i * 3 + 1]!;
      const b = col[i * 3 + 2]!;
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1.25);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1.25);
      expect(g).toBe(0);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      minB = Math.min(minB, b);
      maxB = Math.max(maxB, b);
    }
    expect(minR).toBeLessThan(maxR);
    expect(minB).toBeLessThan(maxB);
  });

  it("burstPrism produces varied hues across dominant channels", () => {
    const fx = new FxSystem(new THREE.Scene());
    fx.burstPrism(0, 0, 50);
    expect(fx.activeParticles).toBe(50);

    const col = (fx as any)["col"] as Float32Array;
    const alive = (fx as any)["alive"] as number[];
    expect(alive.length).toBe(50);

    let redMax = 0;
    let greenMax = 0;
    let blueMax = 0;
    for (const i of alive) {
      const r = col[i * 3]!;
      const g = col[i * 3 + 1]!;
      const b = col[i * 3 + 2]!;
      const m = Math.max(r, g, b);
      if (r === m) redMax++;
      else if (g === m) greenMax++;
      else if (b === m) blueMax++;
    }
    expect(redMax).toBeGreaterThan(0);
    expect(greenMax).toBeGreaterThan(0);
    expect(blueMax).toBeGreaterThan(0);
  });
});
