import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withDetails } from "@bubble-ai/core";
import { buildHub } from "../src/app.ts";
import { ComputerError } from "../src/computers.ts";
import type { Hub } from "../src/hub.ts";

let dir: string;
let base: string;
let hub: Hub;
let token: string;
let close: () => Promise<void>;

async function api(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "wisp-install-"));
  const built = await buildHub({ dataDir: path.join(dir, "hub"), setupCode: false, logger: false });
  hub = built.hub;
  await built.app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
  close = () => built.app.close();
  const setup = await fetch(base + "/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "o@example.com", name: "Owner", password: "password123", features: "everything" }) });
  token = (await setup.json()).token;
});

afterAll(async () => {
  await close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("installing a harness from Settings", () => {
  it("answers with plain words, and npm's output only as details", async () => {
    const { node } = (await api("POST", "/api/nodes", { name: "mac" })).data;
    hub.isNodeOnline = () => true;
    // the device's answer when npm fails (see npmInstall in the node package)
    hub.computers.nodeRequest = (async () => {
      throw new ComputerError(withDetails("Couldn't reach npm from mac. Check its internet and try again.", "npm error code ENOTFOUND\nnpm error network request failed"), 422);
    }) as typeof hub.computers.nodeRequest;
    const r = await api("POST", `/api/nodes/${node.id}/install`, { harness: "codex" });
    expect(r.status).toBe(422);
    expect(r.data).toEqual({ error: "Couldn't reach npm from mac. Check its internet and try again.", details: "npm error code ENOTFOUND\nnpm error network request failed" });
  });

  it("installs Hermes with one tap, and hands over the owner's model connection that doesn't rotate", async () => {
    const { node } = (await api("POST", "/api/nodes", { name: "box" })).data;
    hub.isNodeOnline = () => true;
    const me = { id: hub.store.node(node.id)!.ownerId! };
    const ws = hub.store.node(node.id)!.workspaceId;
    const sent: any[] = [];
    hub.computers.nodeRequest = (async (_id: string, make: (requestId: string) => unknown, timeoutMs: number) => {
      sent.push({ msg: make("rq"), timeoutMs });
      return { output: "Hermes v2026.9.24 is installed.", connected: "Anthropic key" };
    }) as typeof hub.computers.nodeRequest;
    // only a ChatGPT sign-in: Hermes would renew it in ~/.hermes and the hub's copy would stop working
    hub.models.create({ workspaceId: ws, userId: me.id, provider: "openai", kind: "oauth", label: "ChatGPT", secret: { auth: { tokens: { access_token: "a", refresh_token: "r" } } } });
    let r = await api("POST", `/api/nodes/${node.id}/install`, { harness: "hermes" });
    expect(r.status).toBe(200);
    expect(sent[0].msg).toEqual({ type: "install_harness", requestId: "rq", harness: "hermes" });
    expect(sent[0].timeoutMs).toBeGreaterThan(16 * 60_000);
    // a key goes along, so Hermes is ready without `hermes setup`
    const key = hub.models.create({ workspaceId: ws, userId: me.id, provider: "anthropic", kind: "key", label: "Anthropic", secret: { key: "sk-ant-api-1" } });
    hub.models.models = (async () => []) as typeof hub.models.models;
    r = await api("POST", `/api/nodes/${node.id}/install`, { harness: "hermes" });
    expect(r.data).toEqual({ output: "Hermes v2026.9.24 is installed.", connected: "Anthropic key" });
    expect(sent[1].msg).toMatchObject({ type: "install_harness", harness: "hermes", credential: { connectionId: key, provider: "anthropic", kind: "key", secret: { key: "sk-ant-api-1" } } });
    // npm harnesses never carry a connection
    await api("POST", `/api/nodes/${node.id}/install`, { harness: "codex" });
    expect(sent[2].msg).toEqual({ type: "install_harness", requestId: "rq", harness: "codex" });
    // and a harness with only a copy-and-paste command is still refused
    r = await api("POST", `/api/nodes/${node.id}/install`, { harness: "goose" });
    expect(r.status).toBe(400);
    expect(sent).toHaveLength(3);
  });

  it("offers Install in the chat when Hermes isn't on the device", () => {
    const agent = { harness: "hermes", computerId: null, settings: {} as any, nodeId: "n1" };
    const run = { id: "r1", triggerMessageId: "m1", discussionId: null };
    expect(hub.failurePart(agent as any, run as any, { error: "spawn hermes ENOENT" })).toMatchObject({ reason: "not_installed", fix: "install", harness: "hermes", nodeId: "n1" });
    expect(hub.failurePart({ ...agent, harness: "goose" } as any, run as any, { error: "spawn goose ENOENT" })).not.toHaveProperty("fix");
  });
});
