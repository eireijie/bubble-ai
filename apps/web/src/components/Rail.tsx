import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Apple, Bell, BookOpen, Building2, ChevronDown, FolderPlus, HardDrive, LayoutGrid, LifeBuoy, ListChecks, ListTodo, LogOut, Plus, Search, Settings, SquareTerminal, Store, Users } from "lucide-react";
import { BubbleIcon } from "./icons.tsx";
import { useReadyChecklist } from "../onboarding.ts";
import type { FeatureKey, Section } from "@wisp/core";
import { api } from "../api.ts";
import { useFeatures } from "../features.ts";
import { logout } from "../logout.ts";
import { useStore, useInboxCount, usePrefs } from "../store.ts";
import { liveShape } from "../liveShape.ts";
import { go, href, type Route } from "../router.ts";
import { openDm } from "../openDm.ts";
import { ComputersIcon, WispGhost } from "./icons.tsx";
import { NewOrgDialog, OrgList, OrgSwitcher, useOrgs } from "./OrgSwitcher.tsx";
import { Menu, PopBadge, agentColor, cx } from "./ui.tsx";
import { ChatAvatar, ChatMenu, chatPreviewLine, startNewAgent, type Chat, type PreviewLine } from "./ChatList.tsx";
import { SectionDialog } from "./Channels.tsx";
import { SIDEBAR, SIDEBAR_CLOSE_MS, SIDEBAR_EASE, SIDEBAR_OPEN_MS, SIDEBAR_TOGGLE, dragWidth, loadSidebar, saveSidebar, settle, stepWidth, type SidebarState } from "../sidebarWidth.ts";

/** Where the Chats item goes: the chat you were last in, else the newest one. Remembered per page load. */
let lastChat: string | null = null;
export function rememberChat(id: string | null) {
  if (id) lastChat = id;
}
export function chatsTarget(): string {
  const { channels } = useStore.getState();
  const id = lastChat && channels.some((c) => c.id === lastChat) ? lastChat : null;
  return id ? href({ view: "chat", channelId: id, threadId: null }) : href({ view: "chats" });
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
    <a href={desktop ? href({ view: "settings", page: null }) : href({ view: "you" })} aria-label="You and settings" title="You and settings" className="circle relative font-semibold text-ink" style={{ width: size, height: size, fontSize: 13 }}>
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
const ROUND = "relative grid size-[40px] shrink-0 place-items-center rounded-full text-ink outline-none hover:bg-line2 focus-visible:ring-2 focus-visible:ring-ring/40";
const SOFT = "bg-side-active";
/** A row of the wide sidebar (60px, a big wisp, a rounded tile when it's the open one), and its square on the rail. Hover eases in; a press gives a little. */
const ITEM = "relative flex h-[60px] w-full items-center gap-3 rounded-[12px] px-2 text-left text-[16px] outline-none transition-[background-color,transform] duration-150 ease-out active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40";
const TILE = "relative grid size-[58px] place-items-center rounded-[12px] outline-none transition-[background-color,transform] duration-150 ease-out active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40";
const MENU_ITEM = "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-body hover:bg-hover";

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
    <div ref={ref} role={role} aria-label={label} style={{ position: "fixed", ...at }} className={cx("glass z-[100] rounded-xl", className)}>
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
  // one dot at the right: orange when it waits on you, its own colour when unread, grey when muted
  const mark = line.needs ? "needs" : unread ? (chat.muted ? "muted" : "unread") : null;
  const markCls = cx("shrink-0 rounded-full", mark === "needs" ? "size-2 bg-st-needs" : mark === "muted" ? "size-1.5 bg-faint" : "size-2");
  const markStyle = mark === "unread" ? { background: chat.kind === "dm" && chat.agent ? agentColor(chat.agent) : "var(--wisp)" } : undefined;
  const cls = cx(wide ? ITEM : TILE, active ? "bg-side-active" : "hover:bg-side-hover");
  const inner = (
    <>
      <span className="grid size-[46px] shrink-0 place-items-center">
        <ChatAvatar chat={chat} size={chat.kind === "dm" ? 54 : 46} />
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
      {wide && mark && <span aria-hidden className={cx(markCls, "mr-1")} style={markStyle} />}
      {!wide && mark && <span aria-hidden className={cx(markCls, "absolute right-[4px] top-[4px] box-content border-2 border-sidebar")} style={markStyle} />}
      {!wide && line.working && <WorkDot corner />}
    </>
  );
  const url = chat.channel ? href({ view: "chat", channelId: chat.channel.id, threadId: null }) : undefined;
  return (
    <div onContextMenu={(e) => chat.channel && (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY }))}>
      {url ? (
        <a href={url} aria-label={label} title={wide ? undefined : label} aria-current={active ? "page" : undefined} className={cls}>{inner}</a>
      ) : (
        <button type="button" onClick={() => chat.agent && void openDm(chat.agent.id)} aria-label={label} title={wide ? undefined : label} className={cls}>{inner}</button>
      )}
      {menu && chat.channel && <ChatMenu chat={chat} channel={chat.channel} at={menu} onClose={() => setMenu(null)} sections={sections} onNewSection={onNewSection} />}
    </div>
  );
});

