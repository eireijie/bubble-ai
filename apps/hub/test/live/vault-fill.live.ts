/**
 * The Wisp vault, end to end, with real pieces: a throwaway Vaultwarden, the official Bitwarden
 * CLI, the vault bridge, a hub, a device on this computer and a real VM whose Chrome signs in to a
 * test page. Not part of `npm test` (it starts a VM and takes minutes): run it by hand.
 *
 *   container run -d --name wisp-vaulttest-vw -p 127.0.0.1:8091:80 -e DOMAIN=http://127.0.0.1:8091/vault \
 *     -e SIGNUPS_ALLOWED=true docker.io/vaultwarden/server:latest      # or docker run …
 *   npm i --prefix /some/scratch @bitwarden/cli@2026.11.1
 *   LIVE_BW=/some/scratch/node_modules/.bin/bw npx tsx apps/hub/test/live/vault-fill.live.ts
 *
 * The accounts and logins are fake, from fixtures/vault-test-accounts.json. It proves:
 *  1. agents see only the agents account's "Agents" logins, without secrets;
 *  2. an agent asks for a login by site, the person approves, and the VM's Chrome signs in with it
 *     (checked by the test page, which records only a hash of what it received);
 *  3. none of the passwords appears in anything the hub or device printed, in the hub's files
 *     (database included), in what the agent was told, or in what the hub sent the device.
 */
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { rmSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HarnessAdapter, RunInput } from "@wisp/adapters";
import { deviceAdapters } from "@wisp/adapters";
import { WispClient } from "@wisp/sdk";
import { NodeDaemon } from "../../../node/src/daemon.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const fixture = JSON.parse(await fs.readFile(path.join(here, "fixtures/vault-test-accounts.json"), "utf8")) as {
  person: { email: string; password: string };
  agents: { email: string; password: string };
  logins: { name: string; folder: string; uri: string; username: string; password: string }[];
};
const VAULT = (process.env.LIVE_VAULT_URL ?? "http://127.0.0.1:8091/vault").replace(/\/+$/, "");
/** the Bitwarden CLI only talks HTTPS: the script puts a TLS proxy (self-signed, trusted only by bw here) in front */
let VAULT_TLS = "";
let CA = "";
const BW = process.env.LIVE_BW ?? "bw";
const SITE_PORT = 8123;
const SECRETS = [fixture.person.password, fixture.agents.password, ...fixture.logins.map((l) => l.password)];

