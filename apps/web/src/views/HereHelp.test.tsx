import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FEATURE_PRESETS, type Agent } from "@wisp/core";
import { HereView, cronLine } from "./HereView.tsx";
import { HelpView } from "./HelpView.tsx";
import { pastedInviteCode } from "./AuthScreen.tsx";
import { setReadyItem } from "../onboarding.ts";
import { useStore } from "../store.ts";

vi.mock("../api.ts", () => ({ api: vi.fn(() => new Promise(() => {})) }));
vi.mock("../theme.ts", () => ({ motionReduced: () => false, useMotionReduced: () => false }));
// a static render reads a store's first state: read the current one, so a test can sign someone in
vi.mock("../store.ts", async (original) => {
  const real = await original<typeof import("../store.ts")>();
  return { ...real, useStore: Object.assign((select: (s: unknown) => unknown) => select(real.useStore.getState()), real.useStore) };
});
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
vi.stubGlobal("location", { origin: "http://localhost:4747", protocol: "http:", hostname: "localhost", hash: "" });
const me = { user: { id: "u1", name: "Sam Rivera" }, workspace: { id: "w1", name: "Sam's Wisp" }, role: "owner" };
const juno = { id: "a1", name: "Juno", handle: "juno", harness: "claude-code", nodeId: null, computerId: null, createdAt: "2026-11-01T00:00:00Z", settings: {} } as unknown as Agent;
beforeEach(() => {
  mem.clear();
  useStore.setState({ me: { ...me, features: { ...FEATURE_PRESETS.simple } } as never, agents: [juno] });
});

describe("Setup (#/here)", () => {
  it("lists the four things the first run no longer asks, each one line and one button", () => {
    const html = renderToStaticMarkup(createElement(HereView, {}));
    for (const line of ["Add your phone", "Set up apps", "Use Wisp away from home", "Let me get to know you"]) expect(html).toContain(line);
    for (const button of ["Pair", "Add", "Set up", "Start"]) expect(html).toContain(`>${button}</button>`);
    expect(html.match(/<button/g)).toHaveLength(4);
    // nothing turned on yet: no empty section, no progress count, no thank-you card
    expect(html).not.toMatch(/Turned on|ready|Thanks for trying/);
  });
  it("ticks what's done and keeps its button", () => {
    setReadyItem("w1", "phone", true);
    setReadyItem("w1", "apps", "later");
    const html = renderToStaticMarkup(createElement(HereView, {}));
    expect(html.match(/aria-label="Done"/g)).toHaveLength(1);
    expect(html.match(/<button/g)).toHaveLength(4);
  });
  it("lists a mod that was turned on, with Undo, for an owner only", () => {
    useStore.setState({ me: { ...me, features: { ...FEATURE_PRESETS.simple, tasks: true } } as never });
    const html = renderToStaticMarkup(createElement(HereView, {}));
    expect(html).toContain("Turned on");
    expect(html).toContain("Tasks board mod");
    expect(html).toContain(">Undo</button>");
    useStore.setState({ me: { ...me, role: "member", features: { ...FEATURE_PRESETS.simple, tasks: true } } as never });
    expect(renderToStaticMarkup(createElement(HereView, {}))).not.toContain("Undo");
  });
  it("says a schedule in a few words", () => {
    expect(cronLine("0 8 * * *")).toBe("Every day at 08:00");
    expect(cronLine("30 7 * * 1-5")).toBe("Weekdays at 07:30");
    expect(cronLine("*/5 * * * *")).toBe("On a schedule");
    expect(cronLine(null)).toBe("When you run it");
  });
});

describe("Help", () => {
  it("is short: ask your agent first, then the fixes, the welcome and reporting a problem", () => {
    const html = renderToStaticMarkup(createElement(HelpView, {}));
    const at = (text: string) => html.indexOf(text);
    expect(at("Ask Juno")).toBeGreaterThan(-1);
    expect(at("Ask Juno")).toBeLessThan(at("My agent isn&#x27;t answering"));
    expect(at("My agent isn&#x27;t answering")).toBeLessThan(at("See the welcome again"));
    expect(at("See the welcome again")).toBeLessThan(at("Report a problem"));
    expect(html).toContain('href="#/welcome/intro"');
    expect(html).toContain("You have an agent: Juno");
    // the glossary, the examples and the setup progress are gone
    expect(html).not.toMatch(/Words you|What can Wisp do|steps done|Harness|Continue setup/);
  });
  it("offers to make an agent when there is none, with the fix", () => {
    useStore.setState({ agents: [] });
    const html = renderToStaticMarkup(createElement(HelpView, {}));
    expect(html).toContain("Make your agent");
    expect(html).toContain("Fix this");
  });
});

describe("joining by invite", () => {
  it("takes a pasted link or the code itself, and nothing else", () => {
    expect(pastedInviteCode(" https://wisp.example.com/#/join/abc-123 ")).toBe("abc-123");
    expect(pastedInviteCode("abc-123")).toBe("abc-123");
    expect(pastedInviteCode("not a link")).toBeNull();
    expect(pastedInviteCode("")).toBeNull();
  });
});
