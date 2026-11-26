import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@bubble-ai/core";
import { uuid } from "../src/uuid.ts";
import { canReadClipboard, copyText, readText } from "../src/clipboard.ts";
import { callFacts } from "../src/voice/facts.ts";
import { INITIAL_CALL } from "../src/voice/call.ts";
import { MIC_NEEDS_SECURE } from "../src/voice/engine.ts";

// The Android app (and any browser on plain http) isn't a secure context: no crypto.randomUUID,
// no navigator.clipboard, no navigator.mediaDevices.

afterEach(() => vi.unstubAllGlobals());

describe("uuid", () => {
  it("uses crypto.randomUUID when there is one", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "from-crypto", getRandomValues: () => {} });
    expect(uuid()).toBe("from-crypto");
  });
  it("makes a v4 UUID without it", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: (b: Uint8Array) => real.getRandomValues(b) });
    const ids = new Set(Array.from({ length: 50 }, () => uuid()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("copy and paste", () => {
  it("goes through the Android app's bridge first", async () => {
    const copied: string[] = [];
    vi.stubGlobal("window", { WispAndroid: { copyText: (t: string) => copied.push(t), readText: () => "on the phone" } });
    vi.stubGlobal("navigator", {});
    await copyText("hello");
    expect(copied).toEqual(["hello"]);
    expect(canReadClipboard()).toBe(true);
    expect(await readText()).toBe("on the phone");
  });
  it("uses the Clipboard API where it exists", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyText("hi");
    expect(writeText).toHaveBeenCalledWith("hi");
  });
  it("falls back to execCommand on plain http", async () => {
    const field = { value: "", style: {} as Record<string, string>, setAttribute() {}, select() {}, setSelectionRange() {}, remove: vi.fn() };
    const execCommand = vi.fn(() => true);
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", { createElement: () => field, body: { appendChild() {} }, activeElement: null, execCommand });
    await copyText("plain");
    expect(field.value).toBe("plain");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(field.remove).toHaveBeenCalled();
    expect(canReadClipboard()).toBe(false);
  });
  it("says so when nothing could copy", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", { createElement: () => ({ style: {}, setAttribute() {}, select() {}, setSelectionRange() {}, remove() {} }), body: { appendChild() {} }, activeElement: null, execCommand: () => false });
    await expect(copyText("x")).rejects.toThrow(/Couldn't copy/);
  });
});

describe("a call without a microphone", () => {
  const agent = { id: "a", name: "Nov", handle: "nov", status: "offline", settings: {} } as unknown as Agent;
  const noMic = { ...INITIAL_CALL, error: MIC_NEEDS_SECURE, needsMic: true, phase: "error" as const };
  it("gives the real reason instead of calling the agent asleep", () => {
    const f = callFacts({ agent, state: noMic, connected: true, seconds: 0, showActivity: true });
    expect(f).toMatchObject({ offline: false, micTrouble: true, label: "No microphone" });
  });
  it("still says asleep for an asleep agent otherwise", () => {
    expect(callFacts({ agent, state: INITIAL_CALL, connected: true, seconds: 0, showActivity: true })).toMatchObject({ offline: true, label: "Asleep" });
  });
});

describe("the error screen", () => {
  it("clears when you go somewhere else", async () => {
    vi.stubGlobal("window", new EventTarget());
    const { ErrorBoundary } = await import("../src/components/ErrorBoundary.tsx");
    const b = new ErrorBoundary({ children: null });
    b.setState = ((s: { error: Error | null }) => Object.assign(b.state, s)) as typeof b.setState;
    b.componentDidMount();
    b.state.error = new Error("crypto.randomUUID is not a function");
    window.dispatchEvent(new Event("hashchange"));
    expect(b.state.error).toBeNull();
    b.componentWillUnmount();
    b.state.error = new Error("again");
    window.dispatchEvent(new Event("hashchange"));
    expect(b.state.error).not.toBeNull();
  });
});
