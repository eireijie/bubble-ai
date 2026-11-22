import { useEffect, useState } from "react";
import { Check, ChevronDown, MoreHorizontal } from "lucide-react";
import { stepAgentId, workSteps, type FlowLane, type TeamFlow, type TeamStep } from "@wisp/core";
import { TeamEditSession } from "./Session.tsx";
import { api } from "../api.ts";
import { href } from "../router.ts";
import { useStore } from "../store.ts";
import { Button, Menu, agentVar, cx } from "../components/ui.tsx";
import { chipActions, chipState, lanesOf, runningStepIds, type ChipState } from "./flow.ts";

type Decision = "approve" | "retry" | "stop" | "changes" | "allow";

const NONE: ReadonlySet<string> = new Set();

/** The steps a team's requests are working on right now (the builder outlines them in their agent's colour). */
export function useRunningSteps(channelId?: string): ReadonlySet<string> {
  const version = useStore((s) => s.flowsVersion);
  const [ids, setIds] = useState<ReadonlySet<string>>(NONE);
  useEffect(() => {
    if (!channelId) return;
    let live = true;
    api<TeamFlow[]>("GET", `/api/channels/${channelId}/flows`).then((all) => live && setIds(new Set(all.flatMap(runningStepIds))), () => {});
    return () => {
      live = false;
    };
  }, [channelId, version]);
  return channelId ? ids : NONE;
}

const CHIP_WORDS: Record<ChipState, string> = { done: "done", now: "on now", needs: "waiting on you", failed: "failed", skipped: "skipped", todo: "to come" };

/**
 * Where a request in a stepped team is, at the top of its thread: one thin row of small chips, a
 * chip for each step (the done ones with a check, the one on now lit in its agent's colour) and a
 * quiet Stop at the end. A step that waits on a person asks its question underneath with Allow and
 * Not now; Try again, Skip and that step's own Stop are in its chip's menu.
 */
