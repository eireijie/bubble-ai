import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { catalogConnector, type Connector, type SignInOption } from "@bubble-ai/core";
import { api } from "../../api.ts";
import { connectApps, signInOptions } from "../../appSignIn.ts";
import { brandLogo } from "../../brandLogos.ts";
import { BrandTile } from "../../components/MarketParts.tsx";
import { cx } from "../../components/ui.tsx";
import { agentInstructions } from "../../onboardingV3.ts";
import { BubbleSlot } from "./Stage.tsx";
import { Bubble } from "../../components/Bubble.tsx";
import type { GhostAppearance } from "@bubble-ai/core";

/**
 * The first run's pages after "Your agent" (2026-11-26 canvas): How it starts (Simple or Advanced,
 * each shown as a small loop of what it's like), then for Advanced, Make it yours (what it helps
 * with, how it talks, when it checks in, with the message it would send) and Connect (each app
 * connects right there: sign in, or a key, and the row says when it's connected).
 * They sit on the one Stage (Stage.tsx); the bubble above each is the stage's own.
 */

export type SetupPath = "advanced" | "simple";

export interface SetupGoal {
  id: string;
  label: string;
  /** a 24×24 line-icon path */
  icon: string;
  /** catalog ids of the apps it calls for */
  apps: string[];
  /** what it would tell you, for the preview */
  news: string;
}

