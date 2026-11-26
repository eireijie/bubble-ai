import type { FeatureKey } from "@bubble-ai/core";
import type { SettingsPage } from "../../router.ts";

/**
 * Settings is six pages, and Learn Bubble AI. Every setting is one row on one of them, in small
 * titled groups, all shown: two clicks (Settings, then the page) reach any of them, and search
 * finds them by name. The old routes (SETTINGS_PAGES) still open: each lands on the row that holds
 * its content now. This file is the whole map, with no React in it, so it can be tested.
 */
export const FIVE = ["you", "agents", "mods", "computers", "privacy", "about", "learn"] as const;
export type Five = (typeof FIVE)[number];
export const FIVE_LABEL: Record<Five, string> = { you: "You", agents: "Agents", mods: "Mods", computers: "Computers", privacy: "Privacy and data", about: "About", learn: "Learn Bubble AI" };
/** The route that opens each page at its top. */
export const FIVE_ROUTE: Record<Five, SettingsPage> = { you: "profile", agents: "agents", mods: "mods", computers: "devices", privacy: "security", about: "updates", learn: "learn" };

export interface SettingRow {
  id: string;
  page: Five;
  label: string;
  /** other words the settings search finds it by */
  words: string;
  /** the old route it hangs under: its address is #/settings/<route>, or #/settings/<route>/<id> */
  route: SettingsPage;
  /** opens its own sheet inside the page, instead of holding its control on the row */
  sheet?: boolean;
  noGuests?: boolean;
  /** only while this mod is on */
  feature?: FeatureKey;
  /** the mod this row is (or holds the settings of): always listed; its sheet offers to turn it on while it's off */
  mod?: FeatureKey;
}

type Opts = Pick<SettingRow, "sheet" | "noGuests" | "feature" | "mod">;
const row = (page: Five, id: string, label: string, route: SettingsPage, words: string, opts: Opts = {}): SettingRow => ({ id, page, label, route, words, ...opts });
const A: Opts = { noGuests: true };

