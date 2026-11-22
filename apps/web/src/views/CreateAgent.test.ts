import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { api, uploadFile } from "../api.ts";
import { useStore, type ComputerInfo } from "../store.ts";
import { resolveComputer } from "../agentComputer.ts";
import { Composer } from "./ChannelView.tsx";
import { AgentDetail, mergeSavedFields, type NodeInfo } from "./AgentSettings.tsx";
import { AGENT_NAMES, CreateAgent, ImportAgent, autoHandle, nameProblem, suggestName } from "./CreateAgent.tsx";
import { openDm } from "../openDm.ts";
import { setChannelPrefs } from "../components/Channels.tsx";
import { BackgroundPanel } from "./AgentBackground.tsx";
import { AgentsPolicyPage } from "./settings/workspace.tsx";
import { LiveScreen, ScreenThumb } from "../components/Screen.tsx";
import { mayLeave } from "../router.ts";
import type { Agent } from "@wisp/core";

// Run component handlers and effects without adding a DOM/test-renderer dependency.
// Child elements stay unrendered; each mounted component has its own hook state.
const hooks = vi.hoisted(() => ({ active: null as any }));
vi.mock("react", async (original) => {
  const real = await original<typeof import("react")>();
  const slot = () => {
    const h = hooks.active;
    const i = h.index++;
    return [h, i] as const;
  };
  return {
    ...real,
    useState(initial: any) {
      const [h, i] = slot();
      if (!(i in h.values)) h.values[i] = typeof initial === "function" ? initial() : initial;
      return [h.values[i], (value: any) => {
        const next = typeof value === "function" ? value(h.values[i]) : value;
        if (!Object.is(next, h.values[i])) h.changed = true;
        h.values[i] = next;
      }];
    },
    useRef(initial: any) {
      const [h, i] = slot();
      return h.values[i] ??= { current: initial };
    },
    useEffect(effect: any, deps?: any[]) {
      const [h, i] = slot();
      if (!h.values[i] || !deps || deps.some((d, n) => !Object.is(d, h.values[i].deps[n]))) {
        h.effects.push(() => {
          h.values[i]?.cleanup?.();
          h.values[i] = { deps, cleanup: effect() };
        });
      }
    },
    useMemo: (fn: any) => fn(),
    useCallback: (fn: any) => fn,
    useSyncExternalStore: (_subscribe: any, get: any) => get(),
    useImperativeHandle: () => {},
  };
});
vi.mock("../store.ts", async (original) => {
  const real = await original<typeof import("../store.ts")>();
  return {
    ...real,
    useStore: Object.assign((select: any) => select(real.useStore.getState()), real.useStore),
    usePrefs: () => ({ sendWith: "enter", experience: "advanced" }),
  };
});
// these tests pick where agents run (Advanced)
vi.mock("../computerMode.ts", () => ({ useComputerMode: () => ({ advanced: true, sharedComputerId: null, loaded: true }) }));
vi.mock("../api.ts", () => ({ api: vi.fn(), uploadFile: vi.fn(), getToken: () => "token", fileUrl: (id: string) => id, ApiError: class extends Error {} }));
vi.mock("../openDm.ts", async (original) => ({ ...(await original<typeof import("../openDm.ts")>()), openDm: vi.fn(async () => {}) }));
vi.mock("../theme.ts", () => ({ motionReduced: () => false, useMotionReduced: () => false }));
vi.mock("../markdown.ts", () => ({ renderMarkdown: (s: string) => s }));
const novnc = vi.hoisted(() => ({ construct: vi.fn() }));
vi.mock("@novnc/novnc", () => ({ default: class { constructor(...args: any[]) { novnc.construct(...args); } } }));

