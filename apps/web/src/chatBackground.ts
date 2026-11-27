import { useEffect, useState, useSyncExternalStore } from "react";
import { fileUrl, uploadFile } from "./api.ts";

/**
 * Chat backgrounds (round 4, board "Chat and sidebar"): none, one colour, or a photo. Every chat
 * uses the person's default (Settings → Preferences → Background) unless the agent has its own.
 *
 * Where they are kept: the hub does not accept a `background` key yet (prefs drop it, agent
 * settings refuse it), so for now both live on this device, under `bubble.chat-background`. Once
 * the hub takes UserPrefs.background and AgentSettings.background, only `read`/`write` below change;
 * the hooks and setters keep their shape.
 */
export type ChatBackground = { kind: "none" } | { kind: "color"; color: string } | { kind: "photo"; url: string };

export const NO_BACKGROUND: ChatBackground = { kind: "none" };

/** The colour swatches: soft tints in light mode; in dark mode the same hue, dimmed (backgroundCss). */
export const BACKGROUND_COLORS = ["#dce9f7", "#e4dcf7", "#f3dcea", "#f6dfd8", "#f3ead6", "#dcefe6", "#d8edf1", "#e6e6ea"];

interface Saved {
  default?: ChatBackground;
  agents?: Record<string, ChatBackground>;
}

const KEY = "bubble.chat-background";
const listeners = new Set<() => void>();
let cache: Saved | null = null;

function valid(bg: unknown): bg is ChatBackground {
  if (!bg || typeof bg !== "object") return false;
  const b = bg as Record<string, unknown>;
  if (b.kind === "none") return true;
  if (b.kind === "color") return typeof b.color === "string" && /^#[0-9a-fA-F]{6}$/.test(b.color);
  if (b.kind === "photo") return typeof b.url === "string" && /^\/api\/files\/[A-Za-z0-9_-]{1,64}$/.test(b.url);
  return false;
}

function read(): Saved {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || "{}") as Saved;
  } catch {
    cache = {};
  }
  return cache;
}

function write(next: Saved) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode or full: keep it for this visit */
  }
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

/** The default every chat uses. */
export function defaultBackground(): ChatBackground {
  const d = read().default;
  return valid(d) ? d : NO_BACKGROUND;
}

/** The agent's own background, or null when it uses the default. */
export function agentBackground(agentId: string): ChatBackground | null {
  const a = read().agents?.[agentId];
  return valid(a) ? a : null;
}

/** What a chat with this agent shows (teams and no agent: the default). */
export function backgroundFor(agentId?: string | null): ChatBackground {
  return (agentId && agentBackground(agentId)) || defaultBackground();
}

export function setDefaultBackground(bg: ChatBackground) {
  write({ ...read(), default: bg });
}

/** null puts the agent back on the default. */
export function setAgentBackground(agentId: string, bg: ChatBackground | null) {
  const agents = { ...read().agents };
  if (bg) agents[agentId] = bg;
  else delete agents[agentId];
  write({ ...read(), agents });
}

const same = (a: ChatBackground, b: ChatBackground) => JSON.stringify(a) === JSON.stringify(b);
let last: Record<string, ChatBackground> = {};
const stable = (key: string, bg: ChatBackground) => (last[key] && same(last[key], bg) ? last[key] : (last = { ...last, [key]: bg })[key]);

/** The background a chat shows: the agent's own, else the default. Re-renders when either changes. */
export function useChatBackground(agentId?: string | null): ChatBackground {
  return useSyncExternalStore(
    subscribe,
    () => stable(agentId ?? "", backgroundFor(agentId)),
    () => NO_BACKGROUND,
  );
}

/** Only the default (the Settings row). */
export function useDefaultBackground(): ChatBackground {
  return useSyncExternalStore(subscribe, () => stable("\u0000default", defaultBackground()), () => NO_BACKGROUND);
}

/** Uploads a photo through the usual file upload and gives back the background for it. */
export async function uploadBackground(file: File): Promise<ChatBackground> {
  if (!file.type.startsWith("image/")) throw new Error("Pick a photo.");
  const up = await uploadFile(file);
  return { kind: "photo", url: `/api/files/${up.id}` };
}

const shown = new Map<string, Promise<string>>();
/** A photo's address the page can show (hub files need the sign-in header, so they become object URLs). */
export function usePhotoSrc(bg: ChatBackground | null | undefined): string | null {
  const url = bg?.kind === "photo" ? bg.url : null;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!url) return;
    let live = true;
    const id = url.slice("/api/files/".length);
    let p = shown.get(id);
    if (!p) {
      p = fileUrl(id);
      shown.set(id, p);
      p.catch(() => shown.delete(id));
    }
    p.then((s) => live && setSrc(s)).catch(() => {});
    return () => {
      live = false;
    };
  }, [url]);
  return src;
}

/** The CSS background for one, or null for none (and for a photo still loading). Dark mode dims a colour to its hue. */
export function backgroundCss(bg: ChatBackground, photoSrc: string | null, dark = false): string | null {
  if (bg.kind === "color") return dark ? `color-mix(in srgb, ${bg.color} 14%, #141416)` : bg.color;
  if (bg.kind === "photo") return photoSrc ? `center / cover no-repeat url("${photoSrc}")` : null;
  return null;
}

/**
 * Puts the open chat's background on the page (--chat-wall, `data-chat-wall`) while it is open.
 * index.css paints it behind the chat, and on desktops behind the glass sidebar too. None leaves
 * the usual window colour.
 */
export function usePageBackground(active: boolean, agentId?: string | null) {
  const bg = useChatBackground(agentId);
  const src = usePhotoSrc(bg);
  const css = active ? backgroundCss(bg, src) : null;
  const dark = active ? backgroundCss(bg, src, true) : null;
  useEffect(() => {
    if (!css || !dark) return;
    const root = document.documentElement;
    root.style.setProperty("--chat-wall-light", css);
    root.style.setProperty("--chat-wall-dark", dark);
    root.dataset.chatWall = bg.kind;
    return () => {
      root.style.removeProperty("--chat-wall-light");
      root.style.removeProperty("--chat-wall-dark");
      delete root.dataset.chatWall;
    };
  }, [css, dark, bg.kind]);
}
