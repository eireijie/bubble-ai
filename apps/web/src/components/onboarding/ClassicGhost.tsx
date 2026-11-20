import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { GhostAppearance, GhostShape } from "@wisp/core";
import { GHOST_ASLEEP, GHOST_WHITE } from "@wisp/core/src/appearance.ts";
import { useMotionReduced } from "../../theme.ts";
import "./classicGhost.css";

/**
 * Onboarding's ghost: the classic (pre-family) drawing, kept here so onboarding can use it while
 * the rest of the app has the new ghost family. Same drawing as the old Ghost, calmer: slower and
 * smaller idle motion, no arms, no thought bubbles or sparkles, and one extra at a time.
 */
export type ClassicMood = "awake" | "listening" | "thinking" | "asleep" | "working" | "done" | "waiting" | "error";

const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));

interface ShapeDef {
  /** body path, and an alternate with the hem rippled the other way (animated between) */
  body: [string, string];
  eyes: { y: number; x: [number, number] };
  mouthY: number;
  /** top of the head, where hats sit */
  top: number;
  /** the body's lowest point; the body gradient (shared with the arms) runs from top to here */
  bottom: number;
  hatScale: number;
  /** a point on the head's edge, up and to the right, where a bow or flower clips on */
  clip: { x: number; y: number };
  /** where neckwear goes, half the body width there, and how far down the body stays solid (where the hem starts) */
  neck: { y: number; half: number; hem: number };
  /** where its shadow sits, just under the hem */
  ground: number;
}

const swap = (d: string, a: string, b: string) => d.replaceAll(a, "§").replaceAll(b, a).replaceAll("§", b);

const CLASSIC = "M30 60 C30 32 44 18 60 18 C76 18 90 32 90 60 L90 96 Q85 104 80 96 Q75 88 70 96 Q65 104 60 96 Q55 88 50 96 Q45 104 40 96 Q35 88 30 96 Z";
const ROUND = "M22 64 C22 38 38 26 60 26 C82 26 98 38 98 64 L98 92 Q92 100 86 92 Q80 84 74 92 Q67 100 60 92 Q53 84 46 92 Q40 100 34 92 Q28 84 22 92 Z";
const TALL = "M38 52 C38 24 47 10 60 10 C73 10 82 24 82 52 L82 102 Q76.5 110 71 102 Q65.5 94 60 102 Q54.5 110 49 102 Q43.5 94 38 102 Z";
const SHEET_A = "M42 52 C42 28 50 16 60 16 C70 16 78 28 78 52 C80 72 92 86 100 100 Q93 95 86 102 Q78 95 70 102 Q60 95 50 102 Q42 95 34 102 Q27 95 20 100 C28 86 40 72 42 52 Z";
const SHEET_B = "M42 52 C42 28 50 16 60 16 C70 16 78 28 78 52 C80 72 92 86 100 100 Q93 105 86 98 Q78 105 70 98 Q60 105 50 98 Q42 105 34 98 Q27 105 20 100 C28 86 40 72 42 52 Z";
const WISP_A = "M60 16 C80 16 90 32 90 52 C90 74 78 84 68 90 C60 95 58 104 66 108 C52 110 46 98 50 90 C36 84 30 72 30 52 C30 32 40 16 60 16 Z";
const WISP_B = "M60 16 C80 16 90 32 90 52 C90 74 80 86 70 92 C62 97 64 106 72 110 C58 110 52 100 52 92 C38 86 30 72 30 52 C30 32 40 16 60 16 Z";

