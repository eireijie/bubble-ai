import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Clock, Flag, Plus, Share2, UserCheck } from "lucide-react";
import { stepOrder, type ChannelTeam, type TeamStep } from "@bubble-ai/core";
import { useStore } from "../store.ts";
import { AgentAvatar, Button, Modal, agentColor, cx } from "../components/ui.tsx";
import { whenText } from "./ScheduleForm.tsx";
import { ADD_KINDS, cardSentence, movingAfter, numberOf, rowInputs, stepRows, titleOf, type AddAt, type AddKind, KIND_MARK } from "./flow.ts";
import { kindsFor } from "./Canvas.tsx";
import { KindIcon, MessageChip, StepNum, agentOfStep, useHandoffName } from "./parts.tsx";

/** The lines between two rows of steps, with a + to put a step there (and "At the same time" where they split). */
function Connector({ from, to, plus, onAdd }: { from: number; to: number; plus: boolean; onAdd: () => void }) {
  const tall = from > 1 || to > 1;
  const h = tall ? 64 : 44;
  const xs = (n: number) => Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * 100);
  const a = xs(Math.max(from, 1));
  const b = xs(Math.max(to, 1));
  return (
    <div className="relative mx-auto w-full" style={{ height: h }}>
      <svg className="absolute inset-0 h-full w-full overflow-visible text-faint" viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" aria-hidden>
        {a.flatMap((x1) => b.map((x2) => <path key={`${x1}-${x2}`} d={x1 === x2 ? `M ${x1} 0 L ${x2} ${h}` : `M ${x1} 0 C ${x1} ${h / 2}, ${x2} ${h / 2}, ${x2} ${h}`} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />))}
      </svg>
      {to > 1 && <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-line bg-panel px-2.5 py-0.5 text-[12px] text-muted">At the same time</span>}
      {plus && (
        <button type="button" onClick={onAdd} aria-label="Add a step here" className="absolute left-1/2 top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-control-line bg-control shadow-panel">
          <Plus size={15} />
        </button>
      )}
    </div>
  );
}

