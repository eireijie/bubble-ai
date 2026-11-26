import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";
import { LAYER } from "./layers.ts";
import { cx } from "./ui.tsx";
import { SettingsDialogContext, escapeCloses } from "./SettingsDialog.tsx";

/** Beside the sidebar's Needs you row, or near the top of the sidebar when the row isn't there (nothing waits, or the sidebar is a rail). */
export function needsAnchor(): CSSProperties {
  const side = document.querySelector('nav[aria-label="Bubble AI"]')?.getBoundingClientRect();
  const row = document.querySelector("[data-needs-row]")?.getBoundingClientRect();
  const left = (side?.right ?? 0) + 6;
  const top = Math.max(8, Math.min(row && row.height > 0 ? row.top : (side?.top ?? 0) + 56, window.innerHeight - 240));
  return { left, top, maxHeight: window.innerHeight - top - 16 };
}

/**
 * Needs you (desktops): a 380px popover anchored to its row in the sidebar, not a page (canvas
 * "Calmer layout", board B). No dim; Escape, a click outside or the x closes it. The address stays
 * #/dashboard so links to it still open it.
 */
export function NeedsPopover({ count, closing, onClose, children }: { count: number; closing: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<CSSProperties | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const place = () => setAt(needsAnchor());
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);
  useEffect(() => {
    if (closing) return;
    const key = (e: KeyboardEvent) => {
      const above = !!document.querySelector('[role="menu"], [role="listbox"], [aria-modal="true"]');
      if (!escapeCloses(e, above)) return;
      e.preventDefault();
      closeRef.current();
    };
    // a press outside closes it; the row that opened it toggles it itself
    const down = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || ref.current?.contains(t) || t.closest("[data-needs-row]") || t.closest('[aria-modal="true"], [role="menu"]')) return;
      closeRef.current();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("mousedown", down, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("mousedown", down, true);
    };
  }, [closing]);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Needs you"
      tabIndex={-1}
      data-state={closing ? "out" : "in"}
      style={{ position: "fixed", ...(at ?? { left: -9999, top: 0 }) }}
      className={cx("needs-pop flex w-[380px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[14px] border border-line2 bg-float shadow-float outline-none", LAYER.settings, closing && "pointer-events-none")}
    >
      <div className="flex shrink-0 items-center gap-2 px-3.5 pt-3 pb-1.5">
        <h2 className="text-[14px] font-semibold">Needs you</h2>
        {count > 0 && <span className="text-[12px] font-semibold tabular-nums text-st-needs">{count}</span>}
        <span className="flex-1" />
        <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" className="grid size-7 place-items-center rounded-[8px] text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/40">
          <X size={15} strokeWidth={1.8} />
        </button>
      </div>
      <SettingsDialogContext.Provider value={{ close: onClose, size: "medium" }}>
        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-3.5">{children}</div>
      </SettingsDialogContext.Provider>
    </div>
  );
}
