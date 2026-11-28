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

const me = { kind: "user", role: "owner", user: { id: "u1", name: "Yug Patel", email: "yug@example.com", createdAt: "now" }, workspace: { id: "w", name: "Meadows" }, prefs: { sendWith: "enter", clock: "auto", toolCalls: "collapsed", experience: "advanced", sidebar: { pins: [], sections: [] } } } as unknown as Me;
const agent = (id: string, name: string) => ({ id, handle: name.toLowerCase(), name, harness: "codex", model: null, nodeId: "n1", computerId: null, settings: {}, status: "online", createdAt: "2026-01-01T00:00:00Z", workspaceId: "w" }) as never;
const channel = (over: Partial<ChannelInfo>): ChannelInfo =>
  ({ id: "c", workspaceId: "w", name: "x", kind: "channel", topic: "", sectionId: null, private: false, archivedAt: null, settings: { defaultAgentId: null, replyInThread: true, instructions: "", team: null }, createdAt: "2026-01-01T00:00:00Z", joined: true, memberCount: 1, unread: 0, lastReadAt: null, notify: "default", starred: false, pinnedIds: [], last: null, ...over }) as ChannelInfo;

function render(variant?: "page") {
  return renderToStaticMarkup(createElement(ChatList, { route: { view: "chats" }, variant }));
}

describe("chats list", () => {
  it("on desktops (nothing open yet) is one plain list of agents and teams, newest first: pins and sections live in the sidebar", () => {
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
    // by recency, whatever is pinned or filed
    expect(at("release-crew")).toBeLessThan(at("Ghosty"));
    expect(at("Ghosty")).toBeLessThan(at("launch-crew"));
    expect(at("launch-crew")).toBeLessThan(at("general"));
    // an agent with no chat yet still has a row, after the ones with messages
    expect(at("general")).toBeLessThan(at("Nova"));
    // previews say who spoke in a team, and "You" for you
    expect(html).toContain("You: newer");
    expect(html).toContain("older");
    // the + menu is there, and nothing says Channels or Starred
    expect(html).toContain('aria-label="New agent, team or chat"');
    expect(html).not.toMatch(/Channels|Starred/);
  });

  it("is the phone's home: your initials left and + right on top, search pulled down above the list, then one line per agent or team", () => {
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
    // your initials (opening the account page) sit top left, the one + (New agent, team or chat) top right,
    // and the search field waits just above the list, scrolled out of sight until you pull
    expect(at('href="#/you"')).toBeLessThan(at('aria-label="New agent, team or chat"'));
    expect(at('aria-label="New agent, team or chat"')).toBeLessThan(at('aria-label="Search chats"'));
    expect(at('aria-label="Search chats"')).toBeLessThan(at("release-crew"));
    expect(html).not.toContain(">Search<");
    // newest first, each with its preview and when; unread shows as one dot
    expect(at("release-crew")).toBeLessThan(at("Ghosty"));
    expect(html).toContain("You: newer");
    expect(html).toContain("My pick is Immich.");
    expect(html).toContain('aria-label="Ghosty, 2 unread"');
    // no All / Your turn filter (round 4): a blue dot marks what waits
    expect(html).not.toContain(">Your turn<");
    expect(html).toContain("Oct 24");
    expect(html).not.toContain("No messages yet");
    // nothing waits on you: no Needs you card
    expect(html).not.toContain('href="#/dashboard"');
  });

  it("marks a chat that waits on you with a blue dot instead of a Needs you card", () => {
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
    expect(html).not.toContain('href="#/dashboard"');
    expect(html).toContain('aria-label="Ghosty, needs you"');
    expect(html).toContain("background:#0a84ff");
  });
});
