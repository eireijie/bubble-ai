import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { Approval } from "@wisp/core";
import { api } from "../api.ts";
import { useStore } from "../store.ts";
import { AppleApprovalCard } from "./AppleParts.tsx";

const state = vi.hoisted(() => ({ role: "owner" }));
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), useState: vi.fn(), useEffect: vi.fn(), useLayoutEffect: vi.fn() }));
vi.mock("../api.ts", () => ({ api: vi.fn(), getToken: () => "t", observeEvents: vi.fn() }));
vi.mock("../theme.ts", () => ({ motionReduced: () => false }));
vi.mock("../store.ts", () => ({
  usePrefs: () => ({ clock: "24h" }),
  useStore: Object.assign((select: (s: unknown) => unknown) => select({ me: { role: state.role, user: { id: "u1" } }, members: [{ id: "u2", name: "Alex" }] }), { setState: vi.fn() }),
}));

const send = (over: Partial<Approval> = {}): Approval => ({
  id: "ap1",
  workspaceId: "w",
  agentId: "a1",
  channelId: "c1",
  threadId: null,
  summary: "Send a text to Sam",
  details: "",
  status: "pending",
  decidedBy: null,
  note: "",
  createdAt: "2026-11-14T18:50:00.000Z",
  decidedAt: null,
  apple: {
    app: "messages",
    op: { op: "messages_send", to: "+15550142290", text: "Running 10 minutes late" },
    title: "Send a text",
    aside: "iMessage",
    fields: [{ label: "To", value: "Sam Rivera · (555) 014-2290" }],
    bubble: "Running 10 minutes late",
    yes: "Send",
    no: "Don't send",
    requestedBy: null,
  },
  ...over,
});
const move: Approval["apple"] = {
  app: "calendar",
  op: { op: "calendar_move", id: "e1", start: "2026-11-20T10:30:00Z", end: "2026-11-20T11:00:00Z" },
  title: "Move an event",
  aside: "Work calendar",
  fields: [
    { label: "Event", value: "Team call" },
    { label: "From", value: "Thu 10:00–10:30 AM", was: true },
    { label: "To", value: "Thu 10:30–11:00 AM" },
  ],
  yes: "Move it",
  no: "Leave it",
  requestedBy: null,
};

let states: any[];
function render(a: Approval) {
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
  return AppleApprovalCard({ approval: a });
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (!node || typeof node !== "object") return undefined;
  if (predicate(node)) return node;
  return [node.props?.children]
    .flat(Infinity)
    .map((child) => find(child, predicate))
    .find(Boolean);
}
const text = (node: any): string => (typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : "");
const button = (tree: any, label: string) => find(tree, (n) => n.type === "button" && text(n) === label);

beforeEach(() => {
  states = [];
  state.role = "owner";
  vi.mocked(api).mockReset();
  vi.mocked(useStore.setState).mockReset();
});

describe("Apple approval card", () => {
  it("shows the title, aside, To line, the bubble and Send / Edit / Don't send", () => {
    const tree = render(send());
    expect(tree.props["aria-label"]).toBe("Send a text");
    expect(text(tree)).toContain("iMessage");
    expect(text(tree)).toContain("Sam Rivera · (555) 014-2290");
    expect(find(tree, (n) => typeof n.props?.className === "string" && n.props.className.includes("bubble me"))?.props.children).toBe("Running 10 minutes late");
    expect(button(tree, "Send")).toBeTruthy();
    expect(button(tree, "Edit")).toBeTruthy();
    expect(button(tree, "Don't send")).toBeTruthy();
  });

  it("edits the text inline, then approves with the edited text", async () => {
    vi.mocked(api).mockResolvedValue(send({ status: "approved", decidedBy: "u1", decidedAt: "2026-11-14T18:52:00.000Z" }));
    button(render(send()), "Edit").props.onClick();
    let tree = render(send());
    const box = find(tree, (n) => n.type === "textarea");
    expect(box.props.value).toBe("Running 10 minutes late");
    expect(button(tree, "Cancel")).toBeTruthy();
    box.props.onChange({ target: { value: "Running 15 minutes late" } });
    tree = render(send());
    await button(tree, "Send").props.onClick();
    expect(api).toHaveBeenCalledWith("POST", "/api/approvals/ap1/decide", { approve: true, text: "Running 15 minutes late" });
    expect(useStore.setState).toHaveBeenCalled();
  });

  it("approves without text when it wasn't edited, and won't send an empty edit", async () => {
    vi.mocked(api).mockResolvedValue(send());
    await button(render(send()), "Send").props.onClick();
    expect(api).toHaveBeenLastCalledWith("POST", "/api/approvals/ap1/decide", { approve: true });
    button(render(send()), "Edit").props.onClick();
    find(render(send()), (n) => n.type === "textarea").props.onChange({ target: { value: "   " } });
    expect(button(render(send()), "Send").props.disabled).toBe(true);
  });

  it("says no without the edited text", async () => {
    vi.mocked(api).mockResolvedValue(send({ status: "denied" }));
    button(render(send()), "Edit").props.onClick();
    find(render(send()), (n) => n.type === "textarea").props.onChange({ target: { value: "changed" } });
    await button(render(send()), "Don't send").props.onClick();
    expect(api).toHaveBeenCalledWith("POST", "/api/approvals/ap1/decide", { approve: false });
  });

  it("shows Sent with the time, or Not sent, once decided", () => {
    expect(text(render(send({ status: "approved", decidedBy: "u1", decidedAt: "2026-11-14T18:52:00.000Z" })))).toMatch(/Sent at \d/);
    expect(text(render(send({ status: "denied", decidedBy: "u2", decidedAt: "2026-11-14T18:52:00.000Z" })))).toContain("Not sent by Alex");
    expect(button(render(send({ status: "approved" })), "Send")).toBeUndefined();
  });

  it("lays out a change as rows, strikes through what it was, and has no Edit", () => {
    const tree = render(send({ apple: move }));
    expect(find(tree, (n) => n.type === "dd" && n.props.children === "Thu 10:00–10:30 AM")?.props.className).toContain("line-through");
    expect(find(tree, (n) => n.type === "dd" && n.props.children === "Thu 10:30–11:00 AM")?.props.className).not.toContain("line-through");
    expect(button(tree, "Move it")).toBeTruthy();
    expect(button(tree, "Leave it")).toBeTruthy();
    expect(button(tree, "Edit")).toBeUndefined();
    expect(text(render(send({ apple: move, status: "denied" })))).toContain("Left as is");
  });

  it("only owners answer", () => {
    state.role = "member";
    const tree = render(send());
    expect(button(tree, "Send")).toBeUndefined();
    expect(text(tree)).toContain("Waiting for an owner to answer.");
  });
});
