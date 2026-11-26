import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { harnessLabel, type Actor, type Agent, type Approval, type FlowLane, type Followup, type TeamFlow } from "@bubble-ai/core";
import { api } from "../api.ts";
import { useStore, useTeams, useWaitingOnYou, usePrefs, type ComputerInfo } from "../store.ts";
import { waitingOnYou } from "../team/Runs.tsx";
import { useFeatures } from "../features.ts";
import { go, href } from "../router.ts";
import { openDm } from "../openDm.ts";
import { AgentAvatar, cx, timeAgo } from "../components/ui.tsx";
import { MotionMark } from "../components/MotionMark.tsx";
import { ChatAvatar, shortTime } from "../components/ChatList.tsx";
import { ApprovalNeed, CardButton, HelpNeed, NeedRow, ReminderNeed, stoppedLine, useHelpSeen, helpKey } from "../components/InboxParts.tsx";
import { dueReminders, laterReminders, usePutOff } from "../components/Loops.tsx";
import { agentReadiness, agentSignedIn, useDevices, type DeviceInfo } from "../devices.ts";
import { setupNextStep } from "../components/AgentPanel.tsx";
import { cleanPreview } from "../components/CommandPalette.tsx";

/** The fields of a task this page reads (GET /api/tasks). */
interface TaskLite {
  id: string;
  from: Actor;
  toAgentId: string | null;
  title: string;
  status: "open" | "in_progress" | "done" | "failed";
  result?: string | null;
  channelId: string | null;
  threadId: string | null;
  teamId: string | null;
  updatedAt: string;
}

/** The one sentence of a request: what the agent wants to do, in its own words. */
export function approvalLine(a: Pick<Approval, "summary" | "login">, name: string): string {
  if (a.login) return `${name} wants to use your ${a.login.title} login.`;
  return cleanPreview(a.summary, 200) || `${name} wants your OK.`;
}

/** What an agent asked for on its computer, else that it needs you there. */
export function helpLine(c: Pick<ComputerInfo, "name" | "help">, name: string): string {
  return cleanPreview(c.help?.request ?? "", 200) || `${name} needs you on ${c.name}.`;
}

/**
 * What an agent that can't work yet needs from the person: one sentence and the one button that
 * does it. The checks go in the order of `setupNextStep`, which also says where the button leads;
 * `href` is null when nothing more specific than its chat exists. Null when the agent is ready.
 */
export function agentNeed(agent: Pick<Agent, "id" | "nodeId" | "harness" | "name" | "settings" | "computerId"> & Partial<Pick<Agent, "signIn">>, devices: DeviceInfo[] | null): { text: string; action: "Choose one" | "See computers" | "Sign in" | "Install it" | "Open chat"; href: string | null } | null {
  if (agentReadiness(agent, devices).ready) return null;
  const next = setupNextStep(agent, devices);
  const device = devices?.find((d) => d.id === agent.nodeId);
  if (!next) return { text: `${agent.name} can't work yet.`, action: "Open chat", href: null };
  if (!agent.nodeId) return { text: `${agent.name} needs a computer to work on.`, action: "Choose one", href: next.href };
  if (device && !device.online) return { text: `${agent.name} is waiting for ${device.name} to reconnect.`, action: "See computers", href: next.href };
  if (device?.paused) return { text: `${agent.name} is waiting for ${device.name} to be resumed.`, action: "See computers", href: next.href };
  const ai = harnessLabel(agent.harness);
  if (agent.signIn || (device && agentSignedIn(agent, device) === false)) return { text: `${agent.name} needs you to sign in to ${ai}.`, action: "Sign in", href: next.href };
  return { text: `${agent.name} needs ${ai} installed${device ? ` on ${device.name}` : ""}.`, action: "Install it", href: next.href };
}

/**
 * Needs you (route: dashboard; it was the Inbox): only what waits on the person. An approval, an
 * agent that can't work until they do something, a team request that stopped, a reminder that came
 * due. Under them, Later (what they put off) and Earlier (what was answered and what finished).
 * Everything else the Inbox listed lives in the sidebar. Fed live by the store's websocket events.
 */
