import { useSlidingThumb } from "../../motion.ts";
import { createContext, useContext, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { href } from "../../router.ts";
import { cx } from "../../components/ui.tsx";
import { rowAvailable, rowById, rowTarget, type FeatureFlags, type Five } from "./map.ts";

/** What a settings page's rows need to know: who is looking, and which row an address pointed at. */
export interface FiveState {
  page: Five;
  guest: boolean;
  features: FeatureFlags;
  /** the row the address names, for as long as the address does */
  landed: string | null;
  /** the same row, marked for a moment after arriving */
  target: string | null;
}
export const FiveContext = createContext<FiveState>({ page: "you", guest: false, features: {}, landed: null, target: null });

// --- Rows ---------------------------------------------------------------------------------------

/**
 * Rows in one card, with a small title over it when given. A card whose rows are all hidden (a
 * guest, a mod that's off) takes no room, title and all.
 */
export function Group({ children, className, title }: { children?: ReactNode; className?: string; title?: string }) {
  const card = <div className={cx("rounded-[12px] bg-card divide-y divide-line overflow-hidden empty:hidden", className)}>{children}</div>;
  if (!title) return card;
  return (
    <section aria-label={title} className="has-[>div:empty]:hidden">
      <h2 className="px-1 pb-1.5 text-[13px] font-medium text-muted">{title}</h2>
      {card}
    </section>
  );
}

export const rowDomId = (id: string) => `setting-${id}`;
const ROW = "flex items-center gap-3 px-4 min-h-[52px] md:min-h-[60px] text-body";

/**
 * One setting, named by its id in the map: the label on the left, its value or control on the
 * right, one line. A row the map calls a sheet is a link that opens it. Returns nothing when the
 * row isn't for this person.
 */
export function SRow({ id, value, children, to, external, danger, icon }: { id: string; value?: ReactNode; children?: ReactNode; to?: string; external?: boolean; danger?: boolean; icon?: ReactNode }) {
  const s = useContext(FiveContext);
  const r = rowById(id);
  if (!rowAvailable(r, s.guest, s.features)) return null;
  const marked = s.target === id && "bg-side-active";
  const label = (
    <>
      {icon && <span className="shrink-0 text-muted">{icon}</span>}
      <span className={cx("flex-1 min-w-[6.5rem]", danger && "text-bad")}>{r.label}</span>
    </>
  );
  const link = to ?? (r.sheet ? href({ view: "settings", ...rowTarget(r) }) : null);
  if (link)
    return (
      <a id={rowDomId(id)} href={link} {...(external ? { target: "_blank", rel: "noreferrer" } : {})} className={cx(ROW, "hover:bg-hover", marked)}>
        {label}
        {value != null && value !== "" && <span className="min-w-0 max-w-[60%] truncate text-muted">{value}</span>}
        <ChevronRight size={15} className="shrink-0 text-faint" aria-hidden />
      </a>
    );
  return (
    <div id={rowDomId(id)} className={cx(ROW, "flex-wrap gap-y-1 py-1.5", marked)}>
      {label}
      {value != null && value !== "" && <span className="min-w-0 max-w-[60%] truncate text-muted">{value}</span>}
      {children}
    </div>
  );
}

/** Pick one of a few, small enough to sit on a row. */
export function Seg<T extends string>({ value, options, onChange, label, disabled }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void; label: string; disabled?: boolean }) {
  const thumb = useSlidingThumb<HTMLDivElement>(value, options.length);
  return (
    <div ref={thumb.ref} className="relative inline-flex shrink-0 gap-0.5 rounded-[8px] bg-side-active p-0.5" role="radiogroup" aria-label={label}>
      {thumb.ready && <span aria-hidden className="seg-thumb absolute top-0.5 bottom-0.5 left-0 rounded-[6px] bg-panel shadow-[0_1px_2px_rgba(0,0,0,.1),0_0_0_0.5px_var(--line2)] dark:bg-[#2c2c2c]" style={thumb.style} />}
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={cx("relative h-[26px] px-3 rounded-[6px] text-[13px] leading-[18px] whitespace-nowrap transition-colors duration-200 disabled:opacity-50", value === v ? "text-ink font-medium" : "text-muted hover:text-ink", value === v && !thumb.ready && "bg-panel")}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** A line under a card: an error, or the one sentence that has to stay. */
export function Note({ children, bad }: { children: ReactNode; bad?: boolean }) {
  return (
    <p role={bad ? "alert" : undefined} className={cx("px-1 -mt-2 text-[13px] leading-snug", bad ? "text-bad" : "text-muted")}>
      {children}
    </p>
  );
}
