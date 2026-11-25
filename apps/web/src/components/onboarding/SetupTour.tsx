import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Agent } from "@wisp/core";
import { useStore } from "../../store.ts";
import { andList } from "../../views/onboarding/BubbleSetup.tsx";
import { Ghost } from "../Ghost.tsx";
import { cx } from "../ui.tsx";
import { Plug } from "lucide-react";
import { api } from "../../api.ts";
import { SuggestionBanner } from "../SuggestionBanner.tsx";

/**
 * Right after the first run (2026-11-25 "Wisp, bubbles", board 6), in the new agent's chat.
 * Advanced: the agent says what got done ("Great! I can see all that you've done.", which apps are
 * connected and which are still off) and offers a one-minute tour: six stops (Chat, Approvals,
 * Computers, Memory vault, Teams, Settings), each a spotlight on the real thing with a short note,
 * skippable at any point. Simple: one quiet line that apps can be added anytime. It all goes away
 * once the person writes their first message. Nothing here is sent or stored in the hub.
 */

export interface SetupTourState {
  agentId: string;
  path: "advanced" | "simple";
  /** apps connected during setup, and the ones it recommended that are still off (names) */
  on: string[];
  off: string[];
  stage?: "ask" | "tour" | "done";
  at?: number;
  /** the Connect banner was closed or used */
  bannerGone?: boolean;
}

const KEY = "wisp.setupTour";
const FRESH_MS = 3 * 86_400_000;

function load(): SetupTourState | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as SetupTourState | null;
    return s && Date.now() - (s.at ?? 0) < FRESH_MS ? s : null;
  } catch {
    return null;
  }
}
function save(s: SetupTourState | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {}
}

/** The first run calls this just before it opens the chat. */
export function startSetupTour(s: SetupTourState) {
  save({ ...s, stage: "ask", at: Date.now() });
}

/** The six stops. `target` is a [data-tour] on the real element; a stop whose target isn't on the page (phones) is left out. */
export const TOUR = [
  { target: "composer", title: "Chat", body: "Tell me what to do in plain words. I do the work and report back here." },
  { target: "approval", title: "Approvals", body: "Before I send, buy or delete anything, I ask. Allow or Not now." },
  { target: "computers", title: "Computers", body: "I work on my own computer. Click here to watch live or take over." },
  { target: "vault", title: "Memory vault", body: "What I learn about you lives here as notes you can read and edit." },
  { target: "new", title: "Teams", body: "Put agents together on one job. Start a team from +." },
  { target: "you", title: "Settings", body: "Click your name for Settings: account, agents and computers." },
] as const;

/** The stop's element; a wrapper that only marks it (display: contents) stands for its child. */
function find(t: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${t}"]`);
  return el && getComputedStyle(el).display === "contents" ? ((el.firstElementChild as HTMLElement | null) ?? null) : el;
}

