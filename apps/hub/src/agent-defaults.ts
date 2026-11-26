import { accountsSignedIn, preferSignedIn } from "@bubble-ai/core";
import type { Store } from "./store.ts";

/**
 * What "Use my defaults" in New agent fills in: a harness, a model, the device it runs on, and its
 * computer: that device directly (the default once a device is connected; "none" before), the
 * shared one, its own VM, or none. The shared computer is only made when an agent is put on it
 * (shared-computer.ts), so nothing starts a VM until someone asks for one.
 */
export interface AgentDefaults {
  harness: string | null;
  model: string | null;
  computer: AgentComputerDefault;
  nodeId: string | null;
  /** A default model for each AI tool (harness id to model id); a tool left out uses `model` when it is the default tool, else its own default. */
  models: Record<string, string>;
}

/** "device": the agent works on its device directly (no VM); "none": no computer at all. */
export type AgentComputerDefault = "device" | "shared" | "own-vm" | "none";

const KEY = "agents.defaults";

/** What an owner saved in Settings, as it was stored (fields left out aren't chosen). */
export function savedAgentDefaults(store: Store, workspaceId: string): Partial<AgentDefaults> {
  try {
    const v = JSON.parse(store.setting(workspaceId, KEY) ?? "null");
    return v && typeof v === "object" ? (v as Partial<AgentDefaults>) : {};
  } catch {
    return {};
  }
}

export function saveAgentDefaults(store: Store, workspaceId: string, patch: Partial<Omit<AgentDefaults, "models">> & { models?: Record<string, string | null> }) {
  const saved = savedAgentDefaults(store, workspaceId);
  const { models: change, ...rest } = patch;
  const models = { ...(saved.models ?? {}) };
  for (const [harness, model] of Object.entries(change ?? {})) {
    if (model) models[harness] = model;
    else delete models[harness];
  }
  const next = { ...saved, ...rest, ...(change ? { models } : {}) };
  store.setSetting(workspaceId, KEY, JSON.stringify(next));
}

/**
 * The defaults for a new agent: what the owner saved, and for anything not saved, what the most
 * recently made agent uses (else the first signed-in harness a device offers), on a device that can run VMs.
 */
export function agentDefaults(store: Store, workspaceId: string): AgentDefaults {
  const saved = savedAgentDefaults(store, workspaceId);
  const nodes = store.nodes(workspaceId);
  const known = (nodeId: string | null | undefined) => !!nodeId && nodes.some((n) => n.id === nodeId);
  const canRunVms = (nodeId: string) => !!store.nodeCapabilities(nodeId)?.vm.ok;
  const latest = store.agents(workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const nodeId = known(saved.nodeId) ? saved.nodeId! : known(latest?.nodeId) ? latest!.nodeId! : (nodes.find((n) => canRunVms(n.id)) ?? nodes[0])?.id ?? null;
  // a tool that's signed in beats one that would fail its first run; "can't tell" beats "signed out".
  // Its device says first; another device's sign-in counts when its own can't tell.
  const offered = [...(nodeId ? [nodeId] : []), ...nodes.map((n) => n.id)].flatMap((id) => store.nodeCatalog(id));
  const signedIn = (harness: string) => {
    const here = nodeId ? accountsSignedIn(store.nodeCatalog(nodeId).find((h) => h.harness === harness)?.accounts) : null;
    return here ?? (offered.some((h) => h.harness === harness && accountsSignedIn(h.accounts) === true) ? true : null);
  };
  // the person's own pick (saved, else the one made at first-run setup, else the latest) stays, unless
  // no device has it installed while one has another, or it's known to be signed out and another is signed in
  const installed = (harness: string) => offered.some((h) => h.harness === harness);
  const first = store.agents(workspaceId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const picks = [...(saved.harness ? [saved.harness] : []), ...(saved.harness === undefined ? [first?.harness, latest?.harness] : [])].filter((h): h is string => !!h);
  const wanted = offered.length ? (picks.find(installed) ?? null) : (picks[0] ?? null);
  const candidates = [...(wanted ? [wanted] : []), ...offered.map((h) => h.harness)];
  const best = preferSignedIn(candidates, signedIn);
  const harness = wanted && !(signedIn(wanted) === false && best && signedIn(best) === true) ? wanted : (best ?? null);
  const model = saved.model !== undefined ? saved.model : latest && latest.harness === harness ? latest.model : null;
  // nothing saved: work on the device directly once there is one, else without a computer
  const computer: AgentComputerDefault = saved.computer ?? (nodeId ? "device" : "none");
  return { harness, model, computer, nodeId, models: saved.models ?? {} };
}

/**
 * Where a new agent works, from the defaults' choice: the shared computer only for an owner's
 * agent (a member's gets one of its own, so it never has the owner's sign-ins); "device" means
 * its device directly, with no computer made.
 */
export function newAgentComputer(choice: AgentComputerDefault, forOwner: boolean): AgentComputerDefault {
  return choice === "shared" && !forOwner ? "own-vm" : choice;
}
