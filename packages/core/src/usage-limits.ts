import type { PlanUsage, PlanWindow } from "./models.ts";
import { zonedParts } from "./schedule.ts";
import type { ModelOption } from "./types.ts";

/**
 * Keeping agents inside the person's own AI plan. A subscription (Claude, ChatGPT) has windows that
 * fill up and reset; an API key has rate limits and a balance. Work nobody asked for (background
 * checks, changes in watched apps) stops before it uses the last of a window, and stops completely
 * when the harness says the limit is reached, until the time it gives. Nothing is retried meanwhile.
 */

/**
 * How much a token read from the harness's cache counts against an allowance. Harnesses report
 * `inputTokens` as everything the model read, every turn of a run, cached prefix included; a long
 * check can re-read the same 30k of context ten times. Plans charge a cache read a small fraction of
 * a fresh token (about a tenth on Claude and ChatGPT), so counting them in full made one quiet check
 * look like a quarter of a day's allowance.
 */
export const CACHED_INPUT_WEIGHT = 0.1;

/** What a run's reported usage costs against an allowance: fresh input and output in full, cache reads at CACHED_INPUT_WEIGHT; null when the harness didn't say. */
export function spentTokens(u: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number } | null | undefined): number | null {
  if (!u || (u.inputTokens === undefined && u.outputTokens === undefined)) return null;
  const input = u.inputTokens ?? 0;
  const cached = Math.min(input, Math.max(0, u.cachedInputTokens ?? 0));
  return Math.round(input - cached + cached * CACHED_INPUT_WEIGHT + (u.outputTokens ?? 0));
}

/** Unattended work stops once a plan window is this full, so what's left is the person's own. */
export const PLAN_RESERVE = 0.9;
/** How long to wait when a limit is reached and the harness didn't say when it resets; doubles each time it's hit again. */
export const LIMIT_WAIT_MINUTES = 60;
export const LIMIT_WAIT_MAX_MINUTES = 6 * 60;

export interface LimitHit {
  /** when the harness says it can be used again (ISO), or null when it didn't say */
  resetsAt: string | null;
}

/** A run error that means "the plan or key is used up for now", in any harness's words. */
const LIMIT =
  /(?:usage|rate|weekly|daily|monthly|session|plan|spend(?:ing)?|token|request)s?[ _-]?limit|\d+[- ]hour limit|hit your limit|limit (?:reached|exceeded)|too many requests|\b429\b|quota|credit balance is too low|out of credits|insufficient[_ ]credits?|insufficient_quota|usage_limit_reached|exceeded your current/i;
/**
 * Limits that aren't the plan's: Bubble AI's own, a full disk, a model's context window, a browser or
 * session count, and another service's rate limit (a connected app's API answering 429).
 */
const NOT_THE_PLAN =
  /channel rate limit|daily limit reached|allowance|disk quota|\bEDQUOT\b|\bENOSPC\b|context (?:length|window)|(?:exceeds?|over|above) the (?:token|context|size|length) limit|maximum context|concurrent|\b(?:github|gitlab|bitbucket|notion|slack|linear|jira|atlassian|stripe|npm|docker|pypi|hugging ?face|google drive|gmail)\b|tool call failed/i;
/** A reset further away than this isn't believed (no plan window is longer than a week): it's treated as "didn't say". */
export const LIMIT_MAX_WAIT_MS = 8 * 86_400_000;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The next time the clock reads `hour:minute` in `timeZone`, after `now`. */
function nextClock(now: Date, hour: number, minute: number, timeZone: string): Date {
  let t = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  // step by minutes to the next hour boundary, then by the minute within the hour: at most a day and an hour
  for (let i = 0; i < 25 * 60; i++) {
    t = new Date(t.getTime() + 60_000);
    let p: { hour: number; minute: number };
    try {
      p = zonedParts(t, timeZone);
    } catch {
      p = zonedParts(t, "UTC");
    }
    if (p.hour === hour && p.minute === minute) return t;
  }
  return new Date(now.getTime() + 24 * 3_600_000);
}

/**
 * Is this run error the harness saying its plan or key is used up? Then when it resets, read from
 * the error where it says ("resets 5pm", "try again in 3 hours 12 minutes", "…|1763830800").
 * `timeZone` is the person's, for clock times given without one.
 */
