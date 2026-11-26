import { describe, expect, it, vi } from "vitest";
import { computerProblem, isTransientError, withRetry } from "../src/computers.ts";

const EAI = "npm error request to https://registry.npmjs.org/@anthropic-ai%2fclaude-code failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org";

describe("network hiccups", () => {
  it("knows a passing network error from a real one", () => {
    expect(isTransientError(EAI)).toBe(true);
    expect(isTransientError("Temporary failure in name resolution")).toBe(true);
    expect(isTransientError("read tcp 10.0.0.2:5555: connection reset by peer")).toBe(true);
    expect(isTransientError("received unexpected HTTP status: 503 Service Unavailable")).toBe(true);
    expect(isTransientError("npm error 404 Not Found - GET https://registry.npmjs.org/nope")).toBe(false);
    expect(isTransientError("no space left on device")).toBe(false);
    expect(isTransientError("")).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });

  it("tries again after each wait while the error is a hiccup, then gives up with the last error", async () => {
    const sleep = vi.fn(async () => {});
    const onRetry = vi.fn();
    let calls = 0;
    const ok = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new Error(EAI);
      return "built";
    }, { delaysMs: [10, 20, 30], sleep, onRetry });
    expect(ok).toBe("built");
    expect(calls).toBe(3);
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([10, 20]);
    expect(onRetry.mock.calls.map((c) => c[1])).toEqual([1, 2]);

    calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new Error(`${EAI} (${calls})`);
    }, { delaysMs: [1, 1], sleep })).rejects.toThrow("(3)");
    expect(calls).toBe(3);
  });

  it("doesn't try again after an error that won't pass", async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new Error("no space left on device");
    }, { delaysMs: [1, 1], sleep: async () => {} })).rejects.toThrow("no space");
    expect(calls).toBe(1);
  });
});

describe("why a computer couldn't start, in plain words", () => {
  it("names the cause without the device's jargon", () => {
    expect(computerProblem(EAI)).toBe("Couldn't reach the internet while setting it up.");
    expect(computerProblem("write /var/lib/docker/tmp: no space left on device")).toBe("Its device is out of disk space.");
    expect(computerProblem("Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?")).toBe("The VM engine on its device isn't running.");
    expect(computerProblem("Shared computer is offline: its device isn't connected")).toBe("Its device is offline.");
    expect(computerProblem("the VM started but its desktop didn't come up within a minute and a half")).toBe("It started, but its screen didn't come up.");
    expect(computerProblem("something odd")).toBe("It couldn't start.");
    expect(computerProblem("")).toBe("It couldn't start.");
  });
});
