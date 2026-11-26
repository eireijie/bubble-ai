/** Ink that reads on a flat colour: near-black on the light ghost colours, white on a dark one. */
export function inkOn(color: string): string {
  const n = /^#[0-9a-fA-F]{6}$/.test(color) ? parseInt(color.slice(1), 16) : 0xffffff;
  const light = (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
  return light > 0.5 ? "#161616" : "#ffffff";
}

/** What the composer's one round button does right now. */
export type RoundAction = "send" | "stop" | "listening" | "call" | "dictate";

/**
 * Text or files: send. Nothing typed: stop while an agent works here, else start a call (its own
 * chat), else dictate (a team or a thread, where there is nobody to call).
 */
export function roundAction(s: { hasContent: boolean; dictating: boolean; working: boolean; canStop: boolean; canCall: boolean; canDictate: boolean }): RoundAction {
  if (s.dictating) return "listening";
  if (s.hasContent) return "send";
  if (s.working && s.canStop) return "stop";
  if (s.canCall) return "call";
  if (s.canDictate) return "dictate";
  return "send";
}

/** "Did 4 things": the one folded line under a reply. */
export const didThings = (n: number) => `Did ${n} ${n === 1 ? "thing" : "things"}`;
