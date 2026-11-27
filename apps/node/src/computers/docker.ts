import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { Duplex } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GITHUB_REPO, isTransientError, withRetry, type ComputerSpec, type LoginFillResult, type PageElement, type RunOutput, type VmConfig } from "@bubble-ai/core";
import { FILL_LOGIN_SCRIPT } from "./fill-login.ts";
import { ActionError, exec, has, must, type Driver } from "./driver.ts";
import { X11Driver } from "./x11.ts";
import { shellFiles, x11Clipboard, type Clipboard, type Files, type ShRunner } from "./transfer.ts";
import { AGENT_SCREEN_IDLE_MS, AgentScreen, parseScreenInfo, parseScreenList, screenSlug, type AgentScreenInfo } from "./agent-screens.ts";

const IMAGE_DIR = fileURLToPath(new URL("../../../../docker/computer", import.meta.url));
/** The main screen (people's, and every agent's on a VM without screens of their own). */
const MAIN_DISPLAY = 1;
const MAIN_VNC = 5900;
/** The VM's home folder and the folder it shares with the device. */
export const VM_HOME = "/home/wisp";
export const VM_FILES = "/home/wisp/files";
/** Where the VM image installs Hermes (outside the home folder, which is a volume). */
const HERMES_DIR = "/opt/hermes/hermes-agent";

/** Which file says a harness is signed in, inside a VM. */
export const SIGNED_IN: Record<string, string> = {
  "claude-code": "test -s ~/.claude/.credentials.json || test -s ~/.claude/.credentials",
  codex: "test -s ~/.codex/auth.json",
  // Hermes keeps keys, OAuth logins and provider settings in several places; ask it whether it can resolve a provider
  hermes: `cd ${HERMES_DIR} && venv/bin/python -c "from acp_adapter.auth import detect_provider as d; raise SystemExit(0 if d() else 1)" 2>/dev/null`,
  // `kimi login` writes ~/.kimi-code/credentials/<profile>.json; an API key goes in config.toml
  kimi: "ls ~/.kimi-code/credentials/*.json >/dev/null 2>&1 || grep -qs api_key ~/.kimi-code/config.toml",
};

/**
 * Runs in the VM's Node: asks each page of the visible Chrome (over its debugging port) what
 * element is under a screen point. The page part maps screen to page coordinates from the window's
 * position and its frame, then names the element the way a person would point at it.
 */
const INSPECT_SCRIPT = String.raw`
const [X, Y] = process.argv.slice(1).map(Number);
const inPage = (X, Y) => {
  if (document.visibilityState !== "visible") return null;
  const side = (outerWidth - innerWidth) / 2;
  const top = outerHeight - innerHeight - side;
  const x = X - screenX - side, y = Y - screenY - top;
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  const t = hit.closest("a,button,input,select,textarea,label,summary,[role],[contenteditable]") || hit;
  const tag = t.tagName.toLowerCase();
  const type = (t.getAttribute("type") || "").toLowerCase();
  const role = t.getAttribute("role") || { a: "link", button: "button", select: "combobox", textarea: "textbox", summary: "button", label: "label" }[tag] || (tag === "input" ? (["checkbox", "radio"].includes(type) ? type : ["submit", "button"].includes(type) ? "button" : "textbox") : tag);
  const by = t.getAttribute("aria-labelledby");
  const name = (t.getAttribute("aria-label") || (by && document.getElementById(by)?.innerText) || (t.labels && t.labels[0]?.innerText) || t.innerText || t.value || t.getAttribute("placeholder") || t.getAttribute("title") || t.getAttribute("alt") || "").trim().replace(/\s+/g, " ").slice(0, 100);
  const attr = (n) => t.getAttribute(n);
  const selector = t.id ? "#" + CSS.escape(t.id) : attr("name") ? tag + '[name="' + attr("name") + '"]' : attr("data-testid") ? '[data-testid="' + attr("data-testid") + '"]' : undefined;
  return { url: location.href, title: document.title, role, name, selector };
};
const ask = (url) => new Promise((resolve) => {
  const ws = new WebSocket(url);
  const done = (v) => { try { ws.close(); } catch {} resolve(v); };
  setTimeout(() => done(null), 3000);
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "(" + inPage + ")(" + X + "," + Y + ")", returnByValue: true } }));
  ws.onmessage = (m) => { const r = JSON.parse(m.data); if (r.id === 1) done(r.result?.result?.value ?? null); };
  ws.onerror = () => done(null);
});
const pages = await fetch("http://127.0.0.1:" + (process.env.CDP_PORT || "9222") + "/json/list").then((r) => r.json(), () => []);
for (const p of pages.filter((p) => p.type === "page" && p.webSocketDebuggerUrl)) {
  const found = await ask(p.webSocketDebuggerUrl);
  if (found) { console.log(JSON.stringify(found)); process.exit(0); }
}
console.log("null");
`;

/** How a person signs a harness in, in a terminal on the VM's screen. */
export const SIGN_IN_COMMAND: Record<string, string> = {
  "claude-code": "claude",
  codex: "codex login",
  hermes: "hermes setup",
  kimi: "kimi login",
};

/**
 * What runs the VMs: Docker (Docker Desktop, OrbStack, Colima, Docker Engine), Podman, or Apple's
 * `container` on a Mac (each container in its own small VM). Their command lines differ a little.
 */
export type EngineKind = "docker" | "podman" | "apple";

export interface Engine {
  bin: string;
  kind: EngineKind;
}

export const ENGINE_LABEL: Record<EngineKind, string> = { docker: "Docker", podman: "Podman", apple: "Apple's container" };

function kindOf(bin: string): EngineKind {
  const base = path.basename(bin);
  return base === "container" ? "apple" : base.includes("podman") ? "podman" : "docker";
}

/**
 * The VM engine on this device: the one in node.json if set, else Apple's container on a Mac,
 * then Docker, then Podman. `detail` says what's missing when none is ready.
 */
