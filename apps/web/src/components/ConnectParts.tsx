import { useEffect, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { AppCategory, Connector, ConnectSuggestion, Message } from "@bubble-ai/core";
import { api } from "../api.ts";
import { brandLogo, isDarkMark, type BrandLogo } from "../brandLogos.ts";
import { useStore } from "../store.ts";
import { cx } from "./ui.tsx";

/**
 * Connect apps (round 8, canvas board "Apps"): the pieces the pop-up and the sidebar's "Connect
 * apps" pill share. The pop-up itself is MarketplaceView.
 */

/** The filter chips past All, Apps, Skills and This Mac: topics an app is about, and Mods. */
export type Topic = "productivity" | "communication" | "passwords" | "developer" | "design" | "money" | "mods";

/** The chips in the row: [key, label]. All, Apps, Skills and This Mac are the page's own sections (the address). */
export const MAIN_CHIPS: readonly [string, string][] = [
  ["all", "All"],
  ["apps", "Apps"],
  ["skills", "Skills"],
  ["devices", "This Mac"],
  ["productivity", "Productivity"],
  ["communication", "Communication"],
];
/** The rest, under More. */
export const MORE_CHIPS: readonly [Topic, string][] = [
  ["passwords", "Password managers"],
  ["developer", "Developer tools"],
  ["design", "Design and media"],
  ["money", "Money"],
  ["mods", "Mods"],
];
export const TOPICS = new Set<string>(["productivity", "communication", ...MORE_CHIPS.map(([k]) => k)]);

/** What "This Mac" is called on the computer this runs on: Mac, PC or computer. */
export function thisComputer(platform = typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent): string {
  if (/mac|iphone|ipad/i.test(platform)) return "This Mac";
  if (/win/i.test(platform)) return "This PC";
  return "This computer";
}

const PASSWORDS = /\b(1password|bitwarden|lastpass|dashlane|keeper|proton ?pass|keepass\w*|passwords?)\b/i;
const MAIL = /\b(e-?mail|gmail|outlook|inbox|imap)\b/i;

/** The topics an app is on, from its shelf (AppCategory) and, for password managers, its name. */
export function appTopics(a: { name: string; description?: string | null; category?: AppCategory | null }): Topic[] {
  if (PASSWORDS.test(a.name)) return ["passwords"];
  switch (a.category) {
    case "Email and calendar":
      return MAIL.test(`${a.name} ${a.description ?? ""}`) ? ["communication"] : ["productivity"];
    case "Chat":
      return ["communication"];
    case "Tasks":
    case "Docs and notes":
    case "Data":
    case "Research":
    case "Automation":
      return ["productivity"];
    case "Developer":
      return ["developer"];
    case "Design":
      return ["design"];
    case "Finance":
    case "Sales":
      return ["money"];
    default:
      return [];
  }
}

/** The latest apps an agent suggested (a "connect" part, PR 163), and who suggested them: the open chat's first. */
export function latestPicks(messages: Record<string, Message[]> | undefined, active: string | null | undefined): { agentId: string | null; apps: ConnectSuggestion[] } | null {
  if (!messages) return null;
  const lists = [...(active && messages[active] ? [messages[active]] : []), ...Object.entries(messages).filter(([k]) => k !== active).map(([, v]) => v)];
  for (const list of lists) {
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      const part = m.parts?.find((p) => p.type === "connect") as Extract<Message["parts"][number], { type: "connect" }> | undefined;
      if (part?.apps.length) return { agentId: m.author.kind === "agent" ? m.author.id : null, apps: part.apps };
    }
  }
  return null;
}

/**
 * The agent's latest picks wherever they are: the chats already loaded first; when none of those has
 * any, the last messages of the few most recent agent chats are fetched once to look.
 */
