import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BUBBLE_SHAPES, type BubbleShape, type GhostAppearance } from "@wisp/core/src/appearance.ts";
import { useMotionReduced, motionReduced } from "../theme.ts";
import { useGhostActivity } from "../ghostActivity.ts";
import { familyColor } from "../ghostFamily.ts";
import "./bubble.css";

/** How the bubble feels right now; follows the agent's status where it matters. */
export type BubbleMood = "awake" | "listening" | "thinking" | "asleep" | "working" | "done" | "waiting" | "error";

interface Part {
  /** left, top, width, height in % of the bubble */
  l: number;
  t: number;
  w: number;
  h: number;
  r: string;
  rot?: number;
}
interface ShapeDef {
  name: string;
  parts: Part[];
  /** where the face sits, in % of the bubble, from the centre */
  face: [number, number];
}

const P = (l: number, t: number, w: number, h: number, r: string, rot?: number): Part => ({ l, t, w, h, r, rot });

/** The eight shapes of board 6 ("Bubble shapes, in each agent's Look"). */
export const BUBBLE_DEFS: Record<BubbleShape, ShapeDef> = {
  round: { name: "Round", parts: [P(0, 0, 100, 100, "50%")], face: [0, 0] },
  squircle: { name: "Squircle", parts: [P(2, 2, 96, 96, "40%")], face: [0, 0] },
  egg: { name: "Egg", parts: [P(7, 0, 86, 100, "50% 50% 50% 50% / 58% 58% 42% 42%")], face: [0, 4] },
  drop: { name: "Drop", parts: [P(10, 14, 80, 80, "50% 0 50% 50%", -45)], face: [0, 9] },
  blob: { name: "Blob", parts: [P(0, 4, 100, 92, "58% 42% 54% 46% / 46% 58% 42% 54%")], face: [0, 2] },
  capsule: { name: "Capsule", parts: [P(0, 16, 100, 70, "999px")], face: [0, 2] },
  double: { name: "Double", parts: [P(0, 18, 82, 82, "50%"), P(60, 0, 40, 40, "50%")], face: [-9, 10] },
  cluster: { name: "Cluster", parts: [P(2, 26, 72, 72, "50%"), P(50, 6, 44, 44, "50%"), P(64, 54, 34, 34, "50%")], face: [-12, 15] },
};

/** A look's bubble shape: saved looks from before bubbles have none and are round. */
export const bubbleShape = (look: Pick<GhostAppearance, "bubble"> | undefined): BubbleShape => (look?.bubble && (BUBBLE_SHAPES as readonly string[]).includes(look.bubble) ? look.bubble : "round");

/** The colour a bubble is tinted with: its own, or (for old white or grey looks) one picked from its seed. */
export const bubbleColor = (look: Pick<GhostAppearance, "color" | "color2"> | undefined, seed = ""): string => familyColor(look, seed || look?.color || "agent");

const MOOD_CLASS: Record<BubbleMood, string> = {
  awake: "bub-idle",
  listening: "bub-listen",
  thinking: "bub-work",
  working: "bub-work",
  waiting: "bub-need",
  error: "bub-error",
  asleep: "bub-sleep",
  done: "bub-done",
};

// --- eyes that follow the pointer -----------------------------------------------------------------

let following = false;
/**
 * One listener for the whole page: while the pointer is over a bubble its eyes follow it. Touch and
 * reduced motion never follow (the eyes just glance now and then). No React renders.
 */