export async function detectEngine(prefer?: string): Promise<{ engine: Engine | null; detail: string }> {
  const order = [prefer, process.platform === "darwin" ? "container" : null, "docker", "podman"].filter((b, i, all): b is string => !!b && all.indexOf(b) === i);
  const stopped: string[] = [];
  for (const bin of order) {
    if (!(await has(bin))) continue;
    const kind = kindOf(bin);
    if (kind === "apple") {
      const r = await exec(bin, ["system", "status"], { timeoutMs: 15_000 }).catch(() => null);
      if (r?.code === 0 && /running/i.test(r.stdout.toString())) return { engine: { bin, kind }, detail: `${ENGINE_LABEL[kind]} is running` };
      stopped.push("Apple's container is installed but not running: run `container system start`");
      continue;
    }
    const r = await exec(bin, ["version", "--format", "{{.Server.Version}}"], { timeoutMs: 15_000 }).catch(() => null);
    if (r?.code === 0) return { engine: { bin, kind }, detail: `${ENGINE_LABEL[kind]} is running` };
    stopped.push(kind === "podman" ? "Podman is installed but not running: run `podman machine start`" : "Docker is installed but not running: start Docker Desktop, OrbStack or Colima");
  }
  if (stopped.length) return { engine: null, detail: `${stopped[0]}.` };
  const how =
    process.platform === "darwin"
      ? "Run `bubble-ai setup` to install Apple's container (free, from Apple), or install OrbStack or Docker Desktop"
      : process.platform === "win32"
        ? "Install Docker Desktop (it uses WSL 2)"
        : "Run `bubble-ai setup`, or install Docker Engine or Podman";
  return { engine: null, detail: `This device can't run VMs yet. ${how}.` };
}

/**
 * The VM image for this copy of Bubble AI: named after a hash of its recipe (docker/computer), so a
 * changed recipe means a new image, and a published image is only used when it's built from the
 * same recipe.
 */
export function recipeTag(dir = IMAGE_DIR): string {
  // every file under the recipe, in path order (the same as `find … | LC_ALL=C sort` in CI)
  const files = (fs.readdirSync(dir, { recursive: true }) as string[]).map((f) => f.split(path.sep).join("/")).filter((f) => fs.statSync(path.join(dir, f)).isFile());
  const h = crypto.createHash("sha256");
  for (const f of files.sort()) h.update(fs.readFileSync(path.join(dir, f)));
  return h.digest("hex").slice(0, 12);
}

export const LOCAL_IMAGE = "wisp-computer";

/**
 * Where this copy of Bubble AI's VM images are published: ghcr.io/<owner>/wisp-computer for a
 * GitHub checkout, and Bubble AI's own (vm-image.yml) for an installed copy, which has no .git.
 * Only an image built from the very same recipe is used (recipeTag).
 */
export function publishedImage(repoDir = path.resolve(IMAGE_DIR, "../..")): string | null {
  const official = `ghcr.io/${GITHUB_REPO.split("/")[0].toLowerCase()}/wisp-computer`;
  let head: string;
  try {
    head = fs.readFileSync(path.join(repoDir, ".git", "config"), "utf8");
  } catch {
    return official;
  }
  const url = head.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/)?.[1] ?? "";
  const owner = url.match(/github\.com[:/]([A-Za-z0-9-]+)\//)?.[1];
  return owner ? `ghcr.io/${owner.toLowerCase()}/wisp-computer` : null;
}

const relays = new Map<string, Promise<number>>();

/** Old containers keep their image/user/home; orphaned old home volumes are mounted into new images. */
export async function existingComputer(engine: Engine, id: string, run: typeof exec = exec) {
  const safe = id.replace(/[^a-zA-Z0-9_.-]/g, "-");
  const name = `wisp-${safe}`, old = `warren-${safe}`;
  const inspect = (args: string[]) => run(engine.bin, args, { timeoutMs: 15_000 });
  if ((await inspect(["inspect", name])).code === 0) return { name, volume: `${name}-home`, user: "wisp", home: VM_HOME };
  if ((await inspect(["inspect", old])).code === 0) return { name: old, volume: `${old}-home`, user: "warren", home: "/home/warren" };
  const legacyVolume = (await inspect(["volume", "inspect", `${old}-home`])).code === 0;
  return { name, volume: `${legacyVolume ? old : name}-home`, user: "wisp", home: VM_HOME };
}

/**
 * A relay from the address VMs reach this device at to a port on its loopback: a hub listening only
 * on localhost here is then still reachable from inside the VMs (and only from their network).
 */
function relay(bindHost: string, port: number): Promise<number> {
  const key = `${bindHost}->${port}`;
  let p = relays.get(key);
  if (!p) {
    p = new Promise<number>((resolve, reject) => {
      const server = net.createServer((client) => {
        const upstream = net.connect(port, "127.0.0.1");
        client.pipe(upstream).pipe(client);
        client.on("error", () => upstream.destroy());
        upstream.on("error", () => client.destroy());
      });
      server.once("error", reject);
      server.listen(0, bindHost, () => resolve((server.address() as net.AddressInfo).port));
      server.unref();
    });
    p.catch(() => relays.delete(key));
    relays.set(key, p);
  }
  return p;
}

/** The name a VM goes by inside (prompt, tmux): "shared" for the shared computer, else its name as a slug. */
export function vmHostname(spec: Pick<ComputerSpec, "name" | "config">): string {
  if ((spec.config as VmConfig).shared) return "shared";
  return (
    spec.name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "wisp"
  );
}

/**
 * Run as root in the VM each time it comes up, with its name as $1: that name in the shell prompt
 * and tmux bar. Apple's container can't set a hostname, so they'd show the container's id
 * ("wisp-cmp_…"). The prompt is fixed up just before it's shown (after ~/.bashrc set it).
 */
