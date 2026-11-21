import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Approval, Computer } from "@wisp/core";
import { defaultAppearance } from "@wisp/core/src/appearance.ts";
import { Ghost } from "../src/components/Ghost.tsx";
import { agentMood } from "../src/ghostMood.ts";
import { activitySnapshot, subscribeActivity } from "../src/ghostActivity.ts";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../src/theme.ts", () => ({ useMotionReduced: () => motion.reduced }));
afterEach(() => { motion.reduced = false; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("work moods", () => {
  const agent = { id: "agent", computerId: "computer", status: "busy" as const };
  const computer = { id: "computer", status: "error" } as Computer;
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

describe("still ghosts", () => {
  const look = { ...defaultAppearance("ghost"), glow: true, hat: "propeller" as const };
  it.each([false, true])("stills every animation with reduced motion=%s", (reduced) => {
    motion.reduced = reduced;
    const html = renderToStaticMarkup(createElement(Ghost, { look, size: 80, mood: "working", interactive: true, animate: !reduced && false }));
    expect(html).toContain("frozen");
    expect(html).not.toContain("<animate");
  });
  it("doesn't glow, even for a look saved with glow on (the feature was removed)", () => {
    expect(renderToStaticMarkup(createElement(Ghost, { look, size: 80 }))).not.toContain("glow");
  });
});

describe("ghost family", () => {
  const look = { ...defaultAppearance("ghost"), color: "#3cc0a6", color2: undefined, hat: "none" as const, accessory: "none" as const };
  const render = (size: number, mood: Parameters<typeof Ghost>[0]["mood"] = "awake", shape = look.shape) => renderToStaticMarkup(createElement(Ghost, { look: { ...look, shape }, size, mood }));
  it("is one flat colour with two eyes and its own silhouette", () => {
    const html = render(40);
    expect(html).toContain('fill="#3cc0a6"');
    expect(html.match(/class="wisp-eye"/g)).toHaveLength(2);
    expect(html).not.toContain("Gradient");
    expect(render(40, "awake", "tall")).not.toEqual(render(40, "awake", "round"));
  });
  it("sits idle, and wakes up with a laptop and thought bubbles while working", () => {
    expect(render(40)).toContain("idle");
    expect(render(40)).not.toContain("wisp-kit");
    const working = render(80, "working");
    expect(working).toContain("working");
    expect(working).toContain("wisp-kit");
    expect(working).toContain("wisp-thoughts");
    // tiny avatars keep the laptop but drop the bubbles
    expect(render(22, "working")).toContain("wisp-kit");
    expect(render(22, "working")).not.toContain("wisp-thoughts");
  });
  it("has one mouth in the eyes' ink: flat, a smile for the pointer, pressed while working, open while talking", () => {
    const html = render(40);
    for (const m of ["m-flat", "m-smile", "m-work", "m-talk"]) expect(html).toContain(m);
    expect(html).toMatch(/class="wisp-mouth" stroke="rgba\(20,20,20,.88\)"/);
    // a mustache or a look with no mouth hides it; tiny avatars skip it
    expect(renderToStaticMarkup(createElement(Ghost, { look: { ...look, accessory: "mustache" }, size: 40 }))).not.toContain("wisp-mouth");
    expect(renderToStaticMarkup(createElement(Ghost, { look: { ...look, mouth: "none" }, size: 40 }))).not.toContain("wisp-mouth");
    expect(render(22)).not.toContain("wisp-mouth");
  });
  it("still wears its hat and neckwear, and makes room for the hat", () => {
    const worn = renderToStaticMarkup(createElement(Ghost, { look: { ...look, hat: "tophat", accessory: "bowtie" }, size: 40 }));
    expect(worn).toContain('fill="#2b2735"');
    expect(worn).toContain('fill="#e5484d"');
    expect(worn).toContain('viewBox="-4 -8 48 48"');
    expect(render(40)).toContain('viewBox="0 0 40 40"');
    const glasses = renderToStaticMarkup(createElement(Ghost, { look: { ...look, accessory: "glasses" }, size: 40 }));
    expect(glasses).toContain('stroke="#2b2735"');
  });
  it("gives white looks a family colour instead of a white ghost", () => {
    const white = renderToStaticMarkup(createElement(Ghost, { look: { ...look, color: "#ffffff", color2: "#ffffff" }, size: 40, seed: "nova" }));
    expect(white).not.toContain('fill="#ffffff"');
  });
});
