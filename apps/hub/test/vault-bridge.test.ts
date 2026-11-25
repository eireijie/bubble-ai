import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Bridge, BridgeError, createServer, type BwItem, type BwLike } from "../../../docker/vault-bridge/bridge.mjs";

const PASSWORD = "Fake-agents-pass-7Q";
const SECRET = "zendesk-fake-secret-91";

/** The Bitwarden CLI, faked: one agents account with an Agents folder, a team collection and some other logins. */
export class FakeBw implements BwLike {
  unlocked = false;
  logins = 0;
  items_: BwItem[] = [
    { id: "11111111-1111-4111-8111-111111111111", name: "Zendesk", type: 1, folderId: "f-agents", login: { username: "support@shop.test", password: SECRET, totp: "JBSWY3DPEHPK3PXP", uris: [{ uri: "https://www.zendesk.com/login" }] } },
    { id: "22222222-2222-4222-8222-222222222222", name: "GitHub", type: 1, collectionIds: ["c-agents"], login: { username: "bot", password: "gh-fake-secret", uris: [{ uri: "github.com" }] } },
    { id: "33333333-3333-4333-8333-333333333333", name: "Bank", type: 1, folderId: "f-personal", login: { username: "me", password: "bank-fake-secret", uris: [{ uri: "https://bank.test" }] } },
    { id: "note", name: "Note", type: 2, folderId: "f-agents" },
  ];
  async unlock(c: { email?: string; password: string }) {
    this.logins++;
    if (c.password !== PASSWORD) throw new BridgeError("Invalid master password.", 502);
    this.unlocked = true;
    return "session-key";
  }
  async logout() {
    this.unlocked = false;
  }
  async sync() {}
  async items() {
    return structuredClone(this.items_);
  }
  async folders() {
    return [
      { id: "f-agents", name: "Agents" },
      { id: "f-personal", name: "Personal" },
    ];
  }
  async collections() {
    return [{ id: "c-agents", name: "agents" }];
  }
  async item(_s: string, id: string) {
    const i = this.items_.find((x) => x.id === id);
    if (!i) throw new BridgeError("Not found.", 502);
    return structuredClone(i);
  }
  async totp() {
    return "123456";
  }
}

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vault-bridge-"));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("vault bridge", () => {
  let bw: FakeBw;
  let dir: string;
  let bridge: Bridge;
  let clock: number;
  beforeEach(() => {
    bw = new FakeBw();
    dir = tmp();
    clock = Date.now();
    bridge = new Bridge({ bw, dataDir: dir, now: () => clock });
  });
  const connected = async (extra: Record<string, unknown> = {}) => bridge.connect({ code: bridge.connectCode().code, email: "agents@wisp.test", password: PASSWORD, ...extra });

  it("connects only with a fresh code from the hub, a few tries each", async () => {
    await expect(bridge.connect({ code: "made-up", email: "agents@wisp.test", password: PASSWORD })).rejects.toThrow(/expired/);
    const { code } = bridge.connectCode();
    await expect(bridge.connect({ code, email: "agents@wisp.test", password: "wrong" })).rejects.toThrow(/didn't accept/);
    await expect(bridge.connect({ code, email: "agents@wisp.test", password: "wrong" })).rejects.toThrow(/didn't accept/);
    // the third try uses the code up, right or wrong
    await expect(bridge.connect({ code, email: "agents@wisp.test", password: "wrong" })).rejects.toThrow(/didn't accept/);
    await expect(bridge.connect({ code, email: "agents@wisp.test", password: PASSWORD })).rejects.toThrow(/expired/);
    const late = bridge.connectCode().code;
    clock += 11 * 60_000;
    await expect(bridge.connect({ code: late, email: "agents@wisp.test", password: PASSWORD })).rejects.toThrow(/expired/);
    expect(bridge.status().state).toBe("not_connected");
    expect(await connected()).toEqual({ account: "agents@wisp.test", count: 2, agentsFound: true });
    expect(bridge.status()).toMatchObject({ state: "ready", account: "agents@wisp.test", lockOnRestart: false });
  });

  it("lists only logins in Agents, without secrets", async () => {
    await connected();
    const list = await bridge.list();
    expect(list).toEqual([
      { id: "11111111-1111-4111-8111-111111111111", title: "Zendesk", site: "zendesk.com", username: "support@shop.test", hasOtp: true },
      { id: "22222222-2222-4222-8222-222222222222", title: "GitHub", site: "github.com", username: "bot", hasOtp: false },
    ]);
    expect(JSON.stringify(list)).not.toMatch(/secret|JBSWY/);
  });

  it("hands out single-use tickets for one site and computer, checked again on redeem", async () => {
    await connected();
    await expect(bridge.ticket({ itemId: "33333333-3333-4333-8333-333333333333", site: "bank.test", computerId: "c1" })).rejects.toThrow(/isn't in the Agents/);
    // ids go to `bw get item`: only a GUID gets that far
    await expect(bridge.ticket({ itemId: "--help", site: "zendesk.com", computerId: "c1" })).rejects.toThrow(/are needed/);
    await expect(bridge.ticket({ itemId: "11111111-1111-4111-8111-111111111111", site: "zendesk-login.evil.test", computerId: "c1" })).rejects.toThrow(/isn't saved for/);
    const { ticket } = await bridge.ticket({ itemId: "11111111-1111-4111-8111-111111111111", site: "zendesk.com", computerId: "c1" });
    await expect(bridge.redeem({ ticket, site: "evil.test", computerId: "c1" })).rejects.toThrow(/for zendesk.com/);
    // a refused redeem used it up
    await expect(bridge.redeem({ ticket, site: "zendesk.com", computerId: "c1" })).rejects.toThrow(/already used/);

    const t2 = (await bridge.ticket({ itemId: "11111111-1111-4111-8111-111111111111", site: "www.zendesk.com", computerId: "c1" })).ticket;
    await expect(bridge.redeem({ ticket: t2, site: "zendesk.com", computerId: "c2" })).rejects.toThrow(/another computer/);
    const t3 = (await bridge.ticket({ itemId: "11111111-1111-4111-8111-111111111111", site: "zendesk.com", computerId: "c1" })).ticket;
    expect(await bridge.redeem({ ticket: t3, site: "zendesk.com", computerId: "c1" })).toEqual({ username: "support@shop.test", password: SECRET, otp: "123456" });
    await expect(bridge.redeem({ ticket: t3, site: "zendesk.com", computerId: "c1" })).rejects.toThrow(/already used/);

    const t4 = (await bridge.ticket({ itemId: "11111111-1111-4111-8111-111111111111", site: "zendesk.com", computerId: "c1" })).ticket;
    clock += 61_000;
    await expect(bridge.redeem({ ticket: t4, site: "zendesk.com", computerId: "c1" })).rejects.toThrow(/expired/);

    // the person moved it out of Agents after the ticket was made
    const t5 = (await bridge.ticket({ itemId: "22222222-2222-4222-8222-222222222222", site: "github.com", computerId: "c1" })).ticket;
    bw.items_[1].collectionIds = [];
    await expect(bridge.redeem({ ticket: t5, site: "github.com", computerId: "c1" })).rejects.toThrow(/isn't in the Agents/);
  });

  it("unlocks again after a restart, unless the person chose to lock it then", async () => {
    await connected();
    expect(fs.statSync(path.join(dir, "unlock.json")).mode & 0o777).toBe(0o600);
    const again = new Bridge({ bw: new FakeBw(), dataDir: dir });
    await again.start();
    expect(again.status().state).toBe("ready");

    const d2 = tmp();
    const locking = new Bridge({ bw, dataDir: d2 });
    await locking.connect({ code: locking.connectCode().code, email: "agents@wisp.test", password: PASSWORD, lockOnRestart: true });
    expect(fs.existsSync(path.join(d2, "unlock.json"))).toBe(false);
    expect(fs.readFileSync(path.join(d2, "settings.json"), "utf8")).not.toContain(PASSWORD);
    const restarted = new Bridge({ bw: new FakeBw(), dataDir: d2 });
    await restarted.start();
    expect(restarted.status().state).toBe("locked");
    await expect(restarted.list()).rejects.toThrow(/locked/);
  });

  it("forgets the account on request", async () => {
    await connected();
    await bridge.forget();
    expect(bridge.status().state).toBe("not_connected");
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(bw.unlocked).toBe(false);
  });
});

describe("vault bridge over HTTP", () => {
  const hubToken = "h".repeat(40);
  const redeemToken = "r".repeat(40);
  it("needs the right token for each door, has no way to change logins, and logs no secrets", async () => {
    expect(() => createServer(new Bridge({ bw: new FakeBw(), dataDir: tmp() }), { hubToken, redeemToken: hubToken })).toThrow(/different/);
    const lines: string[] = [];
    const bridge = new Bridge({ bw: new FakeBw(), dataDir: tmp() });
    const server = createServer(bridge, { hubToken, redeemToken, log: (l) => lines.push(l) });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (method: string, p: string, token?: string, body?: unknown) => {
      const r = await fetch(base + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    try {
      const page = await fetch(base + "/vault-bridge/connect");
      expect(page.headers.get("content-security-policy")).toMatch(/frame-ancestors 'none'/);
      expect(await page.text()).toContain("Connect the agents' vault account");

      expect((await call("GET", "/v1/status")).status).toBe(401);
      expect((await call("GET", "/v1/status", redeemToken)).status).toBe(401);
      expect((await call("GET", "/v1/status", hubToken)).body).toMatchObject({ state: "not_connected" });
      const { code } = (await call("POST", "/v1/connect-codes", hubToken)).body;
      expect((await call("POST", "/vault-bridge/connect", undefined, { code, email: "agents@wisp.test", password: PASSWORD })).body).toMatchObject({ count: 2 });

      const { ticket } = (await call("POST", "/v1/tickets", hubToken, { itemId: "11111111-1111-4111-8111-111111111111", site: "zendesk.com", computerId: "c1" })).body;
      // the hub's token can't redeem what it was given
      expect((await call("POST", "/v1/redeem", hubToken, { ticket, site: "zendesk.com", computerId: "c1" })).status).toBe(401);
      expect((await call("GET", "/v1/items", redeemToken)).status).toBe(401);
      expect((await call("POST", "/v1/redeem", redeemToken, { ticket, site: "zendesk.com", computerId: "c1" })).body).toMatchObject({ password: SECRET });
      for (const [m, p] of [["PUT", "/v1/items/x"], ["DELETE", "/v1/items/x"], ["POST", "/v1/items"], ["POST", "/v1/unlock"], ["GET", "/v1/items/x"]])
        expect((await call(m, p, hubToken, m === "GET" ? undefined : {})).status).toBe(404);
      expect((await call("POST", "/vault-bridge/connect", undefined, { code: "x", email: "a@b.c", password: "leaky-pass" })).status).toBe(403);
      expect(lines.join("\n")).not.toMatch(new RegExp(`${SECRET}|${PASSWORD}|leaky-pass|${ticket}`));
    } finally {
      server.close();
    }
  });
});
