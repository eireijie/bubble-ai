import { SILHOUETTES } from "../../web/src/ghostFamily.ts";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function fixture(state: Record<string, any> = { step: "cloud", server: { id: 42, name: "saved-server", ip: "203.0.113.7", type: "cx23", location: "fsn1" } }, create?: () => Promise<any>) {
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
    create: vi.fn(create ?? (async (): Promise<any> => ({ ok: true }))), open: vi.fn(), cancelCreate: vi.fn(), returnToServer: vi.fn(),
    cloudKeep: vi.fn(), check: async () => ({}), onCloudStep: vi.fn(), cloudPlans: vi.fn(async () => ({ ok: true, locations: [], choices: {}, currency: "EUR" })), cloudCreate: vi.fn(async () => ({ ok: true, url: "https://hub" })),
    cloudProviders: vi.fn(async () => [{ id: "digitalocean", name: "DigitalOcean", signIn: true }, { id: "hetzner", name: "Hetzner", signIn: false, signInUrl: "https://console.hetzner.com/projects" }]),
    rustdeskStatus: vi.fn(async () => ({ installed: false, id: null })),
  };
  const timers = new Map<number, () => Promise<void>>();
  let timerId = 0;
  const html = readFileSync(new URL("../src/setup.html", import.meta.url), "utf8");
  const code = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  runInNewContext(code, {
    window: { wispSetup: setup, addEventListener: vi.fn(), dispatchEvent: vi.fn() }, Event: class {}, location: { search: `?state=${encodeURIComponent(JSON.stringify(state))}` },
    setTimeout: (fn: () => Promise<void>) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: () => 0, clearInterval: () => {},
    URLSearchParams, URL, Intl, Option: class {},
    document: { getElementById: element, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({ append: vi.fn() }) },
  });
  return { element, setup, tick: async () => { const [id, fn] = [...timers][0]; timers.delete(id); await fn(); } };
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

  it("says hello and starts Self-Host in the background; Continue opens it with the name", async () => {
    const f = fixture({});
    expect(f.element("hello").hidden).toBe(false);
    // the server starts the moment the page opens, before anything is clicked
    expect(f.setup.create).toHaveBeenCalledWith({ device: true, background: true });
    f.element("hello-name").value = "Ada Lovelace";
    f.element("hello-name").oninput();
    expect(f.element("hello-title").textContent).toBe("Nice to meet you, Ada.");
    expect(f.element("hello-sub").textContent).toBe("I'll remember that.");
    await f.element("hello-form").onsubmit({ preventDefault() {} });
    expect(f.setup.create).toHaveBeenCalledOnce();
    expect(f.setup.open).toHaveBeenCalledWith("Ada Lovelace");
    expect(f.element("starting").hidden).toBe(false);
  });

  it("continues with no name, waiting on the installing screen while the start finishes", async () => {
    let finish: (r: any) => void = () => {};
    const f = fixture({}, () => new Promise((r) => (finish = r)));
    const going = f.element("hello-form").onsubmit({ preventDefault() {} });
    expect(f.element("installing").hidden).toBe(false);
    expect(f.setup.open).not.toHaveBeenCalled();
    finish({ ok: true });
    await going;
    expect(f.setup.open).toHaveBeenCalledWith("");
    expect(f.element("starting").hidden).toBe(false);
  });

  it("shows the reason on Self-Host when the background start failed", async () => {
    const f = fixture({}, async () => ({ ok: false, error: "The server didn't start.", log: "port in use" }));
    await f.element("hello-form").onsubmit({ preventDefault() {} });
    expect(f.element("create").hidden).toBe(false);
    expect(f.element("create-error").textContent).toBe("The server didn't start.");
    expect(f.setup.open).not.toHaveBeenCalled();
  });

  it("Use Cloud instead calls off the background start and goes to Cloud with the name", async () => {
    const f = fixture({});
    f.element("hello-name").value = "Ada";
    f.element("hello-cloud").onclick();
    expect(f.setup.cancelCreate).toHaveBeenCalledOnce();
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.element("cloud").hidden).toBe(false);
    expect(f.element("cloud-name").value).toBe("Ada");
  });

  it("a second Wisp from an existing one doesn't start a server until asked", () => {
    const f = fixture({ canReturn: true });
    expect(f.setup.create).not.toHaveBeenCalled();
    f.element("hello-form").onsubmit({ preventDefault() {} });
    expect(f.element("create").hidden).toBe(false);
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
