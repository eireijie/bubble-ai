import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { STOPS, TOTAL, seenCount } from "../tour.ts";
import { createPortal } from "react-dom";
import { Apple, Bell, BookOpen, Building2, ExternalLink, FolderPlus, Sparkles, HardDrive, LayoutGrid, LifeBuoy, ListTodo, Compass, MessageSquarePlus, Plus, Search, Settings, SquareTerminal, Store, Users, X } from "lucide-react";
import { BubbleIcon } from "./icons.tsx";
import { GITHUB_URL } from "@bubble-ai/core";
import { startTour } from "./tour/tourRun.ts";
import { useReadyChecklist } from "../onboarding.ts";
import type { FeatureKey, Section } from "@bubble-ai/core";
import { api } from "../api.ts";
import { useFeatures } from "../features.ts";
import { logout } from "../logout.ts";
import { useStore, useInboxCount, usePrefs } from "../store.ts";
import { liveShape } from "../liveShape.ts";
import { machinesOn, useDevices } from "../devices.ts";
import { go, href, SETTINGS_PAGES, type Route } from "../router.ts";
import { openDm } from "../openDm.ts";
import { ComputersIcon, WispGhost } from "./icons.tsx";
import { NewOrgDialog, OrgList, OrgSwitcher, useOrgs } from "./OrgSwitcher.tsx";
import { Menu, PopBadge, cx } from "./ui.tsx";
import { ChatAvatar, ChatMenu, chatPreviewLine, startNewAgent, type Chat, type PreviewLine } from "./ChatList.tsx";
import { BLUE_DOT, SideList, newSideSection, useSideLayout } from "./SideList.tsx";
import { placeChats } from "../sidebarLayout.ts";
import { SIDEBAR, SIDEBAR_CLOSE_MS, SIDEBAR_EASE, SIDEBAR_OPEN_MS, SIDEBAR_TOGGLE, dragWidth, loadSidebar, saveSidebar, settle, stepWidth, type SidebarState } from "../sidebarWidth.ts";

/** Where the Chats item goes, and what desktops open on: the chat you were last in, kept on this device. */
const LAST_CHAT_KEY = "bubble.last-chat";
let lastChat: string | null = null;
export function rememberChat(id: string | null) {
  if (!id || id === lastChat) return;
  lastChat = id;
  try {
    localStorage.setItem(LAST_CHAT_KEY, id);
  } catch {}
}
function keptChat(): string | null {
  if (lastChat) return lastChat;
  try {
    return localStorage.getItem(LAST_CHAT_KEY);
  } catch {
    return null;
  }
}
export function chatsTarget(): string {
  const id = homeChat(useStore.getState().channels, false);
  return id ? href({ view: "chat", channelId: id, threadId: null }) : href({ view: "chats" });
}

/**
 * The chat desktops open on (#/): the one you were last in when it's still there, else (with
 * `newest`) the chat or team with the newest message. Null when there is none.
 */
export function homeChat(channels: { id: string; kind: string; joined?: boolean; archivedAt?: string | null; last?: { at: string } | null; createdAt: string }[], newest = true): string | null {
  const kept = keptChat();
  const open = (c: (typeof channels)[number]) => !c.archivedAt && (c.kind !== "channel" || c.joined);
  if (kept && channels.some((c) => c.id === kept && open(c))) return kept;
  if (!newest) return null;
  let best: { id: string; at: number } | null = null;
  for (const c of channels) {
    if (!open(c)) continue;
    const at = Date.parse(c.last?.at ?? c.createdAt);
    if (!best || at > best.at) best = { id: c.id, at };
  }
  return best?.id ?? null;
}

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

/** You: your initials on a glass circle. On desktops it opens Settings; on phones, the You page. */
export function UserAvatarButton({ size, desktop }: { size?: number; desktop?: boolean }) {
  size ??= desktop ? 38 : 44;
  const me = useStore((s) => s.me)!;
  const { orgs } = useOrgs();
  const elsewhere = orgs.some((o) => o.unread && !o.current && o.id !== me.workspace.id);
  return (
    <a href={desktop ? href({ view: "settings", page: null }) : href({ view: "you" })} aria-label="You and settings" title="You and settings" className="relative grid shrink-0 place-items-center rounded-full bg-wisp-soft font-semibold text-wisp-strong" style={{ width: size, height: size, fontSize: 13 }}>
      {initialsOf(me.user.name)}
      {elsewhere && <span className="absolute right-0 bottom-0 size-3 rounded-full bg-badge border-2 border-app" aria-label="New messages in another workspace" />}
    </a>
  );
}

/**
 * What mods add to the app's places while they're on. On desktops every entry sits in the menu
 * behind your picture; "more" items also go in More on phones. A mod adds its entry here instead
 * of its own check in the sidebar.
 */
