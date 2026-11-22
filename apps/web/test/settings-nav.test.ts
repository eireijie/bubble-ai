import { describe, expect, it, vi } from "vitest";
import { FEATURE_PRESETS } from "@wisp/core";

// the settings pages read browser state when their modules load; the list itself doesn't need it
vi.mock("../src/theme.ts", () => ({ motionReduced: () => false, THEMES: [], useAppearance: () => ({}) }));
const { settingsNav, settingsLinks } = await import("../src/views/SettingsView.tsx");
const { SETTINGS_PAGES } = await import("../src/router.ts");
const ids = (sections: ReturnType<typeof settingsNav>) => sections.map((s) => [s.section, s.pages.map((p) => p.id)]);

describe("settings navigation", () => {
  it("groups every page under You, Workspace, Agents, Devices and More", () => {
    expect(ids(settingsNav(false, FEATURE_PRESETS.everything))).toEqual([
      ["You", ["profile", "notifications", "appearance", "preferences", "voice", "buddy", "security"]],
      ["Workspace", ["general", "people", "usage"]],
      ["Agents", ["agents", "agent-defaults", "harnesses", "logins", "apps", "skills", "connections", "memory"]],
      ["Devices", ["devices", "access"]],
      ["More", ["data", "updates"]],
    ]);
  });

  it("keeps the places that do things (Memory, Tasks, Marketplace, Mods, Help) out of Settings", () => {
    const labels = settingsNav(false, FEATURE_PRESETS.everything).flatMap((s) => [...s.pages.map((p) => p.label), ...settingsLinks(s.section, false, FEATURE_PRESETS.everything).map((l) => l.label)]);
    for (const l of ["Tasks", "Marketplace", "Mods", "Help"]) expect(labels).not.toContain(l);
    expect(settingsLinks("You", false, FEATURE_PRESETS.everything)).toEqual([]);
  });

  it("still opens every route (SETTINGS_PAGES) somewhere", () => {
    // Everything leaves out mods that need setting up first (Storage, Apple); with every mod on, every page shows
    const pages = settingsNav(false, { ...FEATURE_PRESETS.everything, storage: true, apple: true }).flatMap((s) => s.pages.map((p) => p.id));
    expect([...pages].sort()).toEqual([...SETTINGS_PAGES].sort());
  });

  it("leaves out pages guests can't use", () => {
    const pages = settingsNav(true, FEATURE_PRESETS.everything).flatMap((s) => s.pages.map((p) => p.id));
    for (const id of ["agents", "agent-defaults", "devices", "harnesses", "logins", "apps", "skills", "connections", "voice", "people", "general"]) expect(pages).not.toContain(id);
  });

  it("hides pages for features that are off, and a section left empty", () => {
    const off = { ...FEATURE_PRESETS.everything, invite: false, background: false };
    const nav = settingsNav(false, off);
    const pages = nav.flatMap((s) => s.pages.map((p) => p.id));
    expect(pages).toContain("voice");
    expect(pages).not.toContain("people");
    expect(pages).not.toContain("usage");
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
