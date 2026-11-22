import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { CommandPalette } from "./CommandPalette.tsx";
import { PLACES, findByWords, openSearch, placesFor, wordMatch } from "./searchIndex.ts";
import { SETTINGS_PAGES, href, parseRoute } from "../router.ts";
import { VaultView } from "../views/VaultView.tsx";
import { MarketplaceView } from "../views/MarketplaceView.tsx";

/** What the mocked store, mods and "Needs you" count say; each test sets what it needs. */
const world = vi.hoisted(() => ({ store: {} as any, waiting: 0, features: {} as Record<string, boolean>, setState: null as any, setPalette: null as any }));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: vi.fn(), useState: vi.fn(),
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useRef: (initial: unknown) => ({ current: initial }),
}));
vi.mock("../api.ts", () => ({ api: vi.fn() }));
vi.mock("../theme.ts", () => ({ motionReduced: () => false }));
vi.mock("../features.ts", () => ({ useFeatures: () => world.features }));
vi.mock("../store.ts", () => ({
  useStore: Object.assign((select: (s: unknown) => unknown) => select(world.store), {
    setState: (patch: unknown) => world.setState(patch),
    getState: () => ({ ...world.store, setPalette: world.setPalette }),
  }),
  useTeams: () => [],
  useInboxCount: () => world.waiting,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("location", new URL("https://wisp.test/"));
  vi.mocked(api).mockReset();
  vi.mocked(useState).mockImplementation((initial?: any): [any, any] => [typeof initial === "function" ? initial() : initial, vi.fn()]);
  Object.assign(world, { store: { paletteOpen: true, me: { user: { id: "me" }, role: "owner" }, channels: [], agents: [], members: [] }, waiting: 0, features: { tasks: true }, setState: vi.fn(), setPalette: vi.fn() });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Run just each component's search effect, with controlled state and deferred API responses.
// This exercises the actual debounce and cleanup without requiring a browser DOM.
const cases = [
  { name: "palette", queryIndex: 0, resultIndex: 1, component: () => {
    const element = (CommandPalette() as any).props.children[0];
    return () => element.type(element.props);
  }, result: (name: string) => ({ channels: [], agents: [], messages: [], notes: [{ path: name, title: name, snippet: name }] }) },
  { name: "vault", queryIndex: 3, resultIndex: 4, component: () => () => VaultView({ path: null }), result: (name: string) => [{ path: name, title: name, snippet: name }] },
  { name: "marketplace", queryIndex: 0, resultIndex: 5, component: () => () => MarketplaceView({ section: "apps" }), result: (name: string) => ({ entries: [{ id: name, name }] }) },
];

describe.each(cases)("$name search", ({ queryIndex, resultIndex, component, result, name }) => {
  function setup() {
    const render = component();
    let query = "older";
    let latest: any = null;
    const requests: { resolve(value: any): void; reject(error: Error): void }[] = [];
    vi.mocked(api).mockImplementation(() => new Promise((resolve, reject) => requests.push({ resolve, reject })));
    function search(next: string) {
      query = next;
      let index = 0;
      vi.mocked(useEffect).mockClear();
      vi.mocked(useState).mockImplementation((initial?: any): [any, any] => {
        const current = index++;
        const value = current === queryIndex ? query : typeof initial === "function" ? initial() : initial;
        return [value, ((value: any) => {
          if (current === resultIndex) latest = typeof value === "function" ? value(latest ?? { q: "", entries: null }) : value;
        }) as any];
      });
      render();
      const effect = vi.mocked(useEffect).mock.calls.find(([, deps]) => deps?.[0] === query)![0];
      return effect() as (() => void) | undefined;
    }
    return { search, requests, latest: () => latest };
  }

  it.each(["success", "error"])("ignores an older response after newer results (%s)", async (outcome) => {
    const h = setup();
    const cleanup = h.search("older");
    await vi.advanceTimersByTimeAsync(400);
    cleanup?.();
    h.search("newer");
    await vi.advanceTimersByTimeAsync(400);
    h.requests[1].resolve(result("newer"));
    await Promise.resolve();
    const latest = h.latest();
    expect(JSON.stringify(latest)).toContain("newer");
    if (outcome === "success") h.requests[0].resolve(result("older"));
    else h.requests[0].reject(new Error("Older request failed"));
    await Promise.resolve();
    expect(h.latest()).toEqual(latest);
  });

  it("ignores a response after clearing the query or closing the view", async () => {
    const h = setup();
    const cleanup = h.search("older");
    await vi.advanceTimersByTimeAsync(400);
    cleanup?.();
    const close = h.search("");
    close?.();
    const cleared = h.latest();
    h.requests[0].resolve(result("older"));
    await Promise.resolve();
    expect(h.latest()).toEqual(cleared);
    if (name !== "marketplace") expect(h.latest()).toBeNull();
  });
});


it.each([null, "thread"])("opens the selected search message in its conversation (%s)", (threadId) => {
  const palette = (CommandPalette() as any).props.children[0];
  let index = 0;
  const states = ["needle", { channels: [], agents: [], notes: [], messages: [{ id: "message", channelId: "channel", channelName: "general", threadId, author: { kind: "user", id: "me" }, createdAt: "2026-11-22T12:00:00.000Z", body: "needle", parts: [] }] }, 0];
  vi.mocked(useState).mockImplementation((): [any, any] => [states[index++], vi.fn()]);
  const tree = palette.type({ ...palette.props, onClose: vi.fn() });
  function find(node: any): any {
    if (!node || typeof node !== "object") return null;
    if (node.props?.id === "palette-opt-0") return node;
    return [node.props?.children].flat(Infinity).map(find).find(Boolean);
  }
  const option = find(tree);
  expect(option).toBeTruthy();
  option.props.onClick();
  expect(location.hash).toBe(`#/c/channel${threadId ? "/t/thread" : ""}/m/message`);
});

// --- what search finds, and in which order ---------------------------------------------------------

const NOW = "2026-11-22T12:00:00.000Z";
const agent = (id: string, name: string) => ({ id, name, handle: name.toLowerCase(), harness: "codex", createdAt: "2026-01-01T00:00:00.000Z", settings: {} });
const dm = (id: string, agentId: string, at: string) => ({ id, kind: "dm", name: `dm:me:${agentId}`, joined: true, archivedAt: null, createdAt: "2026-01-01T00:00:00.000Z", last: { at, body: "hi", author: { kind: "agent", id: agentId } } });
const team = (id: string, name: string, at: string, more: Record<string, unknown> = {}) => ({ id, kind: "channel", name, joined: true, archivedAt: null, createdAt: "2026-01-01T00:00:00.000Z", last: { at, body: "hi", author: { kind: "user", id: "me" } }, ...more });
const NO_RESULTS = { channels: [], agents: [], messages: [], notes: [] };

/** The palette as drawn for what was typed: its group headers and rows in order, each row clickable. */
function draw(typed: string, results: unknown = null) {
  const palette = (CommandPalette() as any).props.children[0];
  const states = [typed, results, 0];
  let index = 0;
  vi.mocked(useState).mockImplementation((): [any, any] => [states[index++], vi.fn()]);
  const onClose = vi.fn(), onAfter = vi.fn();
  const tree = palette.type({ ...palette.props, onClose, onAfter });
  const text = (node: any): string => (node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : [node.props?.children].flat(Infinity).map(text).join(""));
  const headers: string[] = [];
  const rows: { label: string; meta: string; group: string; click(): void }[] = [];
  (function walk(node: any) {
    if (!node || typeof node !== "object") return;
    if (node.props?.role === "option") {
      const [, label, meta] = [node.props.children].flat(Infinity);
      return void rows.push({ label: text(label), meta: text(meta), group: headers.at(-1) ?? "", click: node.props.onClick });
    }
    if (node.type === "div" && typeof node.props?.children === "string" && node.props.className?.includes("text-xs")) headers.push(node.props.children);
    [node.props?.children].flat(Infinity).forEach(walk);
  })(tree);
  return { headers, rows, labels: rows.map((r) => r.label), onClose, onAfter, row: (label: string) => rows.find((r) => r.label === label) };
}

describe("nothing typed", () => {
  beforeEach(() => {
    world.store.agents = [agent("a1", "Juno"), agent("a2", "Atlas")];
    world.store.channels = [dm("d1", "a1", "2026-11-22T10:00:00.000Z"), dm("d2", "a2", "2026-11-20T10:00:00.000Z"), team("t1", "Launch crew", "2026-11-22T11:00:00.000Z"), team("t2", "Old crew", NOW, { archivedAt: NOW }), team("t3", "Other crew", NOW, { joined: false })];
  });

  it("shows only the agents and teams you talked to last, newest first", () => {
    const p = draw("");
    expect(p.headers).toEqual(["Recent"]);
    expect(p.labels).toEqual(["Launch crew", "Juno", "Atlas"]);
    expect(api).not.toHaveBeenCalled();
  });

  it("adds Needs you under them only when something waits", () => {
    world.waiting = 2;
    const p = draw("");
    expect(p.labels).toEqual(["Launch crew", "Juno", "Atlas", "Needs you (2)"]);
    expect(p.headers).toEqual(["Recent"]);
    p.row("Needs you (2)")!.click();
    expect(p.onClose).toHaveBeenCalled();
    expect(location.hash).toBe("#/dashboard");
  });
});

describe("typing", () => {
  const found = {
    ...NO_RESULTS,
    messages: [
      { id: "m1", channelId: "d1", channelName: "dm:me:a1", threadId: null, author: { kind: "agent", id: "a1" }, body: "The **new** plan is ready", parts: [], createdAt: NOW },
      { id: "m2", channelId: "t1", channelName: "Launch crew", threadId: null, author: { kind: "user", id: "me" }, body: "new date?", parts: [], createdAt: NOW },
    ],
    notes: [{ path: "shared/new-office.md", title: "New office", snippet: "Moving in March" }],
  };
  beforeEach(() => {
    vi.setSystemTime(new Date(NOW));
    world.store.agents = [agent("a1", "Juno"), agent("a3", "Nell")];
    world.store.channels = [dm("d1", "a1", NOW), team("t1", "Launch crew", NOW), team("t4", "Newsroom", NOW, { archivedAt: NOW })];
  });

  it("groups what it finds: agents and teams, messages, Needs you, places, notes, actions", () => {
    const p = draw("ne", found);
    expect(p.headers).toEqual(["Agents and teams", "Messages", "Places", "Notes", "Actions"]);
    expect(p.rows.filter((r) => r.group === "Agents and teams").map((r) => [r.label, r.meta])).toEqual([["Nell", ""], ["Newsroom", "Archived"]]);
    const needs = p.labels.indexOf("Needs you");
    expect(p.labels[needs - 1]).toBe("new date?");
    expect(p.rows[needs + 1].group).toBe("Places");
    expect(p.row("New office")!.meta).toBe("Shared");
    expect(p.rows.filter((r) => r.group === "Actions").map((r) => r.label)).toEqual(["New agent", "New team", "New section", "New task", "New workspace"]);
  });

  it("says who wrote a message, where and when", () => {
    const p = draw("new", found);
    expect(p.row("The new plan is ready")!.meta).toMatch(/^Juno · \S/);
    expect(p.row("new date?")!.meta).toMatch(/^You · Launch crew · \S/);
  });

  it("finds an agent by its @handle", () => {
    world.store.agents = [{ ...agent("a1", "Juno"), handle: "planner" }];
    expect(draw("@plan").rows[0]).toMatchObject({ label: "Juno", meta: "@planner", group: "Agents and teams" });
  });

  it("finds settings by the words a person would type", () => {
    const first = (typed: string) => draw(typed).rows.find((r) => r.group === "Places");
    expect(first("password")).toMatchObject({ label: "Password", meta: "Settings" });
    expect(first("dark")).toMatchObject({ label: "Appearance", meta: "Settings" });
    expect(first("tailscale")).toMatchObject({ label: "Away from home", meta: "Settings" });
    expect(first("api key")).toMatchObject({ label: "AI accounts and keys", meta: "Settings" });
    first("away")!.click();
    expect(location.hash).toBe("#/settings/access");
  });

  it("no longer lists every page: a page shows only when its name or words are typed", () => {
    expect(draw("").labels).not.toContain("Settings");
    expect(draw("zzz").rows).toEqual([]);
    expect(draw("comp").labels).toContain("Computers");
  });

  it("leaves out what a guest or a switched-off mod can't open", () => {
    expect(draw("task").labels).toEqual(["Tasks", "New task"]);
    world.features = {};
    expect(draw("task").labels).toEqual([]);
    world.store.me.role = "guest";
    expect(draw("computers").labels).toEqual([]);
    expect(draw("new").labels).not.toContain("New agent");
  });

  it("offers Call, Start fresh and Compact for the agent whose chat is open", () => {
    expect(draw("call").rows.filter((r) => r.group === "Actions")).toEqual([]);
    vi.stubGlobal("location", new URL("https://wisp.test/#/c/d1"));
    vi.mocked(api).mockResolvedValue({});
    draw("call").row("Call Juno")!.click();
    expect(location.hash).toBe("#/c/d1/call");
    draw("fresh").row("Start fresh")!.click();
    expect(api).toHaveBeenLastCalledWith("POST", "/api/channels/d1/messages", { body: "/new", threadId: null, fileIds: [] });
    draw("compact").row("Compact")!.click();
    expect(api).toHaveBeenLastCalledWith("POST", "/api/channels/d1/messages", { body: "/compact", threadId: null, fileIds: [] });
    // a team's chat has no one agent to call
    vi.stubGlobal("location", new URL("https://wisp.test/#/c/t1"));
    expect(draw("call").rows.filter((r) => r.group === "Actions")).toEqual([]);
  });

  it("hands dialogs to the app once it has closed", () => {
    for (const [typed, label, after] of [["sign out", "Sign out", "signout"], ["workspace", "Switch workspace", "orgs"], ["section", "New section", "section"]] as const) {
      const p = draw(typed);
      p.row(label)!.click();
      expect(p.onClose).toHaveBeenCalled();
      expect(p.onAfter).toHaveBeenCalledWith(after);
    }
    draw("team").row("Browse teams")!.click();
    expect(world.setState).toHaveBeenLastCalledWith({ channelBrowser: { sectionId: null } });
  });

  it("collapses or expands the sidebar on desktops only", () => {
    expect(draw("sidebar").labels).toEqual(["New section"]);
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }), dispatchEvent });
    draw("sidebar").row("Collapse sidebar")!.click();
    expect(dispatchEvent.mock.calls[0][0].type).toBe("wisp:sidebar-toggle");
  });
});

