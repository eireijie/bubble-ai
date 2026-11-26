import { useState, type ComponentType, type ReactNode } from "react";
import { KeyRound } from "lucide-react";
import { SuggestionBanner } from "./SuggestionBanner.tsx";
import { Loader2, LogIn } from "lucide-react";
import { harnessLabel, type AgentSignIn, type HarnessSettings } from "@bubble-ai/core";
import { api } from "../api.ts";
import { go } from "../router.ts";
import { useStore } from "../store.ts";
import type { HarnessesResponse, HarnessSignIn as HarnessSignInDialog } from "../views/settings/harnesses.tsx";
import { cx } from "./ui.tsx";

/**
 * "Sign in" for a harness where it runs, right here: on a device it opens that harness's own
 * sign-in (link, code, paste box); inside an agent's own computer it starts the sign-in on that
 * computer's screen and takes you there to finish it. Works for any harness and any computer.
 */
export function HarnessSignInButton({ signIn, agentId, className, children, onOpenChange }: { signIn: AgentSignIn; agentId?: string; className?: string; children?: ReactNode; onOpenChange?: (open: boolean) => void }) {
  const refreshAgents = useStore((s) => s.refreshAgents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ Dialog: ComponentType<Parameters<typeof HarnessSignInDialog>[0]>; device: HarnessesResponse["device"]; settings: HarnessSettings; account: HarnessSettings["accounts"][number] } | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      if (signIn.computerId) {
        if (!agentId) throw new Error("open the agent's computer to sign in there");
        const r = await api<{ computerId: string }>("POST", `/api/agents/${agentId}/signin`);
        go({ view: "computers", computerId: r.computerId });
        return;
      }
      const r = await api<HarnessesResponse>("GET", `/api/nodes/${signIn.nodeId}/harness-settings?harness=${encodeURIComponent(signIn.harness)}&account=${encodeURIComponent(signIn.account)}`);
      const settings = r.harnesses.find((h) => h.harness === signIn.harness);
      const account = settings?.accounts.find((a) => a.id === signIn.account) ?? settings?.accounts.find((a) => a.isDefault) ?? settings?.accounts[0];
      if (!settings || !account) throw new Error(`${harnessLabel(signIn.harness)} isn't on ${signIn.where} anymore`);
      // the dialog lives with the Harnesses settings; loaded only when someone signs in
      const { HarnessSignIn } = await import("../views/settings/harnesses.tsx");
      setOpen({ Dialog: HarnessSignIn, device: r.device, settings, account });
      onOpenChange?.(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" disabled={busy} onClick={() => void start()} className={cx("h-8 px-3 rounded-full border border-control-line bg-control text-[13px] text-ink hover:bg-hover disabled:opacity-50 inline-flex shrink-0 items-center gap-1.5", className)}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />} {children ?? "Sign in"}
      </button>
      {error && <span className="text-xs text-bad">{error}</span>}
      {open && <open.Dialog device={open.device} settings={open.settings} account={open.account} onClose={() => (setOpen(null), onOpenChange?.(false))} onDone={() => void refreshAgents()} />}
    </>
  );
}

/** The line a chat shows while its agent can't answer because its harness isn't signed in where it runs. */
export function SignInNeededBar({ agent }: { agent: { id: string; name: string; signIn?: AgentSignIn | null } }) {
  // while its sign-in is open the bar stays, so the dialog isn't lost when the status changes under it
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<AgentSignIn | null>(agent.signIn ?? null);
  if (agent.signIn && agent.signIn !== last) setLast(agent.signIn);
  const [hidden, setHidden] = useState<AgentSignIn | null>(null);
  const signIn = agent.signIn ?? (open ? last : null);
  if (!signIn || (hidden === signIn && !open)) return null;
  return (
    <SuggestionBanner label="Sign-in needed" icon={<KeyRound size={17} strokeWidth={1.8} className="text-st-needs" />} text={`${harnessLabel(signIn.harness)} isn't signed in on ${signIn.where}, so ${agent.name} can't answer yet.`} onClose={() => setHidden(signIn)}>
      <HarnessSignInButton signIn={signIn} agentId={agent.id} onOpenChange={setOpen} />
    </SuggestionBanner>
  );
}
