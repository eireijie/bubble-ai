import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { FEATURE_INFO } from "@wisp/core";
import { useStore } from "../../store.ts";
import { go, parseRoute, type Route, href } from "../../router.ts";
import { motionReduced, useMotionReduced } from "../../theme.ts";
import { setFeatures, useFeatures } from "../../features.ts";
import { Bubble } from "../Bubble.tsx";
import { cx } from "../ui.tsx";
import { CHAPTERS, bubbleSpot, cardSpot, curveControl, curvePoint, easeInOut, eyebrow, flightMs, stopBody, stopsFor, type Box, type Place, type Stop } from "../../tour.ts";
import { goStop, markSeen, stopTour, useTour, type TourRun } from "./tourRun.ts";
import "./tour.css";

/**
 * Show me around, running (board 9). The person's agent leaves its chat as a bubble and flies on a
 * curve to each stop, trailing small bubbles, its eyes on where it's going. When the stop is on
 * another page, the page changes under it mid-flight. Where it lands, the real thing is cut out of
 * a dimmed page and a card beside the bubble says what it is: Back, Next, Skip tour, "6 of 25".
 *
 * Esc skips, ← and → go back and on. Reduced motion: it fades between stops instead of flying.
 * Nothing here runs while the tour is off: the component returns null and holds no listeners.
 */
export function TourOverlay() {
  const run = useTour((s) => s.run);
  if (!run) return null;
  return createPortal(<Running run={run} />, document.body);
}

const SIZE = 46;
const PAD = 6;
const CARD_W = 316;

type Shown = { el: Element | null; box: Box; fallback: boolean };

function isPhone() {
  return window.innerWidth < 768;
}

/** The first of a stop's targets that is on the page and can be seen. */
function findTarget(stop: Stop): { el: Element; fallback: boolean } | null {
  for (let n = 0; n < stop.targets.length; n++) {
    for (const el of document.querySelectorAll(stop.targets[n])) {
      // a wrapper that only marks its child (display: contents) stands for the child
      const real = getComputedStyle(el).display === "contents" ? el.firstElementChild : el;
      if (!real) continue;
      const r = real.getBoundingClientRect();
      if (r.width > 2 && r.height > 2 && getComputedStyle(real).visibility !== "hidden") return { el: real, fallback: n > 0 && n === stop.targets.length - 1 };
    }
  }
  return null;
}

/** Never a stop that points at nothing: the page itself, when nothing nearer is there. */
function pageTarget(): Element | null {
  return document.querySelector("main") ?? document.querySelector("#root > div") ?? document.body;
}

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  // a target taller or wider than the window is cut down to what can be seen
  const left = Math.max(0, r.left);
  const top = Math.max(0, r.top);
  return { left, top, width: Math.min(window.innerWidth, r.right) - left, height: Math.min(window.innerHeight, r.bottom) - top };
}

/** The target's box, with the composer's / or @ menu above it when Try it opened one. */
function shownBox(stop: Stop | null, el: Element): Box {
  const box = boxOf(el);
  if (stop?.tryIt !== "slash" && stop?.tryIt !== "at") return box;
  const row = el.closest(".relative");
  const menu = row && [...row.children].find((c) => c !== el && c.getBoundingClientRect().bottom <= box.top + 4 && c.getBoundingClientRect().height > 0);
  if (!menu) return box;
  const m = boxOf(menu);
  const left = Math.min(box.left, m.left);
  const top = Math.min(box.top, m.top);
  return { left, top, width: Math.max(box.left + box.width, m.left + m.width) - left, height: box.top + box.height - top };
}

function sameRoute(a: Route, b: Route): boolean {
  return href(a) === href(b);
}

