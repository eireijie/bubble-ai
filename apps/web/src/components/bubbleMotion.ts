import { motionReduced } from "../theme.ts";

/**
 * Shared motion for every bubble on the page, so a long chat list stays cheap (2026-11-25 speed
 * pass). Measured at phone width with the CPU slowed 4×: the CSS loops on 31 small bubbles kept the
 * main thread busy ~97% of the time even while idle, mostly re-running styles every frame.
 *
 * - One IntersectionObserver marks bubbles that are off screen (`data-off`), and the page marks
 *   itself while hidden (`data-bub-hidden` on <html>); CSS pauses every animation under either.
 * - Small bubbles ("lite") blink and glance from one shared timer: a blink is a 0.18 s one-off
 *   animation, a glance moves the eyes with a short transition, and between them nothing runs.
 *   Off-screen and hidden bubbles are skipped, and reduced motion stops it all.
 */

interface Lite {
  /** drowsy: slower blinks and glances */
  sleepy: boolean;
  /** glances around when nothing else moves its eyes (idle, done, asleep) */
  glances: boolean;
  nextBlink: number;
  nextLook: number;
  /** where a glance is up to: 0 rest, 1 up-left, 2 down-right */
  step: number;
}

const lite = new Map<HTMLElement, Lite>();
let observer: IntersectionObserver | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let watchingPage = false;

const BLINK = [{ transform: "scaleY(1)" }, { transform: "scaleY(0.12)", offset: 0.45 }, { transform: "scaleY(1)" }];
/** where the eyes go on a glance, as the old bub-look keyframes: up-left, then down-right */
const LOOK: [string, string][] = [
  ["0%", "0%"],
  ["-40%", "-15%"],
  ["40%", "10%"],
];

function watchPage() {
  if (watchingPage || typeof document === "undefined") return;
  watchingPage = true;
  const sync = () => {
    if (document.hidden) document.documentElement.dataset.bubHidden = "";
    else delete document.documentElement.dataset.bubHidden;
  };
  document.addEventListener("visibilitychange", sync);
  sync();
}

function io(): IntersectionObserver | null {
  if (observer || typeof IntersectionObserver === "undefined") return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        if (e.isIntersecting) delete el.dataset.off;
        else el.dataset.off = "";
      }
    },
    { rootMargin: "64px" },
  );
  return observer;
}

/** Pause a moving bubble's animations while it is off screen. Returns the undo. */
export function watchBubble(el: HTMLElement): () => void {
  watchPage();
  const o = io();
  o?.observe(el);
  return () => {
    o?.unobserve(el);
    delete el.dataset.off;
  };
}

const jitter = (base: number) => base * (0.7 + Math.random() * 0.6);

function tick() {
  if (document.hidden || motionReduced()) return;
  const now = performance.now();
  for (const [el, s] of lite) {
    if (el.dataset.off !== undefined) continue;
    if (now >= s.nextBlink) {
      s.nextBlink = now + jitter(s.sleepy ? 7000 : 5200);
      for (const eye of el.querySelectorAll<HTMLElement>(".bub-e")) eye.animate(BLINK, { duration: s.sleepy ? 260 : 180, easing: "ease-in-out" });
    }
    if (s.glances && now >= s.nextLook) {
      // rest a while, then up-left, hold, down-right, hold, back to rest
      s.step = (s.step + 1) % 3;
      s.nextLook = now + (s.step === 0 ? jitter(s.sleepy ? 11000 : 7500) : s.sleepy ? 1900 : 1500);
      if (el.dataset.hov !== undefined) continue;
      const [x, y] = LOOK[s.step];
      el.style.setProperty("--gx", x);
      el.style.setProperty("--gy", y);
    }
  }
}

/**
 * A small bubble whose eyes blink and glance from the shared timer instead of CSS loops. Returns
 * the undo. The first blink and glance come at a random time so a list never moves in step.
 */
export function liteEyes(el: HTMLElement, opts: { sleepy: boolean; glances: boolean }): () => void {
  const now = performance.now();
  lite.set(el, { ...opts, nextBlink: now + Math.random() * 5200, nextLook: now + Math.random() * 9000, step: 0 });
  timer ??= setInterval(tick, 150);
  return () => {
    lite.delete(el);
    el.style.removeProperty("--gx");
    el.style.removeProperty("--gy");
    if (!lite.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** for tests */
export const bubbleMotionState = () => ({ lite: lite.size, timer: timer !== undefined });
