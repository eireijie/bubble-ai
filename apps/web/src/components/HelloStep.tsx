import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMotionReduced } from "../theme.ts";
import { OnboardingGhost as HelloGhost } from "./onboarding/OnboardingGhost.tsx";

/** The page's entrance; the ghost's own motion is in OnboardingGhost and index.css. */
const STYLE = `
@keyframes hello-in { from { opacity: 0; transform: translateY(6px); } }
.hello-in { animation: hello-in .45s cubic-bezier(.32,.72,0,1) both; }
.hello-in2 { animation: hello-in .45s cubic-bezier(.32,.72,0,1) .5s both; }
.hello-in3 { animation: hello-in .45s cubic-bezier(.32,.72,0,1) .9s both; }
@media (prefers-reduced-motion: reduce) {
  .hello-in, .hello-in2, .hello-in3 { animation: none; }
}`;

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
