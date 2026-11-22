import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { api } from "../api.ts";
import { useStore, type ComputerInfo } from "../store.ts";
import { ComputerLive, ComputersView, activityDot, computerState, stateColor } from "./ComputersView.tsx";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: vi.fn(),
  useState: (initial: unknown) => [typeof initial === "function" ? (initial as () => unknown)() : initial, vi.fn()],
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useRef: () => ({ current: null }),
  // no window here: a store that has a server snapshot (the address) answers with it
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown, server?: () => unknown) => (server ?? snapshot)(),
}));
vi.mock("../api.ts", () => ({ api: vi.fn(), uploadFile: vi.fn() }));
vi.mock("../store.ts", async (original) => {
  const actual = await original<typeof import("../store.ts")>();
  return { ...actual, useStore: Object.assign((select: (s: ReturnType<typeof actual.useStore.getState>) => unknown) => select(actual.useStore.getState()), actual.useStore) };
});
vi.mock("../theme.ts", () => ({ motionReduced: () => false }));
vi.mock("../components/ComputerSync.tsx", () => ({ remotePlatform: () => "linux", useClipboardSync: () => ({}) }));

const initial = useStore.getState();
beforeEach(() => {
  vi.mocked(api).mockReset().mockResolvedValue({});
  vi.mocked(useEffect).mockClear();
  useStore.setState({ me: { user: { id: "me" }, role: "owner" } as never, agents: [{ id: "atlas", name: "Atlas", status: "online", settings: {} }] as never, computers: [{ id: "computer", name: "Desk", kind: "vm", config: {}, agents: ["atlas"], online: true, controller: null, status: "ready" } as unknown as ComputerInfo] });
});
afterEach(() => useStore.setState(initial, true));

const computer = () => useStore.getState().computers[0];

function mount() {
  ComputerLive({ computer: computer(), devices: [], teach: null });
  const effect = vi.mocked(useEffect).mock.calls.find(([, deps]) => deps?.[0] === "computer" && deps?.[1] === "me")![0];
  return effect() as () => void;
}

/** An element tree without rendering components: every element, depth-first. */
function walk(node: any, out: any[] = []): any[] {
  if (Array.isArray(node)) node.forEach((n) => walk(n, out));
  else if (node && typeof node === "object" && "props" in node) {
    out.push(node);
    walk(node.props.children, out);
  }
  return out;
}
/** The live view's elements, watching or with `controller` in control. */
function live(controller: unknown = null) {
  useStore.setState((s) => ({ computers: s.computers.map((c) => ({ ...c, controller: controller as ComputerInfo["controller"] })) }));
  return walk(ComputerLive({ computer: computer(), devices: [], teach: null }));
}
const byTestId = (nodes: any[], id: string) => nodes.find((n) => n.props?.["data-testid"] === id);
const menuLabels = (nodes: any[]) => (nodes.find((n) => Array.isArray(n.props?.items))?.props.items as { label: string }[]).map((i) => i.label);
const button = (nodes: any[], text: string) => nodes.find((n) => n.props?.children === text && n.props?.onClick);

describe("the Computers page and a computer's sheet", () => {
  it("shows only the grid at the bare address", () => {
    const page = ComputersView({ computerId: null, teach: null }) as any;
    expect(page.type.name).toBe("ComputersHome");
    expect(page.props.open).toBeUndefined();
    expect(page.props.children).toBeFalsy();
  });

  it("opens a computer's sheet beside the grid at the computer's address", () => {
    const page = ComputersView({ computerId: "computer", teach: null }) as any;
    expect(page.type.name).toBe("ComputersHome");
    expect(page.props.open).toBe("c:computer");
    expect(page.props.children.type.name).toBe("ComputerSheet");
    expect(page.props.children.props.target).toMatchObject({ kind: "computer", computer: { id: "computer" } });
  });

  it("opens a device's sheet at the device's address (still loading until the devices arrive)", () => {
    const page = ComputersView({ computerId: null, teach: null, deviceId: "mac" }) as any;
    expect(page.props.open).toBe("d:mac");
    expect(page.props.children.props.target.kind).toBe("loading");
  });

  it("gives teaching a task the live view", () => {
    const page = ComputersView({ computerId: "computer", teach: "atlas" }) as any;
    expect(page.type).toBe(ComputerLive);
    expect(page.props.teach).toBe("atlas");
  });
});

