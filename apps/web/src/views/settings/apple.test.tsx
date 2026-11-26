import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { APPLE_DEFAULTS, type AppleMacStatus, type AppleView } from "@bubble-ai/core";
import { api, observeEvents } from "../../api.ts";
import { AppleSeg } from "../../components/AppleParts.tsx";
import { OwnersOnly } from "./parts.tsx";
import { ApplePage, MacSheet, agentsPatch, needsPermission, speakValue } from "./apple.tsx";

const state = vi.hoisted(() => ({ role: "owner", apple: false }));
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), useState: vi.fn(), useEffect: vi.fn(), useLayoutEffect: vi.fn() }));
vi.mock("../../api.ts", () => ({ api: vi.fn(), getToken: () => "t", observeEvents: vi.fn() }));
vi.mock("../../theme.ts", () => ({ motionReduced: () => false }));
vi.mock("../../store.ts", () => ({ usePrefs: () => ({ clock: "24h" }), useStore: (select: (s: unknown) => unknown) => select({ me: { role: state.role, features: { apple: state.apple } }, agents: [] }) }));

const allowed: AppleMacStatus = { fullDiskAccess: "allowed", messagesControl: "allowed", contacts: "allowed", calendars: "allowed", reminders: "allowed", messagesSignedIn: true };
const view = (over: Partial<AppleView> = {}): AppleView => ({
  settings: { ...APPLE_DEFAULTS, macNodeId: "mac1", levels: { messages: 2, contacts: 1, calendar: 2, reminders: 2, location: 1 } },
  macs: [{ nodeId: "mac1", name: "MacBook Pro", online: true, status: { ...allowed, reminders: "denied" } }],
  iphones: [{ id: "ph1", name: "iPhone", lastAt: new Date().toISOString() }],
  agents: [
    { id: "a1", name: "Harry", handle: "harry", role: "Business manager" },
    { id: "a2", name: "Nova", handle: "nova", role: null },
  ],
  ...over,
});

let states: any[];
function render(fn: () => any) {
  let index = 0;
  vi.mocked(useState).mockImplementation((initial?: unknown): [any, any] => {
    const current = index++;
    if (!(current in states)) states[current] = initial;
    return [
      states[current],
      (value: any) => {
        states[current] = typeof value === "function" ? value(states[current]) : value;
      },
    ];
  });
  return fn();
}
function findAll(node: any, predicate: (node: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.forEach((n) => findAll(n, predicate, out));
    return out;
  }
  if (predicate(node)) out.push(node);
  findAll([node.props?.children, node.props?.right, node.props?.sub], predicate, out);
  return out;
}
const text = (node: any): string => (typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : "");

beforeEach(() => {
  state.role = "owner";
  state.apple = false;
  vi.mocked(api).mockReset();
  vi.mocked(useEffect).mockReset();
  vi.mocked(observeEvents).mockReturnValue(vi.fn());
});

