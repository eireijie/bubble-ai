import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useStore, type ComputerInfo, type Me } from "../src/store.ts";
import { ComputerSheet } from "../src/views/DevicePage.tsx";
import { ComputersView } from "../src/views/ComputersView.tsx";
import type { NodeInfo } from "../src/views/deviceBits.tsx";

vi.mock("../src/api.ts", () => ({ api: vi.fn(() => new Promise(() => {})), uploadFile: vi.fn() }));
vi.mock("../src/theme.ts", () => ({ motionReduced: () => false, useAppearance: () => ({ resolvedMode: "light", mode: "light", setMode: vi.fn(), toggleMode: vi.fn() }) }));

const initial = useStore.getInitialState();
const saved = { me: initial.me, computers: initial.computers, agents: initial.agents };
afterEach(() => Object.assign(initial, saved));

function signIn(role: Me["role"] = "owner") {
  initial.me = { kind: "user", role, user: { id: "sam", name: "Sam", email: "sam@example.test", createdAt: "now" }, workspace: { id: "workspace", name: "Lab" }, prefs: { experience: "advanced", sendWith: "enter", clock: "auto", toolCalls: "collapsed" } };
}

const mac = (more: Partial<NodeInfo> = {}): NodeInfo => ({
  id: "mac",
  name: "This Mac",
  ownerName: "Sam",
  mine: true,
  shared: false,
  role: "screen",
  paused: false,
  capabilities: { platform: "darwin", arch: "arm64", screen: { ok: true, detail: "" }, vm: { ok: true, detail: "" } },
  online: true,
  lastSeen: null,
  agents: [],
  version: null,
  update: null,
  ...more,
});
const vm = { id: "desk", name: "Bubble AI computer", kind: "vm", nodeId: "mac", online: true, paused: false, agents: [], controller: null, help: null, activity: null, status: "stopped", statusText: "", config: { cpus: 2, memoryGb: 4 }, code: null, ownerId: null, transport: "vnc" } as unknown as ComputerInfo;

const sheet = (target: Parameters<typeof ComputerSheet>[0]["target"]) => renderToStaticMarkup(createElement(ComputerSheet, { target, refresh: async () => {} }));
/** The switch with this name, as it was rendered. */
const toggle = (html: string, label: string) => html.match(new RegExp(`<button[^>]*role="switch"[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";
/** The attribute, not the `disabled:` styles in its class. */
const DISABLED = ' disabled=""';
const inOrder =(html: string, words: string[]) => words.map((w) => html.indexOf(w)).every((at, i, all) => at >= 0 && (i === 0 || at > all[i - 1]));

describe("a computer's sheet", () => {
  it("is the screen, Watch and Take over, then one card of four rows", () => {
    signIn();
    const html = sheet({ key: "d:mac", kind: "device", node: mac() });
    expect(inOrder(html, ["This Mac", ">Watch<", ">Take over<", "Run commands and files", "See and use the screen", "Ask me", ">More<"])).toBe(true);
    expect(html).toContain("Ready");
    // what moved behind More is not on the sheet's first page
    for (const gone of ["Runs VMs", "Headless", "Agent harnesses", "Remove device", "Update Bubble AI", "bubble-ai node"]) expect(html).not.toContain(gone);
  });

  it("sets the hub's one switch with the first row; the second shows the same value and can't be changed", () => {
    signIn();
    const html = sheet({ key: "d:mac", kind: "device", node: mac() });
    expect(toggle(html, "Run commands and files")).toContain('aria-checked="true"');
    expect(toggle(html, "Run commands and files")).not.toContain(DISABLED);
    expect(toggle(html, "See and use the screen")).toContain('aria-checked="true"');
    expect(toggle(html, "See and use the screen")).toContain(DISABLED);
    const off = sheet({ key: "d:mac", kind: "device", node: mac({ role: "vms" }) });
    expect(toggle(off, "Run commands and files")).toContain('aria-checked="false"');
    expect(toggle(off, "See and use the screen")).toContain('aria-checked="false"');
  });

  it("can't turn the switch on from here when the screen is off at the computer, or the computer is someone else's", () => {
    signIn();
    const there = sheet({ key: "d:mac", kind: "device", node: mac({ capabilities: { platform: "darwin", arch: "arm64", screen: { ok: false, off: true, detail: "" }, vm: { ok: true, detail: "" } } }) });
    expect(toggle(there, "Run commands and files")).toContain(DISABLED);
    expect(toggle(there, "Run commands and files")).toContain('aria-checked="false"');
    expect(there).toContain("Set on this computer.");
    const theirs = sheet({ key: "d:mac", kind: "device", node: mac({ mine: false }) });
    expect(toggle(theirs, "Run commands and files")).toContain(DISABLED);
  });

  it("says offline with when it was last seen, and offers Retry", () => {
    signIn();
    const html = sheet({ key: "d:mac", kind: "device", node: mac({ online: false }) });
    expect(html).toContain("Offline. Never connected");
    expect(html).toContain(">Retry<");
  });

  it("shows a VM's sheet with both switches on, no Ask me, and its status in a few words", () => {
    signIn();
    const html = sheet({ key: "c:desk", kind: "computer", computer: vm, host: mac() });
    expect(inOrder(html, ["Bubble AI computer", ">Watch<", ">Take over<", "Run commands and files", "See and use the screen", ">More<"])).toBe(true);
    expect(html).toContain("Asleep. Wakes when needed.");
    expect(html).not.toContain("Ask me");
    for (const label of ["Run commands and files", "See and use the screen"]) {
      expect(toggle(html, label)).toContain('aria-checked="true"');
      expect(toggle(html, label)).toContain(DISABLED);
    }
  });

  it("gives paired phones their own sheet, and says so when a computer is gone", () => {
    signIn();
    const phones = sheet({ key: "phones", kind: "phones" });
    expect(inOrder(phones, ["Paired", "Pair a phone", "Phone sign-ins"])).toBe(true);
    expect(sheet({ key: "c:nope", kind: "gone" })).toContain("That computer is gone.");
  });
});

describe("the Computers page", () => {
  it("is a title, one plus, and a tile per computer with its name and one status line", () => {
    signIn("member");
    initial.computers = [vm];
    const html = renderToStaticMarkup(createElement(ComputersView, { computerId: null, teach: null }));
    expect(html).toContain("Computers");
    expect(html.match(/aria-label="Add a computer or phone"/g)).toHaveLength(1);
    expect(html).toContain('href="#/computers/desk"');
    expect(inOrder(html, ["Bubble AI computer", "Asleep. Wakes when needed."])).toBe(true);
    // no tree, no sections, no count of what is online
    for (const gone of ["Cloud computers", "online", "Your screen", "Phones"]) expect(html).not.toContain(gone);
  });

  it("opens the computer's sheet beside the grid", () => {
    signIn();
    initial.computers = [vm];
    const html = renderToStaticMarkup(createElement(ComputersView, { computerId: "desk", teach: null }));
    expect(html).toContain('aria-label="Computer details"');
    expect(html).toContain('aria-current="page"');
    expect(inOrder(html, [">Watch<", ">Take over<", "Run commands and files"])).toBe(true);
  });
});
