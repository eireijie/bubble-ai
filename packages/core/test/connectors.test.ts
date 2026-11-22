import { describe, expect, it } from "vitest";
import { CONNECTOR_CATALOG, CONNECTOR_HELP, connectorUnsupportedReason, everydayFirst, harnessSupportsConnectors, signInReturnsTo, type ConnectorKind } from "../src/connectors.ts";

const kinds: ConnectorKind[] = ["mcp-http", "mcp-stdio", "secret"];

describe("harnessSupportsConnectors", () => {
  it("native harnesses get every kind", () => {
    for (const id of ["claude-code", "codex"]) for (const k of kinds) expect(harnessSupportsConnectors(id, k)).toBe(true);
  });
  it("acp harnesses get everything but remote servers", () => {
    for (const id of ["gemini", "acp:my-bot"]) {
      expect(harnessSupportsConnectors(id)).toBe(false);
      expect(harnessSupportsConnectors(id, "mcp-http")).toBe(false);
      expect(harnessSupportsConnectors(id, "mcp-stdio")).toBe(true);
      expect(harnessSupportsConnectors(id, "secret")).toBe(true);
    }
  });
  it("mcp harnesses get nothing", () => {
    for (const k of kinds) expect(harnessSupportsConnectors("grok", k)).toBe(false);
    expect(harnessSupportsConnectors("unknown-thing")).toBe(false);
  });
  it("explains why in plain words", () => {
    expect(connectorUnsupportedReason("gemini")).toBe("Gemini CLI can't use connected apps yet");
    expect(connectorUnsupportedReason("grok")).toBe("Grok connects through wisp-mcp, so it can't use connected apps here");
    expect(connectorUnsupportedReason("codex")).toBeNull();
    expect(connectorUnsupportedReason("gemini", "secret")).toBeNull();
    expect(CONNECTOR_HELP).toMatch(/Claude Code or Codex/);
  });
});

describe("everydayFirst", () => {
  it("puts chat & docs first and developer things last without mutating", () => {
    const before = CONNECTOR_CATALOG.map((c) => c.id);
    const out = everydayFirst(CONNECTOR_CATALOG);
    expect(CONNECTOR_CATALOG.map((c) => c.id)).toEqual(before);
    expect(out).toHaveLength(CONNECTOR_CATALOG.length);
    expect(out.slice(0, 5).map((c) => c.id)).toEqual(["gmail", "gcal", "slack", "notion", "gdrive"]);
    const ids = out.map((c) => c.id);
    expect(ids.indexOf("slack")).toBeLessThan(ids.indexOf("github"));
    expect(ids.indexOf("gdrive")).toBeLessThan(ids.indexOf("github"));
    expect(out.at(-1)?.category).toBe("Cloud keys");
  });
});

describe("one-click sign-in", () => {
  it("every sign-in is the company's own remote server, and Google ones ask only to read", () => {
    const withSignIn = CONNECTOR_CATALOG.filter((c) => c.signIn);
    expect(withSignIn.map((c) => c.id).sort()).toEqual(["gcal", "gdrive", "github", "gmail", "linear", "notion", "slack", "vercel"]);
    for (const c of withSignIn) {
      expect(c.signIn!.url).toMatch(/^https:\/\//);
      expect(c.signInReads).toBeTruthy();
      if (c.signIn!.via === "app" && c.signIn!.provider === "google") for (const s of c.signIn!.scopes) expect(s).toMatch(/readonly$/);
      if (c.signIn!.via === "app" && c.signIn!.provider === "slack") expect(c.signIn!.scopes.some((s) => /write/.test(s))).toBe(false);
    }
  });
  it("knows when a sign-in page can send people back", () => {
    expect(signInReturnsTo("http://127.0.0.1:8787")).toBe(true);
    expect(signInReturnsTo("http://localhost:5173", true)).toBe(true);
    expect(signInReturnsTo("https://wisp.example.ts.net")).toBe(true);
    expect(signInReturnsTo("https://wisp.example.ts.net", true)).toBe(false);
    expect(signInReturnsTo("http://192.168.1.5:8787")).toBe(false);
    expect(signInReturnsTo("not a url")).toBe(false);
  });
});
