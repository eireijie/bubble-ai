#!/usr/bin/env node
// Builds the Bubble AI the desktop app carries inside it, so a downloaded app can run a hub and be a
// device without Node.js or a clone of the repo: the hub, the device, wisp-mcp and the web app,
// with their production dependencies. The app runs it
// with its own binary as Node (ELECTRON_RUN_AS_NODE), the same `bin/bubble-ai.mjs` a terminal runs.
//
//   node apps/desktop/scripts/bundle-bubble-ai.mjs   → apps/desktop/build/wisp-runtime
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import env from "../src/env.cjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const repo = path.resolve(desktop, "../..");
const out = path.join(desktop, "build", "wisp-runtime");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (cmd, args, cwd, env = {}) => execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
// BUBBLE_BUNDLE_ARCH=x64 bundles for Intel on an Apple silicon Mac: native modules come prebuilt for that processor
const arch = env.envVar("BUNDLE_ARCH");

console.log("building the web app");
run(npm, ["run", "build"], repo);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const skip = (src) => !/[\\/](node_modules|test|\.DS_Store)([\\/]|$)/.test(path.relative(repo, src));
const copy = (rel) => fs.cpSync(path.join(repo, rel), path.join(out, rel), { recursive: true, filter: skip });

for (const rel of ["bin", "apps/hub", "apps/node", "apps/web/dist", "docker/computer", "docker/cloud-init.yaml", "install.sh", "install.ps1", "LICENSE"]) copy(rel);
for (const pkg of fs.readdirSync(path.join(repo, "packages"))) copy(`packages/${pkg}`);

// a better-sqlite3 with Node-API prebuilds, which load in any Node or Electron on every platform
// (11.x is built per Node version and doesn't compile against this Electron's V8)
const SQLITE = "^13.0.3";
const desktopPackage = JSON.parse(fs.readFileSync(path.join(desktop, "package.json"), "utf8"));
const root = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
fs.writeFileSync(
  path.join(out, "package.json"),
  JSON.stringify({ name: "wisp-runtime", private: true, version: root.version, type: "module", license: root.license, workspaces: ["apps/hub", "apps/node", "packages/*"], dependencies: { ...root.dependencies, ...desktopPackage.dependencies, "better-sqlite3": SQLITE }, overrides: { "better-sqlite3": SQLITE } }, null, 2),
);

console.log("installing production dependencies");
run(npm, ["install", "--omit=dev", "--no-audit", "--no-fund", ...(arch ? [`--cpu=${arch}`] : [])], out, arch ? { npm_config_arch: arch, npm_config_target_arch: arch } : {});

fs.rmSync(path.join(out, "package-lock.json"), { force: true });

// Windows doesn't come with Git, and the hub can't start without it (its vault is a git repository),
// so the Windows app carries Git for Windows' portable MinGit, plus git-http-backend from the full
// build: MinGit leaves that out, and Obsidian sync serves the vault with it. bin/bundled-git.mjs puts
// it on PATH. Both downloads are pinned to the hashes Git for Windows publishes for the release.
const GIT_RELEASE = "https://github.com/git-for-windows/git/releases/download/v2.56.1.windows.1";
const MINGIT = { file: "MinGit-2.56.1-64-bit.zip", sha256: "4a92850b6e917da4fd010669b614b55dccf5b0ec333a534cc4be4700dfefdafd" };
const FULL_GIT = { file: "Git-2.56.1-64-bit.tar.bz2", sha256: "d7d89e69855f00e73d957b513c49538a420c465c84b9d212cf1add400eecdf54" };
const HTTP_BACKEND = "ucrt64/libexec/git-core/git-http-backend.exe";

/** A Git for Windows download, kept in build/git-download so a second bundle doesn't fetch it again. */
async function gitDownload({ file, sha256 }) {
  const dir = path.join(desktop, "build", "git-download");
  const to = path.join(dir, file);
  const hash = (f) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  if (fs.existsSync(to) && hash(to) === sha256) return to;
  console.log(`downloading ${file}`);
  const res = await fetch(`${GIT_RELEASE}/${file}`);
  if (!res.ok) throw new Error(`couldn't download ${file} (${res.status})`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(to, Buffer.from(await res.arrayBuffer()));
  const got = hash(to);
  if (got !== sha256) {
    fs.rmSync(to, { force: true });
    throw new Error(`${file} isn't the file Git for Windows published (sha256 ${got})`);
  }
  return to;
}

if (process.platform === "win32") {
  // Windows' own tar (bsdtar) unpacks zip and bzip2
  const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  const git = path.join(out, "git");
  fs.mkdirSync(git, { recursive: true });
  execFileSync(tar, ["-xf", await gitDownload(MINGIT), "-C", git], { stdio: "inherit" });
  execFileSync(tar, ["-xjf", await gitDownload(FULL_GIT), "-C", git, HTTP_BACKEND], { stdio: "inherit" });
  for (const f of ["cmd/git.exe", HTTP_BACKEND]) if (!fs.existsSync(path.join(git, f))) throw new Error(`the bundled Git is missing ${f}`);
  console.log(`bundled ${execFileSync(path.join(git, "cmd", "git.exe"), ["--version"], { encoding: "utf8" }).trim()}`);
}

console.log(`Bubble AI runtime ready in ${path.relative(repo, out)}`);
