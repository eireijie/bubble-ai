/**
 * Live proof that Hermes installs with one tap on a person's own device, from its pinned official
 * installer, and comes up using the model connection the person made in Bubble AI. A throwaway hub
 * and a real device on this computer, both with HOME under <scratch>; the person's own ~/.hermes,
 * ~/.local/bin/hermes and ~/.bubble-ai are never on the PATH or written.
 *
 *   HOME=<scratch>/home tsx apps/hub/test/live/hermes-install.live.ts <scratch> [port]
 *
 * It sets up an owner, a device ("This Mac"), an Anthropic key connection (a made-up key: what's
 * proven is where it lands, not that Anthropic takes it) and an agent on Hermes, writes
 * <scratch>/hermes-live.json (hub address, owner token, ids) and keeps running, so the web app can be
 * pointed at the hub (BUBBLE_HUB=<url>) and Install pressed there. With `--install` it presses
 * Install itself through the API and reports what the device did.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deviceAdapters } from "@bubble-ai/adapters";
import { WispClient } from "@bubble-ai/sdk";
import { NodeDaemon } from "../../../node/src/daemon.ts";
import { buildHub } from "../../src/app.ts";

const dir = process.argv[2];
if (!dir) throw new Error("usage: hermes-install.live.ts <scratch folder> [port] [--install]");
const home = os.homedir();
if (!home.startsWith(path.resolve(dir))) throw new Error(`set HOME under ${dir} first (it is ${home})`);
const port = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 0);
for (const k of Object.keys(process.env)) if (/^(CLAUDE|ANTHROPIC|HERMES)/.test(k)) delete process.env[k];
// nothing from the real home folder: its hermes (~/.local/bin) must not count as installed
const realHome = (process.env.REAL_HOME ?? "/Users/" + (process.env.USER ?? "")).replace(/\/$/, "");
process.env.PATH = (process.env.PATH ?? "")
  .split(path.delimiter)
  .filter((p) => !p.startsWith(realHome + "/") || p.includes("/node_modules/"))
  .join(path.delimiter);

const built = await buildHub({ dataDir: path.join(dir, "hub"), setupCode: false });
const { hub } = built;
await built.app.listen({ port, host: "127.0.0.1" });
const url = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
const password = `live-${Date.now()}`;
const setup = await (await fetch(url + "/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", name: "Owner", password, features: "everything" }) })).json();
const owner = new WispClient({ url, token: setup.token });
const { node, token } = await owner.request("POST", "/api/nodes", { name: "This Mac" });
const ownerId = hub.store.node(node.id)!.ownerId!;
const ws = hub.store.node(node.id)!.workspaceId;
const connectionId = hub.models.create({ workspaceId: ws, userId: ownerId, provider: "anthropic", kind: "key", label: "Anthropic", secret: { key: "sk-ant-api03-bubble-live-test-not-a-real-key" } });
// the key is made up, so the connection can't list Anthropic's models: name the one Bubble AI would pick
hub.models.models = (async () => [{ id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" }]) as unknown as typeof hub.models.models;

const nodeDir = path.join(dir, "node");
await fs.mkdir(nodeDir, { recursive: true });
const log: string[] = [];
const daemon = new NodeDaemon({ hub: url, token, name: "This Mac", dir: nodeDir, harnessHome: home, noPrepare: true }, (m) => (log.push(m), console.log(`[device] ${m}`)), deviceAdapters());
daemon.start();
const end = Date.now() + 30_000;
while (!hub.isNodeOnline(node.id)) {
  if (Date.now() > end) throw new Error("the device didn't connect");
  await new Promise((r) => setTimeout(r, 300));
}
const agent = await owner.request("POST", "/api/agents", { handle: "hermy", name: "Hermy", harness: "hermes", nodeId: node.id, greet: "later", settings: { connectionId } });
const info = { hub: url, password, email: "owner@example.com", token: setup.token, nodeId: node.id, agentId: agent.id, connectionId, home };
await fs.writeFile(path.join(dir, "hermes-live.json"), JSON.stringify(info, null, 2));
console.log(JSON.stringify(info));
console.log(`before: hermes on This Mac? ${hub.store.nodeCatalog(node.id).some((c) => c.harness === "hermes")}`);

if (process.argv.includes("--install")) {
  const started = Date.now();
  const r = await owner.request("POST", `/api/nodes/${node.id}/install`, { harness: "hermes" }).catch((e) => ({ error: (e as Error).message }));
  console.log(`install answered after ${Math.round((Date.now() - started) / 1000)}s: ${JSON.stringify(r)}`);
}

const stop = async () => {
  await daemon.stop(1000).catch(() => {});
  await built.app.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
