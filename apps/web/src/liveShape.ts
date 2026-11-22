import type { LiveRun } from "./store.ts";

/**
 * Who is working where, for everything that shows it without showing the words: the same object
 * for as long as only a run's text grows. (`text` in it is whatever it was when the run last
 * changed otherwise, so read it only as "has it said anything yet".)
 */
let shapeOf: Record<string, LiveRun> | null = null;
let shape: Record<string, LiveRun> = {};
function sameShape(a: Record<string, LiveRun>, b: Record<string, LiveRun>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const k of keys) {
    const x = a[k], y = b[k];
    if (!y) return false;
    if (x === y) continue;
    if (x.agentId !== y.agentId || x.channelId !== y.channelId || x.threadId !== y.threadId || x.threadPath !== y.threadPath || x.tools !== y.tools || x.last !== y.last || x.usedComputer !== y.usedComputer || !x.text !== !y.text) return false;
  }
  return true;
}
export function liveShape(s: { live: Record<string, LiveRun> }): Record<string, LiveRun> {
  if (s.live !== shapeOf) {
    if (!sameShape(shape, s.live)) shape = s.live;
    shapeOf = s.live;
  }
  return shape;
}
