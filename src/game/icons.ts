/**
 * 8-bit icons for the collection, shop and charm panel.
 *
 * Each glyph is a 12×12 pixel map ('.' empty, '#' primary, '+' secondary,
 * 'o' highlight) rendered as crisp SVG rects. Charms map to a glyph plus a
 * palette from their rarity/element; balls are shaded spheres in their own
 * colour. Everything is generated, so adding a charm means picking a glyph.
 */
import { BALL_TYPES, type BallTypeId } from "./balls.js";
import { CHARMS, type CharmId } from "./charms.js";
import type { FeatId } from "./meta.js";

const G: Record<string, string[]> = {
  flame: ["....#.......", "....##......", "...###......", "...#+##.....", "..##++#.....", "..#+++##....", ".##++o+#....", ".#++oo++#...", ".#+ooo++#...", ".##+oo+##...", "..##++##....", "...####....."],
  snow:  ["....#.......", "..#.#.#.....", "...###......", ".#..#..#....", "..#####.....", "####o####...", "..#####.....", ".#..#..#....", "...###......", "..#.#.#.....", "....#.......", "............"],
  bolt:  [".......##...", "......##....", ".....##.....", "....###.....", "...#####....", "..##oo###...", ".....#o.....", "....##......", "...##.......", "..##........", ".##.........", "............"],
  coin:  ["...######...", "..#++++++#..", ".#+o####+#..", ".#+#....#+#.", "#+#..##..#+#", "#+#..#o..#+#", "#+#..##..#+#", ".#+#....#+#.", ".#+o####+#..", "..#++++++#..", "...######...", "............"],
  dice:  [".##########.", "#o........o#", "#..##......#", "#..##..##..#", "#......##..#", "#....##....#", "#....##....#", "#..##......#", "#..##..##..#", "#......##..#", "#o........o#", ".##########."],
  shield:["..########..", ".#++++++++#.", "#+++o##o+++#", "#++o####o++#", "#++######++#", "#+++####+++#", ".#++####++#.", ".#++####++#.", "..#++##++#..", "...#++++#...", "....#++#....", ".....##....."],
  star:  [".....##.....", ".....##.....", "....#oo#....", "###########.", ".##++++++##.", "..#++oo++#..", "..#++++++#..", ".##+#..#+##.", ".#+#....#+#.", "##........##", "............", "............"],
  magnet:[".###....###.", "#+++#..#+++#", "#+o+#..#+o+#", "#+++#..#+++#", "#+++#..#+++#", "#+++#..#+++#", "#+++####+++#", "#++++++++++#", ".#++++++++#.", "..########..", "............", "............"],
  split: ["......#.....", ".....###....", "....#o##....", "...##.##....", "..##...##...", ".##.....##..", "##.......##.", "##.......##.", ".##.....##..", "..o#...#o...", "...##.##....", "............"],
  eye:   ["....####....", "..##++++##..", ".#++####++#.", "#++#o##o#++#", "#+####o###+#", "#+####o###+#", "#++#o##o#++#", ".#++####++#.", "..##++++##..", "....####....", "............", "............"],
  clock: ["...######...", "..#++++++#..", ".#++++#+++#.", "#+++++#++++#", "#+++++#++++#", "#+++++o####.", "#++++++++++#", "#++++++++++#", ".#++++++++#.", "..#++++++#..", "...######...", "............"],
  heart: [".###....###.", "#+++#..#+++#", "#+o++##++++#", "#++++++++++#", "#++++++++++#", ".#++++++++#.", "..#++++++#..", "...#++++#...", "....#++#....", ".....##.....", "............", "............"],
  arrow: [".....##.....", "....#oo#....", "...#++++#...", "..#++++++#..", ".#++++++++#.", "....#++#....", "....#++#....", "....#++#....", "....#++#....", "....#++#....", "....####....", "............"],
  wave:  ["............", "............", "##....##....", "#+#..#+#..##", ".#+##+#+##+#", "..#oo#..#o#.", "............", "##....##....", "#+#..#+#..##", ".#+##+#+##+#", "..#oo#..#o#.", "............"],
  bomb:  [".......#....", "......#o....", ".....#......", "...######...", "..#++++++#..", ".#+o++++++#.", ".#++++++++#.", "#++++++++++#", ".#++++++++#.", ".#++++++++#.", "..#++++++#..", "...######..."],
  gear:  ["....####....", ".#.#++++#.#.", "..##++++##..", ".#+++##+++#.", "##++#..#++##", "##++#..#++##", ".#+++##+++#.", "..##++++##..", ".#.#++++#.#.", "....####....", "............", "............"],
  trophy:["#..######..#", "#..#++++#..#", "##.#++++#.##", ".###o+++###.", "..#++++++#..", "...#++++#...", "....#++#....", ".....##.....", ".....##.....", "...######...", "..########..", "............"],
  skull: ["...######...", "..#++++++#..", ".#++++++++#.", ".#+##++##+#.", ".#+oo++oo+#.", ".#++++++++#.", "..#++##++#..", "..##+##+##..", "...#+##+#...", "...#.##.#...", "............", "............"],
  sun:   [".....##.....", ".#...##...#.", "..#.####.#..", "...######...", ".#########+.", "###o#####+##", "###+#####o##", ".+########+.", "...######...", "..#.####.#..", ".#...##...#.", ".....##....."],
  ball:  ["...######...", "..#oo####+..", ".#o#######+.", ".##########.", "###########+", "###########+", "###########+", ".##########.", ".+#########.", "..++#####+..", "...++++++...", "............"],
};

