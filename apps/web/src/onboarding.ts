import { useEffect } from "react";
import { create } from "zustand";
import { FEATURE_PRESETS, type Agent, type DeviceRole, type Features } from "@bubble-ai/core";
import { harnessInfo, harnessLabel, runsInVm } from "@bubble-ai/core/src/harnesses.ts";
import { api } from "./api.ts";
import { accessSkipped, onPublicAddress, type AccessInfo } from "./access.ts";
import { keep, sameData, useStore } from "./store.ts";
import { agentReadiness, agentSignedIn, type DeviceInfo } from "./devices.ts";
import type { Route } from "./router.ts";

export interface OnboardingState {
  /** `mine`: you connected it; `role`: what it does for agents, once someone chose */
  devices: { id: string; name: string; online: boolean; mine: boolean; role: DeviceRole | null }[];
  computers: { id: string; name: string; kind: "vm" | "orgo"; nodeId: string | null; status: string }[];
  agents: Agent[];
  firstReply: { id: string; channelId: string; agentId: string } | null;
  memoryNotes: { path: string; title: string }[];
  /** the hub has an address that works from anywhere (Tailscale serving it) */
  reachable?: boolean;
}

/** What setup keeps track of, in order. The first run is three screens now (you, your agent, its AI) and marks all four once the agent exists. */
export const STEPS = ["anywhere", "address", "agent", "devices"] as const;
export type StepId = (typeof STEPS)[number];
export type SetupChoices = Partial<Record<StepId, boolean>>;
const useSetupRevision = create<{ revision: number }>(() => ({ revision: 0 }));
const setupKey = (workspaceId: string) => `wisp.setup.v2.${workspaceId}`;

export function savedSetup(workspaceId: string): SetupChoices {
  try { return JSON.parse(localStorage.getItem(setupKey(workspaceId)) ?? "{}") ?? {}; } catch { return {}; }
}

export function completeSetupStep(workspaceId: string, step: StepId) {
  try { localStorage.setItem(setupKey(workspaceId), JSON.stringify({ ...savedSetup(workspaceId), [step]: true })); } catch {}
  useSetupRevision.setState((s) => ({ revision: s.revision + 1 }));
}

/** Visiting a step never completes it; explicit skips count as a choice. */
export function stepsDone(s: OnboardingState | null, choices: SetupChoices = {}): Record<StepId, boolean> {
  return {
    anywhere: !!choices.anywhere || !!s?.reachable || onPublicAddress() || accessSkipped(),
    // a setup finished before this step existed has nothing left to show
    address: !!choices.address || !!choices.devices,
    agent: !!choices.agent || !!s?.agents.length,
    devices: !!choices.devices,
  };
}

/** The phone step's line; with no agent yet (the AI step was skipped) it names none. */
export function devicesLine(agentName: string | null): string {
  return agentName ? `Say hi to ${agentName} from your phone too.` : "Add your phone so you can reach Bubble AI from it.";
}

/** Steps that finishing setup marks done: the agent only when one exists (a skipped AI leaves it open). */
export function stepsFinished(hasAgent: boolean): StepId[] {
  return hasAgent ? ["agent", "devices"] : ["devices"];
}

const DISMISS_KEY = "wisp.onboarding.dismissed";

export function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Lets the sidebar react the moment "Do this later" is clicked. */
const useDismissStore = create<{ dismissed: boolean }>(() => ({ dismissed: isDismissed() }));

export function useDismissed(): boolean {
  return useDismissStore((s) => s.dismissed);
}

export function setDismissed(v: boolean) {
  try {
    if (v) localStorage.setItem(DISMISS_KEY, "1");
    else localStorage.removeItem(DISMISS_KEY);
  } catch {}
  useDismissStore.setState({ dismissed: v });
}

/** How far along setup is. A skipped but unfinished setup stays visible in the sidebar as "Finish setup". */
export function setupProgress(done: Record<StepId, boolean>) {
  const steps = STEPS.length;
  const progress = STEPS.filter((id) => done[id]).length;
  return { progress, steps, complete: progress >= steps };
}

/** The check that's on its way, and whether something changed since it left (so one more follows it). */
let checking: Promise<void> | null = null;
let stale = false;

