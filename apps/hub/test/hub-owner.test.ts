import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildHub } from "../src/app.ts";
import type { Hub } from "../src/hub.ts";

/**
 * Hub-wide controls belong to the hub's owner (an owner of its first organization), not to
 * whoever owns the workspace they're in now: anyone can be made owner of an organization.
 */
let dir: string;
let base: string;
let hub: Hub;
let close: () => Promise<void>;
/** the hub owner's sign-in, in the first organization */
let owner: string;
let member: string;
let guest: string;
/** owner of a second organization the hub owner made */
let boss: string;
/** the hub owner's sign-in, moved into the second organization */
let acmeToken: string;
let sharedId: string;
let acmeOnlyId: string;
let ownerId: string;
let acmeId: string;

async function api<T = any>(method: string, url: string, body?: unknown, token = owner): Promise<{ status: number; data: T }> {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}

const login = async (email: string) => (await api<{ token: string }>("POST", "/api/auth/login", { email, password: "password123" }, "")).data.token;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "wisp-hub-owner-"));
  const built = await buildHub({ dataDir: dir, setupCode: false });
  hub = built.hub;
  await built.app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
  close = () => built.app.close();

  const setup = (await api("POST", "/api/setup", { email: "me@example.com", name: "Alex", password: "password123", workspaceName: "Home" }, "")).data;
  owner = setup.token;
  ownerId = setup.user.id;
  await api("POST", "/api/members", { email: "member@example.com", name: "Mo", password: "password123", role: "member" });
  await api("POST", "/api/members", { email: "guest@example.com", name: "Gus", password: "password123", role: "guest" });
  sharedId = (await api("POST", "/api/members", { email: "shared@example.com", name: "Sha", password: "password123", role: "member" })).data.id;
  member = await login("member@example.com");
  guest = await login("guest@example.com");

  // the hub owner makes a second organization and puts someone else in charge of it
  const acme = await api("POST", "/api/orgs", { name: "Acme" });
  expect(acme.status).toBe(200);
  acmeToken = acme.data.token;
  acmeId = acme.data.org.id;
  // making it moved that sign-in there; a fresh one goes back to Home
  owner = (await api("POST", `/api/orgs/${setup.workspace.id}/switch`, undefined, await login("me@example.com"))).data.token;
  expect((await api("POST", "/api/members", { email: "boss@example.com", name: "Bo", password: "password123", role: "owner" }, acmeToken)).status).toBe(200);
  acmeOnlyId = (await api("POST", "/api/members", { email: "acme@example.com", name: "Ace", password: "password123", role: "member" }, acmeToken)).data.id;
  hub.store.addMember(acme.data.org.id, sharedId, "member");
  boss = await login("boss@example.com");
  expect((await api("GET", "/api/me", undefined, boss)).data.workspace.id).toBe(acme.data.org.id);
});

afterAll(async () => {
  await close();
  await fs.rm(dir, { recursive: true, force: true });
});

const hubWide: [string, string, unknown][] = [
  ["POST", "/api/orgs", { name: "Mine" }],
  ["POST", "/api/reach/cloudflare", { action: "start", token: "x".repeat(40) }],
  ["POST", "/api/reach/tailscale", { action: "funnel" }],
  ["POST", "/api/updates/hub", undefined],
  ["POST", "/api/memory/storage/restart", undefined],
  ["POST", "/api/onboarding/discover/git", undefined],
  ["POST", "/api/storage/webdav", { service: "webdav", url: "http://127.0.0.1:1/", username: "u", password: "p" }],
  ["POST", "/api/storage/nextcloud/start", { url: "http://127.0.0.1:1/" }],
];

describe("hub-wide controls", () => {
  for (const who of ["guest", "member", "owner of another organization"] as const) {
    it(`refuse a ${who}`, async () => {
      const token = who === "guest" ? guest : who === "member" ? member : boss;
      for (const [method, url, body] of hubWide) {
        const r = await api(method, url, body, token);
        expect(r.status, `${method} ${url}`).toBe(403);
      }
      expect((await api<any[]>("GET", "/api/orgs", undefined, token)).data.map((o) => o.name)).not.toContain("Mine");
    });
  }

  it("hide looking around the hub's computer from an owner of another organization", async () => {
    expect((await api("GET", "/api/onboarding/discover", undefined, boss)).data.available).toBe(false);
  });

  it("still let the hub owner in, wherever they are", async () => {
    // past the permission check: these fail on their bodies or on the test machine, never 403
    expect((await api("POST", "/api/reach/cloudflare", { action: "start", token: "short" })).status).toBe(400);
    expect((await api("POST", "/api/reach/tailscale", { action: "nope" })).status).toBe(400);
    expect((await api("POST", "/api/memory/storage/restart")).status).toBe(400);
    expect((await api("POST", "/api/onboarding/discover/nope")).status).not.toBe(403);
    // the Storage mod is off here, which is checked after the permission
    expect((await api("POST", "/api/storage/webdav", {})).status).toBe(404);
    // from inside the second organization too
    expect((await api("POST", "/api/reach/cloudflare", { action: "start", token: "short" }, acmeToken)).status).toBe(400);
    // (making one moves that sign-in into it)
    const again = (await api("POST", `/api/orgs/${acmeId}/switch`, undefined, await login("me@example.com"))).data.token;
    expect((await api("POST", "/api/orgs", { name: "Side" }, again)).status).toBe(200);
  });
});

describe("resetting a password", () => {
  it("refuses someone outside the caller's organization", async () => {
    expect((await api("POST", `/api/members/${acmeOnlyId}/password`, { password: "password456" })).status).toBe(403);
  });

  it("refuses an organization owner when the person is also in another organization", async () => {
    expect((await api("POST", `/api/members/${sharedId}/password`, { password: "password456" }, boss)).status).toBe(403);
    expect((await api("POST", `/api/members/${ownerId}/password`, { password: "password456" }, boss)).status).toBe(403);
    expect((await api("POST", "/api/auth/login", { email: "me@example.com", password: "password123" }, "")).status).toBe(200);
  });

  it("lets an organization owner reset someone only in theirs, and the hub owner anyone in the one they're in", async () => {
    expect((await api("POST", `/api/members/${acmeOnlyId}/password`, { password: "password456" }, boss)).status).toBe(200);
    expect((await api("POST", `/api/members/${sharedId}/password`, { password: "password456" }, acmeToken)).status).toBe(200);
  });
});
