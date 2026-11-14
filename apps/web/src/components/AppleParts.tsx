import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Calendar, Check, Contact, ListChecks, MessageCircle, Navigation, X } from "lucide-react";
import { type AppleApp, type Approval, type MessagePart } from "@wisp/core";
import { api, getToken, observeEvents } from "../api.ts";
import { usePrefs, useStore } from "../store.ts";
import { clockTime, cx } from "./ui.tsx";

/*
 * The Apple mod's shared pieces: the real app icons (from the hub, read off the Mac), the
 * segmented Off / Read / Read and send control, the approval card and the "Read your last 5
 * texts" lines under a reply.
 */

// --- icons -------------------------------------------------------------------------------------

const FALLBACK: Record<AppleApp, typeof Calendar> = { messages: MessageCircle, contacts: Contact, calendar: Calendar, reminders: ListChecks, location: Navigation };

const icons = new Map<AppleApp, Promise<string | null>>();
let watching = false;

/**
 * The app's real icon as an object URL, or null while the hub has none (no Mac has sent them yet).
 * Fetched once per session with the bearer header, like files. A miss is tried again after the
 * Apple settings change, since that's when a Mac joins and sends them.
 */
export function appleIconUrl(app: AppleApp): Promise<string | null> {
  if (!watching) {
    watching = true;
    observeEvents((e) => {
      if (e.type !== "apple_changed") return;
      for (const [k, p] of icons) void p.then((url) => url === null && icons.get(k) === p && icons.delete(k));
    });
  }
  let p = icons.get(app);
  if (!p) {
    p = fetch(`/api/apple/icons/${app}`, { headers: { authorization: `Bearer ${getToken()}` } })
      .then(async (res) => {
        if (!res.ok) return null;
        // always an image, whatever the response says it is, so nothing else can run on Wisp's origin
        return URL.createObjectURL(new Blob([await res.blob()], { type: "image/png" }));
      })
      .catch(() => null);
    icons.set(app, p);
  }
  return p;
}

/** The real Apple app icon; a plain line icon on a neutral tile while it loads or when the hub has none. */
export function AppleIcon({ app, size = 36 }: { app: AppleApp; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void appleIconUrl(app).then((u) => live && setUrl(u));
    return () => void (live = false);
  }, [app]);
  const radius = Math.round(size * 0.22);
  if (url) return <img src={url} alt="" aria-hidden width={size} height={size} className="shrink-0 object-cover" style={{ width: size, height: size, borderRadius: radius }} />;
  const I = FALLBACK[app];
  return (
    <span aria-hidden className="grid shrink-0 place-items-center bg-chip text-ink/80" style={{ width: size, height: size, borderRadius: radius }}>
      <I size={Math.max(10, Math.round(size * 0.5))} strokeWidth={1.7} />
    </span>
  );
}

// --- segmented control --------------------------------------------------------------------------

/**
 * Off / Read / Read and send: options as wide as their words, the selection a raised pill that
 * slides to the one picked (motion.css's indicator spring; reduced motion only fades).
 */
