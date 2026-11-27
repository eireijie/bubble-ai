import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ComputerSpec } from "@bubble-ai/core";
import { parseScreenInfo, parseScreenList, screenSlug } from "../src/computers/agent-screens.ts";
import { ComputerHost } from "../src/computers/index.ts";
import { DockerVm } from "../src/computers/docker.ts";
import { exec } from "../src/computers/driver.ts";

const RECIPE = path.resolve(import.meta.dirname, "../../../docker/computer");
const vmSpec = (shared: boolean, image?: string): ComputerSpec => ({ id: `screens-test-${shared ? "shared" : "own"}`, name: shared ? "Shared" : "Own", kind: "vm", config: { shared, resolution: "1280x800", ...(image ? { image } : {}) } });

describe("what wisp-screen says", () => {
  it("reads a screen's display and ports", () => {
    expect(parseScreenInfo("DISPLAY=:12 VNC_PORT=5912 CDP_PORT=9312 PROFILE=/home/wisp/.config/wisp-browser-agents/agt_1\n")).toEqual({ display: 12, vncPort: 5912, cdpPort: 9312 });
    expect(() => parseScreenInfo("too many screens on this computer")).toThrow(/didn't start: too many/);
    expect(() => parseScreenInfo("")).toThrow(/didn't start/);
  });

  it("lists the screens that are up", () => {
    expect([...parseScreenList("agt_1 10\nagt_2 11\n\n")]).toEqual([["agt_1", 10], ["agt_2", 11]]);
    expect(parseScreenList("").size).toBe(0);
  });

  it("names a screen (and its browser profile folder) after the agent, safely", () => {
    expect(screenSlug("agt_AbC-1")).toBe("agt_AbC-1");
    expect(screenSlug("../../x y;rm")).toBe("xyrm");
    expect(screenSlug("a".repeat(100))).toHaveLength(64);
  });
});

describe("the VM image's agent screens", () => {
  it("installs wisp-screen, and Chrome and the browser tools use an agent's own profile and port", () => {
    const docker = fs.readFileSync(path.join(RECIPE, "Dockerfile"), "utf8");
    expect(docker).toMatch(/COPY screen\.sh \/usr\/local\/bin\/wisp-screen/);
    expect(docker).toMatch(/chmod \+x[^\n]*\/usr\/local\/bin\/wisp-screen/);
    const chrome = fs.readFileSync(path.join(RECIPE, "chrome.sh"), "utf8");
    expect(chrome).toContain("wisp-browser-agents/$WISP_AGENT");
    expect(chrome).toContain('--remote-debugging-port="$PORT"');
    const mcp = fs.readFileSync(path.join(RECIPE, "browser-mcp.sh"), "utf8");
    expect(mcp).toContain('wisp-screen up "$WISP_AGENT"');
    // without an agent, the main screen's Chrome as before
    expect(mcp).toMatch(/export DISPLAY=:1\nPORT=9222/);
  });

  it("starts screens without holding up the command that asked (every background stream closed, the lock too)", () => {
    const screen = fs.readFileSync(path.join(RECIPE, "screen.sh"), "utf8");
    const background = screen.split("\n").filter((l) => /&\s*$/.test(l) && !l.trim().startsWith("#"));
    expect(background.length).toBeGreaterThanOrEqual(3);
    for (const line of background) expect(line).toMatch(/<\/dev\/null >\S+ 2>&1 9>&- &$/);
  });
});

describe("whose screen an action goes to", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bubble-screens-"));
  const host = new ComputerHost({ dir });
  const engine = { bin: "docker", kind: "docker" as const };

  it("a VM of one agent's own keeps its one screen", async () => {
    const vm = new DockerVm(vmSpec(false), dir, engine);
    expect(vm.shared).toBe(false);
    expect(await vm.agentScreens()).toBe(false);
    expect(await vm.forAgent("agt_1")).toBe(vm);
    expect(await vm.forAgent(undefined)).toBe(vm);
  });

  it("gives an agent working inside the shared computer its own browser profile and screen, by name", async () => {
    const shared = new DockerVm(vmSpec(true), dir, engine);
    const launch = await shared.launcher("run_1", "agt_1")({ command: "claude", args: [], cwd: shared.filesDir, env: { X: "1" } });
    expect(launch.args).toContain("WISP_AGENT=agt_1");
    expect(launch.args).toContain("X=1");
    const own = new DockerVm(vmSpec(false), dir, engine);
    const plain = await own.launcher("run_2", "agt_1")({ command: "claude", args: [], cwd: own.filesDir, env: {} });
    expect(plain.args.some((a) => a.startsWith("WISP_AGENT="))).toBe(false);
  });

  it("a device's own screen ignores whose screen was asked for", async () => {
    const spec: ComputerSpec = { id: "dev", name: "Mac", kind: "device", config: {} };
    const d = await host.driver(spec);
    expect(await (host as unknown as { driverFor: (s: ComputerSpec, a?: string) => Promise<unknown> }).driverFor(spec, "agt_1")).toBe(d);
  });
});

/**
 * With a real VM engine: BUBBLE_LIVE_SCREENS=<image> (an image of docker/computer, e.g.
 * wisp-computer:<tag>). Two agents open different pages at the same time on one shared computer,
 * and each one's screen and VNC viewer shows its own page.
 */
const LIVE = process.env.BUBBLE_LIVE_SCREENS;
describe.skipIf(!LIVE)("two agents on the shared computer at once (live)", () => {
  it("each sees and shows its own page", { timeout: 300_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bubble-screens-live-"));
    const host = new ComputerHost({ dir, vmEngine: process.env.BUBBLE_LIVE_ENGINE });
    const spec = { ...vmSpec(true, LIVE), id: `screens-live-${Date.now()}` };
    const vm = (await host.vm(spec))!;
    try {
      await vm.ready();
      // an image from before this change: this branch's scripts put in place
      for (const [file, dest] of [["screen.sh", "/usr/local/bin/wisp-screen"], ["chrome.sh", "/usr/local/bin/google-chrome"], ["browser-mcp.sh", "/usr/local/bin/wisp-browser-mcp"]])
        await exec(vm.engine.bin, ["exec", "-i", "-u", "root", vm.name, "sh", "-c", `cat > ${dest} && chmod +x ${dest}`], { input: fs.readFileSync(path.join(RECIPE, file), "utf8") });
      (vm as unknown as { forgetScreens: () => void }).forgetScreens();
      expect(await vm.agentScreens()).toBe(true);
      const page = (who: string) => `data:text/html,<title>${who}</title><h1>${who}</h1>`;
      await Promise.all([host.act(spec, { action: "open", target: page("AGENT A") }, "agentA"), host.act(spec, { action: "open", target: page("AGENT B") }, "agentB")]);
      expect(vm.screenAgents().sort()).toEqual(["agentA", "agentB"]);
      const titles = async (agent: string) => {
        const port = (await vm.screen(agent)).cdpPort;
        for (let i = 0; i < 50; i++) {
          const r = await exec(vm.engine.bin, ["exec", "-u", "wisp", vm.name, "curl", "-s", `http://127.0.0.1:${port}/json/list`]);
          const t = (JSON.parse(r.stdout.toString() || "[]") as { type: string; title: string }[]).filter((p) => p.type === "page").map((p) => p.title);
          if (t.length && t.every(Boolean)) return t;
          await new Promise((res) => setTimeout(res, 200));
        }
        return [];
      };
      expect(await titles("agentA")).toEqual(["AGENT A"]);
      expect(await titles("agentB")).toEqual(["AGENT B"]);
      // each viewer reaches its own display (the VNC desktop name ends in it)
      const desktopName = (agent?: string) =>
        new Promise<string>((resolve, reject) => {
          let buf = Buffer.alloc(0);
          let step = 0;
          let t: { write: (b: Uint8Array) => void; close: () => void };
          void host
            .tunnel(spec, (b) => {
              buf = Buffer.concat([buf, b]);
              if (step === 0 && buf.length >= 12) (buf = buf.subarray(12)), t.write(Buffer.from("RFB 003.008\n")), (step = 1);
              if (step === 1 && buf.length >= 1 + buf[0]) (buf = buf.subarray(1 + buf[0])), t.write(Buffer.from([1])), (step = 2);
              if (step === 2 && buf.length >= 4) (buf = buf.subarray(4)), t.write(Buffer.from([1])), (step = 3);
              if (step === 3 && buf.length >= 24 && buf.length >= 24 + buf.readUInt32BE(20)) {
                t.close();
                resolve(buf.subarray(24, 24 + buf.readUInt32BE(20)).toString());
              }
            }, (err) => err && reject(new Error(err)), agent)
            .then((x) => (t = x), reject);
        });
      const [a, b, main] = [await desktopName("agentA"), await desktopName("agentB"), await desktopName()];
      expect(a).toMatch(new RegExp(`:${(await vm.screen("agentA")).display}$`));
      expect(b).toMatch(new RegExp(`:${(await vm.screen("agentB")).display}$`));
      expect(main).toMatch(/:1$/);
      expect((await vm.sweepScreens(0)).sort()).toEqual(["agentA", "agentB"]);
    } finally {
      await vm.destroy();
    }
  });
});
