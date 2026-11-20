import { useEffect, useRef, useState } from "react";
import { useMotionReduced } from "../../theme.ts";
import { GOALS, pickedGoals, turnOnFor, type GoalId } from "../../onboardingV3.ts";
import { OnboardingGhost } from "./OnboardingGhost.tsx";

const STYLE = `
@keyframes ob-pop { 0% { opacity: 0; transform: translateY(6px) scale(.98); } 100% { opacity: 1; transform: none; } }
.ob-pop { animation: ob-pop .32s cubic-bezier(.32,.72,0,1) both; }
@keyframes ob-hop-a { 0%,100% { transform: none; } 35% { transform: translateY(-10px) scale(.96,1.05); } 70% { transform: translateY(0) scale(1.06,.94); } }
@keyframes ob-hop-b { 0%,100% { transform: none; } 35% { transform: translateY(-10px) scale(.96,1.05); } 70% { transform: translateY(0) scale(1.06,.94); } }
.ob-hop-a { animation: ob-hop-a .5s cubic-bezier(.32,.72,0,1); }
.ob-hop-b { animation: ob-hop-b .5s cubic-bezier(.32,.72,0,1); }
@keyframes ob-page { 0% { opacity: 0; transform: translateX(40px); } 100% { opacity: 1; transform: none; } }
.ob-page { animation: ob-page .45s cubic-bezier(.32,.72,0,1) both; }
.ob-choice { transition: background .15s ease, border-color .15s ease, transform .1s ease; }
.ob-choice:hover { border-color: rgb(28 28 28 / .32); }
.ob-choice[aria-pressed="true"], .ob-choice[aria-pressed="true"]:hover { border-color: var(--wisp); background: rgb(169 139 245 / .12); }
.ob-choice:active { transform: scale(.97); }
@media (prefers-reduced-motion: reduce) {
  .ob-pop, .ob-hop-a, .ob-hop-b, .ob-page { animation: none; }
  .ob-choice { transition: none; }
  .ob-choice:active { transform: none; }
}`;

/** The 7-step track, top right: done ink, current an 18px ink pill, the rest faint. */
export function OnboardingDots({ step, of = 7 }: { step: number; of?: number }) {
  return (
    <span className="flex gap-1.5 items-center" role="img" aria-label={`Step ${step + 1} of ${of}`}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className="block h-1.5 rounded-[3px]" style={{ width: i === step ? 18 : 6, background: i <= step ? "var(--ink)" : "var(--input)" }} />
      ))}
    </span>
  );
}

/**
 * Page 2 of the first run: what the person wants help with. Each pick shows a message the wisp
 * would send them that day and what it will turn on (set up on the last page, not here).
 */
