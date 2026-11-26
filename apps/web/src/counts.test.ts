import { describe, expect, it, vi } from "vitest";

vi.mock("./api.ts", () => ({ api: vi.fn(), setToken: vi.fn(), getToken: () => null }));
vi.mock("./notifications.ts", () => ({ notifyOn: vi.fn() }));
vi.mock("./components/ui.tsx", () => ({ agentColor: () => "" }));
vi.mock("./orgs.ts", () => ({ listOrgs: async () => [] }));

const { readyLeft, readyRows } = await import("./onboarding.ts");
const { inboxCount } = await import("./store.ts");

describe("Finish setup's count", () => {
  it("counts only what isn't done, the same rows its list ticks", () => {
    expect(readyLeft(readyRows({}))).toBe(4);
    expect(readyLeft(readyRows({ phone: true, apps: true, away: true, know: true }))).toBe(0);
    // put off still counts as left
    expect(readyLeft(readyRows({ phone: "later" }))).toBe(4);
  });

  it("counts a step done some other way (a phone paired on Computers, an app added, reachable away) as done", () => {
    const rows = readyRows({ know: true }, { phone: true, apps: true, away: true });
    expect(rows.every((r) => r.done)).toBe(true);
    expect(readyLeft(rows)).toBe(0);
    // done wins over put off
    expect(readyRows({ phone: "later" }, { phone: true })[0]).toMatchObject({ done: true, later: false });
  });
});

describe("the Needs you badge", () => {
  it("shows what the open page lists when the store alone knows less", () => {
    expect(inboxCount(0, 1)).toBe(1);
    expect(inboxCount(2, null)).toBe(2);
    expect(inboxCount(3, 1)).toBe(3);
    expect(inboxCount(0, null)).toBe(0);
  });
});
