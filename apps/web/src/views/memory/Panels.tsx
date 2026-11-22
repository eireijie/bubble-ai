import { useEffect, useMemo, useState } from "react";
import { Folder, FolderOpen, Lock, MoreHorizontal, PencilLine, Trash2 } from "lucide-react";
import type { AccessRule } from "@wisp/core";
import { api } from "../../api.ts";
import { useStore } from "../../store.ts";
import { Menu } from "../../components/ui.tsx";
import { accessSummary } from "../../components/AccessDialog.tsx";
import { folderSteps, noteName, useFolderLabel, whoIs } from "./parts.tsx";
import { accessWord, fixedFolder, shortWhen } from "./logic.ts";
import { buildTree, type NoteMeta, type TreeNode } from "./Sidebar.tsx";

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
              <button onClick={toggle} className="grid size-8 max-md:size-11 shrink-0 place-items-center rounded-full text-muted outline-none hover:bg-hover hover:text-ink focus-visible:bg-hover" aria-haspopup="menu" aria-label={fixed ? `${name}: share` : `${name}: share, rename, delete`}>
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
