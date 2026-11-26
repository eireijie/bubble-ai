import type { Agent, Approval, Computer } from "@bubble-ai/core";
import type { GhostMood } from "./components/Ghost.tsx";

export type MoodAgent = { id?: string; status?: Agent["status"]; computerId?: string | null; settings?: Pick<Agent["settings"], "runIn"> };

/**
 * Is the agent's work blocked by its computer? Only when its AI tool runs inside that computer
 * (a VM): then it can't answer at all. An agent whose AI tool runs on its device keeps chatting
 * while a computer it uses now and then won't start, so a broken shared computer doesn't make
 * every agent look sick.
 */
export function blockedByComputer(agent: MoodAgent, computer: Computer | undefined): boolean {
  return computer?.status === "error" && agent.settings?.runIn === "computer" && computer.kind === "vm";
}

/** Offline wins; requests and failures stay visible until their underlying state clears. */
export function agentMood(agent: MoodAgent | undefined, approvals: Record<string, Approval>, computers: (Computer & { paused?: boolean })[]): GhostMood {
  if (!agent) return "awake";
  const computer = agent.computerId ? computers.find((c) => c.id === agent.computerId) : undefined;
  if (agent.status === "offline" || computer?.paused) return "asleep";
  if (agent.id && Object.values(approvals).some((a) => a.agentId === agent.id && a.status === "pending")) return "waiting";
  if (blockedByComputer(agent, computer)) return "error";
  return agent.status === "busy" ? "working" : "awake";
}
