import { describe, expect, it, vi } from "vitest";
import { normalizeSteps, teamProblem, type ChannelTeam, type TeamStep } from "@wisp/core";

// the pages these helpers live in read the browser as they load; none of it is used here
vi.mock("../src/theme.ts", () => ({ motionReduced: () => false, useMotionReduced: () => false }));
vi.mock("../src/api.ts", () => ({ api: vi.fn(), uploadFile: vi.fn(), getToken: () => "token", fileUrl: (id: string) => id, observeEvents: vi.fn(), ApiError: class extends Error {} }));
vi.mock("../src/markdown.ts", () => ({ renderMarkdown: (s: string) => s }));

// the app loads Channels first, and it and the team panel import each other: neither may use the other while loading
const { ChannelSettings } = await import("../src/components/Channels.tsx");
const { newTeamProblem, newTeamSettings, teamSlug } = await import("../src/team/Create.tsx");
const { knowsLine, repoName, scheduleLine } = await import("../src/components/TeamInfo.tsx");

const step = (id: string, extra: Partial<TeamStep> = {}): TeamStep => ({ id, roleId: "", kind: "do", action: id, agentId: "juno", next: null, x: 0, y: 0, ...extra });
const team = (steps: TeamStep[]): ChannelTeam => ({ nodes: [], edges: [], roles: [], steps: normalizeSteps(steps) });

describe("making a team: Done on the builder creates it", () => {
  it("names a team in lower case with dashes", () => {
    expect(teamSlug("  Launch Crew! ")).toBe("launch-crew");
  });
  it("with no steps, the agents picked by name become a plain team: the first one leads", () => {
    const made = newTeamSettings(team([]), ["juno", "atlas", "pip"])!;
    expect(made.nodes.map((n) => [n.agentId, n.lead])).toEqual([
      ["juno", true],
      ["atlas", false],
      ["pip", false],
    ]);
    expect(made.edges).toEqual([
      { from: "juno", to: "atlas" },
      { from: "juno", to: "pip" },
    ]);
    expect(teamProblem(made)).toBeNull();
    expect(newTeamProblem(team([]), ["juno", "atlas", "pip"])).toBeNull();
  });
  it("with no steps and fewer than two agents there is nothing to make yet", () => {
    expect(newTeamSettings(team([]), ["juno"])).toBeNull();
    expect(newTeamProblem(team([]), ["juno"])).toBe("Add a step first");
  });
  it("with steps, the steps are the team, and it still needs two agents", () => {
    const one = team([step("plan"), step("build")]);
    expect(newTeamProblem(one, ["juno", "atlas"])).toBe("Pick at least 2 agents");
    const two = team([step("plan"), step("build", { agentId: "atlas" })]);
    expect(newTeamProblem(two, [])).toBeNull();
    expect(newTeamSettings(two, [])!.steps).toHaveLength(2);
  });
});

describe("the team panel's rows say their value", () => {
  it("loads beside the settings sheet that shows it", () => {
    expect(typeof ChannelSettings).toBe("function");
  });
  it("Schedule: when it runs by itself, Off, or None", () => {
    expect(scheduleLine(null)).toBe("None");
    expect(scheduleLine({ steps: [step("plan")] })).toBe("None");
    expect(scheduleLine({ steps: [step("s", { kind: "schedule", schedule: "0 9 * * 1", enabled: false })] })).toBe("Off");
    const one = scheduleLine({ steps: [step("s", { kind: "schedule", schedule: "0 9 * * 1" })] });
    expect(one).toMatch(/Monday/);
    expect(scheduleLine({ steps: [step("s", { kind: "schedule", schedule: "0 9 * * 1" }), step("s2", { kind: "schedule", schedule: "0 9 * * 2" })] })).toBe(`${one} +1`);
  });
  it("Knows: its notes and its repo by name", () => {
    expect(knowsLine(null)).toBe("Nothing yet");
    expect(knowsLine({ folder: "teams/web", repo: "git@github.com:you/wisp.git" })).toBe("Notes, wisp repo");
    expect(knowsLine({ repo: "/Users/sam/code/app/" })).toBe("app repo");
    expect(repoName("https://github.com/you/site")).toBe("site");
  });
});