export function limitProblem(error: string, now = new Date(), timeZone = "UTC"): LimitHit | null {
  if (!error || !LIMIT.test(error) || NOT_THE_PLAN.test(error)) return null;
  const at = (d: Date | null) => ({ resetsAt: d && !isNaN(d.getTime()) && d.getTime() > now.getTime() && d.getTime() - now.getTime() <= LIMIT_MAX_WAIT_MS ? d.toISOString() : null });
  // Claude Code: "Claude AI usage limit reached|1763830800"
  const epoch = /\|(\d{10})\b/.exec(error);
  if (epoch) return at(new Date(Number(epoch[1]) * 1000));
  // "try again in 3 days 2 hours 12 minutes", "retry after 20s"
  const rel = /(?:try again|retry|resets?|available again)\s+(?:in|after)\s+((?:\d+(?:\.\d+)?\s*(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b[\s,and]*)+)/i.exec(error);
  if (rel) {
    let ms = 0;
    for (const m of rel[1].matchAll(/(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi)) {
      const n = Number(m[1]);
      const u = m[2][0].toLowerCase();
      ms += n * (u === "d" ? 86_400_000 : u === "h" ? 3_600_000 : u === "m" ? 60_000 : 1000);
    }
    if (ms > 0) return at(new Date(now.getTime() + ms));
  }
  // "try again at Nov 23rd, 2026 9:05 AM"
  const dated = /(?:try again|resets?|available again)\s+(?:at|on)\s+([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}),?\s+(?:at\s+)?(\d{1,2}):(\d\d)\s*(am|pm)?/i.exec(error);
  if (dated) {
    const month = MONTHS.indexOf(dated[1].slice(0, 3).toLowerCase());
    if (month >= 0) {
      let hour = Number(dated[4]) % 12;
      if (dated[6]?.toLowerCase() === "pm") hour += 12;
      else if (!dated[6]) hour = Number(dated[4]);
      // the clock time on that date, in the person's zone: start from UTC and correct by the zone's offset
      let t = Date.UTC(Number(dated[3]), month, Number(dated[2]), hour, Number(dated[5]));
      try {
        const p = zonedParts(new Date(t), timeZone);
        t += t - Date.UTC(Number(dated[3]), p.month - 1, p.day, p.hour, p.minute);
      } catch {}
      return at(new Date(t));
    }
  }
  // "resets 5pm", "resets at 3:30 PM (America/New_York)"
  const clock = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d\d))?\s*(am|pm)(?:\s*\(([A-Za-z_]+\/[A-Za-z_+-]+)\))?/i.exec(error);
  if (clock) {
    let hour = Number(clock[1]) % 12;
    if (clock[3].toLowerCase() === "pm") hour += 12;
    return at(nextClock(now, hour, Number(clock[2] ?? 0), clock[4] ?? timeZone));
  }
  return { resetsAt: null };
}

/** How full a plan is, for deciding whether unattended work may go on: the fullest window and when it resets. */
export interface PlanState {
  /** every window is under the reserve: unattended work may run */
  ok: boolean;
  /** a window is full: nothing will run until it resets */
  full: boolean;
  /** the window that stops it (the one that resets last among those over the line) */
  window: PlanWindow | null;
}

/** Where a plan stands against the reserve. Windows that already reset (as of `now`) count as empty. */
export function planState(plan: PlanUsage | null | undefined, now = new Date(), reserve = PLAN_RESERVE): PlanState {
  const windows = (plan?.windows?.length ? plan.windows : plan ? [plan] : []).filter((w) => !w.resetsAt || new Date(w.resetsAt).getTime() > now.getTime());
  const over = windows.filter((w) => w.usedFraction >= reserve);
  if (!over.length) return { ok: true, full: false, window: null };
  // the one to wait for: full ones first, then whichever resets last (unknown counts as last)
  const when = (w: PlanWindow) => (w.resetsAt ? new Date(w.resetsAt).getTime() : Infinity);
  const full = over.filter((w) => w.usedFraction >= 1);
  const window = [...(full.length ? full : over)].sort((a, b) => when(b) - when(a))[0];
  return { ok: false, full: full.length > 0, window };
}

/** Words in a model's name or description that say it's the small, cheap one. */
const SMALL = [/\bnano\b/i, /\b(?:haiku|mini|luna|lite|flash|small|spark|instant)\b/i, /\b(?:cheap(?:est)?|affordable|quick(?:est)?|fast(?:est)?|simple|easier|lightweight)\b/i];

/**
 * The smallest model a harness offers, for work that only sorts things (is this change worth a
 * full look?): by name first ("nano", then "haiku", "mini", "luna"…), then by what its description
 * says. Undefined when nothing looks small; then the caller keeps the model it had.
 */
export function smallestModel(models: readonly Pick<ModelOption, "id" | "label" | "description">[]): string | undefined {
  for (const hint of SMALL.slice(0, 2)) {
    const m = models.find((x) => hint.test(x.id.replace(/[-_.]/g, " ")) || hint.test(x.label.replace(/[-_.]/g, " ")));
    if (m) return m.id;
  }
  return models.find((x) => SMALL[2].test(x.description ?? ""))?.id;
}
