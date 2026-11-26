import { describe, expect, it, vi } from "vitest";
import { FEATURE_KEYS } from "@bubble-ai/core";

vi.mock("../theme.ts", () => ({ motionReduced: () => false, THEMES: [], useAppearance: () => ({}) }));
const { modWhere } = await import("./MarketplaceView.tsx");
const { usageText } = await import("./AgentBackground.tsx");

describe("plain words", () => {
  it("says where every mod lives once it's on", () => {
    for (const k of FEATURE_KEYS) expect(modWhere(k)).toMatch(/\S/);
    expect(modWhere("background")).toBe("Each agent, under More");
    expect(modWhere("storage")).toBe("In Settings › Drives and folders");
    expect(modWhere("code")).toBe("In Code");
  });

  it("says what background checks used without jargon, or nothing", () => {
    const none = { lastTokens: null, todayTokens: null, weekTokens: null, checksToday: 0, capReached: false };
    expect(usageText(none, null)).toBe("");
    expect(usageText({ ...none, checksToday: 1 }, null)).toBe("1 check today");
    expect(usageText({ ...none, checksToday: 3, todayTokens: 410_000 }, 24)).toBe("3 of 24 checks today · 410k tokens today");
    expect(usageText({ ...none, checksToday: 2 }, null)).not.toMatch(/harness|reported/);
  });
});
