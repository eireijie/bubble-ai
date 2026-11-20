import { SILHOUETTES } from "../../web/src/ghostFamily.ts";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function fixture(state: Record<string, any> = { step: "cloud", server: { id: 42, name: "saved-server", ip: "203.0.113.7", type: "cx23", location: "fsn1" } }) {
  const elements = new Map<string, any>();
  const element = (id: string) => {
    if (!elements.has(id)) {
      const attrs: Record<string, string> = {};
      elements.set(id, { hidden: true, value: "", textContent: "", checked: true, focus: vi.fn(), replaceChildren: vi.fn(), append: vi.fn(), style: {}, dataset: {}, classList: { add: vi.fn(), remove: vi.fn() }, addEventListener: vi.fn(), setAttribute: (k: string, v: string) => (attrs[k] = v), getAttribute: (k: string) => attrs[k] ?? null });
    }
    return elements.get(id)!;
  };
  const setup = {
    cancelJoin: vi.fn(), discover: vi.fn(async () => ({ ok: true, wisps: [] })),
    requestJoin: vi.fn(async () => ({ ok: true, code: "482913", host: "mac.local", expiresAt: new Date(Date.now() + 600000).toISOString() })),
    pollJoin: vi.fn(async (): Promise<any> => ({ ok: true, status: "pending" })),
    create: vi.fn(async (): Promise<any> => ({ ok: true })), open: vi.fn(),
    cloudKeep: vi.fn(), check: async () => ({}), onCloudStep: vi.fn(), cloudPlans: vi.fn(async () => ({ ok: true, locations: [], choices: {}, currency: "EUR" })), cloudCreate: vi.fn(async () => ({ ok: true, url: "https://hub" })),
    cloudProviders: vi.fn(async () => [{ id: "digitalocean", name: "DigitalOcean", signIn: true }, { id: "hetzner", name: "Hetzner", signIn: false, signInUrl: "https://console.hetzner.com/projects" }]),
    rustdeskStatus: vi.fn(async () => ({ installed: false, id: null })),
  };
  let keydown: (e: any) => void = () => {};
  const timers = new Map<number, () => Promise<void>>();
  let timerId = 0;
  const html = readFileSync(new URL("../src/setup.html", import.meta.url), "utf8");
  const code = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  runInNewContext(code, {
    window: { wispSetup: setup, addEventListener: (type: string, fn: any) => { if (type === "keydown") keydown = fn; }, dispatchEvent: vi.fn() }, Event: class {}, location: { search: `?state=${encodeURIComponent(JSON.stringify(state))}` },
    setTimeout: (fn: () => Promise<void>) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: () => 0, clearInterval: () => {},
    URLSearchParams, URL, Intl, Option: class {},
    document: { getElementById: element, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({ append: vi.fn() }) },
  });
  return { element, setup, esc: (extra: Record<string, any> = {}) => keydown({ key: "Escape", ...extra }), tick: async () => { const [id, fn] = [...timers][0]; timers.delete(id); await fn(); } };
}

