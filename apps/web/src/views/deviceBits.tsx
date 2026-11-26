import type { DeviceCapabilities, DeviceRole, OwnRemoteDesktop } from "@bubble-ai/core";

export interface NodeInfo {
  id: string;
  name: string;
  ownerName: string | null;
  mine: boolean;
  shared: boolean;
  /** what it does for agents; null until its owner chooses */
  role: DeviceRole | null;
  paused: boolean;
  capabilities: DeviceCapabilities | null;
  online: boolean;
  lastSeen: string | null;
  agents: string[];
  /** the Bubble AI version it runs; null for devices from before updates */
  version: { commit: string | null; date: string | null } | null;
  update: { state: "idle" | "updating" | "restarting" | "failed"; message: string } | null;
  /** the remote desktop app its owner uses to reach it; only they get it */
  remoteDesktop?: OwnRemoteDesktop | null;
  /** the AI tools installed on it, and whether each account on it is signed in (null: nobody can tell) */
  harnesses?: { id: string; version: string | null; accounts?: Record<string, boolean | null> }[];
}

/** "Connected" while online; otherwise when it was last seen. Never both, so it can't contradict the pill. */
export function connectionLine(n: { online: boolean; lastSeen: string | null }, ago: (iso: string) => string): string {
  if (n.online) return "Connected";
  return n.lastSeen ? `Last seen ${ago(n.lastSeen)}` : "Never connected";
}

/** What we can say about the device's own screen. Offline means unknown, whatever we saw last time. */
export function screenLine(n: { online: boolean; capabilities: DeviceCapabilities | null }): string {
  const last = n.capabilities?.screen;
  if (n.online && last) return "";
  if (n.online) return "Its screen: not checked yet.";
  const base = "Its screen: unknown until it connects.";
  if (!last) return base;
  return `${base} (Last time: ${last.ok ? "on" : "off"}.)`;
}

export { isLocalOnlyHost } from "../loopback.ts";

/** What to tell someone about a device that is not connected; null while it is connected. */
export function notConnectedLine(n: { online: boolean; lastSeen: string | null }): string | null {
  if (n.online) return null;
  return n.lastSeen ? "This device was connected before but is offline now." : "This device hasn't connected yet.";
}
