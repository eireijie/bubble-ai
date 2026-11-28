import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withDetails } from "@bubble-ai/core";

/**
 * Installing Hermes Agent (Nous Research) on a person's own device with its official installer,
 * pinned the way docker/computer/Dockerfile pins it: the script is fetched by commit (never the live
 * `install.sh` at hermes-agent.nousresearch.com), its SHA-256 is checked before anything runs, and the
 * installer checks the code out at that same commit. Moving to a new Hermes release means changing
 * HERMES_PIN here and the Dockerfile's ARGs together (a test keeps them in step).
 *
 * The installer runs stage by stage, non-interactively (its own `--stage` protocol, the one Hermes's
 * desktop app drives), skipping what needs a person at the keyboard (its setup wizard, the messaging
 * gateway) and the extras Bubble AI already brings (browser tools, Computer Use). Its prerequisites
 * stage is skipped on macOS and Linux too: it would reach for Homebrew, sudo or the Xcode tools
 * dialog for optional extras (ripgrep, ffmpeg). The stages that matter install uv, Python and git
 * themselves when they're missing.
 */
export const HERMES_PIN = {
  tag: "v2026.9.24",
  commit: "f97608f178d1ffeca59860195ab7da295f7c8e5f",
  sh: { file: "install.sh", sha256: "2017ddf0cc7bc6cfb70d40dc9fba1d916f47dbcccf5fe73bdee2cf93a11262af" },
  ps1: { file: "install.ps1", sha256: "0a80dfeb7434229933bac32e73140d10086dff81bd84b156e71be9abc87cddf2" },
} as const;

export function hermesScriptUrl(file: string, commit: string = HERMES_PIN.commit): string {
  return `https://raw.githubusercontent.com/NousResearch/hermes-agent/${commit}/scripts/${file}`;
}

/** Hermes's own folder (HERMES_HOME) in a home folder: ~/.hermes on every system, as Bubble AI reads it. */
export function hermesHome(home: string): string {
  return path.join(home, ".hermes");
}

/** Where the installer puts the `hermes` command. */
export function hermesBinDir(home: string, platform = process.platform): string {
  return platform === "win32" ? path.join(hermesHome(home), "bin") : path.join(home, ".local", "bin");
}

/** The installer's stages, in order, and the arguments each one runs with. */
export function hermesInstallSteps(script: string, home: string, platform = process.platform): { cmd: string; args: string[]; stage: string }[] {
  const data = hermesHome(home);
  if (platform === "win32") {
    const stages = ["uv", "git", "repository", "python", "venv", "dependencies", "path", "config-templates", "bootstrap-marker"];
    return stages.map((stage) => ({
      stage,
      cmd: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Stage", stage, "-Commit", HERMES_PIN.commit, "-NonInteractive", "-SkipComputerUse", "-HermesHome", data, "-InstallDir", path.join(data, "hermes-agent")],
    }));
  }
  const stages = ["repository", "venv", "python-deps", "path", "config", "complete"];
  return stages.map((stage) => ({
    stage,
    cmd: "bash",
    args: [script, "--stage", stage, "--commit", HERMES_PIN.commit, "--non-interactive", "--skip-browser", "--skip-computer-use", "--hermes-home", data, "--dir", path.join(data, "hermes-agent")],
  }));
}

/** What went wrong, in plain words, from the installer's output. */
export function hermesInstallProblem(output: string, device: string): string {
  if (/no space left|ENOSPC/i.test(output)) return `${device} is out of disk space.`;
  if (/Git not found|Could not install Git/i.test(output)) return `Hermes needs Git, and ${device} doesn't have it. Install Git, then try again.`;
  if (/Could not resolve host|Failed to connect|timed out|Network is unreachable|Temporary failure in name resolution|Unable to connect/i.test(output)) return `Couldn't reach Hermes's servers from ${device}. Check its internet and try again.`;
  if (/Permission denied|EACCES|Access is denied/i.test(output)) return `The Hermes installer couldn't write to ${device}'s home folder.`;
  return "Hermes didn't install.";
}