// --- everything this process prints, kept to search afterwards (the hub and device run in it) ---
const printed: string[] = [];
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    printed.push(String(chunk));
    return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof stream.write;
}
const say = (s: string) => console.log(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(what: string, fn: () => Promise<T | undefined | null | false> | T | undefined | null | false, ms = 10 * 60_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// --- making a Bitwarden account the way the web vault does (client-side keys), for the test accounts ---

const b64 = (b: Buffer) => b.toString("base64");
function encString(plain: Buffer, enc: Buffer, mac: Buffer) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv("aes-256-cbc", enc, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  const m = crypto.createHmac("sha256", mac).update(Buffer.concat([iv, ct])).digest();
  return `2.${b64(iv)}|${b64(ct)}|${b64(m)}`;
}
const expand = (prk: Buffer, info: string) => crypto.createHmac("sha256", prk).update(Buffer.concat([Buffer.from(info), Buffer.from([1])])).digest();
async function register(email: string, password: string) {
  const iterations = 600_000;
  const masterKey = crypto.pbkdf2Sync(password, email.toLowerCase(), iterations, 32, "sha256");
  const hash = b64(crypto.pbkdf2Sync(masterKey, password, 1, 32, "sha256"));
  const userKey = crypto.randomBytes(64);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const body = {
    email,
    name: email.split("@")[0],
    masterPasswordHash: hash,
    masterPasswordHint: null,
    key: encString(userKey, expand(masterKey, "enc"), expand(masterKey, "mac")),
    kdf: 0,
    kdfIterations: iterations,
    keys: { publicKey: b64(publicKey.export({ type: "spki", format: "der" })), encryptedPrivateKey: encString(privateKey.export({ type: "pkcs8", format: "der" }), userKey.subarray(0, 32), userKey.subarray(32)) },
  };
  const post = (p: string, b: unknown) => fetch(VAULT + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  // Vaultwarden 1.34+: a verification step first (it answers with the token itself when it has no email set up)
  const started = await post("/identity/accounts/register/send-verification-email", { email, name: body.name, receiveMarketingEmails: false });
  let r: Response;
  if (started.ok) {
    const token = (await started.text()).replace(/^"|"$/g, "");
    r = await post("/identity/accounts/register/finish", { email, emailVerificationToken: token, masterPasswordHash: hash, masterPasswordHint: null, userSymmetricKey: body.key, userAsymmetricKeys: body.keys, kdf: 0, kdfIterations: iterations });
  } else r = await post("/identity/accounts/register", body);
  const text = await r.text();
  if (r.ok) return "made";
  if (/already|exists|taken/i.test(text)) return "already there";
  throw new Error(`registering ${email}: ${r.status} ${text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300)}`);
}

// --- the Bitwarden CLI, for putting the fake logins in the agents account (as a person would in the app) ---

function bw(appDir: string, args: string[], env: Record<string, string> = {}, input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = spawn(BW, [...args, "--nointeraction"], { env: { PATH: process.env.PATH!, HOME: appDir, BITWARDENCLI_APPDATA_DIR: appDir, NODE_EXTRA_CA_CERTS: CA, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`bw ${args[0]} ${args[1] ?? ""}: ${err.split("\n")[0]}`))));
    c.stdin.end(input ?? "");
  });
}
async function seed(dir: string) {
  const app = path.join(dir, "bw-seed");
  await fs.mkdir(app, { recursive: true });
  await bw(app, ["config", "server", VAULT_TLS]);
  const session = await bw(app, ["login", fixture.agents.email, "--passwordenv", "PW", "--raw"], { PW: fixture.agents.password });
  const S = { BW_SESSION: session };
  const folders = JSON.parse(await bw(app, ["list", "folders"], S)) as { id: string; name: string }[];
  const folderId: Record<string, string> = {};
  for (const name of new Set(fixture.logins.map((l) => l.folder))) {
    folderId[name] = folders.find((f) => f.name === name)?.id ?? JSON.parse(await bw(app, ["create", "folder"], S, Buffer.from(JSON.stringify({ name })).toString("base64"))).id;
  }
  const items = JSON.parse(await bw(app, ["list", "items"], S)) as { name: string }[];
  for (const l of fixture.logins) {
    if (items.some((i) => i.name === l.name)) continue;
    const item = { organizationId: null, collectionIds: null, folderId: folderId[l.folder], type: 1, name: l.name, notes: null, favorite: false, fields: [], login: { uris: [{ match: null, uri: l.uri }], username: l.username, password: l.password, totp: null }, secureNote: null, card: null, identity: null, reprompt: 0 };
    await bw(app, ["create", "item"], S, Buffer.from(JSON.stringify(item)).toString("base64"));
  }
  await bw(app, ["logout"]).catch(() => {});
}

// --- the test site inside the VM: a sign-in form that records who signed in and a hash of the password ---

