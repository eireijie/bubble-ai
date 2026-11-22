import { Blocks, BookOpen, Brain, Ghost, LifeBuoy, ListChecks, ListTodo, Monitor, Settings, SlidersHorizontal, SquareTerminal, Store, type LucideIcon } from "lucide-react";
import type { FeatureKey } from "@wisp/core";
import type { Route, SettingsPage } from "../router.ts";
import { useStore } from "../store.ts";

/**
 * What search (⌘K) can find besides agents, teams, messages and notes: every place in the app,
 * by its name and by the plain words a person would type for it. Search is the way to anything
 * that left the screen, so a page that loses its button gets a row here.
 */

/** Open search from anywhere: the sidebar's Search button, the phone's search field. `text` starts it with something typed. */
export function openSearch(text = ""): void {
  useStore.setState({ paletteSeed: text });
  useStore.getState().setPalette(true);
}

export interface Place {
  key: string;
  label: string;
  /** other words that find it ("password" finds Security) */
  words: string;
  icon: LucideIcon;
  to: Route;
  /** where it lives, shown on the right ("Settings") */
  where?: string;
  noGuests?: boolean;
  /** only while this mod is on */
  feature?: FeatureKey;
}

const settings = (page: SettingsPage, label: string, words: string, more: Pick<Place, "noGuests" | "feature"> = {}): Place => ({ key: `settings:${page}`, label, words, icon: SlidersHorizontal, to: { view: "settings", page }, where: "Settings", ...more });

/** In the order they show. Settings pages carry the names Settings gives them. */
export const PLACES: Place[] = [
  { key: "computers", label: "Computers", words: "screens screen vm devices machines desktop watch take over", icon: Monitor, to: { view: "computers", computerId: null }, noGuests: true },
  { key: "add", label: "Add apps and skills", words: "marketplace store shop connect connectors connected integrations install gmail slack mcp", icon: Store, to: { view: "marketplace" } },
  { key: "memory", label: "Memory", words: "notes vault knows remember knowledge", icon: BookOpen, to: { view: "vault", path: null } },
  { key: "tasks", label: "Tasks", words: "work board todo to do", icon: ListTodo, to: { view: "tasks" }, feature: "tasks" },
  { key: "code", label: "Code", words: "terminal terminals shell coding", icon: SquareTerminal, to: { view: "code" }, feature: "code", noGuests: true },
  { key: "mods", label: "Mods", words: "features optional extras addons add-ons", icon: Blocks, to: { view: "mods" } },
  { key: "help", label: "Help", words: "support guide stuck not answering", icon: LifeBuoy, to: { view: "help" } },
  { key: "agents", label: "All agents", words: "manage list every agent", icon: Ghost, to: { view: "agents", agentId: null } },
  { key: "about", label: "About you", words: "profile what agents remember me", icon: Brain, to: { view: "about" } },
  { key: "setup", label: "Setup", words: "finish checklist get started turned on undo welcome", icon: ListChecks, to: { view: "here" }, noGuests: true },
  { key: "settings", label: "Settings", words: "preferences options", icon: Settings, to: { view: "settings" } },
  settings("profile", "Profile", "name picture photo avatar email account role you"),
  settings("notifications", "Notifications", "alerts sound sounds push notify"),
  settings("appearance", "Appearance", "dark light mode theme themes colour color text size font reduce motion accessibility"),
  settings("preferences", "App behavior", "enter sends send clock time 12 24 hour tools tool calls preferences"),
  settings("voice", "Voice", "speech speak talk call calls microphone mic dictation engine", { noGuests: true }),
  settings("buddy", "Desk buddy", "desktop ghost pet", { noGuests: true }),
  settings("security", "Security", "password sessions signed in devices sign out everywhere"),
  settings("general", "Workspace", "organization org hub address lead delete name", { noGuests: true }),
  settings("people", "People", "invite members guests roles", { noGuests: true, feature: "invite" }),
  settings("usage", "Usage", "limits cost spend tokens daily budget", { noGuests: true, feature: "background" }),
  settings("agents", "Permissions", "approvals ask before allow rules loop protection agents making agents", { noGuests: true }),
  settings("agent-defaults", "Agent defaults", "default model harness effort new agents", { noGuests: true }),
  settings("harnesses", "AI", "api key keys model models harness harnesses claude codex hermes gemini kimi openai anthropic provider subscription install", { noGuests: true }),
  settings("logins", "Logins", "password manager 1password bitwarden credentials accounts", { noGuests: true }),
  settings("storage", "Storage", "nextcloud webdav google drive dropbox nas files", { noGuests: true, feature: "storage" }),
  settings("apple", "Apple", "messages imessage contacts calendar reminders location iphone mac", { noGuests: true, feature: "apple" }),
  settings("apps", "Connected apps", "connectors integrations gmail slack", { noGuests: true }),
  settings("skills", "Skills", "learned teach", { noGuests: true }),
  settings("connections", "Outside agents", "mcp token tokens chatgpt grok connect another app", { noGuests: true }),
  settings("memory", "Memory", "folder obsidian sync access rules", { noGuests: true }),
  settings("devices", "Computers and devices", "phone pair pairing qr new computer size cloud vm control", { noGuests: true }),
  settings("access", "Away from home", "tailscale remote outside anywhere network vpn reach", { noGuests: true }),
  settings("data", "Data", "backup back up export download restore", { noGuests: true }),
  settings("updates", "About", "version update updates release what's new license source"),
];

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * How well what was typed finds something, by whole words and their beginnings ("pass" finds
 * "password", "art" does not find "start"): 3 its name starts with it, 2 every word typed starts
 * a word of its name, 1 the other words were needed, 0 no match.
 */
export function wordMatch(typed: string, label: string, words = ""): 0 | 1 | 2 | 3 {
  const q = norm(typed);
  if (!q) return 0;
  const name = norm(label);
  if (name.startsWith(q)) return 3;
  const tokens = q.split(" ");
  const nameWords = name.split(" ");
  const starts = (list: string[], t: string) => list.some((w) => w.startsWith(t));
  if (tokens.every((t) => starts(nameWords, t))) return 2;
  const all = [...nameWords, ...norm(words).split(" ")];
  return tokens.every((t) => starts(all, t)) ? 1 : 0;
}

/** The rows that match, best first; rows that match equally keep their order. */
export function findByWords<T extends { label: string; words?: string }>(typed: string, rows: T[]): T[] {
  return rows
    .map((row, i) => ({ row, i, score: wordMatch(typed, row.label, row.words) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.row);
}

/** The places this person can open: guests and switched-off mods leave some out. */
export function placesFor(guest: boolean, features: Partial<Record<FeatureKey, boolean>>): Place[] {
  return PLACES.filter((p) => !(guest && p.noGuests) && (!p.feature || !!features[p.feature]));
}
