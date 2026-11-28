import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useStore, type Me } from "../src/store.ts";
import { App, preloadRoute } from "../src/App.tsx";

vi.mock("../src/api.ts", () => ({ api: vi.fn(() => new Promise(() => {})), uploadFile: vi.fn(), getToken: () => "session", setToken: vi.fn(), connectEvents: vi.fn() }));
vi.mock("../src/theme.ts", () => ({ motionReduced: () => false, useAppearance: () => ({}), THEMES: [] }));
const nav = vi.hoisted(() => ({ route: { view: "computers", computerId: "private", teach: "atlas" } as unknown }));
vi.mock("../src/router.ts", async (original) => ({ ...await original<typeof import("../src/router.ts")>(), useRoute: () => nav.route }));
vi.mock("../src/components/Sidebar.tsx", () => ({ Sidebar: () => null }));
vi.mock("../src/components/OrgRail.tsx", () => ({ OrgRail: () => null }));
vi.mock("../src/components/CommandPalette.tsx", () => ({ CommandPalette: () => null }));
vi.mock("../src/views/DashboardView.tsx", () => ({ DashboardView: () => createElement("div", null, "Dashboard fallback") }));
vi.mock("../src/views/ComputersView.tsx", () => ({ ComputersView: () => createElement("div", null, "Private screen") }));
vi.mock("../src/views/BuddyView.tsx", () => ({ BuddyView: () => null }));
vi.mock("../src/desktop.ts", () => ({ useDesktopAgents: () => {} }));
vi.mock("../src/hubUpdate.ts", () => ({ useHubUpdated: () => null }));

// pages are files of their own now: the app asks for the one its address needs as it starts (App.tsx), and so does this
// (the computers page, and the phone's account pages the tests below open)
beforeAll(async () => {
  await preloadRoute({ view: "computers", computerId: "private", teach: "atlas" });
  await preloadRoute({ view: "you" });
  await preloadRoute({ view: "more" });
});

const initial = useStore.getInitialState();
const saved = initial.me;
const deepLink = nav.route;
afterEach(() => {
  initial.me = saved;
  nav.route = deepLink;
  vi.unstubAllGlobals();
});

function render(role: Me["role"], phone: boolean, route: unknown = deepLink) {
  nav.route = route;
  initial.me = { kind: "user", role, user: { id: "person", name: "Person", email: "me@example.com", createdAt: "now" }, workspace: { id: "workspace", name: "Lab" }, prefs: { experience: "advanced", sendWith: "enter", clock: "auto", toolCalls: "collapsed" } };
  vi.stubGlobal("window", { matchMedia: () => ({ matches: phone }) });
  return renderToStaticMarkup(createElement(App));
}

describe("computer navigation access", () => {
  it.each([false, true])("falls back from a guest computer deep link (phone: %s)", (phone) => {
    const html = render("guest", phone);
    expect(html).toContain("Dashboard fallback");
    expect(html).not.toContain("Private screen");
    expect(html).not.toContain('href="#/computers"');
  });

  it.each(["owner", "member"] as const)("keeps the page for a %s", (role) => {
    const html = render(role, true);
    expect(html).toContain("Private screen");
    expect(html).not.toContain("Dashboard fallback");
  });

  // phones (round 11): the five places are a tab bar at the bottom of each tab page; guests don't get Computers or Marketplace
  it.each(["owner", "member", "guest"] as const)("lists Computers and Marketplace in the phone's tab bar only for members and owners (%s)", (role) => {
    for (const view of ["chats", "more", "vault"]) {
      const html = render(role, true, { view, path: null });
      const bar = html.slice(html.indexOf('aria-label="Places"'));
      expect(bar).toContain('aria-label="Places"');
      expect(bar.includes('href="#/computers"')).toBe(role !== "guest");
      expect(bar.includes('href="#/marketplace"')).toBe(role !== "guest");
      // everyone can reach chats, memory and More from the bar
      for (const link of ["#/chats", "#/vault", "#/more"]) expect(bar).toContain(`href="${link}"`);
      expect(bar).toContain('aria-current="page"');
      // tab pages have no Back button
      expect(html).not.toContain('aria-label="Back"');
    }
  });

  it.each(["owner", "member", "guest"] as const)("keeps help, what's new and settings one tap away on the phone's More tab (%s)", (role) => {
    const html = render(role, true, { view: "more" });
    expect(html).toContain(">More<");
    expect(html).toContain('href="#/help"');
    expect(html).toContain('href="#/settings/updates/news"');
    // Computers is a tab of its own (not a row on this page), and guests have none
    expect(html.includes('href="#/computers"')).toBe(role !== "guest");
    expect(html).not.toContain('aria-label="Main"');
  });

  it("gives the phone's list of computers the tab bar, not a Back, and one computer its own page without the bar", () => {
    const html = render("owner", true, { view: "computers", computerId: null });
    expect(html).toContain("Private screen");
    expect(html).toContain('aria-label="Places"');
    expect(html).not.toContain('aria-label="Back"');
    // one computer's page is deeper than a tab: no bar; desktops have the sidebar instead
    expect(render("owner", true)).not.toContain('aria-label="Places"');
    expect(render("owner", false, { view: "computers", computerId: null })).not.toContain('aria-label="Places"');
    expect(render("owner", false, { view: "computers", computerId: null })).not.toContain('aria-label="Back"');
  });
});
