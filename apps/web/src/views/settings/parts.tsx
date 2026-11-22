import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cx } from "../../components/ui.tsx";

/** Set by a sheet that holds several old pages: each one's header becomes a section heading inside it. */
export const MergedPageContext = createContext(false);

/**
 * The top of what a settings sheet shows. The sheet itself carries the name, so this is only a
 * section heading inside a merged sheet, plus a line when there is something to say ("Loading…").
 */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  const merged = useContext(MergedPageContext);
  if (!merged && !children) return null;
  return (
    <div className={merged ? "mb-3 mt-7" : "mb-4"}>
      {merged && <h3 className="px-1 text-[13px] font-semibold text-muted">{title}</h3>}
      {children && <p className="mt-1.5 px-1 text-sm leading-snug text-muted max-w-xl">{children}</p>}
    </div>
  );
}

/** A group of settings with a small heading, like Linear's and Slack's. */
export function Section({ title, description, action, children }: { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-7">
      <div className="mb-2 px-1 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-faint tracking-wide">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] leading-snug text-faint">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Rows in a bordered card. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-[14px] bg-card divide-y divide-line overflow-hidden", className)}>{children}</div>;
}

/** One setting: what it is on the left, the control on the right (stacked on phones). */
export function Row({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cx("px-4 py-1.5 min-h-[52px] flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      <div className="min-w-[6.5rem] flex-1">
        <div className="text-body">{label}</div>
        {hint && <div className="mt-0.5 text-[13px] leading-snug text-faint">{hint}</div>}
      </div>
      {children !== undefined && <div className="shrink-0 flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx("relative inline-flex h-[30px] w-[52px] shrink-0 items-center rounded-full transition-colors disabled:opacity-40", on ? "bg-badge" : "bg-control border border-control-line")}
    >
      <span className={cx("m-knob inline-block size-6 rounded-full shadow bg-white ml-[3px]", on && "translate-x-[22px]")} />
    </button>
  );
}

/** Pick one of a few options, inline. */
export function Segmented<T extends string>({ value, options, onChange, label, disabled }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void; label: string; disabled?: boolean }) {
  return (
    <div className="inline-flex rounded-full border border-control-line p-[3px] bg-control" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={cx("h-[34px] px-3.5 rounded-full text-sm inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50", value === v ? "bg-ink/15 text-ink font-medium" : "text-muted hover:text-ink")}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function Select({ value, onChange, children, label, disabled, className }: { value: string; onChange: (v: string) => void; children: ReactNode; label: string; disabled?: boolean; className?: string }) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cx("h-9 rounded-xl border border-control-line bg-control px-2.5 text-sm disabled:opacity-60", className)}>
      {children}
    </select>
  );
}

/** "Saved" for a moment after a change that saves by itself. */
export function useSavedFlash(): [boolean, () => void] {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(false), 1600);
    return () => clearTimeout(t);
  }, [shown]);
  return [shown, () => setShown(true)];
}

export function SavedNote({ shown }: { shown: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ok" aria-live="polite">
      {shown && (
        <>
          <Check size={13} /> Saved
        </>
      )}
    </span>
  );
}

/** Non-owners see the same controls, switched off: no banner says so. Kept so pages needn't change. */
export function OwnersOnly(_: { show: boolean }) {
  return null;
}
