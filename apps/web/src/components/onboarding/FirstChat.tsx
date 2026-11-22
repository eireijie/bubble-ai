import { useState } from "react";
import { api } from "../../api.ts";
import { useStore } from "../../store.ts";
import { Bell, ChevronRight } from "lucide-react";
import type { Agent, Message } from "@wisp/core";
import { enableNotifications, permission } from "../../notifications.ts";
import { enablePush, pushSupported } from "../../push.ts";
import { go } from "../../router.ts";

/**
 * The extras in a new agent's first chat (onboarding page 6). One primary next step: a quick
 * reply to its hello. A quiet link to "Here's your Wisp" (page 7). Notifications are asked about
 * only after its first useful answer, when a ping would mean something; Turn on brings up the
 * system's own prompt, and after "Don't Allow" the card links to the exact switch.
 */

/** What you can answer its hello with in one tap: the first is the one primary button. */
export const QUICK = ["Yes, go ahead", "Something else first"] as const;

const ASKED_KEY = (workspaceId: string) => `wisp.notifyAsked.${workspaceId}`;
export const hereSeenKey = (agentId: string) => `wisp.hereSeen.${agentId}`;
const FRESH_MS = 7 * 86_400_000;
const NO_MESSAGES: readonly Message[] = [];

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string) => {
  try {
    localStorage.setItem(k, "1");
  } catch {}
};

/** Is this the chat the agent's hello started, and has the hello been said? */
export function isFirstChat(agent: Pick<Agent, "settings"> | undefined, channelId: string): boolean {
  const s = agent?.settings.setup;
  return !!s && s.channelId === channelId && !!s.greetingId && Date.now() - Date.parse(s.startedAt) < FRESH_MS;
}

/** Has the agent answered the person at least once (a reply after something they wrote), so it has done something useful? */
export function answeredOnce(messages: readonly Pick<Message, "author" | "threadId" | "deletedAt">[], agentId: string): boolean {
  let spoke = false;
  for (const m of messages) {
    if (m.threadId || m.deletedAt) continue;
    if (m.author.kind === "user") spoke = true;
    else if (spoke && m.author.kind === "agent" && m.author.id === agentId) return true;
  }
  return false;
}

/** Where the notifications card stands: hidden, asking, waiting on the system prompt, on, or off (said no). */
export type PingState = "hidden" | "ask" | "asking" | "on" | "off";

/** The card's state: nothing until the agent has answered once; afterwards, what the system says. */
export function pingState(o: { answered: boolean; asked: boolean; busy: boolean; perm: NotificationPermission | "unsupported" }): PingState {
  if (o.perm === "unsupported") return "hidden";
  if (o.busy) return "asking";
  // a "Don't Allow" stays visible with its switch until dismissed; a yes shows once, then goes
  if (o.perm === "denied") return o.asked ? "hidden" : o.answered ? "off" : "hidden";
  if (o.asked) return "hidden";
  if (o.perm === "granted") return "hidden";
  return o.answered ? "ask" : "hidden";
}

/** The one place to turn pings back on: the desktop app opens the system switch; a browser can only say where it is. */
export function switchHelp(): { open?: () => void; where: string } {
  const desktop = typeof window !== "undefined" ? window.wispDesktop?.notifications : undefined;
  if (desktop) return { open: () => void desktop.openSettings(), where: "System Settings › Notifications › Wisp" };
  return { where: "your browser's site settings for this page (the icon left of the address)" };
}