const useOnboardingStore = create<{ state: OnboardingState | null; error: string | null; refresh: () => Promise<void> }>((set) => ({
  state: null,
  error: null,
  // Every agent change and every message asks for this, from each place that shows progress. While one
  // check is out the rest wait for it, and a single check follows if anything asked meanwhile, so
  // what's shown still ends up newer than the last change without a pile of identical requests.
  refresh: () => {
    if (checking) {
      stale = true;
      return checking;
    }
    const run = (): Promise<void> =>
      api<OnboardingState>("GET", "/api/onboarding")
        .then(
          // unchanged progress keeps the state it has: this is refetched on a timer and on every message
          (state) => set((s) => (s.error === null && sameData(s.state, state) ? s : { state: keep(s.state, state), error: null })),
          (e: { status?: number; message: string }) =>
            // a 404 means the browser has a newer app than the hub is running
            set({ error: e.status === 404 ? "Restart Bubble AI on the computer it lives on, then reload this page." : `Couldn't check your progress: ${e.message}` }),
        )
        .then(() => {
          if (!stale) return;
          stale = false;
          return run();
        });
    checking = run().finally(() => {
      checking = null;
    });
    return checking;
  },
}));

/**
 * Onboarding progress from the hub, shared by the page and the sidebar. Refetches when
 * agents change status or post, and optionally polls (the page polls so a device
 * connecting shows up quickly).
 */
