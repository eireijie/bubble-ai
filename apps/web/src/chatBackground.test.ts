import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });

const bg = await import("./chatBackground.ts");

describe("chat backgrounds", () => {
  beforeEach(() => {
    mem.clear();
    bg.setDefaultBackground({ kind: "none" });
  });

  it("uses the default, then the agent's own over it, and null puts it back", () => {
    expect(bg.backgroundFor("a1")).toEqual({ kind: "none" });
    bg.setDefaultBackground({ kind: "color", color: "#dce9f7" });
    expect(bg.backgroundFor("a1")).toEqual({ kind: "color", color: "#dce9f7" });
    expect(bg.backgroundFor(null)).toEqual({ kind: "color", color: "#dce9f7" });
    bg.setAgentBackground("a1", { kind: "photo", url: "/api/files/f_1" });
    expect(bg.backgroundFor("a1")).toEqual({ kind: "photo", url: "/api/files/f_1" });
    expect(bg.backgroundFor("a2")).toEqual({ kind: "color", color: "#dce9f7" });
    bg.setAgentBackground("a1", null);
    expect(bg.backgroundFor("a1")).toEqual({ kind: "color", color: "#dce9f7" });
  });

  it("ignores anything that isn't a colour, a hub photo or none", () => {
    bg.setDefaultBackground({ kind: "photo", url: "https://elsewhere.example/x.png" });
    bg.setAgentBackground("a1", { kind: "color", color: "red;}" });
    expect(bg.backgroundFor("a1")).toEqual({ kind: "none" });
  });

  it("paints a colour or a loaded photo, nothing for none", () => {
    expect(bg.backgroundCss({ kind: "none" }, null)).toBeNull();
    expect(bg.backgroundCss({ kind: "color", color: "#dce9f7" }, null)).toBe("#dce9f7");
    expect(bg.backgroundCss({ kind: "color", color: "#dce9f7" }, null, true)).toContain("color-mix");
    expect(bg.backgroundCss({ kind: "photo", url: "/api/files/f" }, null)).toBeNull();
    expect(bg.backgroundCss({ kind: "photo", url: "/api/files/f" }, "blob:x")).toContain('url("blob:x")');
  });
});