export function FlowStrip({ channelId, threadId }: { channelId: string; threadId: string }) {
  const version = useStore((s) => s.flowsVersion);
  const team = useStore((s) => s.channels.find((c) => c.id === channelId)?.settings.team ?? null);
  const agents = useStore((s) => s.agents);
  const [flow, setFlow] = useState<TeamFlow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api<TeamFlow[]>("GET", `/api/channels/${channelId}/flows`)
      .then((all) => live && setFlow(all.find((f) => f.threadId === threadId) ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [channelId, threadId, version]);
  if (!flow || !team?.steps?.length) return null;
  const order = workSteps(team.steps);
  const lanes = lanesOf(flow);
  const number = (id: string) => order.findIndex((s) => s.id === id) + 1;

  const decide = async (action: Decision, stepId?: string, text?: string) => {
    setBusy(true);
    setError(null);
    try {
      setFlow(await api<TeamFlow>("POST", `/api/flows/${flow.id}/decide`, { action, ...(stepId ? { stepId } : {}), ...(text?.trim() ? { note: text.trim() } : {}) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chip = (s: TeamStep) => {
    const lane = lanes[s.id];
    const state = chipState(flow, lane);
    const rounds = flow.rounds[s.id] ?? 0;
    const label = s.action || `Step ${number(s.id)}`;
    const actions = chipActions(state, lane?.waitingFor);
    const agent = agents.find((a) => a.id === stepAgentId(team, s));
    const cls = cx(
      "inline-flex h-[22px] max-w-[12rem] items-center gap-1 rounded-full px-2 text-[11px] font-medium",
      state === "now" ? (agent ? "agent-tint agent-ink" : "bg-st-working/16 text-st-working") : state === "needs" ? "bg-st-needs/16 text-st-needs" : state === "failed" ? "bg-bad/12 text-bad" : state === "done" ? "bg-chip text-muted" : "bg-chip text-faint",
      state === "skipped" && "line-through opacity-60",
    );
    const inner = (
      <>
        {state === "done" && <Check size={11} strokeWidth={3} aria-hidden />}
        <span className="min-w-0 truncate">{label}</span>
        {rounds > 1 && <span className="shrink-0 tabular-nums">· {rounds}</span>}
        {actions.length > 0 && <ChevronDown size={11} className="shrink-0" aria-hidden />}
      </>
    );
    const words = `${label}, ${CHIP_WORDS[state]}${rounds > 1 ? `, round ${rounds}` : ""}`;
    if (!actions.length)
      return (
        <span key={s.id} title={words} className={cls} style={state === "now" && agent ? agentVar(agent) : undefined}>
          {inner}
        </span>
      );
    return (
      <Menu
        key={s.id}
        trigger={(open, toggle) => (
          <button type="button" onClick={toggle} disabled={busy} aria-expanded={open} aria-haspopup="menu" aria-label={words} title={words} className={cls}>
            {inner}
          </button>
        )}
        items={actions.map((a) => ({ label: a.label, onSelect: () => void decide(a.action, s.id) }))}
      />
    );
  };

  const waiting = order.filter((s) => lanes[s.id]?.status === "waiting" && lanes[s.id]?.waitingFor);
  return (
    <div className="space-y-1.5 border-b border-line px-4 py-1.5" aria-label="Team steps">
      <div className="flex flex-wrap items-center gap-1">
        {order.map(chip)}
        {flow.status === "failed" && <span className="ml-1 text-[11px] font-medium text-bad">Stopped</span>}
        {/* a running request can be stopped too: the hub cancels the work still open */}
        {flow.status === "running" && (
          <button type="button" disabled={busy} onClick={() => void decide("stop")} className="ml-auto h-[22px] px-1 text-[12px] text-faint hover:text-ink">
            Stop
          </button>
        )}
      </div>
      {waiting.map((s) => (
        <WaitingStep key={s.id} flow={flow} step={s} lane={lanes[s.id]!} busy={busy} decide={decide} />
      ))}
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}

/**
 * One step waiting on a person, as a question: why it waits, then Allow and Not now. Allow lets it
 * through; Not now sends it back (another round, or back to an earlier step with what should
 * change) or, where there is nowhere to send it, stops there. A step that failed has no question:
 * Try again, Skip and Stop are in its chip's menu (in Needs you, behind the "…" here).
 */
export function WaitingStep({ flow, step: s, lane, busy, decide, inInbox = false }: { flow: TeamFlow; step: TeamStep; lane: FlowLane; approvalId?: string; busy: boolean; decide: (action: Decision, stepId?: string, text?: string) => Promise<void> | void; inInbox?: boolean }) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [picking, setPicking] = useState(false);
  const channel = useStore((st) => st.channels.find((c) => c.id === flow.channelId));
  const w = lane.waitingFor!;
  const ask = w.options === "ask";
  const failed = !!w.failed;
  const more = inInbox ? chipActions(failed ? "failed" : "needs", w) : [];
  const SMALL = "h-7 px-3 text-xs";
  return (
    <div className="space-y-1.5" aria-label={`${s.action || "A step"}, waiting`}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <p className={cx("min-w-0 flex-1 basis-48 text-[13px] leading-5", failed ? "text-bad" : "text-ink")}>
          <span className="font-medium">{s.action || "A step"}</span>
          <span className={failed ? "" : "text-muted"}>
            {failed ? " failed. " : ": "}
            {w.why}
          </span>
        </p>
        {w.selfReview ? (
          <>
            <Button type="button" variant="primary" disabled={busy || !channel} onClick={() => setPicking(true)} className={SMALL}>
              Pick an agent
            </Button>
            <Button type="button" disabled={busy} onClick={() => void decide("allow", s.id)} className={SMALL}>
              Let {w.selfReview.agent} review
            </Button>
            {picking && channel && <TeamEditSession channel={channel} select={s.id} onClose={() => setPicking(false)} />}
          </>
        ) : failed ? null : (
          <>
            <Button type="button" variant="primary" disabled={busy} onClick={() => void decide("approve", s.id)} className={SMALL}>
              Allow
            </Button>
            {/* an ask-me step goes back with a note, or stops where it has nowhere to go back to; out of rounds, it goes round again */}
            {(ask || w.options === "rounds") && (
              <Button type="button" disabled={busy} onClick={() => (ask ? (s.sendBackTo ? setAsking(true) : void decide("stop", s.id)) : void decide("retry", s.id))} className={SMALL}>
                Not now
              </Button>
            )}
          </>
        )}
        {more.length > 0 && (
          <Menu
            align="right"
            trigger={(open, toggle) => (
              <button type="button" onClick={toggle} disabled={busy} aria-expanded={open} aria-haspopup="menu" aria-label="More" className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-hover hover:text-ink">
                <MoreHorizontal size={15} />
              </button>
            )}
            items={more.map((a) => ({ label: a.label, onSelect: () => void decide(a.action, s.id) }))}
          />
        )}
      </div>
      {asking && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void decide("changes", s.id, note);
            setAsking(false);
            setNote("");
          }}
        >
          <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change?" aria-label="What should change" maxLength={4000} className="h-8 min-w-48 flex-1 rounded-full border border-input bg-transparent px-3 text-xs outline-none focus:border-ring" />
          <Button type="submit" variant="primary" disabled={busy} className="h-8 text-xs">
            Send back
          </Button>
          <Button type="button" variant="ghost" onClick={() => setAsking(false)} className="h-8 text-xs">
            Cancel
          </Button>
        </form>
      )}
    </div>
  );
}

/** Steps of a team's newest request that wait on a person (ask-me steps have their own approval card). */
export function waitingOnYou(flows: TeamFlow[]): { flow: TeamFlow; lane: FlowLane }[] {
  const f = flows[0];
  if (!f || (f.status !== "waiting" && f.status !== "running")) return [];
  return Object.values(f.lanes ?? {})
    .filter((l) => l.status === "waiting" && l.waitingFor && l.waitingFor.options !== "ask")
    .map((lane) => ({ flow: f, lane }));
}

/** A stalled team in Needs you: the team, what was asked, the question and its answers, right there. */
export function TeamNeedCard({ flow, lane }: { flow: TeamFlow; lane: FlowLane }) {
  const team = useStore((s) => s.channels.find((c) => c.id === flow.channelId));
  const steps = team?.settings.team?.steps ?? [];
  const step = steps.find((s) => s.id === lane.stepId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (action: Decision, stepId?: string, text?: string) => {
    setBusy(true);
    setError(null);
    try {
      await api<TeamFlow>("POST", `/api/flows/${flow.id}/decide`, { action, ...(stepId ? { stepId } : {}), ...(text?.trim() ? { note: text.trim() } : {}) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!step) return null;
  return (
    <div className="rounded-2xl bg-card px-4 py-3.5 flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium leading-snug">{team?.name ?? "A team"} needs you</div>
          <a href={href({ view: "chat", channelId: flow.channelId, threadId: flow.threadId })} className="text-[13px] text-faint hover:underline truncate block">
            {flow.request.slice(0, 80)}
          </a>
        </div>
        <span role="img" aria-label="Needs you" className="shrink-0 size-2.5 rounded-full bg-st-needs" />
      </div>
      <WaitingStep flow={flow} step={step} lane={lane} busy={busy} decide={decide} inInbox />
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
