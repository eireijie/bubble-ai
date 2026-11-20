import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMotionReduced } from "../theme.ts";
import { FAMILY_COLORS, SILHOUETTES, eyeInk } from "../ghostFamily.ts";

const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
const VIOLET = FAMILY_COLORS[0];

/** The mouth and its talking oval (canvas Avatar, mouth C); the rest of the motion is the family's (index.css). */
const STYLE = `
.hello-ghost .hello-mouth { transition: d .22s cubic-bezier(.32,.72,0,1), opacity .15s ease; }
.hello-ghost .hello-talk { transform-box: fill-box; transform-origin: center; opacity: 0; animation: hello-talk .62s ease-in-out infinite; }
.hello-ghost.talking .hello-talk { opacity: 1; }
.hello-ghost.talking .hello-mouth { opacity: 0; }
@keyframes hello-talk { 0%,100% { transform: scaleY(.3); } 30% { transform: scaleY(1); } 55% { transform: scaleY(.45); } 78% { transform: scaleY(.85); } }
@keyframes hello-in { from { opacity: 0; transform: translateY(6px); } }
.hello-in { animation: hello-in .45s cubic-bezier(.32,.72,0,1) both; }
.hello-in2 { animation: hello-in .45s cubic-bezier(.32,.72,0,1) .5s both; }
.hello-in3 { animation: hello-in .45s cubic-bezier(.32,.72,0,1) .9s both; }
@media (prefers-reduced-motion: reduce) {
  .hello-ghost .hello-talk { animation: none; transform: scaleY(.6); }
  .hello-ghost .hello-mouth { transition: none; }
  .hello-in, .hello-in2, .hello-in3 { animation: none; }
}`;

/**
 * The first wisp: violet, idles (breathes, blinks, stares off), follows the cursor when it comes
 * near with a smile, and talks (a filled oval) while `talking`.
 */
function HelloGhost({ size = 128, talking, smiling, hop }: { size?: number; talking: boolean; smiling: boolean; hop: boolean }) {
  const reduced = useMotionReduced();
  const root = useRef<HTMLSpanElement>(null);
  const follow = useRef<SVGGElement>(null);
  const lean = useRef<SVGGElement>(null);
  const [near, setNear] = useState(false);
  const shape = SILHOUETTES.ghost;
  const eye = eyeInk(VIOLET);
  const my = shape.ey + 5;

  useEffect(() => {
    if (reduced) return;
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
  }, [reduced]);

  const smile = near || smiling;
  const md = smile ? `M18 ${my - 0.3}q2 1.7 4 0` : `M18.7 ${my}h2.6`;
  return (
    <span
      ref={root}
      aria-hidden
      className={["wisp-root hello-ghost relative inline-block shrink-0 idle", near && "following", talking && "talking", reduced && "frozen"].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
    >
      <svg width="100%" height="100%" viewBox="0 0 40 40" style={{ overflow: "visible", display: "block" }}>
        <g className={hop ? "wisp-wake hop" : "wisp-wake"}>
        <g className="wisp-bob">
          <g ref={lean} className="wisp-lean">
            <path d={shape.d} fill={VIOLET} />
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
        </g>
        </g>
      </svg>
    </span>
  );
}

/**
 * Page 1 of the first run, Hello: the first wisp says hi and asks what to call you. Continue works
 * with an empty name too. "I already have Wisp" leaves for signing in.
 */
export function HelloStep({ initialName = "", onContinue, onHaveWisp }: { initialName?: string; onContinue: (name: string) => void; onHaveWisp: () => void }) {
  const [name, setName] = useState(initialName);
  const [talking, setTalking] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    timer.current = setTimeout(() => setTalking(false), 2200);
    return () => clearTimeout(timer.current);
  }, []);
  const first = name.trim().split(/\s+/)[0] ?? "";
  const type = (v: string) => {
    setName(v);
    clearTimeout(timer.current);
    setTalking(!!v.trim());
    timer.current = setTimeout(() => setTalking(false), 900);
  };
  const reduced = useMotionReduced();
  const [hop, setHop] = useState(false);
  const go = (e: FormEvent) => {
    e.preventDefault();
    if (hop) return;
    // a small hop (squash and stretch), then on to the next screen
    if (reduced) return onContinue(name.trim());
    setHop(true);
    setTimeout(() => onContinue(name.trim()), 480);
  };
  return (
    <div className="fixed inset-0 z-10 flex flex-col bg-panel text-ink text-[14px] leading-[22px]">
      <style>{STYLE}</style>
      <div className="h-14 px-6 flex items-center justify-between shrink-0 safe-top">
        <span className="text-[15px] font-[650] tracking-[-0.01em]">Wisp</span>
        <button type="button" onClick={onHaveWisp} className="text-[13px] text-muted hover:text-ink">
          I already have Wisp
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-7 px-4 pb-14">
        <span className="hello-in">
          <HelloGhost talking={talking} smiling={!!first} hop={hop} />
        </span>
        <div className="flex flex-col items-center gap-1.5 w-full max-w-[440px] text-center" aria-live="polite">
          {first ? (
            <>
              <h1 className="text-[24px] leading-[30px] font-[650] tracking-[-0.015em]">Nice to meet you, {first}.</h1>
              <p className="text-[15px] leading-[22px] text-muted">I'll remember that.</p>
            </>
          ) : (
            <>
              <h1 className="hello-in text-[24px] leading-[30px] font-[650] tracking-[-0.015em]">Hi. I'm your first wisp.</h1>
              <p className="hello-in2 text-[15px] leading-[22px] text-muted">What should I call you?</p>
            </>
          )}
        </div>
        <form onSubmit={go} className="hello-in3 flex gap-2 w-full max-w-[400px]">
          <label htmlFor="hello-name" className="sr-only">
            Your name
          </label>
          <input
            id="hello-name"
            value={name}
            onChange={(e) => type(e.target.value)}
            placeholder="Your name"
            autoComplete="given-name"
            maxLength={80}
            autoFocus
            className="flex-1 min-w-0 h-11 px-[18px] rounded-full border border-[var(--input)] bg-[var(--control)] text-ink text-[15px] outline-none placeholder:text-faint focus:border-ink"
          />
          <button
            type="submit"
            className={["setup-press h-11 px-5 rounded-full font-semibold", first ? "bg-ink text-panel" : "bg-chip text-ink"].join(" ")}
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}

/** The name the desktop app's Hello already asked for: #/setup/<code>?name=… */
export const linkedHelloName = () => {
  const q = location.hash.split("?")[1];
  return q ? (new URLSearchParams(q).get("name") ?? "").trim().slice(0, 80) : "";
};

/** The screen after Hello slides in from the right on the drawer curve (still under Reduce Motion). */
export function HelloNext({ children }: { children: ReactNode }) {
  return (
    <div className="hello-next">
      <style>{`.hello-next { position: fixed; inset: 0; z-index: 40; animation: hello-next 450ms cubic-bezier(.32,.72,0,1) both; } @keyframes hello-next { from { opacity: 0; transform: translateX(48px); } } @media (prefers-reduced-motion: reduce) { .hello-next { animation: none; } }`}</style>
      {children}
    </div>
  );
}
