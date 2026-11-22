import crypto from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { AppSignIn } from "./app-signin.ts";
import { now } from "./auth.ts";
import type { Db } from "./db.ts";

/**
 * Signing in to remote MCP servers (Notion, Linear, Zapier…) the way the MCP spec describes:
 * the hub finds the server's sign-in page, registers itself as a client, sends the person there,
 * and keeps the tokens it gets back, refreshing them before agents need them. Agents only ever
 * get a short-lived access token in their run.
 */

type Row = {
  connector_id: string;
  required: number;
  redirect_url: string | null;
  client_json: string | null;
  tokens_json: string | null;
  expires_at: string | null;
  verifier: string | null;
  state: string | null;
  signed_in_by: string | null;
  error: string | null;
  provider: string | null;
  return_to: string | null;
  browser_nonce: string | null;
};

export interface ConnectorAuthStatus {
  /** the server wants people to sign in */
  required: boolean;
  signedIn: boolean;
  /** why the last sign-in or refresh failed */
  error: string | null;
}

export const CALLBACK_PATH = "/api/connectors/oauth/callback";

const notPublic = new BlockList();
for (const [ip, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) notPublic.addSubnet(ip, bits, "ipv4");
for (const [ip, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8], ["64:ff9b::", 96], ["2002::", 16], ["2001::", 32]] as const) notPublic.addSubnet(ip, bits, "ipv6");

/** Whether every address a URL's host names is on the public internet, not this machine or its networks. */
export async function isPublicUrl(url: string | URL): Promise<boolean> {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = u.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
    return addresses.length > 0 && addresses.every((a) => {
      // BlockList applies IPv4 rules to mapped addresses (::ffff:127.0.0.1) too
      return !notPublic.check(a, isIP(a) === 6 ? "ipv6" : "ipv4");
    });
  } catch {
    return false;
  }
}

/** Fetch that only calls public addresses, checking each redirect itself so one can't lead back inside. */
function publicOnly(fetchFn: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    let url = input instanceof Request ? input.url : String(input);
    for (let hop = 0; hop < 5; hop++) {
      if (!(await isPublicUrl(url))) throw new Error("connected apps can only reach public addresses");
      const res = await fetchFn(hop === 0 ? input : url, { ...init, redirect: "manual" });
      const to = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!to) return res;
      await res.body?.cancel().catch(() => {});
      url = new URL(to, url).href;
    }
    throw new Error("too many redirects");
  }) as typeof fetch;
}

/** One sign-in flow for one connector, kept in the database between the redirect and the callback. */
class Provider implements OAuthClientProvider {
  authorizationUrl: URL | null = null;

  constructor(
    private db: Db,
    private connectorId: string,
    private redirect: string,
  ) {}

  private row() {
    return this.db.prepare("SELECT * FROM connector_auth WHERE connector_id = ?").get(this.connectorId) as Row | undefined;
  }

  private set(cols: Partial<Row>) {
    this.db.prepare("INSERT OR IGNORE INTO connector_auth (connector_id, updated_at) VALUES (?, ?)").run(this.connectorId, now());
    const keys = Object.keys(cols);
    this.db.prepare(`UPDATE connector_auth SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE connector_id = ?`).run(...keys.map((k) => (cols as Record<string, unknown>)[k]), now(), this.connectorId);
  }

  get redirectUrl() {
    return this.redirect;
  }

  get clientMetadata(): OAuthClientMetadata {
    return { client_name: "Wisp", redirect_uris: [this.redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
  }

  state() {
    return this.row()?.state ?? "";
  }

  clientInformation() {
    const r = this.row();
    // a client registered for another address (the hub moved, or HTTPS was added) can't come back here
    return r?.client_json && r.redirect_url === this.redirect ? (JSON.parse(r.client_json) as OAuthClientInformationMixed) : undefined;
  }

  saveClientInformation(info: OAuthClientInformationMixed) {
    this.set({ client_json: JSON.stringify(info), redirect_url: this.redirect });
  }

  tokens() {
    const r = this.row();
    return r?.tokens_json ? (JSON.parse(r.tokens_json) as OAuthTokens) : undefined;
  }

  saveTokens(tokens: OAuthTokens) {
    const expires = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;
    // a refresh may not send a new refresh token; keep the one we have
    const keep = this.tokens()?.refresh_token;
    this.set({ tokens_json: JSON.stringify({ ...tokens, refresh_token: tokens.refresh_token ?? keep }), expires_at: expires, error: null, required: 1 });
  }

  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }

  saveCodeVerifier(v: string) {
    this.set({ verifier: v });
  }

  codeVerifier() {
    const v = this.row()?.verifier;
    if (!v) throw new Error("this sign-in has expired; start it again");
    return v;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "client") this.set({ client_json: null });
    if (scope === "all" || scope === "tokens") this.set({ tokens_json: null, expires_at: null });
    if (scope === "all" || scope === "verifier") this.set({ verifier: null });
  }
}

