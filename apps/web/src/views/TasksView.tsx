import { TASK_GROUPS, closedLanes, groupOfState, shortAgo, takeRequestedTask, taskMatches, titleAndBrief, type TaskGroup, type TaskRequest } from "./task-lanes.ts";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronLeft, Circle, CircleCheck, CircleX, Loader2, Paperclip, Plus, Search, Users, WifiOff, X } from "lucide-react";
import { harnessInfo, type Actor, type Agent, type Team } from "@bubble-ai/core";
import { api, uploadFile } from "../api.ts";
import { useStore, useTeams, usePrefs } from "../store.ts";
import { go, href } from "../router.ts";
import { useDevices } from "../devices.ts";
import { useFeatures } from "../features.ts";
import { AgentAvatar, Menu, Modal, cx, timeAgo } from "../components/ui.tsx";
import { CardButton, ConfirmDialog, GroupCard, Rule, SectionHead, StateChip, runSummary } from "../components/InboxParts.tsx";
import { PulseDots, shortTime } from "../components/ChatList.tsx";
import { ReviewPanel, branchesOf, type ReviewTab } from "../code/ReviewPanel.tsx";
import { codeTaskOf, repoName, type CodeTask } from "../code/data.ts";

export interface TaskRow {
  id: string;
  from: Actor;
  /** null once that agent was removed */
  toAgentId: string | null;
  title: string;
  brief: string;
  status: "open" | "in_progress" | "done" | "failed";
  result: string | null;
  channelId: string | null;
  threadId: string | null;
  teamId: string | null;
  reviewOf: string | null;
  /** coding work for a channel team with a repo happens on its own branch */
  branch?: string | null;
  mergedAt?: string | null;
  /** the task this is a piece of; null at the top */
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
}