export const NAME_INSIDE_SCRIPT = [
  "printf '%s\\n' \"$1\" > /etc/wisp-hostname",
  "if ! grep -q wisp-hostname /etc/bash.bashrc 2>/dev/null; then",
  "cat >> /etc/bash.bashrc <<'WISPNAME'",
  "",
  "# this computer's name in the prompt, not the container's id (wisp-hostname)",
  "__wisp_name() { [ -r /etc/wisp-hostname ] && PS1=\"${PS1//\\\\h/$(cat /etc/wisp-hostname)}\"; }",
  "PROMPT_COMMAND=\"__wisp_name${PROMPT_COMMAND:+;$PROMPT_COMMAND}\"",
  "WISPNAME",
  "fi",
  "grep -q wisp-hostname /etc/tmux.conf 2>/dev/null || printf '%s\\n' \"set -g status-right '\\\"#(cat /etc/wisp-hostname)\\\" %H:%M %d-%b-%y' # wisp-hostname\" >> /etc/tmux.conf",
  "",
].join("\n");

/** Arguments that create a VM's container. Exported for tests. */
export function runArgs(spec: ComputerSpec, o: { name: string; volume: string; files: string; image: string; kind?: EngineKind }): string[] {
  const cfg = spec.config as VmConfig;
  const kind = o.kind ?? "docker";
  const resolution = /^\d{3,5}x\d{3,5}$/.test(cfg.resolution ?? "") ? cfg.resolution! : "1280x800";
  const hostname = vmHostname(spec);
  const args = ["run", "-d", "--name", o.name, "--label", `wisp.computer=${spec.id}`, "--shm-size", "1g"];
  // Apple's container has no hostname or restart policy; Bubble AI starts a stopped VM when it's next used
  // stopped when idle and started when next needed, so it never comes back on its own (after a reboot, say)
  if (kind !== "apple") args.push("--hostname", hostname, "--restart", "no");
  // the hub, when it runs on this same device (Docker Engine on Linux needs to be told the name)
  if (kind === "docker") args.push("--add-host", "host.docker.internal:host-gateway");
  // no published ports: VNC listens inside the container and the device reaches it with exec
  args.push("-e", `RESOLUTION=${resolution}`, "-v", `${o.volume}:/home/wisp`, "-v", `${o.files}:/home/wisp/files`);
  if (cfg.cpus && cfg.cpus > 0) args.push("--cpus", String(Math.min(Math.ceil(cfg.cpus), 64)));
  if (cfg.memoryGb && cfg.memoryGb > 0) args.push("--memory", `${Math.min(cfg.memoryGb, 256)}g`);
  args.push(o.image);
  return args;
}

/** Thrown to whoever was waiting on a VM image when they gave up on it (the VM was deleted, say). */
export const IMAGE_CANCELLED = "cancelled: the computer was removed while its image was being set up";

/** Image fetches and builds under way, by engine and tag: one at a time, shared by all who wait on it. */
interface ImageJob {
  promise: Promise<string>;
  waiters: number;
  abort: AbortController;
  listeners: Set<(text: string) => void>;
  last: string | null;
}
const imageJobs = new Map<string, ImageJob>();

/** How many image fetches or builds are under way (for tests). */
export const imageJobsRunning = () => imageJobs.size;

type ImageFetcher = (engine: Engine, local: string, onStatus: (text: string) => void, signal: AbortSignal) => Promise<void>;

/**
 * Make sure the VM image is on this device: the published one built from the same recipe if
 * there is one, otherwise built here from docker/computer (a few minutes, once).
 *
 * Only one fetch or build per image runs at a time: a second VM (or the ahead-of-time prepare)
 * asking meanwhile waits on the same one and hears its steps. `signal` lets a waiter give up (its
 * VM was deleted); the build itself is stopped once nobody is waiting on it any more.
 */
export async function ensureImage(engine: Engine, onStatus: (text: string) => void = () => {}, signal?: AbortSignal, o: { fetch?: ImageFetcher; tag?: string } = {}): Promise<string> {
  if (signal?.aborted) throw new ActionError(IMAGE_CANCELLED);
  const local = `${LOCAL_IMAGE}:${o.tag ?? recipeTag()}`;
  const key = `${engine.bin}\n${local}`;
  let job = imageJobs.get(key);
  if (!job) {
    const abort = new AbortController();
    const listeners = new Set<(text: string) => void>();
    const fresh: ImageJob = { waiters: 0, abort, listeners, last: null, promise: Promise.resolve(local) };
    const tell = (text: string) => {
      fresh.last = text;
      for (const l of listeners) l(text);
    };
    fresh.promise = (o.fetch ?? fetchImage)(engine, local, tell, abort.signal)
      .then(() => local)
      .finally(() => {
        if (imageJobs.get(key) === fresh) imageJobs.delete(key);
      });
    // nobody listening when it fails (everyone gave up): don't surface it as unhandled
    fresh.promise.catch(() => {});
    imageJobs.set(key, fresh);
    job = fresh;
  } else if (job.last) onStatus(job.last);
  const j = job;
  j.waiters++;
  j.listeners.add(onStatus);
  return new Promise<string>((resolve, reject) => {
    let done = false;
    const leave = () => {
      if (done) return false;
      done = true;
      j.listeners.delete(onStatus);
      signal?.removeEventListener("abort", onAbort);
      j.waiters--;
      return true;
    };
    const onAbort = () => {
      if (!leave()) return;
      // the last one waiting gave up: stop the build or download
      if (j.waiters === 0) {
        j.abort.abort();
        if (imageJobs.get(key) === j) imageJobs.delete(key);
      }
      reject(new ActionError(IMAGE_CANCELLED));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    j.promise.then(
      (v) => leave() && resolve(v),
      (e) => leave() && reject(j.abort.signal.aborted ? new ActionError(IMAGE_CANCELLED) : e),
    );
  });
}

/** Fetch the published image, else build it here. */
async function fetchImage(engine: Engine, local: string, onStatus: (text: string) => void, signal: AbortSignal): Promise<void> {
  if (await imageExists(engine, local)) return;
  const tag = local.slice(local.indexOf(":") + 1);
  const published = publishedImage();
  if (published) {
    onStatus("Downloading the VM image (first time only)…");
    const remote = `${published}:${tag}`;
    const pulled = await exec(engine.bin, engine.kind === "apple" ? ["image", "pull", remote] : ["pull", remote], { timeoutMs: 30 * 60_000, signal });
    if (signal.aborted) throw new ActionError(IMAGE_CANCELLED);
    if (pulled.code === 0 && (await exec(engine.bin, engine.kind === "apple" ? ["image", "tag", remote, local] : ["tag", remote, local], { timeoutMs: 60_000 })).code === 0) return;
  }
  if (!fs.existsSync(path.join(IMAGE_DIR, "Dockerfile"))) throw new ActionError(`can't find the VM image recipe at ${IMAGE_DIR}`);
  onStatus("Building the VM image (first time only, a few minutes)…");
  await buildImage(engine, local, IMAGE_DIR, { onStatus, signal });
}

/** Waits between tries when building the VM image hits a network hiccup (the engine keeps the steps that worked). */
export const BUILD_RETRY_MS = [10_000, 30_000, 90_000];

/**
 * The line of a failed build that says why: a network error if there is one (it may be well above
 * the last line, which only says a step failed), else the last line that reads as an error.
 */
export function buildFailure(output: string): string {
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean).reverse();
  const pick = lines.find((l) => isTransientError(l)) ?? lines.find((l) => /error|failed|denied|not found/i.test(l)) ?? lines[0];
  return (pick ?? "the VM image didn't build").slice(0, 500);
}

