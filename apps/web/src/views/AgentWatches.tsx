import { useCallback, useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import type { Agent, Watch } from "@bubble-ai/core";
import { api } from "../api.ts";
import { CARD, Toggle } from "./AgentSections.tsx";
import { cx, timeAgo } from "../components/ui.tsx";

type WatchRow = Pick<Watch, "id" | "label" | "agentIds" | "paused" | "everyMinutes" | "lastPolledAt" | "lastError">;

/** "Every 15 min", "Every hour", "Every 3 hours". */
export function everyLine(minutes: number): string {
  if (minutes < 60) return `Every ${minutes} min`;
  const h = Math.round(minutes / 60);
  return h === 1 ? "Every hour" : `Every ${h} hours`;
}

/**
 * What it watches: each of your apps this agent keeps an eye on, with a switch to pause it and Stop.
 * Stop takes this agent off the watch; a watch nobody else is on goes away with it.
 */
export function AgentWatches({ agent, bare = false }: { agent: Pick<Agent, "id" | "name">; /** no heading: it is the page's own (the profile's Watches) */ bare?: boolean }) {
  const [watches, setWatches] = useState<WatchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const load = useCallback(() => {
    api<{ watches: WatchRow[] }>("GET", "/api/watches").then(
      (r) => setWatches(r.watches.filter((w) => w.agentIds.includes(agent.id))),
      () => setWatches([]),
    );
  }, [agent.id]);
  useEffect(load, [load]);

  const pause = async (w: WatchRow, paused: boolean) => {
    setError(null);
    setWatches((list) => list?.map((x) => (x.id === w.id ? { ...x, paused } : x)) ?? null);
    try {
      await api("PATCH", `/api/watches/${w.id}`, { paused });
    } catch (e) {
      setError((e as Error).message);
      load();
    }
  };
  const stop = async (w: WatchRow) => {
    if (confirm !== w.id) {
      setConfirm(w.id);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setConfirm(null), 3500);
      return;
    }
    setConfirm(null);
    setError(null);
    try {
      const rest = w.agentIds.filter((id) => id !== agent.id);
      if (rest.length) await api("PATCH", `/api/watches/${w.id}`, { agentIds: rest });
      else await api("DELETE", `/api/watches/${w.id}`);
      setWatches((list) => list?.filter((x) => x.id !== w.id) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section aria-label="What it watches" data-watches className="scroll-mt-3 space-y-2">
      {!bare && <h3 className="px-1 text-[13px] font-medium text-muted">What it watches</h3>}
      <div className={CARD}>
        {watches === null && <div className="flex min-h-[46px] items-center px-3.5 text-[13px] text-muted">Loading…</div>}
        {watches?.length === 0 && <div className="flex min-h-[46px] items-center px-3.5 text-[13px] text-muted">Nothing yet. Ask {agent.name} in chat to keep an eye on an app.</div>}
        {watches?.map((w) => (
          <div key={w.id} className="flex min-h-[54px] items-center gap-3 px-3.5 py-1.5">
            <Eye size={17} strokeWidth={1.8} className={cx("shrink-0 text-muted transition-opacity", w.paused && "opacity-50")} aria-hidden />
            <div className={cx("min-w-0 flex-1 transition-opacity", w.paused && "opacity-60")}>
              <div className="truncate text-[14px] font-medium">{w.label}</div>
              <div className={cx("truncate text-[12px]", w.lastError ? "text-st-needs" : "text-muted")}>{w.paused ? "Paused" : w.lastError ? w.lastError : `${everyLine(w.everyMinutes)}${w.lastPolledAt ? ` · looked ${timeAgo(w.lastPolledAt)}` : ""}`}</div>
            </div>
            <Toggle label={`Watch ${w.label}`} on={!w.paused} onChange={(on) => void pause(w, !on)} />
            <button type="button" onClick={() => void stop(w)} className={cx("h-8 shrink-0 rounded-full px-3 text-[13px] font-medium transition-colors", confirm === w.id ? "bg-bad text-white" : "text-bad hover:bg-hover")}>
              {confirm === w.id ? "Stop it" : "Stop"}
            </button>
          </div>
        ))}
      </div>
      {error && <p className="px-1 text-[13px] text-bad">{error}</p>}
    </section>
  );
}
