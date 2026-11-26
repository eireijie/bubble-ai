import { describe, expect, it } from "vitest";
import { FEATURE_PRESETS } from "@bubble-ai/core";
import { SETTINGS_PAGES, href, parseRoute, type SettingsPage } from "../../router.ts";
import { FIVE, FIVE_ROUTE, ROUTE_ROW, ROWS, fivePages, pageRows, rowById, rowTarget, searchableRows, settingsLanding, type Five } from "./map.ts";

const everything = { ...FEATURE_PRESETS.everything, storage: true, apple: true };

describe("where the settings routes land", () => {
  // route, the page it opens, the row it shows (null = the top of the page), opened as a sheet
  const expected: [SettingsPage, Five, string | null, boolean][] = [
    ["profile", "you", null, false],
    ["preferences", "you", "enter", false],
    ["notifications", "you", "notifications", true],
    ["appearance", "you", "appearance", false],
    ["voice", "you", "voice", true],
    ["buddy", "you", "buddy", false],
    ["agents", "agents", null, false],
    ["agent-defaults", "agents", "thinks", true],
    ["harnesses", "agents", "tools", true],
    ["usage", "agents", "usage", true],
    ["logins", "agents", "logins", true],
    ["storage", "mods", "storage", true],
    ["apple", "mods", "apple", true],
    ["apps", "agents", "apps", true],
    ["skills", "agents", "skills", true],
    ["connections", "agents", "outside", true],
    ["mods", "mods", null, false],
    ["devices", "computers", null, false],
    ["access", "computers", "away", false],
    ["security", "privacy", null, false],
    ["people", "privacy", "people", true],
    ["memory", "privacy", "memory-access", true],
    ["data", "privacy", "backup", true],
    ["general", "privacy", "workspace", true],
    ["updates", "about", null, false],
    ["learn", "learn", null, false],
  ];

  it("covers every route, each on the page that holds its content now", () => {
    expect(expected.map(([r]) => r).sort()).toEqual([...SETTINGS_PAGES].sort());
    for (const [route, page, row, sheet] of expected) expect(settingsLanding(route), route).toEqual({ page, row, sheet });
  });

  it("names a real row for every route, and that row hangs under the route", () => {
    for (const route of SETTINGS_PAGES) expect(rowById(ROUTE_ROW[route])?.route, route).toBe(route);
  });

  it("opens Settings on You when no page is named", () => {
    expect(settingsLanding(null)).toEqual({ page: "you", row: null, sheet: false });
  });

  it("opens one row by its id after the route, or as a sheet", () => {
    expect(settingsLanding("agents", "lead")).toEqual({ page: "agents", row: "lead", sheet: false });
    expect(settingsLanding("security", "password")).toEqual({ page: "privacy", row: "password", sheet: true });
    expect(settingsLanding("harnesses", "accounts")).toEqual({ page: "agents", row: "accounts", sheet: true });
    expect(settingsLanding("appearance", "theme")).toEqual({ page: "you", row: "theme", sheet: false });
  });

  it("leaves anything else after the route to the sheet (a skill, a storage connection)", () => {
    expect(settingsLanding("skills", "s1")).toEqual({ page: "agents", row: "skills", sheet: true });
    expect(settingsLanding("storage", "conn-9")).toMatchObject({ row: "storage", sheet: true });
  });
});

describe("settings rows", () => {
  it("each has its own id and an address that leads back to it", () => {
    expect(new Set(ROWS.map((r) => r.id)).size).toBe(ROWS.length);
    for (const r of ROWS) {
      const to = rowTarget(r);
      expect(settingsLanding(to.page, to.item).row, r.id).toBe(r.id);
      // and the address is one the router keeps whole
      expect(href(parseRoute(href({ view: "settings", ...to })))).toBe(href({ view: "settings", ...to }));
    }
  });

  it("puts every row on its page, within two clicks: nothing behind Show all", () => {
    const simple = { ...FEATURE_PRESETS.simple };
    for (const r of ROWS) {
      // a row only an off mod has (People) is reached by turning the mod on, on the Mods page
      if (r.feature && !simple[r.feature]) continue;
      expect(pageRows(r.page, false, simple).map((x) => x.id), r.id).toContain(r.id);
    }
  });

  it("lists every mod on the Mods page, Storage and Apple included, even while they're off", () => {
    const ids = pageRows("mods", false, FEATURE_PRESETS.simple).map((r) => r.id);
    expect(ids).toEqual(["mod-background", "mod-routines", "mod-teach", "mod-tasks", "storage", "apple", "mod-invite", "mod-remote", "mod-code"]);
    expect(searchableRows(false, FEATURE_PRESETS.simple).map((r) => r.id)).toEqual(expect.arrayContaining(["storage", "apple", "mod-background", "mod-tasks"]));
  });

  it("opens each page at its top by a route of its own", () => {
    for (const page of FIVE) expect(settingsLanding(FIVE_ROUTE[page])).toEqual({ page, row: null, sheet: false });
  });

  it("gives guests only what they can use: You, their password and sign-ins, About, Learn Bubble AI", () => {
    expect(fivePages(true, everything)).toEqual(["you", "privacy", "about", "learn"]);
    expect(pageRows("privacy", true, everything).map((r) => r.id)).toEqual(["password", "sessions"]);
    expect(fivePages(false, everything)).toEqual([...FIVE]);
  });

  it("leaves out rows whose mod is off", () => {
    const off = { ...everything, invite: false };
    expect(pageRows("privacy", false, off).map((r) => r.id)).not.toContain("people");
    expect(searchableRows(false, off).map((r) => r.id)).not.toContain("people");
    expect(pageRows("agents", false, off).map((r) => r.id)).toContain("usage");
  });

  it("lets search reach every row", () => {
    const ids = searchableRows(false, everything).map((r) => r.id);
    for (const id of ["clock", "text-size", "hops", "cloud", "obsidian", "hub", "storage", "apple"]) expect(ids).toContain(id);
  });
});
