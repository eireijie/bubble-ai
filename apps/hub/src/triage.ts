import { envVar, frameOutside, type AppEvent } from "@wisp/core";
import { inQuietHours } from "./background.ts";
import { featureOn } from "./features.ts";
import type { Hub } from "./hub.ts";

/** The device sees sorting as its own conversation (each one starts fresh anyway). */
export const TRIAGE_THREAD = "triage";
/** A sort still running this long after it was started is given up on (and counts as a yes). */
export const SORT_TIMEOUT_MS = 10 * 60_000;
/** Kinds that are addressed to the person: always worth a full look, so sorting them would only add a call. */
const DIRECT = /mention|review_requested|assigned|direct|dm\b|invite/i;
/** In a browser check's preview: what to look for, then this, then the lines Wisp saw added (watches.ts). */
const NEW_ON_PAGE = "\n[new on the page]\n";
/** Changes shown to the sorter; the rest ride along with the decision. */
const MAX_LINES = 40;
const MAX_LINE = 260;
/** Changed notes named to the sorter. */
const MAX_NOTES = 20;

/**
 * Sorting changes before a full check. A check wakes the agent with all its tools, its memory and
 * its notes, which costs tens of thousands of tokens whether or not the change mattered. So a batch
 * of changes first goes to the harness's smallest model with a few lines and no tools: is any of
 * this worth waking the agent for? Only a yes starts the check. It fails open: no answer, an answer
 * it can't read, or a failed run all count as yes. A yes still obeys what holds any check (the
 * plan, the day's limits, quiet hours, background work turned off): then the changes wait, already sorted.
 *
 * Notes that changed inside Wisp are sorted the same way when they are the only reason for a check.
 */
export class Triage {
  /** the notes a note sort is about, and the time it looked at them (not kept across a restart: the next look sorts again) */
  private notes = new Map<string, { paths: string[]; at: Date }>();

  constructor(private hub: Hub) {
    // a sort that was running when the hub stopped never answers: its changes go back in line
    const { db } = hub.store;
    const stale = db.prepare("SELECT id FROM runs WHERE kind = 'triage' AND status = 'running'").all() as { id: string }[];
    for (const r of stale) {
      db.prepare("UPDATE app_events SET run_id = NULL WHERE run_id = ?").run(r.id);
      hub.store.setRunStatus(r.id, "failed", "the hub restarted");
    }
  }

  get on() {
    return envVar("TRIAGE") !== "off";
  }

  /** Whether a batch should be sorted first (true) or go straight to a full check. */
  worthSorting(events: AppEvent[]): boolean {
    if (!this.on || !events.length) return false;
    // a site only its browser can see: there is nothing to read here, the agent has to look
    if (events.some((e) => e.kind === "browser_check" && !(e.preview ?? "").includes(NEW_ON_PAGE))) return false;
    return !events.some((e) => DIRECT.test(e.kind));
  }

  private sorting(agentId: string, userId: string) {
    return !!this.hub.store.db.prepare("SELECT 1 FROM runs WHERE agent_id = ? AND requested_by = ? AND kind = 'triage' AND status IN ('queued','running')").get(agentId, userId);
  }

  private start(agentId: string, userId: string): string | null {
    const { store } = this.hub;
    const agent = store.agent(agentId);
    if (!agent) return null;
    const channel = store.dmChannel(agent.workspaceId, userId, agentId);
    return store.createRun({ agentId, channelId: channel.id, threadId: null, triggerMessageId: "", hop: 0, requestedBy: userId, kind: "triage" });
  }

  /**
   * Sort a batch of waiting changes for one agent and person. Returns the sorting run, or null when
   * the batch should go straight to a check (the caller wakes the agent then).
   */
  sort(agentId: string, userId: string, eventIds: string[]): string | null {
    const { store, watches } = this.hub;
    if (!eventIds.length) return null;
    const marks = eventIds.map(() => "?").join(",");
    const events = store.db.prepare(`SELECT id, watch_id AS watchId, service, kind, item_id AS itemId, title, url, actor, preview, happened_at AS happenedAt FROM app_events WHERE id IN (${marks}) AND run_id IS NULL`).all(...eventIds) as AppEvent[];
    if (!this.worthSorting(events)) return null;
    const runId = this.start(agentId, userId);
    if (!runId) return null;
    watches.claim(eventIds, runId);
    this.hub.dispatchRun(runId);
    return runId;
  }

