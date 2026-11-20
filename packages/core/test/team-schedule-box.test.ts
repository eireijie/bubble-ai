import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE_PROMPT, scheduleProblem, startSteps, workSteps, type TeamStep } from "../src/index.ts";

const base = { roleId: "", x: 0, y: 0 };
const schedule: TeamStep = { ...base, id: "s", kind: "schedule", action: "", schedule: "0 9 * * 1", timezone: "UTC", prompt: DEFAULT_SCHEDULE_PROMPT, enabled: true, nexts: ["a"], inputs: [], next: "a" };
const work: TeamStep = { ...base, id: "a", kind: "do", action: "Write it", agentId: "x", nexts: ["b"], inputs: ["s"], next: "b" };
const work2: TeamStep = { ...base, id: "b", kind: "do", action: "Check it", agentId: "x", nexts: [], inputs: ["a"], next: null };

describe("schedule box", () => {
  it("a fresh schedule box with the default prompt has nothing to fix", () => {
    expect(DEFAULT_SCHEDULE_PROMPT.trim()).not.toBe("");
    expect(scheduleProblem(schedule)).toBeNull();
  });
  it("an emptied prompt is still flagged", () => {
    expect(scheduleProblem({ ...schedule, prompt: "  " })).toBe("Say what the schedule asks the team.");
  });
  it("the schedule box is not counted as a step", () => {
    expect(workSteps([schedule, work, work2]).map((s) => s.id)).toEqual(["a", "b"]);
  });
  it("steps a schedule points at are still where a message starts", () => {
    expect(startSteps([schedule, work, work2]).map((s) => s.id)).toEqual(["a"]);
  });
});
