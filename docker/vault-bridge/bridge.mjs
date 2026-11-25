/**
 * vault-bridge: lets Wisp's agents fill logins from the Wisp vault (Vaultwarden) one at a time,
 * without the password ever reaching the hub, the agent's model, or Wisp's database.
 *
 * It's a thin wrapper around the official Bitwarden CLI (`bw`), signed in as the agents' own vault
 * account. The person connects that account on this bridge's own page (/vault-bridge/connect), so
 * the hub never receives the account's master password either.
 *
 *   hub    (BRIDGE_HUB_TOKEN)    → status, connect codes, the list of logins *without secrets*,
 *                                  one-time fill tickets, forget
 *   device (BRIDGE_REDEEM_TOKEN) → redeems a ticket for {username, password, otp} and fills it in the
 *                                  agent's VM straight away
 *
 * The hub holds tickets but not the redeem token, so a ticket on its own opens nothing. The bridge
 * has no way to add, change or delete a login: only the person does that, in their vault.
 * Only logins in a collection or folder named "Agents" are ever listed or handed out.
 *
 * Nothing here logs a request body, a password or a bw output.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TICKET_MS = 60_000;
const CODE_MS = 10 * 60_000;
const CODE_TRIES = 3;
const LIST_TTL_MS = 30_000;
const MAX_BODY = 16 * 1024;
export const AGENTS = "agents";
/** vault item ids are GUIDs: anything else would reach `bw get item` as a search or a flag */
const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "https://www.zendesk.com/login" → "zendesk.com" (the same rule as @wisp/core's siteOf). */
export function siteOf(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
    if (!host.includes(".") && host !== "localhost") return null;
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}
const bare = (h) => String(h).toLowerCase().replace(/^www\./, "");

export class BridgeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * The official Bitwarden CLI, run once per call. Secrets go in through environment variables
 * (never arguments, which other processes can read), and its output is never logged or echoed.
 */
export class BwCli {
  constructor({ bin = "bw", appDir, server }) {
    this.bin = bin;
    this.appDir = appDir;
    this.server = server;
  }

  run(args, env = {}, timeoutMs = 90_000) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, [...args, "--nointeraction"], {
        env: { PATH: process.env.PATH, HOME: this.appDir, BITWARDENCLI_APPDATA_DIR: this.appDir, BW_NOINTERACTION: "true", NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS ?? "", ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const out = [];
      const err = [];
      child.stdout.on("data", (c) => out.push(c));
      child.stderr.on("data", (c) => err.push(c));
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.on("error", (e) => (clearTimeout(timer), reject(new BridgeError(`the Bitwarden CLI didn't start: ${e.code ?? "error"}`, 503))));
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) return resolve(Buffer.concat(out).toString("utf8").trim());
        // only bw's own first error line, which is about the request, never a vault item
        const why = Buffer.concat(err).toString("utf8").trim().split("\n")[0].slice(0, 200) || `bw exited with ${code}`;
        reject(new BridgeError(why, 502));
      });
    });
  }

  async status(session) {
    try {
      return JSON.parse(await this.run(["status"], session ? { BW_SESSION: session } : {})).status;
    } catch {
      return "unauthenticated";
    }
  }

  /** Sign in as the agents' account and unlock it; returns the session key (kept in memory only). */
  async unlock(creds) {
    fs.mkdirSync(this.appDir, { recursive: true, mode: 0o700 });
    if ((await this.status()) === "unauthenticated") {
      await this.run(["config", "server", this.server]);
      if (creds.clientId) await this.run(["login", "--apikey"], { BW_CLIENTID: creds.clientId, BW_CLIENTSECRET: creds.clientSecret });
      else await this.run(["login", creds.email, "--passwordenv", "BW_PASSWORD", "--raw"], { BW_PASSWORD: creds.password });
    }
    return this.run(["unlock", "--passwordenv", "BW_PASSWORD", "--raw"], { BW_PASSWORD: creds.password });
  }

  async logout() {
    await this.run(["logout"]).catch(() => {});
    fs.rmSync(this.appDir, { recursive: true, force: true });
  }

  async sync(session) {
    await this.run(["sync"], { BW_SESSION: session });
  }

  async json(args, session) {
    return JSON.parse(await this.run(args, { BW_SESSION: session }));
  }

  items(session) {
    return this.json(["list", "items"], session);
  }
  folders(session) {
    return this.json(["list", "folders"], session);
  }
  collections(session) {
    return this.json(["list", "collections"], session);
  }
  item(session, id) {
    return this.json(["get", "item", id], session);
  }
  totp(session, id) {
    return this.run(["get", "totp", id], { BW_SESSION: session });
  }
}

