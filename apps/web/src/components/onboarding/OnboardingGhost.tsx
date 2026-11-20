import { useEffect, useRef, useState } from "react";
import { useMotionReduced } from "../../theme.ts";
import { FAMILY_COLORS, SILHOUETTES, eyeInk } from "../../ghostFamily.ts";

const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
export const ONBOARDING_VIOLET = FAMILY_COLORS[0];

/** The mouth and its talking oval (canvas Avatar, mouth C); the rest of the motion is the family's (index.css). */
export const ONBOARDING_GHOST_STYLE = `
.hello-ghost .hello-mouth { transition: d .22s cubic-bezier(.32,.72,0,1), opacity .15s ease; }
.hello-ghost .hello-talk { transform-box: fill-box; transform-origin: center; opacity: 0; animation: hello-talk .62s ease-in-out infinite; }
.hello-ghost.talking .hello-talk { opacity: 1; }
.hello-ghost.talking .hello-mouth { opacity: 0; }
@keyframes hello-talk { 0%,100% { transform: scaleY(.3); } 30% { transform: scaleY(1); } 55% { transform: scaleY(.45); } 78% { transform: scaleY(.85); } }
@media (prefers-reduced-motion: reduce) {
  .hello-ghost .hello-talk { animation: none; transform: scaleY(.6); }
  .hello-ghost .hello-mouth { transition: none; }
}`;

/**
 * The first wisp of onboarding: violet, idles (breathes, blinks, stares off), follows the cursor
 * when it comes near with a smile, talks (a filled oval) while `talking`, and with `working` pulls
 * out its laptop. `follow={false}` keeps small copies (chat bubbles) from tracking the pointer.
 */
export function OnboardingGhost({
  size = 128,
  talking = false,
  smiling = false,
  hop = false,
  working = false,
  follow: tracks = true,
}: {
  size?: number;
  talking?: boolean;
  smiling?: boolean;
  hop?: boolean;
  working?: boolean;
  follow?: boolean;
}) {
  const reduced = useMotionReduced();
  const root = useRef<HTMLSpanElement>(null);
  const follow = useRef<SVGGElement>(null);
  const lean = useRef<SVGGElement>(null);
  const [near, setNear] = useState(false);
  const shape = SILHOUETTES.ghost;
  const eye = eyeInk(ONBOARDING_VIOLET);
  const my = shape.ey + 5;

  useEffect(() => {
    if (reduced || !tracks) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    let on = false;
    const paint = () => {
      frame = 0;
      const el = root.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const reach = r.width * 0.9;
      const inside = !!last && last.clientX > r.left - reach && last.clientX < r.right + reach && last.clientY > r.top - reach && last.clientY < r.bottom + reach;
      if (inside && last) {
        const fx = clamp((last.clientX - (r.left + r.width / 2)) / (r.width * 0.9), 1);
        const fy = clamp((last.clientY - (r.top + r.height * 0.45)) / (r.height * 0.9), 1);
        follow.current?.style.setProperty("transform", `translate(${(fx * 2.6).toFixed(2)}px,${(fy * 2).toFixed(2)}px)`);
        lean.current?.style.setProperty("transform", `rotate(${(fx * 6).toFixed(1)}deg)`);
      } else {
        follow.current?.style.removeProperty("transform");
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
    };
  }, [reduced, tracks]);

  const smile = near || smiling;
  const md = smile ? `M18 ${my - 0.3}q2 1.7 4 0` : `M18.7 ${my}h2.6`;
  const small = size <= 44;
  return (
    <span
      ref={root}
      aria-hidden
      className={["wisp-root hello-ghost relative inline-block shrink-0", working ? "working" : "idle", near && "following", talking && "talking", reduced && "frozen", small && "small"]
        .filter(Boolean)
        .join(" ")}
      style={{ width: size, height: size }}
    >
      <style>{ONBOARDING_GHOST_STYLE}</style>
      <svg width="100%" height="100%" viewBox="0 0 40 40" style={{ overflow: "visible", display: "block" }}>
        <g className="wisp-wander">
          <g className={hop ? "wisp-wake hop" : "wisp-wake"}>
            <g className="wisp-bob">
              <g ref={lean} className="wisp-lean">
                <path d={shape.d} fill={ONBOARDING_VIOLET} />
                <g className="wisp-gaze">
                  <g ref={follow} className="wisp-follow">
                    <g className="wisp-lid">
                      <ellipse className="wisp-eye" cx="16" cy={shape.ey} rx="1.9" ry="2.7" fill={eye} />
                    </g>
                    <g className="wisp-lid">
                      <ellipse className="wisp-eye" cx="24" cy={shape.ey} rx="1.9" ry="2.7" fill={eye} />
                    </g>
                    <path className="hello-mouth" d={md} fill="none" stroke={eye} strokeWidth="1.25" strokeLinecap="round" />
                    <ellipse className="hello-talk" cx="20" cy={my} rx="1.5" ry="1.3" fill={eye} />
                  </g>
                </g>
              </g>
              {working && (
                <g className="wisp-kit">
                  <rect x="11.5" y="24.5" width="17" height="10" rx="1.4" fill="#2b2b2e" />
                  <rect className="wisp-glow" x="12.8" y="25.8" width="14.4" height="7.4" rx=".6" fill="rgba(255,255,255,.92)" />
                  <rect className="wisp-code" x="14.2" y="27.6" width="9" height="1" rx=".5" fill={ONBOARDING_VIOLET} />
                  <rect className="wisp-code b" x="14.2" y="30.2" width="6.5" height="1" rx=".5" fill={ONBOARDING_VIOLET} />
                  <rect x="8.5" y="34.2" width="23" height="2.2" rx="1.1" fill="#3d3d42" />
                </g>
              )}
            </g>
          </g>
        </g>
      </svg>
    </span>
  );
}
