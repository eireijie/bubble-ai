import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultAppearance } from "@wisp/core/src/appearance.ts";
import { Ghost } from "../src/components/Ghost.tsx";
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../src/theme.ts", () => ({ useMotionReduced: () => motion.reduced }));
afterEach(() => { motion.reduced = false; });
const ghost = (level: number) => renderToStaticMarkup(createElement(Ghost, { look: defaultAppearance("pip"), size: 220, speakingLevel: level }));
it("moves with speech amplitude and opens its mouth, and keeps the body still with reduced motion", () => {
  expect(ghost(0)).not.toEqual(ghost(1));
  expect(ghost(1)).toContain("talking");
  expect(ghost(0)).not.toContain("talking");
  motion.reduced = true;
  // the mouth still shows it is talking (held open by CSS), but the body doesn't move
  expect(ghost(1)).toContain("talking");
  expect(ghost(1)).not.toMatch(/scale\(/);
});
it("names the ghost for screen readers while it listens", () => {
  const html = renderToStaticMarkup(createElement(Ghost, { look: defaultAppearance("pip"), size: 220, mood: "listening", label: "Pip is listening" }));
  expect(html).toContain('aria-label="Pip is listening"');
});
