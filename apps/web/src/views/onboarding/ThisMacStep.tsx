import { useEffect, useState } from "react";
import { Bell, Check, Laptop, Mic, Monitor, MousePointerClick } from "lucide-react";
import { SetupLink } from "../../components/SetupShell.tsx";
import type { MacPermission, MacPermissions } from "../../desktop.ts";
import { BubbleSlot } from "./Stage.tsx";

/** The rows, in the order macOS users expect them (2026-11-27 canvas, Setup board). */
export const MAC_PERMISSIONS: { id: MacPermission; name: string; why: string; Icon: typeof Monitor }[] = [
  { id: "screen", name: "Screen Recording", why: "So agents can see what they are doing", Icon: Monitor },
  { id: "accessibility", name: "Accessibility", why: "So agents can click and type", Icon: MousePointerClick },
  { id: "microphone", name: "Microphone", why: "For calls and dictation", Icon: Mic },
  { id: "notifications", name: "Notifications", why: "So you hear when an agent needs you", Icon: Bell },
];

/** All four allowed: Continue is on. */
export const allAllowed = (s: Partial<Record<MacPermission, string>> | undefined) => MAC_PERMISSIONS.every((p) => s?.[p.id] === "granted");

/** Shown only in the desktop app on a Mac (WelcomeView decides). */
export function macStepWanted(desktop: Window["wispDesktop"], done: boolean | undefined): boolean {
  return !done && !!desktop?.permissions && desktop.platform === "darwin";
}

/**
 * The first run on a Mac, right after the name: "Let your agents use this Mac" with an Allow per
 * permission and a live checkmark, then "This Mac is ready · Agents can use it". The app turns the
 * screen on for agents once Screen Recording and Accessibility are allowed.
 */
export function ThisMacStep({ onDone }: { onDone: () => void }) {
  const perms = typeof window !== "undefined" ? window.wispDesktop?.permissions : undefined;
  const [state, setState] = useState<MacPermissions | null>(null);
  const [ready, setReady] = useState(false);
  const [asking, setAsking] = useState<MacPermission | null>(null);

  // live: macOS answers in its own dialog or in System Settings, so look again every moment
  useEffect(() => {
    if (!perms) return;
    let live = true;
    const read = () => perms.status().then((s) => live && s && setState(s)).catch(() => {});
    read();
    const t = setInterval(read, 1500);
    window.addEventListener("focus", read);
    return () => {
      live = false;
      clearInterval(t);
      window.removeEventListener("focus", read);
    };
  }, [perms]);

  const allow = async (id: MacPermission) => {
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

  if (ready)
    return (
      <div className="flex w-full max-w-[520px] flex-col items-center text-center">
        <BubbleSlot size={72} />
        <h1 className="ob-title mt-6">This Mac is ready</h1>
        <p className="mt-3 text-[15px] leading-[22px] text-muted">Ask from your phone and your agents use it while it's on.</p>
        <div className="mt-5 flex items-center gap-2.5 rounded-[14px] px-4 py-3 shadow-[inset_0_0_0_1px_var(--line)]">
          <Laptop size={20} strokeWidth={1.8} aria-hidden />
          <span className="font-semibold">{state?.name ?? "This Mac"}</span>
          <span className={`h-2 w-2 rounded-full ${state?.screenOn ? "bg-[#34c759]" : "bg-faint"}`} aria-hidden />
          <span className="text-[13px] text-muted">{state?.screenOn ? "Agents can use it" : "Agents can use it once it's allowed"}</span>
        </div>
        <button type="button" onClick={onDone} className="ob-primary mt-8 w-full max-w-[280px]">
          Make your first agent
        </button>
      </div>
    );

  return (
    <div className="flex w-full max-w-[520px] flex-col items-center">
      <BubbleSlot size={72} />
      <h1 className="ob-title mt-6">Let your agents use this Mac</h1>
      <ul className="mt-6 w-full overflow-hidden rounded-2xl shadow-[inset_0_0_0_1px_var(--line)]">
        {MAC_PERMISSIONS.map(({ id, name, why, Icon }, i) => {
          const ok = state?.statuses[id] === "granted";
          return (
            <li key={id} className={`flex min-h-[62px] items-center gap-3.5 px-4 ${i ? "border-t border-line" : ""}`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-hover" aria-hidden>
                <Icon size={18} strokeWidth={1.8} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2 text-left">
                <span className="text-[15px] font-semibold">{name}</span>
                <span className="text-[13px] text-muted">{why}</span>
              </span>
              {ok ? (
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[#1f8a4c] dark:text-[#34c759]">
                  <Check size={14} strokeWidth={2.6} aria-hidden />
                  Allowed
                </span>
              ) : (
                <button type="button" disabled={!state || asking === id} onClick={() => void allow(id)} aria-label={`Allow ${name}`} className="h-8 shrink-0 rounded-full px-4 text-[13px] font-medium text-ink shadow-[inset_0_0_0_1px_var(--line2)] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50">
                  Allow
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" disabled={!allAllowed(state?.statuses)} onClick={() => setReady(true)} className="ob-primary mt-8 w-full max-w-[280px]">
        Continue
      </button>
      {/* macOS can need a restart of Bubble AI before it shows Screen Recording as allowed: never a dead end */}
      <SetupLink onClick={onDone}>Not now</SetupLink>
    </div>
  );
}
