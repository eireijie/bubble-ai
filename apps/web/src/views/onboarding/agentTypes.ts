import type { AppleApp } from "@wisp/core";

/**
 * "Pick your agent" (first-run page 1): what the first agent is for, and the apps each kind of agent
 * starts with. How each app is set up follows what Wisp can really do today:
 * - `mac`: an Apple app the Apple mod reads on the Mac Wisp runs on (macOS asks once);
 * - `key`: a connector from the catalog, with a key the person pastes (or their password manager fills);
 * - `soon`: no connector for it yet, shown greyed with nothing to press, never faked.
 */
export type AppHow = "mac" | "key" | "soon";

export interface StartApp {
  id: string;
  name: string;
  /** what it reads, in a few words */
  what: string;
  how: AppHow;
  /** a 24×24 line-icon path (stroke, no fill) */
  icon: string;
  /** `key`: the catalog connector it adds */
  catalogId?: string;
  /** `mac`: the Apple app, and the macOS permission that lets Wisp read it */
  apple?: Exclude<AppleApp, "location">;
}

const IC = {
  msg: "M4 5h16v11H9l-5 4z",
  cal: "M4 6h16v14H4zM4 10h16M8 3v5M16 3v5",
  rem: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  per: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  drive: "M3 18h18M7 18l5-12 5 12M9.5 13h5",
  hash: "M5 9h14M5 15h14M10 4 8 20M16 4l-2 16",
  doc: "M6 3h9l4 4v14H6zM14 3v5h5",
  tick: "M4 7h16v10H4zM9 12h6",
  code: "M8 7l-5 5 5 5M16 7l5 5-5 5",
  tri: "M12 4l9 16H3z",
  db: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  alert: "M12 4l9 16H3zM12 10v4M12 17h.01",
  cloud: "M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5-1A4.5 4.5 0 0 0 7 18z",
  card: "M3 6h18v12H3zM3 10h18M7 15h3",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
};

export const START_APPS: Record<string, StartApp> = {
  messages: { id: "messages", name: "Messages", what: "Recent texts", how: "mac", icon: IC.msg, apple: "messages" },
  calendar: { id: "calendar", name: "Calendar", what: "Your week", how: "mac", icon: IC.cal, apple: "calendar" },
  reminders: { id: "reminders", name: "Reminders", what: "Your lists", how: "mac", icon: IC.rem, apple: "reminders" },
  contacts: { id: "contacts", name: "Contacts", what: "Who's who", how: "mac", icon: IC.per, apple: "contacts" },
  gmail: { id: "gmail", name: "Gmail", what: "Email", how: "soon", icon: IC.mail },
  gcal: { id: "gcal", name: "Google Calendar", what: "Your week", how: "soon", icon: IC.cal },
  gdrive: { id: "gdrive", name: "Google Drive", what: "Documents", how: "soon", icon: IC.drive },
  slack: { id: "slack", name: "Slack", what: "Channels and DMs", how: "key", icon: IC.hash, catalogId: "slack" },
  notion: { id: "notion", name: "Notion", what: "Pages you share with it", how: "key", icon: IC.doc, catalogId: "notion" },
  linear: { id: "linear", name: "Linear", what: "Issues and projects", how: "key", icon: IC.tick, catalogId: "linear" },
  jira: { id: "jira", name: "Jira", what: "Tickets", how: "key", icon: IC.tick, catalogId: "jira" },
  github: { id: "github", name: "GitHub", what: "Repos, issues, pull requests", how: "key", icon: IC.code, catalogId: "github" },
  vercel: { id: "vercel", name: "Vercel", what: "Deploys", how: "soon", icon: IC.tri },
  supabase: { id: "supabase", name: "Supabase", what: "Projects and databases", how: "key", icon: IC.db, catalogId: "supabase" },
  sentry: { id: "sentry", name: "Sentry", what: "Errors", how: "key", icon: IC.alert, catalogId: "sentry" },
  cloudflare: { id: "cloudflare", name: "Cloudflare", what: "Sites and Workers", how: "key", icon: IC.cloud, catalogId: "cloudflare" },
  stripe: { id: "stripe", name: "Stripe", what: "Payments and invoices", how: "key", icon: IC.card, catalogId: "stripe" },
  brave: { id: "brave", name: "Web search", what: "Brave Search", how: "key", icon: IC.search, catalogId: "brave-search" },
};

