import { useMemo, type ReactNode } from "react";
import { Blocks, BookOpen, Ghost as GhostIcon, HardDrive, LayoutGrid, LifeBuoy, ListChecks, ListTodo, MessageSquarePlus, Plus, Search, SquareTerminal, Store, Users } from "lucide-react";
import { useReadyChecklist } from "../onboarding.ts";
import type { Agent, FeatureKey } from "@wisp/core";
import { useFeatures } from "../features.ts";
import { useStore, useInboxCount, type ChannelInfo } from "../store.ts";
import { go, href, type Route } from "../router.ts";
import { openDm } from "../openDm.ts";
import { ComputersIcon, InboxIcon, WispGhost } from "./icons.tsx";
import { OrgSwitcher, useOrgs } from "./OrgSwitcher.tsx";
import { Menu, PopBadge, cx } from "./ui.tsx";
import { ChatAvatar, startNewAgent } from "./ChatList.tsx";
import { cleanPreview } from "./CommandPalette.tsx";
import { workingLine } from "./agentActivity.ts";

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
 * What mods add to the sidebar while they're on: "rail" items sit under Computers on desktops,
 * "more" items go in More. A mod adds its entry here instead of its own check in the rail.
 */
const MOD_NAV: { feature: FeatureKey; place: "rail" | "more"; label: string; icon: (size: number) => ReactNode; to: Route; views: Route["view"][] }[] = [
  { feature: "code", place: "rail", label: "Code", icon: (size) => <SquareTerminal size={size} strokeWidth={1.8} />, to: { view: "code" }, views: ["code"] },
  { feature: "storage", place: "more", label: "Storage", icon: (size) => <HardDrive size={size} strokeWidth={1.8} />, to: { view: "settings", page: "storage" }, views: [] },
];

function modNav(features: Record<FeatureKey, boolean>, place: "rail" | "more") {
  return MOD_NAV.filter((m) => m.place === place && features[m.feature]);
}

/** The views More opens, so More shows active on them. */
export const MORE_VIEWS: Route["view"][] = ["more", "vault", "tasks", "marketplace", "connectors", "skills", "mods", "help", "agents"];

/** What More holds, the same on desktops and phones. */
export function useMoreItems(guest: boolean, size = 16, withAgents = false): { label: string; icon: ReactNode; to: Route }[] {
  const features = useFeatures();
  const icon = { size, strokeWidth: 1.8 };
  return [
    ...(withAgents ? [{ label: "All agents", icon: <GhostIcon {...icon} />, to: { view: "agents", agentId: null } as Route }] : []),
    { label: "Memory", icon: <BookOpen {...icon} />, to: { view: "vault", path: null } },
    ...(!guest && features.tasks ? [{ label: "Tasks", icon: <ListTodo {...icon} />, to: { view: "tasks" } as Route }] : []),
    ...(!guest ? modNav(features, "more").map((m) => ({ label: m.label, icon: m.icon(size), to: m.to })) : []),
    ...(!guest ? [{ label: "Marketplace", icon: <Store {...icon} />, to: { view: "marketplace" } as Route }, { label: "Mods", icon: <Blocks {...icon} />, to: { view: "mods" } as Route }] : []),
    { label: "Help", icon: <LifeBuoy {...icon} />, to: { view: "help" } },
  ];
}

/** One row of the rail: an icon in the 72px column, and its words when the rail opens. */
const ROW = "rail-row relative mx-[9px] flex items-center gap-[14px] rounded-[10px] text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/40 shrink-0";

function ToolRow({ label, icon, active, onClick, to, dot, aria }: { label: string; icon: ReactNode; active?: boolean; onClick?: () => void; to?: string; dot?: boolean; aria?: Record<string, unknown> }) {
  const cls = cx(ROW, "h-[38px] px-[17px]", active ? "bg-side-active text-ink" : "text-muted hover:bg-side-hover hover:text-ink");
  const inner = (
    <>
      <span className="shrink-0 grid place-items-center w-5" aria-hidden>{icon}</span>
      <span className="rail-label whitespace-nowrap text-ink">{label}</span>
      {dot && <span className="absolute left-[34px] top-[7px] size-2 rounded-full bg-wisp" aria-label="An agent is working" />}
    </>
  );
  return to ? (
    <a href={to} aria-label={label} title={label} aria-current={active ? "page" : undefined} className={cls}>{inner}</a>
  ) : (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={cls} {...aria}>{inner}</button>
  );
}

