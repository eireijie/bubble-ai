import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildHub } from "../src/app.ts";
import type { Hub } from "../src/hub.ts";

/**
 * Apps added together (Gmail and Calendar from one sign-in) are often saved in the same millisecond.
 * Ordered by time alone, those came out in id order, which is random: the Connected apps list, what an
 * agent is given for a run, and which of two same-named apps gets the "-2" could each come out either
 * way. That is what made app-signin.test.ts fail on CI now and then.
 */

let dir: string;
let base: string;
let hub: Hub;
let close: () => Promise<void>;
let owner: string;

async function api<T = any>(method: string, url: string, body?: unknown, token = owner): Promise<{ status: number; data: T }> {
  const res = await fetch(base + url, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "wisp-connector-order-"));
  const built = await buildHub({ dataDir: dir, setupCode: false });
  hub = built.hub;
  await built.app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
  close = () => built.app.close();
  owner = (await api("POST", "/api/setup", { email: "me@example.com", name: "Me", password: "password123", features: "everything" }, "")).data.token;
});

afterAll(async () => {
  await close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("apps saved in the same millisecond", () => {
  it("stay in the order they were added: in the list, for the agent, and in what its run is given", async () => {
    const agent = (await api("POST", "/api/agents", { handle: "dot", name: "Dot", harness: "custom" })).data;
    const names = ["Gmail", "Google Calendar", "Drive", "Notion", "Linear", "Sentry"];
    for (const name of names) expect((await api("POST", "/api/connectors", { kind: "mcp-http", name, url: `https://${name.toLowerCase().replace(/\s/g, "")}.example/mcp`, agentIds: [agent.id] })).status).toBe(200);
    // one on for every agent, which the query finds another way
    expect((await api("POST", "/api/connectors", { kind: "mcp-http", name: "Everyone's", url: "https://all.example/mcp", allAgents: true })).status).toBe(200);
    const added = [...names, "Everyone's"];
    const slugs = ["gmail", "google-calendar", "drive", "notion", "linear", "sentry", "everyone-s"];

    // as if all seven were saved in one millisecond
    const db = (hub.connectors as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): unknown } } }).db;
    db.prepare("UPDATE connectors SET created_at = ?").run("2026-11-22T00:00:00.000Z");

    expect((await api<{ name: string }[]>("GET", "/api/connectors")).data.map((c) => c.name)).toEqual(added);
    expect(hub.connectors.forAgent(agent.id).map((c) => c.name)).toEqual(added);
    const given = hub.connectors.specsFor(agent.id).map((s) => s.name);
    expect(given.slice(0, 6)).toEqual(slugs.slice(0, 6));
    expect(given).toHaveLength(7);
  });
});