const SHAPES: Record<GhostShape, ShapeDef> = {
  // hatScale: the head's width just under its top, against the classic head's (measured from the paths), so a
  // hat covers the same part of every head; neck.half: the body's half-width at the neck
  classic: { body: [CLASSIC, swap(CLASSIC, "104", "88")], eyes: { y: 54, x: [50, 70] }, mouthY: 66, top: 18, bottom: 100, hatScale: 1, clip: { x: 75, y: 23 }, neck: { y: 77, half: 30, hem: 98 }, ground: 111 },
  round: { body: [ROUND, swap(ROUND, "100", "84")], eyes: { y: 58, x: [47, 73] }, mouthY: 70, top: 26, bottom: 96, hatScale: 1.38, clip: { x: 83, y: 32 }, neck: { y: 80, half: 38, hem: 92 }, ground: 107 },
  tall: { body: [TALL, swap(TALL, "110", "94")], eyes: { y: 44, x: [52, 68] }, mouthY: 56, top: 10, bottom: 106, hatScale: 0.77, clip: { x: 72, y: 15 }, neck: { y: 68, half: 22, hem: 100 }, ground: 115 },
  sheet: { body: [SHEET_A, SHEET_B], eyes: { y: 46, x: [53, 67] }, mouthY: 57, top: 16, bottom: 102, hatScale: 0.65, clip: { x: 70, y: 21 }, neck: { y: 64, half: 20.5, hem: 96 }, ground: 110 },
  wisp: { body: [WISP_A, WISP_B], eyes: { y: 50, x: [50, 70] }, mouthY: 62, top: 16, bottom: 109, hatScale: 1.09, clip: { x: 77, y: 21 }, neck: { y: 72, half: 25.7, hem: 92 }, ground: 115 },
};

// --- color helpers ------------------------------------------------------------------------------

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance([r, g, b]: [number, number, number]) {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const safeColor = (c: string | undefined, fallback: string) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback);

/** One-color ghosts (from before gradients) fade to a deeper, slightly richer shade of themselves. */
function shade(hex: string): string {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return `hsl(${Math.round(h * 60 + 12)} ${Math.round(Math.min(1, s + 0.12) * 100)}% ${Math.round(Math.max(0.12, l - 0.16) * 100)}%)`;
}

/** Zz and thought marks, the same warm yellow on every palette (like Paperclip's). */

const DEFAULT_LOOK: GhostAppearance = { shape: "classic", ...GHOST_WHITE, eyes: "dots", mouth: "smile", cheeks: false, hat: "none", accessory: "none", motion: "float" };

