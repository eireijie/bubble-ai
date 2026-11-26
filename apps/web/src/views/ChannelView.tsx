import { Suspense, createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { MotionMark } from "../components/MotionMark.tsx";
import { FlowStrip } from "../team/Runs.tsx";
import { contextWords } from "../contextWords.ts";
import { SquarePen, Globe, Archive, Book, Bot, Clock, ChevronLeft, ChevronRight, Check, CircleDot, FileText, GitPullRequest, Brain, ArrowDown, ArrowUp, AtSign, Camera, Loader2, Mic, MessageSquare, Paperclip, Plus, UserPlus, X, AudioLines, CornerUpLeft, Pin, ListChecks, Square, ArrowRightLeft } from "lucide-react";
import { SCHEDULE_MARK, type Agent, type ContextUsage, type Message, type MessagePart } from "@bubble-ai/core";
import { api, fileUrl, uploadFile } from "../api.ts";
import { conversationKey, useHandleColors, useHandleNames, useNames, usePrefs, useStore, type ChannelInfo, type LiveRun } from "../store.ts";
import { liveShape } from "../liveShape.ts";
import { go, href, type Route } from "../router.ts";
import type { TaskRow } from "./TasksView.tsx";
import { renderMarkdown, renderMessage } from "../markdown.ts";
import { lazyView } from "../lazy.tsx";
import { ChannelSettings, landingChannel, setArchived, type ChannelSettingsTab } from "../components/Channels.tsx";
import { ChatAvatar } from "../components/ChatList.tsx";
import { prettyModel, tokens, useAgentContext } from "../models.ts";
import { DiscussionCard } from "../components/Discussion.tsx";
import { ApprovalCard, ChangeCard, ChatCard, ComputerPart, RoutineChip } from "../components/AgentCards.tsx";
import { AppleReadLines } from "../components/AppleParts.tsx";
import { downloadFile, FilePreview } from "../components/FilePreview.tsx";
import { fileKind } from "../components/fileKind.ts";
import { AgentAvatar, Menu, Pill, Popover, StatusDot, UserAvatar, agentColor, clockTime, cx } from "../components/ui.tsx";
import { AgentPill } from "../components/AgentPill.tsx";
import { BannerSlot } from "../components/SuggestionBanner.tsx";
import { linkPreviews, type LinkPreview } from "../linkPreview.ts";
import type { CallRecord } from "../voice/CallScreen.tsx";
import { takeDraft } from "../draft.ts";
import { chatTint, didThings, roundAction } from "../chatTint.ts";
import { AgentPanel, type AgentPanelTab } from "../components/AgentPanel.tsx";
import { slashEnterAction } from "../slashCommand.ts";
import { slashQuery, useAgentCommands, useSlashMenu, type SlashItem } from "../components/SlashMenu.tsx";
import { ActivityPill, stopRuns } from "../components/ActivityPill.tsx";
import { RightPane } from "../components/RightPane.tsx";
import { workSummary } from "../components/agentActivity.ts";
import { DeleteMessageDialog, EditMessageDialog, MessageMenu, ReactionBadges, SWIPE_ARM, useLongPress, useMessageActionList, useSwipeToThread } from "../components/MessageActions.tsx";
import { useChangedSinceMount, useFreshIds } from "../motion.ts";
import { TeamInfo, type InfoTab } from "../components/TeamInfo.tsx";
import { useFeature } from "../features.ts";
import { chatName, isGrouped, needsStamp, snippetOf, stampLabel, startsChat, toolLine } from "../chatFormat.ts";
import { HarnessSignInButton, SignInNeededBar } from "../components/HarnessSignInButton.tsx";
import { CheckbackLabel, ClosedLine, LoopParts } from "../components/Loops.tsx";
import { SetupTour } from "../components/onboarding/SetupTour.tsx";
import { FirstChatExtras, isFirstChat } from "../components/onboarding/FirstChat.tsx";
import { GhostLanding, useFirstHelloHtml } from "../components/onboarding/FirstHello.tsx";

/** What's open in the pane beside the chat (a thread comes from the route instead). */
type Side = { kind: "agent"; agentId: string; tab: AgentPanelTab } | { kind: "info"; tab: InfoTab };

/** The DM's own agent panel stays open across DMs once you open it. */
// a call's screen is only needed while a call is on: a file of its own (lazy.tsx)
const CallScreen = lazyView(() => import("../voice/CallScreen.tsx").then((m) => m.CallScreen));

/** A reply that failed: one muted line, "Couldn't finish." (click it for why), Try again, and the sign-in when that's the cause. */
function RunFailedActions({ part, agentId, detail }: { part: Extract<MessagePart, { type: "run_failed" }>; agentId?: string; detail?: string }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/api/runs/${part.runId}/retry`);
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // the agent still can't answer for want of a sign-in: open that sign-in right here
  const signIn = useStore((s) => (agentId && (part.fix === "signin" || part.fix === "computer") ? s.agents.find((a) => a.id === agentId)?.signIn : null));
  const to = part.fix === "computer" && agentId ? href({ view: "agents", agentId, tab: "computer" }) : part.fix === "connection" ? href({ view: "settings", page: "harnesses" }) : part.fix === "signin" ? href({ view: "settings", page: "harnesses" }) : null;
  if (sent) return <div className="mt-1 px-1 text-[14px] text-muted">Trying again…</div>;
  const link = "font-medium text-ink hover:underline disabled:opacity-50";
  return (
    <div className="mt-1 px-1 text-[14px] leading-5 text-muted">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {detail ? (
          <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className="hover:text-ink">
            Couldn't finish.
          </button>
        ) : (
          <span>Couldn't finish.</span>
        )}
        {part.retry && (
          <button type="button" disabled={busy} onClick={() => void retry()} className={link}>
            Try again
          </button>
        )}
        {signIn && <HarnessSignInButton signIn={signIn} agentId={agentId} />}
        {to && !signIn && (
          <a href={to} className={link}>
            Sign in
          </a>
        )}
        {error && <span className="text-xs text-bad">{error}</span>}
      </div>
      {more && detail && <p className="mt-1 whitespace-pre-wrap text-xs">{detail}</p>}
    </div>
  );
}

function storedDmPanel(): AgentPanelTab | null {
  try {
    return (localStorage.getItem("wisp.agentPanel") as AgentPanelTab | null) || null;
  } catch {
    return null;
  }
}

/** The most the hub takes in one file (apps/hub/src/api.ts, POST /api/files). */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export function ChannelView({ route, onBack }: { route: Extract<Route, { view: "chat" }>; onBack?: () => void }) {
  const channels = useStore((s) => s.channels);
  const setActive = useStore((s) => s.setActive);
  const loadChannel = useStore((s) => s.loadChannel);
  const names = useNames();
  const [calling, setCalling] = useState(!!route.call);
  const [bannerSlot, setBannerSlot] = useState<HTMLDivElement | null>(null);
  // the record a finished call leaves in the chat
  const [callRecord, setCallRecord] = useState<(CallRecord & { channelId: string }) | null>(null);
  useEffect(() => { setCalling(!!route.call); }, [route.channelId, route.call]);
  const [settings, setSettings] = useState<ChannelSettingsTab | null>(null);

  // a chat with an agent that was removed has no agent left in it: it's gone, not a chat with nobody
  const channel = channels.find((c) => c.id === route.channelId && !(c.kind === "dm" && c.agentIds?.length === 0)) ?? (route.channelId ? undefined : landingChannel(channels));
  const dmAgentId = channel?.kind === "dm" ? channel.name.split(":").pop()! : null;
  // the pane beside the chat: an agent's details or the team's info page
  const [side, setSideState] = useState<Side | null>(null);
  useEffect(() => {
    // remembered only where the panel sits beside the chat: on a phone it would cover the chat it belongs to
    const beside = typeof window === "undefined" || window.matchMedia("(min-width: 768px)").matches;
    const tab = dmAgentId && beside ? storedDmPanel() : null;
    setSideState(dmAgentId && tab ? { kind: "agent", agentId: dmAgentId, tab: "details" } : null);
  }, [channel?.id, dmAgentId]);
  const setSide = (next: Side | null) => {
    setSideState(next);
    // remember the DM's own panel, so it's there in the next DM too
    if (!dmAgentId) return;
    try {
      if (next?.kind === "agent" && next.agentId === dmAgentId) localStorage.setItem("wisp.agentPanel", next.tab);
      else if (!next) localStorage.removeItem("wisp.agentPanel");
    } catch {}
  };
  /** Open a pane; a thread that's open closes first, since they share the space. */
  const openSide = (next: Side) => {
    if (route.threadId && channel) go({ view: "chat", channelId: channel.id, threadId: null });
    setSide(next);
  };
  const openAgent = (agentId: string, tab: AgentPanelTab = "details") => openSide({ kind: "agent", agentId, tab });
  const toggleInfo = () => (side?.kind === "info" && !route.threadId ? setSide(null) : openSide({ kind: "info", tab: "about" }));

  // where you'd stopped reading when you opened the channel; the "NEW" divider goes there
  const [readMark, setReadMark] = useState<{ channelId: string; at: string | null } | null>(null);

  useEffect(() => {
    if (!route.channelId && channel) go({ view: "chat", channelId: channel.id, threadId: null });
  }, [route.channelId, channel]);

  useEffect(() => {
    if (!channel) return;
    setReadMark({ channelId: channel.id, at: channel.lastReadAt });
    setActive(channel.id);
    void loadChannel(channel.id).catch(() => {});
    return () => {
      setActive(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.id, setActive, loadChannel]);

  // hooks stay above the early return below: a chat that isn't there (or stops being there) must not change their count
  const dmFull = useStore((s) => (dmAgentId ? s.agents.find((a) => a.id === dmAgentId) : undefined));
  const pillRef = useRef<HTMLDivElement>(null);

  if (!channel)
    return (
      <div className="flex-1 min-w-0 flex flex-col">
        {onBack && (
          <header className="shrink-0 px-3 h-[4.75rem] flex items-center safe-top box-content md:hidden">
            <button className="circle" onClick={onBack} aria-label="Back to chats">
              <ChevronLeft size={22} strokeWidth={2} />
            </button>
          </header>
        )}
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-muted">
          <MotionMark size={56} mood="drift" />
          {route.channelId ? "This chat isn't here any more" : "No chats yet"}
        </div>
      </div>
    );

  const dmAgent = dmAgentId ? names.agent(dmAgentId) : undefined;
  const sideAgent = !route.threadId && side?.kind === "agent" ? names.agent(side.agentId) : undefined;
  const dmPanel = sideAgent && dmAgent && sideAgent.id === dmAgent.id ? (side as Extract<Side, { kind: "agent" }>).tab : null;
  const infoOpen = side?.kind === "info" && !route.threadId && channel.kind === "channel";

  return (
    // the open agent's colour tints its chat: your bubbles and the round button (a team keeps the Bubble AI violet)
    <div className="flex-1 min-h-0 flex" style={chatTint(dmAgent ? agentColor(dmAgent) : undefined)}>
      <div className={cx("relative flex-1 min-w-0 flex flex-col", route.threadId && "hidden lg:flex")}>
        <BannerSlot.Provider value={bannerSlot}>
        {/* only the name pill, centred: it opens the panel that holds everything else */}
        <header className="win-safe shrink-0 px-3 md:px-6 h-[4.75rem] md:h-[80px] pt-[env(safe-area-inset-top)] md:pt-4 md:pb-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2 box-content">
          <div className="flex items-center">
            {onBack && (
              <span className="md:hidden">
                <button className="circle" onClick={onBack} aria-label="Back to chats">
                  <ChevronLeft size={22} strokeWidth={2} />
                </button>
              </span>
            )}
            {/* round new-chat button in the top-left corner (desktop; phones keep Back there) */}
            <button type="button" onClick={() => useStore.setState({ newChatOpen: true })} aria-label="New chat" title="New chat" className="m-press hidden size-[34px] place-items-center rounded-[8px] text-muted outline-none transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/40 md:grid">
              <SquarePen size={17} strokeWidth={1.7} />
            </button>
          </div>
          {dmAgent ? (
            // the agent lives here, in the middle, and nowhere else in its DM
            <div ref={pillRef} className="flex justify-center min-w-0">
              <AgentPill agent={dmAgent} open={!!dmPanel} onClick={() => (dmPanel ? setSide(null) : openAgent(dmAgent.id))} />
              {/* straight from setup: the host flies into the pill */}
              {dmFull && isFirstChat(dmFull, channel.id) && <GhostLanding key={channel.id} agent={dmFull} target={() => pillRef.current} />}
            </div>
          ) : (
            <TeamPill channel={channel} open={infoOpen} onClick={toggleInfo} />
          )}
          <div className="flex items-center justify-end gap-2">
            {/* calls start from the composer's round button; Help and the tour live in the account menu */}
            {dmAgent && <DmContext agentId={dmAgent.id} channelId={channel.id} onOpen={() => openAgent(dmAgent.id, "thinks")} />}
          </div>
        </header>
        {/* one suggested step sits here, under the header, in its own space (SuggestionBanner) */}
        <div ref={setBannerSlot} className="relative z-20 flex shrink-0 flex-col items-center gap-2 px-4 pb-2 empty:hidden" />
        <SoloAgent.Provider value={dmAgent?.id ?? null}>
          <MessageList messageId={!route.threadId ? route.messageId : undefined} channel={channel} readMark={readMark?.channelId === channel.id ? readMark.at : null} calling={calling && !!dmAgent} onAddAgent={() => setSettings("team")} onMembers={() => openSide({ kind: "info", tab: "members" })} />
        </SoloAgent.Provider>
        {!channel.archivedAt && dmFull?.signIn && <SignInNeededBar agent={dmFull} />}
        {!channel.archivedAt && dmFull && <SetupTour key={channel.id} agent={dmFull} channelId={channel.id} />}
        {!channel.archivedAt && dmFull && <FirstChatExtras agent={dmFull} channelId={channel.id} workspaceId={channel.workspaceId} />}
        {callRecord && callRecord.channelId === channel.id && dmAgent && !calling && <CallRecordCard agent={dmAgent} record={callRecord} onHide={() => setCallRecord(null)} />}
        {calling && dmAgent && (
          <Suspense fallback={null}>
            <CallScreen key={`${channel.id}:${dmAgent.id}`} agent={dmAgent} channelId={channel.id} onClose={(record) => { setCalling(false); if (record) setCallRecord({ ...record, channelId: channel.id }); if (route.call) go({ view: "chat", channelId: channel.id, threadId: null }); }} />
          </Suspense>
        )}
        {channel.archivedAt ? <ArchivedBar channel={channel} /> : <div data-tour="composer" className="contents"><Composer channelId={channel.id} agentId={dmAgent?.id} placeholder={`Message ${dmAgent ? dmAgent.name : channel.name}`} onDetails={openAgent} onCall={dmAgent && !calling ? () => setCalling(true) : undefined} /></div>}
        </BannerSlot.Provider>
      </div>
      {route.threadId && <ThreadPanel key={route.threadId} messageId={route.messageId} channelId={channel.id} rootId={route.threadId} agentId={dmAgent?.id} />}
      {sideAgent && side?.kind === "agent" && <AgentPanel key={sideAgent.id} agent={sideAgent} channelId={channel.id} tab={side.tab} inDm={sideAgent.id === dmAgent?.id} onClose={() => setSide(null)} />}
      {infoOpen && side?.kind === "info" && (
        // the team's info keeps its place and content, at the panel's 310 px
        <div className="contents lg:[&>aside]:w-[310px]! [&>aside>[role=separator]]:hidden!">
          <TeamInfo channel={channel} tab={side.tab} onTab={(tab) => setSide({ kind: "info", tab })} onClose={() => setSide(null)} onSettings={setSettings} />
        </div>
      )}
      {settings && <ChannelSettings key={settings} channel={channel} tab={settings} onClose={() => setSettings(null)} />}
    </div>
  );
}

/** What a finished call leaves in the chat: how long it was and what was said. The round button calls again. */
function CallRecordCard({ agent, record, onHide }: { agent: Agent; record: CallRecord; onHide: () => void }) {
  const m = Math.floor(record.seconds / 60);
  const length = `${String(m).padStart(2, "0")}:${String(record.seconds % 60).padStart(2, "0")}`;
  return (
    <div className="shrink-0 px-4 md:px-11 w-full max-w-3xl md:max-w-[808px] mx-auto">
      <section className="call-record overflow-hidden rounded-[18px] border border-line bg-card" aria-label={`Call with ${agent.name}`}>
        <div className="flex h-11 items-center gap-2 border-b border-line pl-3.5 pr-2 text-[14px] text-muted">
          <AudioLines size={15} strokeWidth={1.7} aria-hidden />
          <span className="flex-1 truncate">Call with {agent.name} · {length}</span>
          <button type="button" onClick={onHide} aria-label="Hide" title="Hide" className="grid size-7 place-items-center rounded-[8px] text-muted hover:bg-hover hover:text-ink"><X size={14} strokeWidth={1.8} /></button>
        </div>
        {record.lines.length > 0 && (
          <div className="flex max-h-48 flex-col gap-2 overflow-y-auto px-3.5 py-3">
            {record.lines.map((l, i) => (
              <div key={i} className={cx("max-w-[480px] rounded-2xl px-[13px] py-[7px] text-[14px] leading-5", l.who === "you" ? "self-end bg-[var(--bubble-me)] text-[var(--bubble-me-ink)]" : "self-start bg-[var(--bubble-them)]")}>{l.text}</div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** A team's name in a pill at the top of its chat, with its agents' ghosts; opens its info page. */
function TeamPill({ channel, open, onClick }: { channel: ChannelInfo; open: boolean; onClick: () => void }) {
  return (
    <button data-tour="team-pill" onClick={onClick} aria-expanded={open} aria-label={`${channel.name}. Team info`} className={cx("h-12 max-w-[min(22rem,60vw)] rounded-[8px] pl-2 pr-5 inline-flex items-center gap-2.5 text-[17px] outline-none focus-visible:ring-2 focus-visible:ring-ring", open ? "bg-side-active" : "hover:bg-hover")}>
      <ChatAvatar chat={{ kind: "team", agent: null, channel }} size={34} />
      <span className="min-w-0 truncate font-semibold">{channel.name}</span>
      {channel.archivedAt && <span className="shrink-0 text-xs text-muted">Archived</span>}
    </button>
  );
}

/** Past this share of its context window a conversation is nearly full (where the context ring used to turn red). */
const NEARLY_FULL = 85;

/** The context ring, in a DM's header only once the conversation is nearly full. It opens Thinks with, where Compact and Start fresh are. */
function DmContext({ agentId, channelId, onOpen }: { agentId: string; channelId: string; onOpen: () => void }) {
  const { ctx } = useAgentContext(agentId, channelId);
  const pct = ctx && ctx.contextUsed !== null && ctx.contextWindow ? Math.min(100, (ctx.contextUsed / ctx.contextWindow) * 100) : null;
  if (pct === null || pct <= NEARLY_FULL) return null;
  const r = 7;
  const c = 2 * Math.PI * r;
  const summary = `${Math.round(pct)}% of context used`;
  return (
    <button type="button" onClick={onOpen} title={summary} aria-label={summary} className="size-9 md:size-8 grid place-items-center">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <circle cx="9" cy="9" r={r} fill="none" stroke="var(--faint)" strokeOpacity="0.35" strokeWidth="2.6" />
        <circle cx="9" cy="9" r={r} fill="none" stroke="var(--bad)" strokeWidth="2.6" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 9 9)" />
      </svg>
    </button>
  );
}

/** Where the composer would be, in an archived team. */
function ArchivedBar({ channel }: { channel: ChannelInfo }) {
  const canManage = useStore((s) => s.me?.role !== "guest");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="shrink-0 px-3 md:px-5 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-2xl rounded-3xl bg-card px-4 py-3 flex items-center gap-3">
        <Archive size={18} className="text-muted shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium">Archived</span>
        </span>
        {canManage && (
          <button className="h-10 rounded-[8px] bg-accent px-4 text-sm font-medium text-accent-ink" onClick={() => setArchived(channel, false).catch((e) => setError((e as Error).message))}>
            Unarchive
          </button>
        )}
      </div>
      {error && <p className="pt-1 px-1 text-xs text-bad">{error}</p>}
    </div>
  );
}

/** An agent's answer to /context: how full its conversation is, with a way to shrink it when its harness has one. */
function ContextCard({ usage }: { usage: ContextUsage | null }) {
  const author = useContext(CardAuthor);
  const commands = useAgentCommands(author?.agentId);
  const channelKind = useStore((s) => s.channels.find((c) => c.id === author?.channelId)?.kind);
  const agent = useStore((s) => s.agents.find((a) => a.id === author?.agentId));
  const shrink = commands.find((c) => c.via === "raw" && (c.name === "compact" || c.name === "compress"));
  const used = usage?.contextUsed ?? null;
  const window = usage?.contextWindow ?? null;
  const pct = used !== null && window ? Math.min(100, (used / window) * 100) : null;
  const color = pct === null ? "var(--faint)" : pct > 85 ? "var(--bad)" : pct > 60 ? "var(--warn)" : "var(--ok)";
  async function run() {
    if (!author || !shrink || !agent) return;
    await api("POST", `/api/channels/${author.channelId}/messages`, { body: `${channelKind === "dm" ? "" : `@${agent.handle} `}/${shrink.name}`, threadId: author.threadId ?? undefined });
  }
  return (
    <ChatCard icon={<AudioLines size={13} />} label="Context window">
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="text-body font-medium">{contextWords(pct)}</span>
        {usage?.model && <span className="text-xs text-muted truncate">{prettyModel(usage.model)}</span>}
      </div>
      {pct !== null && (
        <div className="mt-2 h-2 rounded-full bg-chip overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 2)}%`, background: color }} />
        </div>
      )}
      <p className="mt-2 text-[14px] text-muted">{used !== null ? `${tokens(used)}${window ? ` of ${tokens(window)}` : ""} used. Older messages are summarized when it fills up.` : "This shows up after its first reply here."}</p>
      {shrink && used !== null && (
        <button className="mt-2.5 h-10 rounded-[8px] border border-control-line bg-control px-4 text-sm font-medium" onClick={run}>
          {shrink.name === "compact" ? "Compact" : "Compress"}
        </button>
      )}
    </ChatCard>
  );
}

