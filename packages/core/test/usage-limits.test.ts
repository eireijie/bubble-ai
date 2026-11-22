import { describe, expect, it } from "vitest";
import { limitProblem, planState, smallestModel } from "../src/usage-limits.ts";

const now = new Date("2026-11-22T15:00:00Z");

describe("a harness saying its plan is used up", () => {
  it("reads the reset time each harness gives", () => {
    // Claude Code: seconds since 1970 after a bar
    expect(limitProblem("Claude AI usage limit reached|1795453200", now)).toEqual({ resetsAt: new Date(1795453200 * 1000).toISOString() });
    // Codex: how long from now
    expect(limitProblem("You've hit your usage limit. Upgrade to Pro, or try again in 3 hours 12 minutes.", now)).toEqual({ resetsAt: "2026-11-22T18:12:00.000Z" });
    expect(limitProblem("You've hit your usage limit. Try again in 2 days 1 hour.", now)).toEqual({ resetsAt: "2026-11-24T16:00:00.000Z" });
    expect(limitProblem("Rate limit reached for requests. Please try again in 20s.", now)).toEqual({ resetsAt: "2026-11-22T15:00:20.000Z" });
    // a clock time, on the person's clock unless the message names a zone
    expect(limitProblem("You've hit your limit · resets 5pm", now, "America/New_York")).toEqual({ resetsAt: "2026-11-22T22:00:00.000Z" });
    expect(limitProblem("5-hour limit reached ∙ resets 3:30am (Europe/Berlin)", now, "America/New_York")).toEqual({ resetsAt: "2026-11-23T02:30:00.000Z" });
    // a date
    expect(limitProblem("You've hit your usage limit. Try again at Nov 25th, 2026 9:05 AM.", now, "UTC")).toEqual({ resetsAt: "2026-11-25T09:05:00.000Z" });
  });

  it("knows a limit with no reset time, and a time already past, as 'not said'", () => {
    expect(limitProblem("429 Too Many Requests", now)).toEqual({ resetsAt: null });
    expect(limitProblem("Your credit balance is too low to access the API.", now)).toEqual({ resetsAt: null });
    expect(limitProblem("insufficient_quota: You exceeded your current quota", now)).toEqual({ resetsAt: null });
    expect(limitProblem("Claude AI usage limit reached|1700000000", now)).toEqual({ resetsAt: null });
  });

  it("leaves other failures alone, Wisp's own limits included", () => {
    expect(limitProblem("Failed to authenticate: OAuth session expired and could not be refreshed", now)).toBeNull();
    expect(limitProblem("spawn codex ENOENT", now)).toBeNull();
    expect(limitProblem("channel rate limit reached", now)).toBeNull();
    expect(limitProblem("", now)).toBeNull();
  });
});

describe("how full a plan is", () => {
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();

  it("lets unattended work run under the reserve", () => {
    expect(planState(null, now)).toEqual({ ok: true, full: false, window: null });
    expect(planState({ window: "5-hour", usedFraction: 0.5, resetsAt: at(2) }, now).ok).toBe(true);
  });

  it("stops at the reserve and waits for the window that's over it", () => {
    const weekly = { window: "weekly", usedFraction: 0.4, resetsAt: at(90) };
    const five = { window: "5-hour", usedFraction: 0.93, resetsAt: at(2) };
    expect(planState({ ...five, windows: [five, weekly] }, now)).toEqual({ ok: false, full: false, window: five });
    // a full window wins over one that's only nearly full, whenever it resets
    const full = { window: "weekly", usedFraction: 1, resetsAt: at(90) };
    expect(planState({ ...five, windows: [five, full] }, now)).toEqual({ ok: false, full: true, window: full });
  });

  it("counts a window that has reset since the report as empty", () => {
    expect(planState({ window: "5-hour", usedFraction: 1, resetsAt: at(-1) }, now).ok).toBe(true);
  });
});

describe("the smallest model a harness offers", () => {
  it("goes by name first, then by what the description says", () => {
    expect(smallestModel([{ id: "fable", label: "Fable" }, { id: "opus", label: "Opus" }, { id: "haiku", label: "Haiku", description: "Quickest and cheapest" }])).toBe("haiku");
    expect(smallestModel([{ id: "gpt-6.1-terra", label: "GPT-6.1 Terra", description: "Efficient model" }, { id: "gpt-6-luna", label: "GPT-6-Luna", description: "Fast and affordable model for easier tasks." }, { id: "gpt-5.6-luna", label: "GPT-5.6-Luna" }])).toBe("gpt-6-luna");
    expect(smallestModel([{ id: "gpt-9", label: "GPT-9" }, { id: "gpt-9-mini", label: "GPT-9 mini" }, { id: "gpt-9-nano", label: "GPT-9 nano" }])).toBe("gpt-9-nano");
    expect(smallestModel([{ id: "a", label: "Big" }, { id: "b", label: "Other", description: "A fast model for simple work" }])).toBe("b");
  });

  it("says nothing when none looks small", () => {
    expect(smallestModel([{ id: "big", label: "Big" }])).toBeUndefined();
    expect(smallestModel([])).toBeUndefined();
  });
});
