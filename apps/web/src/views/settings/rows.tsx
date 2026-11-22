import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { href } from "../../router.ts";
import { cx } from "../../components/ui.tsx";
import { pageRows, rowAvailable, rowById, rowTarget, type FeatureFlags, type Five } from "./map.ts";

/** What a settings page's rows need to know: who is looking, and which row an address pointed at. */
export interface FiveState {
  page: Five;
  guest: boolean;
  features: FeatureFlags;
  showAll: boolean;
  /** the row the address names, for as long as the address does */
  landed: string | null;
  /** the same row, marked for a moment after arriving */
  target: string | null;
}
export const FiveContext = createContext<FiveState>({ page: "you", guest: false, features: {}, showAll: false, landed: null, target: null });

// --- Show all, remembered per page until the tab closes ----------------------------------------

const KEY = "wisp.settings.showAll";
let opened: Partial<Record<Five, boolean>> = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Partial<Record<Five, boolean>>;
  } catch {
    return {};
  }
})();
const watchers = new Set<() => void>();
const watch = (on: () => void) => {
  watchers.add(on);
  return () => void watchers.delete(on);
};

export function setShowAll(page: Five, on: boolean): void {
  if (!!opened[page] === on) return;
  opened = { ...opened, [page]: on };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(opened));
  } catch {
    // private windows: it lasts until the page reloads
  }
  watchers.forEach((w) => w());
}

export function useShowAll(page: Five): boolean {
  return useSyncExternalStore(
    watch,
    () => !!opened[page],
    () => false,
  );
}

// --- Rows ---------------------------------------------------------------------------------------

/** Rows in one card. A card whose rows are all hidden (a guest, a mod that's off, Show all closed) takes no room. */
export function Group({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-[14px] bg-card divide-y divide-line overflow-hidden empty:hidden", className)}>{children}</div>;
}

export const rowDomId = (id: string) => `setting-${id}`;
const ROW = "flex items-center gap-3 px-4 min-h-[52px] text-body";

/**
 * One setting, named by its id in the map: the label on the left, its value or control on the
 * right, one line. A row the map calls a sheet is a link that opens it. Returns nothing when the
 * row isn't for this person, or sits under Show all while that is closed.
 */
export function SRow({ id, value, children, to, external, danger, icon }: { id: string; value?: ReactNode; children?: ReactNode; to?: string; external?: boolean; danger?: boolean; icon?: ReactNode }) {
  const s = useContext(FiveContext);
  const r = rowById(id);
  if (!rowAvailable(r, s.guest, s.features) || (r.all && !s.showAll)) return null;
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

/** "Show all" under a page's default rows, when there is more for this person. `children` sit at the other end of its line. */
export function ShowAll({ children }: { children?: ReactNode }) {
  const s = useContext(FiveContext);
  const more = pageRows(s.page, s.guest, s.features, true).length > 0;
  if (!more && !children) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      {more ? (
        <button type="button" aria-expanded={s.showAll} onClick={() => setShowAll(s.page, !s.showAll)} className="px-1 h-8 text-sm text-muted hover:text-ink">
          {s.showAll ? "Show less" : "Show all"}
        </button>
      ) : (
        <span />
      )}
      {children}
    </div>
  );
}

/** Pick one of a few, small enough to sit on a row. */
export function Seg<T extends string>({ value, options, onChange, label, disabled }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void; label: string; disabled?: boolean }) {
  return (
    <div className="inline-flex shrink-0 gap-0.5 rounded-full border border-line p-0.5" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={cx("h-[26px] px-3 rounded-full text-[13px] leading-[18px] whitespace-nowrap disabled:opacity-50", value === v ? "bg-side-active text-ink font-semibold" : "text-muted hover:text-ink")}
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
