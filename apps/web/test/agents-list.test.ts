import { describe, expect, it, vi } from "vitest";
import type { DeviceInfo } from "../src/devices.ts";

// the list's module pulls in the agent page, which reads browser state when it loads
vi.mock("../src/theme.ts", () => ({ motionReduced: () => false, useMotionReduced: () => false, THEMES: [], useAppearance: () => ({}) }));
const { agentListLine } = await import("../src/views/AgentsView.tsx");

const device = (over: Partial<DeviceInfo> = {}): DeviceInfo => ({ id: "node", name: "my-mac", online: true, agents: [], ...over });
const agent = (over: Record<string, unknown> = {}) => ({ id: "a", status: "idle", harness: "claude-code", nodeId: "node", computerId: null, settings: {}, ...over }) as Parameters<typeof agentListLine>[0];

describe("an agent's line on the list of all agents", () => {
  it("says what it does, or its AI when it has no line of its own", () => {
    expect(agentListLine(agent({ settings: { role: "Keeps my days on track" } }), [device()])).toEqual({ text: "Keeps my days on track", warn: false, working: false });
    expect(agentListLine(agent(), [device()])).toEqual({ text: "Claude Code", warn: false, working: false });
  });

  it("says what is wrong first, in the warning colour", () => {
    expect(agentListLine(agent({ nodeId: null, settings: { role: "Research" } }), [device()])).toEqual({ text: "No device yet", warn: true, working: false });
    expect(agentListLine(agent({ settings: { role: "Research" } }), [device({ online: false })])).toEqual({ text: "my-mac is offline", warn: true, working: false });
  });

  it("says what it is doing while it works", () => {
    expect(agentListLine(agent({ status: "busy", settings: { role: "Research" } }), [device()])).toMatchObject({ text: "Working", working: true, warn: false });
    expect(agentListLine(agent({ settings: { role: "Research" } }), [device()], { last: null, text: null })).toMatchObject({ working: true, warn: false });
  });

  it("says offline for an agent that is ready but away", () => {
    expect(agentListLine(agent({ status: "offline", settings: { role: "Research" } }), null)).toEqual({ text: "Offline", warn: false, working: false });
  });
});
