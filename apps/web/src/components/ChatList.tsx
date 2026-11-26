import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BellOff, Check, ChevronDown, ChevronRight, FolderPlus, MessageSquarePlus, Pin, Plus, Search, Users, X } from "lucide-react";
import { BubbleIcon } from "./icons.tsx";
import { harnessLabel, teamIconAgentIds, type Agent, type Approval, type Section } from "@wisp/core";
import { api } from "../api.ts";
import { useStore, usePrefs, useWaitingOnYou, type ChannelInfo, type ComputerInfo, type LiveRun } from "../store.ts";
import { liveShape } from "../liveShape.ts";
import { go, href, type Route } from "../router.ts";
import { openDm } from "../openDm.ts";
import { AgentAvatar, Menu, cx, clockTime } from "./ui.tsx";
import { useSheetBackdrop } from "../motion.ts";
import { ChannelSettings, SectionDialog, leaveChannel, setChannelPrefs } from "./Channels.tsx";
import { workingLine } from "./agentActivity.ts";
import { cleanPreview } from "./CommandPalette.tsx";
import { loopLine } from "./Loops.tsx";
import { UserAvatarButton } from "./Rail.tsx";
import { SideList, newSideSection } from "./SideList.tsx";
import { useTeamImage } from "./teamImage.ts";

const COLLAPSE_KEY = "wisp.chats.collapsed";
const loadCollapsed = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "{}");
  } catch {
    return {};
  }
};

/** Open the New agent screen from anywhere (the + menu, ⌘K). */
export function startNewAgent() {
  useStore.setState({ newAgentOpen: true });
  go({ view: "agents", agentId: null });
}

/** One row of the flat chats list: a chat with an agent, or a team. */
export interface Chat {
  key: string;
  kind: "dm" | "team";
  channel: ChannelInfo | null;
  agent: Agent | null;
  name: string;
  /** when it last had a message; what the list sorts by */
  at: number;
  unread: number;
  pinned: boolean;
  muted: boolean;
  sectionId: string | null;
}

/** "9:34 PM" for today, "Yesterday", the weekday this week, else "Oct 23". */
export function shortTime(at: number, clock: "auto" | "12h" | "24h"): string {
  if (!at) return "";
  const d = new Date(at);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return clockTime(d, clock);
  const days = Math.floor((now.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** A team's chosen image, else its first two agents' ghosts overlapped; one ghost for a chat with an agent. */
export function ChatAvatar({ chat, size, ghostsOnly = false }: { chat: Pick<Chat, "kind" | "agent" | "channel">; size: number; ghostsOnly?: boolean }) {
  const agents = useStore((s) => s.agents);
  const image = useTeamImage(chat.kind === "team" && !ghostsOnly ? chat.channel?.settings?.iconFileId : null);
  if (chat.kind === "dm") return <AgentAvatar agent={chat.agent ?? undefined} size={size} live />;
  if (image.loading) return <span className="inline-block shrink-0 rounded-full bg-chip" style={{ width: size, height: size }} aria-hidden />;
  if (image.url) return <img src={image.url} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  const members = (chat.channel ? teamIconAgentIds(chat.channel) : []).map((id) => agents.find((a) => a.id === id)).filter((a): a is Agent => !!a);
  // nobody on the team yet: a plain team icon, never somebody's ghost
  if (!members.length) return <span className="grid shrink-0 place-items-center rounded-full bg-chip text-muted" style={{ width: size, height: size }} aria-hidden><Users size={size * 0.5} strokeWidth={1.8} /></span>;
  if (members.length === 1) return <AgentAvatar agent={members[0]} size={size} live />;
  // two of its agents' bubbles, overlapped (board 7): the first up and left, the second down and right
  const a = Math.round(size * 0.66);
  const b = Math.round(size * 0.7);
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }} aria-hidden>
      <span className="absolute left-0 top-[4%]">
        <AgentAvatar agent={members[0]} size={a} live />
      </span>
      <span className="absolute right-0 bottom-0">
        <AgentAvatar agent={members[1]} size={b} live />
      </span>
    </span>
  );
}

