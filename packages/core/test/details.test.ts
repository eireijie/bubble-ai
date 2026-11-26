import { describe, expect, it } from "vitest";
import { splitDetails, withDetails } from "../src/harnesses.ts";

describe("plain words with the raw log behind them", () => {
  it("travel as one message and come apart again", () => {
    const msg = withDetails("Codex didn't install.", "npm error code E500\nnpm error boom\n");
    expect(splitDetails(msg)).toEqual({ text: "Codex didn't install.", details: "npm error code E500\nnpm error boom" });
  });

  it("leave a message with no log as it was", () => {
    expect(withDetails("Codex didn't install.", "  ")).toBe("Codex didn't install.");
    expect(splitDetails("Mac is paused")).toEqual({ text: "Mac is paused", details: null });
  });
});
