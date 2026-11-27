import { useEffect, useState } from "react";
import type { Agent } from "@bubble-ai/core";
import { useStore } from "../../store.ts";
import { andList } from "../../views/onboarding/BubbleSetup.tsx";
import { cx } from "../ui.tsx";
import { markSeen, startTour, useTour } from "../tour/tourRun.ts";
import { Plug } from "lucide-react";
import { api } from "../../api.ts";
import { SuggestionBanner } from "../SuggestionBanner.tsx";

/**
 * Right after the first run (2026-11-25 "Bubble AI, bubbles", board 6), in the new agent's chat.
 * Advanced: the agent says what got done ("Great! I can see all that you've done.", which apps are
 * connected and which are still off). Simple: one quiet line that apps can be added anytime. Then,
 * either way, Show me around starts on its own: four things to do for real, Skip tour any time
 * (components/tour), and once skipped it's gone. It all goes away once the person writes
 * their first message. Nothing here is sent to the hub; the tour's progress is (UserPrefs.learn).
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

export function SetupTour({ agent, channelId }: { agent: Agent; channelId: string }) {
  const [state, setState] = useState(load);
  const messages = useStore((s) => s.messages[channelId]);
  const set = (next: SetupTourState | null) => (save(next), setState(next));
  // their first message ends it
  const spoke = !!state?.at && !!messages?.some((m) => m.author.kind === "user" && Date.parse(m.createdAt) > state.at!);
  useEffect(() => {
    if (spoke) set(null);
  }, [spoke]);
  // Advanced: right after "Great!", the agent leaves the chat to show you around; when the tour
  // ends (or is skipped) it says it's ready. A tour already started (on another device) isn't repeated
  const running = useTour((s) => !!s.run);
  const learnStarted = useStore((s) => !!s.me?.prefs.learn?.started);
  const auto = !!state && state.agentId === agent.id && !spoke && state.stage === "ask";
  useEffect(() => {
    if (!auto) return;
    if (learnStarted) return void set({ ...state!, stage: "done" });
    // Make it yours already sent the first message (your picks), so "Say hi" is done: start after it
    const t = setTimeout(() => {
      const wrote = !!useStore.getState().messages[channelId]?.some((m) => m.author.kind === "user");
      set({ ...state!, stage: "tour" });
      if (wrote) markSeen("write");
      startTour(wrote ? 1 : 0);
    }, 1800);
    return () => clearTimeout(t);
  }, [auto]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (state?.stage === "tour" && !running && state.agentId === agent.id) set({ ...state, stage: "done" });
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!state || state.agentId !== agent.id || spoke) return null;
  const name = agent.name;

  if (state.path === "simple")
    return (
      <div className="px-4 pb-3 text-center text-[13px] text-muted m-pop">
        No apps yet.
        <br />
        Ask {name} to add any, anytime.
      </div>
    );

  // Make it yours sent the picks to the agent, and the agent answers with the apps it suggests: it speaks for itself here
  if (!state.on.length && !state.off.length) return null;

  // only true things: "Great!" when something was connected, a plain line when nothing was
  const opening = state.on.length ? ["Great! I can see all that you've done.", `${andList(state.on)} ${state.on.length > 1 ? "are" : "is"} connected.`] : ["No apps yet. That's fine, add them anytime."];
  const missing = state.off.length ? `${andList(state.off)} ${state.off.length > 1 ? "are" : "is"} still off. Say the word and I'll connect ${state.off.length > 1 ? "them" : "it"}.` : null;

  return (
    // the same column and side as the agent's own messages, each group ending in a tail
    <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-[3px] px-3 pb-3 md:max-w-[840px] md:px-5" aria-live="polite">
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
      {state.stage === "done" && <div className="bubble them tail m-pop mt-1.5 text-[15px] md:text-[16px]">What should I start on?</div>}
    </div>
  );
}
