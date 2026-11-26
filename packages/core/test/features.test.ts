import { describe, expect, it } from "vitest";
import { CORE_MODS, FEATURE_KEYS, FEATURE_PRESETS, FEATURES_VERSION, resolveFeatures, upgradeStoredFeatures } from "../src/features.js";

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

describe("agents working on their own is on by default", () => {
  it("keeps Background agents, Routines and Teach a task on in Simple, and for a stored set missing them", () => {
    for (const k of CORE_MODS) {
      expect(FEATURE_PRESETS.simple[k]).toBe(true);
      expect(FEATURE_PRESETS.everything[k]).toBe(true);
      expect(resolveFeatures({ tasks: true })[k]).toBe(true);
    }
    expect(FEATURE_PRESETS.simple.tasks).toBe(false);
    expect(resolveFeatures({ background: false }).background).toBe(false);
  });
  it("turns them on once for a set stored before, unless any was chosen on", () => {
    const old = { ...FEATURE_PRESETS.simple, background: false, routines: false, teach: false };
    expect(upgradeStoredFeatures(old)).toMatchObject({ background: true, routines: true, teach: true, v: FEATURES_VERSION });
    // someone turned Routines on and left the rest off: that's a choice, kept as it is
    expect(upgradeStoredFeatures({ ...old, routines: true })).toMatchObject({ background: false, routines: true, teach: false, v: FEATURES_VERSION });
    // already upgraded (or stored since): left alone, even with them off
    expect(upgradeStoredFeatures({ ...old, v: FEATURES_VERSION })).toBeNull();
    expect(upgradeStoredFeatures(null)).toBeNull();
  });
});
