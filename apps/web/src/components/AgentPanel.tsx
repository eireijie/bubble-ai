import { useEffect, useRef, useState } from "react";
import { isTopOverlay, toBody, useOverlay } from "../overlays.ts";
import { Eye, Hand, Minimize2, Video } from "lucide-react";
import { harnessLabel, type Agent } from "@bubble-ai/core";
import { api } from "../api.ts";
import { useStore, type ComputerInfo } from "../store.ts";
import { useFeature } from "../features.ts";
import { go, href, type AgentTab } from "../router.ts";
import { agentReadiness, agentSignedIn, type DeviceInfo } from "../devices.ts";
import { useComputerState } from "../views/computerState.ts";
import { LiveScreen, WorkingBadge } from "./Screen.tsx";
import { AgentAvatar, Pill, cx } from "./ui.tsx";

/** What the chat asks to open about an agent: the agent itself ("details"), or one part of it. */
export type AgentPanelTab = "details" | "computer" | "thinks" | "can" | "asks" | "knows" | "more";

/** Where each of those lands in the agent's profile. */
export const PANEL_PROFILE_TAB: Record<AgentPanelTab, AgentTab> = { details: "overview", computer: "screen", thinks: "model", can: "apps", asks: "permissions", knows: "memory", more: "settings" };
/** A part by name; anything else (an old remembered tab) is the agent itself. */
export const panelSheet = (tab: string | null | undefined): AgentPanelTab => (tab && tab in PANEL_PROFILE_TAB ? (tab as AgentPanelTab) : "details");

// The side panel is gone: the profile pop-up opens instead. A panel a chat remembered from before
// would open the pop-up by itself on the next visit, so that memory goes.
try {
  if (typeof localStorage !== "undefined") localStorage.removeItem("wisp.agentPanel");
} catch {}

/**
 * The chat's way to open an agent (its header, its avatar, the composer's details, "…" items):
 * it opens the agent's profile pop-up on the matching tab or part, and hands the chat its pane back.
 */
export function AgentPanel({ agent, tab, onClose }: { agent: Agent; channelId?: string; tab?: AgentPanelTab; onClose: () => void; onSheet?: (tab: AgentPanelTab) => void; inDm?: boolean }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    go({ view: "agents", agentId: agent.id, tab: PANEL_PROFILE_TAB[panelSheet(tab)] });
    closeRef.current();
  }, [agent.id, tab]);
  return null;
}

