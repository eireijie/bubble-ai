import { useMemo } from "react";
import { useMotionReduced } from "../theme.ts";
import "./bubble.css";

/** Seeded so a field looks the same on every render (and every visit). */
function makeField(n: number, maxD: number, seed0: number) {
  let seed = seed0;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  return Array.from({ length: n }, () => {
    const dur = 16 + rnd() * 16;
    return { l: 2 + rnd() * 96, d: 4 + rnd() ** 2 * maxD, dur, delay: -rnd() * dur, o: 0.35 + rnd() * 0.5, sw: 2.5 + rnd() * 3 };
  });
}

/**
 * Small bubbles drifting up behind a big one (onboarding, an agent's Look). Pure CSS, nothing
 * re-renders; hidden with reduced motion.
 */
export function BubbleField({ count = 22, maxSize = 14, rise, seed = 7, fade = false, speed = 1 }: { count?: number; maxSize?: number; rise?: number; seed?: number; fade?: boolean; speed?: number }) {
  const reduced = useMotionReduced();
  const field = useMemo(() => makeField(count, maxSize, seed), [count, maxSize, seed]);
  if (reduced) return null;
  return (
    <div className="bub-field" aria-hidden style={{ opacity: fade ? 0 : 1, ...(rise ? { ["--bub-rise" as string]: `-${rise}px` } : null) }}>
      {field.map((f, i) => (
        <span key={i} className="bub-fb" style={{ left: `${f.l}%`, width: f.d, height: f.d, animationDuration: `${(f.dur / speed).toFixed(1)}s`, animationDelay: `${(f.delay / speed).toFixed(1)}s` }}>
          <span className="bub-fbi" style={{ opacity: f.o, animationDuration: `${f.sw.toFixed(1)}s` }} />
        </span>
      ))}
    </div>
  );
}
