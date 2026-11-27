/**
 * One agent's chat background: none (null), a photo, or a colour. Saved on the agent as
 * `settings.background`.
 *
 * Minimal stand-in with the same exports as the chat-glass lane's version: until the hub accepts
 * `settings.background`, a rejected save is kept in this browser instead so the choice still sticks.
 * Replaced when the two lanes merge.
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "./api.ts";
import { useStore } from "./store.ts";

export type ChatBackground = { kind: "photo"; fileId: string } | { kind: "color"; color: string };

const LOCAL = "bubble.agent-background";
const CHANGED = "bubble:agent-background";

function readLocal(): Record<string, ChatBackground> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL) ?? "{}") as Record<string, ChatBackground>;
  } catch {
    return {};
  }
}

function writeLocal(agentId: string, bg: ChatBackground | null) {
  const all = readLocal();
  if (bg) all[agentId] = bg;
  else delete all[agentId];
  localStorage.setItem(LOCAL, JSON.stringify(all));
  window.dispatchEvent(new Event(CHANGED));
}

/** This agent's chat background, or null for none. */
export function useChatBackground(agentId: string): ChatBackground | null {
  const saved = useStore((s) => (s.agents.find((a) => a.id === agentId)?.settings as { background?: ChatBackground | null } | undefined)?.background);
  const [local, setLocal] = useState(() => readLocal()[agentId] ?? null);
  useEffect(() => {
    const sync = () => setLocal(readLocal()[agentId] ?? null);
    sync();
    window.addEventListener(CHANGED, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGED, sync);
      window.removeEventListener("storage", sync);
    };
  }, [agentId]);
  return saved !== undefined ? saved : local;
}

/** Set (or clear, with null) this agent's chat background. */
export async function setAgentBackground(agentId: string, bg: ChatBackground | null): Promise<void> {
  try {
    await api("PATCH", `/api/agents/${agentId}`, { settings: { background: bg } });
    writeLocal(agentId, null);
    await useStore.getState().refreshAgents();
  } catch (e) {
    // The hub doesn't take `settings.background` yet (400): keep it here. Anything else is a real failure.
    if (!(e instanceof ApiError) || e.status !== 400) throw e;
    writeLocal(agentId, bg);
  }
}
