import type { GhostAppearance } from "@bubble-ai/core/src/appearance.ts";
import type { ShapeDef } from "./Bubble.tsx";

/*
 * What a bubble wears (2026-11-26, back from the ghosts): a mouth, face wear (glasses, sunglasses, a
 * monocle, a mustache), neckwear (bow tie, scarf, tie) and hats. Everything is drawn in the bubble's
 * own 100×100 box. Face things sit in the face, neckwear and hats on the body, so all of it wobbles,
 * hops and spins with the bubble and nothing slides on its own. Each piece is one flat shape or two:
 * no outlines that fight the glass, no extra shading.
 */

const INK = "#262330";
/** The eyes' centres in the face box (bubble.css: .bub-e1 at 31%, .bub-e2 at 58%, 11% wide; 38% down, 17% tall). */
const EYE_L = 36.5;
const EYE_R = 63.5;
const EYE_Y = 46.5;
const MOUTH_Y = 62;

const svgProps = { viewBox: "0 0 100 100", "aria-hidden": true, focusable: false } as const;

/** A small mouth under the eyes, in the eyes' own ink. */
export function BubbleMouth({ kind }: { kind: GhostAppearance["mouth"] }) {
  const x = 50;
  const y = MOUTH_Y;
  let d: React.ReactNode = null;
  switch (kind) {
    case "smile":
      d = <path d={`M${x - 5.5} ${y} Q${x} ${y + 5} ${x + 5.5} ${y}`} className="bub-ink-line" />;
      break;
    case "open":
      d = (
        <>
          <ellipse cx={x} cy={y + 1.5} rx="4" ry="4.6" className="bub-ink-fill" />
          <ellipse cx={x} cy={y + 4} rx="2.6" ry="1.5" fill="#ff7a93" />
        </>
      );
      break;
    case "cat":
      d = <path d={`M${x - 6.5} ${y} Q${x - 3.25} ${y + 4.2} ${x} ${y} Q${x + 3.25} ${y + 4.2} ${x + 6.5} ${y}`} className="bub-ink-line" />;
      break;
    case "fangs":
      d = (
        <>
          <path d={`M${x - 6.5} ${y} Q${x} ${y + 5} ${x + 6.5} ${y}`} className="bub-ink-line" />
          <path d={`M${x - 4.2} ${y + 2} l1.5 3.6 l1.5 -3.1 Z M${x + 1.2} ${y + 2.3} l1.5 3.1 l1.5 -3.6 Z`} fill="#fff" />
        </>
      );
      break;
    case "tongue":
      d = (
        <>
          <path d={`M${x - 5.5} ${y} Q${x} ${y + 4.6} ${x + 5.5} ${y}`} className="bub-ink-line" />
          <path d={`M${x + 0.4} ${y + 2} q0 5 3.4 5 q3.4 0 2.8 -6 Z`} fill="#ff7a93" />
        </>
      );
      break;
  }
  return d && <svg {...svgProps} className="bub-wear">{d}</svg>;
}

/** Glasses, sunglasses, a monocle or a mustache, on the face. */
export function BubbleFaceWear({ kind }: { kind: GhostAppearance["accessory"] }) {
  const a = EYE_L;
  const b = EYE_R;
  const y = EYE_Y;
  let d: React.ReactNode = null;
  switch (kind) {
    case "glasses":
      d = (
        <g fill="none" stroke={INK} strokeWidth="2.2">
          <circle cx={a} cy={y} r="9" fill="rgb(255 255 255 / 0.16)" />
          <circle cx={b} cy={y} r="9" fill="rgb(255 255 255 / 0.16)" />
          <path d={`M${a + 9} ${y - 1} Q50 ${y - 4} ${b - 9} ${y - 1}`} />
        </g>
      );
      break;
    case "sunglasses":
      d = (
        <g>
          <rect x={a - 10.5} y={y - 7} width="21" height="14" rx="5" fill="#16141d" />
          <rect x={b - 10.5} y={y - 7} width="21" height="14" rx="5" fill="#16141d" />
          <path d={`M${a + 10} ${y - 3} L${b - 10} ${y - 3}`} stroke="#16141d" strokeWidth="2.4" />
          <path d={`M${a - 6} ${y - 3.5} l4 -2 M${b - 6} ${y - 3.5} l4 -2`} stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
        </g>
      );
      break;
    case "monocle":
      d = (
        <g fill="none" stroke="#c9a227">
          <circle cx={b} cy={y} r="9" strokeWidth="2.4" fill="rgb(255 255 255 / 0.18)" />
          <path d={`M${b + 6.5} ${y + 6.5} Q${b + 14} ${y + 15} ${b + 9} ${y + 27}`} strokeWidth="1.3" />
        </g>
      );
      break;
    case "mustache": {
      const m = MOUTH_Y - 3;
      d = <path d={`M50 ${m} Q41 ${m - 5.5} 34 ${m - 1} Q32 ${m + 4} 37 ${m + 3.4} Q43.5 ${m + 1.8} 50 ${m + 2.5} Q56.5 ${m + 1.8} 63 ${m + 3.4} Q68 ${m + 4} 66 ${m - 1} Q59 ${m - 5.5} 50 ${m} Z`} fill="#3a2a20" />;
      break;
    }
  }
  return d && <svg {...svgProps} className="bub-wear">{d}</svg>;
}

