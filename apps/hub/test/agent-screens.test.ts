import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ComputerAction, ComputerSpec, DeviceCapabilities, VmConfig } from "@bubble-ai/core";
import { WispClient } from "@bubble-ai/sdk";
import { ComputerHost } from "../../node/src/computers/index.ts";
import type { Driver } from "../../node/src/computers/driver.ts";
import { NodeDaemon } from "../../node/src/daemon.ts";
import { buildHub } from "../src/app.ts";
import type { Hub } from "../src/hub.ts";

const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

/** What reached the device: each action, and whose screen it was for. */
const calls: { action: string; screen?: string }[] = [];
/** how long a click takes on the fake screen (two agents clicking at once overlap) */
let clickMs = 0;

function fakeVm(): Driver {
  const ok = async () => {};
  return {
    label: "fake",
    screenSize: async () => ({ width: 1280, height: 800 }),
    screenshot: async () => ({ jpeg: JPEG, width: 1280, height: 800 }),
    move: ok,
    click: async () => void (await new Promise((r) => setTimeout(r, clickMs))),
    mouse: ok,
    drag: ok,
    scroll: ok,
    type: ok,
    key: ok,
    open: ok,
    start: ok,
    stop: ok,
    status: async () => ({ status: "ready", detail: "" }),
  };
}

class FakeHost extends ComputerHost {
  private fake = fakeVm();
  async capabilities(): Promise<DeviceCapabilities> {
    return { platform: "linux", arch: "x64", screen: { ok: false, detail: "none" }, vm: { ok: true, detail: "fake" } };
  }
  async driver(_spec: ComputerSpec): Promise<Driver> {
    return this.fake;
  }
  async act(spec: ComputerSpec, action: ComputerAction, screen?: string) {
    calls.push({ action: action.action, screen });
    return super.act(spec, action, screen);
  }
}

let dir: string;
let hub: Hub;
let close: () => Promise<void>;
let daemon: NodeDaemon;
let owner: WispClient;
let nova: { id: string; api: WispClient };
let pip: { id: string; api: WispClient };
let computerId: string;
let ownerId: string;
let ownerToken: string;
/** a picture of the screen, as the page asks for it */
const shot = (query: string) => fetch(`${owner.url}/api/computers/${computerId}/screen?${query}`, { headers: { authorization: `Bearer ${ownerToken}` } });

const waitFor = async <T>(fn: () => Promise<T | undefined> | T | undefined, ms = 5000): Promise<T> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out");
};

/** What the device says about the shared computer's agents' screens. */
const report = (supported: boolean, agents: string[]) => (daemon as unknown as { send: (m: unknown) => void }).send({ type: "agent_screens", computerId, supported, agents });

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "bubble-screens-"));
  const built = await buildHub({ dataDir: path.join(dir, "hub"), setupCode: false });
  hub = built.hub;
  await built.app.listen({ port: 0, host: "127.0.0.1" });
  const url = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
  close = () => built.app.close();
  const setup = await (await fetch(url + "/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "me@example.com", name: "Me", password: "password123", features: "everything" }) })).json();
  owner = new WispClient({ url, token: setup.token });
  ownerId = setup.user.id;
  ownerToken = setup.token;
  const created = await owner.request("POST", "/api/nodes", { name: "box" });
  const nodeId = created.node.id;
  const comp = await owner.request("POST", "/api/computers", { name: "Shared", kind: "vm", nodeId });
  computerId = comp.id;
  // the shared computer every agent works on
  hub.store.updateComputer(computerId, { config: { ...(hub.store.computer(computerId)!.config as VmConfig), shared: true }, status: "ready" });
  const make = async (handle: string) => {
    const a = await owner.request("POST", "/api/agents", { handle, name: handle, harness: "custom", nodeId, computerId });
    return { id: a.id as string, api: new WispClient({ url, token: (await owner.request("POST", `/api/agents/${a.id}/token`)).token }) };
  };
  nova = await make("nova");
  pip = await make("pip");
  const nodeDir = path.join(dir, "node");
  daemon = new NodeDaemon({ hub: url, token: created.token, name: "box", dir: nodeDir, noPrepare: true }, () => {}, {}, new FakeHost({ dir: nodeDir }));
  daemon.start();
  await waitFor(() => hub.isNodeOnline(nodeId));
});

afterAll(async () => {
  daemon?.stop();
  await close();
  await fs.rm(dir, { recursive: true, force: true });
});

const computer = () => hub.store.computer(computerId)!;

