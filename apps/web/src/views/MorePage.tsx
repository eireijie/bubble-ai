import type { ReactNode } from "react";
import { Bell, ChevronRight, Compass, ExternalLink, LayoutGrid, LifeBuoy, ListTodo, Sparkles, Users } from "lucide-react";
import { GITHUB_URL } from "@bubble-ai/core";
import { BubbleIcon } from "../components/icons.tsx";
import { useMoreItems } from "../components/Rail.tsx";
import { startTour } from "../components/tour/tourRun.ts";
import { useFeatures } from "../features.ts";
import { useReadyChecklist } from "../onboarding.ts";
import { useInboxCount, useStore } from "../store.ts";
import { STOPS, TOTAL, seenCount } from "../tour.ts";
import { href, type Route } from "../router.ts";

type Row = { label: string; icon: ReactNode; to?: Route; onClick?: () => void; hint?: string | null; external?: boolean };

/**
 * Phones' More tab (round 11, board 8 C): everything that isn't one of the other four tabs — the agents
 * list, what needs you, tasks and routines, templates, mods' own pages, help and the tour.
 */
export function MorePage() {
  const me = useStore((s) => s.me)!;
  const guest = me.role === "guest";
  const features = useFeatures();
  const needs = useInboxCount();
  const ready = useReadyChecklist();
  const learnSeen = useStore((s) => seenCount(s.me?.prefs.learn, STOPS));
  // mods' own pages (Code, Storage, Apple) while they're on
  const mods = useMoreItems(guest, 18, false, true).filter((m) => !["Memory", "Tasks", "Connect apps", "Help"].includes(m.label));
  const icon = { size: 18, strokeWidth: 1.8 };
  const first: Row[] = [
      { label: "All agents", icon: <BubbleIcon {...icon} />, to: { view: "agents", agentId: null } as Route },
      ...(!guest ? [{ label: "Needs you", icon: <Bell {...icon} />, to: { view: "dashboard" } as Route, hint: needs > 0 ? String(needs) : null }] : []),
      ...(!guest ? [{ label: "Tasks and routines", icon: <ListTodo {...icon} />, to: (features.tasks ? { view: "tasks" } : { view: "marketplace", app: "m:tasks" }) as Route, hint: features.tasks ? null : "Off" }] : []),
      ...(!guest ? [{ label: "Templates", icon: <LayoutGrid {...icon} />, to: { view: "templates" } as Route }] : []),
      { label: "Browse teams", icon: <Users {...icon} />, onClick: () => useStore.setState({ channelBrowser: { sectionId: null } }) },
  ];
  const last: Row[] = [
      ...(!guest && ready.started && ready.left > 0 ? [{ label: "Finish setup", icon: <Compass {...icon} />, to: { view: "settings", page: "learn" } as Route, hint: `${ready.left} left` }] : []),
      ...(!guest ? [{ label: "Show me around", icon: <Compass {...icon} />, onClick: () => startTour(learnSeen >= TOTAL ? 0 : undefined), hint: learnSeen < TOTAL ? `${learnSeen} of ${TOTAL}` : null }] : []),
      { label: "Help", icon: <LifeBuoy {...icon} />, to: { view: "help" } },
      { label: "What's new", icon: <Sparkles {...icon} />, to: { view: "settings", page: "updates", item: "news" } },
      { label: "Report a problem", icon: <ExternalLink {...icon} />, onClick: () => window.open(`${GITHUB_URL}/issues`, "_blank", "noreferrer"), external: true },
  ];
  const groups: Row[][] = [first, mods.map((m): Row => ({ label: m.label, icon: m.icon, to: m.to })), last].filter((g) => g.length > 0);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-[calc(96px+env(safe-area-inset-bottom))] safe-top">
      <h1 className="px-5 pb-2 pt-3 text-[28px] font-bold tracking-[-0.2px]">More</h1>
      {groups.map((rows, i) => (
        <div key={i} className="mx-3.5 mt-3.5 overflow-hidden rounded-[16px] bg-[var(--r11-card)]">
          {rows.map((r) => {
            const inner = (
              <>
                <span className="grid shrink-0 text-ink/80">{r.icon}</span>
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                {r.hint && <span className="text-[14px] text-muted">{r.hint}</span>}
                {!r.external && <ChevronRight size={16} strokeWidth={2} className="shrink-0 text-muted" aria-hidden />}
              </>
            );
            const cls = "flex min-h-12 w-full items-center gap-3 border-b border-line2 px-3.5 text-left text-[15px] last:border-b-0 active:bg-hover";
            return r.to ? (
              <a key={r.label} href={href(r.to)} className={cls}>
                {inner}
              </a>
            ) : (
              <button key={r.label} type="button" onClick={r.onClick} className={cls}>
                {inner}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
