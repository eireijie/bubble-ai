import { useEffect, useState, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from "react";
import { LOGIN_SOURCE_LABEL, type Agent, type Approval } from "@wisp/core";
import { api } from "../api.ts";
import { useStore, type ComputerInfo, type LiveRun } from "../store.ts";
import { go } from "../router.ts";
import { AgentAvatar, cx, timeAgo } from "./ui.tsx";
import { StorageLogo } from "../views/settings/storage.tsx";
import { AppleApprovalCard } from "./AppleParts.tsx";

/** "Needs you", "New replies"…: the small grey heading over a group, with a count or a link on the right. */
export function SectionHead({ title, right, needs }: { title: string; right?: ReactNode; needs?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2.5 px-0.5 pt-4 first:pt-0 text-[13px] font-semibold text-muted">
      <h2>{title}</h2>
      {right !== undefined && right !== null && <span className={cx("font-medium", needs && "text-st-needs")}>{right}</span>}
    </div>
  );
}

/** A flat card on the page (canvas Inbox: 16px, no border). */
export function GroupCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-2xl bg-card overflow-hidden", className)}>{children}</div>;
}

/** A thin rule between rows, inset like the phone's lists. */
export function Rule() {
  return <div className="h-px bg-line mx-4" role="separator" />;
}

/** The big pill buttons on a card: filled for the main answer, soft for the other, bare for "Open chat". */
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

// ---------- "Not now" on a computer-help request: hidden for this tab session, kept in the chat ----------

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

/** Ids of the help requests already shown or put off ("computerId:at"). */
export function useHelpSeen(): string[] {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    read,
    read,
  );
}

export const helpKey = (c: ComputerInfo) => `${c.id}:${c.help!.at}`;

export function dismissHelp(c: ComputerInfo) {
  cache = [...read(), helpKey(c)].slice(-50);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(cache));
  } catch {}
  listeners.forEach((l) => l());
}

// ---------- the Needs you cards ----------

function CardHead({ agent, title, sub }: { agent: Agent | undefined; title: ReactNode; sub: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <AgentAvatar agent={agent} size={32} live />
      <div className="min-w-0 flex-1 flex flex-col">
        <div className="text-[13px] text-muted truncate">{sub}</div>
        <div className="font-semibold leading-snug">{title}</div>
      </div>
    </div>
  );
}

