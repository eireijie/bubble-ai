import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultAppearance, newBubbleLook, shuffleBubbleLook, type GhostAppearance } from "@bubble-ai/core/src/appearance.ts";
import { Bubble, bubbleParts } from "./Bubble.tsx";
import { LOOK, RESTING_GAZE } from "./bubbleMotion.ts";
import { withParts } from "../views/LookEditor.tsx";
import { harnessChoices } from "../views/AgentSettings.tsx";

vi.mock("../theme.ts", () => ({ motionReduced: () => false, useMotionReduced: () => false }));

const html = (look: Partial<GhostAppearance> & { color: string }, size = 120) => renderToStaticMarkup(createElement(Bubble, { look, size, seed: "nova" }));

describe("what a bubble wears", () => {
  it("draws eyes, mouth, hat, accessory and motion only for looks saved with parts", () => {
    // an old look (a ghost's leftovers) keeps showing plain eyes and nothing worn
    const old = { ...defaultAppearance("nova"), hat: "crown" as const, mouth: "smile" as const, accessory: "bowtie" as const };
    const plain = html(old);
    expect(plain).not.toContain("bub-hat");
    expect(plain).not.toContain("bub-hatted");
    expect(plain).not.toContain("bub-ink-line");
    expect(plain).toContain("bub-eyes-dots");
    // the same look from the new editor wears all of it
    const dressed = html({ ...old, parts: true, eyes: "happy", motion: "sway" });
    expect(dressed).toContain("bub-hatted");
    expect(dressed).toContain("bub-hat");
    expect(dressed).toContain("bub-ink-line");
    expect(dressed).toContain("bub-arc");
    expect(dressed).toContain("bub-m-sway");
  });

  it("keeps hats and neckwear on the body, so they move with it", () => {
    const out = html({ ...newBubbleLook(), hat: "tophat", accessory: "bowtie" });
    const body = out.indexOf('class="bub-w"');
    expect(body).toBeGreaterThan(-1);
    // both drawn inside the body's wrapper, which carries the wobble, hop and spin
    expect(out.indexOf("bub-hat", body)).toBeGreaterThan(body);
    expect(out.indexOf("#e5484d", body)).toBeGreaterThan(body);
  });

  it("leaves worn things off tiny bubbles", () => {
    const out = html({ ...newBubbleLook(), hat: "crown", mouth: "smile" }, 16);
    expect(out).not.toContain("bub-hat");
    expect(out).not.toContain("bub-ink-line");
  });

  it("starts new agents round, plain and without a mouth; shuffle never adds a mouth", () => {
    expect(newBubbleLook(() => 0)).toMatchObject({ bubble: "round", parts: true, eyes: "dots", mouth: "none", hat: "none", accessory: "none", motion: "float" });
    for (let i = 0; i < 50; i++) expect(shuffleBubbleLook().mouth).toBe("none");
  });

  it("opens an old look in the editor as it looks today", () => {
    const old = { ...defaultAppearance("nova"), hat: "witch" as const };
    const ready = withParts(old, "nova");
    expect(ready.parts).toBe(true);
    expect(bubbleParts(ready)).toEqual({ eyes: "dots", mouth: "none", hat: "none", accessory: "none", motion: "float" });
    // a look already from the editor is left as it is
    const mine = { ...newBubbleLook(), hat: "crown" as const };
    expect(withParts(mine)).toEqual(mine);
  });
});

describe("idle eyes", () => {
  it("rest to one side, never straight ahead", () => {
    for (const [x] of RESTING_GAZE) expect(Math.abs(x)).toBeGreaterThan(0.3);
  });
  it("glance across or back, and only ever level or a little up, never down", () => {
    for (const [, y] of LOOK) expect(parseFloat(y)).toBeLessThanOrEqual(0);
  });
});

describe("changing an agent's AI", () => {
  const agent = { harness: "codex", computerId: null, settings: {} };
  it("offers what is installed where it runs, and keeps its own", () => {
    expect(harnessChoices(agent, { harnesses: [{ id: "claude-code", version: null }, { id: "codex", version: null }, { id: "custom", version: null }] })).toEqual(["claude-code", "codex"]);
    expect(harnessChoices({ ...agent, harness: "hermes" }, { harnesses: [{ id: "codex", version: null }] })).toEqual(["codex", "hermes"]);
  });
  it("inside its own computer, offers what that computer has", () => {
    const inVm = { harness: "codex", computerId: "vm1", settings: { runIn: "computer" as const } };
    expect(harnessChoices(inVm, { harnesses: [], vmSignIns: { vm1: { "claude-code": true, codex: null } } })).toEqual(["claude-code", "codex"]);
    // not reported yet: the ones every computer comes with
    expect(harnessChoices(inVm, { harnesses: [] })).toEqual(["claude-code", "codex", "hermes", "kimi"]);
  });
});
