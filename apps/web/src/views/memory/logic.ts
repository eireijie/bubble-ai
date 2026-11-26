import type { AccessRule, MemoryLevel, Subject } from "@bubble-ai/core";

/** How the Memory page lays out its notes. */
export type MemoryView = "list" | "folders" | "graph";

const VIEW_KEY = "wisp.memory.view";

/** The view picked last time, or the list. */
export function savedView(): MemoryView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "folders" || v === "graph" ? v : "list";
  } catch {
    return "list";
  }
}
export function saveView(view: MemoryView) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // private windows: the choice lasts for this visit only
  }
}

/** The note's text without its front matter and without a first heading that just repeats the title. */
export function bodyOnly(content: string, title: string): string {
  let t = content;
  if (t.startsWith("---")) {
    const end = t.indexOf("\n---", 3);
    if (end >= 0) t = t.slice(end + 4).replace(/^\r?\n/, "");
  }
  const m = t.match(/^\s*#\s+(.+?)\s*\r?\n/);
  if (m && m[1]!.trim().toLowerCase() === title.trim().toLowerCase()) t = t.slice(m[0].length);
  return t;
}

/** "Today", "Yesterday", then the weekday and date: the day a change was made, as the feed groups it. */
export function dayWord(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  const n = new Date(now);
  const diff = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

/** The change feed (newest first) cut into days. */
export function changeDays<C extends { date: string }>(changes: C[], now: number = Date.now()): { day: string; items: C[] }[] {
  const out: { day: string; items: C[] }[] = [];
  for (const c of changes) {
    const day = dayWord(c.date, now);
    const last = out[out.length - 1];
    if (last?.day === day) last.items.push(c);
    else out.push({ day, items: [c] });
  }
  return out;
}

interface LinkGraph {
  nodes: { id: string; path: string | null; title: string }[];
  edges: { source: string; target: string }[];
}
export interface NoteLink {
  /** null for a note that is linked to but nobody wrote yet */
  path: string | null;
  title: string;
}

/** A note's links, both ways: the notes that link to it, and the notes it links to (written or not). */
export function noteLinks(graph: LinkGraph | null, path: string, backlinks: string[]): { from: NoteLink[]; to: NoteLink[] } {
  const byId = new Map(graph?.nodes.map((n) => [n.id, n]) ?? []);
  const name = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "");
  // while looking through an agent, only the notes it can see (the graph holds just those)
  const from = backlinks.filter((p) => !graph || byId.has(p)).map((p) => ({ path: p, title: byId.get(p)?.title ?? name(p) }));
  const seen = new Set<string>();
  const to: NoteLink[] = [];
  for (const e of graph?.edges ?? []) {
    const n = e.source === path ? byId.get(e.target) : undefined;
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    to.push({ path: n.path, title: n.title });
  }
  return { from, to };
}

/** "Not moved: Plan, Release and 2 more": the notes a folder change could not finish, in one line. */
export function leftBehind(what: string, paths: string[]): string {
  const names = paths.map((p) => p.split("/").pop()!.replace(/\.md$/i, ""));
  return `${what}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`;
}

/** "now", "12m", "3h", "today", "Mon", "Nov 3", "Nov 2025": when a note last changed, in a word. */
export function shortWhen(at: number, now: number = Date.now()): string {
  if (!at) return "";
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 6 * 3600) return `${Math.floor(s / 3600)}h`;
  const d = new Date(at);
  const today = new Date(now);
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  if (d.getFullYear() === today.getFullYear()) return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleDateString([], { month: "short", year: "numeric" });
}

interface ChangeLike {
  author: string;
  date: string;
  files: { path: string; change: string }[];
}

/** Who last changed each note and when, from the change feed (newest first). */
export function lastAuthors(changes: ChangeLike[]): Map<string, { author: string; at: number }> {
  const out = new Map<string, { author: string; at: number }>();
  for (const c of changes) for (const f of c.files) if (f.change !== "deleted" && !out.has(f.path)) out.set(f.path, { author: c.author, at: Date.parse(c.date) || 0 });
  return out;
}

export interface NoteRow<N> {
  note: N;
  /** who changed it last, as the change feed names them ("@atlas", "Sam"); null when the feed doesn't reach that far back */
  author: string | null;
  at: number;
}

/**
 * The list on the Memory page: every note, newest first. With `only`, just that author's notes:
 * the ones they changed last, plus older ones (`theirs`) nobody is known to have changed since.
 */
export function noteRows<N extends { path: string; title: string; updatedAt: number }>(notes: N[], authors: Map<string, { author: string; at: number }>, only?: string | null, theirs?: Set<string> | null): NoteRow<N>[] {
  const rows = notes.map((note) => {
    const last = authors.get(note.path);
    return { note, author: last?.author ?? null, at: last?.at || note.updatedAt };
  });
  const shown = only ? rows.filter((r) => (r.author ? r.author === only : !!theirs?.has(r.note.path))).map((r) => ({ ...r, author: only })) : rows;
  return shown.sort((a, b) => b.at - a.at || a.note.title.localeCompare(b.note.title));
}

/** "you" → "Only you"; "everyone in the workspace, all agents" → "Everyone, all agents". */
export function accessWord(read: string): string {
  const words = read.replace(/everyone in the workspace/g, "everyone").trim();
  if (!words || words === "nobody") return "Nobody";
  if (words === "you") return "Only you";
  return words[0]!.toUpperCase() + words.slice(1);
}

/** Folders Bubble AI itself keeps (Shared, each agent's and person's notes, team folders): shared, never renamed or deleted. */
export function fixedFolder(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  const top = parts[0]?.toLowerCase();
  if (top === "shared") return parts.length === 1;
  if (top === "agents" || top === "people" || top === "teams" || top === "groups") return parts.length <= 2;
  return parts.length === 0;
}

const inside = (folder: string, path: string) => path.toLowerCase().startsWith(folder.toLowerCase() + "/");

export interface FolderPlan {
  /** the folder's own access rules (and those on anything in it), to set again under the new name before a note moves */
  rules: { id?: string; path: string; subject: Subject; level: MemoryLevel; startup: boolean }[];
  moves: { from: string; to: string }[];
  /** why it can't be done, when it can't */
  error?: string;
}

/** What renaming a folder takes: each note moves, and so does every access rule set on the folder or inside it. */
export function renameFolderPlan(from: string, to: string, notes: { path: string }[], rules: AccessRule[]): FolderPlan {
  const swap = (p: string) => to + p.slice(from.length);
  const plan: FolderPlan = {
    rules: rules.filter((r) => !r.builtin && (r.path.toLowerCase() === from.toLowerCase() || inside(from, r.path))).map((r) => ({ id: r.id, path: swap(r.path), subject: r.subject, level: r.level, startup: !!r.startup })),
    moves: notes.filter((n) => inside(from, n.path)).map((n) => ({ from: n.path, to: swap(n.path) })),
  };
  if (to.toLowerCase() !== from.toLowerCase() && notes.some((n) => inside(to, n.path))) plan.error = `There is already a folder called ${to.split("/").pop()}`;
  return plan;
}

/** A folder's new path when only its own name changes. */
export function renamedFolder(path: string, name: string): string | null {
  const clean = name.trim().replace(/[\\/]+/g, " ").trim();
  if (!clean || clean === "." || clean === "..") return null;
  return [...path.split("/").slice(0, -1), clean].join("/");
}
