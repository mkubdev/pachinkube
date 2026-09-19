/**
 * Elements: pegs can carry a state (burning, frozen, charged) and balls can be
 * imbued. Hitting a peg resolves ball element × peg element through one table,
 * which is where the "game-breaking synergies" come from.
 *
 * Pure data. The run applies results; the renderer paints them.
 */
export type Element = "fire" | "ice" | "storm";

export interface PegElementState {
  el: Element;
  /** Fire: spread budget. Ice: thickness (shatter chips). Storm: charge. */
  stacks: number;
}

export const ELEMENTS: Record<Element, { name: string; color: number; verb: string }> = {
  fire: { name: "Fire", color: 0xff6a00, verb: "ignite" },
  ice: { name: "Ice", color: 0x9fe8ff, verb: "freeze" },
  storm: { name: "Storm", color: 0x7df9ff, verb: "charge" },
};

/** What happens when a ball of `ball` element hits a peg in `peg` state. */
export type Reaction =
  | { kind: "ignite" }                       // fire ball on a neutral peg
  | { kind: "freeze" }                       // ice ball on a neutral peg
  | { kind: "charge" }                       // storm ball on a neutral peg
  | { kind: "burn"; chipMult: number }       // any ball on a burning peg: bonus chips, spreads
  | { kind: "shatter"; chips: number }       // any non-fire ball on a frozen peg: burst, spreads freeze
  | { kind: "steam"; chips: number; mult: number } // fire on frozen: melt for chips + mult
  | { kind: "zap"; arcs: number }            // any ball on a charged peg: lightning to nearest pegs
  | { kind: "wildfire"; spread: number }     // storm on burning: fire jumps to many pegs
  | { kind: "shatter_chain"; chips: number } // storm on frozen: every connected frozen peg shatters
  | { kind: "thicken"; stacks: number }      // ice on frozen: the ice grows (bigger shatter later)
  | { kind: "flare"; chipMult: number; spread: number } // fire on burning: hotter burn, wider spread
  | { kind: "none" };

export const ICE_STACK_CHIPS = 12;
export const STEAM_CHIPS = 40;
/** Ice this thick shatters even under an ice ball. */
export const MAX_ICE_STACKS = 4;

export function react(ball: Element | null, peg: PegElementState | null): Reaction {
  if (!peg) {
    if (ball === "fire") return { kind: "ignite" };
    if (ball === "ice") return { kind: "freeze" };
    if (ball === "storm") return { kind: "charge" };
    return { kind: "none" };
  }
  switch (peg.el) {
    case "fire":
      if (ball === "storm") return { kind: "wildfire", spread: 3 + peg.stacks };
      if (ball === "fire") return { kind: "flare", chipMult: 2.5, spread: 2 };
      return { kind: "burn", chipMult: 1.5 };
    case "ice":
      if (ball === "fire") return { kind: "steam", chips: STEAM_CHIPS * peg.stacks, mult: 1 };
      if (ball === "storm") return { kind: "shatter_chain", chips: ICE_STACK_CHIPS * peg.stacks };
      if (ball === "ice" && peg.stacks < MAX_ICE_STACKS) return { kind: "thicken", stacks: peg.stacks + 1 };
      return { kind: "shatter", chips: ICE_STACK_CHIPS * peg.stacks };
    case "storm":
      return { kind: "zap", arcs: 2 + (ball === "storm" ? 2 : 0) };
  }
}

/** Frozen pegs are glassy: bouncier than bare metal. */
export const ICE_RESTITUTION = 0.92;

/** Presentation events the run emits for element moments. */
export type ElementFxKind = Reaction["kind"] | "spread" | "melt";
