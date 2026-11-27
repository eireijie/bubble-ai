/**
 * Live proof that an owner's own computer is usable by their agents by default: a throwaway hub and
 * a real device on this computer (its screen on, as the desktop app sets it after its first run),
 * then a fresh agent with no computer takes a screenshot of it through the MCP tools.
 *
 *   HOME=<scratch>/home tsx apps/hub/test/live/device-default.live.ts <scratch>
 *
 * Writes <scratch>/device-default.json (what happened) and <scratch>/device-default.jpg (the shot).
 * Never touches ~/.bubble-ai: everything lives under <scratch>, and HOME must point there too.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { deviceAdapters } from "@bubble-ai/adapters";
import { WispClient } from "@bubble-ai/sdk";
import { createWispMcp } from "@bubble-ai/mcp/src/server.ts";
import { NodeDaemon } from "../../../node/src/daemon.ts";
import { buildHub } from "../../src/app.ts";

const dir = process.argv[2];
if (!dir) throw new Error("usage: device-default.live.ts <scratch folder>");
if (!os.homedir().startsWith(path.resolve(dir))) throw new Error(`set HOME under ${dir} first (it is ${os.homedir()})`);
for (const k of Object.keys(process.env)) if (/^(CLAUDE|ANTHROPIC)/.test(k)) delete process.env[k];

const waitFor = async (what: string, ok: () => boolean | Promise<boolean>, ms = 30_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 300));
  }
};

const built = await buildHub({ dataDir: path.join(dir, "hub"), setupCode: false });
const { hub } = built;
await built.app.listen({ port: 0, host: "127.0.0.1" });
const url = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
const setup = await (await fetch(url + "/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", name: "Owner", password: `live-${Date.now()}`, features: "everything" }) })).json();
const owner = new WispClient({ url, token: setup.token });
const report: Record<string, unknown> = { hub: url };

// an agent made before this computer turns its screen on
const early = await owner.request("POST", "/api/agents", { handle: "early", name: "Early", harness: "custom", greet: "later" });
const { node, token } = await owner.request("POST", "/api/nodes", { name: "This Mac" });
// what the desktop app writes once it may: the screen on for agents, no code
const nodeDir = path.join(dir, "node");
await fs.mkdir(nodeDir, { recursive: true });
await fs.writeFile(path.join(nodeDir, "node.json"), JSON.stringify({ shareScreen: true }));
const log: string[] = [];
const daemon = new NodeDaemon({ hub: url, token, name: "This Mac", dir: nodeDir }, (m) => log.push(m), deviceAdapters());
daemon.start();
try {
  await waitFor("the device's screen to report on", () => !!hub.store.nodeCapabilities(node.id)?.screen.ok && !hub.store.nodeCapabilities(node.id)?.screen.off);
  report.screen = hub.store.nodeCapabilities(node.id)?.screen;
  report.earlyAgentUseDevices = hub.store.agent(early.id)?.settings.useDevices;

  // a fresh agent, no computer of its own
  const fresh = await owner.request("POST", "/api/agents", { handle: "fresh", name: "Fresh", harness: "custom", greet: "later" });
  report.freshAgent = { computerId: fresh.computerId ?? null, useDevices: fresh.settings.useDevices };
  report.freshPrompt = hub.computerSection(fresh.id);

  const agentToken = (await owner.request("POST", `/api/agents/${fresh.id}/token`)).token;
  const server = await createWispMcp(new WispClient({ url, token: agentToken }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const mcp = new Client({ name: "live", version: "0" });
  await mcp.connect(b);
  report.computerTools = (await mcp.listTools()).tools.map((t) => t.name).filter((n) => n.startsWith("computer_"));
  const shot = (await mcp.callTool({ name: "computer_screenshot", arguments: {} })) as { content: ({ type: "image"; data: string; mimeType: string } | { type: "text"; text: string })[]; isError?: boolean };
  const image = shot.content.find((c) => c.type === "image") as { data: string; mimeType: string } | undefined;
  report.screenshot = { isError: !!shot.isError, text: shot.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join(" "), bytes: image ? Buffer.from(image.data, "base64").length : 0, mime: image?.mimeType ?? null };
  if (image) await fs.writeFile(path.join(dir, "device-default.jpg"), Buffer.from(image.data, "base64"));
  await mcp.close();
} finally {
  report.deviceLog = log.slice(-20);
  await fs.writeFile(path.join(dir, "device-default.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  daemon.stop();
  await built.app.close();
}
process.exit(0);
