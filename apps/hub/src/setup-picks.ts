import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { CONNECTOR_CATALOG, type Agent, type CatalogConnector, type ConnectSuggestion, type MessagePart } from "@bubble-ai/core";
import type { Caller } from "./api.ts";
import type { Hub } from "./hub.ts";

/**
 * "Make it yours", then the agent picks the apps (2026-11-27, round 7). The first run sends what the
 * person picked and wrote about themselves to the agent as their first message (POST
 * /api/agents/:id/setup-picks). The agent answers in its own words and suggests apps to connect with
 * connect_suggest (POST /api/connect-suggest), which puts a card under its reply with a one-tap
 * Connect on each. Composio is in every suggestion. When the agent can't answer (no device, not
 * signed in, the run fails) or answers without suggesting any, Bubble AI's own short list goes
 * instead, so the person always gets one.
 */

/** At most this many apps in one suggestion, besides the always-recommended ones. */
export const SUGGEST_MAX = 5;

/** The catalog apps that connect with one tap (their own sign-in page): the ones an agent can suggest. */
export const suggestable = (): CatalogConnector[] => CONNECTOR_CATALOG.filter((c) => c.signIn);

/** The apps in every suggestion (Composio). */
const alwaysRecommended = () => CONNECTOR_CATALOG.filter((c) => c.signIn && c.recommended);

/**
 * A suggestion as the card shows it: the always-recommended ones first with their own line, then
 * what was asked for, each once, only apps that connect with one tap. Unknown ids are left out.
 */
export function suggestion(wanted: { id: string; why?: string }[]): { apps: ConnectSuggestion[]; unknown: string[] } {
  const always = alwaysRecommended();
  const apps: ConnectSuggestion[] = always.map((c) => ({ id: c.id, name: c.name, why: c.recommended!, recommended: true }));
  const unknown: string[] = [];
  for (const w of wanted) {
    const id = w.id.trim().toLowerCase();
    const c = suggestable().find((x) => x.id === id);
    if (!c) {
      unknown.push(w.id);
      continue;
    }
    if (apps.some((a) => a.id === c.id)) continue;
    if (apps.length - always.length >= SUGGEST_MAX) break;
    apps.push({ id: c.id, name: c.name, why: (w.why?.trim() || c.description).replace(/\s+/g, " ").slice(0, 140) });
  }
  return { apps, unknown };
}

/**
 * Bubble AI's own suggestion when the agent gives none: the apps that usually help with each pick
 * (the Make it yours ids), with a plain line on each. A fallback only; the agent's own choice wins.
 */
const FALLBACK: Record<string, { id: string; why: string }[]> = {
  days: [{ id: "gcal", why: "So I can see your day and spot clashes." }],
  msgs: [
    { id: "gmail", why: "So I can tell you which emails need you." },
    { id: "slack", why: "So I can catch messages that need a reply." },
  ],
  people: [{ id: "gcal", why: "So I can remember birthdays and plans with people." }],
  plans: [
    { id: "gcal", why: "So I can plan around what's already booked." },
    { id: "gmail", why: "So I can find bookings and confirmations." },
  ],
  money: [{ id: "gmail", why: "So I can spot bills and due dates." }],
  health: [{ id: "gcal", why: "So I can fit workouts and sleep around your day." }],
  business: [
    { id: "gmail", why: "So I can tell you which customers wrote in." },
    { id: "stripe", why: "So I can keep an eye on payments and orders." },
    { id: "slack", why: "So I can follow what your team is saying." },
  ],
  learn: [
    { id: "notion", why: "So I can keep what you're learning in your notes." },
    { id: "github", why: "So I can follow the things you're building." },
  ],
};

export function fallbackSuggestion(goals: readonly string[]): ConnectSuggestion[] {
  return suggestion(goals.flatMap((g) => FALLBACK[g] ?? [])).apps;
}

export const FALLBACK_TEXT = "Thanks, that helps! Here's what I'd connect for that. Tap Connect on any of them, or skip them for now and tell me what to start on.";

/** The setup's picks message, while it's waiting on an answer. */
const waiting = (agent: Agent | undefined, triggerMessageId: string | null | undefined) => {
  const p = agent?.settings.setup?.picks;
  return p && !p.answered && triggerMessageId && p.messageId === triggerMessageId ? p : null;
};

function markAnswered(hub: Hub, agentId: string) {
  const s = hub.store.agent(agentId)?.settings.setup;
  if (s?.picks) hub.store.updateAgent(agentId, { settings: { setup: { ...s, picks: { ...s.picks, answered: true } } } });
}

/** Post Bubble AI's own answer to the picks, in the agent's name. */
function postFallback(hub: Hub, agent: Agent, channelId: string, goals: readonly string[]) {
  hub.postMessage({ channelId, author: { kind: "agent", id: agent.id }, body: FALLBACK_TEXT, parts: [{ type: "connect", apps: fallbackSuggestion(goals) }], route: false });
  markAnswered(hub, agent.id);
}

/**
 * A run ended (hub.finishRun, after Loops has put its cards under the reply). When it was the answer
 * to the picks: a reply with no apps gets Bubble AI's list under it; no reply at all (it failed) gets
 * Bubble AI's whole answer.
 */
