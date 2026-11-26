import { animate, popRespawn, reduced as motionIsReduced } from "./markMotion.ts";

/*
 * Background bubbles (canvas "Bubble AI mark motion", board "Background bubbles", approved
 * 2026-11-25): a few faint glass bubbles drift in the empty space behind onboarding. The main bubble
 * (any element marked `data-bub-main`) pushes them aside, two that touch pop and new ones drift in
 * from the edges, a click on empty space pops the bubble under it, and a click on a `data-bub-pop`
 * element pops it and spins it back up (drag it to push bubbles around).
 *
 * Cost: at most 10 bubbles (7 on narrow screens), transforms only, one requestAnimationFrame loop
 * that runs only while this layer is on screen, the page is visible, motion isn't reduced, and the
 * person did something in the last 15 s. The layer's size is cached (ResizeObserver) so a frame never
 * forces a layout; measured on the canvas at about 0.02–0.04 ms a frame.
 */

const IDLE_AFTER = 15_000;
const GRACE = 1_200;
const INTERACTIVE = "button,a,input,textarea,select,label,summary,[role=button],[role=radio],[role=checkbox],[role=switch],[role=tab],[contenteditable],[data-bub-main]";

interface B {
  el: HTMLElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  born: number;
}

/**
 * Start the bubbles in `layer` (an empty, absolutely or fixed positioned box); its parent is the
 * area they react to. Plain DOM, so the desktop setup page uses it too (apps/desktop/src/mark-motion.js
 * is built from this file). Returns a function that stops them and clears them away.
 */
