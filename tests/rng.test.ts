import { describe, expect, it } from "vitest";
import { Rng, hash32, makeStreams } from "../src/sim/rng";

describe("rng", () => {
  it("is reproducible from a seed", () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) expect(v >= 0 && v < 1).toBe(true);
  });

  it("streams are independent: consuming one does not shift another", () => {
    const s1 = makeStreams("seed-x");
    const s2 = makeStreams("seed-x");
    for (let i = 0; i < 100; i++) s1.shop.next(); // burn the shop stream only
    expect(s1.drop.next()).toBe(s2.drop.next());
    expect(s1.layout.next()).toBe(s2.layout.next());
  });

  it("different seeds give different streams", () => {
    expect(makeStreams("a").drop.next()).not.toBe(makeStreams("b").drop.next());
    expect(hash32("a")).not.toBe(hash32("b"));
  });
});
