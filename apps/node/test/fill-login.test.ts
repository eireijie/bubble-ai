import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { FILL_LOGIN_SCRIPT } from "../src/computers/fill-login.ts";
import { exec } from "../src/computers/driver.ts";

// the VMs' fill script against a real (headless) Chrome, where this machine has one
const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));
// Chrome's cold start on a busy machine (CI runs every test file at once) is the slow part here
const START_MS = 90_000;

const PAGES: Record<string, string> = {
  "/form": `<form id="f"><input name="email" type="email"><input name="password" type="password"><button type="submit">Sign in</button></form>
    <script>document.getElementById("f").onsubmit = (e) => { e.preventDefault(); window.got = { email: e.target.email.value, password: e.target.password.value }; };</script>`,
  // a page that keeps its own state from input events (like React) and has no form
  "/app": `<input id="u" autocomplete="username"><input id="p" type="password"><button id="go">Log in</button>
    <script>const s = {}; u.oninput = () => (s.u = u.value); p.oninput = () => (s.p = p.value); go.onclick = () => (window.got = { ...s });</script>`,
  // the first of two pages: only the username
  "/step1": `<form id="f"><input name="identifier" type="email" placeholder="Email"><button>Next</button></form>
    <script>f.onsubmit = (e) => { e.preventDefault(); window.got = { email: f.identifier.value }; };</script>`,
  "/none": `<h1>Hello</h1>`,
  // a page (or an agent before the fill) that swaps out the value setter to catch what's typed
  "/hijack": `<form id="f"><input name="email" type="email"><input name="password" type="password"><button type="submit">Sign in</button></form>
    <script>const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    Object.defineProperty(HTMLInputElement.prototype, "value", { get: d.get, set(v) { (window.stolen ||= []).push(v); d.set.call(this, v); } });
    f.onsubmit = (e) => e.preventDefault();</script>`,
  // a password box with nothing to press
  "/nobutton": `<input name="email" type="email"><input name="password" type="password">`,
};

let server: http.Server;
let chrome: ChildProcess | undefined;
let profile: string;
/** Where this run's Chrome answers DevTools calls: a port Chrome picked itself, so no two runs can share one. */
let cdp: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const exited = (c: ChildProcess) => c.exitCode !== null || c.signalCode !== null;

/**
 * Starts Chrome on a debugging port of its own choosing (port 0) and returns its address once it
 * answers there. Chrome writes the port it got to DevToolsActivePort in its profile folder.
 */
async function startChrome(): Promise<string> {
  const child = spawn(CHROME!, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore", detached: true });
  chrome = child;
  let failed: Error | undefined;
  child.once("error", (err) => (failed = err));
  for (const end = Date.now() + START_MS; Date.now() < end; await sleep(50)) {
    if (failed) throw failed;
    if (exited(child)) throw new Error(`Chrome stopped before its debugging port opened (exit code ${child.exitCode}, signal ${child.signalCode})`);
    let port = 0;
    try {
      port = Number(fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
    } catch {
      // not written yet
    }
    if (port && (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5000) }).then((r) => r.ok, () => false))) return `http://127.0.0.1:${port}`;
  }
  // said here, in the hook, rather than as a refused connection in whichever test runs first
  throw new Error(`Chrome's debugging port didn't open within ${START_MS / 1000}s`);
}