/** The one thing to do about an unfinished helper, in plain words. Mirrors agentReadiness's order of checks; null when ready. */
export function setupNextStep(agent: Pick<Agent, "id" | "nodeId" | "harness" | "name" | "settings" | "computerId"> & Partial<Pick<Agent, "signIn">>, devices: DeviceInfo[] | null): { text: string; href: string; action: string } | null {
  if (agentReadiness(agent, devices).ready) return null;
  if (!agent.nodeId) return { text: `Choose the computer that runs ${agent.name}.`, href: href({ view: "agents", agentId: agent.id, tab: "device" }), action: "Choose a device" };
  const device = devices?.find((d) => d.id === agent.nodeId);
  if (!device) return null;
  if (!device.online) return { text: `Open Bubble AI on ${device.name} so it reconnects. Messages wait until then.`, href: href({ view: "computers", computerId: null }), action: "See computers" };
  if (device.paused) return { text: `${device.name} is paused. Resume it on that computer.`, href: href({ view: "computers", computerId: null }), action: "See computers" };
  if (agent.signIn) return { text: `Sign in to ${harnessLabel(agent.harness)} on ${agent.signIn.where} so ${agent.name} can answer.`, href: href(agent.signIn.computerId ? { view: "agents", agentId: agent.id, tab: "computer" } : { view: "settings", page: "harnesses" }), action: "Sign in" };
  if (agentSignedIn(agent, device) === false) {
    const inVm = agent.settings?.runIn === "computer" && !!agent.computerId;
    return { text: `Sign in to ${harnessLabel(agent.harness)} ${inVm ? `on ${agent.name}'s computer` : `on ${device.name}`} so ${agent.name} can answer.`, href: href(inVm ? { view: "agents", agentId: agent.id, tab: "computer" } : { view: "settings", page: "harnesses" }), action: "Sign in" };
  }
  return { text: `Install ${harnessLabel(agent.harness)} on ${device.name}.`, href: href({ view: "settings", page: "harnesses" }), action: "Install it" };
}

/** "Setup incomplete · my-mac is offline": what's still missing before it can answer. */
export function SetupIncomplete({ problem }: { problem: string | null }) {
  return <Pill tone="warn">{problem ? `Setup incomplete · ${problem}` : "Setup incomplete"}</Pill>;
}

// --- computer ------------------------------------------------------------------------------------

/**
 * The computer, big. Click the screen to take control; it's yours (blue ring) until you hand it
 * back, leave it alone for a while, or the agent needs it after you've stopped using it.
 */
export function ComputerFullscreen({ agent, computer: c, onClose }: { agent: Agent; computer: ComputerInfo; onClose: () => void }) {
  const me = useStore((s) => s.me);
  const state = useComputerState(c);
  const [error, setError] = useState<string | null>(null);
  const mine = !!me && c.controller?.id === me.user.id;
  const canControl = me?.role !== "guest" && c.online && !c.paused;
  const someoneElse = !!c.controller && !mine;
  const teach = useFeature("teach");
  const touched = useRef(0);

  const control = async (take: boolean) => {
    setError(null);
    try {
      await api("POST", `/api/computers/${c.id}/control`, { take, ...(c.screens ? { agent: agent.id } : {}) });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  // while you work on it, tell the hub now and then that you're still there (VNC input skips the hub)
  const activity = () => {
    if (Date.now() - touched.current < 15_000) return;
    touched.current = Date.now();
    void api("POST", `/api/computers/${c.id}/control`, { take: true, ...(c.screens ? { agent: agent.id } : {}) }).catch(() => {});
  };
  // leaving the big view gives the computer back, so agents aren't stuck waiting on a closed window
  const close = () => {
    if (mine) void api("POST", `/api/computers/${c.id}/control`, { take: false }).catch(() => {});
    onClose();
  };
  const overlayId = useRef(Symbol("screen")).current;
  useOverlay(overlayId, "screen");
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      // while in control, Escape belongs to the remote computer; a dialog over the screen takes it first
      if (e.key === "Escape" && !mine && isTopOverlay(overlayId)) close();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  return toBody(
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col p-3 md:p-5 safe-top safe-bottom" role="dialog" aria-modal="true" aria-label={`${c.name}'s screen`}>
      <div className="shrink-0 relative flex items-center gap-2 pb-3 min-h-11 text-white">
        <AgentAvatar agent={agent} size={26} live />
        <span className="font-medium truncate">{c.name}</span>
        {!mine && (state.working ? <WorkingBadge text={c.activity?.text ?? "Working"} /> : <Pill tone={state.tone}>{state.label}</Pill>)}
        {mine && (
          <div className="absolute left-1/2 top-0 -translate-x-1/2 inline-flex items-center gap-2 rounded-[8px] bg-info text-white pl-3.5 pr-1 h-9 text-sm font-medium shadow-panel" role="status">
            <Hand size={15} /> You are in control
            <button onClick={() => control(false)} className="h-7 px-3 rounded-[8px] bg-white/20 hover:bg-white/30 text-xs font-medium">
              Hand back
            </button>
          </div>
        )}
        {teach && canControl && !someoneElse && (
          <button onClick={() => go({ view: "computers", computerId: c.id, teach: agent.id })} className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-[8px] border border-white/20 text-sm font-medium hover:bg-white/10" title={`Do a task once while ${agent.name} watches; it saves it as a skill`}>
            <Video size={15} /> Teach a task
          </button>
        )}
        <button onClick={close} className={cx(!(teach && canControl && !someoneElse) && "ml-auto", "size-9 rounded-[8px] hover:bg-white/10 grid place-items-center")} aria-label="Exit full screen" title="Exit full screen">
          <Minimize2 size={18} />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <LiveScreen computer={c} control={mine} onTakeControl={canControl && !someoneElse ? () => void control(true) : undefined} onActivity={activity} agentId={c.screens ? agent.id : undefined} />
      </div>
      <div className="shrink-0 mt-3 text-center text-sm text-white/70 min-h-5">
        {c.help ? (
          <span>
            <span className="font-medium text-white">{agent.name} needs you:</span> {c.help.request}
            {mine ? " Hand back when you're done." : " Click the screen to take control."}
          </span>
        ) : mine ? (
          `${agent.name} gets it back if you hand it back or stop using it.`
        ) : someoneElse ? (
          state.label
        ) : canControl ? (
          <span className="inline-flex items-center gap-1.5">
            <Eye size={14} /> Watching · click the screen to take control
          </span>
        ) : null}
      </div>
      {error && <p className="shrink-0 mt-1 text-center text-sm text-bad">{error}</p>}
    </div>,
  );
}
