import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useStore } from "../src/store.ts";
import { Rail, sidebarGroups } from "../src/components/Rail.tsx";
import type { Chat } from "../src/components/ChatList.tsx";

vi.mock("../src/api.ts", () => ({ api: vi.fn(() => new Promise(() => {})), uploadFile: vi.fn() }));
vi.mock("../src/App.tsx", () => ({ logout: vi.fn() }));
vi.mock("../src/components/OrgSwitcher.tsx", () => ({ OrgSwitcher: () => null, OrgList: () => null, NewOrgDialog: () => null, useOrgs: () => ({ orgs: [], current: null, homeId: null }) }));
vi.mock("../src/theme.ts", () => ({ motionReduced: () => false, useMotionReduced: () => false, useAppearance: () => ({ resolvedMode: "light", mode: "light", setMode: vi.fn(), toggleMode: vi.fn() }) }));
vi.mock("../src/onboarding.ts", () => ({
  useOnboarding: () => ({ done: {} }),
  useDismissed: () => false,
  setupProgress: () => ({ progress: 6, steps: 6, complete: true }),
  useReadyChecklist: () => ({ items: [], left: 0, started: false, workspaceId: "" }),
}));

const chat = (key: string, kind: "dm" | "team", extra: Partial<Chat> = {}): Chat => ({ key, kind, channel: null, agent: null, name: key, at: 0, unread: 0, pinned: false, muted: false, sectionId: null, ...extra });

describe("sidebar groups", () => {
  it("puts pinned first, then agents and teams in no section as one list, then your sections", () => {
    const groups = sidebarGroups(
      [chat("ledger", "dm", { pinned: true, sectionId: "work" }), chat("iris", "dm"), chat("launch", "team"), chat("mason", "dm", { sectionId: "work" }), chat("old", "team", { sectionId: "gone" })],
      [{ id: "work", name: "Work" } as never],
    );
    expect(groups.map((g) => [g.label, g.chats.map((c) => c.key)])).toEqual([
      ["Pinned", ["ledger"]],
      // agents and teams together, in the order they came in (newest first); a chat in a deleted section falls back here
      ["Agents and teams", ["iris", "launch", "old"]],
      ["Work", ["mason"]],
    ]);
  });

  it("gives only Pinned and your own sections a header", () => {
    const groups = sidebarGroups([chat("ledger", "dm", { pinned: true }), chat("iris", "dm"), chat("mason", "dm", { sectionId: "work" })], [{ id: "work", name: "Work" } as never]);
    expect(groups.map((g) => [g.id, !g.plain])).toEqual([["pinned", true], ["chats", false], ["work", true]]);
    expect(groups[2].section?.name).toBe("Work");
  });

  it("leaves out Pinned and the plain list when empty, and keeps a section you made", () => {
    expect(sidebarGroups([chat("iris", "dm")], []).map((g) => g.id)).toEqual(["chats"]);
    expect(sidebarGroups([chat("iris", "dm", { sectionId: "work" })], [{ id: "work", name: "Work" } as never, { id: "later", name: "Later" } as never]).map((g) => [g.label, g.chats.length])).toEqual([["Work", 1], ["Later", 0]]);
  });
});

describe("docked sidebar", () => {
  const initial = useStore.getInitialState();
  const saved = { me: initial.me, agents: initial.agents, approvals: initial.approvals, channels: initial.channels };
  afterEach(() => {
    Object.assign(initial, saved);
    vi.unstubAllGlobals();
  });

  function render(stored: unknown) {
    const data = new Map<string, string>(stored ? [["wisp.sidebar2", JSON.stringify(stored)]] : []);
    vi.stubGlobal("localStorage", { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
    initial.me = { kind: "user", role: "owner", user: { id: "person", name: "Sam Rivera", email: "me@example.com", createdAt: "now" }, workspace: { id: "workspace", name: "Home" }, prefs: { experience: "advanced", sendWith: "enter", clock: "auto", toolCalls: "collapsed" } };
    // Iris has a computer, so she is not waiting on the person (an agent with none counts under Needs you)
    initial.agents = [{ id: "a1", name: "Iris", status: "idle", nodeId: "n1", harness: "claude-code" } as (typeof initial.agents)[number]];
    return renderToStaticMarkup(createElement(Rail, { route: { view: "dashboard" } }));
  }

  it("opens at the remembered width: search and New on top, the list, you and Computers + Memory vault at the foot, a resize edge", () => {
    const html = render({ width: 360, collapsed: false });
    expect(html).toContain("width:360px");
    expect(html).toContain('role="separator"');
    expect(html).toContain(">Iris<");
    expect(html).toContain(">Sam<");
    expect(html).toMatch(/aria-label="Computers, \d+ on"/);
    expect(html).toContain('href="#/vault"');
    for (const control of ["Search", "New agent or team", "You and settings"]) expect(html).toContain(`aria-label="${control}"`);
    // the All / Your turn filter
    expect(html).toContain(">All<");
    expect(html).toContain(">Your turn<");
  });

  it("holds only agents and teams: no workspace header, nothing else drawn in it", () => {
    const html = render({ width: 360, collapsed: false });
    for (const gone of ["Collapse sidebar", "All chats and search", "Inbox", ">Agents<", ">Teams<", "Finish setup", "Apps, skills and mods", "Settings, memory, usage", ">Home<", "switch workspace", "No chats yet"]) expect(html).not.toContain(gone);
  });

  it("gives a row its name, the newest message under it and one dot when unread, with no count", () => {
    initial.channels = [{ id: "c1", kind: "dm", name: "dm:person:a1", unread: 3, notify: "default", starred: false, sectionId: null, last: { at: "2026-11-22T10:00:00Z", body: "My pick is Immich.", author: { kind: "agent", id: "a1" } } } as unknown as (typeof initial.channels)[number]];
    const html = render({ width: 360, collapsed: false });
    expect(html).toMatch(/href="#\/[^"]*c1"/);
    expect(html).toContain('aria-label="Iris, 3 unread"');
    expect(html).toContain(">My pick is Immich.<");
    expect(html).not.toContain(">3<");
    // collapsed: the same chat as a tile, still marked
    const rail = render({ width: 360, collapsed: true });
    expect(rail).toContain('aria-label="Iris, 3 unread"');
    expect(rail).not.toContain(">My pick is Immich.<");
  });

  it("counts what waits on you on Your turn, and keeps Needs you in the New menu", () => {
    initial.channels = [{ id: "c1", kind: "dm", name: "dm:person:a1", unread: 0, notify: "default", starred: false, sectionId: null } as unknown as (typeof initial.channels)[number]];
    initial.approvals = { ok: { id: "ok", status: "pending", channelId: "c1", agentId: "a1", summary: "Send it?" } as (typeof initial.approvals)[string] };
    const html = render({ width: 360, collapsed: false });
    expect(html).toMatch(/Your turn<span[^>]*>\d+</);
  });

  it("collapsed is an 82px rail of tiles, and every place is still reachable", () => {
    const html = render({ width: 360, collapsed: true });
    expect(html).toContain("width:82px");
    expect(html).not.toContain(">Iris<");
    for (const place of ["Search", "Iris", "New agent or team", "Computers", "Memory vault", "You and settings"]) expect(html).toContain(`aria-label="${place}`);
  });

  it("starts at 320 with nothing saved", () => expect(render(null)).toContain("width:320px"));
});
