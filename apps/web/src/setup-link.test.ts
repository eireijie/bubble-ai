import { describe, expect, it } from "vitest";
import { setupCodeFromHash } from "./setup-link.ts";

describe("setup link", () => {
  it("reads the setup code from #/setup/<code>", () => {
    expect(setupCodeFromHash("#/setup/k7qm-29xd-hp4c")).toBe("k7qm-29xd-hp4c");
  });
  it("is empty for other links", () => {
    expect(setupCodeFromHash("")).toBe("");
    expect(setupCodeFromHash("#/join/abc")).toBe("");
    expect(setupCodeFromHash("#/welcome/intro")).toBe("");
  });
});
