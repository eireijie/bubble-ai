import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { APPLE_APPS, APPLE_SETTINGS_PANES, AppleLocationReport, AppleOp, ApplePlace, ApplePlaceEvent, type AppleApp } from "@wisp/core";
import type { Caller } from "./api.ts";
import { AppleError, isChange } from "./apple.ts";
import type { Hub } from "./hub.ts";

interface Helpers {
  need(req: FastifyRequest, reply: FastifyReply, opts?: { user?: boolean; owner?: boolean; member?: boolean }): Caller | null;
  parse<S extends z.ZodTypeAny>(schema: S, data: unknown, reply: FastifyReply): z.output<S> | null;
  requesterOf(c: Caller): string | null;
  dataDir: string;
}

const level = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const SettingsPatch = z
  .object({
    macNodeId: z.string().max(100).nullable(),
    levels: z.object({ messages: level, contacts: level, calendar: level, reminders: level, location: level }).partial(),
    allAgents: z.boolean(),
    agentIds: z.array(z.string().max(100)).max(500),
    speakUp: z.object({ unanswered: z.boolean(), unansweredFrom: z.array(z.string().trim().min(1).max(200)).max(100), calendar: z.boolean(), reminders: z.boolean(), places: z.boolean() }).partial(),
    iphoneId: z.string().max(200).nullable(),
    places: z.array(ApplePlace).max(20),
  })
  .partial()
  .strict();

const Device = { deviceId: z.string().trim().min(1).max(200), deviceName: z.string().trim().max(80).default("iPhone") };

/**
 * The Apple mod. People see and change Settings → Apple; the iPhone reports location and places;
 * agents read through the apple tools and ask before any change. Nothing answers while the mod is off.
 */
export function registerAppleApi(app: FastifyInstance, hub: Hub, h: Helpers) {
  const { need, parse } = h;
  const apple = hub.apple;
  apple.configure({ dataDir: h.dataDir });

  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof AppleError) return reply.code(err.status).send({ error: err.message });
    throw err;
  };
  const caller = (req: FastifyRequest, reply: FastifyReply, opts?: { owner?: boolean; user?: boolean }) => {
    const c = need(req, reply, opts);
    if (!c) return null;
    if (!apple.on(c.workspaceId)) {
      reply.code(404).send({ error: "The Apple mod is off. Turn it on in Mods." });
      return null;
    }
    return c;
  };

  // --- people --------------------------------------------------------------------------------------

  app.get("/api/apple", async (req, reply) => {
    const c = caller(req, reply, { user: true });
    if (!c) return;
    reply.header("cache-control", "no-store");
    return apple.view(c.workspaceId);
  });

  app.put("/api/apple/settings", async (req, reply) => {
    const c = caller(req, reply, { owner: true });
    if (!c) return;
    const body = parse(SettingsPatch, req.body, reply);
    if (!body) return;
    try {
      apple.save(c.workspaceId, body);
      return apple.view(c.workspaceId);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/apple/mac/permission", async (req, reply) => {
    const c = caller(req, reply, { owner: true });
    if (!c) return;
    const body = parse(z.object({ pane: z.enum(APPLE_SETTINGS_PANES) }), req.body, reply);
    if (!body) return;
    try {
      await apple.requestPermission(c.workspaceId, body.pane);
      return apple.view(c.workspaceId);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/apple/mac/refresh", async (req, reply) => {
    const c = caller(req, reply, { owner: true });
    if (!c) return;
    await apple.refresh(c.workspaceId);
    return apple.view(c.workspaceId);
  });

  app.get("/api/apple/icons/:app", async (req, reply) => {
    const c = caller(req, reply);
    if (!c) return;
    const name = String((req.params as { app: string }).app).replace(/\.png$/, "");
    if (!(APPLE_APPS as readonly string[]).includes(name)) return reply.code(404).send({ error: "no such icon" });
    const png = await apple.icon(c.workspaceId, name as AppleApp).catch(() => null);
    if (!png) return reply.code(404).send({ error: "no icon yet" });
    reply.header("cache-control", "private, max-age=86400");
    return reply.type("image/png").send(png);
  });

  // --- the iPhone ----------------------------------------------------------------------------------

  app.post("/api/apple/location", async (req, reply) => {
    const c = caller(req, reply, { user: true });
    if (!c) return;
    const body = parse(AppleLocationReport.extend(Device), req.body, reply);
    if (!body) return;
    try {
      apple.report(c.workspaceId, c.actor.id, body);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/apple/place-event", async (req, reply) => {
    const c = caller(req, reply, { user: true });
    if (!c) return;
    const body = parse(ApplePlaceEvent.extend({ deviceId: Device.deviceId }), req.body, reply);
    if (!body) return;
    try {
      apple.placeEvent(c.workspaceId, c.actor.id, body);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // --- agents ----------------------------------------------------------------------------------------

  const agentOf = (c: Caller, reply: FastifyReply) => {
    if (c.actor.kind !== "agent") {
      reply.code(403).send({ error: "agents only" });
      return null;
    }
    const agent = hub.store.agent(c.actor.id);
    if (!agent) reply.code(404).send({ error: "agent not found" });
    return agent ?? null;
  };

  /** Which Apple apps this agent may use and how far (an empty object when none). */
  app.get("/api/apple/mine", async (req, reply) => {
    const c = need(req, reply);
    if (!c) return;
    const agent = agentOf(c, reply);
    if (!agent) return;
    return apple.levelsFor(agent);
  });

  /** Read something, or ask to change something (always asked first). */
  app.post("/api/apple/agent", async (req, reply) => {
    const c = caller(req, reply);
    if (!c) return;
    const agent = agentOf(c, reply);
    if (!agent) return;
    const op = parse(AppleOp, req.body, reply);
    if (!op) return;
    if (op.op === "status" || op.op === "request_permission" || op.op === "icons") return reply.code(403).send({ error: "That's for Settings → Apple, not agents." });
    try {
      if (!isChange(op)) return { status: "done", result: await apple.agentRead(agent, op, req.headers["x-wisp-run"]) };
      const r = await apple.agentChange(agent, op, h.requesterOf(c));
      return { status: "asked", approvalId: r.asked, message: `Asked the person: "${r.summary}". End your turn now; you'll get a message with their answer.` };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/apple/agent/location", async (req, reply) => {
    const c = caller(req, reply);
    if (!c) return;
    const agent = agentOf(c, reply);
    if (!agent) return;
    try {
      return await apple.agentLocation(agent, req.headers["x-wisp-run"]);
    } catch (e) {
      return fail(reply, e);
    }
  });
}
