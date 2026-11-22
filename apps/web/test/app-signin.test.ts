import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api.ts";
import { connectApps, waitForSignIn } from "../src/appSignIn.ts";
import { howToSignIn } from "../src/views/AppPages.tsx";

vi.mock("../src/api.ts", () => ({ api: vi.fn() }));
vi.mock("../src/theme.ts", () => ({ motionReduced: () => false }));

const conn = (id: string, auth: { signedIn: boolean; error: string | null }) => ({ id, name: id, kind: "mcp-http", auth: { required: true, ...auth } });
const tab = { location: { href: "" }, close: vi.fn() };

beforeEach(() => {
  vi.stubGlobal("location", { origin: "http://127.0.0.1:8787" });
  vi.stubGlobal("window", { open: vi.fn(() => tab) });
  tab.location.href = "";
  tab.close.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(api).mockReset();
});

describe("connectApps", () => {
  it("opens the tab on the click, points it at the sign-in page, and waits for the hub", async () => {
    const calls: unknown[] = [];
    let looks = 0;
    vi.mocked(api).mockImplementation(async (method: string, path: string, body?: unknown) => {
      calls.push([method, path, body]);
      if (path === "/api/connectors/connect") return { url: "https://accounts.google.com/o/oauth2/v2/auth?x=1", connectors: [conn("c1", { signedIn: false, error: null }), conn("c2", { signedIn: false, error: null })] };
      looks++;
      return [conn("c1", { signedIn: looks > 1, error: null }), conn("c2", { signedIn: looks > 1, error: null }), conn("other", { signedIn: false, error: "x" })];
    });
    const r = await connectApps(["gmail", "gcal"], { allAgents: true }, { pollMs: 1 });
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    expect(tab.location.href).toBe("https://accounts.google.com/o/oauth2/v2/auth?x=1");
    expect(calls[0]).toEqual(["POST", "/api/connectors/connect", { catalogIds: ["gmail", "gcal"], origin: "http://127.0.0.1:8787", returnTo: "close", allAgents: true }]);
    expect(r.ok).toBe(true);
    expect(r.connectors.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("closes the tab and says why when the hub can't start it", async () => {
    vi.mocked(api).mockRejectedValue(new Error("Signing in with Google isn't set up for Wisp yet."));
    const r = await connectApps(["gmail"]);
    expect(tab.close).toHaveBeenCalled();
    expect(r).toEqual({ ok: false, error: "Signing in with Google isn't set up for Wisp yet.", connectors: [] });
  });

  it("stops at a cancelled sign-in, or when time runs out", async () => {
    vi.mocked(api).mockResolvedValue([conn("c1", { signedIn: false, error: "Sign-in was cancelled." })]);
    expect(await waitForSignIn(["c1"], { pollMs: 1 })).toMatchObject({ ok: false, error: "Sign-in was cancelled." });
    vi.mocked(api).mockResolvedValue([conn("c1", { signedIn: false, error: null })]);
    expect(await waitForSignIn(["c1"], { pollMs: 1, timeoutMs: 10 })).toMatchObject({ ok: false, error: "The sign-in didn't finish. Try again." });
  });
});

describe("howToSignIn", () => {
  it("says what signing in allows, or why it can't and what to do instead", () => {
    expect(howToSignIn("Gmail", { signIn: true, reads: "Reads and searches your email", key: false })).toBe("A page opens in your browser to sign in to Gmail. Wisp never sees your password. Reads and searches your email.");
    expect(howToSignIn("Notion", { signIn: false, reason: "Notion only signs in when Wisp is open over https or on this computer.", key: true })).toBe("Notion only signs in when Wisp is open over https or on this computer. You can use a key instead.");
  });
});
