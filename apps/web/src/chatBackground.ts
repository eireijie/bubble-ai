import { useEffect, useState, useSyncExternalStore } from "react";
import type { ChatBackground } from "@bubble-ai/core";
import { api, ApiError, fileUrl, uploadFile } from "./api.ts";
import { useStore } from "./store.ts";

/**
 * Chat backgrounds (round 4, board "Chat and sidebar"): none, one colour, or a photo. Every chat
 * uses the person's default (Settings → Preferences → Background, kept in their prefs as
 * `background`) unless the agent has its own (the profile's Background tab, kept on the agent as
 * `settings.background`). Both are on the hub, so they follow the person to every device.
 *
 * This device's `bubble.chat-background` is only a fallback: an older hub that refuses the key (400)
 * keeps the choice here instead, and a later save that the hub takes clears it.
 */
export type { ChatBackground };

export const NO_BACKGROUND: ChatBackground = { kind: "none" };

/** Mist in light mode, Night in dark: what every chat shows until the person picks (so the glass has something to sit on). */
export const MIST = "#dfe4f3";
export const NIGHT = "#2a2d35";
export const DEFAULT_BACKGROUND: ChatBackground = { kind: "color", color: MIST };

/** The colour swatches (the Profile board's), light to dark; in dark mode each is dimmed to its hue (backgroundCss). */
export const BACKGROUND_SWATCHES: readonly [string, string][] = [
  ["#dfe4f3", "Mist"],
  ["#f3e3dc", "Peach"],
  ["#e2f0e6", "Mint"],
  ["#efe4f7", "Lilac"],
  ["#f6efd9", "Sand"],
  ["#dcebf5", "Sky"],
  ["#2a2d35", "Night"],
  ["#1c1c1c", "Black"],
];
export const BACKGROUND_COLORS = BACKGROUND_SWATCHES.map(([c]) => c);

interface Saved {
  default?: ChatBackground;
  agents?: Record<string, ChatBackground>;
}

const KEY = "bubble.chat-background";
const listeners = new Set<() => void>();
let cache: Saved | null = null;

/** Only none, a #rrggbb colour, or a hub file: nothing else ever reaches the page's CSS. */
export function validBackground(bg: unknown): bg is ChatBackground {
  if (!bg || typeof bg !== "object") return false;
  const b = bg as Record<string, unknown>;
  if (b.kind === "none") return true;
  if (b.kind === "color") return typeof b.color === "string" && /^#[0-9a-fA-F]{6}$/.test(b.color);
  if (b.kind === "photo") return typeof b.url === "string" && /^\/api\/files\/[A-Za-z0-9_-]{1,64}$/.test(b.url);
  return false;
}

function readLocal(): Saved {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || "{}") as Saved;
  } catch {
    cache = {};
  }
  return cache;
}

function writeLocal(next: Saved) {
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
  // the hub's copies come in with the agents and the person's prefs
  const unsub = useStore.subscribe(l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", storage);
    unsub();
  };
}

/** The hub refused the key itself (an older hub): only then is this device's copy used. A photo it turned down is a real error. */
const refused = (e: unknown) => e instanceof ApiError && e.status === 400 && /unrecognized key/i.test(e.message) && /background/.test(e.message);

/** The default every chat uses. */
export function defaultBackground(): ChatBackground {
  const saved = useStore.getState().me?.prefs?.background;
  if (validBackground(saved)) return saved;
  const local = readLocal().default;
  return validBackground(local) ? local : DEFAULT_BACKGROUND;
}

/** The agent's own background, or null when it uses the default. */
export function agentBackground(agentId: string): ChatBackground | null {
  const saved = useStore.getState().agents.find((a) => a.id === agentId)?.settings.background;
  if (validBackground(saved)) return saved;
  const local = readLocal().agents?.[agentId];
  return validBackground(local) ? local : null;
}

/** What a chat with this agent shows (teams and no agent: the default). */
export function backgroundFor(agentId?: string | null): ChatBackground {
  return (agentId && agentBackground(agentId)) || defaultBackground();
}

/** Saves the person's default on the hub (their prefs). */
export async function setDefaultBackground(bg: ChatBackground): Promise<void> {
  await useStore.getState().setPrefs({ background: bg });
  // an older hub drops keys it doesn't know from prefs (no error): then this device keeps it
  const kept = same(useStore.getState().me?.prefs?.background ?? null, bg);
  const { default: _, ...rest } = readLocal();
  if (!kept) writeLocal({ ...rest, default: bg });
  else if (readLocal().default) writeLocal(rest);
}

/** Saves the agent's own background on the hub; null puts it back on the default. */
export async function setAgentBackground(agentId: string, bg: ChatBackground | null): Promise<void> {
  const keepLocal = (next: ChatBackground | null) => {
    const agents = { ...readLocal().agents };
    if (next) agents[agentId] = next;
    else delete agents[agentId];
    writeLocal({ ...readLocal(), agents });
  };
  try {
    await api("PATCH", `/api/agents/${agentId}`, { settings: { background: bg } });
    if (readLocal().agents?.[agentId]) keepLocal(null);
    await useStore.getState().refreshAgents();
  } catch (e) {
    if (!refused(e)) throw e;
    keepLocal(bg);
  }
}

const same = (a: ChatBackground | null, b: ChatBackground | null) => JSON.stringify(a) === JSON.stringify(b);
let last: Record<string, ChatBackground | null> = {};
function stable<T extends ChatBackground | null>(key: string, bg: T): T {
  if (key in last && same(last[key], bg)) return last[key] as T;
  last = { ...last, [key]: bg };
  return bg;
}

/** The background a chat shows: the agent's own, else the default. Re-renders when either changes. */
export function useChatBackground(agentId?: string | null): ChatBackground {
  return useSyncExternalStore(
    subscribe,
    () => stable(`c:${agentId ?? ""}`, backgroundFor(agentId)),
    () => NO_BACKGROUND,
  );
}

/** Only the agent's own (the profile's Background tab), or null when it uses the default. */
export function useAgentBackground(agentId: string): ChatBackground | null {
  return useSyncExternalStore(
    subscribe,
    () => stable(`a:${agentId}`, agentBackground(agentId)),
    () => null,
  );
}

/** Only the default (the Settings row). */
export function useDefaultBackground(): ChatBackground {
  return useSyncExternalStore(subscribe, () => stable("d:", defaultBackground()), () => NO_BACKGROUND);
}

/** Uploads a photo through the usual file upload and gives back the background for it. */
export async function uploadBackground(file: File): Promise<ChatBackground> {
  if (!/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(file.type)) throw new Error("Pick a photo (PNG, JPEG, GIF, WebP).");
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

/** How light a #rrggbb colour is, 0 to 1. */
function lightness(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/**
 * The CSS background for one, or null for none (and for a photo still loading). In dark mode Mist
 * becomes Night, another light colour is dimmed to its hue, and a colour that is already dark stays
 * as it is (dimming it again would leave flat black under the glass).
 */
export function backgroundCss(bg: ChatBackground, photoSrc: string | null, dark = false): string | null {
  if (bg.kind === "color") {
    if (!dark || lightness(bg.color) < 0.35) return bg.color;
    return bg.color.toLowerCase() === MIST ? NIGHT : `color-mix(in srgb, ${bg.color} 20%, ${NIGHT} 80%)`;
  }
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
