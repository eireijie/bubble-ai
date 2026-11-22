import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Approval, Followup, TeamStep } from "@wisp/core";

vi.mock("../src/api.ts", () => ({ api: vi.fn(() => new Promise(() => {})), uploadFile: vi.fn() }));
vi.mock("../src/theme.ts", () => ({ motionReduced: () => false, useMotionReduced: () => false }));
import { useStore, type ComputerInfo, type Me } from "../src/store.ts";
import type { DeviceInfo } from "../src/devices.ts";
import { DashboardView, agentNeed, approvalLine, helpLine } from "../src/views/DashboardView.tsx";
import { stoppedLine } from "../src/components/InboxParts.tsx";
import { dueReminders, laterReminders } from "../src/components/Loops.tsx";

const dev = (o: Partial<DeviceInfo> = {}): DeviceInfo => ({ id: "n1", name: "my-mac", online: true, agents: [], harnesses: [{ id: "claude-code", version: "1" }], ...o });
const ada = (o: Record<string, unknown> = {}) => ({ id: "a1", name: "Ada", nodeId: "n1", harness: "claude-code", ...o }) as Parameters<typeof agentNeed>[0];

describe("an agent that can't work yet", () => {
  it("is not an item when it is ready", () => {
    expect(agentNeed(ada(), [dev()])).toBeNull();
    // devices still loading: never a claim the hub can't back up
    expect(agentNeed(ada(), null)).toBeNull();
  });

  it("says what it needs in one sentence, with the one button that does it", () => {
    expect(agentNeed(ada({ nodeId: null }), [dev()])).toEqual({ text: "Ada needs a computer to work on.", action: "Choose one", href: "#/agents/a1/device" });
    expect(agentNeed(ada(), [dev({ online: false })])).toEqual({ text: "Ada is waiting for my-mac to reconnect.", action: "See computers", href: "#/computers" });
    expect(agentNeed(ada(), [dev({ paused: true })])).toEqual({ text: "Ada is waiting for my-mac to be resumed.", action: "See computers", href: "#/computers" });
    expect(agentNeed(ada(), [dev({ harnesses: [{ id: "claude-code", version: "1", accounts: { default: false } }] })])).toMatchObject({ text: "Ada needs you to sign in to Claude Code.", action: "Sign in" });
    expect(agentNeed(ada({ harness: "acp:foo" }), [dev({ harnesses: [{ id: "codex", version: null }] })])).toMatchObject({ text: "Ada needs foo installed on my-mac.", action: "Install it", href: "#/settings/harnesses" });
  });

  it("keeps every button to one or two words", () => {
    const needs = [agentNeed(ada({ nodeId: null }), []), agentNeed(ada(), [dev({ online: false })]), agentNeed(ada({ harness: "acp:foo" }), [dev({ harnesses: [{ id: "codex", version: null }] })])];
    for (const n of needs) expect(n!.action.split(" ").length).toBeLessThanOrEqual(2);
  });
});

describe("the one sentence of an item", () => {
  it("is what the agent asked, without Markdown", () => {
    expect(approvalLine({ summary: "Move the **dentist** to Thursday at 3?" }, "Juno")).toBe("Move the dentist to Thursday at 3?");
    expect(approvalLine({ summary: "" }, "Juno")).toBe("Juno wants your OK.");
    expect(approvalLine({ summary: "Use your Zendesk login", login: { title: "Zendesk" } as Approval["login"] }, "Juno")).toBe("Juno wants to use your Zendesk login.");
  });

  it("is the agent's request on a computer, else that it needs you there", () => {
    const help = (request: string) => ({ name: "This Mac", help: { agentId: "a1", request, channelId: "c", threadId: null, at: "now" } });
    expect(helpLine(help("Type the code from your phone"), "Atlas")).toBe("Type the code from your phone");
    expect(helpLine(help(""), "Atlas")).toBe("Atlas needs you on This Mac.");
  });

  it("counts a team's steps the way the team does: a schedule is not a step", () => {
    const step = (id: string, extra: Partial<TeamStep> = {}): TeamStep => ({ id, roleId: "", kind: "do", action: id, agentId: "a1", next: null, x: 0, y: 0, ...extra });
    const steps = [step("every-morning", { kind: "schedule", next: "plan" }), step("plan", { next: "build" }), step("build")];
    expect(stoppedLine(steps, "build")).toBe("Stopped at step 2.");
    expect(stoppedLine(steps, "plan")).toBe("Stopped at step 1.");
    expect(stoppedLine(steps, "gone")).toBe("Stopped.");
  });
});