export function startBubbles(layer: HTMLElement, { max = 10 }: { max?: number } = {}): () => void {
  const parent = layer.parentElement;
  if (!parent) return () => {};
  const root: HTMLElement = parent;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  // the layer's box, in page coordinates (cached so a frame never forces a layout)
  let ox = 0;
  let oy = 0;
  let w = window.innerWidth;
  let h = window.innerHeight;
  const cap = () => (w < 420 ? Math.min(7, max) : max);
  let bubbles: B[] = [];
  let raf = 0;
  let last = 0;
  let onScreen = true;
  let lastInput = performance.now();
  let disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!disposed) fn();
    }, ms);
    timers.add(t);
  };
  // the main bubble being dragged, if any
  let drag: { el: HTMLElement; id: number; x0: number; y0: number; moved: boolean } | null = null;

  const place = (b: B) => (b.el.style.transform = `translate3d(${(b.x - b.r).toFixed(1)}px, ${(b.y - b.r).toFixed(1)}px, 0)`);
  const mains = () => [...root.querySelectorAll<HTMLElement>("[data-bub-main]")];

  function spawn(edge: boolean) {
    if (bubbles.length >= cap()) return;
    const r = rnd(4, 10);
    const el = document.createElement("i");
    el.className = "bgb";
    el.style.width = el.style.height = `${r * 2}px`;
    const b: B = { el, r, x: 0, y: 0, vx: 0, vy: 0, born: performance.now() };
    if (edge && !motionIsReduced()) {
      const side = Math.floor(rnd(0, 4));
      const sp = rnd(10, 18);
      if (side === 0) Object.assign(b, { x: -r, y: rnd(20, h - 20), vx: sp });
      else if (side === 1) Object.assign(b, { x: w + r, y: rnd(20, h - 20), vx: -sp });
      else if (side === 2) Object.assign(b, { x: rnd(20, w - 20), y: h + r, vy: -sp });
      else Object.assign(b, { x: rnd(20, w - 20), y: -r, vy: sp });
    } else {
      const keepOut = mains().map((e) => { const r = e.getBoundingClientRect(); return { left: r.left - ox, right: r.right - ox, top: r.top - oy, bottom: r.bottom - oy }; });
      let tries = 0;
      do {
        b.x = rnd(16, w - 16);
        b.y = rnd(16, h - 16);
        tries++;
      } while (tries < 24 && (keepOut.some((k) => b.x > k.left - 30 && b.x < k.right + 30 && b.y > k.top - 30 && b.y < k.bottom + 30) || bubbles.some((o) => Math.hypot(o.x - b.x, o.y - b.y) < o.r + r + 14)));
      if (!motionIsReduced()) {
        const a = rnd(0, Math.PI * 2);
        const sp = rnd(4, 10);
        b.vx = Math.cos(a) * sp;
        b.vy = Math.sin(a) * sp;
      }
      animate(el, [{ opacity: 0 }, { opacity: 0.55 }], { duration: 400, easing: "ease-out" });
    }
    layer.append(el);
    place(b);
    bubbles.push(b);
  }

  function pop(b: B) {
    const i = bubbles.indexOf(b);
    if (i < 0) return;
    bubbles.splice(i, 1);
    const el = b.el;
    const gone = () => el.remove();
    if (motionIsReduced()) animate(el, [{ opacity: 0.55 }, { opacity: 0 }], { duration: 200 }).finished.then(gone, gone);
    else {
      animate(el, [{ opacity: 0.8, transform: el.style.transform }, { opacity: 0, transform: `${el.style.transform} scale(1.6)` }], { duration: 150, easing: "ease-out" }).finished.then(gone, gone);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + rnd(-0.3, 0.3);
        const d = b.r + rnd(6, 12);
        const s = rnd(1.5, 3);
        const dot = document.createElement("i");
        dot.className = "bgb";
        Object.assign(dot.style, { width: `${s}px`, height: `${s}px`, opacity: "0.9", transform: `translate3d(${b.x - s / 2}px, ${b.y - s / 2}px, 0)` });
        layer.append(dot);
        const off = () => dot.remove();
        animate(dot, [{ opacity: 0.9, transform: dot.style.transform }, { opacity: 0, transform: `translate3d(${b.x - s / 2 + Math.cos(a) * d}px, ${b.y - s / 2 + Math.sin(a) * d}px, 0) scale(.4)` }], { duration: 360, easing: "ease-out" }).finished.then(off, off);
      }
    }
    later(rnd(700, 1600), () => {
      spawn(true);
      wake();
    });
  }

  function step(now: number) {
    raf = 0;
    if (!running()) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // reads first (layout is clean at the start of a frame), then writes
    const obstacles = mains().map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left - ox + r.width / 2, y: r.top - oy + r.height / 2, r: Math.min(r.width, r.height) / 2, el: e };
    });
    for (const b of bubbles) {
      b.vx += rnd(-1, 1) * 14 * dt;
      b.vy += (rnd(-1, 1) * 14 - 2) * dt;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 16) {
        const f = Math.max(16 / sp, 1 - 2.2 * dt);
        b.vx *= f;
        b.vy *= f;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      for (const o of obstacles) {
        const dx = b.x - o.x;
        const dy = b.y - o.y;
        const d = Math.hypot(dx, dy) || 1;
        const min = o.r + b.r + 3;
        if (d >= min) continue;
        const nx = dx / d;
        const ny = dy / d;
        b.x = o.x + nx * min;
        b.y = o.y + ny * min;
        const push = drag?.el === o.el ? 90 : 34;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < push) {
          b.vx += nx * (push - vn);
          b.vy += ny * (push - vn);
        }
      }
      if (b.x < b.r && b.vx < 0 && b.x > -b.r * 3) b.vx = Math.abs(b.vx) * 0.6;
      if (b.x > w - b.r && b.vx > 0 && b.x < w + b.r * 3) b.vx = -Math.abs(b.vx) * 0.6;
      if (b.y < b.r && b.vy < 0 && b.y > -b.r * 3) b.vy = Math.abs(b.vy) * 0.6;
      if (b.y > h - b.r && b.vy > 0 && b.y < h + b.r * 3) b.vy = -Math.abs(b.vy) * 0.6;
    }
    // two settled bubbles that touch pop each other
    outer: for (let i = 0; i < bubbles.length; i++)
      for (let j = i + 1; j < bubbles.length; j++) {
        const a = bubbles[i];
        const c = bubbles[j];
        if (now - a.born < GRACE || now - c.born < GRACE) continue;
        if (Math.hypot(a.x - c.x, a.y - c.y) < a.r + c.r) {
          pop(c);
          pop(a);
          break outer;
        }
      }
    bubbles.forEach(place);
    if (now - lastInput > IDLE_AFTER && !drag) return; // rest until the person does something
    raf = requestAnimationFrame(step);
  }

  const running = () => onScreen && !document.hidden && !motionIsReduced() && !disposed;
  function wake() {
    if (raf || !running()) return;
    last = performance.now();
    raf = requestAnimationFrame(step);
  }
  const activity = () => {
    lastInput = performance.now();
    wake();
  };

  function onDown(e: PointerEvent) {
    activity();
    const t = e.target as Element | null;
    if (!t || !root.contains(t)) return;
    const main = t.closest<HTMLElement>("[data-bub-pop]");
    if (main && root.contains(main)) {
      drag = { el: main, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false };
      return;
    }
    if (t.closest(INTERACTIVE)) return;
    let best: B | null = null;
    let bd = Infinity;
    for (const b of bubbles) {
      const d = Math.hypot(e.clientX - ox - b.x, e.clientY - oy - b.y);
      if (d < b.r + 7 && d < bd) {
        best = b;
        bd = d;
      }
    }
    if (best) pop(best);
  }
  function onMove(e: PointerEvent) {
    activity();
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) > 5) drag.moved = true;
    if (drag.moved) drag.el.style.translate = `${dx}px ${dy}px`;
  }
  function onUp(e: PointerEvent) {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      void popRespawn(d.el);
      // everything near it gets nudged away
      const r = d.el.getBoundingClientRect();
      const cx = r.left - ox + r.width / 2;
      const cy = r.top - oy + r.height / 2;
      for (const b of bubbles) {
        const dx = b.x - cx;
        const dy = b.y - cy;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist < 160) {
          const f = (1 - dist / 160) * 120;
          b.vx += (dx / dist) * f;
          b.vy += (dy / dist) * f;
        }
      }
      return;
    }
    // spring back home, pushing bubbles on the way
    const from = d.el.style.translate || "0px 0px";
    d.el.style.translate = "";
    if (!motionIsReduced()) animate(d.el, [{ translate: from }, { translate: "0px 0px" }], { duration: 520, easing: "cubic-bezier(.2,.9,.3,1.25)" });
    // a click event follows a drag; swallow it so a drag never counts as a click
    d.el.addEventListener("click", (ev) => ev.stopPropagation(), { capture: true, once: true });
    lastInput = performance.now();
  }

  const measure = () => {
    const r = layer.getBoundingClientRect();
    ox = r.left;
    oy = r.top;
    w = r.width || window.innerWidth;
    h = r.height || window.innerHeight;
  };
  measure();
  const ro = new ResizeObserver(measure);
  ro.observe(layer);
  const io = new IntersectionObserver((es) => {
    onScreen = es[0]?.isIntersecting ?? true;
    wake();
  });
  io.observe(layer);
  const vis = () => wake();
  document.addEventListener("visibilitychange", vis);
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  window.addEventListener("keydown", activity);

  const n = motionIsReduced() ? Math.min(6, cap()) : cap();
  for (let i = 0; i < n; i++) spawn(false);
  wake();

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    timers.forEach(clearTimeout);
    ro.disconnect();
    io.disconnect();
    document.removeEventListener("visibilitychange", vis);
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("keydown", activity);
    bubbles.forEach((b) => b.el.remove());
    bubbles = [];
  };
}
