/**
 * Wisp's sign-in relay, shared by the three Pages Functions under functions/ (see docs/sign-in.md).
 *
 * GitHub, Slack and Google only send people back to an address registered with Wisp's app, and
 * every self-hosted hub has its own address. The relay is that registered address:
 *
 * - `/oauth/callback` gets the one-time code and sends the browser on to the hub named in `state`.
 *   A hub on the person's own computer or network gets it straight away; anything else is shown
 *   first, so a sign-in link someone else made can't quietly send the code to their hub.
 * - `/api/oauth/token` is called by the hub, never the browser: it adds the app's secret and
 *   trades a code (useless without the hub's PKCE verifier) or a refresh token for tokens.
 * - `/api/oauth/apps` says which apps are set up, so hubs show Sign in only where it works.
 *
 * Nothing is stored. Secrets are Pages environment variables: GITHUB_CLIENT_ID and
 * GITHUB_CLIENT_SECRET, SLACK_…, GOOGLE_….
 */

export type Provider = "github" | "slack" | "google";
export type Env = Partial<Record<`${"GITHUB" | "SLACK" | "GOOGLE"}_CLIENT_${"ID" | "SECRET"}`, string>>;

export const TOKEN_URL: Record<Provider, string> = {
  github: "https://github.com/login/oauth/access_token",
  slack: "https://slack.com/api/oauth.v2.user.access",
  google: "https://oauth2.googleapis.com/token",
};
const ENV_PREFIX: Record<Provider, "GITHUB" | "SLACK" | "GOOGLE"> = { github: "GITHUB", slack: "SLACK", google: "GOOGLE" };
export const PROVIDERS = Object.keys(TOKEN_URL) as Provider[];

export const HUB_CALLBACK = "/api/connectors/app/callback";

export function app(env: Env, p: Provider): { id: string; secret: string } | null {
  const id = env[`${ENV_PREFIX[p]}_CLIENT_ID`]?.trim();
  const secret = env[`${ENV_PREFIX[p]}_CLIENT_SECRET`]?.trim();
  return id && secret ? { id, secret } : null;
}

/** The apps set up here, by client ID (public anyway: it's in every sign-in link). */
export function apps(env: Env): Partial<Record<Provider, { clientId: string }>> {
  const out: Partial<Record<Provider, { clientId: string }>> = {};
  for (const p of PROVIDERS) {
    const a = app(env, p);
    if (a) out[p] = { clientId: a.id };
  }
  return out;
}

/** The hub's address from `state` ("<base64url origin>.<random>"), or null if it isn't one. */
export function hubFromState(state: string | null): URL | null {
  const head = state?.split(".")[0];
  if (!head || !/^[A-Za-z0-9_-]{4,400}$/.test(head)) return null;
  try {
    const b64 = head.replace(/-/g, "+").replace(/_/g, "/");
    const u = new URL(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.pathname !== "/" || u.search || u.hash) return null;
    return u;
  } catch {
    return null;
  }
}

/** A hub on the person's own computer or home network: nobody else can receive a code sent there. */
export function isOwnNetwork(u: URL): boolean {
  const h = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h === "::1") return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}

const esc = (t: string) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** The page shown before sending a code to a hub on the internet: whose Wisp it is going to. */
export function confirmPage(hub: URL, next: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Finish signing in</title>
<style>:root{color-scheme:light dark;--bg:#fff;--fg:#141414;--mute:#5c5c66;--line:#e4e4e8;--btn:#141414;--btnfg:#fff}@media(prefers-color-scheme:dark){:root{--bg:#121214;--fg:#ededf0;--mute:#a0a0aa;--line:#2a2a30;--btn:#ededf0;--btnfg:#121214}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,sans-serif}main{max-width:380px;padding:24px 16px}h1{font-size:19px;font-weight:600;margin:0 0 8px}p{margin:0 0 16px;color:var(--mute)}code{color:var(--fg);font:14px ui-monospace,monospace;word-break:break-all}
.row{display:flex;gap:12px;align-items:center}a.go{background:var(--btn);color:var(--btnfg);text-decoration:none;padding:8px 14px;border-radius:8px;font-weight:500}a.no{color:var(--mute)}</style>
<main><h1>Finish signing in</h1><p>This sign-in goes back to the Wisp at <code>${esc(hub.host)}</code>. Continue only if that's your Wisp.</p>
<div class="row"><a class="go" href="${esc(next)}">Continue</a><a class="no" href="/">Cancel</a></div></main></html>`;
}

/** Where the browser goes next with the code: the hub's own callback with what the company sent. */
export function forwardUrl(hub: URL, from: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const k of ["code", "state", "error", "error_description"]) {
    const v = from.get(k);
    if (v) out.set(k, v.slice(0, 2000));
  }
  return `${hub.origin}${HUB_CALLBACK}?${out}`;
}

export function callback(request: Request): Response {
  const url = new URL(request.url);
  const hub = hubFromState(url.searchParams.get("state"));
  const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
  if (!hub) return new Response("This sign-in link isn't from a Wisp. Start it again from Wisp.", { status: 400, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });
  const next = forwardUrl(hub, url.searchParams);
  if (isOwnNetwork(hub)) return new Response(null, { status: 302, headers: { ...headers, location: next } });
  return new Response(confirmPage(hub, next), { headers: { ...headers, "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" } });
}

/** The hub trades a code or a refresh token for tokens; the relay adds the app's secret and keeps nothing. */
export async function token(request: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (Number(request.headers.get("content-length") ?? 0) > 8000) return json(413, { error: "too_large" });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "invalid_request", error_description: "send JSON" });
  }
  const p = body.provider as Provider;
  if (!PROVIDERS.includes(p)) return json(400, { error: "invalid_request", error_description: "unknown provider" });
  const a = app(env, p);
  if (!a) return json(404, { error: "not_configured", error_description: "Wisp's app for this isn't set up yet" });
  const str = (k: string) => (typeof body[k] === "string" && (body[k] as string).length <= 4000 ? (body[k] as string) : "");
  const form = new URLSearchParams({ client_id: a.id, client_secret: a.secret });
  if (body.grant_type === "authorization_code") {
    // only codes that came back through this relay
    const own = new URL("/oauth/callback", request.url).href;
    if (str("redirect_uri") !== own || !str("code") || !str("code_verifier")) return json(400, { error: "invalid_request", error_description: "code, code_verifier and this relay's redirect_uri are needed" });
    for (const k of ["code", "code_verifier", "redirect_uri"]) form.set(k, str(k));
    form.set("grant_type", "authorization_code");
  } else if (body.grant_type === "refresh_token") {
    if (!str("refresh_token")) return json(400, { error: "invalid_request", error_description: "refresh_token is needed" });
    form.set("grant_type", "refresh_token");
    form.set("refresh_token", str("refresh_token"));
  } else return json(400, { error: "unsupported_grant_type" });
  const res = await fetchFn(TOKEN_URL[p], { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
