import { useState } from "react";
import type { MessagePart } from "@bubble-ai/core";
import { api } from "../api.ts";
import { href } from "../router.ts";
import { useStore } from "../store.ts";
import { HarnessSignInButton } from "./HarnessSignInButton.tsx";

type Failed = Extract<MessagePart, { type: "run_failed" }>;
export type FixAction = "install" | "signin" | "device" | "retry" | null;

/**
 * The one button a failed run offers: Install when its harness is missing, Sign in when it's signed
 * out, Choose device when nothing can run it, else Try again (when asking again makes sense).
 */
export function fixAction(part: Pick<Failed, "fix" | "retry" | "nodeId" | "harness">): FixAction {
  if (part.fix === "install" && part.nodeId && part.harness) return "install";
  if (part.fix === "signin" || part.fix === "computer" || part.fix === "connection") return "signin";
  if (part.fix === "device") return "device";
  return part.retry ? "retry" : null;
}

/** The short reason shown on the line: the hub's plain line, or "Couldn't finish." for anything else. */
export function failedLine(part: Pick<Failed, "why">): string {
  return part.why?.trim() || "Couldn't finish.";
}

/**
 * A reply that failed: one muted line saying why ("Claude Code isn't installed on Mac mini."), and
 * one fix. The full error opens from the line. Installing tries the request again once it's done.
 */
export function RunFailed({ part, agentId, detail }: { part: Failed; agentId?: string; detail?: string }) {
  const [busy, setBusy] = useState<null | "install" | "retry">(null);
  const [sent, setSent] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = fixAction(part);
  // the agent's own sign-in opens right here when the hub knows how
  const signIn = useStore((s) => (agentId && action === "signin" && part.fix !== "connection" ? s.agents.find((a) => a.id === agentId)?.signIn : null));

  const retry = async () => {
    setBusy("retry");
    setError(null);
    try {
      await api("POST", `/api/runs/${part.runId}/retry`);
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const install = async () => {
    setBusy("install");
    setError(null);
    try {
      await api("POST", `/api/nodes/${part.nodeId}/install`, { harness: part.harness });
      if (part.retry) {
        await api("POST", `/api/runs/${part.runId}/retry`);
        setSent(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (sent) return <div className="mt-1 px-1 text-[14px] text-muted">Trying again…</div>;
  const link = "font-medium text-ink hover:underline disabled:opacity-50";
  const signInHref = part.fix === "computer" && agentId ? href({ view: "agents", agentId, tab: "computer" }) : href({ view: "settings", page: "harnesses" });
  const line = failedLine(part);
  return (
    <div className="mt-1 px-1 text-[14px] leading-5 text-muted" data-testid="run-failed">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {detail ? (
          <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className="text-left hover:text-ink">
            {line}
          </button>
        ) : (
          <span>{line}</span>
        )}
        {action === "install" && (
          <button type="button" disabled={!!busy} onClick={() => void install()} className={link}>
            {busy === "install" ? "Installing…" : "Install"}
          </button>
        )}
        {action === "signin" &&
          (signIn ? (
            <HarnessSignInButton signIn={signIn} agentId={agentId} />
          ) : (
            <a href={signInHref} className={link}>
              Sign in
            </a>
          ))}
        {action === "device" && agentId && (
          <a href={href({ view: "agents", agentId, tab: "device" })} className={link}>
            Choose device
          </a>
        )}
        {action === "retry" && (
          <button type="button" disabled={!!busy} onClick={() => void retry()} className={link}>
            Try again
          </button>
        )}
        {error && <span className="text-xs text-bad">{error}</span>}
      </div>
      {more && detail && <p className="mt-1 whitespace-pre-wrap text-xs">{detail}</p>}
    </div>
  );
}
