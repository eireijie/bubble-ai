import { afterAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitDetails } from "@bubble-ai/core";
import { HERMES_PIN, hermesBinDir, hermesInstallSteps, hermesScriptUrl, installHermes } from "../src/hermes-install.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const homes: string[] = [];
const home = () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "bubble-hermes-test-"));
  homes.push(h);
  return h;
};
afterAll(() => homes.forEach((h) => fs.rmSync(h, { recursive: true, force: true })));

/** a stand-in for the pinned installer, with the hash the code checks swapped for its own */
const fakeScript = Buffer.from("#!/bin/bash\necho fake\n");

describe("Hermes's pinned installer", () => {
  it("is the same release and commit the computer image is built with", () => {
    const docker = fs.readFileSync(path.join(root, "docker/computer/Dockerfile"), "utf8");
    expect(docker).toContain(`ARG HERMES_TAG=${HERMES_PIN.tag}`);
    expect(docker).toContain(`ARG HERMES_COMMIT=${HERMES_PIN.commit}`);
  });

  it("is fetched by commit, never the live script", () => {
    expect(hermesScriptUrl("install.sh")).toBe(`https://raw.githubusercontent.com/NousResearch/hermes-agent/${HERMES_PIN.commit}/scripts/install.sh`);
    expect(HERMES_PIN.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(HERMES_PIN.sh.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(HERMES_PIN.ps1.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("runs its stages non-interactively, pinned to the commit, skipping the wizard and the extras", () => {
    const steps = hermesInstallSteps("/tmp/i.sh", "/Users/x", "darwin");
    expect(steps.map((s) => s.stage)).toEqual(["repository", "venv", "python-deps", "path", "config", "complete"]);
    for (const s of steps) {
      expect(s.cmd).toBe("bash");
      expect(s.args).toEqual(expect.arrayContaining(["--commit", HERMES_PIN.commit, "--non-interactive", "--skip-browser", "--skip-computer-use", "--hermes-home", "/Users/x/.hermes"]));
    }
    expect(steps.some((s) => s.args.includes("setup") || s.args.includes("gateway") || s.args.includes("prerequisites"))).toBe(false);
    const win = hermesInstallSteps("C:\\t\\install.ps1", "C:\\Users\\x", "win32");
    expect(win.map((s) => s.stage)).toEqual(["uv", "git", "repository", "python", "venv", "dependencies", "path", "config-templates", "bootstrap-marker"]);
    expect(win[0].cmd).toBe("powershell.exe");
    expect(win[0].args).toEqual(expect.arrayContaining(["-Commit", HERMES_PIN.commit, "-NonInteractive", "-SkipComputerUse", "-HermesHome"]));
    expect(hermesBinDir("/Users/x", "darwin")).toBe("/Users/x/.local/bin");
  });

  it("refuses to run a script that isn't the pinned copy", async () => {
    let ran = false;
    const err = await installHermes({ home: home(), device: "mac", platform: "darwin", download: async () => fakeScript, run: async () => ((ran = true), { code: 0, text: "" }) }).then(() => new Error("it ran"), (e: Error) => e);
    expect(ran).toBe(false);
    const { text, details } = splitDetails(err.message);
    expect(text).toBe("Hermes's installer wasn't the copy Bubble AI expects, so it didn't run.");
    expect(details).toContain(HERMES_PIN.sh.sha256);
  });

  it("runs each stage in the person's home and checks the command is there afterwards", async () => {
    const h = home();
    const pinned = HERMES_PIN.sh as { sha256: string };
    const real = pinned.sha256;
    // the pinned hash, for this test's stand-in script
    (pinned as any).sha256 = crypto.createHash("sha256").update(fakeScript).digest("hex");
    try {
      const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
      const out = await installHermes({
        home: h,
        device: "mac",
        platform: "darwin",
        download: async (url) => (expect(url).toBe(hermesScriptUrl("install.sh")), fakeScript),
        run: async (_cmd, args, env) => {
          calls.push({ args, env });
          if (args[2] === "path") fs.mkdirSync(path.join(h, ".local/bin"), { recursive: true }), fs.writeFileSync(path.join(h, ".local/bin/hermes"), "");
          return { code: 0, text: "ok" };
        },
      });
      expect(out).toBe(`Hermes ${HERMES_PIN.tag} is installed.`);
      expect(calls).toHaveLength(6);
      expect(calls[0].env).toMatchObject({ HOME: h, HERMES_HOME: path.join(h, ".hermes") });
      // the downloaded copy doesn't stay behind
      expect(fs.existsSync(calls[0].args[0])).toBe(false);
    } finally {
      (pinned as any).sha256 = real;
    }
  });

  it("stops at the first stage that fails, in plain words with the log as details", async () => {
    const pinned = HERMES_PIN.sh as { sha256: string };
    const real = pinned.sha256;
    (pinned as any).sha256 = crypto.createHash("sha256").update(fakeScript).digest("hex");
    try {
      let n = 0;
      const err = await installHermes({ home: home(), device: "mac", platform: "darwin", download: async () => fakeScript, run: async () => (n++, { code: 1, text: "fatal: unable to access 'https://github.com/': Could not resolve host: github.com" }) }).then(() => new Error("it ran"), (e: Error) => e);
      expect(n).toBe(1);
      const { text, details } = splitDetails(err.message);
      expect(text).toBe("Couldn't reach Hermes's servers from mac. Check its internet and try again.");
      expect(details).toContain("stage repository");
    } finally {
      (pinned as any).sha256 = real;
    }
  });
});