export function ClassicGhost({
  look = DEFAULT_LOOK,
  size = 40,
  mood = "awake",
  animate = true,
  trackPointer = false,
  label,
  hop = false,
  smiling = false,
  talking = false,
  working = false,
}: {
  look?: GhostAppearance;
  size?: number;
  mood?: ClassicMood;
  animate?: boolean;
  /** face and body turn gently toward the pointer when it comes near */
  trackPointer?: boolean;
  label?: string;
  /** one small hop each time it turns on */
  hop?: boolean;
  smiling?: boolean;
  talking?: boolean;
  /** heads down at a small laptop */
  working?: boolean;
}) {
  const reduced = useMotionReduced();
  const animated = animate && !reduced;
  const root = useRef<HTMLSpanElement>(null);
  const face = useRef<SVGGElement>(null);
  const lean = useRef<SVGGElement>(null);
  const [near, setNear] = useState(false);
  const busy = working || mood === "working";
  const tracks = animated && trackPointer && size >= 24 && !busy && mood !== "asleep";

  useEffect(() => {
    if (!tracks) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    let on = false;
    const paint = () => {
      frame = 0;
      const el = root.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const reach = r.width * 0.8;
      const inside = !!last && last.clientX > r.left - reach && last.clientX < r.right + reach && last.clientY > r.top - reach && last.clientY < r.bottom + reach;
      if (inside && last) {
        const fx = clamp((last.clientX - (r.left + r.width / 2)) / r.width, 1);
        const fy = clamp((last.clientY - (r.top + r.height * 0.45)) / r.height, 1);
        face.current?.style.setProperty("transform", `translate(${(fx * 3.5).toFixed(2)}px,${(fy * 2.5).toFixed(2)}px)`);
        lean.current?.style.setProperty("transform", `rotate(${(fx * 3).toFixed(1)}deg)`);
      } else {
        face.current?.style.removeProperty("transform");
        lean.current?.style.removeProperty("transform");
      }
      if (inside !== on) {
        on = inside;
        setNear(inside);
      }
    };
    const move = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const leave = () => {
      last = null;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      face.current?.style.removeProperty("transform");
      lean.current?.style.removeProperty("transform");
      setNear(false);
    };
  }, [tracks]);

  // a hop plays once each time `hop` (or the "done" mood) turns on
  const [hops, setHops] = useState(0);
  const hopping = hop || mood === "done";
  useEffect(() => {
    if (hopping && animated) setHops((n) => n + 1);
  }, [hopping, animated]);

  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const shape = SHAPES[look.shape as GhostShape] ?? SHAPES.classic;
  const asleep = mood === "asleep";
  const happy = mood === "done" || (smiling && !busy);
  const top = asleep ? GHOST_ASLEEP.color : safeColor(look.color, "#f4f1ff");
  const bottom = asleep ? GHOST_ASLEEP.color2 : look.color2 ? safeColor(look.color2, top) : shade(top);
  const [r1, g1, b1] = rgb(top);
  const [r2, g2, b2] = look.color2 && !asleep ? rgb(safeColor(look.color2, top)) : asleep ? rgb(GHOST_ASLEEP.color2) : [r1 * 0.8, g1 * 0.8, b1 * 0.8];
  const dark = luminance([(r1 + r2) / 2, (g1 + g2) / 2, (b1 + b2) / 2]) < 0.16;
  const ink = dark ? "#f7f7f8" : "#1d1d1f";
  // calmer: bounce reads as float, sway is half as wide; nothing moves while it works or sleeps
  const motion = look.motion === "still" ? null : look.motion === "sway" ? "sway" : "float";
  const moving = animated && !!motion && !busy;
  const details = size >= 26;
  const grounded = size >= 28;
  const rippling = animated && size >= 44 && !busy;
  const { x: [ex1, ex2], y: ey } = shape.eyes;
  const ripple = rippling ? <animate attributeName="d" dur="3.8s" repeatCount="indefinite" values={`${shape.body[0]};${shape.body[1]};${shape.body[0]}`} calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" /> : null;
  // one extra at a time: while it works or talks, what it wears on its face steps aside
  const faceWear = FACE_WEAR.has(look.accessory) && !busy && !talking;
  const eyes = happy ? "happy" : asleep ? "closed" : mood === "listening" ? "big" : look.eyes;
  const mouthStyle = asleep || busy || mood === "thinking" ? "flat" : near || smiling ? "smile" : look.mouth;
  const showMouth = look.accessory !== "mustache" || look.mouth === "none" || !faceWear;

  return (
    <span
      ref={root}
      className={cx("cg relative inline-grid place-items-center shrink-0", !animated && "cg-still")}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox={look.hat === "none" ? "4.5 8 111 111" : "-8 -18 136 140"} width={size} height={size} overflow="visible">
        <defs>
          <linearGradient id={`b${uid}`} gradientUnits="userSpaceOnUse" x1="0" y1={shape.top} x2="0" y2={shape.bottom}>
            <stop offset="0.08" stopColor={top} />
            <stop offset="0.95" stopColor={bottom} />
          </linearGradient>
          <radialGradient id={`l${uid}`} cx="0.5" cy="0.42" r="0.6">
            <stop offset="0" stopColor="white" stopOpacity={asleep ? 0.1 : 0.24} />
            <stop offset="0.65" stopColor="white" stopOpacity="0.06" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <clipPath id={`c${uid}`}>
            <path d={shape.body[0]}>{ripple}</path>
          </clipPath>
        </defs>

        {grounded && <ellipse cx="60" cy={shape.ground} rx="24" ry="3.4" className={cx("cg-ground", moving && motion === "float" && "cg-ground-float")} />}

        <g key={hops} className={hops > 0 && animated ? "cg-hop" : undefined}>
          <g className={moving ? `cg-${motion}` : undefined}>
            <g ref={lean} className="cg-lean">
              <path d={shape.body[0]} fill={`url(#b${uid})`}>{ripple}</path>
              <path d={shape.body[0]} fill={`url(#l${uid})`}>{ripple}</path>
              <path d={shape.body[0]} fill="none" stroke="black" strokeOpacity="0.1" strokeWidth="7" clipPath={`url(#c${uid})`}>
                {ripple}
              </path>

              <g ref={face} className="cg-face">
                <g transform={busy && !happy ? "translate(0 3)" : mood === "listening" ? "translate(0 -2)" : undefined}>
                  {look.cheeks && !asleep && (
                    <>
                      <ellipse cx={ex1 - 4} cy={ey + 8} rx="4.5" ry="2.6" fill="#ff8fab" opacity="0.45" />
                      <ellipse cx={ex2 + 4} cy={ey + 8} rx="4.5" ry="2.6" fill="#ff8fab" opacity="0.45" />
                    </>
                  )}
                  <Eyes details={details} style={eyes} x={[ex1, ex2]} y={ey} ink={ink} blink={animated && details && !asleep && !busy} thinking={mood === "thinking"} working={busy && !happy} />
                  {talking ? (
                    <ellipse cx="60" cy={shape.mouthY + 1} rx="3.4" ry="3.6" fill={ink} className={animated ? "cg-talk" : undefined} />
                  ) : (
                    showMouth && <Mouth style={mouthStyle} x={60} y={shape.mouthY} ink={ink} />
                  )}
                  {faceWear && (
                    <g className="cg-worn">
                      <Accessory kind={look.accessory} shape={shape} />
                    </g>
                  )}
                </g>
              </g>
              {look.accessory !== "none" && !FACE_WEAR.has(look.accessory) && !busy && (
                <g className="cg-worn">
                  <Accessory kind={look.accessory} shape={shape} />
                </g>
              )}
              {look.hat !== "none" && (
                <g className="cg-worn">
                  <g transform={CLIPPED.has(look.hat) ? `translate(${shape.clip.x} ${shape.clip.y}) scale(${shape.hatScale})` : `translate(60 ${shape.top + (HAT_SINK[look.hat] ?? 2.5)}) scale(${shape.hatScale})`}>
                    <Hat kind={look.hat} />
                  </g>
                </g>
              )}
            </g>
            {busy && details && <Laptop y={shape.bottom - 22} />}
          </g>
        </g>

        {asleep && details && (
          <text x="92" y={shape.top + 6} fontSize="14" fill={MARK} fontFamily="ui-rounded, system-ui, sans-serif" fontWeight="800" className={animated ? "cg-z" : undefined}>
            z
          </text>
        )}
      </svg>
    </span>
  );
}