/** A chat in the rail: an agent or a team, newest first, with what it's doing when the rail opens. */
interface RailChat {
  key: string;
  kind: "dm" | "team";
  channel: ChannelInfo | null;
  agent: Agent | null;
  name: string;
  at: number;
  unread: number;
  pinned: boolean;
}

function useRailChats(): RailChat[] {
  const channels = useStore((s) => s.channels);
  const agents = useStore((s) => s.agents);
  return useMemo(() => {
    const out: RailChat[] = [];
    for (const a of agents) {
      const dm = channels.find((c) => c.kind === "dm" && c.name.endsWith(`:${a.id}`));
      out.push({ key: `a:${a.id}`, kind: "dm", channel: dm ?? null, agent: a, name: a.name, at: dm?.last ? Date.parse(dm.last.at) : 0, unread: dm?.unread ?? 0, pinned: !!dm?.starred });
    }
    for (const c of channels) {
      if (c.kind !== "channel" || !c.joined || c.archivedAt) continue;
      out.push({ key: `c:${c.id}`, kind: "team", channel: c, agent: null, name: c.name, at: Date.parse(c.last?.at ?? c.createdAt), unread: c.unread, pinned: c.starred });
    }
    return out.sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.at - x.at || x.name.localeCompare(y.name));
  }, [channels, agents]);
}

function ChatRow({ chat, active }: { chat: RailChat; active: boolean }) {
  const live = useStore((s) => s.live);
  const agents = useStore((s) => s.agents);
  const run = chat.channel ? Object.values(live).find((r) => r.channelId === chat.channel!.id && (chat.kind === "team" || r.agentId === chat.agent?.id)) : undefined;
  const preview = run
    ? `${chat.kind === "team" ? `${agents.find((a) => a.id === run.agentId)?.name ?? "An agent"} · ` : ""}${workingLine(run.last?.name, !!run.text)}`
    : chat.agent?.status === "busy"
      ? "Working"
      : chat.channel?.last
        ? cleanPreview(chat.channel.last.body, 60) || "Sent something"
        : "No messages yet";
  const open = () => (chat.channel ? go({ view: "chat", channelId: chat.channel.id, threadId: null }) : chat.agent && void openDm(chat.agent.id));
  return (
    <button type="button" onClick={open} aria-label={chat.unread ? `${chat.name}, ${chat.unread} unread` : chat.name} title={chat.name} aria-current={active ? "page" : undefined} className={cx(ROW, "h-14 px-[9px] gap-3", active ? "bg-side-active" : "hover:bg-side-hover")}>
      <span className="relative grid place-items-center size-[38px] shrink-0">
        <ChatAvatar chat={chat} size={chat.kind === "team" ? 30 : 38} />
        {chat.unread > 0 && <span className="absolute -right-0.5 -top-0.5 size-[11px] rounded-full bg-ink border-2 border-sidebar" aria-hidden />}
      </span>
      <span className="rail-label flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold leading-5">{chat.name}</span>
        <span className="truncate text-[13px] leading-[18px] text-muted">{preview}</span>
      </span>
    </button>
  );
}

/**
 * The desktop sidebar (canvas Sidebar and Main): a 72px rail that opens over the page while the
 * pointer rests on it. Inbox at the top, then every agent and team (newest first), then new,
 * Computers, mods, More and you. Search and the full chats list (sections, pins) sit in its header.
 */
