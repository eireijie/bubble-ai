import { describe, expect, it, vi } from "vitest";
import { FEATURE_PRESETS } from "@bubble-ai/core";

// the settings pages read browser state when their modules load; the list itself doesn't need it
vi.mock("../src/theme.ts", () => ({ motionReduced: () => false, THEMES: [], useAppearance: () => ({}) }));
const { SHEET_IDS } = await import("../src/views/SettingsView.tsx");
const { SETTINGS_PAGES } = await import("../src/router.ts");
const { FIVE, FIVE_LABEL, ROWS, fivePages, settingsLanding } = await import("../src/views/settings/map.ts");

describe("settings navigation", () => {
  it("is six pages: You, Agents, Computers, Privacy and data, About, Learn Bubble AI", () => {
    expect(fivePages(false, FEATURE_PRESETS.everything).map((p) => FIVE_LABEL[p])).toEqual(["You", "Agents", "Computers", "Privacy and data", "About", "Learn Bubble AI"]);
  });

  it("has a sheet to open for every row that says it opens one, and no others", () => {
    expect([...SHEET_IDS].sort()).toEqual(ROWS.filter((r) => r.sheet).map((r) => r.id).sort());
  });

  it("still opens every route (SETTINGS_PAGES) on one of the six", () => {
    for (const page of SETTINGS_PAGES) expect(FIVE).toContain(settingsLanding(page).page);
  });

  it("keeps the places that do things (Memory, Tasks, Marketplace, Mods) out of Settings", () => {
    const labels = ROWS.map((r) => r.label);
    for (const l of ["Memory", "Tasks", "Marketplace", "Mods"]) expect(labels).not.toContain(l);
  });

  it("leaves out the pages guests can't use", () => {
    expect(fivePages(true, FEATURE_PRESETS.everything)).toEqual(["you", "privacy", "about", "learn"]);
  });
});

describe("old settings routes", () => {
  it("land on the page that holds them now", async () => {
    const { parseRoute } = await import("../src/router.ts");
    for (const [old, now] of [["models", "harnesses"], ["runtimes", "harnesses"], ["computers", "devices"], ["mobile", "devices"]]) expect(parseRoute(`#/settings/${old}`)).toMatchObject({ view: "settings", page: now });
  });
});

describe("agent page", () => {
  it("has the agent panel's six groups, in its order", async () => {
    const { AGENT_GROUPS, GROUP_TITLES } = await import("../src/views/AgentSettings.tsx");
    expect(AGENT_GROUPS.map((g) => GROUP_TITLES[g])).toEqual(["Thinks with", "Works on", "Can use", "Asks first", "Knows", "More"]);
  });

  it("lands every old tab's address in its group, and the overview on the page's top", async () => {
    const { agentPlace } = await import("../src/views/AgentSettings.tsx");
    const { AGENT_TABS } = await import("../src/router.ts");
    const groups = Object.fromEntries(AGENT_TABS.map((t) => [t, agentPlace(t).group]));
    expect(groups).toEqual({
      overview: null,
      model: "thinks",
      device: "works",
      computer: "works",
      skills: "can",
      apps: "can",
      permissions: "asks",
      memory: "knows",
      soul: "knows",
      instructions: "knows",
      look: "more",
      access: "more",
      background: "more",
      routines: "more",
      connect: "more",
      runs: "more",
      remove: "more",
    });
    expect(agentPlace(null)).toEqual({ group: null, part: null });
  });

  it("opens a part for the tabs that need room, and the group's own rows for the rest", async () => {
    const { agentPlace } = await import("../src/views/AgentSettings.tsx");
    const { AGENT_TABS } = await import("../src/router.ts");
    expect(AGENT_TABS.filter((t) => agentPlace(t).part)).toEqual(["look", "soul", "instructions", "access", "background", "routines", "connect", "runs", "remove"]);
    for (const t of AGENT_TABS) expect(agentPlace(t).part ?? t).toBe(t);
  });

  it("names every tab, for a part's title", async () => {
    const { TAB_TITLES } = await import("../src/views/AgentSections.tsx");
    const { AGENT_TABS } = await import("../src/router.ts");
    for (const t of AGENT_TABS) expect(TAB_TITLES[t]).toBeTruthy();
  });
});
