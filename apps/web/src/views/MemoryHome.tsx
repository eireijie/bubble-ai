import { useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, Folder, List, Plus, Search, Share2, X } from "lucide-react";
import type { AccessRule, Agent } from "@wisp/core";
import { useStore } from "../store.ts";
import { href } from "../router.ts";
import { AgentAvatar, Popover, cx } from "../components/ui.tsx";
import { type GraphData } from "../components/MemoryGraph.tsx";
import { MemoryGraphView } from "./MemoryGraphView.tsx";
import { FolderList } from "./memory/Panels.tsx";
import { iconBtn, menuRow, pageCol, pageTitle, whoIs } from "./memory/parts.tsx";
import { noteRows, shortWhen, type MemoryView, type NoteRow } from "./memory/logic.ts";
import { useNotePreview, useSeen } from "./memory/preview.ts";
import { type Hit, type NoteMeta } from "./memory/Sidebar.tsx";

export interface Change {
  hash: string;
  author: string;
  date: string;
  message: string;
  files: { path: string; change: "added" | "modified" | "deleted" | "renamed"; from?: string }[];
}

type Authors = Map<string, { author: string; at: number }>;

const VIEWS: { view: MemoryView; label: string; icon: typeof List }[] = [
  { view: "list", label: "List", icon: List },
  { view: "folders", label: "Folders", icon: Folder },
  { view: "graph", label: "Graph", icon: Share2 },
];
/** How many notes the list draws before "Show more". */
const PAGE = 100;

/**
 * The Memory page: a title, a view button and New note, one search, and the notes, newest first.
 * The view button swaps the list for folders or the graph; an author's ghost narrows the list to theirs.
 */
