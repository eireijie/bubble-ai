import { describe, expect, it, vi } from "vitest";

vi.mock("../src/theme.ts", () => ({ motionReduced: () => false }));
const { restingGaze, RESTING_GAZE } = await import("../src/components/bubbleMotion.ts");

describe("where an idle bubble's eyes rest", () => {
  it("is never dead centre: to one side, or to the side and a little up", () => {
    for (const [x, y] of RESTING_GAZE) {
      expect(Math.abs(x)).toBeGreaterThan(0.3);
      expect(y).toBeLessThanOrEqual(0);
    }
  });

  it("is the same every time for an agent, and a list of agents doesn't all look one way", () => {
    expect(restingGaze("agt_loTPuGwTztIX")).toEqual(restingGaze("agt_loTPuGwTztIX"));
    const ways = new Set(["agt_a", "agt_b", "agt_c", "agt_d", "agt_e", "agt_f", "agt_g", "agt_h"].map((id) => restingGaze(id).join()));
    expect(ways.size).toBeGreaterThanOrEqual(3);
  });

  it("matches the iPhone's pick (FNV-1a of the id, then the table in order)", () => {
    // the empty id hashes to the FNV offset basis, so this pins the hash and the table order
    expect(restingGaze("")).toEqual(RESTING_GAZE[0x811c9dc5 % 4]);
  });
});
