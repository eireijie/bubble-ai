import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFailure, buildImage, publishedImage } from "../src/computers/docker.ts";
import type { exec } from "../src/computers/driver.ts";

/** A build log like the one that failed on a Mac: the cause is well above the last line. */
const EAI_LOG = [
  "#9 [5/12] RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code && npm cache clean --force",
  "#9 3.112 npm error code EAI_AGAIN",
  "#9 3.113 npm error request to https://registry.npmjs.org/@anthropic-ai%2fclaude-code failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org",
  "#9 ERROR: process \"/bin/sh -c npm install -g @anthropic-ai/claude-code\" did not complete successfully: exit code: 1",
  "Error: failed to build: exit status 1",
].join("\n");

const engine = { bin: "docker", kind: "docker" as const };

/** Runs that fail with `results` in turn (0 = success), counting the builds. */
function fakeRun(results: { code: number; stderr?: string }[]) {
  const calls: string[][] = [];
  const run = (async (_bin: string, args: string[]) => {
    calls.push(args);
    const r = results[Math.min(calls.length - 1, results.length - 1)];
    return { code: r.code, stdout: Buffer.from(""), stderr: r.stderr ?? "" };
  }) as unknown as typeof exec;
  return { run, calls };
}

describe("building the VM image", () => {
  it("names the network error behind a failed build, not just the step that failed", () => {
    expect(buildFailure(EAI_LOG)).toContain("EAI_AGAIN");
    expect(buildFailure("step 3\nE: Unable to locate package nope\nError: failed to build: exit status 100")).toBe("Error: failed to build: exit status 100");
    expect(buildFailure("")).toBe("the VM image didn't build");
  });

  it("builds again after a network hiccup, and says so", async () => {
    const { run, calls } = fakeRun([{ code: 1, stderr: EAI_LOG }, { code: 1, stderr: EAI_LOG }, { code: 0 }]);
    const said: string[] = [];
    const waits: number[] = [];
    await buildImage(engine, "wisp-computer:abc", "/recipe", { run, delaysMs: [5, 6, 7], sleep: async (ms) => void waits.push(ms), onStatus: (t) => said.push(t) });
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual(["build", "-t", "wisp-computer:abc", "/recipe"]);
    expect(waits).toEqual([5, 6]);
    expect(said[0]).toMatch(/Network hiccup.*Trying again \(2 of 4\)/);
  });

  it("gives up after the last try with the network error, and doesn't retry other failures", async () => {
    const flaky = fakeRun([{ code: 1, stderr: EAI_LOG }]);
    await expect(buildImage(engine, "t", "/r", { run: flaky.run, delaysMs: [1, 1], sleep: async () => {} })).rejects.toThrow(/EAI_AGAIN/);
    expect(flaky.calls).toHaveLength(3);

    const broken = fakeRun([{ code: 1, stderr: "E: Unable to locate package nope\nError: failed to build: exit status 100" }]);
    await expect(buildImage(engine, "t", "/r", { run: broken.run, delaysMs: [1, 1], sleep: async () => {} })).rejects.toThrow(/exit status 100/);
    expect(broken.calls).toHaveLength(1);
  });

  it("looks for a published image in an installed copy too (no .git), so it isn't built on the person's computer", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wisp-installed-"));
    expect(publishedImage(dir)).toMatch(/^ghcr\.io\/[a-z0-9-]+\/wisp-computer$/);
    fs.mkdirSync(path.join(dir, ".git"));
    fs.writeFileSync(path.join(dir, ".git", "config"), '[remote "origin"]\n\turl = git@github.com:Someone/fork.git\n');
    expect(publishedImage(dir)).toBe("ghcr.io/someone/wisp-computer");
    fs.writeFileSync(path.join(dir, ".git", "config"), '[remote "origin"]\n\turl = https://gitlab.com/x/y.git\n');
    expect(publishedImage(dir)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
