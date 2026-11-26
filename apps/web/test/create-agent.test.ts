import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CreateAgent } from "../src/views/CreateAgent.tsx";
import { useStore } from "../src/store.ts";
import { HARNESSES, type Agent } from "@bubble-ai/core";
import { HarnessLogo } from "../src/components/HarnessLogo.tsx";

vi.mock("../src/theme.ts", () => ({ motionReduced: () => false, useMotionReduced: () => false }));

const initial = useStore.getState();
afterEach(() => useStore.setState(initial, true));

describe("add agent onboarding", () => {
  it("is one sheet, filled in: look rows, template, role and AI in view, the rest under More options", () => {
    const html = renderToStaticMarkup(
      createElement(CreateAgent, { nodes: [], onClose() {} }),
    );
    expect(html).toContain('aria-label="New agent"');
    // a click on the bubble, or the shuffle by its name, gives it another look
    expect(html).toContain('aria-label="Change its look"');
    expect(html).toContain('aria-label="Shuffle its look"');
    expect(html).toMatch(/aria-label="Name"[^>]*value="[A-Z][a-z]+"/);
    // its look as seven rows, every choice a small bubble wearing it
    for (const row of ["Shape", "Colour", "Eyes", "Mouth", "Hat", "Wear", "Motion"]) expect(html).toContain(`role="radiogroup" aria-label="${row}"`);
    for (const t of ['aria-label="Start from"', "What it does", 'aria-label="AI"', 'aria-label="Model"', 'aria-label="Effort"', "More options", "Make it a team", "Bring one in"]) expect(html).toContain(t);
    // folded until opened; the closed row says what's picked
    for (const t of ['aria-label="Instructions"', 'aria-label="Computer"', ">Apps<", ">Skills<", "Use my defaults", "Customize"]) expect(html).not.toContain(t);
    expect(html).toContain('aria-expanded="false"');
    // nothing to create until your defaults have loaded
    expect(html).toMatch(/disabled=""[^>]*>(<!-- -->)?Create</);
    // no emoji tiles for templates
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
