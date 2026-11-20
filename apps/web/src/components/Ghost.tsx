import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { GhostAppearance } from "@wisp/core";
import { useMotionReduced } from "../theme.ts";
import { SILHOUETTES, eyeInk, familyColor, seedDelay, silhouetteOf } from "../ghostFamily.ts";
import { GhostFacewear, GhostHat, GhostNeckwear } from "./GhostWear.tsx";

/** How the ghost feels right now; follows the agent's status where it matters. */
export type GhostMood = "awake" | "listening" | "thinking" | "asleep" | "working" | "done" | "waiting" | "error";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));

/**
 * An agent's ghost from the ghost family (canvas Avatar): one flat colour, two eyes, its own
 * silhouette. Idle, it sits and breathes and stares off; when the pointer comes near, its eyes and
 * body follow it; working, it wakes with a hop, wanders, types on a little laptop and thinks in
 * bubbles. One mouth stroke in the eyes' ink (canvas Mouths, C): flat idle, a small smile when the
 * pointer is near, a pressed line while working, opening and closing while it talks on a call. Hats
 * and neckwear ride with the body, face wear with the eyes. Reduce Motion (the OS or Settings) stills all of it.
 */
export function Ghost({
  look,
  size = 40,
  mood = "awake",
  animate = true,
  tile = false,
  label,
  trackPointer = false,
  interactive = false,
  ambient = true,
  speakingLevel,
  seed,
}: {
  look: GhostAppearance;
  size?: number;
  mood?: GhostMood;
  animate?: boolean;
  /** kept for callers from the old ghost; the family has no rippling hem */
  wave?: boolean;
  tile?: boolean;
  label?: string;
  trackPointer?: boolean;
  interactive?: boolean;
  ambient?: boolean;
  speakingLevel?: number;
  /** picks a family colour for white looks; defaults to the label */
  seed?: string;
}) {
  const reduced = useMotionReduced();
  const animated = animate && !reduced;
  const still = !animated || !ambient;
  const sil = silhouetteOf(look);
  const shape = SILHOUETTES[sil];
  const asleep = mood === "asleep";
  // speaking: Reduce Motion keeps the ghost as it is, so the level only counts while animated
  const level = speakingLevel !== undefined && animated ? Math.min(1, Math.max(0, speakingLevel)) : 0;
  const working = !asleep && (mood === "working" || mood === "thinking");
  // talking on a call: the mouth opens and closes (held half open under Reduce Motion)
  const talking = !asleep && speakingLevel !== undefined && speakingLevel > 0.05;
  const my = shape.ey + 5;
  const showMouth = look.mouth !== "none" && look.accessory !== "mustache";
  const hat = look.hat ?? "none";
  const wear = look.accessory ?? "none";
  const color = familyColor(look, seed ?? label ?? "");
  const eye = eyeInk(color);
  const delays = seedDelay(seed ?? label ?? color);
  const root = useRef<HTMLSpanElement>(null);
  const follow = useRef<SVGGElement>(null);
  const lean = useRef<SVGGElement>(null);
  const [hop, setHop] = useState(0);

  // hover: the eyes and body follow the pointer while it is near (or anywhere, with trackPointer)
  useEffect(() => {
    const el = root.current;
    // asleep ghosts still glance over and smile, with their sleepy eyes
    if (!animated || size < 16 || !el) return;
    if (!window.matchMedia?.("(hover: hover)").matches && !trackPointer) return;
    let frame = 0;
    let on = false;
    let last: PointerEvent | null = null;
    const paint = () => {
      frame = 0;
      const e = last;
      if (!e || !root.current) return;
      const r = root.current.getBoundingClientRect();
      const reach = trackPointer ? Infinity : Math.max(r.width * 0.9, 28);
      const near = e.clientX > r.left - reach && e.clientX < r.right + reach && e.clientY > r.top - reach && e.clientY < r.bottom + reach;
      if (!near) {
        if (on) {
          on = false;
          root.current.classList.remove("following");
          follow.current?.style.removeProperty("transform");
          lean.current?.style.removeProperty("transform");
        }
        return;
      }
      const span = trackPointer ? Math.max(r.width * 2.5, 300) : r.width * 0.9;
      const fx = clamp((e.clientX - (r.left + r.width / 2)) / span, 1);
      const fy = clamp((e.clientY - (r.top + r.height * 0.45)) / span, 1);
      if (!on) {
        on = true;
        root.current.classList.add("following");
      }
      follow.current?.style.setProperty("transform", `translate(${(fx * 2.6).toFixed(2)}px,${(fy * 2).toFixed(2)}px)`);
      lean.current?.style.setProperty("transform", `rotate(${(fx * 6).toFixed(1)}deg)`);
    };
    const move = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const leave = () => {
      last = null;
      on = false;
      root.current?.classList.remove("following");
      follow.current?.style.removeProperty("transform");
      lean.current?.style.removeProperty("transform");
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      leave();
    };
  }, [animated, size, trackPointer]);

  const small = size <= 44;
  const tiny = size <= 24;
  return (
    <span
      ref={root}
      role="img"
      aria-label={label ?? "ghost"}
      aria-hidden={label === "" ? true : undefined}
      className={cx(
        "wisp-root ghost relative inline-block shrink-0",
        working ? "working" : asleep ? "asleep" : "idle",
        talking && "talking",
        still && "still",
        !animated && "frozen",
        small && "small",
        tiny && "tiny",
        tile && "rounded-full",
      )}
      style={{ width: size, height: size, background: tile ? `color-mix(in srgb, ${color} 22%, transparent)` : undefined, "--wd": delays.wd, "--wb": delays.wb } as CSSProperties}
      onPointerDown={interactive && animated ? () => setHop((h) => h + 1) : undefined}
    >
      <svg width="100%" height="100%" viewBox={tile ? "-6 -6 52 52" : hat !== "none" ? "-4 -8 48 48" : "0 0 40 40"} aria-hidden="true" style={{ overflow: "visible", display: "block" }}>
        <g className="wisp-wander">
          <g key={`${working ? "w" : "i"}${hop}`} className={cx("wisp-wake", (hop > 0 || mood === "done") && "hop")}>
            <g className="wisp-bob" style={level ? { transform: `scale(${1 + level * 0.05},${1 - level * 0.04})` } : undefined}>
              <g ref={lean} className="wisp-lean">
                <path d={shape.d} fill={color} />
                <GhostNeckwear kind={wear} shape={sil} />
                <g className="wisp-gaze">
                  <g ref={follow} className="wisp-follow">
                    <g className="wisp-lid">
                      <ellipse className="wisp-eye" cx="16" cy={shape.ey} rx="1.9" ry="2.7" fill={eye} />
                    </g>
                    <g className="wisp-lid">
                      <ellipse className="wisp-eye" cx="24" cy={shape.ey} rx="1.9" ry="2.7" fill={eye} />
                    </g>
                    {showMouth && !tiny && (
                      <g className="wisp-mouth" stroke={eye} strokeWidth="1.25" strokeLinecap="round" fill="none">
                        <path className="m-flat" d={`M18.7 ${my}h2.6`} />
                        <path className="m-smile" d={`M18 ${my - 0.3}q2 1.7 4 0`} />
                        <path className="m-work" d={`M19.6 ${my + 0.2}h2.1`} />
                        <ellipse className="m-talk" cx="20" cy={my} rx="1.5" ry="1.3" fill={eye} stroke="none" />
                      </g>
                    )}
                    <GhostFacewear kind={wear} ey={shape.ey} />
                  </g>
                </g>
                <GhostHat kind={hat} shape={sil} animate={animated} />
              </g>
              {working && (
                <g className="wisp-kit">
                  <rect x="11.5" y="24.5" width="17" height="10" rx="1.4" fill="#2b2b2e" />
                  <rect className="wisp-glow" x="12.8" y="25.8" width="14.4" height="7.4" rx=".6" fill="rgba(255,255,255,.92)" />
                  <rect className="wisp-code" x="14.2" y="27.6" width="9" height="1" rx=".5" fill={color} />
                  <rect className="wisp-code b" x="14.2" y="30.2" width="6.5" height="1" rx=".5" fill={color} />
                  <rect x="8.5" y="34.2" width="23" height="2.2" rx="1.1" fill="#3d3d42" />
                </g>
              )}
            </g>
          </g>
        </g>
        {working && !tiny && (
          <g className="wisp-thoughts">
            <circle className="wisp-th t1" cx="32.5" cy="9" r="1.3" fill="#fff" stroke="rgba(0,0,0,.2)" strokeWidth=".5" />
            <circle className="wisp-th t2" cx="35.6" cy="4.6" r="1.9" fill="#fff" stroke="rgba(0,0,0,.2)" strokeWidth=".5" />
            <g className="wisp-th t3">
              <ellipse cx="40.5" cy="-1.5" rx="4.8" ry="3.6" fill="#fff" stroke="rgba(0,0,0,.2)" strokeWidth=".5" />
              <circle cx="38.6" cy="-1.5" r=".6" fill="#555" />
              <circle cx="40.5" cy="-1.5" r=".6" fill="#555" />
              <circle cx="42.4" cy="-1.5" r=".6" fill="#555" />
            </g>
          </g>
        )}
      </svg>
    </span>
  );
}
