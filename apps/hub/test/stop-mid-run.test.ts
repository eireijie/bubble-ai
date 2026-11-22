import { expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { buildHub } from "../src/app.ts";

// The hub stops (the app quits, a test file ends) while a run's request is still being prepared.
// What was being prepared finishes afterwards, with the database already closed: it must drop the
// run quietly. An error nobody catches there ends the hub's process with a failure instead of a
// clean stop, and fails a test run whose tests all passed.
it("drops a run that was still being prepared when the hub stopped", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wisp-hub-stop-"));
  const { app, hub } = await buildHub({ dataDir: dir, setupCode: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const api = async (method: string, url: string, body: unknown, auth: string) => {
    const res = await fetch(base + url, { method, headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });
    return (await res.json()) as any;
  };
  const unhandled: unknown[] = [];
  const seen = (err: unknown) => unhandled.push(err);
  let stopped = false;
  try {
    const token = (await api("POST", "/api/setup", { email: "me@example.com", name: "Alex", password: "password123", features: "everything", workspaceName: "Test" }, "")).token;
    const device = await api("POST", "/api/nodes", { name: "box" }, token);
    const agents = [];
    for (const handle of ["atlas", "nova"]) agents.push(await api("POST", "/api/agents", { handle, name: handle, harness: "codex", nodeId: device.node.id }, token));
    const ws = new WebSocket(base.replace("http", "ws") + "/ws/node", { headers: { authorization: `Bearer ${device.token}` } });
    await new Promise<void>((resolve, reject) => {
      ws.on("message", (raw) => JSON.parse(raw.toString()).type === "welcome" && resolve());
      ws.on("error", reject);
    });

    // both agents get work; each request is still being built when the hub stops
    const building: { resolve: (prompt: string) => void; reject: (err: Error) => void }[] = [];
    const bothBuilding = new Promise<void>((done) => {
      hub.buildPrompt = () =>
        new Promise<string>((resolve, reject) => {
          building.push({ resolve, reject });
          if (building.length === agents.length) done();
        });
    });
    for (const a of agents) await api("POST", "/api/tasks", { to: a.handle, title: "Say hi", brief: "hi" }, token);
    await bothBuilding;

    process.on("unhandledRejection", seen);
    ws.close();
    await app.close();
    stopped = true;
    // one request is ready after the stop, the other couldn't be built
    building[0].resolve("a prompt");
    building[1].reject(new Error("the vault couldn't be read"));
    // an error nobody caught is reported once the turn it happened in is over
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", seen);
    if (!stopped) await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}, 30_000);