type State = "todo" | "working" | "blocked" | "needsYou" | "done" | "failed" | "cancelled";
type Tone = "neutral" | "ok" | "warn" | "bad" | "info";
const STATE: Record<State, { label: string; tone: Tone }> = {
  todo: { label: "To do", tone: "neutral" },
  working: { label: "Working", tone: "ok" },
  blocked: { label: "Waiting for a computer", tone: "neutral" },
  needsYou: { label: "Needs you", tone: "warn" },
  done: { label: "Done", tone: "info" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
const isCancelled = (t: TaskRow) => t.status === "failed" && !!t.result?.startsWith("Cancelled");
const isClosed = (t: TaskRow) => t.status === "done" || t.status === "failed";
const cancellable = (s: State) => s === "todo" || s === "blocked" || s === "working";

/** The page's column: a list as wide as the board draws it, wider when a task shows its review. */
const column = (wide?: boolean) => cx("mx-auto w-full px-3 md:px-4 pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-9 pb-[max(2rem,env(safe-area-inset-bottom))]", wide ? "max-w-[780px]" : "max-w-[632px]");

/**
 * Tasks (a mod): work that's been planned and handed out. A task nobody assigned goes to the lead, who
 * splits it up; the pieces show up under it as subtasks. One plain list in three groups (Doing,
 * Waiting on you, Done); a task opens its own page.
 */
export function TasksView({ onBack }: { onBack?: () => void }) {
  const status = useStore((s) => s.lead);
  const agents = useStore((s) => s.agents);
  useEffect(() => {
    useStore.getState().refreshLead();
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {agents.length === 0 ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className={column()}>
            <Head onBack={onBack} />
            <NoAgents />
          </div>
        </div>
      ) : (
        <Board leadId={status?.lead ?? null} onBack={onBack} />
      )}
    </div>
  );
}

/** The page's one row of chrome: its name and the plus. */
function Head({ onBack, onNew }: { onBack?: () => void; onNew?: () => void }) {
  return (
    <header className="flex items-center gap-3 px-1.5">
      {onBack && (
        <button className="md:hidden! circle" onClick={onBack} aria-label="Back">
          <ChevronLeft size={22} strokeWidth={2} />
        </button>
      )}
      <h1 className="flex-1 truncate text-[22px] md:text-[24px] font-[650] leading-tight tracking-[-0.02em] max-md:text-center">Tasks</h1>
      {onNew ? (
        <button onClick={onNew} aria-label="New task" title="New task" className="m-press size-11 md:size-[34px] shrink-0 rounded-full grid place-items-center bg-chip text-ink hover:bg-hover outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Plus size={18} strokeWidth={2} />
        </button>
      ) : (
        onBack && <span className="md:hidden w-11" />
      )}
    </header>
  );
}

/** Tasks need someone to hand them to. */
function NoAgents() {
  /** this also shows inside the New task dialog; leave it before navigating */
  const to = (view: Parameters<typeof go>[0]) => {
    useStore.setState({ newTaskOpen: false });
    go(view);
  };
  return (
    <div className="px-1.5 pt-6 flex flex-col items-start gap-3">
      <p className="text-sm text-muted">No agents yet</p>
      <CardButton tone="primary" onClick={() => to({ view: "agents", agentId: null })}>
        Add an agent
      </CardButton>
    </div>
  );
}

interface Ctx {
  agents: Agent[];
  teams: Team[];
  leadId: string | null;
  children: Map<string, TaskRow[]>;
  byId: Map<string, TaskRow>;
  stateOf: (t: TaskRow) => State;
  stateLabel: (t: TaskRow) => string;
  canCancel: boolean;
  refetch: () => void;
  waitingOn: (t: TaskRow) => string | null;
  fromName: (a: Actor) => string;
}

function Board({ leadId, onBack }: { leadId: string | null; onBack?: () => void }) {
  const me = useStore((s) => s.me)!;
  const agents = useStore((s) => s.agents);
  const teams = useTeams();
  const members = useStore((s) => s.members);
  const approvals = useStore((s) => s.approvals);
  const computers = useStore((s) => s.computers);
  const version = useStore((s) => s.tasksVersion);
  const devices = useDevices();
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [query, setQuery] = useState("");
  // the open task's page; a subtask opens over its parent, so Back returns there
  const [stack, setStack] = useState<string[]>([]);
  const [request, setRequest] = useState<TaskRequest | null>(null);

  const refetch = () => api<TaskRow[]>("GET", "/api/tasks").then(setTasks, () => setTasks((t) => t ?? []));
  useEffect(() => {
    refetch();
  }, [version]);

  // another page asked for one task (Code's Review keys): open it once the tasks are here
  const loaded = !!tasks;
  useEffect(() => {
    if (!tasks) return;
    const r = takeRequestedTask();
    if (!r || !tasks.some((t) => t.id === r.id)) return;
    setRequest(r);
    setStack([r.id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const waitingOn = (t: TaskRow) => {
    if (isClosed(t)) return null;
    const inThread = (x: { channelId: string; threadId: string | null }) => x.channelId === t.channelId && (x.threadId === t.threadId || (!!t.threadId && x.threadId === null));
    const approval = Object.values(approvals).find((a) => a.status === "pending" && a.agentId === t.toAgentId && inThread(a));
    if (approval) return `Wants your OK: ${approval.summary}`;
    const help = computers.find((c) => c.help && c.help.agentId === t.toAgentId && inThread(c.help));
    return help ? `Needs you on ${help.name}: ${help.help!.request}` : null;
  };
  /** the device an agent runs on, if we know it */
  const deviceOf = (a: Agent | undefined) => (a?.nodeId ? devices?.find((d) => d.id === a.nodeId) : undefined);
  const stateOf = (t: TaskRow): State => {
    if (t.status === "done") return "done";
    if (isCancelled(t)) return "cancelled";
    if (t.status === "failed") return "failed";
    if (waitingOn(t)) return "needsYou";
    const agent = agents.find((a) => a.id === t.toAgentId);
    // agents that connect on their own (mcp) have no device to wait for
    if (agent && harnessInfo(agent.harness)?.protocol !== "mcp") {
      const dev = deviceOf(agent);
      const unreachable = !agent.nodeId || (devices ? !dev || !dev.online || !!dev.paused : agent.status === "offline");
      if (unreachable) return "blocked";
    }
    return t.status === "in_progress" || agent?.status === "busy" ? "working" : "todo";
  };
  const stateLabel = (t: TaskRow) => {
    const s = stateOf(t);
    if (s !== "blocked") return STATE[s].label;
    const name = deviceOf(agents.find((a) => a.id === t.toAgentId))?.name;
    return name ? `Waiting for ${name}` : "Waiting for a computer";
  };

  // the tree: subtasks (and reviews) hang under the task they're a piece of
  const { roots, children, byId } = useMemo(() => {
    const byId = new Map((tasks ?? []).map((t) => [t.id, t]));
    const children = new Map<string, TaskRow[]>();
    const roots: TaskRow[] = [];
    for (const t of [...(tasks ?? [])].reverse()) {
      const up = t.parentId ?? t.reviewOf;
      if (up && byId.has(up)) children.set(up, [...(children.get(up) ?? []), t]);
      else roots.push(t);
    }
    return { roots: roots.reverse(), children, byId };
  }, [tasks]);

  const all = (t: TaskRow): TaskRow[] => [t, ...(children.get(t.id) ?? []).flatMap(all)];
  /** what the search field looks through: the task, who has it, its team, where it stands, and "mine" for what you asked for */
  const wordsOf = (t: TaskRow) => {
    const a = agents.find((x) => x.id === t.toAgentId);
    const team = teams.find((x) => x.id === t.teamId);
    const group = TASK_GROUPS.find((g) => g.id === groupOfState(stateOf(t)))?.title;
    return [t.title, a?.name, a && `@${a.handle}`, a?.settings.role, team && `team ${team.name}`, stateLabel(t), group, t.branch, t.from.kind === "user" && t.from.id === me.user.id ? "mine" : null];
  };
  const matches = (t: TaskRow) => !query.trim() || all(t).some((x) => taskMatches(query, wordsOf(x)));
  const shown = roots.filter(matches);
  const open = shown.filter((t) => !isClosed(t));
  // the pieces of a task that wait on you count too: the root stays where it is, the piece is listed here
  const needsYou = shown.flatMap(all).filter((t) => !isClosed(t) && stateOf(t) === "needsYou");
  // at work first, then waiting for a computer, then not started
  const rank = (t: TaskRow) => ({ working: 0, blocked: 1 } as Partial<Record<State, number>>)[stateOf(t)] ?? 2;
  const doing = open.filter((t) => !needsYou.includes(t)).sort((a, b) => rank(a) - rank(b));
  const { failed, done: closed } = closedLanes(shown.filter(isClosed));
  const lists: Record<TaskGroup, TaskRow[]> = { doing, waiting: [...needsYou, ...failed], done: closed };

  const fromName = (a: Actor) => (a.kind === "agent" ? `@${agents.find((x) => x.id === a.id)?.handle ?? "agent"}` : a.id === me.user.id ? "you" : (members.find((m) => m.id === a.id)?.name ?? "someone"));
  const ctx: Ctx = { agents, teams, leadId, children, byId, stateOf, stateLabel, waitingOn, fromName, canCancel: me.role !== "guest", refetch };
  const selectedId = stack.at(-1) ?? null;
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  const canNew = me.role !== "guest";

  if (!tasks) return <div className="flex-1 grid place-items-center text-sm text-muted">Loading…</div>;

  if (selected)
    return (
      <TaskPage
        key={selected.id}
        task={selected}
        ctx={ctx}
        request={request?.id === selected.id ? request : null}
        onSelect={(id) => setStack((s) => [...s, id])}
        onBack={() => (setRequest(null), setStack((s) => s.slice(0, -1)))}
      />
    );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className={column()}>
        <Head onBack={onBack} onNew={canNew ? () => useStore.setState({ newTaskOpen: true }) : undefined} />
        {roots.length > 0 && (
          <label className="mt-4 mx-1.5 flex items-center gap-2 h-9 rounded-full bg-chip px-3 text-muted focus-within:text-ink">
            <Search size={15} strokeWidth={2} aria-hidden />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search tasks" placeholder="Search tasks" className="flex-1 min-w-0 bg-transparent outline-none text-body text-ink placeholder:text-muted" />
          </label>
        )}
        {roots.length === 0 ? <p className="px-1.5 pt-6 text-sm text-muted">No tasks yet</p> : shown.length === 0 && <p className="px-1.5 pt-6 text-sm text-muted">Nothing matches</p>}
        {TASK_GROUPS.map(
          (g) =>
            lists[g.id].length > 0 && (
              <section key={g.id} aria-label={g.title} className="flex flex-col">
                <h2 className="px-1.5 pt-5 pb-1 text-xs text-muted">{g.title}</h2>
                {lists[g.id].map((t) => (
                  <TaskRowItem key={t.id} task={t} ctx={ctx} onOpen={() => setStack([t.id])} />
                ))}
              </section>
            ),
        )}
      </div>
    </div>
  );
}

const iconFor = (s: State, size = 22) => {
  const p = { size, strokeWidth: 1.8, className: "shrink-0" };
  if (s === "done") return <CircleCheck {...p} className="shrink-0 text-ok" />;
  if (s === "failed") return <CircleX {...p} className="shrink-0 text-bad" />;
  if (s === "cancelled") return <CircleX {...p} className="shrink-0 text-faint" />;
  if (s === "working") return <Loader2 {...p} className="shrink-0 animate-spin text-st-working" />;
  if (s === "blocked") return <WifiOff {...p} className="shrink-0 text-faint" />;
  return <Circle {...p} className="shrink-0 text-faint" />;
};

/** A row: the assignee's ghost (moving while it works), the task, who and when, and a small mark for how it ended or what holds it up. */
function TaskRowItem({ task: t, ctx, onOpen }: { task: TaskRow; ctx: Ctx; onOpen: () => void }) {
  const agent = ctx.agents.find((a) => a.id === t.toAgentId);
  const state = ctx.stateOf(t);
  const finished = groupOfState(state) === "done";
  const working = state === "working";
  return (
    <button onClick={onOpen} className="w-full flex items-center gap-3 h-12 px-1.5 rounded-[10px] text-left hover:bg-hover min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className={cx("shrink-0 grid", finished && "opacity-50")}>
        <AgentAvatar agent={agent} size={28} interactive={false} live={working} animate={working} />
      </span>
      <span className={cx("flex-1 min-w-0 truncate text-[15px]", finished && "text-muted")}>{t.title}</span>
      <span className="shrink-0 max-w-[45%] truncate text-[13px] text-muted">
        {agent?.name ?? "An agent"} · {shortAgo(t.updatedAt)}
      </span>
      <span className="sr-only">{ctx.stateLabel(t)}</span>
      <span className="size-4 shrink-0 grid place-items-center text-muted" aria-hidden>
        {state === "done" ? <Check size={16} strokeWidth={2} /> : state === "failed" ? <CircleX size={16} strokeWidth={2} className="text-bad" /> : state === "cancelled" ? <X size={16} strokeWidth={2} /> : state === "blocked" ? <WifiOff size={15} strokeWidth={2} /> : null}
      </span>
    </button>
  );
}

/** Hand a failed task back to its agent. */
function RetryTask({ task: t, ctx }: { task: TaskRow; ctx: Ctx }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (ctx.stateOf(t) !== "failed" || !ctx.canCancel) return null;
  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/api/tasks/${t.id}/retry`);
      ctx.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <CardButton disabled={busy} onClick={() => void retry()}>
        Try again
      </CardButton>
      {error && <span className="text-sm text-bad">{error}</span>}
    </span>
  );
}

/**
 * A task's page: where it stands, who has it and its branch, what the agent is doing or what it
 * found, the pieces it was split into, the review of its branch (changes, files, checks, send
 * back, merge), and Open conversation, Merge, Try again and Cancel.
 */
function TaskPage({ task: t, ctx, request, onSelect, onBack }: { task: TaskRow; ctx: Ctx; request: TaskRequest | null; onSelect: (id: string) => void; onBack: () => void }) {
  const live = useStore((s) => s.live);
  const approvals = useStore((s) => s.approvals);
  const version = useStore((s) => s.tasksVersion);
  const codeOn = useFeatures().code;
  const prefs = usePrefs();
  const agent = ctx.agents.find((a) => a.id === t.toAgentId);
  const state = ctx.stateOf(t);
  const note = ctx.waitingOn(t);
  const subs = ctx.children.get(t.id) ?? [];
  const name = agent?.name ?? "The agent";
  const [confirm, setConfirm] = useState<"merge" | "cancel" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ReviewTab>(request?.tab ?? "changes");
  const canMerge = !!t.branch && !t.reviewOf && t.status === "done" && !t.mergedAt && ctx.canCancel;

  // the whole piece of work this task belongs to: its team's repo, and the branches Review reads
  let root = t;
  for (let i = 0; i < 20; i++) {
    const up = ctx.byId.get(root.parentId ?? root.reviewOf ?? "");
    if (!up) break;
    root = up;
  }
  const team = ctx.teams.find((x) => x.id === root.teamId);
  const family = (x: TaskRow): TaskRow[] => [x, ...(ctx.children.get(x.id) ?? []).flatMap(family)];
  const work: CodeTask | null = team?.repo ? codeTaskOf(root, family(root), team, approvals, live) : null;
  const review = codeOn && work && branchesOf(work).length > 0 ? work : null;

  /** the newest thing the agent is doing for this task, when it's at work on it */
  const run = Object.values(live).find((r) => r.agentId === t.toAgentId && r.channelId === t.channelId && (r.threadId ?? null) === (t.threadId ?? null));
  const doing = state === "needsYou" ? note : state === "working" ? (run ? runSummary(run, ctx.agents) : "Working on it") : null;

  const act = async (kind: "merge" | "cancel") => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/api/tasks/${t.id}/${kind}`);
      setConfirm(null);
      ctx.refetch();
    } catch (err) {
      setConfirm(null);
      setError((err as Error).message);
      ctx.refetch();
    } finally {
      setBusy(false);
    }
  };

  // Escape goes back, unless a dialog, a menu or a field has it
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      back.current();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const flat = (list: TaskRow[], depth: number): { t: TaskRow; depth: number }[] => list.flatMap((s) => [{ t: s, depth }, ...flat(ctx.children.get(s.id) ?? [], depth + 1)]);
  const rows = flat(subs, 0);
  const conversation = t.channelId ? () => go({ view: "chat", channelId: t.channelId!, threadId: t.threadId }) : null;
  const when = `${shortTime(Date.parse(t.createdAt), prefs.clock)}`;
  const closed = t.status === "done" || state === "cancelled" || state === "failed";
  const said = t.result || (t.brief && t.brief !== t.title ? t.brief : "");
  // Review carries its own Merge (with Send back beside it); without it the page's own Merge shows
  const ownMerge = canMerge && !review;

  const rowCls = "flex items-center gap-3 px-4 min-h-[48px] py-2";
  const field = (k: string, v: ReactNode) => (
    <div className={rowCls}>
      <span className="w-[78px] shrink-0 text-sm text-muted">{k}</span>
      <span className="flex-1 min-w-0 flex items-center gap-2 text-body">{v}</span>
    </div>
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className={cx(column(!!review), "flex flex-col gap-3.5")}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="circle" aria-label="Back to tasks">
            <ChevronLeft size={22} strokeWidth={2} />
          </button>
          <span className="flex-1" />
          {conversation && <CardButton onClick={conversation}>Open conversation</CardButton>}
        </div>

        <div className="flex flex-col gap-2 px-1">
          <h1 className="text-[22px] md:text-[24px] font-[650] leading-tight tracking-[-0.02em] break-words">{t.title}</h1>
          <span className="flex items-center gap-2.5 flex-wrap">
            <StateChip tone={STATE[state].tone}>{ctx.stateLabel(t)}</StateChip>
            <span className="text-[13px] text-muted">
              Asked by {ctx.fromName(t.from)} · {when}
            </span>
          </span>
        </div>

        <GroupCard>
          {field(
            "Assignee",
            <>
              <AgentAvatar agent={agent} size={26} interactive={false} />
              <span className="truncate">
                {agent?.name ?? "an agent"}
                {t.toAgentId === ctx.leadId ? " · lead" : agent?.settings.role ? ` · ${agent.settings.role}` : ""}
              </span>
            </>,
          )}
          {t.branch && (
            <>
              <Rule />
              {field("Branch", <span className="font-mono text-sm break-all">{t.branch}</span>)}
            </>
          )}
          {team?.repo && (
            <>
              <Rule />
              {field("Repo", <span className="font-mono text-sm break-all">{repoName(team.repo)}</span>)}
            </>
          )}
          {t.branch && t.mergedAt && (
            <>
              <Rule />
              {field("Merged", timeAgo(t.mergedAt))}
            </>
          )}
        </GroupCard>

        {state === "blocked" && (
          <p className="text-sm text-muted flex gap-2 px-1">
            <WifiOff size={15} className="shrink-0 mt-0.5 text-warn" />
            <span>
              {name} is offline.{" "}
              <a href={href({ view: "computers", computerId: null })} className="underline hover:text-ink">
                Computers
              </a>
            </span>
          </p>
        )}

        {!closed && (doing || (t.brief && t.brief !== t.title)) && (
          <>
            <SectionHead title={`What ${name} is doing`} />
            <GroupCard className="px-4 py-3.5 flex flex-col gap-2">
              {doing && (
                <span className="flex items-start gap-2.5">
                  {state === "working" && (
                    <span className="mt-2"><PulseDots /></span>
                  )}
                  <span className={cx("text-body leading-snug", state === "working" ? "text-st-working" : "text-warn")}>{doing}</span>
                </span>
              )}
              {t.brief && t.brief !== t.title && <span className="text-sm leading-snug text-ink/80 whitespace-pre-wrap break-words">{t.brief}</span>}
            </GroupCard>
          </>
        )}

        {closed && (said || state === "failed") && (
          <>
            <SectionHead title={state === "cancelled" ? "Cancelled" : state === "failed" ? "What happened" : "Result"} />
            <GroupCard className="px-4 py-3.5 flex flex-col gap-2">
              {said && <span className="text-sm leading-snug text-ink/85 whitespace-pre-wrap break-words">{said}</span>}
              <RetryTask task={t} ctx={ctx} />
            </GroupCard>
          </>
        )}

        {rows.length > 0 && (
          <>
            <SectionHead title="Subtasks" right={rows.length} />
            <GroupCard>
              {rows.map(({ t: s, depth }, i) => {
                const sa = ctx.agents.find((a) => a.id === s.toAgentId);
                const ss = ctx.stateOf(s);
                return (
                  <div key={s.id}>
                    {i > 0 && <Rule />}
                    <button onClick={() => onSelect(s.id)} className="w-full flex items-center gap-3 min-h-[48px] py-2 pr-4 text-left hover:bg-hover" style={{ paddingLeft: 16 + depth * 20 }}>
                      {iconFor(ss, 20)}
                      <span className="flex-1 min-w-0 text-body leading-snug">
                        {s.reviewOf && <span className="text-muted">Review · </span>}
                        {s.title}
                        {sa && <span className="text-muted"> · {sa.name}</span>}
                      </span>
                      <StateChip tone={STATE[ss].tone}>{ctx.stateLabel(s)}</StateChip>
                    </button>
                  </div>
                );
              })}
            </GroupCard>
          </>
        )}

        {review && (
          <>
            <SectionHead title="Review" />
            <ReviewPanel key={review.root.id} task={review} tab={tab} setTab={setTab} version={version} initial={t.reviewOf ?? t.id} act={request?.act} />
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-bad whitespace-pre-wrap px-1">
            {error}
          </p>
        )}

        {(ownMerge || (ctx.canCancel && cancellable(state))) && (
          <div className="flex gap-2.5 pt-1">
            {ownMerge && (
              <CardButton tone="primary" aria-label="Merge this task's branch" disabled={busy} onClick={() => setConfirm("merge")}>
                Merge
              </CardButton>
            )}
            {ctx.canCancel && cancellable(state) && (
              <CardButton className="text-bad" disabled={busy} onClick={() => setConfirm("cancel")}>
                Cancel task
              </CardButton>
            )}
          </div>
        )}

        {confirm === "merge" && (
          <ConfirmDialog title="Merge this task's branch?" body={`${t.branch} goes into the team's main branch.`} confirm="Merge" busy={busy} onConfirm={() => act("merge")} onClose={() => setConfirm(null)} />
        )}
        {confirm === "cancel" && (
          <ConfirmDialog title="Cancel this task?" body={`${name} won't work on it.`} confirm="Cancel task" keep="Keep it" danger busy={busy} onConfirm={() => act("cancel")} onClose={() => setConfirm(null)} />
        )}
      </div>
    </div>
  );
}

/** Start a task: one field, and who it goes to. It goes to the lead to plan unless you pick an agent or a team's lead. */
export function NewTask({ onClose, defaultTo }: { onClose: () => void; defaultTo?: string }) {
  const agents = useStore((s) => s.agents);
  const teams = useTeams();
  const status = useStore((s) => s.lead);
  const lead = agents.find((a) => a.id === status?.lead);
  const [text, setText] = useState("");
  const [to, setTo] = useState(defaultTo ?? "auto");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = agents.find((a) => a.id === to);
  const team = to.startsWith("team:") ? teams.find((t) => `team:${t.name}` === to) : undefined;
  const solo = agents.length === 1;
  const { title, brief } = titleAndBrief(text);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || !title) return;
    setBusy(true);
    setError(null);
    try {
      const fileIds = [];
      for (const f of files) fileIds.push((await uploadFile(f)).id);
      const t = await api<TaskRow>("POST", "/api/tasks", { to, title, brief, fileIds });
      await useStore.getState().refreshChannels();
      onClose();
      if (t.channelId) go({ view: "chat", channelId: t.channelId, threadId: t.threadId });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!lead) {
    return (
      <Modal title="New task" onClose={onClose}>
        <NoAgents />
      </Modal>
    );
  }

  const who = team ? team.name : (picked ?? lead).name;
  return (
    <Modal title="New task" onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <textarea
          aria-label="What needs doing?"
          placeholder="What needs doing?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter hands it off; Shift+Enter starts the details on a new line
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
              e.preventDefault();
              void submit();
            }
          }}
          autoFocus
          required
          rows={3}
          className="w-full resize-none rounded-2xl bg-card px-4 py-3 text-body leading-[22px] outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        {files.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-chip px-2.5 h-7 text-xs">
                {f.name}
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          {!solo && (
            <Menu
              up
              trigger={(isOpen, toggle) => (
                <button type="button" onClick={toggle} aria-expanded={isOpen} aria-haspopup="menu" aria-label={`Goes to ${who}`} className="inline-flex items-center gap-2 h-9 max-w-[220px] rounded-full border border-line2 pl-1.5 pr-2.5 text-sm font-medium hover:bg-hover">
                  {team ? <Users size={18} strokeWidth={1.8} className="ml-1 text-muted shrink-0" /> : <AgentAvatar agent={picked ?? lead} size={24} interactive={false} />}
                  <span className="truncate">{who}</span>
                  <ChevronDown size={14} strokeWidth={2} className="text-muted shrink-0" />
                </button>
              )}
              items={[
                { label: `${lead.name} plans it`, icon: <AgentAvatar agent={lead} size={22} interactive={false} />, onSelect: () => setTo("auto") },
                ...agents.filter((a) => a.id !== lead.id).map((a) => ({ label: a.name, icon: <AgentAvatar agent={a} size={22} interactive={false} />, onSelect: () => setTo(a.id) })),
                ...teams.filter((t) => t.leadId).map((t) => ({ label: `Team ${t.name}`, icon: <Users size={18} strokeWidth={1.8} />, onSelect: () => setTo(`team:${t.name}`) })),
              ]}
            />
          )}
          <label className="size-9 shrink-0 grid place-items-center rounded-full text-muted hover:bg-hover hover:text-ink cursor-pointer focus-within:ring-2 focus-within:ring-ring" title="Attach files">
            <Paperclip size={17} strokeWidth={1.8} aria-hidden />
            <input type="file" multiple aria-label="Attach files" className="sr-only" onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
          </label>
          <span className="flex-1" />
          <CardButton tone="primary" type="submit" disabled={busy || !title}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : "Hand off"}
          </CardButton>
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
      </form>
    </Modal>
  );
}
