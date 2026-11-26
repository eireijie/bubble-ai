import { afterEach, describe, expect, it, vi } from "vitest";
import type { Computer, ComputerAction } from "@bubble-ai/core";
import { Computers, START_RETRY_MS } from "../src/computers.ts";
import type { Hub } from "../src/hub.ts";

const EAI = "npm error request to https://registry.npmjs.org/@anthropic-ai%2fclaude-code failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org";

/** Computers over a tiny store, with starts that fail or succeed as each test says. */
function setup(kind: Computer["kind"] = "vm") {
  const rows = new Map<string, Computer>();
  const c: Computer = { id: "cmp_1", workspaceId: "w", name: "Shared computer", kind, nodeId: "node", config: {}, status: "stopped", statusText: "", controller: null, help: null, createdAt: "" };
  rows.set(c.id, c);
  const store = {
    // the idle sweep finds no running VMs
    db: { prepare: () => ({ all: () => [] }) },
    computer: (id: string) => rows.get(id),
    updateComputer: (id: string, patch: Partial<Computer>) => rows.set(id, { ...rows.get(id)!, ...patch }),
  };
  const computers = new Computers({ store } as unknown as Hub);
  const starts: number[] = [];
  let outcome: () => Promise<unknown> = async () => {};
  Object.assign(computers, {
    changed: () => {},
    act: (_c: Computer, action: ComputerAction) => {
      if (action.action === "start") starts.push(Date.now());
      return outcome();
    },
  });
  return {
    computers,
    starts,
    now: () => rows.get(c.id)!,
    willFail: (message: string) => (outcome = async () => Promise.reject(new Error(message))),
    willStart: () => (outcome = async () => ({ ok: true })),
  };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

afterEach(() => vi.useRealTimers());

describe("starting a computer after a network hiccup", () => {
  it("waits longer each time, shows it as starting meanwhile, and comes up", async () => {
    vi.useFakeTimers();
    const t = setup();
    t.computers.startRetryMs = [1000, 5000];
    t.willFail(EAI);
    t.computers.startInBackground(t.now());
    await settle();
    expect(t.starts).toHaveLength(1);
    expect(t.now().status).toBe("starting");
    expect(t.now().statusText).toMatch(/Trying again/);

    await vi.advanceTimersByTimeAsync(999);
    expect(t.starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.starts).toHaveLength(2);
    expect(t.now().status).toBe("starting");

    t.willStart();
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.starts).toHaveLength(3);
    expect(t.now().status).toBe("ready");
    expect(t.now().statusText).toBe("");
    t.computers.shutdown();
  });

  it("shows the error once the hiccup outlasts every try, and Try again starts a fresh round at once", async () => {
    vi.useFakeTimers();
    const t = setup();
    t.computers.startRetryMs = [10, 20];
    t.willFail(EAI);
    t.computers.startInBackground(t.now());
    await vi.advanceTimersByTimeAsync(100);
    expect(t.starts).toHaveLength(3);
    expect(t.now().status).toBe("error");
    expect(t.now().statusText).toContain("EAI_AGAIN");
    // nothing more on its own
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.starts).toHaveLength(3);

    t.computers.startInBackground(t.now());
    await settle();
    expect(t.starts).toHaveLength(4);
    expect(t.now().status).toBe("starting");
    t.computers.shutdown();
  });

  it("shows other errors right away, without trying again", async () => {
    vi.useFakeTimers();
    const t = setup();
    t.willFail("no space left on device");
    t.computers.startInBackground(t.now());
    await vi.advanceTimersByTimeAsync(START_RETRY_MS.reduce((a, b) => a + b, 0) + 1000);
    expect(t.starts).toHaveLength(1);
    expect(t.now().status).toBe("error");
    expect(t.now().statusText).toBe("no space left on device");
    t.computers.shutdown();
  });

  it("treats the device's repeated reports of one failure as one, and a demand that fails like a start", async () => {
    vi.useFakeTimers();
    const t = setup();
    t.computers.startRetryMs = [1000, 1000];
    t.willStart();
    // an agent needed it: the device built the image and hit a DNS blip, then said so twice
    t.computers.onStatus("cmp_1", "starting", "Building the VM image (first time only, a few minutes)…");
    expect(t.now().status).toBe("starting");
    t.computers.onStatus("cmp_1", "error", EAI);
    t.computers.onStatus("cmp_1", "error", EAI);
    t.computers.onStatus("cmp_1", "stopped", "");
    expect(t.now().status).toBe("starting");
    expect(t.now().statusText).toMatch(/Trying again/);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.starts).toHaveLength(1);
    await settle();
    expect(t.now().status).toBe("ready");
    t.computers.shutdown();
  });

  it("forgets earlier failures once it's up, so a later hiccup gets every try again", async () => {
    vi.useFakeTimers();
    const t = setup();
    t.computers.startRetryMs = [10];
    t.computers.onStatus("cmp_1", "error", EAI);
    t.computers.onStatus("cmp_1", "ready", "");
    expect(t.now().status).toBe("ready");
    t.computers.onStatus("cmp_1", "error", EAI);
    expect(t.now().status).toBe("starting");
    t.computers.shutdown();
  });
});
