import { create } from "zustand";
import type { LearnProgress } from "@bubble-ai/core";
import { useStore } from "../../store.ts";
import { parseRoute } from "../../router.ts";
import { cleanSeen, resumeIndex, stopsFor, withSeen } from "../../tour.ts";

/**
 * Whether Show me around is running, and on which stop. Nothing runs while it isn't: the overlay
 * renders nothing and adds no listeners, timers or animation frames until `start()`.
 */
export interface TourRun {
  /** index into stopsFor(guest) */
  i: number;
  /** past the last stop: the "That's Bubble AI" card */
  end: boolean;
  /** the chat the tour came from, where chat stops happen */
  homeChannel: string | null;
  /** the agent whose bubble flies the tour */
  agentId: string | null;
}

export const useTour = create<{ run: TourRun | null }>(() => ({ run: null }));

export function learnProgress(): LearnProgress | undefined {
  return useStore.getState().me?.prefs.learn;
}

function guest() {
  return useStore.getState().me?.role === "guest";
}

/** The chat the tour belongs to: the open one when it's a chat, else the newest chat with an agent. */
function homeChat(): { channelId: string | null; agentId: string | null } {
  const s = useStore.getState();
  const r = parseRoute(location.hash);
  const dmAgent = (channelId: string) => {
    const c = s.channels.find((x) => x.id === channelId);
    if (!c || c.kind !== "dm") return null;
    const id = c.name.split(":").pop()!;
    return s.agents.some((a) => a.id === id) ? id : null;
  };
  if (r.view === "chat" && r.channelId && s.channels.some((c) => c.id === r.channelId)) return { channelId: r.channelId, agentId: dmAgent(r.channelId) ?? s.agents[0]?.id ?? null };
  const dms = s.channels.filter((c) => c.kind === "dm" && !c.archivedAt && dmAgent(c.id));
  const newest = [...dms].sort((a, b) => Date.parse(b.last?.at ?? b.createdAt) - Date.parse(a.last?.at ?? a.createdAt))[0];
  if (newest) return { channelId: newest.id, agentId: dmAgent(newest.id) };
  const any = s.channels.find((c) => !c.archivedAt);
  return { channelId: any?.id ?? null, agentId: s.agents[0]?.id ?? null };
}

/** Start at a stop, or where the person left off. */
export function startTour(at?: number) {
  const stops = stopsFor(guest());
  const i = at ?? resumeIndex(learnProgress(), stops);
  const home = homeChat();
  useTour.setState({ run: { i: Math.max(0, Math.min(stops.length - 1, i)), end: false, homeChannel: home.channelId, agentId: home.agentId } });
  const p = learnProgress();
  if (!p?.started) void useStore.getState().setPrefs({ learn: { seen: cleanSeen(p?.seen), started: true } }).catch(() => {});
}

export function stopTour() {
  useTour.setState({ run: null });
}

export function goStop(i: number) {
  const run = useTour.getState().run;
  if (!run) return;
  const n = stopsFor(guest()).length;
  // past the last stop it just ends: no closing card to dismiss
  if (i >= n) useTour.setState({ run: null });
  else useTour.setState({ run: { ...run, i: Math.max(0, i), end: false } });
}

/** Saved on the hub with the person's other preferences, so every device shows the same progress. */
export function markSeen(id: string) {
  const p = learnProgress();
  const next = withSeen(p, id);
  if (next !== p) void useStore.getState().setPrefs({ learn: next }).catch(() => {});
}
