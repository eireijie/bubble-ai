import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HarnessAdapter, RunInput } from "@wisp/adapters";
import { WispClient } from "@wisp/sdk";
import { NodeDaemon } from "../../node/src/daemon.ts";
import { buildHub } from "../src/app.ts";
import type { Hub } from "../src/hub.ts";

/**
 * What a day of unattended work costs in model calls, with a fake harness and a clock that jumps five
 * minutes at a time. Three agents, each left alone for 24 hours:
 *
 * - Fresh: made the way first-run setup makes one (its own computer, background work on), nothing else.
 * - Watcher: also connected to Notion with a watch on it. Nothing changes all day.
 * - Busy: the same, on a day when Notion changes 13 times: 12 edits that don't matter to the person
 *   and one that does.
 * - Noted: a fresh agent on a day when six notes are saved in the memory it shares with other agents
 *   (as their memory passes do), none of them about what the person asked it to watch.
 *
 * It prints the calls as `USAGE-DAY {...}` (and writes them to the file named by USAGE_OUT). Written against APIs `main` had before the usage work, so
 * the same file measures before and after; the limits it asserts only apply where sorting exists.
 */

let dir: string;
let close: () => Promise<void>;
let daemon: NodeDaemon;
let owner: WispClient;
let hub: Hub;
let me: string;
let ws: string;
let nodeId: string;
const calls: { agent: string; kind: "sort" | "check" | "chat" }[] = [];

/** What a full check and a sort used with a real model (Codex on its small model, cached input included), rounded. */
const CHECK_TOKENS = 100_000;
const SORT_TOKENS = 13_700;

const fake: HarnessAdapter = {
  id: "custom",
  label: "Fake",
  binary: "true",
  async catalog() {
    return { harness: "custom", version: "1", efforts: ["low"], models: [{ id: "big", label: "Big" }, { id: "small-mini", label: "Small mini" }] };
  },
  async run(input: RunInput, onEvent) {
    const agent = /agents\/([^/]+)/.exec(input.cwd)?.[1] ?? input.cwd;
    // a sort has no tools; it says yes only to what the person asked about
    if (!input.mcp) {
      calls.push({ agent, kind: "sort" });
      onEvent({ type: "usage", inputTokens: SORT_TOKENS - 20, outputTokens: 20 });
      return { finalText: JSON.stringify({ wake: /launch/i.test(input.prompt.split("<<<outside")[1] ?? ""), why: "" }), sessionId: null };
    }
    const check = input.prompt.includes("## Working in the background");
    calls.push({ agent, kind: check ? "check" : "chat" });
    onEvent({ type: "usage", inputTokens: CHECK_TOKENS - 500, outputTokens: 500 });
    return { finalText: check ? "nothing new" : "hi", sessionId: null };
  },
};

const waitFor = async <T>(fn: () => Promise<T | undefined> | T | undefined, ms = 8000): Promise<T> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out");
};
const idle = () => waitFor(() => !hub.store.db.prepare("SELECT 1 FROM runs WHERE status IN ('queued','running')").get() || undefined);

let pages: unknown[] = [];
const page = (id: string, title: string, at: number) => ({ object: "page", id, url: `https://notion.so/${id}`, created_time: "2026-01-01T00:00:00.000Z", last_edited_time: new Date(at).toISOString(), last_edited_by: { id: "u1" }, properties: { Name: { type: "title", title: [{ plain_text: title }] } } });

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "wisp-usage-day-"));
  const built = await buildHub({ dataDir: path.join(dir, "hub"), setupCode: false });
  hub = built.hub;
  hub.watches.fetch = (async (input: Parameters<typeof fetch>[0]) => (String(input).startsWith("https://api.notion.com/v1/search") ? Response.json({ results: pages }) : new Response("not found", { status: 404 }))) as typeof fetch;
  await built.app.listen({ port: 0, host: "127.0.0.1" });
  const url = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
  close = () => built.app.close();
  const setup = await (await fetch(url + "/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "me@example.com", name: "Me", password: "password123", features: "everything" }) })).json();
  owner = new WispClient({ url, token: setup.token });
  const made = await owner.request("POST", "/api/nodes", { name: "box" });
  nodeId = made.node.id;
  me = (hub.store.db.prepare("SELECT id FROM users").get() as { id: string }).id;
  hub.store.db.prepare("UPDATE users SET timezone = 'UTC' WHERE id = ?").run(me);
  daemon = new NodeDaemon({ hub: url, token: made.token, name: "box", dir: path.join(dir, "node") }, () => {}, { custom: fake });
  daemon.start();
  ws = hub.store.firstWorkspace()!.id;
}, 60_000);

afterAll(async () => {
  daemon?.stop();
  await close();
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}, 60_000);

