import { useEffect, useRef, useState } from "react";
import type { Agent } from "@wisp/core";
import { defaultAppearance } from "@wisp/core/src/appearance.ts";
import { useStore } from "../store.ts";
import { agentMood } from "../ghostMood.ts";
import { Ghost, type GhostMood } from "./Ghost.tsx";
import { cx } from "./ui.tsx";

const MOOD_TEXT: Partial<Record<GhostMood, string>> = { working: "working", thinking: "thinking", waiting: "needs you", error: "having trouble", asleep: "asleep", done: "done", awake: "online" };

/**
 * Where an agent lives in its DM: a pill at the top of the conversation with its pet ghost, which
 * watches your cursor, gets busy while it works, waves for your OK, cheers when it's done and
 * dozes while its device is off. Poke the ghost to play; click the rest to see the agent.
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
      className={cx(
        "agent-pill inline-flex items-center gap-[9px] h-10 pl-2 pr-4 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        open ? "bg-side-active" : "hover:bg-hover",
      )}
      aria-label={`${agent.name}${note ? `, ${note}` : ""}. About ${agent.name}`}
    >
      {/* poking the ghost plays with it instead of opening the panel */}
      <span onClick={(e) => e.stopPropagation()} className="grid place-items-center">
        <Ghost look={look} size={26} mood={mood} interactive label={agent.name} seed={agent.handle} />
      </span>
      <span className="font-semibold">{agent.name}</span>
      {note && <span className={cx("text-xs", mood === "waiting" ? "text-st-needs" : mood === "error" ? "text-st-problem" : "text-muted")}>{note}</span>}
    </button>
  );
}
