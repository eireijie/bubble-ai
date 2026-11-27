import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WispClient } from "@bubble-ai/sdk";
import { createWispMcp } from "@bubble-ai/mcp/src/server.ts";
import { buildHub } from "../src/app.ts";
import { defaultDeviceUse } from "../src/device-defaults.ts";
import type { Hub } from "../src/hub.ts";
import { makeRoomFor } from "./room.ts";

vi.setConfig({ testTimeout: 30_000 });

let dir: string;
let hub: Hub;
let url: string;
let close: () => Promise<void>;
let owner: WispClient;
let member: WispClient;
let ownerId: string;
let mac: string;
let memberPc: string;
let before: string;

const screenOn = (nodeId: string, on = true) =>
  hub.store.setNodeCapabilities(nodeId, { platform: "darwin", arch: "arm64", screen: on ? { ok: true, detail: "" } : { ok: false, off: true, detail: "Off" }, vm: { ok: false, detail: "" } });

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "bubble-devdefaults-"));
  const built = await buildHub({ dataDir: path.join(dir, "hub"), setupCode: false });
  hub = built.hub;
  await built.app.listen({ port: 0, host: "127.0.0.1" });
  url = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
  close = () => built.app.close();
  const setup = await (await fetch(url + "/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "me@example.com", name: "Me", password: "password123", features: "everything" }) })).json();
  owner = new WispClient({ url, token: setup.token });
  ownerId = setup.user.id;
  await makeRoomFor(hub, owner, { name: "general" });
  mac = (await owner.request("POST", "/api/nodes", { name: "Me's MacBook" })).node.id;
  await owner.request("POST", "/api/members", { email: "m@example.com", name: "Mem", password: "password123", role: "member" });
  member = new WispClient({ url, token: (await (await fetch(url + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "m@example.com", password: "password123" }) })).json()).token });
  memberPc = (await member.request("POST", "/api/nodes", { name: "Mem's PC" })).node.id;
  before = (await owner.request("POST", "/api/agents", { handle: "early", name: "Early", harness: "custom" })).id;
});

afterAll(async () => {
  await close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("the owner's own computer, usable by default", () => {
  it("isn't, while its screen is off", async () => {
    screenOn(mac, false);
    expect(defaultDeviceUse(hub, mac)).toEqual([]);
    expect(hub.store.agent(before)!.settings.useDevices).toBeUndefined();
  });

  it("is for the owner's agents once the screen turns on, only once per device", async () => {
    const memberAgent = (await member.request("POST", "/api/agents", { handle: "mems", name: "Mems", harness: "custom" })).id;
    screenOn(mac);
    expect(defaultDeviceUse(hub, mac)).toEqual([before]);
    expect(hub.store.agent(before)!.settings.useDevices).toEqual({ [mac]: "tell" });
    // a member's agent never gets the owner's Mac
    expect(hub.store.agent(memberAgent)!.settings.useDevices?.[mac]).toBeUndefined();
    // turned off on its Computer page: stays off
    await owner.request("PATCH", `/api/agents/${before}`, { settings: { useDevices: {} } });
    expect(defaultDeviceUse(hub, mac)).toEqual([]);
    expect(hub.store.agent(before)!.settings.useDevices?.[mac]).toBeUndefined();
  });

  it("a member's own device isn't given to anyone by default", async () => {
    screenOn(memberPc);
    expect(defaultDeviceUse(hub, memberPc)).toEqual([]);
  });

  it("new agents the owner makes get it; a member's don't", async () => {
    const fresh = await owner.request("POST", "/api/agents", { handle: "fresh", name: "Fresh", harness: "custom" });
    expect(fresh.settings.useDevices).toEqual({ [mac]: "tell" });
    // the screen is off again: an agent made now still gets it, the owner already said yes on that Mac
    screenOn(mac, false);
    const later = await owner.request("POST", "/api/agents", { handle: "later", name: "Later", harness: "custom" });
    expect(later.settings.useDevices).toEqual({ [mac]: "tell" });
    screenOn(mac);
    const mems = await member.request("POST", "/api/agents", { handle: "mems2", name: "Mems 2", harness: "custom" });
    expect(mems.settings.useDevices ?? {}).toEqual({});
    // an explicit choice wins
    const none = await owner.request("POST", "/api/agents", { handle: "none", name: "None", harness: "custom", settings: { useDevices: {} } });
    expect(none.settings.useDevices).toEqual({});
  });

  it("an agent with no computer is told about the computers it may use", async () => {
    const fresh = hub.store.agentByHandle(hub.store.firstWorkspace()!.id, "fresh")!;
    expect(fresh.computerId).toBeFalsy();
    const section = hub.computerSection(fresh.id);
    expect(section).toContain("## Computers you can use");
    expect(section).toContain(`"Me's MacBook"`);
    expect(section).toContain("Me hears afterwards");
    expect(section).toContain("(offline now)");
  });

  it("and gets the computer tools, which work on that computer", async () => {
    const fresh = hub.store.agentByHandle(hub.store.firstWorkspace()!.id, "fresh")!;
    const { token } = await owner.request("POST", `/api/agents/${fresh.id}/token`);
    const server = await createWispMcp(new WispClient({ url, token }));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const mcp = new Client({ name: "test", version: "0" });
    await mcp.connect(b);
    try {
      const tools = (await mcp.listTools()).tools;
      const names = tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(["computer_screenshot", "computer_click", "computer_switch"]));
      // no shell or sign-in tools for someone else's computer
      expect(names).not.toContain("computer_run");
      expect(names).not.toContain("computer_ask_human");
      expect(tools.find((t) => t.name === "computer_screenshot")!.description).toContain("Me's MacBook");
      const listed = (await mcp.callTool({ name: "computer_switch", arguments: {} })) as { content: { text: string }[] };
      expect(listed.content[0].text).toContain("Me's MacBook: allowed, tell after (offline)");
      // for the owner's own request, it reaches the Mac (offline in this test)
      const real = hub.currentRun.bind(hub);
      hub.currentRun = ((id: string) => (id === fresh.id ? ({ id: "r1", requestedBy: ownerId, channelId: "x", threadId: null } as never) : real(id))) as typeof hub.currentRun;
      try {
        const shot = (await mcp.callTool({ name: "computer_screenshot", arguments: {} })) as { content: { text: string }[]; isError?: boolean };
        expect(shot.isError).toBe(true);
        expect(shot.content[0].text).toMatch(/offline/);
      } finally {
        hub.currentRun = real;
      }
    } finally {
      await mcp.close();
    }
  });
  it("an older agent nobody is recorded as making doesn't get it where others are in the organization", async () => {
    const ws = hub.store.node(mac)!.workspaceId;
    const old = hub.store.createAgent({ workspaceId: ws, handle: "olden", name: "Olden", harness: "custom", computerId: null, nodeId: null, instructions: "", model: null } as never);
    const second = (await owner.request("POST", "/api/nodes", { name: "Me's iMac" })).node.id;
    screenOn(second);
    expect(defaultDeviceUse(hub, second)).not.toContain(old.id);
    expect(hub.store.agent(old.id)!.settings.useDevices?.[second]).toBeUndefined();
  });

});
