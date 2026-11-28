import { useInboxCount, useStore } from "../store.ts";
import { href, type Route } from "../router.ts";
import { PlaceIcon, type PlaceKey } from "./r11Icons.tsx";
import { cx } from "./ui.tsx";

/** Which of the five tabs a page belongs to on phones, or null when the page is deeper than a tab (a chat, one computer). */
export function phoneTab(r: Route): PlaceKey | null {
  switch (r.view) {
    case "chats":
      return "chats";
    case "chat":
      return r.channelId ? null : "chats";
    case "computers":
      return r.computerId || r.deviceId || r.teach || r.watch ? null : "computers";
    case "vault":
      return r.path ? null : "memory";
    case "marketplace":
      return r.app ? null : "marketplace";
    case "connectors":
    case "skills":
    case "mods":
      return "marketplace";
    case "more":
      return "more";
    default:
      return null;
  }
}

/**
 * The phone's tab bar (round 11, board 8 C): Chats, Computers, Memory, Marketplace, More, on one glass
 * pill at the bottom. Chats carries a blue count when something needs you. Switching tabs is instant.
 */
export function PhoneTabs({ on }: { on: PlaceKey }) {
  const guest = useStore((s) => s.me?.role === "guest");
  const needs = useInboxCount();
  const tabs: { key: PlaceKey; label: string; to: Route }[] = [
    { key: "chats", label: "Chats", to: { view: "chats" } },
    ...(!guest ? [{ key: "computers" as const, label: "Computers", to: { view: "computers", computerId: null } as Route }] : []),
    { key: "memory", label: "Memory", to: { view: "vault", path: null } },
    ...(!guest ? [{ key: "marketplace" as const, label: "Marketplace", to: { view: "marketplace" } as Route }] : []),
    { key: "more", label: "More", to: { view: "more" } },
  ];
  return (
    <nav aria-label="Places" className="r11-tabbar pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(14px,env(safe-area-inset-bottom))]">
      <div className="gl pointer-events-auto flex h-[58px] items-center rounded-[29px] px-[5px]">
        {tabs.map((t) => {
          const active = t.key === on;
          return (
            <a key={t.key} href={href(t.to)} aria-current={active ? "page" : undefined} className={cx("relative flex flex-1 flex-col items-center gap-0.5 rounded-[22px] py-1.5 text-[10.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40", active ? "bg-side-active font-semibold text-ink" : "text-muted")}>
              <PlaceIcon place={t.key} size={20} />
              {t.label}
              {t.key === "chats" && needs > 0 && (
                <span aria-label={`${needs} need you`} className="absolute right-[14%] top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0a84ff] px-1 text-[10px] font-bold text-white">
                  {needs > 99 ? "99+" : needs}
                </span>
              )}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
