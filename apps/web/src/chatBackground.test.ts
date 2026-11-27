import { beforeEach, describe, expect, it, vi } from "vitest";

// no DOM here: a small in-memory localStorage and window events are all the module needs
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });

// a stand-in hub: agent PATCHes and prefs PUTs, which an "old" hub refuses or drops
const state = vi.hoisted(() => ({
  old: false,
  calls: [] as { method: string; path: string; body: unknown }[],
  me: { prefs: {} as Record<string, unknown> },
  agents: [{ id: "a1", settings: {} as Record<string, unknown> }, { id: "a2", settings: {} as Record<string, unknown> }],
}));
vi.mock("./api.ts", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    uploadFile: async () => ({ id: "f_up" }),
    fileUrl: async (id: string) => `blob:${id}`,
    api: async (method: string, path: string, body: { settings: { background: unknown } }) => {
      state.calls.push({ method, path, body });
      if (state.old) throw new ApiError("settings: Unrecognized key(s) in object: 'background'", 400);
      const a = state.agents.find((x) => path.endsWith(x.id))!;
      a.settings = { ...a.settings, background: body.settings.background ?? undefined };
      return a;
    },
  };
});
vi.mock("./store.ts", () => ({
  useStore: Object.assign(() => undefined, {
    subscribe: () => () => {},
    getState: () => ({
      me: state.me,
      agents: state.agents,
      refreshAgents: async () => {},
      // an old hub keeps only the keys it knows
      setPrefs: async (patch: Record<string, unknown>) => {
        state.calls.push({ method: "PUT", path: "/api/me/prefs", body: patch });
        if (!state.old) state.me.prefs = { ...state.me.prefs, ...patch };
      },
    }),
  }),
}));

const bg = await import("./chatBackground.ts");

describe("chat backgrounds", () => {
  beforeEach(async () => {
    mem.clear();
    state.old = false;
    state.calls.length = 0;
    state.me.prefs = {};
    for (const a of state.agents) a.settings = {};
  });

  it("saves the default in the person's prefs and the agent's own on the agent", async () => {
    // never chosen: Mist (Night in dark mode), so the glass has something to sit on
    expect(bg.backgroundFor("a1")).toEqual({ kind: "color", color: "#dfe4f3" });
    await bg.setDefaultBackground({ kind: "color", color: "#dfe4f3" });
    expect(state.calls.at(-1)).toEqual({ method: "PUT", path: "/api/me/prefs", body: { background: { kind: "color", color: "#dfe4f3" } } });
    expect(bg.backgroundFor("a1")).toEqual({ kind: "color", color: "#dfe4f3" });
    expect(bg.backgroundFor(null)).toEqual({ kind: "color", color: "#dfe4f3" });
    await bg.setAgentBackground("a1", { kind: "photo", url: "/api/files/f_1" });
    expect(state.calls.at(-1)).toEqual({ method: "PATCH", path: "/api/agents/a1", body: { settings: { background: { kind: "photo", url: "/api/files/f_1" } } } });
    expect(bg.backgroundFor("a1")).toEqual({ kind: "photo", url: "/api/files/f_1" });
    expect(bg.backgroundFor("a2")).toEqual({ kind: "color", color: "#dfe4f3" });
    // an agent's own None beats a default photo or colour
    await bg.setAgentBackground("a2", { kind: "none" });
    expect(bg.backgroundFor("a2")).toEqual({ kind: "none" });
    await bg.setAgentBackground("a1", null);
    expect(bg.agentBackground("a1")).toBeNull();
    expect(bg.backgroundFor("a1")).toEqual({ kind: "color", color: "#dfe4f3" });
    expect(mem.get("bubble.chat-background") ?? "{}").not.toContain("#dfe4f3");
  });

  it("keeps the choice on this device while the hub doesn't take it yet", async () => {
    state.old = true;
    await bg.setAgentBackground("a1", { kind: "color", color: "#e2f0e6" });
    await bg.setDefaultBackground({ kind: "color", color: "#f6efd9" });
    expect(bg.backgroundFor("a1")).toEqual({ kind: "color", color: "#e2f0e6" });
    expect(bg.backgroundFor("a2")).toEqual({ kind: "color", color: "#f6efd9" });
    // once the hub takes it, its copy wins and this device's is dropped
    state.old = false;
    await bg.setAgentBackground("a1", null);
    expect(bg.backgroundFor("a1")).toEqual({ kind: "color", color: "#f6efd9" });
    expect(JSON.parse(mem.get("bubble.chat-background")!).agents).toEqual({});
    await bg.setDefaultBackground({ kind: "none" });
    expect(JSON.parse(mem.get("bubble.chat-background")!)).toEqual({ agents: {} });
  });

  it("ignores anything that isn't a colour, a hub photo or none", () => {
    state.me.prefs = { background: { kind: "photo", url: "https://elsewhere.example/x.png" } };
    state.agents[0].settings = { background: { kind: "color", color: "red;}" } };
    expect(bg.backgroundFor("a1")).toEqual(bg.DEFAULT_BACKGROUND);
    expect(bg.validBackground({ kind: "photo", url: "/api/files/../x" })).toBe(false);
  });

  it("shows Mist as Night in dark mode, dims other light colours, and leaves dark ones as they are", () => {
    expect(bg.backgroundCss({ kind: "color", color: "#dfe4f3" }, null)).toBe("#dfe4f3");
    expect(bg.backgroundCss({ kind: "color", color: "#dfe4f3" }, null, true)).toBe("#2a2d35");
    expect(bg.backgroundCss({ kind: "color", color: "#f3e3dc" }, null, true)).toContain("color-mix");
    expect(bg.backgroundCss({ kind: "color", color: "#1c1c1c" }, null, true)).toBe("#1c1c1c");
    expect(bg.backgroundCss({ kind: "none" }, null, true)).toBeNull();
  });

  it("uploads only photos", async () => {
    await expect(bg.uploadBackground({ type: "image/svg+xml" } as File)).rejects.toThrow(/photo/i);
    await expect(bg.uploadBackground({ type: "image/png" } as File)).resolves.toEqual({ kind: "photo", url: "/api/files/f_up" });
  });

  it("paints a colour or a loaded photo, nothing for none", () => {
    expect(bg.backgroundCss({ kind: "none" }, null)).toBeNull();
    expect(bg.backgroundCss({ kind: "color", color: "#dce9f7" }, null)).toBe("#dce9f7");
    expect(bg.backgroundCss({ kind: "color", color: "#dce9f7" }, null, true)).toContain("color-mix");
    expect(bg.backgroundCss({ kind: "photo", url: "/api/files/f" }, null)).toBeNull();
    expect(bg.backgroundCss({ kind: "photo", url: "/api/files/f" }, "blob:x")).toContain('url("blob:x")');
  });
});
