import { useEffect, useState } from "react";
import { Cloud, Laptop, Monitor } from "lucide-react";
import type { Agent, DeviceCapabilities, DeviceRole } from "@bubble-ai/core";
import { useStore, type ComputerInfo } from "../store.ts";
import type { DeviceInfo } from "../devices.ts";
import { href } from "../router.ts";

export type Tone = "neutral" | "ok" | "warn" | "bad" | "info";

/** How a computer is doing, in a word or two, for cards and headers. */
export function computerState(c: ComputerInfo, meId: string | undefined, agents: Agent[], memberName: (id: string) => string): { label: string; tone: Tone; working: boolean } {
  if (!c.online) return { label: "Offline", tone: "neutral", working: false };
  if (c.paused) return { label: "Paused at the device", tone: "neutral", working: false };
  if (c.status === "starting") return { label: c.statusText || "Starting…", tone: "info", working: false };
  if (c.status === "error") return { label: c.kind === "device" ? "Problem" : "Couldn't start", tone: "bad", working: false };
  if (c.controller) return { label: c.controller.id === meId ? "You're in control" : `${memberName(c.controller.id)} is in control`, tone: "warn", working: false };
  const recent = c.activity && Date.now() - new Date(c.activity.at).getTime() < 30_000;
  const busy = agents.some((a) => c.agents.includes(a.id) && a.status === "busy");
  if (recent || (busy && c.activity)) return { label: "Working", tone: "info", working: true };
  if (c.status === "stopped") return { label: "Off", tone: "neutral", working: false };
  return { label: "Ready", tone: "ok", working: false };
}

/**
 * The one status-color rule (iOS matches it). Connectivity first, so offline always wins:
 * offline or paused -> gray; you or someone else in control, or an agent asking for help -> amber;
 * a problem -> red; working or starting -> blue; ready -> green.
 */
export function toneColor(tone: Tone): string {
  return tone === "ok" ? "var(--st-online)" : tone === "info" ? "var(--st-working)" : tone === "warn" ? "var(--st-needs)" : tone === "bad" ? "var(--st-problem)" : "var(--status-idle)";
}

export function stateColor(state: { tone: Tone; working: boolean }, c: { online: boolean; paused?: boolean; help?: unknown; controller?: unknown }, mine: boolean): string {
  if (!c.online || c.paused) return "var(--status-idle)";
  if (mine || c.help || c.controller) return "var(--st-needs)";
  return state.working ? "var(--st-working)" : toneColor(state.tone);
}

/** The dot color for an activity line, by what it says: took control amber, handed it back green, opened the live view sky, else gray. */
export function activityDot(text: string): string {
  if (/took control/i.test(text)) return "var(--st-needs)";
  if (/handed (it )?back/i.test(text)) return "var(--st-online)";
  if (/opened (the )?live view/i.test(text)) return "var(--accent-computers)";
  return "var(--status-idle)";
}

export function useComputerState(c: ComputerInfo) {
  const me = useStore((s) => s.me);
  const agents = useStore((s) => s.agents);
  const members = useStore((s) => s.members);
  // re-evaluate "Working" as activity ages
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  return computerState(c, me?.user.id, agents, (id) => members.find((m) => m.id === id)?.name ?? "Someone");
}

export const KIND_ICON = { device: Laptop, vm: Monitor, orgo: Cloud };

// --- the Computers page: one tile per computer --------------------------------------------------

/** One tile on the Computers page: a device (with its own screen), a VM, a cloud computer, or the paired phones. */
export interface ComputerTile {
  key: string;
  kind: "device" | "vm" | "cloud" | "phone";
  name: string;
  /** where the tile opens */
  to: string;
  /** the device itself, or the one a VM lives on */
  device?: DeviceInfo;
  /** the screen it shows: the device's own, the VM's, the cloud computer's */
  computer?: ComputerInfo;
  /** when something last happened on it (0: never), for the order */
  at: number;
}

const KIND_ORDER = { device: 0, vm: 1, cloud: 2, phone: 3 };

/** The address of the paired phones' sheet (#/computers/phones): the hub knows how many, not which. */
export const PHONES = "phones";

/**
 * Every computer as one flat list, newest activity first: each device (its own screen is its
 * thumbnail), each VM, each cloud computer, then the paired phones. Ties keep what is on ahead
 * of what is off, then devices, VMs, cloud, by name, so the grid doesn't shuffle.
 */
