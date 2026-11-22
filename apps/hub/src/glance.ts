import { APPLE_APP_INFO, type Agent, type AppleChat, type AppleEvent, type AppleOp, type AppleReminder } from "@wisp/core";
import { isChange, span, when } from "./apple.ts";
import type { Hub } from "./hub.ts";
import { WatchError, WATCHERS, type FoundEvent, type Watcher } from "./watchers/index.ts";

/**
 * A new agent's first look at the apps the person just connected, so its hello can be about their
 * real work. Read-only: it only uses the watchers' own reads (and Apple's read ops), through a fetch
 * that refuses anything but GETs and the two read-only POSTs the watchers make. What it reads goes
 * into the hello's prompt framed as outside content (frameOutside in greeting.ts).
 */

/** What one app showed: a short line per thing, and a few words from those lines the UI can underline. */
export interface Glance {
  /** the app's name, as the person knows it ("GitHub", "Messages") */
  app: string;
  lines: string[];
  terms: string[];
}

/** How far back the first look goes. */
const LOOK_BACK_MS = 3 * 24 * 60 * 60_000;
/** Things kept per app, newest first. */
const MAX_LINES = 6;
const MAX_TERMS = 6;
const LINE_CHARS = 200;
/** How long one app may take; a slow one is left out. */
export const GLANCE_TIMEOUT_MS = 10_000;

/** The apps a glance reads; Google's wait for Wisp's own Google sign-in. */
const GLANCE_SERVICES = new Set(["github", "slack", "notion", "linear", "jira", "stripe"]);

/** POSTs the watchers make that only read: Notion's search and Linear's GraphQL queries. */
function readOnlyPost(url: string, body: unknown): boolean {
  if (url.startsWith("https://api.notion.com/v1/search")) return true;
  if (url.startsWith("https://api.linear.app/graphql")) {
    try {
      return /^\s*query\b/.test(String(JSON.parse(String(body)).query ?? ""));
    } catch {
      return false;
    }
  }
  return false;
}

/** A fetch that only reads: anything else is refused before it leaves the hub. */
export function readOnlyFetch(inner: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET" && !(method === "POST" && readOnlyPost(url, init?.body))) throw new WatchError("Wisp only reads here.", false);
    return inner(input, init);
  }) as typeof fetch;
}

/** A cursor meaning "since then", in the watcher's own format: unix seconds for Slack and Stripe, ISO for the rest. */
export const cursorSince = (w: Pick<Watcher, "service">, since: Date) => (w.service === "slack" || w.service === "stripe" ? String(Math.floor(since.getTime() / 1000)) : since.toISOString());

/**
 * Apps connected by signing in instead of a key: the key the watcher reads, filled from the
 * sign-in's token. GitHub's and Slack's are ordinary user tokens for their own APIs. Linear's and
 * Notion's come from their MCP servers' own sign-in; unproven whether their APIs take them (a
 * refused one only leaves that app out of the hello).
 */
const SIGNED_IN_AS: Partial<Record<string, string>> = { github: "GITHUB_TOKEN", slack: "SLACK_USER_TOKEN", linear: "LINEAR_API_KEY", notion: "NOTION_TOKEN" };

/** The values a connector signs in with: its key, or the token from signing in when it has no key. */
function credsOf(hub: Hub, connectorId: string, w: Watcher): Record<string, string> {
  const creds = { ...(hub.connectors.values(connectorId) ?? {}) };
  const key = SIGNED_IN_AS[w.service];
  if (key && !has(w, creds)) {
    const token = hub.connectors.auth.accessToken(connectorId);
    if (token) creds[key] = token;
  }
  return creds;
}

const has = (w: Watcher, c: Record<string, string>) => w.needs.every((any) => any.some((k) => c[k]?.trim()));

const clip = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > LINE_CHARS ? `${t.slice(0, LINE_CHARS - 1)}…` : t;
};

