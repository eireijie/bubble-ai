import { useState } from "react";
import type { Agent } from "@bubble-ai/core";
import { completeSetupStep, setDismissed, setReadyItem, stepsFinished, type StepId } from "../onboarding.ts";
import { usableDevices, useDevices } from "../devices.ts";
import { useStore } from "../store.ts";
import { go } from "../router.ts";
import { openDm } from "../openDm.ts";
import { loadAnswers, saveAnswers } from "../onboardingV3.ts";
import { AgentStep } from "./onboarding/AgentStep.tsx";
import { Ghost } from "../components/Ghost.tsx";
import { AIStep } from "./onboarding/AIStep.tsx";
import { GoalsStep, RecsStep, type SetupPath } from "./onboarding/BubbleSetup.tsx";
import { startSetupTour, type SetupTourState } from "../components/onboarding/SetupTour.tsx";
export { askableOn, makeFirstAgent, NO_NODE } from "./onboarding/firstAgent.ts";

/** The first run's screens after the account ("You", which AuthScreen shows before anyone is signed in). */
export type WelcomeScreen = "agent" | "ai" | "goals" | "recs";

/**
 * The agent this first run is about: the one it made (remembered in this browser), else, coming
 * back from somewhere else, the oldest one this person made. None yet: "Your agent" makes it.
 */
export function firstRunAgent<A extends Pick<Agent, "id" | "createdAt" | "settings">>(savedId: string | null | undefined, agents: readonly A[], userId: string): A | undefined {
  // one it made and that has since been removed is not replaced by another: "Your agent" makes a new one
  if (savedId) return agents.find((a) => a.id === savedId);
  return agents.filter((a) => a.settings.createdBy === userId).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
}

/**
 * Which screen shows. "Its AI" only ever shows for an agent that exists: with none, whatever was
 * asked for, it is "Your agent". A new setup and "See the welcome again" (`intro`) start there too.
 */
export function welcomeScreen(wanted: WelcomeScreen | null, o: { intro?: boolean; hasAgent: boolean }): WelcomeScreen {
  if (!o.hasAgent) return "agent";
  return wanted ?? (o.intro ? "agent" : "ai");
}

/** What ending the first run marks done: everything once the agent exists; never the agent step without one. */
export function finishedSteps(hasAgent: boolean): StepId[] {
  return hasAgent ? ["anywhere", "address", ...stepsFinished(true)] : [];
}

/**
 * The first run after the account: your agent, then its AI, then its chat. The agent is made when
 * "Your agent" is continued, so it exists whatever happens on "Its AI". Everything else setup used
 * to ask (phone, apps, away from home, getting to know you) is asked in that chat, and listed on
 * "Finish setup".
 */
export function WelcomeView({ intro }: { intro?: boolean }) {
  const me = useStore((s) => s.me)!;
  const agents = useStore((s) => s.agents);
  const devices = useDevices(3000);
  const ws = me.workspace.id;
  const usable = usableDevices(devices ?? []).filter((d) => d.online && !d.paused);
  const device = usable.find((d) => d.mine) ?? usable[0];
  const [agentId, setAgentId] = useState<string | null>(() => loadAnswers(ws).agentId ?? null);
  const agent = firstRunAgent(agentId, agents, me.user.id);
  const [wanted, setWanted] = useState<WelcomeScreen | null>(null);
  const screen = welcomeScreen(wanted, { intro, hasAgent: !!agent });

  const finish = (channelId: string | null) => {
    for (const step of finishedSteps(!!agent)) completeSetupStep(ws, step);
    // what's left (phone, apps, away from home, getting to know you) stays under "Finish setup"
    if (agent) setReadyItem(ws, "started", true);
    setDismissed(true);
    if (channelId) go({ view: "chat", channelId, threadId: null });
    else if (agent) void openDm(agent.id).catch(() => go({ view: "dashboard" }));
    else go({ view: "dashboard" });
  };

  const [path, setPathState] = useState<SetupPath>(() => loadAnswers(ws).path ?? "advanced");
  const setPath = (p: SetupPath) => (setPathState(p), saveAnswers(ws, { path: p }));
  const [goals, setGoalsState] = useState<string[]>(() => loadAnswers(ws).setupGoals ?? ["inbox", "cal"]);
  const setGoals = (g: string[]) => (setGoalsState(g), saveAnswers(ws, { setupGoals: g }));
  // the chat the AI step opened, kept while Advanced asks its goals and apps
  const [chatId, setChatId] = useState<string | null>(null);
  const toChat = (tour: Omit<SetupTourState, "agentId">) => {
    if (agent) startSetupTour({ agentId: agent.id, ...tour });
    finish(chatId);
  };

  const top = agent ? <Ghost look={agent.settings.appearance} seed={agent.id} size={72} label="" ambient /> : null;
  if (screen === "goals" && agent) return <GoalsStep bubble={top} name={agent.name} picked={goals} onPicked={setGoals} onBack={() => setWanted("ai")} onNext={() => setWanted("recs")} />;
  if (screen === "recs" && agent) return <RecsStep bubble={top} goals={goals} onBack={() => setWanted("goals")} onNext={(on, off) => toChat({ path: "advanced", on, off })} />;
  if (screen === "ai" && agent)
    return (
      <AIStep
        key={agent.id}
        agentId={agent.id}
        device={device}
        onBack={() => setWanted("agent")}
        onDone={(channelId) => {
          setChatId(channelId);
          if (path === "advanced") setWanted("goals");
          else {
            startSetupTour({ agentId: agent.id, path: "simple", on: [], off: [] });
            finish(channelId);
          }
        }}
      />
    );
  return (
    <AgentStep
      workspaceId={ws}
      person={me.user.name}
      device={device}
      existing={agent}
      onContinue={(id) => {
        saveAnswers(ws, { agentId: id });
        setAgentId(id);
        setWanted("ai");
      }}
      // only offered after the hub wouldn't make the agent: leave, with the agent step still open
      onLeave={() => finish(null)}
      path={path}
      onPath={setPath}
    />
  );
}