const MOD_NAV: { feature: FeatureKey; place: "rail" | "more"; label: string; icon: (size: number) => ReactNode; to: Route; views: Route["view"][] }[] = [
  { feature: "code", place: "rail", label: "Code", icon: (size) => <SquareTerminal size={size} strokeWidth={1.8} />, to: { view: "code" }, views: ["code"] },
  { feature: "storage", place: "more", label: "Storage", icon: (size) => <HardDrive size={size} strokeWidth={1.8} />, to: { view: "settings", page: "storage" }, views: [] },
  { feature: "apple", place: "more", label: "Apple", icon: (size) => <Apple size={size} strokeWidth={1.8} />, to: { view: "settings", page: "apple" }, views: [] },
];

function modNav(features: Record<FeatureKey, boolean>, place: "rail" | "more") {
  return MOD_NAV.filter((m) => m.place === place && features[m.feature]);
}

/** The views More opens, so More shows active on them. */
export const MORE_VIEWS: Route["view"][] = ["more", "vault", "tasks", "marketplace", "connectors", "skills", "mods", "help", "agents"];

/** What More holds, the same on desktops and phones. */
export function useMoreItems(guest: boolean, size = 16, withAgents = false, withRail = false): { label: string; icon: ReactNode; to: Route }[] {
  const features = useFeatures();
  const icon = { size, strokeWidth: 1.8 };
  return [
    ...(withAgents ? [{ label: "All agents", icon: <BubbleIcon {...icon} />, to: { view: "agents", agentId: null } as Route }] : []),
    { label: "Memory", icon: <BookOpen {...icon} />, to: { view: "vault", path: null } },
    ...(!guest && features.tasks ? [{ label: "Tasks", icon: <ListTodo {...icon} />, to: { view: "tasks" } as Route }] : []),
    ...(!guest ? [...(withRail ? modNav(features, "rail") : []), ...modNav(features, "more")].map((m) => ({ label: m.label, icon: m.icon(size), to: m.to })) : []),
    ...(!guest ? [{ label: "Marketplace", icon: <Store {...icon} />, to: { view: "marketplace" } as Route }] : []),
    { label: "Help", icon: <LifeBuoy {...icon} />, to: { view: "help" } },
  ];
}

/** A round sidebar button, 40px with a soft fill: search, the plus, Computers on the rail. */
const ROUND = "relative grid size-[36px] shrink-0 place-items-center rounded-[10px] text-ink outline-none hover:bg-line2 focus-visible:ring-2 focus-visible:ring-ring/40";
const SOFT = "bg-side-active";
/** one icon in the wide sidebar's top row: 34px, a 10px corner */
const ICON_BTN = "relative grid size-[34px] shrink-0 place-items-center rounded-[10px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/40";
/** A row of the wide sidebar (60px, a big wisp, a rounded tile when it's the open one), and its square on the rail. Hover eases in; a press gives a little. */
const ITEM = "relative flex h-[60px] w-full items-center gap-3 rounded-[12px] px-2 text-left text-[16px] outline-none transition-[background-color,transform] duration-150 ease-out active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40";
const TILE = "relative grid size-[58px] place-items-center rounded-[12px] outline-none transition-[background-color,transform] duration-150 ease-out active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40";
const MENU_ITEM = "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-body hover:bg-hover";

/** How many notes the Memory vault holds (the pill at the foot), fetched again when notes change. */
function useNoteCount(guest: boolean): number | null {
  const version = useStore((s) => s.memoryVersion);
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (guest) return;
    let on = true;
    api<unknown[]>("GET", "/api/vault/notes").then((all) => on && setN(all.length), () => {});
    return () => {
      on = false;
    };
  }, [guest, version]);
  return n;
}

/** A small violet dot that breathes while an agent is working. */
function WorkDot({ corner }: { corner?: boolean }) {
  return <span aria-hidden className={cx("side-pulse shrink-0 rounded-full bg-wisp", corner ? "absolute bottom-[4px] right-[4px] size-[7px] box-content border-2 border-sidebar" : "size-[6px]")} />;
}

/**
 * A floating panel drawn on the page itself, because the sidebar clips what's inside it.
 * An outside click, Escape or a window resize closes it. It appears at once.
 */
function Float({ at, role, label, className, onClose, children }: { at: CSSProperties; role: "menu" | "dialog"; label: string; className?: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : e.type === "resize" || !ref.current?.contains(e.target as Node)) closeRef.current();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("resize", close);
    };
  }, []);
  return createPortal(
    <div ref={ref} role={role} aria-label={label} style={{ position: "fixed", ...at }} className={cx("pop-glass z-[100]", className)}>
      {children}
    </div>,
    document.body,
  );
}

function useSideChats(): Chat[] {
  const channels = useStore((s) => s.channels);
  const agents = useStore((s) => s.agents);
  return useMemo(() => {
    const out: Chat[] = [];
    for (const a of agents) {
      const dm = channels.find((c) => c.kind === "dm" && c.name.endsWith(`:${a.id}`));
      out.push({ key: `a:${a.id}`, kind: "dm", channel: dm ?? null, agent: a, name: a.name, at: dm?.last ? Date.parse(dm.last.at) : 0, unread: dm?.unread ?? 0, pinned: !!dm?.starred, muted: dm?.notify === "mute", sectionId: dm?.sectionId ?? null });
    }
    for (const c of channels) {
      if (c.kind !== "channel" || !c.joined || c.archivedAt) continue;
      out.push({ key: `c:${c.id}`, kind: "team", channel: c, agent: null, name: c.name, at: Date.parse(c.last?.at ?? c.createdAt), unread: c.unread, pinned: c.starred, muted: c.notify === "mute", sectionId: c.sectionId });
    }
    return out.sort((x, y) => y.at - x.at || x.name.localeCompare(y.name));
  }, [channels, agents]);
}

