import { motionReduced } from "../theme.ts";

/*
 * Motion for the Bubble AI mark (canvas "Bubble AI mark motion", approved 2026-11-25). Plain DOM and
 * Web Animations, no React. Every move is a one-off animation or a loop that ends when its state ends;
 * nothing runs at rest. While the page is hidden every animation started here is paused, and with
 * reduced motion only short fades run.
 *
 * The mark's layers (see MotionMark.tsx and mark.css): move > turn > squash > body. The rim's colours
 * sit on `--rim-a`, so turning it makes the rainbow shimmer as the bubble spins.
 */

export interface MarkParts {
  el: HTMLElement;
  mv: HTMLElement;
  rot: HTMLElement;
  sq: HTMLElement;
  body: HTMLElement;
  rim: HTMLElement;
  eyes: HTMLElement;
  es: HTMLElement[];
  size: number;
}

export function markParts(el: HTMLElement): MarkParts {
  const q = (s: string) => el.querySelector<HTMLElement>(s)!;
  return { el, mv: q(".mk-mv"), rot: q(".mk-rot"), sq: q(".mk-sq"), body: q(".mk-b"), rim: q(".mk-rim"), eyes: q(".mk-eyes"), es: [...el.querySelectorAll<HTMLElement>(".mk-e")], size: el.offsetWidth || 64 };
}

// --- every animation started here pauses while the page is hidden --------------------------------

const live = new Set<Animation>();
let watching = false;
function watchPage() {
  if (watching || typeof document === "undefined") return;
  watching = true;
  document.addEventListener("visibilitychange", () => {
    for (const a of live) {
      if (document.hidden && a.playState === "running") a.pause();
      else if (!document.hidden && a.playState === "paused") a.play();
    }
  });
}

/** Start one animation; it pauses with the page and forgets itself when done. */
export function animate(el: Element, keyframes: Keyframe[], opts: KeyframeAnimationOptions): Animation {
  watchPage();
  const a = el.animate(keyframes, { fill: "none", ...opts });
  live.add(a);
  const drop = () => live.delete(a);
  a.finished.then(drop, drop);
  a.addEventListener("remove", drop);
  if (typeof document !== "undefined" && document.hidden) a.pause();
  return a;
}

/** for tests */
export const liveAnimations = () => live.size;

export const reduced = () => motionReduced();

// --- tiny bubbles: trails behind fast moves and bursts ------------------------------------------------

let fxLayer: HTMLElement | null = null;
function fx(): HTMLElement {
  if (fxLayer?.isConnected) return fxLayer;
  fxLayer = document.createElement("div");
  fxLayer.className = "mk-fx";
  fxLayer.setAttribute("aria-hidden", "true");
  document.body.append(fxLayer);
  return fxLayer;
}

/** One tiny bubble at viewport (x, y) that plays `keyframes` once and removes itself. */
export function tinyBubble(x: number, y: number, size: number, keyframes: Keyframe[], duration: number, layer: HTMLElement = fx(), cls = "mk-tb") {
  const d = document.createElement("i");
  d.className = cls;
  Object.assign(d.style, { left: `${x - size / 2}px`, top: `${y - size / 2}px`, width: `${size}px`, height: `${size}px` });
  layer.append(d);
  const done = () => d.remove();
  animate(d, keyframes, { duration, easing: "cubic-bezier(.2,.7,.3,1)" }).finished.then(done, done);
}

