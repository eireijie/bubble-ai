import { beforeEach, describe, expect, it, vi } from "vitest";
import { addFacts, dropFact, initKnow, pickApp, resetKnow, takeAnswer, useKnow } from "./onboardingKnow.ts";
import { loadAnswers } from "./onboardingV3.ts";

vi.mock("./api.ts", () => ({ api: vi.fn(async () => ({ available: true, label: "this Mac", items: [] })) }));

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), clear: () => mem.clear() });

describe("page 3 findings", () => {
  beforeEach(() => {
    mem.clear();
    resetKnow();
    initKnow("w1");
  });

  it("keeps the useful lines of another AI's answer, never people or secrets", () => {
    pickApp("grok");
    const n = takeAnswer("## About me\n- Pacific time\n## People\n- Alex is my accountant\n## Preferences and rules\n- Short answers\n- api key: sk-ant-abcdefghijklmnopqrstuvwxyz");
    expect(n).toBe(2);
    expect(useKnow.getState().facts.map((f) => [f.group, f.text, f.src])).toEqual([
      ["You", "Pacific time", "Grok"],
      ["Likes", "Short answers", "Grok"],
    ]);
    expect(useKnow.getState().imported).toEqual({ app: "Grok", kept: 2 });
    expect(loadAnswers("w1").facts).toHaveLength(2);
  });

  it("a removed chip isn't added back by a later look", () => {
    addFacts([{ group: "Work", text: "shop-web", src: "projects" }]);
    dropFact(useKnow.getState().facts[0].id);
    addFacts([{ group: "Work", text: "shop-web", src: "projects" }]);
    expect(useKnow.getState().facts).toEqual([]);
  });
});
