import { Suspense, lazy, useState } from "react";
import { SuggestionBanner } from "../SuggestionBanner.tsx";
import { api } from "../../api.ts";
import { useStore } from "../../store.ts";
import { Bell } from "lucide-react";
import type { Agent, Message } from "@bubble-ai/core";
import { enableNotifications, permission } from "../../notifications.ts";
import { enablePush, pushSupported } from "../../push.ts";
import { go, type Route } from "../../router.ts";
import { nextAsk, setReadyItem, useReadyChecklist, type ReadyItem, type ReadyRow } from "../../onboarding.ts";
import { loadAnswers } from "../../onboardingV3.ts";

/**
 * The extras in a new agent's first chat, one thing at a time. First a quick reply to its hello.
 * Then, in the first agent's chat, what the first run no longer asks (your phone, apps, away from
 * home, getting to know you): each as a bubble from the agent with its one action and "Later".
 * Notifications are asked about only after its first useful answer, when a ping would mean
 * something; Turn on brings up the system's own prompt, and after "Don't Allow" the card links to
 * the exact switch.
 */

/** What you can answer its hello with in one tap: the first is the one primary button. */
export const QUICK = ["Yes, go ahead", "Something else first"] as const;

/** Where each of setup's questions leads: a page, or a sheet that opens here. */
export const ASK_OPENS: Record<ReadyItem, Route | "phone" | "know"> = {
  phone: "phone",
  apps: { view: "marketplace", section: "apps" },
  away: { view: "settings", page: "access" },
  know: "know",
};

/**
 * What the agent asks next in its first chat, one at a time: nothing until the person has answered
 * its hello, nothing while the notifications question is up, nothing for guests, and only in the
 * chat of the agent the first run made.
 */
export function chatAsk(o: { rows: readonly ReadyRow[]; started: boolean; youSpoke: boolean; pingUp: boolean; guest: boolean; firstAgent: boolean }): ReadyRow | null {
  if (!o.started || !o.youSpoke || o.pingUp || o.guest || !o.firstAgent) return null;
  return nextAsk(o.rows);
}

// the sheets (the pairing code, getting to know you) load only when one is opened
const PhoneSheet = lazy(() => import("./AskSheets.tsx").then((m) => ({ default: m.PhoneSheet })));
const KnowSheet = lazy(() => import("./AskSheets.tsx").then((m) => ({ default: m.KnowSheet })));

const ASKED_KEY = (workspaceId: string) => `wisp.notifyAsked.${workspaceId}`;
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
  if (desktop) return { open: () => void desktop.openSettings(), where: "System Settings › Notifications › Bubble AI" };
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
  const ready = useReadyChecklist();
  const guest = useStore((s) => s.me?.role === "guest");
  const [firstAgentId] = useState(() => loadAnswers(workspaceId).agentId);
  const [sheet, setSheet] = useState<"phone" | "know" | null>(null);
  if (!agent || !isFirstChat(agent, channelId)) return null;
  const quick = !sent && !youSpoke ? QUICK : [];
  const reply = (text: string) => {
    setSent(true);
    void api("POST", `/api/channels/${channelId}/messages`, { body: text }).catch(() => setSent(false));
  };
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
  const ask = chatAsk({ rows: ready.items, started: ready.started, youSpoke: youSpoke || sent, pingUp: ping !== "hidden", guest, firstAgent: firstAgentId === agent.id });
  const yes = (id: ReadyItem) => {
    const to = ASK_OPENS[id];
    setReadyItem(workspaceId, id, true);
    if (typeof to === "string") setSheet(to);
    else go(to);
  };
  const sheets = sheet && <Suspense fallback={null}>{sheet === "phone" ? <PhoneSheet onClose={() => setSheet(null)} /> : <KnowSheet agent={agent} workspaceId={workspaceId} onClose={() => setSheet(null)} />}</Suspense>;
  const nothing = ping === "hidden" && !quick.length;
  if (nothing && !sheet && !ask) return null;
  return (
    <>
    {ask && <SuggestionBanner key={ask.id} label={ask.label} text={ask.ask} action={ask.action} onAction={() => yes(ask.id)} onClose={() => setReadyItem(workspaceId, ask.id, "later")} closeLabel="Later" />}
    {/* an open sheet keeps its place here even once there is nothing else to show */}
    <div className={nothing ? "hidden" : "shrink-0 w-full max-w-3xl mx-auto px-3 md:px-5 flex flex-col gap-2 pb-2"}>
      {sheets}
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
            <div className="text-[13px] font-medium text-ink">{ping === "on" ? "Pings are on." : ping === "off" ? "Pings are off for Bubble AI." : "Want a ping when this is done?"}</div>
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
      <style>{`@keyframes first-chat-pop{0%{opacity:0;transform:translateY(16px)}100%{opacity:1;transform:none}}.first-chat-pop{animation:first-chat-pop .45s cubic-bezier(.22,1,.36,1) both}@media (prefers-reduced-motion: reduce){.first-chat-pop{animation:none}}`}</style>
    </div>
    </>
  );
}
