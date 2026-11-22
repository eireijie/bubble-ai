import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CreateAgent } from "../src/views/CreateAgent.tsx";
import { useStore } from "../src/store.ts";
import { HARNESSES, type Agent } from "@wisp/core";
import { HarnessLogo } from "../src/components/HarnessLogo.tsx";

vi.mock("../src/theme.ts", () => ({ motionReduced: () => false, useMotionReduced: () => false }));

const initial = useStore.getState();
afterEach(() => useStore.setState(initial, true));

describe("add agent onboarding", () => {
  it("is one small sheet: its ghost, a suggested name, one line and Create, with the rest behind More options", () => {
    const html = renderToStaticMarkup(
      createElement(CreateAgent, { nodes: [], onClose() {} }),
    );
    expect(html).toContain('aria-label="New agent"');
    // a click on the ghost gives it another look
    expect(html).toContain('aria-label="Change its look"');
    expect(html).toMatch(/aria-label="Name"[^>]*value="[A-Z][a-z]+"/);
    expect(html).toContain("It says hello and sets itself up in the chat.");
    expect(html).toContain("More options");
    expect(html).toContain("Make it a team");
    // what the old form showed at once stays folded until More options (CreateAgent.test.ts opens it)
    for (const t of ["What it does", "Instructions", "AI and computer", "Use my defaults", "Customize", "Edit look", "Bring one in", "Shuffle"]) expect(html).not.toContain(t);
    // templates live on their own page now, not in this form
    expect(html).not.toContain("Start from");
    // nothing to create until your defaults have loaded
    expect(html).toMatch(/disabled=""[^>]*>(<!-- -->)?Create</);
    // no emoji tiles for roles
    for (const t of ["🧭", "📥"]) expect(html).not.toContain(t);
  });

  it("can open before any device or agent is connected", () => {
    useStore.setState({ agents: [], computers: [] });
    expect(() =>
      renderToStaticMarkup(
        createElement(CreateAgent, { nodes: [], onClose() {} }),
      ),
    ).not.toThrow();
  });

  it("provides a source logo for each named built-in harness", () => {
    for (const h of HARNESSES.filter((h) => h.id !== "custom")) {
      const html = renderToStaticMarkup(
        createElement(HarnessLogo, { harness: h.id as Agent["harness"] }),
      );
      expect(html, h.id).toContain("/harnesses/");
    }
  });
});

describe("creating an agent from the team builder", () => {
  it("asks for an AI in the form when the defaults name none, instead of failing with 'pick a harness'", async () => {
    const { defaultsNeedPicking } = await import("../src/views/CreateAgent.tsx");
    expect(defaultsNeedPicking({ harness: null, model: null, computer: "none", nodeId: null })).toBe(true);
    expect(defaultsNeedPicking("error")).toBe(true);
    expect(defaultsNeedPicking({ harness: "claude-code", model: null, computer: "none", nodeId: null })).toBe(false);
    expect(defaultsNeedPicking(null)).toBe(false);
  });

  it("opens the dialog even when the devices never load", async () => {
    const { devicesToShow } = await import("../src/team/NewAgent.tsx");
    expect(devicesToShow(null, false)).toBeNull();
    expect(devicesToShow(null, true)).toEqual([]);
    expect(devicesToShow([{ id: "a" }], false)).toEqual([{ id: "a" }]);
  });
});
