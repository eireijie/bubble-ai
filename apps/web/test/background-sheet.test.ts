import { describe, expect, it, vi } from "vitest";

vi.mock("../src/theme.ts", () => ({ motionReduced: () => false, THEMES: [], useAppearance: () => ({ resolvedMode: "light" }) }));

describe("background preview sheet", () => {
  it("offers 18 colours, two rows of nine", async () => {
    const { SHEET_SWATCHES } = await import("../src/components/BackgroundSheet.tsx");
    expect(SHEET_SWATCHES).toHaveLength(18);
    expect(new Set(SHEET_SWATCHES).size).toBe(18);
    for (const c of SHEET_SWATCHES) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("moves a colour lighter to the left and deeper to the right, never all the way", async () => {
    const { shadeColor } = await import("../src/components/BackgroundSheet.tsx");
    expect(shadeColor("#a98bf5", 50)).toBe("#a98bf5");
    const light = shadeColor("#a98bf5", 0);
    const deep = shadeColor("#a98bf5", 100);
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    expect(lum(light)).toBeGreaterThan(lum("#a98bf5"));
    expect(lum(deep)).toBeLessThan(lum("#a98bf5"));
    expect(light).not.toBe("#ffffff");
    expect(deep).not.toBe("#000000");
    // what is saved is a plain colour the chat background accepts
    const { validBackground } = await import("../src/chatBackground.ts");
    expect(validBackground({ kind: "color", color: deep })).toBe(true);
  });

  it("starts deeper in dark mode, so a pick reads as a dark tone there", async () => {
    const { shadeStart } = await import("../src/components/BackgroundSheet.tsx");
    expect(shadeStart(false)).toBe(50);
    expect(shadeStart(true)).toBeGreaterThan(50);
  });
});

describe("profile memory graph", () => {
  it("keeps the agent's own notes (not its personality) and what they link to", async () => {
    const { agentGraph } = await import("../src/views/AgentProfile.tsx");
    const node = (id: string, path: string | null) => ({ id, path, title: id, kind: "agents" as const, type: null, tags: [], updatedAt: null, links: 0, inbound: 0 });
    const g = {
      nodes: [node("a", "agents/ag1/Dentist.md"), node("s", "agents/ag1/SOUL.md"), node("you", "people/you.md"), node("other", "agents/ag2/Gym.md"), node("far", "shared/Far.md")],
      edges: [
        { source: "a", target: "you" },
        { source: "other", target: "far" },
      ],
    };
    const out = agentGraph("ag1", g);
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["a", "you"]);
    expect(out.edges).toEqual([{ source: "a", target: "you" }]);
    expect(agentGraph("nobody", g)).toEqual({ nodes: [], edges: [] });
  });
});