describe("plain words", () => {
  const all = { tasks: true, code: true, invite: true, background: true, storage: true, apple: true };
  const find = (typed: string) => findByWords(typed, placesFor(false, all)).map((p) => p.label);

  it("finds a place by words that aren't in its name", () => {
    expect(find("password")[0]).toBe("Password");
    expect(find("dark")).toEqual(["Appearance"]);
    expect(find("tailscale")).toEqual(["Away from home"]);
    expect(find("away")[0]).toBe("Away from home");
    expect(find("voice")[0]).toBe("Voice");
    expect(find("api key")[0]).toBe("AI accounts and keys");
    expect(find("marketplace")).toEqual(["Add apps and skills"]);
    expect(find("terminal")).toEqual(["Code"]);
  });

  it("puts a name that matches ahead of other words that match", () => {
    expect(find("memory").slice(0, 2)).toEqual(["Memory", "Memory access"]);
    expect(find("comp").slice(0, 2)).toEqual(["Computers", "Computers"]);
    expect(wordMatch("away", "Away from home")).toBe(3);
    expect(wordMatch("home", "Away from home")).toBe(2);
    expect(wordMatch("tailscale", "Away from home", "tailscale vpn")).toBe(1);
  });

  it("matches whole words and their beginnings, in any order, never the middle of a word", () => {
    expect(wordMatch("pass", "Security", "password")).toBe(1);
    expect(wordMatch("key api", "AI", "api key")).toBe(1);
    expect(wordMatch("art", "Start fresh")).toBe(0);
    expect(wordMatch("api banana", "AI", "api key")).toBe(0);
    expect(wordMatch("  ", "AI", "api key")).toBe(0);
  });

  it("has every settings page, and every place opens a real route", () => {
    for (const page of SETTINGS_PAGES) expect(PLACES.map((p) => p.key)).toContain(`settings:${page}`);
    for (const p of PLACES) expect(href(parseRoute(href(p.to)))).toBe(href(p.to));
    expect(new Set(PLACES.map((p) => p.key)).size).toBe(PLACES.length);
  });

  it("opens from code, with or without something typed", () => {
    openSearch();
    expect(world.setState).toHaveBeenLastCalledWith({ paletteSeed: "" });
    expect(world.setPalette).toHaveBeenLastCalledWith(true);
    openSearch("juno");
    expect(world.setState).toHaveBeenLastCalledWith({ paletteSeed: "juno" });
  });
});
