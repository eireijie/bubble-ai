import { describe, expect, it } from "vitest";
import { recommendedSetup } from "./onboardingPlan.ts";

describe("recommendedSetup", () => {
  it("builds a morning plan from What I do and the work page 3 found", () => {
    const r = recommendedSetup("Sam Lee", "Helps with your inbox and research, so you have more time.", [{ group: "Work", text: "Lighthouse" }, { group: "You", text: "Email: x@y.z" }]).routine!;
    expect(r.schedule).toBe("0 8 * * *");
    expect(r.steps).toContain("message Sam in your chat");
    expect(r.steps).toContain("What they want help with: your inbox and research.");
    expect(r.steps).toContain("What they're working on: Lighthouse.");
    expect(r.steps).not.toContain("x@y.z");
  });
  it("reads the role line from what page 3 found", () => {
    expect(recommendedSetup("Sam", "Help with kodi, and whatever else you need.", []).routine!.steps).toContain("What they want help with: kodi.");
  });
  it("makes nothing up when it knows no goal and no work", () => {
    expect(recommendedSetup("Sam", "Helps with whatever you need, so you have more time.", [{ group: "You", text: "You're Sam" }]).routine).toBeNull();
  });
});
