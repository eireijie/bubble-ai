import { describe, expect, it } from "vitest";
import { roleSentence } from "../src/role-phrase.ts";

describe("what an agent says it does", () => {
  it("turns a third-person description into a first-person sentence", () => {
    expect(roleSentence("says pong")).toBe("I'm here to say pong.");
    expect(roleSentence("Says pong.")).toBe("I'm here to say pong.");
    expect(roleSentence("Keeps my days on track")).toBe("I'm here to keep your days on track.");
    expect(roleSentence("Keep my days on track.")).toBe("I'm here to keep your days on track.");
    expect(roleSentence("Fixes bugs in my repo")).toBe("I'm here to fix bugs in your repo.");
    expect(roleSentence("It tries new recipes")).toBe("I'm here to try new recipes.");
    expect(roleSentence("An agent that watches my inbox")).toBe("I'm here to watch your inbox.");
  });

  it("says a job as a job, and a topic as something it helps with", () => {
    expect(roleSentence("Engineer")).toBe("I'm your engineer.");
    expect(roleSentence("Sales assistant")).toBe("I'm your sales assistant.");
    expect(roleSentence("Researcher for my shop")).toBe("I'm your researcher for your shop.");
    expect(roleSentence("Emails and calendar")).toBe("I'll help with emails and calendar.");
    expect(roleSentence("Reports")).toBe("I'll help with reports.");
    expect(roleSentence("Answering support emails")).toBe("I'll be answering support emails.");
  });

  it("says nothing for no description", () => {
    expect(roleSentence("")).toBe("");
    expect(roleSentence("  . ")).toBe("");
  });
});
