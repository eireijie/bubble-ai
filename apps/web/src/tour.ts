import type { FeatureKey, LearnProgress } from "@bubble-ai/core";
import type { Route } from "./router.ts";

/**
 * Show me around (2026-11-26 canvas "Bubble AI onboarding flow", Tour board): four stops, and at
 * each one you do the thing for real: write to your agent, open the / commands, open Your turn,
 * make another agent or team. The agent's bubble flies to the real control, the rest of the page
 * dims, a short card says what to do, and the stop finishes itself when you've done it. Skipping
 * ends it, and nothing about it stays on screen; it is in Help and Settings to start again.
 * This file is the list of stops and the arithmetic over them, with no React, so it can be tested.
 * The overlay that runs it is components/tour/TourOverlay.tsx.
 */

/** One chapter now: the stops are few enough to show as one row of dots. */
export const CHAPTERS = ["Show me around"] as const;

/**
 * Where a stop is.
 * - "chat": the chat the tour started from (or the newest chat with an agent)
 * - "side": the sidebar, which is on every desktop page; phones show it as the chats list
 * - "newTeam": the New team window
 * - "team": a team's chat, when there is one (the stop's targets fall back to the sidebar otherwise)
 * - a Route: that page
 */
export type Place = "chat" | "side" | "newTeam" | "team" | Route;

/** What finishes a stop: sending a message, typing /, opening Your turn, or a click on the target. */
export type DoIt = "send" | "slash" | "at" | "click";
/** @deprecated the old name */
export type TryIt = DoIt;

export interface Stop {
  id: string;
  /** chapter (always 0 now) */
  ch: number;
  /** what to do; {agent} is the agent's name */
  title: string;
  body: string;
  place: Place;
  /** phones, when the desktop place has no room for it (the sidebar's pills aren't on phones) */
  phonePlace?: Place;
  /** [data-tour] names or CSS selectors, best first. The first one on the page that can be seen is shown */
  targets: string[];
  /** said instead of `body` when none of `targets` is there and the stop points at what's nearest */
  fallbackBody?: string;
  /** said instead of `body` on phones, when the desktop words point at something phones don't have */
  phoneBody?: string;
  /** where the bubble sits beside its target, when there's room */
  side?: "right" | "left" | "top" | "bottom";
  /** what you do to finish it */
  doIt: DoIt;
  /** @deprecated: every stop is hands-on now (doIt) */
  tryIt?: DoIt;
  /** a mod this stop belongs to; when it's off the card offers a switch (it is never turned on for you) */
  mod?: FeatureKey;
  /** guests can't use it, so they skip it */
  noGuests?: boolean;
}

const t = (name: string) => `[data-tour="${name}"]`;

export const STOPS: Stop[] = [
  { id: "write", ch: 0, place: "chat", targets: [t("input")], side: "top", doIt: "send", title: "Say hi to {agent}", body: "Type anything and press Return." },
  { id: "slash", ch: 0, place: "chat", targets: [t("input")], side: "top", doIt: "slash", title: "Type /", body: "Quick commands: new chat, stop, switch model." },
  { id: "your-turn", ch: 0, place: "side", phonePlace: { view: "chats" }, targets: [t("yourturn")], side: "right", doIt: "click", title: "Blue dot = your turn", body: "An agent that needs you, or a new reply, gets a blue dot." },
  { id: "new", ch: 0, place: "side", phonePlace: { view: "chats" }, targets: [t("new")], side: "right", doIt: "click", noGuests: true, title: "Make another", body: "Another agent, or a team of them." },
];

/**
 * How long a finished stop stays up, in ms, before the tour moves on by itself. The trigger (a
 * keypress, a tab click) fires before the result is drawn, and leaving the stop puts back what
 * it opened (the / popup is closed again), so the stops that open something stay long enough to
 * read it. Next is always there to go sooner.
 */
export function dwellMs(doIt: DoIt): number {
  return { send: 1800, slash: 4500, at: 4500, click: 900 }[doIt];
}

/** A stop's title with the agent's name in it. */
export function stopTitle(stop: Pick<Stop, "title">, agent: string): string {
  return stop.title.replace("{agent}", agent || "your agent");
}

export const TOTAL = STOPS.length;

/** The stops this person can use: guests skip the ones they can't open. */
export function stopsFor(guest: boolean): Stop[] {
  return guest ? STOPS.filter((s) => !s.noGuests) : STOPS;
}

/** Only ids that are still stops, once each. */
export function cleanSeen(seen: readonly string[] | undefined): string[] {
  const ids = new Set(STOPS.map((s) => s.id));
  return [...new Set((seen ?? []).filter((id) => ids.has(id)))];
}

export function seenCount(p: LearnProgress | undefined, stops: Stop[] = STOPS): number {
  const seen = new Set(p?.seen ?? []);
  return stops.filter((s) => seen.has(s.id)).length;
}

/** Where Resume starts: the first stop not seen, or the first stop when all are. */
export function resumeIndex(p: LearnProgress | undefined, stops: Stop[] = STOPS): number {
  const seen = new Set(p?.seen ?? []);
  const i = stops.findIndex((s) => !seen.has(s.id));
  return i < 0 ? 0 : i;
}

/** Each chapter's stops and how many are seen. */
export function chapterProgress(p: LearnProgress | undefined, stops: Stop[] = STOPS) {
  const seen = new Set(p?.seen ?? []);
  return CHAPTERS.map((name, ch) => {
    const idx = stops.map((s, i) => (s.ch === ch ? i : -1)).filter((i) => i >= 0);
    return { name, first: idx[0] ?? 0, total: idx.length, seen: idx.filter((i) => seen.has(stops[i].id)).length };
  }).filter((c) => c.total > 0);
}

