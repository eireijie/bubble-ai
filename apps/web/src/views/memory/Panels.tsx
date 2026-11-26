import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Folder, FolderOpen, Lock, MoreHorizontal, PencilLine, Trash2 } from "lucide-react";
import type { AccessRule } from "@bubble-ai/core";
import { api } from "../../api.ts";
import { useStore } from "../../store.ts";
import { Menu, cx } from "../../components/ui.tsx";
import { accessSummary, pathLabel } from "../../components/AccessDialog.tsx";
import { FilterChip, folderSteps, iconBtn, noteName, pageCol, pageTitle, useFolderLabel, whoIs } from "./parts.tsx";
import { accessWord, changeDays, fixedFolder, shortWhen } from "./logic.ts";
import { buildTree, type NoteMeta, type TreeNode } from "./Sidebar.tsx";
import type { Change } from "../MemoryHome.tsx";

const VERB = { added: "wrote", modified: "edited", deleted: "deleted", renamed: "moved" } as const;

/**
 * Who changed what across the memory you can see, newest first, a day at a time. Notes that were
 * deleted or moved are listed too. A name narrows the feed to that author.
 */
export function ActivityFeed({ onOpen, onBack }: { onOpen: (p: string) => void; onBack: () => void }) {
  const agents = useStore((s) => s.agents);
  const members = useStore((s) => s.members);
  const memoryVersion = useStore((s) => s.memoryVersion);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [author, setAuthor] = useState("");
  useEffect(() => {
    let live = true;
    api<Change[]>("GET", `/api/vault/changes?limit=100${author ? `&author=${encodeURIComponent(author)}` : ""}`).then((c) => live && setChanges(c), () => live && setChanges([]));
    return () => {
      live = false;
    };
  }, [author, memoryVersion]);
  const days = useMemo(() => changeDays(changes ?? []), [changes]);
  const only = author ? whoIs(author, agents, members, 16) : null;
  return (
    <div className="h-full overflow-y-auto">
      <div className={cx(pageCol, "pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-9 pb-[max(1.5rem,env(safe-area-inset-bottom))]")}>
        <button className={iconBtn} onClick={onBack} aria-label="Back to Memory" title="Back">
          <ChevronLeft size={18} />
        </button>
        <h1 className={cx(pageTitle, "pt-4 pb-3")}>Recent changes</h1>
        {only && (
          <div className="pb-2.5">
            <FilterChip avatar={only.avatar} text={`By ${only.name}`} clear="Show everyone's changes" onClear={() => setAuthor("")} />
          </div>
        )}
        {changes && changes.length === 0 && <p className="border-t border-line px-1.5 py-4 text-[13px] text-muted">No changes yet</p>}
        {days.map((g) => (
          <section key={g.day}>
            <h2 className="flex h-9 items-end px-1.5 pb-1.5 text-xs font-medium text-muted">{g.day}</h2>
            {g.items.map((c) => {
              const w = whoIs(c.author, agents, members, 16);
              return (
                <div key={c.hash} className="flex items-start gap-3.5 border-t border-line px-1.5 py-2.5">
                  <p className="min-w-0 flex-1 text-[14px] leading-[22px] break-words">
                    <button onClick={() => setAuthor(c.author)} aria-label={`Only ${w.name}'s changes`} className="mr-1 inline-flex items-center gap-1.5 align-bottom font-semibold outline-none hover:underline focus-visible:underline">
                      {w.avatar}
                      {w.name}
                    </button>
                    {c.files.slice(0, 3).map((f, i) => (
                      <span key={f.path}>
                        {i === 0 ? VERB[f.change] : ","}{" "}
                        <button disabled={f.change === "deleted"} onClick={() => onOpen(f.path)} className={f.change === "deleted" ? "text-muted line-through" : "underline decoration-line2 underline-offset-[3px] outline-none hover:decoration-ink focus-visible:decoration-ink"} title={f.change === "renamed" && f.from ? `${pathLabel(f.from, agents, members)} → ${pathLabel(f.path, agents, members)}` : pathLabel(f.path, agents, members)}>
                          {noteName(f.path)}
                        </button>
                      </span>
                    ))}
                    {c.files.length > 3 && <span className="text-muted"> and {c.files.length - 3} more</span>}
                  </p>
                  <span className="shrink-0 pt-[3px] text-xs leading-4 text-muted">{shortWhen(Date.parse(c.date))}</span>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

type Authors = Map<string, { author: string; at: number }>;

interface FolderListProps {
  /** the folder the address has open; its notes and folders show under it */
  open: string | null;
  authors: Authors;
  rules: AccessRule[];
  /** looking at memory as an agent: folders can't be shared, renamed or deleted */
  readOnly?: boolean;
  onFolder: (path: string | null) => void;
  onOpen: (path: string) => void;
  onAuthor: (author: string) => void;
  onShare: (dir: string) => void;
  onRename: (dir: string) => void;
  onDelete: (dir: string) => void;
}

/** Memory by folder: every folder with how many notes it holds. Opening one shows what is in it. */
export function FolderList({ notes, hidden, ...rest }: FolderListProps & { notes: NoteMeta[]; /** folders the agent being looked through can't see */ hidden?: string[] }) {
  const meId = useStore((s) => s.me?.user.id);
  const top = useMemo(() => buildTree(notes, meId), [notes, meId]);
  if (!notes.length) return <p className="border-t border-line px-1.5 py-4 text-[13px] text-muted">No notes yet</p>;
  return (
    <div>
      {top.map((n) => (
        <FolderRows key={n.path} node={n} depth={0} {...rest} />
      ))}
      {hidden && hidden.length > 0 && <p className="border-t border-line px-1.5 pt-3 text-xs text-muted">Hidden: {hidden.join(", ")}</p>}
    </div>
  );
}

function FolderRows({ node, depth, ...p }: FolderListProps & { node: TreeNode; depth: number }) {
  const label = useFolderLabel();
  const agents = useStore((s) => s.agents);
  const members = useStore((s) => s.members);
  const indent = { paddingLeft: 6 + depth * 30 };

  if (node.note) {
    const last = p.authors.get(node.path);
    const w = last ? whoIs(last.author, agents, members, 16) : null;
    const when = shortWhen(last?.at || node.note.updatedAt);
    return (
      <div className="flex h-10 items-center gap-3.5 pr-1.5" style={{ paddingLeft: 6 + depth * 30 + (depth ? 0 : 30) }}>
        <button onClick={() => p.onOpen(node.path)} className="min-w-0 flex-1 truncate text-left text-[14px] outline-none hover:underline focus-visible:underline">
          {node.note.title || noteName(node.path)}
        </button>
        {w ? (
          <button onClick={() => p.onAuthor(last!.author)} aria-label={`Only ${w.name}'s notes`} className="flex shrink-0 items-center gap-1.5 text-xs text-muted outline-none hover:text-ink focus-visible:text-ink">
            {w.avatar}
            {w.name} · {when}
          </button>
        ) : (
          <span className="shrink-0 text-xs text-muted">{when}</span>
        )}
      </div>
    );
  }

  const isOpen = p.open === node.path;
  const onPath = isOpen || (!!p.open && p.open.startsWith(node.path + "/"));
  const name = depth === 0 ? label(node.name) : node.name;
  const parent = folderSteps(node.path).slice(0, -1).join("/") || null;
  const own = p.rules.some((r) => r.path.toLowerCase() === node.path.toLowerCase());
  const fixed = fixedFolder(node.path);
  const kids = [...node.children.values()];
  const folders = kids.filter((k) => !k.note).sort((a, b) => a.name.localeCompare(b.name));
  const files = kids.filter((k) => k.note).sort((a, b) => b.note!.updatedAt - a.note!.updatedAt);
  const Icon = onPath ? FolderOpen : Folder;
  return (
    <>
      <div className="flex h-[46px] items-center gap-2 border-t border-line pr-1.5" style={indent}>
        <button onClick={() => p.onFolder(isOpen ? parent : node.path)} aria-expanded={onPath} className="flex h-full min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:underline">
          <Icon size={18} strokeWidth={1.8} className="shrink-0 text-muted" aria-hidden />
          <span className="truncate text-[15px] font-semibold">{name}</span>
          <span className="shrink-0 text-[13px] tabular-nums text-muted">{node.count}</span>
          {own && (
            <>
              <span className="flex-1" />
              <AccessWord path={node.path} rules={p.rules} />
            </>
          )}
        </button>
        {isOpen && !p.readOnly && (
          <Menu
            align="right"
            trigger={(_o, toggle) => (
              <button onClick={toggle} className="grid size-8 max-md:size-11 shrink-0 place-items-center rounded-[8px] text-muted outline-none hover:bg-hover hover:text-ink focus-visible:bg-hover" aria-haspopup="menu" aria-label={fixed ? `${name}: share` : `${name}: share, rename, delete`}>
                <MoreHorizontal size={16} />
              </button>
            )}
            items={[
              { label: "Share", icon: <Lock size={16} />, onSelect: () => p.onShare(node.path) },
              ...(fixed ? [] : [{ label: "Rename", icon: <PencilLine size={16} />, onSelect: () => p.onRename(node.path) }, "divider" as const, { label: "Delete", icon: <Trash2 size={16} />, danger: true, onSelect: () => p.onDelete(node.path) }]),
            ]}
          />
        )}
      </div>
      {onPath && (
        <div className={files.length ? "pb-1.5" : undefined}>
          {folders.map((k) => (
            <FolderRows key={k.path} node={k} depth={depth + 1} {...p} />
          ))}
          {files.map((k) => (
            <FolderRows key={k.path} node={k} depth={depth + 1} {...p} />
          ))}
        </div>
      )}
    </>
  );
}

/** Who can read a folder that has its own access: "Only you", or their names. */
function AccessWord({ path, rules }: { path: string; rules: AccessRule[] }) {
  const agents = useStore((s) => s.agents);
  const myId = useStore((s) => s.me?.user.id);
  const [info, setInfo] = useState<Parameters<typeof accessSummary>[0] | null>(null);
  // asked again whenever a rule on this folder changes
  const stamp = rules.filter((r) => r.path.toLowerCase() === path.toLowerCase()).map((r) => `${r.id}:${r.level}`).join(",");
  useEffect(() => {
    let live = true;
    api<Parameters<typeof accessSummary>[0]>("GET", `/api/access?path=${encodeURIComponent(path)}`).then((i) => live && setInfo(i), () => {});
    return () => {
      live = false;
    };
  }, [path, stamp]);
  if (!info) return null;
  const read = accessSummary(info, { myId, agentName: (id, handle) => agents.find((a) => a.id === id)?.name ?? `@${handle}` }).read;
  return <span className="max-w-[45%] shrink-0 truncate pr-1 text-xs font-normal text-muted">{accessWord(read)}</span>;
}

export { noteName };