describe("each agent's own screen on the shared computer", () => {
  it("takes turns on one screen while the computer hasn't said it has screens of their own (an older image)", async () => {
    expect(hub.computers.view(computer()).screens).toBeUndefined();
    const real = hub.currentRun.bind(hub);
    hub.currentRun = ((id: string) => (id === nova.id ? ({ id: "run-x" } as never) : real(id))) as typeof hub.currentRun;
    try {
      await hub.computers.takeScreen(computer(), nova.id);
      await expect(hub.computers.takeScreen(computer(), pip.id, 300)).rejects.toThrow(/@nova is using/);
    } finally {
      hub.currentRun = real;
    }
  });

  it("lets agents work at the same time once each has its own screen, each on its own", async () => {
    report(true, []);
    await waitFor(() => hub.computers.view(computer()).screens);
    calls.length = 0;
    clickMs = 400;
    const real = hub.currentRun.bind(hub);
    // both are mid-task: on one screen the second would wait for the first
    hub.currentRun = ((id: string) => ({ id: `run-${id}` }) as never) as typeof hub.currentRun;
    try {
      const t0 = Date.now();
      await Promise.all([nova.api.request("POST", "/api/computers/mine/act", { action: { action: "click", x: 1, y: 1 } }), pip.api.request("POST", "/api/computers/mine/act", { action: { action: "click", x: 2, y: 2 } })]);
      // side by side, not one after the other
      expect(Date.now() - t0).toBeLessThan(800);
    } finally {
      hub.currentRun = real;
      clickMs = 0;
    }
    expect(calls.filter((c) => c.action === "click").map((c) => c.screen).sort()).toEqual([nova.id, pip.id].sort());
  });

  it("shows which agents have a screen up", async () => {
    report(true, [nova.id]);
    await waitFor(() => hub.computers.view(computer()).screens?.length === 1);
    expect(hub.computers.view(computer()).screens).toEqual([nova.id]);
    const listed = (await owner.request("GET", "/api/computers")) as { id: string; screens?: string[] }[];
    expect(listed.find((c) => c.id === computerId)?.screens).toEqual([nova.id]);
  });

  it("serves an agent's own screen as a picture, without starting one that isn't up", async () => {
    calls.length = 0;
    const res = await shot(`agent=${nova.id}`);
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ action: "screenshot", screen: nova.id }]);
    // Pip's screen isn't up: no picture, and nothing asked of the device
    const idle = await shot(`agent=${pip.id}`);
    expect(idle.status).toBe(409);
    expect(calls).toHaveLength(1);
    // only agents on this computer
    const stranger = await shot(`agent=agt_nobody`);
    expect(stranger.status).toBe(404);
  });

  it("opens a live view of the agent's own screen", async () => {
    const sent: unknown[] = [];
    const orig = hub.sendToNode.bind(hub);
    hub.sendToNode = ((nodeId: string, msg: unknown) => (sent.push(msg), orig(nodeId, msg as never))) as typeof hub.sendToNode;
    try {
      const view = (await owner.request("POST", `/api/computers/${computerId}/view`, { agent: pip.id })) as { url: string };
      const ticket = new URL(view.url, "http://x").searchParams.get("ticket")!;
      const t = hub.computers.redeem(ticket, computerId)!;
      expect(t.screen).toBe(pip.id);
      const socket = { on: () => {}, close: () => {}, readyState: 1 } as never;
      hub.computers.openTunnel(computer(), socket, t.code, t.screen);
      expect(sent).toContainEqual(expect.objectContaining({ type: "tunnel_open", screen: pip.id }));
      await expect(owner.request("POST", `/api/computers/${computerId}/view`, { agent: "agt_nobody" })).rejects.toThrow(/doesn't use this computer/);
    } finally {
      hub.sendToNode = orig;
    }
  });

  it("types on the agent's screen a person picked", async () => {
    calls.length = 0;
    hub.computers.take(computer(), ownerId);
    await owner.request("POST", `/api/computers/${computerId}/act`, { action: { action: "type", text: "hi" }, agent: pip.id });
    hub.computers.release(computer(), ownerId);
    expect(calls).toEqual([{ action: "type", screen: pip.id }]);
  });

  it("goes back to one screen when the computer says so (stopped, or an older image)", async () => {
    report(false, []);
    await waitFor(() => hub.computers.view(computer()).screens === undefined);
    // the picture of an agent's screen is then the computer's one screen
    calls.length = 0;
    const res = await shot(`agent=${pip.id}&maxAge=1000`);
    expect(res.status).toBe(200);
  });
});