const centre = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
};
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** A short trail of tiny bubbles behind the mark while it moves fast. */
export function trail(m: MarkParts, duration: number, every = 36): () => void {
  if (reduced()) return () => {};
  let raf = 0;
  const t0 = performance.now();
  let last = 0;
  const step = (now: number) => {
    if (now - t0 > duration) return;
    if (now - last > every) {
      last = now;
      const c = centre(m.body);
      const s = rnd(3.5, 8.5);
      tinyBubble(c.x + rnd(-0.25, 0.25) * c.w, c.y + rnd(-0.25, 0.25) * c.w, s, [{ opacity: 0.95, transform: "scale(.5)" }, { opacity: 0, transform: `translate(${rnd(-5, 5)}px, ${rnd(-22, -8)}px) scale(1)` }], rnd(650, 900));
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/** Tiny bubbles bursting out of a point: `around` sends them all round, otherwise up and out. */
export function burst(x: number, y: number, n: number, opts: { spread?: number; size?: [number, number]; around?: boolean; layer?: HTMLElement } = {}) {
  if (reduced()) return;
  const [s0, s1] = opts.size ?? [3, 7];
  const spread = opts.spread ?? 36;
  for (let i = 0; i < n; i++) {
    const a = opts.around ? (i / n) * Math.PI * 2 + rnd(-0.2, 0.2) : ((-165 + (150 * i) / Math.max(1, n - 1) + rnd(-7, 7)) * Math.PI) / 180;
    const d = spread + rnd(0, spread * 0.6);
    tinyBubble(x, y, rnd(s0, s1), [{ opacity: 0, transform: "scale(.3)" }, { opacity: 1, transform: `translate(${Math.cos(a) * d * 0.45}px, ${Math.sin(a) * d * 0.45}px) scale(.9)`, offset: 0.15 }, { opacity: 0, transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d - 8}px) scale(1)` }], rnd(620, 860), opts.layer);
  }
}

// --- the moves ---------------------------------------------------------------------------------------

const rim = (m: MarkParts, from: number, to: number, duration: number, easing = "cubic-bezier(.2,.7,.2,1)") => animate(m.rim, [{ "--rim-a": `${from}deg` } as Keyframe, { "--rim-a": `${to}deg` } as Keyframe], { duration, easing });

export function blink(m: MarkParts) {
  if (reduced()) return;
  for (const e of m.es) animate(e, [{ transform: "scaleY(1)" }, { transform: "scaleY(.1)", offset: 0.45 }, { transform: "scaleY(1)" }], { duration: 170, easing: "ease-in-out" });
}

/** The eyes look to (x, y), as fractions of the mark's size, hold, and come back. */
export function glance(m: MarkParts, x: number, y: number, hold = 520) {
  if (reduced()) return;
  const t = `translate(${x * m.size}px, ${y * m.size}px)`;
  const d = hold + 520;
  animate(m.eyes, [{ transform: "none" }, { transform: t, offset: 260 / d, easing: "ease-in-out" }, { transform: t, offset: (260 + hold) / d, easing: "ease-in-out" }, { transform: "none" }], { duration: d });
}

/** Launch: in on a curve from the lower left, spinning, lands with a squash and wobble, blinks, glances back. */
export function whoosh(m: MarkParts, opts: { from?: [number, number]; onWord?: HTMLElement | null } = {}): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  if (reduced()) {
    animate(m.el, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
    if (opts.onWord) animate(opts.onWord, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
    return () => {};
  }
  const s = m.size / 76;
  const [fx0, fy0] = opts.from ?? [-190 * s, 120 * s];
  const P1 = [-70 * s, -140 * s];
  const kf: Keyframe[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, u = 1 - t;
    kf.push({ transform: `translate(${u * u * fx0 + 2 * u * t * P1[0]}px, ${u * u * fy0 + 2 * u * t * P1[1]}px)` });
  }
  animate(m.mv, kf, { duration: 900, easing: "cubic-bezier(.3,.6,.25,1)" });
  animate(m.rot, [{ transform: "rotate(-430deg)" }, { transform: "rotate(0deg)" }], { duration: 1000, easing: "cubic-bezier(.25,.7,.25,1)" });
  m.sq.style.transformOrigin = "50% 50%";
  animate(m.sq, [{ transform: "scale(.4)" }, { transform: "scale(.86,1.14)", offset: 0.3 }, { transform: "scale(1.16,.86)", offset: 0.6, easing: "ease-out" }, { transform: "scale(.93,1.07)", offset: 0.72, easing: "ease-in-out" }, { transform: "scale(1.04,.97)", offset: 0.84, easing: "ease-in-out" }, { transform: "scale(.99,1.01)", offset: 0.93 }, { transform: "scale(1)" }], { duration: 1500 });
  animate(m.el, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1 }], { duration: 900 });
  rim(m, 0, 540, 1600);
  const stopTrail = trail(m, 760);
  if (opts.onWord) animate(opts.onWord, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 0, transform: "translateY(6px)", offset: 0.55 }, { opacity: 1, transform: "none" }], { duration: 1400, easing: "ease-out" });
  timers.push(setTimeout(() => blink(m), 1650), setTimeout(() => glance(m, -0.15, -0.02), 2050), setTimeout(() => blink(m), 2850));
  return () => {
    stopTrail();
    timers.forEach(clearTimeout);
  };
}

/**
 * Working (loading, connecting): drifts, bobs and spins with a little anticipation. The returned stop
 * lets each loop finish the turn it is on, then hops once and rests; `now` cancels at once.
 */
export function working(m: MarkParts): { stop: () => Promise<void>; now: () => void } {
  if (reduced()) return { stop: async () => {}, now: () => {} };
  m.sq.style.transformOrigin = "50% 50%";
  const loops = [
    animate(m.mv, [{ transform: "translate(0,0)" }, { transform: "translate(4%,-6%)" }, { transform: "translate(0,-2%)" }, { transform: "translate(-4%,-6%)" }, { transform: "translate(0,0)" }], { duration: 2800, iterations: Infinity, easing: "ease-in-out" }),
    animate(m.rot, [{ transform: "rotate(0)" }, { transform: "rotate(-14deg)", offset: 0.16, easing: "cubic-bezier(.5,0,.3,1)" }, { transform: "rotate(374deg)", offset: 0.6, easing: "ease-out" }, { transform: "rotate(356deg)", offset: 0.74, easing: "ease-in-out" }, { transform: "rotate(360deg)", offset: 0.84 }, { transform: "rotate(360deg)" }], { duration: 1400, iterations: Infinity }),
    animate(m.sq, [{ transform: "scale(1)" }, { transform: "scale(1.08,.92)", offset: 0.16 }, { transform: "scale(.94,1.06)", offset: 0.38 }, { transform: "scale(1.05,.95)", offset: 0.6 }, { transform: "scale(1)", offset: 0.78 }, { transform: "scale(1)" }], { duration: 1400, iterations: Infinity, easing: "ease-in-out" }),
    animate(m.rim, [{ "--rim-a": "0deg" } as Keyframe, { "--rim-a": "360deg" } as Keyframe], { duration: 1400, iterations: Infinity }),
  ];
  let ended = false;
  const now = () => {
    ended = true;
    loops.forEach((a) => a.cancel());
  };
  const stop = async () => {
    if (ended) return;
    ended = true;
    for (const a of loops) {
      const it = a.effect?.getComputedTiming().currentIteration ?? 0;
      a.effect?.updateTiming({ iterations: (it ?? 0) + 1 });
    }
    loops[0].cancel();
    try {
      await loops[1].finished;
    } catch {
      return;
    }
    m.sq.style.transformOrigin = "50% 100%";
    animate(m.sq, [{ transform: "scale(1)" }, { transform: "scale(1.1,.9)", offset: 0.2 }, { transform: "scale(.94,1.07) translateY(-14%)", offset: 0.5 }, { transform: "scale(1.06,.95)", offset: 0.78 }, { transform: "scale(1)" }], { duration: 620, easing: "ease-in-out" });
    setTimeout(() => blink(m), 700);
  };
  return { stop, now };
}

/** Hover on the wordmark: a quick spin and jiggle. Ignored while one is playing. */
export function jolly(m: MarkParts) {
  if (reduced() || m.el.dataset.jolly) return;
  m.el.dataset.jolly = "1";
  m.sq.style.transformOrigin = "50% 50%";
  animate(m.rot, [{ transform: "rotate(0)" }, { transform: "rotate(-10deg)", offset: 0.12, easing: "cubic-bezier(.4,0,.2,1)" }, { transform: "rotate(378deg)", offset: 0.66, easing: "ease-out" }, { transform: "rotate(354deg)", offset: 0.82, easing: "ease-in-out" }, { transform: "rotate(360deg)" }], { duration: 640 });
  animate(m.sq, [{ transform: "scale(1)" }, { transform: "scale(1.1,.9)", offset: 0.12 }, { transform: "scale(.9,1.1)", offset: 0.4 }, { transform: "scale(1.07,.94)", offset: 0.66 }, { transform: "scale(.97,1.03)", offset: 0.82 }, { transform: "scale(1)" }], { duration: 640, easing: "ease-in-out" });
  const done = () => delete m.el.dataset.jolly;
  rim(m, 0, 270, 700).finished.then(done, done);
  if (m.size >= 24) trail(m, 260, 50);
}

/** "Great!": crouch, hop with a full spin, squash on landing and pop a few tiny bubbles. */
export function hopSpin(m: MarkParts) {
  if (reduced()) return;
  const D = 1100;
  m.sq.style.transformOrigin = "50% 100%";
  animate(m.sq, [{ transform: "scale(1)" }, { transform: "scale(1.16,.84)", offset: 0.18, easing: "cubic-bezier(.3,0,.2,1)" }, { transform: "scale(.86,1.16)", offset: 0.3, easing: "ease-out" }, { transform: "scale(1)", offset: 0.5, easing: "ease-in" }, { transform: "scale(1.2,.8)", offset: 0.7, easing: "ease-out" }, { transform: "scale(.94,1.06)", offset: 0.82, easing: "ease-in-out" }, { transform: "scale(1.03,.98)", offset: 0.92 }, { transform: "scale(1)" }], { duration: D });
  animate(m.mv, [{ transform: "translateY(0)" }, { transform: "translateY(0)", offset: 0.2, easing: "cubic-bezier(.2,.7,.4,1)" }, { transform: `translateY(${-m.size * 0.95}px)`, offset: 0.46, easing: "cubic-bezier(.6,0,.8,.4)" }, { transform: "translateY(0)", offset: 0.7 }, { transform: "translateY(0)" }], { duration: D });
  animate(m.rot, [{ transform: "rotate(0)" }, { transform: "rotate(0)", offset: 0.24, easing: "cubic-bezier(.45,0,.3,1)" }, { transform: "rotate(360deg)", offset: 0.66 }, { transform: "rotate(360deg)" }], { duration: D });
  for (const e of m.es) animate(e, [{ transform: "scaleY(1)" }, { transform: "scaleY(1)", offset: 0.22 }, { transform: "scaleY(.55)", offset: 0.34 }, { transform: "scaleY(.55)", offset: 0.62 }, { transform: "scaleY(1)", offset: 0.78 }, { transform: "scaleY(1)" }], { duration: D });
  rim(m, 0, 360, D);
  setTimeout(() => trail(m, D * 0.4, 40), D * 0.24);
  setTimeout(() => {
    const c = centre(m.body);
    burst(c.x, c.y + c.h * 0.46, 7);
  }, D * 0.7);
  setTimeout(() => blink(m), D + 450);
}

/** The old mark pops with a burst; returns once it's gone (the caller puts a new one in). */
export async function popOut(el: HTMLElement): Promise<void> {
  const c = centre(el);
  if (reduced()) {
    await animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).finished.catch(() => {});
    return;
  }
  burst(c.x, c.y, 14, { around: true, spread: c.w * 0.5 + 16, size: [3, 7] });
  await animate(el, [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(1.22)", opacity: 0.9, offset: 0.45 }, { transform: "scale(1.45)", opacity: 0 }], { duration: 170, easing: "ease-out" }).finished.catch(() => {});
}

/** A new mark spins up in place: eyes open, a little wobble. */
export function spinUp(m: MarkParts) {
  if (reduced()) {
    animate(m.el, [{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
    return;
  }
  m.sq.style.transformOrigin = "50% 50%";
  animate(m.rot, [{ transform: "rotate(-300deg)" }, { transform: "rotate(14deg)", offset: 0.7 }, { transform: "rotate(0)" }], { duration: 760, easing: "cubic-bezier(.2,.7,.3,1)" });
  animate(m.sq, [{ transform: "scale(0)" }, { transform: "scale(1.14,.9)", offset: 0.55 }, { transform: "scale(.94,1.06)", offset: 0.75 }, { transform: "scale(1.02,.98)", offset: 0.9 }, { transform: "scale(1)" }], { duration: 760, easing: "ease-out" });
  rim(m, 0, 420, 900);
  for (const e of m.es) animate(e, [{ transform: "scaleY(.08)" }, { transform: "scaleY(.08)", offset: 0.62 }, { transform: "scaleY(1)" }], { duration: 820, easing: "ease-out" });
  setTimeout(() => blink(m), 1300);
}

/** Any element (an agent's bubble) popping and spinning back up: used by the background bubbles. */
export async function popRespawn(el: HTMLElement) {
  await popOut(el);
  if (reduced()) {
    animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
    return;
  }
  animate(el, [{ transform: "scale(0) rotate(-300deg)", opacity: 1 }, { transform: "scale(1.12, .9) rotate(14deg)", offset: 0.65 }, { transform: "scale(.96, 1.04) rotate(0)", offset: 0.85 }, { transform: "none" }], { duration: 760, easing: "cubic-bezier(.2,.7,.3,1)" });
}

/**
 * Sign-in and empty screens: a gentle drift for 6 s after the person last moved, and eyes that follow
 * a mouse or trackpad (never touch). Returns the undo.
 */
export function drifter(m: MarkParts): () => void {
  if (reduced()) return () => {};
  let loop: Animation | null = null;
  let until = 0;
  let check: ReturnType<typeof setTimeout> | undefined;
  const settle = () => {
    if (!loop) return;
    const it = loop.effect?.getComputedTiming().currentIteration ?? 0;
    loop.effect?.updateTiming({ iterations: (it ?? 0) + 1 });
    loop = null;
  };
  const tick = () => {
    if (performance.now() >= until) settle();
    else check = setTimeout(tick, 500);
  };
  const wake = () => {
    if (reduced() || document.hidden) return;
    until = performance.now() + 6000;
    if (loop && loop.playState === "running") return;
    loop = animate(m.mv, [{ transform: "translate(0,0) rotate(0)" }, { transform: "translate(7%,-6%) rotate(2deg)" }, { transform: "translate(0,-10%) rotate(0)" }, { transform: "translate(-7%,-6%) rotate(-2deg)" }, { transform: "translate(0,0) rotate(0)" }], { duration: 4200, iterations: Infinity, easing: "ease-in-out" });
    clearTimeout(check);
    check = setTimeout(tick, 500);
  };
  let frame = 0;
  let pending: PointerEvent | null = null;
  const look = () => {
    frame = 0;
    const ev = pending;
    if (!ev) return;
    const r = m.body.getBoundingClientRect();
    const dx = (ev.clientX - (r.left + r.width / 2)) / 220;
    const dy = (ev.clientY - (r.top + r.height * 0.45)) / 220;
    const d = Math.hypot(dx, dy);
    const k = d > 1 ? 1 / d : 1;
    // the eyes rest glancing right, so they have more room to the left
    const x = Math.max(-0.15, Math.min(0.08, dx * k * 0.15)) * m.size;
    const y = Math.max(-0.1, Math.min(0.1, dy * k * 0.1)) * m.size;
    m.eyes.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  };
  const move = (ev: PointerEvent) => {
    if (ev.pointerType === "touch" || reduced()) return;
    wake();
    pending = ev;
    frame ||= requestAnimationFrame(look);
  };
  const leave = () => (m.eyes.style.transform = "");
  document.addEventListener("pointermove", move, { passive: true });
  document.documentElement.addEventListener("pointerleave", leave);
  wake();
  return () => {
    document.removeEventListener("pointermove", move);
    document.documentElement.removeEventListener("pointerleave", leave);
    cancelAnimationFrame(frame);
    clearTimeout(check);
    loop?.cancel();
    m.eyes.style.transform = "";
  };
}