/** A small laptop it holds in front while it works: two lines of "code" grow and shrink on the screen. */
function Laptop({ y }: { y: number }) {
  const accent = "#7c6cf0";
  return (
    <g>
      <rect x="38" y={y} width="44" height="26" rx="3.2" fill="#2b2b2e" />
      <rect x="41.5" y={y + 3.2} width="37" height="19" rx="1.6" fill="rgba(255,255,255,.94)" />
      <rect className="cg-type" x="45" y={y + 7.5} width="22" height="2.6" rx="1.3" fill={accent} />
      <rect className="cg-type b" x="45" y={y + 13.5} width="15" height="2.6" rx="1.3" fill={accent} />
      <rect x="31" y={y + 25} width="58" height="5" rx="2.5" fill="#3d3d42" />
    </g>
  );
}
const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

/** Accessories worn on the face; neckwear stays with the body. */
const FACE_WEAR = new Set<GhostAppearance["accessory"]>(["glasses", "sunglasses", "monocle", "mustache"]);

/**
 * How far each hat's brim sits down into the head, in viewBox units. The same depth works for every
 * shape: at it, each head is as wide (relative to its hat scale) as the classic one.
 */
/** Worn clipped to the side of the head rather than on top of it. */
const CLIPPED = new Set<GhostAppearance["hat"]>(["bow", "flower"]);

const HAT_SINK: Partial<Record<GhostAppearance["hat"], number>> = { tophat: 3, party: 2, beanie: 4.5, crown: 2.5, witch: 3, headphones: 0, bow: 0, halo: 0, flower: 0, propeller: 4 };

