import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AudioLines, Bell, Building2, CornerDownLeft, FileText, FolderPlus, LogOut, MessageSquare, Minimize2, PanelLeft, Plus, RotateCcw, Search, SquarePen, Users, type LucideIcon } from "lucide-react";
import type { Agent, Channel, Message } from "@bubble-ai/core";
import { api } from "../api.ts";
import { useInboxCount, useStore, useTeams, type ChannelInfo } from "../store.ts";
import { go, href, parseRoute } from "../router.ts";
import { openDm } from "../openDm.ts";
import { useFeatures } from "../features.ts";
import { logout } from "../logout.ts";
import { SIDEBAR, loadSidebar, toggleSidebar } from "../sidebarWidth.ts";
import { NewOrgDialog, OrgList } from "./OrgSwitcher.tsx";
import { ChatAvatar, shortTime, startNewAgent } from "./ChatList.tsx";
import { SectionDialog } from "./Channels.tsx";
import { chatsTarget } from "./Rail.tsx";
import { Button, Modal, cx } from "./ui.tsx";
import { findByWords, openSearch, placesFor, wordMatch } from "./searchIndex.ts";
import { isTopOverlay, toBody, useOverlay } from "../overlays.ts";

export { openSearch };

interface Results {
  channels: Channel[];
  agents: Agent[];
  messages: (Message & { channelName: string })[];
  notes: { path: string; title: string; snippet: string }[];
}

interface Row {
  key: string;
  /** the small header it sits under; "" sits apart with no header */
  group: string;
  icon: ReactNode;
  label: ReactNode;
  /** muted, on the right: who and when, or where it lives */
  meta?: string;
  /** raw detail for the tooltip only (never shown) */
  tip?: string;
  run: () => void;
}

/** Things the palette opens after it closes: they outlive it. */
type After = "org" | "orgs" | "section" | "signout" | null;

/** How many of each kind show at most. */
const MOST = { recent: 7, chats: 8, messages: 5, places: 8, notes: 5 };

export interface Lookup {
  people: Record<string, string>;
  agents: Record<string, string>;
  teams: Record<string, string>;
}

const ID_TOKEN = /\b[a-z]{2,6}_[A-Za-z0-9]{6,}\b/g;

/** Internal ids look like usr_yN7fNNXTN6NP: a short prefix and a random tail with a digit or capital. */
function stripIds(text: string): string {
  return text.replace(ID_TOKEN, (m) => (/[0-9A-Z]/.test(m.slice(m.indexOf("_") + 1)) ? "" : m));
}