export function picksRunEnded(hub: Hub, run: { agentId: string; channelId: string; triggerMessageId: string | null }, replyId: string | null) {
  const { store } = hub;
  const agent = store.agent(run.agentId);
  const p = waiting(agent, run.triggerMessageId);
  if (!agent || !p) return;
  const reply = replyId ? store.message(replyId) : undefined;
  if (!reply || reply.deletedAt) return postFallback(hub, agent, run.channelId, p.goals);
  if (!reply.parts.some((x) => x.type === "connect")) {
    const parts: MessagePart[] = [...reply.parts, { type: "connect", apps: fallbackSuggestion(p.goals) }];
    store.db.prepare("UPDATE messages SET parts_json = ? WHERE id = ?").run(JSON.stringify(parts), reply.id);
    hub.broadcast(agent.workspaceId, { type: "message_updated", message: store.withReactions([{ ...reply, parts }])[0] }, hub.audience(reply.channelId));
  }
  markAnswered(hub, agent.id);
}

/** The prompt lines for the reply to the picks: what to do with them. Empty when it isn't that reply. */
export function picksSection(agent: Agent, triggerMessageId: string | null | undefined, personName: string): string {
  if (!waiting(agent, triggerMessageId)) return "";
  const apps = suggestable().filter((c) => !c.recommended);
  return [
    `## ${personName}'s picks from setup`,
    `${personName}'s message above came from the setup screen: what they'd like help with, and anything they wrote about themselves. That's the goal step: record it with setup_step goal. In this reply, say in a line or two what you'll help with, in your own voice and in the style they picked. Then pick the apps that would help most with what they said (one to four, only ones that fit) and call connect_suggest with them, each with a short, friendly reason (under 12 words). A card with a one-tap Connect on each shows under your reply, so don't paste links or explain how to connect. Composio is added to every suggestion for you (it brings hundreds more apps with an easy sign-in), so don't list it yourself; you may mention it in a few words. End with one short question about what to start on. Don't ask the other setup questions in this reply.`,
    `Apps that connect with one tap (id: name, what it is): ${apps.map((c) => `${c.id}: ${c.name}`).join("; ")}.`,
  ].join("\n");
}

interface Helpers {
  need(req: FastifyRequest, reply: FastifyReply, opts?: { owner?: boolean; user?: boolean; member?: boolean }): Caller | null;
  parse<S extends z.ZodTypeAny>(schema: S, data: unknown, reply: FastifyReply): z.output<S> | null;
}

/** Make it yours' ids, as the web sends them. */
const GOAL_IDS = ["days", "msgs", "people", "plans", "money", "health", "business", "learn"] as const;

/**
 * POST /api/agents/:id/setup-picks { text, goals } → { messageId, channelId, answered }: the person's
 * picks go to the agent in their DM, as their message. Its creator only, once per agent.
 * POST /api/connect-suggest { apps: [{ id, why }] }: the agent suggests apps to connect (MCP
 * connect_suggest); they show under its reply.
 */
export function registerSetupPicksApi(app: FastifyInstance, hub: Hub, h: Helpers) {
  app.post("/api/agents/:id/setup-picks", async (req, reply) => {
    const c = h.need(req, reply, { user: true });
    if (!c) return;
    const { store } = hub;
    const agent = store.agent((req.params as { id: string }).id);
    if (!agent || agent.workspaceId !== c.workspaceId) return reply.code(404).send({ error: "agent not found" });
    if (agent.settings.createdBy !== c.actor.id) return reply.code(403).send({ error: "only whoever made this agent can send its setup picks" });
    const body = h.parse(z.object({ text: z.string().trim().min(1).max(2000), goals: z.array(z.enum(GOAL_IDS)).max(GOAL_IDS.length) }).strict(), req.body, reply);
    if (!body) return;
    if (agent.settings.setup?.picks) return reply.code(409).send({ error: "already sent" });
    const dm = store.dmChannel(agent.workspaceId, c.actor.id, agent.id);
    // can it answer now? if not, Bubble AI's own answer goes right away instead of a reply that never comes
    const cant = !hub.agentAvailable(agent) || !!hub.signInNeeded(agent) || !!hub.connectionWithheld(agent) || !!hub.whyNotAllowed(agent, c.actor.id) || hub.limits.reached(agent);
    const msg = hub.postMessage({ channelId: dm.id, author: { kind: "user", id: c.actor.id }, body: body.text, route: false });
    const s = store.agent(agent.id)!.settings.setup;
    if (s) store.updateAgent(agent.id, { settings: { setup: { ...s, picks: { messageId: msg.id, goals: body.goals } } } });
    if (cant || !s) {
      postFallback(hub, store.agent(agent.id)!, dm.id, body.goals);
      return { messageId: msg.id, channelId: dm.id, answered: true };
    }
    hub.route(msg, agent.workspaceId, false, c.actor.id);
    return { messageId: msg.id, channelId: dm.id, answered: false };
  });

  app.post("/api/connect-suggest", async (req, reply) => {
    const c = h.need(req, reply);
    if (!c) return;
    if (c.actor.kind !== "agent") return reply.code(403).send({ error: "agents only" });
    const body = h.parse(z.object({ apps: z.array(z.object({ id: z.string().max(100), why: z.string().max(300).optional() })).max(20) }).strict(), req.body, reply);
    if (!body) return;
    const run = hub.runFor(c.actor.id, req.headers["x-wisp-run"]);
    if (!run) return reply.code(409).send({ error: "only while answering someone" });
    const { apps, unknown } = suggestion(body.apps);
    hub.loops.queue(run.id, { type: "connect", apps });
    return { shown: apps.map((a) => a.id), unknown, valid: unknown.length ? suggestable().map((x) => x.id) : undefined };
  });
}
