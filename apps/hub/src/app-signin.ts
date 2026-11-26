import crypto from "node:crypto";
import { envVar, SIGN_IN_PROVIDERS, type SignInProvider } from "@bubble-ai/core";
import { now } from "./auth.ts";
import type { Db } from "./db.ts";

/**
 * Signing in to GitHub, Slack and Google through Bubble AI's own app with each company, for connectors
 * whose servers can't register a hub by themselves the way MCP sign-in does.
 *
 * Those companies only send people back to an address registered with the app, and every
 * self-hosted hub has its own address. So unless a hub has its own app for a company
 * (BUBBLE_<COMPANY>_CLIENT_ID and _SECRET), the sign-in goes through the relay on Bubble AI's website:
 *
 *   1. The hub sends the browser to the company's sign-in page, with the relay as the address to
 *      come back to and this hub's address inside `state`.
 *   2. The company sends the browser to the relay with a one-time code. The relay forwards that
 *      code to this hub (after asking, when the hub isn't on the person's own network).
 *   3. This hub trades the code for tokens through the relay, which adds the app's secret.
 *      The code is useless without this hub's PKCE verifier, which never leaves the hub.
 *
 * Tokens only ever travel hub ↔ relay ↔ company, never through the browser, and the relay keeps
 * nothing. Refreshing goes the same way.
 */

export const APP_CALLBACK_PATH = "/api/connectors/app/callback";
// Still the site's address from before the rename: the GitHub, Slack and Google sign-in apps only send people
// back to the callback registered with them (docs/sign-in.md). Move it once those apps list the new site too.
export const DEFAULT_RELAY = "https://wisp-app.pages.dev";

type Row = {
  connector_id: string;
  provider: string | null;
  redirect_url: string | null;
  tokens_json: string | null;
  expires_at: string | null;
  verifier: string | null;
  state: string | null;
  return_to: string | null;
};

/** What a company's token endpoint said, made the same shape for all of them. */
export interface AppTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

/** Where this hub gets a company's app from: its own (set by whoever runs it) or the relay's. */
type AppSource = { kind: "own"; clientId: string; clientSecret: string } | { kind: "relay"; relay: string; clientId: string };

const ENV_NAME: Record<SignInProvider, string> = { github: "GITHUB", slack: "SLACK", google: "GOOGLE" };

export class AppSignInError extends Error {
  /** the company itself said no (a bad or revoked grant), as opposed to not being reachable */
  constructor(
    message: string,
    readonly refused = false,
  ) {
    super(message);
  }
}

/** The relay URL, or null when this hub was told not to use one (BUBBLE_SIGNIN_RELAY=off). */
export function relayUrl(): string | null {
  const v = envVar("SIGNIN_RELAY")?.trim();
  if (v === "off" || v === "none") return null;
  return (v || DEFAULT_RELAY).replace(/\/+$/, "");
}

/** `state` for a relay sign-in: the hub's address (so the relay knows where to send the code) and a random part. */
export function relayState(origin: string): string {
  return `${Buffer.from(origin).toString("base64url")}.${crypto.randomBytes(24).toString("base64url")}`;
}

/** Answers that mean the sign-in itself is gone (revoked, expired, or the app was removed), not a passing failure. */
const DEAD_GRANT = new Set(["invalid_grant", "invalid_token", "invalid_refresh_token", "token_revoked", "token_expired", "access_denied", "unauthorized_client", "invalid_client", "bad_refresh_token"]);

/** Make one company's token answer the usual OAuth shape. Slack puts user tokens under `authed_user`; GitHub and Slack say errors with a 200. */
export function normalizeTokens(provider: SignInProvider, body: Record<string, any>): AppTokens {
  if (provider === "slack" && body.ok === false) throw new AppSignInError(`Slack said no (${body.error ?? "unknown error"})`, DEAD_GRANT.has(body.error));
  if (body.error) throw new AppSignInError(`${SIGN_IN_PROVIDERS[provider].name} said no (${body.error_description || body.error})`, DEAD_GRANT.has(body.error));
  const t = provider === "slack" && body.authed_user?.access_token ? body.authed_user : body;
  if (!t.access_token || typeof t.access_token !== "string") throw new AppSignInError(`${SIGN_IN_PROVIDERS[provider].name} didn't send a token back`);
  return {
    access_token: t.access_token,
    ...(t.refresh_token ? { refresh_token: String(t.refresh_token) } : {}),
    ...(Number(t.expires_in) > 0 ? { expires_in: Number(t.expires_in) } : {}),
    ...(t.scope ? { scope: String(t.scope) } : {}),
    token_type: t.token_type ?? "bearer",
  };
}

