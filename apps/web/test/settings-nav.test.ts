import { describe, expect, it, vi } from "vitest";
import { FEATURE_PRESETS } from "@wisp/core";

// the settings pages read browser state when their modules load; the list itself doesn't need it
vi.mock("../src/theme.ts", () => ({ motionReduced: () => false, THEMES: [], useAppearance: () => ({}) }));
const { SHEET_IDS } = await import("../src/views/SettingsView.tsx");
const { SETTINGS_PAGES } = await import("../src/router.ts");
const { FIVE, FIVE_LABEL, ROWS, fivePages, settingsLanding } = await import("../src/views/settings/map.ts");

describe("settings navigation", () => {
  it("is five pages: You, Agents, Computers, Privacy and data, About", () => {
    expect(fivePages(false, FEATURE_PRESETS.everything).map((p) => FIVE_LABEL[p])).toEqual(["You", "Agents", "Computers", "Privacy and data", "About"]);
  });

  it("has a sheet to open for every row that says it opens one, and no others", () => {
    expect([...SHEET_IDS].sort()).toEqual(ROWS.filter((r) => r.sheet).map((r) => r.id).sort());
  });

  it("still opens every route (SETTINGS_PAGES) on one of the five", () => {
    for (const page of SETTINGS_PAGES) expect(FIVE).toContain(settingsLanding(page).page);
  });

  it("keeps the places that do things (Memory, Tasks, Marketplace, Mods) out of Settings", () => {
    const labels = ROWS.map((r) => r.label);
    for (const l of ["Memory", "Tasks", "Marketplace", "Mods"]) expect(labels).not.toContain(l);
  });

  it("leaves out the pages guests can't use", () => {
    expect(fivePages(true, FEATURE_PRESETS.everything)).toEqual(["you", "privacy", "about"]);
  });
});

describe("old settings routes", () => {
  it("land on the page that holds them now", async () => {
    const { parseRoute } = await import("../src/router.ts");
    for (const [old, now] of [["models", "harnesses"], ["runtimes", "harnesses"], ["computers", "devices"], ["mobile", "devices"]]) expect(parseRoute(`#/settings/${old}`)).toMatchObject({ view: "settings", page: now });
  });
});

describe("agent settings navigation", () => {
  it("lists the sections, and every other tab opens from Edit, Computer or Remove", async () => {
    const { agentSections } = await import("../src/views/AgentSettings.tsx");
    const { AGENT_TABS } = await import("../src/router.ts");
    expect(agentSections()).toEqual(["overview", "model", "computer", "access", "routines", "background", "memory", "skills", "apps", "permissions", "connect", "runs", "look"]);
    expect(AGENT_TABS.filter((t) => !agentSections().includes(t))).toEqual(["soul", "instructions", "device", "remove"]);
  });
});