/** Build the VM image, trying again after a network hiccup. Exported for tests. */
export async function buildImage(engine: Engine, tag: string, dir: string, o: { onStatus?: (text: string) => void; run?: typeof exec; delaysMs?: readonly number[]; sleep?: (ms: number) => Promise<void>; signal?: AbortSignal } = {}): Promise<void> {
  const run = o.run ?? exec;
  await withRetry(
    async () => {
      if (o.signal?.aborted) throw new ActionError(IMAGE_CANCELLED);
      const r = await run(engine.bin, ["build", "-t", tag, dir], { timeoutMs: 60 * 60_000, signal: o.signal });
      if (o.signal?.aborted) throw new ActionError(IMAGE_CANCELLED);
      if (r.code !== 0) throw new ActionError(buildFailure(`${r.stdout.toString().slice(-4000)}\n${r.stderr}`));
    },
    {
      delaysMs: o.delaysMs ?? BUILD_RETRY_MS,
      retryable: (err) => !o.signal?.aborted && isTransientError(err instanceof Error ? err.message : String(err)),
      sleep: o.sleep,
      onRetry: (_err, attempt) => o.onStatus?.(`Network hiccup while building the VM image. Trying again (${attempt + 1} of ${(o.delaysMs ?? BUILD_RETRY_MS).length + 1})…`),
    },
  );
}

export async function imageExists(engine: Engine, image: string): Promise<boolean> {
  const r = await exec(engine.bin, ["image", "inspect", image], { timeoutMs: 15_000 }).catch(() => null);
  return r?.code === 0;
}

/**
 * A Linux desktop in a container: a virtual computer this device runs for its agents. Its
 * home folder lives in a volume, so sign-ins and browser profiles survive restarts, and
 * `files/` is shared with the device (the agents' working folder).
 */
/**
 * Writes stdin to a file in the VM, swapped in whole. A private file (and the folders made for it)
 * is never readable by others, not even until the chmod; a failed write leaves nothing. Exported for tests.
 */
export function writeFileScript(vmPath: string, mode: string): string {
  const priv = (parseInt(mode, 8) & 0o077) === 0;
  return `${priv ? "umask 077; " : ""}mkdir -p "$(dirname '${vmPath}')" && tmp='${vmPath}'.$$.tmp; if cat > "$tmp" && chmod ${mode} "$tmp" && mv -f "$tmp" '${vmPath}'; then :; else rm -f "$tmp"; exit 1; fi`;
}

/** $1 is the connections folder; the rest are the connection ids to keep. Exported for tests. */
export const PRUNE_CONNECTIONS_SCRIPT = `dir="$1"; shift; cd "$dir" 2>/dev/null || exit 0; for d in *; do [ -e "$d" ] || continue; keep=; for k in "$@"; do [ "$d" = "$k" ] && keep=1; done; [ -n "$keep" ] || rm -rf -- "$d"; done`;

export class DockerVm implements Driver {
  readonly label = "Linux VM";
  private desktop: X11Driver;
  private starting: Promise<void> | null = null;
  /** an idle stop under way: a use that arrives meanwhile waits for it, then starts the VM again */
  private stopping: Promise<void> | null = null;
  name: string;
  user = "wisp";
  home = VM_HOME;
  private identity: Promise<void> | null = null;
  /** aborted when it's deleted: a start still getting its image gives up (and the build stops if nobody else waits) */
  private removed = new AbortController();
  volume: string;
  /** shared with the agents that use this computer: their working folder */
  readonly filesDir: string;

  constructor(
    private spec: ComputerSpec,
    nodeDir: string,
    readonly engine: Engine,
    /** how starting it goes: each step, then up or not, whatever asked for it */
    private report: (status: "starting" | "ready" | "stopped" | "error", text: string) => void = () => {},
  ) {
    const safe = spec.id.replace(/[^a-zA-Z0-9_.-]/g, "-");
    this.name = `wisp-${safe}`;
    this.volume = `wisp-${safe}-home`;
    this.filesDir = path.join(nodeDir, "computers", safe, "files");
    this.desktop = new X11Driver(this.label, (argv, opts) => this.inVm(MAIN_DISPLAY, argv, opts), (command, timeoutSec) => this.shell(command, timeoutSec));
    this.clipboard = x11Clipboard(this.sh(MAIN_DISPLAY));
    this.files = shellFiles(this.sh(MAIN_DISPLAY));
  }