export function useAgentPicks(): { agentId: string | null; apps: ConnectSuggestion[] } | null {
  const messages = useStore((s) => s.messages);
  const active = useStore((s) => s.activeChannel);
  const channels = useStore((s) => s.channels);
  const [fetched, setFetched] = useState<Record<string, Message[]>>({});
  const loaded = latestPicks(messages, active);
  useEffect(() => {
    if (loaded || !channels) return;
    const dms = channels
      .filter((c) => c.kind === "dm" && !messages?.[c.id])
      .sort((a, b) => (b.last?.at ?? "").localeCompare(a.last?.at ?? ""))
      .slice(0, 6);
    let live = true;
    void Promise.all(dms.map((c) => api<{ messages: Message[] }>("GET", `/api/channels/${c.id}/messages?limit=40`).then((r) => [c.id, r.messages] as const, () => null))).then((pages) => {
      if (live) setFetched(Object.fromEntries(pages.filter((x): x is readonly [string, Message[]] => !!x)));
    });
    return () => {
      live = false;
    };
  }, [!!loaded, channels?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return loaded ?? latestPicks(fetched, null);
}

/** An added app is connected: on, and signed in when it needs a sign-in. */
export const isOn = (c: Connector) => c.enabled && (!c.auth?.required || c.auth.signedIn);

/** The logos of connected apps that Bubble AI carries, newest first, at most `max`. */
export function connectedLogos(list: Connector[], max = 3): BrandLogo[] {
  const out: BrandLogo[] = [];
  for (const c of [...list].reverse()) {
    if (!isOn(c)) continue;
    const l = brandLogo(c.catalogId, c.name);
    if (l && !out.includes(l)) out.push(l);
    if (out.length >= max) break;
  }
  return out;
}

/** The person's added apps, kept fresh: loaded once, again when the hub says they changed and when the page moves on (back from a sign-in, the pop-up closing). */
export function useConnectors(): Connector[] | null {
  const version = useStore((s) => s.skillsVersion);
  const [hash, setHash] = useState(() => (typeof location === "undefined" ? "" : location.hash));
  const [list, setList] = useState<Connector[] | null>(null);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    let live = true;
    api<Connector[]>("GET", "/api/connectors").then(
      (l) => live && setList(l),
      () => live && setList((x) => x ?? []),
    );
    return () => {
      live = false;
    };
  }, [version, hash]);
  return list;
}

/** Up to three connected logos, small white rounded squares overlapping a little. */
export function LogoStack({ logos, size = 20, className }: { logos: BrandLogo[]; size?: number; className?: string }) {
  if (!logos.length) return null;
  return (
    <span className={cx("flex shrink-0", className)} aria-hidden>
      {logos.map((l, i) => (
        <span key={l.title} className="grid place-items-center bg-white shadow-[0_0_0_1.5px_var(--stack-ring)]" style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), marginLeft: i ? -5 : 0 }}>
          <svg viewBox="0 0 24 24" width={Math.round(size * 0.6)} height={Math.round(size * 0.6)}>
            <path d={l.path} fill={isDarkMark(l.hex) ? "#111" : `#${l.hex}`} />
          </svg>
        </span>
      ))}
    </span>
  );
}

/** "✓ Connected", "✓ Added", "✓ On": what a row says once it's in. */
export function Done({ word }: { word: string }) {
  return (
    <span className="flex shrink-0 items-center gap-[5px] pr-1 text-[13.5px] text-muted" role="img" aria-label={word}>
      <Check size={13} strokeWidth={2.4} aria-hidden />
      <span aria-hidden>{word}</span>
    </span>
  );
}

/** The soft pill at a row's right: Connect, Add, Bring in, Set up. */
export function GoPill({ className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...p} className={cx("h-[30px] shrink-0 rounded-[15px] bg-[var(--go-bg)] px-3.5 text-[13.5px] font-medium text-ink outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50", className)} />;
}

/** A chip in the filter row: outlined, the chosen one filled with the ink colour. */
export function FilterChip({ on, onClick, children, ...rest }: { on: boolean; onClick: () => void; children: ReactNode } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} {...rest} className={cx("inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-2xl border px-[13px] text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40", on ? "border-ink bg-ink font-semibold text-panel" : "border-[var(--pop-line)] text-ink hover:bg-hover")}>
      {children}
    </button>
  );
}

/**
 * One app, skill or mod: a 42 px tile, its name (with a Recommended mark), one line of what it does,
 * and at the right Connect / Add or ✓ Connected / ✓ Added. The name opens its page inside the pop-up.
 */
export function ConnectRow({ tile, name, mark, desc, status, action, onOpen }: { tile: ReactNode; name: string; mark?: string; desc?: string; status?: ReactNode; action?: ReactNode; onOpen?: () => void }) {
  const main = (
    <>
      {tile}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center">
          <span className="truncate text-[14.5px] font-medium leading-5">{name}</span>
          {mark && <span className="ml-1.5 shrink-0 rounded-[6px] bg-wisp-soft px-[7px] py-0.5 text-[11.5px] font-semibold leading-[14px] text-wisp-strong">{mark}</span>}
        </span>
        {desc && <span className="block truncate text-[13px] leading-[18px] text-muted">{desc}</span>}
      </span>
      {status}
    </>
  );
  return (
    <div className="flex h-[60px] min-w-0 items-center gap-3 rounded-[14px] px-3 hover:bg-hover">
      {onOpen ? (
        <button type="button" onClick={onOpen} className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-[12px] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
          {main}
        </button>
      ) : (
        <div className="flex h-full min-w-0 flex-1 items-center gap-3">{main}</div>
      )}
      {action}
    </div>
  );
}

/** The 42 px tile for a line icon (skills, mods, things on this computer): the same white square as a logo's. */
export function LineTile({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-white text-ink ring-1 ring-black/[0.08] dark:bg-[#2c2c2e] dark:ring-white/[0.09]" aria-hidden>
      {children}
    </span>
  );
}