/** An id rather than a name (Slack's U0123ABCD, Notion's uuids): not worth showing. */
const idLike = (s: string) => /^[A-Z0-9]{8,}$/.test(s) || /^[0-9a-f-]{20,}$/i.test(s);

function eventLine(e: FoundEvent): string {
  const who = e.actor && !idLike(e.actor) ? ` (${e.actor})` : "";
  return clip(`${e.title}${who}${e.preview ? `: ${e.preview}` : ""}`);
}

/** Distinctive bits of a thing: its repo or key ("o/r", "ENG-12"), who, issue numbers and amounts. */
function eventTerms(e: FoundEvent): string[] {
  const out: string[] = [];
  const head = e.title.split(": ")[0];
  if (head !== e.title && head.length <= 40) out.push(head);
  else if (e.title.length <= 40) out.push(e.title);
  if (e.actor && !idLike(e.actor)) out.push(e.actor);
  for (const m of `${e.title} ${e.preview ?? ""}`.matchAll(/#[\w-]+|\b\d[\d,.]*\s?[A-Z]{3}\b|\$\d[\d,.]*/g)) out.push(m[0]);
  return out;
}

/** Up to MAX_TERMS distinct terms that appear in the lines. */
function pickTerms(lines: string[], candidates: string[]): string[] {
  const text = lines.join("\n");
  const out: string[] = [];
  for (const t of candidates.map((c) => c.trim())) {
    if (t.length < 2 || out.includes(t) || !text.includes(t)) continue;
    out.push(t);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error("took too long")), ms)))]).finally(() => clearTimeout(timer));
}

async function glanceWatcher(w: Watcher, creds: Record<string, string>, f: typeof fetch, at: Date): Promise<Glance> {
  const { events } = await w.poll({ creds, config: {}, cursor: cursorSince(w, new Date(at.getTime() - LOOK_BACK_MS)), fetch: f, now: at });
  const seen = new Set<string>();
  const newest = [...events]
    .sort((a, b) => b.happenedAt.localeCompare(a.happenedAt))
    .filter((e) => !seen.has(e.itemId) && seen.add(e.itemId))
    .slice(0, MAX_LINES);
  const lines = newest.map(eventLine);
  return { app: w.name, lines, terms: pickTerms(lines, newest.flatMap(eventTerms)) };
}

/** Apple apps this agent may read, now: the mod on, the agent allowed, and the Mac online. */
function appleReads(hub: Hub, agent: Agent, at: Date, timeoutMs: number): { app: string; read: () => Promise<Glance> }[] {
  const ws = agent.workspaceId;
  if (!hub.apple.on(ws) || !hub.apple.mac(ws)?.online) return [];
  const levels = hub.apple.levelsFor(agent);
  const tz = hub.store.members(ws).find((m) => m.id === agent.settings.setup?.userId)?.timezone ?? undefined;
  const ask = <T>(op: AppleOp) => {
    if (isChange(op)) throw new Error("only reads");
    return hub.apple.ask<T>(ws, op, timeoutMs);
  };
  const glance = (app: string, lines: string[], terms: string[]): Glance => ({ app, lines, terms: pickTerms(lines, terms) });
  const out: { app: string; read: () => Promise<Glance> }[] = [];
  if ((levels.messages ?? 0) >= 1)
    out.push({
      app: APPLE_APP_INFO.messages.name,
      read: async () => {
        const chats = ((await ask<AppleChat[]>({ op: "messages_recent", limit: 5 })) ?? []).slice(0, 5);
        return glance(APPLE_APP_INFO.messages.name, chats.map((c) => clip(`${c.name}: ${c.lastFromMe ? "you said " : ""}${c.lastText}`)), chats.map((c) => c.name));
      },
    });
  if ((levels.calendar ?? 0) >= 1)
    out.push({
      app: APPLE_APP_INFO.calendar.name,
      read: async () => {
        const to = new Date(at.getTime() + 7 * 24 * 60 * 60_000);
        const evs = ((await ask<AppleEvent[]>({ op: "calendar_list", from: at.toISOString(), to: to.toISOString(), limit: 10 })) ?? []).slice(0, MAX_LINES);
        return glance(APPLE_APP_INFO.calendar.name, evs.map((e) => clip(`${e.title}, ${span(e.start, e.end, tz, e.allDay)}`)), evs.map((e) => e.title));
      },
    });
  if ((levels.reminders ?? 0) >= 1)
    out.push({
      app: APPLE_APP_INFO.reminders.name,
      read: async () => {
        const rs = ((await ask<AppleReminder[]>({ op: "reminders_list", includeDone: false, limit: 10 })) ?? []).filter((r) => !r.done).slice(0, MAX_LINES);
        return glance(APPLE_APP_INFO.reminders.name, rs.map((r) => clip(`${r.title}${r.due ? `, due ${when(r.due, tz)}` : ""}`)), rs.map((r) => r.title));
      },
    });
  return out;
}

