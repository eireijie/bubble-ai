import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Agent } from "@bubble-ai/core";
import { defaultAppearance } from "@bubble-ai/core/src/appearance.ts";
import { useStore } from "../store.ts";
import { agentMood } from "../ghostMood.ts";
import { Ghost, type GhostMood } from "./Ghost.tsx";
import { cx } from "./ui.tsx";

const MOOD_TEXT: Partial<Record<GhostMood, string>> = { working: "working", thinking: "thinking", waiting: "needs you", error: "having trouble", asleep: "asleep", done: "done", awake: "online" };

/**
 * Where an agent lives in its DM: a pill at the top of the conversation with its pet ghost, which
 * watches your cursor, gets busy while it works, waves for your OK, cheers when it's done and
 * dozes while its device is off. A quiet word beside its name says how it is (working, needs you,
 * asleep). Poke the ghost to play; click the rest to open the agent's panel.
 */
export function AgentPill({ agent, open, onClick }: { agent: Agent; open?: boolean; onClick: () => void }) {
  const base = useStore((s) => agentMood(agent, s.approvals, s.computers));
  // a short cheer when it finishes something
  const [done, setDone] = useState(false);
  const was = useRef(agent.status);
  useEffect(() => {
    const finished = was.current === "busy" && agent.status === "online";
    was.current = agent.status;
    if (!finished) return;
    setDone(true);
    const t = setTimeout(() => setDone(false), 1800);
    return () => clearTimeout(t);
  }, [agent.status]);
  const mood: GhostMood = done && base === "awake" ? "done" : base;
  const look = agent.settings?.appearance ?? defaultAppearance(agent.handle);
  const note = MOOD_TEXT[mood];
  return (
    <button
      onClick={onClick}
      aria-expanded={open}
      className="agent-pill group inline-flex max-w-full flex-col items-center gap-1 rounded-[12px] px-2 pt-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${agent.name}${note ? `, ${note}` : ""}. About ${agent.name}`}
    >
      {/* poking the bubble plays with it instead of opening the panel */}
      <span onClick={(e) => e.stopPropagation()} className="grid place-items-center">
        <Ghost look={look} size={44} mood={mood} interactive label={agent.name} seed={agent.handle} />
      </span>
      {/* the name in a small pill under it, with a chevron: it opens the details */}
      <span className={cx("inline-flex h-[24px] max-w-full items-center gap-1 rounded-[6px] pl-2.5 pr-1.5 text-[13px] transition-colors duration-150", open ? "bg-side-active" : "bg-[var(--bubble-them)] group-hover:bg-hover")}>
        <span className="truncate font-semibold">{agent.name}</span>
        {note && mood !== "awake" && (
          <span key={mood} className={cx("m-fade-in shrink-0", mood === "waiting" ? "text-st-needs" : mood === "error" ? "text-st-problem" : mood === "working" || mood === "thinking" ? "shimmer-text text-wisp-strong" : "text-muted")} aria-hidden>
            · {note}
          </span>
        )}
        <ChevronRight size={13} strokeWidth={2.2} className={cx("shrink-0 text-muted transition-transform duration-200", open && "rotate-90")} aria-hidden />
      </span>
    </button>
  );
}

const STATUS_LINE: Partial<Record<GhostMood, string>> = { working: "Working", thinking: "Thinking", waiting: "Needs you", error: "Having trouble", asleep: "Asleep", done: "Done", awake: "Online", listening: "Listening" };

/**
 * The chat header's middle (round 4, like Messages): the agent's bubble above a small glass capsule
 * with its name, a chevron and how it is right now. Clicking either opens the agent's profile; poking
 * the bubble plays with it. Teams pass their own avatar and line.
 */
export function ChatHead({ avatar, name, line, tone, open, onClick, label }: { avatar: React.ReactNode; name: string; line?: string | null; tone?: "needs" | "working" | "problem" | null; open?: boolean; onClick: () => void; label: string }) {
  return (
    <div className="chat-head flex min-w-0 flex-col items-center gap-1">
      {/* the bubble opens the profile too; the capsule is the button for keyboards and screen readers */}
      <span onClick={onClick} className="grid cursor-pointer place-items-center drop-shadow-[0_4px_10px_rgb(0_0_0/0.10)]">
        {avatar}
      </span>
      <button type="button" onClick={onClick} aria-expanded={open} aria-label={label} className={cx("lg-glass lg-press flex max-w-[min(18rem,60vw)] flex-col items-center rounded-[14px] px-3 py-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring", open && "is-on")}>
        <span className="flex min-w-0 max-w-full items-center gap-0.5 text-[13.5px] font-semibold leading-[18px]">
          <span className="truncate">{name}</span>
          <ChevronRight size={13} strokeWidth={2.4} className={cx("shrink-0 opacity-50 transition-transform duration-200", open && "rotate-90")} aria-hidden />
        </span>
        {line && <span key={line} className={cx("m-fade-in max-w-full truncate text-[11.5px] leading-[15px]", tone === "needs" ? "text-st-needs" : tone === "problem" ? "text-st-problem" : tone === "working" ? "shimmer-text text-wisp-strong" : "text-muted")}>{line}</span>}
      </button>
    </div>
  );
}

/** A DM's header middle: the agent's live bubble and how it is. */
export function AgentHead({ agent, open, onClick }: { agent: Agent; open?: boolean; onClick: () => void }) {
  const base = useStore((s) => agentMood(agent, s.approvals, s.computers));
  const look = agent.settings?.appearance ?? defaultAppearance(agent.handle);
  // the pill is just the name and › (round 11, board 10); the bubble's face shows how it is, and screen readers hear it
  const line = STATUS_LINE[base] ?? null;
  return (
    <ChatHead
      avatar={<Ghost look={look} size={46} mood={base} interactive label={agent.name} seed={agent.handle} />}
      name={agent.name}
      open={open}
      onClick={onClick}
      label={`${agent.name}${line ? `, ${line.toLowerCase()}` : ""}. Open ${agent.name}'s profile`}
    />
  );
}
