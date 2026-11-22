import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { type AccessRule } from "@wisp/core";
import { api } from "../api.ts";
import { useStore } from "../store.ts";
import { go, mayLeave } from "../router.ts";
import { AgentAvatar } from "../components/ui.tsx";
import { AccessDialog, folderPaths } from "../components/AccessDialog.tsx";
import { type GraphData } from "../components/MemoryGraph.tsx";
import { MemoryHome, type Change } from "./MemoryHome.tsx";
import { StorageDialog } from "./memory/Storage.tsx";
import { DeleteFolderDialog, NewNoteDialog, RenameFolderDialog } from "./memory/NoteDialogs.tsx";
import { NoteView } from "./memory/NoteView.tsx";
import { buildTree, type Hit, type NoteMeta } from "./memory/Sidebar.tsx";
import { MemoryDialog, Cards, folderSteps, isNotePath, keepMine, useFolderLabel, useIsPhone } from "./memory/parts.tsx";
import { lastAuthors, saveView, savedView, type MemoryView } from "./memory/logic.ts";

const norm = (s: string) => s.trim().replace(/\.md$/i, "").toLowerCase();
const base = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "");

function snippetHtml(s: string) {
  const esc = s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  return esc.replace(/\*\*(.+?)\*\*/g, '<mark class="bg-info/30 text-ink rounded px-0.5">$1</mark>');
}

/**
 * Memory: one page with a search and the notes, newest first; a view button swaps the list for
 * folders or the graph. A note opens on a page of its own (read, edit, history, who wrote what).
 */