/** Which message a card sits in, for cards that act on their conversation. */
const CardAuthor = createContext<{ agentId: string; channelId: string; threadId: string | null } | null>(null);

// --- message list -------------------------------------------------------------------------------

/** In a DM the agent lives in the pill at the top, so its messages don't repeat its ghost and name. */
const SoloAgent = createContext<string | null>(null);
/** Messages that just arrived in the open list: they rise or pop in once (motion.ts useFreshIds). */
const FreshMessages = createContext<ReadonlySet<string>>(new Set());

/** Shared paging, retry and search positioning for a channel or thread. */
function useMessageHistory(channelId: string, threadId: string | undefined, messageId: string | undefined, ref: RefObject<HTMLDivElement | null>, messages: Message[] | undefined) {
  const key = conversationKey(channelId, threadId);
  const earlier = useStore((s) => s.hasEarlier[key]);
  const error = useStore((s) => s.loadErrors[key]);
  const loading = useStore((s) => s.loadingMessages[key]);
  const snapshot = useRef<{ height: number; top: number } | null>(null);
  const prepended = useRef(false);
  const search = useRef({ key: "", pages: 0, found: false });
  const highlight = useRef<(() => void) | null>(null);
  const loadEarlier = async () => {
    if (ref.current) snapshot.current = { height: ref.current.scrollHeight, top: ref.current.scrollTop };
    try { await useStore.getState().loadEarlier(channelId, threadId); } catch { snapshot.current = null; }
  };
  useLayoutEffect(() => {
    prepended.current = !!snapshot.current;
    if (ref.current && snapshot.current) ref.current.scrollTop = snapshot.current.top + ref.current.scrollHeight - snapshot.current.height;
    snapshot.current = null;
  }, [messages]);
  useEffect(() => {
    const searchKey = `${key}/${messageId ?? ""}`;
    if (search.current.key !== searchKey) search.current = { key: searchKey, pages: 0, found: false };
    if (!messageId || !messages || loading || error || search.current.found) return;
    const row = Array.from(ref.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? []).find((el) => el.dataset.messageId === messageId);
    if (row) {
      search.current.found = true;
      row.scrollIntoView({ block: "center" });
      highlight.current?.();
      row.classList.add("bg-accent-soft");
      const timer = setTimeout(() => row.classList.remove("bg-accent-soft"), 2000);
      highlight.current = () => { clearTimeout(timer); row.classList.remove("bg-accent-soft"); };
    } else if (earlier && search.current.pages < 10) {
      search.current.pages++;
      void loadEarlier();
    }
  }, [key, messageId, messages, loading, error, earlier]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => highlight.current?.(), []);
  const retry = () => {
    const state = useStore.getState();
    if (error?.earlier) void loadEarlier();
    else void (threadId ? state.loadThread(channelId, threadId) : state.loadChannel(channelId)).catch(() => {});
  };
  const controls = <>
    {earlier && <div className="px-5 py-1 text-center"><button className="text-xs text-muted hover:text-ink hover:underline" disabled={loading} onClick={() => void loadEarlier()}>Show earlier messages</button></div>}
    {error && <p role="alert" className="px-5 py-2 text-xs text-bad">Couldn't load messages: {error.message} <button className="underline" disabled={loading} onClick={retry}>Try again</button></p>}
  </>;
  return { controls, error, prepended };
}

function MessageList({ channel, readMark, onAddAgent, onMembers, messageId, calling }: { messageId?: string; channel: ChannelInfo; readMark: string | null; onAddAgent: () => void; onMembers: () => void; /** a call is on: leave room at the top for its bar, so it never covers the first message */ calling?: boolean }) {
  const messages = useStore((s) => s.messages[channel.id]);
  const replyCounts = useStore((s) => s.replyCounts);
  const me = useStore((s) => s.me);
  const ref = useRef<HTMLDivElement>(null);
  const history = useMessageHistory(channel.id, undefined, messageId, ref, messages);
  const fresh = useFreshIds(channel.id, messages);
  const dividerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newSince, setNewSince] = useState(0);
  const positioned = useRef<string | null>(null);
  const lastCount = useRef(0);
  // every run working at the top of this chat shows as a bubble, even before it has said anything
  // (only these re-render the list as they write; a run in a thread or another chat doesn't)
  const runs = useLiveRuns((r) => r.channelId === channel.id && !r.threadId);
  const working = useWorkingByThread(channel.id);

  // first message from someone else after where you'd read up to
  const firstNew = useMemo(() => {
    if (!messages || !readMark) return null;
    return messages.find((m) => m.createdAt > readMark && m.author.id !== me?.user.id && m.author.id !== "system")?.id ?? null;
  }, [messages, readMark, me]);

  // where each message sits among its neighbours (a new chat, a time above it, grouped with the one before,
  // last of its group): worked out when the messages change, not again for every word of a reply
  // a system notice repeated over a run of messages ("isn't connected to a device yet") shows once,
  // the latest one, at the bottom of the run; an answer from anyone but you ends the run
  const repeats = useMemo(() => {
    const hide = new Set<string>();
    const seen = new Set<string>();
    const all = messages ?? [];
    for (let i = all.length - 1; i >= 0; i--) {
      const m = all[i];
      if (m.author.id === "system") {
        if (seen.has(m.body)) hide.add(m.id);
        else seen.add(m.body);
      } else if (m.author.kind !== "user") seen.clear();
    }
    return hide;
  }, [messages]);
  const shown = useMemo(() => (messages ?? []).filter((m) => !repeats.has(m.id)), [messages, repeats]);
  const places = useMemo(
    () =>
      shown.map((m, i, all) => {
        const chat = startsChat(all[i - 1], m);
        const stamp = chat || needsStamp(all[i - 1], m);
        const grouped = !stamp && isGrouped(all[i - 1], m) && m.id !== firstNew;
        const next = all[i + 1];
        const last = !next || startsChat(m, next) || needsStamp(m, next) || !isGrouped(m, next) || next.id === firstNew;
        return { chat, stamp, grouped, last };
      }),
    [shown, firstNew],
  );

  // on open: jump to the NEW divider (or the bottom); afterwards stick to the bottom if you're there
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !messages) return;
    if (positioned.current !== channel.id) {
      positioned.current = channel.id;
      lastCount.current = messages.length;
      if (dividerRef.current) dividerRef.current.scrollIntoView({ block: "center" });
      else el.scrollTop = el.scrollHeight;
      return;
    }
    if (history.prepended.current) { history.prepended.current = false; lastCount.current = messages.length; return; }
    const added = messages.length - lastCount.current;
    lastCount.current = messages.length;
    // something you just sent always comes into view, wherever you'd scrolled to
    const newest = messages[messages.length - 1];
    const sentByMe = added > 0 && newest?.author.kind === "user" && newest.author.id === me?.user.id;
    if (atBottom || sentByMe) {
      el.scrollTop = el.scrollHeight;
      if (!atBottom) {
        setAtBottom(true);
        setNewSince(0);
      }
    } else if (added > 0) setNewSince((n) => n + added);
  }, [messages, runs.map((r) => `${r.runId}${r.text.length}${r.last?.name ?? ""}`).join(), channel.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setNewSince(0);
    setAtBottom(true);
  }, [channel.id]);

  if (!messages) return <div className="flex-1 grid place-items-center text-sm text-muted">{history.error ? history.controls : null}</div>;

  const empty = !messages.some((m) => m.author.id !== "system");
  return (
    <FreshMessages.Provider value={fresh}>
    <div className="relative flex-1 min-h-0">
      <div
        ref={ref}
        className={cx("h-full overflow-y-auto overscroll-x-none pb-2", calling ? "pt-[84px]" : "pt-2")}
        onScroll={(e) => {
          const el = e.currentTarget;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          setAtBottom(bottom);
          if (bottom) setNewSince(0);
        }}
      >
        <div className="mx-auto w-full max-w-3xl md:max-w-[808px] md:px-6">
        <LatestChat.Provider value={messages.at(-1)?.conversationId ?? null}>
        {history.controls}
        {!history.error && empty && !runs.length && <ChannelIntro channel={channel} onAddAgent={onAddAgent} onMembers={onMembers} />}
        {shown.map((m, i) => (
          <ChatRow
            key={m.id}
            m={m}
            channelId={channel.id}
            chatOf={places[i].chat ? messages : undefined}
            stamp={places[i].stamp}
            newRef={m.id === firstNew ? dividerRef : undefined}
            grouped={places[i].grouped}
            last={places[i].last}
            replies={replyCounts[m.id]}
            working={working.get(m.id) ?? NO_RUNS}
            arrived={fresh.has(m.id)}
          />
        ))}
        {runs.map((r) => (
          <StreamingItem key={r.runId} run={r} />
        ))}
        </LatestChat.Provider>
        </div>
      </div>
      {!atBottom && (
        <button
          onClick={() => {
            ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
            setNewSince(0);
          }}
          className="glass absolute bottom-3 left-1/2 -translate-x-1/2 h-9 px-3.5 rounded-[8px] text-xs font-medium inline-flex items-center gap-1.5 hover:bg-hover"
        >
          <ArrowDown size={13} /> {newSince > 0 ? `${newSince} new ${newSince === 1 ? "message" : "messages"}` : "Jump to latest"}
        </button>
      )}
    </div>
    </FreshMessages.Provider>
  );
}

