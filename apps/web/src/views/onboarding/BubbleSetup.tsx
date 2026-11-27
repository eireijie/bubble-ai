import { Check, Loader2 } from "lucide-react";
import { cx } from "../../components/ui.tsx";
import { agentInstructions } from "../../onboardingV3.ts";
import { BubbleSlot } from "./Stage.tsx";
import { Bubble } from "../../components/Bubble.tsx";
import type { GhostAppearance } from "@bubble-ai/core";

/**
 * The first run's pages after "Your agent" (2026-11-26 canvas): How it starts (Simple or Advanced,
 * each shown as a small loop of what it's like), then for Advanced, Make it yours (2026-11-27,
 * round 7: what it should help with in the person's own words, anything it should know about them,
 * how it talks and when it checks in, with the message it would send them by name). On Continue the
 * picks go to the agent as the person's first message, and the agent suggests which apps to connect
 * (hub setup-picks.ts); there is no Connect page any more.
 * They sit on the one Stage (Stage.tsx); the bubble above each is the stage's own.
 */

export type SetupPath = "advanced" | "simple";

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
            <span className="chip c1">My days</span>
            <span className="chip c2">Messages</span>
            <span className="chip c3">Trips</span>
            <span className="chip r1">Calendar ✓</span>
            <span className="chip r2">Gmail ✓</span>
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

export interface SetupGoal {
  id: string;
  /** in the person's own words, as they'd say it */
  label: string;
  /** the same, as it reads after "I'd like help with:" */
  want: string;
  /** a 24×24 line-icon path */
  icon: string;
  /** what it would tell you, for the sample message */
  say: string;
}

export const SETUP_GOALS: SetupGoal[] = [
  { id: "days", label: "Keep my days on track", want: "keeping my days on track", icon: "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4", say: "the dentist is at 10, so I moved the gym to 6" },
  { id: "msgs", label: "Stay on top of my messages", want: "staying on top of my messages", icon: "M4 6h16v12H4zM4 7l8 6 8-6", say: "your landlord replied, and Friday works for him" },
  { id: "people", label: "Remember the people I care about", want: "remembering the people I care about", icon: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z", say: "it's your mom's birthday Saturday. Want me to find a gift?" },
  { id: "plans", label: "Plan trips and weekends", want: "planning trips and weekends", icon: "M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", say: "flights to Chicago for the 14th dropped to $142" },
  { id: "money", label: "Keep an eye on money and bills", want: "keeping an eye on money and bills", icon: "M3 7h18v12H3zM3 11h18M16 15h2", say: "your phone bill ($64) is due Thursday" },
  { id: "health", label: "Help me stay healthy", want: "staying healthy", icon: "M3 12h4l3-7 4 14 3-7h4", say: "you've slept under 6 hours three nights running. Earlier night tonight?" },
  { id: "business", label: "Help run my business", want: "running my business", icon: "M4 9l1-5h14l1 5M4 9v11h16V9M4 9h16M9 20v-6h6v6", say: "2 customers wrote in overnight and 4 orders are ready to ship" },
  { id: "learn", label: "Help me learn and build things", want: "learning and building things", icon: "M4 5h7a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-7", say: "I found 5 good sources on what you asked. Short answer: yes" },
];

export type Talk = "short" | "friendly" | "thorough";
export type CheckIn = "morning" | "evening" | "needed";
const TALK: { id: Talk; label: string }[] = [
  { id: "short", label: "Short" },
  { id: "friendly", label: "Friendly" },
  { id: "thorough", label: "Thorough" },
];
const WHEN: { id: CheckIn; label: string }[] = [
  { id: "morning", label: "Each morning" },
  { id: "evening", label: "Each evening" },
  { id: "needed", label: "Only when it matters" },
];

/** The person's first name, for the title and the sample message. */
export const firstName = (person: string) => person.trim().split(/\s+/)[0] ?? "";

const picked = (goals: readonly string[]) => SETUP_GOALS.filter((g) => goals.includes(g.id));
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** a full stop, unless it already ends with one ("…find a gift?") */
const stop = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

/** The message it would send you, from what's picked and who you are: the preview on Make it yours. */
export function sampleMessage(goals: readonly string[], talk: Talk, when: CheckIn, about: string, person: string): string {
  const first = firstName(person);
  const hi = when === "morning" ? `Morning${first ? `, ${first}` : ""}!` : when === "evening" ? `Evening${first ? `, ${first}` : ""}.` : `Hey${first ? ` ${first}` : ""},`;
  const news = picked(goals);
  if (!news.length) return `${hi} Tell me what's on your mind and I'll take it from there.`;
  // a new sentence after "Morning, Yug!", not after "Hey Yug,"
  const lead = stop(hi.endsWith(",") ? news[0].say : sentence(news[0].say));
  const also = news[1] ? ` Also, ${stop(news[1].say)}` : "";
  const known = about.trim().replace(/[.\s]+$/, "");
  const nod = known ? ` (I'll keep in mind: ${known}.)` : "";
  if (talk === "short") return `${hi} ${lead}`;
  if (talk === "friendly") return `${hi} ${lead}${also}${nod}`;
  return `${hi} ${lead}${also} I've already drafted what I can; say go and I'll handle it.${nod}`;
}

/** What goes to the agent as the person's first message: their picks and what they wrote, in plain words. */
export function picksMessage(goals: readonly string[], about: string): string {
  const want = picked(goals).map((g) => g.want);
  const known = about.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
  return [want.length ? `I'd like help with: ${andList(want)}.` : "I'm not sure yet what I'd like help with.", known ? `About me: ${known}.` : ""].filter(Boolean).join(" ");
}

/** The agent's instructions from Make it yours: the usual start, what it helps with, about the person, how it talks, when it checks in. */
export function yoursInstructions(name: string, person: string, goals: readonly string[], talk: Talk, when: CheckIn, about = ""): string {
  const who = firstName(person) || "them";
  const base = agentInstructions(name, person, "", [], picked(goals).map((g) => g.want).join(", "));
  const known = about.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "").slice(0, 500);
  const me = known ? `About ${who}, in their words: "${known}."` : "";
  const style = { short: "Keep messages short: one or two lines.", friendly: "Be warm and friendly, with enough detail to act on.", thorough: "Give full detail, and say what you've already done." }[talk];
  const check = { morning: `Each morning, message ${who} with what needs them.`, evening: `Each evening, message ${who} with what happened and what needs them.`, needed: `Only message ${who} when something matters.` }[when];
  return [base, me, style, check].filter(Boolean).join(" ");
}

