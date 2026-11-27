import { beforeEach, describe, expect, it, vi } from "vitest";

// no DOM here: a small in-memory localStorage and window events are all the module needs
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), clear: () => mem.clear() });
vi.stubGlobal("window", new EventTarget());

const calls: unknown[] = [];
let reject = false;
vi.mock("../src/api.ts", () => {
  class ApiError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  }
  return {
    ApiError,
    api: async (_m: string, _p: string, body: unknown) => {
      calls.push(body);
      if (reject) throw new ApiError("Unrecognized key: background", 400);
      return {};
    },
  };
});
vi.mock("../src/store.ts", () => ({ useStore: Object.assign(() => undefined, { getState: () => ({ refreshAgents: async () => {} }) }) }));

describe("chat background (local stand-in)", () => {
  beforeEach(() => {
    calls.length = 0;
    localStorage.clear();
  });

  it("saves on the agent as settings.background", async () => {
    reject = false;
    const { setAgentBackground } = await import("../src/chatBackground.ts");
    await setAgentBackground("a1", { kind: "color", color: "#dfe4f3" });
    expect(calls).toEqual([{ settings: { background: { kind: "color", color: "#dfe4f3" } } }]);
    expect(localStorage.getItem("bubble.agent-background")).toBe("{}");
  });

  it("keeps the choice in this browser while the hub doesn't take it yet", async () => {
    reject = true;
    const { setAgentBackground } = await import("../src/chatBackground.ts");
    await setAgentBackground("a1", { kind: "photo", fileId: "f1" });
    expect(JSON.parse(localStorage.getItem("bubble.agent-background")!)).toEqual({ a1: { kind: "photo", fileId: "f1" } });
    await setAgentBackground("a1", null);
    expect(JSON.parse(localStorage.getItem("bubble.agent-background")!)).toEqual({});
  });
});
