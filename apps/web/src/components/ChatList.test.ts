import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@wisp/core";
import type { ChannelInfo, LiveRun } from "../store.ts";
import { chatPreview, chatPreviewLine, firstWaiting, type Chat, type PreviewContext } from "./ChatList.tsx";

vi.mock("../api.ts", () => ({ api: vi.fn(), setToken: vi.fn(), getToken: () => null }));
vi.mock("../theme.ts", () => ({ motionReduced: () => false }));

const juno = { id: "juno", name: "Juno", status: "online", harness: "claude" } as unknown as Agent;
const dm = (over: Partial<ChannelInfo> = {}) => ({ id: "dm-juno", kind: "dm", name: "dm:me:juno", unread: 0, ...over }) as unknown as ChannelInfo;
const team = (over: Partial<ChannelInfo> = {}) => ({ id: "crew", kind: "channel", name: "Launch crew", unread: 0, ...over }) as unknown as ChannelInfo;
const chat = (over: Partial<Chat> = {}): Chat => ({ key: "a:juno", kind: "dm", channel: dm(), agent: juno, name: "Juno", at: 0, unread: 0, pinned: false, muted: false, sectionId: null, ...over });
const teamChat = (channel: ChannelInfo): Chat => chat({ key: "c:crew", kind: "team", channel, agent: null, name: "Launch crew" });
const ctx: PreviewContext = { meId: "me", agents: [juno, { id: "atlas", name: "Atlas" }], members: [{ id: "me", name: "Sam Lee" }, { id: "kim", name: "Kim Park" }], approvals: {} };
const run = (over: Partial<LiveRun> = {}): LiveRun => ({ runId: "r1", agentId: "juno", channelId: "dm-juno", threadId: null, threadPath: [], text: "", tools: [], last: null, usedComputer: false, ...over });
const last = (body: string, kind = "agent", id = "juno") => ({ at: "2026-11-22T10:00:00Z", body, author: { kind, id } });

describe("chatPreview", () => {
  it("shows nothing for a chat with no messages", () => {
    expect(chatPreview(chat(), {}, ctx)).toBe("");
    expect(chatPreview(chat({ channel: null }), {}, ctx)).toBe("");
  });

  it("shows the newest message, and says when it was yours", () => {
    expect(chatPreview(chat({ channel: dm({ last: last("My pick is Immich.") }) }), {}, ctx)).toBe("My pick is Immich.");
    expect(chatPreview(chat({ channel: dm({ last: last("Thursday works", "user", "me") }) }), {}, ctx)).toBe("You: Thursday works");
  });

  it("names who spoke last in a team", () => {
    expect(chatPreview(teamChat(team({ last: last("Build fixed. Tests pass.", "agent", "atlas") })), {}, ctx)).toBe("Atlas: Build fixed. Tests pass.");
    expect(chatPreview(teamChat(team({ last: last("Ship it", "user", "kim") })), {}, ctx)).toBe("Kim: Ship it");
  });

  it("shows what the agent is doing while it works, ahead of the last message", () => {
    const working = chatPreviewLine(chat({ channel: dm({ last: last("Earlier") }) }), { r1: run() }, ctx);
    expect(working.working).toBe(true);
    expect(working.text).not.toBe("Earlier");
    expect(working.text.length).toBeGreaterThan(0);
    // a run in another chat doesn't count
    expect(chatPreviewLine(chat({ channel: dm({ last: last("Earlier") }) }), { r1: run({ channelId: "elsewhere" }) }, ctx)).toMatchObject({ text: "Earlier", working: false });
    // busy with no run yet
    expect(chatPreviewLine(chat({ agent: { ...juno, status: "busy" } as Agent }), {}, ctx)).toMatchObject({ text: "Working", working: true });
  });

  it("names the agent that works in a team", () => {
    const line = chatPreviewLine(teamChat(team()), { r1: run({ agentId: "atlas", channelId: "crew" }) }, ctx);
    expect(line.working).toBe(true);
    expect(line.text.startsWith("Atlas · ")).toBe(true);
  });

  it("says what waits on you", () => {
    const approvals = { a1: { status: "pending" as const, channelId: "dm-juno", summary: "Move the dentist to Thursday at 3?" } };
    expect(chatPreviewLine(chat({ channel: dm({ last: last("Earlier") }) }), {}, { ...ctx, approvals })).toEqual({ text: "Needs approval · Move the dentist to Thursday at 3?", working: false, needs: true });
    const asked = chatPreviewLine(chat({ channel: dm({ last: last("Earlier"), loop: { status: "waiting", summary: "Pick a photo app" } }) }), {}, ctx);
    expect(asked).toMatchObject({ text: "Waiting on you · Pick a photo app", needs: true });
  });
});

describe("firstWaiting", () => {
  it("is nothing when nothing waits", () => {
    expect(firstWaiting({ approvals: [], help: [] })).toBeNull();
  });

  it("is the first approval, else help on a computer", () => {
    const help = [{ name: "This Mac", help: { agentId: "atlas", request: "Type the code from your phone", at: "2026-11-22T10:00:00Z" } }] as unknown as Parameters<typeof firstWaiting>[0]["help"];
    expect(firstWaiting({ approvals: [{ agentId: "juno", summary: "Move the dentist to Thursday at 3?" }], help })).toEqual({ agentId: "juno", text: "Move the dentist to Thursday at 3?" });
    expect(firstWaiting({ approvals: [], help })).toEqual({ agentId: "atlas", text: "Type the code from your phone" });
  });
});
