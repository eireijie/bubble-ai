import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Agent, GhostShape } from "@wisp/core";
import type { GhostAppearance } from "@wisp/core/src/appearance.ts";
import { motionReduced } from "../../theme.ts";
import { FAMILY_COLORS } from "../../ghostFamily.ts";
import { useStore } from "../../store.ts";
import { unavailable } from "../../join.ts";
import { useConnections } from "../../models.ts";
import type { DeviceInfo } from "../../devices.ts";
import { agentInstructions, saveAnswers } from "../../onboardingV3.ts";
import { OB_EASE } from "../../components/onboarding/HostGhost.tsx";
import { Ghost } from "../../components/Ghost.tsx";
import { SetupLink, SetupProblem } from "../../components/SetupShell.tsx";
import { BubbleStage, PathChoice, type SetupPath } from "./BubbleSetup.tsx";
import { AGENT_TYPES } from "./agentTypes.ts";
import { lookOf, makeNamedAgent, renameNamedAgent, type AgentShape } from "./firstAgent.ts";
import { foundOn } from "./AIStep.tsx";

const SHAPES: GhostShape[] = ["classic", "round", "tall", "sheet", "wisp"];
const NAME_POOL = ["Juno", "Atlas", "Pip", "Nova", "Milo", "Iris", "Otto", "Wren", "Remy", "Luna"];
/** The hub keeps a role to this many characters. */
const ROLE_MAX = 60;

/** What an agent can be for, as suggestions inside the one field: "Keep my days on track", "Help with my code"… */
export const JOBS = AGENT_TYPES.filter((t) => t.role).map((t) => t.role.replace(/\.$/, ""));

/** A name to start with: the first of the pool that isn't the person's own or one of their agents'. */
export function suggestedName(person: string, taken: readonly string[] = []): string {
  const not = new Set([person.trim().split(/\s+/)[0] ?? "", ...taken].map((n) => n.toLowerCase()));
  return NAME_POOL.find((n) => !not.has(n.toLowerCase())) ?? NAME_POOL[0];
}

/** Another look, never the one it has: a new colour and shape from the first run's set; anything else it wears stays. */
export function nextLook(look: GhostAppearance, random: () => number = Math.random): GhostAppearance {
  const any = <T,>(xs: readonly T[], not: T) => {
    const rest = xs.filter((x) => x !== not);
    return rest[Math.floor(random() * rest.length)] ?? not;
  };
  return { ...look, color: any<string>(FAMILY_COLORS, look.color), color2: undefined, shape: any(SHAPES, look.shape), bubble: look.bubble ?? "round" };
}

/** What Continue saves: the agent's name, its one line, its look and the start of its instructions. */
export function shapeOf(name: string, role: string, look: GhostAppearance, person: string): AgentShape {
  const n = name.trim();
  const r = role.trim().slice(0, ROLE_MAX);
  return { name: n, role: r, appearance: look, instructions: agentInstructions(n, person, r, [], "") };
}

/**
 * "Your agent" → Continue. The agent exists when this resolves: made now (holding its hello until
 * its AI is chosen), or, when it was made on an earlier visit, renamed and re-dressed to match.
 * Returns its id; throws when the hub wouldn't make it, so nothing moves on without an agent.
 */
export async function saveNamedAgent(o: { workspaceId: string; existing: Pick<Agent, "id" | "name" | "handle" | "settings"> | undefined; shape: AgentShape; harness: string; device: DeviceInfo | undefined; agents: Pick<Agent, "id" | "handle">[] }): Promise<string> {
  const { existing, shape } = o;
  if (existing) {
    const same = existing.name === shape.name && (existing.settings.role ?? "") === shape.role && JSON.stringify(existing.settings.appearance ?? null) === JSON.stringify(shape.appearance);
    if (!same) await renameNamedAgent(existing, shape, o.agents);
    return existing.id;
  }
  const agent = await makeNamedAgent(shape, o.harness, o.device, o.agents);
  saveAnswers(o.workspaceId, { agentId: agent.id });
  return agent.id;
}

