import { describe, expect, it } from "vitest";
import { GOALS, roleLine } from "../../onboardingV3.ts";

describe("roleLine", () => {
  it("reads naturally for every single pick", () => {
    for (const g of GOALS) {
      const line = roleLine([g.id], "", []);
      expect(line).toMatch(/^Helps with [a-z].*, so you have more time\.$/);
      expect(line).not.toMatch(/spend less time on (them|it)/);
    }
  });
  it("lists up to three picks", () => {
    expect(roleLine(["email", "cal", "research"], "", [])).toBe("Helps with your inbox, your calendar and research, so you have more time.");
  });
  it("uses the person's own words when nothing is picked", () => {
    expect(roleLine([], "plan my trip.", [])).toBe("Plan my trip, and whatever else you need.");
  });
});
