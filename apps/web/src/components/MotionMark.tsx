import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { drifter, hopSpin, jolly, markParts, popOut, spinUp, whoosh, working, type MarkParts } from "./markMotion.ts";
import "./mark.css";

export type MarkMood = "still" | "working" | "drift";

/**
 * The Bubble AI mark, alive (canvas "Bubble AI mark motion", 2026-11-25). Round glass bubble, rainbow
 * rim, two eyes glancing right. It only moves on events: `entrance="whoosh"` flies it in once,
 * `mood="working"` drifts and spins until the mood changes (then it finishes its turn and hops),
 * `mood="drift"` drifts for a few seconds after the person moves and its eyes follow the pointer,
 * `jollyOnHover` spins and jiggles on hover or focus, `hop` (a counter) does the "Great!" hop, and
 * `popOnClick` pops it and spins up a new one. Reduced motion: fades only.
 */
export function MotionMark({
  size = 64,
  entrance,
  mood = "still",
  jollyOnHover = false,
  popOnClick = false,
  hop = 0,
  spin = 0,
  word,
  label,
  className,
  style,
}: {
  size?: number;
  entrance?: "whoosh";
  mood?: MarkMood;
  jollyOnHover?: boolean;
  popOnClick?: boolean;
  /** bump to hop once */
  hop?: number;
  /** bump to spin and jiggle once (a wordmark hovered beside it) */
  spin?: number;
  /** an element (the wordmark) that fades in as the bubble lands */
  word?: RefObject<HTMLElement | null>;
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const parts = useRef<MarkParts | null>(null);
  // a pop swaps in a new mark (remount) that spins up
  const [gen, setGen] = useState(0);
  const popping = useRef(false);

  useEffect(() => {
    if (!ref.current) return;
    parts.current = markParts(ref.current);
    parts.current.size = size;
  }, [size, gen]);

  // entrance (first mount only), or spin-up after a pop
  useEffect(() => {
    const m = parts.current;
    if (!m) return;
    if (gen > 0) {
      spinUp(m);
      return;
    }
    if (entrance === "whoosh") return whoosh(m, { onWord: word?.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen]);

  useEffect(() => {
    const m = parts.current;
    if (!m) return;
    if (mood === "drift") return drifter(m);
    if (mood !== "working") return;
    // let an entrance land before working starts
    let w: ReturnType<typeof working> | null = null;
    const t = setTimeout(() => (w = working(m)), entrance === "whoosh" && gen === 0 ? 1600 : 0);
    return () => {
      clearTimeout(t);
      void w?.stop();
    };
  }, [mood, gen, entrance]);

  const first = useRef(hop);
  useEffect(() => {
    if (hop === first.current || !parts.current) return;
    hopSpin(parts.current);
  }, [hop]);

  const firstSpin = useRef(spin);
  useEffect(() => {
    if (spin === firstSpin.current || !parts.current) return;
    jolly(parts.current);
  }, [spin]);

  const pop = async () => {
    if (!popOnClick || popping.current || !ref.current) return;
    popping.current = true;
    await popOut(ref.current);
    setGen((g) => g + 1);
    setTimeout(() => (popping.current = false), 400);
  };

  const small = size <= 32;
  return (
    <span
      key={gen}
      ref={ref}
      className={["mk", small && "mk-small", popOnClick && "mk-hit", className].filter(Boolean).join(" ")}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      tabIndex={popOnClick ? 0 : undefined}
      data-bub-main=""
      onPointerEnter={jollyOnHover ? () => parts.current && jolly(parts.current) : undefined}
      onFocus={jollyOnHover ? () => parts.current && jolly(parts.current) : undefined}
      onClick={popOnClick ? () => void pop() : undefined}
      onKeyDown={popOnClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), void pop()) : undefined}
      style={{ ["--mk-s" as string]: `${size}px`, ["--mk-rim" as string]: `${size > 32 ? Math.max(1.5, size * 0.03) : size * 0.08}px`, ...style }}
    >
      <span className="mk-mv">
        <span className="mk-rot">
          <span className="mk-sq">
            <span className="mk-b">
              <i className="mk-glass" />
              <i className="mk-rim" />
              <i className="mk-hl" />
              <span className="mk-eyes">
                <i className="mk-e" />
                <i className="mk-e" />
              </span>
            </span>
          </span>
        </span>
      </span>
    </span>
  );
}
