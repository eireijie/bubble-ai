import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withDetails } from "@bubble-ai/core";

/** Shown when this computer has no Node.js; the setup screen recognises it and offers the download. */
export const NO_NODE = "Node.js isn't installed on this computer";

/** Folders a GUI-launched app or a service often misses, where Node.js and npm usually live. */
export function npmFolders(env: NodeJS.ProcessEnv = process.env, platform = process.platform, home = os.homedir()): string[] {
  const dirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  // the runtime's own folder helps only when it is Node (the desktop app's is Electron, with no npm beside it)
  if (!process.versions.electron) dirs.push(path.dirname(process.execPath));
  if (platform === "win32") {
    for (const base of [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs")]) if (base) dirs.push(path.join(base, "nodejs"));
    if (env.APPDATA) dirs.push(path.join(env.APPDATA, "npm"));
    if (env.NVM_SYMLINK) dirs.push(env.NVM_SYMLINK);
    if (env.NVM_HOME && env.NVM_SYMLINK === undefined) dirs.push(env.NVM_HOME);
    dirs.push(path.join(home, "scoop", "apps", "nodejs", "current"));
    return dirs;
  }
  dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", path.join(home, ".local/bin"), path.join(home, ".volta/bin"), path.join(home, ".local/share/fnm/aliases/default/bin"), path.join(home, ".fnm/aliases/default/bin"));
  // nvm keeps each version in its own folder; take the newest
  for (const root of [env.NVM_DIR ? path.join(env.NVM_DIR, "versions/node") : "", path.join(home, ".nvm/versions/node")]) {
    if (!root) continue;
    try {
      const versions = fs.readdirSync(root).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const v of versions) dirs.push(path.join(root, v, "bin"));
    } catch {}
  }
  return dirs;
}

/** The folder with npm in it, or null when there is no Node.js to be found. */
export function findNpmDir(env: NodeJS.ProcessEnv = process.env, platform = process.platform, home = os.homedir()): string | null {
  const names = platform === "win32" ? ["npm.cmd"] : ["npm"];
  for (const dir of npmFolders(env, platform, home)) if (names.some((n) => fs.existsSync(path.join(dir, n)))) return dir;
  return null;
}

/** An environment where npm's own `node` can be found, even if the app was started with a short PATH. */
export function withDir(dir: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const parts = (env.PATH ?? "").split(path.delimiter);
  return { ...env, PATH: parts.includes(dir) ? env.PATH : [dir, ...parts].filter(Boolean).join(path.delimiter), ELECTRON_RUN_AS_NODE: undefined };
}

/** Where Bubble AI installs harnesses: a folder of its own, never npm's global one (Homebrew's, the system's). */
export function harnessPrefix(dataDir: string): string {
  return path.join(dataDir, "harnesses");
}

/** The folder a prefix's commands land in (npm puts them straight in the prefix on Windows). */
export function prefixBin(prefix: string, platform = process.platform): string {
  return platform === "win32" ? prefix : path.join(prefix, "bin");
}

/**
 * PATH with Bubble AI's harness folder at the end, so a harness the person installed themselves
 * (anywhere already on PATH) is the one found, and Bubble AI's own copy only fills a gap.
 */
export function withHarnessBin(bin: string, pathVar: string | undefined): string {
  const parts = (pathVar ?? "").split(path.delimiter).filter(Boolean);
  return parts.includes(bin) ? (pathVar ?? "") : [...parts, bin].join(path.delimiter);
}

/** npm's arguments to install `pkg` into `prefix`, and nowhere else. */
export function npmInstallArgs(prefix: string, pkg: string): string[] {
  return ["install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", "--no-update-notifier", pkg];
}

/** What went wrong with an install, in plain words, from npm's output. */
export function installProblem(output: string, label: string, device: string): string {
  if (/\bENOSPC\b|no space left/i.test(output)) return `${device} is out of disk space.`;
  if (/\bE404\b|404 Not Found/i.test(output)) return `npm doesn't have ${label} right now. Try again later.`;
  if (/\bEACCES\b|\bEPERM\b|permission denied/i.test(output)) return `Bubble AI couldn't write to its harness folder on ${device}.`;
  if (/\bETIMEDOUT\b|\bENOTFOUND\b|\bEAI_AGAIN\b|\bECONNRESET\b|\bECONNREFUSED\b|network|socket hang up/i.test(output)) return `Couldn't reach npm from ${device}. Check its internet and try again.`;
  return `${label} didn't install.`;
}

/**
 * Install `pkg` into Bubble AI's own `prefix` with the npm at `npm`. Resolves with npm's last lines;
 * fails with plain words, npm's raw output following under DETAILS_MARK (see withDetails).
 */
export async function npmInstall(opts: { npm: string; env: NodeJS.ProcessEnv; prefix: string; pkg: string; label: string; device: string; timeoutMs?: number }): Promise<string> {
  fs.mkdirSync(opts.prefix, { recursive: true });
  const out = await new Promise<{ code: number | null; text: string }>((resolve) => {
    const child = spawn(opts.npm, npmInstallArgs(opts.prefix, opts.pkg), { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32", env: opts.env });
    let text = "";
    child.stdout.on("data", (d) => (text = (text + d).slice(-8000)));
    child.stderr.on("data", (d) => (text = (text + d).slice(-8000)));
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 15 * 60_000);
    child.on("error", (e) => (clearTimeout(timer), resolve({ code: -1, text: (e as NodeJS.ErrnoException).code === "ENOENT" ? "ENOENT" : e.message })));
    child.on("close", (code) => (clearTimeout(timer), resolve({ code, text })));
  });
  if (out.code === 0) return out.text.trim().split("\n").slice(-3).join("\n");
  if (out.text === "ENOENT") throw new Error(`${NO_NODE}, and ${opts.label} is installed with it. Install Node.js from https://nodejs.org, then try again.`);
  const log = `npm ${npmInstallArgs(opts.prefix, opts.pkg).join(" ")}\n${out.code === null ? "(stopped: it took too long)\n" : ""}${out.text.trim()}`;
  throw new Error(withDetails(out.code === null ? `${opts.label} took too long to install.` : installProblem(out.text, opts.label, opts.device), log));
}
