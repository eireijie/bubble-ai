import { useEffect, useState, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { workSteps, type Agent, type Approval, type Followup, type TeamStep } from "@wisp/core";
import { api } from "../api.ts";
import { usePrefs, useStore, type ComputerInfo, type LiveRun } from "../store.ts";
import { go, href } from "../router.ts";
import { AgentAvatar, Menu, cx, timeAgo } from "./ui.tsx";
import { AppleApprovalCard } from "./AppleParts.tsx";
import { PickTime, changeFollowup, reminderTimes, whenText } from "./Loops.tsx";

/** The small grey heading over a group, with a count or a link on the right. */
export function SectionHead({ title, right, needs }: { title: string; right?: ReactNode; needs?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2.5 px-0.5 pt-4 first:pt-0 text-[13px] md:text-[14px] font-semibold text-muted">
      <h2>{title}</h2>
      {right !== undefined && right !== null && <span className={cx("font-medium", needs && "text-st-needs")}>{right}</span>}
    </div>
  );
}

/** A flat card on the page (16px, no border). */
export function GroupCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-2xl bg-card overflow-hidden", className)}>{children}</div>;
}

/** A thin rule between rows, inset like the phone's lists. */
export function Rule() {
  return <div className="h-px bg-line mx-4" role="separator" />;
}

/** The pill buttons under a request: an ink pill for the main answer, a hairline pill for the other, bare text for the quiet ones. */
export function CardButton({ tone = "soft", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "soft" | "ghost" | "danger" }) {
  return (
    <button
      type="button"
      {...p}
      className={cx(
        "m-press h-9 md:h-8 px-[15px] rounded-full text-sm font-semibold whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
        tone === "primary" && "bg-ink text-panel hover:bg-ink/85",
        tone === "danger" && "bg-bad text-white hover:bg-bad/90",
        tone === "soft" && "bg-transparent text-ink hover:bg-hover border border-line2 font-medium",
        tone === "ghost" && "bg-transparent text-muted hover:text-ink px-3 font-medium",
        className,
      )}
    />
  );
}

/** A tinted label (Working, Needs you, Done…): one hue from the status tokens, mixed into the surface. */
export function StateChip({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "bad" | "info"; children: ReactNode }) {
  const color = { neutral: "var(--muted)", ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", info: "var(--info)" }[tone];
  return (
    <span className="inline-flex items-center h-[26px] px-2.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0" style={{ color, background: `color-mix(in oklab, ${color} 15%, transparent)` }}>
      {children}
    </span>
  );
}

// ---------- "Not now" on a computer-help request: put under Later for this tab session, kept in the chat ----------

const KEY = "wisp.helpSeen";
const listeners = new Set<() => void>();
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
  } catch {
    cache = [];
  }
  return cache!;
}

const subscribeHelpSeen = (cb: () => void) => (listeners.add(cb), () => void listeners.delete(cb));

/** Ids of the help requests already shown or put off ("computerId:at"). */
export function useHelpSeen(): string[] {
  return useSyncExternalStore(subscribeHelpSeen, read, read);
}

export const helpKey = (c: ComputerInfo) => `${c.id}:${c.help!.at}`;

export function dismissHelp(c: ComputerInfo) {
  cache = [...read(), helpKey(c)].slice(-50);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(cache));
  } catch {}
  listeners.forEach((l) => l());
}

// ---------- the Needs you rows ----------

/**
 * One thing that waits on you: the ghost of who asks, one sentence (it opens the chat where it was
 * asked), who and when, and its buttons underneath.
 */
export function NeedRow({ avatar, text, to, onOpen, meta, children }: { avatar: ReactNode; text: string; to?: string; onOpen?: () => void; meta: (string | null | undefined | false)[]; children?: ReactNode }) {
  const line = "text-[15px] md:text-[17px] leading-[22px] md:leading-6 font-semibold break-words";
  const link = cx(line, "text-left rounded-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40");
  return (
    <li className="flex items-start gap-3.5 py-3.5">
      <span className="shrink-0 grid w-10 place-items-center">{avatar}</span>
      <div className="min-w-0 flex-1 flex flex-col gap-2.5">
        <div className="flex flex-col items-start">
          {to ? (
            <a href={to} className={link}>
              {text}
            </a>
          ) : onOpen ? (
            <button type="button" onClick={onOpen} className={link}>
              {text}
            </button>
          ) : (
            <span className={line}>{text}</span>
          )}
          <span className="max-w-full truncate text-[13px] md:text-[14px] leading-[18px] text-muted">{meta.filter(Boolean).join(" · ")}</span>
        </div>
        {children}
      </div>
    </li>
  );
}