export interface HermesInstallOptions {
  /** the home folder Hermes goes in (the person's, or a throwaway one in tests) */
  home: string;
  device: string;
  log?: (line: string) => void;
  platform?: NodeJS.Platform;
  /** fetches a URL's bytes (for tests) */
  download?: (url: string) => Promise<Buffer>;
  /** runs one step (for tests); resolves with its exit code (null when stopped) and output */
  run?: (cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<{ code: number | null; text: string }>;
  timeoutMs?: number;
}

async function fetchBytes(url: string): Promise<Buffer> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (err) {
      last = err;
      await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
    }
  }
  throw last;
}

/** One step, with no terminal to ask anything on (stdin closed, its own session on macOS/Linux). */
function runStep(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number | null; text: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env, detached: process.platform !== "win32", windowsHide: true });
    let text = "";
    const add = (d: Buffer) => (text = (text + d).slice(-16000));
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
    }, timeoutMs);
    child.on("error", (e) => (clearTimeout(timer), resolve({ code: -1, text: `${text}\n${e.message}` })));
    child.on("close", (code) => (clearTimeout(timer), resolve({ code, text })));
  });
}

/**
 * Install Hermes in `home`. Resolves with the installer's last lines; fails in plain words, with the
 * installer's output under Details (withDetails).
 */
export async function installHermes(o: HermesInstallOptions): Promise<string> {
  const platform = o.platform ?? process.platform;
  const pinned = platform === "win32" ? HERMES_PIN.ps1 : HERMES_PIN.sh;
  const url = hermesScriptUrl(pinned.file);
  let bytes: Buffer;
  try {
    bytes = await (o.download ?? fetchBytes)(url);
  } catch (err) {
    throw new Error(withDetails(`Couldn't download Hermes's installer on ${o.device}. Check its internet and try again.`, `${url}\n${(err as Error).message}`));
  }
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  // the pinned commit's script can't change; anything else is not what was reviewed, so nothing runs
  if (sha !== pinned.sha256) throw new Error(withDetails("Hermes's installer wasn't the copy Bubble AI expects, so it didn't run.", `${url}\nexpected sha256 ${pinned.sha256}\ngot      ${sha}`));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bubble-hermes-"));
  const script = path.join(dir, pinned.file);
  fs.writeFileSync(script, bytes, { mode: 0o700 });
  const data = hermesHome(o.home);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: o.home,
    ...(platform === "win32" ? { USERPROFILE: o.home } : {}),
    HERMES_HOME: data,
    HERMES_INSTALL_DIR: path.join(data, "hermes-agent"),
    // no prompts, no colour codes in the log, no Homebrew self-update
    DEBIAN_FRONTEND: "noninteractive",
    NO_COLOR: "1",
    HOMEBREW_NO_AUTO_UPDATE: "1",
    GIT_TERMINAL_PROMPT: "0",
    ELECTRON_RUN_AS_NODE: undefined,
  };
  // a short PATH (a GUI-launched app's) still finds git, curl and the uv the installer puts here
  env.PATH = [...(env.PATH ?? "").split(path.delimiter), ...(platform === "win32" ? [] : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]), path.join(data, "bin"), hermesBinDir(o.home, platform)]
    .filter((p, i, all) => p && all.indexOf(p) === i)
    .join(path.delimiter);
  let log = "";
  try {
    for (const step of hermesInstallSteps(script, o.home, platform)) {
      o.log?.(`hermes installer: ${step.stage}`);
      const r = await (o.run ?? runStep)(step.cmd, step.args, env, o.timeoutMs ?? 15 * 60_000);
      log = `${log}\n$ ${step.stage}\n${r.text.trim()}`.slice(-16000);
      if (r.code !== 0) throw new Error(withDetails(r.code === null ? "Hermes took too long to install." : hermesInstallProblem(r.text, o.device), `Hermes installer ${HERMES_PIN.tag} (${HERMES_PIN.commit.slice(0, 12)}), stage ${step.stage}, exit ${r.code}\n${log.trim()}`));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const bin = path.join(hermesBinDir(o.home, platform), platform === "win32" ? "hermes.exe" : "hermes");
  if (!fs.existsSync(bin) && !fs.existsSync(bin.replace(/\.exe$/, ".cmd"))) throw new Error(withDetails("Hermes didn't install: its command isn't there afterwards.", `${bin} is missing\n${log.trim()}`));
  return `Hermes ${HERMES_PIN.tag} is installed.`;
}