export class AppSignIn {
  /** the relay's apps, looked up now and then (an owner can add one without anyone updating their hub) */
  private relayApps: { at: number; apps: Partial<Record<SignInProvider, { clientId: string }>> } | null = null;

  constructor(
    private db: Db,
    private fetchFn: () => typeof fetch,
  ) {}

  private rows(where: string, ...args: unknown[]) {
    return this.db.prepare(`SELECT * FROM connector_auth WHERE ${where}`).all(...args) as Row[];
  }

  private async source(provider: SignInProvider): Promise<AppSource | null> {
    const clientId = envVar(`${ENV_NAME[provider]}_CLIENT_ID`)?.trim();
    const clientSecret = envVar(`${ENV_NAME[provider]}_CLIENT_SECRET`)?.trim();
    if (clientId && clientSecret) return { kind: "own", clientId, clientSecret };
    const relay = relayUrl();
    if (!relay) return null;
    if (!this.relayApps || Date.now() - this.relayApps.at > 10 * 60_000) {
      try {
        const res = await this.fetchFn()(`${relay}/api/oauth/apps`, { signal: AbortSignal.timeout(10_000) });
        const apps = res.ok ? ((await res.json()) as Record<string, { clientId?: unknown }>) : {};
        const ok: Partial<Record<SignInProvider, { clientId: string }>> = {};
        for (const p of Object.keys(SIGN_IN_PROVIDERS) as SignInProvider[]) if (typeof apps[p]?.clientId === "string" && apps[p]!.clientId) ok[p] = { clientId: apps[p]!.clientId as string };
        this.relayApps = { at: Date.now(), apps: ok };
      } catch {
        // can't reach it: ask again next time rather than remembering "none"
        return null;
      }
    }
    const app = this.relayApps.apps[provider];
    return app ? { kind: "relay", relay, clientId: app.clientId } : null;
  }