/** One step as a row: whose it is (the agent's ghost and name) and what it does in a few words. */
function StepCard({ team, step, wide, problem, working, onOpen, onHold }: { team: ChannelTeam; step: TeamStep; wide: boolean; problem?: string; working: boolean; onOpen: () => void; onHold: () => void }) {
  // a long press offers Delete; the tap that ends it must not also open the step
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const held = useRef(false);
  const stop = () => clearTimeout(timer.current);
  const agents = useStore((s) => s.agents);
  const agent = agentOfStep(team, agents, step);
  const mark = KIND_MARK[step.kind];
  const handoff = useHandoffName(step.handoffTo);
  const plain = step.kind === "schedule" || step.kind === "ask" || step.kind === "handoff";
  const who = step.kind === "schedule" ? "Schedule" : step.kind === "ask" ? "You" : step.kind === "handoff" ? handoff : agent?.name;
  const words = step.kind === "schedule" ? (step.enabled === false ? "Off" : whenText(step)) : cardSentence(step);
  return (
    <button
      type="button"
      onClick={() => (held.current ? (held.current = false) : onOpen())}
      onPointerDown={() => {
        held.current = false;
        stop();
        timer.current = setTimeout(() => {
          held.current = true;
          onHold();
        }, 550);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => {
        e.preventDefault();
        stop();
        held.current = true;
        onHold();
      }}
      aria-label={`${step.kind === "schedule" ? `Schedule, ${whenText(step)}` : `Step ${numberOf(team, step.id)}, ${titleOf(step)}`}${working ? ", working now" : ""}${problem ? `. ${problem}` : ""}`}
      className={cx("flex min-w-0 select-none items-center gap-3 rounded-[14px] border bg-card p-3 text-left [-webkit-touch-callout:none]", wide ? "w-full" : "flex-1", problem ? "border-bad/50" : working ? "border-[1.5px]" : "border-transparent")}
      style={working ? { borderColor: agent ? agentColor(agent) : "var(--st-working)" } : undefined}
    >
      {plain ? (
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-chip text-muted" aria-hidden>
          {step.kind === "schedule" ? <Clock size={16} strokeWidth={1.8} /> : step.kind === "ask" ? <UserCheck size={16} strokeWidth={1.8} /> : <Share2 size={16} strokeWidth={1.8} />}
        </span>
      ) : agent ? (
        <AgentAvatar agent={agent} size={32} live={working} interactive={false} />
      ) : (
        <span className="size-8 shrink-0 rounded-full border border-dashed border-bad/60" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className={cx("block truncate text-[14px] font-semibold", !who && "text-bad")}>{who ?? "Pick an agent"}</span>
        <span className={cx("line-clamp-2 text-[13px] leading-[18px]", working ? "animate-pulse text-ink motion-reduce:animate-none" : "text-muted")}>{words}</span>
      </span>
      {mark && !plain && wide && (
        <span className="shrink-0 text-faint" aria-hidden>
          <KindIcon kind={step.kind} size={15} />
        </span>
      )}
    </button>
  );
}

/** The flow at phone width: top to bottom, steps that run together side by side. */
export function PhoneFlow({ team, problems, working, banner, onOpen, onHold, onAdd }: { team: ChannelTeam; problems: Map<string, string>; /** the steps a request is on right now */ working?: ReadonlySet<string>; banner: React.ReactNode; onOpen: (id: string) => void; onHold: (id: string) => void; onAdd: (at: AddAt) => void }) {
  const rows = stepRows(team.steps ?? []);
  const last = rows.at(-1) ?? [];
  // a schedule box heads the chart instead (its form says a message still starts the team)
  const scheduled = (team.steps ?? []).some((s) => s.kind === "schedule");
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 pb-6 pt-2">
      {banner}
      {!scheduled && <MessageChip />}
      {rows.map((row, i) => {
        const before = i === 0 ? 0 : rows[i - 1].length;
        return (
          <div key={i} className="flex w-full flex-col items-center">
            {(i > 0 || !scheduled) && <Connector from={before} to={row.length} plus={row.length === 1} onAdd={() => onAdd({ between: { from: rowInputs(row), to: row.map((s) => s.id) } })} />}
            <div className="flex w-full items-start gap-2.5">
              {row.map((s) => (
                <StepCard key={s.id} team={team} step={s} wide={row.length === 1} problem={problems.get(s.id)} working={!!working?.has(s.id)} onOpen={() => onOpen(s.id)} onHold={() => onHold(s.id)} />
              ))}
            </div>
          </div>
        );
      })}
      <Connector from={last.length} to={0} plus onAdd={() => onAdd({ between: { from: last.map((s) => s.id), to: [] } })} />
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] text-muted">
        <Flag size={13} aria-hidden /> Done
      </span>
    </div>
  );
}

/** Pick the kind of step to add; "After" says where when it isn't between two steps. */
export function AddStepSheet({ team, at, onPick, onClose }: { team: ChannelTeam; at: AddAt; onPick: (kind: AddKind, anchor: string | null) => void; onClose: () => void }) {
  const order = stepOrder(team.steps ?? []).filter((s) => s.kind !== "schedule");
  const [anchor, setAnchor] = useState<string | null>(at.after ?? order.at(-1)?.id ?? null);
  const kinds = kindsFor(order.length === 0, at);
  return (
    <Modal title="Add a step" onClose={onClose}>
      <div className="space-y-3">
        {!at.between && order.length > 0 && (
          <label className="flex items-center gap-3 text-body text-muted">
            After
            <select aria-label="After" value={anchor ?? ""} onChange={(e) => setAnchor(e.target.value)} className="h-10 min-w-0 flex-1 rounded-full border border-control-line bg-control px-3 text-ink">
              {order.map((s) => (
                <option key={s.id} value={s.id}>
                  {numberOf(team, s.id)}. {titleOf(s)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="overflow-hidden rounded-[14px] bg-card divide-y divide-line">
          {ADD_KINDS.filter((k) => kinds.includes(k.kind)).map((k) => (
            <button key={k.kind} type="button" title={k.blurb} onClick={() => onPick(k.kind, at.between ? null : anchor)} className="flex h-12 w-full items-center gap-3 px-4 text-left hover:bg-hover">
              <span className="shrink-0 text-muted">
                <KindIcon kind={k.kind === "agent" ? "do" : k.kind === "handOut" ? "hand_out" : k.kind === "beside" ? "beside" : k.kind} size={18} />
              </span>
              <span className="min-w-0 truncate text-body">{k.title}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Change the order steps happen in: a step moves up or down one place. */
export function ReorderSheet({ team, onChange, onClose }: { team: ChannelTeam; onChange: (t: ChannelTeam) => void; onClose: () => void }) {
  const order = stepOrder(team.steps ?? []).filter((s) => s.kind !== "schedule");
  return (
    <Modal title="Reorder steps" onClose={onClose}>
      <ol className="overflow-hidden rounded-3xl border border-line bg-card divide-y divide-line">
        {order.map((s, i) => (
          <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
            <StepNum n={i + 1} />
            <span className="min-w-0 flex-1 truncate text-body">{titleOf(s)}</span>
            <button type="button" disabled={i === 0} aria-label={`Move ${titleOf(s)} up`} onClick={() => onChange(movingAfter(team, s.id, i >= 2 ? order[i - 2].id : null))} className="circle circle-sm disabled:opacity-30">
              <ArrowUp size={16} />
            </button>
            <button type="button" disabled={i === order.length - 1} aria-label={`Move ${titleOf(s)} down`} onClick={() => onChange(movingAfter(team, s.id, order[i + 1].id))} className="circle circle-sm disabled:opacity-30">
              <ArrowDown size={16} />
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex justify-end">
        <Button type="button" variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
