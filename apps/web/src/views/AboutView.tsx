import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ExternalLink, ListFilter, MoreHorizontal, Pencil, Pin, PinOff, RotateCcw, Trash2 } from "lucide-react";
import { api } from "../api.ts";
import { useStore } from "../store.ts";
import { Input, Menu, Popover, Textarea, cx } from "../components/ui.tsx";
import { iconBtn, menuRow, pageCol, pageTitle, pill, pillPrimary, useIsPhone, whoIs } from "./memory/parts.tsx";
import { shortWhen } from "./memory/logic.ts";

type Kind = "preference" | "plan" | "did" | "detail";

export interface Item {
  path: string;
  kind: Kind;
  text: string;
  by: string | null;
  source: string | null;
  messageId: string | null;
  channelId: string | null;
  created: string | null;
  updated: string | null;
  pinned: boolean;
  status: string | null;
  due: string | null;
  date: string | null;
}

interface Profile {
  person: { id: string; name: string };
  level: string;
  items: Item[];
}

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "preference", label: "Preferences" },
  { kind: "plan", label: "Plans" },
  { kind: "did", label: "Activity" },
  { kind: "detail", label: "Details" },
];

const closed = (i: Pick<Item, "status">) => i.status === "done" || i.status === "dropped";

/**
 * The About-you list in the order it reads: what is pinned first, then each kind under its own
 * word (plans split into what is coming up and what is done). `only` narrows it to one kind.
 * The day-by-day activity is not a list of rows, so it comes back on its own.
 */
export function aboutSections(items: Item[], only: Kind | "all" = "all"): { pinned: Item[]; sections: { head: string; items: Item[] }[]; journal: Item[] } {
  const shown = items.filter((i) => only === "all" || i.kind === only);
  const rows = shown.filter((i) => i.kind !== "did");
  const rest = rows.filter((i) => !i.pinned);
  const of = (kind: Kind) => rest.filter((i) => i.kind === kind);
  const sections = [
    { head: "Preferences", items: of("preference") },
    { head: "Coming up", items: of("plan").filter((i) => !closed(i)) },
    { head: "Done", items: of("plan").filter(closed) },
    { head: "Details", items: of("detail") },
  ].filter((s) => s.items.length);
  return { pinned: rows.filter((i) => i.pinned), sections, journal: shown.filter((i) => i.kind === "did") };
}

/**
 * What agents have learned about a person. Every agent reads this before it works, and the
 * person can correct, pin or remove anything. One list, pinned first, with one filter.
 */
