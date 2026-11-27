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
const { ownAppName } = await import("../src/views/ConnectorsView.tsx");

beforeEach(() => {
  vi.stubGlobal("location", new URL("https://wisp.test/"));
  Object.assign(world, { role: "owner", features: { background: false, routines: false, teach: false, tasks: true, buddy: false, invite: false, remoteDesktop: false, storage: false, code: true, apple: false } });
});
afterEach(() => vi.unstubAllGlobals());

const add = (section: "all" | "apps" | "skills" | "devices" | "installed" | "mods" = "all") => renderToStaticMarkup(createElement(MarketplaceView, { section }));

describe("Connect apps: apps, skills and mods in one pop-up (round 8)", () => {
  it("is titled Connect apps, with one search, the filter chips and the sections of All in order", () => {
    const html = add();
    expect(html).toContain(">Connect apps</h1>");
    expect(html).toContain('placeholder="Search apps and skills"');
    expect(html).toContain("0 connected");
    for (const chip of ["All", "Apps", "Skills", "Productivity", "Communication", "More"]) expect(html).toMatch(new RegExp(`aria-pressed="(true|false)"[^>]*>${chip}`));
    expect(html).toMatch(/aria-pressed="true"[^>]*>All</);
    expect(html).toContain('<section id="add-recommended" aria-label="Recommended"');
    expect(html.indexOf('id="add-recommended"')).toBeLessThan(html.indexOf('id="add-apps"'));
    expect(html.indexOf('id="add-apps"')).toBeLessThan(html.indexOf('id="add-skills"'));
    expect(html.indexOf('id="add-skills"')).toBeLessThan(html.indexOf("Make or bring your own"));
    // mods are under More, not on All; the old side list is gone
    expect(html).not.toContain('id="add-mods"');
    expect(html).not.toContain('aria-label="Add sections"');
  });

  it("puts Composio first, with the Recommended mark and its own line", () => {
    const html = add();
    const rec = html.split('id="add-recommended"')[1].split("</section>")[0];
    expect(rec.indexOf(">Composio<")).toBeGreaterThan(-1);
    expect(rec).toContain(">Recommended<");
    expect(rec).toContain("Use Composio for more apps and easy sign-in");
    expect(rec).toContain('aria-label="Connect Composio"');
  });

  it("draws two-column rows: a tile, the name, one line of what it does, and Connect or Add", () => {
    const html = add("apps");
    const github = CONNECTOR_CATALOG.find((c) => c.id === "github")!;
    expect(html).toContain("md:grid-cols-2");
    expect(html).toContain('aria-label="Connect GitHub"');
    expect(html).toContain(github.description.replace(/'/g, "&#x27;"));
    expect(add("skills")).toContain(`aria-label="Add ${SKILL_CATALOG[0].name}"`);
  });

  it("a chip shows only its own rows, all of them", () => {
    const apps = add("apps");
    expect(apps).toContain('id="add-apps"');
    expect(apps).not.toContain('id="add-skills"');
    expect(apps).not.toContain('id="add-recommended"');
    expect(apps).toMatch(/aria-pressed="true"[^>]*>Apps</);
    const skills = add("skills");
    expect(skills).toContain('id="add-skills"');
    expect(skills).not.toContain('id="add-apps"');
    expect(add("installed")).toContain('id="add-added"');
  });

  it("shows a section only when it has rows", () => {
    // nothing is added and no computer has reported anything (the lists haven't loaded)
    const html = add();
    expect(html).not.toContain('id="add-added"');
    // This Mac has the Apple mod on a Mac, and nothing else until a computer reports what it has
    if (!/mac/i.test(navigator.platform)) expect(html).not.toContain('id="add-found"');
  });

  it("folds Apps and Skills on All behind Show all", () => {
    expect(add("all").split('id="add-skills"')[1]).toContain("Show all");
  });

  it("lists every mod under Mods, the ones that are on with a check and the rest with Add, Code included", () => {
    const html = add("mods");
    for (const k of ["background", "routines", "teach", "tasks", "buddy", "invite", "remoteDesktop", "storage", "apple"] as const) expect(html).toContain(FEATURE_INFO[k].name);
    expect(html).toContain('aria-label="Add Storage"');
    expect(html).not.toContain('aria-label="Add Tasks board"');
    expect(html).toContain('role="img" aria-label="On"');
    expect(html).toContain(">Code<");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Mods/);
  });

  it("only owners add mods, and a guest gets no actions at all", () => {
    world.role = "member";
    expect(add("mods")).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Add Storage"|<button[^>]*aria-label="Add Storage"[^>]*disabled=""/);
    world.role = "guest";
    const html = add("mods");
    expect(html).not.toContain('aria-label="Add Storage"');
    expect(html).not.toContain("Make or bring your own");
    expect(add()).not.toContain('aria-label="Connect GitHub"');
    // a guest can't add from a device, so This Mac isn't offered
    expect(add()).not.toMatch(/>This (Mac|PC|computer)</);
  });
});

describe("Connect apps' helpers", async () => {
  const { appTopics, latestPicks, connectedLogos, thisComputer } = await import("../src/components/ConnectParts.tsx");
  it("puts an app on a topic chip from its shelf, and password managers by name", () => {
    expect(appTopics({ name: "Gmail", category: "Email and calendar" })).toEqual(["communication"]);
    expect(appTopics({ name: "Google Calendar", category: "Email and calendar" })).toEqual(["productivity"]);
    expect(appTopics({ name: "Slack", category: "Chat" })).toEqual(["communication"]);
    expect(appTopics({ name: "Stripe", category: "Finance" })).toEqual(["money"]);
    expect(appTopics({ name: "GitHub", category: "Developer" })).toEqual(["developer"]);
    expect(appTopics({ name: "Figma", category: "Design" })).toEqual(["design"]);
    expect(appTopics({ name: "1Password", category: "Developer" })).toEqual(["passwords"]);
  });
  it("finds the agent's latest picks, the open chat's first", () => {
    const msg = (channelId: string, agent: string, ids: string[]) => ({ id: channelId + agent, channelId, author: { kind: "agent", id: agent }, parts: [{ type: "connect", apps: ids.map((id) => ({ id, name: id, why: "x" })) }] }) as never;
    expect(latestPicks(undefined, null)).toBeNull();
    expect(latestPicks({ a: [msg("a", "tony", ["gmail"])], b: [msg("b", "luna", ["slack"])] }, "b")).toMatchObject({ agentId: "luna", apps: [{ id: "slack" }] });
    expect(latestPicks({ a: [msg("a", "tony", ["gmail"])] }, "b")).toMatchObject({ agentId: "tony" });
  });
  it("stacks the logos of apps that are connected, at most three", () => {
    const c = (name: string, o: object = {}) => ({ name, catalogId: null, enabled: true, auth: null, ...o }) as never;
    const logos = connectedLogos([c("Gmail"), c("Slack"), c("Notion"), c("GitHub"), c("Linear", { enabled: false })]);
    expect(logos.map((l) => l.title)).toEqual(["GitHub", "Notion", "Slack"]);
    expect(connectedLogos([c("Gmail", { auth: { required: true, signedIn: false } })])).toEqual([]);
  });
  it("names This Mac for the computer it runs on", () => {
    expect(thisComputer("MacIntel")).toBe("This Mac");
    expect(thisComputer("Win32")).toBe("This PC");
    expect(thisComputer("Linux x86_64")).toBe("This computer");
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

describe("making your own app", () => {
  it("names it from what was typed, so there's no Name field to fill", () => {
    const none = { url: "", command: "", args: [] as string[], keys: [] as string[] };
    expect(ownAppName("mcp-http", { ...none, url: "https://mcp.acme.com/sse" }, [])).toBe("Acme");
    expect(ownAppName("mcp-stdio", { ...none, command: "npx", args: ["-y", "@acme/mcp-server"] }, [])).toBe("Acme");
    expect(ownAppName("secret", { ...none, keys: ["STRIPE_API_KEY"] }, [])).toBe("Stripe");
    expect(ownAppName("mcp-http", none, ["my app"])).toBe("My app 2");
  });
});

describe("an app that can't be signed in to yet", () => {
  it("says Coming soon instead of an Add that fails", () => {
    const html = renderToStaticMarkup(createElement(AppPage, { app: gmailApp, have: undefined, agents, canEdit: true, signIn: { signIn: false, key: false, soon: true, reason: "Signing in with Google is coming soon." }, ...handlers }));
    expect(html).toContain("Coming soon");
    expect(html).not.toContain(">Add</button>");
    expect(html).not.toContain("Signing in with Google is coming soon.");
  });
});