/** Every row, in the order its page shows it. */
export const ROWS: SettingRow[] = [
  row("you", "name", "Name", "profile", "full name profile account you"),
  row("you", "preferred", "Agents call you", "profile", "preferred name nickname"),
  row("you", "email", "Email", "profile", "address account"),
  row("you", "timezone", "Time zone", "profile", "timezone region utc"),
  row("you", "appearance", "Appearance", "appearance", "dark light mode system look"),
  row("you", "notifications", "Notifications", "notifications", "alerts sound sounds push notify test direct messages replies approvals away", { sheet: true }),
  row("you", "enter", "Enter sends", "preferences", "send sending message cmd ctrl return new line app behavior preferences"),
  row("you", "clock", "Clock", "preferences", "time 12 24 hour"),
  row("you", "tool-calls", "Tool calls", "preferences", "tools agents used collapsed open hidden"),
  row("you", "theme", "Theme", "appearance", "colour color accent themes mono mint iris lilac sky"),
  row("you", "text-size", "Text size", "appearance", "font small large accessibility"),
  row("you", "motion", "Reduce motion", "appearance", "animation accessibility"),
  row("you", "voice", "Voice", "voice", "speech speak talk call calls microphone mic dictation engine openai elevenlabs key speaker test", { sheet: true, noGuests: true }),
  row("you", "buddy", "Desk buddy", "buddy", "desktop ghost pet mod", { noGuests: true }),

  row("agents", "thinks", "New agents think with", "agent-defaults", "default model harness tool ai agent defaults models per tool", { ...A, sheet: true }),
  row("agents", "access", "New agents can", "agents", "files read only edit full access permissions", A),
  row("agents", "asks", "Ask me before", "agents", "approvals asks first permissions allow rules sending paying deleting posting sign up sharing", { ...A, sheet: true }),
  row("agents", "learn", "Learn skills on their own", "agents", "learned skill teach", A),
  // chats, follow-ups and check-backs use tokens whatever mods are on, and Bubble AI's own usage warnings link here
  row("agents", "usage", "Usage and daily limit", "usage", "limits cost spend tokens budget allowance", { ...A, sheet: true }),
  row("agents", "accounts", "AI accounts and keys", "harnesses", "api key keys model models provider subscription plan sign in claude chatgpt openai anthropic", { ...A, sheet: true }),
  row("agents", "tools", "AI on each computer", "harnesses", "harness harnesses install claude code codex hermes gemini kimi config setup acp", { ...A, sheet: true }),
  row("agents", "skills", "Skills", "skills", "learned teach built in import", { ...A, sheet: true }),
  row("agents", "apps", "Apps", "apps", "connected apps connectors integrations gmail slack", { ...A, sheet: true }),
  row("agents", "logins", "Logins", "logins", "password manager 1password credentials accounts", { ...A, sheet: true }),
  row("agents", "outside", "Outside apps", "connections", "mcp token tokens chatgpt grok claude connect another app outside agents public address", { ...A, sheet: true }),
  row("agents", "lead", "Lead agent", "agents", "default nobody assigned", A),
  row("agents", "makers", "Agents making agents", "agents", "leads create agents sub-agents", A),
  row("agents", "made-max", "Most agents made by agents", "agents", "limit cap", A),
  row("agents", "hops", "Hand-offs in a row", "agents", "loop protection limits", A),
  row("agents", "runs", "Runs per team a minute", "agents", "loop protection limits rate", A),

  // what agents do on their own, then the extras; each a switch (Storage and Apple open their settings)
  row("mods", "mod-background", "Background agents", "mods", "proactive check apps on their own message first watch", { ...A, mod: "background" }),
  row("mods", "mod-routines", "Routines", "mods", "schedule timer cron morning summary", { ...A, mod: "routines" }),
  row("mods", "mod-teach", "Teach a task", "mods", "show watch record skill", { ...A, mod: "teach" }),
  row("mods", "mod-tasks", "Tasks board", "mods", "tasks board todo to do work hand out", { ...A, mod: "tasks" }),
  row("mods", "storage", "Storage", "storage", "nextcloud webdav google drive dropbox nas files", { ...A, sheet: true, mod: "storage" }),
  row("mods", "apple", "Apple", "apple", "messages imessage contacts calendar reminders location iphone mac", { ...A, sheet: true, mod: "apple" }),
  row("mods", "mod-invite", "Invite people", "mods", "people members guests share", { ...A, mod: "invite" }),
  row("mods", "mod-remote", "Remote desktop", "mods", "rustdesk reach devices anywhere", { ...A, mod: "remoteDesktop" }),
  row("mods", "mod-code", "Code", "mods", "coding side by side", { ...A, mod: "code" }),

  row("computers", "devices", "Devices", "devices", "computers phones machines add a device connected offline", A),
  row("computers", "away", "Away from home", "access", "tailscale cloudflare remote outside anywhere network vpn reach", A),
  row("computers", "phone", "Phone", "devices", "pair pairing qr mobile iphone android", { ...A, sheet: true }),
  row("computers", "control", "Give control back after", "devices", "idle take over minutes", A),
  row("computers", "vm-size", "New computers", "devices", "size vm small medium large", A),
  row("computers", "works-on", "New agents work on", "agent-defaults", "default computer shared own none", A),
  row("computers", "works-device", "Device for new agents", "agent-defaults", "default device where agents run", A),
  row("computers", "pick", "Pick each agent's computer", "devices", "choose where agents run myself", A),
  row("computers", "cloud", "Orgo cloud", "devices", "api key cloud computers", { ...A, sheet: true }),

  row("privacy", "password", "Password", "security", "change password security", { sheet: true }),
  row("privacy", "sessions", "Signed in", "security", "sessions devices sign out everywhere", { sheet: true }),
  row("privacy", "people", "People", "people", "invite members guests roles temporary password", { ...A, sheet: true, feature: "invite" }),
  row("privacy", "memory-access", "Memory access", "memory", "rules who can see edit notes folders load at startup", { ...A, sheet: true }),
  row("privacy", "memory-folder", "Memory folder", "memory", "where memory is kept vault path location", { ...A, sheet: true }),
  row("privacy", "backup", "Back up", "data", "backup export download restore notes conversations data", { ...A, sheet: true }),
  row("privacy", "workspace", "Workspace", "general", "organization org name delete workspace", { ...A, sheet: true }),
  row("privacy", "changes", "Recent changes", "general", "undo changed ask agent", { ...A, sheet: true }),
  row("privacy", "obsidian", "Sync to Obsidian", "memory", "git token notes app", { ...A, sheet: true }),
  row("privacy", "import", "Import from another AI", "memory", "chatgpt claude gemini bring memory", { ...A, sheet: true }),

  row("about", "version", "Version", "updates", "update updates release check now"),
  row("about", "news", "What's new", "updates", "changes changelog", { sheet: true }),
  row("about", "help", "Help", "updates", "support guide stuck"),
  row("about", "source", "Open source, Apache-2.0", "updates", "source code github license"),
  row("about", "hub", "Hub address", "updates", "url server", A),
  row("about", "welcome", "See the welcome again", "updates", "intro replay what is bubble ai wisp"),
  row("about", "remove", "Remove Bubble AI from this computer", "updates", "uninstall delete app", A),

  // Show me around, and what setup left to do (it used to be its own "Finish setup" page)
  row("learn", "tour", "Show me around", "learn", "tour learn bubble ai wisp guide how does it work finish setup getting started"),
];

