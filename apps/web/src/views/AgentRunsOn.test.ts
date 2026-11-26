import { describe, expect, it, vi } from "vitest";

vi.mock("../theme.ts", () => ({ motionReduced: () => false, useMotionReduced: () => false }));
import { currentPlace, places } from "./AgentRunsOn.tsx";
import { href, parseRoute } from "../router.ts";

const mac = { id: "mac", name: "Mac", online: true, mine: true, shared: false, capabilities: { vm: { ok: true }, screen: { ok: true, off: false } } } as any;
const box = { id: "box", name: "Box", online: false, mine: true, shared: false, capabilities: { vm: { ok: true }, screen: { ok: false, detail: "No screen" } } } as any;
const shared = { id: "sh", kind: "vm", nodeId: "mac", name: "Shared", agents: ["a2"], config: { shared: true } } as any;
const own = { id: "vm1", kind: "vm", nodeId: "mac", name: "Nova's computer", agents: ["a1"], config: {} } as any;
const cloud = { id: "o1", kind: "orgo", nodeId: null, name: "Cloud desk", agents: [], config: {} } as any;
const agents = [{ id: "a1", handle: "nova" }, { id: "a2", handle: "milo" }];
const agent = { id: "a1", computerId: null as string | null, nodeId: "mac" as string | null, settings: {} as any };
const keys = (o: Parameters<typeof places>[0]) => places(o).map((p) => p.key);

describe("Runs on", () => {
  it("is one list: the shared computer, then its own computer, my screen or no computer", () => {
    const list = places({ agent, nodes: [mac], computers: [shared], agents, sharedId: "sh", isOwner: true, advanced: false });
    expect(list.map((p) => p.title)).toEqual(["Shared computer", "Its own computer", "My screen", "No computer"]);
    expect(list[0].sub).toBe("With @milo");
  });

  it("names the device when there is more than one, and greys out a screen that can't be used", () => {
    const list = places({ agent, nodes: [mac, box], computers: [], agents, sharedId: null, isOwner: false, advanced: false });
    expect(list.map((p) => p.key)).toEqual(["own:mac", "screen:mac", "none:mac", "own:box", "screen:box", "none:box"]);
    expect(list.find((p) => p.key === "screen:box")!.disabled).toBe(true);
    expect(list.find((p) => p.key === "own:box")!.title).toBe("Its own computer on Box");
  });

  it("marks where it is now", () => {
    expect(currentPlace({ ...agent, computerId: "sh" }, [shared], "sh")).toBe("shared");
    expect(currentPlace({ ...agent, computerId: "vm1" }, [own], null)).toBe("own:mac");
    expect(currentPlace({ ...agent, settings: { headless: true } }, [], null)).toBe("none:mac");
    expect(currentPlace(agent, [], null)).toBeNull();
  });

  it("lists other computers only in Advanced, but always the one it's on", () => {
    expect(keys({ agent, nodes: [mac], computers: [cloud], agents, sharedId: null, isOwner: true, advanced: false })).not.toContain("c:o1");
    expect(keys({ agent, nodes: [mac], computers: [cloud], agents, sharedId: null, isOwner: true, advanced: true })).toContain("c:o1");
    expect(keys({ agent: { ...agent, computerId: "o1" }, nodes: [mac], computers: [cloud], agents, sharedId: null, isOwner: true, advanced: false })).toContain("c:o1");
  });
});

describe("adding for one agent", () => {
  it("opens the marketplace with the agent picked, and back", () => {
    expect(href({ view: "marketplace", forAgent: "a1" })).toBe("#/marketplace/for/a1");
    expect(parseRoute("#/marketplace/for/a1")).toEqual({ view: "marketplace", section: null, forAgent: "a1" });
    expect(parseRoute("#/marketplace/skills/for/a1")).toEqual({ view: "marketplace", section: "skills", forAgent: "a1" });
    expect(parseRoute("#/marketplace/apps")).toEqual({ view: "marketplace", section: "apps" });
  });
});
