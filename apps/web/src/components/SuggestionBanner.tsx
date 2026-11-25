import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cx } from "./ui.tsx";

/**
 * One suggested next step, floating across the top of the chat (2026-11-25, Messages-style): a short
 * line, one filled button that does it, and a round close. Agents' setup prompts ("Connect Gmail"),
 * the first chat's one-step asks and the harness sign-in use it. The chat gives it a slot under its
 * header; outside a chat it sits where it's rendered.
 */
export const BannerSlot = createContext<HTMLElement | null>(null);

export function SuggestionBanner({
  icon,
  text,
  action,
  onAction,
  onClose,
  closeLabel = "Not now",
  children,
  label,
}: {
  icon?: ReactNode;
  text: ReactNode;
  /** the filled button; leave out and pass `children` for a button of its own (a sign-in) */
  action?: string;
  onAction?: () => void;
  onClose?: () => void;
  closeLabel?: string;
  children?: ReactNode;
  label?: string;
}) {
  const slot = useContext(BannerSlot);
  const banner = (
    <div role="status" aria-label={label} className="suggestion-banner m-pop pointer-events-auto flex w-full max-w-[620px] items-center gap-3 rounded-[18px] bg-panel/95 py-2 pl-3.5 pr-2 shadow-[0_10px_30px_rgba(0,0,0,.12),0_0_0_1px_var(--line)] backdrop-blur-md dark:bg-[#1f1f1f]/95 dark:shadow-[0_10px_30px_rgba(0,0,0,.5),0_0_0_1px_rgba(255,255,255,.08)]">
      {icon && <span className="grid shrink-0 place-items-center text-muted">{icon}</span>}
      <span className="min-w-0 flex-1 text-[14px] leading-5 text-ink">{text}</span>
      {children}
      {action && (
        <button type="button" onClick={onAction} className="m-press h-[32px] shrink-0 rounded-full bg-[#7a5bdc] px-3.5 text-[14px] font-semibold text-white outline-none hover:brightness-110 focus-visible:ring-3 focus-visible:ring-ring/40">
          {action}
        </button>
      )}
      {onClose && (
        <button type="button" onClick={onClose} aria-label={closeLabel} title={closeLabel} className={cx("grid size-[30px] shrink-0 place-items-center rounded-full bg-[var(--bubble-them)] text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/40")}>
          <X size={15} strokeWidth={2} />
        </button>
      )}
    </div>
  );
  return slot ? createPortal(banner, slot) : banner;
}
