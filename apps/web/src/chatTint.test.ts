import { describe, expect, it } from "vitest";
import { didThings, inkOn, roundAction } from "./chatTint.ts";

describe("chat tint", () => {
  it("picks dark ink on the light ghost colours and white on a dark one", () => {
    for (const c of ["#a98bf5", "#3cc0a6", "#f2a04a", "#6aa2f5", "#ef7fa8"]) expect(inkOn(c)).toBe("#161616");
    expect(inkOn("#2b2f3a")).toBe("#ffffff");
    expect(inkOn("not-a-colour")).toBe("#161616");
  });
});

describe("the composer's round button", () => {
  const idle = { hasContent: false, dictating: false, working: false, canStop: true, canCall: true, canDictate: true };

  it("calls when the field is empty and sends when it has text", () => {
    expect(roundAction(idle)).toBe("call");
    expect(roundAction({ ...idle, hasContent: true })).toBe("send");
  });

  it("is Stop while an agent works and nothing is typed; typing still sends", () => {
    expect(roundAction({ ...idle, working: true })).toBe("stop");
    expect(roundAction({ ...idle, working: true, hasContent: true })).toBe("send");
    // a guest can't stop a run
    expect(roundAction({ ...idle, working: true, canStop: false })).toBe("call");
  });

  it("dictates where there is nobody to call, and says so while it listens", () => {
    expect(roundAction({ ...idle, canCall: false })).toBe("dictate");
    expect(roundAction({ ...idle, canCall: false, canDictate: false })).toBe("send");
    expect(roundAction({ ...idle, dictating: true, hasContent: true })).toBe("listening");
  });
});

describe("what the agent did", () => {
  it("counts in plain words", () => {
    expect(didThings(1)).toBe("Did 1 thing");
    expect(didThings(4)).toBe("Did 4 things");
  });
});
