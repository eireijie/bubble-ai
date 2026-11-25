import { describe, expect, it } from "vitest";
import { FEATURE_PRESETS } from "@wisp/core";
import { SETTINGS_PAGES, href, parseRoute, type SettingsPage } from "../../router.ts";
import { FIVE, FIVE_ROUTE, ROUTE_ROW, ROWS, fivePages, pageRows, rowById, rowTarget, searchableRows, settingsLanding, type Five } from "./map.ts";

const everything = { ...FEATURE_PRESETS.everything, storage: true, apple: true };

describe("where the 24 settings routes land", () => {
  // route, the page it opens, the row it shows (null = the top of the page), opened as a sheet, under Show all
  const expected: [SettingsPage, Five, string | null, boolean, boolean][] = [
    ["profile", "you", null, false, false],
    ["preferences", "you", "enter", false, true],
    ["notifications", "you", "notifications", true, false],
    ["appearance", "you", "appearance", false, false],
    ["voice", "you", "voice", true, true],
    ["buddy", "you", "buddy", false, true],
    ["agents", "agents", null, false, false],
    ["agent-defaults", "agents", "thinks", true, false],
    ["harnesses", "agents", "tools", true, true],
    ["usage", "agents", "usage", true, false],
    ["logins", "agents", "logins", true, true],
    ["storage", "agents", "storage", true, false],
    ["apple", "agents", "apple", true, false],
    ["apps", "agents", "apps", true, true],
    ["skills", "agents", "skills", true, true],
    ["connections", "agents", "outside", true, true],
    ["devices", "computers", null, false, false],
    ["access", "computers", "away", false, false],
    ["security", "privacy", null, false, false],
    ["people", "privacy", "people", true, false],
    ["memory", "privacy", "memory-access", true, false],
    ["data", "privacy", "backup", true, false],
    ["general", "privacy", "workspace", true, true],
    ["updates", "about", null, false, false],
    ["vault", "privacy", "vault", true, false],
  ];

  it("covers every route, each on the page that holds its content now", () => {
    expect(expected.map(([r]) => r).sort()).toEqual([...SETTINGS_PAGES].sort());
    for (const [route, page, row, sheet, all] of expected) expect(settingsLanding(route), route).toEqual({ page, row, sheet, all });
  });

  it("names a real row for every route, and that row hangs under the route", () => {
    for (const route of SETTINGS_PAGES) expect(rowById(ROUTE_ROW[route])?.route, route).toBe(route);
  });

  it("opens Settings on You when no page is named", () => {
    expect(settingsLanding(null)).toEqual({ page: "you", row: null, sheet: false, all: false });
  });

  it("opens one row by its id after the route, under Show all or as a sheet", () => {
    expect(settingsLanding("agents", "lead")).toEqual({ page: "agents", row: "lead", sheet: false, all: true });
    expect(settingsLanding("security", "password")).toEqual({ page: "privacy", row: "password", sheet: true, all: false });
    expect(settingsLanding("harnesses", "accounts")).toEqual({ page: "agents", row: "accounts", sheet: true, all: false });
    expect(settingsLanding("appearance", "theme")).toEqual({ page: "you", row: "theme", sheet: false, all: true });
  });

  it("leaves anything else after the route to the sheet (a skill, a storage connection)", () => {
    expect(settingsLanding("skills", "s1")).toEqual({ page: "agents", row: "skills", sheet: true, all: true });
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

  it("shows 4 to 7 by default on every page, the rest under Show all", () => {
    for (const page of FIVE) {
      const shown = pageRows(page, false, everything).length;
      expect(shown, page).toBeGreaterThanOrEqual(4);
      expect(shown, page).toBeLessThanOrEqual(7);
    }
    expect(pageRows("agents", false, everything, true).map((r) => r.id)).toEqual(["lead", "makers", "made-max", "hops", "runs", "logins", "outside", "tools", "skills", "apps"]);
  });

  it("opens each page at its top by a route of its own", () => {
    for (const page of FIVE) expect(settingsLanding(FIVE_ROUTE[page])).toEqual({ page, row: null, sheet: false, all: false });
  });

  it("gives guests only what they can use: You, their password and sign-ins, About", () => {
    expect(fivePages(true, everything)).toEqual(["you", "privacy", "about"]);
    expect(pageRows("privacy", true, everything).map((r) => r.id)).toEqual(["password", "sessions"]);
    expect(fivePages(false, everything)).toEqual([...FIVE]);
  });

  it("leaves out rows whose mod is off, and never lists a mod's own settings as a row", () => {
    const off = { ...everything, invite: false, background: false, storage: false, apple: false };
    expect(pageRows("privacy", false, off).map((r) => r.id)).not.toContain("people");
    // usage isn't a mod's: it's on the Agents page without Show all, whatever is switched off
    expect(pageRows("agents", false, off).map((r) => r.id)).toContain("usage");
    const listed = [...pageRows("agents", false, everything), ...pageRows("agents", false, everything, true)].map((r) => r.id);
    expect(listed).not.toContain("storage");
    expect(listed).not.toContain("apple");
    // search still reaches them while the mod is on
    expect(searchableRows(false, everything).map((r) => r.id)).toEqual(expect.arrayContaining(["storage", "apple"]));
    expect(searchableRows(false, off).map((r) => r.id)).not.toContain("storage");
  });

  it("lets search reach rows under Show all", () => {
    const ids = searchableRows(false, everything).map((r) => r.id);
    for (const id of ["clock", "text-size", "hops", "cloud", "obsidian", "hub"]) expect(ids).toContain(id);
  });
});
