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
});