/** What a preview line needs besides the chat itself: who is who, what waits on you, how you read the clock. */
export interface PreviewContext {
  /** your own user id, for "You: …" */
  meId: string | null;
  agents: Pick<Agent, "id" | "name">[];
  members: { id: string; name: string }[];
  approvals: Record<string, Pick<Approval, "status" | "channelId" | "summary">>;
  clock?: "auto" | "12h" | "24h";
}

/** The line under a chat's name, and how to show it: working (it is doing something now) or needs (it waits on you). */
export interface PreviewLine {
  text: string;
  working: boolean;
  needs?: boolean;
  icon?: ReactNode;
}

/** The context as the store has it right now, for callers that already re-render when the store changes. */
function storePreviewContext(): PreviewContext {
  const s = useStore.getState();
  return { meId: s.me?.user.id ?? null, agents: s.agents, members: s.members, approvals: s.approvals, clock: s.me?.prefs?.clock ?? "auto" };
}

/**
 * The one line under a chat's name, the same words on the phone's list and the desktop sidebar:
 * what an agent is doing right now, else what waits on you, else the newest message. Nothing for
 * a chat with no messages yet.
 */
export function chatPreviewLine(c: Chat, live: Record<string, LiveRun>, ctx: PreviewContext = storePreviewContext()): PreviewLine {
  const run = c.channel ? Object.values(live).find((r) => r.channelId === c.channel!.id && (c.kind === "team" || r.agentId === c.agent?.id)) : undefined;
  if (run) {
    const who = c.kind === "team" ? `${ctx.agents.find((a) => a.id === run.agentId)?.name ?? "An agent"} · ` : "";
    return { text: `${who}${workingLine(run.last?.name, !!run.text)}`, working: true };
  }
  if (c.kind === "dm" && c.agent?.status === "busy") return { text: "Working", working: true };
  if (c.kind === "dm" && c.agent?.status === "online" && c.agent.signIn) return { text: `Needs sign-in · ${harnessLabel(c.agent.harness)} on ${c.agent.signIn.where}`, working: false, needs: true };
  const ask = c.channel ? Object.values(ctx.approvals).find((a) => a.status === "pending" && a.channelId === c.channel!.id) : undefined;
  if (ask) return { text: `Needs approval · ${cleanPreview(ask.summary, 70)}`, working: false, needs: true };
  // waiting on you, or when its agent will be back with something
  const line = c.kind === "dm" && c.channel ? loopLine(c.channel, ctx.clock) : null;
  if (line) return { text: line.text, working: false, needs: line.tone === "warn", icon: line.icon };
  const last = c.channel?.last;
  if (!last) return { text: "", working: false };
  const body = cleanPreview(last.body, 90) || "Sent something";
  if (last.author.kind === "user" && last.author.id === ctx.meId) return { text: `You: ${body}`, working: false };
  if (c.kind === "dm") return { text: body, working: false, icon: c.channel?.loop?.status === "done" ? <Check size={12} className="text-ok" aria-label="Done" /> : undefined };
  const who = last.author.kind === "agent" ? ctx.agents.find((a) => a.id === last.author.id)?.name : last.author.kind === "user" ? ctx.members.find((m) => m.id === last.author.id)?.name?.split(" ")[0] : undefined;
  return { text: who ? `${who}: ${body}` : body, working: false };
}

/** Just the words of `chatPreviewLine`. */
export function chatPreview(c: Chat, live: Record<string, LiveRun>, ctx?: PreviewContext): string {
  return chatPreviewLine(c, live, ctx).text;
}

