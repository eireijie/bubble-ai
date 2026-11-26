import { runsInVm, type Agent, type GhostShape } from "@bubble-ai/core";
import type { GhostAppearance } from "@bubble-ai/core/src/appearance.ts";
import { api } from "../../api.ts";
import type { DeviceInfo } from "../../devices.ts";
import type { ComputerInfo } from "../../store.ts";
import { WHITE_WISP } from "../../components/onboarding/HostGhost.tsx";
import type { Askable } from "../../components/MemoryImport.tsx";
import { freeHandle } from "../CreateAgent.tsx";

/** The device's message when it has no Node.js (see NO_NODE in the node package). */
export const NO_NODE = /Node\.js isn't installed on this computer/;

/** The first run's ghost in one of its colours and shapes. */
export const lookOf = (color: string, shape: GhostShape): GhostAppearance => ({ ...WHITE_WISP, shape, color, color2: undefined });

/**
 * Make the first agent: on the model connection Bubble AI keeps for it when there is one (the hub hands
 * it to each run, wherever the agent works), else on the harness's own sign-in where it runs.
 * Installs a new harness on the device when requested. `greetLater` holds its hello until
 * POST /api/agents/:id/greet, so it can greet with what it was just told.
 */
export async function makeFirstAgent(device: DeviceInfo, harness: string, name: string, agents: Agent[], computers: ComputerInfo[], appearance?: GhostAppearance, connectionId?: string, opts: { greetLater?: boolean } = {}) {
  const installed = device.harnesses?.some((h) => h.id === harness);
  const canVm = device.role !== "headless" && device.role !== "screen" && !!device.capabilities?.vm.ok;
  const inVm = !installed && runsInVm(harness) && canVm;
  if (!installed && !inVm) {
    await api("POST", `/api/nodes/${device.id}/install`, { harness });
    await api("POST", `/api/nodes/${device.id}/refresh`).catch(() => {});
  }
  const common = {
    name,
    handle: freeHandle(
      name,
      agents.map((a) => a.handle),
    ),
    harness,
    nodeId: device.id,
    ...(opts.greetLater ? { greet: "later" } : {}),
  };
  const look = { ...(appearance ? { appearance } : {}), ...(connectionId ? { connectionId } : {}) };
  if (inVm) {
    // an AI that only runs inside a computer gets one of its own, with the AI in it
    let computer = computers.find((c) => c.kind === "vm" && c.nodeId === device.id && !c.agents.length);
    if (!computer) computer = await api<ComputerInfo>("POST", "/api/computers", { kind: "vm", nodeId: device.id, name: `${name}'s desk`, cpus: 2, memoryGb: 4 });
    return api<Agent>("POST", "/api/agents", { ...common, computerId: computer.id, settings: { runIn: "computer", ...look } });
  }
  // otherwise Bubble AI places it: the AI stays beside its sign-in, and it works on the shared computer
  return api<Agent>("POST", "/api/agents", { ...common, useDefaults: true, settings: look });
}

/** What "Your agent" asks for: its name, its look, and the one line of what it does. */
export interface AgentShape {
  name: string;
  role: string;
  appearance: GhostAppearance;
  instructions: string;
}

/**
 * "Your agent" → Continue: the agent the person just named exists from here on, whatever happens
 * on "Its AI". Nothing is installed and nobody is signed in yet: it starts on `harness` (what was
 * found, or a guess the next screen replaces) where Bubble AI places it, and holds its hello
 * (`greet: "later"`) until its AI is chosen.
 */
export function makeNamedAgent(shape: AgentShape, harness: string, device: DeviceInfo | undefined, agents: Pick<Agent, "handle">[]): Promise<Agent> {
  return api<Agent>("POST", "/api/agents", {
    name: shape.name,
    handle: freeHandle(
      shape.name,
      agents.map((a) => a.handle),
    ),
    harness,
    ...(device ? { nodeId: device.id } : {}),
    useDefaults: true,
    greet: "later",
    instructions: shape.instructions,
    settings: { appearance: shape.appearance, ...(shape.role ? { role: shape.role } : {}) },
  });
}

/** Back on "Your agent" with the agent already made: a new name, look or job is saved to it (its handle follows its name). */
export async function renameNamedAgent(agent: Pick<Agent, "id" | "name" | "handle">, shape: AgentShape, agents: Pick<Agent, "id" | "handle">[]): Promise<void> {
  const renamed = shape.name !== agent.name;
  await api("PATCH", `/api/agents/${agent.id}`, {
    ...(renamed
      ? {
          name: shape.name,
          handle: freeHandle(
            shape.name,
            agents.filter((a) => a.id !== agent.id).map((a) => a.handle),
          ),
        }
      : {}),
    instructions: shape.instructions,
    settings: { appearance: shape.appearance, role: shape.role || undefined },
  });
}

/**
 * "Its AI": point the agent that already exists at the AI just chosen, the way a new one is made.
 * A harness that isn't on the device is installed there, or, when it only runs inside a computer,
 * the agent gets one of its own with the AI in it.
 */
export async function pointAgentAt(agent: Pick<Agent, "id" | "name" | "nodeId">, device: DeviceInfo, harness: string, connectionId: string | null, computers: ComputerInfo[]): Promise<void> {
  const installed = device.harnesses?.some((h) => h.id === harness);
  const canVm = device.role !== "headless" && device.role !== "screen" && !!device.capabilities?.vm.ok;
  const inVm = !installed && runsInVm(harness) && canVm;
  if (!installed && !inVm) {
    await api("POST", `/api/nodes/${device.id}/install`, { harness });
    await api("POST", `/api/nodes/${device.id}/refresh`).catch(() => {});
  }
  // made before any computer had connected: it works on this one now
  const where = agent.nodeId ? {} : { nodeId: device.id };
  if (inVm) {
    let computer = computers.find((c) => c.kind === "vm" && c.nodeId === device.id && (!c.agents.length || c.agents.includes(agent.id)));
    if (!computer) computer = await api<ComputerInfo>("POST", "/api/computers", { kind: "vm", nodeId: device.id, name: `${agent.name}'s desk`, cpus: 2, memoryGb: 4 });
    await api("PATCH", `/api/agents/${agent.id}`, { harness, nodeId: device.id, computerId: computer.id, settings: { runIn: "computer", connectionId } });
    return;
  }
  await api("PATCH", `/api/agents/${agent.id}`, { harness, ...where, settings: { connectionId } });
}

/** Claude Code or Codex on the person's computer, signed in through Bubble AI, can be asked for them. */
export function askableOn(device: DeviceInfo | undefined, ready: { harness: string; connectionId: string | null }[]): Askable[] {
  if (!device?.mine) return [];
  // the hub asks with the person's connection when there is one, else the device's own sign-in
  const here = ["claude-code", "codex"].filter((id) => device.harnesses?.some((h) => h.id === id));
  const connected = (id: string) => ready.some((r) => r.harness === id && r.connectionId);
  return [...here.filter(connected), ...here.filter((id) => !connected(id))].map((harness) => ({ harness, nodeId: device.id, device: device.name }));
}
