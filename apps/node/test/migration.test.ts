import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrateHome, migrateHomes, migrateDataDir, defaultHubDataDir } from "../src/migrate-home.ts";
import { migrateServices, rewriteService, type ServiceRunner } from "../src/migrate-services.ts";
import { existingComputer } from "../src/computers/docker.ts";
import type { exec } from "../src/computers/driver.ts";

let home: string;
const write = (rel: string, content: string) => { const file = path.join(home, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file; };
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), "wisp-migration-")); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe("home migration", () => {
  it("leaves a fresh home alone", () => {
    expect(migrateHome({ home, from: ".warren" })).toEqual({ moved: false, dir: path.join(home, ".bubble-ai") });
    expect(fs.readdirSync(home)).toEqual([]);
  });
  it("moves all data, leaves an alias, rewrites JSON paths and is idempotent", () => {
    const file = write(".warren/node.json", JSON.stringify({ hub: "http://hub:9876", token: "secret", working: `${home}/.warren/agents/a`, nested: [`${home}/.warren/data`] }));
    fs.chmodSync(file, 0o600);
    write(".warren/data/hub.sqlite", "database bytes");
    write(".warren/agents/a/project.json", JSON.stringify({ userContent: `${home}/.warren/example` }));
    const messages: string[] = [];
    expect(migrateHome({ home, from: ".warren", log: (m) => messages.push(m) }).moved).toBe(true);
    expect(fs.lstatSync(path.join(home, ".warren")).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(path.join(home, ".warren"))).toBe(path.join(home, ".bubble-ai"));
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ hub: "http://hub:9876", token: "secret", working: `${home}/.bubble-ai/agents/a`, nested: [`${home}/.bubble-ai/data`] });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(path.join(home, ".bubble-ai/data/hub.sqlite"), "utf8")).toBe("database bytes");
    expect(migrateHome({ home, from: ".warren", log: (m) => messages.push(m) }).moved).toBe(false);
    expect(messages).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(home, ".bubble-ai/agents/a/project.json"), "utf8")).userContent).toBe(`${home}/.warren/example`);
  });
  it("repairs an interrupted migration's missing old alias without moving data again", () => {
    write(".bubble-ai/node.json", "{}");
    write(".bubble-ai/.moved-from", path.join(home, ".warren"));
    expect(migrateHome({ home, from: ".warren" })).toEqual({ moved: false, dir: path.join(home, ".bubble-ai") });
    expect(fs.lstatSync(path.join(home, ".warren")).isSymbolicLink()).toBe(true);
  });
  it("does not merge or overwrite two existing homes", () => {
    write(".warren/node.json", "old"); write(".bubble-ai/node.json", "new");
    expect(migrateHome({ home, from: ".warren" }).moved).toBe(false);
    expect(fs.readFileSync(path.join(home, ".warren/node.json"), "utf8")).toBe("old");
    expect(fs.readFileSync(path.join(home, ".bubble-ai/node.json"), "utf8")).toBe("new");
  });
  it("does not follow an old home symlink", () => {
    fs.mkdirSync(path.join(home, "other")); fs.symlinkSync(path.join(home, "other"), path.join(home, ".warren"), "dir");
    expect(migrateHome({ home, from: ".warren" }).moved).toBe(false);
    expect(fs.existsSync(path.join(home, ".bubble-ai"))).toBe(false);
  });
  it("retains an unwritable old directory and logs the fallback", () => {
    write(".warren/node.json", "{}");
    const io = Object.create(fs) as typeof fs;
    io.renameSync = () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); };
    const logs: string[] = [];
    expect(migrateHome({ home, from: ".warren", fs: io, log: (m) => logs.push(m) })).toEqual({ moved: false, dir: path.join(home, ".warren") });
    expect(logs).toHaveLength(1);
  });
  it("copies and verifies only across devices, preserving links", () => {
    write(".warren/data/db", "precious"); fs.symlinkSync("data/db", path.join(home, ".warren/link"));
    const io = Object.create(fs) as typeof fs;
    io.renameSync = (a, b) => { if (a === path.join(home, ".warren") && b === path.join(home, ".bubble-ai")) throw Object.assign(new Error("cross device"), { code: "EXDEV" }); return fs.renameSync(a, b); };
    expect(migrateHome({ home, from: ".warren", fs: io }).moved).toBe(true);
    expect(fs.readFileSync(path.join(home, ".bubble-ai/link"), "utf8")).toBe("precious");
  });
  it("keeps the source when copied bytes fail verification", () => {
    write(".warren/data/db", "precious");
    const io = Object.create(fs) as typeof fs;
    io.renameSync = () => { throw Object.assign(new Error("cross device"), { code: "EXDEV" }); };
    io.cpSync = (a, b, opts) => { fs.cpSync(a, b, opts); fs.writeFileSync(path.join(String(b), "data/db"), "wrong"); };
    expect(migrateHome({ home, from: ".warren", fs: io }).moved).toBe(false);
    expect(fs.readFileSync(path.join(home, ".warren/data/db"), "utf8")).toBe("precious");
    expect(fs.existsSync(path.join(home, ".bubble-ai"))).toBe(false);
  });
  it("uses an injected filesystem for the Linux data default", () => {
    const io = Object.create(fs) as typeof fs;
    io.existsSync = (p) => p === "/var/lib/warren";
    Object.defineProperty(io, "lstatSync", { value: (p: string) => p === "/var/lib/warren" ? { isDirectory: () => true, isSymbolicLink: () => false } : undefined });
    io.renameSync = () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); };
    expect(migrateDataDir("/var/lib/wisp", () => {}, io)).toBe("/var/lib/warren");
  });
});