/** One group of the sidebar. `plain` has no header; `section` is one the person made. */
export interface SideGroup {
  id: string;
  label: string;
  chats: Chat[];
  plain?: boolean;
  section?: Section;
}

/**
 * The sidebar's groups: Pinned, then every agent and team that's in no section as one list with
 * no header (newest first, the order the chats come in), then the person's own sections. A
 * section shows once it exists, even empty; Pinned and the plain list only when they hold something.
 */
export function sidebarGroups(chats: Chat[], sections: Section[]): SideGroup[] {
  const ids = new Set(sections.map((s) => s.id));
  const groups: SideGroup[] = [
    { id: "pinned", label: "Pinned", chats: chats.filter((c) => c.pinned) },
    { id: "chats", label: "Agents and teams", plain: true, chats: chats.filter((c) => !c.pinned && (!c.sectionId || !ids.has(c.sectionId))) },
    ...sections.map((s) => ({ id: s.id, label: s.name, section: s, chats: chats.filter((c) => !c.pinned && c.sectionId === s.id) })),
  ];
  return groups.filter((g) => !!g.section || g.chats.length > 0);
}

const NO_LINE: PreviewLine = { text: "", working: false };

/** The same line under a name: a row whose words didn't change keeps the line object it had. */
const sameLine = (a: PreviewLine | undefined, b: PreviewLine): a is PreviewLine => !!a && a.text === b.text && a.working === b.working && !a.needs === !b.needs && !a.icon && !b.icon;

/** A chat in the sidebar. It renders again only when its own chat or its line changes, not on every step of dragging the sidebar's edge. */
const SideRow = memo(function SideRow({ chat, wide, active, line, sections, onNewSection }: { chat: Chat; wide: boolean; active: boolean; line: PreviewLine; sections: Section[]; onNewSection: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const unread = chat.unread > 0;
  const label = `${chat.name}${unread ? `, ${chat.unread} unread` : ""}${line.working ? ", working" : ""}${line.needs ? ", needs you" : ""}`;
  // one blue dot (round 4): it needs you, or there's something unread
  const dot = !!line.needs || unread;
  const cls = cx(wide ? ITEM : TILE, active ? "bg-side-active" : "hover:bg-side-hover");
  const inner = (
    <>
      {wide && <span aria-hidden className="side-dot" style={{ background: dot ? BLUE_DOT : "transparent" }} />}
      {/* agents and teams at one size: every bubble shape fills its box (Bubble.tsx) */}
      <span className="grid size-[46px] shrink-0 place-items-center">
        <ChatAvatar chat={chat} size={46} />
      </span>
      {wide && (
        <span className={cx("flex min-w-0 flex-1 flex-col", chat.muted && "opacity-60")}>
          <span className="truncate font-medium leading-[22px] text-ink">{chat.name}</span>
          {line.text && (
            <span className={cx("flex min-w-0 items-center gap-1.5 text-[15px] leading-[21px]", line.working ? "text-wisp-strong" : "text-muted")}>
              {line.working && <WorkDot />}
              {line.icon && <span className="inline-flex shrink-0">{line.icon}</span>}
              <span className={cx("truncate", line.working && "shimmer-text")}>{line.text}</span>
            </span>
          )}
        </span>
      )}
      {!wide && dot && <span aria-hidden className="side-dot absolute -left-1 top-1/2 -translate-y-1/2" style={{ background: BLUE_DOT }} />}
      {!wide && line.working && <WorkDot corner />}
    </>
  );
  const url = chat.channel ? href({ view: "chat", channelId: chat.channel.id, threadId: null }) : undefined;
  return (
    <div onContextMenu={(e) => (e.preventDefault(), onNewSection())}>
      {url ? (
        <a href={url} aria-label={label} title={wide ? undefined : label} aria-current={active ? "page" : undefined} data-bub-host="" className={cls}>{inner}</a>
      ) : (
        <button type="button" onClick={() => chat.agent && void openDm(chat.agent.id)} aria-label={label} title={wide ? undefined : label} data-bub-host="" className={cls}>{inner}</button>
      )}
      {menu && chat.channel && <ChatMenu chat={chat} channel={chat.channel} at={menu} onClose={() => setMenu(null)} sections={sections} onNewSection={onNewSection} />}
    </div>
  );
});

/** The notes Memory held when it was last opened: the strip's dot shows only when new ones arrived since. */
const MEMORY_SEEN_KEY = "bubble.memory.seen-notes";
function useNewNotes(notes: number | null, open: boolean): boolean {
  const [seen, setSeen] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(MEMORY_SEEN_KEY);
      return v == null ? null : Number(v);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (notes == null) return;
    // the first count this device sees is the baseline; opening Memory catches up
    if (seen == null || open) {
      if (seen !== notes) setSeen(notes);
      try {
        localStorage.setItem(MEMORY_SEEN_KEY, String(notes));
      } catch {}
    }
  }, [notes, open, seen]);
  return notes != null && seen != null && notes > seen;
}

