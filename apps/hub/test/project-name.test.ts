import { describe, expect, it } from "vitest";
import { projectName } from "../src/memory-import.ts";

describe("projectName", () => {
  it("puts every line about one project under one name", () => {
    expect(projectName("Bubble AI: an agents app")).toBe("Bubble AI");
    expect(projectName("Bubble AI, formerly Warren, provides agents")).toBe("Bubble AI");
    expect(projectName("Bubble AI's immediate work is fixing sign-in")).toBe("Bubble AI");
    expect(projectName("Bubble AI lives in /Users/me/kodi")).toBe("Bubble AI");
    expect(projectName("Hotel Reconciliation Center's documented Windows run")).toBe("Hotel Reconciliation Center");
    expect(projectName("Instant Tracker manages scratch-off inventory")).toBe("Instant Tracker");
    expect(projectName("Garden sensor - a Pi in the shed")).toBe("Garden sensor");
  });
  it("gives none for a line that names nothing", () => {
    expect(projectName("next step is shipping v1")).toBeNull();
  });
});