async function deleteSection(id: string) {
  try {
    await api("DELETE", `/api/sections/${id}`);
    await useStore.getState().refreshSections();
    await useStore.getState().refreshChannels();
  } catch (e) {
    alert((e as Error).message);
  }
}

/** "Pinned" or one of your sections: 36px of muted text that folds its rows. Right-click one of yours to rename or delete it. */
function GroupHeader({ label, closed, onToggle, section, onRename, first }: { label: string; closed: boolean; onToggle: () => void; section?: Section; onRename: () => void; first: boolean }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <div className={cx("group/sec flex h-9 items-center px-2", !first && "mt-3")} onContextMenu={section ? (e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY })) : undefined}>
      <button type="button" onClick={onToggle} aria-expanded={!closed} className="flex min-w-0 items-center gap-1 rounded text-[15px] leading-5 text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/40">
        <span className="truncate">{label}</span>
        <ChevronDown size={14} strokeWidth={2.2} aria-hidden className={cx("shrink-0", closed ? "-rotate-90" : "opacity-0 group-hover/sec:opacity-100")} />
      </button>
      {menu && section && (
        <Float role="menu" label={section.name} at={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 232)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 108)) }} className="min-w-56 p-1.5" onClose={() => setMenu(null)}>
          <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => (setMenu(null), onRename())}>Rename section</button>
          <button type="button" role="menuitem" className={cx(MENU_ITEM, "text-bad")} onClick={() => (setMenu(null), void deleteSection(section.id))}>Delete section</button>
        </Float>
      )}
    </div>
  );
}

const COLLAPSE_KEY = "wisp.chats.collapsed";
function useCollapsedGroups(): [Record<string, boolean>, (id: string) => void] {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "{}");
    } catch {
      return {};
    }
  });
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = { ...c, [id]: !c[id] };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  return [collapsed, toggle];
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
 * The desktop sidebar (2026-11-22 "Wisp, decluttered"): only your agents and teams, like a
 * contacts list, always docked beside the page. Search and the plus at the top right, "Needs you"
 * when something waits, then the rows; your picture (its menu holds everything else) and
 * Computers at the foot. Drag its edge to make it wider or narrower and it stays there; pulled
 * narrow it snaps to a rail of ghosts. ⌘\ collapses and expands it, a double-click on the edge
 * resets it, and the width is remembered on this device.
 */