export function computerTiles(devices: DeviceInfo[], computers: ComputerInfo[], phones: number): ComputerTile[] {
  const at = (c?: ComputerInfo) => (c?.activity ? new Date(c.activity.at).getTime() || 0 : 0);
  const known = new Set(devices.map((d) => d.id));
  const tiles: ComputerTile[] = [];
  for (const d of devices) {
    const screen = computers.find((c) => c.kind === "device" && c.nodeId === d.id);
    tiles.push({ key: `d:${d.id}`, kind: "device", name: d.name, to: href({ view: "computers", computerId: null, deviceId: d.id }), device: d, computer: screen, at: at(screen) });
  }
  for (const c of computers) {
    // a device's own screen is already its device's tile
    if (c.kind === "device" && c.nodeId && known.has(c.nodeId)) continue;
    tiles.push({ key: `c:${c.id}`, kind: c.kind === "orgo" ? "cloud" : c.kind, name: c.name, to: href({ view: "computers", computerId: c.id }), device: devices.find((d) => d.id === c.nodeId), computer: c, at: at(c) });
  }
  const on = (t: ComputerTile) => Number(t.computer ? t.computer.online : !!t.device?.online);
  tiles.sort((a, b) => b.at - a.at || on(b) - on(a) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));
  if (phones > 0) tiles.push({ key: PHONES, kind: "phone", name: phones === 1 ? "Phone" : `${phones} phones`, to: href({ view: "computers", computerId: PHONES }), at: 0 });
  return tiles;
}

/**
 * A computer's live view is its own address under the computer: #/computers/<id>/watch, and an
 * agent's own screen on the shared computer #/computers/<id>/watch/<agentId>.
 */
