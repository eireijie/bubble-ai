import { newBubbleLook, type GhostAppearance } from "@bubble-ai/core/src/appearance.ts";

/**
 * Round 11 (board 12): the twelve bubble colours the New agent sheet and Bubble look show, in the
 * board's order. Any of them saves as an ordinary #rrggbb colour.
 */
export const BOARD_COLORS: { name: string; hex: string }[] = [
  { name: "Violet", hex: "#b49cf7" },
  { name: "Blue", hex: "#7fb0f0" },
  { name: "Green", hex: "#6cc4a1" },
  { name: "Yellow", hex: "#e6c35c" },
  { name: "Orange", hex: "#f2a65a" },
  { name: "Pink", hex: "#e88fb4" },
  { name: "Red", hex: "#ef6b6b" },
  { name: "Stone", hex: "#9a8f86" },
  { name: "Teal", hex: "#5fc6d9" },
  { name: "Orchid", hex: "#c98af0" },
  { name: "Lime", hex: "#8fd16a" },
  { name: "Silver", hex: "#d0d0d6" },
];

const COLOR_WORDS: [RegExp, string][] = [
  [/\b(violet|purple|lavender|lilac)\b/, "#b49cf7"],
  [/\b(blue|navy|sky)\b/, "#7fb0f0"],
  [/\b(green|mint|sage|emerald)\b/, "#6cc4a1"],
  [/\b(yellow|gold|golden|sunny|lemon)\b/, "#e6c35c"],
  [/\b(orange|peach|amber|tangerine)\b/, "#f2a65a"],
  [/\b(pink|rose|blush|bubblegum)\b/, "#e88fb4"],
  [/\b(red|cherry|crimson|scarlet)\b/, "#ef6b6b"],
  [/\b(brown|stone|grey|gray|taupe|earthy)\b/, "#9a8f86"],
  [/\b(teal|cyan|aqua|turquoise)\b/, "#5fc6d9"],
  [/\b(orchid|magenta|plum)\b/, "#c98af0"],
  [/\b(lime|leaf|grass)\b/, "#8fd16a"],
  [/\b(white|silver|pale|light)\b/, "#d0d0d6"],
];

type Patch = Partial<GhostAppearance>;
const PART_WORDS: [RegExp, Patch][] = [
  [/\btop ?hat\b/, { hat: "tophat" }],
  [/\bparty\b/, { hat: "party" }],
  [/\bbeanie\b/, { hat: "beanie" }],
  [/\bcrown\b|\bking\b|\bqueen\b/, { hat: "crown" }],
  [/\bwitch\b/, { hat: "witch" }],
  [/\bheadphones?\b|\bmusic\b/, { hat: "headphones" }],
  [/\bhalo\b|\bangel\b/, { hat: "halo" }],
  [/\bflowers?\b/, { hat: "flower" }],
  [/\bpropeller\b/, { hat: "propeller" }],
  [/\bsunglasses\b|\bshades\b|\bcool\b/, { accessory: "sunglasses" }],
  [/\bglasses\b|\bnerdy\b|\bsmart\b/, { accessory: "glasses" }],
  [/\bmonocle\b|\bfancy\b/, { accessory: "monocle" }],
  [/\bbow ?tie\b/, { accessory: "bowtie" }],
  [/\bscarf\b|\bcozy\b|\bcosy\b/, { accessory: "scarf" }],
  [/\btie\b/, { accessory: "tie" }],
  [/\bmustache\b|\bmoustache\b/, { accessory: "mustache" }],
  [/\bbow\b(?! ?tie)/, { hat: "bow" }],
  [/\bfreckles?\b|\bcheeks?\b|\brosy\b/, { cheeks: true }],
  [/\bsmil(e|ing|ey)\b|\bhappy\b|\bcheerful\b/, { mouth: "smile", eyes: "happy" }],
  [/\bcat\b|\bkitty\b/, { mouth: "cat" }],
  [/\bfangs?\b|\bvampire\b|\bspooky\b/, { mouth: "fangs" }],
  [/\btongue\b|\bsilly\b|\bcheeky\b/, { mouth: "tongue" }],
  [/\bwink(ing|y)?\b/, { eyes: "wink" }],
  [/\bsparkl(e|y|ing)\b|\bshiny\b/, { eyes: "sparkle" }],
  [/\bbig eyes\b|\bcute\b/, { eyes: "big" }],
  [/\bbounc(e|y)\b|\benergetic\b/, { motion: "bounce" }],
  [/\bsway(ing)?\b/, { motion: "sway" }],
  [/\bstill\b|\bcalm\b|\bquiet\b/, { motion: "still" }],
  [/\bsquare\b|\bsquircle\b/, { bubble: "squircle" }],
  [/\begg\b/, { bubble: "egg" }],
  [/\bdrop\b|\bdroplet\b|\btear\b/, { bubble: "drop" }],
  [/\bblob\b|\bwobbly\b/, { bubble: "blob" }],
  [/\bcapsule\b|\bpill\b/, { bubble: "capsule" }],
  [/\bdouble\b|\btwins?\b/, { bubble: "double" }],
  [/\bcluster\b|\bbubbly\b/, { bubble: "cluster" }],
];

const SHAPES = ["round", "squircle", "blob", "egg"] as const;
const HATS = ["none", "beanie", "flower", "party"] as const;

/** A small seeded random, so the same words give the same four looks. */
function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * "Describe a look": four bubbles from a few words, read on this device (no AI). Words it knows
 * (colours, hats, glasses, a smile, freckles, a shape, how it moves) are kept in all four; whatever
 * the words leave open differs between them, so there is something to pick from.
 */
export function looksFromWords(text: string): GhostAppearance[] {
  const words = text.toLowerCase();
  const color = COLOR_WORDS.find(([re]) => re.test(words))?.[1];
  const said: Patch = {};
  for (const [re, patch] of PART_WORDS) if (re.test(words)) for (const [k, v] of Object.entries(patch)) if (!(k in said)) (said as Record<string, unknown>)[k] = v;
  const random = seeded(words.trim() || "bubble");
  return [0, 1, 2, 3].map((i) => {
    const base = newBubbleLook(random);
    const vary: Patch = {
      color: color ?? BOARD_COLORS[Math.floor(random() * BOARD_COLORS.length)].hex,
      bubble: SHAPES[i],
      shape: "round",
      hat: i === 0 ? "none" : HATS[i],
    };
    return { ...base, ...vary, ...said, color2: undefined, parts: true };
  });
}