describe("a computer's live view", () => {
  it("is one slim row over the screen: Back, the name, what is happening, Take over and one More", () => {
    const nodes = live();
    const bar = walk(byTestId(nodes, "screen-bar"));
    expect(bar.some((n) => n.props?.["aria-label"] === "Back")).toBe(true);
    expect(bar.some((n) => n.type === "h1" && n.props.children === "Desk")).toBe(true);
    expect(bar.some((n) => n.props?.role === "status")).toBe(true);
    expect(button(bar, "Take over")).toBeTruthy();
    // no side panel, no Details button, no second layout for phones
    expect(nodes.some((n) => n.type === "aside")).toBe(false);
    expect(nodes.some((n) => n.props?.["aria-label"] === "Details")).toBe(false);
    expect(nodes.filter((n) => n.props?.["aria-label"] === "Back")).toHaveLength(1);
    expect(byTestId(nodes, "control-frame")).toBeUndefined();
  });

  it("keeps Clipboard, Files, Screenshot and Teach a task behind the one More while watching", () => {
    expect(menuLabels(live())).toEqual(["Clipboard", "Files", "Screenshot", "Teach a task"]);
  });

  it("while in control shows Hand back, the amber frame, and Keys in More", () => {
    const nodes = live({ kind: "user", id: "me", since: new Date().toISOString() });
    expect(button(nodes, "Hand back")).toBeTruthy();
    expect(button(nodes, "Take over")).toBeUndefined();
    expect(byTestId(nodes, "control-frame")).toBeTruthy();
    expect(menuLabels(nodes)).toEqual(["Clipboard", "Files", "Keys", "Screenshot", "Teach a task"]);
  });

  it("hands back at once, with no dialog", () => {
    const nodes = live({ kind: "user", id: "me", since: new Date().toISOString() });
    button(nodes, "Hand back").props.onClick();
    expect(api).toHaveBeenCalledWith("POST", "/api/computers/computer/control", { take: false });
  });

  it("gives the computer back when you leave while in control", () => {
    const leave = mount();
    useStore.setState((s) => ({ computers: s.computers.map((c) => ({ ...c, controller: { kind: "user", id: "me", since: "now" } as ComputerInfo["controller"] })) }));
    leave();
    expect(api).toHaveBeenCalledWith("POST", "/api/computers/computer/control", { take: false });
  });

  it("leaves the computer alone when you leave without control", () => {
    mount()();
    expect(api).not.toHaveBeenCalledWith("POST", "/api/computers/computer/control", { take: false });
  });
});

describe("status colors", () => {
  const now = new Date().toISOString();
  const base = { id: "c", kind: "vm", agents: [], online: true, controller: null, status: "running" } as unknown as ComputerInfo;
  const color = (c: Partial<ComputerInfo>, meId = "me") => {
    const full = { ...base, ...c } as ComputerInfo;
    return stateColor(computerState(full, meId, [], () => "Sam"), full, full.controller?.id === meId);
  };
  it("working is blue, ready is green, a problem is red", () => {
    expect(color({})).toBe("var(--st-online)");
    expect(color({ activity: { text: "Opening a page", at: now } } as never)).toBe("var(--st-working)");
    expect(color({ status: "starting" } as never)).toBe("var(--st-working)");
    expect(color({ status: "error" } as never)).toBe("var(--st-problem)");
  });
  it("you, someone else, or a call for help is amber", () => {
    expect(color({ controller: { kind: "user", id: "me", since: now } } as never)).toBe("var(--st-needs)");
    expect(color({ controller: { kind: "user", id: "sam", since: now } } as never)).toBe("var(--st-needs)");
    expect(color({ help: { agentId: "a", request: "log in", at: now } } as never)).toBe("var(--st-needs)");
  });
  it("offline or paused is gray, and offline wins over help and control", () => {
    expect(color({ online: false })).toBe("var(--status-idle)");
    expect(color({ online: false, help: { agentId: "a", request: "x", at: now }, controller: { kind: "user", id: "me", since: now } } as never)).toBe("var(--status-idle)");
    expect(color({ paused: true } as never)).toBe("var(--status-idle)");
    expect(color({ status: "stopped" } as never)).toBe("var(--status-idle)");
  });
  it("working computers are not warn-toned", () => {
    const state = computerState({ ...base, activity: { text: "x", at: now } } as unknown as ComputerInfo, "me", [], () => "Sam");
    expect(state).toMatchObject({ working: true, tone: "info" });
  });
  it("colors activity lines by what happened", () => {
    expect(activityDot("Took control")).toBe("var(--st-needs)");
    expect(activityDot("Handed it back")).toBe("var(--st-online)");
    expect(activityDot("Handed back")).toBe("var(--st-online)");
    expect(activityDot("Opened the live view")).toBe("var(--accent-computers)");
    expect(activityDot("Wrong code entered")).toBe("var(--status-idle)");
  });
});