describe("home migration across both renames (Warren → Wisp → Bubble AI)", () => {
  const link = (rel: string) => fs.readlinkSync(path.join(home, rel));
  it("moves a Wisp home to ~/.bubble-ai, leaves ~/.wisp as an alias and rewrites its paths", () => {
    write(".wisp/node.json", JSON.stringify({ hub: "http://hub:4747", token: "secret", dir: `${home}/.wisp`, log: `${home}/.wisp/node.log` }));
    write(".wisp/agents/a/notes.json", JSON.stringify({ keep: `${home}/.wisp/agents/a` }));
    const logs: string[] = [];
    expect(migrateHomes({ home, log: (m) => logs.push(m) })).toEqual({ moved: true, dir: path.join(home, ".bubble-ai") });
    expect(link(".wisp")).toBe(path.join(home, ".bubble-ai"));
    expect(JSON.parse(fs.readFileSync(path.join(home, ".bubble-ai/node.json"), "utf8"))).toEqual({ hub: "http://hub:4747", token: "secret", dir: `${home}/.bubble-ai`, log: `${home}/.bubble-ai/node.log` });
    // agents' own files are content, not settings
    expect(JSON.parse(fs.readFileSync(path.join(home, ".bubble-ai/agents/a/notes.json"), "utf8")).keep).toBe(`${home}/.wisp/agents/a`);
    expect(fs.existsSync(path.join(home, ".bubble-ai/.moved-from"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".warren"))).toBe(false);
    expect(migrateHomes({ home }).moved).toBe(false);
    expect(logs).toHaveLength(1);
  });
  it("keeps the Warren alias working through the Wisp one", () => {
    write(".wisp/node.json", "{}");
    fs.symlinkSync(path.join(home, ".wisp"), path.join(home, ".warren"), "dir");
    migrateHomes({ home });
    expect(fs.readFileSync(path.join(home, ".warren/node.json"), "utf8")).toBe("{}");
    expect(fs.realpathSync(path.join(home, ".warren"))).toBe(fs.realpathSync(path.join(home, ".bubble-ai")));
  });
  it("takes a home that was never moved from Warren all the way to ~/.bubble-ai", () => {
    write(".warren/node.json", JSON.stringify({ dir: `${home}/.warren` }));
    expect(migrateHomes({ home }).dir).toBe(path.join(home, ".bubble-ai"));
    expect(JSON.parse(fs.readFileSync(path.join(home, ".bubble-ai/node.json"), "utf8")).dir).toBe(`${home}/.bubble-ai`);
    expect(fs.readFileSync(path.join(home, ".warren/node.json"), "utf8")).toContain(".bubble-ai");
  });
  it("leaves both folders untouched when ~/.wisp and ~/.bubble-ai both exist", () => {
    write(".wisp/node.json", "old"); write(".bubble-ai/node.json", "new");
    expect(migrateHomes({ home })).toEqual({ moved: false, dir: path.join(home, ".bubble-ai") });
    expect(fs.readFileSync(path.join(home, ".wisp/node.json"), "utf8")).toBe("old");
    expect(fs.lstatSync(path.join(home, ".wisp")).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(home, ".bubble-ai/node.json"), "utf8")).toBe("new");
  });
  it("gives a fresh install no aliases for names it never had", () => {
    write(".bubble-ai/node.json", "{}");
    migrateHomes({ home });
    expect(fs.readdirSync(home)).toEqual([".bubble-ai"]);
  });
  it("finishes the alias after a move that stopped before it", () => {
    write(".bubble-ai/node.json", "{}");
    write(".bubble-ai/.moved-from", path.join(home, ".wisp"));
    migrateHomes({ home });
    expect(link(".wisp")).toBe(path.join(home, ".bubble-ai"));
    expect(fs.existsSync(path.join(home, ".bubble-ai/.moved-from"))).toBe(false);
  });
  it("keeps using ~/.wisp, with nothing deleted, when it can't be moved", () => {
    write(".wisp/data/wisp.db", "database");
    const io = Object.create(fs) as typeof fs;
    io.renameSync = () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); };
    expect(migrateHomes({ home, fs: io })).toEqual({ moved: false, dir: path.join(home, ".wisp") });
    expect(fs.readFileSync(path.join(home, ".wisp/data/wisp.db"), "utf8")).toBe("database");
    expect(fs.existsSync(path.join(home, ".wisp/.moved-from"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".bubble-ai"))).toBe(false);
  });
});

