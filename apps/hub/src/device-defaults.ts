import type { Agent } from "@bubble-ai/core";
import type { Hub } from "./hub.ts";

/**
 * "Use my computers" on by default for the owner's own devices: once an owner's computer turns its
 * screen on (the desktop app does that after its first run), the agents that owner made may use it
 * and say so afterwards ("tell"), and so does every agent they make later. Only the owner's own
 * agents, only the owner's own devices, and only once per device: turning it off for an agent on
 * its Computer page (Use my computers) stays off.
 */

const doneKey = (nodeId: string) => `devices.defaultUse.${nodeId}`;

/** The workspace owner's devices whose screen agents can use now, or that already had their default. */
function ownerDevices(hub: Hub, workspaceId: string, personId: string): string[] {
  const { store } = hub;
  if (store.role(workspaceId, personId) !== "owner") return [];
  return store
    .nodes(workspaceId)
    .filter((n) => n.ownerId === personId && (screenOn(hub, n.id) || store.setting(workspaceId, doneKey(n.id)) === "true"))
    .map((n) => n.id);
}

function screenOn(hub: Hub, nodeId: string): boolean {
  const screen = hub.store.nodeCapabilities(nodeId)?.screen;
  return !!screen?.ok && !screen.off;
}

/**
 * Whose agent this is for the default: the person who made it. One made before that was kept (or by
 * another agent) counts as the owner's only where the owner is the only person, so nobody else's
 * agent gets the owner's device by default.
 */
function madeBy(hub: Hub, agent: Agent, ownerId: string): boolean {
  const maker = agent.settings.createdBy;
  if (maker) return maker === ownerId;
  const people = hub.store.members(agent.workspaceId);
  return people.length === 1 && people[0].id === ownerId;
}

/** For an agent being made by `personId`: the devices it may use from the start. */
export function newAgentDeviceUse(hub: Hub, workspaceId: string, personId: string): Record<string, "tell"> {
  return Object.fromEntries(ownerDevices(hub, workspaceId, personId).map((id) => [id, "tell" as const]));
}

/**
 * A device reported its screen on: the first time, the owner's agents get it ("tell"). Returns the
 * agents it changed. Safe to call on every capabilities report.
 */
export function defaultDeviceUse(hub: Hub, nodeId: string): string[] {
  const { store } = hub;
  const node = store.node(nodeId);
  if (!node?.ownerId || !screenOn(hub, nodeId)) return [];
  const ws = node.workspaceId;
  if (store.setting(ws, doneKey(nodeId)) === "true") return [];
  if (store.role(ws, node.ownerId) !== "owner") return [];
  store.setSetting(ws, doneKey(nodeId), "true");
  const changed: string[] = [];
  for (const a of store.agents(ws)) {
    if (!madeBy(hub, a, node.ownerId) || a.settings.useDevices?.[nodeId]) continue;
    store.updateAgent(a.id, { settings: { ...a.settings, useDevices: { ...(a.settings.useDevices ?? {}), [nodeId]: "tell" } } });
    changed.push(a.id);
  }
  if (changed.length) hub.broadcast(ws, { type: "agents_changed" });
  return changed;
}
