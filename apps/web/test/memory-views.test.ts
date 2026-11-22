import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AccessRule } from "@wisp/core";
import { useStore } from "../src/store.ts";
import { MemoryHome } from "../src/views/MemoryHome.tsx";
import { mostLinked } from "../src/views/MemoryGraphView.tsx";
import { aboutSections, type Item } from "../src/views/AboutView.tsx";
import { accessWord, firstLine, fixedFolder, lastAuthors, noteRows, renameFolderPlan, renamedFolder, savedView, shortWhen } from "../src/views/memory/logic.ts";

vi.mock("../src/api.ts", () => ({ api: vi.fn(() => new Promise(() => {})), uploadFile: vi.fn() }));
vi.mock("../src/theme.ts", () => ({ motionReduced: () => false, useMotionReduced: () => false, useAppearance: () => ({ resolvedMode: "light", mode: "light", setMode: vi.fn(), toggleMode: vi.fn() }) }));

const note = (path: string, updatedAt: number, title = path.split("/").pop()!.replace(/\.md$/, "")) => ({ path, title, tags: [], links: [], updatedAt });
const change = (author: string, date: string, ...files: [string, string?][]) => ({ hash: date, author, date, message: "", files: files.map(([path, kind]) => ({ path, change: (kind ?? "modified") as "modified" })) });

describe("a note's one line in the list", () => {
  it("skips the front matter and a heading that repeats the title", () => {
    expect(firstLine("---\ntype: project\n---\n# Release\n\nShip Friday. Sam signs off.\n\nMore.", "Release")).toBe("Ship Friday. Sam signs off.");
  });

  it("drops Markdown marks, list bullets and link brackets", () => {
    expect(firstLine("- [ ] Ask **Pip** about [[Photo apps compared|the photo apps]] and [Immich](https://immich.app)", "Todo")).toBe("Ask Pip about the photo apps and Immich");
    expect(firstLine("## Status\n\ntext", "Other")).toBe("Status");
  });

  it("passes over rules and code fences, and is empty for an empty note", () => {
    expect(firstLine("---\n\n```js\nconst x = 1\n```\n\nAfter the code", "T")).toBe("After the code");
    expect(firstLine("# Dentist\n", "Dentist")).toBe("");
  });
});

describe("when a note changed, in a word", () => {
  const now = new Date(2026, 10, 22, 15, 0, 0).getTime();
  it("counts minutes and hours, then says today, then the weekday, then the date", () => {
    expect(shortWhen(now - 20_000, now)).toBe("now");
    expect(shortWhen(now - 12 * 60_000, now)).toBe("12m");
    expect(shortWhen(now - 3 * 3_600_000, now)).toBe("3h");
    expect(shortWhen(new Date(2026, 10, 22, 1, 0).getTime(), now)).toBe("today");
    expect(shortWhen(new Date(2026, 10, 20, 9, 0).getTime(), now)).toBe(new Date(2026, 10, 20).toLocaleDateString([], { weekday: "short" }));
    expect(shortWhen(new Date(2026, 9, 3, 9, 0).getTime(), now)).toBe(new Date(2026, 9, 3).toLocaleDateString([], { month: "short", day: "numeric" }));
    expect(shortWhen(new Date(2025, 9, 3, 9, 0).getTime(), now)).toBe(new Date(2025, 9, 3).toLocaleDateString([], { month: "short", year: "numeric" }));
    expect(shortWhen(0, now)).toBe("");
  });
});

describe("the list of notes", () => {
  const notes = [note("shared/Release.md", 100), note("agents/a1/Dentist.md", 300), note("shared/Old.md", 50), note("shared/Gone.md", 10)];
  const authors = lastAuthors([
    change("@atlas", "2026-11-22T12:00:00Z", ["shared/Release.md"], ["shared/Gone.md", "deleted"]),
    change("@juno", "2026-11-22T09:00:00Z", ["agents/a1/Dentist.md", "added"], ["shared/Release.md"]),
  ]);

  it("names who changed each note last, ignoring deletions", () => {
    expect(authors.get("shared/Release.md")?.author).toBe("@atlas");
    expect(authors.get("agents/a1/Dentist.md")?.author).toBe("@juno");
    expect(authors.has("shared/Gone.md")).toBe(false);
  });

  it("is newest first, by the last change when it is known", () => {
    expect(noteRows(notes, authors).map((r) => [r.note.title, r.author])).toEqual([
      ["Release", "@atlas"],
      ["Dentist", "@juno"],
      ["Old", null],
      ["Gone", null],
    ]);
  });

  it("narrows to one author: what they changed last, plus older notes of theirs nobody is known to have changed since", () => {
    expect(noteRows(notes, authors, "@juno").map((r) => r.note.title)).toEqual(["Dentist"]);
    expect(noteRows(notes, authors, "@juno", new Set(["shared/Old.md", "shared/Release.md"])).map((r) => [r.note.title, r.author])).toEqual([
      ["Dentist", "@juno"],
      ["Old", "@juno"],
    ]);
  });
});