describe("hub data folder after the rename", () => {
  const checkout = () => path.join(home, "checkout");
  it("keeps using <checkout>/data when the old hub kept its database there", () => {
    write("checkout/data/warren.db", "");
    expect(defaultHubDataDir(path.join(home, ".bubble-ai"), checkout())).toBe(path.join(checkout(), "data"));
  });
  it("prefers the new data folder once it has a database", () => {
    write("checkout/data/warren.db", "");
    write(".bubble-ai/data/wisp.db", "");
    expect(defaultHubDataDir(path.join(home, ".bubble-ai"), checkout())).toBe(path.join(home, ".bubble-ai", "data"));
  });
  it("uses the new data folder for a fresh install", () => {
    fs.mkdirSync(path.join(checkout(), "data"), { recursive: true });
    expect(defaultHubDataDir(path.join(home, ".bubble-ai"), checkout())).toBe(path.join(home, ".bubble-ai", "data"));
  });
});

describe("service migration with a fake command runner", () => {
  it("keeps a checkout directory and service user whose real name happens to be Warren", () => {
    expect(rewriteService("WorkingDirectory=/home/sam/warren\nUser=warren\nExecStart=node /home/sam/warren/bin/warren-hub.mjs\n")).toBe("WorkingDirectory=/home/sam/warren\nUser=warren\nExecStart=node /home/sam/warren/bin/bubble-ai-hub.mjs\n");
  });
  it("retains old home paths when the home could not be moved", () => {
    fs.mkdirSync(path.join(home, ".warren"));
    write("Library/LaunchAgents/ai.warren.node.plist", `<plist><string>${home}/.warren/node.json</string><string>ai.warren.node</string></plist>`);
    migrateServices({ platform: "darwin", home, uid: 501, run: () => "" });
    expect(fs.readFileSync(path.join(home, "Library/LaunchAgents/ai.wisp.node.plist"), "utf8")).toContain(`${home}/.warren/node.json`);
  });
  it("preserves an older checkout-local hub database when its service had no data env", () => {
    const checkout = path.join(home, "warren");
    write("warren/data/hub.sqlite", "database");
    write("Library/LaunchAgents/ai.warren.hub.plist", `<plist><dict><key>WorkingDirectory</key><string>${checkout}</string><key>EnvironmentVariables</key><dict><key>PORT</key><string>9876</string></dict></dict></plist>`);
    migrateServices({ platform: "darwin", home, uid: 501, run: () => "" });
    const plist = fs.readFileSync(path.join(home, "Library/LaunchAgents/ai.wisp.hub.plist"), "utf8");
    expect(plist).toContain(`<key>BUBBLE_DATA_DIR</key><string>${checkout}/data</string>`);
    write(".config/systemd/user/warren.service", `[Service]\nWorkingDirectory=${checkout}\nExecStart=node ${checkout}/bin/warren-hub.mjs\n`);
    migrateServices({ platform: "linux", home, system: false, run: () => "" });
    expect(fs.readFileSync(path.join(home, ".config/systemd/user/wisp.service"), "utf8")).toContain(`Environment="BUBBLE_DATA_DIR=${checkout}/data"`);
  });
  const settings = 'PORT=9876 HUB=https://hub TOKEN=secret CUSTOM=kept';
  it("replaces launchd definitions, preserving settings and rewriting paths", () => {
    const old = write("Library/LaunchAgents/ai.warren.node.plist", `<plist><dict><key>Label</key><string>ai.warren.node</string><key>ProgramArguments</key><array><string>${home}/.warren/bin/warren.mjs</string><string>node</string><string>start</string><string>--hub</string><string>https://hub</string><string>--token</string><string>secret</string></array><key>EnvironmentVariables</key><dict><key>WARREN_NODE_DIR</key><string>${home}/.warren/work</string><key>CUSTOM</key><string>${settings}</string></dict></dict></plist>`);
    const calls: string[] = []; const run: ServiceRunner = (c, a) => { calls.push([c, ...a].join(" ")); return ""; };
    expect(migrateServices({ platform: "darwin", home, run, uid: 501 })).toEqual(["ai.warren.node"]);
    const text = fs.readFileSync(path.join(home, "Library/LaunchAgents/ai.wisp.node.plist"), "utf8");
    expect(text).toContain(settings); expect(text).toContain(`${home}/.bubble-ai/bin/bubble-ai.mjs`); expect(text).toContain("BUBBLE_NODE_DIR"); expect(text).not.toContain("warren");
    expect(fs.existsSync(old)).toBe(false);
    expect(calls).toEqual([`launchctl bootstrap gui/501 ${home}/Library/LaunchAgents/ai.wisp.node.plist`, "launchctl bootout gui/501/ai.warren.node"]);
    expect(migrateServices({ platform: "darwin", home, run, uid: 501 })).toEqual([]);
  });
  it("replaces user and system systemd units with all their environment and arguments", () => {
    const systemDir = path.join(home, "system");
    for (const rel of [".config/systemd/user/warren.service", "system/warren-node.service"]) write(rel, `[Service]\nWorkingDirectory=${home}/.warren\nEnvironment="${settings}"\nEnvironment=WARREN_NODE_DIR=${home}/.warren\nExecStart=node ${home}/.warren/bin/warren-hub.mjs --port 9876 --hub https://hub --token secret\n`);
    const calls: string[] = []; const run: ServiceRunner = (c, a) => { calls.push([c, ...a].join(" ")); return ""; };
    expect(migrateServices({ platform: "linux", home, run, systemDir, system: true })).toEqual(["warren", "warren-node"]);
    for (const file of [path.join(home, ".config/systemd/user/wisp.service"), path.join(systemDir, "wisp-node.service")]) {
      const text = fs.readFileSync(file, "utf8"); expect(text).toContain(settings); expect(text).toContain("--hub https://hub --token secret"); expect(text).toContain(`${home}/.bubble-ai/bin/bubble-ai-hub.mjs`); expect(text).not.toContain("warren");
    }
    expect(calls).toContain("systemctl --user disable warren"); expect(calls).toContain("systemctl --user restart wisp"); expect(calls).toContain("systemctl disable warren-node"); expect(calls).toContain("systemctl restart wisp-node");
    expect(migrateServices({ platform: "linux", home, run, systemDir, system: true })).toEqual([]);
  });
  it("exports and replaces Windows tasks without reconstructing or losing their settings", () => {
    let exists = true; const calls: string[] = [];
    const run: ServiceRunner = (_c, args) => {
      const script = args.at(-1)!; calls.push(script);
      if (script.includes("Export-ScheduledTask")) return exists && script.includes("Warren node") ? `<Task><Arguments>$env:WARREN_HUB='https://hub'; $env:WARREN_NODE_TOKEN='secret'; $env:PORT='9876'; node ${home}/.warren/bin/warren.mjs</Arguments><Settings>${settings}</Settings></Task>` : "";
      if (script.includes("Unregister-ScheduledTask")) exists = false;
      return "";
    };
    expect(migrateServices({ platform: "win32", home, run })).toEqual(["Warren node"]);
    const install = calls.find((c) => c.includes("Register-ScheduledTask"))!;
    expect(install).toContain("Wisp node"); expect(install).toContain(settings); expect(install).toContain("BUBBLE_HUB"); expect(install).toContain("BUBBLE_NODE_TOKEN"); expect(install).toContain(`${home}/.bubble-ai/bin/bubble-ai.mjs`);
    expect(calls.some((c) => c.includes("Unregister-ScheduledTask -TaskName 'Warren node'"))).toBe(true);
    expect(migrateServices({ platform: "win32", home, run })).toEqual([]);
  });
  it("uninstall removes legacy definitions without installing replacements", () => {
    write("Library/LaunchAgents/ai.warren.hub.plist", "legacy"); const calls: string[] = [];
    migrateServices({ platform: "darwin", home, removeOnly: true, uid: 501, run: (c, a) => { calls.push([c, ...a].join(" ")); return ""; } });
    expect(calls).toEqual(["launchctl bootout gui/501/ai.warren.hub"]);
    expect(fs.readdirSync(path.join(home, "Library/LaunchAgents"))).toEqual([]);
  });
  it("does not overwrite an existing Bubble AI service", () => {
    write("Library/LaunchAgents/ai.warren.hub.plist", "legacy"); const file = write("Library/LaunchAgents/ai.wisp.hub.plist", "current");
    migrateServices({ platform: "darwin", home, run: () => "", uid: 501 }); expect(fs.readFileSync(file, "utf8")).toBe("current");
  });
});

