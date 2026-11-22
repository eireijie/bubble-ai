/**
 * Agents working unattended, with a real harness and real models. Not part of `npm test` (it spends
 * tokens and takes minutes): run it by hand.
 *
 *   npx tsx apps/hub/test/live/agents-work.live.ts                  # every scenario, Codex on its small model
 *   npx tsx apps/hub/test/live/agents-work.live.ts watch promise    # only those
 *   LIVE_HARNESS=claude-code LIVE_MODEL=haiku npx tsx …             # another harness signed in on this computer
 *   LIVE_GITHUB_TOKEN=$(gh auth token) npx tsx … connector          # a real connector's watch, read-only
 *
 * It starts a hub in a throwaway folder (never ~/.wisp), a device on this computer that runs the
 * harness with its own sign-in here, and plays each scenario without a person answering: the script
 * only changes what the agent watches, lets time pass (by making things due), and presses Approve
 * once. For each scenario it prints whether it worked, how long it took, and the model calls and
 * tokens it used, and writes the same to LIVE_OUT (JSON) when that's set.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TeamFlow, TeamStep } from "@wisp/core";
import { deviceAdapters } from "@wisp/adapters";
import { NodeDaemon } from "../../../node/src/daemon.ts";
import { buildHub } from "../../src/app.ts";
import type { Hub } from "../../src/hub.ts";

const HARNESS = process.env.LIVE_HARNESS ?? "codex";
const MODEL = process.env.LIVE_MODEL ?? (HARNESS === "claude-code" ? "haiku" : HARNESS === "codex" ? "gpt-6-luna" : "");
// started from inside another Claude Code session, that session's own sign-in settings would reach the harness and break its sign-in
for (const k of Object.keys(process.env)) if (/^(CLAUDE|ANTHROPIC)/.test(k)) delete process.env[k];
// generous: on a busy computer a harness can take minutes just to start its tools
const RUN_TIMEOUT_MS = Number(process.env.LIVE_RUN_TIMEOUT_MS ?? 20 * 60_000);
const want = process.argv.slice(2).filter((a) => !a.startsWith("-"));

interface RunRow {
  id: string;
  agent: string;
  kind: string;
  status: string;
  error: string | null;
  seconds: number;
  model: string | null;
  /** how full the plan was after the run, as the harness reported it: "5-hour 12%, weekly 40%" */
  plan: string | null;
  input: number;
  cached: number;
  output: number;
}
interface Result {
  scenario: string;
  worked: boolean;
  notes: string[];
  seconds: number;
  calls: number;
  tokens: number;
  runs: RunRow[];
}

let hub: Hub;
let base: string;
let owner: string;
let me: string;
let ws: string;
let nodeId: string;
const agents: Record<string, { id: string; handle: string }> = {};

