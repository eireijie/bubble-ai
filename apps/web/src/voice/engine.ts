/** Which engine hears the person, from what actually works here. Kept free of window access so it can be tested. */
export type ListenChoice = "device" | "openai";

export interface ListenInput {
  /** what is saved in Voice settings */
  chosen: ListenChoice;
  /** running inside the desktop app (Electron has no speech service behind the browser's recognition) */
  desktop: boolean;
  /** this browser offers built-in speech recognition */
  recognition: boolean;
  /** an OpenAI key is saved */
  hasKey: boolean;
}
export interface ListenPlan {
  engine: ListenChoice;
  /** set when nothing can hear the person yet: what to set up, in plain words */
  problem: string | null;
}

export const NEEDS_KEY_DESKTOP = "Wisp can't hear you yet. Add your OpenAI key in Settings → Voice so calls can listen.";
export const NEEDS_KEY_BROWSER = "This browser can't listen on its own. Add your OpenAI key in Settings → Voice, or open Wisp in Chrome or Safari.";

export function planListening({ chosen, desktop, recognition, hasKey }: ListenInput): ListenPlan {
  const device = !desktop && recognition;
  // OpenAI only when a key is there; the saved choice never forces a listener that can't work
  if (chosen === "openai" && hasKey) return { engine: "openai", problem: null };
  if (device) return { engine: "device", problem: null };
  if (hasKey) return { engine: "openai", problem: null };
  return { engine: chosen, problem: desktop ? NEEDS_KEY_DESKTOP : NEEDS_KEY_BROWSER };
}
