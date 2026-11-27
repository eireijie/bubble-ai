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

/**
 * The colours, each a pair: a soft tint for light mode and a deep, clearly coloured tone for dark
 * mode. Whichever half is saved, a chat shows the half for the mode it's in, and the picker shows
 * the set for the mode it's in (swatchesFor).
 */
export const BACKGROUND_PAIRS: readonly { light: string; dark: string; name: string; darkName: string }[] = [
  { light: "#dfe4f3", dark: "#262f45", name: "Mist", darkName: "Slate blue" },
  { light: "#dcebf5", dark: "#1d2a44", name: "Sky", darkName: "Navy" },
  { light: "#d9eef0", dark: "#173338", name: "Aqua", darkName: "Teal" },
  { light: "#e2f0e6", dark: "#1a3826", name: "Mint", darkName: "Forest" },
  { light: "#efe4f7", dark: "#33223f", name: "Lilac", darkName: "Plum" },
  { light: "#f3e3dc", dark: "#3d1f2a", name: "Peach", darkName: "Wine" },
  { light: "#f6efd9", dark: "#3a2f1f", name: "Sand", darkName: "Umber" },
];

/** Mist in light mode, Slate blue in dark: what every chat shows until the person picks (so the glass has something to sit on). */
export const MIST = "#dfe4f3";
export const SLATE = "#262f45";
export const DEFAULT_BACKGROUND: ChatBackground = { kind: "color", color: MIST };

/** The swatches a picker shows: the light set, or the dark set in dark mode. [colour, name] */
export function swatchesFor(dark: boolean): [string, string][] {
  return BACKGROUND_PAIRS.map((p) => (dark ? [p.dark, p.darkName] : [p.light, p.name]));
}
/** The light set (Settings' first pick, older callers). */
export const BACKGROUND_SWATCHES: readonly [string, string][] = swatchesFor(false);
export const BACKGROUND_COLORS = BACKGROUND_SWATCHES.map(([c]) => c);

const pairOf = (hex: string) => {
  const h = hex.toLowerCase();
  return BACKGROUND_PAIRS.find((p) => p.light === h || p.dark === h);
};

/** Whether two saved colours are the same swatch (one may be the light half, the other the dark). */
export function sameSwatch(a: string, b: string): boolean {
  const p = pairOf(a);
  return p ? p === pairOf(b) : a.toLowerCase() === b.toLowerCase();
}

/**
 * The colour a saved one shows as: its pair's half for the mode. A colour from outside the pairs
 * stays as it is, except a light one in dark mode, which is tinted toward Slate blue.
 */
export function shownColor(hex: string, dark: boolean): string {
  const p = pairOf(hex);
  if (p) return dark ? p.dark : p.light;
  if (!dark || lightness(hex) < 0.35) return hex;
  return mixHex(hex, SLATE, 0.75);
}

// --- soft gradients (round 6): a colour background is a gentle wash, not a flat fill ----------------

const rgbOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hexOf = (c: number[]) => "#" + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
/** `a` moved toward `b` by t (0 to 1), in sRGB. */
function mixHex(a: string, b: string, t: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return hexOf(x.map((v, i) => v + (y[i] - v) * t));
}
function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return hexOf([f(0), f(8), f(4)].map((v) => v * 255));
}
/** The colour turned a little around the wheel and made lighter or deeper (dl, -1 to 1). Greys only change lightness. */
function shift(hex: string, dh: number, dl: number): string {
  const [h, s, l] = toHsl(hex);
  return fromHsl((h + dh + 360) % 360, s, Math.min(0.97, Math.max(0.03, l + dl)));
}

/**
 * A colour as a soft gradient, Apple Messages-like: a lighter tint at the top left that turns a few
 * degrees one way, the colour itself across the middle, and a slightly deeper tone turned the other
 * way at the bottom right, with a faint glow in the top corner. Dark mode keeps it deep: the light
 * end only just lifts. `hex` is what shows (shownColor).
 */
export function colorGradient(hex: string, dark = false): string {
  const top = dark ? shift(mixHex(hex, "#ffffff", 0.1), -10, 0.02) : shift(mixHex(hex, "#ffffff", 0.45), -12, 0);
  const end = dark ? shift(mixHex(hex, "#000000", 0.22), 14, 0) : shift(hex, 14, -0.05);
  const glow = dark ? "rgb(255 255 255 / 0.06)" : "rgb(255 255 255 / 0.45)";
  return `radial-gradient(110% 80% at 0% 0%, ${glow}, transparent 60%), linear-gradient(155deg, ${top} 0%, ${hex} 48%, ${end} 100%)`;
}

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

/** The CSS background for one, or null for none (and for a photo still loading). A colour shows its half for the mode (shownColor), as a soft gradient. */
export function backgroundCss(bg: ChatBackground, photoSrc: string | null, dark = false): string | null {
  if (bg.kind === "color") return colorGradient(shownColor(bg.color, dark), dark);
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
  const tint = active && bg.kind === "color" ? shownColor(bg.color, true) : null;
  useEffect(() => {
    if (!css || !dark) return;
    const root = document.documentElement;
    root.style.setProperty("--chat-wall-light", css);
    root.style.setProperty("--chat-wall-dark", dark);
    // the solid colour under a gradient, for things tinted by it (the agent's bubbles, menus)
    if (tint) root.style.setProperty("--chat-wall-tint-dark", tint);
    root.dataset.chatWall = bg.kind;
    return () => {
      root.style.removeProperty("--chat-wall-light");
      root.style.removeProperty("--chat-wall-dark");
      root.style.removeProperty("--chat-wall-tint-dark");
      delete root.dataset.chatWall;
    };
  }, [css, dark, tint, bg.kind]);
}
