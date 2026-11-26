import { useEffect, useState } from "react";
import type { MessagePart } from "@bubble-ai/core";
import { api } from "../api.ts";
import { href } from "../router.ts";
import { useStore } from "../store.ts";
import { timeAgo, AgentAvatar } from "./ui.tsx";
import { CardButton, NeedRow } from "./InboxParts.tsx";
import { fixAction } from "./RunFailed.tsx";

/** A reply that failed and still stands (GET /api/runs/failed). */
export interface StandingFailure {
  runId: string;
  agentId: string;
  channelId: string;
  threadId: string | null;
  at: string;
  part: Extract<MessagePart, { type: "run_failed" }>;
}

/** Failed replies for Needs you, read again whenever an agent's status changes (a run ending does that). */
export function useStandingFailures(enabled: boolean): [StandingFailure[], () => void] {
  const statuses = useStore((s) => s.agents.map((a) => `${a.id}:${a.status}`).join(","));
  const [list, setList] = useState<StandingFailure[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return setList([]);
    let off = false;
    api<StandingFailure[]>("GET", "/api/runs/failed").then(
      (r) => !off && setList(Array.isArray(r) ? r : []),
      () => {},
    );
    return () => {
      off = true;
    };
  }, [enabled, statuses, tick]);
  return [list, () => setTick((n) => n + 1)];
}

/** The line Needs you shows for a failed reply: who and why. */
export function failedNeedText(name: string, part: Pick<StandingFailure["part"], "why">): string {
  const why = part.why?.trim();
  return why ? `${name} couldn't answer. ${why}` : `${name} couldn't answer.`;
}

/** A failed reply: why, and its one fix (Install, Sign in, Choose device, Try again). The sentence opens the chat. */
export function FailedNeed({ failure, onDone }: { failure: StandingFailure; onDone: () => void }) {
  const agent = useStore((s) => s.agents.find((a) => a.id === failure.agentId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { part } = failure;
  const action = fixAction(part);
  const chat = href({ view: "chat", channelId: failure.channelId, threadId: failure.threadId });
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const retry = () => api("POST", `/api/runs/${part.runId}/retry`);
  const button =
    action === "install" ? (
      <CardButton tone="primary" disabled={busy} onClick={() => void run(async () => (await api("POST", `/api/nodes/${part.nodeId}/install`, { harness: part.harness }), part.retry && (await retry())))}>
        {busy ? "Installing…" : "Install"}
      </CardButton>
    ) : action === "signin" ? (
      <CardButton tone="primary" onClick={() => (location.hash = part.fix === "computer" ? href({ view: "agents", agentId: failure.agentId, tab: "computer" }) : href({ view: "settings", page: "harnesses" }))}>
        Sign in
      </CardButton>
    ) : action === "device" ? (
      <CardButton tone="primary" onClick={() => (location.hash = href({ view: "agents", agentId: failure.agentId, tab: "device" }))}>
        Choose device
      </CardButton>
    ) : action === "retry" ? (
      <CardButton tone="primary" disabled={busy} onClick={() => void run(retry)}>
        Try again
      </CardButton>
    ) : (
      <CardButton tone="primary" onClick={() => (location.hash = chat)}>
        Open chat
      </CardButton>
    );
  return (
    <NeedRow avatar={<AgentAvatar agent={agent} size={48} live />} text={failedNeedText(agent?.name ?? "An agent", part)} to={chat} meta={[agent?.name, timeAgo(failure.at)]}>
      <div className="flex flex-wrap items-center gap-2">
        {button}
        {error && <span className="text-xs text-bad">{error}</span>}
      </div>
    </NeedRow>
  );
}