  /** Whether signing in with this company works from this hub, and if not, why (in plain words). */
  async available(provider: SignInProvider): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (await this.source(provider)) return { ok: true };
    const name = SIGN_IN_PROVIDERS[provider].name;
    return { ok: false, reason: relayUrl() ? `Signing in with ${name} isn't set up for Bubble AI yet.` : `Signing in with ${name} needs Bubble AI's sign-in service, which this hub has turned off.` };
  }

  /**
   * Start one sign-in for one or more connectors (Gmail and Google Calendar can share one).
   * Returns the company's sign-in page to send the browser to.
   */
  async start(connectorIds: string[], provider: SignInProvider, scopes: string[], origin: string, userId: string, returnTo: string | null): Promise<string> {
    const src = await this.source(provider);
    if (!src) throw new AppSignInError((await this.available(provider) as { reason: string }).reason);
    const hubOrigin = new URL(origin).origin;
    const redirect = src.kind === "own" ? `${hubOrigin}${APP_CALLBACK_PATH}` : `${src.relay}/oauth/callback`;
    const state = src.kind === "own" ? crypto.randomBytes(24).toString("base64url") : relayState(hubOrigin);
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    for (const cid of connectorIds) {
      this.db.prepare("INSERT INTO connector_auth (connector_id, required, updated_at) VALUES (?, 1, ?) ON CONFLICT(connector_id) DO UPDATE SET required = 1").run(cid, now());
      this.db
        .prepare("UPDATE connector_auth SET provider = ?, redirect_url = ?, state = ?, verifier = ?, return_to = ?, signed_in_by = ?, error = NULL, client_json = NULL, browser_nonce = NULL, updated_at = ? WHERE connector_id = ?")
        .run(provider, redirect, state, verifier, returnTo, userId, now(), cid);
    }
    const p = SIGN_IN_PROVIDERS[provider];
    const q = new URLSearchParams({ client_id: src.clientId, redirect_uri: redirect, response_type: "code", state, code_challenge: challenge, code_challenge_method: "S256" });
    if (provider === "slack") q.set("user_scope", scopes.join(","));
    else q.set("scope", scopes.join(" "));
    // Google: a refresh token, and ask again even if signed in before, so one always comes back
    if (provider === "google") (q.set("access_type", "offline"), q.set("prompt", "consent"), q.set("include_granted_scopes", "true"));
    return `${p.authorize}?${q}`;
  }

  /** Trade a code or refresh token for tokens, directly with the company or through the relay. */
  private async token(provider: SignInProvider, form: Record<string, string>): Promise<AppTokens> {
    const src = await this.source(provider);
    if (!src) throw new AppSignInError((await this.available(provider) as { reason: string }).reason);
    const res =
      src.kind === "own"
        ? await this.fetchFn()(SIGN_IN_PROVIDERS[provider].token, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
            body: new URLSearchParams({ ...form, client_id: src.clientId, client_secret: src.clientSecret }),
            signal: AbortSignal.timeout(20_000),
          })
        : await this.fetchFn()(`${src.relay}/api/oauth/token`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ provider, ...form }),
            signal: AbortSignal.timeout(20_000),
          });
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok && !body.error) throw new AppSignInError(`${SIGN_IN_PROVIDERS[provider].name} sign-in failed (${res.status})`);
    return normalizeTokens(provider, body);
  }

  private save(connectorId: string, t: AppTokens) {
    const keep = this.rows("connector_id = ?", connectorId)[0]?.tokens_json;
    const refresh = t.refresh_token ?? (keep ? (JSON.parse(keep) as AppTokens).refresh_token : undefined);
    const expires = t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null;
    this.db
      .prepare("UPDATE connector_auth SET tokens_json = ?, expires_at = ?, error = NULL, required = 1, updated_at = ? WHERE connector_id = ?")
      .run(JSON.stringify({ ...t, ...(refresh ? { refresh_token: refresh } : {}) }), expires, now(), connectorId);
  }

  /** The company (through the relay, or straight here) sent the browser back with a code. Returns the connectors signed in and where to go next. */
  async finish(state: string, code: string): Promise<{ connectorIds: string[]; returnTo: string | null }> {
    const rows = this.rows("state = ? AND provider IS NOT NULL", state);
    if (!rows.length || !rows[0].verifier || !rows[0].redirect_url) throw new AppSignInError("This sign-in link has expired. Start it again.");
    const provider = rows[0].provider as SignInProvider;
    const clear = () => this.db.prepare("UPDATE connector_auth SET state = NULL, verifier = NULL, browser_nonce = NULL WHERE state = ?").run(state);
    try {
      const t = await this.token(provider, { grant_type: "authorization_code", code, redirect_uri: rows[0].redirect_url, code_verifier: rows[0].verifier });
      for (const r of rows) this.save(r.connector_id, t);
    } catch (e) {
      for (const r of rows) this.db.prepare("UPDATE connector_auth SET error = ? WHERE connector_id = ?").run((e as Error).message.slice(0, 500), r.connector_id);
      throw e;
    } finally {
      clear();
    }
    return { connectorIds: rows.map((r) => r.connector_id), returnTo: rows[0].return_to };
  }

  /** The sign-in page said no (the person pressed Cancel): note it on the connectors waiting for it. */
  fail(state: string, message: string): string | null {
    const rows = this.rows("state = ? AND provider IS NOT NULL", state);
    for (const r of rows) this.db.prepare("UPDATE connector_auth SET error = ?, state = NULL, verifier = NULL, browser_nonce = NULL WHERE connector_id = ?").run(message.slice(0, 500), r.connector_id);
    return rows[0]?.return_to ?? null;
  }

  /** Whether this connector signs in through a company app (and so refreshes here, not with the MCP server). */
  handles(connectorId: string): boolean {
    return !!this.rows("connector_id = ? AND provider IS NOT NULL", connectorId)[0];
  }

  /** Before a run: refresh a token that's about to run out. A refused refresh signs the connector out with a plain reason. */
  async fresh(connectorId: string): Promise<void> {
    const r = this.rows("connector_id = ? AND provider IS NOT NULL", connectorId)[0];
    if (!r?.tokens_json) return;
    if (!r.expires_at || new Date(r.expires_at).getTime() - Date.now() > 5 * 60_000) return;
    const refresh = (JSON.parse(r.tokens_json) as AppTokens).refresh_token;
    if (!refresh) return;
    try {
      this.save(connectorId, await this.token(r.provider as SignInProvider, { grant_type: "refresh_token", refresh_token: refresh }));
    } catch (e) {
      // only the company saying no ends the sign-in; the relay or the company being away for a while doesn't
      if (e instanceof AppSignInError && e.refused) this.db.prepare("UPDATE connector_auth SET error = ?, tokens_json = NULL, expires_at = NULL WHERE connector_id = ?").run(`Signed out: ${e.message}`.slice(0, 500), connectorId);
      else this.db.prepare("UPDATE connector_auth SET error = ? WHERE connector_id = ?").run(`Couldn't renew the sign-in yet: ${(e as Error).message}`.slice(0, 500), connectorId);
    }
  }
}
