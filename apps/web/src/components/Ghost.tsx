import { Bubble, type BubbleLook, type BubbleMood } from "./Bubble.tsx";

/** How an agent's bubble feels right now (the name stays from when agents were ghosts). */
export type GhostMood = BubbleMood;

/**
 * An agent's avatar. Agents were ghosts until 2026-11-25; every caller now gets a bubble
 * (Bubble.tsx) with the same props, so saved looks keep working: their colour tints the bubble
 * and a look without a bubble shape is round. Eyes, a mouth, a hat, something to wear and the idle
 * motion come back for looks saved with `parts` (the bubble Look editor, 2026-11-26).
 */
export function Ghost({
  look,
  seed,
  size = 40,
  mood = "awake",
  animate = true,
  tile = false,
  label,
  trackPointer = true,
  interactive = false,
  ambient = true,
  speakingLevel,
  talking = false,
  hop = false,
}: {
  look: BubbleLook | undefined;
  happy?: boolean;
  talking?: boolean;
  hop?: boolean;
  seed?: string;
  size?: number;
  mood?: GhostMood;
  animate?: boolean;
  wave?: boolean;
  tile?: boolean;
  label?: string;
  trackPointer?: boolean;
  interactive?: boolean;
  /** false: it stays still until something happens (calm lists) */
  ambient?: boolean;
  speakingLevel?: number;
}) {
  return <Bubble look={look} seed={seed} size={size} mood={mood} animate={animate && (ambient || mood !== "awake")} tile={tile} label={label} interactive={interactive} talking={talking} speakingLevel={speakingLevel} hop={hop} follow={trackPointer} />;
}
