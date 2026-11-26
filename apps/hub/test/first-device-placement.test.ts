import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HarnessAdapter } from "@bubble-ai/adapters";
import { WispClient } from "@bubble-ai/sdk";
import { NodeDaemon } from "../../node/src/daemon.ts";
import { buildHub } from "../src/app.ts";
import type { Hub } from "../src/hub.ts";

let dir: string;
let url: string;
let close: () => Promise<void>;
let daemon: NodeDaemon | undefined;
let owner: WispClient;
let hub: Hub;
let runs = 0;

/** Stands in for Codex: a harness that runs on a device (one connected through MCP never gets one). */
const fake: HarnessAdapter = {
  id: "codex",
  label: "Fake",
  binary: "true",
  async run() {
    runs++;
    return { finalText: "on it", sessionId: "s" };
  },
};

const waitFor = async <T>(fn: () => Promise<T | undefined> | T | undefined, ms = 8000): Promise<T> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out");
};

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "wisp-first-device-"));
  const built = await buildHub({ dataDir: path.join(dir, "hub"), setupCode: false });
  hub = built.hub;
  await built.app.listen({ port: 0, host: "127.0.0.1" });
  url = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
  close = () => built.app.close();
  const setup = await (await fetch(url + "/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "me@example.com", name: "Me", password: "password123", features: "everything" }) })).json();
  owner = new WispClient({ url, token: setup.token });
});

afterAll(async () => {
  daemon?.stop();
  await close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("an agent made before any device (first-run setup)", () => {
  it("gets the first device that connects, and the work it was given runs then", async () => {
    // first-run setup names the agent before the person's computer has joined
    const agent = await owner.request("POST", "/api/agents", { handle: "nova", name: "Nova", harness: "codex", useDefaults: true, greet: "later" });
    expect(agent.nodeId).toBeNull();
    const headless = await owner.request("POST", "/api/agents", { handle: "quiet", name: "Quiet", harness: "codex", useDefaults: true, greet: "later", settings: { headless: true } });
    const dm = await owner.request("POST", `/api/dm/${agent.id}`);
    await owner.send(dm.id, "check my inbox");
    await waitFor(() => hub.store.activeRuns(agent.id).find((r) => hub.store.run(r.id)?.status === "queued"));

    const { node, token } = await owner.request("POST", "/api/nodes", { name: "mac" });
    daemon = new NodeDaemon({ hub: url, token, name: "mac", dir: path.join(dir, "node"), noPrepare: true }, () => {}, { codex: fake });
    daemon.start();
    await waitFor(() => hub.store.agent(agent.id)?.nodeId === node.id);
    await waitFor(() => hub.store.messages(dm.id).find((m) => m.body === "on it"));
    expect(runs).toBe(1);
    // one that was set to work without a device stays as it was
    expect(hub.store.agent(headless.id)!.nodeId).toBeNull();
  }, 20_000);

  it("runs queued work once someone gives an agent a device", async () => {
    const agent = await owner.request("POST", "/api/agents", { handle: "late", name: "Late", harness: "codex" });
    expect(agent.nodeId).toBeNull();
    const dm = await owner.request("POST", `/api/dm/${agent.id}`);
    const before = runs;
    await owner.send(dm.id, "hello?");
    await waitFor(() => hub.store.activeRuns(agent.id).find((r) => hub.store.run(r.id)?.status === "queued"));
    const node = hub.store.nodes(hub.store.agent(agent.id)!.workspaceId)[0];
    await owner.request("PATCH", `/api/agents/${agent.id}`, { nodeId: node.id });
    await waitFor(() => runs > before);
  }, 20_000);
});
