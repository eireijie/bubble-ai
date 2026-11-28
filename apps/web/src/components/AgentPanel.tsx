import { useEffect, useRef } from "react";
import { harnessLabel, type Agent } from "@bubble-ai/core";
import type { ComputerInfo } from "../store.ts";
import { go, href, type AgentTab } from "../router.ts";
import { agentReadiness, agentSignedIn, type DeviceInfo } from "../devices.ts";
import { ComputerWindow } from "../views/AgentShort.tsx";
import { Pill } from "./ui.tsx";

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
 * The computer, big (board 13): the same black stage as the profile's Computer, filling the window.
 * Watching first; Take control, then "Give back"; leaving hands it back.
 */
export function ComputerFullscreen({ agent, computer, onClose }: { agent: Agent; computer: ComputerInfo; onClose: () => void }) {
  return <ComputerWindow agent={agent} computer={computer} onClose={onClose} />;
}