/** One clean line for a result: no Markdown, search highlights, ids, paths or agent-only instructions. */
export function cleanPreview(text: string, max = 140): string {
  const kept = (text ?? "")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .split(/\r?\n/)
    .filter((l) => !/^\s*\[[^\]]*\]\s*$/.test(l) && !/^\s*\[(system|meta|internal)\b/i.test(l))
    .join("\n");
  let t = kept
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>+\s?/gm, "")
    .replace(/^\s*([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/gm, "")
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/(\*\*|__|~~)/g, "")
    .replace(/(^|[\s(])[*_]+(?=\S)/g, "$1")
    .replace(/(\S)[*_]+(?=[\s).,;:!?]|$)/g, "$1")
    .replace(/`+/g, "")
    // agent-only hints that can trail a task message
    .replace(/This is task\s+\S+\.?/gi, " ")
    .replace(/When finished, report back[^.]*\.?/gi, " ")
    // vault paths, then bare ids
    .replace(/\b(?:people|agents|teams|groups|shared)\/[\w./-]+/gi, " ")
    .replace(/\b(?:[\w-]+\/)+[\w-]+\.md\b/gi, " ");
  t = stripIds(t).replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

/** "dinner-preferences.md" becomes "Dinner preferences". */
function humanize(name: string): string {
  const t = name.replace(/\.md$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

/** Where a note lives, in words: "Memory › Shared › Dinner preferences". */
export function noteLocation(path: string, title: string, lookup: Lookup): string {
  const parts = path.split("/").filter(Boolean);
  const file = parts.pop() ?? "";
  const last = cleanPreview(title, 60) || humanize(file) || "Note";
  const crumbs = ["Memory"];
  const [top, id, ...rest] = parts;
  if (top === "shared") crumbs.push("Shared", ...[id, ...rest].filter(Boolean).map(humanize));
  else if (top === "people") crumbs.push((id && lookup.people[id]) || "A person", ...rest.map(humanize));
  else if (top === "agents") crumbs.push(id && lookup.agents[id] ? `@${lookup.agents[id]}` : "An agent", ...rest.map(humanize));
  else if (top === "teams") crumbs.push((id && lookup.teams[id]) || "A team", ...rest.map(humanize));
  else if (top === "groups") crumbs.push("Groups", ...[id, ...rest].filter(Boolean).map(humanize));
  else crumbs.push(...parts.map(humanize));
  if (crumbs[crumbs.length - 1] !== last) crumbs.push(last);
  return crumbs.join(" › ");
}

/** What a message result is: one that hands out a task, one about a routine, or just a message. */
export function messageKind(m: Pick<Message, "parts">): "Task" | "Routine" | "Message" {
  const parts = m.parts ?? [];
  if (parts.some((p) => p.type === "task")) return "Task";
  if (parts.some((p) => p.type === "routine")) return "Routine";
  return "Message";
}

/** "DM with @maya" or "#general". DM channel names end with the agent id. */
export function messageLocation(channelName: string, agentHandles: Record<string, string>): string {
  if (!channelName.startsWith("dm:")) return `#${channelName}`;
  const handle = agentHandles[channelName.slice(channelName.lastIndexOf(":") + 1)];
  return handle ? `DM with @${handle}` : "Direct message";
}

/** ⌘K / Ctrl+K: find an agent, a team, a message, a note, any page or setting, or do something. */
export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const setOpen = useStore((s) => s.setPalette);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useStore.getState().paletteOpen);
        return;
      }
      // ⌘1 Inbox, ⌘2 Chats, ⌘3 Agents, ⌘4 Computers, ⌘, Settings
      const guest = useStore.getState().me?.role === "guest";
      const target = { "1": href({ view: "dashboard" }), "2": chatsTarget(), "3": href({ view: "agents", agentId: null }), "4": guest ? null : href({ view: "computers", computerId: null }), ",": href({ view: "settings", page: null }) }[e.key];
      if (target) {
        e.preventDefault();
        useStore.getState().setPalette(false);
        location.hash = target;
      }
    };
    const close = () => useStore.getState().paletteOpen && setOpen(false);
    window.addEventListener("keydown", k);
    window.addEventListener("hashchange", close);
    return () => {
      window.removeEventListener("keydown", k);
      window.removeEventListener("hashchange", close);
    };
  }, [setOpen]);

  const [after, setAfter] = useState<After>(null);
  const done = () => setAfter(null);
  return (
    <>
      {open && <Palette onClose={() => setOpen(false)} onAfter={setAfter} />}
      {after === "org" && <NewOrgDialog onClose={done} />}
      {after === "orgs" && (
        <Modal title="Switch workspace" headerless label="Switch workspace" onClose={done} contentClassName="!px-1.5 !py-1.5">
          <OrgList onDone={done} />
        </Modal>
      )}
      {after === "section" && <SectionDialog onClose={done} />}
      {after === "signout" && <SignOutDialog onClose={done} />}
    </>
  );
}

/** The same question Settings asks before signing out. */
function SignOutDialog({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Sign out of Bubble AI?" onClose={onClose}>
      <p className="text-body text-muted mb-5">Your agents keep working. To come back, sign in again.</p>
      <div className="flex flex-col gap-2">
        <Button
          variant="danger"
          className="h-12"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void logout();
          }}
        >
          Sign out
        </Button>
        <Button variant="ghost" className="h-12" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

const media = (query: string) => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches;