/** An agent as first-run setup makes one: its own computer, background work every 3 hours, no quiet hours (so the whole day counts). */
async function makeAgent(handle: string, notion: boolean) {
  const id = (await owner.request("POST", "/api/agents", { handle, name: handle, harness: "custom", nodeId, greet: "later" })).id as string;
  await waitFor(async () => (await owner.agents()).find((a) => a.id === id && a.status === "online"));
  const computer = hub.store.createComputer({ workspaceId: ws, name: `${handle}'s computer`, kind: "vm", nodeId: null, config: {} as never });
  hub.store.db.prepare("UPDATE agents SET computer_id = ? WHERE id = ?").run(computer.id, id);
  if (notion) {
    const c = hub.connectors.create(ws, me, { kind: "mcp-stdio", name: `Notion ${handle}`, catalogId: "notion", command: "npx", args: [], env: { NOTION_TOKEN: "ntn_good" } });
    hub.connectors.attach(c.id, id, true);
  }
  return id;
}

/** Run one agent's day: turn background work on at 08:00 and step the clock to 08:00 the next day. */
let days = 0;
async function day(handle: string, opts: { notion?: boolean; edits?: { atMinute: number; id: string; title: string }[]; notes?: { atMinute: number; path: string }[] } = {}) {
  // each agent gets a day of its own (one person's allowance is per day), well after the real clock so notes written
  // while the test runs don't look newer than the agent's last check
  const start = Date.UTC(2031, 0, 6 + 3 * days++, 8);
  vi.setSystemTime(start);
  const id = await makeAgent(handle, !!opts.notion);
  pages = [page("p0", "Old notes", start - 86_400_000)];
  const from = calls.length;
  await owner.request("PUT", `/api/agents/${id}/background`, { enabled: true, everyMinutes: 180, quietStart: "00:00", quietEnd: "00:00", focus: "Tell me when the launch plan changes." });
  await idle();
  if (opts.notion) {
    const w = await hub.watches.create({ workspaceId: ws, userId: me, agentIds: [id], service: "notion", createdBy: me });
    if ("error" in w) throw new Error(w.error);
  }
  for (let m = 5; m <= 24 * 60; m += 5) {
    vi.setSystemTime(start + m * 60_000);
    for (const e of opts.edits ?? []) if (e.atMinute === m) pages = [page(e.id, e.title, start + m * 60_000)];
    for (const n of opts.notes ?? [])
      if (n.atMinute === m) {
        await hub.vault(ws).write(n.path, `# ${n.path}\n\nSaved by another agent.\n`, { name: "Other", email: "other@example.com" }, "note");
        // the file's own time is the real clock's; the day being played is the simulated one
        (hub.vault(ws) as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): void } } }).db.prepare("UPDATE vault_notes SET updated_at = ? WHERE path = ?").run(start + m * 60_000, n.path);
      }
    hub.background.tick();
    await hub.watches.tick();
    await new Promise((r) => setTimeout(r, 2));
    await idle();
  }
  // done for the day, so the next agent's day starts clean
  hub.store.setBackground(id, me, { enabled: false });
  const mine = calls.slice(from);
  const n = (kind: string) => mine.filter((c) => c.kind === kind).length;
  return { checks: n("check"), sorts: n("sort"), tokens: n("check") * CHECK_TOKENS + n("sort") * SORT_TOKENS };
}

describe("a day left alone", () => {
  it("counts the model calls three kinds of agent make in 24 hours", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const fresh = await day("fresh");
      const watcher = await day("watcher", { notion: true });
      // 12 edits nobody asked about, spread over the day, and one to the launch plan
      const edits = Array.from({ length: 12 }, (_, i) => ({ atMinute: 60 + i * 100, id: `n${i}`, title: `Meeting notes ${i + 1}` }));
      edits.push({ atMinute: 700, id: "launch", title: "Launch plan: date moved to Friday" });
      const busy = await day("busy", { notion: true, edits });
      const noted = await day("noted", { notes: Array.from({ length: 6 }, (_, i) => ({ atMinute: 90 + i * 200, path: `shared/notes-${i + 1}.md` })) });
      console.log("USAGE-DAY " + JSON.stringify({ fresh, watcher, busy, noted }));
      // USAGE_OUT=<file> keeps the numbers (a passing test's output isn't always shown)
      if (process.env.USAGE_OUT) await fs.writeFile(process.env.USAGE_OUT, JSON.stringify({ fresh, watcher, busy, noted }));
      // where changes are sorted first (this branch): the first look when background work is turned on, then nothing
      if ("triage" in hub) {
        expect(fresh).toMatchObject({ checks: 1, sorts: 0 });
        expect(watcher).toMatchObject({ checks: 1, sorts: 0 });
        // every batch of edits is sorted; only the launch plan wakes the agent
        expect(busy.checks).toBe(2);
        expect(busy.sorts).toBe(13);
        // notes other agents save are sorted too: no full check for any of them
        expect(noted.checks).toBe(1);
        expect(noted.sorts).toBeGreaterThanOrEqual(1);
        expect(noted.sorts).toBeLessThanOrEqual(6);
      }
    } finally {
      vi.useRealTimers();
    }
  }, 300_000);
});