/** Bow tie, scarf or tie, low on the body below the face. */
export function BubbleNeckwear({ kind, def }: { kind: GhostAppearance["accessory"]; def: ShapeDef }) {
  const x = def.bottom[0];
  const y = def.top[1] + (def.bottom[1] - def.top[1]) * 0.79;
  const half = (def.width / 2) * 0.78;
  let d: React.ReactNode = null;
  switch (kind) {
    case "bowtie":
      d = (
        <g transform={`translate(${x} ${y}) scale(1.25)`}>
          <path d="M0 0 L-11 -6.5 L-11 6.5 Z M0 0 L11 -6.5 L11 6.5 Z" fill="#e5484d" strokeLinejoin="round" />
          <rect x="-3" y="-3.2" width="6" height="6.4" rx="1.6" fill="#c2333a" />
        </g>
      );
      break;
    case "scarf":
      d = (
        <g>
          <rect x={x - half} y={y - 5} width={half * 2} height="10" rx="5" fill="#ff8f5a" />
          <path d={`M${x - half + 9} ${y - 5} v10 M${x - half + 18} ${y - 5} v10 M${x + half - 11} ${y - 5} v10`} stroke="#ffd166" strokeWidth="2.4" />
          <rect x={x + half * 0.3} y={y + 2} width="9" height={Math.max(8, Math.min(14, def.bottom[1] - y - 4))} rx="4" fill="#ff8f5a" transform={`rotate(-10 ${x + half * 0.3} ${y})`} />
        </g>
      );
      break;
    case "tie": {
      const len = Math.max(10, Math.min(18, def.bottom[1] - y - 3));
      d = (
        <g transform={`translate(${x} ${y - 4})`}>
          <path d="M-4 0 L4 0 L2.4 5.5 L-2.4 5.5 Z" fill="#2563eb" />
          <path d={`M-2.4 5.5 L2.4 5.5 L5.2 ${len - 4} L0 ${len + 1} L-5.2 ${len - 4} Z`} fill="#3b82f6" />
        </g>
      );
      break;
    }
  }
  return d && <svg {...svgProps} className="bub-wear">{d}</svg>;
}

/** How far each hat sits down into the head, in the hat's own units. */
const HAT_SINK: Partial<Record<GhostAppearance["hat"], number>> = { tophat: 3, party: 2, beanie: 5, crown: 2.5, witch: 3, propeller: 4 };
/** Worn clipped to the side of the head rather than on top. */
const CLIPPED = new Set<GhostAppearance["hat"]>(["bow", "flower"]);

/** A hat on top of the head (or clipped to its side), drawn around (0, 0) with negative y up. */
export function BubbleHat({ kind, def, animate }: { kind: GhostAppearance["hat"]; def: ShapeDef; animate: boolean }) {
  const k = (kind === "headphones" ? 1.62 : CLIPPED.has(kind) ? 1.25 : 1.15) * (def.width / 100);
  const [tx, ty] = CLIPPED.has(kind) ? [def.top[0] + def.width * 0.31, def.top[1] + def.width * 0.15] : [def.top[0], def.top[1] + (HAT_SINK[kind] ?? 0) * k];
  return (
    <svg {...svgProps} className="bub-wear bub-hat">
      <g transform={`translate(${tx} ${ty}) scale(${k})`}>
        <Hat kind={kind} animate={animate} />
      </g>
    </svg>
  );
}

function Hat({ kind, animate }: { kind: GhostAppearance["hat"]; animate: boolean }) {
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
          <path d="M-29 24 C-31 -9 31 -9 29 24" stroke="#2b2735" strokeWidth="4" fill="none" strokeLinecap="round" />
          <rect x="-35" y="17" width="10" height="16" rx="4.5" fill="#ff6b6b" />
          <rect x="25" y="17" width="10" height="16" rx="4.5" fill="#ff6b6b" />
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
      return <ellipse cx="0" cy="-9" rx="16" ry="4.5" fill="none" stroke="#ffd84d" strokeWidth="3.4" />;
    case "flower":
      return (
        <g>
          {[0, 72, 144, 216, 288].map((a) => (
            <circle key={a} cx={Math.cos((a * Math.PI) / 180) * 4.2} cy={Math.sin((a * Math.PI) / 180) * 4.2} r="3.6" fill="#ffffff" stroke="#e9e1f7" strokeWidth="0.6" />
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
            <g className={animate ? "bub-prop" : undefined}>
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
