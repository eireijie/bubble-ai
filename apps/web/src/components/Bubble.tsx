import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BUBBLE_SHAPES, type BubbleShape, type GhostAppearance } from "@bubble-ai/core/src/appearance.ts";
import { BubbleFaceWear, BubbleHat, BubbleMouth, BubbleNeckwear } from "./BubbleParts.tsx";
import { useMotionReduced, motionReduced } from "../theme.ts";
import { useGhostActivity } from "../ghostActivity.ts";
import { familyColor } from "../ghostFamily.ts";
import { liteEyes, restingGaze, watchBubble } from "./bubbleMotion.ts";
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
export interface ShapeDef {
  name: string;
  parts: Part[];
  /** where the face sits, in % of the bubble, from the centre */
  face: [number, number];
  /** what's worn on it, in % of the bubble: the top of the head, the bottom, and how wide the head is */
  top: [number, number];
  bottom: [number, number];
  width: number;
}

const P = (l: number, t: number, w: number, h: number, r: string, rot?: number): Part => ({ l, t, w, h, r, rot });

/**
 * The eight shapes of board 6 ("Bubble shapes, in each agent's Look"). Each one's visible extent
 * fills the box (round 4, 2026-11-27): a capsule, drop, double or cluster beside a round bubble
 * reads as the same size in the sidebar, a chat header or the shape picker.
 */
export const BUBBLE_DEFS: Record<BubbleShape, ShapeDef> = {
  round: { name: "Round", parts: [P(0, 0, 100, 100, "50%")], face: [0, 0], top: [50, 0], bottom: [50, 100], width: 100 },
  squircle: { name: "Squircle", parts: [P(0, 0, 100, 100, "40%")], face: [0, 0], top: [50, 0], bottom: [50, 100], width: 100 },
  egg: { name: "Egg", parts: [P(6, 0, 88, 100, "50% 50% 50% 50% / 58% 58% 42% 42%")], face: [0, 4], top: [50, 0], bottom: [50, 100], width: 88 },
  // a square turned 45°: its point reaches 0.707 of its side above the centre, its round side half a side below
  drop: { name: "Drop", parts: [P(9, 17, 82, 82, "50% 0 50% 50%", -45)], face: [0, 12], top: [50, 12], bottom: [50, 99], width: 76 },
  blob: { name: "Blob", parts: [P(0, 2, 100, 96, "58% 42% 54% 46% / 46% 58% 42% 54%")], face: [0, 1], top: [50, 2], bottom: [50, 98], width: 100 },
  capsule: { name: "Capsule", parts: [P(0, 11, 100, 78, "999px")], face: [0, 0], top: [50, 11], bottom: [50, 89], width: 92 },
  double: { name: "Double", parts: [P(0, 12, 88, 88, "50%"), P(64, 0, 36, 36, "50%")], face: [-6, 6], top: [44, 12], bottom: [44, 100], width: 88 },
  cluster: { name: "Cluster", parts: [P(0, 20, 80, 80, "50%"), P(56, 0, 40, 40, "50%"), P(70, 58, 30, 30, "50%")], face: [-10, 10], top: [40, 20], bottom: [40, 100], width: 80 },
};

/** What a bubble can wear, as saved in a look. */
export type BubbleLook = Pick<GhostAppearance, "color"> & Partial<Pick<GhostAppearance, "color2" | "bubble" | "eyes" | "mouth" | "hat" | "accessory" | "motion" | "parts">>;

