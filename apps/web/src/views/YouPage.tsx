import type { ReactNode } from "react";
import { go, href, type Route } from "../router.ts";
import { SettingsView } from "./SettingsView.tsx";

/** One row of the More page's list. */
export interface YouRow {
  label: string;
  icon: ReactNode;
  to: Route;
  /** on the right, before the chevron: a count, say */
  hint?: ReactNode;
}

/**
 * The More page's list (phones): the places it always names (`head`), then whatever else the
 * sidebar's More list holds (the mods that are on add their entries there), then `tail`. A place is
 * listed once, under the first label given for it.
 */
export function accountRows(head: YouRow[], more: YouRow[], tail: YouRow[]): YouRow[] {
  const named = new Set([...head, ...tail].map((r) => href(r.to)));
  const seen = new Set<string>();
  return [...head, ...more.filter((r) => !named.has(href(r.to))), ...tail].filter((r) => {
    const key = href(r.to);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Phones: your initials open Settings as one sheet (round 11, board 14). Its close goes back home.
 */
export function YouPage() {
  return <SettingsView page={null} onBack={() => go({ view: "chats" })} />;
}