/** where the "done" sparkles twinkle: x, y below the head's top, size, delay */

function Eyes({ style, x, y, ink, blink, thinking, working, details }: { details: boolean; style: GhostAppearance["eyes"] | "closed" | "dizzy"; x: [number, number]; y: number; ink: string; blink: boolean; thinking: boolean; working: boolean }) {
  const look = thinking ? { dx: 1.4, dy: -1.6 } : { dx: 0, dy: working ? 2.5 : 0 };
  const one = (cx: number, i: number): ReactNode => {
    switch (style) {
      case "dizzy":
        return <path d={`M${cx - 5} ${y} c0 -7 11 -7 11 0 c0 6 -9 6 -9 0 c0 -3 6 -3 6 0 q0 3 -3 1`} stroke={ink} strokeWidth="1.8" fill="none" strokeLinecap="round" />;
      case "closed":
        return <path d={`M${cx - 4.5} ${y} Q${cx} ${y + 3.6} ${cx + 4.5} ${y}`} stroke={ink} strokeWidth="2.4" fill="none" strokeLinecap="round" />;
      case "happy":
        return <path d={`M${cx - 4.8} ${y + 1.5} Q${cx} ${y - 4.5} ${cx + 4.8} ${y + 1.5}`} stroke={ink} strokeWidth="2.6" fill="none" strokeLinecap="round" />;
      case "big":
        return (
          <>
            <circle cx={cx} cy={y} r="6.2" fill="white" />
            <g >
              <circle cx={cx + look.dx} cy={y + 0.5 + look.dy} r="3.6" fill="#2a2340" />
              {details && <g ><circle cx={cx + 1.4 + look.dx} cy={y - 1 + look.dy} r="1.2" fill="white" /></g>}
            </g>
          </>
        );
      case "sparkle":
        return (
          <g >
            <ellipse cx={cx + look.dx * 0.5} cy={y + look.dy * 0.5} rx="4.4" ry="5.6" fill={ink} />
            <g >
              <circle cx={cx + 1.4} cy={y - 2} r="1.6" fill="white" opacity="0.95" />
              <circle cx={cx - 1.4} cy={y + 2} r="0.9" fill="white" opacity="0.8" />
            </g>
          </g>
        );
      case "wink":
        return i === 1 ? (
          <path d={`M${cx - 4.6} ${y} Q${cx} ${y - 3.6} ${cx + 4.6} ${y}`} stroke={ink} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        ) : (
          <g ><ellipse cx={cx} cy={y} rx="3.4" ry="4.4" fill={ink} /></g>
        );
      default:
        return (
          <g >
            <ellipse cx={cx + look.dx * 0.6} cy={y + look.dy * 0.6} rx="3.9" ry="4.9" fill={ink} />
            {details && <g  fill="white">
              <circle cx={cx + 1.3 + look.dx * 0.6} cy={y - 1.8 + look.dy * 0.6} r="1.4" opacity="0.95" />
              <circle cx={cx - 1.2 + look.dx * 0.6} cy={y + 1.9 + look.dy * 0.6} r="0.7" opacity="0.8" />
            </g>}
          </g>
        );
    }
  };
  const canBlink = blink && (style === "dots" || style === "big" || style === "sparkle");
  return (
    <g className={canBlink ? "cg-blink" : undefined}>
      {one(x[0], 0)}
      {one(x[1], 1)}
    </g>
  );
}

