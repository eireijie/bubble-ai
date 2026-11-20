import type { GhostAppearance } from "@wisp/core";
import type { Silhouette } from "../ghostFamily.ts";

/**
 * Hats and accessories for the flat ghost family. The pieces are the same flat drawings the old
 * 120-unit ghost wore; each family silhouette says where its head top, side clip and neck are in the
 * family's 40-unit space, and the pieces are scaled into it. Hats and neckwear ride with the body,
 * face wear moves with the eyes.
 */

/** Where things sit on each silhouette, in 40-unit space. hat: the head's width against the old classic head. */
const FIT: Record<Silhouette, { top: number; hat: number; clip: [number, number]; neck: { y: number; half: number; hem: number } }> = {
  ghost: { top: 4.5, hat: 1.4, clip: [29, 7.8], neck: { y: 26, half: 14, hem: 32 } },
  drop: { top: 7.5, hat: 0.95, clip: [27, 9.5], neck: { y: 27, half: 14, hem: 32 } },
  soft: { top: 4, hat: 1.4, clip: [29, 7.5], neck: { y: 25, half: 14, hem: 30 } },
  tall: { top: 3, hat: 1.1, clip: [27.5, 6], neck: { y: 25, half: 11, hem: 33 } },
  wide: { top: 9, hat: 1.45, clip: [30, 11], neck: { y: 27, half: 17, hem: 31 } },
  block: { top: 6, hat: 1.3, clip: [29, 7], neck: { y: 26, half: 14, hem: 32 } },
};

/** Worn clipped to the side of the head rather than on top of it. */
const CLIPPED = new Set<GhostAppearance["hat"]>(["bow", "flower"]);
/** How far each hat's brim sits into the head, in the old ghost's units. */
const HAT_SINK: Partial<Record<GhostAppearance["hat"], number>> = { tophat: 3, party: 2, beanie: 4.5, crown: 2.5, witch: 3, propeller: 4 };
/** Accessories worn on the face; neckwear stays with the body. */
export const FACE_WEAR = new Set<GhostAppearance["accessory"]>(["glasses", "sunglasses", "monocle", "mustache"]);

/** The old ghost's units are 3× the family's; its classic eyes sat 20 apart, the family's sit 8 apart. */
const OLD = 1 / 3;
const FACE = 24 / 20;

export function GhostHat({ kind, shape, animate }: { kind: GhostAppearance["hat"]; shape: Silhouette; animate: boolean }) {
  if (kind === "none") return null;
  const f = FIT[shape];
  const s = f.hat * OLD;
  const at = CLIPPED.has(kind) ? `translate(${f.clip[0]} ${f.clip[1]}) scale(${s})` : `translate(20 ${f.top}) scale(${s}) translate(0 ${HAT_SINK[kind] ?? 0})`;
  return (
    <g className="ghost-worn" transform={at}>
      <Hat kind={kind} animate={animate} />
    </g>
  );
}

/** Neckwear (bow tie, scarf, tie): drawn with the body. */
export function GhostNeckwear({ kind, shape }: { kind: GhostAppearance["accessory"]; shape: Silhouette }) {
  if (kind === "none" || FACE_WEAR.has(kind)) return null;
  const n = FIT[shape].neck;
  const neck = { y: n.y * 3, half: n.half * 3, hem: n.hem * 3 };
  const inner = kind === "scarf" ? wear(kind, neck, 0) : <g transform={`translate(60 ${neck.y}) scale(${Math.min(1.5, Math.max(1, neck.half / 28))}) translate(-60 ${-neck.y})`}>{wear(kind, neck, 0)}</g>;
  return (
    <g className="ghost-worn" transform={`scale(${OLD})`}>
      {inner}
    </g>
  );
}

/** Face wear (glasses, sunglasses, monocle, mustache): drawn with the eyes, so it follows the gaze. */
export function GhostFacewear({ kind, ey }: { kind: GhostAppearance["accessory"]; ey: number }) {
  if (!FACE_WEAR.has(kind)) return null;
  const y = ey * 3;
  const at = kind === "mustache" ? `translate(60 ${(ey + 5) * 3 - 1.5}) scale(${FACE}) translate(-60 -64.5)` : `translate(60 ${y}) scale(${FACE}) translate(-60 -54)`;
  return (
    <g className="ghost-worn" transform={`scale(${OLD})`}>
      <g className="ghost-worn" transform={at}>{wear(kind, { y: 77, half: 30, hem: 98 }, 54)}</g>
    </g>
  );
}

/** Hats are drawn around the head's top center at (0, 0); negative y is up. */
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
          <path d="M-15 3 L-15 -12 L-7.5 -4.5 L0 -17 L7.5 -4.5 L15 -12 L15 3 Z" fill="#ffcf3f" />
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
      return <ellipse cx="0" cy="-11" rx="16" ry="4.5" fill="none" stroke="#ffd84d" strokeWidth="3.6" className={animate ? "ghost-halo" : undefined} />;
    case "flower":
      return (
        <g>
          {[0, 72, 144, 216, 288].map((a) => (
            <circle key={a} cx={Math.cos((a * Math.PI) / 180) * 4.2} cy={Math.sin((a * Math.PI) / 180) * 4.2} r="3.6" fill="#ffffff" />
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
            <g className={animate ? "ghost-spin" : undefined}>
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

/** Drawn in the old 120-unit space around x = 60: face wear for eyes at 50/70 and height y, neckwear at `neck`. */
function wear(kind: GhostAppearance["accessory"], neck: { y: number; half: number; hem: number }, y: number) {
  const [a, b] = [50, 70];
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
      return (
        <g>
          <rect x={a - 8} y={y - 5.5} width="16" height="11" rx="4" fill="#1f1d2b" />
          <rect x={b - 8} y={y - 5.5} width="16" height="11" rx="4" fill="#1f1d2b" />
          <path d={`M${a + 8} ${y - 2} L${b - 8} ${y - 2}`} stroke="#1f1d2b" strokeWidth="2.2" />
        </g>
      );
    case "monocle":
      return (
        <g stroke="#c9a227" fill="none">
          <circle cx={b} cy={y} r="7" strokeWidth="2.2" fill="white" fillOpacity="0.2" />
          <path d={`M${b + 5} ${y + 5} Q${b + 12} ${y + 12} ${b + 7} ${y + 22}`} strokeWidth="1.2" />
        </g>
      );
    case "mustache": {
      const m = 64.5;
      return <path d={`M60 ${m} Q52 ${m - 5} 46 ${m - 1} Q44 ${m + 3.5} 48.5 ${m + 3} Q54 ${m + 1.6} 60 ${m + 2.2} Q66 ${m + 1.6} 71.5 ${m + 3} Q76 ${m + 3.5} 74 ${m - 1} Q68 ${m - 5} 60 ${m} Z`} fill="#3a2a20" />;
    }
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
      const len = Math.max(12, Math.min(24, neck.hem - neck.y - 2));
      return (
        <g>
          <path d={`M56.5 ${neck.y - 4} L63.5 ${neck.y - 4} L62 ${neck.y + 1.5} L58 ${neck.y + 1.5} Z`} fill="#2563eb" />
          <path d={`M58 ${neck.y + 1.5} L62 ${neck.y + 1.5} L65 ${neck.y + len - 5} L60 ${neck.y + len} L55 ${neck.y + len - 5} Z`} fill="#3b82f6" />
        </g>
      );
    }
    default:
      return null;
  }
}