/** An agent wants your OK: what it will do, an optional note, Approve / Not now / Open chat. */
export function ApprovalNeedCard({ approval: a }: { approval: Approval }) {
  const agent = useStore((s) => s.agents.find((x) => x.id === a.agentId));
  const channel = useStore((s) => s.channels.find((c) => c.id === a.channelId));
  const [note, setNote] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const where = !channel ? null : channel.kind === "dm" ? null : channel.name;
  const decide = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const done = await api<Approval>("POST", `/api/approvals/${a.id}/decide`, { approve, note: note.trim() });
      useStore.setState((s) => ({ approvals: { ...s.approvals, [a.id]: done } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <GroupCard className="px-4 py-3.5 flex flex-col gap-2.5">
      <CardHead agent={agent} title={`${agent?.name ?? "An agent"} wants your OK`} sub={`${agent?.name ?? "Agent"} · ${where ? `${where} · ` : ""}${timeAgo(a.createdAt)}`} />
      <div className="rounded-xl bg-[var(--bubble-them)] px-3 py-2.5 text-[13px] leading-[19px] text-muted break-words">{a.summary}</div>
      {a.details && (
        <div>
          <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className="text-xs text-muted hover:text-ink">
            {more ? "Hide details" : "Show details"}
          </button>
          {more && <pre className="mt-1.5 whitespace-pre-wrap text-xs rounded-xl bg-panel p-3 max-h-60 overflow-y-auto">{a.details}</pre>}
        </div>
      )}
      <input
        aria-label="Add a note (optional)"
        placeholder="Add a note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="h-9 rounded-[10px] border border-line2 bg-transparent px-3 text-sm outline-none placeholder:text-faint focus:border-ring"
      />
      <div className="flex flex-wrap gap-2">
        <CardButton tone="primary" disabled={busy} onClick={() => decide(true)}>
          Approve
        </CardButton>
        <CardButton onClick={() => go({ view: "chat", channelId: a.channelId, threadId: a.threadId })}>Open chat</CardButton>
        <CardButton tone="ghost" disabled={busy} onClick={() => decide(false)}>
          Not now
        </CardButton>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
    </GroupCard>
  );
}

/** An agent wants to sign in with a login from your password manager: only whoever connected it answers. */
export function LoginNeedCard({ approval: a }: { approval: Approval }) {
  const login = a.login!;
  const me = useStore((s) => s.me);
  const agent = useStore((s) => s.agents.find((x) => x.id === a.agentId));
  const owner = useStore((s) => s.members.find((m) => m.id === login.ownerId)?.name ?? "whoever connected it");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = agent?.name ?? "An agent";
  const decide = async (approve: boolean, always = false) => {
    setBusy(true);
    setError(null);
    try {
      const done = await api<Approval>("POST", `/api/approvals/${a.id}/decide`, { approve, always });
      useStore.setState((s) => ({ approvals: { ...s.approvals, [a.id]: done } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <GroupCard className="px-4 py-3.5 flex flex-col gap-2.5">
      <section aria-label="Login request" className="contents">
        <CardHead agent={agent} title={`${name} wants to sign in to ${login.site}`} sub={`${login.username ? `Account ${login.username} · ` : ""}from ${LOGIN_SOURCE_LABEL[login.source] ?? "your password manager"}`} />
        <p className="text-xs text-muted">Wisp types it into {login.site} on {name}'s computer, so the password never goes in chat.</p>
        {me?.user.id !== login.ownerId ? (
          <p className="text-xs text-muted">Waiting for {owner}: only they can let agents use their logins.</p>
        ) : (
          <div className="flex flex-wrap gap-2.5">
            <CardButton tone="primary" disabled={busy} onClick={() => decide(true)} className="flex-1 md:flex-none">
              Allow sign-in
            </CardButton>
            <CardButton disabled={busy} onClick={() => decide(false)} className="flex-1 md:flex-none">
              Not now
            </CardButton>
            <CardButton tone="ghost" disabled={busy} onClick={() => decide(true, true)} className="max-md:basis-full">
              Always allow for {name}
            </CardButton>
          </div>
        )}
        {error && <p className="text-xs text-bad">{error}</p>}
      </section>
    </GroupCard>
  );
}

/** An agent wants to add, replace or delete a file on the workspace's storage: owners answer. */
export function StorageNeedCard({ approval: a }: { approval: Approval }) {
  const req = a.storage!;
  const me = useStore((s) => s.me);
  const agent = useStore((s) => s.agents.find((x) => x.id === a.agentId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = agent?.name ?? "An agent";
  const decide = async (approve: boolean, always = false) => {
    setBusy(true);
    setError(null);
    try {
      const done = await api<Approval>("POST", `/api/approvals/${a.id}/decide`, { approve, always });
      useStore.setState((s) => ({ approvals: { ...s.approvals, [a.id]: done } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <GroupCard className="px-4 py-3.5 flex flex-col gap-2.5">
      <section aria-label="Storage request" className="contents">
        <CardHead agent={agent} title={`${name} wants your OK`} sub={timeAgo(a.createdAt)} />
        <div className="flex items-center gap-3 rounded-xl bg-panel px-3 py-2.5">
          <StorageLogo service={req.service} size={32} />
          <span className="min-w-0 text-sm text-ink/85 break-words">{a.summary}</span>
        </div>
        {me?.role !== "owner" ? (
          <p className="text-xs text-muted">Waiting for an owner to answer.</p>
        ) : (
          <div className="flex flex-wrap gap-2.5">
            <CardButton tone={req.action === "delete" ? "danger" : "primary"} disabled={busy} onClick={() => decide(true)} className="flex-1 md:flex-none">
              {req.action === "delete" ? "Delete" : req.action === "replace" ? "Replace" : "Allow"}
            </CardButton>
            {req.action !== "delete" && (
              <CardButton disabled={busy} onClick={() => decide(true, true)} className="flex-1 md:flex-none">
                Always in this folder
              </CardButton>
            )}
            <CardButton disabled={busy} onClick={() => decide(false)} className="flex-1 md:flex-none">
              No
            </CardButton>
          </div>
        )}
        {error && <p className="text-xs text-bad">{error}</p>}
      </section>
    </GroupCard>
  );
}

/** An agent wants to send a text or change an event or reminder (the Apple mod): the same card as in chat, under who's asking. */
export function AppleNeedCard({ approval: a }: { approval: Approval }) {
  const agent = useStore((s) => s.agents.find((x) => x.id === a.agentId));
  return (
    <GroupCard className="p-4 md:px-5 md:py-[18px] flex flex-col gap-3">
      <CardHead agent={agent} title={`${agent?.name ?? "An agent"} wants your OK`} sub={timeAgo(a.createdAt)} />
      <AppleApprovalCard approval={a} className="!mt-0 max-w-none" />
      <div>
        <CardButton tone="ghost" onClick={() => go({ view: "chat", channelId: a.channelId, threadId: a.threadId })} className="!px-0">
          Open chat
        </CardButton>
      </div>
    </GroupCard>
  );
}

/** An agent asked you to take over on its computer. */
export function HelpNeedCard({ computer: c }: { computer: ComputerInfo }) {
  const agent = useStore((s) => s.agents.find((x) => x.id === c.help!.agentId));
  return (
    <GroupCard className="px-4 py-3.5 flex flex-col gap-2.5">
      <CardHead agent={agent} title={`${agent?.name ?? "An agent"} needs you on ${c.name}`} sub={`Asked for help on a computer · ${timeAgo(c.help!.at)}`} />
      {c.help!.request && <p className="rounded-xl bg-panel px-3 py-2.5 text-sm text-ink/85">“{c.help!.request}”</p>}
      <div className="flex flex-wrap gap-2.5">
        <CardButton tone="primary" onClick={() => go({ view: "computers", computerId: c.id })} className="flex-1 md:flex-none">
          Open computer
        </CardButton>
        <CardButton onClick={() => dismissHelp(c)} className="flex-1 md:flex-none">
          Not now
        </CardButton>
      </div>
    </GroupCard>
  );
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
