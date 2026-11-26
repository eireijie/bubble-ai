import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@bubble-ai/core";
import type { ChannelInfo } from "./store.ts";

vi.mock("./api.ts", () => ({ api: vi.fn(), setToken: vi.fn(), getToken: () => null }));
vi.mock("./theme.ts", () => ({ motionReduced: () => false }));

const { chatPreviewLine } = await import("./components/ChatList.tsx");
const { opensQuestion } = await import("./components/onboarding/FirstChat.tsx");

const agent = (nodeId: string | null) => ({ id: "juno", name: "Juno", status: "online", harness: "claude-code", nodeId, computerId: null, settings: {} }) as unknown as Agent;
const dm = { id: "dm-juno", kind: "dm", name: "dm:me:juno", unread: 0, last: { at: "2026-11-26T10:00:00Z", body: "Booked it.", author: { kind: "agent", id: "juno" } } } as unknown as ChannelInfo;
const ctx = { meId: "me", agents: [], members: [], approvals: {} };
const chat = (a: Agent) => ({ key: "a:juno", kind: "dm" as const, channel: dm, agent: a, name: "Juno", at: 0, unread: 0, pinned: false, muted: false, sectionId: null });

describe("Your turn agrees with Needs you", () => {
  it("an agent with no device is your turn, and its last message still shows", () => {
    expect(chatPreviewLine(chat(agent(null)), {}, ctx)).toMatchObject({ text: "Booked it.", needs: true });
  });
  it("a set-up agent isn't", () => {
    expect(chatPreviewLine(chat(agent("n1")), {}, ctx).needs).toBeFalsy();
  });
});

describe("first-chat quick replies", () => {
  it("are left out when the hello asks an open question", () => {
    expect(opensQuestion("Hey, I'm Luna! What would you like me to do? Tell me in a few words.")).toBe(true);
    expect(opensQuestion("Which apps should I use?")).toBe(true);
  });
  it("stay for a hello that proposes something", () => {
    expect(opensQuestion("I can sort your inbox every morning. Shall I start?")).toBe(false);
    expect(opensQuestion("Hi! I'm ready.")).toBe(false);
  });
});
