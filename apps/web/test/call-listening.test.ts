import { describe, expect, it } from "vitest";
import { NEEDS_KEY_BROWSER, NEEDS_KEY_DESKTOP, planListening } from "../src/voice/engine.ts";

const base = { chosen: "device", desktop: false, recognition: true, hasKey: false } as const;

describe("planListening", () => {
  it("uses the browser's own listening with no key", () => expect(planListening(base)).toEqual({ engine: "device", problem: null }));
  it("does not force OpenAI when no key is set", () => expect(planListening({ ...base, chosen: "openai" })).toEqual({ engine: "device", problem: null }));
  it("uses OpenAI when chosen and a key is there", () => expect(planListening({ ...base, chosen: "openai", hasKey: true })).toEqual({ engine: "openai", problem: null }));
  it("keeps the browser engine when a key exists but device was chosen", () => expect(planListening({ ...base, hasKey: true }).engine).toBe("device"));
  it("falls back to OpenAI in a browser without recognition when a key exists", () => expect(planListening({ ...base, recognition: false, hasKey: true }).engine).toBe("openai"));
  it("says what to set up in a browser without recognition or a key", () => expect(planListening({ ...base, recognition: false })).toEqual({ engine: "device", problem: NEEDS_KEY_BROWSER }));
  it("never uses browser recognition in the desktop app", () => {
    expect(planListening({ ...base, desktop: true, hasKey: true }).engine).toBe("openai");
  });
  it("asks the desktop app for an OpenAI key when there is none", () => {
    expect(planListening({ ...base, desktop: true }).problem).toBe(NEEDS_KEY_DESKTOP);
    expect(planListening({ ...base, desktop: true, chosen: "openai" }).problem).toBe(NEEDS_KEY_DESKTOP);
  });
});
