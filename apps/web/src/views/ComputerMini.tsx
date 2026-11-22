import { Server } from "lucide-react";
import type { ComputerInfo } from "../store.ts";
import { ScreenThumb, WorkingBadge } from "../components/Screen.tsx";
import { Pill } from "../components/ui.tsx";
import { useComputerState, watchHref } from "./computerState.ts";

/** A small live card for an agent's computer (chat, agent pages). It opens the computer's live view. */
export function ComputerMini({ computer, request, showOpen = true, quiet }: { computer: ComputerInfo; request?: string; showOpen?: boolean; quiet?: boolean }) {
  const state = useComputerState(computer);
  return (
    <a href={watchHref(computer.id)} className="block max-w-md rounded-2xl border border-line bg-panel p-3 hover:shadow-panel transition-shadow">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-medium text-sm flex items-center gap-1.5">
          <Server size={13} className="text-muted" /> Computer
        </span>
        <span className="ml-auto">{state.working ? <WorkingBadge /> : <Pill tone={state.tone}>{state.label}</Pill>}</span>
      </div>
      {request && !quiet && <p className="text-sm mb-2">{request}</p>}
      <ScreenThumb computer={computer} refreshMs={3000} />
      {showOpen && <div className="mt-2 text-xs text-accent-text font-medium">{request && !computer.help ? "Handled ✓" : request ? "Open and take control →" : `Watch ${computer.name} →`}</div>}
    </a>
  );
}
