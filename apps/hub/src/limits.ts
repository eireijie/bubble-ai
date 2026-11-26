import { harnessLabel, LIMIT_WAIT_MAX_MINUTES, LIMIT_WAIT_MINUTES, limitProblem, PLAN_RESERVE, planState, providerLabel, type Agent, type PlanUsage } from "@bubble-ai/core";
import type { Hub } from "./hub.ts";
import { agentPolicy } from "./policy.ts";

/** A plan report older than this with no reset time says nothing about now. */
const STALE_PLAN_MS = 6 * 3_600_000;

interface PlanSeen {
  plan?: PlanUsage;
  /** when `plan` was reported */
  seenAt?: string;
  /** the harness said its limit is reached: nothing runs on it until then */
  hitUntil?: string;
  /** limits hit in a row with no reset time given: each one doubles the wait */
  hits?: number;
}

export interface Paused {
  /** when work may go on (ISO); the plan's own reset time, or Bubble AI's guess when it gave none */
  until: string;
  /** the limit is reached (nothing would run anyway), as opposed to Bubble AI leaving the rest of the plan to the person */
  full: boolean;
  /** how full the window is, 0–1, when the harness said */
  used: number | null;
}

/**
 * The person's own AI plan comes first. Each sign-in an agent runs on (a model connection, or a
 * harness's own sign-in on a device) is watched here: how full its windows are, as the harness
 * reports after each run, and whether it said the limit is reached. Work nobody asked for stops at
 * PLAN_RESERVE of a window and waits for its reset; a reached limit stops everything unattended
 * until the time the harness gave. The person hears once, in the agent's chat.
 */
export class Limits {
  private seen = new Map<string, PlanSeen>();

  constructor(private hub: Hub) {}

  /** The sign-in a run of this agent uses: its model connection, or its harness's own sign-in on its device (or in its computer). */
  key(agent: Pick<Agent, "harness" | "nodeId" | "computerId" | "settings">, connectionId?: string | null): string {
    const cid = connectionId ?? agent.settings?.connectionId;
    if (cid) return `connection:${cid}`;
    const inComputer = agent.settings?.runIn === "computer" && agent.computerId;
    return `signin:${inComputer ? agent.computerId : (agent.nodeId ?? "none")}:${agent.harness}`;
  }

  private settingKey = (key: string) => `plan:${key}`;

  private state(workspaceId: string, key: string): PlanSeen {
    const hit = this.seen.get(key);
    if (hit) return hit;
    let s: PlanSeen = {};
    try {
      s = JSON.parse(this.hub.store.setting(workspaceId, this.settingKey(key)) ?? "{}") as PlanSeen;
    } catch {}
    this.seen.set(key, s);
    return s;
  }

  private save(workspaceId: string, key: string, s: PlanSeen) {
    this.seen.set(key, s);
    this.hub.store.setSetting(workspaceId, this.settingKey(key), JSON.stringify(s));
  }

  /** A run reported how full its plan is. */
  planSeen(agent: Agent, connectionId: string | null, plan: PlanUsage, at = new Date()) {
    const key = this.key(agent, connectionId);
    this.save(agent.workspaceId, key, { ...this.state(agent.workspaceId, key), plan, seenAt: at.toISOString() });
  }

  /** A run failed: if the harness said its limit is reached, nothing unattended runs on that sign-in until it resets. */
  runFailed(agent: Agent, connectionId: string | null, error: string, userId: string | null, at = new Date()): Paused | null {
    const tz = (userId && this.hub.store.user(userId)?.timezone) || "UTC";
    const hit = limitProblem(error, at, tz);
    if (!hit) return null;
    const key = this.key(agent, connectionId);
    const was = this.state(agent.workspaceId, key);
    // already waiting, and this failure says nothing new about when: the wait stands (several agents on one sign-in
    // failing together are one limit, not several)
    if (!hit.resetsAt && was.hitUntil && new Date(was.hitUntil).getTime() > at.getTime()) return { until: was.hitUntil, full: true, used: 1 };
    const hits = hit.resetsAt ? 0 : (was.hits ?? 0) + 1;
    const wait = Math.min(LIMIT_WAIT_MAX_MINUTES, LIMIT_WAIT_MINUTES * 2 ** Math.max(0, hits - 1));
    const until = hit.resetsAt ?? new Date(at.getTime() + wait * 60_000).toISOString();
    this.save(agent.workspaceId, key, { ...was, hitUntil: until, hits });
    return { until, full: true, used: 1 };
  }

  /** A run worked on this sign-in: a limit Bubble AI was only guessing at (no reset time given) is over. */
  runWorked(agent: Agent, connectionId: string | null) {
    const key = this.key(agent, connectionId);
    const was = this.state(agent.workspaceId, key);
    if (was.hitUntil || was.hits) this.save(agent.workspaceId, key, { ...was, hitUntil: undefined, hits: 0 });
  }

