import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { NodeToHub } from "@wisp/core";
import { importCodexSignin, SharedSignins } from "../src/shared-signin.ts";

const dirs: string[] = [];
const shared: SharedSignins[] = [];
afterEach(() => {
  for (const s of shared.splice(0)) s.stop();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function setup(here: object | null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wisp-shared-"));
  dirs.push(dir);
  const file = path.join(dir, "auth.json");
  if (here) fs.writeFileSync(file, JSON.stringify(here));
  const sent: NodeToHub[] = [];
  const s = new SharedSignins((m) => sent.push(m), () => {}, file, 60_000);
  shared.push(s);
  return { file, sent, s, read: () => JSON.parse(fs.readFileSync(file, "utf8")) };
}
const auth = (refresh: string, at: string, account = "acct") => ({ auth_mode: "chatgpt", tokens: { access_token: "a", refresh_token: refresh, account_id: account }, last_refresh: at });

describe("Use this sign-in", () => {
  it("reads this computer's ChatGPT sign-in, and refuses an API key", () => {
    const { file } = setup(auth("r1", "2026-11-01T00:00:00Z"));
    expect(importCodexSignin(file).secret.auth).toMatchObject({ tokens: { refresh_token: "r1" } });
    const key = setup({ OPENAI_API_KEY: "sk-x", tokens: null });
    expect(() => importCodexSignin(key.file)).toThrow(/API key/);
  });

  it("sends the hub a sign-in Codex renewed here", () => {
    const { s, sent } = setup(auth("r2", "2026-11-10T00:00:00Z"));
    s.update([{ connectionId: "mc1", secret: { auth: auth("r1", "2026-11-01T00:00:00Z") } }]);
    expect(sent).toEqual([{ type: "shared_signin_renewed", connectionId: "mc1", secret: { auth: auth("r2", "2026-11-10T00:00:00Z") } }]);
    s.sync();
    expect(sent).toHaveLength(1);
  });

  it("writes back a sign-in an agent renewed, so Codex here keeps working", () => {
    const { s, sent, read } = setup(auth("r1", "2026-11-01T00:00:00Z"));
    s.update([{ connectionId: "mc1", secret: { auth: auth("r3", "2026-11-12T00:00:00Z") } }]);
    expect(read().tokens.refresh_token).toBe("r3");
    expect(sent).toEqual([]);
  });

  it("leaves another account's sign-in alone", () => {
    const { s, sent, read } = setup(auth("other", "2026-11-01T00:00:00Z", "someone-else"));
    s.update([{ connectionId: "mc1", secret: { auth: auth("r3", "2026-11-12T00:00:00Z") } }]);
    expect(read().tokens.refresh_token).toBe("other");
    expect(sent).toEqual([]);
  });
});