export function useOnboarding(pollMs?: number) {
  const { state, error, refresh } = useOnboardingStore();
  const workspaceId = useStore((s) => s.me?.workspace.id) ?? "";
  useSetupRevision((s) => s.revision);
  const agents = useStore((s) => s.agents);
  const messages = useStore((s) => s.messages);

  useEffect(() => {
    refresh();
  }, [refresh, agents, messages]);

  useEffect(() => {
    if (!pollMs) return;
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  return { state, error, refresh, done: stepsDone(state, savedSetup(workspaceId)) };
}

/** Each setup step as a plain next thing to do, for "Continue setup" and Help. */
export const NEXT_STEP: Record<StepId, string> = {
  anywhere: "Use Bubble AI away from home",
  address: "See your Bubble AI server address",
  agent: "Make your first agent",
  devices: "Add your phone and other computers",
};

/** The first setup step that hasn't happened yet, or null when setup is done. */
export function nextStep(done: Record<StepId, boolean>): StepId | null {
  return STEPS.find((s) => !done[s]) ?? null;
}

type AgentLike = Pick<Agent, "id" | "name" | "nodeId" | "harness" | "settings" | "computerId">;

/** The helper to talk about on Home and in Help: a ready one first, then one with a device, then any. */
export function pickHelper<A extends AgentLike>(agents: A[], devices: DeviceInfo[] | null): A | null {
  return agents.find((a) => agentReadiness(a, devices).ready) ?? agents.find((a) => a.nodeId) ?? agents[0] ?? null;
}

/**
 * What Home should lead with: finish setup (no helper yet), a helper that is waiting on something
 * (its problem, in plain words), or a ready helper to try. Only claims what the hub reports.
 */
export type HomeReadiness<A extends AgentLike = AgentLike> =
  | { kind: "setup"; next: StepId }
  | { kind: "waiting"; agent: A; problem: string; deviceName: string | null }
  | { kind: "ready"; agent: A };

export function homeReadiness<A extends AgentLike>(done: Record<StepId, boolean>, agents: A[], devices: DeviceInfo[] | null): HomeReadiness<A> {
  const agent = pickHelper(agents, devices);
  if (!agent) return { kind: "setup", next: nextStep(done) ?? "agent" };
  const { ready, problem } = agentReadiness(agent, devices);
  if (ready) return { kind: "ready", agent };
  const deviceName = devices?.find((d) => d.id === agent.nodeId)?.name ?? null;
  return { kind: "waiting", agent, problem: problem ?? "Not ready yet", deviceName };
}

export interface HelperCheck {
  id: "helper" | "device" | "online" | "harness" | "signin";
  /** ok: fine; bad: needs fixing; unknown: the hub can't tell yet (never reported as broken) */
  status: "ok" | "bad" | "unknown";
  label: string;
  /** one line on what to do, when it isn't ok */
  fix: string | null;
  to: Route | null;
}

/**
 * "My helper isn't answering": the checks in order, from what the hub reports. Each failing one
 * says what to do and where; later checks are unknown while an earlier one fails.
 */
export function helperChecklist(agents: AgentLike[], devices: DeviceInfo[] | null): HelperCheck[] {
  const agent = pickHelper(agents, devices);
  const out: HelperCheck[] = [];
  const unknown = (id: HelperCheck["id"], label: string): HelperCheck => ({ id, status: "unknown", label, fix: null, to: null });
  if (!agent) {
    out.push({ id: "helper", status: "bad", label: "You have an agent", fix: "Make one in setup. It takes a few minutes.", to: { view: "welcome" } });
    out.push(unknown("device", "It has a device to work on"), unknown("online", "That device is on and connected"), unknown("harness", "Its AI is installed there"));
    return out;
  }
  out.push({ id: "helper", status: "ok", label: `You have an agent: ${agent.name}`, fix: null, to: null });
  // helpers that join from outside Bubble AI don't need a device here
  if (harnessInfo(agent.harness)?.protocol === "mcp") {
    out.push({ id: "device", status: "ok", label: `${agent.name} runs outside Bubble AI and needs no device here`, fix: null, to: null });
    return out;
  }
  const agentRoute = (tab: "device" | "model"): Route => ({ view: "agents", agentId: agent.id, tab });
  if (!agent.nodeId) {
    out.push({ id: "device", status: "bad", label: `${agent.name} has a device to work on`, fix: `Pick the computer ${agent.name} should use.`, to: agentRoute("device") });
    out.push(unknown("online", "That device is on and connected"), unknown("harness", "Its AI is installed there"));
    return out;
  }
  const device = devices?.find((d) => d.id === agent.nodeId);
  if (!device) {
    out.push({ id: "device", status: devices ? "bad" : "unknown", label: `${agent.name} has a device to work on`, fix: devices ? `Its device was removed. Pick another for ${agent.name}.` : null, to: devices ? agentRoute("device") : null });
    out.push(unknown("online", "That device is on and connected"), unknown("harness", "Its AI is installed there"));
    return out;
  }
  out.push({ id: "device", status: "ok", label: `${agent.name} works on ${device.name}`, fix: null, to: null });
  if (!device.online || device.paused) {
    out.push({
      id: "online",
      status: "bad",
      label: `${device.name} is on and connected`,
      fix: device.paused ? `${device.name} is paused. Resume Bubble AI on it.` : `Turn on ${device.name} and make sure Bubble AI is running there.`,
      to: { view: "computers", computerId: null },
    });
    out.push(unknown("harness", "Its AI is installed there"));
    return out;
  }
  out.push({ id: "online", status: "ok", label: `${device.name} is on and connected`, fix: null, to: null });
  const label = harnessLabel(agent.harness);
  const reported = device.harnesses ?? [];
  if (runsInVm(agent.harness) && agent.settings?.runIn === "computer" && agent.computerId) out.push({ id: "harness", status: "ok", label: `${label} runs inside ${agent.name}'s computer`, fix: null, to: null });
  else if (!reported.length) out.push(unknown("harness", `${label} is installed on ${device.name}`));
  else if (reported.some((h) => h.id === agent.harness)) out.push({ id: "harness", status: "ok", label: `${label} is installed on ${device.name}`, fix: null, to: null });
  else out.push({ id: "harness", status: "bad", label: `${label} is installed on ${device.name}`, fix: `Install ${label} on ${device.name}, or pick an AI that's already there.`, to: agentRoute("model") });
  if (out[out.length - 1].status === "ok" || agent.settings?.connectionId) {
    const signedIn = agentSignedIn(agent, device);
    const inVm = agent.settings?.runIn === "computer" && !!agent.computerId;
    if (signedIn === true) out.push({ id: "signin", status: "ok", label: `${label} is signed in`, fix: null, to: null });
    else if (signedIn === null) out.push(unknown("signin", `${label} is signed in`));
    else out.push({ id: "signin", status: "bad", label: `${label} is signed in`, fix: `Sign in to ${label} so ${agent.name} can answer.`, to: inVm ? { view: "agents", agentId: agent.id, tab: "computer" } : { view: "settings", page: "harnesses" } });
  }
  return out;
}

export { isLocalOnlyHost } from "./loopback.ts";

/** The features an owner's Simple or Advanced choice sets for the organization: Simple keeps the extras off, Advanced turns them all on. */
export function featuresForExperience(choice: "simple" | "advanced"): Features {
  return { ...(choice === "simple" ? FEATURE_PRESETS.simple : FEATURE_PRESETS.everything) };
}

/**
 * What the first run no longer asks: the agent asks each in its first chat, one at a time (`ask`,
 * with `action` and "Later" as its buttons), and the same four are listed on "Finish setup"
 * (#/here, `label` and `button`) until each is done.
 */
export const READY_ITEMS = [
  { id: "phone", label: "Add your phone", button: "Pair", ask: "Want me on your phone too?", action: "Pair my phone" },
  { id: "apps", label: "Set up apps", button: "Add", ask: "Which apps should I work with?", action: "Set up apps" },
  { id: "away", label: "Use Bubble AI away from home", button: "Set up", ask: "Want to reach me away from home?", action: "Set up" },
  { id: "know", label: "Let me get to know you", button: "Start", ask: "Can I get to know you?", action: "Get started" },
] as const;
export type ReadyItem = (typeof READY_ITEMS)[number]["id"];
/** true: done. "later": asked in the chat and put off; it stays on "Finish setup". */
export type ReadyTick = boolean | "later";
const readyKey = (workspaceId: string) => `wisp.ready.v1.${workspaceId}`;
const useReadyStore = create<{ revision: number }>(() => ({ revision: 0 }));

function readyTicks(workspaceId: string): Partial<Record<ReadyItem | "started", ReadyTick>> {
  try { return JSON.parse(localStorage.getItem(readyKey(workspaceId)) ?? "{}") ?? {}; } catch { return {}; }
}

/** `started`: the first run has ended, so "Finish setup" shows from then on while anything is left. */
export function setReadyItem(workspaceId: string, id: ReadyItem | "started", done: ReadyTick) {
  try { localStorage.setItem(readyKey(workspaceId), JSON.stringify({ ...readyTicks(workspaceId), [id]: done })); } catch {}
  useReadyStore.setState((s) => ({ revision: s.revision + 1 }));
}

export type ReadyRow = (typeof READY_ITEMS)[number] & { done: boolean; later: boolean };

/** Each of the four with where it stands, from what was saved. */
export function readyRows(ticks: Partial<Record<ReadyItem | "started", ReadyTick>>): ReadyRow[] {
  return READY_ITEMS.map((i) => ({ ...i, done: ticks[i.id] === true, later: ticks[i.id] === "later" }));
}

/** The one the agent asks about next in its chat: the first neither done nor put off. */
export const nextAsk = (rows: readonly ReadyRow[]): ReadyRow | null => rows.find((r) => !r.done && !r.later) ?? null;

/** The four and whether each is done; `left` counts what isn't (put off counts as left). */
export function useReadyChecklist(): { items: ReadyRow[]; left: number; started: boolean; workspaceId: string } {
  useReadyStore((s) => s.revision);
  const workspaceId = useStore((s) => s.me?.workspace.id) ?? "";
  const ticks = readyTicks(workspaceId);
  const items = readyRows(ticks);
  return { items, left: items.filter((i) => !i.done).length, started: !!ticks.started, workspaceId };
}

/** Where your devices connect, and what that address can reach. */
export function serverAddress(info: AccessInfo | null, loc: Pick<Location, "origin" | "protocol" | "hostname"> = location): { url: string; note: string } | null {
  if (onPublicAddress(loc)) return { url: loc.origin, note: "Your devices connect here, at home or away." };
  if (!info) return null;
  if (info.publicUrl) return { url: info.publicUrl, note: info.publicUrl.endsWith(".ts.net") && !info.tailscale.funnel ? "Your devices connect here, at home or away. Any device on your Tailscale can reach it." : "Your devices connect here, at home or away." };
  return info.lan[0] ? { url: info.lan[0], note: "Your devices connect here while they're on your home network." } : null;
}
