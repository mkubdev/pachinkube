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
});
