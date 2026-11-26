import { useState } from "react";
import { Check } from "lucide-react";
import { MIN_TEAM_AGENTS, teamSizeProblem, type ChannelTeam } from "@bubble-ai/core";
import { api } from "../api.ts";
import { go } from "../router.ts";
import { useStore } from "../store.ts";
import { AgentAvatar, Button, Modal, cx } from "../components/ui.tsx";
import { EMPTY_TEAM, addToTeam } from "../components/TeamChart.tsx";
import { TeamBuilder } from "./Builder.tsx";
import { emptyTeam, teamAgentIds, withChart } from "./flow.ts";

export const teamSlug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/** Shown wherever a team can't be made yet for want of agents. */
const NEEDS_AGENTS = `Pick at least ${MIN_TEAM_AGENTS} agents`;

/**
 * What Done makes of a new team. With steps on the chart, the steps. With none, the agents picked
 * by name become a plain team: the first one leads and hands work to the others. Null when there
 * is nothing to make yet.
 */
export function newTeamSettings(team: ChannelTeam, picked: string[]): ChannelTeam | null {
  if (team.steps?.length) return withChart({ ...team, roles: team.roles ?? [] });
  return picked.length >= MIN_TEAM_AGENTS ? picked.reduce((t, id) => addToTeam(t, id), EMPTY_TEAM) : null;
}

/** Why Done can't be pressed on a new team yet, or null when it can. */
export function newTeamProblem(team: ChannelTeam, picked: string[]): string | null {
  if (team.steps?.length) return teamSizeProblem(team) ? NEEDS_AGENTS : null;
  return picked.length >= MIN_TEAM_AGENTS ? null : "Add a step first";
}

/**
 * Making a team is one step: name it (and pick its agents), and it opens in the builder. Done
 * there creates it. Templates and "have an agent build it" are in the builder itself: the
 * Templates button and the field at the bottom.
 */
export function NewTeamFlow({ onClose, sectionId = null, initialName = "", initialAgents = [] }: { onClose: () => void; sectionId?: string | null; initialName?: string; initialAgents?: string[] }) {
  const channels = useStore((s) => s.channels).filter((c) => c.kind === "channel");
  const agents = useStore((s) => s.agents);
  const refreshChannels = useStore((s) => s.refreshChannels);
  const [page, setPage] = useState<"name" | "builder">("name");
  const [name, setName] = useState(initialName);
  const [picked, setPicked] = useState<string[]>(initialAgents);
  const [team, setTeam] = useState<ChannelTeam>(emptyTeam);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = teamSlug(name);
  const exists = channels.some((c) => c.name === id);
  const valid = !!id && !exists;

  async function create() {
    const settingsTeam = newTeamSettings(team, picked);
    if (busy || !settingsTeam) return;
    setError(null);
    setBusy(true);
    try {
      const ch = await api<{ id: string }>("POST", "/api/channels", { name: id, topic: "", sectionId, private: false, settings: { replyInThread: true, team: settingsTeam } });
      // agents picked by name that no step uses are on the team all the same
      const onChart = new Set([...teamAgentIds(settingsTeam), ...settingsTeam.nodes.map((n) => n.agentId)]);
      await Promise.all(picked.filter((a) => !onChart.has(a)).map((a) => api("PUT", `/api/channels/${ch.id}/members/agent/${a}`).catch(() => {})));
      await refreshChannels();
      onClose();
      go({ view: "chat", channelId: ch.id, threadId: null });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (page === "builder")
    return <TeamBuilder team={team} onChange={setTeam} name={id} allowEmpty blocked={newTeamProblem(team, picked)} leadId={picked[0] ?? null} pool={picked} saving={busy} error={error} onBack={() => setPage("name")} onDone={() => void create()} />;

  const toggle = (agentId: string) => setPicked((cur) => (cur.includes(agentId) ? cur.filter((x) => x !== agentId) : [...cur, agentId]));
  return (
    <Modal title="New team" onClose={onClose} className="sm:max-w-[440px]!">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) setPage("builder");
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="release-crew" aria-label="Name" autoCapitalize="none" autoCorrect="off" maxLength={80} className="h-11 w-full rounded-[12px] border border-line bg-card px-3.5 text-body outline-none placeholder:text-faint focus:border-ring" />
        {id && (exists || id !== name) && <p className={cx("px-1 text-xs", exists ? "text-bad" : "text-faint")}>{exists ? `${id} already exists` : id}</p>}
        {agents.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Agents on the team">
            {agents.map((a) => {
              const on = picked.includes(a.id);
              return (
                <button key={a.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(a.id)} className={cx("inline-flex h-9 items-center gap-1.5 rounded-[8px] border pl-1.5 pr-3 text-[13px]", on ? "border-transparent bg-side-active font-medium" : "border-line hover:bg-hover")}>
                  <AgentAvatar agent={a} size={24} interactive={false} />
                  {a.name}
                  {on && <Check size={13} strokeWidth={2.6} aria-hidden />}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex justify-end pt-1">
          <Button variant="primary" disabled={!valid}>
            Next
          </Button>
        </div>
      </form>
    </Modal>
  );
}