/** The first thing waiting on you, as one sentence and who asks it: an approval, else help on a computer. */
export function firstWaiting(waiting: { approvals: Pick<Approval, "agentId" | "summary">[]; help: Pick<ComputerInfo, "name" | "help">[] }): { agentId: string | null; text: string } | null {
  const ask = waiting.approvals[0];
  if (ask) return { agentId: ask.agentId, text: cleanPreview(ask.summary, 120) || "Wants your approval" };
  const c = waiting.help[0];
  if (c) return { agentId: c.help?.agentId ?? null, text: cleanPreview(c.help?.request ?? "", 120) || `Help on ${c.name}` };
  return null;
}

/**
 * The chats list: every chat with an agent and every team in one flat list, newest first, with
 * your own Sections as optional groups. On desktops it's the column beside the open chat; on
 * phones it's the home screen (variant "page"): you, Search and + on top, a Needs you card when
 * something waits, then the rows. The + makes an agent, team or section; a right-click or
 * long-press on a row has pin, move to section, mute and the rest.
 */
export function ChatList({ route, variant = "column" }: { route: Route; variant?: "column" | "page" }) {
  const me = useStore((s) => s.me)!;
  const channels = useStore((s) => s.channels);
  const sections = useStore((s) => s.sections);
  const agents = useStore((s) => s.agents);
  const live = useStore(liveShape);
  const approvals = useStore((s) => s.approvals);
  const members = useStore((s) => s.members);
  const prefs = usePrefs();
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Section | "new" | null>(null);
  const page = variant === "page";
  const isGuest = me.role === "guest";
  const active = route.view === "chat" ? route.channelId : null;

  const chats = useMemo(() => {
    const out: Chat[] = [];
    const dmFor = (id: string) => channels.find((c) => c.kind === "dm" && c.name.endsWith(`:${id}`));
    for (const a of agents) {
      const dm = dmFor(a.id);
      out.push({ key: `a:${a.id}`, kind: "dm", channel: dm ?? null, agent: a, name: a.name, at: dm?.last ? Date.parse(dm.last.at) : 0, unread: dm?.unread ?? 0, pinned: !!dm?.starred, muted: dm?.notify === "mute", sectionId: dm?.sectionId ?? null });
    }
    for (const c of channels) {
      if (c.kind !== "channel" || !c.joined || c.archivedAt) continue;
      out.push({ key: `c:${c.id}`, kind: "team", channel: c, agent: null, name: c.name, at: Date.parse(c.last?.at ?? c.createdAt), unread: c.unread, pinned: c.starred, muted: c.notify === "mute", sectionId: c.sectionId });
    }
    return out.sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.at - x.at || x.name.localeCompare(y.name));
  }, [channels, agents]);

  const needle = q.trim().toLowerCase();
  const shown = needle ? chats.filter((c) => c.name.toLowerCase().includes(needle)) : chats;
  const sectionIds = new Set(sections.map((s) => s.id));
  const plain = shown.filter((c) => !c.sectionId || !sectionIds.has(c.sectionId));

  const toggle = (key: string) => {
    const next = { ...collapsed, [key]: !collapsed[key] };
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
    } catch {}
  };

  /** the preview line: what an agent is doing right now, else the newest message */
  const previewCtx: PreviewContext = { meId: me.user.id, agents, members, approvals, clock: prefs.clock };
  const preview = (c: Chat) => chatPreviewLine(c, live, previewCtx);

  const open = (c: Chat) => (c.channel ? go({ view: "chat", channelId: c.channel.id, threadId: null }) : c.agent && void openDm(c.agent.id));

  const rows = (list: Chat[]) =>
    list.map((c) => {
      const p = preview(c);
      return <ChatRow key={c.key} chat={c} page={page} active={!!c.channel && active === c.channel.id} preview={p} time={shortTime(c.at, prefs.clock)} onOpen={() => open(c)} sections={sections} onNewSection={() => setEditing("new")} />;
    });

  const newMenu = (
    <Menu
      align="right"
      trigger={(isOpen, t) => (
        <button data-tour="new" onClick={t} aria-expanded={isOpen} aria-haspopup="menu" aria-label={page ? "New agent or team" : "New chat, agent or team"} className="circle">
          <Plus size={page ? 22 : 20} strokeWidth={2} />
        </button>
      )}
      items={[
        ...(!page ? [{ label: "New chat", icon: <MessageSquarePlus size={18} strokeWidth={1.8} />, onSelect: () => useStore.setState({ newChatOpen: true }) }] : []),
        ...(!isGuest ? [{ label: "New agent", icon: <BubbleIcon size={18} strokeWidth={1.8} />, onSelect: startNewAgent }] : []),
        ...(!isGuest ? [{ label: "New team", icon: <Users size={18} strokeWidth={1.8} />, onSelect: () => useStore.setState({ channelBrowser: { sectionId: null, create: true } }) }] : []),
        { label: "Browse teams", icon: <Search size={18} strokeWidth={1.8} />, onSelect: () => useStore.setState({ channelBrowser: { sectionId: null } }) },
        ...(!isGuest ? [{ label: "New section", icon: <FolderPlus size={18} strokeWidth={1.8} />, onSelect: newSideSection }] : []),
      ]}
    />
  );

  return (
    <nav className={cx("h-full flex flex-col min-h-0", page ? "safe-top" : "pt-[18px] px-3")} aria-label="Chats">
      {page ? (
        <div className="shrink-0 flex items-center gap-2 px-4 pt-3 pb-2">
          <UserAvatarButton size={44} />
          <SearchField page value={q} onChange={setQ} />
          {newMenu}
        </div>
      ) : (
        <>
          <div className="shrink-0 flex items-center justify-between px-1.5 pb-3">
            <h1 className="t-title">Chats</h1>
            {newMenu}
          </div>
          <div className="shrink-0 px-1 pb-2.5">
            <SearchField page={false} value={q} onChange={setQ} />
          </div>
        </>
      )}

      <div data-stagger className={cx("flex-1 min-h-0 overflow-y-auto", page ? "px-2 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))]" : "pb-4 -mx-1 px-1")}>
        {page && <NeedsYouCard />}
        {/* phones: pins, All / Your turn and your sections, as in the desktop sidebar; the desktop's
            own Chats column (nothing open yet) is a plain newest-first list, since the sidebar beside it has the rest */}
        {!needle && page && chats.length > 0 && <SideList chats={chats} lines={new Map(chats.map((c) => [c.key, preview(c)]))} active={active} phone />}
        {!needle && !page && rows([...chats].sort((x, y) => y.at - x.at || x.name.localeCompare(y.name)))}
        {needle && rows(plain)}
        {needle && sections.map((s) => {
          const list = shown.filter((c) => c.sectionId === s.id);
          if (needle && !list.length) return null;
          return (
            <section key={s.id}>
              <SectionHeader section={s} count={list.length} collapsed={!!collapsed[s.id]} onToggle={() => toggle(s.id)} onRename={() => setEditing(s)} page={page} canEdit={!isGuest} />
              {!collapsed[s.id] && (list.length ? rows(list) : !page && <p className="px-3 py-1 text-[13px] text-faint">No chats in this section.</p>)}
            </section>
          );
        })}
        {needle && (
          <button onClick={() => (useStore.setState({ paletteSeed: q }), useStore.getState().setPalette(true))} className="w-full flex items-center gap-3 rounded-2xl px-3 py-3 text-left text-body text-muted hover:bg-hover">
            <Search size={18} strokeWidth={1.8} /> Search messages and memory for “{q.trim()}”
          </button>
        )}
        {!needle && chats.length === 0 && <p className="px-3 py-6 text-sm text-muted text-center">{page ? "No agents yet" : "No chats yet. Tap + to start one."}</p>}
        {needle && shown.length === 0 && <p className="px-3 py-2 text-sm text-faint">No chats match.</p>}
      </div>

      {editing && <SectionDialog section={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </nav>
  );
}

/** Desktop: a field you type in to narrow the list (⌘K searches everything). Phones: a pill that opens the full search. */
function SearchField({ page, value, onChange }: { page: boolean; value: string; onChange: (v: string) => void }) {
  const setPalette = useStore((s) => s.setPalette);
  if (page)
    return (
      <button type="button" onClick={() => setPalette(true)} className="flex-1 min-w-0 h-11 flex items-center gap-2.5 rounded-full bg-card px-4 text-left text-body text-faint">
        <Search size={18} strokeWidth={2} className="shrink-0" aria-hidden />
        Search
      </button>
    );
  return (
    <label className="flex items-center gap-2.5 bg-card text-faint h-9 rounded-full px-3">
      <Search size={16} strokeWidth={2} className="shrink-0" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search" aria-label="Search chats" className={cx("flex-1 min-w-0 bg-transparent outline-none text-ink placeholder:text-faint", "text-body")} />
      <kbd className="text-xs font-sans text-faint">⌘K</kbd>
    </label>
  );
}

/** Phones: what waits on you, on top of the list. One tap opens the Needs you page. */
function NeedsYouCard() {
  const waiting = useWaitingOnYou();
  const agents = useStore((s) => s.agents);
  const count = waiting.approvals.length + waiting.help.length;
  const first = firstWaiting(waiting);
  if (!first) return null;
  const agent = agents.find((a) => a.id === first.agentId);
  return (
    <a href={href({ view: "dashboard" })} aria-label={`Needs you, ${count} waiting. ${first.text}`} className="mx-2 mb-2 flex items-center gap-3 rounded-[14px] bg-card px-3.5 py-3 text-left">
      {agent && <AgentAvatar agent={agent} size={36} live />}
      <span className="flex-1 min-w-0">
        <span className="line-clamp-2 text-[15px] font-semibold leading-5">{first.text}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[13px] leading-[18px] text-muted">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-st-needs" />
          <span className="truncate">{["Needs you", agent?.name, count > 1 ? `${count - 1} more` : null].filter(Boolean).join(" · ")}</span>
        </span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-faint" aria-hidden />
    </a>
  );
}

function SectionHeader({ section, count, collapsed, onToggle, onRename, page, canEdit }: { section: Section; count: number; collapsed: boolean; onToggle: () => void; onRename: () => void; page: boolean; canEdit: boolean }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const press = useLongPress((x, y) => canEdit && setMenu({ x, y }));
  return (
    <div className={cx("flex items-center justify-between text-xs", page ? "mt-2 h-7 px-2 text-muted" : "text-faint font-medium uppercase tracking-wide pt-3.5 pb-1.5 px-3")} onContextMenu={(e) => canEdit && (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY }))} {...press}>
      <button onClick={onToggle} aria-expanded={!collapsed} className="flex items-center gap-1.5 min-w-0 h-7 hover:text-ink">
        <ChevronDown size={13} strokeWidth={2.4} className={cx("shrink-0 transition-transform", collapsed && "-rotate-90")} />
        <span className="truncate">{section.name}</span>
      </button>
      {!page && <span className="font-medium normal-case tracking-normal">{count}</span>}
      {menu && (
        <ContextMenu at={menu} onClose={() => setMenu(null)} title={<><span className="font-medium text-ink">{section.name}</span><span className="block text-xs text-faint">{count} {count === 1 ? "chat" : "chats"}</span></>}>
          {(close) => (
            <>
              <MenuItem onClick={() => (close(), onRename())}>Rename section</MenuItem>
              <MenuItem
                danger
                onClick={async () => {
                  close();
                  await api("DELETE", `/api/sections/${section.id}`);
                  await useStore.getState().refreshSections();
                  await useStore.getState().refreshChannels();
                }}
              >
                Delete section
              </MenuItem>
              <p className="px-3.5 pt-1 pb-2 text-xs text-faint normal-case tracking-normal font-normal">Deleting a section keeps its chats. They move back to the main list.</p>
            </>
          )}
        </ContextMenu>
      )}
    </div>
  );
}