export function GoalsStep({
  name,
  initial = [],
  initialOther = "",
  onContinue,
  onSkip,
}: {
  name: string;
  initial?: readonly string[];
  initialOther?: string;
  onContinue: (goals: GoalId[], other: string) => void;
  onSkip: () => void;
}) {
  const reduced = useMotionReduced();
  const first = name.trim().split(/\s+/)[0] ?? "";
  const [on, setOn] = useState<GoalId[]>(() => pickedGoals(initial).map((g) => g.id));
  const [other, setOther] = useState(initialOther);
  const [hop, setHop] = useState(0);
  const [smile, setSmile] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const toggle = (id: GoalId) => {
    const adding = !on.includes(id);
    setOn((cur) => (adding ? [...cur, id] : cur.filter((x) => x !== id)));
    if (reduced) return;
    setHop((h) => h + 1);
    setSmile(adding);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSmile(false), 1100);
  };

  const picked = pickedGoals(on);
  const any = picked.length > 0;
  const chips = turnOnFor(on);
  return (
    <div className="fixed inset-0 z-10 flex flex-col bg-panel text-ink text-[14px] leading-[22px]">
      <style>{STYLE}</style>
      <div className="h-14 px-6 flex items-center justify-between shrink-0 safe-top">
        <span className="text-[15px] font-[650] tracking-[-0.01em]">Wisp</span>
        <OnboardingDots step={1} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="ob-page min-h-full grid grid-cols-1 lg:grid-cols-[minmax(0,560px)_minmax(0,440px)] gap-10 lg:gap-[72px] justify-center items-center px-4 sm:px-6 pt-4 pb-10">
          <div className="flex flex-col gap-6 min-w-0">
            <div className="flex items-center gap-4">
              <span className={hop === 0 ? "block" : hop % 2 ? "block ob-hop-a" : "block ob-hop-b"} style={{ transformOrigin: "50% 100%" }}>
                <OnboardingGhost size={64} working={any} smiling={smile} talking={smile} />
              </span>
              <div className="flex flex-col gap-0.5 min-w-0">
                <h1 className="text-[24px] leading-[30px] font-[650] tracking-[-0.015em]">{first ? `What should I help with, ${first}?` : "What should I help with?"}</h1>
                <p className="text-[15px] leading-[22px] text-muted">Pick as many as you like.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {GOALS.map((g) => {
                const sel = on.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={sel}
                    onClick={() => toggle(g.id)}
                    className="ob-choice h-12 flex items-center gap-3 px-3.5 rounded-[14px] border border-[var(--line2)] bg-panel text-ink text-left"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 opacity-75">
                      <path d={g.icon} />
                    </svg>
                    <span className="flex-1 font-medium truncate">{g.label}</span>
                    <span
                      aria-hidden
                      className="w-[18px] h-[18px] rounded-full shrink-0 flex items-center justify-center border"
                      style={{ background: sel ? "var(--ink)" : "transparent", borderColor: sel ? "var(--ink)" : "var(--input)" }}
                    >
                      {sel && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--panel)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m5 12 5 5 9-10" />
                        </svg>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <label className="flex items-center gap-2 h-11 px-4 rounded-full border border-[var(--input)] bg-[var(--control)] focus-within:border-ink">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden className="shrink-0 text-faint">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="sr-only">Something else</span>
              <input
                value={other}
                onChange={(e) => setOther(e.target.value)}
                placeholder="Something else? Say it in your words"
                maxLength={500}
                className="flex-1 min-w-0 bg-transparent outline-none text-ink text-[14px] placeholder:text-faint"
              />
            </label>

            <div className="flex gap-2 items-center">
              <button type="button" onClick={() => onContinue(on, other.trim())} className="setup-press h-11 px-[22px] rounded-full bg-ink text-panel font-semibold">
                Continue
              </button>
              <button type="button" onClick={onSkip} className="h-11 px-3.5 rounded-full text-muted hover:text-ink">
                Skip for now
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 min-w-0">
            <span className="text-[13px] font-semibold text-muted">{any && first ? `A day with me, ${first}` : "A day with me"}</span>
            <div className="bg-[var(--card)] rounded-[18px] p-[18px] flex flex-col gap-2.5 min-h-[360px]" aria-live="polite">
              {!any && <div className="flex-1 flex items-center justify-center text-center text-faint px-6 py-10">Pick something on the left and I'll show you what I'd do.</div>}
              {picked.slice(0, 4).map((g) => (
                <div key={g.id} className="ob-pop flex gap-2.5 items-start">
                  <OnboardingGhost size={28} follow={false} />
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-[12px] leading-4 text-muted">{g.when}</span>
                    <span className="bg-panel rounded-[18px] px-3.5 py-[9px] self-start">{g.text}</span>
                  </div>
                </div>
              ))}
            </div>
            {any && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-muted">I'll turn on</span>
                <div className="flex flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <span key={c.label} className="ob-pop h-7 flex items-center px-3 rounded-[14px] text-[13px]" style={{ background: "rgb(169 139 245 / .16)" }}>
                      {c.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