export function YoursStep({ look, seed, name, person, goals, onGoals, about, onAbout, talk, onTalk, when, onWhen, onNext, busy }: { name: string; person: string; goals: string[]; onGoals: (g: string[]) => void; about: string; onAbout: (a: string) => void; talk: Talk; onTalk: (t: Talk) => void; when: CheckIn; onWhen: (w: CheckIn) => void; onNext: () => void; busy?: boolean; look?: Pick<GhostAppearance, "color" | "color2" | "bubble">; seed?: string }) {
  const msg = sampleMessage(goals, talk, when, about, person);
  const first = firstName(person);
  return (
    <div className="flex w-full max-w-[608px] flex-col items-center">
      <BubbleSlot size={64} />
      <h1 className="ob-title mt-3.5">
        What should {name} help with{first ? `, ${first}` : ""}?
      </h1>
      <p className="ob-sub !mt-1 !text-[14px]">Pick anything. You can change it later by just telling {name}.</p>
      <div className="mt-[22px] grid w-full grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Helps with" role="group">
        {SETUP_GOALS.map((g) => {
          const on = goals.includes(g.id);
          return (
            <button key={g.id} type="button" aria-pressed={on} onClick={() => onGoals(on ? goals.filter((x) => x !== g.id) : [...goals, g.id])} className="ob-tile flex h-[46px] items-center gap-2 px-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 opacity-85">
                <path d={g.icon} />
              </svg>
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{g.label}</span>
              <span aria-hidden className={cx("grid size-[18px] shrink-0 place-items-center rounded-full text-white transition-[background-color,opacity] duration-200", on ? "bg-wisp opacity-100" : "opacity-0")}>
                <Check size={11} strokeWidth={3.2} />
              </span>
            </button>
          );
        })}
      </div>
      <input
        value={about}
        onChange={(e) => onAbout(e.target.value)}
        maxLength={300}
        aria-label={`Anything ${name} should know about you?`}
        placeholder={`Anything ${name} should know about you? (I'm a student, I work weekends, I love hiking…)`}
        className="ob-field mt-4 !h-11 w-full !rounded-xl !px-3.5"
      />
      <div className="mt-4 flex w-full flex-col gap-2.5">
        <Seg label={`${name} talks`} value={talk} options={TALK} onPick={onTalk} />
        <Seg label="Checks in" value={when} options={WHEN} onPick={onWhen} />
      </div>
      {/* what it would actually send, changing as you pick */}
      <div className="mt-5 flex w-full items-end gap-2.5" aria-live="polite">
        <Bubble look={look} seed={seed} size={30} label="" follow={false} />
        <div key={msg} className="bubble them tail m-pop max-w-[560px] text-[15px]">
          {msg}
        </div>
      </div>
      <button type="button" onClick={onNext} disabled={busy} className="ob-primary mt-[22px] w-full max-w-[280px]">
        {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
        Continue
      </button>
    </div>
  );
}

function Seg<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: { id: T; label: string }[]; onPick: (v: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <span className="w-24 shrink-0 truncate text-[13px] text-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="ob-seg ob-seg-fill">
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onPick(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
