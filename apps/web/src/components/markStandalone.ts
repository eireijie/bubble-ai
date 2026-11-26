/*
 * The mark's motion and the background bubbles for pages that run before the app does (the desktop
 * setup page). `node apps/desktop/scripts/build-mark-motion.mjs` bundles this into
 * apps/desktop/src/mark-motion.js (window.BubbleMark) and copies mark.css beside it; a test checks the
 * copies match, so change the motion here, never in the copies.
 */
export { blink, burst, drifter, glance, hopSpin, jolly, markParts, popRespawn, spinUp, whoosh, working } from "./markMotion.ts";
export { startBubbles } from "./bubbles.ts";

/** The mark's layers as plain DOM, the same as MotionMark.tsx draws them. */
export function makeMark(size: number): HTMLElement {
  const el = document.createElement("span");
  el.className = size <= 32 ? "mk mk-small" : "mk";
  el.setAttribute("aria-hidden", "true");
  el.dataset.bubMain = "";
  el.style.setProperty("--mk-s", `${size}px`);
  el.style.setProperty("--mk-rim", `${size > 32 ? Math.max(1.5, size * 0.03) : size * 0.08}px`);
  el.innerHTML = '<span class="mk-mv"><span class="mk-rot"><span class="mk-sq"><span class="mk-b"><i class="mk-glass"></i><i class="mk-rim"></i><i class="mk-hl"></i><span class="mk-eyes"><i class="mk-e"></i><i class="mk-e"></i></span></span></span></span></span>';
  return el;
}
