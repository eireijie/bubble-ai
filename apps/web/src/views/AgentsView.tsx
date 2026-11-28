import { useEffect, useState } from "react";
import { MoreHorizontal, Plus, Search } from "lucide-react";
import { api } from "../api.ts";
import { useStore } from "../store.ts";
import { liveShape } from "../liveShape.ts";
import { href, type AgentTab } from "../router.ts";
import { AgentDetail, type NodeInfo } from "./AgentSettings.tsx";
import { agentReadiness, useDevices, type DeviceInfo } from "../devices.ts";
import { workingLine } from "../components/agentActivity.ts";
import { AgentAvatar, StatusDot, harnessLabel, cx } from "../components/ui.tsx";
import { prettyModel } from "../components/EffortSlider.tsx";
import { openDm } from "../openDm.ts";

import { CreateAgent } from "./CreateAgent.tsx";
import { NewAgentSheet } from "./NewAgentSheet.tsx";
import type { GhostAppearance } from "@bubble-ai/core/src/appearance.ts";
export { freeHandle, importFound } from "./CreateAgent.tsx";

type ListAgent = ReturnType<typeof useStore.getState>["agents"][number];

/**
 * An agent's one line on the list: what is wrong when something is (in the warning colour), what
 * it is doing while it works, otherwise what it does (its AI when it has no line of its own).
 */
export function agentListLine(a: Pick<ListAgent, "id" | "status" | "harness" | "nodeId" | "computerId" | "settings"> & Partial<Pick<ListAgent, "signIn">>, devices: DeviceInfo[] | null, run?: { last?: { name?: string } | null; text?: string | null } | null): { text: string; warn: boolean; working: boolean } {
  const readiness = agentReadiness(a, devices);
  if (!readiness.ready) return { text: readiness.problem ?? "Setup incomplete", warn: true, working: false };
  if (a.status !== "offline" && a.signIn) return { text: `Needs sign-in on ${a.signIn.where}`, warn: true, working: false };
  if (run) return { text: workingLine(run.last?.name, !!run.text), warn: false, working: true };
  if (a.status === "busy") return { text: "Working", warn: false, working: true };
  if (a.status === "offline") return { text: "Offline", warn: false, working: false };
  return { text: a.settings.role || harnessLabel(a.harness), warn: false, working: false };
}

/** All agents: one row each (ghost, name, one line). The row opens its chat; the "…" at its end opens its page. */
export function AgentsView({ agentId, tab }: { agentId: string | null; tab: AgentTab | null }) {
  const agents = useStore((s) => s.agents);
  const live = useStore(liveShape);
  const me = useStore((s) => s.me);
  const [creating, setCreating] = useState(false);
  // "More options" on the sheet: the full New agent dialog, with the sheet's name and look in it
  const [full, setFull] = useState<{ name: string; look: GhostAppearance } | null>(null);
  const [bringing, setBringing] = useState(false);
  // "New agent" from the + menu or ⌘K opens it here
  const newAgentOpen = useStore((s) => s.newAgentOpen);
  useEffect(() => {
    if (!newAgentOpen) return;
    useStore.setState({ newAgentOpen: false });
    if (me?.role !== "guest") setCreating(true);
  }, [newAgentOpen, me?.role]);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const devices = useDevices();
  const [q, setQ] = useState("");
  useEffect(() => {
    api<NodeInfo[]>("GET", "/api/nodes").then(setNodes);
  }, [agents]);
  const selected = agents.find((a) => a.id === agentId);
  const canEdit = me?.role !== "guest";

  const newSheets = (
    <>
      {creating && (
        <NewAgentSheet
          onClose={() => setCreating(false)}
          onMore={(picked) => {
            setCreating(false);
            setFull(picked);
          }}
        />
      )}
      {full && <CreateAgent nodes={nodes} initialName={full.name} initialLook={full.look} onClose={() => setFull(null)} />}
    </>
  );

  if (selected)
    return (
      <>
        <AgentDetail key={selected.id} agent={selected} nodes={nodes} tab={tab} />
        {newSheets}
      </>
    );

  const needle = q.trim().toLowerCase();
  const shown = agents.filter((a) => !needle || a.name.toLowerCase().includes(needle) || a.handle.toLowerCase().includes(needle));

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto">
        {/* phones: the top room the back bar over this page takes back (App's PhoneBack) */}
        <div className="mx-auto max-w-[640px] px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] md:px-6 md:pt-7">
          <h1 className="t-title mb-4 px-1">All agents</h1>
          <div className="mb-3 flex items-center gap-2">
            <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[10px] bg-card px-3 text-faint">
              <Search size={15} strokeWidth={2} className="shrink-0" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search agents" className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-faint" />
            </label>
            {canEdit && (
              <button onClick={() => setCreating(true)} className="circle shrink-0" aria-label="New agent">
                <Plus size={18} strokeWidth={2} />
              </button>
            )}
          </div>

          <ul data-stagger>
            {shown.map((a) => {
              const line = agentListLine(a, devices, Object.values(live).find((r) => r.agentId === a.id));
              return (
                <li key={a.id} className="group relative flex h-[76px] items-center gap-3 rounded-[12px] px-2 transition-colors duration-150 hover:bg-side-active">
                  <button type="button" onClick={() => void openDm(a.id)} aria-label={`Message ${a.name}`} className="flex min-w-0 flex-1 items-center gap-3.5 text-left after:absolute after:inset-0 after:rounded-[12px]">
                    <AgentAvatar agent={a} size={58} live />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-[17px] font-semibold leading-6">{a.name}</span>
                        <span className="flex shrink-0 items-center gap-1.5 text-[14px] text-faint">
                          <StatusDot status={a.status} needsSignIn={!!a.signIn} className="size-1.5" />
                          {harnessLabel(a.harness)}
                          {a.model ? ` · ${prettyModel(a.model)}` : ""}
                        </span>
                      </span>
                      <span className={cx("block truncate text-[15px] leading-[22px]", line.warn ? "text-st-needs" : line.working ? "text-wisp-strong" : "text-muted")}>
                        <span className={cx(line.working && "shimmer-text")}>{line.text}</span>
                      </span>
                    </span>
                  </button>
                  <a href={href({ view: "agents", agentId: a.id, tab: "overview" })} aria-label={`${a.name}'s settings`} className="circle circle-sm relative z-10 shrink-0 text-muted opacity-70 transition-opacity duration-150 hover:text-ink group-hover:opacity-100">
                    <MoreHorizontal size={16} />
                  </a>
                </li>
              );
            })}
          </ul>
          {agents.length > 0 && shown.length === 0 && <p className="px-2 py-3 text-[13px] text-muted">No matches</p>}
          {agents.length === 0 && <p className="px-2 py-3 text-[13px] text-muted">No agents yet</p>}
          {canEdit && (
            <div className="mt-3 flex flex-wrap gap-x-1">
              <a href={href({ view: "templates" })} className="inline-flex h-9 items-center px-2 text-[13px] text-muted hover:text-ink">
                Start from a template
              </a>
              <button type="button" onClick={() => setBringing(true)} className="inline-flex h-9 items-center px-2 text-[13px] text-muted hover:text-ink">
                Bring in an agent
              </button>
            </div>
          )}
        </div>
      </div>
      {newSheets}
      {bringing && <CreateAgent bringIn nodes={nodes} onClose={() => setBringing(false)} />}
    </div>
  );
}
