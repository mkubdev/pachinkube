/**
 * Combo events: every 20th combo hit fires one of these, drawn from the fx
 * stream. They are the "completely crazy" layer — each bends the board or the
 * physics for a moment. Durations are in ticks (120/s).
 */
export type ComboEventKind = "laser" | "portal" | "quake" | "rain" | "gravity_flip" | "magnet_storm" | "slowmo";

export interface ComboEventDef {
  kind: ComboEventKind;
  name: string;
  desc: string;
  weight: number;
  /** How long the physical effect lasts; 0 = instantaneous. */
  ticks: number;
}

export const COMBO_EVENT_EVERY = 50;
/** Minimum spacing between two events, in ticks (6 s). */
export const COMBO_EVENT_COOLDOWN_TICKS = 720;

export const COMBO_EVENTS: Record<ComboEventKind, ComboEventDef> = {
  laser: { kind: "laser", name: "LASER SWEEP", desc: "A beam lights every peg on one row.", weight: 22, ticks: 0 },
  portal: { kind: "portal", name: "PORTAL", desc: "The next two balls to reach the bottom come back from the top with +2 mult.", weight: 18, ticks: 0 },
  quake: { kind: "quake", name: "QUAKE", desc: "The whole board shakes loose for 3 s.", weight: 14, ticks: 360 },
  rain: { kind: "rain", name: "BALL RAIN", desc: "Three bonus shards fall from the top.", weight: 16, ticks: 0 },
  gravity_flip: { kind: "gravity_flip", name: "GRAVITY FLIP", desc: "Everything falls up for a second.", weight: 10, ticks: 110 },
  magnet_storm: { kind: "magnet_storm", name: "MAGNET STORM", desc: "Every ball is dragged toward the centre pocket for 2 s.", weight: 12, ticks: 240 },
  slowmo: { kind: "slowmo", name: "SLOW MOTION", desc: "Time dilates for 1.5 s.", weight: 8, ticks: 0 },
};

export const COMBO_EVENT_KINDS = Object.keys(COMBO_EVENTS) as ComboEventKind[];
