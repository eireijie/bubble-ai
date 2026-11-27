import { useEffect, useState } from "react";
import { useStore } from "./store.ts";
import { useFeature } from "./features.ts";

export interface DesktopUpdate {
  state: "idle" | "checking" | "current" | "downloading" | "ready" | "unsupported" | "error" | "timed-out";
  detail: string;
  version: string | null;
  current: string;
}

/** The first run's macOS permissions (Windows and Linux report every one as granted). */
export type MacPermission = "screen" | "accessibility" | "microphone" | "notifications";
export interface MacPermissions {
  platform: string;
  /** this computer's name ("Yug's MacBook") */
  name: string;
  statuses: Record<MacPermission, "granted" | "denied" | "not-determined" | "restricted" | "unknown">;
  /** its screen is on for agents (the app turns it on once they can use it) */
  screenOn: boolean;
}

export interface BuddySettings {
  agentId: string | null;
}

declare global {
  interface Window {
    wispDesktop?: {
      setBadge(n: number): void;
      /** how the window's title bar is drawn: Mac lights over the page's top-left, Windows buttons over its top-right, or the OS frame */
      titleBar?: "inset" | "overlay" | "native";
      setTitleBarColors?(bg: string, fg: string): void;
      /** bring the window back from the menu bar (a clicked notification) */
      focus(): void;
      info(): Promise<{ version: string; platform: string; device: boolean }>;
      /** with a claim, this computer becomes that waiting device; without one, a new device */
      connectDevice(claim?: { token: string; name: string }): Promise<void>;
      /** open the system's own notifications switch for Bubble AI (System Settings › Notifications › Bubble AI) */
      notifications?: { openSettings(): Promise<void> };
      /** process.platform of the computer the app runs on */
      platform?: string;
      /** the first run's "Let your agents use this Mac": live statuses, and Allow (macOS's prompt, else its System Settings pane) */
      permissions?: {
        status(): Promise<MacPermissions | null>;
        request(id: MacPermission): Promise<"asked" | "opened" | null>;
      };
      /** the computer's own microphone permission for calls (macOS asks once; only System Settings changes it after) */
      microphone?: {
        status(): Promise<string>;
        request(): Promise<boolean>;
        openSettings(): Promise<void>;
      };
      /** the app decides who may; removing happens in its own window, never from a page */
      removal?: {
        available(): Promise<boolean>;
        open(): Promise<void>;
      };
      updates: {
        status(): Promise<DesktopUpdate | null>;
        /** look for a newer Bubble AI now; downloads it when there is one */
        check(): Promise<DesktopUpdate | null>;
        /** install the downloaded update and open Bubble AI again */
        restart(): Promise<void>;
      };
      buddy: {
        agents(agents: { id: string; name: string }[], leadId: string | null): void;
        settings(): Promise<BuddySettings>;
        onSettings(fn: (settings: BuddySettings) => void): () => void;
        onPointer(fn: (point: { x: number; y: number } | null) => void): () => void;
        ignoreMouse(ignore: boolean): void;
        expand(expanded: boolean): void;
        drag(phase: "start" | "move" | "end"): void;
        open(route: string): void;
      };
    };
  }
}

/** Keep the tray current even when the buddy is turned off. With the Desk buddy feature off, the app hears no agents, so no buddy appears. */
export function useDesktopAgents() {
  const agents = useStore((s) => s.agents);
  const leadId = useStore((s) => s.lead?.lead ?? null);
  const buddy = useFeature("buddy");
  useEffect(() => {
    window.wispDesktop?.buddy.agents(buddy ? agents.map(({ id, name }) => ({ id, name })) : [], buddy ? leadId : null);
  }, [agents, leadId, buddy]);
  useEffect(() => () => window.wispDesktop?.buddy.agents([], null), []);
}

export type DesktopInfo = { version: string; platform: string; device: boolean };

/** undefined: not in the desktop app (or not asked yet); otherwise what the Bubble AI app says about this computer. */
export function useDesktopInfo(): { inDesktop: boolean; info: DesktopInfo | null; connect: (claim?: { token: string; name: string }) => Promise<void> } {
  const desktop = typeof window !== "undefined" ? window.wispDesktop : undefined;
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    const read = () => desktop.info().then((i) => live && setInfo(i)).catch(() => {});
    read();
    const t = setInterval(read, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [desktop]);
  /** with a claim, this computer becomes that waiting device instead of adding another */
  const connect = async (claim?: { token: string; name: string }) => {
    await desktop?.connectDevice(claim);
    await desktop?.info().then(setInfo).catch(() => {});
  };
  return { inDesktop: !!desktop, info, connect };
}

/** "rgb(r, g, b)" → "#rrggbb" (null for anything else, like a transparent colour). */
export function hexColor(css: string): string | null {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(css.trim());
  if (!m || (m[4] !== undefined && Number(m[4]) < 1)) return null;
  return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

/**
 * In the desktop app there's no grey title bar: the page says how the window draws its buttons
 * (`data-titlebar` on <html>, which the CSS makes room for), and on Windows keeps the buttons the
 * colour of the page as the theme changes.
 */
export function applyTitleBar() {
  const desktop = typeof window !== "undefined" ? window.wispDesktop : undefined;
  const kind = desktop?.titleBar;
  if (!kind || kind === "native") return;
  const root = document.documentElement;
  root.dataset.titlebar = kind;
  if (kind !== "overlay" || !desktop.setTitleBarColors) return;
  const send = () => {
    const page = getComputedStyle(document.body);
    const bg = hexColor(page.backgroundColor);
    const fg = hexColor(page.color);
    if (bg && fg) desktop.setTitleBarColors?.(bg, fg);
  };
  new MutationObserver(send).observe(root, { attributes: true, attributeFilter: ["data-mode", "data-theme"] });
  send();
}
