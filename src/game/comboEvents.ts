/**
 * Combo events: every 20th combo hit fires one of these, drawn from the fx
 * stream. They are the "completely crazy" layer — each bends the board or the
 * physics for a moment. Durations are in ticks (120/s).
 */
export type ComboEventKind =
  | "laser"
  | "portal"
  | "quake"
  | "rain"
  | "gravity_flip"
  | "magnet_storm"
  | "slowmo"
  | "overdrive"
  | "time_lock"
  | "fresh_coat";

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
  laser: { kind: "laser", name: "LASER SWEEP", desc: "A beam lights every peg on one row.", weight: 18, ticks: 0 },
  portal: { kind: "portal", name: "PORTAL", desc: "The next two balls to reach the bottom come back from the top with +2 mult.", weight: 15, ticks: 0 },
  quake: { kind: "quake", name: "QUAKE", desc: "The whole board shakes loose for 3 s.", weight: 12, ticks: 360 },
  rain: { kind: "rain", name: "BALL RAIN", desc: "Three bonus shards fall from the top.", weight: 13, ticks: 0 },
  gravity_flip: { kind: "gravity_flip", name: "GRAVITY FLIP", desc: "Everything falls up for a second.", weight: 9, ticks: 110 },
  magnet_storm: { kind: "magnet_storm", name: "MAGNET STORM", desc: "Every ball is dragged toward the centre pocket for 2 s.", weight: 10, ticks: 240 },
  slowmo: { kind: "slowmo", name: "SLOW MOTION", desc: "Time dilates for 1.5 s.", weight: 7, ticks: 0 },
  overdrive: { kind: "overdrive", name: "OVERDRIVE", desc: "Every peg hit counts double toward the combo for 3 s.", weight: 14, ticks: 360 },
  time_lock: { kind: "time_lock", name: "TIME LOCK", desc: "The combo cannot lapse for 2.5 s.", weight: 10, ticks: 300 },
  fresh_coat: { kind: "fresh_coat", name: "FRESH COAT", desc: "Every lit peg goes dark — the whole board pays fresh again.", weight: 12, ticks: 0 },
};

export const COMBO_EVENT_KINDS = Object.keys(COMBO_EVENTS) as ComboEventKind[];