export function Rail({ route }: { route: Route }) {
  const me = useStore((s) => s.me)!;
  const computers = useStore((s) => s.computers);
  const inbox = useInboxCount();
  const isGuest = me.role === "guest";
  const features = useFeatures();
  const chats = useRailChats();
  const ready = useReadyChecklist();
  const working = computers.some((c) => c.activity && Date.now() - new Date(c.activity.at).getTime() < 30_000);
  const active = route.view === "chat" ? route.channelId : null;
  const moreItems = useMoreItems(isGuest, 18, true).map((i) => ({ label: i.label, icon: i.icon, onSelect: () => go(i.to) }));
  const addItems = [
    { label: "New chat", icon: <MessageSquarePlus size={18} strokeWidth={1.8} />, onSelect: () => useStore.setState({ newChatOpen: true }) },
    ...(!isGuest ? [{ label: "New agent", icon: <GhostIcon size={18} strokeWidth={1.8} />, onSelect: startNewAgent }] : []),
    ...(!isGuest ? [{ label: "New team", icon: <Users size={18} strokeWidth={1.8} />, onSelect: () => useStore.setState({ channelBrowser: { sectionId: null, create: true } }) }] : []),
    { label: "Browse teams", icon: <Search size={18} strokeWidth={1.8} />, onSelect: () => useStore.setState({ channelBrowser: { sectionId: null } }) },
  ];
  return (
    <div className="rail-wrap relative w-[72px] shrink-0">
      <nav aria-label="Wisp" className="rail absolute inset-y-0 left-0 z-40 flex flex-col gap-1 overflow-hidden border-r border-line bg-sidebar pt-[max(14px,env(safe-area-inset-top))] pb-3.5">
        <div className="flex h-[38px] shrink-0 items-center gap-2 px-[19px]">
          <OrgSwitcher
            trigger={(open, toggle) => (
              <button onClick={toggle} aria-expanded={open} aria-haspopup="menu" aria-label={`${me.workspace.name}, switch workspace`} title={me.workspace.name} className="flex shrink-0 rounded-lg text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
                <WispGhost size={34} />
              </button>
            )}
          />
          <span className="rail-label flex-1 truncate pl-1 font-semibold">{me.workspace.name}</span>
          <a href={href({ view: "chats" })} aria-label="All chats and search" title="All chats and search" className="rail-label grid size-8 shrink-0 place-items-center rounded-[10px] text-muted hover:bg-side-hover hover:text-ink"><Search size={17} strokeWidth={1.8} /></a>
        </div>

        <a href={href({ view: "dashboard" })} aria-label={inbox ? `Inbox, ${inbox} waiting` : "Inbox"} title="Inbox" aria-current={route.view === "dashboard" ? "page" : undefined} className={cx(ROW, "mt-2.5 h-11 px-[17px]", route.view === "dashboard" ? "bg-side-active" : "hover:bg-side-hover")}>
          <span className="grid w-5 shrink-0 place-items-center" aria-hidden><InboxIcon size={20} /></span>
          <PopBadge count={inbox} label={inbox > 99 ? "99+" : String(inbox)} className="absolute left-[31px] top-[5px] grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[10px] font-bold tabular-nums text-panel" />
          <span className="rail-label whitespace-nowrap font-semibold">Inbox</span>
          {inbox > 0 && <span className="rail-label whitespace-nowrap text-[13px] text-muted">{inbox} need{inbox === 1 ? "s" : ""} you</span>}
        </a>
        <div className="mx-5 my-1.5 h-px shrink-0 bg-line" />

        <div className="rail-chats -my-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden py-1">
          {chats.map((c) => (
            <ChatRow key={c.key} chat={c} active={!!c.channel && c.channel.id === active} />
          ))}
        </div>

        {ready.started && ready.left > 0 && !isGuest && <ToolRow label="Finish setup" icon={<ListChecks size={20} strokeWidth={1.7} />} to={href({ view: "here" })} active={route.view === "here"} />}
        <Menu up items={addItems} trigger={(open, toggle) => <ToolRow label="New agent or team" icon={<Plus size={20} strokeWidth={1.7} />} onClick={toggle} aria={{ "aria-expanded": open, "aria-haspopup": "menu" }} />} />
        {!isGuest && <ToolRow label="Computers" icon={<ComputersIcon size={20} />} to={href({ view: "computers", computerId: null })} active={route.view === "computers"} dot={working} />}
        {!isGuest && modNav(features, "rail").map((m) => <ToolRow key={m.feature} label={m.label} icon={m.icon(20)} to={href(m.to)} active={m.views.includes(route.view)} />)}
        <Menu up items={moreItems} trigger={(open, toggle) => <ToolRow label="Apps, skills and mods" icon={<LayoutGrid size={20} strokeWidth={1.7} />} onClick={toggle} active={open || MORE_VIEWS.includes(route.view)} aria={{ "aria-expanded": open, "aria-haspopup": "menu" }} />} />
        <a href={href({ view: "settings", page: null })} aria-label="Account and settings" title="Account and settings" aria-current={route.view === "settings" ? "page" : undefined} className={cx(ROW, "mt-1.5 h-[54px] px-[9px] gap-3", route.view === "settings" ? "bg-side-active" : "hover:bg-side-hover")}>
          <span className={cx("grid size-[38px] shrink-0 place-items-center rounded-full border text-[13px] font-semibold", route.view === "settings" ? "border-ink" : "border-line2")}>{initialsOf(me.user.name)}</span>
          <span className="rail-label flex min-w-0 flex-col">
            <span className="truncate font-semibold leading-5">{me.user.name.split(" ")[0]}</span>
            <span className="truncate text-xs leading-[18px] text-muted">Settings, memory, usage</span>
          </span>
        </a>
      </nav>
    </div>
  );
}
