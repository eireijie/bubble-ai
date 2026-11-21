import { describe, expect, it } from "vitest";
import { contextWords } from "./contextWords.ts";

describe("contextWords", () => {
  it("maps fractions to matching words", () => {
    expect(contextWords(null)).toBe("Nothing used yet");
    expect(contextWords(0)).toBe("Nearly empty");
    expect(contextWords(15)).toBe("Under a quarter full");
    expect(contextWords(33)).toBe("Roughly a third full");
    expect(contextWords(50)).toBe("Roughly half full");
    expect(contextWords(70)).toBe("Over half full");
    expect(contextWords(80)).toBe("Getting full");
    expect(contextWords(95)).toBe("Nearly full");
  });
  it("17K of 258K is nearly empty, not a third", () => {
    expect(contextWords((17_000 / 258_000) * 100)).toBe("Nearly empty");
  });
});