export function MemoryHome({
  view,
  onView,
  phone,
  onBack,
  notes,
  total,
  authors,
  query,
  setQuery,
  hits,
  by,
  byPaths,
  onBy,
  seeAs,
  onSeeAs,
  onStopSeeAs,
  hidden,
  graph,
  graphPick,
  folder,
  rules,
  where,
  snippetHtml,
  onOpen,
  onFolder,
  onNew,
  onWrite,
  onShareFolder,
  onRenameFolder,
  onDeleteFolder,
}: {
  view: MemoryView;
  onView: (view: MemoryView) => void;
  phone: boolean;
  onBack?: () => void;
  /** notes the person (or the agent they're looking through) can open */
  notes: NoteMeta[] | null;
  /** how many notes there are in all, for "5 of 10 notes" */
  total: number;
  authors: Authors;
  query: string;
  setQuery: (q: string) => void;
  hits: Hit[] | null;
  /** only this author's notes, as the change feed names them */
  by: string | null;
  byPaths: Set<string> | null;
  onBy: (author: string | null) => void;
  /** the agent whose view of memory is showing */
  seeAs: Agent | null;
  /** pick an agent to look through (owners) */
  onSeeAs?: () => void;
  onStopSeeAs: () => void;
  /** folders that agent can't see */
  hidden: string[];
  graph: GraphData | null;
  /** open the graph on this note */
  graphPick: string | null;
  /** the folder the address has open */
  folder: string | null;
  rules: AccessRule[];
  where: (path: string) => string;
  snippetHtml: (s: string) => string;
  onOpen: (path: string) => void;
  onFolder: (path: string | null) => void;
  onNew?: () => void;
  onWrite?: (title: string) => void;
  onShareFolder: (dir: string) => void;
  onRenameFolder: (dir: string) => void;
  onDeleteFolder: (dir: string) => void;
}) {
  const agents = useStore((s) => s.agents);
  const members = useStore((s) => s.members);
  const [limit, setLimit] = useState(PAGE);
  const rows = useMemo(() => noteRows(notes ?? [], authors, by, byPaths), [notes, authors, by, byPaths]);
  const byWho = by ? whoIs(by, agents, members, 16) : null;
  const shownHits = useMemo(() => {
    if (!hits) return null;
    if (!by) return hits;
    const mine = new Set(rows.map((r) => r.note.path));
    return hits.filter((h) => mine.has(h.path));
  }, [hits, by, rows]);

  const current = VIEWS.find((v) => v.view === view)!;
  const viewMenu = (
    <Popover
      up={false}
      align="right"
      className="w-52 p-1.5"
      trigger={(open, toggle) => (
        <button onClick={toggle} className={iconBtn} aria-haspopup="menu" aria-expanded={open} aria-label={`View: ${current.label}. Change view`} title="View">
          <current.icon size={16} />
        </button>
      )}
    >
      {(close) => (
        <div role="menu" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.view}
              role="menuitemradio"
              aria-checked={v.view === view}
              onClick={() => {
                close();
                onView(v.view);
              }}
              className={menuRow}
            >
              <v.icon size={16} className="shrink-0 text-muted" aria-hidden />
              <span className="flex-1">{v.label}</span>
              {v.view === view && <Check size={15} className="shrink-0 text-muted" aria-hidden />}
            </button>
          ))}
          <div className="-mx-1 my-1 h-px bg-line" />
          {/* who can see what, where memory is kept and Obsidian are settings */}
          <a role="menuitem" href={href({ view: "settings", page: "memory" })} onClick={close} className={cx(menuRow, "text-muted")}>
            Sharing and storage
          </a>
          {onSeeAs && (
            <button
              role="menuitem"
              onClick={() => {
                close();
                onSeeAs();
              }}
              className={cx(menuRow, "text-muted")}
            >
              See as an agent…
            </button>
          )}
        </div>
      )}
    </Popover>
  );

  const head = (extra?: ReactNode) => {
    const buttons = (
      <>
        {extra}
        {viewMenu}
        {onNew && (
          <button className={iconBtn} onClick={onNew} aria-label="New note" title="New note">
            <Plus size={16} />
          </button>
        )}
      </>
    );
    return phone ? (
      <>
        <div className="flex items-center gap-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          {onBack && (
            <button className={iconBtn} onClick={onBack} aria-label="Back">
              <ChevronLeft size={20} />
            </button>
          )}
          <span className="flex-1" />
          {buttons}
        </div>
        <h1 className={cx(pageTitle, "px-1 pt-2.5 pb-3")}>Memory</h1>
      </>
    ) : (
      <div className="flex items-center gap-2 pt-9 pb-3.5">
        <h1 className={cx(pageTitle, "flex-1")}>Memory</h1>
        {buttons}
      </div>
    );
  };

  const shown = by ? rows.length : (notes?.length ?? 0);
  const chips = (seeAs || byWho) && (
    <div className="flex flex-wrap items-center gap-2 pb-2.5">
      {seeAs && <Chip avatar={<AgentAvatar agent={seeAs} size={16} interactive={false} />} text={`${seeAs.name} can see`} clear="Show everything again" onClear={onStopSeeAs} />}
      {byWho && <Chip avatar={byWho.avatar} text={`By ${byWho.name}`} clear="Show everyone's notes" onClear={() => onBy(null)} />}
      <span className="flex-1" />
      {notes && (
        <span className="text-xs text-muted" title={seeAs && hidden.length ? `Hidden: ${hidden.join(", ")}` : undefined}>
          {seeAs ? `${shown} of ${total} notes` : `${shown} ${shown === 1 ? "note" : "notes"}`}
        </span>
      )}
    </div>
  );

  if (view === "graph")
    return (
      <MemoryGraphView
        key={`${seeAs?.id ?? ""}:${graphPick ?? ""}`}
        graph={graph}
        initialSelect={graphPick}
        where={where}
        onOpen={onOpen}
        onWrite={onWrite}
        header={(filter) => (
          <div className={cx(pageCol, "shrink-0")}>
            {head(filter)}
            {chips}
          </div>
        )}
      />
    );

  const empty = (text: string) => <p className="border-t border-line px-1.5 py-4 text-[13px] text-muted">{text}</p>;
  return (
    <div className="h-full overflow-y-auto">
      <div className={cx(pageCol, "pb-[max(1.5rem,env(safe-area-inset-bottom))]")}>
        {head()}
        <div className="mb-3 flex h-12 items-center gap-2.5 rounded-[20px] bg-chip px-4 focus-within:ring-2 focus-within:ring-ring/30">
          <Search size={16} className="shrink-0 text-muted" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && shownHits?.[0]) onOpen(shownHits[0].path);
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search what your agents know"
            aria-label="Search what your agents know"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted"
          />
          {query && (
            <button className="grid size-6 shrink-0 place-items-center rounded-full text-muted hover:text-ink" onClick={() => setQuery("")} aria-label="Clear search">
              <X size={15} />
            </button>
          )}
        </div>
        {chips}
        {query.trim() ? (
          // searching: what matches takes the place of the list
          !shownHits ? null : shownHits.length ? (
            shownHits.map((h) => {
              const last = authors.get(h.path);
              return (
                <Row key={h.path} title={h.title} aside={where(h.path)} line={<span dangerouslySetInnerHTML={{ __html: snippetHtml(h.snippet) }} />} author={last?.author ?? null} at={last?.at ?? 0} onOpen={() => onOpen(h.path)} onAuthor={onBy} />
              );
            })
          ) : (
            empty("No matches")
          )
        ) : !notes ? null : view === "folders" ? (
          <FolderList notes={notes} open={folder} authors={authors} rules={rules} readOnly={!!seeAs} hidden={seeAs ? hidden : undefined} onFolder={onFolder} onOpen={onOpen} onAuthor={onBy} onShare={onShareFolder} onRename={onRenameFolder} onDelete={onDeleteFolder} />
        ) : rows.length ? (
          <>
            {rows.slice(0, limit).map((r) => (
              <NoteItem key={r.note.path} row={r} where={where} onOpen={onOpen} onAuthor={onBy} />
            ))}
            {rows.length > limit && (
              <button onClick={() => setLimit(limit + PAGE)} className="mt-1 h-10 w-full border-t border-line text-[13px] font-medium text-muted hover:text-ink">
                Show more
              </button>
            )}
          </>
        ) : (
          empty(by ? "No notes" : "No notes yet")
        )}
      </div>
    </div>
  );
}

