import { api } from "./api.ts";
import { setFeatures } from "./features.ts";
import { useStore } from "./store.ts";
import { loadAnswers, saveAnswers, type AgentDraft } from "./onboardingV3.ts";
import { recommendedSetup } from "./onboardingPlan.ts";

/**
 * What onboarding switches on by itself once the agent exists (Its AI → Continue), each shown on
 * "Here's your Wisp" with Undo: calls and routines (owners only; they're workspace switches), and
 * one morning routine built from "What I do" and what page 3 learned, only when there's something
 * to build it from. The shared computer is already where Simple puts a new agent. Runs once.
 */
export async function switchOnRecommended(workspaceId: string, agentId: string, person: string): Promise<void> {
  const answers = loadAnswers(workspaceId);
  if (answers.setupDone) return;
  const st = useStore.getState();
  const owner = st.me?.role === "owner";
  const draft: AgentDraft | undefined = answers.agentDraft;
  const plan = recommendedSetup(person, draft?.role ?? "", answers.facts ?? []);
  if (owner && plan.routine) await setFeatures({ routines: true }).catch(() => undefined);
  if (plan.routine) {
    const channelId = st.channels.find((c) => c.kind === "dm" && c.name.endsWith(`:${agentId}`))?.id ?? null;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    await api("POST", "/api/routines", { agentId, name: plan.routine.name, steps: plan.routine.steps, schedule: plan.routine.schedule, timezone, channelId }).catch(() => undefined);
  }
  saveAnswers(workspaceId, { setupDone: true });
}