/** Finish setup's card at the foot, until its x: after that it lives in the account menu. */
const SETUP_CARD_KEY = "bubble.setup-card.hidden";
function useSetupCardHidden(): [boolean, () => void] {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(SETUP_CARD_KEY) === "1";
    } catch {
      return false;
    }
  });
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(SETUP_CARD_KEY, "1");
    } catch {}
  };
  return [hidden, hide];
}

/** One place in the strip under search: a line icon with a tooltip (name, count, shortcut) and a dot when there's news. */
export interface StripPlace {
  key: string;
  label: string;
  icon: ReactNode;
  to: string;
  on: boolean;
  /** ⌘1 to ⌘5 */
  shortcut: number;
  /** said after the name in the tooltip: "1 on", "5 notes", "Off" */
  count?: string | null;
  /** a small dot at the corner: green while a computer is on, violet when new notes arrived */
  dot?: "on" | "new" | null;
  tour?: string;
}

/**
 * The places that aren't chats (canvas "Calmer layout", board A1): Computers, Memory, Apps and
 * skills, Tasks and Code (when its mod is on), in that order, ⌘1 to ⌘5. Guests get Memory alone.
 * Exported for the tests.
 */
export function stripPlaces(o: { guest: boolean; tasks: boolean; code: boolean; computersOn: number; notes: number | null; newNotes: boolean; open: Route | null; vaultTo: string }): StripPlace[] {
  const v = o.open?.view;
  const icon = { size: 18, strokeWidth: 1.8 };
  const all: (StripPlace | false)[] = [
    !o.guest && { key: "computers", label: "Computers", icon: <ComputersIcon size={18} />, to: href({ view: "computers", computerId: null }), on: v === "computers", shortcut: 1, count: o.computersOn > 0 ? `${o.computersOn} on` : null, dot: o.computersOn > 0 ? "on" : null, tour: "computers" },
    { key: "memory", label: "Memory", icon: <BookOpen {...icon} />, to: o.vaultTo, on: v === "vault", shortcut: 2, count: o.notes != null ? `${o.notes} ${o.notes === 1 ? "note" : "notes"}` : null, dot: o.newNotes ? "new" : null, tour: "vault" },
    !o.guest && { key: "apps", label: "Apps and skills", icon: <LayoutGrid {...icon} />, to: href({ view: "marketplace" }), on: v === "marketplace" || v === "skills" || v === "connectors" || v === "mods", shortcut: 3 },
    // Tasks is a mod: while it's off the icon opens Mods, where it's switched on
    !o.guest && { key: "tasks", label: "Tasks", icon: <ListTodo {...icon} />, to: href(o.tasks ? { view: "tasks" } : { view: "marketplace", app: "m:tasks" }), on: v === "tasks", shortcut: 4, count: o.tasks ? null : "Off" },
    !o.guest && o.code && { key: "code", label: "Code", icon: <SquareTerminal {...icon} />, to: href({ view: "code" }), on: v === "code", shortcut: 5 },
  ];
  return all.filter((p): p is StripPlace => !!p);
}

/** Where ⌘1 to ⌘5 go: the strip's places by number, or null when that one isn't there. */
export function shortcutTarget(n: number, o: { guest: boolean; tasks: boolean; code: boolean }): string | null {
  const p = stripPlaces({ ...o, computersOn: 0, notes: null, newNotes: false, open: null, vaultTo: href({ view: "vault", path: null }) }).find((x) => x.shortcut === n);
  return p?.to ?? null;
}

function StripButton({ p, align }: { p: StripPlace; align: "left" | "center" | "right" }) {
  const aria = [p.label, p.count].filter(Boolean).join(", ");
  return (
    <a
      href={p.to}
      data-tour={p.tour}
      aria-label={aria}
      aria-keyshortcuts={`Meta+${p.shortcut}`}
      aria-current={p.on ? "page" : undefined}
      className={cx("group/tip relative grid size-[34px] shrink-0 place-items-center rounded-[10px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/40", p.on ? "bg-side-active text-ink" : "text-muted hover:bg-side-active hover:text-ink")}
    >
      {p.icon}
      {p.dot && <span aria-hidden className={cx("absolute right-[6px] top-[4px] box-content size-1.5 rounded-full border-2 border-sidebar", p.dot === "on" ? "bg-[#30d158]" : "bg-wisp")} />}
      <span
        aria-hidden
        className={cx(
          "pointer-events-none absolute top-[calc(100%+6px)] z-20 whitespace-nowrap rounded-[6px] bg-ink px-2 py-[5px] text-[12px] leading-4 text-panel opacity-0 shadow-float transition-opacity duration-150 group-hover/tip:opacity-100 group-hover/tip:delay-300 group-focus-visible/tip:opacity-100",
          align === "left" ? "left-0" : align === "right" ? "right-0" : "left-1/2 -translate-x-1/2",
        )}
      >
        {p.label}
        {p.count ? ` · ${p.count}` : ""}
        <kbd className="ml-1.5 font-sans text-[11px] opacity-60">⌘{p.shortcut}</kbd>
      </span>
    </a>
  );
}

