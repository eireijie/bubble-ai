import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HarnessAdapter, RunInput } from "@bubble-ai/adapters";
import type { MessagePart } from "@bubble-ai/core";
import { WispClient } from "@bubble-ai/sdk";
import { NodeDaemon } from "../../node/src/daemon.ts";
import { buildHub } from "../src/app.ts";
import type { Hub } from "../src/hub.ts";
import { FALLBACK_TEXT, fallbackSuggestion, suggestion } from "../src/setup-picks.ts";

let dir: string;
let close: () => Promise<void>;
let daemon: NodeDaemon;
let owner: WispClient;
let hub: Hub;
let url: string;
let nodeId: string;
let me: string;
const calls: RunInput[] = [];
/** what the fake harness does with a message; throwing makes the run fail */
let onReply: (agent: WispClient, input: RunInput) => Promise<string> = async () => "Hi!";

const fake: HarnessAdapter = {
  id: "claude-code",
  label: "Fake",
  binary: "true",
  async run(input, onEvent) {
    calls.push(input);
    onEvent({ type: "session", id: `sess-${calls.length}` });
    const agent = new WispClient({ url: input.mcp!.env.BUBBLE_URL, token: input.mcp!.env.BUBBLE_TOKEN });
    return { finalText: await onReply(agent, input), sessionId: `sess-${calls.length}` };
  },
};

const waitFor = async <T>(fn: () => Promise<T | undefined> | T | undefined, ms = 15_000): Promise<T> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out");
};

const idle = () => waitFor(() => !hub.store.db.prepare("SELECT 1 FROM runs WHERE status IN ('queued','running')").get() || undefined);
const dmOf = (agentId: string) => hub.store.dmChannel(hub.store.agent(agentId)!.workspaceId, me, agentId);
const said = (agentId: string) => hub.store.messages(dmOf(agentId).id).filter((m) => m.body);
const make = async (handle: string, extra: Record<string, unknown> = {}) => (await owner.request<{ id: string }>("POST", "/api/agents", { handle, name: handle[0].toUpperCase() + handle.slice(1), harness: "claude-code", nodeId, ...extra })).id;
const connectPart = (parts: MessagePart[]) => parts.find((p): p is Extract<MessagePart, { type: "connect" }> => p.type === "connect");
const PICKS = { text: "I'd like help with: keeping my days on track and staying on top of my messages. About me: I work weekends.", goals: ["days", "msgs"] };

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "wisp-picks-"));
  const built = await buildHub({ dataDir: path.join(dir, "hub"), setupCode: false });
  hub = built.hub;
  hub.push.send = async () => {};
  await built.app.listen({ port: 0, host: "127.0.0.1" });
  url = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
  close = () => built.app.close();
  const setup = await (await fetch(url + "/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "me@example.com", name: "Me", password: "password123", features: "everything" }) })).json();
  owner = new WispClient({ url, token: setup.token });
  const { node, token } = await owner.request("POST", "/api/nodes", { name: "box" });
  nodeId = node.id;
  me = (hub.store.db.prepare("SELECT id FROM users").get() as { id: string }).id;
  daemon = new NodeDaemon({ hub: url, token, name: "box", dir: path.join(dir, "node") }, () => {}, { "claude-code": fake });
  daemon.start();
  await waitFor(async () => (await owner.request<{ id: string; online: boolean }[]>("GET", "/api/nodes")).find((n) => n.online));
});

