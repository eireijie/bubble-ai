import { BUBBLE_COLORS } from "@bubble-ai/core/src/appearance.ts";
import { stepNeedsAgent, type TeamTemplate } from "@bubble-ai/core";
import { AGENT_TYPES, START_APPS, type AgentType } from "./onboarding/agentTypes.ts";

/**
 * What the Marketplace's Agents and Teams (round 12) show, apart from how: the agent templates, who
 * is on each team template with a one-line job, and what a search finds. No DOM here, so tests
 * can read it.
 */

/** Every typed word is somewhere in these fields. */
const matchWords = (words: string[], fields: (string | null | undefined)[]) => words.every((w) => fields.some((f) => f?.toLowerCase().includes(w)));

/** The agent templates, less "Something else" (that one is New agent itself). */
export const AGENT_TEMPLATES: AgentType[] = AGENT_TYPES.filter((t) => t.id !== "other");

const C = (name: string) => BUBBLE_COLORS.find((c) => c.name === name)!.hex;
/** One bubble colour per agent template, so the cards read apart at a glance. */
export const AGENT_TINT: Record<string, string> = { daily: C("Orange"), work: C("Blue"), code: C("Green"), biz: C("Amber"), research: C("Violet") };
/** The order a team's bubbles take their colours in. */
export const TEAM_TINTS = ["Violet", "Blue", "Green", "Orange", "Pink", "Amber"].map(C);

/** The one-line job of each role in the ready-made teams (their descriptions are what the agents read). */
const ROLE_JOBS: Record<string, Record<string, string>> = {
  "plan-challenge": { lead: "Plans and hands out the work", challenger: "Pushes back until the plan is right", backend: "Server, data and API", frontend: "The screens", reviewer: "Reads and tests every piece" },
  "build-review": { builder: "Builds it, with tests", reviewer: "Reviews every change", tester: "Tries it for real" },
  "research-desk": { researcher: "Digs into the question", checker: "Checks every claim", writer: "Writes it up" },
  "bug-squad": { reproducer: "Reproduces the bug", fixer: "Fixes the root cause", verifier: "Checks the fix holds" },
  "support-queue": { triage: "Sorts each request", responder: "Drafts the reply", checker: "Checks every draft" },
  "release-crew": { planner: "Plans the work", researcher: "Compares the options", builder: "Builds it" },
};

/** The first sentence of what an agent is told, as a job: "You build what's asked, with tests." → "Build what's asked, with tests". */
export function firstLine(text: string | undefined): string {
  const first = (text ?? "").trim().split(/(?<=[.!?])\s/)[0]?.replace(/[.!?]+$/, "") ?? "";
  const plain = first.replace(/^you\s+/i, "");
  // a long sentence keeps its first clause: "Read the builder's work as a skeptical senior engineer: correctness, …" → up to the colon
  const clause = plain.length > 40 ? plain.replace(/^(.{12,}?)[,:;—].*$/, "$1") : plain;
  const line = clause.charAt(0).toUpperCase() + clause.slice(1);
  return line.length > 64 ? `${line.slice(0, 63).trimEnd()}…` : line;
}

export type CastMember = { key: string; name: string; job: string; color: string };

/**
 * Who is on a team template, each with a one-line job. The ready-made ones by their roles; a saved
 * team (whose roles may be only the ones a hand-out uses) by its steps that need an agent.
 */
export function teamCast(t: Pick<TeamTemplate, "id" | "roles" | "steps">): CastMember[] {
  const jobs = ROLE_JOBS[t.id];
  const offset = [...t.id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % TEAM_TINTS.length;
  const tint = (i: number) => TEAM_TINTS[(jobs ? i : i + offset) % TEAM_TINTS.length];
  if (jobs && t.roles.length) return t.roles.map((r, i) => ({ key: r.id, name: r.name, job: jobs[r.id] ?? firstLine(r.description), color: tint(i) }));
  const seen = new Set<string>();
  const steps = t.steps.filter((s) => stepNeedsAgent(s) && !seen.has(s.action) && !!seen.add(s.action));
  if (!steps.length) return t.roles.map((r, i) => ({ key: r.id, name: r.name, job: firstLine(r.description), color: tint(i) }));
  return steps.map((s, i) => ({ key: s.id, name: s.action || "Step", job: firstLine(s.prompt ?? t.roles.find((r) => r.id === s.roleId)?.description), color: tint(i) }));
}

export const agentsWord = (n: number) => `${n} agent${n === 1 ? "" : "s"}`;

/** Does what was typed find this agent template? */
export const agentHit = (words: string[], t: AgentType) => matchWords(words, [t.name, t.sub, t.role, "agent", "template", ...t.apps.map((a) => START_APPS[a]?.name)]);
/** Does what was typed find this team template? */
export const teamHit = (words: string[], t: TeamTemplate) => matchWords(words, [t.name, t.blurb, "team", "template", ...t.roles.map((r) => r.name), ...t.steps.map((s) => s.action)]);

