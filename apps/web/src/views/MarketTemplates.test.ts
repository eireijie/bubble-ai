import { describe, expect, it } from "vitest";
import { TEAM_TEMPLATES, templateFromTeam } from "@bubble-ai/core";
import { fillTemplate, freeName } from "../team/flow.ts";
import { AGENT_TEMPLATES, agentHit, firstLine, teamCast, teamHit } from "./marketTemplateData.ts";
const queryWords = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

describe("Marketplace agent and team templates", () => {
  it("offers the five agent templates, without Something else", () => {
    expect(AGENT_TEMPLATES.map((t) => t.name)).toEqual(["Daily assistant", "Work assistant", "Coding assistant", "Business manager", "Research assistant"]);
  });

  it("lists a ready-made team's roles with a one-line job each (board 15b)", () => {
    const plan = TEAM_TEMPLATES.find((t) => t.id === "plan-challenge")!;
    expect(teamCast(plan).map((m) => [m.name, m.job])).toEqual([
      ["Lead", "Plans and hands out the work"],
      ["Challenger", "Pushes back until the plan is right"],
      ["Backend builder", "Server, data and API"],
      ["Frontend builder", "The screens"],
      ["Reviewer", "Reads and tests every piece"],
    ]);
    // every ready-made team has a job for every role, and an agent count that matches the boards
    for (const t of TEAM_TEMPLATES) for (const m of teamCast(t)) expect(m.job, `${t.id}/${m.key}`).not.toBe("");
    expect(teamCast(TEAM_TEMPLATES.find((t) => t.id === "build-review")!)).toHaveLength(3);
  });

  it("reads a saved team by its steps, each once", () => {
    const team = fillTemplate(TEAM_TEMPLATES.find((t) => t.id === "build-review")!, [{ id: "a1", harness: "codex" }, { id: "a2", harness: "claude-code" }]);
    const saved = templateFromTeam(team, "Shop mornings");
    const cast = teamCast(saved);
    expect(cast.map((m) => m.name)).toEqual(["Build it", "Review the work", "Try it for real"]);
    expect(cast.map((m) => m.job)).toEqual(["Build what's asked", "Read the builder's work as a skeptical senior engineer", "Run the thing for real"]);
  });

  it("turns what an agent is told into a short job", () => {
    expect(firstLine("You check every claim against its source. More words.")).toBe("Check every claim against its source");
    expect(firstLine(undefined)).toBe("");
    expect(firstLine("x".repeat(100)).length).toBe(64);
    expect(firstLine("You dig into the question using primary sources and collect findings with links.")).toBe("Dig into the question using primary sources and collect finding…");
  });

  it("finds templates by name, what they do, apps and roles", () => {
    expect(AGENT_TEMPLATES.filter((t) => agentHit(queryWords("github"), t)).map((t) => t.id)).toEqual(["code"]);
    expect(TEAM_TEMPLATES.filter((t) => teamHit(queryWords("fact-checker"), t)).map((t) => t.id)).toEqual(["research-desk"]);
    expect(TEAM_TEMPLATES.filter((t) => teamHit(queryWords("bug"), t)).map((t) => t.id)).toContain("bug-squad");
  });

  it("names a team from a template so it doesn't clash with one here", () => {
    expect(freeName("Bug squad", ["general"])).toBe("Bug squad");
    expect(freeName("Bug squad", ["bug squad", "Bug squad 2"])).toBe("Bug squad 3");
  });
});
