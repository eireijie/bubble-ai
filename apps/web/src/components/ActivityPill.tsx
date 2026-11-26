import type { Agent } from "@bubble-ai/core";
import { api } from "../api.ts";
import { useStore, type LiveRun } from "../store.ts";
import { describeTool } from "./AgentCards.tsx";
import { AgentAvatar, cx } from "./ui.tsx";
import { activityPhrase, runStartedAt, workKind } from "./agentActivity.ts";

/** What one live run is doing, in plain words: "searching memory", or "asking Chief" for a hand-off. */
export function runActivity(run: LiveRun, agents: Agent[]): string {
  if (run.last) {
    const handoff = describeTool(run.last.name, run.last.input, agents);
    if (handoff.with.length) return handoff.text.replace(/…$/, "").replace(/^./, (c) => c.toLowerCase());
  }
  return activityPhrase(run.last?.name, !!run.text);
}

/** "Editing files: notes/release.md", "Reading main.ts", or just "Thinking". */
export function workDetail(run: LiveRun, agents: Agent[]): string {
  const base = runActivity(run, agents).replace(/^./, (c) => c.toUpperCase());
  const inp = (run.last?.input ?? {}) as Record<string, unknown>;
  const path = [inp.file_path, inp.path, inp.filename, inp.file].find((v) => typeof v === "string") as string | undefined;
  const kind = run.last ? workKind(run.last.name) : null;
  return path && (kind === "edit" || kind === "read") ? `${base}: ${path.split("/").slice(-2).join("/")}` : base;
}

/** Stop every run an agent has going here. */
export function stopRuns(runs: LiveRun[]) {
  return Promise.all(runs.map((r) => api("POST", `/api/runs/${r.runId}/cancel`).catch(() => {})));
}

/**
 * Above the composer while agents work here: their ghosts and one line of what is happening now,
 * "Atlas is editing files". A ghost (or the line) opens that agent's panel, which has its Stop;
 * the composer's round button stops everyone working here.
 */
export function ActivityPill({ runs, onDetails }: { runs: LiveRun[]; onDetails: (agentId: string) => void }) {
  const agents = useStore((s) => s.agents);
  // one ghost per agent; its newest run says what it's doing
  const byAgent = new Map<string, LiveRun>();
  for (const r of runs) {
    runStartedAt(r.runId); // start its clock the first time it shows up
    byAgent.set(r.agentId, r);
  }
  const working = [...byAgent.entries()].map(([agentId, run]) => ({ agentId, agent: agents.find((a) => a.id === agentId), run }));
  if (!working.length) return null;
  const [first, ...others] = working;
  const firstName = first.agent?.name ?? "An agent";
  const rest = others.length ? (others.length === 1 ? (others[0].agent?.name ?? "1 more") : `${others[0].agent?.name ?? "someone"} +${others.length - 1}`) : null;
  return (
    <div className="flex max-w-full items-center gap-2 text-[13px] leading-5 text-muted">
      <span className="flex shrink-0">
        {working.slice(0, 3).map((w, i) => (
          <button key={w.agentId} type="button" onClick={() => onDetails(w.agentId)} aria-label={`${w.agent?.name ?? "An agent"} is ${runActivity(w.run, agents)}. Open details`} className={cx("rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", i > 0 && "-ml-1.5")}>
            <AgentAvatar agent={w.agent} size={20} live interactive={false} />
          </button>
        ))}
      </span>
      <button type="button" onClick={() => onDetails(first.agentId)} className="min-w-0 truncate rounded-md outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring">
        <span className="font-medium text-ink">{firstName}</span> is {runActivity(first.run, agents)}
        {rest && ` · ${rest}`}
      </button>
    </div>
  );
}
