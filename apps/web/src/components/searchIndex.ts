import { Blocks, BookOpen, Brain, LifeBuoy, ListChecks, ListTodo, Monitor, Settings, SlidersHorizontal, SquareTerminal, Store, type LucideIcon, LayoutTemplate } from "lucide-react";
import { BubbleIcon } from "./icons.tsx";
import type { FeatureKey } from "@bubble-ai/core";
import type { Route, SettingsPage } from "../router.ts";
import { useStore } from "../store.ts";
import { FIVE, FIVE_LABEL, FIVE_ROUTE, ROWS, rowTarget, type Five } from "../views/settings/map.ts";

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

/** A place in Settings: one of its five pages (by the route that opens it), or one row. */
const settings = (to: { page: SettingsPage; item?: string }, label: string, words: string, more: Pick<Place, "noGuests" | "feature"> = {}): Place => ({ key: `settings:${to.page}${to.item ? `/${to.item}` : ""}`, label, words, icon: SlidersHorizontal, to: { view: "settings", ...to }, where: "Settings", ...more });

const PAGE_WORDS: Record<Five, string> = { you: "profile account me", agents: "agent settings permissions defaults", mods: "features optional extras addons add-ons switches", computers: "devices settings", privacy: "security data", about: "version", learn: "tour show me around guide getting started finish setup" };

/** Settings' five pages, then every row on them by its name (settings/map.ts), so search reaches a setting wherever it sits. */
const SETTINGS_PLACES: Place[] = [
  ...FIVE.map((p) => settings({ page: FIVE_ROUTE[p] }, FIVE_LABEL[p], PAGE_WORDS[p], { noGuests: p === "agents" || p === "computers" })),
  ...ROWS.map((r) => settings(rowTarget(r), r.label, r.words, { noGuests: r.noGuests, feature: r.feature })),
];

/** In the order they show. Settings' pages and rows carry the names Settings gives them. */
export const PLACES: Place[] = [
  { key: "computers", label: "Computers", words: "screens screen vm devices machines desktop watch take over", icon: Monitor, to: { view: "computers", computerId: null }, noGuests: true },
  { key: "add", label: "Connect apps", words: "marketplace store shop connect connectors connected integrations install gmail slack mcp", icon: Store, to: { view: "marketplace" } },
  { key: "memory", label: "Memory", words: "notes vault knows remember knowledge", icon: BookOpen, to: { view: "vault", path: null } },
  { key: "tasks", label: "Tasks", words: "work board todo to do", icon: ListTodo, to: { view: "tasks" }, noGuests: true },
  { key: "code", label: "Code", words: "terminal terminals shell coding", icon: SquareTerminal, to: { view: "code" }, feature: "code", noGuests: true },
  { key: "mods", label: "Mods", words: "features optional extras addons add-ons", icon: Blocks, to: { view: "mods" } },
  { key: "help", label: "Help", words: "support guide stuck not answering", icon: LifeBuoy, to: { view: "help" } },
  { key: "agents", label: "All agents", words: "manage list every agent", icon: BubbleIcon as unknown as LucideIcon, to: { view: "agents", agentId: null } },
  { key: "templates", label: "Agent templates", words: "new agent start from template assistant coding research business", icon: LayoutTemplate, to: { view: "templates" }, noGuests: true },
  { key: "about", label: "About you", words: "profile what agents remember me", icon: Brain, to: { view: "about" } },
  { key: "setup", label: "Setup", words: "finish checklist get started turned on undo welcome", icon: ListChecks, to: { view: "here" }, noGuests: true },
  { key: "settings", label: "Settings", words: "preferences options", icon: Settings, to: { view: "settings" } },
  ...SETTINGS_PLACES,
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
