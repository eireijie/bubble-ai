import { useEffect, useMemo, useRef, useState } from "react";
import { Bold, ChevronLeft, ExternalLink, FolderInput, Hash, History, Link2, List, Lock, Pencil, PencilLine, Share2, Trash2, Type, X, MoreHorizontal } from "lucide-react";
import { type MemoryLevel } from "@wisp/core";
import { api } from "../../api.ts";
import { useStore } from "../../store.ts";
import { go, guardLeaving } from "../../router.ts";
import { renderMarkdown } from "../../markdown.ts";
import { Menu, Popover, cx, timeAgo, agentColor } from "../../components/ui.tsx";
import { MoreOptions } from "../../components/MoreOptions.tsx";
import { kindColor, kindLabel, type GraphData } from "../../components/MemoryGraph.tsx";
import { obsidianLink, onHubMachine, useMemoryStorage } from "../../obsidian.ts";
import { Cards, noteName, baseName, iconBtn, menuRow, pageCol, pill, pillPrimary, whoIs, useIsPhone } from "./parts.tsx";
import { bodyOnly } from "./logic.ts";
import { DeleteDialog, MoveDialog, RenameDialog } from "./NoteDialogs.tsx";

export interface Note {
  path: string;
  title: string;
  tags: string[];
  links: string[];
  updatedAt: number;
  content: string;
  frontmatter: Record<string, string | string[]>;
  backlinks: string[];
  access: MemoryLevel;
  editedBy: string | null;
  editedAt: string | null;
}
interface BlameBlock {
  hash: string;
  author: string;
  date: string;
  lines: string[];
}
interface Commit {
  hash: string;
  author: string;
  date: string;
  message: string;
}

/** Blame blocks minus the note's frontmatter, which is bookkeeping rather than writing. */
function withoutFrontmatter(blocks: BlameBlock[]): BlameBlock[] {
  const lines = blocks.flatMap((b) => b.lines);
  const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  if (end < 0) return blocks;
  let n = 0;
  return blocks
    .map((b) => {
      const keep = b.lines.filter((_, i) => n + i > end);
      n += b.lines.length;
      return { ...b, lines: keep };
    })
    .filter((b) => b.lines.length);
}

/** Focus the note body with the caret after the last character, once when it appears. */
function focusAtEnd(el: HTMLTextAreaElement | null) {
  if (!el || el.dataset.focused) return;
  el.dataset.focused = "1";
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
}

/**
 * A note: back, its title, one line of who and when, and the text. Click the text to edit it
 * (Obsidian is the better place to write). History (with Restore and who wrote what) is one button;
 * the ⋯ holds share, rename, move, Obsidian, the graph and delete.
 */