/** A look's eyes, mouth, hat, accessory and motion; looks saved before these came back get plain eyes and nothing else. */
export function bubbleParts(look: BubbleLook | undefined): Required<Pick<GhostAppearance, "eyes" | "mouth" | "hat" | "accessory" | "motion">> {
  const on = !!look?.parts;
  return {
    eyes: (on && look?.eyes) || "dots",
    mouth: (on && look?.mouth) || "none",
    hat: (on && look?.hat) || "none",
    accessory: (on && look?.accessory) || "none",
    motion: (on && look?.motion) || "float",
  };
}

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
      // a glance from the shared timer gives way to the pointer
      b.style.removeProperty("--gx");
      b.style.removeProperty("--gy");
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
          <span className="bub-f" style={{ ["--bub-c" as string]: color }} />
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
  look: BubbleLook | undefined;
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
  const worn = bubbleParts(look);
  // a hat or something to wear needs some size to read; tiny bubbles keep just their eyes
  const hat = size >= 20 ? worn.hat : "none";
  const accessory = size >= 20 ? worn.accessory : "none";
  const mouth = size >= 24 ? worn.mouth : "none";
  // bubbles in one list don't blink or glance all at once
  const delay = useMemo(() => `${-(Math.random() * 12).toFixed(2)}s`, []);
  // idle eyes rest to one side, steadily per agent
  const [rx, ry] = restingGaze(seed || look?.color || "agent");
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
  // Small bubbles (lists, pins, chat headers) hold their body still and blink and glance from one
  // shared timer (bubbleMotion.ts); big ones keep every CSS loop. Working eyes still scan in CSS.
  const lite = moving && size <= 80;
  const scans = moodClass === "bub-work";
  const glances = moodClass === "bub-idle" || moodClass === "bub-done" || moodClass === "bub-sleep";
  const sleepy = moodClass === "bub-sleep";
  const motionRef = useCallback(
    (el: HTMLSpanElement | null) => {
      if (!el || !moving) return;
      const unwatch = watchBubble(el);
      const unlite = lite && !scans ? liteEyes(el, { sleepy, glances }) : undefined;
      return () => {
        unwatch();
        unlite?.();
      };
    },
    [moving, lite, scans, sleepy, glances],
  );
  const rim = Math.max(1.2, Math.min(2.4, size * 0.03));
  const cls = [
    "bub",
    `bub-${shape}`,
    size <= 80 && "bub-small",
    `bub-eyes-${worn.eyes}`,
    `bub-m-${worn.motion}`,
    hat !== "none" && "bub-hatted",
    moodClass,
    moving && "bub-move",
    lite && "bub-lite",
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
      ref={motionRef}
      className={cls}
      data-nofollow={follow ? undefined : ""}
      role={label === "" ? undefined : "img"}
      aria-label={label === "" ? undefined : (label ?? "agent")}
      aria-hidden={label === "" ? true : undefined}
      onClick={interactive && moving ? () => setSpin((n) => n + 1) : undefined}
      onAnimationEnd={(e) => e.animationName === "bub-spin" && e.currentTarget === e.target && setSpin(0)}
      style={{ width: size, height: size, ["--bub-c" as string]: color, ["--bub-rim" as string]: `${rim}px`, ["--bub-delay" as string]: delay, ["--rx" as string]: `${Math.round(rx * 100)}%`, ["--ry" as string]: `${Math.round(ry * 100)}%`, ...style }}
    >
      {tile && <span className="bub-tile" style={{ background: `color-mix(in srgb, ${color} 22%, transparent)` }} />}
      <span className="bub-ring" />
      <span className="bub-w">
        <BubbleBody shape={shape} color={color} />
        <span className="bub-face" style={def.face[0] || def.face[1] ? { transform: `translate(${def.face[0]}%, ${def.face[1]}%)` } : undefined}>
          <BubbleEyes eyes={worn.eyes} />
          {mouth !== "none" && <BubbleMouth kind={mouth} />}
          {accessory !== "none" && <BubbleFaceWear kind={accessory} />}
        </span>
        {/* worn things sit on the body, so they wobble, hop and spin with it and never slide on their own */}
        {accessory !== "none" && <BubbleNeckwear kind={accessory} def={def} />}
        {hat !== "none" && <BubbleHat kind={hat} def={def} animate={moving} />}
      </span>
      <span className="bub-flag" />
    </span>
  );
}

/** Two eyes in the look's style. Arcs (happy, a wink) are drawn; the others are round eyes with their own shine (bubble.css). */
export function BubbleEyes({ eyes }: { eyes: string }) {
  const arc = (
    <svg viewBox="0 0 10 6" aria-hidden>
      <path d="M1.2 5 Q5 -1.2 8.8 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
  const happy = eyes === "happy";
  const second = happy || eyes === "wink";
  return (
    <>
      <i className={happy ? "bub-e bub-e1 bub-arc" : "bub-e bub-e1"}>{happy && arc}</i>
      <i className={second ? "bub-e bub-e2 bub-arc" : "bub-e bub-e2"}>{second && arc}</i>
    </>
  );
}