const SITE = String.raw`
import hashlib, http.server, json, urllib.parse
PAGE = b'''<!doctype html><title>Test sign in</title><h1>Sign in</h1>
<form method="post" action="/login"><input name="username" autocomplete="username" placeholder="Username">
<input name="password" type="password" placeholder="Password"><button type="submit">Sign in</button></form>'''
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        self.send_response(200); self.send_header("content-type", "text/html"); self.end_headers(); self.wfile.write(PAGE)
    def do_POST(self):
        f = urllib.parse.parse_qs(self.rfile.read(int(self.headers["content-length"])).decode())
        rec = {"username": f.get("username", [""])[0], "sha256": hashlib.sha256(f.get("password", [""])[0].encode()).hexdigest()}
        open("/tmp/signed-in.json", "w").write(json.dumps(rec))
        self.send_response(200); self.send_header("content-type", "text/html"); self.end_headers(); self.wfile.write(b"<h1>Welcome</h1>")
http.server.HTTPServer(("127.0.0.1", ${SITE_PORT}), H).serve_forever()
`;

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wisp-vault-live-"));
  // gone however the run ends, unless asked to keep it
  if (!process.env.LIVE_KEEP) process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const results: [string, boolean, string][] = [];
  const check = (name: string, ok: boolean, detail = "") => (results.push([name, ok, detail]), say(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`));

  say(`vault ${VAULT}, data ${dir}`);
  VAULT_TLS = await tlsProxy(dir);
  say(`person account: ${await register(fixture.person.email, fixture.person.password)}`);
  say(`agents account: ${await register(fixture.agents.email, fixture.agents.password)}`);
  await seed(dir);
  say("fake logins are in the agents account (Agents and Personal folders)");

  // the bridge, as its own process like its container
  const hubToken = crypto.randomBytes(32).toString("hex");
  const redeemToken = crypto.randomBytes(32).toString("hex");
  const bridgeOut: string[] = [];
  const bridgePort = 8188;
  const bridge: ChildProcess = spawn(process.execPath, [path.join(repo, "docker/vault-bridge/bridge.mjs")], {
    env: { PATH: process.env.PATH!, NODE_EXTRA_CA_CERTS: CA, BW_BIN: BW, BW_SERVER: VAULT_TLS, BRIDGE_DATA: path.join(dir, "bridge"), BRIDGE_HUB_TOKEN: hubToken, BRIDGE_REDEEM_TOKEN: redeemToken, BRIDGE_PORT: String(bridgePort), BRIDGE_HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  bridge.stdout!.on("data", (d) => bridgeOut.push(String(d)));
  bridge.stderr!.on("data", (d) => bridgeOut.push(String(d)));
  const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
  await waitFor("the bridge", () => fetch(`${bridgeUrl}/healthz`).then((r) => r.ok, () => false), 30_000);

  // the hub (never the real ~/.wisp: its HOME and data are in the throwaway folder) and this computer as its device
  process.env.HOME = path.join(dir, "home");
  await fs.mkdir(process.env.HOME, { recursive: true });
  for (const k of Object.keys(process.env)) if (/^(CLAUDE|ANTHROPIC)/.test(k)) delete process.env[k];
  process.env.WISP_VAULT_BRIDGE_URL = bridgeUrl;
  process.env.WISP_VAULT_BRIDGE_TOKEN = hubToken;
  process.env.WISP_VAULT_URL = VAULT;
  process.env.WISP_VAULT_CONNECT_URL = `${bridgeUrl}/vault-bridge/connect`;
  const { buildHub } = await import("../../src/app.ts");
  const built = await buildHub({ dataDir: path.join(dir, "hub"), setupCode: false });
  const hub = built.hub;
  // the device's redeem token only: the hub process here also has the device in it, so take the hub's away first
  process.env.WISP_VAULT_REDEEM_TOKEN = redeemToken;
  const sentToDevice: string[] = [];
  const act = hub.computers.act.bind(hub.computers);
  hub.computers.act = (async (c: any, a: any, by: any, ...rest: any[]) => (sentToDevice.push(JSON.stringify(a)), act(c, a, by, ...rest))) as typeof hub.computers.act;
  await built.app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
  const setup = await (await fetch(base + "/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@wisp-vault.test", name: "Owner", password: `owner-${crypto.randomBytes(9).toString("base64url")}`, features: "everything", workspaceName: "Vault test" }) })).json();
  const owner = new WispClient({ url: base, token: setup.token });
  const { node, token } = await owner.request<any>("POST", "/api/nodes", { name: "this-computer" });
  const prompts: string[] = [];
  const recording: HarnessAdapter = { id: "custom", label: "Recorder", binary: "true", async run(input: RunInput) { prompts.push(input.prompt); return { finalText: "ok", sessionId: "s" }; } };
  const daemon = new NodeDaemon({ hub: base, token, name: "this-computer", dir: path.join(dir, "node") }, () => {}, { ...deviceAdapters(), custom: recording });
  daemon.start();
  let vmId: string | null = null;
  try {
    // 1. the person connects the agents account on the bridge's own page; the hub only makes the link
    const link = await owner.request<{ url: string }>("POST", "/api/logins/vault/connect-link");
    const [page, code] = link.url.split("#");
    const connected = await (await fetch(page, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, email: fixture.agents.email, password: fixture.agents.password }) })).json();
    check("agents account connected on the bridge page", connected.agentsFound === true, JSON.stringify(connected));
    const used = await owner.request<any>("PUT", "/api/logins/source", { kind: "wisp-vault" });
    const listed = await owner.request<any>("GET", "/api/logins");
    const sites = listed.logins.map((l: any) => l.site);
    check("agents see only logins in Agents", JSON.stringify(sites) === JSON.stringify(["localhost"]) && used.label === "Wisp vault", `sites: ${sites.join(", ")}`);

    // 2. an agent with its own VM, and the test site running in it
    await waitFor("the device", async () => (await owner.request<any[]>("GET", "/api/nodes"))[0]?.capabilities?.vm?.ok, 60_000);
    const vm = await owner.request<any>("POST", "/api/computers", { kind: "vm", nodeId: node.id, name: "Vault test VM" });
    vmId = vm.id;
    const agent = await owner.request<any>("POST", "/api/agents", { handle: "tester", name: "Tester", harness: "custom", nodeId: node.id, computerId: vm.id, greet: "later" });
    const agentApi = new WispClient({ url: base, token: (await owner.request<any>("POST", `/api/agents/${agent.id}/token`)).token });
    say("starting the VM (a few minutes the first time)…");
    await waitFor("the VM", async () => (await agentApi.computer<any>({ action: "start" }).catch(() => null))?.status === "ready", 15 * 60_000);
    await agentApi.computer({ action: "run", command: `printf '%s' '${Buffer.from(SITE).toString("base64")}' | base64 -d > /tmp/site.py && (nohup python3 /tmp/site.py >/dev/null 2>&1 &) && sleep 1 && rm -f /tmp/signed-in.json && echo started` });
    await agentApi.computer({ action: "open", target: `http://localhost:${SITE_PORT}/login` });
    await sleep(5000);

    // 3. the agent asks by site; the person says yes; the device redeems the ticket and Chrome signs in
    const asked = await agentApi.fillLogin("localhost");
    check("the agent's ask goes to the person first", asked.status === "asked");
    const promptsBefore = prompts.length;
    await owner.request("POST", `/api/approvals/${asked.approvalId}/decide`, { approve: true, always: true });
    const told = await waitFor("the agent to hear back", () => prompts.slice(promptsBefore).find((p) => /Allowed/.test(p)), 120_000);
    check("the agent hears it was filled", /Wisp filled the Test site login/.test(told), told.match(/Allowed[^\n]*/)?.[0]?.slice(0, 200));
    const signedIn = JSON.parse((await agentApi.computer<{ output: string }>({ action: "run", command: "cat /tmp/signed-in.json" })).output || "{}");
    const want = fixture.logins.find((l) => l.folder === "Agents")!;
    check("the test page signed in with the vault's login", signedIn.username === want.username && signedIn.sha256 === crypto.createHash("sha256").update(want.password).digest("hex"), `username ${signedIn.username}`);
    // allowed always now: another fill goes straight through
    const again = await agentApi.fillLogin("localhost");
    check("a second fill (allowed always) works without asking", again.status === "filled" || again.status === "not_filled", again.message.slice(0, 120));
    await expect404(agentApi.fillLogin("bank.wisp-vault.test"), check);

    // 4. the passwords never showed up anywhere Wisp keeps or prints
    hub.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const hubFiles = await everyFile(path.join(dir, "hub"));
    const nodeFiles = await everyFile(path.join(dir, "node"));
    const leaks = (label: string, text: string | Buffer) => SECRETS.filter((s) => (typeof text === "string" ? text.includes(s) : text.includes(Buffer.from(s)))).length ? [label] : [];
    const found = [
      ...leaks("what this process printed (hub + device)", printed.join("")),
      ...leaks("the bridge's output", bridgeOut.join("")),
      ...leaks("what the agent was told", prompts.join("\n")),
      ...leaks("what the hub sent the device", sentToDevice.join("\n")),
      ...(await Promise.all(hubFiles.map(async (f) => leaks(`hub file ${path.relative(dir, f)}`, await fs.readFile(f))))).flat(),
      ...(await Promise.all(nodeFiles.map(async (f) => leaks(`device file ${path.relative(dir, f)}`, await fs.readFile(f))))).flat(),
    ];
    check(`no password in hub/device output, ${hubFiles.length} hub files (database included), ${nodeFiles.length} device files, the agent's prompts or what the hub sent`, found.length === 0, found.join("; "));
    check("the hub only ever sent a ticket", sentToDevice.filter((a) => a.includes("fill_login")).every((a) => JSON.parse(a).password === "" && typeof JSON.parse(a).ticket === "string"));
  } finally {
    if (vmId) await owner.request("DELETE", `/api/computers/${vmId}`).catch((e) => say(`couldn't remove the VM: ${e.message}`));
    daemon.stop();
    await built.app.close();
    bridge.kill();
    if (!process.env.LIVE_KEEP) await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  say(`\n${results.filter((r) => r[1]).length}/${results.length} passed`);
  process.exit(results.every((r) => r[1]) ? 0 : 1);
}

/** An https:// address for the vault: a self-signed certificate made now, trusted only by the bw processes here. */
async function tlsProxy(dir: string): Promise<string> {
  const key = path.join(dir, "tls.key");
  CA = path.join(dir, "tls.crt");
  await new Promise<void>((resolve, reject) =>
    spawn("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", CA, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" }).on("close", (c) => (c === 0 ? resolve() : reject(new Error("openssl failed")))),
  );
  const target = new URL(VAULT);
  const server = https.createServer({ key: await fs.readFile(key), cert: await fs.readFile(CA) }, (req, res) => {
    const up = http.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host } }, (r) => (res.writeHead(r.statusCode ?? 502, r.headers), r.pipe(res)));
    up.on("error", () => (res.writeHead(502), res.end()));
    req.pipe(up);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  server.unref();
  return `https://127.0.0.1:${(server.address() as { port: number }).port}${target.pathname}`;
}

async function expect404(p: Promise<unknown>, check: (n: string, ok: boolean, d?: string) => void) {
  try {
    await p;
    check("a login outside Agents can't be asked for", false, "it was found");
  } catch (err) {
    check("a login outside Agents can't be asked for", /no saved login/.test((err as Error).message), (err as Error).message.slice(0, 100));
  }
}

async function everyFile(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(root, { withFileTypes: true, recursive: true }).catch(() => [])) if (e.isFile()) out.push(path.join(e.parentPath, e.name));
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