export class ConnectorAuth {
  /** tests swap this for a fake server */
  fetchFn: typeof fetch = (...a) => fetch(...a);
  /** sign-ins through Wisp's app with GitHub, Slack or Google */
  readonly apps: AppSignIn;

  constructor(private db: Db) {
    this.apps = new AppSignIn(db, () => this.fetchFn);
  }

  private row(connectorId: string) {
    return this.db.prepare("SELECT * FROM connector_auth WHERE connector_id = ?").get(connectorId) as Row | undefined;
  }

  /** How the hub calls this connector's server. Only one the hub's owner added may reach private
   * addresses (anyone can be made owner of an organization of their own). */
  private fetchFor(connectorId: string): typeof fetch {
    const added = this.db
      .prepare("SELECT m.role FROM connectors c JOIN memberships m ON m.user_id = c.created_by AND m.workspace_id = (SELECT id FROM workspaces ORDER BY created_at LIMIT 1) WHERE c.id = ?")
      .get(connectorId) as { role: string } | undefined;
    return added?.role === "owner" ? this.fetchFn : publicOnly(this.fetchFn);
  }

  status(connectorId: string): ConnectorAuthStatus | null {
    const r = this.row(connectorId);
    if (!r || !r.required) return null;
    return { required: true, signedIn: !!r.tokens_json, error: r.error };
  }

