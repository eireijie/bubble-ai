import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import type { FastifyInstance } from "fastify";
import { buildHub } from "../src/app.ts";
import type { Hub } from "../src/hub.ts";

let dir: string;
let app: FastifyInstance;
let hub: Hub;
let owner: string;

async function api(method: "GET" | "POST", url: string, payload?: any, token = owner) {
  const response = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });
  expect(response.statusCode).toBe(200);
  return response.json();
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "wisp-team-draft-finish-"));
  ({ app, hub } = await buildHub({ dataDir: dir, setupCode: false }));
  owner = (await api("POST", "/api/setup", { email: "me@example.com", name: "Me", password: "password123", features: "everything" }, "")).token;
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 300));
  await app?.close();
  await fs.rm(dir, { recursive: true, force: true });
});

let n = 0;
/** A drawing agent on a device, and a second agent that must stay out of it. */
async function setup() {
  const i = ++n;
  const { node } = await api("POST", "/api/nodes", { name: `box-${i}` });
  const atlas = await api("POST", "/api/agents", { handle: `atlas${i}`, name: `Atlas ${i}`, harness: "custom", nodeId: node.id });
  const nova = await api("POST", "/api/agents", { handle: `nova${i}`, name: `Nova ${i}`, harness: "custom", nodeId: node.id });
  const socket = Object.assign(new EventEmitter(), { readyState: 1, send: () => {}, terminate: () => {} }) as unknown as WebSocket;
  hub.addNode(socket, node.id, atlas.workspaceId);
  const draft = await api("POST", "/api/team-drafts", { description: "One builds, one reviews", agentId: atlas.id });
  const task = hub.store.task(draft.id)!;
  const run = hub.store.db.prepare("SELECT id FROM runs WHERE trigger_message_id = ?").get(task.threadId) as { id: string };
  hub.store.setRunStatus(run.id, "running");
  const finish = (finalText: string) => socket.emit("message", Buffer.from(JSON.stringify({ type: "run_done", runId: run.id, finalText })));
  const chatter = () => hub.store.messages(task.channelId!, { threadId: task.threadId }).filter((m) => m.author.kind === "agent");
  const reply = JSON.stringify({
    name: "Crew",
    steps: [
      { id: "s1", title: "Build it", agent: atlas.handle, prompt: "Build." },
      { id: "s2", title: "Review it", agent: nova.handle, prompt: "Check.", kind: "review", inputs: ["s1"], sendBackTo: "s1" },
    ],
  });
  return { draft, task, atlas, nova, finish, chatter, socket, reply };
}

describe("an agent that drew a team without calling task_update", () => {
  it("makes the draft ready when its run ends, posts nothing, and doesn't wake the agents it names", async () => {
    const t = await setup();
    expect(hub.store.task(t.task.id)!.status).not.toBe("done");
    t.finish(t.reply);
    const got = await api("GET", `/api/team-drafts/${t.draft.id}`);
    expect(got.status).toBe("ready");
    expect(got.steps).toHaveLength(2);
    expect(hub.store.task(t.task.id)!.status).toBe("done");
    expect(t.chatter()).toHaveLength(0);
    const nova = hub.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE agent_id = ? AND kind IS NULL").get(t.nova.id) as { n: number };
    expect(nova.n).toBe(0);
    t.socket.emit("close");
  });

  it("fails the draft, instead of spinning, when its answer has no readable flowchart", async () => {
    const t = await setup();
    t.finish("Here you go: one builds, one reviews.");
    const got = await api("GET", `/api/team-drafts/${t.draft.id}`);
    expect(got.status).toBe("failed");
    expect(got.problem).toMatch(/flowchart/);
    expect(t.chatter()).toHaveLength(0);
    t.socket.emit("close");
  });
});

describe("any delegated task whose agent just answers", () => {
  it("is finished with the reply as its result, so a team's next step isn't left waiting", async () => {
    const i = ++n;
    const { node } = await api("POST", "/api/nodes", { name: `box-t${i}` });
    const agent = await api("POST", "/api/agents", { handle: `plain${i}`, name: `Plain ${i}`, harness: "custom", nodeId: node.id });
    const socket = Object.assign(new EventEmitter(), { readyState: 1, send: () => {}, terminate: () => {} }) as unknown as WebSocket;
    hub.addNode(socket, node.id, agent.workspaceId);
    const task = await api("POST", "/api/tasks", { to: agent.handle, title: "Draft a plan", brief: "Plan it" });
    const run = hub.store.db.prepare("SELECT id FROM runs WHERE trigger_message_id = ?").get(task.threadId) as { id: string };
    hub.store.setRunStatus(run.id, "running");
    socket.emit("message", Buffer.from(JSON.stringify({ type: "run_done", runId: run.id, finalText: "Here is the plan." })));
    const after = hub.store.task(task.id)!;
    expect(after.status).toBe("done");
    expect(after.result).toBe("Here is the plan.");
    socket.emit("close");
  });
});