/** Three small pulsing dots: the pop on a working line. */
export function PulseDots() {
  return (
    <span aria-hidden className="shrink-0 inline-flex gap-[3px]">
      {[0, 1, 2].map((i) => <span key={i} className="size-[4px] rounded-full bg-st-working animate-pulse" style={{ animationDelay: `${i * 160}ms` }} />)}
    </span>
  );
}

/** @mentions in a line of text take the agents' purple. */
export function withMentions(text: string) {
  return text.split(/(@\w+)/g).map((part, i) => (part.startsWith("@") && part.length > 1 ? <span key={i} className="text-accent-agents">{part}</span> : part));
}

function ChatRow({ chat, page, active, preview, time, onOpen, sections, onNewSection }: { chat: Chat; page: boolean; active: boolean; preview: PreviewLine; time: string; onOpen: () => void; sections: Section[]; onNewSection: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const press = useLongPress((x, y) => chat.channel && setMenu({ x, y }));
  const size = 68;
  const unread = chat.unread > 0 && !chat.muted;
  const url = chat.channel ? href({ view: "chat", channelId: chat.channel.id, threadId: null }) : undefined;
  const line = preview.text && (
    <span className={cx("min-w-0 flex items-center gap-1.5", "text-[13px]", preview.working ? "text-st-working" : preview.needs ? "text-st-needs" : "text-muted")}>
      {preview.working && <PulseDots />}
      {preview.icon && <span className="shrink-0 inline-flex">{preview.icon}</span>}
      <span className={cx("truncate", preview.working && "shimmer-text")}>{preview.working || preview.needs ? preview.text : withMentions(preview.text)}</span>
    </span>
  );
  // phones: 76px, a 56px wisp, the name and when, one line, and one dot when it is unread or waits on you
  const inner = page ? (
    <>
      <span className="shrink-0 grid size-14 place-items-center">
        <ChatAvatar chat={chat} size={56} />
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cx("truncate text-[15px] font-semibold leading-5", chat.muted && "opacity-60")}>{chat.name}</span>
          {time && <span className={cx("shrink-0 text-[12px] tabular-nums", unread ? "text-ink" : "text-faint")}>{time}</span>}
        </span>
        {line}
      </span>
      {chat.unread > 0 && chat.muted && <span role="img" aria-label="Unread" className="shrink-0 size-2 rounded-full bg-faint" />}
      {unread && <span role="img" aria-label={`${chat.unread} unread`} className="shrink-0 size-2 rounded-full bg-accent-chats" />}
      {!chat.unread && preview.needs && <span role="img" aria-label="Needs you" className="shrink-0 size-2 rounded-full bg-st-needs" />}
    </>
  ) : (
    <>
      <span className="shrink-0 flex items-center" style={{ width: 76, height: size }}>
        <ChatAvatar chat={chat} size={size} />
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cx("truncate", page ? "text-body" : "text-body", chat.unread > 0 ? "font-semibold" : "font-medium", chat.muted && "opacity-60")}>{chat.name}</span>
          <span className={cx("shrink-0 flex items-center gap-1.5", unread ? "text-accent-chats" : "text-faint")} style={{ fontSize: 12 }}>
            {chat.pinned && <Pin size={11} strokeWidth={2} aria-label="Pinned" />}
            {chat.muted && <BellOff size={11} aria-label="Muted" />}
            {time}
          </span>
        </span>
        <span className="flex items-center justify-between gap-2">
          {line || <span />}
          {chat.unread > 0 && chat.muted && <span aria-label="Unread" className="shrink-0 size-2 rounded-full bg-faint" />}
          {unread && <span role="img" aria-label={`${chat.unread} unread`} className="shrink-0 size-2.5 rounded-full bg-accent-chats" />}
        </span>
      </span>
    </>
  );
  const cls = cx("w-full flex items-center text-left transition-colors", page ? "gap-3 px-2 h-[76px] rounded-[12px] active:scale-[0.99] transition-[background-color,transform] duration-150" : "gap-3 px-2.5 py-2.5 rounded-xl min-h-[88px]", active ? "bg-side-active" : "hover:bg-hover");
  return (
    <div onContextMenu={(e) => chat.channel && (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY }))} {...press}>
      {url ? (
        <a href={url} aria-current={active ? "page" : undefined} className={cls}>
          {inner}
        </a>
      ) : (
        <button onClick={onOpen} className={cls}>
          {inner}
        </button>
      )}
      {menu && chat.channel && <ChatMenu chat={chat} channel={chat.channel} at={menu} onClose={() => setMenu(null)} sections={sections} onNewSection={onNewSection} />}
    </div>
  );
}