/** A filter that is on: who or what it narrows to, and an x to drop it. */
function Chip({ avatar, text, clear, onClear }: { avatar: ReactNode; text: string; clear: string; onClear: () => void }) {
  return (
    <span className="inline-flex h-[30px] max-w-full items-center gap-1.5 rounded-full bg-chip pl-2 pr-1">
      {avatar}
      <span className="truncate text-[13px] font-semibold">{text}</span>
      <button onClick={onClear} aria-label={clear} title={clear} className="grid size-[22px] max-md:size-7 shrink-0 place-items-center rounded-full text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/40">
        <X size={12} />
      </button>
    </span>
  );
}

/** One note in the list: its title, one line of it, and at the right who changed it last and when. */
function Row({ title, aside, line, author, at, tip, onOpen, onAuthor }: { title: string; aside?: string; line: ReactNode; author: string | null; at: number; tip?: string; onOpen: () => void; onAuthor: (author: string) => void }) {
  const agents = useStore((s) => s.agents);
  const members = useStore((s) => s.members);
  const w = author ? whoIs(author, agents, members, 16) : null;
  const when = shortWhen(at);
  return (
    <div className="flex min-h-16 items-start gap-3.5 border-t border-line px-1.5 py-2.5">
      <button onClick={onOpen} title={tip} className="min-w-0 flex-1 text-left outline-none focus-visible:underline">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[15px] leading-[22px] font-semibold">{title}</span>
          {aside && <span className="shrink-0 max-w-[45%] truncate text-xs text-muted">{aside}</span>}
        </span>
        <span className="block truncate text-[13px] leading-[18px] text-muted">{line}</span>
      </button>
      {w ? (
        <button onClick={() => onAuthor(author!)} aria-label={`Only ${w.name}'s notes`} className="flex shrink-0 items-center gap-1.5 pt-[3px] text-xs leading-4 text-muted outline-none hover:text-ink focus-visible:text-ink">
          {w.avatar}
          {w.name}
          {when && ` · ${when}`}
        </button>
      ) : (
        when && <span className="shrink-0 pt-[3px] text-xs leading-4 text-muted">{when}</span>
      )}
    </div>
  );
}

/** A list row that reads its note's first line once it scrolls into view. */
function NoteItem({ row, where, onOpen, onAuthor }: { row: NoteRow<NoteMeta>; where: (path: string) => string; onOpen: (path: string) => void; onAuthor: (author: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref);
  const preview = useNotePreview(row.note.path, row.note.updatedAt, row.note.title, seen);
  return (
    <div ref={ref}>
      <Row title={row.note.title} line={preview?.line ?? ""} author={row.author ?? preview?.by ?? null} at={row.author ? row.at : preview?.at || row.at} tip={where(row.note.path)} onOpen={() => onOpen(row.note.path)} onAuthor={onAuthor} />
    </div>
  );
}