/**
 * The first run's second screen: your agent. Its ghost (click it for another look), its name and
 * the one line of what it does, each already filled in. Continue makes the agent.
 */
export function AgentStep({ workspaceId, person, device, existing, onContinue, onLeave, path, onPath }: { workspaceId: string; person: string; device: DeviceInfo | undefined; existing?: Pick<Agent, "id" | "name" | "handle" | "settings">; onContinue: (agentId: string) => void; onLeave?: () => void; path?: SetupPath; onPath?: (p: SetupPath) => void }) {
  const { connections } = useConnections();
  // the agent Continue made, kept even if the list of agents hasn't caught up: pressing Continue again never makes a second one
  const made = useRef<Pick<Agent, "id" | "name" | "handle" | "settings"> | null>(null);
  const [name, setName] = useState(() => existing?.name ?? suggestedName(person, useStore.getState().agents.map((a) => a.name)));
  const [role] = useState(() => existing?.settings.role ?? "");
  const [look, setLook] = useState<GhostAppearance>(() => existing?.settings.appearance ?? ({ ...lookOf(FAMILY_COLORS[0], "classic"), bubble: "round" }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // a new look morphs in (a quick shrink and twist back to rest), never a cut
  const morph = useRef<HTMLSpanElement>(null);
  const shown = useRef(look);
  useEffect(() => {
    if (shown.current === look) return;
    shown.current = look;
    const el = morph.current;
    if (!el || motionReduced() || typeof el.animate !== "function") return;
    el.animate([{ transform: "scale(0.86) rotate(-6deg)", opacity: 0.55 }, { transform: "none", opacity: 1 }], { duration: 300, easing: OB_EASE });
  }, [look]);

  const called = name.trim() || "your agent";
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const st = useStore.getState();
      const harness = foundOn(device, connections ?? [])?.harness ?? device?.harnesses?.[0]?.id ?? "claude-code";
      const shape = shapeOf(name, role, look, person);
      const id = await saveNamedAgent({ workspaceId, existing: existing ?? made.current ?? undefined, shape, harness, device, agents: st.agents });
      made.current = { id, name: shape.name, handle: (existing ?? made.current)?.handle ?? "", settings: { role: shape.role || undefined, appearance: shape.appearance } };
      await st.refreshAgents().catch(() => {});
      onContinue(id);
    } catch (e) {
      setError(unavailable(e, called));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BubbleStage>
      <form
        className="flex w-full flex-col items-center"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h1 className="sr-only">Your agent</h1>
        <button
          type="button"
          aria-label="Change its colour"
          className="mt-[max(0px,calc(18vh-60px))] rounded-full p-2 outline-none transition-transform active:scale-[.96] focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none"
          onClick={() => setLook((l) => nextLook(l))}
        >
          <span ref={morph} className="block">
            <Ghost look={look} size={190} label="" ambient />
          </span>
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          autoComplete="off"
          aria-label="Name"
          placeholder="Name"
          className="mt-4 w-full max-w-[400px] bg-transparent text-center text-[34px] font-bold leading-[42px] tracking-[-0.02em] text-ink outline-none placeholder:text-faint"
        />
        {onPath && <PathChoice name={name.trim()} path={path ?? "advanced"} onPath={onPath} />}
        <button type="submit" disabled={!name.trim() || busy} className="setup-press mt-8 inline-flex h-11 w-full max-w-[320px] items-center justify-center gap-2 rounded-full bg-ink px-[22px] text-[16px] font-semibold text-panel outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40">
          {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
          Continue
        </button>
        {/* the hub wouldn't make the agent: nobody is kept here, and the agent step stays open */}
        {error && onLeave && <SetupLink onClick={onLeave}>Not now</SetupLink>}
        <SetupProblem>{error}</SetupProblem>
      </form>
    </BubbleStage>
  );
}