const NO_RUNS: LiveRun[] = [];

/**
 * The live runs a view shows word by word: the same array until one of them changes, so a run
 * writing somewhere else (another chat, a thread) doesn't render this view.
 */
function useLiveRuns(pick: (r: LiveRun) => boolean): LiveRun[] {
  const last = useRef<LiveRun[]>(NO_RUNS);
  return useStore((s) => {
    const next = Object.values(s.live).filter(pick);
    if (next.length !== last.current.length || next.some((r, i) => r !== last.current[i])) last.current = next;
    return last.current;
  });
}

/** The runs working in each thread of a chat (and in the threads above it), by the thread's first message. */
function useWorkingByThread(channelId: string, under?: string): Map<string, LiveRun[]> {
  const live = useStore(liveShape);
  return useMemo(() => {
    const by = new Map<string, LiveRun[]>();
    for (const r of Object.values(live)) {
      if (r.channelId !== channelId || !r.threadId || (under && !r.threadPath.includes(under))) continue;
      for (const id of new Set([r.threadId, ...r.threadPath])) by.set(id, [...(by.get(id) ?? []), r]);
    }
    return by;
  }, [live, channelId, under]);
}

/**
 * One message in a chat with what sits around it: the line where a new chat starts or the time,
 * the NEW line, and "closed". It renders again only when something about it changes, so a reply
 * being written below (an update for every word) or a message arriving leaves the rest alone.
 */
const ChatRow = memo(function ChatRow({ m, channelId, chatOf, stamp, newRef, grouped, last, replies, working, arrived }: { m: Message; channelId: string; /** every message here, when this one starts a new chat */ chatOf?: Message[]; stamp: boolean; newRef?: RefObject<HTMLDivElement | null>; grouped: boolean; last: boolean; replies?: number; working: LiveRun[]; arrived: boolean }) {
  const onReplies = useCallback(() => go({ view: "chat", channelId, threadId: m.id }), [channelId, m.id]);
  return (
    <div>
      {chatOf ? <ChatDivider at={m.createdAt} chat={m.conversationId!} messages={chatOf} /> : stamp && <TimeDivider at={m.createdAt} />}
      {newRef && (
        <div ref={newRef} className="flex items-center gap-3 px-5 my-2 text-[11px] font-medium tracking-wide text-accent-text">
          <span className="h-px flex-1 bg-accent/40" /> NEW <span className="h-px flex-1 bg-accent/40" />
        </div>
      )}
      <MessageItem m={m} grouped={grouped} last={last} replies={replies} working={working} onReplies={onReplies} />
      {m.parts?.some((p) => p.type === "closed") && <ClosedLine animate={arrived} />}
    </div>
  );
});

/** The same for a reply in a thread. */
const ThreadRow = memo(function ThreadRow({ m, channelId, rootId, stamp, grouped, last, replies, working }: { m: Message; channelId: string; rootId: string; stamp: boolean; grouped: boolean; last: boolean; replies?: number; working: LiveRun[] }) {
  const onReplies = useCallback(() => go({ view: "chat", channelId, threadId: m.id }), [channelId, m.id]);
  return (
    <div>
      {stamp && <TimeDivider at={m.createdAt} />}
      <MessageItem m={m} grouped={grouped} last={last} inThread composerThread={rootId} replies={replies} working={working} onReplies={onReplies} />
    </div>
  );
});

function TimeDivider({ at }: { at: string }) {
  const { clock } = usePrefs();
  return <div className="px-5 py-3 text-center text-[12px] font-medium text-muted">{stampLabel(at, (d) => clockTime(d, clock))}</div>;
}

/** The chat that's going on now in this list: a reply into an earlier one says when that was. */
const LatestChat = createContext<string | null>(null);

/**
 * Where a new chat starts, after a quiet break: a line with its date. Clicking it offers
 * "Continue this chat", a reply to that chat's last message, which brings it back for the agent.
 */
function ChatDivider({ at, chat, messages }: { at: string; chat: string; messages: Message[] }) {
  const { clock } = usePrefs();
  const names = useNames();
  const meId = useStore((s) => s.me?.user.id);
  const latest = useContext(LatestChat);
  const label = stampLabel(at, (d) => clockTime(d, clock));
  const last = [...messages].reverse().find((m) => m.conversationId === chat && m.author.id !== "system" && !m.deletedAt);
  const items =
    last && chat !== latest
      ? [
          {
            label: "Continue this chat",
            icon: <CornerUpLeft size={15} />,
            onSelect: () => {
              const name = last.author.kind === "user" && last.author.id === meId ? "you" : last.author.kind === "agent" ? (names.agent(last.author.id)?.name ?? "agent") : (names.member(last.author.id)?.name ?? "Someone");
              startReply(last, `${name} · ${stampLabel(last.createdAt, (d) => clockTime(d, clock))}`);
            },
          },
        ]
      : [];
  return (
    <div className="flex items-center gap-3 px-5 pt-4 pb-2 text-[12px] font-medium text-muted" role={items.length ? undefined : "separator"} aria-label={items.length ? undefined : `New chat, ${label}`}>
      <span className="h-px flex-1 bg-line" aria-hidden />
      {items.length ? (
        <Menu
          items={items}
          trigger={(open, toggle) => (
            <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={`Chat from ${label}`} className={cx("-mx-2 rounded-md px-2 py-1 hover:text-ink", open && "text-ink")}>
              {label}
            </button>
          )}
        />
      ) : (
        <span>{label}</span>
      )}
      <span className="h-px flex-1 bg-line" aria-hidden />
    </div>
  );
}