/** The route a place stands for now, or null to stay where we are. */
function routeFor(place: Place, run: TourRun): Route | null {
  // the sidebar is under Settings when that's open as a pop-up: go back to the chat first
  if (place === "side" || place === "newTeam") return parseRoute(location.hash).view === "settings" ? routeFor("chat", run) : null;
  if (place === "chat") return run.homeChannel ? { view: "chat", channelId: run.homeChannel, threadId: null } : null;
  if (place === "team") {
    const team = useStore.getState().channels.find((c) => c.kind === "channel" && !c.archivedAt && c.settings.team);
    return team ? { view: "chat", channelId: team.id, threadId: null } : null;
  }
  return place;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

function Running({ run }: { run: TourRun }) {
  const me = useStore((s) => s.me)!;
  const guest = me.role === "guest";
  const owner = me.role === "owner";
  const stops = stopsFor(guest);
  const stop = run.end ? null : stops[run.i];
  const agent = useStore((s) => s.agents.find((a) => a.id === run.agentId) ?? s.agents[0]);
  const features = useFeatures();
  const reduced = useMotionReduced();

  const bubbleRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const pos = useRef<{ x: number; y: number } | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [landed, setLanded] = useState(false);
  const [side, setSide] = useState<NonNullable<Stop["side"]>>("right");
  const [tried, setTried] = useState(false);
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [cardH, setCardH] = useState(190);

  /** Put the bubble somewhere, and turn its eyes. */
  const place = useCallback((x: number, y: number, look?: { x: number; y: number }) => {
    pos.current = { x, y };
    const el = bubbleRef.current;
    if (!el) return;
    el.style.transform = `translate(${x - SIZE / 2}px, ${y - SIZE / 2}px)`;
    if (look) {
      const dx = look.x - x;
      const dy = look.y - y;
      const d = Math.hypot(dx, dy) || 1;
      const bub = el.querySelector<HTMLElement>(".bub");
      bub?.style.setProperty("--ex", `${((dx / d) * SIZE * 0.08).toFixed(2)}px`);
      bub?.style.setProperty("--ey", `${((dy / d) * SIZE * 0.06).toFixed(2)}px`);
    }
  }, []);

  /** One small bubble left behind; it drifts up and fades, then is gone. */
  const puff = useCallback((x: number, y: number, spread: number) => {
    const box = trailRef.current;
    if (!box || box.childElementCount > 40) return;
    const a = Math.random() * Math.PI * 2;
    const d = 3 + Math.random() * 6;
    const dot = document.createElement("span");
    dot.className = "tour-trail";
    dot.style.cssText = `left:${x + Math.cos(a) * spread - d / 2}px;top:${y + Math.sin(a) * spread - d / 2}px;width:${d}px;height:${d}px`;
    box.appendChild(dot);
    const drift = `translate(${(Math.cos(a) * 14).toFixed(1)}px, ${(-14 - Math.random() * 20).toFixed(1)}px) scale(1.4)`;
    const anim = dot.animate([{ opacity: 0 }, { opacity: 0.85, offset: 0.1 }, { opacity: 0, transform: drift }], { duration: 1400, easing: "ease-out" });
    anim.onfinish = () => dot.remove();
  }, []);

  /** Fly from where the bubble is to (x, y) on a curve. `mid` runs once, 42% of the way. */
  const fly = useCallback(
    async (to: { x: number; y: number }, alive: () => boolean, mid?: () => void) => {
      const from = pos.current ?? to;
      if (motionReduced()) {
        const el = bubbleRef.current;
        el?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" });
        await wait(170);
        mid?.();
        place(to.x, to.y);
        el?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: "forwards" });
        return;
      }
      const c = curveControl(from, to);
      const ms = flightMs(from, to);
      for (let i = 0; i < 4; i++) puff(from.x, from.y, SIZE / 2);
      const t0 = performance.now();
      let lastPuff = 0;
      let paged = false;
      for (;;) {
        const now = await frame();
        if (!alive()) return;
        const k = Math.min(1, (now - t0) / ms);
        if (!paged && k > 0.42) {
          paged = true;
          mid?.();
        }
        const p = curvePoint(from, c, to, easeInOut(k));
        place(p.x, p.y, to);
        if (now - lastPuff > 35 && k < 0.95) {
          lastPuff = now;
          puff(p.x, p.y, SIZE * 0.25);
        }
        if (k >= 1) break;
      }
      if (!paged) mid?.();
      for (let i = 0; i < 3; i++) puff(to.x, to.y, SIZE / 2);
    },
    [place, puff],
  );

  // where the bubble starts: the agent's own bubble in its chat header, else the middle of the window
  useLayoutEffect(() => {
    const home = document.querySelector(".agent-pill .bub")?.getBoundingClientRect();
    if (home && home.width > 0) place(home.left + home.width / 2, home.top + home.height / 2);
    else place(window.innerWidth / 2, window.innerHeight * 0.4);
    document.documentElement.dataset.touring = "";
    return () => {
      delete document.documentElement.dataset.touring;
    };
  }, [place]);

  // each stop: go there (changing page on the way), find the real thing, land beside it
  useEffect(() => {
    let live = true;
    const alive = () => live;
    setLanded(false);
    setTried(false);
    const undo: (() => void)[] = [];
    (async () => {
      if (!stop) {
        // the end: back in the middle, with the last card
        setShown(null);
        await fly({ x: window.innerWidth / 2, y: window.innerHeight * 0.36 }, alive, () => {
          const back = routeFor("chat", run);
          if (back && !sameRoute(parseRoute(location.hash), back)) go(back);
        });
        if (alive()) setLanded(true);
        return;
      }
      const p = isPhone() && stop.phonePlace ? stop.phonePlace : stop.place;
      const route = routeFor(p, run);
      const moving = !!route && !sameRoute(parseRoute(location.hash), route);
      const opensTeam = p === "newTeam" && !useStore.getState().channelBrowser;
      const arrive = () => {
        if (route && moving) go(route);
        if (opensTeam) {
          useStore.setState({ channelBrowser: { sectionId: null, create: true } });
          undo.push(() => useStore.setState({ channelBrowser: null }));
        }
      };
      if (moving || opensTeam) {
        // fly towards the middle while the page changes underneath, then on to the target
        setShown(null);
        await fly({ x: window.innerWidth * 0.55, y: window.innerHeight * 0.42 }, alive, arrive);
      } else arrive();
      if (!alive()) return;
      // the page may still be drawing: look for the target for up to 2 s
      let hit = findTarget(stop);
      for (const t0 = performance.now(); !hit && performance.now() - t0 < 2000; hit = findTarget(stop)) {
        await frame();
        if (!alive()) return;
      }
      const el = hit?.el ?? pageTarget();
      if (el instanceof HTMLElement || el instanceof SVGElement) el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      await frame();
      if (!alive() || !el) return;
      const box = boxOf(el);
      const v = { w: window.innerWidth, h: window.innerHeight };
      const spot = bubbleSpot(box, stop.side, SIZE, v);
      setSide(spot.side);
      setShown({ el, box, fallback: !hit || hit.fallback });
      await fly(spot, alive);
      if (!alive()) return;
      place(spot.x, spot.y, { x: box.left + box.width / 2, y: box.top + box.height / 2 });
      setLanded(true);
      markSeen(stop.id);
    })();
    return () => {
      live = false;
      undo.forEach((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.i, run.end]);

  // while landed: keep the cut-out and the bubble on the target as the page scrolls or resizes
  useEffect(() => {
    if (!landed || !shown?.el || !stop) return;
    const el = shown.el;
    let queued = 0;
    const measure = () => {
      queued = 0;
      if (!el.isConnected) return;
      const box = shownBox(stop, el);
      const v = { w: window.innerWidth, h: window.innerHeight };
      setView(v);
      setShown((s) => (s && s.el === el ? { ...s, box } : s));
      const spot = bubbleSpot(box, stop.side, SIZE, v);
      setSide(spot.side);
      place(spot.x, spot.y, { x: box.left + box.width / 2, y: box.top + box.height / 2 });
    };
    const later = () => (queued ||= requestAnimationFrame(measure));
    const settle = setTimeout(later, 250);
    // menus and sheets that open with an animation are measured again once they've arrived
    const moved = (e: Event) => {
      if (!(e.target instanceof Element) || !e.target.closest(".tour-spot, .tour-card, .tour-bubble, .tour-trail")) later();
    };
    window.addEventListener("resize", later);
    window.addEventListener("scroll", later, true);
    document.addEventListener("animationend", moved, true);
    document.addEventListener("transitionend", moved, true);
    const ro = new ResizeObserver(later);
    ro.observe(el);
    return () => {
      clearTimeout(settle);
      cancelAnimationFrame(queued);
      window.removeEventListener("resize", later);
      window.removeEventListener("scroll", later, true);
      document.removeEventListener("animationend", moved, true);
      document.removeEventListener("transitionend", moved, true);
      ro.disconnect();
    };
  }, [landed, shown?.el, stop, place, tried]);

  // the card takes focus when it lands, so a keyboard or screen reader is where the bubble is
  useEffect(() => {
    if (landed) cardRef.current?.focus({ preventScroll: true });
  }, [landed, run.i, run.end]);
  useLayoutEffect(() => {
    if (landed && cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [landed, run.i, run.end, tried, features]);

  // Try it, on the real control; and what it changed is put back when the stop is left
  useEffect(() => {
    if (!landed || !stop?.tryIt) return;
    if (stop.tryIt === "yourturn") {
      const tab = document.querySelector<HTMLElement>('[data-tour="yourturn"]');
      const was = tab?.getAttribute("aria-selected") === "true";
      const seen = () => setTried(tab?.getAttribute("aria-selected") === "true");
      const mo = tab ? new MutationObserver(seen) : null;
      if (tab) mo!.observe(tab, { attributes: true, attributeFilter: ["aria-selected"] });
      return () => {
        mo?.disconnect();
        // the rest of the tour needs the whole list
        if (!was && tab?.isConnected && tab.getAttribute("aria-selected") === "true") tab.parentElement?.querySelector<HTMLElement>('[role="tab"]')?.click();
      };
    }
    const ta = document.querySelector<HTMLTextAreaElement>('[data-tour="input"] textarea');
    if (!ta) return;
    const ch = stop.tryIt === "slash" ? "/" : "@";
    const seen = () => setTried(ta.value.startsWith(ch) || ta.value.includes(` ${ch}`));
    ta.addEventListener("input", seen);
    return () => {
      ta.removeEventListener("input", seen);
      if (ta.isConnected && ta.value === ch) typeInto(ta, "");
    };
  }, [landed, stop]);

  const tryIt = () => {
    if (!stop?.tryIt) return;
    if (stop.tryIt === "yourturn") return document.querySelector<HTMLElement>('[data-tour="yourturn"]')?.click();
    const ta = document.querySelector<HTMLTextAreaElement>('[data-tour="input"] textarea');
    if (!ta) return;
    typeInto(ta, stop.tryIt === "slash" ? "/" : "@");
    ta.focus();
  };

  const next = () => goStop(run.i + 1);
  const back = () => goStop(run.i - 1);
  const skip = () => stopTour();

  // Esc skips; ← and → go back and on, except while typing (the Try it box takes arrows)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "Escape") {
        e.preventDefault();
        stopTour();
      } else if (!typing && e.key === "ArrowRight") {
        e.preventDefault();
        if (useTour.getState().run?.end) stopTour();
        else goStop((useTour.getState().run?.i ?? 0) + 1);
      } else if (!typing && e.key === "ArrowLeft" && !useTour.getState().run?.end) {
        e.preventDefault();
        goStop((useTour.getState().run?.i ?? 0) - 1);
      }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, []);

  const box = shown?.box ?? null;
  const hole = box ? { left: box.left - PAD, top: box.top - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 } : null;
  const b = pos.current ?? { x: view.w / 2, y: view.h / 2 };
  const end = run.end;
  const card = end
    ? { left: Math.max(12, Math.min(view.w - CARD_W - 12, view.w / 2 - CARD_W / 2)), top: Math.min(view.h - cardH - 12, view.h * 0.36 + SIZE / 2 + 18), docked: null }
    : box
      ? cardSpot({ x: b.x, y: b.y, side }, box, { w: Math.min(CARD_W, view.w - 24), h: cardH }, SIZE, view)
      : null;
  const cardStyle: CSSProperties | undefined = card ? { left: card.left, top: card.top, width: card.docked ? view.w - 24 : CARD_W } : undefined;
  const modOff = stop?.mod && !features[stop.mod] ? stop.mod : null;
  const inCh = stop ? stops.filter((s) => s.ch === stop.ch) : [];
  const chapterSegs = CHAPTERS.map((_, c) => (stop && c === stop.ch ? "var(--wisp)" : stop && c < stop.ch ? "var(--wisp)" : end ? "var(--wisp)" : "var(--line2)"));

  return (
    <div className="tour fixed inset-0 z-[200]" data-tour-overlay aria-live="polite">
      {/* clicks outside the cut-out do nothing; inside it, the real control works */}
      {hole && landed && !end ? (
        <>
          <div className="fixed left-0 right-0 top-0" style={{ height: Math.max(0, hole.top) }} />
          <div className="fixed left-0 right-0 bottom-0" style={{ top: hole.top + hole.height }} />
          <div className="fixed left-0" style={{ top: hole.top, height: hole.height, width: Math.max(0, hole.left) }} />
          <div className="fixed right-0" style={{ top: hole.top, height: hole.height, left: hole.left + hole.width }} />
        </>
      ) : (
        <div className="fixed inset-0" />
      )}
      <div
        className={cx("tour-spot pointer-events-none fixed rounded-2xl", reduced && "tour-still")}
        style={hole && landed && !end ? { ...hole, opacity: 1 } : end && landed ? { left: view.w / 2, top: view.h / 2, width: 0, height: 0, opacity: 1 } : { left: b.x, top: b.y, width: 0, height: 0, opacity: 0 }}
      />
      <div ref={trailRef} aria-hidden className="pointer-events-none fixed inset-0" />
      <div ref={bubbleRef} aria-hidden className="tour-bubble pointer-events-none fixed left-0 top-0" style={{ width: SIZE, height: SIZE }}>
        <Bubble look={agent?.settings.appearance} seed={agent?.handle} size={SIZE} label="" follow={false} />
      </div>
      {landed && card && (
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby="tour-title"
          aria-describedby="tour-body"
          tabIndex={-1}
          className={cx("tour-card fixed flex flex-col gap-1.5 rounded-[18px] bg-[var(--float,var(--panel))] px-4 pb-3 pt-3.5 text-ink outline-none", !reduced && "m-pop")}
          style={cardStyle}
        >
          <span className="flex gap-[3px]" aria-hidden>
            {chapterSegs.map((c, n) => (
              <span key={n} className="h-[3px] flex-1 rounded-sm transition-colors duration-300" style={{ background: c }} />
            ))}
          </span>
          <span className="mt-0.5 text-[12px] text-muted">{end ? "Done" : eyebrow(run.i, stops)}</span>
          <span id="tour-title" className="text-[16px] font-[650] leading-[21px]">
            {end ? "That's Wisp" : stop!.title}
          </span>
          <span id="tour-body" className="text-[14px] leading-5 text-muted">
            {end ? "Show me around stays in Help and in Settings › Learn Wisp." : stopBody(stop!, { fallback: !!shown?.fallback, phone: isPhone() })}
          </span>
          {stop?.tryIt && (
            <button type="button" onClick={tryIt} className={cx("-mx-1 flex h-7 w-fit items-center gap-1.5 rounded-md px-1 text-left text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/40", tried ? "text-ok" : "text-wisp-strong hover:underline")}>
              {tried ? (
                <>
                  <Check size={14} strokeWidth={2.4} aria-hidden /> That's it.
                </>
              ) : (
                { slash: "Try it: type /", at: "Try it: type @", yourturn: "Try it: open Your turn" }[stop.tryIt]
              )}
            </button>
          )}
          {stop?.mod && (modOff || features[stop.mod]) && <ModSwitch k={stop.mod} owner={owner} on={!!features[stop.mod]} />}
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="flex-1 whitespace-nowrap text-[12px] text-muted">{end ? `${stops.length} of ${stops.length}` : `${run.i + 1} of ${stops.length}`}</span>
            {!end && (
              <button type="button" onClick={skip} className="h-[34px] rounded-full px-2 text-[14px] text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/40">
                Skip tour
              </button>
            )}
            {!end && run.i > 0 && (
              <button type="button" onClick={back} className="h-[34px] rounded-full bg-card px-3 text-[14px] text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/40">
                Back
              </button>
            )}
            <button type="button" onClick={end ? skip : next} className="h-[34px] rounded-full bg-ink px-3.5 text-[14px] font-semibold text-panel outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
              {end ? "Done" : run.i === stops.length - 1 ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      )}
      {!landed && <span className="sr-only">{end ? "Finishing the tour" : `Going to ${stop?.title}, ${inCh.indexOf(stop!) + 1} of ${inCh.length} in ${stop ? CHAPTERS[stop.ch] : ""}`}</span>}
    </div>
  );
}

/** A mod that starts off: the card offers it, and only the person turns it on. */
function ModSwitch({ k, owner, on }: { k: NonNullable<Stop["mod"]>; owner: boolean; on: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = FEATURE_INFO[k].name;
  return (
    <div className="mt-1 flex items-center gap-2.5 rounded-xl bg-card px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{name} mod</span>
        <span className="block text-[12px] leading-4 text-muted">{error ?? (on ? "On" : owner ? "Off. Turn it on to use it." : "Off. Only the owner can turn it on.")}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${name} mod`}
        disabled={!owner || busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          setFeatures({ [k]: !on })
            .catch((e: Error) => setError(e.message))
            .finally(() => setBusy(false));
        }}
        className={cx("relative h-[22px] w-[38px] shrink-0 rounded-full outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50", on ? "bg-[#30b158]" : "bg-line2")}
      >
        <span className={cx("absolute top-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.25)] transition-[left] duration-200", on ? "left-[18px]" : "left-[2px]")} />
      </button>
    </div>
  );
}

/** Type into a React-controlled box the way a person would, so its own handlers see it. */
function typeInto(ta: HTMLTextAreaElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  set?.call(ta, value);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  ta.setSelectionRange(value.length, value.length);
  ta.dispatchEvent(new Event("select", { bubbles: true }));
}
