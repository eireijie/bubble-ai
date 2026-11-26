import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LAYER } from "./layers.ts";
import { X } from "lucide-react";
import { cx } from "./ui.tsx";

/** How big a pop-up is (router.popupSize), and "full" for the one page that needs the whole window inside it (Memory's graph). */
export type DialogSize = "large" | "medium" | "full";

/**
 * Inside a pop-up: how to close it, and how big it is. Views use it to drop their own page chrome
 * (Back, the big top padding) and leave room for the pop-up's close button. `setFull` lets a view
 * ask for the whole window while it shows something that needs it (Memory's graph).
 */
export const SettingsDialogContext = createContext<{ close: () => void; size: DialogSize; setFull?: (full: boolean) => void } | null>(null);

/** The pop-up this view is drawn in, or null when it's a page. */
export const useInPopup = () => useContext(SettingsDialogContext);

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
 * The panel's size: large 960 wide, medium 640 wide, both as tall as what they hold up to
 * min(680, window - 96), so a short place (no computers yet) isn't a big empty box, and at least
 * 180 so one still loading isn't a sliver; full is the
 * whole window less a margin.
 */
export const DIALOG_SIZE: Record<DialogSize, string> = {
  large: "min-h-[min(180px,calc(100vh-96px))] max-h-[min(680px,calc(100vh-96px))] w-[min(960px,calc(100vw-48px))]",
  medium: "min-h-[min(180px,calc(100vh-96px))] max-h-[min(680px,calc(100vh-96px))] w-[min(640px,calc(100vw-48px))]",
  full: "h-[calc(100vh-48px)] w-[calc(100vw-48px)]",
};

/**
 * Most places on desktops, as a pop-up over the chat (canvas "Calmer layout", board B): centred,
 * over a dim. Escape, a click outside or the close button closes it; it rises 8px and grows from
 * 96% as it opens and fades out again. The chat under it stays where it was. Moving to another
 * place while it's open swaps what's inside (`swapKey`) with a short crossfade.
 */
export function SettingsDialog({ label, closing, onClose, size = "large", swapKey, setFull, children }: { label: string; closing: boolean; onClose: () => void; size?: DialogSize; swapKey?: string; setFull?: (full: boolean) => void; children: ReactNode }) {
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
  // the panel is as tall as what it holds (up to its size's max), and never shrinks while one place is
  // open: moving between its sections, or its list loading, doesn't make it jump. A swap starts over.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || size === "full" || typeof ResizeObserver === "undefined") return;
    let tallest = 0;
    el.style.minHeight = "";
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (h <= tallest) return;
      tallest = h;
      el.style.minHeight = `min(${h}px, calc(100vh - 96px))`;
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      el.style.minHeight = "";
    };
  }, [swapKey, size]);
  // a swap moves focus into the new place too
  const firstKey = useRef(swapKey);
  useEffect(() => {
    if (swapKey === firstKey.current) return;
    firstKey.current = undefined;
    panel.current?.focus({ preventScroll: true });
  }, [swapKey]);
  return (
    <div
      className={cx("settings-pop fixed inset-0 grid place-items-center p-6", LAYER.settings)}
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
        data-size={size}
        className={cx("settings-pop-panel relative flex flex-col overflow-hidden rounded-[16px] border border-line bg-panel shadow-float outline-none", DIALOG_SIZE[size], closing && "pointer-events-none")}
      >
        <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" className="absolute right-4 top-4 z-20 grid size-[30px] place-items-center rounded-[8px] text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/40">
          <X size={17} strokeWidth={1.8} />
        </button>
        <SettingsDialogContext.Provider value={{ close: onClose, size, setFull }}>
          <div key={swapKey} className={cx("flex min-h-0 flex-1 flex-col", swapKey !== undefined && "pop-swap")}>
            {children}
          </div>
        </SettingsDialogContext.Provider>
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
        const cls = cx("relative flex h-[34px] shrink-0 items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[length:var(--t-row)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40", on ? "font-medium text-ink" : "text-ink/80 hover:bg-hover hover:text-ink");
        const inner = (
          <>
            <span className={cx("grid size-4 shrink-0 place-items-center [&>svg]:size-4", on ? "text-wisp-strong" : "text-muted")} aria-hidden>
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