describe("Settings → Apple", () => {
  it("loads from the hub and refetches when Apple changes", async () => {
    states = [];
    vi.mocked(api).mockResolvedValue(view());
    render(ApplePage);
    vi.mocked(useEffect).mock.calls[0][0]();
    expect(api).toHaveBeenCalledWith("GET", "/api/apple");
    const listener = vi.mocked(observeEvents).mock.calls[0][0];
    listener({ type: "apple_changed" } as never);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("looks again when the hub says off right after the mod was switched on, and only then says it's off", async () => {
    vi.useFakeTimers();
    states = [];
    state.apple = true;
    const loaded = view();
    vi.mocked(api).mockRejectedValueOnce({ status: 404, message: "The Apple mod is off. Turn it on in Mods." }).mockResolvedValue(loaded);
    render(ApplePage);
    vi.mocked(useEffect).mock.calls[0][0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(states[2]).not.toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(api).toHaveBeenCalledTimes(2);
    expect(states[0]).toBe(loaded);
    expect(states[2]).toBe(false);
    vi.useRealTimers();
  });

  it("lets owners change each app's level, and flags a missing Mac permission with Fix on the Mac", async () => {
    states = [view(), null, false, null, null];
    const tree = render(ApplePage);
    expect(findAll(tree, (n) => n.type === OwnersOnly)[0].props.show).toBe(false);
    const segs = findAll(tree, (n) => n.type === AppleSeg);
    expect(segs.map((s) => s.props.label)).toEqual(["Messages access", "Contacts access", "Calendar access", "Reminders access", "Location access"]);
    expect(segs.every((s) => !s.props.disabled)).toBe(true);
    expect(segs[4].props.options.map((o: any) => o[1])).toEqual(["Off", "When asked", "Asked and places"]);
    expect(text(tree)).toContain("Needs permission · ");
    const fix = findAll(tree, (n) => n.type === "button" && text(n) === "Fix on the Mac")[0];
    fix.props.onClick();
    expect(states[3]).toBe("mac1");

    vi.mocked(api).mockResolvedValue(view());
    segs[0].props.onChange(1);
    expect(api).toHaveBeenCalledWith("PUT", "/api/apple/settings", { levels: { messages: 1 } });
  });

  it("shows members the same page, read-only", () => {
    state.role = "member";
    states = [view(), null, false, null, null];
    const tree = render(ApplePage);
    expect(findAll(tree, (n) => n.type === OwnersOnly)[0].props.show).toBe(true);
    expect(findAll(tree, (n) => n.type === AppleSeg).every((s) => s.props.disabled)).toBe(true);
    expect(findAll(tree, (n) => n.type === "button" && text(n) === "Fix on the Mac")).toHaveLength(0);
    expect(findAll(tree, (n) => n.type === "button" && text(n) === "Use")).toHaveLength(0);
  });

  it("offers each other Mac to an owner, and says when the mod is off", () => {
    states = [view({ macs: [...view().macs, { nodeId: "mac2", name: "Mac mini", online: false, status: null }] }), null, false, null, null];
    const use = findAll(render(ApplePage), (n) => n.type === "button" && text(n) === "Use");
    expect(use.map((b) => b.props["aria-label"])).toEqual(["Use Mac mini"]);
    states = [null, null, true, null, null];
    expect(text(render(ApplePage))).toContain("Apple is off.");
  });
});

describe("Apple helpers", () => {
  it("counts a permission as missing only when the app is on and the Mac said no", () => {
    const status = { ...allowed, messagesControl: "not_asked" as const, contacts: "unknown" as const };
    expect(needsPermission("messages", 1, status)).toBe(false);
    expect(needsPermission("messages", 2, status)).toBe(true);
    expect(needsPermission("messages", 0, status)).toBe(false);
    expect(needsPermission("contacts", 1, status)).toBe(false);
    expect(needsPermission("reminders", 1, null)).toBe(false);
  });

  it("treats every agent ticked as every agent", () => {
    const agents = view().agents;
    const all = { ...APPLE_DEFAULTS, allAgents: true };
    expect(agentsPatch(all, agents, "a2", false)).toEqual({ allAgents: false, agentIds: ["a1"] });
    expect(agentsPatch({ ...APPLE_DEFAULTS, allAgents: false, agentIds: ["a1"] }, agents, "a2", true)).toEqual({ allAgents: true, agentIds: [] });
  });

  it("sums up each Speak up row", () => {
    // unanswered texts are off until the person turns them on
    expect(speakValue("unanswered", APPLE_DEFAULTS)).toBe("Off");
    const s = { ...APPLE_DEFAULTS, speakUp: { ...APPLE_DEFAULTS.speakUp, unanswered: true }, places: [{ id: "p1", name: "Home", latitude: 0, longitude: 0, radius: 100, arrive: true, leave: true }] };
    expect(speakValue("unanswered", s)).toBe("Anyone in Contacts");
    expect(speakValue("unanswered", { ...s, speakUp: { ...s.speakUp, unansweredFrom: ["Mom", "Sam"] } })).toBe("From 2 people");
    expect(speakValue("calendar", s)).toBe("On");
    expect(speakValue("places", s)).toBe("Home");
    expect(speakValue("reminders", { ...s, speakUp: { ...s.speakUp, reminders: false } })).toBe("Off");
  });
});

describe("Mac permissions sheet", () => {
  it("lists each permission with Open Settings for the ones not allowed, and polls while open", async () => {
    vi.useFakeTimers();
    states = [];
    const mac = view().macs[0];
    const onView = vi.fn();
    const tree = render(() => MacSheet({ mac, onView, onClose: vi.fn() }));
    expect(text(tree)).toContain("To read and search Messages");
    expect(text(tree)).toContain("To send texts you approve");
    expect(text(tree)).toContain("Messages needs this Mac signed in to your Apple Account.");
    const open = findAll(tree, (n) => text(n) === "Open Settings" && typeof n.props?.onClick === "function");
    expect(open).toHaveLength(1);

    vi.mocked(api).mockResolvedValue(view());
    const stop = vi.mocked(useEffect).mock.calls[0][0]() as () => void;
    expect(api).toHaveBeenCalledWith("POST", "/api/apple/mac/refresh");
    vi.advanceTimersByTime(3000);
    expect(api).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(9000);
    expect(api).toHaveBeenCalledTimes(2);

    await open[0].props.onClick();
    expect(api).toHaveBeenCalledWith("POST", "/api/apple/mac/permission", { pane: "reminders" });
    vi.useRealTimers();
  });
});
