import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Approval, Computer } from "@bubble-ai/core";
import { defaultAppearance } from "@bubble-ai/core/src/appearance.ts";
import { Ghost } from "../src/components/Ghost.tsx";
import { agentMood } from "../src/ghostMood.ts";
import { activitySnapshot, subscribeActivity } from "../src/ghostActivity.ts";
import { Bubble } from "../src/components/Bubble.tsx";
import { bubbleMotionState, liteEyes } from "../src/components/bubbleMotion.ts";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../src/theme.ts", () => ({ useMotionReduced: () => motion.reduced, motionReduced: () => motion.reduced }));
afterEach(() => { motion.reduced = false; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("work moods", () => {
  const agent = { id: "agent", computerId: "computer", status: "busy" as const, settings: { runIn: "computer" as const } };
  const computer = { id: "computer", kind: "vm", status: "error" } as Computer;
  const pending = { id: "approval", agentId: agent.id, status: "pending" } as Approval;

  it("shows the current work, request, or computer failure and clears resolved signals", () => {
    expect(agentMood(agent, {}, [])).toBe("working");
    expect(agentMood(agent, {}, [computer])).toBe("error");
    expect(agentMood(agent, { approval: pending }, [computer])).toBe("waiting");
    expect(agentMood(agent, { approval: { ...pending, status: "approved" } }, [{ ...computer, status: "ready" }])).toBe("working");
    expect(agentMood({ ...agent, status: "online" }, {}, [])).toBe("awake");
  });

  it("keeps offline and paused agents asleep and ignores other agents' signals", () => {
    expect(agentMood({ ...agent, status: "offline" }, { approval: pending }, [computer])).toBe("asleep");
    expect(agentMood(agent, { approval: pending }, [{ ...computer, paused: true }])).toBe("asleep");
    expect(agentMood({ ...agent, id: "other", computerId: null }, { approval: pending }, [computer])).toBe("working");
  });

  it("only looks troubled when a broken computer blocks the agent's work", () => {
    // its AI tool runs on the device: it keeps chatting while the (shared) computer is broken
    expect(agentMood({ ...agent, settings: {} }, {}, [computer])).toBe("working");
    expect(agentMood({ ...agent, status: "online", settings: { runIn: "device" } }, {}, [computer])).toBe("awake");
    // its AI tool runs inside that VM: nothing works until it starts
    expect(agentMood({ ...agent, status: "online" }, {}, [computer])).toBe("error");
  });
});

describe("shared page activity", () => {
  it("dozes after three minutes, wakes on input, and cleans up after the last ghost", () => {
    vi.useFakeTimers();
    const page = new EventTarget();
    vi.stubGlobal("window", page);
    const first = vi.fn(), second = vi.fn();
    const stopFirst = subscribeActivity(first), stopSecond = subscribeActivity(second);
    try {
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(170_000);
      page.dispatchEvent(new Event("pointermove"));
      expect(first).not.toHaveBeenCalled();
      vi.advanceTimersByTime(179_999);
      expect(activitySnapshot()).toBe("active");
      vi.advanceTimersByTime(1);
      expect(activitySnapshot()).toBe("idle");
      expect(first).toHaveBeenCalledTimes(1);
      stopFirst();
      page.dispatchEvent(new Event("keydown"));
      expect(activitySnapshot()).toBe("waking");
      vi.advanceTimersByTime(600);
      expect(activitySnapshot()).toBe("active");
      expect(second).toHaveBeenCalledTimes(3);
      vi.advanceTimersByTime(179_400);
      expect(activitySnapshot()).toBe("idle");
      page.dispatchEvent(new Event("pointerdown"));
      expect(activitySnapshot()).toBe("waking");
    } finally {
      stopFirst();
      stopSecond();
    }
    expect(vi.getTimerCount()).toBe(0);
    expect(activitySnapshot()).toBe("active");
  });
});

describe("still bubbles", () => {
  const look = { ...defaultAppearance("ghost"), bubble: "egg" as const };
  it.each([false, true])("has no motion with reduced motion=%s (or animate off)", (reduced) => {
    motion.reduced = reduced;
    const html = renderToStaticMarkup(createElement(Ghost, { look, size: 80, mood: "working", interactive: true, animate: !reduced && false }));
    expect(html).not.toContain("bub-move");
    expect(renderToStaticMarkup(createElement(Ghost, { look, size: 80, mood: "working", animate: true })).includes("bub-move")).toBe(!reduced);
  });
});

describe("bubbles (2026-11-25)", () => {
  const render = (props: Partial<Parameters<typeof Ghost>[0]> = {}) => renderToStaticMarkup(createElement(Ghost, { look: { ...defaultAppearance("pip"), color: "#6cc4ff", color2: undefined }, size: 40, ...props }));
  it("draws an old saved look as a Round bubble in its own colour", () => {
    const html = render();
    expect(html).toContain("bub-round");
    expect(html).toContain("--bub-c:#6cc4ff");
    expect(html).not.toContain("<svg");
  });
  it("draws each of the eight shapes", () => {
    for (const shape of ["round", "squircle", "egg", "drop", "blob", "capsule", "double", "cluster"] as const) expect(render({ look: { ...defaultAppearance("pip"), bubble: shape } })).toContain(`bub-${shape}`);
  });
  it("shows its mood: working bobs, needs you gets the orange dot, asleep is greyed", () => {
    expect(render({ mood: "working" })).toContain("bub-work");
    expect(render({ mood: "waiting" })).toContain("bub-need");
    expect(render({ mood: "asleep" })).toContain("bub-sleep");
    expect(render({ mood: "error" })).toContain("bub-error");
  });
  it("has two eyes and no mouth", () => {
    const html = render();
    expect(html.match(/bub-e bub-e[12]/g)).toHaveLength(2);
    expect(html).not.toMatch(/mouth/);
  });
  it("is hidden from screen readers with an empty label", () => {
    expect(render({ label: "" })).toContain('aria-hidden="true"');
    expect(render({ label: "Pip" })).toContain('aria-label="Pip"');
  });
});

describe("onboarding shares the app's bubble", async () => {
  const { OnboardingGhost } = await import("../src/components/onboarding/OnboardingGhost.tsx");
  it("draws the same bubble, violet, and bobs while it works", () => {
    const html = renderToStaticMarkup(createElement(OnboardingGhost, { size: 140 }));
    expect(html).toContain('class="bub ');
    expect(html).toContain("--bub-c:#a59bff");
    expect(renderToStaticMarkup(createElement(OnboardingGhost, { size: 140, working: true }))).toContain("bub-work");
  });
});

describe("cheap small bubbles (2026-11-25 speed pass)", () => {
  const look = { ...defaultAppearance("nova"), bubble: "round" as const };
  const html = (size: number, mood?: "awake" | "working") => renderToStaticMarkup(createElement(Bubble, { look, seed: "nova", size, mood }));

  it("holds small bubbles still except their eyes; big ones keep every loop", () => {
    expect(html(40)).toContain("bub-lite");
    expect(html(70)).toContain("bub-lite");
    expect(html(132)).not.toContain("bub-lite");
    expect(html(132)).toContain("bub-move");
    motion.reduced = true;
    expect(html(40)).not.toContain("bub-lite");
    expect(html(40)).not.toContain("bub-move");
  });

  function fakeBubble() {
    const eyes = [{ animate: vi.fn() }, { animate: vi.fn() }];
    const props = new Map<string, string>();
    const el = {
      dataset: {} as Record<string, string>,
      style: { setProperty: (k: string, v: string) => props.set(k, v), removeProperty: (k: string) => props.delete(k) },
      querySelectorAll: () => eyes,
    };
    return { el: el as unknown as HTMLElement, eyes, props, raw: el };
  }

  it("blinks and glances from one shared timer, skips bubbles off screen, and stops when done", () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { hidden: false });
    const a = fakeBubble();
    const b = fakeBubble();
    b.raw.dataset.off = "";
    const undoA = liteEyes(a.el, { sleepy: false, glances: true });
    const undoB = liteEyes(b.el, { sleepy: false, glances: true });
    expect(bubbleMotionState()).toEqual({ lite: 2, timer: true });
    vi.advanceTimersByTime(20_000);
    expect(a.eyes[0].animate).toHaveBeenCalled();
    expect(a.props.has("--gx")).toBe(true);
    expect(b.eyes[0].animate).not.toHaveBeenCalled();
    undoA();
    undoB();
    expect(a.props.has("--gx")).toBe(false);
    expect(bubbleMotionState()).toEqual({ lite: 0, timer: false });
  });

  it("does nothing with reduced motion or while the page is hidden", () => {
    vi.useFakeTimers();
    const a = fakeBubble();
    vi.stubGlobal("document", { hidden: true });
    const undo = liteEyes(a.el, { sleepy: true, glances: true });
    vi.advanceTimersByTime(30_000);
    vi.stubGlobal("document", { hidden: false });
    motion.reduced = true;
    vi.advanceTimersByTime(30_000);
    expect(a.eyes[0].animate).not.toHaveBeenCalled();
    expect(a.props.size).toBe(0);
    undo();
  });
});
