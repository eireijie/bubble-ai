import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@wisp/core";
import type { ComputerInfo } from "../store.ts";
import type { DeviceInfo } from "../devices.ts";

vi.mock("../api.ts", () => ({ api: vi.fn() }));
vi.mock("../theme.ts", () => ({ motionReduced: () => false }));
const { computerTiles, tileStatus, sheetTarget, screenSwitch, askLevel, updateExists, sizeLine, isWatchHash, watchHref, PHONES } = await import("./computerState.ts");

const now = new Date().toISOString();
const device = (id: string, more: Partial<DeviceInfo> = {}): DeviceInfo => ({ id, name: id, online: true, agents: [], ...more });
const computer = (id: string, kind: ComputerInfo["kind"], nodeId: string | null, more: object = {}) => ({ id, name: id, kind, nodeId, online: true, agents: [], controller: null, help: null, activity: null, status: "ready", config: {}, ...more }) as unknown as ComputerInfo;
const agent = (id: string, more: object = {}) => ({ id, name: id, status: "online", nodeId: null, computerId: null, settings: {}, ...more }) as unknown as Agent;
const status = (t: Parameters<typeof tileStatus>[0], agents: Agent[] = []) => tileStatus(t, agents, "me", () => "Sam");

describe("the Computers page: one tile per computer", () => {
  it("makes one flat list: a device and its own screen are one tile, VMs and cloud computers their own, phones last", () => {
    const tiles = computerTiles([device("mac"), device("pc", { online: false })], [computer("screen", "device", "mac"), computer("vm", "vm", "mac"), computer("cloud", "orgo", null)], 2);
    expect(tiles.map((t) => t.key)).toEqual(["d:mac", "c:vm", "c:cloud", "d:pc", PHONES]);
    expect(tiles[0].computer?.id).toBe("screen");
    expect(tiles.map((t) => t.kind)).toEqual(["device", "vm", "cloud", "device", "phone"]);
    expect(tiles.at(-1)?.name).toBe("2 phones");
  });
  it("puts the newest activity first", () => {
    const tiles = computerTiles([device("mac")], [computer("old", "vm", "mac", { activity: { agentId: "a", text: "x", at: "2026-01-01T00:00:00Z" } }), computer("new", "vm", "mac", { activity: { agentId: "a", text: "x", at: "2026-06-01T00:00:00Z" } })], 0);
    expect(tiles.map((t) => t.key)).toEqual(["c:new", "c:old", "d:mac"]);
  });
  it("opens a device at its own address and a computer at its own", () => {
    const [mac, vm] = computerTiles([device("mac")], [computer("vm", "vm", "mac")], 0);
    expect(mac.to).toBe("#/computers/d/mac");
    expect(vm.to).toBe("#/computers/vm");
  });
  it("has no tiles and no phones tile when there is nothing", () => {
    expect(computerTiles([], [], 0)).toEqual([]);
  });
});

describe("a tile's one status line", () => {
  it("names a device's state in a word or two", () => {
    expect(status({ kind: "device", device: device("mac") })).toMatchObject({ text: "Ready", tone: "ok" });
    expect(status({ kind: "device", device: device("mac", { online: false }) }).text).toBe("Offline");
    expect(status({ kind: "device", device: device("mac", { paused: true }) }).text).toBe("Paused");
    expect(status({ kind: "device", device: device("mac", { update: { state: "restarting", message: "" } }) }).text).toBe("Updating");
    expect(status({ kind: "device", device: device("mac", { update: { state: "failed", message: "" } }) })).toMatchObject({ text: "Update failed", tone: "bad" });
    expect(status({ kind: "phone" }).text).toBe("Paired");
  });
  it("says who is working, and hands back that agent for the outline and the ghost", () => {
    const atlas = agent("Atlas", { status: "busy" });
    const s = status({ kind: "vm", computer: computer("vm", "vm", "mac", { agents: ["Atlas"], activity: { agentId: "Atlas", text: "Opening a page", at: now } }) }, [atlas]);
    expect(s).toMatchObject({ text: "Atlas is working", working: true });
    expect(s.agent).toBe(atlas);
    // an agent that runs on the device itself, with no screen
    expect(status({ kind: "device", device: device("mac") }, [agent("Juno", { status: "busy", nodeId: "mac" })])).toMatchObject({ text: "Juno is working", working: true });
  });
  it("says asleep, locked, needs you and who is in control", () => {
    expect(status({ kind: "vm", computer: computer("vm", "vm", "mac", { status: "stopped" }) }).text).toBe("Asleep. Wakes when needed.");
    expect(status({ kind: "device", device: device("mac"), computer: computer("s", "device", "mac", { code: "pin" }) }).text).toBe("Locked");
    expect(status({ kind: "vm", computer: computer("vm", "vm", "mac", { help: { agentId: "Pip", request: "Sign in", at: now } }) }, [agent("Pip")])).toMatchObject({ text: "Pip needs you", tone: "warn" });
    expect(status({ kind: "vm", computer: computer("vm", "vm", "mac", { controller: { kind: "user", id: "me", since: now } }) }).text).toBe("You're in control");
    // offline wins over everything else
    expect(status({ kind: "vm", computer: computer("vm", "vm", "mac", { online: false, help: { agentId: "Pip", request: "x", at: now } }) }).text).toBe("Offline");
  });
});