/** What a brand-new chat says: who you're talking to, or how to get a team going. */
function ChannelIntro({ channel, onAddAgent, onMembers }: { channel: ChannelInfo; onAddAgent: () => void; onMembers: () => void }) {
  const names = useNames();
  const invite = useFeature("invite");
  const canManage = useStore((s) => s.me?.role !== "guest") && !channel.archivedAt;
  if (channel.kind === "dm") {
    const a = names.agent(channel.name.split(":").pop()!);
    return (
      <div className="px-8 pb-6 pt-10 flex flex-col items-center text-center">
        <AgentAvatar agent={a} size={72} live />
        <h2 className="mt-3 t-title">{a?.name}</h2>
      </div>
    );
  }
  const cards: { icon: React.ReactNode; title: string; onClick: () => void }[] = [
    ...(canManage ? [{ icon: <Bot size={18} />, title: "Add agent", onClick: onAddAgent }] : []),
    ...(!channel.archivedAt ? [{ icon: <Paperclip size={18} />, title: "Add files", onClick: () => window.dispatchEvent(new CustomEvent(COMPOSER_ATTACH, { detail: channel.id })) }] : []),
    ...(invite && canManage ? [{ icon: <UserPlus size={18} />, title: "Invite people", onClick: onMembers }] : []),
  ];
  return (
    <div className="px-6 pb-6 pt-8 flex flex-col items-center text-center">
      <ChatAvatar chat={{ kind: "team", agent: null, channel }} size={64} />
      <h2 className="mt-3 t-title">{channel.name}</h2>
      {channel.topic && <p className="mt-1 max-w-sm text-body text-muted">{channel.topic}</p>}
      {cards.length > 0 && (
        <div className="mt-5 w-full max-w-xs overflow-hidden rounded-[12px] bg-card divide-y divide-line text-left">
          {cards.map((c) => (
            <button key={c.title} type="button" onClick={c.onClick} className="flex h-[46px] w-full items-center gap-3 px-3.5 text-left hover:bg-hover">
              <span className="shrink-0 text-muted">{c.icon}</span>
              <span className="min-w-0 flex-1 text-body font-medium">{c.title}</span>
              <ChevronRight size={15} className="shrink-0 text-faint" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Add files" on a new channel's intro asks the composer to open its file picker. */
const COMPOSER_ATTACH = "wisp:composer-attach";
/** A reply started from a message asks that conversation's composer to take focus. */
const COMPOSER_FOCUS = "wisp:composer-focus";

/** Scroll to a message that's on screen and flash it; false when it isn't loaded. */
function flashMessage(id: string): boolean {
  const el = Array.from(document.querySelectorAll<HTMLElement>("[data-message-id]")).find((x) => x.dataset.messageId === id);
  if (!el) return false;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.add("bg-accent-soft");
  setTimeout(() => el.classList.remove("bg-accent-soft"), 1600);
  return true;
}

/** Show where an earlier chat starts: its first message still on screen, or the chat opened at its first message. */
function openChat(channelId: string, chat: string) {
  const first = Array.from(document.querySelectorAll<HTMLElement>("[data-chat]")).find((x) => x.dataset.chat === chat)?.dataset.messageId;
  if (!flashMessage(first ?? chat)) go({ view: "chat", channelId, threadId: null, messageId: chat });
}

/** Press-and-hold and swipe both listen to the same touches. */
function mergeTouch(a: Partial<Record<"onTouchStart" | "onTouchMove" | "onTouchEnd" | "onTouchCancel", (e: React.TouchEvent) => void>>, b: typeof a) {
  const both = (k: keyof typeof a) => (e: React.TouchEvent) => {
    a[k]?.(e);
    b[k]?.(e);
  };
  return { onTouchStart: both("onTouchStart"), onTouchMove: both("onTouchMove"), onTouchEnd: both("onTouchEnd"), onTouchCancel: both("onTouchCancel") };
}

// --- one message --------------------------------------------------------------------------------

/** A hand-off, a note from Bubble AI, or a person's or agent's message. */
function MessageItem(props: { m: Message; grouped?: boolean; last?: boolean; replies?: number; onReplies?: () => void; inThread?: boolean; composerThread?: string; working?: LiveRun[] }) {
  return props.m.author.id === "system" ? <SystemItem {...props} /> : <PersonMessage {...props} />;
}

function SystemItem({ m, replies, onReplies, working = [] }: { m: Message; replies?: number; onReplies?: () => void; working?: LiveRun[] }) {
  const task = m.parts.find((p) => p.type === "task");
  // a step Bubble AI handed out: a row that opens the work in its own sub-thread
  if (task && task.type === "task") return <HandoffRow m={m} taskId={task.taskId} replies={replies} working={working} onOpen={onReplies} />;
  if (m.parts.some((p) => p.type === "status" && p.text === SCHEDULE_MARK)) return <ScheduleRow m={m} replies={replies} onReplies={onReplies} />;
  return (
    <div className="px-5 py-1.5 text-xs text-muted flex items-center gap-2" data-message-id={m.id}>
      <span className="h-px flex-1 bg-line" />
      {m.parts.map((p, i) => (p.type === "status" || p.type === "notice") && <span key={i}>{p.text}</span>)}
      {m.parts.map((p, i) => p.type === "status" && p.link?.href.startsWith("#/") && <a key={`l${i}`} href={p.link.href} className="shrink-0 whitespace-nowrap underline underline-offset-2 hover:text-ink">{p.link.label}</a>)}
      {m.body && <span className="text-center">{m.body.replace(/\*\*/g, "")}</span>}
      {m.parts.map((p) => p.type === "routine" && <RoutineChip key={p.routineId} id={p.routineId} />)}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** The message that opens a scheduled run: what the team was asked, and how far it's got. */
function ScheduleRow({ m, replies, onReplies }: { m: Message; replies?: number; onReplies?: () => void }) {
  return (
    <div className="flex gap-3 px-5 py-2" data-message-id={m.id}>
      <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-chip text-muted">
        <Clock size={16} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13.5px] font-semibold">Schedule</span>
          <span className="text-xs text-muted">{new Date(m.createdAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>
        </div>
        <div className="mt-0.5 text-body">{m.body}</div>
        <FlowStrip channelId={m.channelId} threadId={m.id} />
        {onReplies && (
          <button type="button" onClick={onReplies} className="mt-1 text-[14px] text-muted hover:text-ink">
            {replies ? `${replies} ${replies === 1 ? "reply" : "replies"}` : "Open the thread"}
          </button>
        )}
      </div>
    </div>
  );
}

function useTask(id: string): TaskRow | null {
  const version = useStore((s) => s.tasksVersion);
  const [task, setTask] = useState<TaskRow | null>(null);
  useEffect(() => {
    const key = String(version);
    let p = taskCache.get(key);
    if (!p) {
      taskCache.clear();
      taskCache.set(key, (p = api<TaskRow[]>("GET", "/api/tasks").catch(() => [])));
    }
    let live = true;
    p.then((list) => live && setTask(list.find((t) => t.id === id) ?? null));
    return () => {
      live = false;
    };
  }, [id, version]);
  return task;
}

/** "› Handed to Pappy · 4 replies · Working": opens the hand-off's own thread. */
function HandoffRow({ m, taskId, replies, working, onOpen }: { m: Message; taskId: string; replies?: number; working: LiveRun[]; onOpen?: () => void }) {
  const task = useTask(taskId);
  const agents = useStore((s) => s.agents);
  const agent = task?.toAgentId ? agents.find((a) => a.id === task.toAgentId) : undefined;
  const st = task ? taskState(task) : null;
  const busy = working.length > 0;
  const state = busy ? "Working" : st?.label;
  return (
    <div className="px-3 md:px-5 pl-[3.25rem] md:pl-[4.25rem] py-1" data-message-id={m.id}>
      <button
        onClick={onOpen}
        title={task?.title}
        className="inline-flex max-w-full items-center gap-2 h-9 rounded-[8px] border border-control-line bg-control pl-3 pr-3.5 text-[14px] hover:bg-hover"
      >
        <ChevronRight size={14} className="shrink-0 text-muted" />
        <span className="truncate">
          Handed to <b className="font-medium">{agent?.name ?? m.body.match(/^@([\w-]+)/)?.[1] ?? "an agent"}</b>
        </span>
        {!!replies && <span className="shrink-0 text-muted">· {replies} {replies === 1 ? "reply" : "replies"}</span>}
        {state && (
          <span className={cx("shrink-0 inline-flex items-center gap-1", st?.tone === "bad" ? "text-bad" : st?.tone === "ok" ? "text-ok" : "text-muted")}>
            · {busy && <span className="size-1.5 rounded-full bg-st-working animate-pulse" aria-hidden />}
            {state}
          </span>
        )}
      </button>
    </div>
  );
}

function PersonMessage({ m, grouped, last = true, replies, onReplies, inThread, composerThread, working = [] }: { m: Message; grouped?: boolean; last?: boolean; replies?: number; onReplies?: () => void; inThread?: boolean; composerThread?: string; working?: LiveRun[] }) {
  const { clock } = usePrefs();
  const names = useNames();
  const handles = useHandleNames();
  const colors = useHandleColors();
  const rendered = useMemo(() => (m.body ? renderMessage(m.body, { handles, colors }) : ""), [m.body, handles, colors]);
  // a first chat's hello types in once and underlines what it already knows
  const html = useFirstHelloHtml(m, rendered);
  const cards = useMemo(() => linkCards(m.body), [m.body]);
  const previews = useMemo(() => linkPreviews(m.body), [m.body]);
  const isSummary = m.parts.some((p) => p.type === "summary");
  const [menu, setMenu] = useState<{ at: { x: number; y: number } | null } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const colRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const agent = m.author.kind === "agent" ? names.agent(m.author.id) : undefined;
  const name = agent ? agent.name : (names.member(m.author.id)?.name ?? "Someone");
  const time = clockTime(m.createdAt, clock);
  const solo = useContext(SoloAgent);
  const arrived = useContext(FreshMessages).has(m.id);
  // the DM's own agent already lives in the pill above: no ghost or name on its messages
  const home = !!agent && agent.id === solo;
  const pinned = useStore((s) => !!s.channels.find((c) => c.id === m.channelId)?.pinnedIds.includes(m.id));
  // like Messages: what you wrote sits on the right in your own color, with no name or picture
  const meId = useStore((s) => s.me?.user.id);
  const mine = m.author.kind === "user" && m.author.id === meId;
  const startsAt = composerThread ?? undefined;
  // a reply into an earlier chat says which one, in the bar above the message box
  const latest = useContext(LatestChat);
  const earlier = !!m.conversationId && !!latest && m.conversationId !== latest;
  const toggleReaction = useStore((s) => s.toggleReaction);
  const actions = useMessageActionList(m, {
    onReply: () => startReply(m, earlier ? `${mine ? "you" : name} · ${stampLabel(m.createdAt, (d) => clockTime(d, clock))}` : name, startsAt),
    // a message already in a thread opens a sub-thread; the thread's own first message has nowhere deeper to go
    onThread: onReplies,
    onEdit: () => setEditing(true),
    onDelete: () => setDeleting(true),
  });
  const press = useLongPress(() => setMenu({ at: null }), !m.deletedAt && actions.length > 0);
  const swipe = useSwipeToThread(!m.deletedAt ? onReplies : undefined);
  const touch = mergeTouch(press, swipe.handlers);
  const canReact = !m.deletedAt && actions.some((a) => a.id === "reply");
  const reacted = (m.reactions ?? []).filter((r) => r.actors.some((a) => a.kind === "user" && a.id === meId)).map((r) => r.emoji);
  const react = (emoji: string) => void toggleReaction(m.id, emoji).catch((e) => alert((e as Error).message));
  const openMenu = (at: { x: number; y: number } | null) => !m.deletedAt && actions.length > 0 && setMenu({ at });
  const hasChange = m.parts.some((p) => p.type === "change");
  const quote = m.replyTo;
  // a message that is only a link shows just its card, like Messages
  const onlyLink = previews.length === 1 && !quote && m.body.trim() === previews[0].url;
  const showBubble = !m.deletedAt && (!!html || !!quote) && !hasChange && !onlyLink;
  const showAvatar = !mine && !home;

  return (
    <div
      data-message-id={m.id}
      data-chat={m.conversationId}
      {...touch}
      onContextMenu={(e) => {
        press.onContextMenu?.(e);
        if (e.defaultPrevented || window.matchMedia("(hover: none)").matches) return;
        // text you selected in it keeps the browser's own menu, for copying a part
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) return;
        e.preventDefault();
        openMenu({ x: e.clientX, y: e.clientY });
      }}
      onWheel={swipe.handlers.onWheel}
      className={cx("msg-press relative px-3 md:px-5 flex items-end gap-2 rounded-lg transition-colors", mine ? "justify-end" : "justify-start", last ? "pb-1.5" : "pb-[3px]", !grouped && "pt-2.5", m.reactions?.some((r) => r.actors.length) && "pt-3.5")}
    >
      {showAvatar && (
        <div className="w-8 shrink-0 self-end">
          {last &&
            (agent ? (
              <button onClick={() => go({ view: "agents", agentId: agent.id, tab: "overview" })} aria-label={`Open ${agent.name}`}>
                <AgentAvatar agent={agent} size={32} />
              </button>
            ) : (
              <UserAvatar name={name} size={32} />
            ))}
        </div>
      )}
      <div
        ref={colRef}
        tabIndex={m.deletedAt ? undefined : 0}
        aria-haspopup={m.deletedAt ? undefined : "menu"}
        aria-label={m.deletedAt ? undefined : `${mine ? "You" : name}: ${snippetOf(m) || "message"}. Press Enter for actions.`}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " " || e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault();
            openMenu(null);
          }
        }}
        data-dragging={swipe.dragging}
        style={swipe.dx ? { transform: `translateX(${swipe.dx}px)` } : undefined}
        className={cx("m-swipe relative min-w-0 flex flex-col max-w-[84%] md:max-w-[680px] rounded-[18px] outline-none focus-visible:ring-2 focus-visible:ring-ring touch-pan-y", mine ? "items-end" : "items-start")}
      >
        {swipe.dx > 0 && (
          <span
            aria-hidden
            className={cx("absolute -left-10 top-1/2 -mt-3.5 size-7 rounded-full grid place-items-center transition-colors", swipe.dx >= SWIPE_ARM ? "bg-accent text-accent-ink" : "bg-chip text-muted")}
            style={{ opacity: Math.min(swipe.dx / SWIPE_ARM, 1), transform: `scale(${0.6 + 0.4 * Math.min(swipe.dx / SWIPE_ARM, 1)})` }}
          >
            <MessageSquare size={14} />
          </span>
        )}
        {!grouped && !home && !mine && (
          <div className="px-3.5 pb-0.5 text-[12px] text-muted flex items-center gap-1.5">
            {name}
            {pinned && <Pin size={11} aria-label="Pinned" />}
          </div>
        )}
        {mine && pinned && (
          <span className="text-[11px] text-muted inline-flex items-center gap-0.5 mb-0.5 mr-1">
            <Pin size={11} /> Pinned
          </span>
        )}
        {!m.deletedAt && m.parts.some((p) => p.type === "checkback") && (
          <CheckbackLabel
            from={m.context ? chatName(m.context.at, (d) => clockTime(d, clock)) : undefined}
            onFrom={m.context ? () => openChat(m.channelId, m.context!.conversationId) : undefined}
          />
        )}
        {!m.deletedAt && <AppleReadLines parts={m.parts} />}
        {m.deletedAt ? (
          <div className="bubble them text-body text-muted italic">This message was deleted.</div>
        ) : (
          showBubble && (
            <div ref={bubbleRef} className={cx("bubble relative text-[15px] md:text-[16px]", mine ? "me" : "them", last && !previews.length && "tail", arrived && (mine ? "m-bubble-me" : "m-bubble-them"))} title={time}>
              {!!m.reactions?.length && <ReactionBadges reactions={m.reactions} meId={meId} mine={mine} onToggle={react} />}
              {quote && (
                <button
                  type="button"
                  className="quote"
                  onClick={() => {
                    if (!flashMessage(quote.id)) go({ view: "chat", channelId: m.channelId, threadId: m.threadId, messageId: quote.id });
                  }}
                  aria-label="Go to the message this replies to"
                >
                  <b className="block font-medium">
                    {quote.author.kind === "user" && quote.author.id === meId ? "You" : (quote.author.kind === "agent" ? names.agent(quote.author.id)?.name : names.member(quote.author.id)?.name) ?? "Someone"}
                    {/* from an earlier chat: when it was said */}
                    {quote.createdAt && quote.conversationId && m.conversationId && quote.conversationId !== m.conversationId && <span className="font-normal opacity-80"> · {stampLabel(quote.createdAt, (d) => clockTime(d, clock))}</span>}
                  </b>
                  <span className="line-clamp-2">{quote.deleted ? "This message was deleted." : quote.snippet}</span>
                </button>
              )}
              {isSummary ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted">Summary of the conversation</summary>
                  <div className="prose-w mt-2" dangerouslySetInnerHTML={{ __html: html }} />
                </details>
              ) : (
                html && <div className="prose-w" dangerouslySetInnerHTML={{ __html: m.editedAt ? withEditedMark(html, clockTime(m.editedAt, clock)) : html }} />
              )}
            </div>
          )
        )}
        {!m.deletedAt &&
          cards.map((c) => (
            <a key={c.url} href={c.url} target="_blank" rel="noreferrer" className="mt-1 flex w-full max-w-sm items-center gap-3 rounded-3xl bg-card px-3.5 py-2.5 hover:bg-hover">
              <span className="size-9 rounded-[8px] bg-chip grid place-items-center text-muted">{c.kind === "PR" ? <GitPullRequest size={16} /> : <CircleDot size={16} />}</span>
              <span className="min-w-0">
                <span className="block text-[11px] text-muted">GitHub · {c.kind === "PR" ? "Pull request" : "Issue"}</span>
                <span className="block text-sm font-medium truncate">
                  {c.repo} #{c.num}
                </span>
              </span>
            </a>
          ))}
        {!m.deletedAt && previews.map((p) => <LinkCard key={p.url} preview={p} mine={mine} />)}
        {!m.deletedAt && (
          <CardAuthor.Provider value={m.author.kind === "agent" ? { agentId: m.author.id, channelId: m.channelId, threadId: m.threadId } : null}>
            <Parts parts={m.parts} body={m.body} agentName={agent?.name} agentId={agent?.id} />
          </CardAuthor.Provider>
        )}
        {!m.deletedAt && <LoopParts m={m} arrived={arrived} />}
        {(!!replies || working.length > 0) && onReplies && !inThread && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {!!replies && (
              <button onClick={onReplies} className="h-8 px-3 rounded-[8px] border border-control-line bg-control text-[14px] hover:bg-hover inline-flex items-center gap-1.5">
                <MessageSquare size={13} /> {replies} {replies === 1 ? "reply" : "replies"} <ChevronRight size={13} className="text-muted" />
              </button>
            )}
            {working.length > 0 && <ThreadWork runs={working} threadId={m.id} onClick={onReplies} />}
          </div>
        )}
        {(!!replies || working.length > 0) && onReplies && inThread && (
          <button onClick={onReplies} className="mt-1 h-8 px-3 rounded-[8px] border border-control-line bg-control text-[14px] hover:bg-hover inline-flex items-center gap-1.5">
            <MessageSquare size={13} /> {replies ? `${replies} ${replies === 1 ? "reply" : "replies"}` : "Working"} <ChevronRight size={13} className="text-muted" />
          </button>
        )}
      </div>
      {menu && (
        <MessageMenu
          actions={actions}
          reacted={reacted}
          onReact={canReact ? react : undefined}
          at={menu.at}
          mine={mine}
          source={bubbleRef.current ?? colRef.current}
          preview={
            bubbleRef.current ? (
              <div className={cx("bubble !max-w-none text-[15px] md:text-[16px]", mine ? "me" : "them")}>
                <div className="prose-w line-clamp-[12]" dangerouslySetInnerHTML={{ __html: html || "&nbsp;" }} />
              </div>
            ) : undefined
          }
          onClose={() => setMenu(null)}
        />
      )}
      {editing && <EditMessageDialog m={m} onClose={() => setEditing(false)} />}
      {deleting && <DeleteMessageDialog m={m} onClose={() => setDeleting(false)} />}
    </div>
  );
}

/** "(edited)" at the end of the last paragraph, like Slack, rather than on a line of its own. */
function withEditedMark(html: string, at: string) {
  const mark = `<span class="text-[11px] opacity-60" title="Edited ${at}"> (edited)</span>`;
  const t = html.trimEnd();
  return t.endsWith("</p>") ? t.slice(0, -4) + mark + "</p>" : t + mark;
}

/** GitHub PR and issue links get a small card, like Buzz. Parsed locally; nothing is fetched. */
/** A large link card: the picture on top when the link is one, then the title and the domain. */
function LinkCard({ preview, mine }: { preview: LinkPreview; mine: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <a href={preview.url} target="_blank" rel="noreferrer" className={cx("link-card mt-1 flex w-[320px] max-w-full flex-col overflow-hidden rounded-[18px] bg-[var(--bubble-them)] outline-none transition-[filter] duration-150 hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring dark:hover:brightness-110", mine && "self-end")}>
      {preview.image && !broken ? (
        <img src={preview.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="aspect-[16/10] w-full bg-chip object-cover" />
      ) : (
        <span aria-hidden className="grid aspect-[16/7] w-full place-items-center bg-chip text-muted">
          <Globe size={30} strokeWidth={1.4} />
        </span>
      )}
      <span className="flex flex-col gap-0.5 px-3.5 pb-2.5 pt-2">
        <span className="line-clamp-2 text-[15px] font-semibold leading-5 text-ink">{preview.title}</span>
        <span className="truncate text-[13px] text-muted">{preview.domain}</span>
      </span>
    </a>
  );
}

function linkCards(body: string) {
  const out: { url: string; repo: string; num: string; kind: "PR" | "Issue" }[] = [];
  for (const m of body.matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)/g)) {
    if (!out.some((c) => c.url === m[0])) out.push({ url: m[0], repo: m[1], num: m[3], kind: m[2] === "pull" ? "PR" : "Issue" });
  }
  return out.slice(0, 3);
}

function Parts({ parts, body = "", agentName, agentId }: { parts: MessagePart[]; body?: string; agentName?: string; agentId?: string }) {
  const tools = parts.filter((p) => p.type === "tool_call");
  const files = parts.filter((p) => p.type === "file");
  const status = parts.filter((p) => p.type === "status");
  const { toolCalls } = usePrefs();
  const [open, setOpen] = useState(toolCalls === "expanded");
  const summary = useMemo(() => workSummary(tools.flatMap((t) => (t.type === "tool_call" ? [{ name: t.name, input: t.input }] : []))), [parts]); // eslint-disable-line react-hooks/exhaustive-deps
  // a failed run says so in one quiet line; why it failed opens from that line
  const failed = parts.some((p) => p.type === "run_failed");
  const why = status.flatMap((p) => (p.type === "status" && p.text !== "Voice message" ? [p.text.replace(/`/g, "")] : [])).join("\n");
  // what it did (tools, what it saved to memory, the skills it learned or used) folds into one line
  const saved = savedMemories(tools);
  const shown = toolCalls === "hidden" ? [] : tools;
  const did = (toolCalls === "hidden" ? saved.length : tools.length) + parts.filter((p) => p.type === "skill").length;
  return (
    <>
      {parts.map((p) => p.type === "discussion" && <DiscussionCard key={p.discussionId} id={p.discussionId} />)}
      {parts.map((p, i) => p.type === "computer" && <ComputerPart key={`c${i}`} computerId={p.computerId} request={p.request} agentName={agentName} />)}
      {parts.map((p) => p.type === "approval" && <ApprovalCard key={p.approvalId} id={p.approvalId} />)}
      {parts.map((p) => p.type === "routine" && <RoutineChip key={p.routineId} id={p.routineId} />)}
      {parts.map((p) => p.type === "task" && <TaskChip key={p.taskId} id={p.taskId} />)}
      {parts.map((p, i) => p.type === "context" && <ContextCard key={`x${i}`} usage={p.usage} />)}
      {parts.map((p) => p.type === "change" && <ChangeCard key={p.changeId} id={p.changeId} fallback={body} />)}
      {parts.map((p, i) => p.type === "notice" && <div key={`n${i}`} className="mt-1 px-1 text-xs text-muted whitespace-pre-wrap">{p.text}</div>)}
      {files.length > 0 && (
        <div className="mt-1 flex flex-wrap items-start gap-2">
          {files.map((f) => f.type === "file" && <FileChip key={f.fileId} id={f.fileId} name={f.name} />)}
        </div>
      )}
      {status.map(
        (s, i) =>
          s.type === "status" &&
          (s.text === "Voice message" || !failed) &&
          // a run you stopped didn't fail: it says so quietly
          (s.text === "Run failed: cancelled" ? (
            <div key={i} className="mt-1 px-1 text-[14px] text-muted">Stopped.</div>
          ) : (
            <div key={i} className={cx("mt-1 px-1", s.text === "Voice message" ? "text-[11px] text-faint inline-flex items-center gap-1" : "text-sm text-bad")}>{s.text === "Voice message" && <Mic size={11} />}{s.text.replace(/`/g, "")}</div>
          )),
      )}
      {parts.map((p) => p.type === "run_failed" && <RunFailedActions key={p.runId} part={p} agentId={agentId} detail={why} />)}
      {did > 0 && (
        <div className="mt-1 w-full max-w-md">
          <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1 rounded-md px-1 text-xs leading-5 text-muted hover:text-ink">
            {didThings(did)}
            <ChevronRight size={12} className={cx("shrink-0", open && "rotate-90")} aria-hidden />
          </button>
          {open && (
            <>
              <SkillLines parts={parts} />
              <Remembered saved={saved} />
              {shown.length > 0 && (
                <div className="mt-1.5 overflow-hidden rounded-[12px] bg-card divide-y divide-line">
                  {/* one line of what it did, like "Searched the web · read 6 pages"; then each tool call */}
                  <div className="px-4 py-2 text-[14px] font-medium text-muted">{summary}</div>
                  {shown.map(
                    (t, i) =>
                      t.type === "tool_call" && (
                        <details key={i} className="text-xs">
                          <summary className="px-4 py-2 cursor-pointer text-[14px]">{toolLine(t.name, t.input)}</summary>
                          <pre className="px-4 pb-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-muted">
                            {JSON.stringify(t.input, null, 2)}
                            {t.output !== undefined && `\n→ ${typeof t.output === "string" ? t.output : JSON.stringify(t.output, null, 2)}`}
                          </pre>
                        </details>
                      ),
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

/** What the agent learned or followed in this reply: one quiet line each ("Learned: order-pizza", "Using order-pizza") that opens the skill. */
export function SkillLines({ parts }: { parts: MessagePart[] }) {
  const lines = parts.flatMap((p) => (p.type === "skill" ? [p] : [])).sort((a, b) => Number(a.action !== "learned") - Number(b.action !== "learned"));
  if (!lines.length) return null;
  return (
    <>
      {lines.map((p) => (
        <a
          key={`${p.action}:${p.skillId}`}
          href={href({ view: "settings", page: "skills", item: p.skillId })}
          className={cx("m-work mt-1 flex w-fit max-w-full items-center gap-1.5 px-1 text-xs hover:underline", p.action === "learned" ? "font-medium text-ink" : "text-muted")}
        >
          <Book size={12} strokeWidth={2} aria-hidden className={cx("shrink-0", p.action === "learned" ? "text-badge" : "text-muted")} />
          <span className="truncate">{p.action === "learned" ? `Learned: ${p.slug}` : `Using ${p.slug}`}</span>
        </a>
      ))}
    </>
  );
}

const prettyTool = (n: string) => n.replace(/^mcp__(?:wisp|warren)__/, "").replace(/^mcp__/, "").replace(/^(?:wisp|warren)\./, "");

/** What the agent saved to memory during this reply: the tool calls that did save, with where each landed. */
function savedMemories(tools: MessagePart[]): { kind: string; text: string; path: string | null }[] {
  return tools.flatMap((t) => {
    if (t.type !== "tool_call" || prettyTool(t.name) !== "memory_remember") return [];
    const out = typeof t.output === "string" ? t.output : JSON.stringify(t.output ?? "");
    if (/Not saved|Error/i.test(out)) return [];
    const input = (t.input ?? {}) as { kind?: string; text?: string; status?: string };
    const path = out.match(/(people\/[^\s"\\]+?\.md)/)?.[1] ?? null;
    const text = input.text ?? (input.status ? `marked a plan ${input.status}` : "updated a memory");
    return [{ kind: input.kind ?? "", text, path }];
  });
}

/** What the agent saved about someone during this reply, so you can see (and fix) it right where it happened. */
function Remembered({ saved }: { saved: ReturnType<typeof savedMemories> }) {
  if (!saved.length) return null;
  return (
    <>
      {saved.map((r, i) => (
        <a key={i} href={r.path ? `#/vault/${r.path}` : "#/about"} className="m-work mt-1 flex w-fit max-w-full items-center gap-1.5 px-1 text-xs text-muted hover:underline">
          <Brain size={12} strokeWidth={2} aria-hidden className="shrink-0" />
          <span className="truncate">Remembered: {r.text}</span>
        </a>
      ))}
    </>
  );
}

/**
 * A file in a message. Text, images and PDFs open in a preview (with Download); anything else
 * downloads, and the chip says so while it does.
 */
function FileChip({ id, name }: { id: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState<"busy" | "done" | "failed" | null>(null);
  const kind = fileKind(name);
  useEffect(() => {
    if (kind !== "image") return;
    let u: string | null = null;
    fileUrl(id).then((x) => setUrl((u = x)), () => {});
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [id, kind]);
  useEffect(() => {
    if (saving !== "done" && saving !== "failed") return;
    const t = setTimeout(() => setSaving(null), 2500);
    return () => clearTimeout(t);
  }, [saving]);
  const open = async () => {
    if (kind !== "other") return setPreview(true);
    if (saving === "busy") return;
    setSaving("busy");
    try {
      await downloadFile(id, name);
      setSaving("done");
    } catch {
      setSaving("failed");
    }
  };
  const dialog = preview && <FilePreview id={id} name={name} onClose={() => setPreview(false)} />;
  if (kind === "image" && url)
    return (
      <>
        <img src={url} alt={name} onClick={() => setPreview(true)} className="max-h-64 max-w-full rounded-3xl cursor-pointer" />
        {dialog}
      </>
    );
  return (
    <>
      <button onClick={() => void open()} aria-busy={saving === "busy"} className="flex items-center gap-2.5 rounded-2xl bg-card px-3.5 py-2.5 text-sm hover:bg-hover">
        {saving === "busy" ? <Loader2 size={16} className="text-muted animate-spin" /> : saving === "done" ? <Check size={16} className="text-ok" /> : <FileText size={16} className="text-muted" />} {name}
        {saving && saving !== "busy" && <span className="text-muted" role="status">{saving === "done" ? "· Downloaded" : "· Couldn't download"}</span>}
      </button>
      {dialog}
    </>
  );
}

/**
 * An agent's reply as it streams in, before it's posted: its words so far. What it's doing shows
 * once, in the activity pill above the composer (with Stop), not again here.
 */
function StreamingItem({ run }: { run: LiveRun }) {
  const names = useNames();
  const handles = useHandleNames();
  const colors = useHandleColors();
  const agent = names.agent(run.agentId);
  const html = useMemo(() => (run.text ? renderMarkdown(run.text, { handles, colors }) : ""), [run.text, handles, colors]);
  const computerId = agent?.computerId;
  const home = useContext(SoloAgent) === run.agentId;
  const screen = run.usedComputer && !!computerId;
  if (!html && !screen) return null;
  return (
    <div className="px-3 md:px-5 pt-1 pb-1.5 flex items-end gap-2">
      {!home && (
        <div className="w-8 shrink-0 self-end">
          <AgentAvatar agent={agent} size={32} live />
        </div>
      )}
      <div className="min-w-0 flex flex-col items-start gap-[3px] max-w-[84%] md:max-w-[680px]">
        {!home && <div className="px-3.5 pb-0.5 text-[12px] text-muted">{agent?.name ?? "Agent"}</div>}
        {html && <div className="bubble them text-[15px] md:text-[16px]"><div className="prose-w" dangerouslySetInnerHTML={{ __html: html }} /></div>}
        {screen && <ComputerPart computerId={computerId} />}
      </div>
    </div>
  );
}

// --- thread -------------------------------------------------------------------------------------

function ThreadPanel({ channelId, rootId, agentId, messageId }: { channelId: string; rootId: string; agentId?: string; messageId?: string }) {
  const root = useStore((s) => s.messages[channelId]?.find((m) => m.id === rootId) ?? s.roots[rootId] ?? Object.values(s.threads).flat().find((m) => m.id === rootId));
  const removed = useStore((s) => s.removedRoots[rootId]);
  const replies = useStore((s) => s.threads[rootId]);
  const replyCounts = useStore((s) => s.replyCounts);
  const loadThread = useStore((s) => s.loadThread);
  const ref = useRef<HTMLDivElement>(null);
  const history = useMessageHistory(channelId, rootId, messageId, ref, replies);
  const fresh = useFreshIds(rootId, replies);
  // the hub sends a thread's root with its replies, so a thread that finished loading with neither isn't there
  const loadingThread = useStore((s) => s.loadingMessages[conversationKey(channelId, rootId)]);
  const gone = !root && !removed && !!replies && replies.length === 0 && !loadingThread && !history.error;
  // what's being written in this thread re-renders it word by word; work further down only as it starts and stops
  const streaming = useLiveRuns((r) => r.channelId === channelId && r.threadId === rootId);
  const shape = useStore(liveShape);
  const below = useMemo(() => Object.values(shape).filter((r) => r.channelId === channelId && r.threadPath.includes(rootId)), [shape, channelId, rootId]);
  const working = useWorkingByThread(channelId, rootId);
  // where each reply sits among its neighbours: worked out when the replies change, not for every word written below
  const places = useMemo(
    () =>
      (replies ?? []).map((m, i, all) => {
        const stamp = needsStamp(all[i - 1], m);
        const next = all[i + 1];
        return { stamp: stamp && i > 0, grouped: !stamp && isGrouped(all[i - 1], m), last: !next || needsStamp(m, next) || !isGrouped(m, next) };
      }),
    [replies],
  );

  useEffect(() => {
    void loadThread(channelId, rootId).catch(() => {});
  }, [channelId, rootId, loadThread]);
  useLayoutEffect(() => {
    if (history.prepended.current) { history.prepended.current = false; return; }
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [replies?.length, streaming.map((r) => `${r.runId}${r.text.length}${r.last?.name ?? ""}`).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => go({ view: "chat", channelId, threadId: null });
  // a sub-thread goes back to the thread it branched off from
  const parent = root?.threadId ?? null;
  const open = (id: string) => go({ view: "chat", channelId, threadId: id });
  const handoff = root?.author.id === "system" ? root.parts.find((p) => p.type === "task") : undefined;
  return (
    <RightPane label={parent ? "Sub-thread" : handoff ? "Hand-off" : "Thread"} className="!bg-panel">
      {handoff && handoff.type === "task" ? (
        <HandoffHeader taskId={handoff.taskId} runs={[...streaming, ...below]} parent={parent} onBack={parent ? () => open(parent) : close} onClose={close} />
      ) : (
        <ThreadHeader channelId={channelId} parent={parent} onBack={parent ? () => open(parent) : close} onClose={close} />
      )}
      {!parent && <FlowStrip channelId={channelId} threadId={rootId} />}
      <div ref={ref} className="flex-1 overflow-y-auto overscroll-x-none py-3">
        {history.controls}
        {removed && <p role="status" className="px-5 py-2 text-xs text-muted">This message was deleted.</p>}
        {gone && <p role="status" className="px-5 py-6 text-sm text-muted text-center">This thread isn't here any more.</p>}
        {!removed && root && (handoff && handoff.type === "task" ? <HandoffBrief m={root} taskId={handoff.taskId} /> : <ThreadRoot m={root} composerThread={rootId} />)}
        {!gone && (
          <div className="flex items-center gap-3 px-5 py-2 text-[14px] text-muted">
            {history.error ? "" : replies ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : "Loading…"}
            <span className="h-px flex-1 bg-line" />
          </div>
        )}
        <FreshMessages.Provider value={fresh}>
        {replies?.map((m, i) => (
          <ThreadRow key={m.id} m={m} channelId={channelId} rootId={rootId} stamp={places[i].stamp} grouped={places[i].grouped} last={places[i].last} replies={replyCounts[m.id]} working={working.get(m.id) ?? NO_RUNS} />
        ))}
        </FreshMessages.Provider>
        {streaming.map((r) => (
          <StreamingItem key={r.runId} run={r} />
        ))}
      </div>
      {!removed && !gone && <Composer channelId={channelId} threadId={rootId} agentId={agentId} placeholder={handoff && handoff.type === "task" ? "Reply…" : "Reply…"} />}
    </RightPane>
  );
}

function ThreadHeader({ channelId, parent, onBack, onClose }: { channelId: string; parent: string | null; onBack: () => void; onClose: () => void }) {
  const channel = useStore((s) => s.channels.find((c) => c.id === channelId));
  return (
    <header className="h-[4.5rem] shrink-0 px-3 flex items-center gap-2 border-b border-line safe-top box-content">
      <span className={cx(!parent && "lg:hidden")}>
        <button onClick={onBack} className="circle circle-sm" aria-label={parent ? "Back to the thread it came from" : "Back"} title={parent ? "Back to the thread it came from" : undefined}>
          <ChevronLeft size={20} />
        </button>
      </span>
      <div className="min-w-0 flex-1 px-1">
        <div className="truncate text-body font-medium leading-tight">{parent ? "Sub-thread" : "Thread"}</div>
        {channel && <div className="truncate text-[14px] text-muted">{channel.kind === "dm" ? "Chat" : channel.name}</div>}
      </div>
      <span className="max-lg:hidden">
        <button onClick={onClose} className="circle circle-sm" aria-label="Close thread">
          <X size={18} />
        </button>
      </span>
    </header>
  );
}

/** A hand-off's own thread: "Handed to Pappy", where it stands, and a way to stop it. */
function HandoffHeader({ taskId, runs, parent, onBack, onClose }: { taskId: string; runs: LiveRun[]; parent: string | null; onBack: () => void; onClose: () => void }) {
  const task = useTask(taskId);
  const agent = useStore((s) => (task?.toAgentId ? s.agents.find((a) => a.id === task.toAgentId) : undefined));
  const st = task ? taskState(task) : null;
  const mine = runs.filter((r) => !agent || r.agentId === agent.id);
  const canStop = useStore((s) => s.me?.role !== "guest") && mine.length > 0;
  return (
    <header className="h-[4.5rem] shrink-0 px-3 flex items-center gap-2 border-b border-line safe-top box-content">
      <span className={cx(!parent && "lg:hidden")}>
        <button onClick={onBack} className="circle circle-sm" aria-label="Back">
          <ChevronLeft size={20} />
        </button>
      </span>
      <div className="min-w-0 flex-1 flex items-center gap-2.5 px-1">
        {agent && <AgentAvatar agent={agent} size={32} live={mine.length > 0} />}
        <div className="min-w-0">
          <div className="truncate text-body font-medium leading-tight">Handed to {agent?.name ?? "an agent"}</div>
          <div className={cx("text-[14px]", mine.length ? "text-st-working" : st?.tone === "bad" ? "text-st-problem" : "text-muted")}>{mine.length ? "Working" : (st?.label ?? "")}</div>
        </div>
      </div>
      {canStop && (
        <button onClick={() => void stopRuns(mine)} className="circle circle-sm" aria-label={`Stop ${agent?.name ?? "it"}`} title="Stop">
          <Square size={15} fill="currentColor" />
        </button>
      )}
      <span className="max-lg:hidden">
        <button onClick={onClose} className="circle circle-sm" aria-label="Close thread">
          <X size={18} />
        </button>
      </span>
    </header>
  );
}

/** The top of a hand-off thread: who handed what to whom, and when it started. */
function HandoffBrief({ m, taskId }: { m: Message; taskId: string }) {
  const task = useTask(taskId);
  const { clock } = usePrefs();
  const agents = useStore((s) => s.agents);
  const from = useStore((s) => (task?.from.kind === "agent" ? s.agents.find((a) => a.id === task.from.id)?.name : undefined));
  const to = task?.toAgentId ? agents.find((a) => a.id === task.toAgentId)?.name : undefined;
  const st = task ? taskState(task) : null;
  return (
    <div className="px-3 pb-1">
      <ChatCard icon={<ArrowRightLeft size={13} />} label={`${from ?? "Someone"} handed this to ${to ?? "an agent"}`} className="max-w-none">
        <div className="mt-2 text-body font-medium leading-snug">{task?.title ?? m.body.replace(/^@[\w-]+\s*/, "")}</div>
        <div className="mt-2 flex items-center gap-2 text-[14px] text-muted">
          {st && <Pill tone={st.tone}>{st.label}</Pill>}
          <span>Started {clockTime(m.createdAt, clock)}</span>
        </div>
      </ChatCard>
    </div>
  );
}

/** The first message of a thread, on a card at the top of it. */
function ThreadRoot({ m }: { m: Message; composerThread?: string }) {
  const { clock } = usePrefs();
  const names = useNames();
  const handles = useHandleNames();
  const colors = useHandleColors();
  const html = useMemo(() => (m.body ? renderMessage(m.body, { handles, colors }) : ""), [m.body, handles, colors]);
  const meId = useStore((s) => s.me?.user.id);
  const agent = m.author.kind === "agent" ? names.agent(m.author.id) : undefined;
  const mine = m.author.kind === "user" && m.author.id === meId;
  const name = mine ? "You" : agent ? agent.name : (names.member(m.author.id)?.name ?? "Someone");
  return (
    <div className="px-3 pb-1" data-message-id={m.id}>
      <div className="rounded-3xl bg-card px-4 py-3">
        <div className="flex items-center gap-2.5">
          {agent ? <AgentAvatar agent={agent} size={24} interactive={false} /> : <UserAvatar name={names.member(m.author.id)?.name ?? name} size={24} />}
          <span className="text-[14px] font-medium">{name}</span>
          <span className="text-[14px] text-faint">{clockTime(m.createdAt, clock)}</span>
        </div>
        {m.deletedAt ? (
          <div className="mt-2 text-body italic text-muted">This message was deleted.</div>
        ) : (
          <>
            {m.parts.some((p) => p.type === "apple_read") && (
              <div className="mt-2">
                <AppleReadLines parts={m.parts} />
              </div>
            )}
            {html && <div className="prose-w mt-2 text-body" dangerouslySetInnerHTML={{ __html: html }} />}
            <CardAuthor.Provider value={m.author.kind === "agent" ? { agentId: m.author.id, channelId: m.channelId, threadId: m.threadId } : null}>
              <Parts parts={m.parts} body={m.body} agentName={agent?.name} agentId={agent?.id} />
            </CardAuthor.Provider>
          </>
        )}
      </div>
    </div>
  );
}

/** Who's working in a thread (or a sub-thread of it), on the thread's row: their ghosts and "Ada is working". */
function ThreadWork({ runs, threadId, onClick }: { runs: LiveRun[]; threadId: string; onClick: () => void }) {
  const names = useNames();
  const ids = [...new Set(runs.map((r) => r.agentId))];
  const agents = ids.map((id) => names.agent(id)).filter((a): a is Agent => !!a);
  if (!agents.length) return null;
  const deeper = runs.every((r) => r.threadId !== threadId);
  const who = agents.length === 1 ? agents[0].name : agents.length === 2 ? `${agents[0].name} and ${agents[1].name}` : `${agents[0].name} and ${agents.length - 1} more`;
  return (
    <button onClick={onClick} className="h-8 pl-1.5 pr-3 rounded-[8px] bg-chip hover:bg-hover text-[14px] inline-flex items-center gap-1.5" title={deeper ? "Working in a sub-thread" : "Working in this thread"}>
      <span className="flex">
        {agents.slice(0, 3).map((a, i) => (
          <span key={a.id} className={cx("rounded-full ring-2 ring-chip", i > 0 && "-ml-1.5")}>
            <AgentAvatar agent={a} size={18} live interactive={false} />
          </span>
        ))}
      </span>
      <span className="work-dots scale-75" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span>
        <span className="font-medium">{who}</span> {agents.length === 1 ? "is" : "are"} working{deeper ? " in a sub-thread" : ""}
      </span>
    </button>
  );
}

// --- task hand-off card -------------------------------------------------------------------------

const taskCache = new Map<string, Promise<TaskRow[]>>();

function taskState(t: TaskRow): { label: string; tone: "neutral" | "info" | "ok" | "bad" } {
  if (t.status === "done") return { label: "Done", tone: "ok" };
  if (t.status === "failed") return t.result?.startsWith("Cancelled") ? { label: "Cancelled", tone: "neutral" } : { label: "Failed", tone: "bad" };
  if (t.status === "in_progress") return { label: "Working", tone: "info" };
  return { label: "To do", tone: "neutral" };
}

/** A task an agent mentions: title, who has it, where it stands, and a way into Tasks. */
function TaskChip({ id }: { id: string }) {
  const agents = useStore((s) => s.agents);
  const task = useTask(id);
  if (!task) return null;
  const agent = task.toAgentId ? agents.find((a) => a.id === task.toAgentId) : undefined;
  const st = taskState(task);
  return (
    <a href={href({ view: "tasks" })} className="block">
      <ChatCard icon={<ListChecks size={13} />} label="Task" className="hover:bg-hover">
        <div className="mt-2 text-body font-medium leading-snug">{task.title}</div>
        <div className="mt-2 flex items-center gap-2">
          <Pill tone={st.tone}>{st.label}</Pill>
          {agent && (
            <span className="inline-flex items-center gap-1 text-[14px] text-muted">
              <AgentAvatar agent={agent} size={18} badge={false} interactive={false} /> {agent.name}
            </span>
          )}
        </div>
      </ChatCard>
    </a>
  );
}

// --- composer -----------------------------------------------------------------------------------

/** The message a draft replies to: who said it, and a few of their words. */
interface ReplyTarget {
  id: string;
  name: string;
  snippet: string;
}

interface ComposerDraft {
  text: string;
  files: { id: string; name: string; size?: number }[];
  /** files still going up */
  pending: { key: string; name: string; size?: number }[];
  sending: boolean;
  error: string | null;
  replyTo: ReplyTarget | null;
}
const emptyComposerDraft: ComposerDraft = { text: "", files: [], pending: [], sending: false, error: null, replyTo: null };
const composerDrafts = new Map<string, ComposerDraft>();
const draftListeners = new Set<() => void>();
const subscribeDrafts = (onChange: () => void) => {
  draftListeners.add(onChange);
  return () => { draftListeners.delete(onChange); };
};

// Drafts survive a restart: what's typed, attached and replied to is kept per conversation in this browser.
const DRAFTS_KEY = "wisp.drafts";
function storedDraft(key: string): ComposerDraft | undefined {
  try {
    const all = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}") as Record<string, Pick<ComposerDraft, "text" | "files" | "replyTo">>;
    const d = all[key];
    return d ? { ...emptyComposerDraft, text: d.text ?? "", files: d.files ?? [], replyTo: d.replyTo ?? null } : undefined;
  } catch {
    return undefined;
  }
}
function storeDraft(key: string, d: ComposerDraft) {
  try {
    const all = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}") as Record<string, unknown>;
    if (!d.text.trim() && !d.files.length) delete all[key];
    else all[key] = { text: d.text, files: d.files, replyTo: d.replyTo };
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(all));
  } catch {}
}

function draftKey(channelId: string, threadId?: string | null) {
  return JSON.stringify([channelId, threadId ?? null]);
}
function readDraft(key: string): ComposerDraft {
  let d = composerDrafts.get(key);
  if (!d) {
    d = storedDraft(key) ?? emptyComposerDraft;
    composerDrafts.set(key, d);
  }
  return d;
}

function useComposerDraft(channelId: string, threadId?: string) {
  const key = draftKey(channelId, threadId);
  const get = () => readDraft(key);
  const draft = useSyncExternalStore(subscribeDrafts, get, get);
  const update = (change: (draft: ComposerDraft) => ComposerDraft) => {
    const next = change(get());
    composerDrafts.set(key, next);
    storeDraft(key, next);
    draftListeners.forEach((notify) => notify());
  };
  return [draft, update, get] as const;
}

/** Reply to a message: the composer of its conversation shows "Replying to …" and takes focus. */
function startReply(m: Message, name: string, threadId?: string) {
  const key = draftKey(m.channelId, threadId);
  const d = readDraft(key);
  const next = { ...d, replyTo: { id: m.id, name, snippet: snippetOf(m) } };
  composerDrafts.set(key, next);
  storeDraft(key, next);
  draftListeners.forEach((notify) => notify());
  window.dispatchEvent(new CustomEvent(COMPOSER_FOCUS, { detail: key }));
}

const fileSize = (n?: number) => (n === undefined ? "" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

/** Speech to text in the message box, where the browser can do it. */
function useDictation(onText: (text: string) => void, resetKey = "") {
  const [on, setOn] = useState(false);
  const rec = useRef<{ stop: () => void } | null>(null);
  const Ctor = typeof window !== "undefined" ? ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) : undefined;
  useEffect(() => () => rec.current?.stop(), []);
  // a new conversation never inherits a listening microphone
  useEffect(() => { rec.current?.stop(); }, [resetKey]);
  const toggle = () => {
    if (on) return rec.current?.stop();
    if (!Ctor) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = new (Ctor as any)();
    r.continuous = true;
    r.interimResults = false;
    r.lang = navigator.language;
    r.onresult = (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(e.results[i][0].transcript.trim());
    };
    r.onend = () => {
      setOn(false);
      rec.current = null;
    };
    r.onerror = () => setOn(false);
    rec.current = r;
    setOn(true);
    r.start();
  };
  return { supported: !!Ctor, on, toggle };
}

export function Composer({ channelId, threadId, agentId, placeholder, onDetails, onCall }: { channelId: string; threadId?: string; agentId?: string; placeholder: string; onDetails?: (agentId: string) => void; onCall?: () => void }) {
  const { sendWith } = usePrefs();
  const agents = useStore((s) => s.agents);
  const canEdit = useStore((s) => s.me?.role !== "guest");
  const dmAgent = useStore((s) => (agentId ? s.agents.find((a) => a.id === agentId) : undefined));
  // who is working here, not the words: a reply being written doesn't redraw the composer (liveShape.ts)
  const live = useStore(liveShape);
  const [{ text, files, pending, sending, error, replyTo }, updateDraft, getDraft] = useComposerDraft(channelId, threadId);
  const uploading = pending.length;
  const setText = (value: string) => updateDraft((d) => ({ ...d, text: value }));
  const setFiles = (value: ComposerDraft["files"]) => updateDraft((d) => ({ ...d, files: value }));
  const [pick, setPick] = useState(0);
  const [caret, setCaret] = useState(0);
  // past one line the composer is two rows: the text on top, plus and the round button underneath
  const [tall, setTall] = useState(false);
  const tallAt = useRef(0);
  const hold = useRef<{ timer?: ReturnType<typeof setTimeout>; held: boolean }>({ held: false });
  useEffect(() => () => clearTimeout(hold.current.timer), []);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const key = draftKey(channelId, threadId);
  // in a thread, who's working in it (or a sub-thread of it); at the top, everyone in the channel
  const working = Object.values(live).filter((r) => r.channelId === channelId && (!threadId || r.threadId === threadId || r.threadPath.includes(threadId)));
  const channel = useStore((s) => s.channels.find((c) => c.id === channelId));
  const dictation = useDictation((t) => t && setText(`${getDraft().text}${getDraft().text && !/\s$/.test(getDraft().text) ? " " : ""}${t}`), `${channelId}/${threadId ?? ""}`);

  // @mention autocomplete for the word under the cursor
  const word = text.slice(0, caret).match(/(?:^|\s)@([\w-]*)$/)?.[1];
  const suggestions = word !== undefined ? agents.filter((a) => a.handle.startsWith(word.toLowerCase()) || a.name.toLowerCase().startsWith(word.toLowerCase())).slice(0, 6) : [];

  // "/" at the start of the message: what each agent here can do (Esc hides it until the text changes)
  const [slashHidden, setSlashHidden] = useState<string | null>(null);
  const slashText = text.slice(0, caret);
  const slash = useSlashMenu({ query: slashHidden === slashText ? null : slashQuery(slashText), channel, dmAgent, agents });
  function pickCommand(item: SlashItem) {
    const next = slash.textFor(item);
    setText(next + text.slice(caret).replace(/^\S*/, "").trimStart());
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(next.length, next.length);
      setCaret(next.length);
    });
  }

  // words handed over from elsewhere (Home's "Try asking…") prefill the box once, ready to edit or send
  useEffect(() => {
    if (threadId) return;
    const draft = takeDraft(channelId);
    if (draft) {
      setText(draft);
      ta.current?.focus();
    }
  }, [channelId, threadId]);

  // a thread opened with a mouse or trackpad ("Reply in thread") is ready to type in; phones keep their keyboard down
  useEffect(() => {
    if (threadId && window.matchMedia?.("(pointer: fine)").matches) ta.current?.focus({ preventScroll: true });
  }, [channelId, threadId]);

  // "Add files" on the channel intro opens this composer's file picker; Reply on a message focuses its box
  useEffect(() => {
    const open = (e: Event) => {
      if (!threadId && (e as CustomEvent<string>).detail === channelId) fileInput.current?.click();
    };
    const focus = (e: Event) => {
      if ((e as CustomEvent<string>).detail === key) ta.current?.focus();
    };
    window.addEventListener(COMPOSER_ATTACH, open);
    window.addEventListener(COMPOSER_FOCUS, focus);
    return () => {
      window.removeEventListener(COMPOSER_ATTACH, open);
      window.removeEventListener(COMPOSER_FOCUS, focus);
    };
  }, [channelId, threadId, key]);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
    el.style.overflowY = el.scrollHeight > 220 ? "auto" : "hidden";
    // one line, or more? Two rows give the text more width, so it goes back to one line only once
    // the text is shorter than it was when it first wrapped (no flipping between the two)
    const cs = getComputedStyle(el);
    const wraps = el.scrollHeight > parseFloat(cs.lineHeight) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 2;
    if (!tall && wraps) {
      tallAt.current = text.length;
      setTall(true);
    } else if (tall && !wraps && text.length < tallAt.current) setTall(false);
  }, [text, tall]);

  function insert(s: string) {
    const el = ta.current;
    const at = el?.selectionStart ?? text.length;
    const next = text.slice(0, at) + s + text.slice(el?.selectionEnd ?? at);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + s.length, at + s.length);
      setCaret(at + s.length);
    });
  }

  function complete(handle: string) {
    const before = text.slice(0, caret).replace(/@([\w-]*)$/, `@${handle} `);
    setText(before + text.slice(caret));
    setPick(0);
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(before.length, before.length);
      setCaret(before.length);
    });
  }

  async function send() {
    const current = getDraft();
    if (current.pending.length || current.sending || (!current.text.trim() && !current.files.length)) return;
    const body = current.text;
    const attached = current.files;
    const quoted = current.replyTo;
    updateDraft((d) => ({ ...d, text: "", files: [], replyTo: null, sending: true, error: null }));
    try {
      await api("POST", `/api/channels/${channelId}/messages`, { body, threadId, fileIds: attached.map((f) => f.id), ...(quoted ? { replyToId: quoted.id } : {}) });
    } catch (e) {
      // Restore into this conversation, keeping anything typed while the send was in flight.
      updateDraft((d) => ({ ...d, text: body && d.text ? `${body}\n${d.text}` : body || d.text, files: attached, replyTo: d.replyTo ?? quoted, error: (e as Error).message }));
    } finally {
      updateDraft((d) => ({ ...d, sending: false }));
    }
  }

  async function attach(list: FileList | null) {
    if (!list?.length) return;
    const current = getDraft();
    if (current.sending) {
      updateDraft((d) => ({ ...d, error: "Wait for the message to send before attaching files." }));
      return;
    }
    // the hub takes files up to 100 MB: say so up front instead of uploading all of it first
    const all = Array.from(list);
    const tooBig = all.filter((f) => f.size > MAX_UPLOAD_BYTES);
    const sizeError = tooBig.length ? `${tooBig.length === 1 ? `"${tooBig[0].name}" is` : `${tooBig.length} files are`} over 100 MB, too large to attach.` : null;
    const selected = all.filter((f) => !tooBig.includes(f)).slice(0, Math.max(0, 20 - current.files.length - current.pending.length));
    if (!selected.length) {
      if (sizeError) updateDraft((d) => ({ ...d, error: sizeError }));
      return;
    }
    const added = selected.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name, size: f.size }));
    updateDraft((d) => ({ ...d, pending: [...d.pending, ...added], error: sizeError ?? (selected.length < all.length - tooBig.length ? "Attach up to 20 files per message." : null) }));
    let done = 0;
    try {
      for (const f of selected) {
        const up = await uploadFile(f, channelId);
        const mine = added[done++];
        updateDraft((d) => ({ ...d, pending: d.pending.filter((p) => p.key !== mine.key), files: [...d.files, { id: up.id, name: up.name, size: up.size ?? f.size }] }));
      }
    } catch (e) {
      updateDraft((d) => ({ ...d, error: (e as Error).message }));
    } finally {
      const leftover = added.slice(done).map((a) => a.key);
      if (leftover.length) updateDraft((d) => ({ ...d, pending: d.pending.filter((p) => !leftover.includes(p.key)) }));
    }
  }

  const hasContent = !!text.trim() || files.length > 0 || uploading > 0;
  // the one round button: send what's typed; with nothing typed, stop whoever works here, else call (hold to dictate), else dictate
  const action = roundAction({ hasContent, dictating: dictation.on, working: working.length > 0, canStop: canEdit, canCall: !!onCall && !threadId, canDictate: dictation.supported });
  const act = () => {
    if (action === "send") return send();
    if (action === "stop") return void stopRuns(working);
    if (action === "call") return onCall?.();
    dictation.toggle(); // "dictate" starts listening, "listening" stops it
  };
  // holding it down while it would call dictates instead, for as long as it's held
  const holdStart = () => {
    hold.current.held = false;
    if (action !== "call" || !dictation.supported) return;
    hold.current.timer = setTimeout(() => {
      hold.current.held = true;
      dictation.toggle();
    }, 350);
  };
  const holdEnd = () => {
    clearTimeout(hold.current.timer);
    if (hold.current.held && dictation.on) dictation.toggle();
  };
  const name = dmAgent?.name ?? "agent";
  const round = {
    send: { label: "Send", title: undefined, icon: <ArrowUp size={19} strokeWidth={2.5} /> },
    stop: { label: "Stop", title: "Stop", icon: <Square size={13} fill="currentColor" /> },
    call: { label: `Call ${name}`, title: dictation.supported ? `Call ${name} · hold to dictate` : `Call ${name}`, icon: <AudioLines size={17} strokeWidth={2.2} /> },
    dictate: { label: "Dictate", title: "Dictate", icon: <Mic size={18} strokeWidth={1.8} /> },
    listening: { label: "Stop dictating", title: "Stop dictating", icon: <Mic size={18} strokeWidth={1.8} /> },
  }[action];
  // the icon pops in when what you've typed swaps it (not when the composer first opens)
  const swapped = useChangedSinceMount(action);
  return (
    <div className="shrink-0 px-4 md:px-11 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-[max(1.5rem,env(safe-area-inset-bottom))] w-full max-w-3xl md:max-w-[808px] mx-auto flex flex-col">
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => (attach(e.target.files), (e.target.value = ""))} />
      <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(e) => (attach(e.target.files), (e.target.value = ""))} />
      {/* who's working here and on what, in one line; it opens their panel */}
      {working.length > 0 && (
        <div className="flex px-2 pb-1.5">
          <ActivityPill runs={working} onDetails={(id) => (onDetails ? onDetails(id) : go({ view: "agents", agentId: id, tab: "overview" }))} />
        </div>
      )}
      {replyTo && (
        <div className="mb-2 flex items-center gap-3 rounded-[12px] bg-card pl-4 pr-1.5 py-1.5">
          <CornerUpLeft size={15} className="shrink-0 text-muted" />
          <div className="min-w-0 flex-1 border-l-2 border-accent pl-2.5 leading-tight">
            <div className="text-[14px] font-medium">Replying to {replyTo.name}</div>
            <div className="truncate text-[14px] text-muted">{replyTo.snippet}</div>
          </div>
          <button onClick={() => updateDraft((d) => ({ ...d, replyTo: null }))} className="size-9 shrink-0 rounded-[8px] grid place-items-center text-muted hover:bg-hover hover:text-ink" aria-label="Cancel reply">
            <X size={16} />
          </button>
        </div>
      )}
      {(files.length > 0 || uploading > 0) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {files.map((f) => (
            <span key={f.id} className="flex h-9 min-w-0 max-w-[15rem] items-center gap-2 rounded-[10px] bg-card pl-3 pr-1" title={fileSize(f.size) || undefined}>
              <FileText size={15} className="shrink-0 text-muted" />
              <span className="min-w-0 truncate text-[14px] font-medium">{f.name}</span>
              <button onClick={() => setFiles(files.filter((x) => x.id !== f.id))} aria-label={`Remove ${f.name}`} className="size-7 shrink-0 rounded-[8px] grid place-items-center text-muted hover:bg-hover">
                <X size={14} />
              </button>
            </span>
          ))}
          {pending.map((f) => (
            <span key={f.key} className="flex h-9 min-w-0 max-w-[15rem] items-center gap-2 rounded-[10px] bg-card px-3" aria-busy>
              <Loader2 size={15} className="shrink-0 animate-spin text-muted" />
              <span className="min-w-0 truncate text-[14px] font-medium">{f.name}</span>
            </span>
          ))}
        </div>
      )}
      <div className="relative" onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), attach(e.dataTransfer.files))}>
        {slash.open && !suggestions.length && slash.render(pickCommand)}
        {suggestions.length > 0 && (
          <div className="glass absolute bottom-full mb-2 left-0 w-80 max-w-full rounded-[12px] p-1.5 z-10" role="listbox" aria-label="Mention an agent">
            {suggestions.map((a, i) => {
              const node = channel?.settings.team?.nodes.find((n) => n.agentId === a.id);
              return (
                <button
                  key={a.id}
                  role="option"
                  aria-selected={i === pick % suggestions.length}
                  onMouseDown={(e) => (e.preventDefault(), complete(a.handle))}
                  className={cx("w-full px-3 py-2 rounded-[10px] flex items-center gap-3 text-left", i === pick % suggestions.length && "bg-hover")}
                >
                  <AgentAvatar agent={a} size={28} badge={false} interactive={false} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block text-body font-medium">{a.name}</span>
                    <span className="block truncate text-[14px] text-muted">
                      {node?.role ?? `@${a.handle}`}
                      {node?.lead ? " · leads" : ""}
                    </span>
                  </span>
                  <StatusDot status={a.status} />
                </button>
              );
            })}
          </div>
        )}
        {/* one line: plus, the text, the round button. Past one line it grows upward into two rows: the text on top, plus and the button underneath */}
        {/* a round plus, the pill field (with dictation inside, on the right), and the round button outside it */}
        <div className={cx("grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-x-2", tall && "gap-y-1.5")}>
          <span className={cx("col-start-1 shrink-0", tall ? "row-start-2" : "row-start-1")}>
            <Popover
              className="w-60 p-1.5 !rounded-[12px]"
              trigger={(open, toggle) => (
                <button type="button" data-tour="attach" onClick={toggle} aria-label="Attach" aria-expanded={open} title="Attach" className={cx("m-press size-[42px] rounded-full grid place-items-center bg-[var(--bubble-them)] text-ink hover:bg-hover", open && "bg-hover")}>
                  {uploading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={19} strokeWidth={1.9} />}
                </button>
              )}
            >
              {(close) => (
                <div role="menu">
                  <ComposerMenuItem icon={<Camera size={18} />} label="Photos" onClick={() => (close(), photoInput.current?.click())} />
                  <ComposerMenuItem icon={<Paperclip size={18} />} label="Files" onClick={() => (close(), fileInput.current?.click())} />
                  {channel?.kind !== "dm" && <ComposerMenuItem icon={<AtSign size={18} />} label="Mention an agent" onClick={() => (close(), insert(text && !/\s$/.test(text.slice(0, ta.current?.selectionStart ?? text.length)) ? " @" : "@"))} />}
                  {/* the round button dictates while it's held; this is the same thing for a keyboard */}
                  {dictation.supported && <ComposerMenuItem icon={<Mic size={18} />} label={dictation.on ? "Stop dictating" : "Dictate"} onClick={() => (close(), dictation.toggle())} />}
                </div>
              )}
            </Popover>
          </span>
          <div data-tour="input" className={cx("flex min-h-[42px] min-w-0 items-end rounded-[21px] border border-transparent bg-[var(--bubble-them)] pl-4 pr-1.5 focus-within:border-line2 row-start-1", tall ? "col-span-3 col-start-1" : "col-start-2")}>
          <textarea
            ref={ta}
            rows={1}
            value={text}
            placeholder={replyTo ? `Reply to ${replyTo.name.split(" · ")[0]}` : placeholder}
            aria-label={placeholder}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={(e) => {
              if (slash.open && !suggestions.length) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") return (e.preventDefault(), slash.move(e.key === "ArrowDown" ? 1 : -1));
                if (e.key === "Escape") return (e.preventDefault(), setSlashHidden(slashText));
                if (slash.current && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing))) {
                  e.preventDefault();
                  if (e.key === "Enter" && slashEnterAction(slashText, slash.current.command) === "send") return send();
                  return pickCommand(slash.current);
                }
              }
              if (suggestions.length && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
                e.preventDefault();
                return complete(suggestions[pick % suggestions.length].handle);
              }
              if (suggestions.length && e.key === "ArrowDown") return (e.preventDefault(), setPick(pick + 1));
              if (suggestions.length && e.key === "ArrowUp") return (e.preventDefault(), setPick(Math.max(0, pick - 1)));
              if (e.key === "Escape" && replyTo) return (e.preventDefault(), updateDraft((d) => ({ ...d, replyTo: null })));
              // phones: Enter is a newline and the send button sends. Otherwise Enter sends, or
              // ⌘/Ctrl+Enter does when the person picked that (Settings → Preferences)
              const fine = window.matchMedia("(pointer: fine)").matches;
              const mod = e.metaKey || e.ctrlKey;
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && fine && (sendWith === "mod-enter" ? mod : true)) {
                e.preventDefault();
                send();
              }
            }}
            className="block min-w-0 flex-1 resize-none bg-transparent py-[9px] text-[16px] leading-[22px] outline-none placeholder:text-muted placeholder:truncate"
          />
          {dictation.supported && action !== "dictate" && action !== "listening" && (
            <button type="button" onClick={() => dictation.toggle()} aria-label="Dictate" title="Dictate" className="mb-[3px] grid size-[34px] shrink-0 place-items-center rounded-full text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/40">
              <Mic size={18} strokeWidth={1.8} />
            </button>
          )}
          </div>
          <button
            type="button"
            onClick={() => {
              // the press that dictated has already done its work
              if (hold.current.held) return void (hold.current.held = false);
              return act();
            }}
            data-tour="send"
            onPointerDown={holdStart}
            onPointerUp={holdEnd}
            onPointerLeave={holdEnd}
            onPointerCancel={holdEnd}
            onContextMenu={action === "call" || action === "listening" ? (e) => e.preventDefault() : undefined}
            disabled={action === "send" && (!!uploading || sending || (!text.trim() && !files.length))}
            aria-label={round.label}
            aria-pressed={action === "listening" ? true : undefined}
            title={round.title}
            className={cx(
              "m-press col-start-3 size-[42px] shrink-0 select-none rounded-full grid place-items-center disabled:bg-chip disabled:text-faint",
              tall ? "row-start-2" : "row-start-1",
              action === "listening" ? "bg-bad text-white" : "bg-[var(--bubble-me)] text-[var(--bubble-me-ink)]",
            )}
          >
            <span key={action} className={cx("grid place-items-center", swapped && "m-swap")}>
              {round.icon}
            </span>
          </button>
        </div>
      </div>
      {error && (
        <div className="pt-1.5 px-2 text-xs">
          <span className="text-bad">{error}</span>
        </div>
      )}
    </div>
  );
}

function ComposerMenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button role="menuitem" onClick={onClick} className="w-full px-3 h-12 rounded-2xl flex items-center gap-3 text-body hover:bg-hover">
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  );
}