function Palette({ onClose, onAfter }: { onClose: () => void; onAfter: (after: After) => void }) {
  const channels = useStore((s) => s.channels);
  const agents = useStore((s) => s.agents);
  const members = useStore((s) => s.members);
  const me = useStore((s) => s.me);
  const teams = useTeams();
  const guest = me?.role === "guest";
  // only the hub owner can make a new workspace (older hubs don't say: offer it)
  const hubOwner = me?.hubOwner !== false;
  const features = useFeatures();
  const waiting = useInboxCount();
  const [q, setQ] = useState(() => useStore.getState().paletteSeed);
  const [results, setResults] = useState<Results | null>(null);
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const searchGeneration = useRef(0);
  // the chat that is open behind the palette (it closes when the address changes, so once is enough)
  const here = useMemo(() => {
    const r = parseRoute(typeof location === "undefined" ? "" : location.hash);
    return r.view === "chat" ? r.channelId : null;
  }, []);

  // agents, teams, places and actions are found at once from what is already loaded; only
  // messages and notes ask the hub, and only once two characters are typed
  useEffect(() => {
    const generation = ++searchGeneration.current;
    if (q.trim().length < 2) return setResults(null);
    const t = setTimeout(() => api<Results>("GET", `/api/search?q=${encodeURIComponent(q)}`).then((r) => generation === searchGeneration.current && setResults(r), () => {}), 150);
    return () => {
      searchGeneration.current++;
      clearTimeout(t);
    };
  }, [q]);

  const rows: Row[] = useMemo(() => {
    const typed = q.trim();
    const needle = typed.toLowerCase().replace(/^[#@]/, "");
    const lookup: Lookup = {
      people: Object.fromEntries(members.map((m) => [m.id, m.name])),
      agents: Object.fromEntries(agents.map((a) => [a.id, a.handle])),
      // a team's memory folder (teams/<name>) shows as its channel
      teams: Object.fromEntries(teams.filter((t) => t.folder.startsWith("teams/")).map((t) => [t.folder.split("/")[1], `#${t.name}`])),
    };
    const line = (Icon: LucideIcon) => <Icon size={17} strokeWidth={1.8} />;
    const dmOf = (agentId: string) => channels.find((c) => c.kind === "dm" && c.name.endsWith(`:${agentId}`));
    const stamp = (c: ChannelInfo | undefined, fallback = "") => Date.parse(c?.last?.at ?? c?.createdAt ?? fallback) || 0;
    const agentRow = (a: Agent, group: string, meta?: string): Row => ({ key: `a:${a.id}`, group, icon: <ChatAvatar chat={{ kind: "dm", agent: a, channel: null }} size={28} />, label: <span className="font-semibold">{a.name}</span>, meta, run: () => void openDm(a.id) });
    const teamRow = (c: ChannelInfo, group: string, meta?: string): Row => ({ key: `c:${c.id}`, group, icon: <ChatAvatar chat={{ kind: "team", agent: null, channel: c }} size={28} />, label: <span className="font-semibold">{c.name}</span>, meta, run: () => go({ view: "chat", channelId: c.id, threadId: null }) });
    const needsYou: Row = { key: "needs-you", group: "", icon: line(Bell), label: waiting > 0 ? `Needs you (${waiting})` : "Needs you", run: () => go({ view: "dashboard" }) };

    // nothing typed: who you talked to last, and what waits on you
    if (!needle) {
      const recent = [
        ...agents.map((a) => ({ at: stamp(dmOf(a.id), a.createdAt), row: agentRow(a, "Recent") })),
        ...channels.filter((c) => c.kind === "channel" && c.joined && !c.archivedAt).map((c) => ({ at: stamp(c), row: teamRow(c, "Recent") })),
      ];
      const out = recent.sort((x, y) => y.at - x.at).slice(0, MOST.recent).map((x) => x.row);
      if (waiting > 0) out.push(needsYou);
      return out;
    }

    const out: Row[] = [];
    // agents and teams, by name: a name that starts with what was typed first, then the chats you're in, then the newest
    const has = (s: string) => s.toLowerCase().includes(needle);
    const chats = [
      ...agents.filter((a) => has(a.name) || has(a.handle)).map((a) => ({ name: a.name, mine: true, at: stamp(dmOf(a.id), a.createdAt), row: agentRow(a, "Agents and teams", has(a.name) ? undefined : `@${a.handle}`) })),
      ...channels.filter((c) => c.kind === "channel" && has(c.name)).map((c) => ({ name: c.name, mine: c.joined && !c.archivedAt, at: stamp(c), row: teamRow(c, "Agents and teams", c.archivedAt ? "Archived" : c.joined ? undefined : "Not joined") })),
    ];
    const first = (name: string) => Number(!name.toLowerCase().startsWith(needle));
    out.push(...chats.sort((x, y) => first(x.name) - first(y.name) || Number(y.mine) - Number(x.mine) || y.at - x.at).slice(0, MOST.chats).map((x) => x.row));

    const clock = me?.prefs?.clock ?? "auto";
    const agentName = (id: string) => agents.find((a) => a.id === id)?.name;
    for (const m of (results?.messages ?? []).slice(0, MOST.messages)) {
      const who = m.author.kind === "agent" ? agentName(m.author.id) : m.author.id === me?.user.id ? "You" : lookup.people[m.author.id];
      // a team's name, or the agent a chat is with (DM channel names end with the agent id)
      const where = m.channelName.startsWith("dm:") ? agentName(m.channelName.slice(m.channelName.lastIndexOf(":") + 1)) : m.channelName;
      out.push({
        key: `m:${m.id}`,
        group: "Messages",
        icon: line(MessageSquare),
        label: cleanPreview(m.body, 100) || `Untitled ${messageKind(m).toLowerCase()}`,
        meta: [who, where !== who ? where : null, shortTime(Date.parse(m.createdAt) || 0, clock)].filter(Boolean).join(" · "),
        run: () => go({ view: "chat", channelId: m.channelId, threadId: m.threadId, messageId: m.id }),
      });
    }

    // found by "inbox" or "approvals" too, even with nothing waiting, so the page always opens from here
    if (wordMatch(typed, "Needs you", "inbox waiting approvals allow dashboard") > 0) out.push(needsYou);

    for (const p of findByWords(typed, placesFor(guest, features)).slice(0, MOST.places)) out.push({ key: `p:${p.key}`, group: "Places", icon: line(p.icon), label: p.label, meta: p.where, run: () => go(p.to) });

    for (const n of (results?.notes ?? []).slice(0, MOST.notes)) {
      out.push({
        key: `n:${n.path}`,
        group: "Notes",
        icon: line(FileText),
        label: cleanPreview(n.title, 80) || humanize(n.path.split("/").pop() ?? "") || "Untitled note",
        // the folder it's in: "Shared", "@juno"
        meta: noteLocation(n.path, n.title, lookup).split(" › ").slice(1, -1).join(" › ") || undefined,
        tip: n.path,
        run: () => go({ view: "vault", path: n.path }),
      });
    }

    const act = (key: string, Icon: LucideIcon, label: string, words: string, run: () => void) => ({ key: `x:${key}`, group: "Actions", icon: line(Icon), label, words, run });
    const open = here ? channels.find((c) => c.id === here) : undefined;
    const dmAgent = open && open.kind === "dm" && !open.archivedAt ? agents.find((a) => open.name.endsWith(`:${a.id}`)) : undefined;
    // "/new" and "/compact" are Bubble AI's own commands: every agent answers them in its chat
    const say = (body: string) => void api("POST", `/api/channels/${open!.id}/messages`, { body, threadId: null, fileIds: [] }).catch((e) => alert(`Couldn't send: ${(e as Error).message}`));
    // a small window shows the rail until it's opened by hand, so the sidebar can't say which way it goes
    const sidebar = !media(`(min-width: ${SIDEBAR.roomy}px)`) ? "Expand or collapse sidebar" : loadSidebar().collapsed ? "Expand sidebar" : "Collapse sidebar";
    const actions = [
      ...(!guest ? [act("agent", Plus, "New agent", "add create make hire", startNewAgent)] : []),
      ...(!guest ? [act("team", Users, "New team", "add create make group channel", () => useStore.setState({ channelBrowser: { sectionId: null, create: true } }))] : []),
      act("browse-teams", Users, "Browse teams", "find join leave public archived channels", () => useStore.setState({ channelBrowser: { sectionId: null } })),
      ...(!guest ? [act("section", FolderPlus, "New section", "add create make folder group sidebar", () => onAfter("section"))] : []),
      ...(!guest && features.tasks ? [act("task", SquarePen, "New task", "add create make assign work", () => useStore.setState({ newTaskOpen: true }))] : []),
      ...(media("(min-width: 768px)") ? [act("sidebar", PanelLeft, sidebar, "collapse expand hide show rail", toggleSidebar)] : []),
      act("orgs", Building2, "Switch workspace", "change join invite organization org", () => onAfter("orgs")),
      ...(hubOwner ? [act("org", Building2, "New workspace", "add create make organization org", () => onAfter("org"))] : []),
      act("signout", LogOut, "Sign out", "log out logout", () => onAfter("signout")),
      ...(open && dmAgent
        ? [
            act("call", AudioLines, `Call ${dmAgent.name}`, "talk voice phone speak", () => go({ view: "chat", channelId: open.id, threadId: null, call: true })),
            act("fresh", RotateCcw, "Start fresh", "new conversation chat reset clear context", () => say("/new")),
            act("compact", Minimize2, "Compact", "shrink summarize summarise compress context", () => say("/compact")),
          ]
        : []),
    ];
    for (const { words: _words, ...row } of findByWords(typed, actions)) out.push(row);
    return out;
  }, [q, results, channels, agents, members, teams, me, guest, hubOwner, features, waiting, here, onAfter]);

  const id = useRef(Symbol("palette")).current;
  useOverlay(id, "palette");
  useEffect(() => {
    // a dialog opened over the palette answers Escape itself
    const esc = (e: KeyboardEvent) => e.key === "Escape" && isTopOverlay(id) && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  useEffect(() => {
    setSel(0);
  }, [rows.length, q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const choose = (r: Row | undefined) => {
    if (!r) return;
    onClose();
    r.run();
  };

  let lastGroup: string | null = null;
  // it drops in from the top over a dim (Bubble AI's motion), and is gone at once when closed
  return toBody(
    <div className="m-palette-scrim fixed inset-0 z-[70] flex items-start justify-center bg-black/45 px-3 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] md:pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search everything" className="m-palette-card flex max-h-full w-full max-w-[583px] flex-col overflow-hidden rounded-[18px] border border-line bg-float shadow-float">
        <div className={cx("flex h-[60px] shrink-0 items-center gap-3 pl-5 pr-3 md:pr-5", rows.length > 0 || q.trim() ? "border-b border-line" : "")}>
          <Search size={19} strokeWidth={1.8} className="shrink-0 text-muted" aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-label="Search everything"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={rows[sel] ? `palette-opt-${sel}` : undefined}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="h-full min-w-0 flex-1 bg-transparent text-[18px] leading-[26px] text-ink outline-none placeholder:text-faint"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, rows.length - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
              if (e.key === "Enter") (e.preventDefault(), choose(rows[sel]));
            }}
          />
          <button onClick={onClose} className="md:hidden h-11 shrink-0 px-2 text-base text-muted hover:text-ink">
            Cancel
          </button>
        </div>
        <div ref={listRef} id="palette-list" role="listbox" aria-label="Results" className={cx("min-h-0 overflow-y-auto px-2 max-h-[50dvh] md:max-h-[min(56vh,480px)]", (rows.length > 0 || q.trim()) && "pb-2 pt-0.5")}>
          {rows.length === 0 && q.trim() && <p className="px-3 py-7 text-center text-sm text-muted">No results</p>}
          {rows.map((r, i) => {
            const starts = r.group !== lastGroup;
            const apart = starts && !r.group && i > 0;
            lastGroup = r.group;
            return (
              <div key={r.key} role="presentation">
                {starts && r.group && (
                  <div role="presentation" className="px-2.5 pb-1 pt-2.5 text-xs leading-4 text-muted">
                    {r.group}
                  </div>
                )}
                {apart && <div role="presentation" className="mx-2.5 my-1.5 h-px bg-line" />}
                <button
                  id={`palette-opt-${i}`}
                  role="option"
                  aria-selected={i === sel}
                  tabIndex={-1}
                  title={r.tip}
                  data-index={i}
                  onMouseMove={() => setSel(i)}
                  onClick={() => choose(r)}
                  className={cx("flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base md:h-12 md:gap-3 md:rounded-xl md:px-3 md:text-[16px]", i === sel && "bg-hover")}
                >
                  <span className="grid w-6 shrink-0 place-items-center text-muted md:w-[22px]">{r.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  {r.meta && <span className="max-w-[45%] shrink-0 truncate text-[14px] text-muted">{r.meta}</span>}
                  {i === sel && <CornerDownLeft size={14} strokeWidth={1.8} className="hidden shrink-0 text-muted md:block" aria-hidden />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
  );
}
