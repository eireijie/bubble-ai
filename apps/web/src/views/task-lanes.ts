/** A task that failed on its own. A cancelled one is stored as failed too, but someone stopped it on purpose, so it stays with the finished ones. */
export function isFailedTask(t: { status: string; result?: string | null }): boolean {
  return t.status === "failed" && !t.result?.startsWith("Cancelled");
}

/** Finished tasks split in two: Failed never counts as Done. Most recent 20 of each. */
export function closedLanes<T extends { status: string; result?: string | null }>(closed: T[]): { failed: T[]; done: T[] } {
  return { failed: closed.filter(isFailedTask).slice(0, 20), done: closed.filter((t) => !isFailedTask(t)).slice(0, 20) };
}

/** The page's three groups. */
export type TaskGroup = "doing" | "waiting" | "done";
export const TASK_GROUPS: { id: TaskGroup; title: string }[] = [
  { id: "doing", title: "Doing" },
  { id: "waiting", title: "Waiting on you" },
  { id: "done", title: "Done" },
];

/**
 * Where a task's state puts it: "To do" and "Waiting for a computer" sit under Doing, "Failed"
 * sits under Waiting on you (it wants a Try again), and a cancelled one is finished.
 */
export function groupOfState(state: "todo" | "working" | "blocked" | "needsYou" | "done" | "failed" | "cancelled"): TaskGroup {
  if (state === "needsYou" || state === "failed") return "waiting";
  if (state === "done" || state === "cancelled") return "done";
  return "doing";
}

/** The page's search field: every word typed has to be in one of the task's words (its title, who has it, its team, its state, "me"). */
export function taskMatches(query: string, words: (string | null | undefined)[]): boolean {
  const hay = words.filter(Boolean).join("\n").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** "12 min", "3 h", "Mon", "Nov 3": when a row last moved, as short as it reads. */
export function shortAgo(iso: string, now = Date.now()): string {
  const at = new Date(iso);
  const s = (now - at.getTime()) / 1000;
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return at.toLocaleDateString([], { weekday: "short" });
  return at.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** One field for a new task: its first line is the title (at most 200 characters), the lines under it are the details. */
export function titleAndBrief(text: string): { title: string; brief: string } {
  const all = text.trim();
  const lines = all.split("\n");
  const first = lines[0].trim();
  const rest = lines.slice(1).join("\n").trim();
  // a first line too long for a title is kept whole in the brief
  if (first.length > 200) return { title: `${first.slice(0, 199)}…`, brief: all };
  return { title: first, brief: rest || first };
}

/** A task another page asked Tasks to open (Code's "Review" keys), taken once when Tasks shows. */
export interface TaskRequest {
  id: string;
  tab?: "changes" | "files" | "checks";
  act?: "merge" | "back";
}
let requested: TaskRequest | null = null;
export function requestTask(r: TaskRequest) {
  requested = r;
}
export function takeRequestedTask(): TaskRequest | null {
  const r = requested;
  requested = null;
  return r;
}
