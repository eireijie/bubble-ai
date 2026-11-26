import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import type { GhostAppearance } from "@bubble-ai/core";
import { Bubble, type BubbleMood } from "../../components/Bubble.tsx";
import { BackgroundBubbles } from "../../components/BackgroundBubbles.tsx";
import { motionReduced } from "../../theme.ts";
import "./stage.css";

/**
 * The first run's one stage (2026-11-26 canvas "Bubble AI onboarding flow"). It never unmounts
 * while the first run lasts: the background bubbles, the progress line, Back and the agent's own
 * bubble stay put, and only the page under them changes. Each page marks where the bubble sits
 * with <BubbleSlot size>; the bubble travels there and resizes on the way, with a small squash.
 * The old page slides and fades out while the new one slides and fades in. Nothing blinks.
 *
 * While it's open the bubble's eyes follow the pointer anywhere in the window and it leans a little
 * towards it; when the pointer leaves the window the eyes go back to resting to one side.
 */

/** The size the bubble is drawn at; every slot is this scaled down. */
const DRAWN = 200;
const EASE = "cubic-bezier(.65,0,.25,1)";

export function BubbleSlot({ size, className }: { size: number; className?: string }) {
  return <span data-ob-slot={size} aria-hidden className={className} style={{ display: "block", width: size, height: size, flexShrink: 0 }} />;
}

type Page = { id: string; el: ReactNode };

