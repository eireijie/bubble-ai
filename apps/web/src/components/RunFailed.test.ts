import { describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// the shared UI parts read browser state when their module loads
vi.mock("../theme.ts", () => ({ motionReduced: () => false }));
const { RunFailed, failedLine, fixAction } = await import("./RunFailed.tsx");
const { withLastFailure } = await import("./helpChecks.ts");
const { failedNeedText } = await import("./FailedNeed.tsx");

describe("a failed reply", () => {
  it("offers one fix: Install, Sign in, Choose device, else Try again", () => {
    expect(fixAction({ fix: "install", nodeId: "n1", harness: "claude-code", retry: true })).toBe("install");
    // Install needs a device and a harness to name
    expect(fixAction({ fix: "install", retry: true })).toBe("retry");
    expect(fixAction({ fix: "signin", retry: true })).toBe("signin");
    expect(fixAction({ fix: "computer", retry: false })).toBe("signin");
    expect(fixAction({ fix: "connection", retry: true })).toBe("signin");
    expect(fixAction({ fix: "device", retry: true })).toBe("device");
    expect(fixAction({ retry: true })).toBe("retry");
    expect(fixAction({ retry: false })).toBeNull();
  });

  it("says why in one plain line, or Couldn't finish.", () => {
    expect(failedLine({ why: "Claude Code isn't installed on Mac mini." })).toBe("Claude Code isn't installed on Mac mini.");
    expect(failedLine({})).toBe("Couldn't finish.");
  });

  it("shows the reason and only the Install button", () => {
    const html = renderToStaticMarkup(h(RunFailed, { part: { type: "run_failed", runId: "r1", retry: true, reason: "not_installed", why: "Claude Code isn't installed on box.", fix: "install", harness: "claude-code", nodeId: "n1" }, agentId: "a1" }));
    expect(html).toContain("Claude Code isn&#x27;t installed on box.");
    expect(html).toContain(">Install<");
    expect(html).not.toContain("Try again");
  });

  it("links Choose device to the agent's device page", () => {
    const html = renderToStaticMarkup(h(RunFailed, { part: { type: "run_failed", runId: "r1", retry: true, reason: "no_device", why: "box can't run it right now.", fix: "device" }, agentId: "a1" }));
    expect(html).toContain('href="#/agents/a1/device"');
    expect(html).toContain("Choose device");
  });

  it("reads as a need in one sentence", () => {
    expect(failedNeedText("Juno", { why: "Codex isn't signed in on box." })).toBe("Juno couldn't answer. Codex isn't signed in on box.");
    expect(failedNeedText("Juno", {})).toBe("Juno couldn't answer.");
  });
});

describe("My agent isn't answering", () => {
  const agent = { id: "a1", harness: "claude-code" };
  const checks = [
    { id: "helper", status: "ok", label: "You have an agent: Juno", fix: null, to: null },
    { id: "device", status: "ok", label: "Juno works on box", fix: null, to: null },
    { id: "online", status: "ok", label: "box is on and connected", fix: null, to: null },
    { id: "harness", status: "ok", label: "Claude Code is installed on box", fix: null, to: null },
    { id: "signin", status: "ok", label: "Claude Code is signed in", fix: null, to: null },
  ] as const;

  it("believes the last failed reply over the device's list", () => {
    const out = withLastFailure([...checks], { reason: "not_installed", why: "Claude Code isn't installed on box." }, agent);
    expect(out.find((c) => c.id === "harness")).toMatchObject({ status: "bad", fix: expect.stringContaining("isn't installed"), to: { view: "agents", agentId: "a1", tab: "model" } });
    // what comes after can't be told any more
    expect(out.find((c) => c.id === "signin")?.status).toBe("unknown");
  });

  it("marks the sign-in when that's what failed, and leaves the list alone otherwise", () => {
    expect(withLastFailure([...checks], { reason: "signed_out" }, agent).find((c) => c.id === "signin")?.status).toBe("bad");
    expect(withLastFailure([...checks], { reason: "error" }, agent)).toEqual(checks);
    expect(withLastFailure([...checks], null, agent)).toEqual(checks);
  });

  it("keeps an earlier problem first", () => {
    const offline = checks.map((c) => (c.id === "online" ? { ...c, status: "bad" as const } : c));
    expect(withLastFailure(offline, { reason: "not_installed" }, agent)).toEqual(offline);
  });
});