export const watchHref = (computerId: string, agentId?: string | null) => `${href({ view: "computers", computerId })}/watch${agentId ? `/${encodeURIComponent(agentId)}` : ""}`;
export const isWatchHash = (hash: string) => /^#\/computers\/[^/]+\/watch(\/[^/]+)?\/?$/.test(hash);
/** The agent whose own screen a live-view address is for, if any. */
export const watchedAgent = (hash: string): string | null => {
  const m = hash.match(/^#\/computers\/[^/]+\/watch\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

/**
 * A tile's one status line, three or four words: "Atlas is working", "Asleep. Wakes when needed.",
 * "Offline", "Paired". `agent` is who is working on it (the tile wears its colour and its ghost).
 */
export function tileStatus(t: Pick<ComputerTile, "kind" | "device" | "computer">, agents: Agent[], meId: string | undefined, memberName: (id: string) => string): { text: string; tone: Tone; working: boolean; agent?: Agent } {
  const is = (text: string, tone: Tone = "neutral") => ({ text, tone, working: false });
  if (t.kind === "phone") return is("Paired");
  const d = t.kind === "device" ? t.device : undefined;
  const c = t.computer;
  if (d?.update?.state === "updating" || d?.update?.state === "restarting") return is("Updating", "info");
  if (d?.update?.state === "failed") return is("Update failed", "bad");
  if (d ? !d.online : !c?.online) return is("Offline");
  if (d?.paused || c?.paused) return is("Paused");
  if (c?.help) return is(`${agents.find((a) => a.id === c.help!.agentId)?.name ?? "An agent"} needs you`, "warn");
  if (c) {
    const state = computerState(c, meId, agents, memberName);
    if (c.controller) return is(state.label, "warn");
    if (c.status === "starting") return is("Starting", "info");
    if (c.status === "error") return is(c.kind === "device" ? "Problem" : "Couldn't start", "bad");
    if (state.working) {
      const on = agents.filter((a) => c.agents.includes(a.id));
      const agent = on.find((a) => a.id === c.activity?.agentId) ?? on.find((a) => a.status === "busy") ?? on[0];
      return { text: `${agent?.name ?? "An agent"} is working`, tone: "info", working: true, agent };
    }
    if (c.status === "stopped") return is(c.kind === "vm" ? "Asleep. Wakes when needed." : "Asleep");
    if (c.code) return is("Locked");
  }
  // an agent that runs on the device itself, with no screen of its own
  const here = d ? agents.find((a) => a.nodeId === d.id && a.status === "busy" && (!a.computerId || a.computerId === c?.id)) : undefined;
  if (here) return { text: `${here.name} is working`, tone: "info", working: true, agent: here };
  return is("Ready", "ok");
}

/** A device's own screen that's turned off at the device: only someone there can turn it on. */
export const screenOffText = (name: string) => `${name}'s screen is off. Turn it on at ${name}: Let Me Use This Screen, in the Bubble AI menu.`;

/**
 * Why Watch can't show a computer's screen right now, and whether Start fixes that; null when it
 * can (or when it couldn't start, which StartProblem says). A device's own screen turned off can
 * only be turned on at the device.
 */
export function watchBlock(c: ComputerInfo, device?: Pick<DeviceInfo, "name" | "capabilities">): { text: string; start: boolean; starting: boolean } | null {
  if (!c.online || c.paused) return null;
  if (c.kind === "device") {
    const name = device?.name ?? c.name;
    return device?.capabilities?.screen.off ? { text: screenOffText(name), start: false, starting: false } : null;
  }
  if (c.status === "stopped") return { text: `${c.name} is off.`, start: true, starting: false };
  if (c.status === "starting") return { text: c.statusText || "Starting…", start: false, starting: true };
  return null;
}

/** What an address under #/computers opens beside the grid. `key` is its tile's. */
export type SheetTarget<N extends DeviceInfo = DeviceInfo> =
  | { key: string; kind: "device"; node: N; screen?: ComputerInfo }
  | { key: string; kind: "computer"; computer: ComputerInfo; host?: N }
  | { key: string; kind: "phones" }
  | { key: string; kind: "gone" }
  | { key: string; kind: "loading" };

/**
 * The sheet for #/computers/<id> or #/computers/d/<nodeId>. A device's own screen opens its
 * device's sheet (they are one tile). Nothing is "gone" until the lists it would be in have loaded.
 */
export function sheetTarget<N extends DeviceInfo>(open: { computerId: string | null; deviceId?: string | null }, nodes: N[] | null, computers: ComputerInfo[], computersLoaded: boolean): SheetTarget<N> | null {
  const screenOf = (nodeId: string) => computers.find((c) => c.kind === "device" && c.nodeId === nodeId);
  if (open.computerId === PHONES) return { key: PHONES, kind: "phones" };
  if (open.computerId) {
    const key = `c:${open.computerId}`;
    const c = computers.find((x) => x.id === open.computerId);
    if (!c) return { key, kind: computersLoaded ? "gone" : "loading" };
    const node = nodes?.find((n) => n.id === c.nodeId);
    if (c.kind === "device" && c.nodeId) {
      if (!nodes) return { key, kind: "loading" };
      if (node) return { key: `d:${node.id}`, kind: "device", node, screen: c };
    }
    return { key, kind: "computer", computer: c, host: node };
  }
  if (open.deviceId) {
    const key = `d:${open.deviceId}`;
    if (!nodes) return { key, kind: "loading" };
    const node = nodes.find((n) => n.id === open.deviceId);
    return node ? { key, kind: "device", node, screen: screenOf(node.id) } : { key, kind: "gone" };
  }
  return null;
}

// --- a computer's sheet: what the hub has today, as the sheet's rows -------------------------------

/**
 * The one switch the hub has for a device today, behind both "Run commands and files" and "See
 * and use the screen": may agents use this device itself. It is on when the device's job is to
 * lend its screen (its role), or when some agent already works on that screen or is allowed to
 * use the device (`users`). The screen is only ever turned on at the device, so `there` says it
 * is off (or can't be used) there, and nothing here can change that.
 */
export function screenSwitch(node: { id: string; role?: DeviceRole | null; online: boolean; capabilities?: DeviceCapabilities | null }, screen: ComputerInfo | undefined, agents: Agent[]): { on: boolean; there: boolean; users: Agent[] } {
  const caps = node.online ? node.capabilities?.screen : undefined;
  const there = !!caps && (!caps.ok || !!caps.off);
  const users = agents.filter((a) => (!!screen && a.computerId === screen.id) || !!a.settings.useDevices?.[node.id]);
  return { on: !there && (node.role === "screen" || users.length > 0), there, users };
}

/** How agents ask before using a device: the hub keeps it per agent ("ask" once per task, "tell" afterwards). */
export const ASK_LEVELS = [
  { id: "always", label: "Every time" },
  { id: "ask", label: "Once per task" },
  { id: "tell", label: "Tell me after" },
] as const;
export type AskLevel = (typeof ASK_LEVELS)[number]["id"];

/** The agents allowed to use a device, and the level they share: asking wins when they differ. None allowed: null. */
export function askLevel(agents: Agent[], nodeId: string): { level: Exclude<AskLevel, "always"> | null; agents: Agent[] } {
  const allowed = agents.filter((a) => a.settings.useDevices?.[nodeId]);
  if (!allowed.length) return { level: null, agents: allowed };
  return { level: allowed.some((a) => a.settings.useDevices![nodeId] === "ask") ? "ask" : "tell", agents: allowed };
}

/** What the hub says about Bubble AI's version: its own, and how far behind the newest it is. */
export interface HubVersion {
  version: { commit: string | null } | null;
  check: { behind: number | null } | null;
}

/**
 * Is there a newer Bubble AI for this device? Yes when the hub knows of one, when the device runs
 * something other than the hub does, or when its last update failed. When nobody can tell (no
 * versions to compare), the answer is yes, so the way to update never disappears.
 */
export function updateExists(device: { version?: { commit: string | null } | null; update?: { state: string } | null }, hub: HubVersion | null): boolean {
  if (device.update?.state === "failed") return true;
  if (!hub) return true;
  if ((hub.check?.behind ?? 0) > 0) return true;
  const mine = device.version?.commit;
  const theirs = hub.version?.commit;
  if (!mine || !theirs) return true;
  return mine !== theirs;
}

/** "2 CPUs, 4 GB": the size a VM or cloud computer was made with; null when it has none. */
export function sizeLine(c: Pick<ComputerInfo, "kind" | "config">): string | null {
  const cpus = c.kind === "orgo" ? c.config.cpu : c.config.cpus;
  const gb = c.kind === "orgo" ? c.config.ram : c.config.memoryGb;
  if (!cpus && !gb) return null;
  return [cpus ? `${cpus} CPU${cpus === 1 ? "" : "s"}` : null, gb ? `${gb} GB` : null].filter(Boolean).join(", ");
}
