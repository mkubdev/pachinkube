/** Human-readable scores. Roguelite numbers get silly fast; keep them legible. */
const SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];

export function formatScore(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  if (n < 0) return "-" + formatScore(-n);
  if (n < 1_000_000) return Math.floor(n).toLocaleString("en-US");
  const tier = Math.min(Math.floor(Math.log10(n) / 3), SUFFIXES.length - 1);
  if (tier >= SUFFIXES.length - 1 && n >= 1e36) return n.toExponential(2);
  const scaled = n / 10 ** (tier * 3);
  return `${scaled.toFixed(scaled < 10 ? 2 : scaled < 100 ? 1 : 0)}${SUFFIXES[tier]}`;
}

export function formatMult(m: number): string {
  return `×${m % 1 === 0 ? m : m.toFixed(1)}`;
}