export function Rail({ route }: { route: Route }) {
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
  const [collapsedGroups, toggleGroup] = useCollapsedGroups();
  const [editing, setEditing] = useState<Section | "new" | null>(null);
  const newSection = useCallback(() => setEditing("new"), []);
  const [orgAt, setOrgAt] = useState<CSSProperties | null>(null);
  const [newOrg, setNewOrg] = useState(false);
  const footRef = useRef<HTMLDivElement>(null);

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
  const groups = sidebarGroups(chats, sections);
  // the rail has no headers, so a group with nothing in it shows nothing
  const shown = wide ? groups : groups.filter((g) => g.chats.length > 0);
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
  const addItems = [
    ...(!isGuest ? [{ label: "New agent", icon: <BubbleIcon {...icon} />, onSelect: startNewAgent }] : []),
    ...(!isGuest ? [{ label: "New team", icon: <Users {...icon} />, onSelect: () => useStore.setState({ channelBrowser: { sectionId: null, create: true } }) }] : []),
    { label: "Browse teams", icon: <Search {...icon} />, onSelect: () => useStore.setState({ channelBrowser: { sectionId: null } }) },
    ...(!isGuest ? [{ label: "New section", icon: <FolderPlus {...icon} />, onSelect: () => setEditing("new") }] : []),
  ];
  // everything that left the sidebar lives behind your picture
  const place = (label: string, node: ReactNode, to: Route) => ({ label, icon: node, onSelect: () => go(to) });
  const openWorkspaces = () => {
    const r = footRef.current?.getBoundingClientRect();
    setOrgAt({ left: Math.max(8, r?.left ?? 8), bottom: window.innerHeight - (r?.top ?? window.innerHeight) + 6 });
  };
  const accountItems = [
    ...(!isGuest ? [place("Add apps and skills", <LayoutGrid {...icon} />, { view: "marketplace" })] : []),
    place("Memory", <BookOpen {...icon} />, { view: "vault", path: null }),
    ...(!isGuest && features.tasks ? [place("Tasks", <ListTodo {...icon} />, { view: "tasks" })] : []),
    ...(!isGuest ? MOD_NAV.filter((m) => features[m.feature]).map((m) => place(m.label, m.icon(18), m.to)) : []),
    place("Help", <LifeBuoy {...icon} />, { view: "help" }),
    ...(ready.started && ready.left > 0 && !isGuest ? [place("Finish setup", <ListChecks {...icon} />, { view: "here" })] : []),
    place("All agents", <BubbleIcon {...icon} />, { view: "agents", agentId: null }),
    place("Settings", <Settings {...icon} />, { view: "settings", page: null }),
    "divider" as const,
    {
      label: me.workspace.name,
      icon: (
        <span className="relative grid">
          <Building2 {...icon} />
          {elsewhere && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-badge" aria-label="New messages in another workspace" />}
        </span>
      ),
      onSelect: openWorkspaces,
    },
    { label: "Sign out", icon: <LogOut {...icon} />, onSelect: () => void logout() },
  ];

  const search = (
    <button type="button" onClick={() => useStore.getState().setPalette(true)} aria-label="Search" className={cx(ROUND, SOFT)}>
      <Search size={19} strokeWidth={1.8} />
    </button>
  );
  const plus = (up: boolean) => (
    <Menu
      up={up}
      align={up ? "left" : "right"}
      items={addItems}
      trigger={(open, t) => (
        <button type="button" onClick={t} aria-expanded={open} aria-haspopup="menu" aria-label="New agent or team" className={cx(ROUND, open ? "bg-line2" : SOFT)}>
          <Plus size={20} strokeWidth={1.8} />
        </button>
      )}
    />
  );
  const you = (
    <Menu
      up
      items={accountItems}
      trigger={(open, t) => (
        <button type="button" onClick={t} aria-expanded={open} aria-haspopup="menu" aria-label="You and settings" className={cx("relative grid size-[42px] shrink-0 place-items-center rounded-full text-[15px] font-semibold text-ink outline-none hover:bg-line2 focus-visible:ring-2 focus-visible:ring-ring/40", open || route.view === "settings" ? "bg-line2" : SOFT)}>
          {initialsOf(me.user.name)}
          {elsewhere && <span className="absolute -right-px -top-px box-content size-2 rounded-full border-2 border-sidebar bg-badge" aria-label="New messages in another workspace" />}
        </button>
      )}
    />
  );
  const computersTo = href({ view: "computers", computerId: null });
  const computersOn = route.view === "computers";
  const computersLabel = working ? "Computers, one is working" : "Computers";
  const needsOn = route.view === "dashboard";
  const needsLabel = `Needs you, ${inbox} waiting`;
  const count = inbox > 99 ? "99+" : String(inbox);
  const bell = (
    <span className="grid size-[44px] shrink-0 place-items-center rounded-full bg-st-needs/20 text-st-needs" aria-hidden>
      <Bell size={20} strokeWidth={1.8} />
    </span>
  );

  return (
    <div className="relative z-30 flex shrink-0">
      <nav ref={navRef} aria-label="Wisp" data-wide={wide || undefined} className="side flex h-full flex-col overflow-hidden border-r border-line bg-sidebar pt-[max(11px,env(safe-area-inset-top))] pb-[11px]" style={{ width, transition }}>
        {/* Wisp's ghost and the workspace's name (switch workspace), then search and the plus */}
        <div className={cx("side-top mb-3 flex shrink-0 items-center gap-2", wide ? "h-[40px] px-[11px]" : "flex-col gap-2.5")}>
          <OrgSwitcher
            trigger={(open, t) => (
              <button type="button" onClick={t} aria-expanded={open} aria-haspopup="menu" aria-label={`${me.workspace.name}, switch workspace`} title={wide ? undefined : me.workspace.name} className={cx("side-brand flex min-w-0 items-center rounded-[10px] text-ink outline-none transition-colors duration-150 hover:bg-side-hover focus-visible:ring-2 focus-visible:ring-ring/40", wide ? "h-[40px] flex-1 gap-2 pl-1.5 pr-2" : "size-[58px] justify-center", open && "bg-side-hover")}>
                <WispGhost size={wide ? 30 : 34} />
                {wide && <span className="truncate text-[17px] font-semibold tracking-[-0.01em]">{me.workspace.name}</span>}
                {wide && <ChevronDown size={14} strokeWidth={2} className={cx("shrink-0 text-faint transition-transform duration-200", open && "rotate-180")} aria-hidden />}
                {elsewhere && <span className="size-2 shrink-0 rounded-full bg-badge" aria-label="New messages in another workspace" />}
              </button>
            )}
          />
          {search}
          {wide && plus(false)}
        </div>

        {inbox > 0 && (
          <div className={cx("shrink-0", wide ? "px-[11px]" : "px-3")}>
            <a href={href({ view: "dashboard" })} aria-label={needsLabel} title={wide ? undefined : needsLabel} aria-current={needsOn ? "page" : undefined} className={cx(wide ? ITEM : TILE, needsOn ? "bg-side-active" : "hover:bg-side-hover")}>
              {bell}
              {wide && <span className="min-w-0 flex-1 truncate font-medium text-ink">Needs you</span>}
              {wide && <span className="shrink-0 pr-1 text-[14px] font-semibold tabular-nums text-st-needs">{count}</span>}
              {!wide && <PopBadge count={inbox} label={count} className="absolute right-[1px] top-[1px] box-content grid h-4 min-w-4 place-items-center rounded-full border-2 border-sidebar bg-badge px-1 text-[10px] font-bold tabular-nums text-badge-ink" />}
            </a>
          </div>
        )}

        <div className={cx("side-list min-h-0 flex-1 overflow-y-auto overflow-x-hidden", wide ? "px-[11px]" : "px-3")}>
          {shown.map((g, i) => {
            const closed = wide && !g.plain && !!collapsedGroups[g.id];
            return (
              <section key={g.id} aria-label={g.label}>
                {wide && !g.plain ? (
                  <GroupHeader label={g.label} closed={closed} onToggle={() => toggleGroup(g.id)} section={isGuest ? undefined : g.section} onRename={() => g.section && setEditing(g.section)} first={i === 0} />
                ) : (
                  i > 0 && <div className={cx("h-px bg-line2", wide ? "mx-2 my-1.5" : "mx-auto my-2 w-6")} aria-hidden />
                )}
                {!closed && g.chats.map((c) => <SideRow key={c.key} chat={c} wide={wide} active={!!c.channel && c.channel.id === active} line={lines.get(c.key) ?? NO_LINE} sections={sections} onNewSection={newSection} />)}
              </section>
            );
          })}
        </div>

        {wide ? (
          <div ref={footRef} className="flex shrink-0 items-center gap-2.5 px-[13px] pt-3">
            {you}
            {!isGuest && (
              <a href={computersTo} aria-label={computersLabel} aria-current={computersOn ? "page" : undefined} className={cx("flex h-[42px] min-w-0 items-center gap-2.5 rounded-full pl-3.5 pr-5 text-[16px] text-ink outline-none hover:bg-line2 focus-visible:ring-2 focus-visible:ring-ring/40", computersOn ? "bg-line2" : SOFT)}>
                <span className="flex shrink-0 gap-[3px]" aria-hidden>
                  <span className={cx("h-[13px] w-[19px] rounded-[4px]", working ? "bg-ok" : "bg-muted opacity-45")} />
                  <span className="h-[13px] w-[19px] rounded-[4px] bg-muted opacity-45" />
                </span>
                <span className="truncate">Computers</span>
              </a>
            )}
          </div>
        ) : (
          <div ref={footRef} className="flex shrink-0 flex-col items-center gap-2 pt-2">
            {plus(true)}
            {!isGuest && (
              <a href={computersTo} aria-label={computersLabel} title="Computers" aria-current={computersOn ? "page" : undefined} className={cx(ROUND, computersOn ? "bg-line2" : SOFT)}>
                <ComputersIcon size={20} />
                {working && <span aria-hidden className="absolute right-0 top-0 box-content size-2 rounded-full border-2 border-sidebar bg-ok" />}
              </a>
            )}
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
      {editing && <SectionDialog section={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