export function SetupTour({ agent, channelId }: { agent: Agent; channelId: string }) {
  const [state, setState] = useState(load);
  const [step, setStep] = useState(0);
  const messages = useStore((s) => s.messages[channelId]);
  const set = (next: SetupTourState | null) => (save(next), setState(next));
  // their first message ends it
  const spoke = !!state?.at && !!messages?.some((m) => m.author.kind === "user" && Date.parse(m.createdAt) > state.at!);
  useEffect(() => {
    if (spoke) set(null);
  }, [spoke]);
  if (!state || state.agentId !== agent.id || spoke) return null;

  const stops = TOUR.filter((t) => t.target === "approval" || !!find(t.target));
  const stop = stops[Math.min(step, stops.length - 1)];
  const touring = state.stage === "tour";
  const name = agent.name;

  if (state.path === "simple")
    return (
      <div className="px-4 pb-3 text-center text-[13px] text-muted m-pop">
        No apps yet.
        <br />
        Ask {name} to add any, anytime.
      </div>
    );

  // only true things: "Great!" when something was connected, a plain line when nothing was
  const opening = state.on.length ? ["Great! I can see all that you've done.", `${andList(state.on)} ${state.on.length > 1 ? "are" : "is"} connected.`] : ["No apps yet. That's fine, add them anytime."];
  const missing = state.off.length ? `${andList(state.off)} ${state.off.length > 1 ? "are" : "is"} still off. Say the word and I'll connect ${state.off.length > 1 ? "them" : "it"}.` : null;
  const end = () => (set({ ...state, stage: "done" }), setStep(0));

  return (
    // the same column and side as the agent's own messages, each group ending in a tail
    <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-[3px] px-3 pb-3 md:max-w-[840px] md:px-5" aria-live="polite">
      {!(touring && stop?.target === "approval") && (
        <>
          {[...opening, ...(missing && state.bannerGone ? [missing] : [])].map((line, i, all) => (
            <div key={line} className={cx("bubble them m-pop text-[15px] md:text-[16px]", i === all.length - 1 && "tail")}>
              {line}
            </div>
          ))}
          {state.off.length > 0 && !state.bannerGone && (
            <SuggestionBanner
              label="Connect apps"
              icon={<Plug size={17} strokeWidth={1.8} />}
              text={`${andList(state.off)} ${state.off.length > 1 ? "are" : "is"} still off.`}
              action={state.off.length > 1 ? "Connect them" : `Connect ${state.off[0]}`}
              onAction={() => {
                set({ ...state, bannerGone: true });
                // the agent does the connecting: it asks for what it needs and sends the sign-ins
                void api("POST", `/api/channels/${channelId}/messages`, { body: `Please connect ${andList(state.off)}.` });
              }}
              onClose={() => set({ ...state, bannerGone: true })}
            />
          )}
        </>
      )}
      {state.stage === "ask" && (
        <>
          <div className="bubble them tail m-pop mt-1.5 text-[15px] md:text-[16px]">Want a quick tour? About a minute.</div>
          <div className="mt-2.5 flex gap-2">
            <button type="button" onClick={() => (set({ ...state, stage: "tour" }), setStep(0))} className="h-[34px] rounded-full bg-ink px-3.5 text-[14px] font-semibold text-panel outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
              Show me
            </button>
            <button type="button" onClick={end} className="h-[34px] rounded-full bg-card px-3.5 text-[14px] text-ink outline-none hover:bg-hover focus-visible:ring-3 focus-visible:ring-ring/40">
              Skip
            </button>
          </div>
        </>
      )}
      {touring && stop?.target === "approval" && (
        <div data-tour="approval" className="mt-3 flex w-[min(380px,100%)] flex-col gap-1.5 rounded-[20px] bg-panel px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--line2)]">
          <span className="text-[15px] font-semibold">Send reply to Lena Park?</span>
          <span className="text-[14px] leading-5 text-muted">“Hi Lena, the 14th works. What time can we load in?”</span>
          <span className="mt-2 grid grid-cols-2 gap-2" aria-hidden>
            <span className="h-[38px] rounded-full bg-wisp text-center text-[15px] font-semibold leading-[38px] text-[#161616]">Allow</span>
            <span className="h-[38px] rounded-full bg-card text-center text-[15px] leading-[38px]">Not now</span>
          </span>
          <span className="text-[12px] text-faint">An example. Nothing was sent.</span>
        </div>
      )}
      {state.stage === "done" && <div className="bubble them tail m-pop mt-1.5 text-[15px] md:text-[16px]">That's the tour. What should I start on?</div>}
      {touring && stop && (
        <Spotlight
          key={stop.target}
          target={stop.target}
          title={stop.title}
          body={stop.body}
          count={`${step + 1} of ${stops.length}`}
          last={step >= stops.length - 1}
          look={agent.settings.appearance}
          seed={agent.id}
          onNext={() => (step >= stops.length - 1 ? end() : setStep(step + 1))}
          onSkip={end}
        />
      )}
    </div>
  );
}

/** The dimmed page with a hole round the stop's element, and the note beside it. */
function Spotlight({ target, title, body, count, last, look, seed, onNext, onSkip }: { target: string; title: string; body: string; count: string; last: boolean; look: Agent["settings"]["appearance"]; seed: string; onNext: () => void; onSkip: () => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = find(target);
      if (!el) return setRect(null);
      el.scrollIntoView({ block: "nearest" });
      setRect(el.getBoundingClientRect());
    };
    measure();
    const t = setTimeout(measure, 60);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, [target]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip();
      // Enter on a focused button already clicks it; handling it here too would skip a stop
      else if (e.key === "ArrowRight" || (e.key === "Enter" && !(e.target instanceof HTMLButtonElement))) onNext();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onNext, onSkip]);
  if (!rect) return null;
  const pad = 6;
  const hole = { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
  const W = 300;
  const H = 170;
  const below = hole.top + hole.height + 12 + H < window.innerHeight;
  const tipTop = below ? hole.top + hole.height + 12 : Math.max(12, hole.top - H - 12);
  const tipLeft = Math.max(12, Math.min(hole.left + hole.width / 2 - W / 2, window.innerWidth - W - 12));
  return createPortal(
    <div className="fixed inset-0 z-[95]" role="dialog" aria-modal="true" aria-label={`Tour: ${title}`}>
      <div className="absolute rounded-2xl transition-[left,top,width,height] duration-500 ease-[cubic-bezier(.2,.9,.3,1)] motion-reduce:transition-none" style={{ ...hole, boxShadow: "0 0 0 3px var(--wisp), 0 0 0 9999px rgba(0,0,0,.45)" }} />
      <div className="m-pop absolute flex flex-col gap-1.5 rounded-[18px] bg-panel p-4 pb-3 shadow-[0_18px_50px_rgba(0,0,0,.25)] dark:bg-[#1f1f1f]" style={{ left: tipLeft, top: tipTop, width: W }}>
        <span className="flex items-center gap-2">
          <Ghost look={look} seed={seed} size={24} label="" />
          <span className="text-[16px] font-[650]">{title}</span>
        </span>
        <span className="text-[14px] leading-5 text-muted">{body}</span>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="flex-1 text-[13px] text-muted">{count}</span>
          <button type="button" onClick={onSkip} className="h-[34px] rounded-full px-2.5 text-[14px] text-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/40">
            Skip tour
          </button>
          <button type="button" autoFocus onClick={onNext} className={cx("h-[34px] rounded-full bg-ink px-3.5 text-[14px] font-semibold text-panel outline-none focus-visible:ring-3 focus-visible:ring-ring/40")}>
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