export const SETUP_GOALS: SetupGoal[] = [
  { id: "inbox", label: "Email", icon: "M4 6h16v12H4zM4 7l8 6 8-6", apps: ["gmail"], news: "3 emails need a reply" },
  { id: "cal", label: "Calendar", icon: "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4", apps: ["gcal"], news: "your 2pm moved to 3" },
  { id: "support", label: "Customers", icon: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z", apps: ["slack", "gmail"], news: "2 customers are waiting" },
  { id: "orders", label: "Orders", icon: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8", apps: ["stripe"], news: "4 orders are ready to ship" },
  { id: "research", label: "Research", icon: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5", apps: ["notion", "brave-search"], news: "I found 5 sources on your question" },
  { id: "code", label: "Code", icon: "m16 18 6-6-6-6M8 6l-6 6 6 6", apps: ["github", "linear"], news: "the build on main failed" },
];

export const SETUP_APPS: Record<string, { name: string }> = {
  gmail: { name: "Gmail" },
  gcal: { name: "Google Calendar" },
  slack: { name: "Slack" },
  stripe: { name: "Stripe" },
  gdrive: { name: "Google Drive" },
  notion: { name: "Notion" },
  github: { name: "GitHub" },
  linear: { name: "Linear" },
  "brave-search": { name: "Brave Search" },
};

/** The apps the picked goals call for, each once, in pick order. */
export function appsFor(goalIds: readonly string[]): string[] {
  const out: string[] = [];
  for (const g of SETUP_GOALS) if (goalIds.includes(g.id)) for (const a of g.apps) if (!out.includes(a)) out.push(a);
  return out;
}

/** "a, b and c" */
export function andList(xs: readonly string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

// --- How it starts -------------------------------------------------------------------------------

/** Simple or Advanced, each shown, not described: a chat that starts right away, or goals and apps picked first. */
export function StartStep({ name, path, onPath, onNext }: { name: string; path: SetupPath; onPath: (p: SetupPath) => void; onNext: () => void }) {
  return (
    <div className="flex w-full max-w-[600px] flex-col items-center">
      <BubbleSlot size={96} />
      <h1 className="ob-title mt-5">How should {name} start?</h1>
      <div role="radiogroup" aria-label="How it starts" className="mt-7 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
        <button type="button" role="radio" aria-checked={path === "simple"} onClick={() => onPath("simple")} className="ob-tile flex flex-col gap-3 p-3">
          <div className="ob-demo ob-demo-simple" aria-hidden>
            <span className="msg m1" />
            <span className="msg me m2" />
            <span className="msg m3" />
          </div>
          <span className="px-1 pb-1">
            <span className="block text-[15px] font-semibold">Simple</span>
            <span className="block text-[13px] text-muted">Chat now</span>
          </span>
        </button>
        <button type="button" role="radio" aria-checked={path === "advanced"} onClick={() => onPath("advanced")} className="ob-tile flex flex-col gap-3 p-3">
          <div className="ob-demo ob-demo-adv" aria-hidden>
            <span className="chip c1">Email</span>
            <span className="chip c2">Calendar</span>
            <span className="chip c3">Code</span>
            <span className="chip r1">Gmail ✓</span>
            <span className="chip r2">GitHub ✓</span>
          </div>
          <span className="px-1 pb-1">
            <span className="block text-[15px] font-semibold">Advanced</span>
            <span className="block text-[13px] text-muted">Goals and apps first</span>
          </span>
        </button>
      </div>
      <button type="button" onClick={onNext} className="ob-primary mt-9 w-full max-w-[280px]">
        Continue
      </button>
    </div>
  );
}

// --- Make it yours -------------------------------------------------------------------------------

export type Talk = "brief" | "balanced" | "detailed";
export type CheckIn = "morning" | "evening" | "needed";
const TALK: { id: Talk; label: string }[] = [
  { id: "brief", label: "Brief" },
  { id: "balanced", label: "Balanced" },
  { id: "detailed", label: "Detailed" },
];
const WHEN: { id: CheckIn; label: string }[] = [
  { id: "morning", label: "Mornings" },
  { id: "evening", label: "Evenings" },
  { id: "needed", label: "When needed" },
];

/** The message it would send you, from what's picked: the preview on Make it yours. */
export function sampleMessage(goals: readonly string[], talk: Talk, when: CheckIn): string {
  const news = SETUP_GOALS.filter((g) => goals.includes(g.id)).map((g) => g.news);
  const open = when === "morning" ? "Morning." : when === "evening" ? "Today's wrap-up:" : "Heads up:";
  if (!news.length) return `${open} Nothing needs you yet.`;
  // a sentence starts after "Morning." but not after a colon
  const say = (body: string) => `${open} ${open.endsWith(".") ? body.charAt(0).toUpperCase() + body.slice(1) : body}`;
  if (talk === "brief") return say(`${news[0]}.`);
  if (talk === "balanced") return say(`${andList(news.slice(0, 2))}. Want me to handle it?`);
  return say(`${andList(news.slice(0, 3))}. I've drafted what I can and put it in Your turn. Say go and I'll send it.`);
}

/** The agent's instructions from Make it yours: the usual start, what it helps with, how it talks, when it checks in. */
export function yoursInstructions(name: string, person: string, goals: readonly string[], talk: Talk, when: CheckIn): string {
  const who = person.trim().split(/\s+/)[0] || "them";
  const want = SETUP_GOALS.filter((g) => goals.includes(g.id)).map((g) => g.label.toLowerCase());
  const base = agentInstructions(name, person, "", [], want.join(", "));
  const style = { brief: "Keep messages short: one or two lines.", balanced: "Keep messages short, with enough detail to act on.", detailed: "Give full detail, and say what you've already done." }[talk];
  const check = { morning: `Each morning, message ${who} with what needs them.`, evening: `Each evening, message ${who} with what happened and what needs them.`, needed: `Only message ${who} when something needs them.` }[when];
  return `${base} ${style} ${check}`;
}

export function YoursStep({ look, seed, name, goals, onGoals, talk, onTalk, when, onWhen, onNext, busy }: { name: string; goals: string[]; onGoals: (g: string[]) => void; talk: Talk; onTalk: (t: Talk) => void; when: CheckIn; onWhen: (w: CheckIn) => void; onNext: () => void; busy?: boolean; look?: Pick<GhostAppearance, "color" | "color2" | "bubble">; seed?: string }) {
  const msg = sampleMessage(goals, talk, when);
  return (
    <div className="flex w-full max-w-[600px] flex-col items-center">
      <BubbleSlot size={72} />
      <h1 className="ob-title mt-4">Make {name} yours</h1>
      <div className="mt-7 grid w-full grid-cols-3 gap-2" aria-label="Helps with" role="group">
        {SETUP_GOALS.map((g) => {
          const on = goals.includes(g.id);
          return (
            <button key={g.id} type="button" aria-pressed={on} onClick={() => onGoals(on ? goals.filter((x) => x !== g.id) : [...goals, g.id])} className="ob-tile flex h-[72px] flex-col justify-between p-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={g.icon} />
              </svg>
              <span className="text-[14px] font-semibold">{g.label}</span>
              <span aria-hidden className={cx("absolute right-2.5 top-2.5 grid size-[18px] place-items-center rounded-full text-white transition-[background-color,opacity] duration-200", on ? "bg-wisp opacity-100" : "opacity-0")}>
                <Check size={11} strokeWidth={3.2} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-5 flex w-full flex-wrap items-center justify-between gap-3">
        <Seg label="Talks" value={talk} options={TALK} onPick={onTalk} />
        <Seg label="Checks in" value={when} options={WHEN} onPick={onWhen} />
      </div>
      {/* what it would actually send, changing as you pick */}
      <div className="mt-6 flex w-full items-end gap-2" aria-live="polite">
        <Bubble look={look} seed={seed} size={28} label="" follow={false} />
        <div key={msg} className="bubble them tail m-pop max-w-[460px] text-[14.5px]">
          {msg}
        </div>
      </div>
      <button type="button" onClick={onNext} disabled={busy} className="ob-primary mt-9 w-full max-w-[280px]">
        {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
        Continue
      </button>
    </div>
  );
}

function Seg<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: { id: T; label: string }[]; onPick: (v: T) => void }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[13px] text-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="ob-seg">
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onPick(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Connect -------------------------------------------------------------------------------------

type Way = "signin" | "key" | "none";
type ConnState = "idle" | "out" | "key" | "saving" | "on" | { error: string };

/** How an app connects from here: its own sign-in when the hub can do it, else a key when it takes one, else not yet. */
export function wayFor(id: string, opt: SignInOption | undefined): Way {
  if (opt?.signIn) return "signin";
  const entry = catalogConnector(id);
  return entry?.fields.some((f) => f.secret) ? "key" : "none";
}

/** Already connected: signed in, or made with its key. */
export function isConnected(c: Pick<Connector, "catalogId" | "auth" | "kind">, id: string): boolean {
  return c.catalogId === id && (c.auth ? c.auth.signedIn : true);
}

/** Make a catalog app from a pasted key, the way Apps does. */
async function addWithKey(id: string, values: Record<string, string>): Promise<void> {
  const e = catalogConnector(id);
  if (!e) throw new Error("Unknown app");
  const env = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
  const body = e.kind === "mcp-http" ? { kind: e.kind, name: e.name, url: e.url, headers: e.headers ?? {}, env } : { kind: e.kind, name: e.name, command: e.command, args: e.args ?? [], env };
  const made = await api<Connector>("POST", "/api/connectors", { ...body, catalogId: id, agentIds: [], allAgents: true });
  // the hub tries the key straight away: a server that still asks for a sign-in turned the key down
  if (made?.auth?.required && !made.auth.signedIn) {
    await api("DELETE", `/api/connectors/${made.id}`).catch(() => {});
    throw new Error("That key didn't work");
  }
}

export function ConnectStep({ name, goals, onNext }: { name: string; goals: string[]; onNext: (on: string[], off: string[]) => void }) {
  const apps = appsFor(goals.length ? goals : ["inbox", "cal"]);
  const [conn, setConn] = useState<Record<string, ConnState>>({});
  const [opts, setOpts] = useState<Record<string, SignInOption> | null>(null);
  const [keys, setKeys] = useState<Record<string, Record<string, string>>>({});
  const tries = useRef<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    signInOptions().then((o) => live && setOpts(o), () => live && setOpts({}));
    // anything already connected shows so
    api<Connector[]>("GET", "/api/connectors").then(
      (list) => live && setConn((c) => ({ ...Object.fromEntries(apps.filter((a) => list.some((x) => isConnected(x, a))).map((a) => [a, "on" as const])), ...c })),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = async (id: string) => {
    const n = (tries.current[id] = (tries.current[id] ?? 0) + 1);
    setConn((c) => ({ ...c, [id]: "out" }));
    const r = await connectApps([id]);
    if (tries.current[id] !== n) return;
    setConn((c) => ({ ...c, [id]: r.ok ? "on" : { error: r.error } }));
  };
  const cancel = (id: string) => {
    tries.current[id] = (tries.current[id] ?? 0) + 1;
    setConn((c) => ({ ...c, [id]: "idle" }));
  };
  const saveKey = async (id: string) => {
    setConn((c) => ({ ...c, [id]: "saving" }));
    try {
      await addWithKey(id, keys[id] ?? {});
      setConn((c) => ({ ...c, [id]: "on" }));
    } catch (e) {
      setConn((c) => ({ ...c, [id]: { error: (e as Error).message } }));
    }
  };
  const on = apps.filter((a) => conn[a] === "on");
  const names = (ids: string[]) => ids.map((a) => SETUP_APPS[a]?.name ?? a);

  return (
    <div className="flex w-full max-w-[520px] flex-col items-center">
      <BubbleSlot size={72} />
      <h1 className="ob-title mt-4">Connect what {name} needs</h1>
      <div className="mt-7 w-full rounded-xl bg-panel shadow-[inset_0_0_0_1px_var(--line2)]">
        {apps.map((id, i) => {
          const app = SETUP_APPS[id];
          const logo = brandLogo(id, app?.name);
          const state = conn[id] ?? "idle";
          const way = opts ? wayFor(id, opts[id]) : null;
          const entry = catalogConnector(id);
          const fields = entry?.fields.filter((f) => !f.optional) ?? [];
          const ready = fields.every((f) => (keys[id]?.[f.key] ?? "").trim());
          return (
            <div key={id} className={cx("flex flex-col px-3.5", i > 0 && "shadow-[inset_0_1px_0_var(--line)]")}>
              <div className="flex min-h-[60px] items-center gap-3 py-2.5">
                {logo ? <BrandTile logo={logo} size={36} /> : <span className="size-9 rounded-lg bg-card" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{app?.name ?? id}</span>
                  {typeof state === "object" && <span className="block text-[12.5px] leading-4 text-bad">{state.error}</span>}
                </span>
                {state === "on" ? (
                  <span className="ob-conn flex items-center gap-1.5 text-[13.5px] font-semibold text-ok">
                    <Check size={15} strokeWidth={2.8} aria-hidden />
                    Connected
                  </span>
                ) : state === "out" ? (
                  <span className="ob-conn flex items-center gap-2 text-[13px] text-muted">
                    <Loader2 size={15} className="animate-spin" aria-hidden />
                    Finish in your browser
                    <button type="button" onClick={() => cancel(id)} className="ob-quiet -mr-2">
                      Cancel
                    </button>
                  </span>
                ) : way === null ? (
                  <Loader2 size={15} className="animate-spin text-faint" aria-label="Checking" />
                ) : way === "none" ? (
                  <span className="text-[13px] text-faint">Soon</span>
                ) : state === "key" || state === "saving" ? (
                  <button type="button" onClick={() => cancel(id)} className="ob-quiet -mr-2">
                    Cancel
                  </button>
                ) : (
                  <button type="button" onClick={() => (way === "signin" ? void signIn(id) : setConn((c) => ({ ...c, [id]: "key" })))} className="ob-conn h-8 shrink-0 rounded-lg px-3 text-[13.5px] font-semibold text-ink shadow-[inset_0_0_0_1px_var(--line2)] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/40">
                    {typeof state === "object" ? "Try again" : way === "signin" ? "Connect" : "Add key"}
                  </button>
                )}
              </div>
              {(state === "key" || state === "saving") && (
                <form
                  className="ob-panel flex flex-col gap-2 pb-3.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (ready) void saveKey(id);
                  }}
                >
                  {fields.map((f, n) => (
                    <input
                      key={f.key}
                      autoFocus={n === 0}
                      type={f.secret ? "password" : "text"}
                      autoComplete="off"
                      aria-label={f.label}
                      placeholder={f.placeholder ?? f.label}
                      value={keys[id]?.[f.key] ?? ""}
                      onChange={(e) => setKeys((k) => ({ ...k, [id]: { ...k[id], [f.key]: e.target.value } }))}
                      className="h-9 rounded-lg bg-card px-3 text-[14px] outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring/40"
                    />
                  ))}
                  <div className="flex items-center justify-between">
                    {fields[0]?.link ? (
                      <a href={fields[0].link} target="_blank" rel="noreferrer" className="text-[12.5px] text-muted underline-offset-2 hover:text-ink hover:underline">
                        Get a key
                      </a>
                    ) : (
                      <span />
                    )}
                    <button type="submit" disabled={!ready || state === "saving"} className="ob-primary h-8 px-3.5 text-[13px]">
                      {state === "saving" && <Loader2 size={14} className="animate-spin" aria-hidden />}
                      Save
                    </button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-9 flex h-10 w-full items-center justify-center">
        {on.length ? (
          <button type="button" onClick={() => onNext(names(on), names(apps.filter((a) => !on.includes(a))))} className="ob-primary ob-conn w-full max-w-[280px]">
            Continue
          </button>
        ) : (
          <button type="button" onClick={() => onNext([], names(apps))} className="ob-quiet">
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}