  /**
   * Whether a remote server wants a sign-in: it answers an unauthenticated MCP request with 401.
   * Remembered, so the Connectors page can show a Sign in button.
   */
  async probe(connectorId: string, url: string, headers: Record<string, string> = {}): Promise<boolean> {
    let required = false;
    try {
      const res = await this.fetchFor(connectorId)(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "wisp", version: "0.1" } } }),
        signal: AbortSignal.timeout(15_000),
      });
      required = res.status === 401;
      await res.body?.cancel().catch(() => {});
    } catch {
      return false;
    }
    if (required) this.db.prepare("INSERT INTO connector_auth (connector_id, required, updated_at) VALUES (?, 1, ?) ON CONFLICT(connector_id) DO UPDATE SET required = 1").run(connectorId, now());
    return required;
  }

  /**
   * Start signing in: returns the page to send the person to, or null if it's signed in already.
   * `scope` asks for less than everything (Linear's "read"); `returnTo` is where the browser goes
   * after (a web app page like "#/connectors", or "close" for a sign-in opened in its own tab).
   */
  async start(connectorId: string, serverUrl: string, origin: string, userId: string, opts: { scope?: string; returnTo?: string | null } = {}): Promise<string | null> {
    const redirect = new URL(CALLBACK_PATH, origin).href;
    const provider = new Provider(this.db, connectorId, redirect);
    const state = crypto.randomBytes(24).toString("base64url");
    this.db.prepare("INSERT INTO connector_auth (connector_id, required, updated_at) VALUES (?, 1, ?) ON CONFLICT(connector_id) DO UPDATE SET required = 1").run(connectorId, now());
    // an MCP sign-in now: drop any app sign-in left from before
    this.db.prepare("UPDATE connector_auth SET state = ?, signed_in_by = ?, error = NULL, tokens_json = NULL, expires_at = NULL, provider = NULL, return_to = ?, browser_nonce = NULL WHERE connector_id = ?").run(state, userId, opts.returnTo ?? null, connectorId);
    const result = await auth(provider, { serverUrl, fetchFn: this.fetchFor(connectorId), ...(opts.scope ? { scope: opts.scope } : {}) });
    return result === "REDIRECT" ? provider.authorizationUrl!.href : null;
  }

  // --- which browser finishes a sign-in ------------------------------------------------------------
  //
  // A sign-in link can be passed to someone else: a member could send the owner the link for the
  // member's own connector, and the owner's account would land on it. So the browser that starts
  // a sign-in gets a cookie with a secret, and a callback that arrives without it (another
  // browser, or the desktop app's sign-in that opened in the system browser) asks first, naming
  // who started it and for what.

  /** The cookie name for one sign-in (several can be under way at once). */
  static cookieName(state: string): string {
    return `wisp_signin_${crypto.createHash("sha256").update(state).digest("hex").slice(0, 16)}`;
  }

  /** Remember a secret for the sign-in under way with this state; returns the cookie to set on the browser starting it. */
  bindBrowser(state: string, secure: boolean): string {
    const nonce = crypto.randomBytes(24).toString("base64url");
    this.db.prepare("UPDATE connector_auth SET browser_nonce = ? WHERE state = ?").run(nonce, state);
    return `${ConnectorAuth.cookieName(state)}=${nonce}; Path=/api/connectors/; Max-Age=1800; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  }

  /** Whether this callback came back to the browser that started the sign-in. */
  sameBrowser(state: string, cookieHeader: string | undefined): boolean {
    const r = this.db.prepare("SELECT browser_nonce FROM connector_auth WHERE state = ? AND browser_nonce IS NOT NULL LIMIT 1").get(state) as { browser_nonce: string } | undefined;
    if (!r || !cookieHeader) return false;
    const name = ConnectorAuth.cookieName(state);
    const got = cookieHeader.split(";").map((p) => p.trim().split("=")).find(([k]) => k === name)?.[1] ?? "";
    const a = Buffer.from(got), b = Buffer.from(r.browser_nonce);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** The cookie that clears this sign-in's secret once it's done. */
  static clearCookie(state: string): string {
    return `${ConnectorAuth.cookieName(state)}=; Path=/api/connectors/; Max-Age=0; HttpOnly; SameSite=Lax`;
  }

  /** A sign-in under way with this state (either kind): who started it and for which connectors. */
  pending(state: string): { userId: string | null; connectorIds: string[]; app: boolean } | null {
    const rows = this.db.prepare("SELECT connector_id, signed_in_by, provider FROM connector_auth WHERE state = ?").all(state) as { connector_id: string; signed_in_by: string | null; provider: string | null }[];
    return rows.length ? { userId: rows[0].signed_in_by, connectorIds: rows.map((r) => r.connector_id), app: !!rows[0].provider } : null;
  }

  /** Where the browser goes after the sign-in under way with this state (see start). */
  returnToFor(state: string): string | null {
    return (this.db.prepare("SELECT return_to FROM connector_auth WHERE state = ? LIMIT 1").get(state) as { return_to: string | null } | undefined)?.return_to ?? null;
  }

  /** The sign-in page said no (the person pressed Cancel): note it on the connectors waiting for it. */
  failPending(state: string, message: string) {
    this.db.prepare("UPDATE connector_auth SET error = ?, state = NULL, verifier = NULL, browser_nonce = NULL WHERE state = ?").run(message.slice(0, 500), state);
  }

  /** The sign-in page sent the person back with a code: trade it for tokens. */
  async finish(state: string, code: string, serverUrlFor: (connectorId: string) => string | null): Promise<string> {
    const r = this.db.prepare("SELECT * FROM connector_auth WHERE state = ? AND provider IS NULL").get(state) as Row | undefined;
    if (!r?.redirect_url) throw new Error("This sign-in link has expired. Start it again from Connected apps.");
    const serverUrl = serverUrlFor(r.connector_id);
    if (!serverUrl) throw new Error("That connected app was removed.");
    const provider = new Provider(this.db, r.connector_id, r.redirect_url);
    try {
      await auth(provider, { serverUrl, authorizationCode: code, fetchFn: this.fetchFor(r.connector_id) });
    } catch (e) {
      this.db.prepare("UPDATE connector_auth SET error = ? WHERE connector_id = ?").run((e as Error).message.slice(0, 500), r.connector_id);
      throw e;
    } finally {
      this.db.prepare("UPDATE connector_auth SET state = NULL, verifier = NULL, browser_nonce = NULL WHERE connector_id = ?").run(r.connector_id);
    }
    return r.connector_id;
  }

  /** Make sure the access token will last the run; refresh it if it's about to expire. */
  async fresh(connectorId: string, serverUrl: string): Promise<void> {
    if (this.apps.handles(connectorId)) return this.apps.fresh(connectorId);
    const r = this.row(connectorId);
    if (!r?.tokens_json || !r.redirect_url) return;
    if (r.expires_at && new Date(r.expires_at).getTime() - Date.now() > 5 * 60_000) return;
    const tokens = JSON.parse(r.tokens_json) as OAuthTokens;
    if (!tokens.refresh_token) return;
    const provider = new Provider(this.db, connectorId, r.redirect_url);
    try {
      const result = await auth(provider, { serverUrl, fetchFn: this.fetchFor(connectorId) });
      if (result === "REDIRECT") throw new Error("the sign-in expired; sign in again");
    } catch (e) {
      this.db.prepare("UPDATE connector_auth SET error = ?, tokens_json = NULL, expires_at = NULL WHERE connector_id = ?").run(`Signed out: ${(e as Error).message}`.slice(0, 500), connectorId);
    }
  }

  /** The bearer token to send, if signed in. */
  accessToken(connectorId: string): string | null {
    const r = this.row(connectorId);
    return r?.tokens_json ? ((JSON.parse(r.tokens_json) as OAuthTokens).access_token ?? null) : null;
  }

  /** Drop everything about signing in: tokens, the client registered, and any sign-in under way. */
  forget(connectorId: string) {
    this.db.prepare("DELETE FROM connector_auth WHERE connector_id = ?").run(connectorId);
  }

  signOut(connectorId: string) {
    this.db.prepare("UPDATE connector_auth SET tokens_json = NULL, expires_at = NULL, state = NULL, verifier = NULL, error = NULL WHERE connector_id = ?").run(connectorId);
  }
}
