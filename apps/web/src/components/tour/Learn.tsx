import { Check, CircleHelp, Compass, ExternalLink, LifeBuoy, Sparkles } from "lucide-react";
import { GITHUB_URL } from "@bubble-ai/core";
import { useStore } from "../../store.ts";
import { href } from "../../router.ts";
import { Popover } from "../ui.tsx";
import { resumeLabel, seenCount, stopTitle, stopsFor } from "../../tour.ts";
import { startTour } from "./tourRun.ts";
import { FinishSetupList } from "../../views/HereView.tsx";

/**
 * Learn Bubble AI: the ring with how much of Show me around you've done, the Help "?" menu and the
 * Settings page with every stop. They all start the same tour (tourRun.ts). Nothing about the tour
 * sits in the chat header: once it's skipped or done it is only here.
 */

function useLearn() {
  const guest = useStore((s) => s.me?.role === "guest");
  const learn = useStore((s) => s.me?.prefs.learn);
  const stops = stopsFor(guest);
  return { learn, stops, seen: seenCount(learn, stops), total: stops.length };
}

/** The ring: a circle that fills as stops are seen. */
export function LearnRing({ seen, total, size = 24 }: { seen: number; total: number; size?: number }) {
  const c = 2 * Math.PI * 14;
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden className="shrink-0">
      <circle cx="18" cy="18" r="14" fill="none" stroke="var(--line2)" strokeWidth="4" />
      <circle cx="18" cy="18" r="14" fill="none" stroke="var(--wisp)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${((seen / Math.max(1, total)) * c).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 18 18)" className="transition-[stroke-dasharray] duration-500" />
    </svg>
  );
}

/** The stops, each with a check once done. Clicking one starts there. */
function Stops({ onStart }: { onStart?: () => void }) {
  const { learn, stops } = useLearn();
  const agent = useStore((s) => s.agents[0]?.name ?? "");
  const seen = new Set(learn?.seen ?? []);
  return (
    <ul className="flex flex-col" aria-label="Stops">
      {stops.map((st, i) => (
        <li key={st.id}>
          <button type="button" onClick={() => (onStart?.(), startTour(i))} className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/40">
            <span className="flex-1 text-[14.5px]">{stopTitle(st, agent)}</span>
            {seen.has(st.id) && <Check size={15} strokeWidth={2.6} className="text-ok" aria-label="Done" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

const roundBtn = "m-press grid size-[36px] place-items-center rounded-full bg-[var(--bubble-them)] text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/40";

/** The "?" in the chat header (desktop): Show me around first, then Help, What's new, Report a problem. */
export function HelpMenu() {
  const item = "flex h-10 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[15px] text-ink outline-none hover:bg-hover focus-visible:bg-hover";
  return (
    <span className="hidden md:block">
      <Popover
        up={false}
        align="right"
        className="w-[240px] p-1.5 !rounded-[14px]"
        trigger={(open, toggle) => (
          <button type="button" data-tour="help" onClick={toggle} aria-expanded={open} aria-haspopup="menu" aria-label="Help" title="Help" className={roundBtn}>
            <CircleHelp size={17} strokeWidth={1.8} />
          </button>
        )}
      >
        {(close) => (
          <div role="menu" aria-label="Help">
            <button type="button" role="menuitem" className={item} onClick={() => (close(), startTour())}>
              <Compass size={16} strokeWidth={1.8} aria-hidden /> Show me around
            </button>
            <a role="menuitem" className={item} href={href({ view: "help" })} onClick={close}>
              <LifeBuoy size={16} strokeWidth={1.8} aria-hidden /> Help
            </a>
            <a role="menuitem" className={item} href={href({ view: "settings", page: "updates", item: "news" })} onClick={close}>
              <Sparkles size={16} strokeWidth={1.8} aria-hidden /> What's new
            </a>
            <a role="menuitem" className={item} href={`${GITHUB_URL}/issues`} target="_blank" rel="noreferrer" onClick={close}>
              <ExternalLink size={16} strokeWidth={1.8} aria-hidden /> Report a problem
            </a>
          </div>
        )}
      </Popover>
    </span>
  );
}

/**
 * Settings › Learn Bubble AI: the tour's progress and chapters, then what setup left to do (phone,
 * apps, away from home, getting to know you), which used to be its own "Finish setup" list.
 */
export function LearnPage() {
  const { learn, stops, seen, total } = useLearn();
  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-card p-3.5" aria-label="Show me around">
        <div className="flex items-center gap-3 px-1 pb-2">
          <LearnRing seen={seen} total={total} size={32} />
          <span className="min-w-0 flex-1 text-[16px] font-semibold">Show me around</span>
          <button type="button" onClick={() => startTour(seen >= total ? 0 : undefined)} className="h-8 shrink-0 rounded-lg bg-ink px-3.5 text-[13.5px] font-semibold text-panel outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            {resumeLabel(learn, stops)}
          </button>
        </div>
        <Stops />
      </section>
      <FinishSetupList />
    </div>
  );
}
