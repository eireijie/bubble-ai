import type { Connector, SignInOption } from "@wisp/core";
import { api } from "./api.ts";

/**
 * One-click sign-in to catalog apps (Gmail, Google Calendar, Google Drive, GitHub, Slack, Notion,
 * Linear, Vercel) for screens that stay put while the person signs in, like onboarding's
 * "Set up apps" sheet. The sign-in page opens in its own tab (the browser, from the desktop app),
 * and the promise settles when the hub says it's done. Tokens never come near the browser.
 */

/** Which catalog apps can sign in from where Wisp is open, and why not where they can't. */
export function signInOptions(origin = location.origin): Promise<Record<string, SignInOption>> {
  return api("GET", `/api/connectors/sign-in?origin=${encodeURIComponent(origin)}`);
}

export type SignInResult = { ok: true; connectors: Connector[] } | { ok: false; error: string; connectors: Connector[] };

const inDesktop = () => typeof window !== "undefined" && !!(window as { wispDesktop?: unknown }).wispDesktop;

/**
 * Connect apps by signing in. Call it straight from a click: browsers only allow the new tab then.
 * Several apps from one company (Gmail and Google Calendar) share one sign-in.
 * `who`: the agents that get them (default: every agent, including ones made later).
 */
export async function connectApps(catalogIds: string[], who: { agentIds?: string[]; allAgents?: boolean } = { allAgents: true }, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<SignInResult> {
  // a tab opened on the click itself, pointed at the sign-in page once the hub has it (the desktop app opens the browser instead)
  const tab = inDesktop() ? null : window.open("", "_blank");
  let made: Connector[] = [];
  try {
    const r = await api<{ url?: string; signedIn?: boolean; connectors: Connector[] }>("POST", "/api/connectors/connect", { catalogIds, origin: location.origin, returnTo: "close", ...who });
    made = r.connectors;
    if (!r.url) {
      tab?.close();
      return { ok: true, connectors: made };
    }
    if (tab) tab.location.href = r.url;
    else window.open(r.url, "_blank");
  } catch (e) {
    tab?.close();
    return { ok: false, error: (e as Error).message, connectors: made };
  }
  return waitForSignIn(made.map((c) => c.id), opts);
}

/** Look at the connectors until each is signed in, one says why it isn't, or time runs out. */
export async function waitForSignIn(ids: string[], { timeoutMs = 5 * 60_000, pollMs = 1500 }: { timeoutMs?: number; pollMs?: number } = {}): Promise<SignInResult> {
  const until = Date.now() + timeoutMs;
  let last: Connector[] = [];
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, pollMs));
    try {
      last = (await api<Connector[]>("GET", "/api/connectors")).filter((c) => ids.includes(c.id));
    } catch {
      continue;
    }
    if (last.length && last.every((c) => c.auth?.signedIn)) return { ok: true, connectors: last };
    const failed = last.find((c) => c.auth?.error);
    if (failed) return { ok: false, error: failed.auth!.error!, connectors: last };
  }
  return { ok: false, error: "The sign-in didn't finish. Try again.", connectors: last };
}