  /** Why unattended work for this agent waits, or null when it may run. */
  paused(agent: Agent, at = new Date()): Paused | null {
    const s = this.state(agent.workspaceId, this.key(agent));
    if (s.hitUntil && new Date(s.hitUntil).getTime() > at.getTime()) return { until: s.hitUntil, full: true, used: 1 };
    if (!s.plan || !s.seenAt) return null;
    const p = planState(s.plan, at, agentPolicy(this.hub, agent.workspaceId).planReserve / 100);
    if (p.ok || !p.window) return null;
    const seen = new Date(s.seenAt).getTime();
    if (!p.window.resetsAt) {
      // no reset time: believe it for a while, then look again
      if (at.getTime() - seen > STALE_PLAN_MS) return null;
      return { until: new Date(seen + STALE_PLAN_MS).toISOString(), full: p.full, used: p.window.usedFraction };
    }
    return { until: p.window.resetsAt, full: p.full, used: p.window.usedFraction };
  }

  /** Whose plan it is, in words: "Codex" for a harness's own sign-in, the connection's label otherwise. */
  private name(agent: Pick<Agent, "harness"> & Partial<Pick<Agent, "settings">>): string {
    const cid = agent.settings?.connectionId;
    const row = cid ? this.hub.models.row(cid) : undefined;
    return row ? `${providerLabel(row.provider)} (${row.label})` : harnessLabel(agent.harness);
  }

  /** The pause when the limit itself is reached (as opposed to Bubble AI leaving the rest of the plan to the person), or null. */
  reached(agent: Agent, at = new Date()): Paused | null {
    const p = this.paused(agent, at);
    return p?.full ? p : null;
  }

  /**
   * Say once, in the agent's chat with the person, that its background work waits for the plan. Once
   * per pause and sign-in, whichever agent runs into it and however often: harnesses report a reset
   * time that moves by seconds, so the line isn't keyed on the time. It is said again only once that
   * pause is over, or when "leaving you the rest" turns into "the limit is reached".
   */
  say(agent: Agent, userId: string, p: Paused, at = new Date()) {
    const { store } = this.hub;
    const key = `plan-said:${userId}:${this.key(agent)}`;
    let said: { until?: string; full?: boolean } = {};
    try {
      said = JSON.parse(store.setting(agent.workspaceId, key) ?? "{}") as typeof said;
    } catch {}
    const still = !!said.until && new Date(said.until).getTime() > at.getTime();
    if (still && (said.full || !p.full)) {
      // the same pause, maybe with a later end: remember the end, say nothing
      if (p.until > said.until!) store.setSetting(agent.workspaceId, key, JSON.stringify({ until: p.until, full: !!said.full }));
      return;
    }
    store.setSetting(agent.workspaceId, key, JSON.stringify({ until: p.until, full: p.full }));
    const tz = store.user(userId)?.timezone || "UTC";
    const when = new Date(p.until).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz });
    const text = p.full
      ? `${this.name(agent)}'s limit is reached, so background work is paused until it resets (${when}). Nothing is retried before then.`
      : `${this.name(agent)}'s plan is ${Math.round((p.used ?? PLAN_RESERVE) * 100)}% used. Background work is paused until it resets (${when}), so the rest is yours.`;
    const channel = store.dmChannel(agent.workspaceId, userId, agent.id);
    const msg = store.insertMessage({ channelId: channel.id, threadId: null, author: { kind: "user", id: "system" }, body: "", parts: [{ type: "status", text }], hop: 0 });
    this.hub.broadcast(agent.workspaceId, { type: "message", message: msg }, this.hub.audience(channel.id));
  }

  /**
   * Work on a schedule (a routine, a team's schedule) is skipped because the limit is reached: say so
   * where it would have run, once per pause and schedule however often it comes due meanwhile.
   */
  saySkipped(agent: Agent, channelId: string, key: string, userId: string | null, p: Paused, what: string, at = new Date()) {
    const { store } = this.hub;
    const k = `skip-said:${key}`;
    const said = store.setting(agent.workspaceId, k);
    if (said && new Date(said).getTime() > at.getTime()) {
      if (p.until > said) store.setSetting(agent.workspaceId, k, p.until);
      return;
    }
    store.setSetting(agent.workspaceId, k, p.until);
    const tz = (userId && store.user(userId)?.timezone) || "UTC";
    const when = new Date(p.until).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz });
    const msg = store.insertMessage({ channelId, threadId: null, author: { kind: "user", id: "system" }, body: "", parts: [{ type: "status", text: `Skipped ${what}: ${this.name(agent)}'s limit is reached until it resets (${when}). It runs again at its next time after that.` }], hop: 0 });
    this.hub.broadcast(agent.workspaceId, { type: "message", message: msg }, this.hub.audience(channelId));
  }

  /** A failure in plain words when it's the plan's limit: what happened and when it's back. */
  explain(agent: Pick<Agent, "harness"> & Partial<Pick<Agent, "settings">>, error: string, userId: string | null = null, at = new Date()): string | null {
    const tz = (userId && this.hub.store.user(userId)?.timezone) || "UTC";
    const hit = limitProblem(error, at, tz);
    if (!hit) return null;
    const when = hit.resetsAt ? new Date(hit.resetsAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz }) : null;
    return `${this.name(agent)}'s limit is reached${when ? `; it resets ${when}` : ""}. Ask again after that, or switch this agent to another model connection.`;
  }
}