describe("reminders on Needs you", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  const reminder = (id: string, dueAt: string, o: Partial<Followup> = {}): Followup => ({ id, agentId: "a1", userId: "me", dueAt, note: "", status: "pending", createdAt: at(-600), label: "Send the deck", waitingOn: "person", condition: "", kind: "followup", channelId: "c", messageId: "m", ...o });

  it("lists one that came due and nobody brought, not one its agent is about to bring", () => {
    const list = [reminder("old", at(-30)), reminder("fresh", at(-1)), reminder("ahead", at(60))];
    expect(dueReminders(list, "me", now).map((f) => f.id)).toEqual(["old"]);
  });

  it("leaves out other people's, the agent's private check-backs and ones already settled", () => {
    const list = [reminder("theirs", at(-30), { userId: "sam" }), reminder("private", at(-30), { label: null }), reminder("checkback", at(-30), { kind: "checkback" }), reminder("done", at(-30), { status: "done" }), reminder("anyone", at(-30), { userId: null })];
    expect(dueReminders(list, "me", now).map((f) => f.id)).toEqual(["anyone"]);
  });

  it("keeps what the person put off under Later until it comes round", () => {
    const list = [reminder("tomorrow", at(900)), reminder("tonight", at(300)), reminder("never-moved", at(300)), reminder("came-round", at(-30))];
    expect(laterReminders(list, "me", ["tomorrow", "tonight", "came-round"], now).map((f) => f.id)).toEqual(["tonight", "tomorrow"]);
  });
});

describe("the Needs you page", () => {
  const initial = useStore.getInitialState();
  const saved = { me: initial.me, agents: initial.agents, approvals: initial.approvals, computers: initial.computers, channels: initial.channels };
  afterEach(() => Object.assign(initial, saved));

  const me = { kind: "user", role: "owner", user: { id: "u1", name: "Sam", email: "sam@example.com", createdAt: "now" }, workspace: { id: "w", name: "Home" }, prefs: { sendWith: "enter", clock: "auto", toolCalls: "collapsed", experience: "advanced" } } as unknown as Me;
  const agent = (id: string, name: string, o: object = {}) => ({ id, handle: name.toLowerCase(), name, harness: "custom", model: null, nodeId: null, computerId: null, settings: {}, status: "online", createdAt: "2026-01-01T00:00:00Z", workspaceId: "w", ...o }) as never;
  const approval = (o: Partial<Approval>): Approval => ({ id: "ap1", workspaceId: "w", agentId: "a1", channelId: "dm1", threadId: null, summary: "Move the dentist to Thursday at 3?", details: "", status: "pending", decidedBy: null, note: "", createdAt: new Date().toISOString(), decidedAt: null, ...o });
  const render = (onBack?: () => void) => renderToStaticMarkup(createElement(DashboardView, { onBack }));

  it("lists only what waits, one row each with its own buttons", () => {
    Object.assign(initial, {
      me,
      // Atlas has no computer yet (a harness that needs one); Juno joins from outside and needs none
      agents: [agent("a1", "Juno"), agent("a2", "Atlas", { harness: "codex" })],
      approvals: { ap1: approval({}), ap2: approval({ id: "ap2", summary: "Send the invoice", details: "To: Sam", status: "approved", decidedBy: "u1", decidedAt: new Date().toISOString() }) },
      computers: [{ id: "pc1", name: "This Mac", help: { agentId: "a1", request: "Type the code from your phone", channelId: "dm1", threadId: null, at: new Date().toISOString() } } as unknown as ComputerInfo],
    });
    const html = render();
    expect(html).toContain(">Needs you</h1>");
    expect(html).toContain('href="#/c/dm1"');
    expect(html).toContain("Move the dentist to Thursday at 3?");
    for (const button of [">Allow<", ">Not now<", ">Take over<", ">Choose one<"]) expect(html).toContain(button);
    expect(html).toContain("Atlas needs a computer to work on.");
    // what was answered sits behind Earlier, closed
    expect(html).toContain(">Earlier<");
    expect(html).not.toContain("Send the invoice");
    // the note field, the tabs and the lists the sidebar already shows are gone
    for (const gone of ["Add a note", "role=\"tab\"", "New replies", "Working now", "Recent conversations", "isn&#x27;t ready yet", "every agent", "Open chat", "Approve"]) expect(html).not.toContain(gone);
    expect(html).not.toContain("Nothing needs you.");
  });

  it("offers Details only when a request has some", () => {
    Object.assign(initial, { me, agents: [agent("a1", "Juno")], approvals: { ap1: approval({ details: "Dr. Okafor, 3:00 to 3:45" }) } });
    expect(render()).toContain(">Details<");
    Object.assign(initial, { approvals: { ap1: approval({}) } });
    expect(render()).not.toContain(">Details<");
  });

  it("says one line when nothing waits, with no button", () => {
    Object.assign(initial, { me, agents: [agent("a1", "Juno")], approvals: {}, computers: [] });
    const html = render();
    expect(html).toContain("Nothing needs you.");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("All caught up");
  });

  it("has a Back to home on phones", () => {
    Object.assign(initial, { me, agents: [], approvals: {}, computers: [] });
    expect(render(() => {})).toContain('aria-label="Back"');
    expect(render()).not.toContain('aria-label="Back"');
  });

  it("shows a guest nothing to answer", () => {
    Object.assign(initial, { me: { ...me, role: "guest" }, agents: [agent("a2", "Atlas", { harness: "codex" })], approvals: { ap1: approval({}) }, computers: [] });
    const html = render();
    expect(html).toContain("Nothing needs you.");
    expect(html).not.toContain(">Allow<");
  });
});