afterAll(async () => {
  daemon?.stop();
  await close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("what an agent suggests connecting", () => {
  it("always has Composio first, recommended, with its own line, and only apps that connect with one tap", () => {
    const { apps, unknown } = suggestion([{ id: "gmail", why: "So I can read your email" }, { id: "git" }, { id: "nope" }, { id: "GMAIL" }, { id: "composio" }]);
    expect(apps[0]).toEqual({ id: "composio", name: "Composio", why: "Use Composio for more apps and easy sign-in.", recommended: true });
    expect(apps.slice(1)).toEqual([{ id: "gmail", name: "Gmail", why: "So I can read your email" }]);
    // git has no sign-in; "nope" isn't an app
    expect(unknown).toEqual(["git", "nope"]);
  });

  it("falls back to the apps that usually help with each pick, each once", () => {
    expect(fallbackSuggestion(["days", "msgs", "plans"]).map((a) => a.id)).toEqual(["composio", "gcal", "gmail", "slack"]);
    expect(fallbackSuggestion([]).map((a) => a.id)).toEqual(["composio"]);
  });
});

describe("the picks go to the agent, and it picks the apps", () => {
  it("sends the picks as the person's message; the agent's reply carries the apps it chose", async () => {
    const id = await make("tony");
    await idle();
    let prompt = "";
    onReply = async (agent, input) => {
      prompt = input.prompt;
      await agent.connectSuggest([{ id: "gcal", why: "So I can keep your days on track" }, { id: "gmail", why: "So I can flag messages that need you" }]);
      return "Got it! Here's what I'd connect.";
    };
    const r = await owner.request<{ messageId: string; answered: boolean }>("POST", `/api/agents/${id}/setup-picks`, PICKS);
    expect(r.answered).toBe(false);
    await waitFor(() => said(id).find((m) => m.author.kind === "agent" && m.body.startsWith("Got it")));
    await idle();
    const msgs = said(id);
    const mine = msgs.find((m) => m.id === r.messageId)!;
    expect(mine.author).toEqual({ kind: "user", id: me });
    expect(mine.body).toBe(PICKS.text);
    expect(prompt).toContain("picks from setup");
    expect(prompt).toContain("connect_suggest");
    const reply = await waitFor(() => {
      const m = said(id).find((x) => x.body.startsWith("Got it"));
      return m && connectPart(m.parts) ? m : undefined;
    });
    expect(connectPart(reply.parts)!.apps.map((a) => a.id)).toEqual(["composio", "gcal", "gmail"]);
    expect(hub.store.agent(id)!.settings.setup!.picks).toMatchObject({ messageId: r.messageId, goals: ["days", "msgs"], answered: true });
    // once
    await expect(owner.request("POST", `/api/agents/${id}/setup-picks`, PICKS)).rejects.toThrow(/already sent/);
  });

  it("puts Bubble AI's own list under a reply that suggested nothing", async () => {
    const id = await make("uma");
    await idle();
    onReply = async () => "Sounds good! What should I start on?";
    await owner.request("POST", `/api/agents/${id}/setup-picks`, PICKS);
    const reply = await waitFor(() => {
      const m = said(id).find((x) => x.body.startsWith("Sounds good"));
      return m && connectPart(m.parts) ? m : undefined;
    });
    expect(connectPart(reply.parts)!.apps.map((a) => a.id)).toEqual(["composio", "gcal", "gmail", "slack"]);
  });

  it("answers for the agent when its run fails", async () => {
    const id = await make("vic");
    await idle();
    onReply = async () => {
      throw new Error("model is down");
    };
    await owner.request("POST", `/api/agents/${id}/setup-picks`, PICKS);
    const fallback = await waitFor(() => said(id).find((m) => m.body === FALLBACK_TEXT));
    expect(fallback.author).toEqual({ kind: "agent", id });
    expect(connectPart(fallback.parts)!.apps[0]).toMatchObject({ id: "composio", recommended: true });
  });

  it("answers right away, without a run, when the agent can't run now", async () => {
    const id = await make("wes");
    await idle();
    hub.store.updateAgent(id, { nodeId: null });
    const before = calls.length;
    const r = await owner.request<{ answered: boolean }>("POST", `/api/agents/${id}/setup-picks`, PICKS);
    expect(r.answered).toBe(true);
    expect(said(id).at(-1)!.body).toBe(FALLBACK_TEXT);
    expect(calls.length).toBe(before);
  });

  it("only lets an agent suggest apps while it's answering someone", async () => {
    const id = await make("xan");
    await idle();
    const { token } = await owner.request<{ token: string }>("POST", `/api/agents/${id}/token`);
    await expect(new WispClient({ url, token }).connectSuggest([{ id: "gmail" }])).rejects.toThrow(/only while answering/);
  });
});
