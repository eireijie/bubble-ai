import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.ts";
import { aboutMeLine, loadAnswers, rememberGoals, saveGoals, skipGoals, turnOnFor } from "./onboardingV3.ts";

vi.mock("./api.ts", () => ({ api: vi.fn() }));

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), clear: () => mem.clear() });

describe("onboarding v3 goals", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api).mockReset();
  });

  it("turns on each thing once, routines with a schedule", () => {
    const t = turnOnFor(["code", "research"]);
    expect(t.map((x) => x.label)).toEqual(["Shared computer", "GitHub", "Code mod", "Memory notes"]);
    expect(turnOnFor(["email"])).toContainEqual({ kind: "routine", title: "Inbox check", time: "08:00", every: "day", label: "Inbox check, 8:00 daily" });
  });

  it("saves per workspace and drops unknown ids", () => {
    saveGoals("w1", ["email", "nope", "home"], "  plan trips ");
    const a = loadAnswers("w1");
    expect(a).toMatchObject({ goals: ["email", "home"], other: "plan trips", goalsDone: true, skipped: false });
    expect(a.turnOn.some((t) => t.kind === "mod" && t.id === "apple")).toBe(true);
    expect(loadAnswers("w2").goalsDone).toBe(false);
    skipGoals("w2");
    expect(loadAnswers("w2")).toMatchObject({ goals: [], goalsDone: true, skipped: true });
  });

  it("writes one About me line, replacing the old one", async () => {
    expect(aboutMeLine("Sam Lee", ["email", "code"], "taxes")).toBe("Sam wants help with: email, code. In their words: taxes");
    expect(aboutMeLine("Sam", [], "")).toBeNull();
    vi.mocked(api).mockImplementation(async (method: string) => (method === "GET" ? { items: [{ path: "people/u/x.md", text: "Sam wants help with: email." }] } : { saved: true }) as never);
    expect(await rememberGoals("Sam", ["writing"], "")).toBe(true);
    expect(vi.mocked(api)).toHaveBeenLastCalledWith("POST", "/api/memory/remember", expect.objectContaining({ kind: "preference", text: "Sam wants help with: writing.", replaces: "people/u/x.md" }));
  });
});
