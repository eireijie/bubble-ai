import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { WispClient } from "@wisp/sdk";
import { buildHub } from "../src/app.ts";

let dir: string;
let url: string;
let close: () => Promise<void>;
let owner: WispClient;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "wisp-lastseen-"));
  const built = await buildHub({ dataDir: path.join(dir, "hub"), setupCode: false });
  await built.app.listen({ port: 0, host: "127.0.0.1" });
  url = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
  close = () => built.app.close();
  const setup = await (await fetch(url + "/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "me@example.com", name: "Me", password: "password123", features: "everything" }) })).json();
  owner = new WispClient({ url, token: setup.token });
});

afterAll(async () => {
  await close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("a device's last seen time", () => {
  it("is when it went away, not when it last said hello", async () => {
    const made = await owner.request("POST", "/api/nodes", { name: "Mac" });
    const ws = new WebSocket(url.replace("http", "ws") + "/ws/node", { headers: { authorization: `Bearer ${made.token}` } });
    await new Promise<void>((resolve, reject) => {
      ws.on("message", (raw) => {
        if (JSON.parse(raw.toString()).type === "welcome") {
          ws.send(JSON.stringify({ type: "hello", nodeName: "Mac", agents: [] }));
          resolve();
        }
      });
      ws.on("error", reject);
    });
    const seenAtHello = async () => (await owner.request("GET", "/api/nodes")).find((n: { id: string }) => n.id === made.node.id).lastSeen as string;
    await new Promise((r) => setTimeout(r, 50));
    const hello = await seenAtHello();
    await new Promise((r) => setTimeout(r, 1100));
    ws.close();
    for (let i = 0; i < 40 && (await seenAtHello()) === hello; i++) await new Promise((r) => setTimeout(r, 50));
    expect(Date.parse(await seenAtHello())).toBeGreaterThan(Date.parse(hello));
  });
});
