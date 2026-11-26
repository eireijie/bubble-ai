import { CircleHelp, Compass, ExternalLink, LifeBuoy, Sparkles } from "lucide-react";
import { GITHUB_URL } from "@bubble-ai/core";
import { useStore, usePrefs } from "../../store.ts";
import { href } from "../../router.ts";
import { Popover, cx } from "../ui.tsx";
import { chapterProgress, resumeLabel, seenCount, stopsFor } from "../../tour.ts";
import { startTour, useTour } from "./tourRun.ts";
import { FinishSetupList } from "../../views/HereView.tsx";

/**
 * Learn Bubble AI (board 9): the ring with how much of Show me around you've seen, the Help "?" menu,
 * Simple's "Show me around" button, and the Settings page with every chapter. They all start the
 * same tour (tourRun.ts).
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

/** Each chapter with how far you got, and Resume. Clicking a chapter starts there. */
function Chapters({ onStart }: { onStart?: () => void }) {
  const { learn, stops } = useLearn();
  const chapters = chapterProgress(learn, stops);
  return (
    <>
      <span className="flex gap-1" aria-hidden>
        {chapters.map((c) => (
          <span key={c.name} className="h-1 flex-1 rounded-sm" style={{ background: c.seen === c.total ? "var(--wisp)" : c.seen ? "var(--wisp-soft, rgba(169,139,245,.3))" : "var(--line2)" }} />
        ))}
      </span>
      <ul className="flex flex-col" aria-label="Chapters">
        {chapters.map((c) => (
          <li key={c.name}>
            <button type="button" onClick={() => (onStart?.(), startTour(c.first))} className="flex h-[42px] w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/40">
              <span className="flex-1 text-[15px] font-semibold">{c.name}</span>
              <span className="text-[13px] text-muted">{c.seen === c.total ? "Seen" : `${c.seen} of ${c.total}`}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

const roundBtn = "m-press grid size-[36px] place-items-center rounded-full bg-[var(--bubble-them)] text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/40";

/**
 * The chat header's top right (desktop): "Learn Bubble AI 6/25" with the chapters and Resume, or in
 * Simple, until the tour has been started, a "Show me around" button. Gone once every stop is seen.
 */
export function LearnHeader() {
  const { learn, stops, seen, total } = useLearn();
  const { experience } = usePrefs();
  const running = useTour((s) => !!s.run);
  const guest = useStore((s) => s.me?.role === "guest");
  if (guest) return null;
  const done = seen >= total;
  if (done && !running) return null;
  if (experience === "simple" && !learn?.started)
    return (
      <button type="button" onClick={() => startTour()} className="m-press hidden h-[36px] shrink-0 items-center whitespace-nowrap rounded-full bg-ink px-3.5 text-[14px] font-semibold text-panel outline-none focus-visible:ring-2 focus-visible:ring-ring/40 md:flex">
        Show me around
      </button>
    );
  return (
    <span className="hidden shrink-0 md:block">
      <Popover
        up={false}
        align="right"
        className="w-[340px] p-2.5 !rounded-[16px]"
        trigger={(open, toggle) => (
          <button
            type="button"
            data-tour="learn"
            onClick={toggle}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={`Learn Bubble AI, ${seen} of ${total} seen`}
            className={cx("m-press flex h-[36px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[var(--bubble-them)] pl-1.5 pr-3.5 text-[14px] font-semibold text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/40", !running && seen > 0 && "learn-pulse")}
          >
            <LearnRing seen={seen} total={total} />
            Learn Bubble AI <span className="font-normal text-muted">{seen}/{total}</span>
          </button>
        )}
      >
        {(close) => (
          <div role="dialog" aria-label="Show me around" className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between px-2 pt-1">
              <span className="text-[17px] font-bold">Show me around</span>
              <span className="text-[13px] text-muted">
                {seen} of {total}
              </span>
            </div>
            <div className="flex flex-col gap-2 px-0.5">
              <Chapters onStart={close} />
            </div>
            <div className="flex gap-2 px-2 pt-1">
              <button type="button" onClick={() => (close(), startTour(seen >= total ? 0 : undefined))} className="h-[34px] flex-1 rounded-full bg-ink text-[14px] font-semibold text-panel outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                {resumeLabel(learn, stops)}
              </button>
              <button type="button" onClick={close} className="h-[34px] rounded-full bg-card px-3.5 text-[14px] text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/40">
                Close
              </button>
            </div>
            <span className="px-2 pb-1 text-[12px] text-muted">Also in Help and Settings › Learn Bubble AI.</span>
          </div>
        )}
      </Popover>
    </span>
  );
}

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
      <section className="rounded-[14px] bg-card p-3.5" aria-label="Show me around">
        <div className="flex items-center gap-3 px-1 pb-3">
          <LearnRing seen={seen} total={total} size={36} />
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold">Show me around</span>
            <span className="block text-[13px] text-muted">
              {seen} of {total} seen{seen > 0 && seen < total ? ` · next: ${stops.find((s) => !learn?.seen.includes(s.id))?.title}` : ""}
            </span>
          </span>
          <button type="button" onClick={() => startTour(seen >= total ? 0 : undefined)} className="h-[36px] shrink-0 rounded-full bg-ink px-4 text-[14px] font-semibold text-panel outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            {resumeLabel(learn, stops)}
          </button>
        </div>
        <Chapters />
      </section>
      <FinishSetupList />
    </div>
  );
}
