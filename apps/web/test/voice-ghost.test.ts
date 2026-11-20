import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultAppearance } from "@wisp/core/src/appearance.ts";
import { Ghost } from "../src/components/Ghost.tsx";
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../src/theme.ts", () => ({ useMotionReduced: () => motion.reduced }));
afterEach(() => { motion.reduced = false; });
const ghost = (level: number) => renderToStaticMarkup(createElement(Ghost, { look: defaultAppearance("pip"), size: 220, speakingLevel: level }));
it("moves with speech amplitude and keeps still with reduced motion", () => {
  expect(ghost(0)).not.toEqual(ghost(1));
  motion.reduced = true;
  expect(ghost(0)).toEqual(ghost(1));
});
it("names the ghost for screen readers while it listens", () => {
  const html = renderToStaticMarkup(createElement(Ghost, { look: defaultAppearance("pip"), size: 220, mood: "listening", label: "Pip is listening" }));
  expect(html).toContain('aria-label="Pip is listening"');
});