export type AgentTypeId = "daily" | "work" | "code" | "biz" | "research" | "other";

export interface AgentType {
  id: AgentTypeId;
  name: string;
  /** what it handles, one short line */
  sub: string;
  apps: string[];
  /** "What I do" on Make me yours */
  role: string;
  icon: string;
}

export const AGENT_TYPES: AgentType[] = [
  { id: "daily", name: "Daily assistant", sub: "Texts, calendar, reminders, email.", apps: ["messages", "calendar", "reminders", "contacts", "gmail", "gcal", "gdrive"], role: "Keep my days on track.", icon: "M12 4v2M12 18v2M4 12h2M18 12h2M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" },
  { id: "work", name: "Work assistant", sub: "Email, calendar, Slack, Notion, tickets.", apps: ["gmail", "gcal", "gdrive", "slack", "notion", "linear", "jira"], role: "Keep work moving.", icon: "M4 8h16v11H4zM9 8V5h6v3" },
  { id: "code", name: "Coding assistant", sub: "GitHub, deploys, databases, errors.", apps: ["github", "vercel", "supabase", "sentry", "cloudflare", "linear"], role: "Help with my code.", icon: IC.code },
  { id: "biz", name: "Business manager", sub: "Payments, customers, email, docs.", apps: ["stripe", "gmail", "gdrive", "notion", "slack"], role: "Keep the business side in order.", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
  { id: "research", name: "Research assistant", sub: "Web search, notes, documents.", apps: ["brave", "notion", "gdrive"], role: "Find things out and write them up.", icon: IC.search },
  { id: "other", name: "Something else", sub: "Say it in your own words.", apps: [], role: "", icon: "M5 12h.01M12 12h.01M19 12h.01" },
];

export const agentType = (id: string) => AGENT_TYPES.find((t) => t.id === id);

/** "Something else" in their words: until the agent can suggest apps from them, a notes app and web search fit most things. */
const OTHER_APPS = ["notion", "brave"];

/**
 * The apps the picked types start with, merged, each once, in pick order. Apps that work now come
 * first and "Soon" ones last; Apple apps only when Wisp lives on a Mac.
 */
export function appsForTypes(types: readonly string[], otherText: string, onMac: boolean): StartApp[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const t of AGENT_TYPES) {
    if (!types.includes(t.id)) continue;
    const apps = t.id === "other" ? (otherText.trim() ? OTHER_APPS : []) : t.apps;
    for (const a of apps) if (!seen.has(a)) (seen.add(a), ids.push(a));
  }
  const apps = ids.map((id) => START_APPS[id]).filter((a) => a && (a.how !== "mac" || onMac));
  return [...apps.filter((a) => a.how !== "soon"), ...apps.filter((a) => a.how === "soon")];
}

/** Do the picked types want Apple apps that this Wisp can't reach (it doesn't live on a Mac)? */
export const missesMac = (types: readonly string[], onMac: boolean) => !onMac && AGENT_TYPES.some((t) => types.includes(t.id) && t.apps.some((a) => START_APPS[a]?.how === "mac"));

/** "What I do" from the picks: the first picked type's line, or their own words for "Something else". */
export function typeRole(types: readonly string[], otherText: string): string | null {
  const first = AGENT_TYPES.find((t) => types.includes(t.id));
  if (!first) return null;
  if (first.id === "other") {
    const own = otherText.trim().replace(/[.\s]+$/, "");
    return own ? `${own.charAt(0).toUpperCase()}${own.slice(1)}.` : null;
  }
  return first.role;
}

/** The macOS permission behind each Apple app, as the Apple mod names it (pane to ask, status to read). */
export const APPLE_PERMISSION: Record<Exclude<AppleApp, "location">, { pane: "fullDiskAccess" | "contacts" | "calendars" | "reminders"; status: "fullDiskAccess" | "contacts" | "calendars" | "reminders" }> = {
  messages: { pane: "fullDiskAccess", status: "fullDiskAccess" },
  calendar: { pane: "calendars", status: "calendars" },
  reminders: { pane: "reminders", status: "reminders" },
  contacts: { pane: "contacts", status: "contacts" },
};
