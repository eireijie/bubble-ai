import { describe, expect, it } from "vitest";
import { FEATURE_PRESETS, UNLISTED_FEATURES, resolveFeatures } from "../src/features.js";

describe("Voice calls default", () => {
  it("is on in Simple, still listed, and everything else stays off", () => {
    expect(FEATURE_PRESETS.simple.voice).toBe(true);
    expect(UNLISTED_FEATURES).not.toContain("voice");
    expect(Object.entries(FEATURE_PRESETS.simple).filter(([, v]) => v).map(([k]) => k).sort()).toEqual(["code", "voice"]);
  });
  it("is on for stored sets that never mentioned it, and an explicit off wins", () => {
    expect(resolveFeatures({ tasks: true }).voice).toBe(true);
    expect(resolveFeatures({ voice: false }).voice).toBe(false);
  });
});