function useMedia(query: string, fallback: boolean): boolean {
  const [on, setOn] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : fallback));
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const change = () => setOn(mq.matches);
    change();
    mq.addEventListener("change", change);
    return () => mq.removeEventListener("change", change);
  }, [query]);
  return on;
}

/**
 * The desktop sidebar (2026-11-22 "Bubble AI, decluttered"): only your agents and teams, like a
 * contacts list, always docked beside the page. Search and the plus at the top right, "Needs you"
 * when something waits, then the rows; your picture (its menu holds everything else) and
 * Computers at the foot. Drag its edge to make it wider or narrower and it stays there; pulled
 * narrow it snaps to a rail of ghosts. ⌘\ collapses and expands it, a double-click on the edge
 * resets it, and the width is remembered on this device.
 */
export function Rail({ route, popup = null }: { route: Route; /** the pop-up open over the page, if any: its place shows as open */ popup?: Route | null }) {
  const me = useStore((s) => s.me)!;
  const computers = useStore((s) => s.computers);
  const sections = useStore((s) => s.sections);
  const agents = useStore((s) => s.agents);
  const people = useStore((s) => s.members);
  const approvals = useStore((s) => s.approvals);
  // who is working where, not the words: a run streaming its reply doesn't redraw the sidebar; only
  // a run starting, changing tools or ending does (liveShape.ts)
  const live = useStore(liveShape);
  const inbox = useInboxCount();
  const prefs = usePrefs();
  const { orgs } = useOrgs();
  const isGuest = me.role === "guest";
  const features = useFeatures();
  const chats = useSideChats();
  const ready = useReadyChecklist();
  // stops of Show me around not seen yet
  const learnSeen = useStore((s) => seenCount(s.me?.prefs.learn, STOPS));
  const toLearn = !isGuest && learnSeen < TOTAL;
  const notes = useNoteCount(isGuest);
  const devices = useDevices(15_000);
  const [orgAt, setOrgAt] = useState<CSSProperties | null>(null);
  const [newOrg, setNewOrg] = useState(false);
  const footRef = useRef<HTMLDivElement>(null);
  const [setupHidden, hideSetup] = useSetupCardHidden();
  // what's open: the pop-up when there is one, else the page
  const open = popup ?? route;
  const newNotes = useNewNotes(notes, open.view === "vault");

  const [side, setSide] = useState<SidebarState>(loadSidebar);
  const roomy = useMedia(`(min-width: ${SIDEBAR.roomy}px)`, true);
  // a small window shows the rail; opening it by hand keeps it open until the window has room again
  const [peek, setPeek] = useState(false);
  useEffect(() => {
    if (roomy) setPeek(false);
  }, [roomy]);
  const [drag, setDrag] = useState<number | null>(null);
  const [snapping, setSnapping] = useState(false);
  const dragRef = useRef<{ left: number; width: number; moved: boolean } | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => saveSidebar(side), [side]);

  const resting = roomy ? (side.collapsed ? SIDEBAR.rail : side.width) : peek ? side.width : SIDEBAR.rail;
  const width = drag ?? resting;
  const wide = width > SIDEBAR.rail;

  const toggle = () => {
    if (!roomy) setPeek((p) => !p);
    else setSide((s) => ({ ...s, collapsed: !s.collapsed }));
  };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || (e.key !== "\\" && e.code !== "Backslash")) return;
      e.preventDefault();
      toggleRef.current();
    };
    const asked = () => toggleRef.current();
    window.addEventListener("keydown", key);
    window.addEventListener(SIDEBAR_TOGGLE, asked);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener(SIDEBAR_TOGGLE, asked);
    };
  }, []);

  const snapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(snapTimer.current), []);
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    dragRef.current = { left: navRef.current?.getBoundingClientRect().left ?? 0, width, moved: false };
    document.body.classList.add("side-resizing");
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const next = dragWidth(e.clientX - d.left);
    if (!d.moved && next === d.width) return;
    const was = drag ?? d.width;
    d.moved = true;
    // crossing into or out of the rail animates; following the pointer doesn't
    if ((was <= SIDEBAR.rail) !== (next <= SIDEBAR.rail)) {
      setSnapping(true);
      clearTimeout(snapTimer.current);
      snapTimer.current = setTimeout(() => setSnapping(false), SIDEBAR_OPEN_MS + 20);
    }
    setDrag(next);
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    document.body.classList.remove("side-resizing");
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    if (d.moved && drag != null) {
      const next = settle(side, drag);
      setSide(next);
      if (!roomy) setPeek(!next.collapsed);
    }
    setDrag(null);
  };
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = stepWidth(roomy || peek ? side : { ...side, collapsed: true }, e.key === "ArrowLeft" ? -1 : 1);
      setSide(next);
      if (!roomy) setPeek(!next.collapsed);
    } else if (e.key === "Enter") {
      e.preventDefault();
      toggle();
    }
  };
  const reset = () => {
    setSide({ width: SIDEBAR.default, collapsed: false });
    if (!roomy) setPeek(true);
  };

  const transition = drag != null && !snapping ? "none" : `width ${wide ? SIDEBAR_OPEN_MS : SIDEBAR_CLOSE_MS}ms ${SIDEBAR_EASE}`;

  const working = computers.some((c) => c.activity && Date.now() - new Date(c.activity.at).getTime() < 30_000);
  const active = route.view === "chat" ? route.channelId : null;
  // the rail: pins first, then everyone else (no headers)
  const [layout] = useSideLayout(chats);
  const railChats = useMemo(() => {
    const placed = placeChats(layout, chats);
    const order = [...placed.pins, ...placed.sections.flatMap((s) => s.keys)];
    const byKey = new Map(chats.map((c) => [c.key, c]));
    return order.map((k) => byKey.get(k)!).filter(Boolean);
  }, [layout, chats]);
  const setWide = () => (roomy ? setSide((s) => ({ ...s, collapsed: false })) : setPeek(true));
  // the line under each name: the same words as the phone's list. A line that reads the same keeps
  // its object, so one agent starting to work redraws its own row, not every row
  const hadLines = useRef(new Map<string, PreviewLine>());
  const lines = useMemo(() => {
    const ctx = { meId: me.user.id, agents, members: people, approvals, clock: prefs.clock };
    const had = hadLines.current;
    return (hadLines.current = new Map(
      chats.map((c) => {
        const line = chatPreviewLine(c, live, ctx);
        const was = had.get(c.key);
        return [c.key, sameLine(was, line) ? was : line];
      }),
    ));
  }, [chats, live, agents, people, approvals, me.user.id, prefs.clock]);
  const elsewhere = orgs.some((o) => o.unread && !o.current && o.id !== me.workspace.id);

  const icon = { size: 18, strokeWidth: 1.8 };
  const place = (label: string, node: ReactNode, to: Route) => ({ label, icon: node, onSelect: () => go(to) });
  // New, then every place that isn't a chat: the sidebar keeps only search, New, your agents and teams
  const addItems = [
    // the chat header's pencil used to do this; it lives here now
    { label: "New chat", icon: <MessageSquarePlus {...icon} />, onSelect: () => useStore.setState({ newChatOpen: true }) },
    ...(!isGuest ? [{ label: "New agent", icon: <BubbleIcon {...icon} />, onSelect: startNewAgent }] : []),
    ...(!isGuest ? [{ label: "New team", icon: <Users {...icon} />, onSelect: () => useStore.setState({ channelBrowser: { sectionId: null, create: true } }) }] : []),
    ...(!isGuest ? [{ label: "New section", icon: <FolderPlus {...icon} />, onSelect: () => (wide ? newSideSection() : (setWide(), setTimeout(newSideSection, SIDEBAR_OPEN_MS))) }] : []),
    "divider" as const,
    { label: "Browse teams", icon: <Search {...icon} />, onSelect: () => useStore.setState({ channelBrowser: { sectionId: null } }) },
    // the wide sidebar lists the places under search; as a rail they live here
    // what waits on you shows as blue dots on the chats; the full list is here (and in search)
    ...(!isGuest && inbox > 0 ? [place(`Needs you (${inbox > 99 ? "99+" : inbox})`, <Bell {...icon} />, { view: "dashboard" })] : []),
    ...(!wide && !isGuest ? [place("Apps and skills", <LayoutGrid {...icon} />, { view: "marketplace" })] : []),
    place("All agents", <BubbleIcon {...icon} />, { view: "agents", agentId: null }),
    ...(!wide && !isGuest ? [place(features.tasks ? "Tasks" : "Tasks (off)", <ListTodo {...icon} />, features.tasks ? { view: "tasks" } : { view: "marketplace", app: "m:tasks" })] : []),
    // mods' own pages (Storage, Apple) live in Settings; Code shows here only while the sidebar is a rail
    ...(!wide && !isGuest ? MOD_NAV.filter((m) => features[m.feature] && m.place === "rail").map((m) => place(m.label, m.icon(18), m.to)) : []),
    ...(!wide && ready.started && ready.left > 0 && !isGuest ? [place("Finish setup", <Compass {...icon} />, { view: "settings", page: "learn" })] : []),
    ...(orgs.length > 1
      ? [
          {
            label: "Switch workspace",
            icon: (
              <span className="relative grid">
                <Building2 {...icon} />
                {elsewhere && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-badge" aria-label="New messages in another workspace" />}
              </span>
            ),
            onSelect: () => {
              const r = footRef.current?.getBoundingClientRect();
              setOrgAt({ left: Math.max(8, r?.left ?? 8), bottom: window.innerHeight - (r?.top ?? window.innerHeight) + 6 });
            },
          },
        ]
      : []),
  ];

  const plus = (up: boolean) => (
    <Menu
      up={up}
      align={up ? "left" : "right"}
      items={addItems}
      trigger={(open, t) => (
        <button type="button" data-tour="new" onClick={t} aria-expanded={open} aria-haspopup="menu" aria-label="New chat, agent or team" title="New" className={cx(ICON_BTN, open ? "bg-side-active text-ink" : "text-ink hover:bg-side-active")}>
          <Plus size={19} strokeWidth={1.9} />
        </button>
      )}
    />
  );
  const firstName = me.user.name.trim().split(/\s+/)[0] || me.user.name;
  const settingsOn = open.view === "settings" && (open.page as string | null) !== "vault";
  // your name in the corner opens the account menu: settings, help, the tour, what's new
  const accountItems = [
    { label: "Settings", icon: <Settings {...icon} />, onSelect: () => go({ view: "settings", page: null }) },
    { label: "Help", icon: <LifeBuoy {...icon} />, onSelect: () => go({ view: "help" }) },
    // Finish setup's card, once its x was pressed
    ...(!isGuest && wide && setupHidden && ready.started && ready.left > 0 ? [{ label: `Finish setup · ${ready.left} left`, icon: <Compass {...icon} />, onSelect: () => go({ view: "settings", page: "learn" }) }] : []),
    ...(!isGuest ? [{ label: toLearn ? `Show me around · ${learnSeen} of ${TOTAL}` : "Show me around", icon: <Compass {...icon} />, onSelect: () => startTour(learnSeen >= TOTAL ? 0 : undefined) }] : []),
    { label: "What's new", icon: <Sparkles {...icon} />, onSelect: () => go({ view: "settings", page: "updates", item: "news" }) },
    { label: "Report a problem", icon: <ExternalLink {...icon} />, onSelect: () => window.open(`${GITHUB_URL}/issues`, "_blank", "noreferrer") },
  ];
  const you = (
    <Menu
      up
      align="left"
      items={accountItems}
      trigger={(open, t) => (
        wide ? (
          // the board's long glass "You" pill: the whole width of the sidebar
          <button type="button" data-tour="you" onClick={t} aria-expanded={open} aria-haspopup="menu" aria-label="Account, settings and help" className={cx("lg-glass lg-press relative flex h-[46px] w-full min-w-0 items-center gap-2.5 rounded-[23px] px-2 text-[14px] text-ink outline-none transition-[background-color,transform] duration-150 hover:bg-[var(--lg-bg-strong)]! focus-visible:ring-2 focus-visible:ring-ring/40", (open || settingsOn) && "is-on")}>
            <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-ink text-[12px] font-semibold text-panel">{(firstName[0] ?? "?").toUpperCase()}</span>
            <span className="min-w-0 flex-1 truncate text-left font-semibold">{firstName}</span>
            <Settings size={16} strokeWidth={2} className="mr-1 shrink-0 text-muted" aria-hidden />
            {elsewhere && <span className="absolute left-7 top-1.5 box-content size-2 rounded-full border-2 border-sidebar bg-badge" aria-label="New messages in another workspace" />}
          </button>
        ) : (
          <button type="button" data-tour="you" onClick={t} aria-expanded={open} aria-haspopup="menu" aria-label="Account, settings and help" title="Account, settings and help" className={cx("relative flex h-[36px] w-[36px] min-w-0 shrink-0 items-center justify-center gap-2 rounded-[10px] text-[14px] text-ink outline-none hover:bg-line2 focus-visible:ring-2 focus-visible:ring-ring/40", open || settingsOn ? "bg-line2" : SOFT)}>
            <span className="grid size-[26px] shrink-0 place-items-center rounded-full text-[12px] font-semibold">{(firstName[0] ?? "?").toUpperCase()}</span>
            {elsewhere && <span className="absolute -right-px -top-px box-content size-2 rounded-full border-2 border-sidebar bg-badge" aria-label="New messages in another workspace" />}
          </button>
        )
      )}
    />
  );
  const computersTo = href({ view: "computers", computerId: null });
  const computersOn = open.view === "computers";
  // the vault's own settings page (PR 113) when this build has it; the memory notes otherwise
  const vaultPage = (SETTINGS_PAGES as readonly string[]).includes("vault");
  const vaultTo = vaultPage ? "#/settings/vault" : href({ view: "vault", path: null });
  const vaultOn = vaultPage ? open.view === "settings" && (open.page as string | null) === "vault" : open.view === "vault";
  const onCount = machinesOn(isGuest ? [] : devices, computers);
  const computersLabel = `Computers, ${onCount} on${working ? ", one is working" : ""}`;
  const strip = stripPlaces({ guest: isGuest, tasks: !!features.tasks, code: !!features.code, computersOn: onCount, notes, newNotes, open, vaultTo });
  const setupTotal = ready.items.length || 1;
  const setupCard = wide && !isGuest && ready.started && ready.left > 0 && !setupHidden && (
    <div className="relative mx-3 mb-2.5 grid shrink-0 grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1.5 rounded-[10px] border border-line2 bg-panel py-2.5 pl-3 pr-2.5 text-[13px]">
      <a href={href({ view: "settings", page: "learn" })} className="min-w-0 truncate rounded-[10px] outline-none after:absolute after:inset-0 after:rounded-[10px] focus-visible:after:ring-2 focus-visible:after:ring-ring/40">
        <span className="font-semibold">Finish setup</span> <span className="text-[12px] text-muted">· {ready.left} left</span>
      </a>
      <button type="button" onClick={hideSetup} aria-label="Hide Finish setup" title="Hide (it stays in your menu)" className="relative z-10 grid size-5 place-items-center rounded-[6px] text-faint outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/40">
        <X size={14} strokeWidth={1.8} />
      </button>
      <span aria-hidden className="col-span-2 h-1 overflow-hidden rounded-full bg-line2">
        <span className="block h-full rounded-full bg-wisp" style={{ width: `${Math.round(((setupTotal - ready.left) / setupTotal) * 100)}%` }} />
      </span>
    </div>
  );

  return (
    <div className="relative z-30 flex shrink-0">
      <nav ref={navRef} aria-label="Bubble AI" data-wide={wide || undefined} className="side side-glass flex h-full flex-col overflow-hidden pt-[max(20px,env(safe-area-inset-top))] pb-4" style={{ width, transition }}>
        {/* the rail: search and New stacked at the top */}
        {!wide && (
          <div className="side-top mb-4 flex shrink-0 flex-col items-center gap-2.5">
            <button type="button" onClick={() => useStore.getState().setPalette(true)} aria-label="Search" title="Search" className={cx(ROUND, SOFT)}>
              <Search size={19} strokeWidth={1.8} />
            </button>
            {plus(false)}
          </div>
        )}

        {/* the wide sidebar's one row of line icons: the places, Search, and New at the right end (board "Chat and sidebar") */}
        {wide && (
          <div className="side-top mb-2.5 flex shrink-0 items-center gap-1 px-3">
            <nav aria-label="Places" className="-ml-1 flex min-w-0 flex-1 gap-0.5">
              {strip.map((p, i) => (
                <StripButton key={p.key} p={p} align={i < 2 ? "left" : i === 2 && strip.length > 3 ? "center" : "right"} />
              ))}
              <button type="button" onClick={() => useStore.getState().setPalette(true)} aria-label="Search" aria-keyshortcuts="Meta+K" title="Search  ⌘K" className={cx(ICON_BTN, "text-muted hover:bg-side-active hover:text-ink")}>
                <Search size={18} strokeWidth={1.8} />
              </button>
            </nav>
            <span className="-mr-1 shrink-0">{plus(false)}</span>
          </div>
        )}

        <div className={cx("side-list min-h-0 flex-1 overflow-y-auto overflow-x-hidden", wide ? "px-3" : "px-3")}>
          {wide ? (
            <SideList chats={chats} lines={lines} active={active} />
          ) : (
            railChats.map((c) => <SideRow key={c.key} chat={c} wide={false} active={!!c.channel && c.channel.id === active} line={lines.get(c.key) ?? NO_LINE} sections={sections} onNewSection={() => setWide()} />)
          )}
        </div>

        {wide ? (
          <>
            <div className="h-2.5 shrink-0" />
            {setupCard}
            <div ref={footRef} className="flex shrink-0 items-center px-2 pb-1 *:min-w-0 *:flex-1">
              {you}
            </div>
          </>
        ) : (
          <div ref={footRef} className="flex shrink-0 flex-col items-center gap-2 pt-2">
            {!isGuest && (
              <a href={computersTo} aria-label={computersLabel} title="Computers" aria-current={computersOn ? "page" : undefined} className={cx(ROUND, computersOn ? "bg-line2" : SOFT)}>
                <ComputersIcon size={20} />
                {onCount > 0 && <span aria-hidden className="absolute right-0 top-0 box-content size-2 rounded-full border-2 border-sidebar bg-[#30d158]" />}
              </a>
            )}
            <a href={vaultTo} aria-label="Memory vault" title="Memory vault" aria-current={vaultOn ? "page" : undefined} className={cx(ROUND, vaultOn ? "bg-line2" : SOFT)}>
              <BookOpen size={19} strokeWidth={1.8} />
            </a>
            {you}
          </div>
        )}
      </nav>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={SIDEBAR.rail}
        aria-valuemax={SIDEBAR.max}
        aria-valuenow={width}
        tabIndex={0}
        data-drag={drag != null || undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={reset}
        onKeyDown={onKey}
        className="side-edge"
      >
        <span />
      </div>
      {orgAt && (
        <Float role="dialog" label="Workspaces" at={orgAt} className="max-h-[calc(100vh-5rem)] w-[22rem] max-w-[calc(100vw-1rem)] overflow-y-auto" onClose={() => setOrgAt(null)}>
          <OrgList onDone={() => setOrgAt(null)} onNewOrg={() => (setOrgAt(null), setNewOrg(true))} />
        </Float>
      )}
      {newOrg && <NewOrgDialog onClose={() => setNewOrg(false)} />}
    </div>
  );
}