describe("folders", () => {
  it("says who can see a folder with its own access", () => {
    expect(accessWord("you")).toBe("Only you");
    expect(accessWord("you, Juno")).toBe("You, Juno");
    expect(accessWord("everyone in the workspace, all agents")).toBe("Everyone, all agents");
    expect(accessWord("nobody")).toBe("Nobody");
  });

  it("keeps Wisp's own folders from being renamed or deleted", () => {
    for (const fixed of ["shared", "agents/a1", "people/u1", "teams", "teams/launch", "groups"]) expect(fixedFolder(fixed)).toBe(true);
    for (const free of ["projects", "shared/projects", "agents/a1/plans", "teams/launch/notes"]) expect(fixedFolder(free)).toBe(false);
  });

  it("renames by moving every note and every rule under it", () => {
    const rules = [
      { id: "r1", path: "Projects", subject: { kind: "all_agents" }, level: "none" },
      { id: "r2", path: "projects/web/Plan.md", subject: { kind: "agent", id: "a1" }, level: "read", startup: true },
      { id: "r3", path: "Projects2", subject: { kind: "all_agents" }, level: "none" },
      { path: "projects", subject: { kind: "members" }, level: "edit", builtin: true },
    ] as AccessRule[];
    const plan = renameFolderPlan("projects", "work", [note("projects/web/Plan.md", 1), note("projects/Release.md", 2), note("projects2/Other.md", 3)], rules);
    expect(plan.error).toBeUndefined();
    expect(plan.moves).toEqual([
      { from: "projects/web/Plan.md", to: "work/web/Plan.md" },
      { from: "projects/Release.md", to: "work/Release.md" },
    ]);
    expect(plan.rules.map((r) => [r.id, r.path, r.level, r.startup])).toEqual([
      ["r1", "work", "none", false],
      ["r2", "work/web/Plan.md", "read", true],
    ]);
  });

  it("refuses a name another folder already has, and cleans the name typed", () => {
    expect(renameFolderPlan("projects", "work", [note("projects/A.md", 1), note("Work/B.md", 2)], []).error).toBe("There is already a folder called work");
    expect(renamedFolder("shared/projects", " work/2026 ")).toBe("shared/work 2026");
    expect(renamedFolder("projects", "  ")).toBeNull();
  });
});

describe("the graph", () => {
  it("names the notes most others link to", () => {
    const n = (title: string, inbound: number, path: string | null = `${title}.md`) => ({ id: title, path, title, kind: "shared" as const, type: null, tags: [], updatedAt: null, links: inbound, inbound });
    expect(mostLinked({ nodes: [n("Dentist", 2), n("Sam", 5), n("Lonely", 0), n("Release", 4), n("Upload test", 1), n("Unwritten", 9, null)], edges: [] })).toEqual(["Sam", "Release", "Dentist"]);
  });
});

describe("About you", () => {
  const item = (text: string, kind: Item["kind"], more: Partial<Item> = {}): Item => ({ path: `${text}.md`, kind, text, by: null, source: null, messageId: null, channelId: null, created: null, updated: null, pinned: false, status: null, due: null, date: null, ...more });
  const items = [item("Short answers", "preference"), item("Launch the beta", "plan", { status: "active" }), item("Coffee first", "detail", { pinned: true }), item("Old plan", "plan", { status: "done" }), item("Shipped onboarding", "did", { date: "2026-11-21" }), item("Cofounder is Sam", "detail")];

  it("is one list: pinned first, then each kind under its own word", () => {
    const all = aboutSections(items);
    expect(all.pinned.map((i) => i.text)).toEqual(["Coffee first"]);
    expect(all.sections.map((s) => [s.head, s.items.map((i) => i.text)])).toEqual([
      ["Preferences", ["Short answers"]],
      ["Coming up", ["Launch the beta"]],
      ["Done", ["Old plan"]],
      ["Details", ["Cofounder is Sam"]],
    ]);
    expect(all.journal.map((i) => i.text)).toEqual(["Shipped onboarding"]);
  });

  it("narrows to one kind", () => {
    const plans = aboutSections(items, "plan");
    expect(plans.pinned).toEqual([]);
    expect(plans.sections.map((s) => s.head)).toEqual(["Coming up", "Done"]);
    expect(plans.journal).toEqual([]);
    expect(aboutSections(items, "did").sections).toEqual([]);
  });
});