const random = () => crypto.randomBytes(32).toString("base64url");
function same(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** The bridge's state and rules, separate from HTTP so tests can drive it with a fake CLI. */
export class Bridge {
  constructor({ bw, dataDir, now = () => Date.now() }) {
    this.bw = bw;
    this.dataDir = dataDir;
    this.now = now;
    this.session = null;
    this.problem = null;
    this.tickets = new Map();
    this.codes = new Map();
    this.cache = null;
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  }

  get settingsFile() {
    return path.join(this.dataDir, "settings.json");
  }
  get unlockFile() {
    return path.join(this.dataDir, "unlock.json");
  }
  settings() {
    try {
      return JSON.parse(fs.readFileSync(this.settingsFile, "utf8"));
    } catch {
      return null;
    }
  }

  /** At start: unlock again from what's saved, unless the person chose "lock when the server restarts". */
  async start() {
    const s = this.settings();
    if (!s) return;
    if (s.lockOnRestart) {
      fs.rmSync(this.unlockFile, { force: true });
      await this.bw.logout();
      return;
    }
    let creds = null;
    try {
      creds = JSON.parse(fs.readFileSync(this.unlockFile, "utf8"));
    } catch {
      return;
    }
    try {
      this.session = await this.bw.unlock(creds);
      this.problem = null;
    } catch (err) {
      this.problem = err.message;
    }
  }

  status() {
    const s = this.settings();
    const state = this.session ? "ready" : s ? "locked" : "not_connected";
    return { state, account: s?.account ?? null, lockOnRestart: !!s?.lockOnRestart, problem: this.problem };
  }

  /** A single-use code for the connect page; the hub asks for one when the person clicks Connect. */
  connectCode() {
    for (const [k, v] of this.codes) if (v.until < this.now()) this.codes.delete(k);
    while (this.codes.size >= 5) this.codes.delete(this.codes.keys().next().value);
    const code = random();
    this.codes.set(code, { until: this.now() + CODE_MS, tries: 0 });
    return { code, expiresAt: new Date(this.now() + CODE_MS).toISOString() };
  }

  /** The person signs the agents' account in on the connect page. */
  async connect(body) {
    const c = this.codes.get(String(body?.code ?? ""));
    if (!c || c.until < this.now()) throw new BridgeError("This link has expired. Open Settings → Memory vault in Wisp and press Connect again.", 403);
    if (++c.tries >= CODE_TRIES) this.codes.delete(String(body.code));
    const password = typeof body.password === "string" ? body.password : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
    const clientSecret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";
    if (!password || password.length > 1000) throw new BridgeError("Type the agents account's master password.");
    if (!clientId && !/^[^@\s]+@[^@\s]+$/.test(email)) throw new BridgeError("Type the agents account's email.");
    if (clientId && (!/^user\.[0-9a-f-]{36}$/i.test(clientId) || !clientSecret)) throw new BridgeError("That API key doesn't look right: client_id starts with “user.”.");
    const creds = clientId ? { clientId, clientSecret, password } : { email, password };
    await this.bw.logout();
    try {
      this.session = await this.bw.unlock(creds);
    } catch (err) {
      this.session = null;
      await this.bw.logout();
      // a mistyped reconnect doesn't leave agents without the account that was working
      await this.start().catch(() => {});
      throw new BridgeError(`Bitwarden didn't accept that: ${err.message}`, 400);
    }
    this.codes.delete(String(body.code));
    this.problem = null;
    this.cache = null;
    const lockOnRestart = body.lockOnRestart === true;
    fs.writeFileSync(this.settingsFile, JSON.stringify({ account: email || clientId, lockOnRestart, connectedAt: new Date(this.now()).toISOString() }), { mode: 0o600 });
    if (lockOnRestart) fs.rmSync(this.unlockFile, { force: true });
    else fs.writeFileSync(this.unlockFile, JSON.stringify(creds), { mode: 0o600 });
    const logins = await this.list(true);
    return { account: email || clientId, count: logins.length, agentsFound: this.agentsFound };
  }

  /** Sign the agents' account out and forget everything saved. */
  async forget() {
    this.session = null;
    this.cache = null;
    this.tickets.clear();
    fs.rmSync(this.unlockFile, { force: true });
    fs.rmSync(this.settingsFile, { force: true });
    await this.bw.logout();
  }

  needSession() {
    if (!this.session) throw new BridgeError(this.settings() ? "The Wisp vault is locked. Open Settings → Memory vault to unlock it." : "No vault account is connected for agents.", 423);
    return this.session;
  }

  /** Ids of the "Agents" collections and folders this account can see. */
  async agentsScope(session) {
    const [folders, collections] = await Promise.all([this.bw.folders(session), this.bw.collections(session).catch(() => [])]);
    const named = (x) => String(x.name ?? "").trim().toLowerCase() === AGENTS;
    return { folders: new Set(folders.filter(named).map((f) => f.id)), collections: new Set(collections.filter(named).map((c) => c.id)) };
  }

  /** Is this vault item a login meant for agents? */
  static forAgents(item, scope) {
    if (!item || item.type !== 1 || !item.login || item.deletedDate) return false;
    return (item.folderId && scope.folders.has(item.folderId)) || (item.collectionIds ?? []).some((id) => scope.collections.has(id));
  }

  static sites(item) {
    return [...new Set((item.login?.uris ?? []).map((u) => siteOf(u.uri)).filter(Boolean))];
  }

  /** The logins agents may use, without any secret: {id, title, site, username, hasOtp}. */
  async list(fresh = false) {
    const session = this.needSession();
    if (!fresh && this.cache && this.now() - this.cache.at < LIST_TTL_MS) return this.cache.logins;
    await this.bw.sync(session).catch(() => {});
    const scope = await this.agentsScope(session);
    this.agentsFound = scope.folders.size + scope.collections.size > 0;
    const logins = [];
    for (const item of await this.bw.items(session)) {
      if (!Bridge.forAgents(item, scope)) continue;
      const site = Bridge.sites(item)[0];
      if (!site) continue;
      logins.push({ id: String(item.id), title: String(item.name ?? site), site, username: String(item.login.username ?? ""), hasOtp: !!item.login.totp });
    }
    this.cache = { at: this.now(), logins };
    return logins;
  }

  /** Fresh from the vault: the item, only if it's still for agents and saved for `site`. */
  async checked(itemId, site) {
    const session = this.needSession();
    const item = await this.bw.item(session, itemId).catch(() => null);
    const scope = await this.agentsScope(session);
    if (!Bridge.forAgents(item, scope)) throw new BridgeError("That login isn't in the Agents folder or collection any more.", 404);
    if (!Bridge.sites(item).some((s) => bare(s) === bare(site))) throw new BridgeError(`That login isn't saved for ${site}.`, 403);
    return { session, item };
  }

  /** The hub asks, after the person said yes: a single-use ticket for one login on one site and computer. */
  async ticket(body) {
    const itemId = String(body?.itemId ?? "");
    const site = siteOf(body?.site ?? "");
    const computerId = String(body?.computerId ?? "");
    if (!ITEM_ID.test(itemId) || !site || !computerId || computerId.length > 200) throw new BridgeError("itemId, site and computerId are needed");
    await this.checked(itemId, site);
    for (const [k, v] of this.tickets) if (v.until < this.now()) this.tickets.delete(k);
    const ticket = random();
    this.tickets.set(ticket, { itemId, site, computerId, until: this.now() + TICKET_MS });
    return { ticket, expiresAt: new Date(this.now() + TICKET_MS).toISOString() };
  }

  /** The device, filling now: the login for a ticket, once. */
  async redeem(body) {
    const key = String(body?.ticket ?? "");
    const t = this.tickets.get(key);
    this.tickets.delete(key);
    if (!t || t.until < this.now()) throw new BridgeError("That fill ticket has expired or was already used.", 410);
    if (bare(siteOf(body?.site ?? "") ?? "") !== bare(t.site)) throw new BridgeError(`That ticket is for ${t.site}.`, 403);
    if (String(body?.computerId ?? "") !== t.computerId) throw new BridgeError("That ticket is for another computer.", 403);
    const { session, item } = await this.checked(t.itemId, t.site);
    const otp = item.login.totp ? await this.bw.totp(session, item.id).catch(() => "") : "";
    return { username: String(item.login.username ?? ""), password: String(item.login.password ?? ""), ...(otp ? { otp } : {}) };
  }
}

// --- HTTP ---

const PAGE = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "connect.html"), "utf8");
const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new BridgeError("too big", 413));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new BridgeError("not JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function createServer(bridge, { hubToken, redeemToken, log = (line) => console.log(line) }) {
  if (!hubToken || !redeemToken || hubToken.length < 32 || redeemToken.length < 32 || same(hubToken, redeemToken))
    throw new Error("BRIDGE_HUB_TOKEN and BRIDGE_REDEEM_TOKEN must each be set, at least 32 characters, and different");
  const bearer = (req) => (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://bridge");
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    try {
      const route = `${req.method} ${url.pathname}`;
      if (route === "GET /healthz") return send(200, { ok: true });
      if (route === "GET /vault-bridge/connect") {
        res.writeHead(200, PAGE_HEADERS);
        return res.end(PAGE);
      }
      if (route === "POST /vault-bridge/connect") {
        if (!/^application\/json/i.test(req.headers["content-type"] ?? "")) throw new BridgeError("JSON only", 415);
        return send(200, await bridge.connect(await readBody(req)));
      }
      if (route === "POST /v1/redeem") {
        if (!same(bearer(req), redeemToken)) throw new BridgeError("not allowed", 401);
        return send(200, await bridge.redeem(await readBody(req)));
      }
      if (!url.pathname.startsWith("/v1/")) throw new BridgeError("not found", 404);
      if (!same(bearer(req), hubToken)) throw new BridgeError("not allowed", 401);
      if (route === "GET /v1/status") return send(200, bridge.status());
      if (route === "POST /v1/connect-codes") return send(200, bridge.connectCode());
      if (route === "GET /v1/items") return send(200, { logins: await bridge.list(url.searchParams.get("fresh") === "1"), agentsFound: bridge.agentsFound ?? null });
      if (route === "POST /v1/tickets") return send(200, await bridge.ticket(await readBody(req)));
      if (route === "POST /v1/forget") return send(200, (await bridge.forget(), { ok: true }));
      throw new BridgeError("not found", 404);
    } catch (err) {
      const status = err instanceof BridgeError ? err.status : 500;
      // the path and status only: never a body or what bw said back
      log(`${req.method} ${url.pathname} ${status}`);
      send(status, { error: err instanceof BridgeError ? err.message : "the vault bridge hit an error" });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dataDir = process.env.BRIDGE_DATA ?? "/data";
  // the vault's https address (the Bitwarden CLI refuses http), e.g. https://203.0.113.7/vault
  const vaultUrl = process.env.BW_SERVER ?? "";
  if (!vaultUrl.startsWith("https://")) {
    console.error("vault-bridge: set BW_SERVER to the vault's https:// address");
    process.exit(1);
  }
  const bridge = new Bridge({ bw: new BwCli({ bin: process.env.BW_BIN ?? "bw", appDir: path.join(dataDir, "bw"), server: vaultUrl }), dataDir });
  const server = createServer(bridge, { hubToken: process.env.BRIDGE_HUB_TOKEN, redeemToken: process.env.BRIDGE_REDEEM_TOKEN });
  const port = Number(process.env.BRIDGE_PORT ?? 8088);
  server.listen(port, process.env.BRIDGE_HOST ?? "0.0.0.0", () => console.log(`vault-bridge listening on ${port}`));
  bridge.start().then(() => console.log(`vault-bridge: ${bridge.status().state}`));
}
