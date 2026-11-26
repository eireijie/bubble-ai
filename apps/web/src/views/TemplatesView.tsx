import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { BUBBLE_COLORS, newBubbleLook } from "@bubble-ai/core/src/appearance.ts";
import { api } from "../api.ts";
import { useStore } from "../store.ts";
import { Ghost } from "../components/Ghost.tsx";
import type { NodeInfo } from "./AgentSettings.tsx";
import { CreateAgent } from "./CreateAgent.tsx";
import { AGENT_TYPES, START_APPS, type AgentTypeId } from "./onboarding/agentTypes.ts";

/** One bubble colour per template, so the cards read apart at a glance. */
const TINT: Record<string, string> = { daily: BUBBLE_COLORS[1].hex, work: BUBBLE_COLORS[0].hex, code: BUBBLE_COLORS[4].hex, biz: BUBBLE_COLORS[3].hex, research: BUBBLE_COLORS[2].hex };

function LineIcon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/**
 * Templates: start a new agent from one of the kinds first-run setup offers, any time. Each card
 * shows the agent's bubble, what it's for and the apps it starts with; picking one opens New agent
 * with it filled in, ready to Create.
 */
export function TemplatesView() {
  const me = useStore((s) => s.me);
  const agents = useStore((s) => s.agents);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [open, setOpen] = useState<AgentTypeId | "blank" | null>(null);
  useEffect(() => {
    api<NodeInfo[]>("GET", "/api/nodes").then(setNodes, () => setNodes([]));
  }, [agents]);
  const canEdit = me?.role !== "guest";
  const templates = AGENT_TYPES.filter((t) => t.id !== "other");

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] md:px-6 md:pt-7">
        <h1 className="t-title mb-4 px-1">Templates</h1>
        <ul data-stagger className="grid gap-2.5 sm:grid-cols-2">
          {templates.map((t) => (
            <li key={t.id}>
              <button type="button" disabled={!canEdit} onClick={() => setOpen(t.id)} className="group flex h-full w-full items-start gap-3.5 rounded-[14px] bg-card p-4 text-left outline-none transition-[background-color,transform] duration-200 hover:bg-hover focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-[0.99] disabled:pointer-events-none">
                <Ghost look={{ ...newBubbleLook(), color: TINT[t.id] ?? BUBBLE_COLORS[0].hex }} seed={t.id} size={52} ambient={false} trackPointer label="" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                    <span className="text-muted">
                      <LineIcon d={t.icon} size={15} />
                    </span>
                    {t.name}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-5 text-muted">{t.role}</span>
                  <span className="mt-2.5 flex flex-wrap gap-1">
                    {t.apps
                      .map((a) => START_APPS[a])
                      .filter((a) => a && a.how !== "mac")
                      .map((a) => (
                        <span key={a.id} title={a.name} className="inline-flex h-6 items-center gap-1 rounded-md bg-chip px-1.5 text-[11.5px] text-muted">
                          <LineIcon d={a.icon} size={12} />
                          {a.name}
                        </span>
                      ))}
                  </span>
                </span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" disabled={!canEdit} onClick={() => setOpen("blank")} className="flex h-full min-h-[108px] w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-line text-[14px] font-medium text-muted outline-none transition-colors hover:bg-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none">
              <Plus size={16} /> Blank agent
            </button>
          </li>
        </ul>
      </div>
      {open && <CreateAgent nodes={nodes} template={open === "blank" ? undefined : open} onClose={() => setOpen(null)} />}
    </div>
  );
}