  /**
   * Sort notes that changed, when they're the only reason for a regular check. Returns true when a
   * sort is on its way (or already running); false means check without one.
   */
  sortNotes(agentId: string, userId: string, paths: string[], at = new Date()): boolean {
    if (!this.on || !paths.length) return false;
    if (this.sorting(agentId, userId)) return true;
    const runId = this.start(agentId, userId);
    if (!runId) return false;
    this.notes.set(runId, { paths, at });
    this.hub.dispatchRun(runId);
    return true;
  }

  /** Background work was turned off: a sort that hasn't started never does, and its changes go back to waiting. */
  turnedOff(agentId: string, userId: string) {
    const { store, watches } = this.hub;
    const queued = store.db.prepare("SELECT id FROM runs WHERE agent_id = ? AND kind = 'triage' AND requested_by = ? AND status = 'queued'").all(agentId, userId) as { id: string }[];
    for (const r of queued) {
      if (!store.deleteQueuedRun(r.id)) continue;
      watches.release(r.id);
      this.notes.delete(r.id);
    }
  }

  /** Give up on sorts that never answered: they count as a yes, like any sort that failed. */
  sweep(at = new Date()) {
    const { store } = this.hub;
    const hung = store.db.prepare("SELECT id, agent_id AS agentId, requested_by AS requestedBy FROM runs WHERE kind = 'triage' AND status = 'running' AND created_at < ?").all(new Date(at.getTime() - SORT_TIMEOUT_MS).toISOString()) as { id: string; agentId: string; requestedBy: string | null }[];
    for (const r of hung) {
      this.hub.cancelRun(r.id);
      this.finished(r, { error: "the sort didn't answer in time" }, at);
    }
  }

