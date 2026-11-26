import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight } from "lucide-react";
import { describeFlow, type ChannelTeam, type FlowLine, type TeamStep } from "@bubble-ai/core";
import { useStore } from "../store.ts";
import { cx } from "../components/ui.tsx";
import { KindIcon, StepNum, useIsPhone } from "./parts.tsx";
import { stepRows, titleOf } from "./flow.ts";

/** How a team works, one plain line per step, with real agent and team names. */
export function useFlowLines(team: ChannelTeam): FlowLine[] {
  const agents = useStore((s) => s.agents);
  const channels = useStore((s) => s.channels);
  return useMemo(
    () =>
      describeFlow(
        team,
        (id) => agents.find((a) => a.id === id)?.name ?? "Someone",
        (cid) => channels.find((c) => c.id === cid)?.name ?? "another",
      ),
    [team, agents, channels],
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One line: "2. At the same time, Ghosty researches the options." with the name in bold. */
export function HowLine({ line, numbered = true, big = false, plain = false }: { line: FlowLine; numbered?: boolean; big?: boolean; plain?: boolean }) {
  return (
    <li className={cx("flex items-start gap-3", big ? "text-body" : "text-body")}>
      {plain && <b className="w-5 shrink-0 text-right font-medium tabular-nums text-ink">{line.n > 0 && `${line.n}.`}</b>}
      {numbered && !plain && line.n > 0 && (
        <span className="mt-px">
          <StepNum n={line.n} size={big ? 26 : 22} />
        </span>
      )}
      <span className="min-w-0 leading-snug text-muted">
        {line.together ? "At the same time, " : ""}
        <b className="font-medium text-ink">{line.together ? line.who : cap(line.who)}</b> {line.rest}.
      </span>
    </li>
  );
}

export function HowLines({ lines, big, plain }: { lines: FlowLine[]; big?: boolean; plain?: boolean }) {
  if (!lines.length) return null;
  return (
    <ol className={cx(plain ? "space-y-2" : "space-y-3.5", big && "space-y-4")} aria-label="How it works">
      {lines.map((l) => (
        <HowLine key={l.stepId} line={l} big={big} plain={plain} />
      ))}
    </ol>
  );
}

/** The team's steps as small boxes, left to right, steps that run together stacked. It shrinks to fit the room it has. */
export function MiniChart({ steps, className }: { steps: Omit<TeamStep, "x" | "y">[]; className?: string }) {
  const rows = useMemo(() => stepRows(steps as unknown as TeamStep[]) as unknown as Omit<TeamStep, "x" | "y">[][], [steps]);
  const vertical = useIsPhone();
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ k: 1, h: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const o = outer.current;
      const i = inner.current;
      if (!o || !i) return;
      const k = Math.min(1, o.clientWidth / Math.max(1, i.scrollWidth));
      setFit((f) => (Math.abs(f.k - k) < 0.005 && f.h === i.offsetHeight ? f : { k, h: i.offsetHeight }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outer.current) ro.observe(outer.current);
    return () => ro.disconnect();
  }, [rows, vertical]);
  if (vertical)
    return (
      <div className={cx("flex flex-col items-center gap-1.5 py-1", className)} aria-label="The chart" role="img">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            {i > 0 && <ArrowDown size={14} className="text-faint" aria-hidden />}
            <div className="flex flex-wrap justify-center gap-2">
              {row.map((s) => (
                <div key={s.id} className="flex flex-col items-center">
                  <div className="flex h-9 max-w-[200px] items-center gap-2 rounded-[8px] bg-chip px-3 text-[13px] font-medium">
                    <span className="text-muted">
                      <KindIcon kind={s.kind === "do" ? "do" : s.kind} size={14} />
                    </span>
                    <span className="truncate">{titleOf(s)}</span>
                  </div>
                  {s.kind === "review" && <span className="mt-0.5 text-[11px] text-muted">until approved</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  return (
    <div ref={outer} className={cx("w-full overflow-hidden", className)} style={fit.h ? { height: fit.h * fit.k } : undefined} aria-label="The chart" role="img">
      <div ref={inner} className="flex w-max origin-top-left items-center gap-2 py-1" style={{ transform: `scale(${fit.k})` }}>
        {rows.map((row, i) => (
          <div key={i} className="flex shrink-0 items-center gap-2">
            {i > 0 && <ArrowRight size={14} className="text-faint" aria-hidden />}
            <div className="flex flex-col gap-2">
              {row.map((s) => (
                <div key={s.id}>
                  <div className="flex h-10 max-w-[190px] items-center gap-2 rounded-[8px] bg-chip px-3 text-[13px] font-medium">
                    <span className="text-muted">
                      <KindIcon kind={s.kind === "do" ? "do" : s.kind} size={14} />
                    </span>
                    <span className="truncate">{titleOf(s)}</span>
                  </div>
                  {s.kind === "review" && <span className="mt-1 block px-2 text-[11px] text-muted">until approved</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The lines as text to paste somewhere else: "1. Juno drafts the plan." */
export const linesText = (lines: FlowLine[]): string => lines.map((l) => (l.n ? `${l.n}. ${l.text}` : l.text)).join("\n");