describe("the Memory page", () => {
  const initial = useStore.getInitialState();
  const saved = { agents: initial.agents, members: initial.members, me: initial.me };
  afterEach(() => {
    Object.assign(initial, saved);
  });

  const juno = { id: "a1", name: "Juno", handle: "juno", harness: "claude", status: "online", settings: {} } as unknown as (typeof initial.agents)[number];
  const notes = [note("shared/Release.md", 100), note("agents/a1/Dentist.md", 300)];
  const authors = lastAuthors([change("@juno", "2026-11-22T09:00:00Z", ["agents/a1/Dentist.md"]), change("Sam", "2026-11-21T09:00:00Z", ["shared/Release.md"])]);
  const noop = () => {};
  function render(props: Partial<Parameters<typeof MemoryHome>[0]> = {}) {
    initial.agents = [juno];
    return renderToStaticMarkup(
      createElement(MemoryHome, {
        view: "list", onView: noop, phone: false, notes, total: 2, authors, query: "", setQuery: noop, hits: null, by: null, byPaths: null, onBy: noop, seeAs: null, onSeeAs: noop, onStopSeeAs: noop, hidden: [], graph: null, graphPick: null, folder: null, rules: [],
        where: () => "Shared", snippetHtml: (s: string) => s, onOpen: noop, onFolder: noop, onNew: noop, onWrite: noop, onShareFolder: noop, onRenameFolder: noop, onDeleteFolder: noop,
        ...props,
      }),
    );
  }

  it("is a title, a view button, New note, one search and the notes newest first", () => {
    const html = render();
    expect(html).toContain(">Memory</h1>");
    for (const control of ["View: List. Change view", "New note", "Search what your agents know"]) expect(html).toContain(`aria-label="${control}"`);
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html.indexOf(">Dentist<")).toBeGreaterThan(-1);
    expect(html.indexOf(">Dentist<")).toBeLessThan(html.indexOf(">Release<"));
    // each note's author is a button that narrows the list to theirs
    expect(html).toContain("aria-label=\"Only Juno&#x27;s notes\"");
    expect(html).toContain("aria-label=\"Only Sam&#x27;s notes\"");
  });

  it("drops what the old home carried", () => {
    const html = render();
    for (const gone of ["What your agents remember", "Recent changes", "All activity", "Most linked", "Open the graph", "More in Memory", "View as you", "Search every note"]) expect(html).not.toContain(gone);
  });

  it("shows whose view of memory it is as a chip with an x and a count", () => {
    const html = render({ seeAs: juno, notes: [notes[1]!], total: 2, onNew: undefined });
    expect(html).toContain(">Juno can see<");
    expect(html).toContain('aria-label="Show everything again"');
    expect(html).toContain(">1 of 2 notes<");
    expect(html).not.toContain('aria-label="New note"');
  });

  it("shows one author's notes as a chip with an x", () => {
    const html = render({ by: "@juno" });
    expect(html).toContain(">By Juno<");
    expect(html).toContain("aria-label=\"Show everyone&#x27;s notes\"");
    expect(html).toContain(">1 note<");
    expect(html).not.toContain(">Release<");
  });

  it("lists folders with their counts, and what is in the open one", () => {
    const html = render({ view: "folders", folder: "shared" });
    expect(html).toContain('aria-label="View: Folders. Change view"');
    expect(html).toContain(">Shared<");
    expect(html).toContain(">Juno&#x27;s notes<");
    expect(html).toContain('aria-expanded="true"');
    // only the open folder shows its notes and its own menu (Shared is Wisp's own: it can be shared, not renamed)
    expect(html).toContain(">Release<");
    expect(html).not.toContain(">Dentist<");
    expect(html).toContain('aria-label="Shared: share"');
  });

  it("gives the graph the page's header with one filter button, and no search", () => {
    const html = render({ view: "graph", graph: { nodes: [], edges: [] } });
    expect(html).toContain('aria-label="View: Graph. Change view"');
    expect(html).toContain('aria-label="Filter the graph: folders and tags"');
    expect(html).not.toContain("<input");
    for (const gone of ["Zoom in", "Zoom out", "Find a note in the graph…", "Nothing is linked yet"]) expect(html).not.toContain(gone);
  });

  it("remembers the list as the view until another is picked", () => {
    expect(savedView()).toBe("list");
    vi.stubGlobal("localStorage", { getItem: () => "graph", setItem: noop });
    expect(savedView()).toBe("graph");
    vi.stubGlobal("localStorage", { getItem: () => "nonsense", setItem: noop });
    expect(savedView()).toBe("list");
    vi.unstubAllGlobals();
  });
});