export function AboutView({ onBack }: { onBack?: () => void }) {
  const me = useStore((s) => s.me)!;
  const members = useStore((s) => s.members);
  const [userId, setUserId] = useState(me.user.id);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Kind | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(() => api<Profile>("GET", `/api/memory/profile?user=${encodeURIComponent(userId)}`).then(setProfile, (e) => setError(e.message)), [userId]);
  useEffect(() => {
    setProfile(null);
    load();
  }, [load]);

  const remember = async (body: object) => {
    setError(null);
    try {
      const r = await api<{ saved: boolean; similar?: Item[] }>("POST", "/api/memory/remember", { about: userId, ...body });
      if (!r.saved) setError(`Already saved: "${r.similar?.[0]?.text}". Edit that one instead.`);
      await load();
      return r.saved;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const forget = async (i: Item) => {
    if (!confirm(`Delete “${i.text}”? Git history keeps the old version.`)) return;
    setError(null);
    try {
      await api("DELETE", `/api/vault/note?path=${encodeURIComponent(i.path)}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const isMe = userId === me.user.id;
  const canEdit = profile ? profile.level === "edit" || profile.level === "manage" : false;
  const phone = useIsPhone();
  const owner = me.role === "owner" && members.length > 1;
  // something typed with no kind picked is a detail; with a kind showing, it is one of those
  const addKind: Kind = tab === "all" ? "detail" : tab;
  const count = (kind: Kind) => profile?.items.filter((i) => i.kind === kind && (kind !== "plan" || i.status === "active")).length ?? 0;
  const { pinned, sections, journal } = aboutSections(profile?.items ?? [], tab);
  const title = isMe ? "About you" : `About ${profile?.person.name ?? "…"}`;

  const filter = (
    <Popover
      up={false}
      align="right"
      className="w-56 max-h-[min(70vh,520px)] overflow-auto p-1.5"
      trigger={(open, toggle) => (
        <button onClick={toggle} className={cx(iconBtn, "relative")} aria-haspopup="menu" aria-expanded={open} aria-label={`Show: ${tab === "all" ? "All" : KINDS.find((k) => k.kind === tab)!.label}. Change`} title="Show">
          <ListFilter size={16} />
          {(tab !== "all" || !isMe) && <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-info ring-2 ring-panel" aria-hidden />}
        </button>
      )}
    >
      {(close) => {
        const row = (key: string, label: string, on: boolean, pick: () => void, n?: number) => (
          <button
            key={key}
            role="menuitemradio"
            aria-checked={on}
            onClick={() => {
              close();
              pick();
            }}
            className={menuRow}
          >
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {n !== undefined && <span className="text-xs tabular-nums text-muted">{n}</span>}
            <Check size={15} className={cx("shrink-0 text-muted", !on && "invisible")} aria-hidden />
          </button>
        );
        return (
          <div role="menu" aria-label="Show">
            {row("all", "All", tab === "all", () => setTab("all"))}
            {KINDS.map((k) => row(k.kind, k.label, tab === k.kind, () => setTab(k.kind), count(k.kind)))}
            {owner && (
              <div role="group" aria-label="Whose memory">
                <div className="-mx-1 my-1 h-px bg-line" />
                {members.map((m) => row(m.id, m.id === me.user.id ? "You" : m.name, userId === m.id, () => setUserId(m.id)))}
              </div>
            )}
          </div>
        );
      }}
    </Popover>
  );

  const rows = (xs: Item[]) => xs.map((i) => <ItemRow key={i.path} item={i} canEdit={canEdit} onSave={(body) => remember({ kind: i.kind, replaces: i.path, ...body })} onForget={() => forget(i)} />);
  const nothing = !!profile && !pinned.length && !sections.length && !journal.length;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className={cx(pageCol, "md:pb-6")}>
        {phone ? (
          <>
            <div className="flex items-center gap-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
              {onBack && (
                <button className={iconBtn} onClick={onBack} aria-label="Back">
                  <ChevronLeft size={20} />
                </button>
              )}
              <span className="flex-1" />
              {filter}
            </div>
            <h1 className={cx(pageTitle, "px-1 pt-2.5 pb-3")}>{title}</h1>
          </>
        ) : (
          <div className="flex items-center gap-2 pt-9 pb-3.5">
            <h1 className={cx(pageTitle, "flex-1 min-w-0 truncate")}>{title}</h1>
            {filter}
          </div>
        )}

        {canEdit && (
          <form
            className="mb-3 flex min-h-12 items-center gap-2 rounded-[20px] bg-chip pl-4 pr-2 focus-within:ring-2 focus-within:ring-ring/30"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              if (await remember({ kind: addKind, text: draft.trim() })) setDraft("");
            }}
          >
            <input className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add something to remember" aria-label="Add something to remember" />
            {draft.trim() && <button className={cx(pillPrimary, "h-8 px-3.5 text-[13px]")}>Add</button>}
          </form>
        )}
        {error && <p className="mb-3 px-1.5 text-[13px] text-bad">{error}</p>}

        {nothing && <p className="border-t border-line px-1.5 py-4 text-[13px] text-muted">Nothing yet</p>}
        {rows(pinned)}
        {sections.map((s) => (
          <section key={s.head}>
            <Head>{s.head}</Head>
            {rows(s.items)}
          </section>
        ))}
        {journal.length > 0 && <Journal items={journal} />}
      </div>
    </div>
  );
}

/** A section's word: small and muted, above its rows. */
function Head({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-9 items-end gap-2 px-1.5 pb-1.5 text-xs font-medium text-muted">
      <h2 className="flex-1">{children}</h2>
      {action}
    </div>
  );
}

function ItemRow({ item, canEdit, onSave, onForget }: { item: Item; canEdit: boolean; onSave: (body: object) => Promise<boolean>; onForget: () => void }) {
  const agents = useStore((s) => s.agents);
  const members = useStore((s) => s.members);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [due, setDue] = useState(item.due ?? "");
  const done = closed(item);
  if (editing)
    return (
      <div className="space-y-2 border-t border-line px-1.5 py-2.5">
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        {item.kind === "plan" && <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-44" aria-label="Due date" />}
        <div className="flex gap-2">
          <button className={cx(pillPrimary, "h-8 px-3.5 text-[13px]")} onClick={async () => (await onSave({ text, ...(item.kind === "plan" ? { due: due || null } : {}) })) && setEditing(false)}>
            Save
          </button>
          <button className={cx(pill, "h-8 px-3.5 text-[13px]")} onClick={() => (setEditing(false), setText(item.text))}>
            Cancel
          </button>
        </div>
      </div>
    );
  const w = item.by ? whoIs(item.by, agents, members, 16) : null;
  const at = item.updated ?? item.created;
  const when = at ? (/^\d{4}-\d{2}-\d{2}T/.test(at) ? shortWhen(Date.parse(at)) : at) : "";
  const marks = [item.pinned ? "pinned" : null, item.kind === "plan" && item.status && item.status !== "active" ? item.status : null, item.due ? `due ${item.due}` : null].filter(Boolean);
  return (
    <div className="flex items-start gap-3 border-t border-line px-1.5 py-2.5">
      <div className="min-w-0 flex-1">
        <div className={cx("text-[15px] leading-[22px] font-medium break-words", done && "line-through text-muted")}>{item.text}</div>
        {(marks.length > 0 || item.source) && (
          <div className="flex flex-wrap items-center gap-x-1.5 text-[13px] leading-[18px] text-muted">
            {item.pinned && <Pin size={11} className="shrink-0" aria-hidden />}
            {marks.join(" · ")}
            {item.source && (
              <>
                {marks.length > 0 && <span aria-hidden>·</span>}
                {item.channelId ? (
                  <a className="truncate hover:text-ink hover:underline" href={`#/c/${item.channelId}${item.messageId ? `/t/${item.messageId}` : ""}`}>
                    {item.source}
                  </a>
                ) : (
                  <span className="truncate">{item.source}</span>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {(w || when) && (
        <span className="flex shrink-0 items-center gap-1.5 pt-[3px] text-xs leading-4 text-muted">
          {w?.avatar}
          {[w?.name, when].filter(Boolean).join(" · ")}
        </span>
      )}
      {canEdit && (
        <Menu
          align="right"
          trigger={(_o, toggle) => (
            <button onClick={toggle} className="-my-1 grid size-8 max-md:size-11 shrink-0 place-items-center rounded-full text-muted outline-none hover:bg-hover hover:text-ink focus-visible:bg-hover" aria-haspopup="menu" aria-label="More for this item">
              <MoreHorizontal size={16} />
            </button>
          )}
          items={[
            ...(item.kind === "plan" ? [{ label: done ? "Reopen" : "Mark done", icon: done ? <RotateCcw size={16} /> : <Check size={16} />, onSelect: () => void onSave({ status: done ? "active" : "done" }) }] : []),
            { label: item.pinned ? "Unpin" : "Pin", icon: item.pinned ? <PinOff size={16} /> : <Pin size={16} />, onSelect: () => void onSave({ pinned: !item.pinned }) },
            { label: "Edit", icon: <Pencil size={16} />, onSelect: () => setEditing(true) },
            { label: "Delete", icon: <Trash2 size={16} />, danger: true, onSelect: onForget },
          ]}
        />
      )}
    </div>
  );
}

/** What you did, a day at a time. Each day is one note you can edit in Memory. */
function Journal({ items }: { items: Item[] }) {
  const days = [...new Set(items.map((i) => i.date ?? ""))].sort().reverse();
  return (
    <section aria-label="Activity">
      {days.map((d) => {
        const entries = items.filter((i) => (i.date ?? "") === d);
        return (
          <div key={d}>
            <Head
              action={
                <a href={`#/vault/${entries[0].path}`} className="inline-flex items-center gap-1 hover:text-ink">
                  Edit day <ExternalLink size={11} />
                </a>
              }
            >
              {d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "Undated"}
            </Head>
            {entries.map((i, n) => (
              <div key={n} className="flex items-start gap-3 border-t border-line px-1.5 py-2.5">
                <div className="min-w-0 flex-1 text-[15px] leading-[22px] break-words">{i.text}</div>
                {i.by && <span className="shrink-0 pt-[3px] text-xs leading-4 text-muted">{i.by}</span>}
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}
