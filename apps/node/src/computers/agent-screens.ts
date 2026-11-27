import type { Duplex } from "node:stream";
import type { LoginFillResult, PageElement, RunOutput } from "@bubble-ai/core";
import type { Driver } from "./driver.ts";
import { X11Driver, type Runner } from "./x11.ts";
import { x11Clipboard, type Clipboard, type Files, type ShRunner } from "./transfer.ts";

/**
 * Each agent's own screen on the shared computer (docker/computer/screen.sh): a display of its own,
 * a VNC port for watching it and a Chrome debugging port for its browser tools.
 */
export interface AgentScreenInfo {
  display: number;
  vncPort: number;
  cdpPort: number;
}

/** Stopped after this long without being used (and nobody watching, and no browser tools connected). */
export const AGENT_SCREEN_IDLE_MS = 15 * 60_000;

/** The agent id as screen.sh names it (and its browser profile folder). Exported for tests. */
export function screenSlug(agentId: string): string {
  return agentId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

/** What `wisp-screen up` prints ("DISPLAY=:10 VNC_PORT=5910 CDP_PORT=9310 PROFILE=…"). Exported for tests. */
export function parseScreenInfo(out: string): AgentScreenInfo {
  const line = out.trim().split("\n").pop() ?? "";
  const get = (k: string) => line.match(new RegExp(`(?:^|\\s)${k}=:?(\\d+)`))?.[1];
  const display = Number(get("DISPLAY")), vncPort = Number(get("VNC_PORT")), cdpPort = Number(get("CDP_PORT"));
  if (!display || !vncPort || !cdpPort) throw new Error(`the agent's screen didn't start${line ? `: ${line.slice(0, 200)}` : ""}`);
  return { display, vncPort, cdpPort };
}

/** What `wisp-screen list` prints ("<agent> <display>" a line): the agents with a screen up. Exported for tests. */
export function parseScreenList(out: string): Map<string, number> {
  const up = new Map<string, number>();
  for (const line of out.split("\n")) {
    const [agent, n] = line.trim().split(/\s+/);
    if (agent && Number(n)) up.set(agent, Number(n));
  }
  return up;
}

/** What an agent's screen needs from the VM it's in. */
export interface ScreenHost {
  readonly label: string;
  /** start (if needed) and mark used */
  screen(agentId: string): Promise<AgentScreenInfo>;
  /** run argv in the VM as its user, on this display */
  inVm(display: number, argv: string[], opts?: { input?: string; timeoutMs?: number; env?: Record<string, string> }): ReturnType<Runner>;
  sh(display: number): ShRunner;
  shell(command: string, timeoutSec: number, display: number): Promise<RunOutput>;
  inspectAt(x: number, y: number, cdpPort?: number): Promise<PageElement | null>;
  fillLogin(login: { site: string; username: string; password: string; otp?: string }, cdpPort?: number): Promise<LoginFillResult>;
  vncPort(port: number): Promise<Duplex>;
  files: Files;
  /** the VM itself, for what isn't about the screen (start, stop, status, sign-ins) */
  vm: Driver;
}

/**
 * One agent's view of the shared computer: its own screen, keyboard, mouse, clipboard and browser,
 * with the computer's files and everything else as they are. The screen starts on first use.
 */
export class AgentScreen implements Driver {
  readonly label: string;
  private desktop: X11Driver;
  readonly clipboard: Clipboard;
  readonly files: Files;

  constructor(
    private host: ScreenHost,
    readonly agentId: string,
  ) {
    this.label = host.label;
    const onScreen: Runner = async (argv, opts) => host.inVm((await host.screen(agentId)).display, argv, opts);
    this.desktop = new X11Driver(this.label, onScreen, (command, timeoutSec) => this.run(command, timeoutSec));
    this.clipboard = x11Clipboard(async (script, args, input) => host.sh((await host.screen(agentId)).display)(script, args, input));
    this.files = host.files;
  }

  screenSize = () => this.desktop.screenSize();
  screenshot = (box?: { width: number; height: number }) => this.desktop.screenshot(box);
  move = (x: number, y: number) => this.desktop.move(x, y);
  click = (x: number, y: number, b: "left" | "right" | "middle", n: number) => this.desktop.click(x, y, b, n);
  mouse = (x: number, y: number, b: "left" | "right" | "middle", down: boolean) => this.desktop.mouse(x, y, b, down);
  drag = (x: number, y: number, tx: number, ty: number) => this.desktop.drag(x, y, tx, ty);
  scroll = (x: number, y: number, d: "up" | "down" | "left" | "right", n: number) => this.desktop.scroll(x, y, d, n);
  type = (text: string) => this.desktop.type(text);
  key = (c: Parameters<X11Driver["key"]>[0]) => this.desktop.key(c);
  // a link opens in the agent's own Chrome (its profile and port come with the screen's session)
  open = async (target: string) => {
    const s = await this.host.screen(this.agentId);
    const r = await this.host.inVm(s.display, ["sh", "-c", 'nohup google-chrome "$1" </dev/null >/dev/null 2>&1 &', "open", target], { env: { WISP_AGENT: screenSlug(this.agentId), WISP_CDP_PORT: String(s.cdpPort) } });
    if (r.code !== 0) throw new Error(r.stderr.trim() || "couldn't open it");
  };
  run = async (command: string, timeoutSec: number) => this.host.shell(command, timeoutSec, (await this.host.screen(this.agentId)).display);

  start = () => this.host.vm.start!();
  stop = () => this.host.vm.stop!();
  destroy = () => this.host.vm.destroy!();
  status = () => this.host.vm.status!();
  signedIn = (h: string) => this.host.vm.signedIn!(h);
  openSignIn = (h: string) => this.host.vm.openSignIn!(h);
  inspectAt = async (x: number, y: number) => this.host.inspectAt(x, y, (await this.host.screen(this.agentId)).cdpPort);
  fillLogin = async (login: { site: string; username: string; password: string; otp?: string }) => this.host.fillLogin(login, (await this.host.screen(this.agentId)).cdpPort);
  vnc = async () => this.host.vncPort((await this.host.screen(this.agentId)).vncPort);
}