/** Where each route lands: the row that holds what its page used to show. */
export const ROUTE_ROW: Record<SettingsPage, string> = {
  profile: "name",
  preferences: "enter",
  notifications: "notifications",
  usage: "usage",
  voice: "voice",
  appearance: "appearance",
  security: "password",
  devices: "devices",
  general: "workspace",
  access: "away",
  "agent-defaults": "thinks",
  people: "people",
  agents: "access",
  harnesses: "tools",
  memory: "memory-access",
  buddy: "buddy",
  logins: "logins",
  storage: "storage",
  apple: "apple",
  apps: "apps",
  skills: "skills",
  connections: "outside",
  data: "backup",
  updates: "version",
  learn: "tour",
  mods: "mod-background",
};

const BY_ID = new Map(ROWS.map((r) => [r.id, r]));
export const rowById = (id: string): SettingRow => BY_ID.get(id)!;

export interface Landing {
  page: Five;
  /** the row to show: scrolled to, or (a sheet) opened. null is the top of the page */
  row: string | null;
  /** the row opens as a sheet */
  sheet: boolean;
}

/**
 * Where a settings address lands. `item` names one row under the route (#/settings/agents/lead);
 * anything else there (a skill's id, a storage connection's) is left for the sheet to read. A page's
 * own route (FIVE_ROUTE) with no row named is the top of that page.
 */
export function settingsLanding(route: SettingsPage | null | undefined, item?: string | null): Landing {
  if (!route) return { page: "you", row: null, sheet: false };
  const named = item ? ROWS.find((r) => r.route === route && r.id === item) : undefined;
  const top = named ? undefined : FIVE.find((p) => FIVE_ROUTE[p] === route);
  if (top) return { page: top, row: null, sheet: false };
  const r = named ?? rowById(ROUTE_ROW[route]);
  return { page: r.page, row: r.id, sheet: !!r.sheet };
}

/** The address of one row: its route alone when the route lands on it, else the route and its id. */
export function rowTarget(r: SettingRow): { page: SettingsPage; item?: string } {
  const landsHere = settingsLanding(r.route).row === r.id;
  return landsHere ? { page: r.route } : { page: r.route, item: r.id };
}

export type FeatureFlags = Partial<Record<FeatureKey, boolean>>;

/** Can this person use the row: guests and switched-off mods leave some out. */
export function rowAvailable(r: SettingRow, guest: boolean, features: FeatureFlags): boolean {
  return !(guest && r.noGuests) && (!r.feature || !!features[r.feature]);
}

/** The rows a page lists for this person, all of them. */
export function pageRows(page: Five, guest: boolean, features: FeatureFlags): SettingRow[] {
  return ROWS.filter((r) => r.page === page && rowAvailable(r, guest, features));
}

/** The pages with anything on them for this person (a guest has no Agents, Mods or Computers page). */
export function fivePages(guest: boolean, features: FeatureFlags): Five[] {
  return FIVE.filter((p) => pageRows(p, guest, features).length > 0);
}

/** What the settings search looks through: every row this person can use. */
export function searchableRows(guest: boolean, features: FeatureFlags): SettingRow[] {
  return ROWS.filter((r) => rowAvailable(r, guest, features));
}
