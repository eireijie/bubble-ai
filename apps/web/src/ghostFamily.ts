import type { GhostAppearance, GhostShape } from "@wisp/core";

/**
 * The ghost family (canvas Avatar, 2026-11-20): every agent is a flat, one-colour ghost with two
 * eyes, and each gets its own silhouette and colour. Saved looks keep their core shape names; each
 * maps onto one family silhouette so nothing stored has to change.
 */
export type Silhouette = "drop" | "soft" | "tall" | "wide" | "block" | "ghost";

const HEM = "l-4.7-3.3-4.6 3.3-4.7-3.3-4.7 3.3-4.6-3.3";
/** 40×40 paths and the eyes' height, straight from the canvas. */
export const SILHOUETTES: Record<Silhouette, { d: string; ey: number; label: string }> = {
  drop: { d: "M20 3c6 6 14 9 14 18v14" + HEM + "L6 35V21C6 12 14 9 20 3Z", ey: 21, label: "Drop" },
  soft: { d: "M6 18a14 14 0 0 1 28 0v14a3.5 3.5 0 0 1-7 0 3.5 3.5 0 0 1-7 0 3.5 3.5 0 0 1-7 0 3.5 3.5 0 0 1-7 0Z", ey: 18, label: "Soft" },
  tall: { d: "M9 14a11 11 0 0 1 22 0v22l-3.7-2.6-3.6 2.6-3.7-2.6-3.7 2.6-3.6-2.6L9 36Z", ey: 15, label: "Tall" },
  wide: { d: "M3 22a17 13 0 0 1 34 0v12l-5.7-3-5.6 3-5.7-3-5.7 3-5.6-3L3 34Z", ey: 21, label: "Wide" },
  block: { d: "M6 14a8 8 0 0 1 8-8h12a8 8 0 0 1 8 8v21" + HEM + "L6 35Z", ey: 18, label: "Block" },
  ghost: { d: "M6 18.5a14 14 0 0 1 28 0V35" + HEM + "L6 35Z", ey: 18, label: "Classic" },
};

/** Saved shape → family silhouette. */
export const SHAPE_TO_SILHOUETTE: Record<GhostShape, Silhouette> = {
  wisp: "drop",
  sheet: "soft",
  tall: "tall",
  round: "wide",
  classic: "ghost",
};

/** The family's colours, picked on creation (canvas Foundations). */
export const FAMILY_COLORS = ["#a98bf5", "#3cc0a6", "#f2a04a", "#6aa2f5", "#ef7fa8", "#cfd36a"] as const;
/** Offline ghosts all wear the same quiet gray. */
export const ASLEEP_COLOR = "#9a9da1";

function hash(s: string) {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 99991;
  return h;
}
const hex = (c: string | undefined) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : undefined);
function chroma(c: string) {
  const n = parseInt(c.slice(1), 16);
  const v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return Math.max(...v) - Math.min(...v);
}
function light(c: string) {
  const n = parseInt(c.slice(1), 16);
  return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
}

/**
 * One flat colour for a look. A look with a real colour keeps its more vivid colour; white or
 * near-gray looks (the old default) get a family colour picked from the seed, so the sidebar
 * never fills with white ghosts on a white page.
 */
export function familyColor(look: Pick<GhostAppearance, "color" | "color2"> | undefined, seed: string): string {
  const a = hex(look?.color);
  const b = hex(look?.color2);
  const best = [a, b].filter((c): c is string => !!c).sort((x, y) => chroma(y) - chroma(x))[0];
  if (best && chroma(best) >= 40 && light(best) > 0.2) return best;
  if (best && chroma(best) < 40 && light(best) < 0.55) return best; // a deliberate dark or slate ghost
  return FAMILY_COLORS[hash(seed || "agent") % FAMILY_COLORS.length];
}

export function silhouetteOf(look: Pick<GhostAppearance, "shape"> | undefined): Silhouette {
  return (look && SHAPE_TO_SILHOUETTE[look.shape]) || "ghost";
}

/** Eyes read dark on light bodies and light on very dark ones. */
export function eyeInk(color: string) {
  return light(color) < 0.32 ? "rgba(255,255,255,.92)" : "rgba(20,20,20,.88)";
}

export const seedDelay = (seed: string) => ({ wd: `-${(hash(seed) % 37) / 10}s`, wb: `${(hash(seed) % 23) / 10}s` });