/** "Chapter 2 of 5 · Hands-off · 1 of 4" */
export function eyebrow(i: number, stops: Stop[] = STOPS): string {
  const s = stops[i];
  const inCh = stops.filter((x) => x.ch === s.ch);
  return `Chapter ${s.ch + 1} of ${CHAPTERS.length} · ${CHAPTERS[s.ch]} · ${inCh.indexOf(s) + 1} of ${inCh.length}`;
}

/** The button that starts the tour: never started, part way, or all seen. */
export function resumeLabel(p: LearnProgress | undefined, stops: Stop[] = STOPS): string {
  const n = seenCount(p, stops);
  return n === 0 ? "Show me around" : n >= stops.length ? "Start again" : "Resume";
}

/** Progress with one more stop seen (unchanged, same object, when it was already seen). */
export function withSeen(p: LearnProgress | undefined, id: string): LearnProgress {
  const seen = cleanSeen(p?.seen);
  if (seen.includes(id) && p?.started) return p;
  return { seen: seen.includes(id) ? seen : [...seen, id], started: true };
}

/** The point on a quadratic curve from a through control c to b, at k (0 to 1). */
export function curvePoint(a: { x: number; y: number }, c: { x: number; y: number }, b: { x: number; y: number }, k: number) {
  const u = 1 - k;
  return { x: u * u * a.x + 2 * u * k * c.x + k * k * b.x, y: u * u * a.y + 2 * u * k * c.y + k * k * b.y };
}

/** A curve's middle point: bent to one side by up to 140px, and lifted a little, as in board 9. */
export function curveControl(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const bend = Math.min(140, d * 0.3) * (a.x < b.x ? -1 : 1);
  return { x: (a.x + b.x) / 2 - (dy / d) * bend, y: (a.y + b.y) / 2 + (dx / d) * bend - 30 };
}

/** How long a flight takes, by distance: 0.6 to 1.25 s. */
export function flightMs(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.round(Math.max(600, Math.min(1250, (Math.hypot(b.x - a.x, b.y - a.y) / 850) * 1000)));
}

export const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the bubble sits next to its target: on the stop's side when there's room, otherwise the
 * side with the most room. Kept inside the window.
 */
export function bubbleSpot(r: Box, side: Stop["side"], size: number, view: { w: number; h: number }): { x: number; y: number; side: NonNullable<Stop["side"]> } {
  const g = size / 2 + 14;
  const room = { right: view.w - (r.left + r.width), left: r.left, top: r.top, bottom: view.h - (r.top + r.height) };
  const fits = (s: keyof typeof room) => room[s] >= size + 28;
  const pick: NonNullable<Stop["side"]> = side && fits(side) ? side : (Object.keys(room) as (keyof typeof room)[]).sort((a, b) => room[b] - room[a])[0];
  let x: number;
  let y: number;
  if (pick === "right") (x = r.left + r.width + g), (y = r.top + Math.min(r.height / 2, 34));
  else if (pick === "left") (x = r.left - g), (y = r.top + Math.min(r.height / 2, 34));
  else if (pick === "top") (x = r.left + Math.min(r.width / 2, 60)), (y = r.top - g);
  else (x = r.left + Math.min(r.width / 2, 90)), (y = r.top + r.height + g);
  const m = size / 2 + 6;
  return { x: Math.max(m, Math.min(view.w - m, x)), y: Math.max(m, Math.min(view.h - m, y)), side: pick };
}

/**
 * Where the card goes. Phones (under 640px wide): across the bottom, or the top when the target
 * is low on the screen. Otherwise beside the bubble, on the side it sits, kept inside the window.
 */
export function cardSpot(bubble: { x: number; y: number; side: NonNullable<Stop["side"]> }, target: Box, card: { w: number; h: number }, size: number, view: { w: number; h: number }): { left: number; top: number; docked: "top" | "bottom" | null } {
  const pad = 12;
  if (view.w < 640) {
    const low = target.top + target.height / 2 > view.h * 0.55;
    return { left: pad, top: low ? pad + 44 : view.h - card.h - pad, docked: low ? "top" : "bottom" };
  }
  const half = size / 2 + 12;
  const clampX = (x: number) => Math.max(pad, Math.min(view.w - card.w - pad, x));
  const clampY = (y: number) => Math.max(pad, Math.min(view.h - card.h - pad, y));
  let left: number;
  let top: number;
  if (bubble.side === "right") (left = bubble.x + half), (top = bubble.y - 40);
  else if (bubble.side === "left") (left = bubble.x - half - card.w), (top = bubble.y - 40);
  else if (bubble.side === "top") (left = bubble.x - 60), (top = bubble.y - half - card.h);
  else (left = bubble.x - 60), (top = bubble.y + half);
  // never on top of the target itself
  const l = clampX(left);
  let tp = clampY(top);
  const overlaps = l < target.left + target.width && l + card.w > target.left && tp < target.top + target.height && tp + card.h > target.top;
  if (overlaps) tp = target.top > view.h / 2 ? clampY(target.top - card.h - 16) : clampY(target.top + target.height + 16);
  return { left: l, top: tp, docked: null };
}

/** What a stop says: its fallback when it points at what's nearest, its phone words on phones, and "press and hold" for "right-click" on touch. */
export function stopBody(stop: Stop, o: { fallback: boolean; phone: boolean }): string {
  const text = o.fallback && stop.fallbackBody ? stop.fallbackBody : o.phone && stop.phoneBody ? stop.phoneBody : stop.body;
  return o.phone ? text.replace(/Right-click/g, "Press and hold") : text;
}