describe("what an address opens", () => {
  const nodes = [device("mac")];
  const all = [computer("screen", "device", "mac"), computer("vm", "vm", "mac")];
  it("opens a device's sheet with its own screen, from either address", () => {
    expect(sheetTarget({ computerId: null, deviceId: "mac" }, nodes, all, true)).toMatchObject({ key: "d:mac", kind: "device", screen: { id: "screen" } });
    expect(sheetTarget({ computerId: "screen" }, nodes, all, true)).toMatchObject({ key: "d:mac", kind: "device", node: { id: "mac" } });
  });
  it("opens a VM's sheet with the device it lives on, and the phones' sheet", () => {
    expect(sheetTarget({ computerId: "vm" }, nodes, all, true)).toMatchObject({ key: "c:vm", kind: "computer", host: { id: "mac" } });
    expect(sheetTarget({ computerId: PHONES }, nodes, all, true)).toEqual({ key: PHONES, kind: "phones" });
  });
  it("waits for the lists before saying something is gone, and opens nothing for the bare page", () => {
    expect(sheetTarget({ computerId: "nope" }, nodes, all, false)?.kind).toBe("loading");
    expect(sheetTarget({ computerId: "nope" }, nodes, all, true)?.kind).toBe("gone");
    expect(sheetTarget({ computerId: null, deviceId: "mac" }, null, all, true)?.kind).toBe("loading");
    expect(sheetTarget({ computerId: null, deviceId: "nope" }, nodes, all, true)?.kind).toBe("gone");
    expect(sheetTarget({ computerId: null }, nodes, all, true)).toBeNull();
  });
  it("knows the live view's address", () => {
    expect(watchHref("vm")).toBe("#/computers/vm/watch");
    expect(isWatchHash("#/computers/vm/watch")).toBe(true);
    expect(isWatchHash("#/computers/vm")).toBe(false);
    expect(isWatchHash("#/computers/vm/teach/atlas")).toBe(false);
    expect(isWatchHash("#/computers/d/mac")).toBe(false);
  });
});

describe("a computer's sheet, from what the hub has", () => {
  const caps = (screen: object) => ({ screen: { ok: true, detail: "", ...screen } }) as DeviceInfo["capabilities"];
  it("shows the switch on when the device lends its screen or an agent may use it, off when the device has it off", () => {
    const sw = (...args: Parameters<typeof screenSwitch>) => {
      const { users, ...rest } = screenSwitch(...args);
      return { ...rest, users: users.map((a) => a.id) };
    };
    const screen = computer("s", "device", "mac");
    expect(sw(device("mac", { role: "screen", capabilities: caps({}) }), undefined, [])).toEqual({ on: true, there: false, users: [] });
    expect(sw(device("mac", { role: "vms", capabilities: caps({}) }), undefined, [agent("a")])).toEqual({ on: false, there: false, users: [] });
    // watching your own screen makes it a computer, which lends it to nobody
    expect(sw(device("mac", { role: "vms", capabilities: caps({}) }), screen, [agent("a")]).on).toBe(false);
    // an agent works on its screen, or is allowed to use the device, whatever its role says
    expect(sw(device("mac", { role: "vms", capabilities: caps({}) }), screen, [agent("a", { computerId: "s" })])).toEqual({ on: true, there: false, users: ["a"] });
    expect(sw(device("mac", { role: "headless", capabilities: caps({}) }), undefined, [agent("b", { settings: { useDevices: { mac: "ask" } } })])).toEqual({ on: true, there: false, users: ["b"] });
    // turned off at the device: off here, and only the device can change it
    expect(sw(device("mac", { role: "screen", capabilities: caps({ ok: false, off: true }) }), undefined, [])).toEqual({ on: false, there: true, users: [] });
    // offline: nobody knows what the device says now
    expect(sw(device("mac", { online: false, role: "screen", capabilities: caps({ ok: false, off: true }) }), undefined, [])).toEqual({ on: true, there: false, users: [] });
  });
  it("reads the ask level from the agents allowed on the device; asking wins", () => {
    expect(askLevel([agent("a")], "mac")).toEqual({ level: null, agents: [] });
    expect(askLevel([agent("a", { settings: { useDevices: { mac: "tell" } } })], "mac").level).toBe("tell");
    expect(askLevel([agent("a", { settings: { useDevices: { mac: "tell" } } }), agent("b", { settings: { useDevices: { mac: "ask" } } }), agent("c", { settings: { useDevices: { pc: "tell" } } })], "mac")).toMatchObject({ level: "ask", agents: [{ id: "a" }, { id: "b" }] });
  });
  it("offers a Wisp update only when there is one, or when nobody can tell", () => {
    const hub = { version: { commit: "abc" }, check: { behind: 0 } };
    expect(updateExists({ version: { commit: "abc" } }, hub)).toBe(false);
    expect(updateExists({ version: { commit: "old" } }, hub)).toBe(true);
    expect(updateExists({ version: { commit: "abc" } }, { ...hub, check: { behind: 3 } })).toBe(true);
    expect(updateExists({ version: { commit: "abc" }, update: { state: "failed" } }, hub)).toBe(true);
    expect(updateExists({ version: null }, hub)).toBe(true);
    expect(updateExists({ version: { commit: "abc" } }, null)).toBe(true);
  });
  it("says a computer's size", () => {
    expect(sizeLine(computer("vm", "vm", "mac", { config: { cpus: 2, memoryGb: 4 } }))).toBe("2 CPUs, 4 GB");
    expect(sizeLine(computer("c", "orgo", null, { config: { cpu: 1, ram: 4 } }))).toBe("1 CPU, 4 GB");
    expect(sizeLine(computer("s", "device", "mac"))).toBeNull();
  });
});
