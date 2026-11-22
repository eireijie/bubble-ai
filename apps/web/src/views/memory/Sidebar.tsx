import { baseName, folderSteps } from "./parts.tsx";

export interface NoteMeta {
  path: string;
  title: string;
  tags: string[];
  links: string[];
  updatedAt: number;
}
export interface Hit {
  path: string;
  title: string;
  snippet: string;
}

export type TreeNode = { name: string; path: string; children: Map<string, TreeNode>; note?: NoteMeta; count: number };

/** Folders and notes as a tree. agents/<id> and people/<id> are each a top folder of their own ("Ghosty's notes"). */
export function buildTree(notes: NoteMeta[], meId?: string): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: new Map(), count: 0 };
  for (const n of notes) {
    const parts = folderSteps(n.path.split("/").slice(0, -1).join("/"));
    const segs = [...parts, baseName(n.path)];
    let cur = root;
    segs.forEach((seg, i) => {
      const p = segs.slice(0, i + 1).join("/");
      if (!cur.children.has(seg)) cur.children.set(seg, { name: seg, path: p, children: new Map(), count: 0 });
      cur = cur.children.get(seg)!;
      if (i < segs.length - 1) cur.count++;
      if (i === segs.length - 1) cur.note = n;
    });
  }
  // built-in folders first: Shared, your own notes, helpers' notes, other people, teams, groups, then your own folders A to Z
  const rank = (n: TreeNode) => {
    if (n.note) return 99;
    if (n.name === "shared") return 0;
    if (meId && n.name === `people/${meId}`) return 1;
    if (n.name.startsWith("agents/")) return 2;
    if (n.name.startsWith("people/")) return 3;
    if (n.name === "teams") return 4;
    if (n.name === "groups") return 5;
    return 50;
  };
  return [...root.children.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Find a folder node by its path. */
export function findNode(tree: TreeNode[], path: string): TreeNode | null {
  for (const n of tree) {
    if (n.path === path) return n;
    if (!n.note && path.startsWith(n.path + "/")) {
      const f = findNode([...n.children.values()], path);
      if (f) return f;
    }
  }
  return null;
}