  /** The whole prompt of a sorting run: a few lines, nothing about Wisp's tools. */
  prompt(run: { id: string; agentId: string; requestedBy: string | null }): string {
    const { store, watches } = this.hub;
    const agent = store.agent(run.agentId);
    const user = run.requestedBy ? store.user(run.requestedBy) : undefined;
    const name = user ? user.preferredName || user.name : "the person";
    const who = agent?.name ?? "the assistant";
    const b = user ? store.background(run.agentId, user.id) : undefined;
    const cut = (s: string) => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE - 1)}…` : s);
    const noted = this.notes.get(run.id);
    const lines: string[] = [];
    let count = 0;
    if (noted) {
      count = noted.paths.length;
      // its own folder reads "me/" to it everywhere else; other folders keep their names
      for (const p of noted.paths.slice(0, MAX_NOTES)) lines.push(cut(`- a note in Wisp's memory changed: ${p}`));
    } else {
      const events = watches.eventsForRun(run.id);
      count = events.length;
      const all = run.requestedBy && agent ? watches.list(agent.workspaceId, { agentId: run.agentId, userId: run.requestedBy }) : [];
      const label = new Map(all.map((w) => [w.id, w]));
      for (const e of events.slice(0, MAX_LINES)) {
        const w = label.get(e.watchId);
        if (e.kind === "browser_check") {
          const [lookFor, added] = (e.preview ?? "").split(NEW_ON_PAGE);
          lines.push(`- [${w?.label ?? e.title}] watched for "${cut(lookFor)}". New lines on the page:`, ...(added ?? "").split("\n").filter(Boolean).map((l) => `    ${cut(l)}`));
        } else lines.push(cut(`- [${w?.label ?? e.service}] ${e.kind.replace(/_/g, " ")}: ${e.title}${e.actor ? ` (by ${e.actor})` : ""}${e.preview ? ` — "${e.preview}"` : ""}`));
      }
    }
    const shown = noted ? MAX_NOTES : MAX_LINES;
    const raised = run.requestedBy ? watches.mentions(run.agentId, run.requestedBy).slice(0, 15) : [];
    return [
      `You sort changes for ${who}, an assistant who works for ${name}. ${noted ? `Notes changed in the memory ${who} shares with other agents and people (other agents save notes there all the time).` : `Something changed in what ${who} watches.`} Decide whether ${who} should be woken to look. Waking costs ${name} money, so say yes only when a change plausibly needs ${name}'s attention or is something ${who} was asked to act on. Routine noise (small edits, bots, things ${name} did themself, changes outside what they asked about) is a no.`,
      b?.focus ? `${name} asked ${who} to keep an eye on: ${b.focus}` : `${name} hasn't said what matters most.`,
      raised.length ? `${who} already told ${name} about these (the same thing again is a no, unless something really new happened): ${raised.map((m) => m.about).join("; ")}` : "",
      `The changes${count > shown ? ` (the first ${shown} of ${count})` : ""}:`,
      // written by whoever sent them or by a website, never by the person: data, not instructions
      frameOutside(noted ? "names of notes in Wisp's memory" : "watched apps and websites", lines.join("\n")),
      `Answer with one line of JSON and nothing else: {"wake": true or false, "why": "a few words"}. If you can't tell, answer true. Don't use any tools.`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  /** What the sorter said. Anything but a clear no is a yes. */
  static verdict(text: string): { wake: boolean; why: string } {
    const m = /"wake"\s*:\s*(true|false)/i.exec(text);
    const why = /"why"\s*:\s*"([^"]{0,200})"/i.exec(text)?.[1] ?? "";
    return { wake: m?.[1].toLowerCase() !== "false", why };
  }

  /**
   * Whether a check may start for this agent and person right now: background work is on, it isn't
   * quiet hours, and nothing holds it (the plan, a failed check waiting to try again, the day's limits).
   * Things can change while a sort runs, and a sort that failed because the plan ran out must not
   * start a check that fails the same way.
   */
  private mayWake(agentId: string, userId: string, at: Date): boolean {
    const { store, background } = this.hub;
    const agent = store.agent(agentId);
    const b = store.background(agentId, userId);
    if (!agent || !b?.enabled || !featureOn(store, agent.workspaceId, "background")) return false;
    const tz = store.user(userId)?.timezone || "UTC";
    if (inQuietHours(at, tz, b.quietStart, b.quietEnd)) return false;
    return !background.held(b, at);
  }

  /** The sorting run ended: wake the agent with the batch, or let the batch go. */
  finished(run: { id: string; agentId: string; requestedBy: string | null }, result: { finalText: string } | { error: string }, at = new Date()) {
    const { store, watches, background } = this.hub;
    const said = "finalText" in result ? Triage.verdict(result.finalText) : { wake: true, why: "the sort failed" };
    // what it decided stays with the run, for the agent's activity list
    store.db.prepare("UPDATE runs SET note = ? WHERE id = ?").run(`${said.wake ? "yes" : "no"}${said.why ? `: ${said.why}` : ""}`.slice(0, 300), run.id);
    const noted = this.notes.get(run.id);
    this.notes.delete(run.id);
    if (noted) {
      if (!run.requestedBy) return;
      // a no: those notes aren't news any more. A yes that can't start now leaves them for the next look, which sorts again.
      if (!said.wake) return background.notesSeen(run.agentId, run.requestedBy, noted.at);
      if (this.mayWake(run.agentId, run.requestedBy, at)) background.wake(run.agentId, run.requestedBy, [], at, watches.waiting(run.agentId, run.requestedBy));
      return;
    }
    const ids = watches.eventsForRun(run.id).map((e) => e.id);
    if (!said.wake) {
      // seen and judged not worth a check: they stay on record (titles only) like any delivered change
      watches.delivered(run.id);
      return;
    }
    // back in line marked as sorted: whenever the check can start (now, after a pause, tomorrow) they aren't sorted twice
    watches.retry(run.id);
    if (!run.requestedBy || !ids.length) return;
    if (this.mayWake(run.agentId, run.requestedBy, at)) background.wake(run.agentId, run.requestedBy, [], at, ids);
  }
}
