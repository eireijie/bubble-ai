import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFailure, buildImage, ensureImage, imageJobsRunning, publishedImage } from "../src/computers/docker.ts";
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

describe("getting the VM image", () => {
  /** A stand-in build that waits until it's told to finish, or is stopped. */
  function fakeBuild() {
    const builds: { signal: AbortSignal; finish: () => void }[] = [];
    const fetch = (_e: unknown, _local: string, onStatus: (t: string) => void, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        onStatus("Building the VM image");
        builds.push({ signal, finish: resolve });
        signal.addEventListener("abort", () => reject(new Error("killed")));
      });
    return { fetch, builds };
  }

  it("builds once per tag, however many ask at the same time", async () => {
    const { fetch, builds } = fakeBuild();
    const heard: string[] = [];
    const a = ensureImage(engine, () => {}, undefined, { fetch, tag: "dedupe" });
    const b = ensureImage(engine, (t) => heard.push(t), undefined, { fetch, tag: "dedupe" });
    const other = ensureImage(engine, () => {}, undefined, { fetch, tag: "other" });
    expect(builds).toHaveLength(2);
    // the second one hears where the build is
    expect(heard).toEqual(["Building the VM image"]);
    for (const x of builds) x.finish();
    expect(await a).toBe("wisp-computer:dedupe");
    expect(await b).toBe("wisp-computer:dedupe");
    expect(await other).toBe("wisp-computer:other");
    expect(imageJobsRunning()).toBe(0);
  });

  it("stops the build once everyone waiting on it gives up (the computer was deleted)", async () => {
    const { fetch, builds } = fakeBuild();
    const one = new AbortController();
    const two = new AbortController();
    const a = ensureImage(engine, () => {}, one.signal, { fetch, tag: "cancel" });
    const b = ensureImage(engine, () => {}, two.signal, { fetch, tag: "cancel" });
    one.abort();
    await expect(a).rejects.toThrow(/cancelled/);
    // the other VM still wants it: it goes on
    expect(builds[0].signal.aborted).toBe(false);
    two.abort();
    await expect(b).rejects.toThrow(/cancelled/);
    expect(builds[0].signal.aborted).toBe(true);
    expect(imageJobsRunning()).toBe(0);
    // asking again afterwards starts a fresh build
    const c = ensureImage(engine, () => {}, undefined, { fetch, tag: "cancel" });
    expect(builds).toHaveLength(2);
    builds[1].finish();
    await expect(c).resolves.toBe("wisp-computer:cancel");
  });

  it("doesn't start anything for a computer already removed", async () => {
    const { fetch, builds } = fakeBuild();
    const gone = new AbortController();
    gone.abort();
    await expect(ensureImage(engine, () => {}, gone.signal, { fetch, tag: "gone" })).rejects.toThrow(/cancelled/);
    expect(builds).toHaveLength(0);
  });

  it("stops a build command when asked", async () => {
    const stop = new AbortController();
    const calls: string[][] = [];
    const run = ((_bin: string, args: string[], o: { signal?: AbortSignal }) => {
      calls.push(args);
      return new Promise((resolve) => o.signal?.addEventListener("abort", () => resolve({ code: -1, stdout: Buffer.from(""), stderr: "(cancelled)" })));
    }) as unknown as typeof exec;
    const p = buildImage(engine, "t", "/r", { run, signal: stop.signal, delaysMs: [1, 1], sleep: async () => {} });
    stop.abort();
    await expect(p).rejects.toThrow(/cancelled/);
    expect(calls).toHaveLength(1);
  });
});
