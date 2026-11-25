import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultAppearance } from "@wisp/core/src/appearance.ts";
import { Ghost } from "../src/components/Ghost.tsx";
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../src/theme.ts", () => ({ useMotionReduced: () => motion.reduced }));
afterEach(() => { motion.reduced = false; });
const ghost = (level: number) => renderToStaticMarkup(createElement(Ghost, { look: defaultAppearance("pip"), size: 220, speakingLevel: level }));
it("wobbles faster while speaking (bubbles have no mouth) and stays still with reduced motion", () => {
  expect(ghost(0)).not.toContain("bub-speak");
  expect(ghost(1)).toContain("bub-speak");
  motion.reduced = true;
  expect(ghost(1)).not.toContain("bub-move");
});
it("gives listening its own attentive eyes", () => {
  const html = renderToStaticMarkup(createElement(Ghost, { look: defaultAppearance("pip"), size: 220, mood: "listening", label: "Pip is listening" }));
  expect(html).toContain("bub-listen");
  expect(html).toContain('aria-label="Pip is listening"');
});
