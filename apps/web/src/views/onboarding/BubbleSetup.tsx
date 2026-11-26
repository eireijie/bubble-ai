import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronLeft, Loader2 } from "lucide-react";
import type { SignInOption } from "@bubble-ai/core";
import { connectApps, signInOptions } from "../../appSignIn.ts";
import { brandLogo } from "../../brandLogos.ts";
import { BrandTile } from "../../components/MarketParts.tsx";
import { BackgroundBubbles } from "../../components/BackgroundBubbles.tsx";
import { cx } from "../../components/ui.tsx";

/**
 * The first run's own screens (2026-11-25 "Bubble AI, bubbles", board 6): full window, the agent's
 * bubble centred and mostly still with small bubbles drifting up behind it. "How should it start?"
 * (Advanced, the default, or Simple), then for Advanced the goals and the apps they call for, each
 * with a Connect that signs in and comes back to the list.
 */

export type SetupPath = "advanced" | "simple";

export interface SetupGoal {
  id: string;
  label: string;
  /** a 24×24 line-icon path */
  icon: string;
  /** catalog ids of the apps it calls for */
  apps: string[];
}

export const SETUP_GOALS: SetupGoal[] = [
  { id: "inbox", label: "Handle my email", icon: "M4 6h16v12H4zM4 7l8 6 8-6", apps: ["gmail"] },
  { id: "cal", label: "Run my calendar", icon: "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4", apps: ["gcal"] },
  { id: "support", label: "Answer customers", icon: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z", apps: ["gmail", "slack"] },
  { id: "orders", label: "Sell and ship orders", icon: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8", apps: ["stripe", "gmail"] },
  { id: "money", label: "Keep the books", icon: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6", apps: ["stripe", "gdrive"] },
  { id: "content", label: "Write and post", icon: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z", apps: ["notion", "gdrive"] },
  { id: "research", label: "Research things", icon: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5", apps: ["brave-search", "notion"] },
  { id: "code", label: "Build software", icon: "m16 18 6-6-6-6M8 6l-6 6 6 6", apps: ["github"] },
  { id: "travel", label: "Plan trips", icon: "M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z", apps: ["gmail", "gcal", "brave-search"] },
];

export const SETUP_APPS: Record<string, { name: string; why: string }> = {
  gmail: { name: "Gmail", why: "Read and answer email" },
  gcal: { name: "Google Calendar", why: "See and book time" },
  slack: { name: "Slack", why: "Messages from your team" },
  stripe: { name: "Stripe", why: "Orders, payments and refunds" },
  gdrive: { name: "Google Drive", why: "Files and docs" },
  notion: { name: "Notion", why: "Notes and pages" },
  github: { name: "GitHub", why: "Code, issues and pull requests" },
  "brave-search": { name: "Brave Search", why: "Search the web" },
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

/** The full-window stage every first-run screen sits on. */
export function BubbleStage({ children, onBack, field = true, top }: { children: ReactNode; onBack?: () => void; field?: boolean; top?: ReactNode }) {
  useEffect(() => {
    if (!onBack) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && !(e.target instanceof HTMLInputElement) && onBack();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onBack]);
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-panel text-ink" data-testid="setup">
      {field && <BackgroundBubbles />}
      {onBack && (
        <button type="button" onClick={onBack} aria-label="Back" className="safe-top absolute left-4 top-4 z-10 grid size-[34px] place-items-center rounded-full text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/40">
          <ChevronLeft size={18} />
        </button>
      )}
      <div className="relative flex min-h-full flex-col items-center px-6 pb-10 pt-[max(40px,4vh)]">
        {/* the main bubble: background bubbles move out of its way, and a click pops it and spins it back up */}
        {top && (
          <div className="mb-5" data-bub-main="" data-bub-pop="">
            {top}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

const ring = (on: boolean) => (on ? "shadow-[inset_0_0_0_2px_var(--wisp)] bg-[var(--wisp-soft,rgba(169,139,245,.14))]" : "shadow-[inset_0_0_0_1px_var(--line2)] bg-panel hover:bg-hover");

/** "How should it start?" Advanced (the default) or Simple. */
export function PathChoice({ name, path, onPath }: { name: string; path: SetupPath; onPath: (p: SetupPath) => void }) {
  const opts: { id: SetupPath; title: string; body: string }[] = [
    { id: "advanced", title: "Advanced", body: "Tell it your goals. It suggests the apps to connect, then shows you around. About 5 minutes." },
    { id: "simple", title: "Simple", body: "Straight to chat. No apps yet; add them whenever you like." },
  ];
  return (
    <>
      <span className="mb-6 mt-1 text-[16px] text-muted">How should {name || "it"} start?</span>
      <div role="radiogroup" aria-label="How it starts" className="grid w-full max-w-[656px] grid-cols-1 gap-4 sm:grid-cols-2">
        {opts.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={path === o.id} onClick={() => onPath(o.id)} className={cx("flex flex-col gap-1.5 rounded-[20px] p-5 text-left outline-none transition-[box-shadow,background-color] duration-200 focus-visible:ring-3 focus-visible:ring-ring/40", ring(path === o.id))}>
            <span className="text-[18px] font-[650]">{o.title}</span>
            <span className="text-[14px] leading-5 text-muted">{o.body}</span>
          </button>
        ))}
      </div>
    </>
  );
}

const pill = "setup-press inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ink px-[22px] text-[16px] font-semibold text-panel outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-35";

/** What are your goals? Pick all that fit. */
export function GoalsStep({ name, picked, onPicked, onBack, onNext, bubble }: { name: string; picked: string[]; onPicked: (ids: string[]) => void; onBack: () => void; onNext: () => void; bubble?: ReactNode }) {
  return (
    <BubbleStage onBack={onBack} top={bubble}>
      <div className="flex w-full max-w-[660px] flex-col gap-1.5">
        <h1 className="m-0 text-[32px] font-bold leading-10 tracking-[-0.02em]">What are your goals?</h1>
        <span className="text-[16px] text-muted">Pick all that fit. {name} sets itself up around them.</span>
      </div>
      <div className="mt-7 grid w-full max-w-[660px] grid-cols-2 gap-3 sm:grid-cols-3">
        {SETUP_GOALS.map((g) => {
          const on = picked.includes(g.id);
          return (
            <button key={g.id} type="button" aria-pressed={on} onClick={() => onPicked(on ? picked.filter((x) => x !== g.id) : [...picked, g.id])} className={cx("relative flex h-24 flex-col justify-between rounded-[18px] p-4 text-left outline-none transition-[box-shadow,background-color,transform] duration-200 active:scale-[.98] focus-visible:ring-3 focus-visible:ring-ring/40", ring(on))}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={g.icon} />
              </svg>
              <span className="text-[15px] font-semibold">{g.label}</span>
              <span aria-hidden className={cx("absolute right-3 top-3 grid size-[22px] place-items-center rounded-full text-[#161616] transition-colors duration-200", on ? "bg-wisp" : "bg-transparent")}>
                <Check size={13} strokeWidth={3} className={on ? "opacity-100" : "opacity-0"} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-8 flex w-full max-w-[660px] items-center justify-between">
        <button type="button" onClick={onBack} className="h-[34px] rounded-full px-3.5 text-[14px] text-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/40">
          Back
        </button>
        <button type="button" onClick={onNext} disabled={!picked.length} className={cx(pill, "w-[200px]")}>
          Next
        </button>
      </div>
    </BubbleStage>
  );
}

type ConnState = "idle" | "out" | "on" | { error: string };

/**
 * Here's what I recommend: the apps the goals call for. Connect signs in on the app's own page
 * (connectApps) and the row turns Connected when the hub says so; one that can't sign in from here
 * says why, and stays for later. Next carries on whatever is connected.
 */
export function RecsStep({ goals, onBack, onNext, bubble }: { goals: string[]; onBack: () => void; onNext: (on: string[], off: string[]) => void; bubble?: ReactNode }) {
  const apps = appsFor(goals);
  const [conn, setConn] = useState<Record<string, ConnState>>({});
  const [opts, setOpts] = useState<Record<string, SignInOption> | null>(null);
  useEffect(() => {
    let live = true;
    signInOptions().then((o) => live && setOpts(o), () => live && setOpts({}));
    return () => {
      live = false;
    };
  }, []);
  const connect = async (id: string) => {
    setConn((c) => ({ ...c, [id]: "out" }));
    const r = await connectApps([id]);
    setConn((c) => ({ ...c, [id]: r.ok ? "on" : { error: r.error } }));
  };
  const words = andList(SETUP_GOALS.filter((g) => goals.includes(g.id)).map((g) => g.label.toLowerCase()));
  const names = (ids: string[]) => ids.map((a) => SETUP_APPS[a]?.name ?? a);
  return (
    <BubbleStage onBack={onBack} top={bubble}>
      <div className="flex w-full max-w-[660px] flex-col gap-1.5">
        <h1 className="m-0 text-[32px] font-bold leading-10 tracking-[-0.02em]">Here's what I recommend</h1>
        <span className="text-[16px] text-muted">For {words}. Connect the ones you use and skip the rest.</span>
      </div>
      <div className="mt-6 flex w-full max-w-[660px] flex-col">
        <span className="px-1 pb-2 text-[13px] font-semibold text-muted">Apps</span>
        <div className="rounded-[18px] bg-panel py-1 shadow-[inset_0_0_0_1px_var(--line2)]">
          {apps.map((id, i) => {
            const app = SETUP_APPS[id];
            const logo = brandLogo(id, app?.name);
            const state = conn[id] ?? "idle";
            const opt = opts?.[id];
            const canSignIn = !opts || !!opt?.signIn;
            return (
              <div key={id} className={cx("flex min-h-16 items-center gap-3.5 px-4 py-2.5", i > 0 && "shadow-[inset_0_1px_0_var(--line)]")}>
                {logo ? <BrandTile logo={logo} size={40} /> : <span className="size-10 rounded-xl bg-card" />}
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="text-[16px] font-semibold">{app?.name ?? id}</span>
                  <span className="text-[13px] text-muted">{typeof state === "object" ? state.error : !canSignIn ? (opt?.key ? "Needs a key. Add it from Apps anytime." : (opt?.reason ?? "Add it from Apps anytime.")) : app?.why}</span>
                </span>
                {state === "on" ? (
                  <span className="m-pop flex items-center gap-1.5 text-[14px] font-semibold text-ok">
                    <Check size={16} strokeWidth={2.6} aria-hidden />
                    Connected
                  </span>
                ) : state === "out" ? (
                  <span className="flex items-center gap-2 text-[13px] text-muted">
                    <Loader2 size={16} className="animate-spin" aria-hidden />
                    Finish in your browser
                  </span>
                ) : canSignIn ? (
                  <button type="button" onClick={() => void connect(id)} className="h-[34px] shrink-0 rounded-full bg-ink px-3.5 text-[14px] font-semibold text-panel outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
                    {typeof state === "object" ? "Try again" : "Connect"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-6 flex w-full max-w-[660px] flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[13px] text-muted">Sign-ins open the app's own page, through your password manager.</span>
        <button
          type="button"
          onClick={() => {
            const on = apps.filter((a) => conn[a] === "on");
            onNext(names(on), names(apps.filter((a) => !on.includes(a))));
          }}
          className={cx(pill, "sm:w-[200px]")}
        >
          Next
        </button>
      </div>
    </BubbleStage>
  );
}
