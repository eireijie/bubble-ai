import type { GhostAppearance } from "@wisp/core/src/appearance.ts";
import { FAMILY_COLORS } from "../../ghostFamily.ts";
import { ClassicGhost } from "./ClassicGhost.tsx";

export const ONBOARDING_VIOLET = FAMILY_COLORS[0];

/** The mouth and its talking oval (canvas Avatar, mouth C), for the new-family ghosts some steps still draw (AgentStep). */
export const ONBOARDING_GHOST_STYLE = `
.hello-ghost .hello-mouth { transition: d .22s cubic-bezier(.32,.72,0,1), opacity .15s ease; }
.hello-ghost .hello-talk { transform-box: fill-box; transform-origin: center; opacity: 0; animation: hello-talk .62s ease-in-out infinite; }
.hello-ghost.talking .hello-talk { opacity: 1; }
.hello-ghost.talking .hello-mouth { opacity: 0; }
@keyframes hello-talk { 0%,100% { transform: scaleY(.3); } 30% { transform: scaleY(1); } 55% { transform: scaleY(.45); } 78% { transform: scaleY(.85); } }
@media (prefers-reduced-motion: reduce) {
  .hello-ghost .hello-talk { animation: none; transform: scaleY(.6); }
  .hello-ghost .hello-mouth { transition: none; }
}`;

/** Onboarding's wisp: the classic ghost, violet. */
const ONBOARDING_LOOK: GhostAppearance = { shape: "classic", color: ONBOARDING_VIOLET, eyes: "dots", mouth: "smile", cheeks: false, hat: "none", accessory: "none", motion: "float" };

/**
 * The first wisp of onboarding, drawn as the classic ghost (ClassicGhost) with calm motion: it
 * floats, blinks, turns toward the cursor with a smile when it comes near, talks while `talking`,
 * and with `working` looks down at a small laptop. `follow={false}` keeps small copies (chat
 * bubbles) from tracking the pointer.
 */
export function OnboardingGhost({
  size = 128,
  talking = false,
  smiling = false,
  hop = false,
  working = false,
  follow = true,
  look,
}: {
  size?: number;
  talking?: boolean;
  smiling?: boolean;
  hop?: boolean;
  working?: boolean;
  follow?: boolean;
  /** the agent's own look once it's picked (Make me yours); violet before that */
  look?: GhostAppearance;
}) {
  return <ClassicGhost look={look ?? ONBOARDING_LOOK} size={size} talking={talking} smiling={smiling} hop={hop} working={working} trackPointer={follow} />;
}