/** Pin to top, Move to section, Mute, Mark as read and Leave team for one chat. */
export function ChatMenu({ chat, channel, at, onClose, sections, onNewSection }: { chat: Chat; channel: ChannelInfo; at: { x: number; y: number }; onClose: () => void; sections: Section[]; onNewSection: () => void }) {
  const [view, setView] = useState<"main" | "move">("main");
  const [settings, setSettings] = useState(false);
  const guest = useStore((s) => s.me?.role) === "guest";
  const team = chat.kind === "team";
  const move = async (sectionId: string | null) => {
    onClose();
    try {
      await api("PATCH", `/api/channels/${channel.id}`, { sectionId });
      await useStore.getState().refreshChannels();
    } catch (e) {
      alert((e as Error).message);
    }
  };
  if (settings) return createPortal(<ChannelSettings channel={channel} onClose={() => (setSettings(false), onClose())} />, document.body);
  return (
    <ContextMenu at={at} onClose={onClose} title={view === "move" ? <span className="font-medium text-ink">Move to section</span> : <span className="font-medium text-ink">{chat.name}</span>} back={view === "move" ? () => setView("main") : undefined}>
      {(close) =>
        view === "move" ? (
          <>
            <MenuItem onClick={() => void move(null)} check={!channel.sectionId}>No section</MenuItem>
            {sections.map((s) => (
              <MenuItem key={s.id} onClick={() => void move(s.id)} check={channel.sectionId === s.id}>
                {s.name}
              </MenuItem>
            ))}
            {!guest && <MenuItem onClick={() => (close(), onNewSection())}>New section…</MenuItem>}
          </>
        ) : (
          <>
            <MenuItem onClick={() => (close(), void setChannelPrefs(channel, { starred: !channel.starred }))}>{channel.starred ? "Unpin" : "Pin to top"}</MenuItem>
            {!guest && <MenuItem onClick={() => setView("move")} more>Move to section</MenuItem>}
            <MenuItem onClick={() => (close(), void setChannelPrefs(channel, { notify: channel.notify === "mute" ? "default" : "mute" }))}>{channel.notify === "mute" ? "Unmute" : "Mute"}</MenuItem>
            {channel.unread > 0 && <MenuItem onClick={() => (close(), useStore.getState().markRead(channel.id))}>Mark as read</MenuItem>}
            {team && !guest && <MenuItem onClick={() => setSettings(true)}>Team settings…</MenuItem>}
            {team && channel.joined && channel.name !== "general" && (
              <MenuItem danger onClick={() => (close(), void leaveChannel(channel))}>
                Leave team
              </MenuItem>
            )}
          </>
        )
      }
    </ContextMenu>
  );
}

