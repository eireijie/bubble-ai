import { useEffect, useRef, type ReactNode } from "react";
import { SquareTerminal } from "lucide-react";
import type { Agent } from "@bubble-ai/core";
import { AgentAvatar, Menu, cx } from "../components/ui.tsx";

/**
 * Code's one slim row: a pill that says what's open (and switches to something else), the
 * computer it's on, and two icon buttons at the right (split, new shell). Everything else that
 * used to sit around the terminals is in these three menus or on a key.
 */

export type BarItems = ({ label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean } | "divider")[];

export function CodeBar({ lead, computer, note, children }: { lead: ReactNode; computer?: string | null; note?: string | null; children?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 px-2 md:px-4">
      {lead}
      {computer && <span className="min-w-0 truncate pl-1 text-[13px] text-muted">{computer}</span>}
      {note && <span className="min-w-0 truncate pl-2 text-[13px] text-bad">{note}</span>}
      <span className="flex-1" />
      {children}
    </header>
  );
}

/** Opens a menu from outside it (a key): `tick` going up toggles it open. */
function useOpener(tick: number | undefined) {
  const toggle = useRef<() => void>(() => {});
  const isOpen = useRef(false);
  // only a change opens it: a menu that mounts later must not open by itself
  const seen = useRef(tick);
  useEffect(() => {
    if (tick === seen.current) return;
    seen.current = tick;
    if (!isOpen.current) toggle.current();
  }, [tick]);
  return (open: boolean, t: () => void) => {
    isOpen.current = open;
    toggle.current = t;
  };
}

/** The pill: the focused agent's ghost and name (or "Shells"). Its menu is where the task list went. */
export function Switcher({ agent, label, items, open }: { agent?: Agent; label: string; items: BarItems; open?: number }) {
  const hold = useOpener(open);
  return (
    <Menu
      trigger={(isOpen, toggle) => {
        hold(isOpen, toggle);
        return (
          <button
            type="button"
            onClick={toggle}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            aria-label={`${label}. Switch`}
            className={cx("inline-flex h-10 min-w-0 max-w-[60vw] items-center gap-[9px] rounded-[8px] pl-2 pr-4 text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring", isOpen ? "bg-side-active" : "hover:bg-hover")}
          >
            {agent ? <AgentAvatar agent={agent} size={26} live interactive={false} /> : <SquareTerminal size={18} strokeWidth={1.8} className="mx-1 shrink-0 text-muted" />}
            <span className="truncate font-semibold">{label}</span>
          </button>
        );
      }}
      items={items}
    />
  );
}

/** One of the two icon buttons at the right of the row, with its menu. */
export function BarMenu({ icon, label, title, items, open }: { icon: ReactNode; label: string; title?: string; items: BarItems; open?: number }) {
  const hold = useOpener(open);
  return (
    <Menu
      align="right"
      trigger={(isOpen, toggle) => {
        hold(isOpen, toggle);
        return (
          <button
            type="button"
            onClick={toggle}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            aria-label={label}
            title={title ?? label}
            className={cx("grid size-10 md:size-[34px] shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", isOpen ? "bg-side-active text-ink" : "text-muted hover:bg-hover hover:text-ink")}
          >
            {icon}
          </button>
        );
      }}
      items={items}
    />
  );
}

/** The dark block the terminals sit in, on a page that otherwise follows the theme. */
export const TERMINAL_BLOCK = "mx-2 md:mx-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] bg-[#0c0c0e] text-[#f2f2f4]";
