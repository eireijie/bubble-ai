import { describe, expect, it } from "vitest";
import { BOARD_COLORS, looksFromWords } from "./lookWords.ts";

describe("looksFromWords", () => {
  it("gives four looks that keep what the words said", () => {
    const looks = looksFromWords("a calm green bubble with freckles and glasses");
    expect(looks).toHaveLength(4);
    for (const l of looks) {
      expect(l.color).toBe("#6cc4a1");
      expect(l.cheeks).toBe(true);
      expect(l.accessory).toBe("glasses");
      expect(l.motion).toBe("still");
      expect(l.parts).toBe(true);
    }
    // what the words leave open differs
    expect(new Set(looks.map((l) => l.bubble)).size).toBe(4);
  });

  it("is the same for the same words, and only uses saveable colours", () => {
    expect(looksFromWords("sunny")).toEqual(looksFromWords("sunny"));
    for (const l of looksFromWords("something odd")) expect(l.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("has the board's twelve colours", () => {
    expect(BOARD_COLORS).toHaveLength(12);
  });

  it("tells a bow tie from a bow", () => {
    expect(looksFromWords("a bow tie")[0].accessory).toBe("bowtie");
    expect(looksFromWords("a bow tie")[0].hat).toBe("none");
    expect(looksFromWords("a pink bow")[1].hat).toBe("bow");
  });
});
