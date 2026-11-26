import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CONNECTOR_CATALOG, FEATURE_INFO, SKILL_CATALOG, type Agent, type Skill } from "@bubble-ai/core";

/** Who is looking and which mods are on; each test sets what it needs. */
const world = vi.hoisted(() => ({ role: "owner", features: {} as Record<string, boolean> }));

vi.mock("../src/api.ts", () => ({ api: vi.fn(() => new Promise(() => {})) }));
vi.mock("../src/theme.ts", () => ({ motionReduced: () => false, useMotionReduced: () => false }));
vi.mock("../src/features.ts", () => ({ useFeatures: () => world.features, useFeature: () => false, setFeatures: vi.fn() }));
vi.mock("../src/store.ts", () => ({
  useStore: Object.assign((select: (s: unknown) => unknown) => select({ me: { user: { id: "me" }, role: world.role }, agents: [], channels: [] }), { getState: () => ({}), setState: () => {} }),
}));

const { MarketplaceView } = await import("../src/views/MarketplaceView.tsx");
const { AppPage, appLine, connectorLine } = await import("../src/views/AppPages.tsx");
const { SkillDetail, skillLine } = await import("../src/views/SkillsView.tsx");

beforeEach(() => {
  vi.stubGlobal("location", new URL("https://wisp.test/"));
  Object.assign(world, { role: "owner", features: { background: false, routines: false, teach: false, tasks: true, buddy: false, invite: false, remoteDesktop: false, storage: false, code: true, apple: false } });
});
afterEach(() => vi.unstubAllGlobals());

const add = (section: "all" | "apps" | "skills" | "devices" | "installed" | "mods" = "all") => renderToStaticMarkup(createElement(MarketplaceView, { section }));

describe("Add: apps, skills and mods on one page", () => {
  it("is titled by its search field, with a section for each kind and the way to make your own last", () => {
    const html = add();
    expect(html).toContain('placeholder="Add an app, a skill or a mod"');
    for (const s of ["Apps", "Skills", "Mods"]) expect(html).toContain(`<section id="add-${s.toLowerCase()}" aria-label="${s}"`);
    expect(html.indexOf('id="add-apps"')).toBeLessThan(html.indexOf('id="add-skills"'));
    expect(html.indexOf('id="add-skills"')).toBeLessThan(html.indexOf('id="add-mods"'));
    expect(html.indexOf('id="add-mods"')).toBeLessThan(html.indexOf("Make or bring your own"));
    // the old side list, tabs, chips and header buttons are gone
    for (const gone of ["Marketplace", "Installed", "On your devices", "View all", "Create a skill", "Popular apps"]) expect(html).not.toContain(gone);
  });

  it("shows a section only when it has rows", () => {
    // nothing is added and no computer has reported anything (the lists haven't loaded)
    const html = add();
    expect(html).not.toContain('id="add-added"');
    expect(html).not.toContain('id="add-found"');
  });

  it("draws rows, not cards: a name and one action, no description and no badge", () => {
    const html = add();
    const github = CONNECTOR_CATALOG.find((c) => c.id === "github")!;
    expect(html).toContain('aria-label="Add GitHub"');
    expect(html).not.toContain(github.description);
    expect(html).not.toContain("On Bubble AI&#x27;s list");
    expect(html).not.toContain(SKILL_CATALOG[0].description);
    expect(html).not.toContain("Made by Bubble AI");
  });

  it("shows a few rows of apps and skills with a Show all row, and every mod", () => {
    const html = add();
    expect(html.match(/Show all/g)?.length).toBeGreaterThanOrEqual(2);
    // mods are few and switch core behaviour, so they're never folded away
    expect(html).toContain(FEATURE_INFO.buddy.name);
    expect(html).toContain(FEATURE_INFO.remoteDesktop.name);
  });

  it("lists every mod, the ones that are on with a check and the rest with Add, Code included", () => {
    const html = add("mods");
    for (const k of ["background", "routines", "teach", "tasks", "buddy", "invite", "remoteDesktop", "storage", "apple"] as const) expect(html).toContain(FEATURE_INFO[k].name);
    expect(html).toContain('aria-label="Add Storage"');
    expect(html).not.toContain('aria-label="Add Tasks board"');
    expect(html).toContain('role="img" aria-label="On"');
    expect(html).toContain(">Code<");
    // no description paragraphs here either
    expect(html).not.toContain(FEATURE_INFO.storage.description);
  });

  it("opens an old address with its section showing every row", () => {
    expect(add("apps").split('id="add-skills"')[0]).not.toContain("Show all");
    expect(add("skills").split('id="add-skills"')[1].split('id="add-mods"')[0]).not.toContain("Show all");
    expect(add("all").split('id="add-skills"')[0]).toContain("Show all");
  });

  it("only owners add mods, and a guest gets no actions at all", () => {
    world.role = "member";
    expect(add("mods")).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Add Storage"|<button[^>]*aria-label="Add Storage"[^>]*disabled=""/);
    world.role = "guest";
    const html = add("mods");
    expect(html).not.toContain('aria-label="Add Storage"');
    expect(html).not.toContain("Make or bring your own");
    expect(add()).not.toContain('aria-label="Add GitHub"');
  });
});

