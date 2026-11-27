import { describe, expect, it, vi } from "vitest";
import { FEATURE_PRESETS } from "@bubble-ai/core";

// the settings pages read browser state when their modules load; the list itself doesn't need it
vi.mock("../src/theme.ts", () => ({ motionReduced: () => false, THEMES: [], useAppearance: () => ({}) }));
const { SHEET_IDS } = await import("../src/views/SettingsView.tsx");
const { SETTINGS_PAGES } = await import("../src/router.ts");
const { FIVE, FIVE_LABEL, ROWS, fivePages, settingsLanding } = await import("../src/views/settings/map.ts");

describe("settings navigation", () => {
  it("is seven pages: You, Agents, Mods, Computers, Privacy and data, About, Learn Bubble AI", () => {
    expect(fivePages(false, FEATURE_PRESETS.everything).map((p) => FIVE_LABEL[p])).toEqual(["You", "Agents", "Mods", "Computers", "Privacy and data", "About", "Learn Bubble AI"]);
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
  it("has the profile's five tabs, in the canvas's order", async () => {
    const { PROFILE_TABS, PROFILE_TAB_TITLES } = await import("../src/views/AgentProfile.tsx");
    expect(PROFILE_TABS.map((t) => PROFILE_TAB_TITLES[t])).toEqual(["Activity", "Library", "Computer", "Voice", "Background", "Settings"]);
  });

  it("lands every address on its tab: old tabs and the six groups' rows open their part under Settings", async () => {
    const { profilePlace } = await import("../src/views/AgentProfile.tsx");
    const { AGENT_TABS } = await import("../src/router.ts");
    const tabs = Object.fromEntries(AGENT_TABS.map((t) => [t, profilePlace(t).tab]));
    expect(tabs).toMatchObject({ overview: "activity", runs: "activity", library: "library", screen: "computer", voice: "voice", wallpaper: "background", settings: "settings", model: "settings", computer: "settings", permissions: "settings", memory: "settings", look: "settings", remove: "settings" });
    expect(profilePlace(null)).toEqual({ tab: "activity", part: null });
  });

  it("opens a part for every Settings row; the tabs themselves and Remove (a confirm) are not parts", async () => {
    const { profilePlace } = await import("../src/views/AgentProfile.tsx");
    const { AGENT_TABS } = await import("../src/router.ts");
    expect(AGENT_TABS.filter((t) => !profilePlace(t).part)).toEqual(["overview", "library", "screen", "voice", "wallpaper", "settings", "runs", "remove"]);
    for (const t of AGENT_TABS) expect(profilePlace(t).part ?? t).toBe(t);
  });

  it("opens the chat's old panel tabs on the matching place in the profile", async () => {
    const { PANEL_PROFILE_TAB, panelSheet } = await import("../src/components/AgentPanel.tsx");
    expect(PANEL_PROFILE_TAB).toEqual({ details: "overview", computer: "screen", thinks: "model", can: "apps", asks: "permissions", knows: "memory", more: "settings" });
    expect(panelSheet("nonsense")).toBe("details");
  });

  it("says Model, Harness, Computer, Apps and skills, Permissions and Memory, not the old cute names", async () => {
    const { TAB_TITLES } = await import("../src/views/AgentSections.tsx");
    expect([TAB_TITLES.model, TAB_TITLES.harness, TAB_TITLES.effort, TAB_TITLES.computer, TAB_TITLES.apps, TAB_TITLES.permissions, TAB_TITLES.memory, TAB_TITLES.access]).toEqual(["Model", "Harness", "Effort", "Computer", "Apps and skills", "Permissions", "Memory", "Who can message"]);
    expect(Object.values(TAB_TITLES).join(" ")).not.toMatch(/Thinks with|Works on|Can use|Asks first|Knows/);
  });

  it("names every tab, for a part's title", async () => {
    const { TAB_TITLES } = await import("../src/views/AgentSections.tsx");
    const { AGENT_TABS } = await import("../src/router.ts");
    for (const t of AGENT_TABS) expect(TAB_TITLES[t]).toBeTruthy();
  });
});
