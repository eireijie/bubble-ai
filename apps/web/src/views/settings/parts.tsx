import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useSlidingThumb } from "../../motion.ts";
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
      {merged && <h3 className="px-1 text-[13px] md:text-[12px] font-semibold md:font-medium text-muted">{title}</h3>}
      {children && <p className="mt-1.5 px-1 text-sm md:text-[13px] leading-snug text-muted max-w-xl">{children}</p>}
    </div>
  );
}

/** A group of settings with a small heading, like Linear's and Slack's. */
export function Section({ title, description, action, children }: { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-7">
      <div className="mb-2 px-1 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] md:text-[12px] font-semibold md:font-medium text-faint md:text-muted tracking-wide md:tracking-normal">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] md:t-cap leading-snug text-faint">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Rows in a bordered card. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-[12px] bg-card divide-y divide-line overflow-hidden", className)}>{children}</div>;
}

/** One setting: what it is on the left, the control on the right (stacked on phones). */
export function Row({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cx("px-4 py-1.5 min-h-[52px] md:min-h-[44px] flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      <div className="min-w-[6.5rem] flex-1">
        <div className="text-body leading-5">{label}</div>
        {hint && <div className="mt-0.5 text-[13px] leading-snug md:t-cap text-faint">{hint}</div>}
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
      className={cx("relative inline-flex h-[30px] w-[52px] md:h-5 md:w-[34px] shrink-0 items-center rounded-full transition-colors disabled:opacity-40", on ? "m-switch-on" : "bg-ink/20")}
    >
      <span className={cx("m-knob inline-block size-6 md:size-4 rounded-full shadow bg-white ml-[3px] md:ml-[2px]", on && "translate-x-[22px] md:translate-x-[14px]")} />
    </button>
  );
}

/** Pick one of a few options, inline. The chosen one sits on a thumb that slides to the next one picked. */
export function Segmented<T extends string>({ value, options, onChange, label, disabled }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void; label: string; disabled?: boolean }) {
  const thumb = useSlidingThumb<HTMLDivElement>(value, options.length);
  return (
    <div ref={thumb.ref} className="relative inline-flex rounded-[8px] p-[2px] bg-side-active" role="radiogroup" aria-label={label}>
      {thumb.ready && <span aria-hidden className="seg-thumb absolute top-[2px] bottom-[2px] left-0 rounded-[6px] bg-panel shadow-[0_1px_2px_rgba(0,0,0,.1),0_0_0_0.5px_var(--line2)] dark:bg-[#2c2c2c]" style={thumb.style} />}
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={cx("relative h-[28px] md:h-6 px-3.5 md:px-2.5 rounded-[6px] text-[13.5px] md:text-[length:var(--t-seg)] inline-flex items-center gap-1.5 whitespace-nowrap transition-colors duration-200 disabled:opacity-50", value === v ? "text-ink font-medium" : "text-muted hover:text-ink", value === v && !thumb.ready && "bg-panel")}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function Select({ value, onChange, children, label, disabled, className }: { value: string; onChange: (v: string) => void; children: ReactNode; label: string; disabled?: boolean; className?: string }) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cx("h-9 md:h-8 rounded-xl md:rounded-[8px] border border-control-line bg-control px-2.5 text-sm md:text-[13px] disabled:opacity-60", className)}>
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
