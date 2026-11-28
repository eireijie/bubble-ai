import { useEffect, useState, type ReactNode } from "react";
import type { AppleView } from "@bubble-ai/core";
import { api, observeEvents } from "../api.ts";
import { useFeature } from "../features.ts";
import type { MacPermission, MacPermissions } from "../desktop.ts";
import { MAC_PERMISSIONS as DESKTOP_PERMISSIONS } from "../views/onboarding/ThisMacStep.tsx";
import { MAC_PERMISSIONS as APPLE_PERMISSIONS, activeMac } from "../views/settings/apple.tsx";
import { AppleIcon } from "./AppleParts.tsx";
import { Done, GoPill, LineTile } from "./ConnectParts.tsx";

/** The Mac desktop app (not the web, not Windows or Linux). */
export function isDesktopMac(): boolean {
  if (typeof window === "undefined" || !window.wispDesktop) return false;
  const p = window.wispDesktop.platform;
  return p ? p === "darwin" : /mac/i.test(navigator.platform || navigator.userAgent);
}

export interface MacRow {
  key: string;
  tile: ReactNode;
  name: string;
  desc: string;
  action: ReactNode;
}

type Pane = (typeof APPLE_PERMISSIONS)[number]["pane"];

/**
 * Connect apps › This Mac (round 11, board 14): what agents may use on the Mac this app runs on, each
 * with Allow or Allowed. The app's own permissions (screen, clicking, microphone, notifications) and,
 * with the Apple mod on, Messages, Contacts, Calendar and Reminders. Nothing is asked until Allow.
 */
export function useThisMacRows(on: boolean): MacRow[] {
  const perms = on && typeof window !== "undefined" ? window.wispDesktop?.permissions : undefined;
  const appleOn = useFeature("apple") && on;
  const [state, setState] = useState<MacPermissions | null>(null);
  const [apple, setApple] = useState<AppleView | null>(null);
  const [asking, setAsking] = useState<string | null>(null);

  // macOS answers in its own dialog or in System Settings: look again while this is open
  useEffect(() => {
    if (!perms) return;
    let live = true;
    const read = () => perms.status().then((s) => live && s && setState(s)).catch(() => {});
    read();
    const t = setInterval(read, 2000);
    window.addEventListener("focus", read);
    return () => {
      live = false;
      clearInterval(t);
      window.removeEventListener("focus", read);
    };
  }, [perms]);

  useEffect(() => {
    if (!appleOn) return setApple(null);
    let live = true;
    const load = () => api<AppleView>("POST", "/api/apple/mac/refresh").catch(() => api<AppleView>("GET", "/api/apple")).then((v) => live && setApple(v), () => {});
    void load();
    const t = setInterval(() => void load(), 4000);
    const stop = observeEvents((e) => e.type === "apple_changed" && void load());
    return () => {
      live = false;
      clearInterval(t);
      stop();
    };
  }, [appleOn]);

  if (!on) return [];

  const allowDesktop = async (id: MacPermission) => {
    if (!perms) return;
    setAsking(id);
    try {
      await perms.request(id);
      const s = await perms.status();
      if (s) setState(s);
    } finally {
      setAsking(null);
    }
  };
  const allowApple = async (pane: Pane) => {
    setAsking(pane);
    try {
      setApple(await api<AppleView>("POST", "/api/apple/mac/permission", { pane }));
    } catch {
      /* the row stays on Allow */
    } finally {
      setAsking(null);
    }
  };

  const pill = (ok: boolean, label: string, onClick: () => void, disabled = false) =>
    ok ? (
      <Done word="Allowed" />
    ) : (
      <GoPill aria-label={`Allow ${label}`} disabled={disabled || asking !== null} onClick={onClick}>
        Allow
      </GoPill>
    );

  const rows: MacRow[] = perms
    ? DESKTOP_PERMISSIONS.map((p) => ({
        key: `mac:${p.id}`,
        tile: (
          <LineTile>
            <p.Icon size={20} strokeWidth={1.7} />
          </LineTile>
        ),
        name: p.name,
        desc: p.why,
        action: pill(state?.statuses[p.id] === "granted", p.name, () => void allowDesktop(p.id), !state),
      }))
    : [];

  // the Apple mod's Mac, when it is this one
  const mac = apple ? activeMac(apple) : null;
  const here = mac && apple && (apple.macs.length === 1 || !state || mac.name === state.name);
  if (mac && here)
    for (const p of APPLE_PERMISSIONS)
      rows.push({
        key: `apple:${p.key}`,
        tile: <AppleIcon app={p.app} size={42} />,
        name: p.name,
        desc: p.why,
        action: pill(mac.status?.[p.key] === "allowed", p.name, () => void allowApple(p.pane), !mac.online),
      });
  return rows;
}
