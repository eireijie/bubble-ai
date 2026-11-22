import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useStore, type ChannelInfo, type Me } from "../src/store.ts";
import { ChatList } from "../src/components/ChatList.tsx";

vi.mock("../src/api.ts", () => ({ api: vi.fn(() => new Promise(() => {})), uploadFile: vi.fn() }));
vi.mock("../src/theme.ts", () => ({ motionReduced: () => false, useMotionReduced: () => false }));

const initial = useStore.getInitialState();
const saved = { me: initial.me, channels: initial.channels, sections: initial.sections, agents: initial.agents, approvals: initial.approvals };
afterEach(() => Object.assign(initial, saved));

const me = { kind: "user", role: "owner", user: { id: "u1", name: "Yug Patel", email: "yug@example.com", createdAt: "now" }, workspace: { id: "w", name: "Meadows" }, prefs: { sendWith: "enter", clock: "auto", toolCalls: "collapsed", experience: "advanced" } } as unknown as Me;
const agent = (id: string, name: string) => ({ id, handle: name.toLowerCase(), name, harness: "codex", model: null, nodeId: null, computerId: null, settings: {}, status: "online", createdAt: "2026-01-01T00:00:00Z", workspaceId: "w" }) as never;
const channel = (over: Partial<ChannelInfo>): ChannelInfo =>
  ({ id: "c", workspaceId: "w", name: "x", kind: "channel", topic: "", sectionId: null, private: false, archivedAt: null, settings: { defaultAgentId: null, replyInThread: true, instructions: "", team: null }, createdAt: "2026-01-01T00:00:00Z", joined: true, memberCount: 1, unread: 0, lastReadAt: null, notify: "default", starred: false, pinnedIds: [], last: null, ...over }) as ChannelInfo;

function render(variant?: "page") {
  return renderToStaticMarkup(createElement(ChatList, { route: { view: "chats" }, variant }));
}

describe("chats list", () => {
  it("is one flat list of agents and teams, newest first, with pinned chats on top and sections below", () => {
    Object.assign(initial, {
      me,
      agents: [agent("a1", "Ghosty"), agent("a2", "Nova")],
      sections: [{ id: "s1", name: "Launch", emoji: "", position: 0 }],
      channels: [
        channel({ id: "dm1", name: "dm:u1:a1", kind: "dm", last: { at: "2026-10-23T10:00:00Z", body: "older", author: { kind: "agent", id: "a1" } } }),
        channel({ id: "t1", name: "release-crew", last: { at: "2026-10-24T10:00:00Z", body: "newer", author: { kind: "user", id: "u1" } } }),
        channel({ id: "t2", name: "general", starred: true, last: { at: "2026-10-01T10:00:00Z", body: "pinned and old", author: { kind: "user", id: "u1" } } }),
        channel({ id: "t3", name: "launch-crew", sectionId: "s1", last: { at: "2026-10-22T10:00:00Z", body: "filed away", author: { kind: "user", id: "u1" } } }),
      ],
    });
    const html = render();
    const at = (s: string) => html.indexOf(s);
    // pinned first, then by recency
    expect(at("general")).toBeLessThan(at("release-crew"));
    expect(at("release-crew")).toBeLessThan(at("Ghosty"));
    // an agent with no chat yet still has a row, after the ones with messages
    expect(at("Ghosty")).toBeLessThan(at("Nova"));
    // sections follow the main list
    expect(at("Nova")).toBeLessThan(at("Launch"));
    expect(at("Launch")).toBeLessThan(at("launch-crew"));
    // previews say who spoke in a team, and "You" for you
    expect(html).toContain("You: newer");
    expect(html).toContain("older");
    // the + menu is there, and nothing says Channels or Starred
    expect(html).toContain("New chat, agent or team");
    expect(html).not.toMatch(/Channels|Starred/);
  });

  it("is the phone's home: you, Search and + on top, then one line per agent or team", () => {
    Object.assign(initial, {
      me,
      agents: [agent("a1", "Ghosty"), agent("a2", "Nova")],
      sections: [],
      channels: [
        channel({ id: "dm1", name: "dm:u1:a1", kind: "dm", unread: 2, last: { at: "2026-10-23T10:00:00Z", body: "My pick is Immich.", author: { kind: "agent", id: "a1" } } }),
        channel({ id: "t1", name: "release-crew", last: { at: "2026-10-24T10:00:00Z", body: "newer", author: { kind: "user", id: "u1" } } }),
      ],
    });
    const html = render("page");
    const at = (s: string) => html.indexOf(s);
    // your picture opens the account page, Search opens the full search, and the + has no "New chat" (a row is the chat)
    expect(at('href="#/you"')).toBeLessThan(at(">Search<"));
    expect(at(">Search<")).toBeLessThan(at('aria-label="New agent or team"'));
    expect(html).not.toContain("New chat");
    // newest first, each with its preview; unread shows as one dot, and there are no times
    expect(at("release-crew")).toBeLessThan(at("Ghosty"));
    expect(html).toContain("You: newer");
    expect(html).toContain("My pick is Immich.");
    expect(html).toContain('aria-label="2 unread"');
    expect(html).not.toMatch(/Oct 2\d|No messages yet/);
    // nothing waits on you: no Needs you card
    expect(html).not.toContain('href="#/dashboard"');
  });

  it("puts a Needs you card over the phone's list while something waits", () => {
    Object.assign(initial, {
      me,
      agents: [agent("a1", "Ghosty")],
      sections: [],
      channels: [channel({ id: "dm1", name: "dm:u1:a1", kind: "dm" })],
      approvals: {
        p1: { id: "p1", agentId: "a1", channelId: "dm1", status: "pending", summary: "Move the dentist to Thursday at 3?" },
        p2: { id: "p2", agentId: "a1", channelId: "dm1", status: "pending", summary: "Send the invoice" },
        old: { id: "old", agentId: "a1", channelId: "dm1", status: "approved", summary: "Done already" },
      },
    });
    const html = render("page");
    // one tap to the Needs you page, with the first thing that waits and how many more
    expect(html).toContain('href="#/dashboard"');
    expect(html).toContain("Move the dentist to Thursday at 3?");
    expect(html).toContain("Needs you · Ghosty · 1 more");
    expect(html.indexOf('href="#/dashboard"')).toBeLessThan(html.indexOf('href="#/c/dm1"'));
    // the desktop column has no card: the sidebar has its own Needs you row
    expect(render()).not.toContain('href="#/dashboard"');
  });
});
