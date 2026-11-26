import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../theme.ts", () => ({ motionReduced: () => false, useMotionReduced: () => false }));
const { stripPlaces, shortcutTarget, homeChat, rememberChat } = await import("./Rail.tsx");

const base = { guest: false, tasks: true, code: true, computersOn: 0, notes: null, newNotes: false, open: null, vaultTo: "#/vault" };

describe("the sidebar's strip of places (canvas \"Calmer layout\", A1)", () => {
  it("is Computers, Memory, Apps and skills, Tasks and Code, ⌘1 to ⌘5", () => {
    const strip = stripPlaces(base);
    expect(strip.map((p) => [p.label, p.shortcut])).toEqual([
      ["Computers", 1],
      ["Memory", 2],
      ["Apps and skills", 3],
      ["Tasks", 4],
      ["Code", 5],
    ]);
    expect(strip.map((p) => p.to)).toEqual(["#/computers", "#/vault", "#/marketplace", "#/tasks", "#/code"]);
  });

  it("leaves out Code while its mod is off, and sends Tasks to its mod while that is off", () => {
    const strip = stripPlaces({ ...base, tasks: false, code: false });
    expect(strip.map((p) => p.label)).toEqual(["Computers", "Memory", "Apps and skills", "Tasks"]);
    const tasks = strip.find((p) => p.key === "tasks")!;
    expect(tasks.to).toBe("#/marketplace/app/m%3Atasks");
    expect(tasks.count).toBe("Off");
  });

  it("gives guests Memory alone", () => {
    expect(stripPlaces({ ...base, guest: true }).map((p) => p.label)).toEqual(["Memory"]);
  });

  it("says counts in the tooltip and shows a dot only for a computer that's on or notes that are new", () => {
    const quiet = stripPlaces({ ...base, notes: 5 });
    expect(quiet.find((p) => p.key === "memory")).toMatchObject({ count: "5 notes", dot: null });
    expect(quiet.find((p) => p.key === "computers")).toMatchObject({ count: null, dot: null });
    const busy = stripPlaces({ ...base, notes: 1, newNotes: true, computersOn: 2 });
    expect(busy.find((p) => p.key === "memory")).toMatchObject({ count: "1 note", dot: "new" });
    expect(busy.find((p) => p.key === "computers")).toMatchObject({ count: "2 on", dot: "on" });
  });

  it("marks the place whose pop-up is open", () => {
    const on = (open: Parameters<typeof stripPlaces>[0]["open"]) => stripPlaces({ ...base, open }).filter((p) => p.on).map((p) => p.key);
    expect(on({ view: "computers", computerId: null })).toEqual(["computers"]);
    expect(on({ view: "vault", path: "shared/a.md" })).toEqual(["memory"]);
    expect(on({ view: "marketplace", app: "b:gmail" })).toEqual(["apps"]);
    expect(on({ view: "skills" })).toEqual(["apps"]);
    expect(on({ view: "chat", channelId: "c1", threadId: null })).toEqual([]);
  });

  it("maps ⌘1 to ⌘5 to the same places, and to nothing that isn't there", () => {
    const flags = { guest: false, tasks: true, code: true };
    expect([1, 2, 3, 4, 5].map((n) => shortcutTarget(n, flags))).toEqual(["#/computers", "#/vault", "#/marketplace", "#/tasks", "#/code"]);
    expect(shortcutTarget(5, { ...flags, code: false })).toBeNull();
    expect(shortcutTarget(1, { ...flags, guest: true })).toBeNull();
    expect(shortcutTarget(2, { ...flags, guest: true })).toBe("#/vault");
  });
});

describe("the chat desktops open on", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());
  const ch = (id: string, at: string, more: object = {}) => ({ id, kind: "dm", createdAt: "2026-01-01T00:00:00.000Z", last: { at }, ...more });

  it("is the newest chat when you haven't been in one, skipping archived chats and teams you left", () => {
    const channels = [ch("old", "2026-11-01T00:00:00Z"), ch("new", "2026-11-20T00:00:00Z"), ch("gone", "2026-11-25T00:00:00Z", { archivedAt: "2026-11-25T00:00:00Z" }), ch("left", "2026-11-26T00:00:00Z", { kind: "channel", joined: false })];
    expect(homeChat(channels)).toBe("new");
    expect(homeChat([])).toBeNull();
  });

  it("is the chat you were last in, kept on this device, while it's still there", () => {
    const channels = [ch("a", "2026-11-01T00:00:00Z"), ch("b", "2026-11-20T00:00:00Z")];
    rememberChat("a");
    expect(store.get("bubble.last-chat")).toBe("a");
    expect(homeChat(channels)).toBe("a");
    expect(homeChat([ch("b", "2026-11-20T00:00:00Z")])).toBe("b");
  });
});
