import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AppleOp } from "@wisp/core";
import { createWispMcp } from "@wisp/mcp/src/server.ts";
import { WispClient } from "@wisp/sdk";
import { buildHub } from "../src/app.ts";
import { readLine, span } from "../src/apple.ts";
import type { Hub } from "../src/hub.ts";

/** The Apple mod against a pretend Mac: what it's asked, and what it answers. */
let dir: string;
let base: string;
let hub: Hub;
let close: () => Promise<void>;
let owner: string;
let ws: string;
let scout: any;
let scoutToken: string;
let macId: string;
const asked: AppleOp[] = [];
let unanswered: any[] = [];

const EVENT = { id: "ev1", calendar: "Work", title: "Team call", start: "2026-11-19T15:00:00.000Z", end: "2026-11-19T15:30:00.000Z", allDay: false };

function fakeMac(op: AppleOp): unknown {
  asked.push(op);
  switch (op.op) {
    case "status":
      return { fullDiskAccess: "allowed", messagesControl: "unknown", contacts: "allowed", calendars: "allowed", reminders: "denied" };
    case "contacts_search":
      return op.query.includes("555") ? [{ id: "c1", name: "Sam Rivera", phones: ["(555) 014-2290"], emails: [] }] : [];
    case "messages_read":
      return [{ at: "2026-11-14T10:00:00Z", fromMe: false, sender: "Sam Rivera", text: "see you at 7" }];
    case "messages_send":
      return `Sent to ${op.to}.`;
    case "calendar_get":
      return op.id === EVENT.id ? EVENT : null;
    case "calendar_list":
      return [];
    case "reminders_list":
      return [];
    case "messages_unanswered":
      return unanswered;
    case "calendar_move":
      return "Moved Team call.";
    default:
      return null;
  }
}

async function api<T = any>(method: string, url: string, body?: unknown, token = owner): Promise<{ status: number; data: T }> {
  const res = await fetch(base + url, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, data };
}