describe("resuming cloud setup after relaunch", () => {
  it("hands Keep it to the desktop so the pending server can be dismissed persistently", () => {
    const f = fixture();
    f.element("cloud-keep").onclick();
    expect(f.setup.cloudKeep).toHaveBeenCalledOnce();
  });

  it("shows Keep waiting and resumes the saved server after re-entering credentials, even without available plans", async () => {
    const f = fixture();
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.element("cloud").hidden).toBe(false);
    expect(f.element("cloud-fail-actions").hidden).toBe(false);
    expect(f.element("cloud-progress-sub").textContent).toContain("saved-server");
    // a server from before there was a choice is a Hetzner one, so it's Hetzner's token it asks for
    expect(f.element("p-name").textContent).toBe("Hetzner");
    f.element("cloud-wait").onclick();
    expect(f.element("cloud-connect").hidden).toBe(false);
    f.element("cloud-token").value = "token";
    f.element("cloud-token-form").onsubmit({ preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.element("cloud-choose").hidden).toBe(false);
    expect(f.element("cloud-go").textContent).toBe("Keep waiting");
    f.element("cloud-name").value = "Ada";
    f.element("cloud-email").value = "ada@example.com";
    f.element("cloud-password").value = "password";
    f.element("cloud-form").onsubmit({ preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.setup.cloudCreate).toHaveBeenCalledWith("hetzner", "token", expect.objectContaining({ resume: 42, account: { name: "Ada", email: "ada@example.com", password: "password" } }));
  });
});

describe("Wisp first launch", () => {
  it("draws six wisps from Ghost's own shapes, each on its own clock", () => {
    const html = readFileSync(new URL("../src/setup.html", import.meta.url), "utf8");
    const stage = html.match(/<script>[\s\S]*?<\/script>\s*<script>([\s\S]*?)<\/script>/)![1];
    const crew = stage.match(/const CREW = \[([\s\S]*?)\n\s*\];/)![1];
    const clocks = [...crew.matchAll(/T\("(animation-duration:[^"]+)"/g)].map((m) => m[1]);
    expect(clocks).toHaveLength(5);
    expect(new Set(clocks).size).toBe(5);
    // the first-launch crew is the app's flat ghost family, path for path
    for (const k of ["ghost", "drop", "soft", "tall", "wide"] as const) expect(stage).toContain(`${k}: { d: "${SILHOUETTES[k].d}"`);
  });

  it("goes from Self-Host through installing to Continue, which opens the server", async () => {
    const f = fixture({});
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.element("welcome").hidden).toBe(false);
    // a desktop that stays on: Self-Host is recommended, and Continue goes there
    f.element("pick-create").onclick();
    f.element("welcome-go").onclick();
    expect(f.element("create").hidden).toBe(false);
    expect(f.setup.create).not.toHaveBeenCalled();
    const installing = f.element("create-go").onclick();
    expect(f.element("installing").hidden).toBe(false);
    await installing;
    expect(f.setup.create).toHaveBeenCalledWith({ device: true });
    expect(f.element("ready").hidden).toBe(false);
    expect(f.setup.open).not.toHaveBeenCalled();
    await f.element("ready-go").onclick();
    expect(f.setup.open).toHaveBeenCalledOnce();
    expect(f.element("starting").hidden).toBe(false);
  });

  it("goes back to Self-Host with the reason when the server doesn't start", async () => {
    const f = fixture({});
    f.setup.create.mockResolvedValueOnce({ ok: false, error: "The server didn't start.", log: "port in use" });
    await f.element("create-go").onclick();
    expect(f.element("create").hidden).toBe(false);
    expect(f.element("create-error").textContent).toBe("The server didn't start.");
    expect(f.element("log").textContent).toBe("port in use");
  });

  it("scans, asks with an invite, shows the code, then waits through approval", async () => {
    const f = fixture({});
    f.element("pick-join").onclick();
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.setup.discover).toHaveBeenCalledOnce();
    expect(f.element("discovery-status").textContent).toContain("No Wisps found");
    f.element("url").value = "https://wisp.example/join/invite";
    f.element("join-form").onsubmit({ preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.setup.requestJoin).toHaveBeenCalledWith("https://wisp.example/join/invite");
    expect(f.element("waiting").hidden).toBe(false);
    expect(f.element("join-code").textContent).toBe("482 913");
    await f.tick();
    expect(f.element("waiting").hidden).toBe(false);
    f.setup.pollJoin.mockResolvedValueOnce({ ok: true, status: "approved" });
    await f.tick();
    expect(f.element("starting").hidden).toBe(false);
  });

  it.each(["denied", "expired"])("offers a fresh request after %s", async (status) => {
    const f = fixture({});
    f.element("pick-join").onclick();
    f.element("url").value = "http://mac.local:4747";
    f.element("join-form").onsubmit({ preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
    f.setup.pollJoin.mockResolvedValueOnce({ ok: true, status });
    await f.tick();
    expect(f.element("join-again").hidden).toBe(false);
    expect(f.element("join-status").textContent).toContain(status === "denied" ? "wasn't approved" : "expired");
  });

  it("retries transient polling errors and cancels a waiting request", async () => {
    const f = fixture({});
    f.element("pick-join").onclick();
    f.element("join-form").onsubmit({ preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
    f.setup.pollJoin.mockRejectedValueOnce(new Error("offline"));
    await f.tick();
    expect(f.element("waiting-error").textContent).toContain("trying again");
    f.element("cancel-join").onclick();
    expect(f.setup.cancelJoin).toHaveBeenCalled();
    expect(f.element("join").hidden).toBe(false);
  });
});

describe("Back and Escape", () => {
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  async function toCloud() {
    const f = fixture({});
    f.element("hello-cloud").onclick();
    await settle();
    return f;
  }

  it("on the provider screen, Escape closes the open provider list, then goes back to Hello", async () => {
    const f = await toCloud();
    f.element("p-change").onclick();
    expect(f.element("p-list").hidden).toBe(false);
    f.esc();
    expect(f.element("p-list").hidden).toBe(true);
    expect(f.element("cloud").hidden).toBe(false);
    f.esc();
    expect(f.element("cloud").hidden).toBe(true);
    expect(f.element("hello").hidden).toBe(false);
  });

  it("on the token screen (Hetzner), Escape goes back to Hello", async () => {
    const f = await toCloud();
    f.element("p-change").onclick();
    const row = f.element("p-list").replaceChildren.mock.calls[0][0];
    row.onclick();
    expect(f.element("cloud-token-form").hidden).toBe(false);
    f.esc();
    expect(f.element("cloud").hidden).toBe(true);
    expect(f.element("hello").hidden).toBe(false);
  });

  it("Escape on the sign-in wait cancels the browser sign-in and goes back", async () => {
    const f = await toCloud();
    (f.setup as any).cloudSignIn = vi.fn(() => new Promise(() => {}));
    (f.setup as any).cloudSignInCancel = vi.fn();
    f.element("signin-go").onclick();
    f.esc();
    expect((f.setup as any).cloudSignInCancel).toHaveBeenCalledOnce();
    expect(f.element("hello").hidden).toBe(false);
  });

  it("choosing a size goes back to connecting, and Escape on Hello does nothing", async () => {
    const f = fixture();
    await settle();
    f.element("cloud-wait").onclick();
    f.element("cloud-token").value = "token";
    f.element("cloud-token-form").onsubmit({ preventDefault() {} });
    await settle();
    expect(f.element("cloud-choose").hidden).toBe(false);
    f.esc();
    expect(f.element("cloud-choose").hidden).toBe(true);
    expect(f.element("cloud-connect").hidden).toBe(false);
    f.esc();
    expect(f.element("hello").hidden).toBe(false);
    f.esc();
    expect(f.element("hello").hidden).toBe(false);
  });

  it("I already have Wisp: Escape goes back to Hello; waiting for approval goes back to the join page", async () => {
    const f = fixture({});
    await f.element("pick-join").onclick();
    expect(f.element("join").hidden).toBe(false);
    f.esc();
    expect(f.element("join").hidden).toBe(true);
    expect(f.element("hello").hidden).toBe(false);
    await f.element("pick-join").onclick();
    f.element("url").value = "https://mac.local/join/abc";
    f.element("join-form").onsubmit({ preventDefault() {} });
    await settle();
    expect(f.element("waiting").hidden).toBe(false);
    f.esc();
    expect(f.element("waiting").hidden).toBe(true);
    expect(f.element("join").hidden).toBe(false);
  });

  it("ignores Escape while an input method is composing", async () => {
    const f = await toCloud();
    f.esc({ isComposing: true });
    f.esc({ keyCode: 229 });
    expect(f.element("cloud").hidden).toBe(false);
  });
});