async function evalIn(expression: string) {
  const pages = (await (await fetch(`${cdp}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
  const ws = new WebSocket(pages.find((p) => p.type === "page")!.webSocketDebuggerUrl);
  return new Promise<unknown>((resolve, reject) => {
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
    ws.onmessage = (m) => {
      const r = JSON.parse(String(m.data));
      if (r.id === 1) (ws.close(), resolve(r.result?.result?.value));
    };
    // a socket that drops (the page navigating away, Chrome gone) is an answer too, not a hang
    ws.onerror = () => reject(new Error(`Chrome's page socket failed while running: ${expression}`));
    ws.onclose = () => reject(new Error(`Chrome's page socket closed before answering: ${expression}`));
  });
}
async function goTo(p: string) {
  await evalIn(`location.href = "http://localhost:${(server.address() as { port: number }).port}${p}"`);
  let at: unknown = "";
  for (const end = Date.now() + 15_000; Date.now() < end; await sleep(50)) {
    at = await evalIn("location.pathname + document.readyState").catch(() => "");
    if (at === `${p}complete`) return;
  }
  throw new Error(`the page ${p} didn't finish loading (it's at "${at}")`);
}
async function fill(login: { site: string; username: string; password: string; otp?: string }) {
  const r = await exec(process.execPath, ["--input-type=module", "-e", FILL_LOGIN_SCRIPT], { input: JSON.stringify(login), env: { CDP: cdp, CLEAR_AFTER_MS: "300" }, timeoutMs: 20_000 });
  return JSON.parse(r.stdout.toString().trim().split("\n").pop()!);
}

describe.skipIf(!CHROME)("filling a login in Chrome", () => {
  beforeAll(async () => {
    server = http.createServer((req, res) => res.end(`<!doctype html><html><body>${PAGES[req.url ?? ""] ?? ""}</body></html>`));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    profile = fs.mkdtempSync(path.join(os.tmpdir(), "wisp-fill-"));
    cdp = await startChrome();
  }, START_MS + 10_000);
  afterAll(async () => {
    if (chrome?.pid) {
      const child = chrome;
      const gone = exited(child) ? Promise.resolve() : new Promise((r) => child.once("exit", r));
      // Chrome's helper processes outlive it and keep writing to the profile: stop them all
      try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      await gone;
    }
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
    try { if (profile) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* a leftover temp profile is harmless */ }
  }, 30_000);

  it("fills the username and password, signs in, and empties the box when the page doesn't move on", async () => {
    await goTo("/form");
    expect(await fill({ site: "localhost", username: "bot@shop.test", password: "s3cret!" })).toEqual({ filled: ["username", "password"], submitted: true, cleared: true });
    expect(await evalIn("window.got")).toEqual({ email: "bot@shop.test", password: "s3cret!" });
    expect(await evalIn("document.querySelector('input[type=password]').value")).toBe("");
  }, 20_000);

  it("doesn't call a value setter the page swapped in", async () => {
    await goTo("/hijack");
    expect(await fill({ site: "localhost", username: "bot", password: "s3cret!" })).toMatchObject({ filled: ["username", "password"], submitted: true });
    expect(await evalIn("window.stolen ?? null")).toBeNull();
  }, 20_000);

  it("empties the password right away when there's no sign-in button", async () => {
    await goTo("/nobutton");
    expect(await fill({ site: "localhost", username: "bot", password: "s3cret!" })).toEqual({ filled: ["username", "password"], submitted: false, cleared: true, problem: "there's no sign-in button to press" });
    expect(await evalIn("document.querySelector('input[type=password]').value")).toBe("");
  }, 20_000);

  it("works on pages that keep their own state and have no form", async () => {
    await goTo("/app");
    expect(await fill({ site: "localhost", username: "bot", password: "pw" })).toEqual({ filled: ["username", "password"], submitted: true, cleared: true });
    expect(await evalIn("window.got")).toEqual({ u: "bot", p: "pw" });
  }, 20_000);

  it("fills only the username on a username-first page", async () => {
    await goTo("/step1");
    expect(await fill({ site: "localhost", username: "bot@shop.test", password: "pw" })).toEqual({ filled: ["username"], submitted: true });
    expect(await evalIn("window.got")).toEqual({ email: "bot@shop.test" });
  }, 20_000);

  it("fills nothing on another site's page", async () => {
    await goTo("/form");
    expect(await fill({ site: "zendesk.com", username: "bot", password: "pw" })).toEqual({ filled: [], submitted: false, wrongSite: "localhost" });
    expect(await evalIn("document.querySelector('input[type=password]').value")).toBe("");
  }, 20_000);

  it("says so when there's nothing to fill", async () => {
    await goTo("/none");
    expect(await fill({ site: "localhost", username: "bot", password: "pw" })).toMatchObject({ filled: [], problem: "there are no sign-in boxes on the page" });
  }, 20_000);
});