describe("computer compatibility with a fake Docker runner", () => {
  for (const kind of ["docker", "podman", "apple"] as const) {
    it(`retains an existing legacy ${kind} container and its home volume/user`, async () => {
      const calls: string[][] = [];
      const run = (async (_bin, args) => { calls.push(args); return { code: args.at(-1) === "warren-cmp_1" ? 0 : 1, stdout: Buffer.from(""), stderr: "" }; }) as typeof exec;
      expect(await existingComputer({ bin: kind, kind }, "cmp_1", run)).toEqual({ name: "warren-cmp_1", volume: "warren-cmp_1-home", user: "warren", home: "/home/warren" });
      expect(calls).toEqual([["inspect", "wisp-cmp_1"], ["inspect", "warren-cmp_1"]]);
    });
  }
  it("reuses an orphaned legacy volume rather than creating an empty home", async () => {
    const run = (async (_bin, args) => ({ code: args[0] === "volume" ? 0 : 1, stdout: Buffer.from(""), stderr: "" })) as typeof exec;
    expect(await existingComputer({ bin: "docker", kind: "docker" }, "cmp_1", run)).toEqual({ name: "wisp-cmp_1", volume: "warren-cmp_1-home", user: "wisp", home: "/home/wisp" });
  });
  it("uses new names for a fresh computer", async () => {
    const run = (async () => ({ code: 1, stdout: Buffer.from(""), stderr: "" })) as typeof exec;
    expect(await existingComputer({ bin: "docker", kind: "docker" }, "cmp_1", run)).toEqual({ name: "wisp-cmp_1", volume: "wisp-cmp_1-home", user: "wisp", home: "/home/wisp" });
  });
});