export function FirstChatExtras({ agent, channelId, workspaceId }: { agent: Agent | undefined; channelId: string; workspaceId: string }) {
  const [asked, setAsked] = useState(() => !!read(ASKED_KEY(workspaceId)));
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [justOn, setJustOn] = useState(false);
  const [perm, setPerm] = useState(() => permission());
  // Default outside the selector: `?? []` inside it hands back a new array on every read while the
  // chat's messages haven't loaded, and useSyncExternalStore loops on it (React error #185).
  const messages = useStore((s) => s.messages[channelId]) ?? NO_MESSAGES;
  // quick replies, until you've said something yourself
  const youSpoke = messages.some((m) => m.author.kind === "user");
  if (!agent || !isFirstChat(agent, channelId)) return null;
  const quick = !sent && !youSpoke ? QUICK : [];
  const reply = (text: string) => {
    setSent(true);
    void api("POST", `/api/channels/${channelId}/messages`, { body: text }).catch(() => setSent(false));
  };
  const seen = !!read(hereSeenKey(agent.id));
  const close = () => {
    write(ASKED_KEY(workspaceId));
    setAsked(true);
  };
  const turnOn = async () => {
    setBusy(true);
    try {
      // the system's own prompt: nothing of ours sits on top of it
      const p = await enableNotifications();
      setPerm(p);
      if (p === "granted") {
        setJustOn(true);
        if (pushSupported()) await enablePush().catch(() => undefined);
        write(ASKED_KEY(workspaceId));
      }
    } finally {
      setBusy(false);
    }
  };
  const ping = justOn ? "on" : pingState({ answered: answeredOnce(messages, agent.id), asked, busy, perm });
  const help = switchHelp();
  if (ping === "hidden" && seen && !quick.length) return null;
  return (
    <div className="shrink-0 w-full max-w-3xl mx-auto px-3 md:px-5 flex flex-col gap-2 pb-2">
      {!!quick.length && (
        <div className="flex flex-wrap gap-1.5 justify-end" role="group" aria-label="Quick replies">
          {quick.map((q, i) => (
            <button
              key={q}
              type="button"
              onClick={() => reply(q)}
              className={
                i === 0
                  ? "first-chat-pop h-8 rounded-full bg-ink px-3.5 text-[13px] text-panel transition-transform active:scale-[.97]"
                  : "first-chat-pop h-8 rounded-full border border-line2 bg-panel px-3.5 text-[13px] text-ink hover:bg-hover transition-transform active:scale-[.97]"
              }
              style={{ animationDelay: `${600 + i * 60}ms` }}
            >
              {q}
            </button>
          ))}
        </div>
      )}
      {ping !== "hidden" && (
        <section className="first-chat-pop flex items-start gap-3 rounded-[18px] border border-line bg-card px-3.5 py-3" aria-label="Notifications" aria-live="polite">
          <Bell size={16} strokeWidth={1.7} className="mt-0.5 shrink-0 text-muted" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-ink">{ping === "on" ? "Pings are on." : ping === "off" ? "Pings are off for Wisp." : "Want a ping when this is done?"}</div>
            <div className="mt-0.5 text-[13px] leading-5 text-muted">
              {ping === "on"
                ? "I'll only ping you when something's finished or I need a yes."
                : ping === "off"
                  ? help.open
                    ? "Only the system switch can turn them back on."
                    : `Turn them on in ${help.where}.`
                  : "I'll only message you when something's finished or I need a yes."}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {(ping === "ask" || ping === "asking") && (
                <>
                  <button type="button" disabled={busy} onClick={turnOn} className="h-8 rounded-full bg-ink px-3.5 text-[13px] text-panel transition-transform active:scale-[.97] disabled:opacity-60">
                    Turn on
                  </button>
                  <button type="button" disabled={busy} onClick={close} className="h-8 rounded-full border border-line2 px-3.5 text-[13px] text-ink hover:bg-hover transition-transform active:scale-[.97]">
                    Not now
                  </button>
                </>
              )}
              {ping === "off" && help.open && (
                <button type="button" onClick={help.open} className="h-8 rounded-full bg-ink px-3.5 text-[13px] text-panel transition-transform active:scale-[.97]">
                  Open the switch
                </button>
              )}
              {(ping === "off" || ping === "on") && (
                <button type="button" onClick={() => (setJustOn(false), close())} className="h-8 rounded-full border border-line2 px-3.5 text-[13px] text-ink hover:bg-hover transition-transform active:scale-[.97]">
                  {ping === "on" ? "OK" : "Not now"}
                </button>
              )}
            </div>
          </div>
        </section>
      )}
      {!seen && (
        <button type="button" onClick={() => go({ view: "here", agentId: agent.id })} className="first-chat-pop self-center inline-flex h-7 items-center gap-0.5 px-2 text-[13px] text-muted hover:text-ink">
          See what I set up
          <ChevronRight size={14} strokeWidth={1.8} aria-hidden />
        </button>
      )}
      <style>{`@keyframes first-chat-pop{0%{opacity:0;transform:translateY(16px)}100%{opacity:1;transform:none}}.first-chat-pop{animation:first-chat-pop .45s cubic-bezier(.22,1,.36,1) both}@media (prefers-reduced-motion: reduce){.first-chat-pop{animation:none}}`}</style>
    </div>
  );
}
