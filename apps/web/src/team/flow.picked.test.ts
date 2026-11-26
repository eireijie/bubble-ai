import { describe, expect, it } from "vitest";
import { addStep, builderLead, castFor, emptyTeam, seedTeam } from "./flow.ts";

const agents = [{ id: "juno" }, { id: "pip" }, { id: "rex" }];

describe("a new team starts from the agents picked for it", () => {
  it("puts the picked agents on the canvas, the first one first", () => {
    const team = seedTeam(emptyTeam(), ["pip", "rex"]);
    expect(team.steps?.map((s) => (s as { agentId?: string }).agentId)).toEqual(["pip", "rex"]);
    // the second follows the first
    expect(team.steps?.[0].next).toBe(team.steps?.[1].id);
    // a team that already has steps is left as it is
    expect(seedTeam(team, ["juno"])).toBe(team);
    expect(seedTeam(emptyTeam(), []).steps ?? []).toEqual([]);
  });

  it("gives a step added on an empty canvas to the picked agent, not the workspace's first", () => {
    const made = addStep(emptyTeam(), "agent", {}, castFor(agents, "pip", ["pip"]));
    expect((made.team.steps?.[0] as { agentId?: string }).agentId).toBe("pip");
    expect(castFor(agents, "pip", ["rex", "pip"]).map((a) => a.id)).toEqual(["pip", "rex", "juno"]);
  });

  it("keeps asking the picked lead, whoever a new step went to", () => {
    const made = addStep(emptyTeam(), "agent", {}, [{ id: "juno" }]);
    expect(builderLead(made.team, agents, "pip", null)).toBe("pip");
    expect(builderLead(made.team, agents, null, null)).toBe("juno");
    expect(builderLead(emptyTeam(), agents, null, "rex")).toBe("rex");
  });
});