const CHARM_GLYPH: Record<CharmId, keyof typeof G> = {
  magnet_coil: "magnet", neon_sign: "star", split_shot: "split", jackpot_lens: "eye", rubber_soul: "wave",
  heavy_metal: "gear", chain_lightning: "bolt", bumper_kings: "shield", overflow: "wave", extra_ball: "ball",
  phoenix: "flame", golden_pocket: "coin", loaded_dice: "dice", wide_net: "wave", warm_start: "sun",
  momentum: "arrow", grand_finale: "trophy", fresh_paint: "star", echo: "wave", long_fuse: "clock",
  milestone_maker: "star", insurance: "heart", duplicator: "split", compound: "coin", sharpshooter: "eye",
  low_gravity: "arrow", ember_core: "flame", frost_bite: "snow", static_field: "bolt", conductor: "bolt",
  melting_point: "sun", tinder: "flame", elemental_surge: "sun", firestorm: "flame", deep_freeze: "snow",
  thunderhead: "bolt", solstice: "sun", drift: "wave", restless_board: "gear",
  roulette: "dice", hot_pocket: "flame", groove: "arrow", jackpot_growth: "coin", pocket_lottery: "star", inversion: "split",
};

const FEAT_GLYPH: Record<FeatId, keyof typeof G> = {
  first_win: "trophy", combo_40: "star", combo_80: "star", combo_150: "sun", first_bomb: "bomb", first_split: "split",
  first_revive: "flame", first_bullseye: "eye", ball_5k: "coin", ball_50k: "coin", round_5: "trophy", run_1m: "trophy",
  jackpot_streak: "eye", first_steam: "sun", first_wildfire: "flame", first_shatter_chain: "snow", big_shatter: "snow",
};

interface Palette { primary: string; secondary: string; highlight: string }
const RARITY: Record<string, Palette> = {
  common: { primary: "#8a93a3", secondary: "#c8d0d8", highlight: "#ffffff" },
  uncommon: { primary: "#1aa6bf", secondary: "#2de2ff", highlight: "#d7f7ff" },
  rare: { primary: "#c9962a", secondary: "#ffd34d", highlight: "#fff1a8" },
  feat: { primary: "#c9962a", secondary: "#ffd34d", highlight: "#ffffff" },
  locked: { primary: "#2a2f3a", secondary: "#3a4150", highlight: "#4a5262" },
};
const ELEMENT: Record<string, Palette> = {
  fire: { primary: "#c23a00", secondary: "#ff6a00", highlight: "#ffd34d" },
  ice: { primary: "#3aa5c9", secondary: "#9fe8ff", highlight: "#ffffff" },
  storm: { primary: "#2d8fb0", secondary: "#7df9ff", highlight: "#ffffff" },
};

function shade(hex: number, f: number): string {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Render a 12×12 pixel map as an SVG string (crisp, scales to any size). */
export function pixelSvg(map: string[], pal: Palette, size = 12): string {
  const rects: string[] = [];
  for (let y = 0; y < map.length; y++) {
    const row = map[y]!;
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === ".") continue;
      const fill = ch === "#" ? pal.primary : ch === "+" ? pal.secondary : pal.highlight;
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`);
    }
  }
  return `<svg class="px" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-hidden="true">${rects.join("")}</svg>`;
}

export function charmIcon(id: CharmId, locked = false): string {
  const c = CHARMS[id];
  const pal = locked ? RARITY.locked! : c.element ? ELEMENT[c.element]! : RARITY[c.rarity]!;
  return pixelSvg(G[CHARM_GLYPH[id]]!, pal);
}

export function ballIcon(id: BallTypeId, locked = false): string {
  const color = BALL_TYPES[id].color;
  const pal = locked ? RARITY.locked! : { primary: shade(color, 0.85), secondary: shade(color, 0.55), highlight: "#ffffff" };
  return pixelSvg(G.ball!, pal);
}

export function featIcon(id: FeatId, got: boolean): string {
  return pixelSvg(G[FEAT_GLYPH[id]]!, got ? RARITY.feat! : RARITY.locked!);
}

export const GLYPH_NAMES = Object.keys(G);