function Mouth({ style, x, y, ink }: { style: GhostAppearance["mouth"] | "flat" | "wavy"; x: number; y: number; ink: string }) {
  switch (style) {
    case "wavy":
      return <path d={`M${x - 5} ${y + 1} q1.7 -3 3.4 0 t3.4 0 t3.4 0`} stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round" />;
    case "flat": // concentrating, or dozing
      return <path d={`M${x - 3.2} ${y + 1.2} L${x + 3.2} ${y + 1.2}`} stroke={ink} strokeWidth="2.2" strokeLinecap="round" />;
    case "open":
      return (
        <g>
          <ellipse cx={x} cy={y + 1} rx="3.4" ry="4" fill={ink} />
          <ellipse cx={x} cy={y + 3} rx="2.2" ry="1.4" fill="#ff7a93" />
        </g>
      );
    case "cat":
      return <path d={`M${x - 5.5} ${y} Q${x - 2.75} ${y + 3.6} ${x} ${y} Q${x + 2.75} ${y + 3.6} ${x + 5.5} ${y}`} stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round" />;
    case "fangs":
      return (
        <g>
          <path d={`M${x - 6} ${y} Q${x} ${y + 4.5} ${x + 6} ${y}`} stroke={ink} strokeWidth="2.1" fill="none" strokeLinecap="round" />
          <path d={`M${x - 4} ${y + 1.6} l1.4 3.6 l1.4 -3.2 Z M${x + 1.2} ${y + 1.9} l1.4 3.2 l1.4 -3.6 Z`} fill="white" stroke={ink} strokeWidth="0.6" strokeLinejoin="round" />
        </g>
      );
    case "tongue":
      return (
        <g>
          <path d={`M${x - 5} ${y} Q${x} ${y + 4} ${x + 5} ${y}`} stroke={ink} strokeWidth="2.1" fill="none" strokeLinecap="round" />
          <path d={`M${x + 0.2} ${y + 1.6} q0 5 3.2 5 q3.2 0 2.6 -5.8 Z`} fill="#ff7a93" />
        </g>
      );
    case "none":
      return null;
    default:
      return <path d={`M${x - 4.5} ${y} Q${x} ${y + 4.2} ${x + 4.5} ${y}`} stroke={ink} strokeWidth="2.2" fill="none" strokeLinecap="round" />;
  }
}

/** Hats are drawn around the head's top center at (0, 0); negative y is up. */
function Hat({ kind }: { kind: GhostAppearance["hat"] }) {
  switch (kind) {
    case "tophat":
      return (
        <g>
          <rect x="-13" y="-25" width="26" height="25" rx="3" fill="#2b2735" />
          <rect x="-13" y="-9" width="26" height="5" fill="#e5484d" />
          <rect x="-21" y="-2" width="42" height="5.5" rx="2.75" fill="#2b2735" />
        </g>
      );
    case "party":
      return (
        <g>
          <path d="M-12 3 L12 3 L0 -27 Z" fill="#ff8fab" />
          <path d="M-8.4 -6 L6.6 -6.4 M-4.5 -15.6 L3.2 -15.8" stroke="#ffd166" strokeWidth="3" strokeLinecap="round" />
          <circle cx="0" cy="-28" r="4" fill="#ffd166" />
        </g>
      );
    case "beanie":
      return (
        <g>
          <path d="M-21 6 Q-21 -16 0 -16 Q21 -16 21 6 Z" fill="#5b8def" />
          <rect x="-22.5" y="0" width="45" height="8" rx="4" fill="#3f6fd8" />
          <circle cx="0" cy="-17" r="5" fill="#f8fafc" />
        </g>
      );
    case "crown":
      return (
        <g>
          <path d="M-15 3 L-15 -12 L-7.5 -4.5 L0 -17 L7.5 -4.5 L15 -12 L15 3 Z" fill="#ffcf3f" stroke="#e0a800" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="0" cy="-4" r="2.4" fill="#ff5d73" />
          <circle cx="-9" cy="-1.5" r="1.7" fill="#4dabf7" />
          <circle cx="9" cy="-1.5" r="1.7" fill="#4dabf7" />
        </g>
      );
    case "witch":
      return (
        <g>
          <path d="M-13 1 L-2 -30 Q4 -36 13 -30 Q5 -27 3 -22 L13 1 Z" fill="#4b2e83" />
          <rect x="-13" y="-5" width="26" height="4.5" fill="#ffb703" />
          <ellipse cx="0" cy="2" rx="27" ry="5" fill="#4b2e83" />
        </g>
      );
    case "headphones":
      return (
        <g>
          <path d="M-28 24 C-30 -10 30 -10 28 24" stroke="#2b2735" strokeWidth="5" fill="none" strokeLinecap="round" />
          <rect x="-34" y="16" width="10" height="16" rx="4.5" fill="#ff6b6b" />
          <rect x="24" y="16" width="10" height="16" rx="4.5" fill="#ff6b6b" />
        </g>
      );
    case "bow":
      return (
        <g transform="rotate(18)">
          <path d="M0 0 L-10 -7 L-10 7 Z M0 0 L10 -7 L10 7 Z" fill="#ff6fa3" strokeLinejoin="round" />
          <circle r="3" fill="#ff3d7f" />
        </g>
      );
    case "halo":
      return <ellipse cx="0" cy="-11" rx="16" ry="4.5" fill="none" stroke="#ffd84d" strokeWidth="3.6" className={undefined} />;
    case "flower":
      return (
        <g>
          {[0, 72, 144, 216, 288].map((a) => (
            <circle key={a} cx={Math.cos((a * Math.PI) / 180) * 4.2} cy={Math.sin((a * Math.PI) / 180) * 4.2} r="3.6" fill="#ffffff" stroke="#f1e7ff" strokeWidth="0.6" />
          ))}
          <circle r="2.9" fill="#ffc83d" />
        </g>
      );
    case "propeller":
      return (
        <g>
          <path d="M-19 6 Q-19 -13 0 -13 Q19 -13 19 6 Z" fill="#ff5d73" />
          <path d="M-19 6 Q-19 -13 0 -13 L0 6 Z" fill="#ffd166" />
          <rect x="-1.2" y="-21" width="2.4" height="9" fill="#2b2735" />
          <g transform="translate(0 -21)">
            <g className={undefined}>
              <ellipse cx="-7" cy="0" rx="7" ry="2.2" fill="#4dabf7" />
              <ellipse cx="7" cy="0" rx="7" ry="2.2" fill="#22c55e" />
            </g>
          </g>
        </g>
      );
    default:
      return null;
  }
}

