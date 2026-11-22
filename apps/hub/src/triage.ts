import { envVar, frameOutside, type AppEvent } from "@wisp/core";
import type { Hub } from "./hub.ts";

/** The device sees sorting as its own conversation (each one starts fresh anyway). */
export const TRIAGE_THREAD = "triage";
/** Kinds that are addressed to the person: always worth a full look, so sorting them would only add a call. */
const DIRECT = /mention|review_requested|assigned|direct|dm\b|invite/i;
/** In a browser check's preview: what to look for, then this, then the lines Wisp saw added (watches.ts). */
const NEW_ON_PAGE = "\n[new on the page]\n";
/** Changes shown to the sorter; the rest ride along with the decision. */
const MAX_LINES = 40;
const MAX_LINE = 260;

/**
 * Sorting changes before a full check. A check wakes the agent with all its tools, its memory and
 * its notes, which costs tens of thousands of tokens whether or not the change mattered. So a batch
 * of changes first goes to the harness's smallest model with a few lines and no tools: is any of
 * this worth waking the agent for? Only a yes starts the check. It fails open: no answer, an answer
 * it can't read, or a failed run all count as yes.
 */
export class Triage {
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

  /**
   * Sort a batch of waiting changes for one agent and person. Returns the sorting run, or null when
   * the batch should go straight to a check (the caller wakes the agent then).
   */
  sort(agentId: string, userId: string, eventIds: string[]): string | null {
    const { store, watches } = this.hub;
    const agent = store.agent(agentId);
    if (!agent || !eventIds.length) return null;
    const marks = eventIds.map(() => "?").join(",");
    const events = store.db.prepare(`SELECT id, watch_id AS watchId, service, kind, item_id AS itemId, title, url, actor, preview, happened_at AS happenedAt FROM app_events WHERE id IN (${marks}) AND run_id IS NULL`).all(...eventIds) as AppEvent[];
    if (!this.worthSorting(events)) return null;
    const channel = store.dmChannel(agent.workspaceId, userId, agentId);
    const runId = store.createRun({ agentId, channelId: channel.id, threadId: null, triggerMessageId: "", hop: 0, requestedBy: userId, kind: "triage" });
    watches.claim(eventIds, runId);
    this.hub.dispatchRun(runId);
    return runId;
  }

  /** The whole prompt of a sorting run: a few lines, nothing about Wisp's tools. */
  prompt(run: { id: string; agentId: string; requestedBy: string | null }): string {
    const { store, watches } = this.hub;
    const agent = store.agent(run.agentId);
    const user = run.requestedBy ? store.user(run.requestedBy) : undefined;
    const name = user ? user.preferredName || user.name : "the person";
    const who = agent?.name ?? "the assistant";
    const b = user ? store.background(run.agentId, user.id) : undefined;
    const events = watches.eventsForRun(run.id);
    const all = run.requestedBy && agent ? watches.list(agent.workspaceId, { agentId: run.agentId, userId: run.requestedBy }) : [];
    const label = new Map(all.map((w) => [w.id, w]));
    const cut = (s: string) => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE - 1)}…` : s);
    const lines: string[] = [];
    for (const e of events.slice(0, MAX_LINES)) {
      const w = label.get(e.watchId);
      if (e.kind === "browser_check") {
        const [lookFor, added] = (e.preview ?? "").split(NEW_ON_PAGE);
        lines.push(`- [${w?.label ?? e.title}] watched for "${cut(lookFor)}". New lines on the page:`, ...(added ?? "").split("\n").filter(Boolean).map((l) => `    ${cut(l)}`));
      } else lines.push(cut(`- [${w?.label ?? e.service}] ${e.kind.replace(/_/g, " ")}: ${e.title}${e.actor ? ` (by ${e.actor})` : ""}${e.preview ? ` — "${e.preview}"` : ""}`));
    }
    const raised = run.requestedBy ? watches.mentions(run.agentId, run.requestedBy).slice(0, 15) : [];
    return [
      `You sort changes for ${who}, an assistant who works for ${name}. Something changed in what ${who} watches. Decide whether ${who} should be woken to look. Waking costs ${name} money, so say yes only when a change plausibly needs ${name}'s attention or is something ${who} was asked to act on. Routine noise (small edits, bots, things ${name} did themself, changes outside what they asked about) is a no.`,
      b?.focus ? `${name} asked ${who} to keep an eye on: ${b.focus}` : `${name} hasn't said what matters most.`,
      raised.length ? `${who} already told ${name} about these (the same thing again is a no, unless something really new happened): ${raised.map((m) => m.about).join("; ")}` : "",
      `The changes${events.length > MAX_LINES ? ` (the first ${MAX_LINES} of ${events.length})` : ""}:`,
      // written by whoever sent them or by a website, never by the person: data, not instructions
      frameOutside("watched apps and websites", lines.join("\n")),
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

  /** The sorting run ended: wake the agent with the batch, or let the batch go. */
  finished(run: { id: string; agentId: string; requestedBy: string | null }, result: { finalText: string } | { error: string }) {
    const { watches, background } = this.hub;
    const ids = watches.eventsForRun(run.id).map((e) => e.id);
    const said = "finalText" in result ? Triage.verdict(result.finalText) : { wake: true, why: "the sort failed" };
    if (!said.wake) {
      // seen and judged not worth a check: they stay on record (titles only) like any delivered change
      watches.delivered(run.id);
      return;
    }
    // marked as sorted, so if the check can't start now (the day's limit came, it's already checking) they aren't sorted twice
    this.hub.store.db.prepare("UPDATE app_events SET sorted = 1 WHERE run_id = ?").run(run.id);
    watches.release(run.id);
    if (!run.requestedBy || !ids.length) return;
    background.wake(run.agentId, run.requestedBy, [], new Date(), ids);
  }
}
