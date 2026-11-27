import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { changed } = vi.hoisted(() => ({ changed: vi.fn() }));
vi.mock("react", () => ({
  useMemo: (fn: () => unknown) => fn(),
  useSyncExternalStore: (subscribe: (fn: () => void) => void, snapshot: () => unknown) => {
    subscribe(changed);
    return snapshot();
  },
}));

let router: typeof import("./router.ts");
beforeEach(async () => {
  vi.resetModules();
  changed.mockClear();
  const url = new URL("https://wisp.test/?keep=1#/c/ch0/t/note");
  vi.stubGlobal("location", url);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("history", {
    state: { keep: true },
    replaceState: vi.fn((_state, _title, next) => { url.href = new URL(next, url).href; }),
  });
  vi.stubGlobal("confirm", vi.fn(() => false));
  router = await import("./router.ts");
  router.useRoute();
});
afterEach(() => vi.unstubAllGlobals());

describe("hash routing", () => {
  it.each([null, "thread"])("round trips a selected message in a channel or thread (%s)", (threadId) => {
    const route = { view: "chat" as const, channelId: "channel", threadId, messageId: "message /1" };
    expect(router.href(route)).toBe(`#/c/channel${threadId ? "/t/thread" : ""}/m/message%20%2F1`);
    expect(router.parseRoute(router.href(route))).toEqual(route);
  });

  it("recovers from malformed percent encodings and still decodes valid paths", () => {
    for (const hash of ["#/vault/%", "#/c/%E0%A4%A", "#/agents/%FF"])
      expect(router.parseRoute(hash)).toEqual({ view: "chat", channelId: null, threadId: null });
    expect(router.parseRoute("#/vault/shared/a%20note.md")).toEqual({ view: "vault", path: "shared/a note.md" });
  });

  it.each(["hashchange", "popstate"])("restores a refused %s without notifying views", (event) => {
    router.guardLeaving(() => "Discard changes?");
    location.hash = "#/settings";
    window.dispatchEvent(new Event(event));
    // Back/Forward can emit both events for the same transition.
    window.dispatchEvent(new Event(event === "popstate" ? "hashchange" : "popstate"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe("#/c/ch0/t/note");
    expect(location.search).toBe("?keep=1");
    expect(history.replaceState).toHaveBeenCalledWith({ keep: true }, "", "/?keep=1#/c/ch0/t/note");
    expect(changed).not.toHaveBeenCalled();
    expect(router.appHashBeforeSettings()).toBe("#/c/ch0/t/note");
    expect(router.useRoute()).toEqual({ view: "chat", channelId: "ch0", threadId: "note" });
  });

  it.each(["go", "hashchange", "popstate"])("asks once for accepted navigation via %s", (event) => {
    router.guardLeaving(() => "Discard changes?");
    vi.mocked(confirm).mockReturnValue(true);
    if (event === "go") router.go({ view: "settings" });
    else {
      location.hash = "#/settings";
      window.dispatchEvent(new Event(event));
    }
    window.dispatchEvent(new Event("popstate"));
    window.dispatchEvent(new Event("hashchange"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(router.useRoute()).toEqual({ view: "settings", page: null });
    expect(router.appHashBeforeSettings()).toBe("#/c/ch0/t/note");
  });

  it("opens most places as a pop-up over the last page that wasn't one", () => {
    for (const hash of ["#/settings/voice", "#/agents/agt1/look", "#/agents", "#/dashboard", "#/vault", "#/vault/shared/a.md", "#/tasks", "#/marketplace", "#/marketplace/app/b:gmail", "#/connectors", "#/skills", "#/mods", "#/help", "#/templates", "#/about", "#/computers", "#/computers/d/node1"])
      expect(router.isDialogRoute(router.parseRoute(hash)), hash).toBe(true);
    // chats, Code, a computer's live screen and Teach, onboarding and the phone pages stay pages
    expect(router.isDialogRoute(router.parseRoute("#/computers/pc1")), "a computer's sheet").toBe(true);
    for (const hash of ["#/", "#/c/ch1", "#/code", "#/computers/pc1/watch", "#/computers/pc1/teach/agt1", "#/welcome", "#/here", "#/chats", "#/buddy"])
      expect(router.isDialogRoute(router.parseRoute(hash)), hash).toBe(false);
    router.go({ view: "chat", channelId: "ch1", threadId: null });
    router.go({ view: "computers", computerId: null });
    router.go({ view: "vault", path: null });
    router.go({ view: "settings", page: "voice" });
    // moving between pop-ups keeps the page under them: closing lands back in the chat
    expect(router.appHashBeforeSettings()).toBe("#/c/ch1");
  });

  it("sizes pop-ups: large for the busy places, medium for lists, an agent's profile between, a popover for Needs you", () => {
    const size = (hash: string) => router.popupSize(router.parseRoute(hash));
    for (const hash of ["#/settings", "#/computers", "#/marketplace", "#/tasks", "#/vault"]) expect(size(hash), hash).toBe("large");
    for (const hash of ["#/agents/agt1", "#/agents/agt1/look", "#/agents/agt1/settings"]) expect(size(hash), hash).toBe("profile");
    for (const hash of ["#/agents", "#/help", "#/templates", "#/about"]) expect(size(hash), hash).toBe("medium");
    expect(size("#/dashboard")).toBe("popover");
    // the marketplace's sections and app pages are one pop-up: moving inside it isn't a swap
    expect(router.popupKey(router.parseRoute("#/marketplace/app/b:gmail"))).toBe(router.popupKey(router.parseRoute("#/skills")));
    expect(router.popupKey(router.parseRoute("#/computers"))).not.toBe(router.popupKey(router.parseRoute("#/vault")));
  });

  it("puts the last chat under a pop-up opened straight from a link", async () => {
    vi.resetModules();
    vi.stubGlobal("location", new URL("https://wisp.test/#/computers"));
    const fresh = await import("./router.ts");
    expect(fresh.appHashBeforeSettings()).toBe("#/");
  });

  it("keeps go guarded and supports unregistering a guard", () => {
    const remove = router.guardLeaving(() => "Discard changes?");
    router.go({ view: "dashboard" });
    expect(location.hash).toBe("#/c/ch0/t/note");
    expect(changed).not.toHaveBeenCalled();
    remove();
    router.go({ view: "dashboard" });
    expect(location.hash).toBe("#/dashboard");
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe("guest routes", () => {
  it.each(["#/computers", "#/computers/desk", "#/computers/desk/teach/atlas", "#/code"])("falls back from %s for guests", (hash) => {
    expect(router.routeForRole(router.parseRoute(hash), "guest")).toEqual({ view: "dashboard" });
  });

  it.each(["member", "owner"] as const)("keeps computer routes for a %s", (role) => {
    const route = router.parseRoute("#/computers/desk/teach/atlas");
    expect(router.routeForRole(route, role)).toEqual(route);
  });

  it("keeps guests' other pages available", () => {
    const route = router.parseRoute("#/agents/atlas");
    expect(router.routeForRole(route, "guest")).toEqual(route);
  });
});

describe("device pages", () => {
  it("opens one device inside Computers, and the old Devices addresses land there", () => {
    expect(router.parseRoute("#/computers/d/box")).toEqual({ view: "computers", computerId: null, deviceId: "box" });
    expect(router.href({ view: "computers", computerId: null, deviceId: "box" })).toBe("#/computers/d/box");
    expect(router.parseRoute("#/nodes/box")).toEqual({ view: "computers", computerId: null, deviceId: "box" });
    expect(router.parseRoute("#/nodes")).toEqual({ view: "computers", computerId: null });
    expect(router.parseRoute("#/computers/vm/watch")).toEqual({ view: "computers", computerId: "vm", teach: null, watch: true });
    expect(router.href(router.parseRoute("#/computers/vm/watch"))).toBe("#/computers/vm/watch");
  });

  it("sends the old Marketplace Agents address to All", () => {
    expect(router.parseRoute("#/marketplace/agents")).toEqual({ view: "marketplace", section: null });
    // an app's own page, and back
    expect(router.parseRoute("#/marketplace/app/b%3Agmail")).toEqual({ view: "marketplace", section: null, app: "b:gmail" });
    expect(router.parseRoute("#/marketplace/app/r%3Aio.github%2Fnotion")).toEqual({ view: "marketplace", section: null, app: "r:io.github/notion" });
    expect(router.href({ view: "marketplace", section: null, app: "b:gmail" })).toBe("#/marketplace/app/b%3Agmail");
    expect(router.href({ view: "marketplace", section: "apps" })).toBe("#/marketplace/apps");
    expect(router.parseRoute("#/marketplace/mods")).toEqual({ view: "mods" });
    expect(router.parseRoute("#/more")).toEqual({ view: "more" });
  });
});