export function NoteView({
  path,
  pendingEdit,
  resolve,
  graph,
  where,
  folders,
  readOnly,
  onChanged,
  onShare,
  onGraph,
  onStorage,
  onWrite,
  onBack,
}: {
  path: string;
  pendingEdit: React.MutableRefObject<string | null>;
  resolve: (t: string, from?: string | null) => string | null;
  graph: GraphData | null;
  where: (p: string) => string;
  folders: string[];
  /** looking at memory as a helper: nothing here can be changed */
  readOnly?: boolean;
  onChanged: () => void;
  onShare: () => void;
  onGraph: (path: string) => void;
  onStorage: () => void;
  /** start writing a note this one links to but nobody wrote yet */
  onWrite?: (title: string) => void;
  onBack: () => void;
}) {
  const phone = useIsPhone();
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mode, setMode] = useState<"read" | "authors">("read");
  const [history, setHistory] = useState<Commit[] | null>(null);
  const [blame, setBlame] = useState<BlameBlock[] | null>(null);
  const [viewing, setViewing] = useState<{ commit: Commit; content: string } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<"rename" | "move" | "delete" | null>(null);
  const agents = useStore((s) => s.agents);
  const members = useStore((s) => s.members);
  const memoryVersion = useStore((s) => s.memoryVersion);
  const storage = useMemoryStorage();
  const handles = useMemo(() => new Set(agents.map((a) => a.handle)), [agents]);

  useEffect(() => {
    setError(null);
    api<Note>("GET", `/api/vault/note?path=${encodeURIComponent(path)}`).then(
      (n) => {
        setNote(n);
        // a note we just created: start editing once, with the draft from what was saved
        if (pendingEdit.current === path) {
          pendingEdit.current = null;
          if (n.access === "edit" || n.access === "manage") setDraft((d) => d ?? n.content);
        }
      },
      (e) => {
        if (pendingEdit.current === path) pendingEdit.current = null;
        setError(e.message);
      },
    );
  }, [path, memoryVersion, pendingEdit]);

  // who wrote it and what changed: loaded with the note, for History and the line under the title
  const loadHistory = () => api<Commit[]>("GET", `/api/vault/history?path=${encodeURIComponent(path)}`).then(setHistory, () => setHistory([]));
  useEffect(() => {
    setHistory(null);
    setBlame(null);
    loadHistory();
  }, [path, note?.editedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (mode === "authors") api<BlameBlock[]>("GET", `/api/vault/blame?path=${encodeURIComponent(path)}`).then(setBlame, () => setBlame([]));
  }, [mode, path, note?.editedAt]);

  const title = note?.title || noteName(path);
  const html = useMemo(() => renderMarkdown(bodyOnly(viewing?.content ?? note?.content ?? "", title), { known: (t) => !!resolve(t, path), handles, stripFrontmatter: true }), [note, viewing, resolve, path, handles, title]);

  const dirty = !!note && draft !== null && draft !== note.content;
  // edits aren't lost to a stray click: leaving the note asks first
  useEffect(() => {
    if (!dirty) return;
    const unguard = guardLeaving(() => `${baseName(path)} has unsaved changes. Leave without saving them?`);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      unguard();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty, path]);

  /** A link opens its note (one nobody wrote yet starts it). Returns whether the click was on a link. */
  const followLink = (e: React.MouseEvent): boolean => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-wikilink]");
    if (!a) return false;
    e.preventDefault();
    const found = resolve(a.dataset.wikilink!, path);
    if (found) go({ view: "vault", path: found });
    else if (!readOnly) onWrite?.(a.dataset.wikilink!);
    return true;
  };

  const byId = useMemo(() => new Map(graph?.nodes.map((n) => [n.id, n]) ?? []), [graph]);
  // notes that link here; while looking through an agent, only the ones it can see
  const linkedFrom = note ? note.backlinks.filter((p) => !graph || byId.has(p)).map((p) => ({ path: p, title: byId.get(p)?.title ?? noteName(p) })) : [];

  const back = (
    <button className={iconBtn} onClick={onBack} aria-label="Back to Memory" title="Back">
      <ChevronLeft size={18} />
    </button>
  );
  const page = cx(pageCol, "pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-9 pb-[max(1.5rem,env(safe-area-inset-bottom))]");
  if (error)
    return (
      <div className={page}>
        {back}
        <p className="pt-6 text-[14px] text-muted">{/not found/i.test(error) ? "This note was moved or deleted" : error}</p>
      </div>
    );
  if (!note) return null;

  const canEdit = !readOnly && (note.access === "edit" || note.access === "manage");
  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    try {
      if (draft !== note.content) await api("PUT", "/api/vault/note", { path, content: draft });
      setNote({ ...note, content: draft });
      setDraft(null);
      onChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const restore = async (c: Commit) => {
    try {
      const old = await api<{ content: string }>("GET", `/api/vault/at?path=${encodeURIComponent(path)}&rev=${c.hash}`);
      await api("PUT", "/api/vault/note", { path, content: old.content, message: `Restore the version from ${new Date(c.date).toLocaleString()}` });
      setViewing(null);
      onChanged();
      const fresh = await api<Note>("GET", `/api/vault/note?path=${encodeURIComponent(path)}`);
      setNote(fresh);
      loadHistory();
    } catch (e) {
      alert((e as Error).message);
    }
  };
  const openObsidian = () => {
    if (storage?.path && onHubMachine()) window.location.href = obsidianLink(storage.path, path);
    else onStorage();
  };

  // who changed it last and when: the same pair the list shows
  const author = note.editedBy ?? (history && history.length ? history[0]!.author : null);
  const w = author ? whoIs(author, agents, members, 16) : null;
  const type = typeof note.frontmatter?.type === "string" ? note.frontmatter.type : null;
  const kind = graph?.nodes.find((n) => n.id === path)?.kind ?? null;
  const tags = note.tags ?? [];
  const closeHistory = () => (setHistoryOpen(false), setViewing(null), setMode("read"));
  const menu = (
    <Menu
      align="right"
      trigger={(_o, toggle) => (
        <button onClick={toggle} className={iconBtn} aria-haspopup="menu" aria-label="More: share, rename, move, delete" title="More">
          <MoreHorizontal size={16} />
        </button>
      )}
      items={[
        ...(canEdit && !viewing ? [{ label: "Edit", icon: <Pencil size={17} />, onSelect: () => setDraft(note.content) }] : []),
        { label: "Share", icon: <Lock size={17} />, onSelect: onShare },
        ...(canEdit ? [{ label: "Rename", icon: <PencilLine size={17} />, onSelect: () => setDialog("rename") }, { label: "Move", icon: <FolderInput size={17} />, onSelect: () => setDialog("move") }] : []),
        { label: "Open in Obsidian", icon: <ExternalLink size={17} />, onSelect: openObsidian },
        { label: "Show in graph", icon: <Share2 size={17} />, onSelect: () => onGraph(path) },
        ...(canEdit ? ["divider" as const, { label: "Delete", icon: <Trash2 size={17} />, danger: true, onSelect: () => setDialog("delete") }] : []),
      ]}
    />
  );

  // ---- editing --------------------------------------------------------------------------
  if (draft !== null) {
    return (
      <Editor
        draft={draft}
        setDraft={setDraft}
        saving={saving}
        dirty={dirty}
        onSave={save}
        onCancel={() => setDraft(null)}
      />
    );
  }

  const historyList = (
    <HistoryList history={history} viewing={viewing} canEdit={canEdit} onView={async (c, current) => (current ? setViewing(null) : setViewing({ commit: c, content: (await api<{ content: string }>("GET", `/api/vault/at?path=${encodeURIComponent(path)}&rev=${c.hash}`)).content }))} onRestore={restore} />
  );

  const dialogs = (
    <>
      {dialog === "rename" && (
        <RenameDialog
          path={path}
          onClose={() => setDialog(null)}
          onDone={(to) => {
            setDialog(null);
            onChanged();
            go({ view: "vault", path: to });
          }}
        />
      )}
      {dialog === "move" && (
        <MoveDialog
          path={path}
          folders={folders}
          onClose={() => setDialog(null)}
          onDone={(to) => {
            setDialog(null);
            onChanged();
            go({ view: "vault", path: to });
          }}
        />
      )}
      {dialog === "delete" && (
        <DeleteDialog
          path={path}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            onChanged();
            onBack();
          }}
        />
      )}
    </>
  );

  const version = viewing && (
    <div className="mt-4 rounded-[14px] bg-chip px-3.5 py-2.5 text-[13px] flex items-center gap-2">
      <span className="flex-1">Version from {new Date(viewing.commit.date).toLocaleString()}</span>
      <button className="font-medium underline underline-offset-2" onClick={() => setViewing(null)}>
        Back to current
      </button>
    </div>
  );
  /** Click the text to edit it; a click on a link, or one that ends a selection, is not that. */
  const onText = (e: React.MouseEvent) => {
    if (followLink(e) || !canEdit || viewing) return;
    if ((e.target as HTMLElement).closest("a, button, input, summary")) return;
    if (window.getSelection()?.toString()) return;
    setDraft(note.content);
  };
  const text = (
    <div
      onClick={onText}
      className={cx(
        "prose-w text-[15px] leading-6",
        canEdit && !viewing && "cursor-text",
        // a link to a note nobody wrote yet: dotted, with "Write it" beside it
        "[&_.wikilink.missing]:border-b-0! [&_.wikilink.missing]:px-0! [&_.wikilink.missing]:text-ink! [&_.wikilink.missing]:underline! [&_.wikilink.missing]:decoration-dotted! [&_.wikilink.missing]:decoration-[1.5px]! [&_.wikilink.missing]:decoration-muted! [&_.wikilink.missing]:underline-offset-[3px]!",
        !readOnly && onWrite && "[&_.wikilink.missing]:after:ml-1.5 [&_.wikilink.missing]:after:inline-block [&_.wikilink.missing]:after:text-xs [&_.wikilink.missing]:after:font-semibold [&_.wikilink.missing]:after:text-muted [&_.wikilink.missing]:after:content-['Write_it']",
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
  const switcher = <Segmented mode={mode} setMode={setMode} labels={["History", "Who wrote what"]} />;

  // phones: History is a page of its own, with "Who wrote what" beside it
  if (phone && historyOpen) {
    return (
      <div className="h-full overflow-y-auto">
        <div className={page}>
          <div className="flex items-center gap-2 pb-4">
            <button className={iconBtn} onClick={closeHistory} aria-label="Back to the note" title="Back">
              <ChevronLeft size={18} />
            </button>
            <span className="flex-1" />
            {menu}
          </div>
          {switcher}
          <div className="mt-3">{mode === "authors" ? <Blame blocks={blame} /> : historyList}</div>
          {viewing && mode !== "authors" && (
            <>
              {version}
              <div className="mt-3">{text}</div>
            </>
          )}
        </div>
        {dialogs}
      </div>
    );
  }

  const empty = !bodyOnly(note.content, title).trim();
  return (
    <div className="h-full flex min-h-0">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className={page}>
          <div className="flex items-center gap-2 pb-[22px]">
            {back}
            <span className="flex-1" />
            <button className={cx(iconBtn, historyOpen && "bg-line2")} onClick={() => (historyOpen ? closeHistory() : setHistoryOpen(true))} aria-pressed={historyOpen} aria-label="History: earlier versions and who wrote what" title="History">
              <History size={16} />
            </button>
            {menu}
          </div>
          <h1 className="text-[28px] leading-[34px] font-[650] tracking-[-0.01em] break-words">{title}</h1>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-2 text-[13px] leading-[18px] text-muted">
            {w?.avatar}
            <span>
              {w ? w.name : "Not saved yet"}
              {note.editedAt ? ` · ${timeAgo(note.editedAt)}` : ""}
            </span>
            {linkedFrom.length > 0 && (
              <>
                <span aria-hidden>·</span>
                <Popover
                  inline
                  up={false}
                  className="w-64 max-h-[min(60vh,420px)] overflow-y-auto p-1.5"
                  trigger={(isOpen, toggle) => (
                    <button onClick={toggle} aria-expanded={isOpen} className="outline-none hover:text-ink focus-visible:text-ink focus-visible:underline">
                      linked from {linkedFrom.length} {linkedFrom.length === 1 ? "note" : "notes"}
                    </button>
                  )}
                >
                  {(close) => (
                    <div role="menu" aria-label="Linked from">
                      {linkedFrom.map((n) => (
                        <button
                          key={n.path}
                          role="menuitem"
                          onClick={() => {
                            close();
                            go({ view: "vault", path: n.path });
                          }}
                          className={menuRow}
                        >
                          <span className="min-w-0 flex-1 truncate">{n.title}</span>
                          <span className="max-w-[45%] truncate text-xs text-muted">{where(n.path)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </Popover>
              </>
            )}
          </div>
          {(type || tags.length > 0) && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {type && (
                <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-chip text-xs font-medium capitalize">
                  {kind && <span className="size-2 rounded-full" style={{ background: kindColor(kind) }} title={kindLabel(kind)} />}
                  {type}
                </span>
              )}
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-0.5 h-6 px-2.5 rounded-full bg-chip text-xs font-medium text-muted">
                  <Hash size={11} /> {t}
                </span>
              ))}
            </div>
          )}

          {version}

          <div className="pt-6">
            {mode === "authors" && historyOpen ? (
              <Blame blocks={blame} />
            ) : empty && canEdit && !viewing ? (
              <button onClick={() => setDraft(note.content)} className="text-[15px] leading-6 text-muted hover:text-ink">
                Write something
              </button>
            ) : (
              text
            )}
          </div>

          <Properties frontmatter={note.frontmatter ?? {}} resolve={(t) => resolve(t, path)} />
        </div>
      </div>
      {historyOpen && (
        <aside className="w-[310px] shrink-0 border-l border-line overflow-y-auto px-4 pb-8" aria-label="History">
          <div className="h-16 flex items-center">
            <h2 className="flex-1 text-[15px] font-semibold">History</h2>
            <button onClick={closeHistory} className={iconBtn} aria-label="Close history">
              <X size={16} />
            </button>
          </div>
          {switcher}
          <div className="mt-3">{historyList}</div>
        </aside>
      )}
      {dialogs}
    </div>
  );
}

function Segmented({ mode, setMode, labels }: { mode: "read" | "authors"; setMode: (m: "read" | "authors") => void; labels: [string, string] }) {
  return (
    <div role="tablist" className="p-1 rounded-full bg-card flex gap-1">
      {(["read", "authors"] as const).map((m, i) => (
        <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cx("flex-1 h-10 rounded-full text-[14px] font-medium transition-colors", mode === m ? "bg-control text-ink shadow-sm border border-control-line" : "text-muted hover:text-ink")}>
          {labels[i]}
        </button>
      ))}
    </div>
  );
}

function HistoryList({ history, viewing, canEdit, onView, onRestore }: { history: Commit[] | null; viewing: { commit: Commit } | null; canEdit: boolean; onView: (c: Commit, current: boolean) => void; onRestore: (c: Commit) => void }) {
  const agents = useStore((s) => s.agents);
  const members = useStore((s) => s.members);
  if (!history) return <p className="text-sm text-muted px-1">Loading…</p>;
  if (!history.length) return <p className="text-sm text-muted px-1">Not saved yet.</p>;
  return (
    <Cards className="rounded-[14px]!">
        {history.map((c, i) => {
          const w = whoIs(c.author, agents, members, 28);
          const on = viewing?.commit.hash === c.hash;
          return (
            <div key={c.hash} className={cx("flex items-center gap-2.5 px-3 py-2.5", on && "bg-hover")}>
              {w.avatar}
              <button onClick={() => onView(c, i === 0)} className="flex-1 min-w-0 text-left" title="See this version">
                <span className="block truncate text-body font-medium">{c.message}</span>
                <span className="block text-xs text-muted">
                  {w.name} · {timeAgo(c.date)}
                </span>
              </button>
              {i === 0 ? (
                <span className="text-xs text-muted">Current</span>
              ) : (
                canEdit && (
                  <button onClick={() => confirm("Bring this version back as a new change? Nothing is lost.") && onRestore(c)} className="h-8 px-3 rounded-full border border-control-line bg-control text-[13px] font-medium hover:bg-hover">
                    Restore
                  </button>
                )
              )}
            </div>
          );
        })}
    </Cards>
  );
}

/** Who wrote what: every stretch of the note beside the person or helper who wrote it. */
function Blame({ blocks }: { blocks: BlameBlock[] | null }) {
  const agents = useStore((s) => s.agents);
  const members = useStore((s) => s.members);
  if (!blocks) return <p className="text-sm text-muted px-1">Loading…</p>;
  const shown = withoutFrontmatter(blocks).filter((b) => b.lines.some((l) => l.trim()));
  if (!shown.length) return <p className="text-sm text-muted px-1">Not saved yet.</p>;
  const tone = (author: string) => {
    const w = whoIs(author, agents, members);
    return w.agent ? agentColor(w.agent) : "var(--faint)";
  };
  return (
    <div>
      <div className="rounded-[14px] bg-card overflow-hidden">
        {shown.map((b, i) => {
          const w = whoIs(b.author, agents, members, 18);
          return (
            <div key={i} className="flex gap-3 py-2.5 pr-4 border-l-[3px]" style={{ borderColor: tone(b.author) }}>
              <div className="w-24 shrink-0 pl-3 pt-0.5 flex items-start gap-1.5 text-xs text-muted" title={`${w.name} · ${timeAgo(b.date)}`}>
                {w.avatar}
                <span className="truncate">{w.name}</span>
              </div>
              <div className="flex-1 min-w-0 text-[14px] whitespace-pre-wrap break-words">{b.lines.join("\n").trim()}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The note's front matter, folded away under one word. Nothing shows when it has none. */
function Properties({ frontmatter, resolve }: { frontmatter: Record<string, string | string[]>; resolve: (t: string) => string | null }) {
  const entries = Object.entries(frontmatter).filter(([k, v]) => !["title", "type", "tags"].includes(k) && (Array.isArray(v) ? v.length : v !== ""));
  if (!entries.length) return null;
  const value = (v: string) => {
    const link = v.match(/^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/);
    if (!link) return <span className="break-words">{v}</span>;
    const to = resolve(link[1]!);
    return to ? (
      <button onClick={() => go({ view: "vault", path: to })} className="text-accent-text underline underline-offset-2">
        {link[2] ?? link[1]}
      </button>
    ) : (
      <span className="text-muted">{link[2] ?? link[1]}</span>
    );
  };
  const nice = (k: string) => k.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
  return (
    <MoreOptions className="mt-8" title="Properties">
      <dl className="rounded-[14px] bg-card px-4 py-3 grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-6 gap-y-2 text-sm" aria-label="Properties">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{nice(k)}</dt>
            <dd className="min-w-0 flex flex-wrap items-center gap-1.5">{Array.isArray(v) ? v.map((x, i) => <span key={i}>{value(x)}</span>) : value(v)}</dd>
          </div>
        ))}
      </dl>
    </MoreOptions>
  );
}

/** The plain editor: Markdown, with Cancel and Save on top and the formatting helpers behind one button. */
function Editor({ draft, setDraft, saving, dirty, onSave, onCancel }: { draft: string; setDraft: (s: string) => void; saving: boolean; dirty: boolean; onSave: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  /** Wrap the selection (or put a marker at the caret) and keep the caret in a useful place. */
  const edit = (before: string, after = "", fallback = "") => {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart;
    const e = el.selectionEnd;
    const sel = draft.slice(s, e) || fallback;
    const next = draft.slice(0, s) + before + sel + after + draft.slice(e);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + sel.length);
    });
  };
  const lineStart = (prefix: string) => {
    const el = ref.current;
    if (!el) return;
    const s = draft.lastIndexOf("\n", el.selectionStart - 1) + 1;
    setDraft(draft.slice(0, s) + prefix + draft.slice(s));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(el.selectionStart + prefix.length, el.selectionStart + prefix.length);
    });
  };
  const bold = () => edit("**", "**", "bold");
  return (
    <div className="h-full overflow-y-auto">
      <div className={cx(pageCol, "pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-9 pb-[max(1.5rem,env(safe-area-inset-bottom))]")}>
        <div className="flex items-center gap-2 pb-[22px]">
          <button className={cx(pill, "h-8 max-md:h-11 px-3.5 text-[13px]")} onClick={onCancel}>
            Cancel
          </button>
          <span className="flex-1" />
          <Menu
            align="right"
            trigger={(_o, toggle) => (
              <button type="button" onClick={toggle} className={iconBtn} aria-haspopup="menu" aria-label="Formatting" title="Formatting">
                <Type size={16} />
              </button>
            )}
            items={[
              { label: "Bold", icon: <Bold size={16} />, onSelect: bold },
              { label: "List", icon: <List size={16} />, onSelect: () => lineStart("- ") },
              { label: "Link to a note", icon: <Link2 size={16} />, onSelect: () => edit("[[", "]]", "Note name") },
              { label: "Heading", icon: <Hash size={16} />, onSelect: () => lineStart("## ") },
            ]}
          />
          <button className={cx(pillPrimary, "h-8 max-md:h-11 px-4 text-[13px]")} onClick={onSave} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        <textarea
          ref={(el) => {
            ref.current = el;
            focusAtEnd(el);
          }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
            const key = e.key.toLowerCase();
            if (key !== "b" && key !== "s") return;
            e.preventDefault();
            if (key === "b") bold();
            else if (dirty && !saving) onSave();
          }}
          spellCheck
          aria-label="Note text"
          className="w-full h-[min(68vh,640px)] resize-none rounded-[14px] bg-card px-4 py-3.5 font-mono text-[14px] leading-relaxed outline-none focus:ring-2 focus:ring-ring/30"
        />
      </div>
    </div>
  );
}
