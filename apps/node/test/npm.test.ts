import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { splitDetails } from "@bubble-ai/core";
import { findNpmDir, harnessPrefix, installProblem, npmFolders, npmInstall, npmInstallArgs, prefixBin, withDir, withHarnessBin } from "../src/npm.ts";

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const home = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "wisp-npm-"));
  temporary.push(d);
  return d;
};

describe.skipIf(process.platform === "win32")("finding npm", () => {
  it("is found in a folder a GUI app's short PATH misses (nvm), picking the newest version", () => {
    const h = home();
    for (const v of ["v20.1.0", "v22.4.0", "v9.0.0"]) {
      fs.mkdirSync(path.join(h, ".nvm/versions/node", v, "bin"), { recursive: true });
      fs.writeFileSync(path.join(h, ".nvm/versions/node", v, "bin/npm"), "");
    }
    const folders = npmFolders({ PATH: "/nowhere" }, "linux", h).filter((d) => d.startsWith(h));
    const nvm = folders.filter((d) => d.includes(".nvm"));
    expect(nvm[0]).toBe(path.join(h, ".nvm/versions/node/v22.4.0/bin"));
    expect(nvm).toHaveLength(3);
  });
  it("is found again after Node.js is installed, without restarting", () => {
    const h = home();
    const bin = path.join(h, "bin");
    fs.mkdirSync(bin);
    const env = { PATH: bin };
    const before = findNpmDir(env, "linux", h);
    fs.writeFileSync(path.join(bin, "npm"), "");
    expect(findNpmDir(env, "linux", h)).toBe(bin);
    expect(before).not.toBe(bin);
  });
  it("puts npm's folder first on the PATH its children get, so npm finds node", () => {
    expect(withDir("/x/bin", { PATH: "/usr/bin" }).PATH).toBe("/x/bin:/usr/bin");
    expect(withDir("/usr/bin", { PATH: "/usr/bin" }).PATH).toBe("/usr/bin");
  });
});

/** A stand-in npm: installs a `fakeharness` command into --prefix, or fails the way `mode` says. */
function fakeNpm(dir: string, mode: "ok" | "offline" | "eacces") {
  const npm = path.join(dir, `npm-${mode}`);
  const fail = {
    ok: "",
    offline: 'echo "npm error code ENOTFOUND" >&2; echo "npm error network request to https://registry.npmjs.org/x failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org" >&2; exit 1',
    eacces: 'echo "npm error code EACCES" >&2; echo "npm error Error: EACCES: permission denied, mkdir" >&2; exit 243',
  }[mode];
  const script = [
    "#!/bin/sh",
    `echo "$@" > "${dir}/args"`,
    fail,
    'prefix=""; prev=""',
    'for a in "$@"; do [ "$prev" = "--prefix" ] && prefix="$a"; prev="$a"; done',
    'mkdir -p "$prefix/bin"',
    `printf '#!/bin/sh\\necho bubble\\n' > "$prefix/bin/fakeharness"; chmod +x "$prefix/bin/fakeharness"`,
    'echo "added 1 package in 2s"',
    "",
  ].join("\n");
  fs.writeFileSync(npm, script, { mode: 0o755 });
  return npm;
}

describe.skipIf(process.platform === "win32")("installing a harness", () => {
  const which = (PATH: string) => execFileSync("/bin/sh", ["-c", "command -v fakeharness"], { env: { PATH } }).toString().trim();

  it("goes into Bubble AI's own folder, never npm's global one", async () => {
    const h = home();
    const npm = fakeNpm(h, "ok");
    const prefix = harnessPrefix(path.join(h, ".bubble-ai"));
    expect(prefix).toBe(path.join(h, ".bubble-ai/harnesses"));
    const out = await npmInstall({ npm, env: { PATH: "/usr/bin:/bin" }, prefix, pkg: "@openai/codex", label: "Codex", device: "Mac" });
    expect(out).toContain("added 1 package");
    expect(fs.readFileSync(path.join(h, "args"), "utf8").trim()).toBe(npmInstallArgs(prefix, "@openai/codex").join(" "));
    expect(npmInstallArgs(prefix, "x")).toEqual(expect.arrayContaining(["--global", "--prefix", prefix]));
    expect(fs.existsSync(path.join(prefixBin(prefix), "fakeharness"))).toBe(true);
  });

  it("is found on PATH after the person's own copy, so theirs wins", () => {
    const h = home();
    const mine = path.join(h, "mine");
    const ours = prefixBin(path.join(h, "harnesses"));
    for (const d of [mine, ours]) {
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "fakeharness"), "#!/bin/sh\n", { mode: 0o755 });
    }
    const PATH = withHarnessBin(ours, `${mine}:/usr/bin:/bin`);
    expect(PATH).toBe(`${mine}:/usr/bin:/bin:${ours}`);
    expect(which(PATH)).toBe(path.join(mine, "fakeharness"));
    // with none of their own, Bubble AI's copy is found
    expect(which(withHarnessBin(ours, "/usr/bin:/bin"))).toBe(path.join(ours, "fakeharness"));
    // adding it twice changes nothing
    expect(withHarnessBin(ours, PATH)).toBe(PATH);
  });

  it("fails in plain words, with npm's own output kept for Details", async () => {
    const h = home();
    const prefix = path.join(h, "harnesses");
    const offline = await npmInstall({ npm: fakeNpm(h, "offline"), env: { PATH: "/usr/bin:/bin" }, prefix, pkg: "@openai/codex", label: "Codex", device: "Mac" }).catch((e: Error) => e.message);
    const { text, details } = splitDetails(offline);
    expect(text).toBe("Couldn't reach npm from Mac. Check its internet and try again.");
    expect(details).toContain("ENOTFOUND registry.npmjs.org");
    expect(details).toContain(`--prefix ${prefix}`);
    const denied = splitDetails(await npmInstall({ npm: fakeNpm(h, "eacces"), env: { PATH: "/usr/bin:/bin" }, prefix, pkg: "x", label: "Codex", device: "Mac" }).catch((e: Error) => e.message));
    expect(denied.text).toBe("Bubble AI couldn't write to its harness folder on Mac.");
    expect(denied.text).not.toContain("npm install -g");
  });

  it("names the usual causes", () => {
    expect(installProblem("npm error code ENOSPC", "Codex", "Mac")).toBe("Mac is out of disk space.");
    expect(installProblem("npm error code E404", "Codex", "Mac")).toBe("npm doesn't have Codex right now. Try again later.");
    expect(installProblem("something odd", "Codex", "Mac")).toBe("Codex didn't install.");
  });
});