function MenuItem({ children, onClick, danger, check, more }: { children: ReactNode; onClick: () => void; danger?: boolean; check?: boolean; more?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} className={cx("w-full min-h-11 px-3.5 rounded-xl flex items-center gap-3 text-left text-body hover:bg-hover", danger && "text-bad")}>
      <span className="flex-1">{children}</span>
      {check && <Check size={17} strokeWidth={2.2} className="text-badge" />}
      {more && <ChevronDown size={15} className="-rotate-90 text-faint" />}
    </button>
  );
}

/** Right-click on desktops, press and hold on phones. */
function useLongPress(onPress: (x: number, y: number) => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => clearTimeout(timer.current);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
      timer.current = setTimeout(() => onPress(t.clientX, t.clientY), 480);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (start.current && Math.hypot(t.clientX - start.current.x, t.clientY - start.current.y) > 8) cancel();
    },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
  };
}

/** A glass menu at the pointer (or centered low on a phone), over a dimmed list. */
function ContextMenu({ at, onClose, title, back, children }: { at: { x: number; y: number }; onClose: () => void; title: ReactNode; back?: () => void; children: (close: () => void) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ position: "fixed", left: at.x, top: at.y, visibility: "hidden" });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const phone = window.matchMedia("(max-width: 767px)").matches;
    const left = phone ? Math.max(12, (window.innerWidth - r.width) / 2) : Math.min(Math.max(8, at.x), window.innerWidth - r.width - 8);
    const top = Math.min(Math.max(8, at.y), window.innerHeight - r.height - 8);
    setPos({ position: "fixed", left, top });
  }, [at.x, at.y, back]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(
    <div className="m-scrim fixed inset-0 z-[90] bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onContextMenu={(e) => (e.preventDefault(), onClose())} onTouchStart={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="menu" style={pos} className="m-menu glass w-72 max-w-[calc(100vw-24px)] rounded-xl p-1.5" >
        <div className="flex items-center gap-2 px-3.5 py-2.5 text-body">
          {back && (
            <button onClick={back} className="-ml-1 mr-1 size-7 grid place-items-center rounded-full text-muted hover:bg-hover" aria-label="Back">
              <ChevronDown size={16} className="rotate-90" />
            </button>
          )}
          <div className="min-w-0 flex-1 truncate">{title}</div>
        </div>
        <div className="h-px bg-line mx-2 mb-1" />
        {children(onClose)}
      </div>
    </div>,
    document.body,
  );
}