/**
 * Look at what's new in the agent's connected apps (the last 3 days) and its Apple apps. Each app
 * gets GLANCE_TIMEOUT_MS; one that fails or is slow is left out (named in `failed`), and an app with
 * nothing new isn't listed. Never changes anything.
 */
export async function glanceApps(hub: Hub, agent: Agent, opts: { now?: Date; timeoutMs?: number } = {}): Promise<{ read: Glance[]; failed: string[] }> {
  const at = opts.now ?? new Date();
  const timeoutMs = opts.timeoutMs ?? GLANCE_TIMEOUT_MS;
  const f = readOnlyFetch(hub.watches.fetch);
  const jobs: { app: string; read: () => Promise<Glance> }[] = [];
  // sign-ins about to run out are renewed first, as before a run
  await hub.connectors.prepare(agent.id).catch(() => undefined);
  const connectors = hub.connectors.forAgent(agent.id);
  for (const w of WATCHERS) {
    if (!GLANCE_SERVICES.has(w.service) || w.unavailable?.()) continue;
    // one look per app, with the first of its connectors that holds a key
    const creds = connectors
      .filter((c) => c.catalogId && w.catalogIds.includes(c.catalogId))
      .map((c) => credsOf(hub, c.id, w))
      .find((c) => has(w, c));
    if (creds) jobs.push({ app: w.name, read: () => glanceWatcher(w, creds, f, at) });
  }
  jobs.push(...appleReads(hub, agent, at, timeoutMs));
  const results = await Promise.all(jobs.map((j) => withTimeout(Promise.resolve().then(j.read), timeoutMs).then((g) => ({ ok: true as const, g }), () => ({ ok: false as const, app: j.app }))));
  return {
    read: results.flatMap((r) => (r.ok && r.g.lines.length ? [r.g] : [])),
    failed: results.flatMap((r) => (r.ok ? [] : [r.app])),
  };
}

export type CheckResult = { ok: true; checked: boolean } | { ok: false; error: string };

/**
 * Does a connector's key work? Its app's watcher signs in the way a first watch would (cursor null,
 * which reads nothing new). Apps Wisp has no watcher for aren't checked.
 */
export async function checkConnector(hub: Hub, connectorId: string): Promise<CheckResult> {
  const conn = hub.connectors.get(connectorId);
  const w = conn?.catalogId ? WATCHERS.find((x) => x.catalogIds.includes(conn.catalogId!)) : undefined;
  if (!conn || !w || w.unavailable?.()) return { ok: true, checked: false };
  try {
    await withTimeout(w.poll({ creds: credsOf(hub, conn.id, w), config: {}, cursor: null, fetch: readOnlyFetch(hub.watches.fetch), now: new Date() }), GLANCE_TIMEOUT_MS * 2);
    return { ok: true, checked: true };
  } catch (e) {
    return { ok: false, error: e instanceof WatchError ? e.message : `Wisp couldn't reach ${w.name}. Check the key and try again.` };
  }
}
