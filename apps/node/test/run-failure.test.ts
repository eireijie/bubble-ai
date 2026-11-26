import { describe, expect, it } from "vitest";
import { runFailed, withReason } from "../src/run-failure.ts";

describe("a failed run's report", () => {
  it("says the harness isn't installed when its program can't be started", () => {
    expect(runFailed("r1", "spawn claude ENOENT", "claude-code")).toEqual({ type: "run_failed", runId: "r1", error: "spawn claude ENOENT", reason: "not_installed" });
    expect(runFailed("r1", "/bin/sh: codex: command not found", "codex").reason).toBe("not_installed");
  });

  it("tells a sign-in, a device that can't run it, a usage limit and anything else apart", () => {
    expect(runFailed("r", "Invalid API key · Please run /login", "claude-code").reason).toBe("signed_out");
    expect(runFailed("r", "box is paused; ask again once someone resumes it there").reason).toBe("no_device");
    expect(runFailed("r", "agent is not assigned to this node").reason).toBe("no_device");
    expect(runFailed("r", "Claude AI usage limit reached|1764000000", "claude-code").reason).toBe("limit");
    expect(runFailed("r", "harness crashed", "codex").reason).toBe("error");
  });

  it("keeps a reason already given, and fills one in otherwise", () => {
    expect(withReason({ type: "run_failed", runId: "r", error: "x", reason: "limit" }).reason).toBe("limit");
    expect(withReason({ type: "run_failed", runId: "r", error: "spawn kimi ENOENT" }).reason).toBe("not_installed");
  });
});
