import { describe, expect, it } from "vitest";
import { slashEnterAction } from "../slashCommand.ts";

describe("slashEnterAction", () => {
  it("sends a typed command that takes no argument", () => {
    for (const name of ["new", "stop", "context"]) expect(slashEnterAction(`/${name}`, { name })).toBe("send");
    expect(slashEnterAction("@poopy /context", { name: "context" })).toBe("send");
  });
  it("sends /compact as typed even though its hint is optional", () => {
    expect(slashEnterAction("/compact", { name: "compact", hint: "what to keep" })).toBe("send");
  });
  it("fills a command that takes an argument", () => {
    expect(slashEnterAction("/model", { name: "model", hint: "name" })).toBe("pick");
  });
  it("fills when the typed text is only part of the name", () => {
    expect(slashEnterAction("/con", { name: "context" })).toBe("pick");
    expect(slashEnterAction("/", { name: "new" })).toBe("pick");
  });
});