type El = { type: any; props: any };
function find(tree: any, test: (el: El) => boolean): El | undefined {
  if (Array.isArray(tree)) return tree.map((child) => find(child, test)).find(Boolean);
  if (!isValidElement(tree)) return;
  const el = tree as El;
  return test(el) ? el : find(el.props.children, test);
}
const field = (tree: any, label: string) => find(tree, (el) => el.props["aria-label"] === label)!;
const named = (tree: any, name: string) => find(tree, (el) => el.type.name === name)!;
interface Mounted { tree: any; render(): any; dispose(): void }
function mount(render: () => any): Mounted {
  const h = { index: 0, values: [] as any[], effects: [] as (() => void)[], changed: false };
  const m = {
    tree: null as any,
    render() {
      for (let n = 0; n < 15; n++) {
        h.index = 0;
        h.changed = false;
        hooks.active = h;
        m.tree = render();
        h.effects.splice(0).forEach((effect) => effect());
        if (!h.changed) return m.tree;
      }
      throw new Error("Component did not settle");
    },
    dispose() { h.values.forEach((v) => v?.cleanup?.()); },
  };
  mounts.push(m);
  m.render();
  return m;
}
const mounts: Mounted[] = [];
const initial = useStore.getState();
const deferred = <T = any>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const agent = { id: "a", name: "Agent", handle: "agent", harness: "claude-code", settings: {}, nodeId: "node" } as Agent;
const device = (id: string, role: NodeInfo["role"] = "vms"): NodeInfo => ({ id, name: id, mine: true, online: true, agents: [], role, capabilities: { platform: "linux", arch: "arm64", screen: { ok: false, detail: "off" }, vm: { ok: true, detail: "ready" } } });
const computer = { id: "desk", name: "Desk", nodeId: "node", kind: "vm", online: true, transport: "vnc", agents: [], workspaceId: "ws", config: {}, status: "ready", statusText: "", controller: null, help: null, createdAt: "2026-01-01", ownerId: null, paused: false, activity: null } as unknown as ComputerInfo;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { matchMedia: () => ({ matches: true }) }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  vi.stubGlobal("location", { protocol: "http:", host: "localhost", href: "http://localhost/#/agents/a/instructions", origin: "http://localhost", pathname: "/", search: "", hash: "#/agents/a/instructions" });
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("confirm", vi.fn(() => false));
  vi.mocked(api).mockImplementation(() => new Promise(() => {}));
  useStore.setState({ ...initial, agents: [], channels: [], computers: [], refreshAgents: vi.fn(async () => {}), refreshComputers: vi.fn(async () => {}), refreshChannels: vi.fn(async () => {}) }, true);
});
afterEach(() => {
  mounts.splice(0).forEach((m) => m.dispose());
  useStore.setState(initial, true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("composer regressions", () => {
  it("W4: isolates channel/thread drafts and restores failures alongside newer input", async () => {
    let channelId = "w4-a";
    let threadId: string | undefined;
    const m = mount(() => Composer({ channelId, threadId, placeholder: "Message" }));
    field(m.tree, "Message").props.onChange({ target: { value: "first", selectionStart: 5 } });
    const upload = deferred();
    vi.mocked(uploadFile).mockReturnValueOnce(upload.promise);
    const attaching = find(m.render(), (el) => el.type === "input")!.props.onChange({ target: { files: [{ name: "one" }], value: "" } });
    upload.resolve({ id: "f1", name: "one" });
    await tick();
    await attaching;
    channelId = "w4-b";
    expect(field(m.render(), "Message").props.value).toBe("");
    expect(field(m.tree, "Remove one")).toBeUndefined();
    channelId = "w4-a";
    threadId = "thread";
    expect(field(m.render(), "Message").props.value).toBe("");
    field(m.tree, "Message").props.onChange({ target: { value: "reply", selectionStart: 5 } });
    threadId = undefined;
    expect(field(m.render(), "Message").props.value).toBe("first");
    expect(field(m.tree, "Remove one")).toBeDefined();
    const sent = deferred();
    vi.mocked(api).mockReturnValueOnce(sent.promise);
    const sending = field(m.tree, "Send").props.onClick();
    field(m.render(), "Message").props.onChange({ target: { value: "newer", selectionStart: 5 } });
    channelId = "w4-b";
    m.render();
    sent.reject(new Error("send failed"));
    await sending;
    expect(field(m.render(), "Message").props.value).toBe("");
    channelId = "w4-a";
    expect(field(m.render(), "Message").props.value).toBe("first\nnewer");
    expect(field(m.tree, "Remove one")).toBeDefined();
    m.dispose();
    const again = mount(() => Composer({ channelId, placeholder: "Message" }));
    expect(field(again.tree, "Message").props.value).toBe("first\nnewer");
  });

  it("W23: blocks sends during concurrent uploads and admits at most 20 files", async () => {
    const m = mount(() => Composer({ channelId: "w23", placeholder: "Message" }));
    field(m.tree, "Message").props.onChange({ target: { value: "hello", selectionStart: 5 } });
    const up = deferred();
    vi.mocked(uploadFile).mockReturnValueOnce(up.promise).mockImplementation(async (f) => ({ id: f.name, name: f.name } as any));
    const drop = (files: any[]) => find(m.render(), (el) => !!el.props.onDrop)!.props.onDrop({ preventDefault() {}, dataTransfer: { files } });
    const first = drop([{ name: "one" }]);
    expect(field(m.render(), "Send").props.disabled).toBe(true);
    await field(m.tree, "Send").props.onClick();
    expect(api).not.toHaveBeenCalled();
    const more = drop(Array.from({ length: 21 }, (_, i) => ({ name: `f${i}` })));
    await more;
    expect(uploadFile).toHaveBeenCalledTimes(20);
    expect(find(m.render(), (el) => el.props.children === "Attach up to 20 files per message.")).toBeDefined();
    up.resolve({ id: "one", name: "one" });
    await first;
    expect(field(m.render(), "Send").props.disabled).toBe(false);
    vi.mocked(api).mockResolvedValueOnce({});
    await field(m.tree, "Send").props.onClick();
    expect(vi.mocked(api).mock.calls.at(-1)?.[2]).toMatchObject({ fileIds: expect.any(Array) });
    expect((vi.mocked(api).mock.calls.at(-1)?.[2] as any).fileIds).toHaveLength(20);
  });
});

describe("settings regressions", () => {
  it("W9: follows incoming fields unless they differ from the previous saved snapshot", () => {
    const previous = { instructions: "old", role: "Engineer", notes: "old notes" };
    const saved = { instructions: "remote", role: "Researcher", notes: "remote notes" };
    expect(mergeSavedFields(previous, previous, saved)).toEqual(saved);
    expect(mergeSavedFields({ ...previous, role: "My edit" }, previous, saved)).toEqual({ ...saved, role: "My edit" });
    expect(mergeSavedFields({ model: "old", effort: "high", fast: false }, { model: "old", effort: "low", fast: false }, { model: "new", effort: "medium", fast: true })).toEqual({ model: "new", effort: "high", fast: true });
  });

  it("W9: keeps untouched editors clean on remote saves and preserves an edited field", () => {
    let current = { ...agent, instructions: "old", settings: { role: "Engineer", roleNotes: "old notes" } };
    const detail = mount(() => AgentDetail({ agent: current, nodes: [], tab: "instructions" }));
    const panel = named(detail.tree, "InstructionsPanel");
    const dirty = vi.fn();
    const m = mount(() => panel.type({ ...panel.props, agent: current, onDirty: dirty }));
    current = { ...current, instructions: "remote", settings: { role: "Researcher", roleNotes: "remote notes" } };
    m.render();
    expect(field(m.tree, "Instructions").props.value).toBe("remote");
    expect(field(m.tree, "Role").props.value).toBe("Researcher");
    expect(dirty).toHaveBeenLastCalledWith(false);
    field(m.tree, "Role").props.onChange({ target: { value: "My edit" } });
    m.render();
    current = { ...current, instructions: "new remote", settings: { role: "Designer", roleNotes: "new notes" } };
    m.render();
    expect(field(m.tree, "Instructions").props.value).toBe("new remote");
    expect(field(m.tree, "Role").props.value).toBe("My edit");
    expect(field(m.tree, "What the role covers").props.value).toBe("new notes");
    expect(dirty).toHaveBeenLastCalledWith(true);
  });

  it("W3: guards navigation and unload while any panel is dirty, and cleans up", () => {
    const m = mount(() => AgentDetail({ agent, nodes: [], tab: "instructions" }));
    named(m.tree, "InstructionsPanel").props.onDirty(true);
    m.render();
    expect(mayLeave()).toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("unsaved changes"));
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    const clickLink = (hash: string) => {
      const click = new Event("click", { cancelable: true });
      Object.defineProperties(click, { button: { value: 0 }, target: { value: { closest: () => ({ href: `http://localhost/${hash}`, hasAttribute: () => false }) } } });
      document.dispatchEvent(click);
      return click;
    };
    expect(clickLink("#/agents/a/model").defaultPrevented).toBe(false);
    expect(clickLink("#/agents/other").defaultPrevented).toBe(true);
    named(m.tree, "InstructionsPanel").props.onDirty(false);
    m.render();
    expect(mayLeave()).toBe(true);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
  });

  it("W10: retains a failed background scope draft and clears it after success", async () => {
    vi.mocked(api).mockImplementation(async (method, path) => {
      if (method === "GET" && path.endsWith("/background")) return { background: { enabled: true, focus: "saved", everyMinutes: 60 }, followups: [], sources: [], usage: {} };
      return { agents: [], models: [] };
    });
    const m = mount(() => BackgroundPanel({ agent, active: true }));
    await tick();
    const choice = () => find(m.render(), (el) => el.type.name === "Choice" && el.props.label === "saved")!;
    const close = vi.fn();
    let popup = choice().props.children(close);
    named(popup, "Textarea").props.onChange({ target: { value: "local scope" } });
    vi.mocked(api).mockRejectedValueOnce(new Error("scope failed"));
    popup = choice().props.children(close);
    named(popup, "Button").props.onClick();
    await tick();
    popup = choice().props.children(close);
    expect(named(popup, "Textarea").props.value).toBe("local scope");
    expect(close).not.toHaveBeenCalled();
    expect(find(m.tree, (el) => el.props.children === "scope failed")).toBeDefined();
    named(popup, "Button").props.onClick();
    await tick();
    popup = choice().props.children(close);
    expect(named(popup, "Textarea").props.value).toBe("saved");
    expect(close).toHaveBeenCalledOnce();
  });

  it("W13: rolls back channel preferences and unread state and reports the failure", async () => {
    const ch = { id: "ch", starred: false, notify: "default", unread: 3 } as any;
    useStore.setState({ channels: [ch] });
    const request = deferred();
    vi.mocked(api).mockReturnValueOnce(request.promise);
    const saving = setChannelPrefs(ch, { starred: true, notify: "mute" });
    expect(useStore.getState().channels[0]).toMatchObject({ starred: true, notify: "mute", unread: 0 });
    request.reject(new Error("prefs failed"));
    await saving;
    expect(useStore.getState().channels[0]).toEqual(ch);
    expect(alert).toHaveBeenCalledWith("prefs failed");
  });

  it("W13: leaves the saved approval policy selected after a failed save", async () => {
    const policy = { askBefore: ["send"], maxHops: 5, defaultAccess: "edit" };
    vi.mocked(api).mockResolvedValueOnce(policy);
    const m = mount(AgentsPolicyPage);
    await tick();
    const checked = () => find(m.render(), (el) => el.type.name === "Toggle" && el.props.label === "Sending email or messages outside Wisp")!;
    expect(checked().props.on).toBe(true);
    vi.mocked(api).mockRejectedValueOnce(new Error("policy failed"));
    await checked().props.onChange(false);
    expect(checked().props.on).toBe(true);
    expect(find(m.tree, (el) => el.props.children === "policy failed")).toBeDefined();
  });
});

describe("creation regressions", () => {
  it("W14: lets the hub choose VM resources", async () => {
    vi.mocked(api).mockResolvedValueOnce(computer);
    expect(await resolveComputer({ kind: "vm" }, "node", "Agent")).toBe("desk");
    expect(api).toHaveBeenCalledWith("POST", "/api/computers", { kind: "vm", nodeId: "node", name: "Agent's desk" });
  });

  it("W15: resolves each placement and skips completed imports on retry", async () => {
    const nodes = [device("node"), device("headless", "headless")].map((n, i) => ({ ...n, discovered: [{ key: `key${i}`, name: `Agent ${i}`, harness: "claude-code" }] } as NodeInfo));
    let fail = true;
    vi.mocked(api).mockImplementation(async (method, path, body: any) => {
      if (method === "POST" && path === "/api/computers") return computer;
      if (method === "GET" && path === "/api/computers") return [computer];
      if (path === "/api/agents/import") {
        if (body.nodeId === "headless" && fail) throw new Error("import failed");
        return { ...agent, id: body.nodeId, name: body.key, handle: body.handle };
      }
      return {};
    });
    const close = vi.fn();
    const m = mount(() => ImportAgent({ nodes, onClose: close, onInvite() {} }));
    const bringAll = () => find(m.render(), (el) => el.type.name === "Button" && el.props.onClick?.name === "bringAll")!;
    await bringAll().props.onClick();
    const imports = () => vi.mocked(api).mock.calls.filter((c) => c[1] === "/api/agents/import");
    expect(imports()[0][2]).toMatchObject({ computerId: "desk", runIn: "computer", headless: false });
    expect(imports()[1][2]).toMatchObject({ computerId: null, headless: true });
    expect(close).not.toHaveBeenCalled();
    fail = false;
    await bringAll().props.onClick();
    expect(imports().filter((c) => (c[2] as any).nodeId === "node")).toHaveLength(1);
    expect(imports().filter((c) => (c[2] as any).nodeId === "headless")).toHaveLength(2);
    expect(close).toHaveBeenCalledOnce();
  });

  it("W16: reuses a VM when creating the agent fails, including its runtime placement", async () => {
    let fail = true;
    vi.mocked(api).mockImplementation(async (method, path) => {
      if (path === "/api/settings/agent-defaults") throw new Error("no defaults");
      if (method === "POST" && path === "/api/computers") return computer;
      if (method === "POST" && path === "/api/agents") {
        if (fail) throw new Error("create failed");
        return agent;
      }
      return [];
    });
    const m = mount(() => CreateAgent({ nodes: [device("node")], onClose() {} }));
    await tick();
    field(m.render(), "Name").props.onChange({ target: { value: "Agent" } });
    const submit = () => find(m.render(), (el) => el.type === "form")!.props.onSubmit({ preventDefault() {} });
    submit();
    await tick();
    fail = false;
    submit();
    await tick();
    expect(vi.mocked(api).mock.calls.filter((c) => c[0] === "POST" && c[1] === "/api/computers")).toHaveLength(1);
    const creates = vi.mocked(api).mock.calls.filter((c) => c[0] === "POST" && c[1] === "/api/agents");
    expect(creates).toHaveLength(2);
    for (const call of creates) expect(call[2]).toMatchObject({ computerId: "desk", settings: { runIn: "computer" } });
  });
});

describe("new agent sheet", () => {
  const nova = { ...agent, id: "nova", name: "Nova", handle: "nova" };
  const hub = (extra: (method: string, path: string, body: any) => any = () => undefined) =>
    vi.mocked(api).mockImplementation(async (method, path, body) => {
      const special = extra(method, path, body);
      if (special !== undefined) return special;
      if (path === "/api/settings/agent-defaults") return { harness: "codex", model: null, computer: "shared", nodeId: null };
      if (method === "POST" && path === "/api/agents") return { ...agent, id: "new" };
      return [];
    });
  const creates = () => vi.mocked(api).mock.calls.filter((c) => c[0] === "POST" && c[1] === "/api/agents");
  const submit = (m: Mounted) => find(m.render(), (el) => el.type === "form")!.props.onSubmit({ preventDefault() {} });
  const createButton = (m: Mounted) => find(m.render(), (el) => el.type.name === "Button" && el.props.type === "submit")!;
  const textButton = (m: Mounted, text: string) => find(m.render(), (el) => el.type === "button" && el.props.children === text)!;
  const alertLine = (m: Mounted) => find(m.render(), (el) => el.props.role === "alert")?.props.children;

  it("suggests a name nobody has, and numbers one once they are all used", () => {
    expect(suggestName([], () => 0)).toBe(AGENT_NAMES[0]);
    expect(suggestName([], () => 0.9999)).toBe(AGENT_NAMES.at(-1));
    expect(suggestName([{ name: "Other", handle: AGENT_NAMES[0].toLowerCase() }], () => 0)).toBe(AGENT_NAMES[1]);
    // a renamed agent still counts by its name
    expect(suggestName([{ name: AGENT_NAMES[0], handle: "helper" }], () => 0)).toBe(AGENT_NAMES[1]);
    const all = AGENT_NAMES.map((name) => ({ name, handle: name.toLowerCase() }));
    expect(suggestName(all, () => 0)).toBe(`${AGENT_NAMES[0]} 2`);
  });

  it("picks a free handle from the name, and says in one line what is wrong", () => {
    expect(autoHandle("Nova", [])).toBe("nova");
    expect(autoHandle("Nova", ["nova", "nova-2"])).toBe("nova-3");
    expect(autoHandle("Build & Ship", [])).toBe("build-ship");
    expect(autoHandle("123", ["agent"])).toBe("agent-2");
    expect(autoHandle("a".repeat(40), ["a".repeat(32)])).toMatch(/^a{28}-2$/);
    expect(nameProblem("", "", [nova])).toBeNull();
    expect(nameProblem("Juno", "", [nova])).toBeNull();
    expect(nameProblem(" nova ", "", [nova])).toBe("nova is already here.");
    expect(nameProblem("Juno", "nova", [nova])).toBe("@nova is taken.");
    // a handle typed by hand settles it, even for a name another agent has
    expect(nameProblem("Nova", "nova-two", [nova])).toBeNull();
  });

  it("opens with only a ghost, a suggested name and Create, and makes it on your defaults", async () => {
    useStore.setState({ agents: [nova] });
    hub();
    const close = vi.fn();
    const m = mount(() => CreateAgent({ nodes: [device("node")], onClose: close }));
    await tick();
    const suggested = field(m.render(), "Name").props.value as string;
    expect(AGENT_NAMES).toContain(suggested);
    expect(suggested).not.toBe("Nova");
    expect(find(m.tree, (el) => el.props.children === "It says hello and sets itself up in the chat.")).toBeDefined();
    // everything else stays folded until More options
    for (const label of ["Handle", "What it does", "Instructions", "AI and computer"]) expect(field(m.tree, label)).toBeUndefined();
    expect(createButton(m).props.disabled).toBe(false);
    submit(m);
    await tick();
    expect(creates()).toHaveLength(1);
    const body = creates()[0][2] as any;
    expect(body).toMatchObject({ name: suggested, handle: suggested.toLowerCase(), instructions: "", useDefaults: true, settings: { appearance: named(m.tree, "Ghost").props.look } });
    expect(body).not.toHaveProperty("harness");
    expect(body).not.toHaveProperty("computerId");
    // then straight to its chat, where it says hello
    expect(close).toHaveBeenCalledOnce();
    expect(openDm).toHaveBeenCalledWith("new");
  });

  it("gives the ghost another look on a click", async () => {
    hub();
    const random = vi.spyOn(Math, "random").mockReturnValue(0.05);
    const m = mount(() => CreateAgent({ nodes: [], onClose() {} }));
    await tick();
    const before = named(m.render(), "Ghost").props.look;
    random.mockReturnValue(0.95);
    field(m.tree, "Change its look").props.onClick();
    const after = named(m.render(), "Ghost").props.look;
    expect(after.hat).not.toBe(before.hat);
    submit(m);
    await tick();
    expect(creates()[0][2]).toMatchObject({ settings: { appearance: after } });
  });

  it("silently takes a free handle when the name's own is in use, and stops a name another agent has", async () => {
    useStore.setState({ agents: [{ ...nova, name: "Research" }] });
    hub();
    const m = mount(() => CreateAgent({ nodes: [], onClose() {} }));
    await tick();
    field(m.render(), "Name").props.onChange({ target: { value: "research" } });
    expect(alertLine(m)).toBe("research is already here.");
    expect(createButton(m).props.disabled).toBe(true);
    submit(m);
    await tick();
    expect(creates()).toHaveLength(0);
    field(m.render(), "Name").props.onChange({ target: { value: "Nova" } });
    expect(alertLine(m)).toBeUndefined();
    submit(m);
    await tick();
    expect(creates()[0][2]).toMatchObject({ name: "Nova", handle: "nova-2" });
  });

  it("shows a failed create as one line under the name and lets it be tried again", async () => {
    let fail = true;
    hub((method, path) => {
      if (method === "POST" && path === "/api/agents" && fail) throw new Error("handle taken");
    });
    const close = vi.fn();
    const m = mount(() => CreateAgent({ nodes: [], onClose: close }));
    await tick();
    submit(m);
    await tick();
    expect(alertLine(m)).toBe("handle taken");
    expect(close).not.toHaveBeenCalled();
    fail = false;
    submit(m);
    await tick();
    expect(close).toHaveBeenCalledOnce();
  });

  it("More options unfolds the old fields, checks a typed handle, and sends what was filled in", async () => {
    useStore.setState({ agents: [nova] });
    hub((method, path) => {
      if (path === "/api/connectors") return [{ id: "mail", name: "Mail", allAgents: false }];
      if (path === "/api/skills") return [{ id: "sk", name: "Charts", description: "", allAgents: false }];
    });
    const m = mount(() => CreateAgent({ nodes: [device("node")], onClose() {} }));
    await tick();
    const more = textButton(m, "More options");
    expect(more.props["aria-expanded"]).toBe(false);
    more.props.onClick();
    // unfolding asks for the apps and skills to offer
    m.render();
    await tick();
    expect(textButton(m, "Fewer options").props["aria-expanded"]).toBe(true);
    for (const text of ["Edit look", "Bring one in"]) expect(textButton(m, text)).toBeDefined();
    expect(find(m.tree, (el) => el.props.role === "radiogroup" && el.props["aria-label"] === "AI and computer")).toBeDefined();
    // handle rules: tidied as typed, and one line under it when another agent has it
    field(m.tree, "Handle").props.onChange({ target: { value: "9 Nova!" } });
    expect(field(m.render(), "Handle").props.value).toBe("nova-");
    expect(alertLine(m)).toBe("@nova is taken.");
    expect(createButton(m).props.disabled).toBe(true);
    field(m.tree, "Handle").props.onChange({ target: { value: "scout" } });
    expect(alertLine(m)).toBeUndefined();
    field(m.render(), "Name").props.onChange({ target: { value: "Scout" } });
    field(m.render(), "What it does").props.onChange({ target: { value: "Finds things" } });
    field(m.render(), "Instructions").props.onChange({ target: { value: "Look twice." } });
    find(m.render(), (el) => el.type.name === "Chip" && el.props.children === "Mail")!.props.onClick();
    find(m.render(), (el) => el.type.name === "Chip" && el.props.children === "Charts")!.props.onClick();
    // Customize: pick the AI here (these tests run in Advanced, so where it works is picked too)
    find(m.render(), (el) => el.props.role === "radio" && el.props.children === "Customize")!.props.onClick();
    find(m.render(), (el) => el.type === "select" && el.props.value === "codex")!.props.onChange({ target: { value: "claude-code" } });
    named(m.render(), "ComputerPicker").props.onChange({ kind: "headless" });
    submit(m);
    await tick();
    expect(creates()[0][2]).toMatchObject({ name: "Scout", handle: "scout", instructions: "Look twice.", harness: "claude-code", nodeId: "node", computerId: null, settings: { role: "Finds things", headless: true } });
    expect(creates()[0][2]).not.toHaveProperty("useDefaults");
    expect(api).toHaveBeenCalledWith("PUT", "/api/connectors/mail/agents/new");
    expect(api).toHaveBeenCalledWith("PUT", "/api/skills/sk/agents/new");
  });

  it("keeps the ways to bring an agent in: invite by token, or find one on a device", async () => {
    hub((method, path) => {
      if (method === "POST" && path === "/api/agents/new/token") return { token: "tok" };
    });
    const m = mount(() => CreateAgent({ nodes: [device("node")], onClose() {} }));
    await tick();
    textButton(m, "More options").props.onClick();
    textButton(m, "Bring one in").props.onClick();
    const choice = (text: string) => find(m.render(), (el) => el.type === "button" && !!find(el.props.children, (c) => c.props.children === text))!;
    choice("Find on a device").props.onClick();
    expect(named(m.render(), "ImportAgent")).toBeDefined();
    // "Invite instead" from there lands on the invitation form, with the harness picker open
    named(m.tree, "ImportAgent").props.onInvite();
    expect(named(m.render(), "HarnessGrid")).toBeDefined();
    expect(find(m.tree, (el) => el.props.children === "It joins with an invitation.")).toBeDefined();
    submit(m);
    await tick();
    expect(creates()[0][2]).toMatchObject({ nodeId: null, computerId: null });
    expect(named(m.render(), "ConnectionInstructions").props).toMatchObject({ token: "tok" });
    // opened straight at "Bring one in" (the Agents page's Bring in)
    const direct = mount(() => CreateAgent({ nodes: [], onClose() {}, bringIn: true }));
    expect(find(direct.tree, (el) => el.props.children === "Invite an agent")).toBeDefined();
  });

  it("Make it a team opens the new-team flow, except inside a team being built", async () => {
    hub();
    const close = vi.fn();
    const m = mount(() => CreateAgent({ nodes: [], onClose: close }));
    await tick();
    textButton(m, "Make it a team").props.onClick();
    expect(close).toHaveBeenCalledOnce();
    expect(useStore.getState().channelBrowser).toEqual({ sectionId: null, create: true });
    const inTeam = mount(() => CreateAgent({ nodes: [], onClose() {}, onCreated() {} }));
    expect(textButton(inTeam, "Make it a team")).toBeUndefined();
  });
});

describe("screen regressions", () => {
  it("W18: removes a previously loaded thumbnail when refreshing fails", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, blob: async () => new Blob() }).mockRejectedValueOnce(new Error("offline")));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:screen");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const m = mount(() => ScreenThumb({ computer, refreshMs: 1000 }));
    await tick();
    expect(find(m.render(), (el) => el.type === "img")?.props.src).toBe("blob:screen");
    await vi.advanceTimersByTimeAsync(1000);
    expect(find(m.render(), (el) => el.type === "img")).toBeUndefined();
    expect(find(m.tree, (el) => el.props.children === "Screen unavailable")).toBeDefined();
    expect(revoke).toHaveBeenCalledWith("blob:screen");
  });

  it("W19: exposes reconnect when the noVNC constructor fails", async () => {
    vi.mocked(api).mockResolvedValue({ transport: "vnc", url: "/vnc", direct: false });
    novnc.construct.mockImplementation(() => { throw new Error("client failed"); });
    const m = mount(() => (LiveScreen as any).render({ computer, control: false }, null));
    // Attach the holder before the dynamic import resumes, as React does at commit.
    find(m.tree, (el) => el.props.ref && el.type === "div" && el.props.className === "absolute inset-0")!.props.ref.current = new EventTarget();
    await vi.waitFor(() => expect(novnc.construct).toHaveBeenCalledOnce());
    await tick();
    expect(find(m.render(), (el) => el.props.children === "client failed")).toBeDefined();
    const reconnect = find(m.tree, (el) => el.type === "button")!;
    expect(reconnect).toBeDefined();
    reconnect.props.onClick();
    m.render();
    await tick();
    expect(api).toHaveBeenCalledTimes(2);
  });
});
