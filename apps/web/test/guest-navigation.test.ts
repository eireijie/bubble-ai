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

  // phones have no tab bar: Computers is a row on the account page, behind your picture
  it.each(["owner", "member", "guest"] as const)("lists Computers on the phone's account page only for members and owners (%s)", (role) => {
    for (const view of ["you", "more"]) {
      const html = render(role, true, { view });
      expect(html.includes('href="#/computers"')).toBe(role !== "guest");
      // everyone can reach memory, help, settings and home from there
      for (const link of ["#/vault", "#/help", "#/settings"]) expect(html).toContain(`href="${link}"`);
      expect(html).toContain('aria-label="Back"');
      expect(html).not.toContain('aria-label="Main"');
    }
  });

  it("gives the phone's list of computers a way back to the account page", () => {
    const html = render("owner", true, { view: "computers", computerId: null });
    expect(html).toContain("Private screen");
    expect(html).toContain('href="#/you"');
    // one computer's page has its own Back to the list, and desktops have the sidebar
    expect(render("owner", true)).not.toContain('href="#/you"');
    expect(render("owner", false, { view: "computers", computerId: null })).not.toContain('aria-label="Back"');
  });
});