  /** Run argv in the VM as its user, on an X display. */
  inVm(display: number, argv: string[], opts: { input?: string; timeoutMs?: number; env?: Record<string, string> } = {}) {
    const env = Object.entries(opts.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    return this.ready().then(() => exec(this.engine.bin, ["exec", "-i", "-u", this.user, "-e", `DISPLAY=:${display}`, ...env, this.name, ...argv], { input: opts.input, timeoutMs: opts.timeoutMs }));
  }

  /** A shell script in the VM (as its user, in its home), on an X display. */
  sh(display: number): ShRunner {
    return (script, args, input) =>
      this.ready().then(() => exec(this.engine.bin, ["exec", "-i", "-u", this.user, "-w", this.home, "-e", `DISPLAY=:${display}`, "-e", `HOME=${this.home}`, this.name, "sh", "-c", script, "sh", ...args], { input, timeoutMs: 5 * 60_000 }));
  }

  // --- each agent's own screen (shared computer) ---------------------------------------------------

  /** Does this VM give each agent a screen of its own? Only the shared computer, on an image that has wisp-screen. */
  private screensSupported: boolean | null = null;
  /** the screens up, by agent (screen.sh's name for it), with when each was last used */
  private screensUp = new Map<string, { agentId: string; info: AgentScreenInfo; last: number }>();
  private screensStarting = new Map<string, Promise<AgentScreenInfo>>();
  private agentDrivers = new Map<string, AgentScreen>();
  /** how many live views are open on each agent's screen (it isn't stopped while someone watches) */
  private screenViewers = new Map<string, number>();
  /** told when which agents have a screen up changes */
  onScreens: (supported: boolean, agents: string[]) => void = () => {};

  /** The shared computer (as opposed to a VM of one agent's own, which keeps one screen). */
  get shared(): boolean {
    return !!(this.spec.config as VmConfig).shared;
  }

  /**
   * Whether agents get screens of their own here: the shared computer on an image that has
   * wisp-screen. An older image (a container made before it) keeps the one screen agents take turns on.
   */
  async agentScreens(): Promise<boolean> {
    if (!this.shared) return false;
    if (this.screensSupported !== null) return this.screensSupported;
    await this.ready();
    const r = await exec(this.bin, ["exec", this.name, "test", "-x", "/usr/local/bin/wisp-screen"], { timeoutMs: 15_000 });
    this.screensSupported = r.code === 0;
    if (this.screensSupported) await this.refreshScreens();
    // the hub hears either way: agents stop (or keep) taking turns
    this.screensChanged();
    return this.screensSupported;
  }

  /** The agent's view of this computer: its own screen where there are such, else the computer itself. */
  async forAgent(agentId: string | undefined): Promise<Driver> {
    if (!agentId || !(await this.agentScreens())) return this;
    let d = this.agentDrivers.get(agentId);
    if (!d) {
      d = new AgentScreen(
        {
          label: this.label,
          screen: (id) => this.screen(id),
          inVm: (display, argv, opts) => this.inVm(display, argv, opts),
          sh: (display) => this.sh(display),
          shell: (command, timeoutSec, display) => this.shell(command, timeoutSec, display),
          inspectAt: (x, y, port) => this.inspectAt(x, y, port),
          fillLogin: (login, port) => this.fillLogin(login, port),
          vncPort: (port) => this.vncPort(port),
          files: this.files,
          vm: this,
        },
        agentId,
      );
      this.agentDrivers.set(agentId, d);
    }
    return d;
  }

  /** Start the agent's screen if it isn't up, and mark it used now. */
  async screen(agentId: string): Promise<AgentScreenInfo> {
    const slug = screenSlug(agentId);
    const up = this.screensUp.get(slug);
    if (up) {
      up.last = Date.now();
      return up.info;
    }
    let p = this.screensStarting.get(slug);
    if (!p) {
      p = (async () => {
        await this.ready();
        const r = await exec(this.bin, ["exec", "-u", this.user, "-e", `HOME=${this.home}`, this.name, "wisp-screen", "up", slug], { timeoutMs: 60_000 });
        if (r.code !== 0) throw new ActionError(`couldn't start @${agentId}'s screen: ${r.stderr.toString().trim().split("\n").pop() || `wisp-screen failed (${r.code})`}`);
        const info = parseScreenInfo(r.stdout.toString());
        this.screensUp.set(slug, { agentId, info, last: Date.now() });
        this.screensChanged();
        return info;
      })().finally(() => this.screensStarting.delete(slug));
      this.screensStarting.set(slug, p);
    }
    return p;
  }

  /** A live view of an agent's screen opened (+1) or closed (-1): it stays up while watched. */
  watching(agentId: string, delta: number) {
    const slug = screenSlug(agentId);
    const n = (this.screenViewers.get(slug) ?? 0) + delta;
    if (n > 0) this.screenViewers.set(slug, n);
    else this.screenViewers.delete(slug);
    const up = this.screensUp.get(slug);
    if (up) up.last = Date.now();
  }

  /** Ask the VM which screens are up (an agent's browser tools start theirs inside it, without the device seeing). */
  async refreshScreens(): Promise<void> {
    if (!this.screensSupported || !(await this.isRunning())) return;
    const r = await exec(this.bin, ["exec", "-u", this.user, this.name, "wisp-screen", "list"], { timeoutMs: 15_000 }).catch(() => null);
    if (r?.code !== 0) return;
    const listed = parseScreenList(r.stdout.toString());
    let changed = false;
    for (const slug of [...this.screensUp.keys()])
      if (!listed.has(slug)) {
        this.screensUp.delete(slug);
        changed = true;
      }
    for (const [slug, display] of listed)
      if (!this.screensUp.has(slug)) {
        // started inside the VM (its browser tools): the agent id is the screen's name
        this.screensUp.set(slug, { agentId: slug, info: { display, vncPort: display + 5900, cdpPort: display + 9300 }, last: Date.now() });
        changed = true;
      }
    if (changed) this.screensChanged();
  }

  /** Stop the screens nobody has used for `idleMs` and nobody is watching. Returns the agents whose screen stopped. */
  async sweepScreens(idleMs = AGENT_SCREEN_IDLE_MS, at = Date.now()): Promise<string[]> {
    await this.refreshScreens();
    const stopped: string[] = [];
    for (const [slug, s] of this.screensUp) {
      if (at - s.last < idleMs || this.screenViewers.get(slug)) continue;
      const r = await exec(this.bin, ["exec", "-u", this.user, this.name, "wisp-screen", "down", slug], { timeoutMs: 30_000 }).catch(() => null);
      // its browser tools are still connected: a run is using it
      if (r?.code !== 0 || r.stdout.toString().includes("busy")) {
        s.last = at;
        continue;
      }
      this.screensUp.delete(slug);
      stopped.push(s.agentId);
    }
    if (stopped.length) this.screensChanged();
    return stopped;
  }

  /** The agents with a screen up now. */
  screenAgents(): string[] {
    return [...this.screensUp.values()].map((s) => s.agentId);
  }

  private screensChanged() {
    this.onScreens(!!this.screensSupported, this.screenAgents());
  }

  /** The VM went away (stopped, removed): so did every agent's screen; the next start looks at the image again. */
  private forgetScreens() {
    const known = this.screensSupported !== null;
    this.screensUp.clear();
    this.screensSupported = null;
    if (known) this.onScreens(false, []);
  }

  readonly clipboard: Clipboard;
  readonly files: Files;

  private get bin() {
    return this.engine.bin;
  }

  private resolveIdentity() {
    return this.identity ??= existingComputer(this.engine, this.spec.id).then((found) => { Object.assign(this, found); });
  }

  /** true, false (stopped), or null when there's no such container. */
  private async running(): Promise<boolean | null> {
    await this.resolveIdentity();
    if (this.engine.kind === "apple") {
      const info = await this.appleInfo();
      if (!info) return null;
      // { status: { state: "running", networks: [...] } } (older versions: status: "running")
      return (typeof info.status === "string" ? info.status : info.status?.state) === "running";
    }
    const r = await exec(this.bin, ["inspect", "-f", "{{.State.Running}}", this.name], { timeoutMs: 15_000 });
    if (r.code !== 0) return null; // no such container
    return r.stdout.toString().trim() === "true";
  }

  private async appleInfo(): Promise<{ status?: string | { state?: string; networks?: { ipv4Gateway?: string }[] } } | null> {
    const r = await exec(this.bin, ["inspect", this.name], { timeoutMs: 15_000 });
    if (r.code !== 0) return null;
    try {
      return (JSON.parse(r.stdout.toString()) as object[])[0] ?? null;
    } catch {
      return null;
    }
  }

  /** Make sure the VM exists and is running, getting the image the first time. A stop under way finishes first. */
  ready(): Promise<void> {
    this.starting ??= (async () => {
      await this.stopping?.catch(() => {});
      await this.boot();
    })().finally(() => (this.starting = null));
    return this.starting;
  }

  /** Where it lives (its container's name and user), known without starting it. */
  identityReady(): Promise<void> {
    return this.resolveIdentity();
  }

  private async boot() {
    const state = await this.running();
    if (state === true) return;
    this.forgetScreens();
    try {
      await this.bringUp(state);
      this.report("ready", "");
    } catch (err) {
      this.report("error", (err as Error).message);
      throw err;
    }
  }

  private onStatus(text: string) {
    this.report("starting", text);
  }

  private async bringUp(state: boolean | null) {
    if (state === false) {
      this.onStatus("Starting the computer…");
      await must(this.bin, ["start", this.name], { timeoutMs: 120_000 });
    } else {
      const custom = (this.spec.config as VmConfig).image;
      let image: string;
      if (custom) {
        image = custom;
        if (!(await imageExists(this.engine, image))) {
          this.onStatus(`Pulling ${image}…`);
          await withRetry(() => must(this.bin, this.engine.kind === "apple" ? ["image", "pull", image] : ["pull", image], { timeoutMs: 30 * 60_000 }), { delaysMs: BUILD_RETRY_MS });
        }
      } else image = await ensureImage(this.engine, (text) => this.onStatus(text), this.removed.signal);
      if (this.removed.signal.aborted) throw new ActionError(IMAGE_CANCELLED);
      fs.mkdirSync(this.filesDir, { recursive: true });
      if (this.engine.kind === "apple" && (await exec(this.bin, ["volume", "inspect", this.volume], { timeoutMs: 15_000 })).code !== 0) {
        await must(this.bin, ["volume", "create", this.volume], { timeoutMs: 60_000 });
      }
      this.onStatus("Setting up the computer…");
      await must(this.bin, runArgs(this.spec, { name: this.name, volume: this.volume, files: this.filesDir, image, kind: this.engine.kind }), { timeoutMs: 300_000 });
    }
    // wait for the desktop to come up
    for (let i = 0; i < 90; i++) {
      if (this.removed.signal.aborted) throw new ActionError(IMAGE_CANCELLED);
      const r = await exec(this.bin, ["exec", "-u", this.user, "-e", `DISPLAY=:${MAIN_DISPLAY}`, this.name, "xdotool", "getdisplaygeometry"], { timeoutMs: 10_000 });
      if (r.code === 0) {
        await exec(this.bin, ["exec", "-i", "-u", "root", this.name, "sh", "-s", "--", vmHostname(this.spec)], { input: NAME_INSIDE_SCRIPT, timeoutMs: 15_000 }).catch(() => {});
        return;
      }
      await new Promise((res) => setTimeout(res, 1000));
    }
    throw new ActionError("the VM started but its desktop didn't come up within a minute and a half");
  }

  private async shell(command: string, timeoutSec: number, display = MAIN_DISPLAY): Promise<RunOutput> {
    await this.ready();
    const r = await exec(this.bin, ["exec", "-i", "-u", this.user, "-w", this.home, "-e", `DISPLAY=:${display}`, this.name, "bash", "-lc", command], { timeoutMs: timeoutSec * 1000 });
    const output = (r.stdout.toString() + (r.stderr ? `\n${r.stderr}` : "")).trim();
    return { exitCode: r.code, output: output.length > 50_000 ? output.slice(0, 25_000) + "\n…\n" + output.slice(-25_000) : output };
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
  open = (target: string) => this.desktop.open(target);
  run = (command: string, timeoutSec: number) => this.shell(command, timeoutSec);

  async start() {
    await this.ready();
  }

  /**
   * Stop it, keeping its files, sign-ins and apps. A start under way finishes first, and a use
   * that arrives during the stop waits for it and then starts the VM again.
   */
  stop(): Promise<void> {
    this.stopping ??= (async () => {
      await this.starting?.catch(() => {});
      if (!(await this.running())) return;
      // made before VMs stopped when idle: don't let the engine bring it back on its own
      if (this.engine.kind !== "apple") await exec(this.bin, ["update", "--restart", "no", this.name], { timeoutMs: 15_000 }).catch(() => {});
      await must(this.bin, this.engine.kind === "apple" ? ["stop", "--time", "10", this.name] : ["stop", "-t", "10", this.name], { timeoutMs: 60_000 });
      this.forgetScreens();
      this.report("stopped", "");
    })().finally(() => (this.stopping = null));
    return this.stopping;
  }

  async destroy() {
    // a start still setting up gives up first, so it can't make the container after it's removed
    this.removed.abort();
    await this.starting?.catch(() => {});
    this.forgetScreens();
    await this.resolveIdentity();
    if (this.engine.kind === "apple") {
      await exec(this.bin, ["delete", "--force", this.name], { timeoutMs: 60_000 });
      await exec(this.bin, ["volume", "delete", this.volume], { timeoutMs: 60_000 });
      return;
    }
    await exec(this.bin, ["rm", "-f", this.name], { timeoutMs: 60_000 });
    await exec(this.bin, ["volume", "rm", "-f", this.volume], { timeoutMs: 60_000 });
  }

  async status() {
    const state = await this.running();
    if (this.starting) return { status: "starting" as const, detail: "Starting…" };
    if (state === true) return { status: "ready" as const, detail: "Running" };
    return { status: "stopped" as const, detail: state === null ? "Not created yet; it starts when it's first used" : "Stopped; it starts when it's next used" };
  }

  // --- running harnesses inside the VM ---------------------------------------------------------

  /** A path in the shared folder, as the VM sees it. */
  vmPath(hostPath: string): string {
    const rel = path.relative(this.filesDir, hostPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new ActionError(`${hostPath} isn't in the folder this VM shares`);
    return rel ? path.posix.join(`${this.home}/files`, ...rel.split(path.sep)) : `${this.home}/files`;
  }

  /**
   * How a harness starts inside this VM, as the wisp user, in its own process group so a
   * cancelled run can be stopped there (stopping `exec` alone leaves the process running).
   */
  launcher(runId: string, agentId?: string) {
    const safe = runId.replace(/[^\w-]/g, "");
    // on the shared computer the agent's browser tools (and Chrome it opens) use its own screen and profile
    const agentEnv: Record<string, string> = agentId && this.shared ? { WISP_AGENT: screenSlug(agentId) } : {};
    const pidFile = `/tmp/wisp-run-${safe}.pid`;
    return async (l: { command: string; args: string[]; cwd: string; env: Record<string, string>; files?: { path: string; content: string }[] }) => {
      // files the harness needs (its MCP config) go into the VM, and the arguments point at them there
      let args = l.args;
      for (const f of l.files ?? []) {
        const inVm = `/tmp/wisp-run-${safe}/${path.basename(f.path)}`;
        await this.writeFile(inVm, f.content, "600");
        args = args.map((a) => a.split(f.path).join(inVm));
      }
      return this.exec({ ...l, env: { ...agentEnv, ...l.env } }, args, pidFile);
    };
  }

  private exec(l: { command: string; cwd: string; env: Record<string, string> }, args: string[], pidFile: string) {
    return {
      command: this.bin,
      args: [
        "exec",
        "-i",
        "-u",
        this.user,
        "-w",
        this.vmPath(l.cwd),
        "-e",
        `DISPLAY=:${MAIN_DISPLAY}`,
        "-e",
        `HOME=${this.home}`,
        ...Object.entries(l.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
        this.name,
        "setsid",
        "--wait",
        "sh",
        "-c",
        `echo $$ > ${pidFile}; exec "$@"`,
        "sh",
        l.command,
        ...args,
      ],
      // the engine runs here; it only needs a folder that exists
      cwd: this.filesDir,
      env: {},
    };
  }

  /** Stop what a run started inside the VM. */
  async stopRun(runId: string) {
    const pidFile = `/tmp/wisp-run-${runId.replace(/[^\w-]/g, "")}.pid`;
    await exec(this.bin, ["exec", this.name, "sh", "-c", `p=$(cat ${pidFile} 2>/dev/null) && { kill -TERM -$p 2>/dev/null || kill -TERM $p; }; rm -f ${pidFile}`], { timeoutMs: 15_000 }).catch(() => undefined);
  }

  /** A run is over: the files it had put in the VM (its tools' config has tokens in it) and its pid file go. */
  async cleanupRun(runId: string) {
    const safe = runId.replace(/[^\w-]/g, "");
    await exec(this.bin, ["exec", "-u", this.user, this.name, "rm", "-rf", `/tmp/wisp-run-${safe}`, `/tmp/wisp-run-${safe}.pid`], { timeoutMs: 15_000 });
  }

  /** Put a file in the VM (as wisp), e.g. Bubble AI's tools for harnesses that run in here. */
  async writeFile(vmPath: string, content: string | Buffer, mode = "644") {
    await this.ready();
    await must(this.bin, ["exec", "-i", "-u", this.user, this.name, "sh", "-c", writeFileScript(vmPath, mode)], { input: content, timeoutMs: 60_000 });
  }

  /** Remove the folders of model connections not in `keep` (a removed connection's sign-ins and keys). */
  async pruneConnections(keep: string[]) {
    await this.ready();
    await exec(this.bin, ["exec", "-u", this.user, this.name, "sh", "-c", PRUNE_CONNECTIONS_SCRIPT, "sh", `${this.home}/.bubble-ai/connections`, ...keep], { timeoutMs: 30_000 });
  }

  /** A file in the VM (as wisp), or null when it isn't there. */
  async readFile(vmPath: string): Promise<string | null> {
    await this.ready();
    const r = await exec(this.bin, ["exec", "-u", this.user, this.name, "cat", vmPath], { timeoutMs: 30_000 });
    return r.code === 0 ? r.stdout.toString() : null;
  }

  /** The names in a folder in the VM (none when it isn't there). */
  async readDir(vmPath: string): Promise<string[]> {
    await this.ready();
    const r = await exec(this.bin, ["exec", "-u", this.user, this.name, "ls", "-1A", vmPath], { timeoutMs: 30_000 });
    return r.code === 0 ? r.stdout.toString().split("\n").filter(Boolean) : [];
  }

  /** Run a command in the VM (as wisp, in its home) and get what it printed; throws when it fails. */
  async runCommand(command: string, args: string[], timeoutMs = 30_000): Promise<string> {
    await this.ready();
    const r = await exec(this.bin, ["exec", "-i", "-u", this.user, "-w", this.home, "-e", `HOME=${this.home}`, this.name, command, ...args], { timeoutMs });
    if (r.code !== 0) throw new ActionError(r.stderr.toString().trim().split("\n").pop() || `${command} failed in the VM`);
    return r.stdout.toString();
  }

  /** Point `link` at `target` in the VM, when `target` exists and nothing is at `link` yet. */
  async symlink(target: string, link: string) {
    await this.ready();
    await exec(this.bin, ["exec", "-u", this.user, this.name, "sh", "-c", 'if [ -e "$1" ] && [ ! -e "$2" ] && [ ! -L "$2" ]; then mkdir -p "$(dirname "$2")" && ln -s "$1" "$2"; fi', "sh", target, link], { timeoutMs: 15_000 });
  }

  /** Is it up right now? (Without starting it.) */
  async isRunning(): Promise<boolean> {
    return (await this.running()) === true;
  }

  /** Is this harness signed in inside the VM? null when it isn't one that comes with the VM. */
  async signedIn(harness: string): Promise<boolean | null> {
    const test = SIGNED_IN[harness];
    if (!test) return null;
    await this.ready();
    return (await exec(this.bin, ["exec", "-u", this.user, "-e", `HOME=${this.home}`, this.name, "sh", "-c", test], { timeoutMs: 15_000 })).code === 0;
  }

  /** The web page element under a screen point, in the Chrome people see. */
  async inspectAt(x: number, y: number, cdpPort?: number): Promise<PageElement | null> {
    await this.ready();
    const r = await exec(this.bin, ["exec", "-u", this.user, ...(cdpPort ? ["-e", `CDP_PORT=${cdpPort}`] : []), this.name, "node", "--input-type=module", "-e", INSPECT_SCRIPT, String(Math.round(x)), String(Math.round(y))], { timeoutMs: 15_000 });
    if (r.code !== 0) return null;
    try {
      return JSON.parse(r.stdout.toString().trim().split("\n").pop() ?? "null");
    } catch {
      return null;
    }
  }

  /** Put a login into the page open in the VM's Chrome; the login goes in on stdin, never as an argument. */
  async fillLogin(login: { site: string; username: string; password: string; otp?: string }, cdpPort?: number): Promise<LoginFillResult> {
    await this.ready();
    const r = await exec(this.bin, ["exec", "-i", "-u", this.user, ...(cdpPort ? ["-e", `CDP=http://127.0.0.1:${cdpPort}`] : []), this.name, "node", "--input-type=module", "-e", FILL_LOGIN_SCRIPT], { input: JSON.stringify(login), timeoutMs: 30_000 });
    if (r.code !== 0) throw new ActionError(`couldn't reach the browser on ${this.label}`);
    try {
      return JSON.parse(r.stdout.toString().trim().split("\n").pop() ?? "");
    } catch {
      throw new ActionError(`the browser on ${this.label} didn't answer`);
    }
  }

  /** Open a terminal on the VM's screen that signs the harness in; a person finishes it there. */
  async openSignIn(harness: string) {
    const cmd = SIGN_IN_COMMAND[harness];
    if (!cmd) throw new ActionError(`${harness} doesn't come with the VM`);
    await this.ready();
    await must(
      this.bin,
      ["exec", "-d", "-u", this.user, "-e", `DISPLAY=:${MAIN_DISPLAY}`, "-e", `HOME=${this.home}`, "-w", `${this.home}/files`, this.name, "xfce4-terminal", "--maximize", "--title", "Sign in", "--command", `bash -lc '${cmd}; exec bash'`],
      { timeoutMs: 30_000 },
    );
  }

  /**
   * The hub's address as the VM reaches it: the same, unless the hub runs on this device under
   * localhost, which inside the VM means the VM itself.
   */
  async hubUrl(hub: string): Promise<string> {
    const u = new URL(hub);
    if (!["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(u.hostname)) return hub.replace(/\/+$/, "");
    const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
    // where the VM reaches this device: its network's gateway, with a relay to the hub on loopback
    let gateway: string | undefined;
    if (this.engine.kind === "apple") {
      const info = await this.appleInfo();
      gateway = (typeof info?.status === "object" ? info.status.networks?.[0]?.ipv4Gateway : undefined) ?? "192.168.64.1";
    } else if (this.engine.kind === "docker" && process.platform === "linux") {
      const r = await exec(this.bin, ["network", "inspect", "bridge", "-f", "{{(index .IPAM.Config 0).Gateway}}"], { timeoutMs: 15_000 });
      gateway = r.code === 0 ? r.stdout.toString().trim() || undefined : undefined;
    }
    if (gateway) {
      u.hostname = gateway;
      u.port = String(await relay(gateway, port));
    } else u.hostname = this.engine.kind === "podman" ? "host.containers.internal" : "host.docker.internal"; // these reach the host's loopback
    return u.toString().replace(/\/+$/, "");
  }

  /** The VM's VNC server, through socat inside it. */
  async vnc(): Promise<Duplex> {
    return this.vncPort(MAIN_VNC);
  }

  /** A VNC server in the VM (the main screen's, or an agent's own), through socat inside it. */
  async vncPort(port: number): Promise<Duplex> {
    await this.ready();
    const child = spawn(this.bin, ["exec", "-i", this.name, "socat", "STDIO", `TCP:127.0.0.1:${port}`], { stdio: ["pipe", "pipe", "ignore"] });
    const stream = Duplex.from({ readable: child.stdout, writable: child.stdin });
    stream.on("close", () => child.kill());
    child.on("close", () => stream.destroy());
    return stream;
  }
}
