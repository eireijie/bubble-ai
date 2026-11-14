import { describe, expect, it } from "vitest";
import { KeyRejected, ModelConnections } from "../src/model-connections.ts";

const jwt = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.y`;
const auth = (exp = Date.now() / 1000 + 3600) => ({ tokens: { access_token: jwt(exp), refresh_token: "r", account_id: "acct" }, last_refresh: new Date().toISOString() });

describe("checking a Codex sign-in before the hub keeps it", () => {
  it("asks ChatGPT with the sign-in and its account, and takes the plan it answers with", async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const models = new ModelConnections({} as never, (async (url: string, init: { headers: Record<string, string> }) => {
      seen = { url, headers: init.headers };
      return new Response(JSON.stringify({ plan_type: "plus" }), { status: 200 });
    }) as never);
    expect(await models.checkChatgpt(auth())).toEqual({ plan: "Plus" });
    expect(seen!.url).toBe("https://chatgpt.com/backend-api/wham/usage");
    expect(seen!.headers["chatgpt-account-id"]).toBe("acct");
  });
  it("turns down one ChatGPT refuses, and an expired one without asking", async () => {
    const refused = new ModelConnections({} as never, (async () => new Response("no", { status: 401 })) as never);
    await expect(refused.checkChatgpt(auth())).rejects.toBeInstanceOf(KeyRejected);
    const never = new ModelConnections({} as never, (async () => {
      throw new Error("shouldn't be asked");
    }) as never);
    await expect(never.checkChatgpt(auth(Date.now() / 1000 - 60))).rejects.toThrow(/expired/);
  });
});