export function Stage({
  page,
  dir = 1,
  look,
  seed,
  mood = "awake",
  progress,
  onBack,
  onBubble,
  bubbleLabel,
  children,
}: {
  /** which page shows: a new id slides the old page out and this one in */
  page: string;
  /** 1 forward, -1 back */
  dir?: 1 | -1;
  look: Pick<GhostAppearance, "color" | "color2" | "bubble"> | undefined;
  seed?: string;
  mood?: BubbleMood;
  /** 0 to 1, the thin line along the top */
  progress: number;
  onBack?: (() => void) | null;
  /** a click on the bubble (Your agent: another colour) */
  onBubble?: () => void;
  bubbleLabel?: string;
  children: ReactNode;
}) {
  // the page that is leaving, kept while it slides out
  const [shown, setShown] = useState<{ id: string; prev: Page | null; dir: 1 | -1 }>({ id: page, prev: null, dir });
  const last = useRef<ReactNode>(children);
  if (shown.id !== page) setShown({ id: page, prev: { id: shown.id, el: last.current }, dir });
  else last.current = children;
  useEffect(() => {
    if (!shown.prev) return;
    const t = setTimeout(() => setShown((s) => (s.prev ? { ...s, prev: null } : s)), motionReduced() ? 0 : 520);
    return () => clearTimeout(t);
  }, [shown.prev]);

  useEffect(() => {
    if (!onBack) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && onBack();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onBack]);

  // the app behind the stage (its sidebar, header) is out of reach and out of the accessibility tree
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const hidden: HTMLElement[] = [];
    for (let el: HTMLElement | null = stageRef.current; el && el.parentElement && el !== document.body; el = el.parentElement)
      for (const sib of Array.from(el.parentElement.children))
        if (sib !== el && sib instanceof HTMLElement && !sib.inert && sib.tagName !== "SCRIPT") {
          sib.inert = true;
          hidden.push(sib);
        }
    return () => hidden.forEach((h) => (h.inert = false));
  }, []);

  // --- the travelling bubble -------------------------------------------------------------------
  const box = useRef<HTMLDivElement>(null);
  const bub = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const placed = useRef<{ x: number; y: number; s: number } | null>(null);
  const [hidden, setHidden] = useState(true);

  const measure = useCallback(() => {
    const root = box.current;
    const el = bub.current;
    if (!root || !el) return;
    const slot = root.querySelector<HTMLElement>(`[data-ob-page="${CSS.escape(page)}"] [data-ob-slot]`);
    if (!slot) return setHidden(true);
    const pageEl = slot.closest<HTMLElement>("[data-ob-page]")!;
    // the page is mid-slide: measure the slot against its page, then the page's own place (not its transform)
    const s = slot.getBoundingClientRect();
    const p = pageEl.getBoundingClientRect();
    const size = Number(slot.dataset.obSlot) || s.width;
    const x = pageEl.offsetLeft + (s.left - p.left) + s.width / 2;
    const y = pageEl.offsetTop + (s.top - p.top) + s.height / 2;
    const was = placed.current;
    if (was && Math.abs(was.x - x) < 0.5 && Math.abs(was.y - y) < 0.5 && Math.abs(was.s - size / DRAWN) < 0.001) return;
    const first = !was;
    placed.current = { x, y, s: size / DRAWN };
    el.style.transition = first || motionReduced() ? "none" : `transform .85s ${EASE}`;
    el.style.transform = `translate(${(x - DRAWN / 2).toFixed(1)}px, ${(y - DRAWN / 2).toFixed(1)}px) scale(${(size / DRAWN).toFixed(4)})`;
    setHidden(false);
  }, [page]);

  // each new page: travel, with one squash on the way
  const firstPage = useRef(true);
  useLayoutEffect(() => {
    measure();
    if (firstPage.current) return void (firstPage.current = false);
    const b = body.current;
    if (b && !motionReduced() && typeof b.animate === "function")
      b.animate(
        [{ transform: "scale(1,1)" }, { transform: "scale(1.07,.93)", offset: 0.25 }, { transform: "scale(.95,1.05)", offset: 0.6 }, { transform: "scale(1,1)" }],
        { duration: 820, easing: "ease-in-out" },
      );
  }, [page, measure]);
  // and wherever the page moves the slot (a panel opening, the window resizing, fonts arriving)
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    let q = 0;
    const later = () => (q ||= requestAnimationFrame(() => ((q = 0), measure())));
    const ro = new ResizeObserver(later);
    ro.observe(root);
    // a panel opening inside the page changes where the slot is without changing the stage's size
    root.querySelectorAll(`[data-ob-page="${CSS.escape(page)}"] > *`).forEach((el) => ro.observe(el));
    window.addEventListener("resize", later);
    const t = setTimeout(later, 560);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", later);
      clearTimeout(t);
      cancelAnimationFrame(q);
    };
  }, [measure, page]);

  // --- eyes that follow the pointer anywhere, and a slight lean --------------------------------
  useEffect(() => {
    let q = 0;
    let at: { x: number; y: number } | null = null;
    const face = () => bub.current?.querySelector<HTMLElement>(".bub");
    const rest = () => {
      const f = face();
      if (f) {
        delete f.dataset.hov;
        f.style.removeProperty("--ex");
        f.style.removeProperty("--ey");
      }
      if (body.current) body.current.style.rotate = "0deg";
    };
    const draw = () => {
      q = 0;
      const f = face();
      const el = bub.current;
      if (!at || !f || !el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height * 0.45;
      const dx = (at.x - cx) / Math.max(240, window.innerWidth / 2);
      const dy = (at.y - cy) / Math.max(240, window.innerHeight / 2);
      const k = Math.min(1, 1 / (Math.hypot(dx, dy) || 1));
      f.dataset.hov = "1";
      f.style.removeProperty("--gx");
      f.style.removeProperty("--gy");
      f.style.setProperty("--ex", `${(dx * k * DRAWN * 0.09).toFixed(2)}px`);
      f.style.setProperty("--ey", `${(dy * k * DRAWN * 0.07).toFixed(2)}px`);
      if (body.current) body.current.style.rotate = `${(Math.max(-1, Math.min(1, dx)) * 6).toFixed(2)}deg`;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch" || motionReduced()) return;
      at = { x: e.clientX, y: e.clientY };
      q ||= requestAnimationFrame(draw);
    };
    const out = (e: MouseEvent) => {
      if (e.relatedTarget) return;
      at = null;
      rest();
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("mouseout", out);
    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("mouseout", out);
      cancelAnimationFrame(q);
    };
  }, []);

  const pages: (Page & { cls: string })[] = [
    ...(shown.prev ? [{ ...shown.prev, cls: shown.dir > 0 ? "ob-out-l" : "ob-out-r" }] : []),
    { id: page, el: children, cls: shown.prev ? (shown.dir > 0 ? "ob-in-r" : "ob-in-l") : "ob-in-first" },
  ];

  return (
    <div ref={stageRef} className="ob-stage fixed inset-0 z-40 overflow-y-auto overflow-x-hidden bg-panel text-ink" data-testid="setup">
      <BackgroundBubbles />
      <div className="ob-progress" aria-hidden>
        <span style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, progress))})` }} />
      </div>
      <button
        type="button"
        onClick={onBack ?? undefined}
        aria-label="Back"
        tabIndex={onBack ? 0 : -1}
        aria-hidden={!onBack}
        className="ob-back safe-top fixed left-4 top-4 z-10 grid size-[34px] place-items-center rounded-lg text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/40"
        data-on={onBack ? "" : undefined}
      >
        <ChevronLeft size={18} />
      </button>
      <div ref={box} className="relative grid min-h-full">
        {pages.map((p) => (
          <div key={p.id} data-ob-page={p.id} className={`ob-page ${p.cls}`} aria-hidden={p.id !== page || undefined} inert={p.id !== page ? true : undefined}>
            {p.el}
          </div>
        ))}
        <div ref={bub} className="ob-bubble" style={{ width: DRAWN, height: DRAWN, opacity: hidden ? 0 : 1 }} data-bub-main="">
          <div ref={body} className="ob-bubble-body">
            {onBubble ? (
              <button type="button" onClick={onBubble} aria-label={bubbleLabel ?? "Change its colour"} className="block rounded-full outline-none focus-visible:ring-4 focus-visible:ring-ring/40">
                <Bubble look={look} seed={seed} size={DRAWN} mood={mood} label="" follow={false} interactive />
              </button>
            ) : (
              <Bubble look={look} seed={seed} size={DRAWN} mood={mood} label="" follow={false} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