function followPointer() {
  if (following || typeof document === "undefined") return;
  following = true;
  let cur: HTMLElement | null = null;
  const clear = () => {
    if (!cur) return;
    delete cur.dataset.hov;
    cur.style.removeProperty("--ex");
    cur.style.removeProperty("--ey");
    cur = null;
  };
  document.addEventListener(
    "pointermove",
    (ev) => {
      if (ev.pointerType === "touch" || motionReduced()) return clear();
      const t = ev.target as Element | null;
      let b = (t?.closest?.(".bub") as HTMLElement | null) ?? null;
      if (b && (b.dataset.nofollow !== undefined || !b.classList.contains("bub-move"))) b = null;
      if (b !== cur) clear();
      if (!b) return;
      cur = b;
      b.dataset.hov = "1";
      const r = b.getBoundingClientRect();
      const dx = (ev.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (ev.clientY - (r.top + r.height * 0.45)) / (r.height / 2);
      const d = Math.hypot(dx, dy);
      const k = d > 1 ? 1 / d : 1;
      b.style.setProperty("--ex", `${(dx * k * r.width * 0.08).toFixed(2)}px`);
      b.style.setProperty("--ey", `${(dy * k * r.height * 0.06).toFixed(2)}px`);
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", clear);
}

/** The bubble's own parts, without the moods: also used for the shape picker in Look. */
export function BubbleBody({ shape, color }: { shape: BubbleShape; color: string }) {
  const def = BUBBLE_DEFS[shape];
  return (
    <>
      {def.parts.map((p, i) => (
        <span key={i} className="bub-p" style={{ left: `${p.l}%`, top: `${p.t}%`, width: `${p.w}%`, height: `${p.h}%`, borderRadius: p.r, transform: p.rot ? `rotate(${p.rot}deg)` : undefined }}>
          <span className="bub-f" style={{ background: color }} />
          <span className="bub-r" />
          <span className="bub-h" style={p.rot ? { transform: `rotate(${-p.rot}deg)` } : undefined} />
        </span>
      ))}
    </>
  );
}

/**
 * An agent as a bubble. Clear with a rainbow rim, tinted with its colour, two eyes that glance
 * around and follow the pointer while it hovers. Moods: working bobs and sends up tiny bubbles,
 * waiting (needs you) hops with an orange dot, asleep (offline) goes grey with closed eyes.
 * All motion stops with `animate={false}`, reduced motion, or after the page has been left alone.
 */
export function Bubble({
  look,
  seed,
  size = 40,
  mood = "awake",
  animate = true,
  tile = false,
  label,
  interactive = false,
  talking = false,
  speakingLevel,
  hop = false,
  follow = true,
  className,
  style,
}: {
  look: Pick<GhostAppearance, "color" | "color2" | "bubble"> | undefined;
  seed?: string;
  size?: number;
  mood?: BubbleMood;
  animate?: boolean;
  tile?: boolean;
  label?: string;
  /** a click makes it spin once */
  interactive?: boolean;
  /** speaking (calls): it wobbles faster; bubbles have no mouth */
  talking?: boolean;
  speakingLevel?: number;
  /** one small hop each time this turns on */
  hop?: boolean;
  /** eyes follow the pointer while it's over the bubble (desktop) */
  follow?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const reduced = useMotionReduced();
  const moving = animate && !reduced && size >= 12;
  const activity = useGhostActivity(moving);
  const shape = bubbleShape(look);
  const color = bubbleColor(look, seed);
  const def = BUBBLE_DEFS[shape];
  // bubbles in one list don't blink or glance all at once
  const delay = useMemo(() => `${-(Math.random() * 12).toFixed(2)}s`, []);
  useEffect(() => {
    if (moving && follow) followPointer();
  }, [moving, follow]);
  const [spin, setSpin] = useState(0);
  const [hopping, setHopping] = useState(false);
  const hopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!hop || !moving) return;
    setHopping(true);
    clearTimeout(hopTimer.current);
    hopTimer.current = setTimeout(() => setHopping(false), 650);
    return () => clearTimeout(hopTimer.current);
  }, [hop, moving]);
  const speaking = talking || (speakingLevel !== undefined && speakingLevel > 0.05);
  const moodClass = speaking && mood !== "asleep" ? "bub-speak" : MOOD_CLASS[mood];
  const rim = Math.max(1.2, Math.min(2.4, size * 0.03));
  const cls = [
    "bub",
    `bub-${shape}`,
    moodClass,
    moving && "bub-move",
    moving && activity === "idle" && "bub-rest",
    hopping && "bub-hop-once",
    spin > 0 && "bub-spin",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      key={spin}
      className={cls}
      data-nofollow={follow ? undefined : ""}
      role={label === "" ? undefined : "img"}
      aria-label={label === "" ? undefined : (label ?? "agent")}
      aria-hidden={label === "" ? true : undefined}
      onClick={interactive && moving ? () => setSpin((n) => n + 1) : undefined}
      onAnimationEnd={(e) => e.animationName === "bub-spin" && e.currentTarget === e.target && setSpin(0)}
      style={{ width: size, height: size, ["--bub-c" as string]: color, ["--bub-rim" as string]: `${rim}px`, ["--bub-delay" as string]: delay, ...style }}
    >
      {tile && <span className="bub-tile" style={{ background: `color-mix(in srgb, ${color} 22%, transparent)` }} />}
      <span className="bub-ring" />
      <span className="bub-w">
        <BubbleBody shape={shape} color={color} />
        <span className="bub-face" style={def.face[0] || def.face[1] ? { transform: `translate(${def.face[0]}%, ${def.face[1]}%)` } : undefined}>
          <i className="bub-e bub-e1" />
          <i className="bub-e bub-e2" />
        </span>
      </span>
      <span className="bub-flag" />
    </span>
  );
}
