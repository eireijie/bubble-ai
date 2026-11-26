import { describe, expect, it } from "vitest";
import { normalizeSteps, type ChannelTeam, type FlowLane, type TeamFlow, type TeamStep } from "@bubble-ai/core";
import { backLabel, cardSentence, changeRequest, chipActions, chipState, leadOf, runningStepIds } from "../src/team/flow.ts";

const step = (id: string, extra: Partial<TeamStep> = {}): TeamStep => ({ id, roleId: "", kind: "do", action: id, agentId: "juno", next: null, x: 0, y: 0, ...extra });
const team = (steps: TeamStep[]): ChannelTeam => ({ nodes: [], edges: [], roles: [], steps: normalizeSteps(steps) });
const lane = (stepId: string, status: FlowLane["status"], waitingFor: FlowLane["waitingFor"] = null): FlowLane => ({ stepId, status, taskId: null, carry: null, pieces: {}, waitingFor });
const flow = (status: TeamFlow["status"], lanes: FlowLane[]): TeamFlow => ({ id: "f", workspaceId: "w", channelId: "c", threadId: "t", status, request: "Ship it", requestedBy: null, stepId: lanes[0]?.stepId ?? "", taskId: null, rounds: {}, history: [], pieces: {}, waitingFor: null, lanes: Object.fromEntries(lanes.map((l) => [l.stepId, l])), createdAt: "", updatedAt: "" });

describe("a step's card says what it does in a few words", () => {
  it("turns a title that starts with a verb into what the agent does", () => {
    expect(cardSentence({ kind: "do", action: "Draft the plan" })).toBe("Drafts the plan");
  });
  it("keeps a title that is not a verb as it is", () => {
    expect(cardSentence({ kind: "do", action: "The weekly report" })).toBe("The weekly report");
  });
  it("has words for a step nobody has named yet", () => {
    expect(cardSentence({ kind: "review", action: "" })).toBe("Checks the work");
    expect(cardSentence({ kind: "hand_out", action: " " })).toBe("Splits the work");
    expect(cardSentence({ kind: "ask", action: "" })).toBe("Asks you");
  });
});

describe("an arrow back to an earlier step names who gets the work back", () => {
  it("a review goes back until it is good, up to its rounds", () => {
    expect(backLabel({ kind: "review", maxRounds: 3 }, "plan", "Juno")).toBe("Goes back to Juno until it's good, up to 3 times");
  });
  it("an ask-me step goes back when you ask for changes", () => {
    expect(backLabel({ kind: "ask" }, "plan", "Juno")).toBe("If you ask for changes, back to Juno");
  });
  it("an if/else says which answer loops", () => {
    expect(backLabel({ kind: "branch", ifTrue: "plan", maxRounds: 2 }, "plan", "Atlas")).toBe("Yes: back to Atlas, up to 2 times");
    expect(backLabel({ kind: "branch", ifTrue: "ship", maxRounds: 2 }, "plan", "Atlas")).toBe("No: back to Atlas, up to 2 times");
  });
});

describe("telling the lead how the team should work", () => {
  it("is just the words while the chart is empty", () => {
    expect(changeRequest("  One builds, one reviews ", [])).toBe("One builds, one reviews");
  });
  it("adds how the team works today, so the agent changes it instead of starting over", () => {
    const text = changeRequest("Add a tester at the end", [
      { n: 1, text: "Juno drafts the plan." },
      { n: 2, text: "Atlas checks it." },
    ]);
    expect(text.startsWith("Add a tester at the end\n")).toBe(true);
    expect(text).toContain("1. Juno drafts the plan.\n2. Atlas checks it.");
  });
  it("never goes past the length the hub takes, and keeps the person's words", () => {
    const text = changeRequest("Make it shorter", Array.from({ length: 200 }, (_, i) => ({ n: i + 1, text: "Juno does a long thing that takes many words to say." })));
    expect(text.length).toBe(2000);
    expect(text.startsWith("Make it shorter")).toBe(true);
  });
});

describe("the run strip's chips", () => {
  it("shows each step as done, on now, waiting on you, failed, skipped or to come", () => {
    expect(chipState({ status: "running" }, lane("a", "done"))).toBe("done");
    expect(chipState({ status: "running" }, lane("a", "running"))).toBe("now");
    expect(chipState({ status: "waiting" }, lane("a", "waiting", { why: "Out of rounds", options: "rounds" }))).toBe("needs");
    expect(chipState({ status: "waiting" }, lane("a", "waiting", { why: "It crashed", options: "retry", failed: true }))).toBe("failed");
    expect(chipState({ status: "running" }, lane("a", "skipped"))).toBe("skipped");
    expect(chipState({ status: "running" }, undefined)).toBe("todo");
  });
  it("counts every step as done once the request is", () => {
    expect(chipState({ status: "done" }, undefined)).toBe("done");
  });
  it("puts Try again, Skip and Stop in a failed step's menu", () => {
    expect(chipActions("failed", { why: "It crashed", options: "retry", failed: true }).map((a) => [a.label, a.action])).toEqual([
      ["Try again", "retry"],
      ["Skip", "approve"],
      ["Stop", "stop"],
    ]);
  });
  it("gives a step that waits on you its own Stop, and Try again when that is what it offers", () => {
    expect(chipActions("needs", { why: "Approve it", options: "ask" }).map((a) => a.label)).toEqual(["Stop"]);
    expect(chipActions("needs", { why: "Nobody fills the role", options: "retry" }).map((a) => a.label)).toEqual(["Try again", "Stop"]);
  });
  it("has no menu for a step that is done, to come, or working (the strip's Stop ends the request)", () => {
    expect(chipActions("done")).toEqual([]);
    expect(chipActions("todo")).toEqual([]);
    expect(chipActions("now")).toEqual([]);
  });
});

describe("the step a request is working on", () => {
  it("is every lane that is running, not the ones waiting on a person", () => {
    expect(runningStepIds(flow("running", [lane("a", "done"), lane("b", "running"), lane("c", "waiting", { why: "?", options: "ask" })]))).toEqual(["b"]);
  });
  it("is nothing once the request is over, or when there is none", () => {
    expect(runningStepIds(flow("done", [lane("a", "running")]))).toEqual([]);
    expect(runningStepIds(null)).toEqual([]);
  });
});

describe("who the field at the bottom of the builder talks to", () => {
  const agents = [{ id: "juno" }, { id: "atlas" }];
  it("is the agent that does the first step", () => {
    expect(leadOf(team([step("plan", { agentId: "atlas" }), step("build")]), agents, "juno")).toBe("atlas");
  });
  it("is the lead of a plain chart", () => {
    expect(leadOf({ nodes: [{ agentId: "atlas", lead: false, x: 0, y: 0 }, { agentId: "juno", lead: true, x: 0, y: 0 }], edges: [] }, agents)).toBe("juno");
  });
  it("falls back to the agent picked first, then to anyone, while the chart is empty", () => {
    expect(leadOf(team([]), agents, "atlas")).toBe("atlas");
    expect(leadOf(team([]), agents, "gone")).toBe("juno");
    expect(leadOf(team([]), [], null)).toBeNull();
  });
});
