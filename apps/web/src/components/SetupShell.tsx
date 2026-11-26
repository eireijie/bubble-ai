import { BackgroundBubbles } from "./BackgroundBubbles.tsx";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { cx } from "./ui.tsx";

/** The first run's three screens. */
export const TRACK = ["You", "Your agent", "Its AI"] as const;

/**
 * The first run's one layout: step dots at the top (Back beside them), the screen's content, and
 * what you do next at the bottom. A card in the middle on a desktop, the whole screen on a phone.
 * With `onSubmit` the card is a form, so Enter presses the button in `foot`.
 */
export function SetupShell({ at, onBack, onSubmit, foot, center, children }: { at: 1 | 2 | 3; onBack?: (() => void) | null; onSubmit?: () => void; foot?: ReactNode; center?: boolean; children: ReactNode }) {
  useEscBack(onBack);
  const body = (
    <>
      <div className="shrink-0 h-14 grid grid-cols-[34px_1fr_34px] items-center gap-2 px-5 safe-top box-content">
        {onBack ? (
          <button type="button" className="size-[34px] grid place-items-center rounded-full text-muted hover:bg-hover hover:text-ink" aria-label="Back" onClick={onBack}>
            <ChevronLeft size={18} />
          </button>
        ) : (
          <span />
        )}
        <Track at={at} />
        <span />
      </div>
      <div key={at} className={cx("setup-rise flex-1 min-h-0 overflow-y-auto px-7 pt-3 pb-2 flex flex-col gap-3", center && "items-center")}>
        {children}
      </div>
      {foot && <div className="shrink-0 px-7 pt-3 pb-[max(24px,env(safe-area-inset-bottom))] flex flex-col items-center gap-1">{foot}</div>}
    </>
  );
  // 2026-11-25: the whole window, a few small bubbles drifting behind (no card); they pop when touched
  const card = "relative flex flex-col w-full flex-1 min-h-0 md:flex-none md:w-[440px] md:h-[min(700px,calc(100dvh-48px))]";
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-panel md:items-center md:justify-center text-ink text-[14px] leading-[22px]" data-testid="setup">
      <BackgroundBubbles />
      {onSubmit ? (
        <form
          className={card}
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {body}
        </form>
      ) : (
        <div className={card}>{body}</div>
      )}
    </div>
  );
}

/** The screen's one heading. */
export function SetupTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h1 className={cx("text-[24px] leading-[30px] font-[650] tracking-[-0.015em]", className)}>{children}</h1>;
}

/** A field: its name is its placeholder (and its label for screen readers). */
export const setupField = "h-12 w-full min-w-0 rounded-xl border border-line bg-card px-4 text-[15px] text-ink outline-none placeholder:text-faint focus:border-ring";

/** The one primary button at the bottom: an ink pill. */
export function SetupButton({ className, ...p }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className={cx("setup-press h-12 w-full inline-flex items-center justify-center gap-2 rounded-full bg-ink px-[22px] text-[15px] font-semibold text-panel outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-40 disabled:pointer-events-none", className)} />;
}

/** A quiet text button under it. */
export function SetupLink({ className, ...p }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...p} className={cx("min-h-10 px-3 rounded-full text-[14px] text-muted hover:text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50", className)} />;
}

/** One line saying what went wrong. */
export function SetupProblem({ children }: { children?: ReactNode }) {
  return children ? (
    <p role="alert" className="text-[13px] leading-5 text-bad">
      {children}
    </p>
  ) : null;
}

/** Phone widths. */
export function useNarrow(query = "(max-width: 760px)") {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

/** Esc is Back too, unless it's closing something else (a dialog) or would throw away typing. */
export function useEscBack(onBack: (() => void) | null | undefined) {
  useEffect(() => {
    if (!onBack) return;
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[role=dialog]")) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && (t as HTMLInputElement).value) return;
      onBack();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onBack]);
}

/** One dot a screen; the current one is a pill, the ones done and current are ink. */
export function Track({ at, track = TRACK }: { at: number; track?: readonly string[] }) {
  return (
    <div role="progressbar" aria-label={`Step ${Math.min(at, track.length)} of ${track.length}: ${track[Math.min(at, track.length) - 1]}`} aria-valuemin={1} aria-valuemax={track.length} aria-valuenow={Math.min(at, track.length)} className="ob-track">
      {track.map((name, i) => (
        <span key={name} className="ob-dot" data-state={i + 1 === at ? "now" : i + 1 < at ? "done" : "later"} />
      ))}
    </div>
  );
}

/** The green check that pops in. */
export function Tick({ size = 15 }: { size?: number }) {
  return (
    <svg className="ob-pop" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function Spinner({ size = 15 }: { size?: number }) {
  return (
    <svg className="ob-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}
