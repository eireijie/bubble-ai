import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildHub } from "../src/app.ts";

vi.setConfig({ testTimeout: 30_000 });

let dir: string;
let url: string;
let close: () => Promise<void>;
let token: string;
let other: string;
let agentId: string;

const call = async (method: string, p: string, body?: unknown, as = token) => {
  const res = await fetch(url + p, { method, headers: { authorization: `Bearer ${as}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json() };
};
const upload = async (mime: string, as = token, channelId?: string) => {
  const res = await fetch(url + "/api/files", { method: "POST", headers: { authorization: `Bearer ${as}`, "content-type": "application/octet-stream", "x-filename": "x", "x-mime-type": mime, ...(channelId ? { "x-channel-id": channelId } : {}) }, body: Buffer.from(mime + Math.random()) });
  return (await res.json()).id as string;
};

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "bubble-chatbg-"));
  const built = await buildHub({ dataDir: path.join(dir, "hub"), setupCode: false });
  await built.app.listen({ port: 0, host: "127.0.0.1" });
  url = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
  close = () => built.app.close();
  const setup = await (await fetch(url + "/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "me@example.com", name: "Me", password: "password123", features: "everything" }) })).json();
  token = setup.token;
  agentId = (await call("POST", "/api/agents", { handle: "bg", name: "Bg", harness: "custom" })).json.id;
  // someone in another organization of the same hub
  const second = (await (await fetch(url + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "me@example.com", password: "password123" }) })).json()).token;
  const org = await call("POST", "/api/orgs", { name: "Elsewhere" }, second);
  other = org.json?.token ?? "";
});

afterAll(async () => {
  await close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("chat backgrounds on the hub", () => {
  it("keeps an agent's own background and clears it with null", async () => {
    let r = await call("PATCH", `/api/agents/${agentId}`, { settings: { background: { kind: "color", color: "#dfe4f3" } } });
    expect(r.status).toBe(200);
    expect(r.json.settings.background).toEqual({ kind: "color", color: "#dfe4f3" });
    const photo = await upload("image/png");
    r = await call("PATCH", `/api/agents/${agentId}`, { settings: { background: { kind: "photo", url: `/api/files/${photo}` } } });
    expect(r.json.settings.background).toEqual({ kind: "photo", url: `/api/files/${photo}` });
    r = await call("PATCH", `/api/agents/${agentId}`, { settings: { background: null } });
    expect(r.status).toBe(200);
    expect(r.json.settings.background).toBeUndefined();
  });

  it("leaves background photos out of the organization's file list", async () => {
    const wall = await upload("image/jpeg");
    const shared = await upload("image/jpeg");
    await call("PUT", "/api/me/prefs", { background: { kind: "photo", url: `/api/files/${wall}` } });
    const ids = (await call("GET", "/api/files")).json.map((f: { id: string }) => f.id);
    expect(ids).toContain(shared);
    expect(ids).not.toContain(wall);
    await call("PUT", "/api/me/prefs", { background: { kind: "none" } });
  });

  it("keeps the person's default in their prefs", async () => {
    const r = await call("PUT", "/api/me/prefs", { background: { kind: "color", color: "#e2f0e6" } });
    expect(r.status).toBe(200);
    expect(r.json.background).toEqual({ kind: "color", color: "#e2f0e6" });
    expect((await call("GET", "/api/me")).json.prefs.background).toEqual({ kind: "color", color: "#e2f0e6" });
  });

  it("refuses colours that aren't #rrggbb, outside photos, unknown files and non-images", async () => {
    const bad = [
      { kind: "color", color: "red;}" },
      { kind: "photo", url: "https://elsewhere.example/x.png" },
      { kind: "photo", url: "/api/files/../../etc" },
      { kind: "photo", url: "/api/files/nope" },
      { kind: "photo", url: `/api/files/${await upload("image/svg+xml")}` },
      { kind: "photo", url: `/api/files/${await upload("text/html")}` },
      { kind: "photo", url: "/api/files/x", extra: 1 },
    ];
    for (const background of bad) {
      expect((await call("PATCH", `/api/agents/${agentId}`, { settings: { background } })).status, JSON.stringify(background)).toBe(400);
      expect((await call("PUT", "/api/me/prefs", { background })).status, JSON.stringify(background)).toBe(400);
    }
  });

  it("refuses a photo from a chat or from another organization", async () => {
    const general = (await call("POST", `/api/dm/${agentId}`, {})).json;
    expect(general.id, JSON.stringify(general)).toBeTruthy();
    {
      const inChat = await upload("image/png", token, general.id);
      expect((await call("PUT", "/api/me/prefs", { background: { kind: "photo", url: `/api/files/${inChat}` } })).status).toBe(400);
    }
    expect(other).toBeTruthy();
    {
      const theirs = await upload("image/png", other);
      expect((await call("PATCH", `/api/agents/${agentId}`, { settings: { background: { kind: "photo", url: `/api/files/${theirs}` } } })).status).toBe(400);
    }
  });
});