/** New chat: pick an agent to talk to. */
export function NewChatPicker({ onClose }: { onClose: () => void }) {
  const agents = useStore((s) => s.agents);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // one agent: no choice to make
    if (agents.length === 1) {
      onClose();
      void openDm(agents[0].id);
    }
  }, [agents, onClose]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  useSheetBackdrop();
  return createPortal(
    <div className="m-scrim fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="New chat" className="m-dialog w-full sm:max-w-sm bg-panel border border-line rounded-t-[16px] sm:rounded-xl shadow-panel max-h-[80vh] overflow-y-auto safe-bottom p-2">
        <div className="flex items-center justify-between px-3.5 pt-3 pb-2">
          <h2 className="t-title">New chat</h2>
          <button onClick={onClose} aria-label="Close" className="circle circle-sm">
            <X size={16} strokeWidth={2.2} />
          </button>
        </div>
        {agents.length === 0 && (
          <p className="px-3.5 py-6 text-sm text-muted">
            No agents yet. Make one first.{" "}
            <button className="underline" onClick={() => (onClose(), startNewAgent())}>
              New agent
            </button>
          </p>
        )}
        {agents.map((a) => (
          <button
            key={a.id}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onClose();
              void openDm(a.id);
            }}
            className="w-full flex items-center gap-3 px-3.5 min-h-[56px] rounded-2xl text-left hover:bg-hover"
          >
            <AgentAvatar agent={a} size={36} />
            <span className="text-body font-medium">{a.name}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
