import { describe, expect, it } from "vitest";
import { FEATURE_KEYS, FEATURE_PRESETS, resolveFeatures } from "../src/features.js";

describe("Voice calls are a core feature, not a mod", () => {
  it("is not a mod key, in either preset", () => {
    expect(FEATURE_KEYS as readonly string[]).not.toContain("voice");
    expect(FEATURE_PRESETS.simple).not.toHaveProperty("voice");
    expect(FEATURE_PRESETS.everything).not.toHaveProperty("voice");
  });
  it("ignores a stored voice key from an older workspace", () => {
    const f = resolveFeatures({ voice: false, tasks: true } as never);
    expect(f).not.toHaveProperty("voice");
    expect(f.tasks).toBe(true);
    expect(resolveFeatures({ voice: true } as never)).toEqual(resolveFeatures({}));
  });
});
