import type { Routine } from "@bubble-ai/core";
import { api } from "./api.ts";
import { setFeatures } from "./features.ts";
import { useStore } from "./store.ts";
import { loadAnswers, saveAnswers } from "./onboardingV3.ts";
import { recommendedSetup } from "./onboardingPlan.ts";

/**
 * The one thing setup offers to turn on for a new agent: a morning routine built from what it does
 * and what Bubble AI learned about the person's work. Nothing is switched on by itself any more: it is a
 * row on "Finish setup" with Turn on, and Undo once it is on. Null when there's nothing to build it from.
 */
export function morningPlan(workspaceId: string, person: string, role: string) {
  return recommendedSetup(person, role, loadAnswers(workspaceId).facts ?? []).routine;
}

/** Turn the morning plan on: routines (a workspace switch only an owner can flip), then the routine itself. */
export async function turnOnMorningPlan(workspaceId: string, agentId: string, person: string, role: string): Promise<Routine | null> {
  const plan = morningPlan(workspaceId, person, role);
  if (!plan) return null;
  const st = useStore.getState();
  if (st.me?.role === "owner") await setFeatures({ routines: true }).catch(() => undefined);
  const channelId = st.channels.find((c) => c.kind === "dm" && c.name.endsWith(`:${agentId}`))?.id ?? null;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const routine = await api<Routine>("POST", "/api/routines", { agentId, name: plan.name, steps: plan.steps, schedule: plan.schedule, timezone, channelId });
  saveAnswers(workspaceId, { setupDone: true });
  return routine;
}