export function DashboardView({ onBack }: { onBack?: () => void }) {
  const me = useStore((s) => s.me)!;
  const agents = useStore((s) => s.agents);
  const teams = useTeams();
  const approvals = useStore((s) => s.approvals);
  const version = useStore((s) => s.tasksVersion);
  const flowsVersion = useStore((s) => s.flowsVersion);
  const backgroundVersion = useStore((s) => s.backgroundVersion);
  // each team's newest requests: a step that stopped waits on you
  const [teamFlows, setTeamFlows] = useState<Record<string, TeamFlow[]>>({});
  const teamChannelKey = teams.map((t) => t.channelId).join(",");
  useEffect(() => {
    let live = true;
    for (const id of teamChannelKey ? teamChannelKey.split(",") : [])
      api<TeamFlow[]>("GET", `/api/channels/${id}/flows`)
        .then((all) => live && setTeamFlows((prev) => ({ ...prev, [id]: all.slice(0, 5) })))
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [teamChannelKey, flowsVersion]);
  const features = useFeatures();
  const helpSeen = useHelpSeen();
  const putOff = usePutOff();
  const devices = useDevices();
  // null = not loaded or tasks are unavailable; Earlier shows what was answered without them
  const [tasks, setTasks] = useState<TaskLite[] | null>(null);

  useEffect(() => {
    if (!features.tasks) return setTasks(null);
    let off = false;
    api<TaskLite[]>("GET", "/api/tasks").then(
      (list) => !off && setTasks(Array.isArray(list) ? list : null),
      () => !off && setTasks(null),
    );
    return () => {
      off = true;
    };
  }, [version, features.tasks]);

  const isGuest = me.role === "guest";
  // every agent's open reminders, read again each minute: one that came due and nobody brought waits on you
  const [reminders, setReminders] = useState<Followup[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const agentKey = isGuest ? "" : agents.map((a) => a.id).join(",");
  useEffect(() => {
    if (!agentKey) return setReminders([]);
    let off = false;
    const load = () =>
      Promise.all(agentKey.split(",").map((id) => api<Followup[]>("GET", `/api/followups?agent=${encodeURIComponent(id)}`).catch(() => [] as Followup[]))).then((lists) => {
        if (off) return;
        const all = lists.flat();
        setReminders((cur) => (JSON.stringify(cur) === JSON.stringify(all) ? cur : all));
        setNow(Date.now());
      });
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [agentKey, backgroundVersion]);

  const waiting = useWaitingOnYou();
  // a request answered while the page is open stays where it was, as one quiet line, until the page is left
  const [held, setHeld] = useState<string[]>([]);
  const pendingKey = waiting.approvals.map((a) => a.id).join(",");
  useEffect(() => {
    setHeld((cur) => {
      const add = pendingKey.split(",").filter((id) => id && !cur.includes(id));
      return add.length ? [...cur, ...add] : cur;
    });
  }, [pendingKey]);
  const asks = isGuest ? [] : Object.values(approvals).filter((a) => a.status === "pending" || held.includes(a.id));
  // "Not now" on a help request puts it under Later (it stays in the chat and on Computers)
  const helpNow = waiting.help.filter((c) => !helpSeen.includes(helpKey(c)));
  const helpLater = waiting.help.filter((c) => helpSeen.includes(helpKey(c)));
  const stopped = teams.flatMap((t) => waitingOnYou(teamFlows[t.channelId] ?? []));
  const due = isGuest ? [] : dueReminders(reminders, me.user.id, now);
  const later = isGuest ? [] : laterReminders(reminders, me.user.id, putOff, now);
  const unready = isGuest ? [] : agents.flatMap((agent) => {
    const need = agentNeed(agent, devices);
    return need ? [{ agent, need }] : [];
  });
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "An agent";
  const count = asks.length + helpNow.length + stopped.length + due.length + unready.length;
  const laterCount = helpLater.length + later.length;
  const earlier = useEarlier(Object.values(approvals).filter((a) => !held.includes(a.id)), tasks);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0 px-4 md:px-8 pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-[max(56px,env(safe-area-inset-top))] pb-2 md:pb-3">
        <div className="mx-auto max-w-[520px] flex items-center gap-3">
          {onBack && (
            <button className="md:hidden! circle shrink-0" onClick={onBack} aria-label="Back">
              <ChevronRight size={22} className="rotate-180" aria-hidden />
            </button>
          )}
          <h1 className="text-[22px] md:text-[24px] leading-[30px] font-[650] tracking-[-0.01em]">Needs you</h1>
          {count > 0 && <span key={count} className="m-fade-in grid h-6 min-w-6 place-items-center rounded-full bg-st-needs/15 px-2 text-[13px] font-semibold tabular-nums text-st-needs">{count}</span>}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[584px] min-h-full px-4 md:px-8 pb-[max(2rem,env(safe-area-inset-bottom))] md:pb-10 flex flex-col">
          {count > 0 ? (
            <ul data-stagger data-tour="needs-you" aria-label="Needs you" className="flex flex-col divide-y divide-line">
              {asks.map((a) => (
                <ApprovalNeed key={a.id} approval={a} text={approvalLine(a, agentName(a.agentId))} />
              ))}
              {helpNow.map((c) => (
                <HelpNeed key={c.id} computer={c} text={helpLine(c, agentName(c.help!.agentId))} />
              ))}
              {stopped.map((n) => (
                <TeamNeed key={`${n.flow.id}-${n.lane.stepId}`} flow={n.flow} lane={n.lane} />
              ))}
              {due.map((f) => (
                <ReminderNeed key={f.id} reminder={f} />
              ))}
              {unready.map(({ agent, need }) => (
                <AgentNeed key={agent.id} agent={agent} need={need} />
              ))}
            </ul>
          ) : (
            <div className="flex-1 grid place-items-center py-16">
              <div data-tour="needs-you" className="flex flex-col items-center gap-3 text-center">
                <MotionMark size={88} mood="drift" />
                <div>
                  <p className="text-[17px] font-semibold leading-6">All caught up</p>
                  <p className="text-[15px] leading-6 text-muted">Nothing needs you.</p>
                </div>
              </div>
            </div>
          )}

          {(laterCount > 0 || earlier.length > 0) && (
            <div className="pt-3 flex flex-col">
              {laterCount > 0 && (
                <Fold label={`Later · ${laterCount}`} centred={count === 0}>
                  {helpLater.map((c) => (
                    <HelpNeed key={c.id} computer={c} text={helpLine(c, agentName(c.help!.agentId))} later />
                  ))}
                  {later.map((f) => (
                    <ReminderNeed key={f.id} reminder={f} later />
                  ))}
                </Fold>
              )}
              {earlier.length > 0 && (
                <Fold label="Earlier" centred={count === 0}>
                  {earlier.map((r) => (
                    <li key={r.key} className="flex items-start gap-3.5 py-2.5">
                      <span className="shrink-0 grid w-10 place-items-center">
                        <AgentAvatar agent={agents.find((a) => a.id === r.agentId)} size={28} interactive={false} />
                      </span>
                      <span className="min-w-0 flex-1 flex flex-col items-start">
                        <a href={r.to} className="text-sm leading-5 break-words rounded-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40">
                          {r.text}
                        </a>
                        <span className="max-w-full truncate text-[13px] leading-[18px] text-muted">{r.meta}</span>
                      </span>
                    </li>
                  ))}
                </Fold>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A quiet text button that opens its rows in place: "Later · 2", "Earlier". */
function Fold({ label, centred, children }: { label: string; centred: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cx("w-full flex flex-col", centred ? "items-center" : "items-start")}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={cx("h-9 rounded-full text-sm outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/40", open ? "text-ink" : "text-muted")}>
        {label}
      </button>
      {open && (
        <ul aria-label={label} className="w-full flex flex-col divide-y divide-line text-left">
          {children}
        </ul>
      )}
    </div>
  );
}

/** A team request that stands still at a step: the team's chat, at that request, has what can be done about it. */
function TeamNeed({ flow, lane }: { flow: TeamFlow; lane: FlowLane }) {
  const team = useStore((s) => s.channels.find((c) => c.id === flow.channelId));
  const to = { view: "chat", channelId: flow.channelId, threadId: flow.threadId } as const;
  return (
    <NeedRow avatar={<ChatAvatar chat={{ kind: "team", agent: null, channel: team ?? null }} size={36} />} text={stoppedLine(team?.settings.team?.steps ?? [], lane.stepId)} to={href(to)} meta={[team?.name ?? "A team", timeAgo(flow.updatedAt)]}>
      <div>
        <CardButton tone="primary" onClick={() => go(to)}>
          Open
        </CardButton>
      </div>
    </NeedRow>
  );
}

/** An agent that can't work until the person does one thing: the button does it, the sentence opens its chat. */
function AgentNeed({ agent, need }: { agent: Agent; need: NonNullable<ReturnType<typeof agentNeed>> }) {
  const chat = () => void openDm(agent.id);
  return (
    <NeedRow avatar={<AgentAvatar agent={agent} size={48} live />} text={need.text} onOpen={chat} meta={[agent.name]}>
      <div>
        <CardButton tone="primary" onClick={() => (need.href ? void (location.hash = need.href) : chat())}>
          {need.action}
        </CardButton>
      </div>
    </NeedRow>
  );
}

/** What you answered and what agents finished, newest first: one line each, who and when under it. */
function useEarlier(approvals: Approval[], tasks: TaskLite[] | null): { key: string; agentId: string | null; text: string; meta: string; to: string }[] {
  const me = useStore((s) => s.me)!;
  const agents = useStore((s) => s.agents);
  const members = useStore((s) => s.members);
  const prefs = usePrefs();
  const name = (id: string | null) => agents.find((a) => a.id === id)?.name ?? "An agent";
  const when = (at: string) => shortTime(Date.parse(at), prefs.clock);
  const decided = approvals
    .filter((a) => a.status !== "pending")
    .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt))
    .slice(0, 30)
    .map((a) => {
      const by = a.decidedBy && a.decidedBy !== me.user.id ? ` by ${members.find((m) => m.id === a.decidedBy)?.name ?? "someone"}` : "";
      const at = a.decidedAt ?? a.createdAt;
      return { key: a.id, agentId: a.agentId, at, text: approvalLine(a, name(a.agentId)), meta: [`${a.status === "approved" ? "Allowed" : "Not now"}${by}`, name(a.agentId), when(at)].join(" · "), to: href({ view: "chat", channelId: a.channelId, threadId: a.threadId }) };
    });
  const finished = (tasks ?? [])
    .filter((t) => t.status === "done")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 20)
    .map((t) => ({ key: t.id, agentId: t.toAgentId, at: t.updatedAt, text: t.title, meta: ["Finished", name(t.toAgentId), when(t.updatedAt)].join(" · "), to: t.channelId ? href({ view: "chat", channelId: t.channelId, threadId: t.threadId }) : href({ view: "tasks" }) }));
  return [...decided, ...finished].sort((a, b) => b.at.localeCompare(a.at));
}
