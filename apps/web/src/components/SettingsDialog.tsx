import { createContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./ui.tsx";

/** Inside the Settings pop-up: how to close it. Views use it to swap their Back for the pop-up's own close. */
export const SettingsDialogContext = createContext<{ close: () => void } | null>(null);

/** Something else on top (a menu, a picker, another dialog) gets Escape first. */
function somethingAbove(panel: HTMLElement | null): boolean {
  if (document.querySelector('[role="menu"], [role="listbox"]')) return true;
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]')).some((d) => d !== panel && !panel?.contains(d) && !d.contains(panel));
}

/**
 * Whether this key closes the pop-up: Escape, unless something took it already, something sits on
 * top (a menu, another dialog), or it was pressed in a search field that still has words in it.
 */
export function escapeCloses(e: { key: string; defaultPrevented: boolean; target: unknown }, above: boolean): boolean {
  if (e.key !== "Escape" || e.defaultPrevented || above) return false;
  const t = e.target as { tagName?: string; type?: string; value?: string } | null;
  return !(t && t.tagName === "INPUT" && t.type === "search" && t.value);
}

/**
 * Settings, and one agent's settings, as a pop-up over the app (desktops): centred, a list of
 * sections on the left and the section on the right. Escape, a click outside or the close button
 * closes it; it scales in from 96% and fades out again. The app under it stays where it was.
 */
export function SettingsDialog({ label, closing, onClose, children }: { label: string; closing: boolean; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (closing) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !escapeCloses(e, somethingAbove(panel.current))) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [closing]);
  // focus moves into the pop-up, and back to where it was when it closes
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus({ preventScroll: true });
    return () => {
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="settings-pop fixed inset-0 z-[60] grid place-items-center p-6 md:p-12"
      data-state={closing ? "out" : "in"}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !closing) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cx("settings-pop-panel relative flex h-[min(800px,calc(100vh-96px))] w-[min(1100px,calc(100vw-96px))] flex-col overflow-hidden rounded-[16px] border border-line bg-panel shadow-float outline-none", closing && "pointer-events-none")}
      >
        <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" className="absolute right-6 top-6 z-20 grid size-8 place-items-center rounded-[8px] text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/40">
          <X size={18} strokeWidth={1.8} />
        </button>
        <SettingsDialogContext.Provider value={{ close: onClose }}>{children}</SettingsDialogContext.Provider>
      </div>
    </div>
  );
}

export interface PopNavItem {
  key: string;
  label: string;
  icon: ReactNode;
  href?: string;
  onSelect?: () => void;
  /** a small dot after the label: "needs you" or "unsaved" */
  dot?: "needs" | "unsaved" | null;
}

/**
 * The list of sections down the left of a settings pop-up (and of the full Settings page): line
 * icons, the chosen one on a soft tile that glides to the next one picked.
 */
export function PopNav({ label, items, current, onPick }: { label: string; items: PopNavItem[]; current: string | null; onPick?: () => void }) {
  const box = useRef<HTMLElement>(null);
  const [mark, setMark] = useState<{ top: number; height: number } | null>(null);
  const glide = useRef(false);
  useLayoutEffect(() => {
    const el = current ? box.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(current)}"]`) : null;
    setMark(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
  }, [current, items.length]);
  // the first placement is instant; after that the tile glides
  useEffect(() => {
    if (mark) glide.current = true;
  }, [mark]);
  return (
    <nav ref={box} aria-label={label} className="pop-nav flex flex-col gap-0.5">
      {mark && <span aria-hidden className="pop-nav-mark" style={{ transform: `translateY(${mark.top}px)`, height: mark.height, transition: glide.current ? undefined : "none" }} />}
      {items.map((it) => {
        const on = it.key === current;
        const cls = cx("relative flex h-11 shrink-0 items-center gap-3 rounded-[12px] px-3 text-left text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40", on ? "font-medium text-ink" : "text-ink/75 hover:bg-hover hover:text-ink");
        const inner = (
          <>
            <span className={cx("grid size-[21px] shrink-0 place-items-center", on ? "text-wisp-strong" : "text-muted")} aria-hidden>
              {it.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.dot === "needs" && <span className="size-1.5 shrink-0 rounded-full bg-st-needs" aria-label="needs you" />}
            {it.dot === "unsaved" && <span className="size-1.5 shrink-0 rounded-full bg-wisp" aria-label="unsaved changes" />}
          </>
        );
        return it.href ? (
          <a key={it.key} data-key={it.key} href={it.href} onClick={onPick} aria-current={on ? "page" : undefined} className={cls}>
            {inner}
          </a>
        ) : (
          <button key={it.key} data-key={it.key} type="button" onClick={() => (it.onSelect?.(), onPick?.())} aria-current={on ? "page" : undefined} className={cls}>
            {inner}
          </button>
        );
      })}
    </nav>
  );
}
