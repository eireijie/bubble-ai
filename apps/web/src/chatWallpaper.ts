import { useEffect, useSyncExternalStore } from "react";

/**
 * Chat backgrounds (round 4, board "Chat and sidebar"): each chat keeps its own, on this device.
 * A few soft built-in ones, Plain, or a picture you add. The open chat's background is set on the
 * page as --chat-wall, so on a desktop the glass sidebar sits over the same picture as the chat.
 */
export type WallId = "plain" | "sky" | "dusk" | "sea" | "sand";
export interface Wall {
  id: WallId;
  name: string;
  light: string;
  dark: string;
}

export const WALLS: Wall[] = [
  { id: "plain", name: "Plain", light: "#eef0f3", dark: "#111113" },
  {
    id: "sky",
    name: "Sky",
    light: "radial-gradient(60% 70% at 80% 10%, #c9e4ff 0, transparent 60%), radial-gradient(50% 60% at 10% 90%, #e3d7ff 0, transparent 60%), #eef3fb",
    dark: "radial-gradient(60% 70% at 80% 10%, #1b2c45 0, transparent 60%), radial-gradient(50% 60% at 10% 90%, #2a2142 0, transparent 60%), #111318",
  },
  {
    id: "dusk",
    name: "Dusk",
    light: "radial-gradient(60% 70% at 85% 15%, #ffd1c2 0, transparent 60%), radial-gradient(55% 65% at 10% 85%, #d4c6ff 0, transparent 60%), #f6eef0",
    dark: "radial-gradient(60% 70% at 85% 15%, #3d2420 0, transparent 60%), radial-gradient(55% 65% at 10% 85%, #2a2342 0, transparent 60%), #151214",
  },
  {
    id: "sea",
    name: "Sea",
    light: "radial-gradient(60% 70% at 75% 20%, #a9e6df 0, transparent 60%), radial-gradient(55% 65% at 15% 85%, #9fc8f2 0, transparent 60%), #e6f3f4",
    dark: "radial-gradient(60% 70% at 75% 20%, #133a37 0, transparent 60%), radial-gradient(55% 65% at 15% 85%, #142c46 0, transparent 60%), #0f1517",
  },
  {
    id: "sand",
    name: "Sand",
    light: "radial-gradient(60% 70% at 80% 15%, #ffe6b8 0, transparent 60%), radial-gradient(55% 65% at 12% 88%, #f3d3c4 0, transparent 60%), #f7f2ea",
    dark: "radial-gradient(60% 70% at 80% 15%, #3a2f18 0, transparent 60%), radial-gradient(55% 65% at 12% 88%, #35221c 0, transparent 60%), #15130f",
  },
];

/** What a chat has: a built-in one, or a picture (a data URL, made small enough to keep). */
export type ChatWall = { kind: "built"; id: WallId } | { kind: "image"; url: string };

export const DEFAULT_WALL: ChatWall = { kind: "built", id: "sky" };
const KEY = "bubble.chat-wall";
const listeners = new Set<() => void>();
let cache: Record<string, ChatWall> | null = null;

function readAll(): Record<string, ChatWall> {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, ChatWall>;
  } catch {
    cache = {};
  }
  return cache;
}

export function wallOf(channelId: string): ChatWall {
  const w = readAll()[channelId];
  if (w?.kind === "image" && typeof w.url === "string") return w;
  if (w?.kind === "built" && WALLS.some((x) => x.id === w.id)) return w;
  return DEFAULT_WALL;
}

/** Saves a chat's background. Throws when the picture is too big for this device to keep. */
export function setWall(channelId: string, wall: ChatWall) {
  const next = { ...readAll() };
  // only one picture is kept per chat; a built-in one needs no room
  next[channelId] = wall;
  localStorage.setItem(KEY, JSON.stringify(next));
  cache = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  const storage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = null;
    l();
  };
  window.addEventListener("storage", storage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", storage);
  };
}

export function useChatWall(channelId: string | null | undefined): ChatWall {
  return useSyncExternalStore(
    subscribe,
    () => (channelId ? wallOf(channelId) : DEFAULT_WALL),
    () => DEFAULT_WALL,
  );
}

/** The CSS background for a wall in light or dark. */
export function wallCss(wall: ChatWall, dark: boolean): string {
  if (wall.kind === "image") return `center / cover no-repeat url("${wall.url}")`;
  const w = WALLS.find((x) => x.id === wall.id) ?? WALLS[0];
  return dark ? w.dark : w.light;
}

/**
 * Puts the open chat's background on the page (--chat-wall-light / --chat-wall-dark) while it is
 * open. index.css paints it behind the chat, and on desktops behind the glass sidebar too.
 */
export function usePageWall(channelId: string | null | undefined) {
  const wall = useChatWall(channelId);
  useEffect(() => {
    const root = document.documentElement;
    if (!channelId) return;
    root.style.setProperty("--chat-wall-light", wallCss(wall, false));
    root.style.setProperty("--chat-wall-dark", wallCss(wall, true));
    root.dataset.chatWall = wall.kind === "image" ? "image" : wall.id;
    return () => {
      root.style.removeProperty("--chat-wall-light");
      root.style.removeProperty("--chat-wall-dark");
      delete root.dataset.chatWall;
    };
  }, [channelId, wall]);
}

/** A picture made small enough to keep on this device: at most 1600 px wide, as a JPEG. */
export async function shrinkImage(file: File, max = 1600): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("That file isn't a picture this app can open."));
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