const tools = async (token: string) => {
  const server = await createWispMcp(new WispClient({ url: base, token }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const mcp = new Client({ name: "test", version: "0" });
  await mcp.connect(b);
  return mcp;
};

beforeAll(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wisp-apple-"));
  const built = await buildHub({ dataDir: dir, setupCode: false });
  hub = built.hub;
  await built.app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
  close = () => built.app.close();
  owner = (await api("POST", "/api/setup", { email: "me@example.com", name: "Me", password: "password123", features: "everything", workspaceName: "Lab" }, "")).data.token;
  const me = (await api("GET", "/api/me")).data;
  ws = me.workspace?.id ?? me.workspaceId;
  scout = (await api("POST", "/api/agents", { handle: "scout", name: "Scout", harness: "custom" })).data;
  scoutToken = (await api("POST", `/api/agents/${scout.id}/token`)).data.token;
  // a Mac that joined, always online, answering like the bridge
  const node = hub.store.createNode(ws, "MacBook Pro", me.user.id);
  macId = node.id;
  hub.store.setNodeCapabilities(macId, { platform: "darwin", arch: "arm64", screen: { ok: false, detail: "" }, vm: { ok: false, detail: "" }, apple: fakeMac({ op: "status" }) as any });
  asked.length = 0;
  const online = hub.isNodeOnline.bind(hub);
  hub.isNodeOnline = (id) => id === macId || online(id);
  hub.computers.nodeRequest = async (_nodeId, build) => fakeMac((build("req") as { op: AppleOp }).op);
});

afterAll(async () => {
  await close();
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("while the mod is off", () => {
  it("answers nothing and gives agents no tools", async () => {
    expect((await api("GET", "/api/me")).data.features.apple).toBe(false);
    expect((await api("GET", "/api/apple")).status).toBe(404);
    const mcp = await tools(scoutToken);
    expect((await mcp.listTools()).tools.some((t) => t.name.startsWith("apple_"))).toBe(false);
  });
});

describe("settings", () => {
  it("turns on read-only by default, finds the Mac and merges partial changes", async () => {
    expect((await api("PUT", "/api/features", { apple: true })).status).toBe(200);
    const v = (await api("GET", "/api/apple")).data;
    expect(v.settings.levels).toEqual({ messages: 1, contacts: 1, calendar: 1, reminders: 1, location: 1 });
    expect(v.macs).toEqual([expect.objectContaining({ nodeId: macId, name: "MacBook Pro", online: true, status: expect.objectContaining({ reminders: "denied" }) })]);
    const next = (await api("PUT", "/api/apple/settings", { levels: { messages: 2 } })).data;
    expect(next.settings.levels).toMatchObject({ messages: 2, calendar: 1 });
    expect((await api("PUT", "/api/apple/settings", { macNodeId: "node_nope" })).status).toBe(400);
  });
});

describe("agents", () => {
  it("get tools only for the apps and levels they have", async () => {
    const names = (await (await tools(scoutToken)).listTools()).tools.map((t) => t.name).filter((n) => n.startsWith("apple_"));
    expect(names).toContain("apple_messages_send");
    expect(names).toContain("apple_calendar_list");
    expect(names).not.toContain("apple_calendar_move");
    expect(names).toContain("apple_location");
  });

  it("read without asking, and can't change what's read-only", async () => {
    const r = await api("POST", "/api/apple/agent", { op: "messages_read", chat: "Sam", limit: 5 }, scoutToken);
    expect(r.data).toMatchObject({ status: "done", result: [expect.objectContaining({ text: "see you at 7" })] });
    const no = await api("POST", "/api/apple/agent", { op: "calendar_move", id: "ev1", start: EVENT.start, end: EVENT.end }, scoutToken);
    expect(no.status).toBe(403);
    expect(no.data.error).toMatch(/read-only/);
    expect((await api("POST", "/api/apple/agent", { op: "status" }, scoutToken)).status).toBe(403);
  });

  it("ask before sending a text, with the name from Contacts, and send what the person edited", async () => {
    // the agent asks from a conversation with the person
    const me = (await api("GET", "/api/me")).data;
    const dm = hub.store.dmChannel(ws, me.user.id, scout.id);
    hub.whereIs = () => ({ channelId: dm.id, threadId: null });
    asked.length = 0;
    const r = await api("POST", "/api/apple/agent", { op: "messages_send", to: "+1 555 014 2290", text: "Running 10 late" }, scoutToken);
    expect(r.data.status).toBe("asked");
    expect(asked.some((o) => o.op === "messages_send")).toBe(false);
    const a = (await api("GET", `/api/approvals/${r.data.approvalId}`)).data;
    expect(a.apple).toMatchObject({ title: "Send a text", aside: "iMessage", bubble: "Running 10 late", yes: "Send", no: "Don't send", fields: [{ label: "To", value: "Sam Rivera · +1 555 014 2290" }] });
    const d = await api("POST", `/api/approvals/${a.id}/decide`, { approve: true, text: "Running 15 late, sorry" });
    expect(d.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(asked.find((o) => o.op === "messages_send")).toEqual({ op: "messages_send", to: "+1 555 014 2290", text: "Running 15 late, sorry" });
    expect((await api("GET", `/api/approvals/${a.id}`)).data.apple.bubble).toBe("Running 15 late, sorry");
  });

  it("shows the real event when moving one, struck through where it was", async () => {
    await api("PUT", "/api/apple/settings", { levels: { calendar: 2 } });
    const r = await api("POST", "/api/apple/agent", { op: "calendar_move", id: "ev1", start: "2026-11-19T15:30:00.000Z", end: "2026-11-19T16:00:00.000Z" }, scoutToken);
    expect(r.data.status).toBe("asked");
    const a = (await api("GET", `/api/approvals/${r.data.approvalId}`)).data;
    expect(a.apple).toMatchObject({ title: "Move an event", aside: "Work", yes: "Move it" });
    expect(a.apple.fields.map((f: any) => [f.label, !!f.was])).toEqual([["Event", false], ["From", true], ["To", false]]);
    expect(a.apple.fields[0].value).toBe("Team call");
    expect((await api("POST", `/api/approvals/${a.id}/decide`, { approve: true, text: "nope" })).status).toBe(400);
    const gone = await api("POST", "/api/apple/agent", { op: "calendar_delete", id: "missing" }, scoutToken);
    expect(gone.status).toBe(404);
  });
});

describe("speaking up", () => {
  it("keeps one Apple watch, learns what's there on the first look, then raises only new things", async () => {
    const row = () => hub.store.db.prepare("SELECT * FROM watches WHERE workspace_id = ? AND service = 'apple'").get(ws) as any;
    expect(row()).toBeTruthy();
    unanswered = [{ chatId: "c1", name: "Mom", handles: ["+15550000000"], isGroup: false, lastText: "coming Sunday?", lastAt: "2026-11-13T22:00:00Z", lastFromMe: false }];
    const first = await hub.apple.look(ws, null, new Date("2026-11-14T08:00:00Z"));
    expect(first.events).toEqual([]);
    const same = await hub.apple.look(ws, first.cursor, new Date("2026-11-14T08:30:00Z"));
    expect(same.events).toEqual([]);
    unanswered = [...unanswered, { chatId: "c2", name: "Sam", handles: ["+15550142290"], isGroup: false, lastText: "you around?", lastAt: "2026-11-14T06:00:00Z", lastFromMe: false }];
    const next = await hub.apple.look(ws, same.cursor, new Date("2026-11-14T09:00:00Z"));
    expect(next.events.map((e) => e.title)).toEqual(["Sam texted you and hasn't had an answer"]);
    // turning everything off removes it
    await api("PUT", "/api/apple/settings", { speakUp: { unanswered: false, calendar: false, reminders: false, places: false } });
    expect(row()).toBeFalsy();
  });
});

describe("location", () => {
  it("answers from a fresh fix, with the place it's in", async () => {
    await api("PUT", "/api/apple/settings", { places: [{ id: "home", name: "Home", latitude: 38.7, longitude: -76.9, radius: 200, arrive: true, leave: true }] });
    const at = new Date().toISOString();
    expect((await api("POST", "/api/apple/location", { latitude: 38.7005, longitude: -76.9, accuracy: 20, at, deviceId: "iph1", deviceName: "iPhone" })).data).toEqual({ ok: true });
    const r = await api("POST", "/api/apple/agent/location", {}, scoutToken);
    expect(r.data).toMatchObject({ near: "Home", accuracyMeters: 20, ageMinutes: 0 });
    expect((await api("GET", "/api/apple")).data.iphones).toEqual([expect.objectContaining({ id: "iph1", name: "iPhone" })]);
  });
});

describe("wording", () => {
  it("formats times and read lines plainly", () => {
    expect(span("2026-11-19T15:00:00.000Z", "2026-11-19T15:30:00.000Z", "America/New_York")).toBe("Thu, Nov 19, 10:00–10:30 AM");
    expect(span("2026-11-19T16:30:00.000Z", "2026-11-19T18:00:00.000Z", "America/New_York")).toBe("Thu, Nov 19, 11:30 AM–1:00 PM");
    expect(readLine({ op: "messages_read", chat: "Sam", limit: 5 }, [{ fromMe: false, sender: "Sam Rivera" }, {}, {}, {}, {}])).toBe("Read your last 5 texts with Sam Rivera");
    expect(readLine({ op: "contacts_search", query: "sam", limit: 3 }, [{ name: "Sam Rivera" }])).toBe("Found Sam Rivera in Contacts");
  });
});