/** The buttons under a row's sentence. */
function Answers({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

/** What an answered request settles to, the same quiet line as in the chat: "Allowed" or "Not now", and who said so when it wasn't you. */
function SettledLine({ approval: a }: { approval: Approval }) {
  const who = useStore((s) => (a.decidedBy && a.decidedBy !== s.me?.user.id ? (s.members.find((m) => m.id === a.decidedBy)?.name ?? null) : null));
  const ok = a.status === "approved";
  return (
    <div className="flex items-center gap-1.5 text-[13px] md:text-[14px] leading-5 text-muted" role="status">
      {ok ? <Check size={14} aria-hidden /> : <X size={14} aria-hidden />}
      {ok ? "Allowed" : "Not now"}
      {who && <span>· {who}</span>}
    </div>
  );
}

/**
 * An agent wants your OK: Allow and Not now, the same two answers as in the chat (a note is a reply
 * there). A login is answered only by whoever connected it, a file on a storage only by an owner;
 * both can be allowed for good. Once answered the row settles to one quiet line.
 */
export function ApprovalNeed({ approval: a, text }: { approval: Approval; text: string }) {
  const me = useStore((s) => s.me);
  const agent = useStore((s) => s.agents.find((x) => x.id === a.agentId));
  const team = useStore((s) => s.channels.find((c) => c.id === a.channelId && c.kind !== "dm")?.name ?? null);
  const loginOwner = useStore((s) => (a.login ? (s.members.find((m) => m.id === a.login!.ownerId)?.name ?? null) : null));
  // the message that carries the request, when that chat is loaded: the sentence opens the chat right there
  const messageId = useStore((s) => s.messages[a.channelId]?.find((m) => m.parts.some((p) => p.type === "approval" && p.approvalId === a.id))?.id);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = agent?.name ?? "An agent";
  const pending = a.status === "pending";
  // the hub takes "always" only together with the answer, so it is offered beside it, not after
  const always = !!a.login || (!!a.storage && a.storage.action !== "delete");
  const waitingFor = a.login ? (me?.user.id !== a.login.ownerId ? (loginOwner ?? "whoever connected it") : null) : a.storage && me?.role !== "owner" ? "an owner" : null;
  const decide = async (approve: boolean, forGood = false) => {
    setBusy(true);
    setError(null);
    try {
      const done = await api<Approval>("POST", `/api/approvals/${a.id}/decide`, a.login || a.storage ? { approve, always: forGood } : { approve });
      useStore.setState((s) => ({ approvals: { ...s.approvals, [a.id]: done } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <NeedRow
      avatar={<AgentAvatar agent={agent} size={40} live />}
      text={text}
      to={href({ view: "chat", channelId: a.channelId, threadId: a.threadId, ...(messageId ? { messageId } : {}) })}
      meta={[name, team, a.login?.site, a.login?.username, timeAgo(a.createdAt)]}
    >
      {a.apple ? (
        // a text or an event (the Apple mod): the same card as in the chat, with its own answers
        <AppleApprovalCard approval={a} className="!mt-0 max-w-none" />
      ) : (
        <>
          {!pending ? (
            <SettledLine approval={a} />
          ) : waitingFor ? (
            <p className="text-[13px] md:text-[14px] leading-5 text-muted">Waiting for {waitingFor}.</p>
          ) : (
            <Answers>
              <CardButton tone={a.storage?.action === "delete" ? "danger" : "primary"} disabled={busy} onClick={() => decide(true)}>
                {a.storage?.action === "delete" ? "Delete" : "Allow"}
              </CardButton>
              <CardButton disabled={busy} onClick={() => decide(false)}>
                Not now
              </CardButton>
              {always && (
                <CardButton tone="ghost" disabled={busy} onClick={() => decide(true, true)} title={a.storage ? "Always allow in this folder" : `Always allow for ${name}`}>
                  Always allow
                </CardButton>
              )}
              {a.details && (
                <CardButton tone="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
                  Details
                </CardButton>
              )}
            </Answers>
          )}
          {open && pending && a.details && <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-card p-3 text-xs">{a.details}</pre>}
          {error && <p className="text-xs text-bad">{error}</p>}
        </>
      )}
    </NeedRow>
  );
}

/** An agent asked you to take over on its computer. "Not now" puts it under Later for this tab session; it stays in the chat and on Computers. */
export function HelpNeed({ computer: c, text, later }: { computer: ComputerInfo; text: string; later?: boolean }) {
  const agent = useStore((s) => s.agents.find((x) => x.id === c.help!.agentId));
  const help = c.help!;
  return (
    <NeedRow avatar={<AgentAvatar agent={agent} size={40} live />} text={text} to={href({ view: "chat", channelId: help.channelId, threadId: help.threadId })} meta={[agent?.name ?? "An agent", c.name, timeAgo(help.at)]}>
      <Answers>
        <CardButton tone="primary" onClick={() => go({ view: "computers", computerId: c.id })}>
          Take over
        </CardButton>
        {!later && <CardButton onClick={() => dismissHelp(c)}>Not now</CardButton>}
      </Answers>
    </NeedRow>
  );
}

/**
 * A reminder that came due with nobody to bring it (its agent is offline or at a limit): Done, or
 * Later for a time. Under Later it is one the person put off, with its new time.
 */
export function ReminderNeed({ reminder: f, later }: { reminder: Followup; later?: boolean }) {
  const agent = useStore((s) => s.agents.find((x) => x.id === f.agentId));
  const { clock } = usePrefs();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = (body: Parameters<typeof changeFollowup>[1]) => {
    setBusy(true);
    setError(null);
    changeFollowup(f.id, body)
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  const times = [...reminderTimes().map((t) => ({ label: `${t.label} · ${whenText(t.at.toISOString(), new Date(), clock).replace(/^Tomorrow /, "")}`, onSelect: () => change({ dueAt: t.at.toISOString() }) })), { label: "Pick a time…", onSelect: () => setPicking(true) }];
  const label = f.label ?? f.note;
  return (
    <NeedRow
      avatar={<AgentAvatar agent={agent} size={40} live />}
      text={label}
      to={f.channelId ? href({ view: "chat", channelId: f.channelId, threadId: null, ...(f.messageId ? { messageId: f.messageId } : {}) }) : undefined}
      meta={[agent?.name ?? "An agent", whenText(f.dueAt, new Date(), clock)]}
    >
      <Answers>
        <CardButton tone="primary" disabled={busy} onClick={() => change({ status: "done" })}>
          Done
        </CardButton>
        {!later && (
          <Menu
            items={times}
            trigger={(open, toggle) => (
              <CardButton disabled={busy} onClick={toggle} aria-expanded={open} aria-haspopup="menu">
                Later
              </CardButton>
            )}
          />
        )}
      </Answers>
      {error && <p className="text-xs text-bad">{error}</p>}
      {picking && <PickTime title={label} dueAt={f.dueAt} onClose={() => setPicking(false)} onPick={(at) => change({ dueAt: at.toISOString() })} />}
    </NeedRow>
  );
}

/** "Stopped at step 2.": where a team's request stands still, counted the way the team's own steps are. */
export function stoppedLine(steps: TeamStep[], stepId: string): string {
  const n = workSteps(steps).findIndex((s) => s.id === stepId) + 1;
  return n > 0 ? `Stopped at step ${n}.` : "Stopped.";
}

/** "Sending to @chief…", or the tail of what it's writing. */
export function runSummary(r: LiveRun, agents: Agent[]): string {
  const last = r.last;
  if (last) {
    const input = (last.input ?? {}) as Record<string, unknown>;
    const to = typeof input.to === "string" ? input.to : typeof input.agent === "string" ? input.agent : null;
    if (to) return `Using ${last.name} → ${agents.find((a) => a.id === to || a.handle === to.replace(/^@/, ""))?.name ?? to}`;
    return `Using ${last.name}`;
  }
  const text = r.text.trim().split("\n").filter(Boolean).pop() ?? "";
  if (text) return text.length > 140 ? "…" + text.slice(-140) : text;
  return r.usedComputer ? "Using its computer" : "Thinking";
}


/**
 * A question before something you can't take back (merge, cancel): a card low on a phone, centered on
 * a desktop, over a dimmed page. Esc or tapping outside keeps things as they are.
 */
export function ConfirmDialog({ title, body, confirm, keep = "Keep reviewing", danger, busy, onConfirm, onClose }: { title: string; body: ReactNode; confirm: string; keep?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);
  return (
    <div className="m-scrim fixed inset-0 z-[70] bg-black/55 flex items-end md:items-center justify-center p-3 pb-6 md:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="alertdialog" aria-modal="true" aria-label={title} className="m-dialog w-full max-w-[420px] rounded-xl bg-card border border-line shadow-panel px-5 pt-[22px] pb-3.5 flex flex-col gap-3">
        <h2 className="t-title">{title}</h2>
        <p className="text-body leading-snug text-muted">{body}</p>
        <CardButton tone="primary" disabled={busy} onClick={onConfirm} className={cx("h-[50px] md:h-11", danger && "bg-bad text-white hover:bg-bad/90")} autoFocus>
          {confirm}
        </CardButton>
        <CardButton tone="ghost" onClick={onClose} className="h-[50px] md:h-11">
          {keep}
        </CardButton>
      </div>
    </div>
  );
}
