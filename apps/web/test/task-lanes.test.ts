import { describe, expect, it } from "vitest";
import { closedLanes, groupOfState, requestTask, shortAgo, takeRequestedTask, taskMatches, titleAndBrief } from "../src/views/task-lanes.ts";

describe("the Tasks page's three groups", () => {
  it("puts to-do and waiting-for-a-computer under Doing, failed under Waiting on you, cancelled under Done", () => {
    expect(groupOfState("working")).toBe("doing");
    expect(groupOfState("todo")).toBe("doing");
    expect(groupOfState("blocked")).toBe("doing");
    expect(groupOfState("needsYou")).toBe("waiting");
    expect(groupOfState("failed")).toBe("waiting");
    expect(groupOfState("done")).toBe("done");
    expect(groupOfState("cancelled")).toBe("done");
  });

  it("keeps a cancelled task with the finished ones, never with the failed", () => {
    const lanes = closedLanes([
      { status: "done", result: "ok" },
      { status: "failed", result: "Cancelled by you" },
      { status: "failed", result: "The build broke" },
    ]);
    expect(lanes.failed.map((t) => t.result)).toEqual(["The build broke"]);
    expect(lanes.done.map((t) => t.result)).toEqual(["ok", "Cancelled by you"]);
  });
});

describe("the search field that replaced the filters", () => {
  const words = ["Fix the flaky upload test", "Atlas", "@atlas", "Backend", "team Launch crew", "Working", "Doing", null, "mine"];

  it("shows everything while empty", () => {
    expect(taskMatches("", words)).toBe(true);
    expect(taskMatches("   ", words)).toBe(true);
  });

  it("finds a task by who has it, its team, where it stands, or that you asked for it", () => {
    expect(taskMatches("atlas", words)).toBe(true);
    expect(taskMatches("launch crew", words)).toBe(true);
    expect(taskMatches("doing", words)).toBe(true);
    expect(taskMatches("mine", words)).toBe(true);
    expect(taskMatches("UPLOAD atlas", words)).toBe(true);
  });

  it("needs every word typed", () => {
    expect(taskMatches("atlas failed", words)).toBe(false);
    expect(taskMatches("pip", words)).toBe(false);
  });
});

describe("when a row last moved", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  const ago = (ms: number) => shortAgo(new Date(now - ms).toISOString(), now);

  it("is short", () => {
    expect(ago(20_000)).toBe("now");
    expect(ago(12 * 60_000)).toBe("12 min");
    expect(ago(60 * 60_000)).toBe("1 h");
    expect(ago(5 * 3600_000)).toBe("5 h");
  });

  it("names the day once it is older than a day, and the date after a week", () => {
    expect(ago(2 * 86400_000)).toBe(new Date(now - 2 * 86400_000).toLocaleDateString([], { weekday: "short" }));
    expect(ago(30 * 86400_000)).toBe(new Date(now - 30 * 86400_000).toLocaleDateString([], { month: "short", day: "numeric" }));
    expect(shortAgo("not a date", now)).toBe("");
  });
});

describe("a new task's one field", () => {
  it("uses a single line as both the title and the brief", () => {
    expect(titleAndBrief("  Book the dentist  ")).toEqual({ title: "Book the dentist", brief: "Book the dentist" });
  });

  it("takes the lines under the first as the details", () => {
    expect(titleAndBrief("Book the dentist\n\nThursday after 3, not Friday.")).toEqual({ title: "Book the dentist", brief: "Thursday after 3, not Friday." });
  });

  it("cuts a very long first line for the title and keeps all of it in the brief", () => {
    const long = "x".repeat(260);
    const { title, brief } = titleAndBrief(`${long}\nmore`);
    expect(title).toHaveLength(200);
    expect(title.endsWith("…")).toBe(true);
    expect(brief).toBe(`${long}\nmore`);
  });

  it("has no title while empty, so it can't be handed off", () => {
    expect(titleAndBrief(" \n ").title).toBe("");
  });
});

describe("a task another page asks Tasks to open", () => {
  it("is taken once", () => {
    requestTask({ id: "t1", tab: "checks" });
    expect(takeRequestedTask()).toEqual({ id: "t1", tab: "checks" });
    expect(takeRequestedTask()).toBeNull();
  });
});

describe("closedLanes", () => {
  it("keeps failed tasks out of Done, and cancelled ones out of Failed", () => {
    const lanes = closedLanes([{ status: "done" }, { status: "failed", result: "It crashed" }, { status: "failed", result: "Cancelled by you." }]);
    expect(lanes.failed.map((t) => t.result)).toEqual(["It crashed"]);
    expect(lanes.done).toHaveLength(2);
  });
  it("has nothing in Failed when nothing failed, so nothing of it lists under Waiting on you", () => {
    expect(closedLanes([{ status: "done" }]).failed).toEqual([]);
  });
});