export function VaultView({ path, onBack }: { path: string | null; onBack?: () => void }) {
  const phone = useIsPhone();
  const label = useFolderLabel();
  const [notes, setNotes] = useState<NoteMeta[] | null>(null);
  const [everything, setEverything] = useState<NoteMeta[] | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const searchGeneration = useRef(0);
  // list, folders or graph: the choice is kept for next time
  const [view, setView] = useState<MemoryView>(savedView);
  // "Show in graph" from a note: the graph opens on it, without changing the kept choice
  const [graphPick, setGraphPick] = useState<string | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [changes, setChanges] = useState<Change[] | null>(null);
  // only one author's notes (a ghost in the list was clicked)
  const [by, setBy] = useState<string | null>(null);
  const [byPaths, setByPaths] = useState<Set<string> | null>(null);
  const [creating, setCreating] = useState<{ dir: string; name?: string } | null>(null);
  const [sharing, setSharing] = useState<{ path: string; folder: boolean } | null>(null);
  const [folderDialog, setFolderDialog] = useState<{ kind: "rename" | "delete"; path: string } | null>(null);
  const [storageOpen, setStorageOpen] = useState(false);
  const [pickingAs, setPickingAs] = useState(false);
  // owners can look at memory the way one agent sees it
  const [viewAs, setViewAs] = useState<string | null>(null);
  const [rules, setRules] = useState<AccessRule[]>([]);
  // a note just created here opens straight into editing; NoteView remounts per path, so the intent lives here
  const pendingEdit = useRef<string | null>(null);
  const meId = useStore((s) => s.me?.user.id);
  const agents = useStore((s) => s.agents);
  const isOwner = useStore((s) => s.me?.role === "owner");
  // notes changed in Obsidian (or pushed from another computer): reload the list
  const memoryVersion = useStore((s) => s.memoryVersion);
  const asAgent = agents.find((a) => `agent:${a.id}` === viewAs);

  const refresh = useCallback(async () => {
    const as = viewAs ? `?as=${encodeURIComponent(viewAs)}` : "";
    const [list, rules, links, all, recent] = await Promise.all([
      api<NoteMeta[]>("GET", `/api/vault/notes${as}`),
      api<AccessRule[]>("GET", "/api/access/rules").catch(() => []),
      api<GraphData>("GET", `/api/vault/graph${as}`).catch(() => null),
      viewAs ? api<NoteMeta[]>("GET", "/api/vault/notes").catch(() => null) : Promise.resolve(null),
      // who changed what, newest first: the list's order, authors and times
      api<Change[]>("GET", "/api/vault/changes?limit=200").catch(() => []),
    ]);
    setNotes(list);
    setEverything(all ?? list);
    setGraph(links);
    setRules(rules);
    setChanges(recent);
  }, [viewAs]);
  useEffect(() => {
    refresh();
  }, [refresh, memoryVersion]);
  // edits made outside Wisp (Obsidian, a git pull) are picked up as the page opens; after that the hub says when memory changes
  useEffect(() => {
    api<{ changed: number }>("POST", "/api/vault/sync").then((r) => void (r.changed && refresh()), () => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const generation = ++searchGeneration.current;
    if (!query.trim()) return setHits(null);
    const t = setTimeout(() => api<Hit[]>("GET", `/api/vault/search?q=${encodeURIComponent(query)}&limit=30`).then((r) => generation === searchGeneration.current && setHits(r), () => {}), 150);
    return () => {
      searchGeneration.current++;
      clearTimeout(t);
    };
    // the list reloads after a note is made, changed or deleted: search again so no stale hit stays
  }, [query, notes]);
  // while viewing as an agent, only show hits it could open
  const visibleHits = useMemo(() => (hits && viewAs && notes ? hits.filter((h) => notes.some((n) => n.path === h.path)) : hits), [hits, viewAs, notes]);

  // one author's notes: the change feed names their recent ones; this reaches the older ones too
  useEffect(() => {
    setByPaths(null);
    if (!by) return;
    let live = true;
    api<Change[]>("GET", `/api/vault/changes?limit=200&author=${encodeURIComponent(by)}`).then((c) => live && setByPaths(new Set(c.flatMap((x) => x.files.filter((f) => f.change !== "deleted").map((f) => f.path)))), () => {});
    return () => {
      live = false;
    };
  }, [by, memoryVersion]);
  const authors = useMemo(() => lastAuthors(changes ?? []), [changes]);

  const isNote = !!path && isNotePath(path);
  const folder = path && !isNote ? path : null;
  // opening a note leaves the graph it was picked from
  useEffect(() => {
    if (isNote) setGraphPick(null);
  }, [isNote, path]);

  /** Obsidian-style resolution: exact path, then basename (preferring the same top folder). */
  const resolve = useCallback(
    (target: string, from?: string | null): string | null => {
      if (!notes) return null;
      const t = norm(target);
      const exact = notes.find((n) => norm(n.path) === t);
      if (exact) return exact.path;
      const byName = notes.filter((n) => norm(base(n.path)) === t);
      const scope = from?.split("/").slice(0, from.startsWith("shared/") ? 1 : 2).join("/");
      return (scope && byName.find((n) => n.path.startsWith(scope + "/"))?.path) || byName[0]?.path || null;
    },
    [notes],
  );

  const where = (p: string) => {
    const dir = p.split("/").slice(0, -1).join("/");
    return dir ? folderSteps(dir).map((s) => label(s)).join(" / ") : "Top folder";
  };
  const openPath = (p: string) => go({ view: "vault", path: p });
  const home = () => {
    if (path) go({ view: "vault", path: null });
  };
  // a folder in the address opens the folders view; a note picked for the graph opens the graph; one author's notes are a list
  const shownView: MemoryView = folder ? "folders" : graphPick ? "graph" : by ? "list" : view;
  const chooseView = (next: MemoryView) => {
    if (!mayLeave()) return;
    setView(next);
    saveView(next);
    setGraphPick(null);
    setBy(null);
    if (next !== "folders") home();
  };
  const onlyBy = (author: string | null) => {
    setBy(author);
    setGraphPick(null);
    if (author) home();
  };
  const newNoteDir = isNote ? path!.split("/").slice(0, -1).join("/") : folder ? folder : keepMine(meId);
  /** A note that's linked to but not written yet: write it next to the first note that links to it. */
  const writeMissing = (title: string) => {
    const from = graph?.edges.find((e) => e.target === `ghost:${title}`)?.source;
    setCreating({ dir: from ? from.split("/").slice(0, -1).join("/") : newNoteDir, name: title });
  };
  const folders = useMemo(() => (everything ? folderPaths(everything) : []), [everything]);
  const canNew = !viewAs;

  // what an agent can't see: the top folders missing from its list
  const hidden = useMemo(() => {
    if (!viewAs || !notes || !everything) return [];
    const have = new Set(buildTree(notes, meId).map((n) => n.path));
    return buildTree(everything, meId)
      .filter((n) => !n.note && !have.has(n.path))
      .map((n) => label(n.name));
  }, [viewAs, notes, everything, meId, label]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="flex-1 min-w-0 min-h-0 flex flex-col" aria-label="Memory">
      <div className="flex-1 min-h-0">
        {isNote ? (
          <NoteView
            key={path}
            path={path!}
            pendingEdit={pendingEdit}
            resolve={resolve}
            graph={graph}
            where={where}
            folders={folders}
            readOnly={!!viewAs}
            onChanged={refresh}
            onShare={() => setSharing({ path: path!, folder: false })}
            onGraph={(p) => {
              setGraphPick(p);
              setBy(null);
              go({ view: "vault", path: null });
            }}
            onStorage={() => setStorageOpen(true)}
            onWrite={viewAs ? undefined : writeMissing}
            // back to where the note was opened from: its folder in the folders view, else the list or the graph
            onBack={() => go({ view: "vault", path: view === "folders" && !by ? path!.split("/").slice(0, -1).join("/") || null : null })}
          />
        ) : (
          <MemoryHome
            view={shownView}
            onView={chooseView}
            phone={phone}
            onBack={phone ? (onBack ?? (() => go({ view: "more" }))) : undefined}
            notes={notes}
            total={everything?.length ?? 0}
            authors={authors}
            query={query}
            setQuery={setQuery}
            hits={visibleHits}
            by={by}
            byPaths={byPaths}
            onBy={onlyBy}
            seeAs={asAgent ?? null}
            onSeeAs={isOwner && agents.length > 0 ? () => setPickingAs(true) : undefined}
            onStopSeeAs={() => setViewAs(null)}
            hidden={hidden}
            graph={graph}
            graphPick={graphPick}
            folder={folder}
            rules={rules}
            where={where}
            snippetHtml={snippetHtml}
            onOpen={openPath}
            onFolder={(p) => go({ view: "vault", path: p })}
            onNew={canNew ? () => setCreating({ dir: newNoteDir }) : undefined}
            onWrite={viewAs ? undefined : writeMissing}
            onShareFolder={(dir) => setSharing({ path: dir, folder: true })}
            onRenameFolder={(dir) => setFolderDialog({ kind: "rename", path: dir })}
            onDeleteFolder={(dir) => setFolderDialog({ kind: "delete", path: dir })}
          />
        )}
      </div>

      {creating !== null && (
        <NewNoteDialog
          initial={creating.dir}
          initialName={creating.name}
          folders={folders}
          onClose={() => setCreating(null)}
          onCreated={async (p, hasBody) => {
            setCreating(null);
            await refresh();
            if (!hasBody) pendingEdit.current = p;
            openPath(p);
          }}
        />
      )}
      {sharing && <AccessDialog path={sharing.path} folder={sharing.folder} onClose={() => setSharing(null)} onChanged={refresh} />}
      {folderDialog?.kind === "rename" && (
        <RenameFolderDialog
          path={folderDialog.path}
          notes={everything ?? []}
          rules={rules}
          onClose={() => setFolderDialog(null)}
          onDone={async (to) => {
            setFolderDialog(null);
            await refresh();
            go({ view: "vault", path: to });
          }}
        />
      )}
      {folderDialog?.kind === "delete" && (
        <DeleteFolderDialog
          path={folderDialog.path}
          notes={everything ?? []}
          rules={rules}
          onClose={() => setFolderDialog(null)}
          onDone={async () => {
            const up = folderSteps(folderDialog.path).slice(0, -1).join("/") || null;
            setFolderDialog(null);
            await refresh();
            go({ view: "vault", path: up });
          }}
        />
      )}
      {storageOpen && <StorageDialog onClose={() => setStorageOpen(false)} />}
      {pickingAs && <ViewAsDialog viewAs={viewAs} onClose={() => setPickingAs(false)} onPick={(v) => (setViewAs(v), setPickingAs(false))} />}
    </section>
  );
}

/** Pick an agent to see memory the way it does. The chip under the search says who, and its x ends it. */
function ViewAsDialog({ viewAs, onClose, onPick }: { viewAs: string | null; onClose: () => void; onPick: (v: string | null) => void }) {
  const agents = useStore((s) => s.agents);
  return (
    <MemoryDialog title="See as an agent" onClose={onClose}>
      <Cards>
        {agents.map((a) => (
          <button key={a.id} onClick={() => onPick(`agent:${a.id}`)} aria-pressed={viewAs === `agent:${a.id}`} className="w-full min-h-12 px-4 flex items-center gap-3 text-left hover:bg-hover/60">
            <AgentAvatar agent={a} size={30} interactive={false} />
            <span className="flex-1 text-body">{a.name}</span>
            {viewAs === `agent:${a.id}` && <Check size={16} className="text-muted" aria-hidden />}
          </button>
        ))}
      </Cards>
    </MemoryDialog>
  );
}