async function api<T = any>(method: string, url: string, body?: unknown, token = owner): Promise<{ status: number; data: T }> {
  const res = await fetch(base + url, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}
const must = async <T = any>(method: string, url: string, body?: unknown): Promise<T> => {
  const r = await api<T>(method, url, body);
  if (r.status >= 300) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(what: string, fn: () => Promise<T | undefined | null | false> | T | undefined | null | false, ms = RUN_TIMEOUT_MS): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const db = () => hub.store.db;
const busy = () => !!db().prepare("SELECT 1 FROM runs WHERE status IN ('queued','running')").get();
/** Every run has ended (and nothing new started for a moment: a reply can wake the next agent). */
async function idle(ms = RUN_TIMEOUT_MS) {
  await waitFor("runs to end", async () => {
    if (busy()) return false;
    await sleep(1500);
    return !busy();
  }, ms);
}

const mark = () => new Date().toISOString();
function runsSince(since: string): RunRow[] {
  const rows = db().prepare("SELECT r.id, a.handle AS agent, r.kind, r.status, r.error, r.created_at AS createdAt, r.finished_at AS finishedAt, r.usage_json AS usage FROM runs r JOIN agents a ON a.id = r.agent_id WHERE r.created_at >= ? AND r.status != 'queued' ORDER BY r.created_at").all(since) as { id: string; agent: string; kind: string | null; status: string; error: string | null; createdAt: string; finishedAt: string | null; usage: string | null }[];
  return rows.map((r) => {
    const u = r.usage ? JSON.parse(r.usage) : {};
    return { id: r.id, agent: r.agent, kind: r.kind ?? "chat", status: r.status, error: r.error, seconds: r.finishedAt ? Math.round((Date.parse(r.finishedAt) - Date.parse(r.createdAt)) / 1000) : -1, model: u.model ?? null, plan: u.plan ? (u.plan.windows ?? [u.plan]).map((w: { window: string; usedFraction: number }) => `${w.window} ${Math.round(w.usedFraction * 100)}%`).join(", ") : null, input: u.inputTokens ?? 0, cached: u.cachedInputTokens ?? 0, output: u.outputTokens ?? 0 };
  });
}
const dmOf = (handle: string) => hub.store.dmChannel(ws, me, agents[handle].id).id;
/** What the agent wrote to the person in their DM since `since` (not the background thread, not status lines). */
const saidSince = (handle: string, since: string) =>
  (db().prepare("SELECT body FROM messages WHERE channel_id = ? AND author_kind = 'agent' AND author_id = ? AND created_at >= ? AND deleted_at IS NULL AND body != '' ORDER BY created_at").all(dmOf(handle), agents[handle].id, since) as { body: string }[]).map((m) => m.body);

async function scenario(name: string, fn: (notes: string[]) => Promise<boolean>): Promise<Result> {
  const since = mark();
  const started = Date.now();
  const notes: string[] = [];
  let worked = false;
  console.log(`\n=== ${name} ===`);
  try {
    worked = await fn(notes);
  } catch (err) {
    notes.push(`error: ${(err as Error).message}`);
  }
  const runs = runsSince(since);
  const result = { scenario: name, worked, notes, seconds: Math.round((Date.now() - started) / 1000), calls: runs.length, tokens: runs.reduce((n, r) => n + r.input + r.output, 0), runs };
  for (const n of notes) console.log(`  - ${n}`);
  for (const r of runs) console.log(`  run ${r.agent} ${r.kind} ${r.status} ${r.seconds}s model=${r.model} in=${r.input} (cached ${r.cached}) out=${r.output}${r.plan ? ` plan: ${r.plan}` : ""}${r.error ? ` error=${r.error.slice(0, 200)}` : ""}`);
  console.log(`  → ${worked ? "WORKED" : "DID NOT WORK"} in ${result.seconds}s, ${result.calls} model calls, ${result.tokens} tokens`);
  return result;
}

// --- the page the agent watches (served to the hub's watcher only; the hub never opens the network for it) ---

const PAGE = "https://releases.lab.example/wisp-lab";
let releases = ["v2.3.1: fixes a crash when saving drafts", "v2.3.0: adds dark mode"];
let footer = "Docs last built Monday";
const page = () => `<!doctype html><html><body><main><h1>Lab app releases</h1><p>Every release of the Lab app, newest first, with what changed and what you need to do.</p><p>The Lab app is a small note-taking tool for teams. Releases come out every few weeks. Most are small fixes; a release that changes how you set the app up says so in capital letters at the start of its line.</p><ul>${releases.map((r) => `<li>${r}</li>`).join("")}</ul><p>${footer}</p></main></body></html>`;

/** Let the watch look now, and let what it found count as settled. */
async function watchLooks() {
  db().prepare("UPDATE watches SET next_poll_at = ?").run(new Date(Date.now() - 1000).toISOString());
  await hub.watches.tick();
  db().prepare("UPDATE app_events SET created_at = ? WHERE run_id IS NULL").run(new Date(Date.now() - 15 * 60_000).toISOString());
  await hub.watches.tick();
}

async function watchScenario(notes: string[]) {
  const a = agents.scout;
  // its own computer, like an agent made in first-run setup (a website watch asks for one)
  db().prepare("UPDATE agents SET computer_id = 'comp_lab' WHERE id = ?").run(a.id);
  hub.store.setBackground(a.id, me, { enabled: true, everyMinutes: 180, quietStart: "00:00", quietEnd: "00:00", focus: "Releases of the Lab app. Tell me when a release has a breaking change and what I need to do about it. Nothing else about releases matters to me.", nextAt: new Date(Date.now() + 6 * 3_600_000).toISOString() });
  const w = await hub.watches.create({ workspaceId: ws, userId: me, agentIds: [a.id], service: "browser", config: { url: PAGE, lookFor: "new releases with breaking changes" }, createdBy: me });
  if ("error" in w) throw new Error(w.error);
  notes.push(`watch started; Wisp reads the page itself: ${hub.watches.readsPage(w.id)}`);

  // 1. nothing changed: no model call
  let since = mark();
  await watchLooks();
  await idle();
  const quiet = runsSince(since).length;
  notes.push(`unchanged page → ${quiet} model calls`);

  // 2. a change that matters
  since = mark();
  releases = ["v2.4.0: BREAKING, the config file is renamed from lab.json to lab.toml; rename yours before upgrading", ...releases];
  await watchLooks();
  await waitFor("the agent to start", () => runsSince(since).length > 0, 30_000);
  await idle();
  const said = saidSince("scout", since);
  const told = said.some((s) => /2\.4/.test(s) || /lab\.toml/i.test(s));
  const mentions = hub.watches.mentions(a.id, me);
  notes.push(`breaking release → ${runsSince(since).length} model calls; messaged first: ${told}${said[0] ? ` ("${said[0].replace(/\s+/g, " ").slice(0, 160)}")` : ""}; raised keys: ${mentions.map((m) => m.about).join(", ") || "none"}`);

  // 3. a change that doesn't matter: it should stay silent
  since = mark();
  footer = "Docs last built Tuesday";
  releases = ["v2.3.2: fixes a typo in the settings page", ...releases];
  await watchLooks();
  await sleep(3000);
  await idle();
  const noise = runsSince(since);
  const noiseSaid = saidSince("scout", since);
  notes.push(`a typo-fix release and a new footer → ${noise.length} model calls (${noise.reduce((n, r) => n + r.input + r.output, 0)} tokens); stayed silent: ${!noiseSaid.length}${noiseSaid[0] ? ` (said "${noiseSaid[0].slice(0, 120)}")` : ""}`);

  // 4. the thing it raised changes wording: it must not raise it again
  since = mark();
  releases = releases.map((r) => (r.startsWith("v2.4.0") ? "v2.4.0: BREAKING, the config file is renamed from lab.json to lab.toml. Rename yours before upgrading (notes reworded)" : r));
  await watchLooks();
  await sleep(3000);
  await idle();
  const again = saidSince("scout", since);
  notes.push(`the same release reworded → ${runsSince(since).length} model calls; raised again: ${again.length > 0}${again[0] ? ` (said "${again[0].slice(0, 120)}")` : ""}`);
  return quiet === 0 && told && !noiseSaid.length && !again.length;
}

async function promiseScenario(notes: string[]) {
  const a = agents.scout;
  if (!hub.store.background(a.id, me)) hub.store.setBackground(a.id, me, { enabled: true, everyMinutes: 180, quietStart: "00:00", quietEnd: "00:00", nextAt: new Date(Date.now() + 6 * 3_600_000).toISOString() });
  let since = mark();
  await must("POST", `/api/channels/${dmOf("scout")}/messages`, { body: "I'm walking into a meeting. Tomorrow at 9am, remind me to call Sam about the Q3 budget, and give me a one-line agenda for the call then." });
  await waitFor("the reply run", () => runsSince(since).length > 0, 30_000);
  await idle();
  const set = hub.store.pendingFollowups(a.id).filter((f) => f.kind === "followup");
  notes.push(`promise made → follow-ups set: ${set.length}${set[0] ? ` ("${set[0].label ?? set[0].note}", due ${set[0].dueAt})` : ""}`);
  if (!set.length) return false;
  // tomorrow 9am comes
  since = mark();
  db().prepare("UPDATE followups SET due_at = ? WHERE status = 'pending' AND kind = 'followup' AND agent_id = ?").run(new Date(Date.now() - 1000).toISOString(), a.id);
  hub.background.tick();
  await waitFor("the follow-up check", () => runsSince(since).length > 0, 30_000);
  await idle();
  const said = saidSince("scout", since);
  const ok = said.some((s) => /sam/i.test(s));
  notes.push(`when it came due → ${runsSince(since).length} model calls; followed up on its own: ${ok}${said[0] ? ` ("${said[0].replace(/\s+/g, " ").slice(0, 160)}")` : ""}`);
  return ok;
}

async function teamScenario(notes: string[]) {
  const step = (id: string, handle: string, action: string, extra: Partial<TeamStep> = {}): Partial<TeamStep> => ({ id, roleId: "", kind: "do", action, agentId: agents[handle].id, next: null, nexts: [], inputs: [], x: 0, y: 0, ...extra });
  const steps: Partial<TeamStep>[] = [
    { id: "s", roleId: "", kind: "schedule", action: "", next: "a", nexts: ["a"], inputs: [], schedule: "0 9 * * 1", timezone: "UTC", prompt: "Write this week's note for the team: three plain facts about why short meetings work better, then a two-sentence summary a busy person can read.", x: 0, y: 0 },
    step("a", "scout", "List three plain facts for the note, one line each", { nexts: ["b"], next: "b" }),
    step("b", "quill", "Write the two-sentence summary from the facts", { inputs: ["a"] }),
  ];
  const ch = await must<{ id: string }>("POST", "/api/channels", { name: "weekly-note", settings: { team: { nodes: [], edges: [], roles: [], steps } } });
  const since = mark();
  // Monday 9:00 comes
  hub.schedules.tick(new Date("2026-11-23T09:00:10Z"));
  const flows = () => must<TeamFlow[]>("GET", `/api/channels/${ch.id}/flows`);
  await waitFor("the schedule to start the team", async () => (await flows()).length > 0, 15_000);
  const done = await waitFor("the team to finish", async () => (await flows()).find((f) => f.status !== "running"), 2 * RUN_TIMEOUT_MS).catch(() => null);
  await idle().catch(() => {});
  const flow = done ?? (await flows())[0];
  const ran = runsSince(since);
  notes.push(`schedule fired → flow ${flow?.status}; runs by ${[...new Set(ran.map((r) => r.agent))].join(" → ") || "nobody"}`);
  if (flow?.result) notes.push(`result: "${flow.result.replace(/\s+/g, " ").slice(0, 220)}"`);
  return flow?.status === "done" && ran.some((r) => r.agent === "scout") && ran.some((r) => r.agent === "quill");
}

async function approvalScenario(notes: string[]) {
  const a = agents.scout;
  if (!hub.store.background(a.id, me)) hub.store.setBackground(a.id, me, { enabled: true, everyMinutes: 180, quietStart: "00:00", quietEnd: "00:00", nextAt: new Date(Date.now() + 6 * 3_600_000).toISOString() });
  const vault = hub.vault(ws);
  const who = { name: "Lab", email: "lab@localhost" };
  // two notes in its own folder (it sees them as me/scratch/): one says it can go, one is in use
  const mine = `agents/${a.id}/scratch`;
  await vault.write(`${mine}/old-plan.md`, "# Old plan\nSuperseded by the Q3 plan. Safe to remove.\n", who, "lab");
  await vault.write(`${mine}/keep-me.md`, "# Ideas\nStill using this list every week.\n", who, "lab");
  // a follow-up it owes: tidy the scratch folder, which means deleting, which it has to ask about
  hub.store.createFollowup({ agentId: a.id, userId: me, dueAt: new Date(Date.now() - 1000).toISOString(), note: "Tidy your me/scratch/ folder in memory: delete the notes that say they are superseded or safe to remove, keep the rest. Ask before deleting anything.", kind: "followup", waitingOn: "agent", label: "Tidy scratch notes", channelId: dmOf("scout") });
  let since = mark();
  hub.background.tick();
  await waitFor("the check to start", () => runsSince(since).length > 0, 30_000);
  await idle();
  const pending = hub.store.approvals(ws, "pending").filter((x) => x.agentId === a.id);
  notes.push(`needs permission → approvals asked: ${pending.length}${pending[0] ? ` ("${pending[0].summary}")` : ""}; ${runsSince(since).length} model calls; deleted before asking: ${!(await vault.read(`${mine}/old-plan.md`).then(() => true, () => false))}`);
  if (pending.length !== 1) return false;
  since = mark();
  await must("POST", `/api/approvals/${pending[0].id}/decide`, { approve: true });
  await waitFor("it to continue", () => runsSince(since).length > 0, 60_000).catch(() => null);
  await idle();
  const gone = !(await vault.read(`${mine}/old-plan.md`).then(() => true, () => false));
  const kept = await vault.read(`${mine}/keep-me.md`).then(() => true, () => false);
  notes.push(`after one Approve → ${runsSince(since).length} model calls; deleted the superseded note: ${gone}; kept the other: ${kept}; asked again: ${hub.store.approvals(ws, "pending").filter((x) => x.agentId === a.id).length > 0}`);
  return gone && kept;
}

/**
 * A real connector with a key that already works here (LIVE_GITHUB_TOKEN, e.g. from `gh auth token`): the
 * watch is started and looks twice, which only reads. Nothing it finds is handed to a model: the watch
 * is removed before anything could be delivered.
 */
async function connectorScenario(notes: string[]) {
  const key = process.env.LIVE_GITHUB_TOKEN;
  if (!key) {
    notes.push("skipped: set LIVE_GITHUB_TOKEN to a GitHub token that works on this computer");
    return false;
  }
  const a = agents.scout;
  if (!hub.store.background(a.id, me)) hub.store.setBackground(a.id, me, { enabled: true, everyMinutes: 180, quietStart: "00:00", quietEnd: "00:00", nextAt: new Date(Date.now() + 6 * 3_600_000).toISOString() });
  const since = mark();
  const w = await hub.watches.create({ workspaceId: ws, userId: me, agentIds: [a.id], service: "github", secrets: { GITHUB_TOKEN: key }, createdBy: me });
  if ("error" in w) {
    notes.push(`GitHub refused the first look: ${w.error}`);
    return false;
  }
  notes.push(`GitHub watch started with a real key; first look worked (every ${w.everyMinutes} minutes from now on)`);
  // a second look, as the timer would do it
  db().prepare("UPDATE watches SET next_poll_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), w.id);
  const real = hub.watches.deliver.bind(hub.watches);
  hub.watches.deliver = () => {};
  await hub.watches.tick();
  const after = hub.watches.get(w.id)!;
  const found = (db().prepare("SELECT COUNT(*) AS n FROM app_events WHERE watch_id = ?").get(w.id) as { n: number }).n;
  hub.watches.remove(w.id);
  hub.watches.deliver = real;
  notes.push(`second look: ${after.lastError ? `failed (${after.lastError})` : "worked"}; changes found: ${found} (not handed to a model); model calls: ${runsSince(since).length}`);
  return !after.lastError && runsSince(since).length === 0;
}

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wisp-live-"));
  const built = await buildHub({ dataDir: path.join(dir, "hub"), setupCode: false });
  hub = built.hub;
  const real = hub.watches.fetch;
  hub.watches.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => (String(input) === PAGE ? new Response(page(), { headers: { "content-type": "text/html; charset=utf-8" } }) : real(input, init))) as typeof fetch;
  await built.app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
  owner = (await api("POST", "/api/setup", { email: "lab@example.com", name: "Alex", password: `lab-${Math.random().toString(36).slice(2)}-${Date.now()}`, features: "everything", workspaceName: "Lab" }, "")).data.token;
  me = (db().prepare("SELECT id FROM users").get() as { id: string }).id;
  // the person's clock is this computer's, as the app sets it when they sign in
  db().prepare("UPDATE users SET timezone = ? WHERE id = ?").run(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", me);
  const { node, token } = await must("POST", "/api/nodes", { name: "this-computer" });
  nodeId = node.id;
  const log: string[] = [];
  // LIVE_TRACE: what the harness did in each run (tool calls and what came back), for finding out why something didn't happen
  const adapters = deviceAdapters();
  if (process.env.LIVE_TRACE)
    for (const a of Object.values(adapters)) {
      const run = a.run.bind(a);
      a.run = (input, onEvent) =>
        run(input, (e) => {
          if (e.type === "tool_call") log.push(`  tool ${e.name} ${JSON.stringify(e.input ?? {}).slice(0, 300)}`);
          else if (e.type === "tool_result") log.push(`  result ${JSON.stringify(e).slice(0, 400)}`);
          else if (e.type === "text") log.push(`  text ${e.text.replace(/\s+/g, " ").slice(0, 300)}`);
          onEvent(e);
        });
    }
  const daemon = new NodeDaemon({ hub: base, token, name: "this-computer", dir: path.join(dir, "node") }, (m) => log.push(m), adapters);
  daemon.start();
  for (const [handle, name] of [["scout", "Scout"], ["quill", "Quill"]]) {
    agents[handle] = await must("POST", "/api/agents", { handle, name, harness: HARNESS, model: MODEL || null, nodeId, greet: "later" });
  }
  ws = hub.store.agent(agents.scout.id)!.workspaceId;
  await waitFor("the device to connect", async () => (await must<{ id: string; status: string }[]>("GET", "/api/agents")).every((x) => x.status !== "offline"), 30_000);
  console.log(`hub ${base} (data ${dir}), harness ${HARNESS}${MODEL ? ` on ${MODEL}` : ""}`);

  const all: Record<string, (notes: string[]) => Promise<boolean>> = { watch: watchScenario, promise: promiseScenario, team: teamScenario, approval: approvalScenario, connector: connectorScenario };
  const results: Result[] = [];
  // the connector scenario only runs when asked for by name (it needs a key)
  for (const [name, fn] of Object.entries(all)) if (want.length ? want.includes(name) : name !== "connector") results.push(await scenario(name, fn));

  console.log("\n| Scenario | Worked | Time | Model calls | Tokens (in + out) |\n|---|---|---|---|---|");
  for (const r of results) console.log(`| ${r.scenario} | ${r.worked ? "yes" : "no"} | ${r.seconds}s | ${r.calls} | ${r.tokens.toLocaleString("en-US")} |`);
  if (process.env.LIVE_OUT) await fs.writeFile(process.env.LIVE_OUT, JSON.stringify({ harness: HARNESS, model: MODEL, at: new Date().toISOString(), results }, null, 2));
  if (process.env.LIVE_LOG) await fs.writeFile(process.env.LIVE_LOG, log.join("\n"));
  daemon.stop();
  await built.app.close();
  if (!process.env.LIVE_KEEP) await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  process.exit(results.every((r) => r.worked) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