/**
 * Accessories are drawn for the classic ghost and fitted to the others: face wear scales with the
 * eye spacing (centered between the eyes), neckwear with the body's width at the neck.
 */
function Accessory({ kind, shape, eyeShift = [0, 0] }: { kind: GhostAppearance["accessory"]; shape: ShapeDef; eyeShift?: [number, number] }) {
  const { eyes, neck, mouthY } = shape;
  const face = (eyes.x[1] - eyes.x[0]) / 20;
  if (kind === "mustache") {
    // it sits over the mouth, as wide as the face is
    return <g transform={`translate(60 ${mouthY - 1.5}) scale(${face}) translate(-60 -64.5)`}>{wear(kind, CLASSIC_FIT, eyeShift)}</g>;
  }
  if (FACE_WEAR.has(kind)) return <g transform={`translate(60 ${eyes.y}) scale(${face}) translate(-60 ${-CLASSIC_FIT.eyes.y})`}>{wear(kind, CLASSIC_FIT, eyeShift)}</g>;
  // a scarf wraps the body, so it takes the body's own width; ties and bow ties scale a little with it
  if (kind === "scarf") return wear(kind, shape, eyeShift);
  const body = Math.min(1.15, Math.max(0.75, neck.half / 28));
  return <g transform={`translate(60 ${neck.y}) scale(${body}) translate(-60 ${-neck.y})`}>{wear(kind, shape, eyeShift)}</g>;
}

/** The classic ghost's face, which face wear is drawn for. */
const CLASSIC_FIT = { eyes: { y: 54, x: [50, 70] as [number, number] }, mouthY: 66, neck: { y: 77, half: 30, hem: 98 } };