export function AppleSeg<T extends string | number>({ label, value, options, onChange, disabled, className }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; disabled?: boolean; className?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null);
  const i = options.findIndex(([v]) => v === value);
  useLayoutEffect(() => {
    const measure = () => {
      const el = track.current?.querySelectorAll<HTMLElement>("[role=radio]")[i];
      setInd(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    measure();
    if (typeof ResizeObserver === "undefined" || !track.current) return;
    const ro = new ResizeObserver(measure);
    ro.observe(track.current);
    return () => ro.disconnect();
  }, [i, options.length]);
  return (
    <div ref={track} role="radiogroup" aria-label={label} className={cx("relative inline-flex shrink-0 gap-0.5 rounded-lg bg-chip p-0.5", className)}>
      {ind && <span aria-hidden className="m-ind left-0 top-0.5 bottom-0.5 rounded-md bg-panel shadow-[0_1px_2px_rgb(0_0_0/0.14)]" style={{ width: ind.w, transform: `translateX(${ind.x}px)` }} />}
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          onClick={() => value !== v && onChange(v)}
          className={cx("m-press relative z-[1] h-7 flex-1 whitespace-nowrap rounded-md px-3 text-[13px] disabled:cursor-default", value === v ? "font-medium text-ink" : "text-muted enabled:hover:text-ink", !ind && value === v && "bg-panel")}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

// --- what an agent read ---------------------------------------------------------------------------

/** "Found Sam Rivera in Contacts", "Read your last 5 texts with Sam": a quiet line each, with the app's icon. */
export function AppleReadLines({ parts }: { parts: MessagePart[] }) {
  const lines = parts.flatMap((p) => (p.type === "apple_read" ? [p] : []));
  if (!lines.length) return null;
  return (
    <div className="mb-1 flex flex-col gap-1 px-0.5">
      {lines.map((p, i) => (
        <div key={i} className="m-work flex max-w-full items-center gap-1.5 text-xs text-muted">
          <AppleIcon app={p.app} size={16} />
          <span className="truncate">{p.text}</span>
        </div>
      ))}
    </div>
  );
}

// --- approval card --------------------------------------------------------------------------------

/** Sending a text or changing an event or reminder: what it will do, and the owner's answer. */
export function AppleApprovalCard({ approval, className }: { approval: Approval; className?: string }) {
  const req = approval.apple!;
  const me = useStore((s) => s.me);
  const decider = useStore((s) => (approval.decidedBy === s.me?.user.id ? null : (s.members.find((m) => m.id === approval.decidedBy)?.name ?? null)));
  const { clock } = usePrefs();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** the text being edited; null when not editing */
  const [draft, setDraft] = useState<string | null>(null);
  /** what was approved, when it was edited first */
  const [sentText, setSentText] = useState<string | null>(null);
  const pending = approval.status === "pending";
  const isText = req.op.op === "messages_send";
  const original = req.bubble ?? (req.op.op === "messages_send" ? req.op.text : undefined);
  const editable = !!req.bubble && isText;
  const draftOk = draft === null || (draft.trim().length > 0 && draft.length <= 4000);

  const decide = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    const text = approve && draft !== null && draft !== original ? draft : undefined;
    try {
      const a = await api<Approval>("POST", `/api/approvals/${approval.id}/decide`, text !== undefined ? { approve, text } : { approve });
      if (text !== undefined) setSentText(text);
      setDraft(null);
      useStore.setState((s) => ({ approvals: { ...s.approvals, [approval.id]: a } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const bubble = sentText ?? original;
  const at = approval.decidedAt ? clockTime(approval.decidedAt, clock) : null;
  const by = decider ? ` by ${decider}` : "";
  const outcome = approval.status === "approved" ? (isText ? `Sent${at ? ` at ${at}` : ""}${by}` : `Done${at ? ` at ${at}` : ""}${by}`) : isText ? `Not sent${by}` : `Left as is${by}`;

  return (
    <section aria-label={req.title} className={cx("mt-1 w-full max-w-md overflow-hidden rounded-xl border border-line bg-panel", className)}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5 text-[13px]">
        <AppleIcon app={req.app} size={22} />
        <span className="min-w-0 flex-1 truncate font-semibold">{req.title}</span>
        {req.aside && <span className="shrink-0 truncate text-muted">{req.aside}</span>}
      </div>
      <div className="flex flex-col gap-2 px-3 py-2.5">
        {req.fields.length > 0 &&
          (req.bubble ? (
            req.fields.map((f, i) => (
              <div key={i} className={cx("text-[13px] text-muted", f.was && "line-through")}>
                {f.label} <span className="font-medium text-ink">{f.value}</span>
              </div>
            ))
          ) : (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[14px]">
              {req.fields.map((f, i) => (
                <Fragment key={i}>
                  <dt className="text-muted">{f.label}</dt>
                  <dd className={cx("min-w-0 break-words", f.was ? "text-muted line-through" : "text-ink", i === 0 && !f.was && "font-medium")}>{f.value}</dd>
                </Fragment>
              ))}
            </dl>
          ))}
        {draft !== null ? (
          <div className="m-fade-in flex flex-col gap-1">
            <textarea
              aria-label="Text to send"
              autoFocus
              onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
              value={draft}
              maxLength={4000}
              rows={Math.min(6, Math.max(2, Math.ceil(draft.length / 40)))}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full resize-none rounded-xl border border-control-line bg-control px-3 py-2 text-[14px] leading-snug text-ink outline-none focus:ring-3 focus:ring-ring/30"
            />
          </div>
        ) : (
          bubble !== undefined && <div className={cx("bubble me max-w-[88%] whitespace-pre-wrap break-words text-[14px]", sentText !== null && "m-swap")}>{bubble}</div>
        )}
      </div>
      <div key={approval.status} className={cx("px-3 pb-3", !pending && "m-fade-in")}>
        {pending ? (
          me?.role !== "owner" ? (
            <p className="text-[13px] text-muted">Waiting for an owner to answer.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || !draftOk} onClick={() => void decide(true)} className="h-9 min-w-24 flex-1 rounded-full bg-accent px-4 text-[14px] font-medium text-accent-ink disabled:opacity-50">
                {req.yes}
              </button>
              {editable && (
                <button type="button" disabled={busy} onClick={() => setDraft(draft === null ? (original ?? "") : null)} className="h-9 rounded-full border border-control-line bg-control px-4 text-[14px] font-medium disabled:opacity-50">
                  {draft === null ? "Edit" : "Cancel"}
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => void decide(false)} className="h-9 rounded-full border border-control-line bg-control px-4 text-[14px] font-medium disabled:opacity-50">
                {req.no}
              </button>
            </div>
          )
        ) : (
          <div className={cx("flex items-center gap-1.5 text-[13px]", approval.status === "approved" ? "text-ok" : "text-muted")} role="status">
            {approval.status === "approved" ? <Check size={15} strokeWidth={2.2} aria-hidden /> : <X size={14} aria-hidden />}
            {outcome}
          </div>
        )}
        {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      </div>
    </section>
  );
}