const agents = [{ id: "a1", name: "Juno", handle: "juno", harness: "claude-code", status: "idle", settings: {} }] as unknown as Agent[];
const gmail = CONNECTOR_CATALOG.find((c) => c.id === "gmail")!;
const gmailApp = { key: "b:gmail", name: "Gmail", description: gmail.description, category: "Email and calendar" as const, who: "Bubble AI", builtIn: gmail };
const connector = (o: object) => ({ id: "c1", workspaceId: "w", name: "Gmail", kind: "mcp-http", catalogId: "gmail", command: null, args: [], url: "https://gmailmcp.googleapis.com/mcp/v1", headers: {}, env: {}, enabled: true, auth: { required: true, signedIn: true, error: null }, agentIds: [], allAgents: true, createdBy: "me", createdAt: "2026-11-22T12:00:00Z", ...o }) as never;
const handlers = { onAdd: () => {}, onChanged: () => {}, onSignIn: () => {}, onSignOut: () => {}, onEdit: () => {}, onToggle: () => {}, onRemove: () => {} };

describe("an app's page", () => {
  it("says what it is and who made it in one line", () => {
    expect(appLine(gmailApp)).toBe("Email and calendar · by Google");
    expect(appLine({ key: "b:git", name: "Git", description: "", category: "Developer", who: "Bubble AI", builtIn: CONNECTOR_CATALOG.find((c) => c.id === "git")! })).toBe("Developer");
    expect(connectorLine({ catalogId: "device:n1:codex:github" })).toBe("App · from Codex");
    expect(connectorLine({ catalogId: null })).toBe("Your own app");
  });

  it("before it is added: one Add, what it may do, and no explainers", () => {
    const html = renderToStaticMarkup(createElement(AppPage, { app: gmailApp, have: undefined, agents, canEdit: true, signIn: { signIn: true, key: false, reads: gmail.signInReads }, ...handlers }));
    expect(html).toContain(">Add</button>");
    expect(html).toContain("Email and calendar · by Google");
    expect(html).toContain(gmail.signInReads);
    for (const gone of ["Before you connect", "How to connect", "Try it in a chat", "Who can use it", "Remove", gmail.description]) expect(html).not.toContain(gone);
  });

  it("once added: who can use it, the account, and Remove set apart; nothing to press when all is fine", () => {
    const html = renderToStaticMarkup(createElement(AppPage, { app: gmailApp, have: connector({}), agents, canEdit: true, ...handlers }));
    expect(html).toContain("Who can use it");
    expect(html).toContain("All agents");
    expect(html).toContain("Signed in as");
    expect(html).toContain("Remove");
    expect(html).not.toContain(">Add</button>");
    expect(html).not.toContain("Sign in again");
  });

  it("asks for the sign-in again when it lapsed, with a dot on the account row", () => {
    const html = renderToStaticMarkup(createElement(AppPage, { app: gmailApp, have: connector({ auth: { required: true, signedIn: false, error: null } }), agents, canEdit: true, ...handlers }));
    expect(html.match(/Sign in again/g)?.length).toBe(2);
    expect(html).toContain("bg-st-needs");
  });

  it("is read only for a guest", () => {
    const html = renderToStaticMarkup(createElement(AppPage, { app: gmailApp, have: connector({}), agents, canEdit: false, ...handlers }));
    expect(html).not.toContain("Remove");
    expect(html).not.toContain('aria-haspopup="menu"');
  });
});

const skill = (o: Partial<Skill>): Skill => ({ id: "s1", slug: "order-pizza", name: "Order pizza", description: "Use when asked to order the usual.", tags: [], source: "learned", catalogId: null, content: "1. Open the site", agentIds: ["a1"], allAgents: false, learnedBy: "a1", uses: 3, lastUsedAt: null, createdBy: null, createdAt: "2026-10-29T12:00:00Z", updatedAt: "2026-10-29T12:00:00Z", ...o }) as Skill;

describe("a skill's page", () => {
  it("says what it is, where it came from and how often it's used in one line", () => {
    expect(skillLine(skill({}), agents)).toBe("Skill · learned by Juno · used 3 times");
    expect(skillLine(skill({ source: "catalog", catalogId: "anthropic:docx", uses: 0 }), agents)).toBe("Skill · from Anthropic");
    expect(skillLine(skill({ source: "custom", uses: 1 }), agents)).toBe("Skill · made here · used once");
  });

  it("shows who can use it and Remove, with no Try it and no instructions until they are opened", () => {
    const html = renderToStaticMarkup(createElement(SkillDetail, { open: { skill: skill({}) }, agents, canEdit: true, onInstall: () => {}, onEdit: () => {}, onChanged: () => {}, onGone: () => {}, onShare: () => {} }));
    expect(html).toContain("Who can use it");
    expect(html).toContain("Juno");
    expect(html).toContain("Remove");
    for (const gone of ["Try it", "Forget this skill", "Open the site", "Instruction file"]) expect(html).not.toContain(gone);
  });

  it("offers one Add for a library skill", () => {
    const html = renderToStaticMarkup(createElement(SkillDetail, { open: { entry: SKILL_CATALOG[0] }, agents, canEdit: true, onInstall: () => {}, onEdit: () => {}, onChanged: () => {}, onGone: () => {}, onShare: () => {} }));
    expect(html).toContain(">Add</button>");
    expect(html).toContain("Skill · by Bubble AI");
    for (const gone of ["Try it", "What it does", "Example", "Read the full instructions"]) expect(html).not.toContain(gone);
  });
});