function wear(kind: GhostAppearance["accessory"], shape: Pick<ShapeDef, "eyes" | "neck" | "mouthY">, eyeShift: [number, number]) {
  const {
    eyes: {
      x: [a, b],
      y,
    },
    neck,
    mouthY,
  } = shape;
  switch (kind) {
    case "glasses":
      return (
        <g stroke="#2b2735" strokeWidth="2" fill="white" fillOpacity="0.18">
          <circle cx={a} cy={y} r="7" />
          <circle cx={b} cy={y} r="7" />
          <path d={`M${a + 7} ${y} Q60 ${y - 3} ${b - 7} ${y}`} fill="none" />
        </g>
      );
    case "sunglasses":
      // they move with the eyes behind them: the mood's glance here, the pointer's in 
      return (
        <g >
          <g transform={`translate(${eyeShift[0]} ${eyeShift[1]})`}>
          <rect x={a - 8} y={y - 5.5} width="16" height="11" rx="4" fill="#1f1d2b" />
          <rect x={b - 8} y={y - 5.5} width="16" height="11" rx="4" fill="#1f1d2b" />
          <path d={`M${a + 8} ${y - 2} L${b - 8} ${y - 2}`} stroke="#1f1d2b" strokeWidth="2.2" />
          <path d={`M${a - 4.5} ${y - 2.5} l3 -1.5 M${b - 4.5} ${y - 2.5} l3 -1.5`} stroke="white" strokeWidth="1.4" strokeLinecap="round" opacity="0.8" />
          </g>
        </g>
      );
    case "monocle":
      return (
        <g stroke="#c9a227" fill="none">
          <circle cx={b} cy={y} r="7" strokeWidth="2.2" fill="white" fillOpacity="0.2" />
          <path d={`M${b + 5} ${y + 5} Q${b + 12} ${y + 12} ${b + 7} ${y + 22}`} strokeWidth="1.2" />
        </g>
      );
    case "bowtie":
      return (
        <g>
          <path d={`M60 ${neck.y} L49 ${neck.y - 6.5} L49 ${neck.y + 6.5} Z M60 ${neck.y} L71 ${neck.y - 6.5} L71 ${neck.y + 6.5} Z`} fill="#e5484d" strokeLinejoin="round" />
          <rect x="57" y={neck.y - 3.2} width="6" height="6.4" rx="1.6" fill="#c2333a" />
        </g>
      );
    case "scarf":
      return (
        <g>
          <rect x={60 - neck.half - 1.5} y={neck.y - 4.5} width={(neck.half + 1.5) * 2} height="9" rx="4.5" fill="#ff8f5a" />
          <path d={`M${60 - neck.half + 8} ${neck.y - 4.5} v9 M${60 - neck.half + 16} ${neck.y - 4.5} v9 M${60 + neck.half - 10} ${neck.y - 4.5} v9`} stroke="#ffd166" strokeWidth="2.4" />
          <rect x={60 + neck.half * 0.25} y={neck.y + 1} width="8" height={Math.max(9, Math.min(18, neck.hem - neck.y - 3))} rx="3.5" fill="#ff8f5a" transform={`rotate(-10 ${60 + neck.half * 0.25} ${neck.y})`} />
        </g>
      );
    case "tie": {
      // as long as the body has room for above its hem
      const len = Math.max(12, Math.min(24, neck.hem - neck.y - 2));
      return (
        <g>
          <path d={`M56.5 ${neck.y - 4} L63.5 ${neck.y - 4} L62 ${neck.y + 1.5} L58 ${neck.y + 1.5} Z`} fill="#2563eb" />
          <path d={`M58 ${neck.y + 1.5} L62 ${neck.y + 1.5} L65 ${neck.y + len - 5} L60 ${neck.y + len} L55 ${neck.y + len - 5} Z`} fill="#3b82f6" />
        </g>
      );
    }
    case "mustache": {
      const m = mouthY - 1.5;
      return <path d={`M60 ${m} Q52 ${m - 5} 46 ${m - 1} Q44 ${m + 3.5} 48.5 ${m + 3} Q54 ${m + 1.6} 60 ${m + 2.2} Q66 ${m + 1.6} 71.5 ${m + 3} Q76 ${m + 3.5} 74 ${m - 1} Q68 ${m - 5} 60 ${m} Z`} fill="#3a2a20" />;
    }
    default:
      return null;
  }
}
