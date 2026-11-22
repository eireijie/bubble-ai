import { describe, expect, it, vi } from "vitest";
import type { Route } from "../router.ts";
import { accountRows, type YouRow } from "./YouPage.tsx";

vi.mock("../api.ts", () => ({ api: vi.fn(), setToken: vi.fn(), getToken: () => null }));
vi.mock("../theme.ts", () => ({ motionReduced: () => false, THEMES: [], useAppearance: () => ({}) }));

const row = (label: string, to: Route): YouRow => ({ label, icon: null, to });
const labels = (rows: YouRow[]) => rows.map((r) => r.label);

describe("the account page's first card", () => {
  const head = [row("Computers", { view: "computers", computerId: null }), row("Add apps and skills", { view: "marketplace" }), row("Memory", { view: "vault", path: null }), row("All agents", { view: "agents", agentId: null })];
  const tail = [row("Mods", { view: "mods" }), row("Help", { view: "help" })];

  it("puts what mods add between the fixed rows and Mods, Help", () => {
    const more = [row("Storage", { view: "settings", page: "storage" }), row("Apple", { view: "settings", page: "apple" })];
    expect(labels(accountRows(head, more, tail))).toEqual(["Computers", "Add apps and skills", "Memory", "All agents", "Storage", "Apple", "Mods", "Help"]);
  });

  it("lists a place once, under the account page's own label", () => {
    // the sidebar's More list names Memory, the marketplace, Mods and Help too
    const more = [row("Memory", { view: "vault", path: null }), row("Tasks", { view: "tasks" }), row("Marketplace", { view: "marketplace" }), row("Mods", { view: "mods" }), row("Help", { view: "help" })];
    expect(labels(accountRows([...head, row("Tasks", { view: "tasks" })], more, tail))).toEqual(["Computers", "Add apps and skills", "Memory", "All agents", "Tasks", "Mods", "Help"]);
  });

  it("keeps a row More has that the page does not name", () => {
    expect(labels(accountRows([], [row("Tasks", { view: "tasks" })], [row("Help", { view: "help" })]))).toEqual(["Tasks", "Help"]);
  });
});
